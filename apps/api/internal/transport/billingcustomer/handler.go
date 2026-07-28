// Package billingcustomerhttp exposes Mosaic's billing-identity APIs over HTTP:
// the trusted create-or-get of a Billing Customer, alias attach/revoke/list,
// identity-conflict inspection, and manual projection requests (plan §11).
//
// Everything here is authenticated by a secret server API key presented in
// `Authorization: Bearer`. There is deliberately no public-SDK-key path and no
// route that accepts an installation identifier: the application-user alias is
// assertable only by the customer's own backend, and a client-generated
// installation id must never be able to create or select a customer (plan §5a,
// OD-4(a)). Those two properties are enforced by the absence of a surface, not
// by a check a future edit could remove.
//
// Handlers are strictly thin: decode, validate transport shape, call the
// application service, map the result. No handler decides authorization,
// touches the database, or calls render.JSON.
//
// No response in this package carries an alias value or an alias digest. An
// alias digest is still a stable per-person identifier, and nothing on a server
// or operator surface needs one.
package billingcustomerhttp

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	validation "github.com/go-ozzo/ozzo-validation/v4"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingcustomer"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
)

// maxBodyBytes bounds every request body here. The largest legitimate body is
// an identify request carrying one application user id.
const maxBodyBytes = 8 * 1024

type Handler struct {
	service *billingcustomer.Service
}

// RegisterTrustedRoutes mounts the secret-server-authenticated identity APIs.
//
// They live under /billing/identity rather than under the /billing/server
// subtree the access APIs mount, so the two modules own disjoint route trees
// and neither can shadow the other.
func RegisterTrustedRoutes(router chi.Router, service *billingcustomer.Service, limiters ...func(http.Handler) http.Handler) {
	h := &Handler{service: service}
	router.Group(func(trusted chi.Router) {
		for _, limiter := range limiters {
			if limiter != nil {
				trusted.Use(limiter)
			}
		}
		trusted.Route("/billing/identity", func(identity chi.Router) {
			identity.Post("/customers", h.identifyCustomer)
			identity.Get("/customers/{customerId}/aliases", h.listAliases)
			identity.Post("/customers/{customerId}/aliases", h.attachAlias)
			identity.Post("/customers/{customerId}/sync-requests", h.requestSync)

			identity.Post("/aliases/{aliasId}/revoke", h.revokeAlias)

			identity.Get("/conflicts", h.listConflicts)
			identity.Get("/conflicts/{conflictId}", h.conflict)
		})
	})
}

// ---------------------------------------------------------------------------
// Customers and aliases
// ---------------------------------------------------------------------------

// identifyRequest is the only body that can bring a Billing Customer into
// existence over HTTP. It accepts exactly one field, so a caller cannot smuggle
// an installation identifier, a Project, or an Environment into the creation
// path: the tenant comes from the authenticated key.
type identifyRequest struct {
	ApplicationUserID string `json:"applicationUserId"`
}

func (q identifyRequest) Validate() error {
	return validation.ValidateStruct(&q,
		validation.Field(&q.ApplicationUserID, validation.Required, validation.Length(1, 512)),
	)
}

func (h *Handler) identifyCustomer(w http.ResponseWriter, r *http.Request) {
	var request identifyRequest
	if !decode(w, r, &request) {
		return
	}
	if err := request.Validate(); err != nil {
		writeValidation(w, r, validationFields(err))
		return
	}
	customer, created, err := h.service.IdentifyCustomer(r.Context(), bearer(r), request.ApplicationUserID)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if created {
		response.Created(w, r, customerResponse(customer))
		return
	}
	response.OK(w, r, customerResponse(customer))
}

type attachAliasRequest struct {
	ApplicationUserID string `json:"applicationUserId"`
}

func (q attachAliasRequest) Validate() error {
	return validation.ValidateStruct(&q,
		validation.Field(&q.ApplicationUserID, validation.Required, validation.Length(1, 512)),
	)
}

func (h *Handler) attachAlias(w http.ResponseWriter, r *http.Request) {
	var request attachAliasRequest
	if !decode(w, r, &request) {
		return
	}
	if err := request.Validate(); err != nil {
		writeValidation(w, r, validationFields(err))
		return
	}
	alias, err := h.service.AttachAliasForServer(r.Context(), bearer(r),
		strings.TrimSpace(chi.URLParam(r, "customerId")), request.ApplicationUserID)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.Created(w, r, aliasResponse(alias))
}

