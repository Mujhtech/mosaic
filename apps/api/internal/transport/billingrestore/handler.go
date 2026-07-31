// Package billingrestorehttp exposes Mosaic's restore and sync surface over
// HTTP.
//
// Handlers here are strictly thin: read the request, decode, validate transport
// shape, call the application service, write a standardized response. No handler
// queries the database, decides authorization, interprets a chain state, or
// calls render.JSON directly.
//
// # Authentication choice
//
// The restore record is served with response.Representation because its wire
// contract is the Authoritative Entitlement Contract, not the dashboard data
// envelope.
//
// Two surfaces are mounted, and the split follows the contract's own semantics
// rather than convenience:
//
//   - The SDK surface authenticates the public SDK key alone (Mosaic-SDK-Key),
//     not a Customer Access Token. A Customer Access Token is customer-bound,
//     and the contract makes `identity_unresolved` a first-class restore
//     outcome — a restore is precisely the flow in which the customer may not
//     be known yet, so requiring a customer-bound credential would make the
//     most important restore case unrepresentable. Safety comes from the same
//     place plan §5a requires: the request names no customer, a public key can
//     never select one, and identity is resolved server-side from validated
//     store lineage. The submitted references are not sent here at all — they
//     were already submitted to the observation endpoint under the same key,
//     and this request only names those submissions.
//   - The trusted surface authenticates the secret server key and may name a
//     Billing Customer, because an application backend has authenticated its
//     own user. This is the "restore/sync jobs" entry in plan §11's trusted
//     list.
package billingrestorehttp

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	validation "github.com/go-ozzo/ozzo-validation/v4"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingrestore"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
)

// contractContentType is the media type every Authoritative Entitlement record
// is served as. It is plain JSON: the contract is identified by the record
// envelope, not by a bespoke media type nobody's HTTP client understands.
const contractContentType = "application/json; charset=utf-8"

// maxBodyBytes bounds the request body. The largest legitimate body is a
// restore naming two hundred observation submissions.
const maxBodyBytes = 32 * 1024

// SDKKeyHeader carries the public SDK key on the untrusted surface. It decides
// which Environment is asking and nothing else.
const SDKKeyHeader = "Mosaic-SDK-Key"

type Handler struct {
	service *billingrestore.Service
}

// RegisterSDKRoutes mounts the untrusted SDK restore surface.
//
// It is rate limited: an SDK holds a retry schedule and polls a bounded number
// of times, so shedding load costs latency rather than correctness.
func RegisterSDKRoutes(router chi.Router, service *billingrestore.Service, limiters ...func(http.Handler) http.Handler) {
	h := &Handler{service: service}
	router.Group(func(sdk chi.Router) {
		for _, limiter := range limiters {
			if limiter != nil {
				sdk.Use(limiter)
			}
		}
		sdk.Post("/sdk/billing/restores", h.submitFromSDK)
		sdk.Get("/sdk/billing/restores/{restoreId}", h.restoreForSDK)
	})
}

