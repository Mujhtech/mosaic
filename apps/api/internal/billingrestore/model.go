// Package billingrestore owns Mosaic's restore and sync chain.
//
// A restore is not one action. The SDK asks the store to restore, submits the
// provider transaction references it got back as observations, those
// observations become Raw Billing Inputs, validation turns them into
// Transaction Facts, identity resolution attaches those facts to a Billing
// Customer, and only then does a projection produce an accepted snapshot that
// reflects them. This package records the whole chain so the outcome reported
// to a caller is derived from where the chain actually got to — never from the
// fact that the native restore returned.
//
// The invariant the package exists to protect: `restored` is admissible only
// together with the accepted snapshot version that demonstrates it. It is
// enforced three times over — in Decide, which is the only producer of a
// Decision carrying evidence; in Decision.Validate, which the service calls
// before any write; and in the schema's CHECK constraint, which is the last
// line rather than the first.
package billingrestore

import "time"

// JobFamily is the worker job-family name for the restore/sync queue.
const JobFamily = "billing_restore_sync"

// ContractVersion is the Authoritative Entitlement Contract version every
// restore record on this surface is written under.
const ContractVersion = "1"

// Mosaic's authoritative restore outcomes. This is the contract's closed
// vocabulary and the schema's CHECK list; nothing else may ever be written.
const (
	OutcomeRestored              = "restored"
	OutcomeNoAdditionalPurchases = "no_additional_purchases"
	OutcomeValidationPending     = "validation_pending"
	OutcomeIdentityUnresolved    = "identity_unresolved"
	OutcomeProductUnresolved     = "product_unresolved"
	OutcomeProviderUnavailable   = "provider_unavailable"
	OutcomeFailed                = "failed"
)

// What the native provider restore itself did. This axis is reported by the
// caller, stored beside the Mosaic outcome, and never merged into it: a
// completed native restore whose facts have not reached a snapshot is not
// restored access, and collapsing the two axes is precisely how a restore flow
// starts lying.
const (
	ProviderOutcomeCompleted        = "completed"
	ProviderOutcomeNoPurchasesFound = "no_purchases_found"
	ProviderOutcomeCancelled        = "cancelled"
	ProviderOutcomeFailed           = "failed"
	ProviderOutcomeUnsupported      = "unsupported"
	ProviderOutcomeNotAttempted     = "not_attempted"
)

// The shared uncertainty vocabulary every Mosaic entitlement surface uses.
const (
	ReasonNone                     = "none"
	ReasonProviderUnavailable      = "provider_unavailable"
	ReasonMissingFact              = "missing_fact"
	ReasonIdentityUnresolved       = "identity_unresolved"
	ReasonProductUnresolved        = "product_unresolved"
	ReasonConflictingFacts         = "conflicting_facts"
	ReasonProjectionFailed         = "projection_failed"
	ReasonStaleValidation          = "stale_validation"
	ReasonUnsupportedProviderState = "unsupported_provider_state"
)

const (
	StoreApple  = "apple_app_store"
	StoreGoogle = "google_play"
)

// Job statuses, matching the schema's CHECK.
const (
	StatusQueued    = "queued"
	StatusLeased    = "leased"
	StatusCompleted = "completed"
	StatusFailed    = "failed"
)

// MaxSubmittedObservations bounds one restore. The contract caps
// observedTransactionCount at 10000; this is the far tighter operational bound
// a real native restore stays under, and it keeps one request from linking an
// unbounded number of raw inputs.
const MaxSubmittedObservations = 200

// Job is one restore/sync job as stored. It is the whole chain record, not a
// queue entry with a payload attached.
type Job struct {
	ID            string
	ProjectID     string
	EnvironmentID string
	// CustomerID is empty until identity resolves. `identity_unresolved` is
	// exactly the outcome in which it stays empty, which is why it is not
	// required.
	CustomerID    string
	StorePlatform string

	Status            string
	Outcome           string
	ProviderOutcome   string
	UncertaintyReason string

	ObservedTransactionCount int
	PendingValidationCount   int
	// BaselineSnapshotVersion is the customer's snapshot version at the moment
	// the restore was requested (or at the moment identity first resolved). A
	// nil baseline makes `restored` inadmissible: without it there is nothing
	// for an observed version to have moved past.
	BaselineSnapshotVersion *int64
	// SnapshotVersion is the accepted snapshot that reflects the restore. It is
	// the evidence for `restored` and is written only with it.
	SnapshotVersion *int64

	CorrelationID string
	AttemptCount  int
	MaxAttempts   int

	RequestedAt time.Time
	UpdatedAt   time.Time
	CompletedAt *time.Time
}

// SubmitRequest is one restore submission. It carries no provider transaction
// reference: the references were already submitted to the observation endpoint,
// and this request names those submissions so the chain is linked to the Raw
// Billing Inputs they produced rather than re-transmitting store credentials
// through a second surface.
type SubmitRequest struct {
	StorePlatform   string
	ProviderOutcome string
	// ObservationSubmissionIDs are the submissionId values the caller used on
	// POST /v1/sdk/billing/observations (or the trusted-server equivalent).
	ObservationSubmissionIDs []string
	// CustomerID is accepted only on the trusted-server surface, where the
	// caller's own backend has already authenticated the user. A client-asserted
	// identifier can never select a Billing Customer here — restore resolves
	// identity through server-validated store lineage.
	CustomerID    string
	CorrelationID string
}

// ChainState is where the chain actually got to, read fresh on every attempt.
// Every field answers one question about one stage; nothing here is inferred
// from a timestamp.
type ChainState struct {
	// CustomerID is the customer the restore's facts resolved to, empty when
	// identity has not resolved.
	CustomerID string
	// IdentityConflict is set when a lineage in this chain is frozen or carries
	// an open identity conflict. Mosaic grants nothing automatically in that
	// case (OD-10).
	IdentityConflict bool
	// LinkedInputCount is how many Raw Billing Inputs the submission linked.
	LinkedInputCount int
	// PendingValidationCount is how many of them have neither produced a fact
	// nor terminally failed.
	PendingValidationCount int
	// ProviderUnavailable is set when a pending input is waiting on a provider
	// failure rather than on Mosaic.
	ProviderUnavailable bool
	// ProductUnresolved is set when an input validated but names a Product
	// Mosaic cannot map. The purchase is real; the entitlement is unknown.
	ProductUnresolved bool
	// PermanentFailure is set when an input exhausted validation or quarantined
	// for a reason no retry can clear.
	PermanentFailure bool
	// FactCount is how many Transaction Facts the linked inputs produced.
	FactCount int
	// ProjectionSettled reports that no projection for this customer is queued
	// or leased, so the current snapshot version is the answer rather than an
	// intermediate one.
	ProjectionSettled bool
	// ProjectionFailed reports a dead-lettered projection for this customer.
	ProjectionFailed bool
	// SnapshotVersion is the customer's current accepted snapshot version, 0
	// when the customer has never been projected in this Environment.
	SnapshotVersion int64
}

// View is a restore as read back by the status endpoint.
type View struct {
	Job Job
	// EvaluatedAt is when the reported uncertainty was last observed. The
	// contract requires a `since` on every non-definite answer.
	EvaluatedAt time.Time
}
