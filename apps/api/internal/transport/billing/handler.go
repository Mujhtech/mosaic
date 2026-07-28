// Package billinghttp exposes Mosaic Billing over HTTP.
//
// Handlers here are strictly thin: read the request, decode, validate transport
// shape, call the application service, write a standardized response. No
// handler queries the database, constructs SQL, decides authorization, or calls
// a provider — and none of them calls render.JSON directly.
package billinghttp

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	validation "github.com/go-ozzo/ozzo-validation/v4"
	"github.com/rs/zerolog"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/authn"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/httpmiddleware"
	chimiddleware "github.com/go-chi/chi/v5/middleware"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
)

// Limiter bounds an observation surface. Notification intake is deliberately
// not given one — see RegisterNotificationRoutes.
type Limiter interface {
	Allow(string) (bool, time.Duration)
}

type Handler struct {
	service    *billing.Service
	ipLimiter  Limiter
	keyLimiter Limiter
}

// RegisterNotificationRoutes mounts the Apple App Store Server Notification
// endpoint.
//
// This route carries no rate limiter on purpose. Apple retries a failed V2
// notification only five times, at 1/12/24/48/72 hours, and never retries in
// sandbox at all. A 429 returned to Apple therefore consumes one of five
// non-renewable delivery attempts and can permanently lose a transaction, which
// is a worse outcome than any load this endpoint can realistically produce. It
// is protected instead by a hard body-size ceiling, the unguessable intake
// token in the path, JWS verification against the pinned Apple root, and
// anomaly telemetry.
func RegisterNotificationRoutes(router chi.Router, service *billing.Service) {
	h := &Handler{service: service}
	router.Post("/billing/apple/notifications/{intakeToken}", h.appleNotification)
}

// RegisterPublicRoutes mounts the untrusted SDK observation endpoint. This one
// may return 429: SDKs hold a durable queue and retry, so shedding load costs
// latency rather than data.
func RegisterPublicRoutes(router chi.Router, service *billing.Service, ip, key Limiter) {
	h := &Handler{service: service, ipLimiter: ip, keyLimiter: key}
	router.Post("/sdk/billing/observations", h.clientObservation)
	router.Post("/billing/server/observations", h.serverObservation)
}

// RegisterProjectRoutes mounts the authenticated operator API.
func RegisterProjectRoutes(router chi.Router, service *billing.Service, expensive ...func(http.Handler) http.Handler) {
	h := &Handler{service: service}
	guarded := nonNil(expensive)

	router.Route("/billing/settings", func(settings chi.Router) {
		settings.Put("/", h.updateSettings)
	})
	router.Route("/billing/store-credentials", func(credentials chi.Router) {
		credentials.Get("/", h.listCredentials)
		credentials.Post("/", h.createCredential)
		credentials.Get("/{credentialId}", h.getCredential)
		credentials.Post("/{credentialId}/rotate", h.rotateCredential)
		credentials.Post("/{credentialId}/revoke", h.revokeCredential)
		credentials.With(guarded...).Post("/{credentialId}/test", h.testCredential)
	})
	router.Route("/environments/{environmentId}/billing", func(environment chi.Router) {
		environment.Get("/facts", h.listFacts)
		environment.Get("/validation-attempts", h.listAttempts)
		environment.Get("/ledger", h.listLedger)
		environment.Get("/quarantine", h.listQuarantine)
		environment.Get("/health", h.health)
		environment.Get("/reconciliation-runs", h.listReconciliations)
		environment.With(guarded...).Post("/reconciliation-runs", h.createReconciliation)
		environment.Get("/replay-jobs", h.listReplays)
		environment.With(guarded...).Post("/replay-jobs", h.createReplay)
	})
	router.Route("/billing/quarantine/{recordId}", func(record chi.Router) {
		record.Get("/", h.getQuarantine)
		// The recovery surface is exactly two actions. There is no
		// mark-as-valid route, and adding one would require asserting an
		// outcome the store never confirmed.
		record.With(guarded...).Post("/retry", h.retryQuarantine)
		record.With(guarded...).Post("/close-superseded", h.closeQuarantine)
	})
}

func nonNil(middleware []func(http.Handler) http.Handler) []func(http.Handler) http.Handler {
	result := make([]func(http.Handler) http.Handler, 0, len(middleware))
	for _, item := range middleware {
		if item != nil {
			result = append(result, item)
		}
	}
	return result
}

func actor(r *http.Request) billing.Actor {
	principal, _ := authn.FromContext(r.Context())
	return billing.Actor{ID: principal.ActorID}
}

func correlationID(r *http.Request) string {
	if id := chimiddleware.GetReqID(r.Context()); id != "" {
		return id
	}
	return "billing"
}

// ---------------------------------------------------------------------------
// Apple notification intake
// ---------------------------------------------------------------------------

