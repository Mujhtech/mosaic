// Package billingdiagnosticshttp exposes the Phase 9B projection health surface
// over HTTP.
//
// The handler is a transport adapter and nothing else: it reads the path,
// calls the application service, and writes a standardized response. It makes
// no authorization decision — the repository does, against organization
// membership — and it never calls render.JSON.
package billingdiagnosticshttp

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	validation "github.com/go-ozzo/ozzo-validation/v4"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingdiagnostics"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/authn"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
)

type Handler struct {
	service *billingdiagnostics.Service
}

// RegisterProjectRoutes mounts the operator surface. Projection health is a
// sibling of the Phase 9A billing health route (`/billing/health`) rather than a
// field on it, because the two summaries are read by operators answering
// different questions and merging them would make one page that is wrong for
// both.
//
// `expensive` is the export-class rate limit the other history-scanning billing
// operations already share. A replay recomputes committed state for every scope
// it names, so it belongs in that bucket rather than the baseline API one.
func RegisterProjectRoutes(router chi.Router, service *billingdiagnostics.Service,
	expensive ...func(http.Handler) http.Handler) {

	h := &Handler{service: service}
	router.Get("/environments/{environmentId}/billing/projection-health", h.projectionHealth)

	guarded := make([]func(http.Handler) http.Handler, 0, len(expensive))
	for _, middleware := range expensive {
		if middleware != nil {
			guarded = append(guarded, middleware)
		}
	}
	router.With(guarded...).
		Post("/environments/{environmentId}/billing/projection-replays", h.replay)
}

// replayRequest is the transport shape of a bounded replay.
//
// There is deliberately no "replay everything" member. An unbounded replay is
// not a replay, it is a migration, and bulk migration tooling is out of Phase 9B
// (plan §18) — so the absence of the field, rather than a check, is what makes
// it unavailable.
type replayRequest struct {
	SubscriptionInstanceID string `json:"subscriptionInstanceId,omitempty"`
	BillingCustomerID      string `json:"billingCustomerId,omitempty"`
	WindowStart            string `json:"windowStart,omitempty"`
	WindowEnd              string `json:"windowEnd,omitempty"`
	ProjectionRuleVersion  int    `json:"projectionRuleVersion,omitempty"`
	Limit                  int    `json:"limit,omitempty"`
}

func (q replayRequest) Validate() error {
	return validation.ValidateStruct(&q,
		validation.Field(&q.SubscriptionInstanceID, validation.Length(0, 128)),
		validation.Field(&q.BillingCustomerID, validation.Length(0, 128)),
		validation.Field(&q.WindowStart, validation.Date(time.RFC3339)),
		validation.Field(&q.WindowEnd, validation.Date(time.RFC3339)),
		validation.Field(&q.ProjectionRuleVersion, validation.Min(0), validation.Max(1000000)),
		validation.Field(&q.Limit, validation.Min(0), validation.Max(500)),
	)
}

func (h *Handler) replay(w http.ResponseWriter, r *http.Request) {
	var request replayRequest
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		response.Error(w, r, response.ValidationFailed(map[string][]string{
			"body": {"The request body could not be read."}}))
		return
	}
	if err := request.Validate(); err != nil {
		response.Error(w, r, response.ValidationFailed(map[string][]string{
			"body": {"The request contains invalid fields."}}))
		return
	}

	principal, _ := authn.FromContext(r.Context())
	result, err := h.service.Replay(r.Context(), billingdiagnostics.Actor{ID: principal.ActorID},
		chi.URLParam(r, "projectId"), chi.URLParam(r, "environmentId"),
		billingdiagnostics.ReplayRequest{
			SubscriptionInstanceID: request.SubscriptionInstanceID,
			CustomerID:             request.BillingCustomerID,
			WindowStart:            optionalTime(request.WindowStart),
			WindowEnd:              optionalTime(request.WindowEnd),
			RuleVersion:            request.ProjectionRuleVersion,
			Limit:                  request.Limit,
		})
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func optionalTime(value string) *time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil
	}
	utc := parsed.UTC()
	return &utc
}

// maxBodyBytes bounds the replay request. The largest legitimate body names one
// instance, one customer, a window, a rule version, and a limit.
const maxBodyBytes = 4 * 1024

func (h *Handler) projectionHealth(w http.ResponseWriter, r *http.Request) {
	principal, _ := authn.FromContext(r.Context())
	health, err := h.service.ProjectionHealth(r.Context(),
		billingdiagnostics.Actor{ID: principal.ActorID},
		chi.URLParam(r, "projectId"), chi.URLParam(r, "environmentId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, health)
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	status, code, message := http.StatusInternalServerError, "internal_error", "An unexpected error occurred."
	switch {
	case errors.Is(err, billingdiagnostics.ErrUnauthenticated):
		status, code, message = http.StatusUnauthorized, "unauthenticated", "Authentication is required."
	case errors.Is(err, billingdiagnostics.ErrForbidden):
		status, code, message = http.StatusForbidden, "forbidden", "The actor may not read this resource."
	case errors.Is(err, billingdiagnostics.ErrNotFound):
		status, code, message = http.StatusNotFound, "not_found", "The requested resource was not found."
	case errors.Is(err, billingdiagnostics.ErrInvalid):
		status, code, message = http.StatusUnprocessableEntity, "validation_failed",
			"The replay must be bounded and must name a rule version this build derives under."
	case errors.Is(err, billingdiagnostics.ErrBillingDisabled):
		status, code, message = http.StatusConflict, "billing_not_enabled",
			"Mosaic Billing is not enabled for this Project."
	case errors.Is(err, billingdiagnostics.ErrUnavailable):
		status, code, message = http.StatusServiceUnavailable, "billing_storage_unavailable",
			"Projection health could not be read."
	}
	response.Error(w, r, response.NewAPIError(status, code, message))
}