// RegisterTrustedRoutes mounts the secret-server-authenticated APIs. They are
// authenticated by the API key itself rather than by the dashboard principal
// middleware, because the caller is an application backend rather than an
// operator in a browser session.
func RegisterTrustedRoutes(router chi.Router, service *billingrestore.Service, limiters ...func(http.Handler) http.Handler) {
	h := &Handler{service: service}
	router.Group(func(trusted chi.Router) {
		for _, limiter := range limiters {
			if limiter != nil {
				trusted.Use(limiter)
			}
		}
		// Registered as flat paths rather than through Route: the access
		// surface already mounts a subrouter at /billing/server, and a second
		// Mount inside that subtree is the kind of routing conflict that only
		// shows up when the server starts. Static paths under an existing mount
		// take precedence and are what the observation endpoint already does.
		trusted.Post("/billing/server/restores", h.submitFromServer)
		trusted.Get("/billing/server/restores/{restoreId}", h.restoreForServer)
	})
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

// restoreEnvelope is the Authoritative Entitlement Contract v1 restore request.
// It is decoded with DisallowUnknownFields because the contract declares
// additionalProperties:false at every level, so a member the contract does not
// define is a rejection rather than a silently ignored value.
type restoreEnvelope struct {
	AuthoritativeEntitlementContractVersion string         `json:"authoritativeEntitlementContractVersion"`
	RecordType                              string         `json:"recordType"`
	Payload                                 restorePayload `json:"payload"`
}

type restorePayload struct {
	StorePlatform string `json:"storePlatform"`
	// ProviderOutcome is what the native restore did. It is the caller's axis
	// and Mosaic records it verbatim; it never becomes Mosaic's own outcome.
	ProviderOutcome string `json:"providerOutcome"`
	// ObservationSubmissionIds names the observations already submitted for
	// this restore. No provider transaction reference travels on this surface.
	ObservationSubmissionIDs []string `json:"observationSubmissionIds,omitempty"`
	// BillingCustomerId is honoured only on the trusted surface. The SDK
	// surface drops it, because a client-asserted identifier must never select
	// a Billing Customer.
	BillingCustomerID string `json:"billingCustomerId,omitempty"`
	CorrelationID     string `json:"correlationId"`
}

func (p restorePayload) Validate() error {
	return validation.ValidateStruct(&p,
		validation.Field(&p.StorePlatform, validation.Required,
			validation.In(billingrestore.StoreApple, billingrestore.StoreGoogle)),
		validation.Field(&p.ProviderOutcome, validation.Required,
			validation.In(
				billingrestore.ProviderOutcomeCompleted,
				billingrestore.ProviderOutcomeNoPurchasesFound,
				billingrestore.ProviderOutcomeCancelled,
				billingrestore.ProviderOutcomeFailed,
				billingrestore.ProviderOutcomeUnsupported,
				billingrestore.ProviderOutcomeNotAttempted)),
		validation.Field(&p.ObservationSubmissionIDs,
			validation.Length(0, billingrestore.MaxSubmittedObservations),
			validation.Each(validation.Required, validation.Length(1, 128))),
		validation.Field(&p.BillingCustomerID, validation.Length(0, 128)),
		validation.Field(&p.CorrelationID, validation.Required, validation.Length(1, 128)),
	)
}

func (h *Handler) submitFromSDK(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeRestore(w, r)
	if !ok {
		return
	}
	record, err := h.service.SubmitFromSDK(r.Context(),
		strings.TrimSpace(r.Header.Get(SDKKeyHeader)), submitRequest(payload))
	if err != nil {
		writeError(w, r, err)
		return
	}
	// 202: the restore is recorded and the chain is running. The body already
	// carries the honest current answer, which is what a caller polls against.
	response.Representation(w, http.StatusAccepted, contractContentType, record)
}

func (h *Handler) submitFromServer(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeRestore(w, r)
	if !ok {
		return
	}
	record, err := h.service.SubmitFromServer(r.Context(), bearer(r), submitRequest(payload))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.Representation(w, http.StatusAccepted, contractContentType, record)
}

func submitRequest(payload restorePayload) billingrestore.SubmitRequest {
	return billingrestore.SubmitRequest{
		StorePlatform:            payload.StorePlatform,
		ProviderOutcome:          payload.ProviderOutcome,
		ObservationSubmissionIDs: payload.ObservationSubmissionIDs,
		CustomerID:               payload.BillingCustomerID,
		CorrelationID:            payload.CorrelationID,
	}
}

func decodeRestore(w http.ResponseWriter, r *http.Request) (restorePayload, bool) {
	var envelope restoreEnvelope
	if !decode(w, r, &envelope) {
		return restorePayload{}, false
	}
	if envelope.AuthoritativeEntitlementContractVersion != billingrestore.ContractVersion ||
		envelope.RecordType != "restoreRequest" {
		writeValidation(w, r, map[string][]string{
			"recordType": {"The record is not an Authoritative Entitlement Contract v1 restore request."}})
		return restorePayload{}, false
	}
	if err := envelope.Payload.Validate(); err != nil {
		writeValidation(w, r, validationFields(err))
		return restorePayload{}, false
	}
	if strings.TrimSpace(envelope.Payload.CorrelationID) == "" {
		envelope.Payload.CorrelationID = correlationID(r)
	}
	return envelope.Payload, true
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

func (h *Handler) restoreForSDK(w http.ResponseWriter, r *http.Request) {
	record, err := h.service.RestoreForSDK(r.Context(),
		strings.TrimSpace(r.Header.Get(SDKKeyHeader)), chi.URLParam(r, "restoreId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	// A restore result is per-request state, never cacheable by an
	// intermediary: the whole point of polling it is that the answer changes.
	w.Header().Set("Cache-Control", "private, no-store")
	response.Representation(w, http.StatusOK, contractContentType, record)
}

func (h *Handler) restoreForServer(w http.ResponseWriter, r *http.Request) {
	record, err := h.service.RestoreForServer(r.Context(), bearer(r), chi.URLParam(r, "restoreId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	response.Representation(w, http.StatusOK, contractContentType, record)
}

// ---------------------------------------------------------------------------
// Transport helpers
// ---------------------------------------------------------------------------

func decode(w http.ResponseWriter, r *http.Request, target any) bool {
	if encoding := r.Header.Get("Content-Encoding"); encoding != "" && encoding != "identity" {
		writeValidation(w, r, map[string][]string{"body": {"The request encoding is not supported."}})
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	decoder := json.NewDecoder(r.Body)
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

func correlationID(r *http.Request) string {
	if id := chimiddleware.GetReqID(r.Context()); id != "" {
		return id
	}
	return "mosaic"
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

// writeError maps restore-domain errors onto HTTP in one place.
//
// The Cause is never populated: response.Error logs the cause behind every 5xx,
// and on this surface a cause can quote an API key. ErrUnprovenRestore and
// ErrInvalidOutcome are programming errors, not caller errors, so they fall
// through to the generic 500 rather than telling a caller anything about the
// invariant that stopped them.
func writeError(w http.ResponseWriter, r *http.Request, err error) {
	status, code, message := http.StatusInternalServerError, "internal_error", "An unexpected error occurred."
	switch {
	case errors.Is(err, billingrestore.ErrUnauthenticated):
		status, code, message = http.StatusUnauthorized, "unauthenticated", "Authentication is required."
	case errors.Is(err, billingrestore.ErrNotFound):
		status, code, message = http.StatusNotFound, "not_found", "The requested resource was not found."
	case errors.Is(err, billingrestore.ErrInvalid):
		status, code, message = http.StatusUnprocessableEntity, "validation_failed", "The request contains invalid fields."
	case errors.Is(err, billingrestore.ErrBillingDisabled):
		// Mosaic Billing being off is a service state, never a statement about
		// the customer. 409 rather than 404 so a caller can tell "not enabled"
		// from "no such restore".
		status, code, message = http.StatusConflict, "billing_not_enabled",
			"Mosaic Billing is not enabled for this Project."
	case errors.Is(err, billingrestore.ErrUnavailable):
		status, code, message = http.StatusServiceUnavailable, "billing_storage_unavailable",
			"Restore state could not be read."
	}
	response.Error(w, r, response.NewAPIError(status, code, message))
}
