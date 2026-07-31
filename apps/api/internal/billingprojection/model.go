// Package billingprojection owns Mosaic's authoritative subscription and
// entitlement projection. The engines in this package are pure: they take
// ordered validated facts, grant versions, and an evaluation instant, and they
// return snapshot candidates. They perform no I/O, hold no database handle,
// and never mutate a Phase 9A fact — which is what makes "the same ordered
// facts and rule versions produce the same projection" a property of the code
// rather than a convention.
package billingprojection

import "time"

// ActiveRuleVersion is the projection-rule version new projections derive
// under. It is recorded on every snapshot so a later semantic change is a
// version bump with a replay, never a silent reinterpretation of committed
// state.
const ActiveRuleVersion = 1

// RuleVersion is the value persisted on every snapshot, timeline entry, and
// checkpoint. It is the active version by definition: a projection is only ever
// committed under semantics this build derives.
const RuleVersion = ActiveRuleVersion

// implementedRuleVersions lists every rule version whose derivation semantics
// this build can reproduce.
//
// Review finding I-12: `Replay.RuleVersion` was accepted and ignored, so a
// replay under a hypothetical version 2 silently recomputed version 1 and
// reported the resulting checksum as if version 2 had produced it. A checksum
// produced by the wrong engine is indistinguishable from a genuine determinism
// result, which is the one thing a replay exists to prove — so a rule version
// this build does not implement is refused rather than approximated.
//
// OD-11(a) deferred the shadow diff engine until a second rule version exists;
// when one lands, its derivation is added to the engine and listed here, and
// the selection plumbing below already carries it.
var implementedRuleVersions = []int{ActiveRuleVersion}

// ImplementedRuleVersions reports the rule versions this build can replay
// under, in ascending order.
func ImplementedRuleVersions() []int {
	return append([]int(nil), implementedRuleVersions...)
}

// RuleVersionImplemented reports whether this build derives under a rule
// version. Zero means "the active version" and is always implemented.
func RuleVersionImplemented(version int) bool {
	if version == 0 {
		return true
	}
	for _, implemented := range implementedRuleVersions {
		if implemented == version {
			return true
		}
	}
	return false
}

// ResolveRuleVersion maps a requested rule version onto the one derivation will
// actually use. Zero selects the active version.
func ResolveRuleVersion(version int) int {
	if version == 0 {
		return ActiveRuleVersion
	}
	return version
}

// OrderingVersion identifies the canonical ordering tuple (plan §8). It is
// separate from RuleVersion because ordering can change without changing
// derivation, and a checkpoint's high watermark is only comparable within one
// ordering version.
const OrderingVersion = 1

// Access states. `unavailable` is deliberately absent: it is a read-time
// service state (billing disabled, projection unreachable) and is never
// projected or persisted.
const (
	AccessActive   = "active"
	AccessInactive = "inactive"
	AccessUnknown  = "unknown"
)

// Lifecycle states.
const (
	LifecycleTrialing     = "trialing"
	LifecycleActive       = "active"
	LifecycleGracePeriod  = "grace_period"
	LifecycleBillingRetry = "billing_retry"
	LifecyclePaused       = "paused"
	LifecycleExpired      = "expired"
	LifecycleRevoked      = "revoked"
	LifecycleRefunded     = "refunded"
	LifecycleSuperseded   = "superseded"
	LifecycleUnknown      = "unknown"
)

// Renewal intent.
const (
	RenewalEnabled         = "auto_renew_enabled"
	RenewalDisabled        = "auto_renew_disabled"
	RenewalProviderManaged = "provider_managed"
	RenewalPaused          = "paused"
	RenewalUnknown         = "unknown"
)

// Billing states.
const (
	BillingCurrent  = "current"
	BillingRetrying = "retrying"
	BillingGrace    = "grace"
	BillingFailed   = "failed"
	BillingRefunded = "refunded"
	BillingRevoked  = "revoked"
	BillingUnknown  = "unknown"
)

// Uncertainty reasons. Every non-definitive answer names one, so `unknown` is
// always explainable.
const (
	UncertaintyNone                = "none"
	UncertaintyProviderUnavailable = "provider_unavailable"
	UncertaintyMissingFact         = "missing_fact"
	UncertaintyIdentityUnresolved  = "identity_unresolved"
	UncertaintyProductUnresolved   = "product_unresolved"
	UncertaintyConflictingFacts    = "conflicting_facts"
	UncertaintyProjectionFailed    = "projection_failed"
	UncertaintyStaleValidation     = "stale_validation"
	UncertaintyUnsupportedState    = "unsupported_provider_state"
)

// OwnershipFamilyShared is Apple's inAppOwnershipType for a transaction the
// customer received through Family Sharing.
const OwnershipFamilyShared = "FAMILY_SHARED"

// One-time purchase validity states.
const (
	OwnershipOwned    = "owned"
	OwnershipRefunded = "refunded"
	OwnershipRevoked  = "revoked"
	OwnershipUnknown  = "unknown"
)

