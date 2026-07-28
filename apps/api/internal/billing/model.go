package billing

import "time"

// ValidatorVersion is stamped on every Validation Attempt and Transaction Fact.
// It exists so a replay can be asked for explicitly ("re-run these inputs under
// validator 2") and so a fact records which normalization produced it. It is
// incremented whenever normalization changes in a way that could produce a
// different fact from the same input.
const ValidatorVersion = 1

// Providers.
const (
	ProviderAppStore   = "app_store"
	ProviderGooglePlay = "google_play"
)

// Store Environment. Distinct from a Mosaic Environment throughout: the two are
// always two separate values on every record and every UI control.
const (
	StoreSandbox      = "sandbox"
	StoreProduction   = "production"
	StoreUnclassified = "unclassified"
)

// Raw Billing Input sources.
const (
	SourceAppleNotification        = "apple_notification"
	SourceAppleNotificationHistory = "apple_notification_history"
	SourceAppleTransactionHistory  = "apple_transaction_history"
	SourceGoogleRTDN               = "google_rtdn"
	SourceGoogleTokenRequery       = "google_token_requery"
	SourceClientObservation        = "client_observation"
	SourceTrustedServerObservation = "trusted_server_observation"
)

// Source authority. A client observation is a trigger, never proof; a trusted
// server observation is a trigger from a more accountable caller, still never
// proof. Only the store itself is authoritative, and only after validation.
const (
	AuthorityStoreNotification   = "store_notification"
	AuthorityStoreReconciliation = "store_reconciliation"
	AuthorityClient              = "client_observation"
	AuthorityTrustedServer       = "trusted_server_observation"
)

// Authentication results recorded on a Raw Billing Input.
const (
	AuthVerifiedSignature = "verified_signature"
	AuthVerifiedTransport = "verified_transport"
	AuthUnauthenticated   = "unauthenticated_client"
	AuthFailed            = "failed"
)

// Ingestion statuses.
const (
	IngestAccepted    = "accepted"
	IngestDuplicate   = "duplicate"
	IngestConflicted  = "conflicted"
	IngestQuarantined = "quarantined"
)

// Validation attempt outcomes.
const (
	OutcomeValidated         = "validated"
	OutcomeRecordedNoFact    = "recorded_no_fact"
	OutcomeQuarantined       = "quarantined"
	OutcomeRetryableFailure  = "retryable_failure"
	OutcomePermanentlyFailed = "permanently_failed"
)

// Submission statuses returned to an observation caller, matching the frozen
// Billing Ingestion Contract v1 status set verbatim. There is deliberately no
// member meaning validated, verified, confirmed, or entitled: an observation
// endpoint cannot honestly report any of those, because validation has not
// happened when the response is written.
const (
	SubmissionAccepted            = "accepted_for_validation"
	SubmissionDuplicate           = "duplicate"
	SubmissionPermanentlyRejected = "permanently_rejected"
	SubmissionRetryableFailure    = "retryable_failure"
)

// Permanent submission codes. Resubmitting the identical document cannot
// succeed. The vocabulary is the contract's `permanentCode` enum; a code outside
// it would fail schema validation in every SDK that checks, so these constants
// exist rather than free-form strings.
const (
	CodeObservationSchemaInvalid   = "observation_schema_invalid"
	CodeUnknownField               = "unknown_field"
	CodeInvalidIdentifier          = "invalid_identifier"
	CodeInvalidTimestamp           = "invalid_timestamp"
	CodeObservationTooLarge        = "observation_too_large"
	CodeProviderReferenceMalformed = "provider_reference_malformed"
	CodeReferenceKindUnsupported   = "reference_kind_not_supported_for_platform"
	CodeSensitiveValueRejected     = "sensitive_value_rejected"
	CodeAuthorityNotAllowed        = "authority_not_allowed"
	CodeBillingNotEnabled          = "billing_not_enabled_for_environment"
	CodeObservationIDConflict      = "observation_id_conflict"
)