func (h *Handler) appleNotification(w http.ResponseWriter, r *http.Request) {
	if encoding := r.Header.Get("Content-Encoding"); encoding != "" && encoding != "identity" {
		writeError(w, r, billing.ErrInvalid)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, billing.MaxNotificationBytes)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, r, billing.ErrInvalid)
		return
	}

	token := strings.TrimSpace(chi.URLParam(r, "intakeToken"))
	if token == "" {
		response.Error(w, r, response.NewAPIError(http.StatusNotFound, "not_found", "The requested resource was not found."))
		return
	}

	// The body is handed to the service unparsed. Parsing here would put a
	// signed payload into a handler-local variable that a future logging
	// statement could reach.
	if err := h.service.AcceptAppleNotification(r.Context(), token, body, correlationID(r)); err != nil {
		switch {
		case errors.Is(err, billing.ErrNotFound):
			// An unknown or revoked token has no tenant. 404 with no body: there
			// is nothing to attribute and nothing to say.
			response.Error(w, r, response.NewAPIError(http.StatusNotFound, "not_found", "The requested resource was not found."))
		default:
			// The only condition worth spending one of Apple's five retries on
			// is Mosaic being unable to durably record the input.
			response.Error(w, r, response.NewAPIError(http.StatusServiceUnavailable,
				"billing_storage_unavailable", "The notification could not be recorded."))
		}
		return
	}
	// 202 is inside Apple's 200-206 success range, so the notification is not
	// retried, and it honestly describes what happened: accepted, not validated.
	response.Accepted(w, r, map[string]string{"status": "accepted"})
}

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

// The observation endpoints speak the Billing Ingestion Contract v1 record
// shape on the way in as well as on the way out, so a single platform-neutral
// document travels from four SDKs to one server. The Go types below mirror the
// contract's `clientTransactionObservation` and `serverTransactionObservation`
// records exactly, and every one of them is decoded with
// DisallowUnknownFields: the schema declares additionalProperties:false at
// every level, so a member the contract does not define must be a rejection
// rather than a silently ignored value.

// observationEnvelope is the outer record. recordType and contract version are
// checked before the payload is interpreted, so a reader of the wrong contract
// gets a precise code instead of a schema error.
type observationEnvelope[T any] struct {
	BillingIngestionContractVersion string `json:"billingIngestionContractVersion"`
	RecordType                      string `json:"recordType"`
	Payload                         T      `json:"payload"`
}

// transactionReference is the discriminated provider reference. Raw receipts,
// signed payloads, JWS representations, and purchase tokens are structurally
// impossible to carry here: the value bounds are 24 decimal digits for Apple
// and exactly 64 lowercase hex characters for Google.
type transactionReference struct {
	ReferenceKind string `json:"referenceKind"`
	Value         string `json:"value"`
}

type providerOrderReference struct {
	ReferenceKind string `json:"referenceKind"`
	Value         string `json:"value"`
}

type observationContext struct {
	Platform               string `json:"platform"`
	SDKFamily              string `json:"sdkFamily"`
	SDKVersion             string `json:"sdkVersion"`
	OperatingSystemVersion string `json:"operatingSystemVersion,omitempty"`
	ApplicationVersion     string `json:"applicationVersion,omitempty"`
}

type observationCorrelation struct {
	PurchaseAttemptID   string `json:"purchaseAttemptId,omitempty"`
	ProviderOperationID string `json:"providerOperationId,omitempty"`
	ProviderUpdateID    string `json:"providerUpdateId,omitempty"`
}

type storeEnvironmentClassification struct {
	Classification string `json:"classification"`
	Basis          string `json:"basis"`
}

// clientObservationPayload is the contract's clientTransactionObservation.
//
// It has no storeEnvironmentClassification member and no purchase-token member,
// because the contract gives a client neither. A device can be made to say
// anything, so accepting a client's Store Environment would let a sandbox
// purchase present itself as production; classification comes only from
// server-side validation of the store's own response.
type clientObservationPayload struct {
	ObservationID          string                  `json:"observationId"`
	SubmissionID           string                  `json:"submissionId"`
	ProviderID             string                  `json:"providerId"`
	StorePlatform          string                  `json:"storePlatform"`
	TransactionReference   transactionReference    `json:"transactionReference"`
	ProviderOrderReference *providerOrderReference `json:"providerOrderReference,omitempty"`
	ObservedAt             string                  `json:"observedAt"`
	SourceAuthority        string                  `json:"sourceAuthority"`
	Context                observationContext      `json:"context"`
	Correlation            *observationCorrelation `json:"correlation,omitempty"`
	// ClaimedMosaicProductID is a claim only. The server resolves the Mosaic
	// Product independently and a mismatch is a diagnostic, never an override,
	// so the value is accepted for shape conformance and deliberately not used.
	ClaimedMosaicProductID string `json:"claimedMosaicProductId,omitempty"`
}

// serverObservationPayload is the contract's serverTransactionObservation.
//
// A trusted server may classify the Store Environment and record how trust was
// established. It still carries no purchase token: the contract states that
// purchase tokens are structurally impossible to carry across this boundary,
// and the reference is the same digest a client would send.
type serverObservationPayload struct {
	ObservationID                  string                          `json:"observationId"`
	SubmissionID                   string                          `json:"submissionId"`
	ProviderID                     string                          `json:"providerId"`
	StorePlatform                  string                          `json:"storePlatform"`
	TransactionReference           transactionReference            `json:"transactionReference"`
	ProviderOrderReference         *providerOrderReference         `json:"providerOrderReference,omitempty"`
	SourceAuthority                string                          `json:"sourceAuthority"`
	TrustBasis                     string                          `json:"trustBasis"`
	ReceivedAt                     string                          `json:"receivedAt"`
	ProviderReportedAt             string                          `json:"providerReportedAt,omitempty"`
	ProviderNotificationReference  string                          `json:"providerNotificationReference,omitempty"`
	StoreEnvironmentClassification *storeEnvironmentClassification `json:"storeEnvironmentClassification,omitempty"`
	Correlation                    *observationCorrelation         `json:"correlation,omitempty"`
	OriginatingObservationID       string                          `json:"originatingObservationId,omitempty"`
}

