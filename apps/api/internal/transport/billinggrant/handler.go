// Package billinggranthttp exposes the Phase 9B Product-to-Entitlement Grant
// Version management surface over HTTP (WP9).
//
// Three operations, and the boundaries between them are the design:
//
//   - reading a pair's history changes nothing and is available to any member
//     of the owning organization;
//   - previewing impact changes nothing, not even the audit trail, so an
//     operator may ask as often as they like before deciding;
//   - publishing is the one call that changes what a Product grants, and it
//     requires an actor, a reason, and an admin role.
//
// There is deliberately no update route that succeeds. A published version is
// immutable — that is what makes historical access reproducible — so the edit
// verbs answer a specific 409 telling the caller to publish a superseding
// version, rather than a bare 405 that reads like a routing mistake.
//
// Handlers are strictly thin: decode, validate transport shape, call the
// application service, map the result. No handler decides authorization,
// touches the database, or calls render.JSON.
package billinggranthttp

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	validation "github.com/go-ozzo/ozzo-validation/v4"

	"github.com/Mujhtech/mosaic/apps/api/internal/billinggrant"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/authn"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
)

// maxBodyBytes bounds every request body here. The largest legitimate body
// names one pair, one instant, five policy flags, and a reason.
const maxBodyBytes = 8 * 1024

const timestampLayout = "2006-01-02T15:04:05.000Z"

type Handler struct {
	service *billinggrant.Service
}

// RegisterProjectRoutes mounts the grant-version surface under the
// Project-scoped authenticated subtree.
//
// `expensive` is the export-class rate limit the other history-scanning billing
// operations share. Publishing enqueues a reprojection for every affected
// customer and the preview counts across the Project's current snapshots, so
// both belong in that bucket rather than the baseline API one. The history read
// does not: it is a plain indexed lookup an operator refreshes while working.
func RegisterProjectRoutes(router chi.Router, service *billinggrant.Service,
	expensive ...func(http.Handler) http.Handler) {

	h := &Handler{service: service}
	guarded := make([]func(http.Handler) http.Handler, 0, len(expensive))
	for _, middleware := range expensive {
		if middleware != nil {
			guarded = append(guarded, middleware)
		}
	}

	router.Route("/billing/grant-versions", func(versions chi.Router) {
		versions.Get("/", h.list)
		versions.Get("/{versionId}", h.version)
		versions.With(guarded...).Post("/", h.publish)
		versions.With(guarded...).Post("/impact-preview", h.preview)

		// The three verbs a caller reaches for when it wants to edit. Each
		// answers the same 409, because the answer is the same: a published
		// grant version is a historical fact, and changing it would change what
		// a customer was entitled to at a moment that has already passed.
		versions.Patch("/{versionId}", h.immutable)
		versions.Put("/{versionId}", h.immutable)
		versions.Delete("/{versionId}", h.immutable)
	})
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	limit := 0
	if raw := strings.TrimSpace(query.Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > billinggrant.MaxListLimit {
			writeValidation(w, r, map[string][]string{
				"limit": {"limit must be between 1 and " + strconv.Itoa(billinggrant.MaxListLimit) + "."}})
			return
		}
		limit = parsed
	}
	versions, err := h.service.ListVersions(r.Context(), actor(r), chi.URLParam(r, "projectId"),
		billinggrant.ListFilter{
			ProductID:     strings.TrimSpace(query.Get("productId")),
			EntitlementID: strings.TrimSpace(query.Get("entitlementId")),
			CurrentOnly:   query.Get("currentOnly") == "true",
			Limit:         limit,
		})
	if err != nil {
		writeError(w, r, err)
		return
	}
	items := make([]map[string]any, 0, len(versions))
	for _, version := range versions {
		items = append(items, versionResponse(version))
	}
	response.OK(w, r, map[string]any{"items": items})
}

func (h *Handler) version(w http.ResponseWriter, r *http.Request) {
	version, err := h.service.Version(r.Context(), actor(r), chi.URLParam(r, "projectId"),
		strings.TrimSpace(chi.URLParam(r, "versionId")))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, versionResponse(version))
}

// ---------------------------------------------------------------------------
// Preview and publish
// ---------------------------------------------------------------------------