func (h *Handler) revokeAlias(w http.ResponseWriter, r *http.Request) {
	if err := h.service.RevokeAliasForServer(r.Context(), bearer(r),
		strings.TrimSpace(chi.URLParam(r, "aliasId"))); err != nil {
		writeError(w, r, err)
		return
	}
	response.NoContent(w, r)
}

func (h *Handler) listAliases(w http.ResponseWriter, r *http.Request) {
	aliases, err := h.service.ListAliasesForServer(r.Context(), bearer(r),
		strings.TrimSpace(chi.URLParam(r, "customerId")))
	if err != nil {
		writeError(w, r, err)
		return
	}
	items := make([]map[string]any, 0, len(aliases))
	for _, alias := range aliases {
		items = append(items, aliasResponse(alias))
	}
	response.OK(w, r, map[string]any{"items": items})
}

// customerResponse is the API shape of a Billing Customer. It carries no alias
// values, because Mosaic stores none.
func customerResponse(customer billingcustomer.Customer) map[string]any {
	payload := map[string]any{
		"billingCustomerId":        customer.ID,
		"projectId":                customer.ProjectID,
		"status":                   customer.Status,
		"diagnosticsStatus":        customer.DiagnosticsStatus,
		"currentProjectionVersion": customer.CurrentProjectionVersion,
		"createdAt":                customer.CreatedAt.UTC().Format(timestampLayout),
		"updatedAt":                customer.UpdatedAt.UTC().Format(timestampLayout),
	}
	if customer.LastProjectedAt != nil {
		payload["lastProjectedAt"] = customer.LastProjectedAt.UTC().Format(timestampLayout)
	}
	return payload
}

// aliasResponse renders one alias. The digest is unreachable from here by
// construction: billingcustomer.Alias keeps it in an unexported field and this
// function never calls the accessor.
func aliasResponse(alias billingcustomer.Alias) map[string]any {
	payload := map[string]any{
		"aliasId":            alias.ID,
		"billingCustomerId":  alias.BillingCustomerID,
		"aliasType":          alias.AliasType,
		"sourceAuthority":    alias.SourceAuthority,
		"verificationStatus": alias.VerificationStatus,
		"effectiveStart":     alias.EffectiveStart.UTC().Format(timestampLayout),
		"createdAt":          alias.CreatedAt.UTC().Format(timestampLayout),
	}
	if alias.EffectiveEnd != nil {
		payload["effectiveEnd"] = alias.EffectiveEnd.UTC().Format(timestampLayout)
	}
	return payload
}

// ---------------------------------------------------------------------------
// Identity conflicts
// ---------------------------------------------------------------------------

func (h *Handler) listConflicts(w http.ResponseWriter, r *http.Request) {
	conflicts, err := h.service.ListConflictsForServer(r.Context(), bearer(r),
		strings.TrimSpace(r.URL.Query().Get("status")))
	if err != nil {
		writeError(w, r, err)
		return
	}
	items := make([]map[string]any, 0, len(conflicts))
	for _, conflict := range conflicts {
		items = append(items, conflictResponse(conflict))
	}
	response.OK(w, r, map[string]any{"items": items})
}

func (h *Handler) conflict(w http.ResponseWriter, r *http.Request) {
	detail, err := h.service.ConflictDetailForServer(r.Context(), bearer(r),
		strings.TrimSpace(chi.URLParam(r, "conflictId")))
	if err != nil {
		writeError(w, r, err)
		return
	}
	payload := map[string]any{"conflict": conflictResponse(detail.Conflict)}
	if detail.Lineage != nil {
		payload["lineage"] = map[string]any{
			"purchaseLineageId": detail.Lineage.ID,
			"environmentId":     detail.Lineage.EnvironmentID,
			"provider":          detail.Lineage.Provider,
			"storeEnvironment":  detail.Lineage.StoreEnvironment,
			"lineageType":       detail.Lineage.LineageType,
			"projectionFrozen":  detail.Lineage.ProjectionFrozen,
			"diagnosticStatus":  detail.Lineage.DiagnosticStatus,
		}
	}
	response.OK(w, r, payload)
}