// contract vocabulary the transport enforces before the service is called.
const (
	recordTypeClientObservation = "clientTransactionObservation"
	recordTypeServerObservation = "serverTransactionObservation"

	storePlatformApple  = "apple_app_store"
	storePlatformGoogle = "google_play"

	authorityClientObservation = "client_observation"
	authorityTrustedServer     = "trusted_server_observation"
)

var contractIdentifier = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]*$`)

func validIdentifier(value string) bool {
	return len(value) >= 1 && len(value) <= 128 && contractIdentifier.MatchString(value)
}

// validateReference enforces the contract's storePlatformReferenceAlignment: an
// Apple record carries a decimal transaction id and no Google order reference;
// a Google record carries a 64-character lowercase hex token digest. Mosaic
// checks it rather than trusting the sender, because the alignment is what stops
// an Android digest being validated against Apple's API.
func validateReference(platform string, reference transactionReference, order *providerOrderReference) string {
	switch platform {
	case storePlatformApple:
		if reference.ReferenceKind != billing.ReferenceAppStoreTransactionID {
			return billing.CodeReferenceKindUnsupported
		}
		if order != nil {
			return billing.CodeProviderReferenceMalformed
		}
		if len(reference.Value) < 1 || len(reference.Value) > 24 || !isDecimalString(reference.Value) {
			return billing.CodeProviderReferenceMalformed
		}
	case storePlatformGoogle:
		if reference.ReferenceKind != billing.ReferenceGooglePlayTokenDigest {
			return billing.CodeReferenceKindUnsupported
		}
		if _, ok := billing.ValidHexDigest(reference.Value); !ok {
			return billing.CodeProviderReferenceMalformed
		}
		if order != nil {
			if order.ReferenceKind != billing.ReferenceGooglePlayOrderID || !validIdentifier(order.Value) {
				return billing.CodeProviderReferenceMalformed
			}
		}
	default:
		return billing.CodeProviderReferenceMalformed
	}
	return ""
}

func isDecimalString(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func (p clientObservationPayload) validate() string {
	for _, id := range []string{p.ObservationID, p.SubmissionID, p.ProviderID} {
		if !validIdentifier(id) {
			return billing.CodeInvalidIdentifier
		}
	}
	// sourceAuthority must match what this endpoint's authentication actually
	// proves. A public SDK key proves only that a client sent the document, so
	// any higher authority claimed in the envelope is refused rather than
	// quietly downgraded.
	if p.SourceAuthority != authorityClientObservation {
		return billing.CodeAuthorityNotAllowed
	}
	if p.Context.Platform == "" || p.Context.SDKFamily == "" || p.Context.SDKVersion == "" {
		return billing.CodeObservationSchemaInvalid
	}
	if !contractTimestampValid(p.ObservedAt) {
		return billing.CodeInvalidTimestamp
	}
	return validateReference(p.StorePlatform, p.TransactionReference, p.ProviderOrderReference)
}

func (p serverObservationPayload) validate() string {
	for _, id := range []string{p.ObservationID, p.SubmissionID, p.ProviderID} {
		if !validIdentifier(id) {
			return billing.CodeInvalidIdentifier
		}
	}
	// A Mosaic secret server key proves a trusted app backend sent the
	// document. It does not prove a provider signed anything, so
	// provider_notification, reconciliation_discovery, and manual_revalidation
	// — which are authorities only Mosaic's own pipeline may author — are
	// refused on this endpoint.
	if p.SourceAuthority != authorityTrustedServer {
		return billing.CodeAuthorityNotAllowed
	}
	if p.TrustBasis == "" {
		return billing.CodeObservationSchemaInvalid
	}
	if !contractTimestampValid(p.ReceivedAt) {
		return billing.CodeInvalidTimestamp
	}
	if p.StoreEnvironmentClassification != nil {
		classification := p.StoreEnvironmentClassification
		switch classification.Classification {
		case "sandbox", "production", "unclassified":
		default:
			return billing.CodeObservationSchemaInvalid
		}
		if classification.Basis == "unknown" && classification.Classification != "unclassified" {
			return billing.CodeObservationSchemaInvalid
		}
	}
	return validateReference(p.StorePlatform, p.TransactionReference, p.ProviderOrderReference)
}

var contractTimestamp = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z$`)

func contractTimestampValid(value string) bool {
	if !contractTimestamp.MatchString(value) {
		return false
	}
	_, err := time.Parse(time.RFC3339, value)
	return err == nil
}