// Entitlement source types.
const (
	SourceActiveSubscription = "active_subscription"
	SourceTrial              = "trial"
	SourceVerifiedGrace      = "verified_grace_period"
	SourceBillingRetry       = "accepted_billing_retry"
	SourceOneTime            = "one_time_non_consumable"
	SourceFamilyShared       = "family_shared"
)

// Timeline entry types, matching the closed set in migration 00032.
const (
	TimelinePurchaseValidated  = "purchase_validated"
	TimelineTrialStarted       = "trial_started"
	TimelineRenewalValidated   = "renewal_validated"
	TimelineAutoRenewEnabled   = "auto_renew_enabled"
	TimelineAutoRenewDisabled  = "auto_renew_disabled"
	TimelineCancellation       = "cancellation_requested"
	TimelineGraceStarted       = "grace_period_started"
	TimelineGraceEnded         = "grace_period_ended"
	TimelineBillingRetry       = "billing_retry_started"
	TimelineBillingRecovered   = "billing_recovered"
	TimelinePauseStarted       = "pause_started"
	TimelinePauseEnded         = "pause_ended"
	TimelineProductUpgraded    = "product_upgraded"
	TimelineProductDowngraded  = "product_downgraded"
	TimelineExpiration         = "expiration"
	TimelineRefund             = "refund"
	TimelineRevocation         = "revocation"
	TimelineRefundReversed     = "refund_reversed"
	TimelinePurchaseSuperseded = "purchase_superseded"
	TimelineReplayed           = "projection_replayed"
)

// Fact is the projection engine's view of one Phase 9A Transaction Fact. It is
// a copy rather than a reference to the billing package's type so the pure
// core cannot reach the ingestion service, and so the engine's input surface
// is exactly what it reads.
type Fact struct {
	ID                    string
	Provider              string
	ProviderTransactionID string
	FactKind              string
	TransactionType       string

	OccurredAt              time.Time
	ProviderEventOccurredAt *time.Time
	RecordedAt              time.Time
	PeriodStartAt           *time.Time
	PeriodEndAt             *time.Time
	GracePeriodExpiresAt    *time.Time
	RevokedAt               *time.Time
	RefundedAt              *time.Time

	RenewalExpected    *bool
	BillingRetryActive *bool
	IsUpgraded         *bool
	RevocationReason   *int
	RefundType         string

	AutoRenewProductIdentifier  string
	InAppOwnershipType          string
	SubscriptionGroupIdentifier string

	MosaicProductID string
	ResolutionState string
	IsTestSource    bool
}

// SubscriptionSnapshot is the projection engine's output candidate. It carries
// no identifiers the engine cannot compute; the application service assigns
// the snapshot id and projection version at commit time.
type SubscriptionSnapshot struct {
	AccessState       string
	LifecycleState    string
	RenewalIntent     string
	BillingState      string
	UncertaintyReason string

	PeriodStartAt           *time.Time
	PeriodEndAt             *time.Time
	GracePeriodEndAt        *time.Time
	BillingRetryStartAt     *time.Time
	PauseStartAt            *time.Time
	PauseResumeAt           *time.Time
	CancellationEffectiveAt *time.Time
	ExpirationEffectiveAt   *time.Time
	RevocationEffectiveAt   *time.Time
	RefundEffectiveAt       *time.Time

	CurrentProductID            string
	PriorProductID              string
	ScheduledProductIdentifier  string
	SubscriptionGroupIdentifier string
	// OwnershipType is Apple's inAppOwnershipType, carried so a family-shared
	// source can be labelled as such. It is not persisted as a snapshot column
	// — the provider statement lives on the facts — and exists here only to
	// pass the reading to the entitlement layer.
	OwnershipType string
	IsTestSource  bool
	Terminal      bool

	AsOf     time.Time
	Checksum []byte
	// SourceFactIDs are the facts, in canonical order, that produced this
	// snapshot. They are the snapshot's evidence, not a convenience.
	SourceFactIDs []string
}

// TimelineEntry is one immutable explanation emitted alongside a snapshot.
type TimelineEntry struct {
	EntryType       string
	EffectiveAt     time.Time
	ObservedAt      time.Time
	ProductID       string
	PriorProductID  string
	SourceFactIDs   []string
	ExplanationCode string
	Detail          map[string]string
}

// SubscriptionResult is everything one subscription projection produced.
type SubscriptionResult struct {
	Snapshot SubscriptionSnapshot
	Timeline []TimelineEntry
	// HighWatermark is the canonical ordering position of the last fact
	// projected, in the encoding checkpoints store.
	HighWatermark string
	FactsConsumed int
	Warnings      []string
}

// OneTimeSnapshot is the projected state of one non-consumable lineage.
type OneTimeSnapshot struct {
	ValidityState         string
	AcquiredAt            time.Time
	RefundEffectiveAt     *time.Time
	RevocationEffectiveAt *time.Time
	MosaicProductID       string
	UncertaintyReason     string
	IsTestSource          bool
	Checksum              []byte
	SourceFactIDs         []string
}

// OneTimeResult is everything one non-consumable projection produced.
type OneTimeResult struct {
	Snapshot      OneTimeSnapshot
	Timeline      []TimelineEntry
	HighWatermark string
	FactsConsumed int
}