// Retryable submission codes. Transient; resubmit the identical document later.
const (
	CodeRateLimited           = "rate_limited"
	CodeStorageUnavailable    = "storage_temporarily_unavailable"
	CodeServiceUnavailable    = "service_temporarily_unavailable"
	CodeIngestionTimeout      = "ingestion_timeout"
	CodeValidationBacklogFull = "validation_backlog_saturated"
)

// SubmissionRecordType and BillingContractVersion identify the response record.
const (
	BillingContractVersion = "1"
	SubmissionRecordType   = "observationSubmissionResult"
)

// Reference kinds a client may submit. The discriminator resolves the
// long-standing ambiguity between the iOS raw-decimal transaction id and the
// Android token digest.
const (
	ReferenceAppStoreTransactionID = "app_store_transaction_id"
	ReferenceGooglePlayTokenDigest = "google_play_token_digest"
	ReferenceGooglePlayOrderID     = "google_play_order_id"
)

// Transaction types. Phase 9A supports auto-renewable subscriptions and
// non-consumables only; a consumable quarantines rather than producing a fact
// it cannot model.
const (
	TypeAutoRenewableSubscription = "auto_renewable_subscription"
	TypeNonConsumable             = "non_consumable"
)

// Fact kinds.
const (
	KindInitialPurchase       = "initial_purchase"
	KindRenewal               = "renewal"
	KindOneTimePurchase       = "one_time_purchase"
	KindPlanChange            = "plan_change"
	KindOfferRedeemed         = "offer_redeemed"
	KindRefund                = "refund"
	KindRevocation            = "revocation"
	KindExpiration            = "expiration"
	KindGracePeriodStart      = "grace_period_start"
	KindBillingRetryStart     = "billing_retry_start"
	KindCancellationScheduled = "cancellation_scheduled"
	KindAutoRenewDisabled     = "auto_renew_disabled"
	KindAutoRenewEnabled      = "auto_renew_enabled"
	KindPurchaseSuperseded    = "purchase_superseded"
	KindPaused                = "paused"
	KindResumed               = "resumed"
)

// Product-resolution outcomes.
const (
	ResolutionResolved                 = "resolved"
	ResolutionUnknown                  = "unknown"
	ResolutionAmbiguous                = "ambiguous"
	ResolutionCrossEnvironmentMismatch = "cross_environment_mismatch"
	ResolutionUnsupportedProductType   = "unsupported_product_type"
)

// Resolution states recorded in a Resolution Snapshot.
const (
	StateActiveMapping    = "active_mapping"
	StateArchivedMapping  = "archived_mapping"
	StateReplacementChain = "replacement_chain"
	StateUnresolved       = "unresolved"
)

// Quarantine reason codes.
const (
	QuarantineSignatureInvalid          = "signature_invalid"
	QuarantineApplicationMismatch       = "application_mismatch"
	QuarantineEnvironmentMismatch       = "environment_mismatch"
	QuarantineStoreEnvironmentMismatch  = "store_environment_mismatch"
	QuarantineCredentialUnavailable     = "credential_unavailable"
	QuarantineCredentialRevoked         = "credential_revoked"
	QuarantineProductUnknown            = "product_unknown"
	QuarantineProductAmbiguous          = "product_ambiguous"
	QuarantineCrossEnvironmentMismatch  = "cross_environment_mismatch"
	QuarantineUnsupportedProductType    = "unsupported_product_type"
	QuarantineUnsupportedTransaction    = "unsupported_transaction_type"
	QuarantineMalformedReference        = "malformed_reference"
	QuarantineInputContentConflict      = "input_content_conflict"
	QuarantineReplayConflict            = "replay_conflict"
	QuarantineProviderPermanentlyFailed = "provider_permanently_failed"
	QuarantineValidationExhausted       = "validation_exhausted"
)

// Quarantine statuses. There is no status meaning "operator declared this
// valid": the only exit that yields a Transaction Fact is a successful
// revalidation against the store.
const (
	QuarantineOpen               = "open"
	QuarantineRetrying           = "retrying"
	QuarantineClosedAfterSuccess = "closed_after_success"
	QuarantineClosedSuperseded   = "closed_superseded"
)