func (p clientObservationPayload) toObservation() billing.Observation {
	observation := billing.Observation{
		SubmissionID:  p.SubmissionID,
		ReferenceKind: p.TransactionReference.ReferenceKind,
		Reference:     p.TransactionReference.Value,
		// Classification comes only from server-side validation.
		StoreEnvironment: "unclassified",
		ObservedAt:       parseContractTime(p.ObservedAt),
	}
	if p.ProviderOrderReference != nil {
		observation.OrderReference = p.ProviderOrderReference.Value
	}
	return observation
}

func (p serverObservationPayload) toObservation() billing.Observation {
	observation := billing.Observation{
		SubmissionID:     p.SubmissionID,
		ReferenceKind:    p.TransactionReference.ReferenceKind,
		Reference:        p.TransactionReference.Value,
		StoreEnvironment: "unclassified",
		ObservedAt:       parseContractTime(p.ReceivedAt),
	}
	if p.ProviderOrderReference != nil {
		observation.OrderReference = p.ProviderOrderReference.Value
	}
	if p.StoreEnvironmentClassification != nil {
		observation.StoreEnvironment = p.StoreEnvironmentClassification.Classification
	}
	return observation
}

func parseContractTime(value string) time.Time {
	if when, err := time.Parse(time.RFC3339, strings.TrimSpace(value)); err == nil {
		return when.UTC()
	}
	return time.Time{}
}

func (h *Handler) clientObservation(w http.ResponseWriter, r *http.Request) {
	body, submissionID, ok := h.readObservation(w, r)
	if !ok {
		return
	}
	if !h.allow(w, r, submissionID) {
		return
	}
	envelope, code := decodeEnvelope[clientObservationPayload](body, recordTypeClientObservation)
	if code == "" {
		code = envelope.Payload.validate()
	}
	if code != "" {
		writeSubmission(w, billing.Reject(submissionID, h.now(), code))
		return
	}
	result, err := h.service.SubmitClientObservation(r.Context(), bearer(r), envelope.Payload.toObservation(), correlationID(r))
	if err != nil {
		h.writeSubmissionError(w, r, submissionID, err)
		return
	}
	writeSubmission(w, result)
}

func (h *Handler) serverObservation(w http.ResponseWriter, r *http.Request) {
	body, submissionID, ok := h.readObservation(w, r)
	if !ok {
		return
	}
	if !h.allow(w, r, submissionID) {
		return
	}
	envelope, code := decodeEnvelope[serverObservationPayload](body, recordTypeServerObservation)
	if code == "" {
		code = envelope.Payload.validate()
	}
	if code != "" {
		writeSubmission(w, billing.Reject(submissionID, h.now(), code))
		return
	}
	result, err := h.service.SubmitServerObservation(r.Context(), bearer(r), envelope.Payload.toObservation(), correlationID(r))
	if err != nil {
		h.writeSubmissionError(w, r, submissionID, err)
		return
	}
	writeSubmission(w, result)
}

// readObservation bounds and buffers the body, then leniently peeks the
// submission id.
//
// The peek exists because every response shape in the contract requires
// submissionId, including rejections: a client that cannot correlate a
// rejection cannot drain its queue. The peek is tolerant by design and its
// result is only ever echoed back, never trusted — the strict decode that
// follows is what actually accepts the document.
func (h *Handler) readObservation(w http.ResponseWriter, r *http.Request) ([]byte, string, bool) {
	if encoding := r.Header.Get("Content-Encoding"); encoding != "" && encoding != "identity" {
		writeSubmission(w, billing.Reject("unknown", h.now(), billing.CodeObservationSchemaInvalid))
		return nil, "", false
	}
	r.Body = http.MaxBytesReader(w, r.Body, billing.MaxObservationBytes)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeSubmission(w, billing.Reject("unknown", h.now(), billing.CodeObservationTooLarge))
		return nil, "", false
	}
	return body, peekSubmissionID(body), true
}

// decodeEnvelope strictly decodes one contract record.
//
// The envelope is inspected before the payload is interpreted, in two passes.
// That order matters: a record of the wrong type or the wrong contract version
// would otherwise fail on whichever payload member happened to be unknown, and
// the caller would be told "unknown_field" when the real answer is "this
// document does not belong on this endpoint".
func decodeEnvelope[T any](body []byte, expectedRecordType string) (observationEnvelope[T], string) {
	var envelope observationEnvelope[T]

	var outer observationEnvelope[json.RawMessage]
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&outer); err != nil {
		if strings.Contains(err.Error(), "unknown field") {
			return envelope, billing.CodeUnknownField
		}
		return envelope, billing.CodeObservationSchemaInvalid
	}
	// Trailing JSON would let a caller smuggle a second document past the first.
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return envelope, billing.CodeObservationSchemaInvalid
	}
	if outer.BillingIngestionContractVersion != billing.BillingContractVersion {
		return envelope, "unsupported_contract_version"
	}
	if outer.RecordType != expectedRecordType {
		// Posting a server record to the public endpoint, or the reverse, is a
		// record-type error rather than an authority error.
		return envelope, "unsupported_record_type"
	}
	envelope.BillingIngestionContractVersion = outer.BillingIngestionContractVersion
	envelope.RecordType = outer.RecordType

	payloadDecoder := json.NewDecoder(bytes.NewReader(outer.Payload))
	payloadDecoder.DisallowUnknownFields()
	if err := payloadDecoder.Decode(&envelope.Payload); err != nil {
		// An unknown field is reported distinctly: it is how a client learns it
		// sent something the contract forbids — a Store Environment assertion,
		// for example — rather than seeing a generic schema error.
		if strings.Contains(err.Error(), "unknown field") {
			return envelope, billing.CodeUnknownField
		}
		return envelope, billing.CodeObservationSchemaInvalid
	}
	return envelope, ""
}