// proposalRequest is the transport shape of a proposed grant version. Preview
// and publish take the same body, so an operator previews exactly what they are
// about to publish rather than something adjacent to it.
type proposalRequest struct {
	ProductID              string   `json:"productId"`
	EntitlementID          string   `json:"entitlementId"`
	EffectiveStart         string   `json:"effectiveStart"`
	Retroactive            bool     `json:"retroactive,omitempty"`
	SupportedPurchaseTypes []string `json:"supportedPurchaseTypes,omitempty"`
	GrantsInActive         *bool    `json:"grantsInActive,omitempty"`
	GrantsInTrial          *bool    `json:"grantsInTrial,omitempty"`
	GrantsInGrace          *bool    `json:"grantsInGrace,omitempty"`
	GrantsInBillingRetry   *bool    `json:"grantsInBillingRetry,omitempty"`
	GrantsInPaused         *bool    `json:"grantsInPaused,omitempty"`
	GrantsInOneTime        *bool    `json:"grantsInOneTimeOwnership,omitempty"`
	Reason                 string   `json:"reason,omitempty"`
}

func (q proposalRequest) Validate() error {
	return validation.ValidateStruct(&q,
		validation.Field(&q.ProductID, validation.Required, validation.Length(1, 128)),
		validation.Field(&q.EntitlementID, validation.Required, validation.Length(1, 128)),
		validation.Field(&q.EffectiveStart, validation.Required, validation.Date(time.RFC3339)),
		validation.Field(&q.SupportedPurchaseTypes, validation.Length(0, 4)),
		validation.Field(&q.Reason, validation.Length(0, 512)),
	)
}

// input maps the request onto the domain proposal.
//
// The policy flags are pointers so an omitted flag takes the documented default
// rather than Go's zero value. A missing `grantsInActive` defaulting to false
// would publish a version that grants nothing during an active subscription —
// the exact opposite of what an operator who left the field out meant.
func (q proposalRequest) input() billinggrant.PublishInput {
	start, _ := time.Parse(time.RFC3339, strings.TrimSpace(q.EffectiveStart))
	return billinggrant.PublishInput{
		ProductID:              strings.TrimSpace(q.ProductID),
		EntitlementID:          strings.TrimSpace(q.EntitlementID),
		EffectiveStart:         start.UTC(),
		Retroactive:            q.Retroactive,
		SupportedPurchaseTypes: q.SupportedPurchaseTypes,
		Policy: billingprojection.Policy{
			GrantsInActive:       boolOr(q.GrantsInActive, true),
			GrantsInTrial:        boolOr(q.GrantsInTrial, true),
			GrantsInGrace:        boolOr(q.GrantsInGrace, true),
			GrantsInBillingRetry: boolOr(q.GrantsInBillingRetry, false),
			GrantsInOneTime:      boolOr(q.GrantsInOneTime, true),
		},
		GrantsInPaused: boolOr(q.GrantsInPaused, false),
		Reason:         strings.TrimSpace(q.Reason),
	}
}

func boolOr(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

func (h *Handler) preview(w http.ResponseWriter, r *http.Request) {
	var request proposalRequest
	if !decode(w, r, &request) {
		return
	}
	if err := request.Validate(); err != nil {
		writeValidation(w, r, validationFields(err))
		return
	}
	impact, err := h.service.PreviewImpact(r.Context(), actor(r), chi.URLParam(r, "projectId"), request.input())
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, impactResponse(impact))
}

func (h *Handler) publish(w http.ResponseWriter, r *http.Request) {
	var request proposalRequest
	if !decode(w, r, &request) {
		return
	}
	if err := request.Validate(); err != nil {
		writeValidation(w, r, validationFields(err))
		return
	}
	published, err := h.service.Publish(r.Context(), actor(r), chi.URLParam(r, "projectId"), request.input())
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.Created(w, r, versionResponse(published))
}