// Ledger entry types.
const (
	LedgerInputReceived           = "input_received"
	LedgerInputAuthenticated      = "input_authenticated"
	LedgerInputDuplicateDetected  = "input_duplicate_detected"
	LedgerValidationStarted       = "validation_started"
	LedgerValidationSucceeded     = "validation_succeeded"
	LedgerValidationFailed        = "validation_failed"
	LedgerProductResolved         = "product_resolved"
	LedgerProductResolutionFailed = "product_resolution_failed"
	LedgerFactRecorded            = "fact_recorded"
	LedgerFactDeduplicated        = "fact_deduplicated"
	LedgerInputQuarantined        = "input_quarantined"
	LedgerQuarantineClosed        = "quarantine_closed"
	LedgerReconciliationStarted   = "reconciliation_started"
	LedgerReconciliationDiscovery = "reconciliation_discovery"
	LedgerReconciliationCompleted = "reconciliation_completed"
	LedgerReplayStarted           = "replay_started"
	LedgerReplayCompleted         = "replay_completed"
	LedgerRevalidationCompleted   = "revalidation_completed"
	LedgerCredentialHealthChanged = "credential_health_changed"
)

// Credential classes for the encryption envelope.
const (
	ClassAppleInAppPurchaseKey   = "appleInAppPurchaseKey"
	ClassGoogleServiceAccountKey = "googleServiceAccountKey"
	ClassBillingRawPayload       = "billingRawPayload"
)

// Actor is the authenticated dashboard principal.
type Actor struct{ ID string }

// Envelope is the persisted encryption envelope for a credential or a raw body.
type Envelope struct {
	Version     int
	Algorithm   string
	KeyID       string
	Nonce       []byte
	Ciphertext  []byte
	Fingerprint []byte
}

// StoreServerCredential is the operator-facing view. It never carries secret
// material: the envelope stays in the repository layer and the API returns only
// the non-secret identifiers.
type StoreServerCredential struct {
	ID                       string                  `json:"id"`
	ProjectID                string                  `json:"projectId"`
	EnvironmentID            string                  `json:"environmentId"`
	Provider                 string                  `json:"provider"`
	StoreEnvironment         string                  `json:"storeEnvironment"`
	Name                     string                  `json:"name"`
	Status                   string                  `json:"status"`
	HealthStatus             string                  `json:"healthStatus"`
	AppleIssuerID            string                  `json:"appleIssuerId,omitempty"`
	AppleKeyID               string                  `json:"appleKeyId,omitempty"`
	GoogleClientEmail        string                  `json:"googleClientEmail,omitempty"`
	GooglePubSubProjectID    string                  `json:"googlePubSubProjectId,omitempty"`
	GooglePubSubSubscription string                  `json:"googlePubSubSubscriptionId,omitempty"`
	Applications             []CredentialApplication `json:"applications"`
	LastErrorCode            string                  `json:"lastErrorCode,omitempty"`
	LastTestedAt             *time.Time              `json:"lastTestedAt,omitempty"`
	CreatedAt                time.Time               `json:"createdAt"`
	RotatedAt                *time.Time              `json:"rotatedAt,omitempty"`
	RevokedAt                *time.Time              `json:"revokedAt,omitempty"`
	UpdatedAt                time.Time               `json:"updatedAt"`
	// NotificationEndpointURL is populated only on create and rotate. It embeds
	// the one-time intake token and is never returned by any read.
	NotificationEndpointURL string `json:"notificationEndpointUrl,omitempty"`
}

// CredentialApplication binds one Application to a credential and records the
// store-side identifier (`bundleId` for Apple, `packageName` for Google) the
// verified payload must match.
type CredentialApplication struct {
	ApplicationID                 string `json:"applicationId"`
	Platform                      string `json:"platform"`
	ProviderApplicationIdentifier string `json:"providerApplicationIdentifier"`
}

// CredentialSecret is the decrypted material, used only inside the worker.
type CredentialSecret struct {
	Credential StoreServerCredential
	// Plaintext is the .p8 PEM for Apple or the service-account JSON for Google.
	Plaintext []byte
	// OrganizationID is required to rebuild the encryption scope.
	OrganizationID  string
	EnvironmentMode string
}