// conflictResponse renders one conflict. The disputed alias *type* is useful to
// an operator; the disputed alias digest is not rendered under any scope.
func conflictResponse(conflict billingcustomer.Conflict) map[string]any {
	payload := map[string]any{
		"conflictId":       conflict.ID,
		"projectId":        conflict.ProjectID,
		"scope":            conflict.Scope,
		"status":           conflict.Status,
		"firstCustomerId":  conflict.FirstCustomerID,
		"secondCustomerId": conflict.SecondCustomerID,
		"openedAt":         conflict.OpenedAt.UTC().Format(timestampLayout),
	}
	if conflict.PurchaseLineageID != "" {
		payload["purchaseLineageId"] = conflict.PurchaseLineageID
	}
	if conflict.AliasType != "" {
		payload["aliasType"] = conflict.AliasType
	}
	if conflict.DiagnosticCode != "" {
		payload["diagnosticCode"] = conflict.DiagnosticCode
	}
	if conflict.ResolvedAt != nil {
		payload["resolvedAt"] = conflict.ResolvedAt.UTC().Format(timestampLayout)
		payload["resolutionAction"] = conflict.ResolutionAction
	}
	return payload
}

// ---------------------------------------------------------------------------
// Manual sync
// ---------------------------------------------------------------------------

// requestSync schedules a projection and answers 202 with the handle. It is
// deliberately not a read: the answer is "this has been queued", and a caller
// that needs the result reads the entitlement surfaces once the projection
// version moves.
func (h *Handler) requestSync(w http.ResponseWriter, r *http.Request) {
	request, err := h.service.RequestSync(r.Context(), bearer(r),
		strings.TrimSpace(chi.URLParam(r, "customerId")))
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
		"requestedAt":        request.RequestedAt.UTC().Format(timestampLayout),
		"status":             "queued",
	})
}

// ---------------------------------------------------------------------------
// Transport helpers
// ---------------------------------------------------------------------------

const timestampLayout = "2006-01-02T15:04:05.000Z"

func decode(w http.ResponseWriter, r *http.Request, target any) bool {
	if encoding := r.Header.Get("Content-Encoding"); encoding != "" && encoding != "identity" {
		writeValidation(w, r, map[string][]string{"body": {"The request encoding is not supported."}})
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	decoder := json.NewDecoder(r.Body)
	// An unknown member is rejected rather than dropped. On this surface a
	// silently ignored field would let a caller believe it had supplied an
	// identifier that Mosaic never read.
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeValidation(w, r, map[string][]string{"body": {"The request body could not be read."}})
		return false
	}
	return true
}

func bearer(r *http.Request) string {
	value := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(value) > 7 && strings.EqualFold(value[:7], "Bearer ") {
		return strings.TrimSpace(value[7:])
	}
	return ""
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

// writeError maps identity-domain errors onto HTTP in one place. The Cause is
// never populated: response.Error logs the cause behind every 5xx, and on this
// surface a cause can quote an Authorization header.
func writeError(w http.ResponseWriter, r *http.Request, err error) {
	status, code, message := http.StatusInternalServerError, "internal_error", "An unexpected error occurred."
	switch {
	case errors.Is(err, billingcustomer.ErrUnauthenticated):
		status, code, message = http.StatusUnauthorized, "unauthenticated", "Authentication is required."
	case errors.Is(err, billingcustomer.ErrForbidden):
		status, code, message = http.StatusForbidden, "forbidden", "The credential does not cover this resource."
	case errors.Is(err, billingcustomer.ErrNotFound):
		status, code, message = http.StatusNotFound, "not_found", "The requested resource was not found."
	case errors.Is(err, billingcustomer.ErrInvalidAlias):
		status, code, message = http.StatusUnprocessableEntity, "validation_failed",
			"The request contains invalid fields."
	case errors.Is(err, billingcustomer.ErrIdentityConflict):
		// The distinct code matters. `conflict` invites a retry; this one tells
		// the caller an identity conflict was opened, nothing was reassigned,
		// and an operator now owns the repair (OD-10).
		status, code, message = http.StatusConflict, "identity_conflict",
			"The identity is claimed by another Billing Customer and is held for operator resolution."
	case errors.Is(err, billingcustomer.ErrFrozen):
		status, code, message = http.StatusConflict, "identity_frozen",
			"The Billing Customer's identity is frozen by an open conflict."
	case errors.Is(err, billingcustomer.ErrConflict):
		status, code, message = http.StatusConflict, "conflict", "The resource is in a conflicting state."
	case errors.Is(err, billingcustomer.ErrBillingDisabled):
		status, code, message = http.StatusConflict, "billing_not_enabled",
			"Mosaic Billing is not enabled for this Project."
	case errors.Is(err, billingcustomer.ErrUnavailable):
		status, code, message = http.StatusServiceUnavailable, "billing_storage_unavailable",
			"Billing identity could not be read."
	}
	response.Error(w, r, response.NewAPIError(status, code, message))
}