// immutable answers every in-place edit of a published version.
func (h *Handler) immutable(w http.ResponseWriter, r *http.Request) {
	writeError(w, r, billinggrant.ErrImmutable)
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

func versionResponse(version billinggrant.Version) map[string]any {
	payload := map[string]any{
		"grantVersionId":         version.ID,
		"projectId":              version.ProjectID,
		"productId":              version.ProductID,
		"productKey":             version.ProductKey,
		"entitlementId":          version.EntitlementID,
		"entitlementKey":         version.EntitlementKey,
		"version":                version.Version,
		"grantPolicyVersion":     version.GrantPolicyVersion,
		"effectiveStart":         version.EffectiveStart.UTC().Format(timestampLayout),
		"current":                version.Current(),
		"retroactive":            version.Retroactive,
		"supportedPurchaseTypes": version.SupportedPurchaseTypes,
		"accessPolicy": map[string]any{
			"grantsInActive":           version.Policy.GrantsInActive,
			"grantsInTrial":            version.Policy.GrantsInTrial,
			"grantsInGrace":            version.Policy.GrantsInGrace,
			"grantsInBillingRetry":     version.Policy.GrantsInBillingRetry,
			"grantsInPaused":           false,
			"grantsInOneTimeOwnership": version.Policy.GrantsInOneTime,
		},
		"createdAt": version.CreatedAt.UTC().Format(timestampLayout),
		"reason":    version.Reason,
	}
	if version.EffectiveEnd != nil {
		payload["effectiveEnd"] = version.EffectiveEnd.UTC().Format(timestampLayout)
	}
	if version.CreatedByActorID != "" {
		payload["createdByActorId"] = version.CreatedByActorID
	}
	return payload
}

func impactResponse(impact billinggrant.Impact) map[string]any {
	payload := map[string]any{
		"productId":             impact.ProductID,
		"entitlementId":         impact.EntitlementID,
		"impactedProducts":      impact.ImpactedProducts,
		"impactedEntitlements":  impact.ImpactedEntitlements,
		"impactedCustomers":     impact.ImpactedCustomers,
		"impactedActiveSources": impact.ImpactedActiveSources,
		"impactedLineages":      impact.ImpactedLineages,
		"retroactive":           impact.Retroactive,
		"additiveSuperset":      impact.AdditiveSuperset,
		"observedAt":            impact.ObservedAt.UTC().Format(timestampLayout),
	}
	if impact.NarrowingCode != "" {
		payload["narrowingCode"] = impact.NarrowingCode
	}
	if impact.CurrentVersion != nil {
		payload["currentVersion"] = versionResponse(*impact.CurrentVersion)
	}
	return payload
}

// ---------------------------------------------------------------------------
// Transport helpers
// ---------------------------------------------------------------------------

func actor(r *http.Request) billinggrant.Actor {
	principal, _ := authn.FromContext(r.Context())
	return billinggrant.Actor{ID: principal.ActorID}
}

func decode(w http.ResponseWriter, r *http.Request, target any) bool {
	if encoding := r.Header.Get("Content-Encoding"); encoding != "" && encoding != "identity" {
		writeValidation(w, r, map[string][]string{"body": {"The request encoding is not supported."}})
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	decoder := json.NewDecoder(r.Body)
	// An unknown member is rejected rather than dropped. On a surface that
	// decides access, a silently ignored field would let an operator believe
	// they had set a policy Mosaic never read.
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

// writeError maps grant-domain errors onto HTTP in one place.
//
// The four refusal codes are deliberately distinct rather than one `conflict`.
// An operator told "conflict" retries; an operator told
// `grant_version_immutable`, `grant_interval_overlap`, or
// `grant_not_additive_superset` knows which rule they hit and what to do
// instead, and each of those is a different next action.
func writeError(w http.ResponseWriter, r *http.Request, err error) {
	status, code, message := http.StatusInternalServerError, "internal_error", "An unexpected error occurred."
	switch {
	case errors.Is(err, billinggrant.ErrUnauthenticated):
		status, code, message = http.StatusUnauthorized, "unauthenticated", "Authentication is required."
	case errors.Is(err, billinggrant.ErrForbidden):
		status, code, message = http.StatusForbidden, "forbidden",
			"The actor may not publish grant versions for this Project."
	case errors.Is(err, billinggrant.ErrNotFound):
		status, code, message = http.StatusNotFound, "not_found", "The requested resource was not found."
	case errors.Is(err, billinggrant.ErrImmutable):
		status, code, message = http.StatusConflict, "grant_version_immutable",
			"A published grant version cannot be edited. Publish a superseding version instead."
	case errors.Is(err, billinggrant.ErrOverlap):
		status, code, message = http.StatusUnprocessableEntity, "grant_interval_overlap",
			"The proposed effective start overlaps a recorded grant version."
	case errors.Is(err, billinggrant.ErrNotAdditiveSuperset):
		status, code, message = http.StatusUnprocessableEntity, "grant_not_additive_superset",
			"A retroactive grant version may add or widen access, never remove or narrow it."
	case errors.Is(err, billinggrant.ErrInvalid):
		status, code, message = http.StatusUnprocessableEntity, "validation_failed",
			"The proposed grant version is not permitted."
	case errors.Is(err, billinggrant.ErrConflict):
		status, code, message = http.StatusConflict, "conflict",
			"The grant history changed while this change was being validated. Review it and try again."
	case errors.Is(err, billinggrant.ErrBillingDisabled):
		status, code, message = http.StatusConflict, "billing_not_enabled",
			"Mosaic Billing is not enabled for this Project."
	case errors.Is(err, billinggrant.ErrUnavailable):
		status, code, message = http.StatusServiceUnavailable, "billing_storage_unavailable",
			"Grant versions could not be read."
	}
	response.Error(w, r, response.NewAPIError(status, code, message))
}