// RawInput is a persisted Raw Billing Input.
type RawInput struct {
	ID                         string
	ProjectID                  string
	OrganizationID             string
	EnvironmentID              string
	EnvironmentMode            string
	ApplicationID              string
	CredentialID               string
	Provider                   string
	Source                     string
	SourceAuthority            string
	ProviderEventID            string
	IdempotencyKey             []byte
	ContentDigest              []byte
	TransactionReferenceDigest []byte
	BodyState                  string
	Envelope                   *Envelope
	AuthenticationResult       string
	StoreEnvironment           string
	NotificationKind           string
	NotificationSubtype        string
	IngestionStatus            string
	CorrelationID              string
	ProviderOccurredAt         *time.Time
	ReceivedAt                 time.Time
	ExpiresAt                  time.Time
}

// ValidationAttempt is one append-only record of one validation try.
type ValidationAttempt struct {
	ID                 string    `json:"id"`
	ProjectID          string    `json:"projectId"`
	EnvironmentID      string    `json:"environmentId"`
	RawInputID         string    `json:"rawInputId"`
	CredentialID       string    `json:"credentialId,omitempty"`
	AttemptNumber      int       `json:"attemptNumber"`
	ValidatorVersion   int       `json:"validatorVersion"`
	StartedAt          time.Time `json:"startedAt"`
	CompletedAt        time.Time `json:"completedAt"`
	Outcome            string    `json:"outcome"`
	Retryable          bool      `json:"retryable"`
	FailureCategory    string    `json:"failureCategory,omitempty"`
	DiagnosticCode     string    `json:"diagnosticCode,omitempty"`
	ProviderCode       string    `json:"providerCode,omitempty"`
	ProviderHTTPStatus int       `json:"providerHttpStatus,omitempty"`
	StoreEnvironment   string    `json:"storeEnvironment"`
	LatencyMs          int       `json:"latencyMs"`
	ReplayOfAttemptID  string    `json:"replayOfAttemptId,omitempty"`
	CorrelationID      string    `json:"correlationId"`
}

// TransactionFact is the normalized, provider-independent statement.
type TransactionFact struct {
	ID                            string     `json:"id"`
	ProjectID                     string     `json:"projectId"`
	EnvironmentID                 string     `json:"environmentId"`
	EnvironmentMode               string     `json:"-"`
	ApplicationID                 string     `json:"applicationId"`
	Provider                      string     `json:"provider"`
	StoreEnvironment              string     `json:"storeEnvironment"`
	ProviderTransactionID         string     `json:"providerTransactionId"`
	ProviderOriginalTransactionID string     `json:"providerOriginalTransactionId,omitempty"`
	PurchaseChainDigest           []byte     `json:"-"`
	SupersedesChainDigest         []byte     `json:"-"`
	TransactionType               string     `json:"transactionType"`
	FactKind                      string     `json:"factKind"`
	OccurredAt                    time.Time  `json:"occurredAt"`
	PeriodStartAt                 *time.Time `json:"periodStartAt,omitempty"`
	PeriodEndAt                   *time.Time `json:"periodEndAt,omitempty"`
	RevokedAt                     *time.Time `json:"revokedAt,omitempty"`
	RefundedAt                    *time.Time `json:"refundedAt,omitempty"`
	RenewalExpected               *bool      `json:"renewalExpected,omitempty"`
	IsTestTransaction             bool       `json:"isTestTransaction"`
	ProviderProductIdentifier     string     `json:"providerProductIdentifier"`
	ProviderBasePlanIdentifier    string     `json:"providerBasePlanIdentifier,omitempty"`
	ProviderOfferIdentifier       string     `json:"providerOfferIdentifier,omitempty"`
	ResolutionState               string     `json:"resolutionState"`
	MosaicProductID               string     `json:"mosaicProductId,omitempty"`
	ProviderProductMappingID      string     `json:"providerProductMappingId,omitempty"`
	ResolvedMappingVersion        *int64     `json:"resolvedMappingVersion,omitempty"`
	ValidatorVersion              int        `json:"validatorVersion"`
	FactVersion                   int        `json:"factVersion"`
	SourceRawInputID              string     `json:"sourceRawInputId"`
	ValidationAttemptID           string     `json:"validationAttemptId"`
	FactDigest                    []byte     `json:"-"`
	RecordedAt                    time.Time  `json:"recordedAt"`
}

