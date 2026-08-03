package billingaccess

import "time"

// This file holds the read model: what the repository returns when it reads a
// committed projection. It is deliberately separate from the wire records in
// wire.go, because a database row and a contract record are two different
// things and letting one be the other is how a schema change becomes a
// breaking API change.

// Projection status states, matching the contract's closed vocabulary.
const (
	ProjectionCurrent  = "current"
	ProjectionPending  = "pending"
	ProjectionStale    = "stale"
	ProjectionDegraded = "degraded"
	ProjectionFailed   = "failed"
)

// StaleAfter is how long a customer's last projection may be older than the
// newest fact awaiting projection before the status is reported `stale` rather
// than `pending`. It is a reporting threshold only: a stale projection still
// serves its last committed snapshot, because the alternative is telling a
// paying customer they have no access while Mosaic catches up.
const StaleAfter = 15 * time.Minute

// ProjectionStatus is the health of the projection behind a served record.
type ProjectionStatus struct {
	State            string
	LastProjectedAt  time.Time
	PendingFactCount int
	DiagnosticCode   string
}

// ProjectionStatusUnavailableCode marks a status Mosaic could not read.
const ProjectionStatusUnavailableCode = "entitlement.projection.status_unavailable"

// ProjectionStatusUnavailable is what to report when the projection's own
// health could not be read.
//
// The read model initializes Projection to `current`, so a status read guarded
// by `err == nil` served the snapshot as healthy whenever the health query
// failed: the one state that asserts "this is up to date" was the state
// reported when Mosaic knew nothing. `degraded` is the honest reading. The
// snapshot is still served — a projection whose health cannot be described is
// not a reason to tell a paying customer they have no access — but it is never
// described as current, and the diagnostic says which of the two happened.
func ProjectionStatusUnavailable(lastProjectedAt time.Time) ProjectionStatus {
	return ProjectionStatus{
		State:           ProjectionDegraded,
		LastProjectedAt: lastProjectedAt,
		DiagnosticCode:  ProjectionStatusUnavailableCode,
	}
}

// SnapshotView is one committed Customer Entitlement Snapshot as read.
type SnapshotView struct {
	SnapshotID              string
	ProjectID               string
	EnvironmentID           string
	CustomerID              string
	SnapshotVersion         int64
	PreviousSnapshotVersion int64
	RuleVersion             int
	ComputedAt              time.Time
	AsOf                    time.Time
	Checksum                []byte
	ChangeReason            string
	Entries                 []SnapshotEntry
	Sources                 []SnapshotSource
	Projection              ProjectionStatus
}

// SnapshotEntry is one Entitlement's committed state.
type SnapshotEntry struct {
	EntitlementID     string
	EntitlementKey    string
	State             string
	EffectiveStart    *time.Time
	EffectiveEnd      *time.Time
	EndKnown          bool
	SourceCount       int
	UncertaintyReason string
	IsTestSource      bool
	ExplanationCode   string
	// SourceIDs are the contributing sources, resolved against Sources.
	SourceIDs []string
}

// SnapshotSource is one reason the customer holds, or may hold, an Entitlement.
type SnapshotSource struct {
	// RowID is the per-generation row identity. It is not the contract's
	// sourceId, which must be stable across snapshots.
	RowID                     string
	EntitlementID             string
	PurchaseLineageID         string
	ProductID                 string
	GrantVersionID            string
	SubscriptionInstanceID    string
	OneTimePurchaseInstanceID string
	SourceSnapshotID          string
	StorePlatform             string
	SourceType                string
	SourceState               string
	SourceStart               *time.Time
	SourceEnd                 *time.Time
	EndKnown                  bool
	UncertaintyReason         string
	IsTestSource              bool
	ExplanationCode           string
}

// SubscriptionView is one projected Subscription Instance as read.
type SubscriptionView struct {
	SnapshotID              string
	SubscriptionInstanceID  string
	PurchaseLineageID       string
	CustomerID              string
	ProjectID               string
	EnvironmentID           string
	ProjectionVersion       int64
	RuleVersion             int
	ComputedAt              time.Time
	AsOf                    time.Time
	StorePlatform           string
	ProductID               string
	PriorProductID          string
	AccessState             string
	LifecycleState          string
	RenewalIntent           string
	BillingState            string
	UncertaintyReason       string
	PeriodStart             *time.Time
	PeriodEnd               *time.Time
	GracePeriodEnd          *time.Time
	BillingRetryStart       *time.Time
	PauseEffectiveAt        *time.Time
	PauseResumeAt           *time.Time
	CancellationEffectiveAt *time.Time
	ExpirationEffectiveAt   *time.Time
	RevocationEffectiveAt   *time.Time
	RefundEffectiveAt       *time.Time
	SupersededByInstanceID  string
	IsTestSource            bool
	SourceFactCount         int
	Checksum                []byte
	ChangeReason            string
	ExplanationCode         string
}

// TimelineEntry is one append-only explanation of a subscription transition.
type TimelineEntry struct {
	ID                     string
	EntryType              string
	EffectiveAt            time.Time
	ObservedAt             time.Time
	SubscriptionInstanceID string
	OneTimeInstanceID      string
	ProductID              string
	PriorProductID         string
	ExplanationCode        string
	Detail                 map[string]string
}

// CustomerView is a Billing Customer as the trusted-server API reports it. It
// deliberately carries no alias values: aliases are digests, and the digest is
// never a read-side field.
type CustomerView struct {
	ID                       string
	ProjectID                string
	Status                   string
	DiagnosticsStatus        string
	CurrentProjectionVersion int64
	LastProjectedAt          *time.Time
	Identified               bool
	CreatedAt                time.Time
	UpdatedAt                time.Time
}

// CheckRequest is the multi-key access question a trusted server asks.
type CheckRequest struct {
	CustomerID              string
	EntitlementKeys         []string
	ExpectedSnapshotVersion int64
	CorrelationID           string
}
