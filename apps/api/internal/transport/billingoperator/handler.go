// Package billingoperatorhttp exposes Mosaic's Phase 9B operator surface over
// HTTP: billing customer search, list, and detail; entitlement snapshot,
// subscription, and timeline reads; identity conflict inspection and
// resolution; and restore/sync visibility.
//
// Every route here is registered inside the authenticated dashboard subtree, so
// it is reached with a browser session principal and nothing else. That is the
// whole point of the package: the equivalent trusted-server surfaces
// authenticate a secret server API key, which a browser does not hold and must
// not be given, so the dashboard could not reach any 9B customer state at all
// before these routes existed. The secret-key surfaces are unchanged — they are
// the application-backend contract.
//
// Handlers are strictly thin: read the path, decode, validate transport shape,
// call the application service, write a standardized response. No handler
// decides authorization, touches the database, or calls render.JSON.
//
// No response in this package carries an alias value or an alias digest. The
// application service's view types have no field for one.
package billingoperatorhttp

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	validation "github.com/go-ozzo/ozzo-validation/v4"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingoperator"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/authn"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
)

// maxBodyBytes bounds every request body here. The largest legitimate body is a
// conflict resolution carrying a five-hundred-character reason.
const maxBodyBytes = 8 * 1024

type Handler struct {
	service *billingoperator.Service
}

// RegisterProjectRoutes mounts the operator surface under the project-scoped
// dashboard subtree, following exactly the shape the Phase 9A billing operator
// pages already use: Environment-scoped state under
// `/environments/{environmentId}/billing/...`, Project-scoped state under
// `/billing/...`.
//
// `guarded` is the export-class rate limit. Two routes take it. The lookup is
// bounded because it is the one surface that accepts an attacker-chosen
// identifier and reports whether it matched, and an unbounded one is an
// enumeration oracle over a Project's users even though it returns nothing on a
// miss. The sync request is bounded because it enqueues projection work.
func RegisterProjectRoutes(router chi.Router, service *billingoperator.Service,
	guarded ...func(http.Handler) http.Handler) {

	h := &Handler{service: service}
	limited := make([]func(http.Handler) http.Handler, 0, len(guarded))
	for _, middleware := range guarded {
		if middleware != nil {
			limited = append(limited, middleware)
		}
	}

	router.Route("/environments/{environmentId}/billing", func(environment chi.Router) {
		environment.Get("/customers", h.listCustomers)
		environment.With(limited...).Post("/customer-lookups", h.lookupCustomer)
		environment.Get("/customers/{customerId}", h.customer)
		environment.Get("/customers/{customerId}/entitlements", h.snapshot)
		environment.Get("/customers/{customerId}/subscriptions", h.subscriptions)
		environment.With(limited...).Post("/customers/{customerId}/sync-requests", h.requestSync)

		environment.Get("/subscriptions/{instanceId}", h.subscription)
		environment.Get("/subscriptions/{instanceId}/timeline", h.timeline)

		environment.Get("/restore-jobs", h.listRestoreJobs)
		environment.Get("/restore-jobs/{restoreId}", h.restoreJob)
	})

	// Identity conflicts are Project-scoped, and the route says so. A conflict
	// is a dispute about who a person is, and identity in Mosaic belongs to the
	// Project (OD-3(b)); filing it under an Environment would imply it could be
	// resolved differently in staging than in production.
	router.Route("/billing/identity-conflicts", func(conflicts chi.Router) {
		conflicts.Get("/", h.listConflicts)
		conflicts.Get("/{conflictId}", h.conflict)
		conflicts.With(limited...).Post("/{conflictId}/resolution", h.resolveConflict)
	})
}

// ---------------------------------------------------------------------------
// Customer lookup
// ---------------------------------------------------------------------------

// lookupRequest is the typed-identifier search.
//
// It is a POST with a body rather than a GET with a query parameter, and that
// is a privacy decision rather than a REST one: the submitted value is an
// application user id or an installation id — a person — and a query string is
// written to access logs, proxy logs, browser history, and referrer headers.
// The body is read once, digested, and dropped.
type lookupRequest struct {
	IdentifierType  string `json:"identifierType"`
	IdentifierValue string `json:"identifierValue"`
}

func (q lookupRequest) Validate() error {
	return validation.ValidateStruct(&q,
		validation.Field(&q.IdentifierType, validation.Required,
			validation.In(billingoperator.IdentifierBillingCustomerID,
				billingoperator.IdentifierApplicationUserID,
				billingoperator.IdentifierInstallationID)),
		validation.Field(&q.IdentifierValue, validation.Required, validation.Length(1, 512)),
	)
}