// peekSubmissionID reads submissionId without strict decoding.
func peekSubmissionID(body []byte) string {
	var peek struct {
		Payload struct {
			SubmissionID string `json:"submissionId"`
		} `json:"payload"`
	}
	if json.Unmarshal(body, &peek) == nil && validIdentifier(peek.Payload.SubmissionID) {
		return peek.Payload.SubmissionID
	}
	return "unknown"
}

// writeSubmission emits the contract record envelope.
//
// It uses response.Representation rather than response.Accepted because the
// wire contract here is the Billing Ingestion Contract record, not the
// dashboard data envelope: an SDK must decode one platform-neutral shape.
func writeSubmission(w http.ResponseWriter, result billing.SubmissionResult) {
	status := http.StatusAccepted
	switch result.Status {
	case billing.SubmissionDuplicate:
		status = http.StatusOK
	case billing.SubmissionPermanentlyRejected:
		status = http.StatusUnprocessableEntity
	case billing.SubmissionRetryableFailure:
		status = http.StatusServiceUnavailable
		if result.Code == billing.CodeRateLimited {
			status = http.StatusTooManyRequests
		}
		if result.RetryAfterSeconds > 0 {
			w.Header().Set("Retry-After", strconv.Itoa(result.RetryAfterSeconds))
		}
	}
	encoded, err := json.Marshal(result.Envelope())
	if err != nil {
		// The envelope is built from bounded constants and validated
		// identifiers, so this cannot carry caller content.
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	response.Representation(w, status, "application/json", encoded)
}

// writeSubmissionError maps a service failure onto the contract shape.
// Authentication is the one outcome that is not a submission result: there is
// no authenticated tenant to answer on behalf of.
func (h *Handler) writeSubmissionError(w http.ResponseWriter, r *http.Request, submissionID string, err error) {
	switch {
	case errors.Is(err, billing.ErrUnauthenticated):
		writeError(w, r, err)
	case errors.Is(err, billing.ErrUnavailable):
		writeSubmission(w, billing.SubmissionResult{
			SubmissionID: submissionID, ReceivedAt: billing.ContractTimestamp(h.now()),
			Status: billing.SubmissionRetryableFailure, Code: billing.CodeStorageUnavailable,
			RetryAfterSeconds: 30,
		})
	case errors.Is(err, billing.ErrInvalid):
		writeSubmission(w, billing.Reject(submissionID, h.now(), billing.CodeObservationSchemaInvalid))
	default:
		writeError(w, r, err)
	}
}

func (h *Handler) now() time.Time {
	if h.service != nil {
		return h.service.Now()
	}
	return time.Now().UTC()
}

func (h *Handler) allow(w http.ResponseWriter, r *http.Request, submissionID string) bool {
	if h.ipLimiter != nil {
		if ok, retry := h.ipLimiter.Allow("ip:" + httpmiddleware.ClientIP(r)); !ok {
			writeSubmission(w, billing.RateLimited(submissionID, h.now(), retry))
			return false
		}
	}
	if h.keyLimiter == nil {
		return true
	}
	if ok, retry := h.keyLimiter.Allow("key:" + digestKey(bearer(r))); !ok {
		// Shedding is reported in the contract shape, with a retry hint, so the
		// SDK queue backs off rather than treating it as a decode failure.
		writeSubmission(w, billing.RateLimited(submissionID, h.now(), retry))
		return false
	}
	return true
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

type credentialApplicationRequest struct {
	ApplicationID                 string `json:"applicationId"`
	Platform                      string `json:"platform"`
	ProviderApplicationIdentifier string `json:"providerApplicationIdentifier"`
}

type createCredentialRequest struct {
	EnvironmentID            string                         `json:"environmentId"`
	Provider                 string                         `json:"provider"`
	StoreEnvironment         string                         `json:"storeEnvironment"`
	Name                     string                         `json:"name"`
	Secret                   string                         `json:"secret"`
	AppleIssuerID            string                         `json:"appleIssuerId,omitempty"`
	AppleKeyID               string                         `json:"appleKeyId,omitempty"`
	GoogleClientEmail        string                         `json:"googleClientEmail,omitempty"`
	GooglePubSubProjectID    string                         `json:"googlePubSubProjectId,omitempty"`
	GooglePubSubSubscription string                         `json:"googlePubSubSubscriptionId,omitempty"`
	Applications             []credentialApplicationRequest `json:"applications"`
}

func (v *createCredentialRequest) Validate() error {
	return validation.ValidateStruct(v,
		validation.Field(&v.EnvironmentID, validation.Required),
		validation.Field(&v.Provider, validation.Required, validation.In(billing.ProviderAppStore, billing.ProviderGooglePlay)),
		validation.Field(&v.StoreEnvironment, validation.Required, validation.In("sandbox", "production")),
		validation.Field(&v.Name, validation.Required, validation.RuneLength(1, 120)),
		validation.Field(&v.Secret, validation.Required),
		validation.Field(&v.Applications, validation.Required, validation.Length(1, 32)),
	)
}

func (h *Handler) createCredential(w http.ResponseWriter, r *http.Request) {
	var request createCredentialRequest
	if !decodeLarge(w, r, &request) {
		return
	}
	input := billing.CredentialInput{
		ProjectID:                chi.URLParam(r, "projectId"),
		EnvironmentID:            request.EnvironmentID,
		Provider:                 request.Provider,
		StoreEnvironment:         request.StoreEnvironment,
		Name:                     request.Name,
		Secret:                   []byte(request.Secret),
		AppleIssuerID:            request.AppleIssuerID,
		AppleKeyID:               request.AppleKeyID,
		GoogleClientEmail:        request.GoogleClientEmail,
		GooglePubSubProjectID:    request.GooglePubSubProjectID,
		GooglePubSubSubscription: request.GooglePubSubSubscription,
	}
	for _, application := range request.Applications {
		input.Applications = append(input.Applications, billing.CredentialApplication{
			ApplicationID:                 application.ApplicationID,
			Platform:                      application.Platform,
			ProviderApplicationIdentifier: application.ProviderApplicationIdentifier,
		})
	}
	// The decoded secret string is cleared here too: the request struct outlives
	// the service call otherwise.
	request.Secret = ""

	credential, err := h.service.CreateCredential(r.Context(), actor(r), input)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.Created(w, r, credential)
}

type rotateCredentialRequest struct {
	Secret string `json:"secret"`
}

func (v *rotateCredentialRequest) Validate() error {
	return validation.ValidateStruct(v, validation.Field(&v.Secret, validation.Required))
}

func (h *Handler) rotateCredential(w http.ResponseWriter, r *http.Request) {
	var request rotateCredentialRequest
	if !decodeLarge(w, r, &request) {
		return
	}
	credential, err := h.service.RotateCredential(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "credentialId"), []byte(request.Secret))
	request.Secret = ""
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, credential)
}

