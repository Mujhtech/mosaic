// Package billingaccesshttp exposes Mosaic's authoritative access surfaces over
// HTTP: Customer Access Token issuance and revocation, the SDK entitlement sync
// endpoint, and the trusted-server entitlement reads.
//
// Handlers here are strictly thin: read the request, decode, validate transport
// shape, call the application service, write a standardized response. No handler
// queries the database, decides authorization, interprets a projection, or calls
// render.JSON directly.
//
// Two response shapes coexist deliberately. Contract records — snapshots, check
// results, subscription snapshots — are written with response.Representation
// because their wire contract is the Authoritative Entitlement Contract, not the
// dashboard data envelope; every other response uses the envelope.
package billingaccesshttp

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	validation "github.com/go-ozzo/ozzo-validation/v4"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingaccess"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
)

// contractContentType is the media type every Authoritative Entitlement record
// is served as. It is plain JSON: the contract is identified by the record
// envelope, not by a bespoke media type nobody's HTTP client understands.
const contractContentType = "application/json; charset=utf-8"

// maxBodyBytes bounds every request body on these surfaces. The largest
// legitimate body is a sync request with sixty-four entitlement keys.
const maxBodyBytes = 16 * 1024

type Handler struct {
	service *billingaccess.Service
}

// RegisterSDKRoutes mounts the untrusted SDK read surface.
//
// The route sits under /v1/sdk to match the existing SDK surfaces, and it is
// rate limited: an SDK holds a cache and a retry schedule, so shedding load
// costs latency rather than correctness. This is expected to be the
// highest-QPS authenticated surface Mosaic has, and the in-process limiter
// buckets per instance — a limitation documented rather than hidden.
func RegisterSDKRoutes(router chi.Router, service *billingaccess.Service, limiters ...func(http.Handler) http.Handler) {
	h := &Handler{service: service}
	router.Group(func(sdk chi.Router) {
		for _, limiter := range limiters {
			if limiter != nil {
				sdk.Use(limiter)
			}
		}
		sdk.Get("/sdk/billing/entitlements", h.syncEntitlements)
		sdk.Post("/sdk/billing/entitlements", h.syncEntitlements)
	})
}

// RegisterTrustedRoutes mounts the secret-server-authenticated APIs. They are
// authenticated by the API key itself rather than by the dashboard principal
// middleware, because the caller is an application backend, not an operator in
// a browser session.
func RegisterTrustedRoutes(router chi.Router, service *billingaccess.Service, limiters ...func(http.Handler) http.Handler) {
	h := &Handler{service: service}
	router.Group(func(trusted chi.Router) {
		for _, limiter := range limiters {
			if limiter != nil {
				trusted.Use(limiter)
			}
		}
		trusted.Route("/billing/server", func(server chi.Router) {
			server.Post("/customer-tokens", h.issueToken)
			server.Get("/customer-tokens", h.listTokens)
			server.Post("/customer-tokens/{tokenId}/revoke", h.revokeToken)

			server.Get("/customers/{customerId}", h.customer)
			server.Get("/customers/{customerId}/entitlements", h.snapshot)
			server.Post("/customers/{customerId}/entitlement-checks", h.check)
			server.Get("/customers/{customerId}/subscriptions", h.subscriptions)

			server.Get("/subscriptions/{instanceId}", h.subscription)
			server.Get("/subscriptions/{instanceId}/timeline", h.timeline)
		})
	})
}

// ---------------------------------------------------------------------------
// Customer Access Tokens
// ---------------------------------------------------------------------------

// tokenIssuanceEnvelope is the Customer Access Token Contract v1 issuance
// record. It is decoded with DisallowUnknownFields because the contract
// declares additionalProperties:false at every level, so a member the contract
// does not define is a rejection rather than a silently ignored value.
type tokenIssuanceEnvelope struct {
	CustomerAccessTokenContractVersion string               `json:"customerAccessTokenContractVersion"`
	RecordType                         string               `json:"recordType"`
	Payload                            tokenIssuancePayload `json:"payload"`
}