// QuarantineRecord is one input that cannot safely proceed.
type QuarantineRecord struct {
	ID            string `json:"id"`
	ProjectID     string `json:"projectId"`
	EnvironmentID string `json:"environmentId"`
	RawInputID    string `json:"rawInputId"`
	ApplicationID string `json:"applicationId,omitempty"`
	Provider      string `json:"provider"`
	// StoreEnvironment is carried from the quarantined input so the operator
	// surface can keep sandbox and production apart. It is never empty: an
	// input whose environment was not classified before it quarantined reports
	// "unclassified" explicitly rather than an absent field, because a missing
	// value on this surface reads as production to a careless eye.
	StoreEnvironment     string     `json:"storeEnvironment"`
	ReasonCode           string     `json:"reasonCode"`
	Severity             string     `json:"severity"`
	Scopes               []string   `json:"scopes"`
	Status               string     `json:"status"`
	AttemptCount         int        `json:"attemptCount"`
	FirstSeenAt          time.Time  `json:"firstSeenAt"`
	LastAttemptAt        time.Time  `json:"lastAttemptAt"`
	ClosingAttemptID     string     `json:"closingAttemptId,omitempty"`
	SupersededByRecordID string     `json:"supersededByRecordId,omitempty"`
	ClosedAt             *time.Time `json:"closedAt,omitempty"`
	DiagnosticCode       string     `json:"diagnosticCode,omitempty"`
}

// ReconciliationRun is one bounded, restart-safe reconciliation pass.
type ReconciliationRun struct {
	ID            string    `json:"id"`
	ProjectID     string    `json:"projectId"`
	EnvironmentID string    `json:"environmentId"`
	CredentialID  string    `json:"credentialId"`
	Provider      string    `json:"provider"`
	Trigger       string    `json:"trigger"`
	Strategy      string    `json:"strategy"`
	Status        string    `json:"status"`
	WindowStart   time.Time `json:"windowStart"`
	// CursorToken is the provider pagination position a restarted run resumes
	// from. It is opaque and bounded, and is never a credential.
	CursorToken     string     `json:"-"`
	WindowEnd       time.Time  `json:"windowEnd"`
	ExaminedCount   int64      `json:"examinedCount"`
	DiscoveredCount int64      `json:"discoveredCount"`
	DuplicateCount  int64      `json:"duplicateCount"`
	FailureCount    int64      `json:"failureCount"`
	LastErrorCode   string     `json:"lastErrorCode,omitempty"`
	CreatedAt       time.Time  `json:"createdAt"`
	StartedAt       *time.Time `json:"startedAt,omitempty"`
	CompletedAt     *time.Time `json:"completedAt,omitempty"`
}