func (h *Handler) revokeCredential(w http.ResponseWriter, r *http.Request) {
	credential, err := h.service.RevokeCredential(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "credentialId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, credential)
}

func (h *Handler) testCredential(w http.ResponseWriter, r *http.Request) {
	credential, err := h.service.TestCredential(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "credentialId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, credential)
}

func (h *Handler) listCredentials(w http.ResponseWriter, r *http.Request) {
	credentials, err := h.service.ListCredentials(r.Context(), actor(r), chi.URLParam(r, "projectId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, map[string]any{"items": credentials})
}

func (h *Handler) getCredential(w http.ResponseWriter, r *http.Request) {
	credential, err := h.service.GetCredential(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "credentialId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, credential)
}

type settingsRequest struct {
	BillingEnabled bool `json:"billingEnabled"`
}

func (h *Handler) updateSettings(w http.ResponseWriter, r *http.Request) {
	var request settingsRequest
	if !decode(w, r, &request) {
		return
	}
	if err := h.service.SetBillingEnabled(r.Context(), actor(r), chi.URLParam(r, "projectId"), request.BillingEnabled); err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, map[string]bool{"billingEnabled": request.BillingEnabled})
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// listOptions parses the closed set of filters the ledger surfaces accept.
// Anything outside the enumerations is dropped rather than passed through, so
// no caller-supplied string reaches a query predicate uninspected.
func listOptions(r *http.Request, statuses ...string) billing.ListOptions {
	query := r.URL.Query()
	options := billing.ListOptions{Cursor: strings.TrimSpace(query.Get("cursor"))}
	if limit, err := strconv.Atoi(query.Get("limit")); err == nil {
		options.Limit = limit
	}
	options.Status = allowed(query.Get("status"), statuses)
	options.ReasonCode = allowed(query.Get("reasonCode"), quarantineReasons)
	options.Provider = allowed(query.Get("provider"), []string{billing.ProviderAppStore, billing.ProviderGooglePlay})
	if from, err := time.Parse(time.RFC3339, query.Get("from")); err == nil {
		utc := from.UTC()
		options.From = &utc
	}
	if to, err := time.Parse(time.RFC3339, query.Get("to")); err == nil {
		utc := to.UTC()
		options.To = &utc
	}
	return options
}

func allowed(value string, permitted []string) string {
	trimmed := strings.TrimSpace(value)
	for _, candidate := range permitted {
		if trimmed == candidate {
			return trimmed
		}
	}
	return ""
}

var quarantineReasons = []string{
	billing.QuarantineSignatureInvalid, billing.QuarantineApplicationMismatch,
	billing.QuarantineEnvironmentMismatch, billing.QuarantineStoreEnvironmentMismatch,
	billing.QuarantineCredentialUnavailable, billing.QuarantineCredentialRevoked,
	billing.QuarantineProductUnknown, billing.QuarantineProductAmbiguous,
	billing.QuarantineCrossEnvironmentMismatch, billing.QuarantineUnsupportedProductType,
	billing.QuarantineUnsupportedTransaction, billing.QuarantineMalformedReference,
	billing.QuarantineInputContentConflict, billing.QuarantineReplayConflict,
	billing.QuarantineProviderPermanentlyFailed, billing.QuarantineValidationExhausted,
}

func (h *Handler) listFacts(w http.ResponseWriter, r *http.Request) {
	page, err := h.service.ListFacts(r.Context(), actor(r), chi.URLParam(r, "projectId"),
		chi.URLParam(r, "environmentId"), listOptions(r))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, page)
}

func (h *Handler) listAttempts(w http.ResponseWriter, r *http.Request) {
	page, err := h.service.ListAttempts(r.Context(), actor(r), chi.URLParam(r, "projectId"),
		chi.URLParam(r, "environmentId"), listOptions(r,
			billing.OutcomeValidated, billing.OutcomeRecordedNoFact, billing.OutcomeQuarantined,
			billing.OutcomeRetryableFailure, billing.OutcomePermanentlyFailed))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, page)
}

func (h *Handler) listLedger(w http.ResponseWriter, r *http.Request) {
	page, err := h.service.ListLedger(r.Context(), actor(r), chi.URLParam(r, "projectId"),
		chi.URLParam(r, "environmentId"), listOptions(r))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, page)
}

func (h *Handler) listQuarantine(w http.ResponseWriter, r *http.Request) {
	page, err := h.service.ListQuarantine(r.Context(), actor(r), chi.URLParam(r, "projectId"),
		chi.URLParam(r, "environmentId"), listOptions(r,
			billing.QuarantineOpen, billing.QuarantineRetrying,
			billing.QuarantineClosedAfterSuccess, billing.QuarantineClosedSuperseded))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, page)
}

func (h *Handler) getQuarantine(w http.ResponseWriter, r *http.Request) {
	record, err := h.service.Quarantine(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "recordId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, record)
}

func (h *Handler) retryQuarantine(w http.ResponseWriter, r *http.Request) {
	record, err := h.service.RetryQuarantine(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "recordId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.Accepted(w, r, record)
}

type closeQuarantineRequest struct {
	SupersededByRecordID string `json:"supersededByRecordId"`
}

func (v *closeQuarantineRequest) Validate() error {
	return validation.ValidateStruct(v, validation.Field(&v.SupersededByRecordID, validation.Required))
}

func (h *Handler) closeQuarantine(w http.ResponseWriter, r *http.Request) {
	var request closeQuarantineRequest
	if !decode(w, r, &request) {
		return
	}
	record, err := h.service.CloseQuarantineSuperseded(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "recordId"), request.SupersededByRecordID)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, record)
}

func (h *Handler) health(w http.ResponseWriter, r *http.Request) {
	value, err := h.service.Health(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "environmentId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, value)
}

// ---------------------------------------------------------------------------
// Reconciliation and replay
// ---------------------------------------------------------------------------

type reconciliationRequest struct {
	CredentialID string `json:"credentialId"`
	Provider     string `json:"provider"`
	Strategy     string `json:"strategy"`
	WindowStart  string `json:"windowStart"`
	WindowEnd    string `json:"windowEnd"`
}

func (v *reconciliationRequest) Validate() error {
	return validation.ValidateStruct(v,
		validation.Field(&v.CredentialID, validation.Required),
		validation.Field(&v.Provider, validation.Required, validation.In(billing.ProviderAppStore, billing.ProviderGooglePlay)),
		validation.Field(&v.Strategy, validation.Required, validation.In(
			"apple_notification_history", "apple_transaction_history", "google_token_requery")),
		validation.Field(&v.WindowStart, validation.Required),
		validation.Field(&v.WindowEnd, validation.Required),
	)
}

func (h *Handler) createReconciliation(w http.ResponseWriter, r *http.Request) {
	var request reconciliationRequest
	if !decode(w, r, &request) {
		return
	}
	start, startErr := time.Parse(time.RFC3339, request.WindowStart)
	end, endErr := time.Parse(time.RFC3339, request.WindowEnd)
	if startErr != nil || endErr != nil {
		writeError(w, r, billing.ErrInvalid)
		return
	}
	run, err := h.service.CreateReconciliation(r.Context(), actor(r), billing.ReconciliationRun{
		ProjectID: chi.URLParam(r, "projectId"), EnvironmentID: chi.URLParam(r, "environmentId"),
		CredentialID: request.CredentialID, Provider: request.Provider, Strategy: request.Strategy,
		WindowStart: start.UTC(), WindowEnd: end.UTC(),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.Accepted(w, r, run)
}

func (h *Handler) listReconciliations(w http.ResponseWriter, r *http.Request) {
	page, err := h.service.ListReconciliationRuns(r.Context(), actor(r), chi.URLParam(r, "projectId"),
		chi.URLParam(r, "environmentId"), listOptions(r, "queued", "leased", "completed", "partial", "failed"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, page)
}

type replayRequest struct {
	Kind             string `json:"kind"`
	RawInputID       string `json:"rawInputId,omitempty"`
	WindowStart      string `json:"windowStart,omitempty"`
	WindowEnd        string `json:"windowEnd,omitempty"`
	ValidatorVersion int    `json:"validatorVersion,omitempty"`
}

func (v *replayRequest) Validate() error {
	return validation.ValidateStruct(v,
		validation.Field(&v.Kind, validation.Required, validation.In("replay", "revalidation")),
		validation.Field(&v.ValidatorVersion, validation.Min(0)),
	)
}

func (h *Handler) createReplay(w http.ResponseWriter, r *http.Request) {
	var request replayRequest
	if !decode(w, r, &request) {
		return
	}
	job := billing.ReplayJob{
		ProjectID: chi.URLParam(r, "projectId"), EnvironmentID: chi.URLParam(r, "environmentId"),
		Kind: request.Kind, RawInputID: strings.TrimSpace(request.RawInputID),
		ValidatorVersion: request.ValidatorVersion,
	}
	if start, err := time.Parse(time.RFC3339, request.WindowStart); err == nil {
		utc := start.UTC()
		job.WindowStart = &utc
	}
	if end, err := time.Parse(time.RFC3339, request.WindowEnd); err == nil {
		utc := end.UTC()
		job.WindowEnd = &utc
	}
	created, err := h.service.CreateReplay(r.Context(), actor(r), job)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.Accepted(w, r, created)
}

func (h *Handler) listReplays(w http.ResponseWriter, r *http.Request) {
	page, err := h.service.ListReplayJobs(r.Context(), actor(r), chi.URLParam(r, "projectId"),
		chi.URLParam(r, "environmentId"), listOptions(r, "queued", "leased", "completed", "failed"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, page)
}

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

func decode(w http.ResponseWriter, r *http.Request, target any) bool {
	return decodeWithLimit(w, r, target, billing.MaxObservationBytes)
}

// decodeLarge is used only by the credential routes, whose body legitimately
// carries a service-account JSON key of a few kilobytes.
func decodeLarge(w http.ResponseWriter, r *http.Request, target any) bool {
	return decodeWithLimit(w, r, target, 64<<10)
}

func decodeWithLimit(w http.ResponseWriter, r *http.Request, target any, limit int64) bool {
	if encoding := r.Header.Get("Content-Encoding"); encoding != "" && encoding != "identity" {
		writeError(w, r, billing.ErrInvalid)
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(w, r, billing.ErrInvalid)
		return false
	}
	// A second decode asserting EOF rejects trailing JSON, which would otherwise
	// let a caller smuggle a second document past the first.
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeError(w, r, billing.ErrInvalid)
		return false
	}
	if validatable, ok := target.(interface{ Validate() error }); ok {
		if err := validatable.Validate(); err != nil {
			writeError(w, r, billing.ErrInvalid)
			return false
		}
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

// writeError maps billing errors onto HTTP.
//
// The Cause field is deliberately never populated. response.Error logs the
// cause behind every 5xx, and on this surface a cause can quote a fragment of a
// signed payload, a purchase token, or an Authorization header. The unmapped
// branch logs the error's type only — the same redaction the authentication
// resolver applies for the same reason.
func writeError(w http.ResponseWriter, r *http.Request, err error) {
	status, code, message := http.StatusInternalServerError, "internal_error", "An unexpected error occurred."
	switch {
	case errors.Is(err, billing.ErrUnauthenticated):
		status, code, message = http.StatusUnauthorized, "unauthenticated", "Authentication is required."
	case errors.Is(err, billing.ErrForbidden):
		status, code, message = http.StatusForbidden, "forbidden", "You do not have permission to perform this action."
	case errors.Is(err, billing.ErrNotFound):
		status, code, message = http.StatusNotFound, "not_found", "The requested resource was not found."
	case errors.Is(err, billing.ErrConflict):
		status, code, message = http.StatusConflict, "conflict", "The request conflicts with current billing state."
	case errors.Is(err, billing.ErrBillingDisabled):
		status, code, message = http.StatusConflict, "billing_not_enabled", "Mosaic Billing is not enabled for this Project."
	case errors.Is(err, billing.ErrInvalid):
		status, code, message = http.StatusUnprocessableEntity, "validation_failed", "The billing request is invalid."
	case errors.Is(err, billing.ErrRateLimited):
		status, code, message = http.StatusTooManyRequests, "rate_limited", "Billing submissions are temporarily rate limited."
	case errors.Is(err, billing.ErrCredentialUnusable):
		status, code, message = http.StatusConflict, "store_credential_unusable", "The Store Server Credential could not be used."
	case errors.Is(err, billing.ErrUnavailable):
		status, code, message = http.StatusServiceUnavailable, "billing_storage_unavailable", "Billing storage is temporarily unavailable."
	default:
		var safe *billing.SafeError
		event := zerolog.Ctx(r.Context()).Error()
		if errors.As(err, &safe) {
			event = event.Str("billing_error_code", safe.Code).Str("billing_error_kind", safe.Kind)
		} else {
			event = event.Str("billing_error_kind", errorTypeName(err))
		}
		event.Msg("billing request failed")
	}
	response.Error(w, r, response.NewAPIError(status, code, message))
}

func errorTypeName(err error) string {
	if err == nil {
		return ""
	}
	return strings.TrimPrefix(strings.SplitN(err.Error(), ":", 2)[0], "billing ")
}

func digestKey(raw string) string {
	sum := billing.TokenDigest(raw)
	const digits = "0123456789abcdef"
	out := make([]byte, len(sum)*2)
	for i, b := range sum {
		out[i*2] = digits[b>>4]
		out[i*2+1] = digits[b&0x0f]
	}
	return string(out)
}