type tokenIssuancePayload struct {
	BillingCustomerID   string   `json:"billingCustomerId"`
	Audience            string   `json:"audience"`
	Scopes              []string `json:"scopes"`
	RequestedTTLSeconds int      `json:"requestedTtlSeconds,omitempty"`
	CorrelationID       string   `json:"correlationId"`
}

func (p tokenIssuancePayload) Validate() error {
	return validation.ValidateStruct(&p,
		validation.Field(&p.BillingCustomerID, validation.Required, validation.Length(1, 128)),
		validation.Field(&p.Audience, validation.Required,
			validation.In(billingaccess.AudienceSDKSync, billingaccess.AudienceServerCheck)),
		validation.Field(&p.Scopes, validation.Required, validation.Length(1, 3)),
		validation.Field(&p.RequestedTTLSeconds, validation.Min(60), validation.Max(86400)),
		validation.Field(&p.CorrelationID, validation.Required, validation.Length(1, 128)),
	)
}

func (h *Handler) issueToken(w http.ResponseWriter, r *http.Request) {
	var envelope tokenIssuanceEnvelope
	if !decode(w, r, &envelope) {
		return
	}
	if envelope.CustomerAccessTokenContractVersion != billingaccess.TokenContractVersion ||
		envelope.RecordType != "customerAccessTokenIssuanceRequest" {
		writeValidation(w, r, map[string][]string{
			"recordType": {"The record is not a Customer Access Token Contract v1 issuance request."}})
		return
	}
	if err := envelope.Payload.Validate(); err != nil {
		writeValidation(w, r, validationFields(err))
		return
	}

	issued, err := h.service.IssueToken(r.Context(), bearer(r), billingaccess.IssuanceRequest{
		CustomerID:         envelope.Payload.BillingCustomerID,
		Audience:           envelope.Payload.Audience,
		Scopes:             envelope.Payload.Scopes,
		RequestedTTLSecond: envelope.Payload.RequestedTTLSeconds,
		CorrelationID:      envelope.Payload.CorrelationID,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}

	// This is the one response in Mosaic that carries a bearer credential. It
	// is written directly to the caller over its authenticated server-to-server
	// channel and never reaches a log, a metric attribute, or a span.
	response.Created(w, r, map[string]any{
		"customerAccessTokenContractVersion": billingaccess.TokenContractVersion,
		"recordType":                         "customerAccessTokenIssuanceResult",
		"payload": map[string]any{
			"token":         issued.Value,
			"metadata":      tokenMetadata(issued.Metadata, time.Now().UTC()),
			"correlationId": envelope.Payload.CorrelationID,
		},
	})
}

type tokenRevocationRequest struct {
	RevocationReason string `json:"revocationReason"`
}

func (h *Handler) revokeToken(w http.ResponseWriter, r *http.Request) {
	var request tokenRevocationRequest
	if !decode(w, r, &request) {
		return
	}
	token, err := h.service.RevokeToken(r.Context(), bearer(r),
		strings.TrimSpace(chi.URLParam(r, "tokenId")), request.RevocationReason)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, tokenMetadata(token, time.Now().UTC()))
}