// ReplayJob is one replay or revalidation.
type ReplayJob struct {
	ID               string     `json:"id"`
	ProjectID        string     `json:"projectId"`
	EnvironmentID    string     `json:"environmentId"`
	Kind             string     `json:"kind"`
	RawInputID       string     `json:"rawInputId,omitempty"`
	WindowStart      *time.Time `json:"windowStart,omitempty"`
	WindowEnd        *time.Time `json:"windowEnd,omitempty"`
	ValidatorVersion int        `json:"validatorVersion"`
	Status           string     `json:"status"`
	ComparisonResult string     `json:"comparisonResult,omitempty"`
	ExaminedCount    int64      `json:"examinedCount"`
	UnchangedCount   int64      `json:"unchangedCount"`
	NewFactCount     int64      `json:"newFactCount"`
	ConflictCount    int64      `json:"conflictCount"`
	LastErrorCode    string     `json:"lastErrorCode,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
	CompletedAt      *time.Time `json:"completedAt,omitempty"`
}

// LedgerEntry is one append-only operational event.
type LedgerEntry struct {
	ID                  string            `json:"id"`
	ProjectID           string            `json:"projectId"`
	EnvironmentID       string            `json:"environmentId"`
	EntryType           string            `json:"entryType"`
	RawInputID          string            `json:"rawInputId,omitempty"`
	ValidationAttemptID string            `json:"validationAttemptId,omitempty"`
	TransactionFactID   string            `json:"transactionFactId,omitempty"`
	CredentialID        string            `json:"credentialId,omitempty"`
	Detail              map[string]string `json:"detail,omitempty"`
	CorrelationID       string            `json:"correlationId"`
	OccurredAt          time.Time         `json:"occurredAt"`
}

// ObservationScope is the tenant an observation authenticated into.
type ObservationScope struct {
	APIKeyID        string
	OrganizationID  string
	ProjectID       string
	EnvironmentID   string
	EnvironmentMode string
	ApplicationID   string
	Platform        string
}

// Observation is a validated client or trusted-server submission.
type Observation struct {
	SubmissionID string
	// ReferenceKind discriminates how Reference must be interpreted.
	ReferenceKind string
	Reference     string
	// OrderReference is Google's optional order id. It is never a deduplication
	// key: promotional purchases have no order id, so using it would silently
	// drop them.
	OrderReference string
	// PurchaseToken is populated only by the trusted server endpoint. It is
	// encrypted on receipt and never logged.
	PurchaseToken    string
	StoreEnvironment string
	ObservedAt       time.Time
}

// SubmissionResult is the observation submission payload.
//
// It is the contract's `observationSubmissionResult` record verbatim, so every
// SDK decodes one platform-neutral shape. The schema declares
// additionalProperties:false, which is why nothing Mosaic-internal (a request
// id, a raw input id, a queue position) may be added here.
type SubmissionResult struct {
	SubmissionID string `json:"submissionId"`
	// ReceivedAt is when Mosaic durably recorded the submission, in the
	// contract's UTC timestamp form.
	ReceivedAt string `json:"receivedAt"`
	Status     string `json:"status"`
	// Code is required for permanently_rejected and retryable_failure and
	// forbidden for the other two statuses.
	Code string `json:"code,omitempty"`
	// RetryAfterSeconds appears only on retryable_failure.
	RetryAfterSeconds int `json:"retryAfterSeconds,omitempty"`
	// EstimatedValidationDelaySeconds appears only on accepted_for_validation.
	// It is advisory: it says when validation is likely to run, never that it
	// succeeded.
	EstimatedValidationDelaySeconds int `json:"estimatedValidationDelaySeconds,omitempty"`
}

// SubmissionEnvelope wraps a submission result in the contract record envelope.
type SubmissionEnvelope struct {
	BillingIngestionContractVersion string           `json:"billingIngestionContractVersion"`
	RecordType                      string           `json:"recordType"`
	Payload                         SubmissionResult `json:"payload"`
}

// Envelope renders the result as the contract record readers expect.
func (result SubmissionResult) Envelope() SubmissionEnvelope {
	return SubmissionEnvelope{
		BillingIngestionContractVersion: BillingContractVersion,
		RecordType:                      SubmissionRecordType,
		Payload:                         result,
	}
}

// ContractTimestamp renders an instant in the contract's UTC timestamp form:
// RFC 3339 with millisecond precision and a literal Z, which is what the
// schema pattern accepts.
func ContractTimestamp(value time.Time) string {
	return value.UTC().Format("2006-01-02T15:04:05.000Z")
}

// ValidationJob is one leased unit of validation work.
type ValidationJob struct {
	ID            string
	ProjectID     string
	EnvironmentID string
	RawInputID    string
	Provider      string
	AttemptCount  int
	MaxAttempts   int
}

// MappingCandidate is one Product mapping row considered during resolution.
type MappingCandidate struct {
	ID                         string
	ProjectID                  string
	MosaicProductID            string
	MosaicProductType          string
	Status                     string
	ArchivedAt                 *time.Time
	ReplacesMappingID          string
	ProviderBasePlanIdentifier string
	ProviderOfferIdentifier    string
	Version                    int64
}