func (h *Handler) lookupCustomer(w http.ResponseWriter, r *http.Request) {
	var request lookupRequest
	if !decode(w, r, &request) {
		return
	}
	if err := request.Validate(); err != nil {
		// The field errors are not echoed. A validation message on this surface
		// would be the one place the submitted identifier could be reflected back
		// into a response body.
		writeValidation(w, r, map[string][]string{
			"identifierType": {"The request must name a supported identifier type and a value."}})
		return
	}
	result, err := h.service.LookupCustomer(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "environmentId"),
		request.IdentifierType, request.IdentifierValue)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

func (h *Handler) listCustomers(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	filter := billingoperator.CustomerFilter{
		Status:         strings.TrimSpace(query.Get("status")),
		ConflictedOnly: query.Get("conflictedOnly") == "true",
	}
	switch strings.TrimSpace(query.Get("identified")) {
	case "true":
		value := true
		filter.Identified = &value
	case "false":
		value := false
		filter.Identified = &value
	}
	limit, _ := strconv.Atoi(query.Get("limit"))

	customers, next, err := h.service.ListCustomers(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "environmentId"),
		filter, limit, strings.TrimSpace(query.Get("cursor")))
	if err != nil {
		writeError(w, r, err)
		return
	}
	payload := map[string]any{"items": customers}
	if next != "" {
		payload["nextCursor"] = next
	}
	response.OK(w, r, payload)
}

func (h *Handler) customer(w http.ResponseWriter, r *http.Request) {
	detail, err := h.service.Customer(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "environmentId"), chi.URLParam(r, "customerId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, detail)
}

func (h *Handler) snapshot(w http.ResponseWriter, r *http.Request) {
	snapshot, status, err := h.service.Snapshot(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "environmentId"), chi.URLParam(r, "customerId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, map[string]any{"snapshot": snapshot, "projectionStatus": status})
}

func (h *Handler) subscriptions(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	subscriptions, next, err := h.service.Subscriptions(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "environmentId"), chi.URLParam(r, "customerId"),
		limit, strings.TrimSpace(r.URL.Query().Get("cursor")))
	if err != nil {
		writeError(w, r, err)
		return
	}
	payload := map[string]any{"items": subscriptions}
	if next != "" {
		payload["nextCursor"] = next
	}
	response.OK(w, r, payload)
}

func (h *Handler) subscription(w http.ResponseWriter, r *http.Request) {
	subscription, err := h.service.Subscription(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "environmentId"), chi.URLParam(r, "instanceId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, subscription)
}

func (h *Handler) timeline(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	entries, next, err := h.service.Timeline(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "environmentId"), chi.URLParam(r, "instanceId"),
		limit, strings.TrimSpace(r.URL.Query().Get("cursor")))
	if err != nil {
		writeError(w, r, err)
		return
	}
	payload := map[string]any{"items": entries}
	if next != "" {
		payload["nextCursor"] = next
	}
	response.OK(w, r, payload)
}

// ---------------------------------------------------------------------------
// Identity conflicts
// ---------------------------------------------------------------------------

func (h *Handler) listConflicts(w http.ResponseWriter, r *http.Request) {
	conflicts, err := h.service.ListConflicts(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), strings.TrimSpace(r.URL.Query().Get("status")))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, map[string]any{"items": conflicts})
}

func (h *Handler) conflict(w http.ResponseWriter, r *http.Request) {
	detail, err := h.service.Conflict(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "conflictId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, detail)
}

// resolutionRequest is the OD-10 operator decision.
//
// `reason` is required by the schema of this request and again by the
// application service. It is not ceremony: every action here moves committed
// access for at least one paying customer, and the audit entry an investigation
// reads months later is worth nothing without the why.
type resolutionRequest struct {
	Action             string `json:"action"`
	AssignedCustomerID string `json:"assignedBillingCustomerId,omitempty"`
	Reason             string `json:"reason"`
}

func (q resolutionRequest) Validate() error {
	return validation.ValidateStruct(&q,
		validation.Field(&q.Action, validation.Required,
			validation.In(billingoperator.ActionKeepExisting,
				billingoperator.ActionReassign, billingoperator.ActionSplit)),
		validation.Field(&q.AssignedCustomerID, validation.Length(0, 128)),
		validation.Field(&q.Reason, validation.Required, validation.Length(1, 500)),
	)
}

func (h *Handler) resolveConflict(w http.ResponseWriter, r *http.Request) {
	var request resolutionRequest
	if !decode(w, r, &request) {
		return
	}
	if err := request.Validate(); err != nil {
		writeValidation(w, r, validationFields(err))
		return
	}
	conflict, err := h.service.ResolveConflict(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "conflictId"),
		request.Action, request.AssignedCustomerID, request.Reason)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, conflict)
}