func (h *Handler) listTokens(w http.ResponseWriter, r *http.Request) {
	customerID := strings.TrimSpace(r.URL.Query().Get("billingCustomerId"))
	if customerID == "" {
		writeValidation(w, r, map[string][]string{
			"billingCustomerId": {"A Billing Customer identifier is required."}})
		return
	}
	tokens, err := h.service.ListTokens(r.Context(), bearer(r), customerID, intQuery(r, "limit"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	now := time.Now().UTC()
	items := make([]map[string]any, 0, len(tokens))
	for _, token := range tokens {
		items = append(items, tokenMetadata(token, now))
	}
	response.OK(w, r, map[string]any{"items": items})
}

// tokenMetadata renders the contract's customerAccessTokenMetadata. Everything
// here is metadata *about* a token; the token itself has no parseable structure
// and carries none of it.
func tokenMetadata(token billingaccess.Token, now time.Time) map[string]any {
	metadata := map[string]any{
		"tokenId":           token.ID,
		"projectId":         token.ProjectID,
		"environmentId":     token.EnvironmentID,
		"billingCustomerId": token.CustomerID,
		"audience":          token.Audience,
		"scopes":            token.Scopes,
		"issuer":            "mosaic",
		"issuedAt":          billingaccess.ContractTimestamp(token.IssuedAt),
		"expiresAt":         billingaccess.ContractTimestamp(token.ExpiresAt),
		"status":            token.Status(now),
		"tokenPrefix":       billingaccess.TokenPrefix,
		"digestAlgorithm":   "sha256",
	}
	if token.RevokedAt != nil {
		metadata["revokedAt"] = billingaccess.ContractTimestamp(*token.RevokedAt)
		metadata["revocationReason"] = token.RevocationReason
	}
	if token.LastUsedAt != nil {
		metadata["lastUsedAt"] = billingaccess.ContractTimestamp(*token.LastUsedAt)
	}
	return metadata
}

// ---------------------------------------------------------------------------
// SDK entitlement sync
// ---------------------------------------------------------------------------

// SDKKeyHeader carries the public SDK key alongside the customer token. The
// token travels in Authorization: Bearer and decides *which* customer is read;
// the SDK key decides which Environment is asking. Both are required, and a
// public key alone can never select a customer.
const SDKKeyHeader = "Mosaic-SDK-Key"

type syncEnvelope struct {
	AuthoritativeEntitlementContractVersion string      `json:"authoritativeEntitlementContractVersion"`
	RecordType                              string      `json:"recordType"`
	Payload                                 syncPayload `json:"payload"`
}

type syncPayload struct {
	BillingCustomerID                          string   `json:"billingCustomerId,omitempty"`
	KnownSnapshotVersion                       int64    `json:"knownSnapshotVersion,omitempty"`
	EntityTag                                  string   `json:"entityTag,omitempty"`
	SupportedAuthoritativeEntitlementContracts []string `json:"supportedAuthoritativeEntitlementContracts"`
	RequestedEntitlementKeys                   []string `json:"requestedEntitlementKeys,omitempty"`
	CorrelationID                              string   `json:"correlationId"`
}

func (h *Handler) syncEntitlements(w http.ResponseWriter, r *http.Request) {
	authenticated, err := h.service.AuthenticateCustomerToken(r.Context(), bearer(r),
		strings.TrimSpace(r.Header.Get(SDKKeyHeader)))
	if err != nil {
		writeError(w, r, err)
		return
	}

	request := billingaccess.SyncRequest{CorrelationID: correlationID(r)}
	if r.Method == http.MethodPost {
		var envelope syncEnvelope
		if !decode(w, r, &envelope) {
			return
		}
		if envelope.AuthoritativeEntitlementContractVersion != billingaccess.ContractVersion ||
			envelope.RecordType != "entitlementSyncRequest" {
			writeValidation(w, r, map[string][]string{
				"recordType": {"The record is not an Authoritative Entitlement Contract v1 sync request."}})
			return
		}
		if !supportsContract(envelope.Payload.SupportedAuthoritativeEntitlementContracts) {
			// The caller cannot read anything Mosaic can produce. This is a
			// negotiation failure, not an authentication or state problem.
			response.Error(w, r, response.NewAPIError(http.StatusNotAcceptable,
				"contract_version_unsupported",
				"No supported Authoritative Entitlement Contract version was offered."))
			return
		}
		request.CustomerIDHint = envelope.Payload.BillingCustomerID
		request.KnownSnapshotVersion = envelope.Payload.KnownSnapshotVersion
		request.EntityTag = envelope.Payload.EntityTag
		request.RequestedKeys = envelope.Payload.RequestedEntitlementKeys
		if envelope.Payload.CorrelationID != "" {
			request.CorrelationID = envelope.Payload.CorrelationID
		}
	}

	// If-None-Match is honoured on both verbs. The header and the body member
	// mean the same thing; the header wins when both are present because it is
	// the one HTTP intermediaries can also act on.
	// A conditional request that states no version is still forwarded with its
	// tag, and is still answered with a full snapshot: the service treats
	// version equality as a precondition of `unchanged`, because a matching tag
	// alone would confirm a cache without proving monotonicity. That check
	// lives in the service rather than here, so both verbs get it.
	if tag := strings.TrimSpace(r.Header.Get("If-None-Match")); tag != "" {
		request.EntityTag = strings.Trim(tag, `"`)
	}

	result, err := h.service.Sync(r.Context(), authenticated, request)
	if err != nil {
		writeError(w, r, err)
		return
	}

	w.Header().Set("ETag", `"`+result.EntityTag+`"`)
	w.Header().Set("Cache-Control", "private, no-cache")
	// The freshness window travels as headers as well as inside the record, so
	// a 304 — which carries no body — still slides the caller's window. Without
	// that, a device that keeps confirming the same version would expire while
	// demonstrably in contact with the server.
	w.Header().Set("Mosaic-Refresh-After", billingaccess.ContractTimestamp(result.RefreshAfter))
	w.Header().Set("Mosaic-Valid-Until", billingaccess.ContractTimestamp(result.ValidUntil))
	w.Header().Set("Mosaic-Stale-Grace-Seconds", strconv.Itoa(int(result.StaleGrace/time.Second)))

	// 304 belongs to the conditional GET and to nothing else.
	//
	// POST is the ratified cross-SDK flow, and it always answers 200 with the
	// canonical `snapshotUnchanged` record — even when If-None-Match is
	// present. The record carries refreshAfter, validUntil, and
	// staleGraceSeconds inside a frozen schema every SDK already validates,
	// whereas a bare 304 carries no body and would force all three platforms to
	// read freshness out of `Mosaic-…` header names that no schema defines.
	// Freshness that only exists in undocumented headers is freshness the
	// contract cannot guarantee, so the negotiated form never relies on it.
	//
	// The conditional GET keeps 304 because that is HTTP's own form, where an
	// empty body is the point and the headers are the only channel available.
	if result.Unchanged && r.Method == http.MethodGet &&
		strings.TrimSpace(r.Header.Get("If-None-Match")) != "" {
		response.Representation(w, http.StatusNotModified, contractContentType, nil)
		return
	}
	response.Representation(w, http.StatusOK, contractContentType, result.Payload)
}

func supportsContract(offered []string) bool {
	if len(offered) == 0 {
		return false
	}
	for _, version := range offered {
		if version == billingaccess.ContractVersion {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Trusted-server reads
// ---------------------------------------------------------------------------

func (h *Handler) customer(w http.ResponseWriter, r *http.Request) {
	view, err := h.service.Customer(r.Context(), bearer(r), chi.URLParam(r, "customerId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, customerResponse(view))
}

// customerResponse is the API shape of a Billing Customer. It deliberately
// carries no alias values: aliases are stored as digests and the digest is
// never a read-side field.
func customerResponse(view billingaccess.CustomerView) map[string]any {
	payload := map[string]any{
		"billingCustomerId":        view.ID,
		"projectId":                view.ProjectID,
		"status":                   view.Status,
		"diagnosticsStatus":        view.DiagnosticsStatus,
		"currentProjectionVersion": view.CurrentProjectionVersion,
		// The distinction the dashboard and every operator needs first: a
		// customer anchored to a purchase but never identified is not the same
		// as one a backend has named.
		"identified": view.Identified,
		"createdAt":  billingaccess.ContractTimestamp(view.CreatedAt),
		"updatedAt":  billingaccess.ContractTimestamp(view.UpdatedAt),
	}
	if view.LastProjectedAt != nil {
		payload["lastProjectedAt"] = billingaccess.ContractTimestamp(*view.LastProjectedAt)
	}
	return payload
}

func (h *Handler) snapshot(w http.ResponseWriter, r *http.Request) {
	payload, err := h.service.Snapshot(r.Context(), bearer(r),
		strings.TrimSpace(r.URL.Query().Get("environmentId")),
		chi.URLParam(r, "customerId"), correlationID(r))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.Representation(w, http.StatusOK, contractContentType, payload)
}

type checkEnvelope struct {
	AuthoritativeEntitlementContractVersion string       `json:"authoritativeEntitlementContractVersion"`
	RecordType                              string       `json:"recordType"`
	Payload                                 checkPayload `json:"payload"`
}

type checkPayload struct {
	BillingCustomerID                          string   `json:"billingCustomerId"`
	EntitlementKeys                            []string `json:"entitlementKeys"`
	ExpectedSnapshotVersion                    int64    `json:"expectedSnapshotVersion,omitempty"`
	SupportedAuthoritativeEntitlementContracts []string `json:"supportedAuthoritativeEntitlementContracts"`
	CorrelationID                              string   `json:"correlationId"`
}

func (p checkPayload) Validate() error {
	return validation.ValidateStruct(&p,
		validation.Field(&p.BillingCustomerID, validation.Required, validation.Length(1, 128)),
		validation.Field(&p.EntitlementKeys, validation.Required, validation.Length(1, 64)),
		validation.Field(&p.CorrelationID, validation.Required, validation.Length(1, 128)),
	)
}

func (h *Handler) check(w http.ResponseWriter, r *http.Request) {
	var envelope checkEnvelope
	if !decode(w, r, &envelope) {
		return
	}
	if envelope.AuthoritativeEntitlementContractVersion != billingaccess.ContractVersion ||
		envelope.RecordType != "entitlementCheckRequest" {
		writeValidation(w, r, map[string][]string{
			"recordType": {"The record is not an Authoritative Entitlement Contract v1 check request."}})
		return
	}
	if err := envelope.Payload.Validate(); err != nil {
		writeValidation(w, r, validationFields(err))
		return
	}
	if !supportsContract(envelope.Payload.SupportedAuthoritativeEntitlementContracts) {
		response.Error(w, r, response.NewAPIError(http.StatusNotAcceptable,
			"contract_version_unsupported",
			"No supported Authoritative Entitlement Contract version was offered."))
		return
	}
	if pathCustomer := chi.URLParam(r, "customerId"); pathCustomer != "" &&
		pathCustomer != envelope.Payload.BillingCustomerID {
		writeValidation(w, r, map[string][]string{
			"billingCustomerId": {"The body names a different Billing Customer than the path."}})
		return
	}

	payload, err := h.service.Check(r.Context(), bearer(r),
		strings.TrimSpace(r.URL.Query().Get("environmentId")), billingaccess.CheckRequest{
			CustomerID:              envelope.Payload.BillingCustomerID,
			EntitlementKeys:         envelope.Payload.EntitlementKeys,
			ExpectedSnapshotVersion: envelope.Payload.ExpectedSnapshotVersion,
			CorrelationID:           envelope.Payload.CorrelationID,
		})
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.Representation(w, http.StatusOK, contractContentType, payload)
}

func (h *Handler) subscriptions(w http.ResponseWriter, r *http.Request) {
	views, next, err := h.service.Subscriptions(r.Context(), bearer(r),
		strings.TrimSpace(r.URL.Query().Get("environmentId")), chi.URLParam(r, "customerId"),
		intQuery(r, "limit"), strings.TrimSpace(r.URL.Query().Get("cursor")))
	if err != nil {
		writeError(w, r, err)
		return
	}
	items := make([]map[string]any, 0, len(views))
	for _, view := range views {
		items = append(items, map[string]any{
			"subscriptionInstanceId": view.SubscriptionInstanceID,
			"subscriptionSnapshotId": view.SnapshotID,
			"projectionVersion":      view.ProjectionVersion,
			"accessState":            view.AccessState,
			"lifecycleState":         view.LifecycleState,
			"renewalIntent":          view.RenewalIntent,
			"billingState":           view.BillingState,
			"isTestSource":           view.IsTestSource,
			"asOf":                   billingaccess.ContractTimestamp(view.AsOf),
		})
	}
	payload := map[string]any{"items": items}
	if next != "" {
		payload["nextCursor"] = next
	}
	response.OK(w, r, payload)
}

func (h *Handler) subscription(w http.ResponseWriter, r *http.Request) {
	payload, err := h.service.Subscription(r.Context(), bearer(r),
		chi.URLParam(r, "instanceId"), correlationID(r))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.Representation(w, http.StatusOK, contractContentType, payload)
}

func (h *Handler) timeline(w http.ResponseWriter, r *http.Request) {
	entries, next, err := h.service.Timeline(r.Context(), bearer(r),
		chi.URLParam(r, "instanceId"), intQuery(r, "limit"),
		strings.TrimSpace(r.URL.Query().Get("cursor")))
	if err != nil {
		writeError(w, r, err)
		return
	}
	items := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		item := map[string]any{
			"timelineEntryId": entry.ID,
			"entryType":       entry.EntryType,
			"effectiveAt":     billingaccess.ContractTimestamp(entry.EffectiveAt),
			"observedAt":      billingaccess.ContractTimestamp(entry.ObservedAt),
			"explanationCode": entry.ExplanationCode,
		}
		if entry.ProductID != "" {
			item["mosaicProductId"] = entry.ProductID
		}
		if len(entry.Detail) > 0 {
			item["detail"] = entry.Detail
		}
		items = append(items, item)
	}
	payload := map[string]any{"items": items}
	if next != "" {
		payload["nextCursor"] = next
	}
	response.OK(w, r, payload)
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
	// The contracts declare additionalProperties:false at every level, so an
	// unknown member is a rejection rather than a value quietly dropped.
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

func intQuery(r *http.Request, name string) int {
	value, err := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get(name)))
	if err != nil {
		return 0
	}
	return value
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

// writeError maps access-domain errors onto HTTP in one place.
//
// The Cause is never populated: response.Error logs the cause behind every 5xx,
// and on this surface a cause can quote a token digest or an Authorization
// header. Authentication failures are deliberately indistinguishable from one
// another — expired, revoked, unknown, and wrong-audience all answer 401 —
// because telling a caller which half of a guess was right is how a credential
// gets brute-forced.
func writeError(w http.ResponseWriter, r *http.Request, err error) {
	status, code, message := http.StatusInternalServerError, "internal_error", "An unexpected error occurred."
	switch {
	case errors.Is(err, billingaccess.ErrUnauthenticated):
		status, code, message = http.StatusUnauthorized, "unauthenticated", "Authentication is required."
	case errors.Is(err, billingaccess.ErrForbidden):
		status, code, message = http.StatusForbidden, "forbidden", "The credential does not cover this resource."
	case errors.Is(err, billingaccess.ErrNotFound):
		status, code, message = http.StatusNotFound, "not_found", "The requested resource was not found."
	case errors.Is(err, billingaccess.ErrInvalid):
		status, code, message = http.StatusUnprocessableEntity, "validation_failed", "The request contains invalid fields."
	case errors.Is(err, billingaccess.ErrConflict):
		status, code, message = http.StatusConflict, "conflict", "The resource is in a conflicting state."
	case errors.Is(err, billingaccess.ErrBillingDisabled):
		// Mosaic Billing being off is a service state, never a statement about
		// the customer. 409 rather than 404 so a caller can tell "not enabled"
		// from "no such customer".
		status, code, message = http.StatusConflict, "billing_not_enabled",
			"Mosaic Billing is not enabled for this Project."
	case errors.Is(err, billingaccess.ErrUnavailable):
		status, code, message = http.StatusServiceUnavailable, "billing_storage_unavailable",
			"Billing state could not be read."
	}
	response.Error(w, r, response.NewAPIError(status, code, message))
}