// ---------------------------------------------------------------------------
// Restore and sync
// ---------------------------------------------------------------------------

func (h *Handler) requestSync(w http.ResponseWriter, r *http.Request) {
	request, err := h.service.RequestSync(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "environmentId"), chi.URLParam(r, "customerId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.Accepted(w, r, map[string]any{
		"billingCustomerId":  request.BillingCustomerID,
		"projectId":          request.ProjectID,
		"environmentId":      request.EnvironmentID,
		"projectionScopeKey": request.ScopeKey,
		"triggerKind":        request.Kind,
		"requestedAt":        request.RequestedAt.UTC(),
		"status":             "queued",
	})
}

func (h *Handler) listRestoreJobs(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	limit, _ := strconv.Atoi(query.Get("limit"))
	jobs, next, err := h.service.ListRestoreJobs(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "environmentId"),
		strings.TrimSpace(query.Get("billingCustomerId")), limit, strings.TrimSpace(query.Get("cursor")))
	if err != nil {
		writeError(w, r, err)
		return
	}
	payload := map[string]any{"items": jobs}
	if next != "" {
		payload["nextCursor"] = next
	}
	response.OK(w, r, payload)
}

func (h *Handler) restoreJob(w http.ResponseWriter, r *http.Request) {
	job, err := h.service.RestoreJob(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "environmentId"), chi.URLParam(r, "restoreId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, job)
}

// ---------------------------------------------------------------------------
// Transport helpers
// ---------------------------------------------------------------------------

func actor(r *http.Request) billingoperator.Actor {
	principal, _ := authn.FromContext(r.Context())
	return billingoperator.Actor{ID: principal.ActorID}
}

func decode(w http.ResponseWriter, r *http.Request, target any) bool {
	if encoding := r.Header.Get("Content-Encoding"); encoding != "" && encoding != "identity" {
		writeValidation(w, r, map[string][]string{"body": {"The request encoding is not supported."}})
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	decoder := json.NewDecoder(r.Body)
	// An unknown member is rejected rather than dropped: on a lookup surface a
	// silently ignored field would let an operator believe they had searched by
	// an identifier Mosaic never read.
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeValidation(w, r, map[string][]string{"body": {"The request body could not be read."}})
		return false
	}
	return true
}

func validationFields(err error) map[string][]string {
	fields := map[string][]string{}
	var errs validation.Errors
	if errors.As(err, &errs) {
		for name, fieldErr := range errs {
			fields[name] = []string{fieldErr.Error()}
		}
		return fields
	}
	fields["body"] = []string{"The request contains invalid fields."}
	return fields
}

func writeValidation(w http.ResponseWriter, r *http.Request, fields map[string][]string) {
	response.Error(w, r, response.ValidationFailed(fields))
}

// writeError maps operator-domain errors onto HTTP in one place. The Cause is
// never populated: response.Error logs the cause behind every 5xx, and on this
// surface a cause can quote a query carrying an alias digest.
func writeError(w http.ResponseWriter, r *http.Request, err error) {
	status, code, message := http.StatusInternalServerError, "internal_error", "An unexpected error occurred."
	switch {
	case errors.Is(err, billingoperator.ErrUnauthenticated):
		status, code, message = http.StatusUnauthorized, "unauthenticated", "Authentication is required."
	case errors.Is(err, billingoperator.ErrForbidden):
		status, code, message = http.StatusForbidden, "forbidden", "The actor may not read this resource."
	case errors.Is(err, billingoperator.ErrNotFound):
		status, code, message = http.StatusNotFound, "not_found", "The requested resource was not found."
	case errors.Is(err, billingoperator.ErrInvalid):
		status, code, message = http.StatusUnprocessableEntity, "validation_failed",
			"The request contains invalid fields."
	case errors.Is(err, billingoperator.ErrConflict):
		status, code, message = http.StatusConflict, "conflict", "The resource is in a conflicting state."
	case errors.Is(err, billingoperator.ErrBillingDisabled):
		status, code, message = http.StatusConflict, "billing_not_enabled",
			"Mosaic Billing is not enabled for this Project."
	case errors.Is(err, billingoperator.ErrUnavailable):
		status, code, message = http.StatusServiceUnavailable, "billing_storage_unavailable",
			"Billing customer state could not be read."
	}
	response.Error(w, r, response.NewAPIError(status, code, message))
}
