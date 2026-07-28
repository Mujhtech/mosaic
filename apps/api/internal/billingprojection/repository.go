package billingprojection

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sort"
	"strconv"
	"time"
)

// Stable domain errors.
var (
	// ErrBillingDisabled maps to `unavailable` on every entitlement surface,
	// never to `inactive`.
	ErrBillingDisabled = errors.New("billing is not enabled for this Project")
	ErrNotFound        = errors.New("projection scope not found")
	ErrUnavailable     = errors.New("projection storage is unavailable")
	// ErrVersionConflict is the compare-and-swap losing. It is not a failure:
	// another worker committed a newer projection for the same scope, so the
	// job retries and reads the newer state.
	ErrVersionConflict = errors.New("projection version changed underneath this transaction")
	// ErrUnsupportedRuleVersion is a request to project under rule semantics
	// this build does not implement (review finding I-12).
	ErrUnsupportedRuleVersion = errors.New("projection rule version is not implemented by this build")
)

// Scope names what one projection command covers.
type Scope struct {
	ProjectID     string
	EnvironmentID string
	// CustomerID is the usual scope: entitlements aggregate per customer, so
	// serializing per customer is what makes the aggregate consistent.
	CustomerID string
	// LineageID is used when facts arrived for a lineage that has no resolved
	// customer yet — there is a subscription to project but no aggregate to
	// recompute.
	LineageID string
}

// Key is the scope key used for advisory locking, job coalescing, and
// idempotency. Customer scope wins when both are present, because a customer
// projection subsumes the lineage projections it reads.
func (s Scope) Key() string {
	if s.CustomerID != "" {
		return "customer:" + s.CustomerID
	}
	return "lineage:" + s.LineageID
}

// LockScope is the advisory-lock name, following the accepted LockScope
// pattern already used by hosted publishing and cloud workspace.
func (s Scope) LockScope() string { return "billing-projection:" + s.Key() }

// Input is everything one projection command needs, loaded inside the
// transaction after the lock is held so it cannot be stale.
type Input struct {
	Scope Scope
	// Lineages are the purchase lineages in scope with their ordered facts.
	Lineages []LineageInput
	// GrantVersions are every grant version for the Products involved. The
	// engine selects the applicable ones by period effective time.
	GrantVersions []GrantVersion
	// PriorCustomerSnapshot is the last committed customer snapshot, used for
	// the change set and the no-change decision.
	PriorCustomerSnapshot *CustomerSnapshot
	// CurrentProjectionVersion is the value the compare-and-swap is against.
	CurrentProjectionVersion int64
	// CurrentSnapshotVersion is the monotonic per-(customer, environment)
	// version the next snapshot increments.
	CurrentSnapshotVersion int64
	// UnresolvedLineages and FrozenLineages carry the identity state that
	// keeps an Entitlement at `unknown` rather than `inactive`.
	UnresolvedLineages int
	FrozenLineages     int
	// RuleVersion selects the projection semantics this command derives under.
	// Zero means the active version, which is what every live trigger uses; a
	// replay is the only caller that sets it (plan §12, review finding I-12).
	RuleVersion int
}

// LineageInput is one lineage and the facts that belong to it.
type LineageInput struct {
	LineageID  string
	InstanceID string
	// SnapshotID is the current committed subscription snapshot, carried so a
	// no-change lineage can still be cited as an entitlement source.
	SnapshotID string
	Type       string
	Facts      []Fact
	// Checkpoint is the last committed high watermark for this lineage.
	Checkpoint string
	// CheckpointChecksum is the checksum recorded with that checkpoint.
	CheckpointChecksum []byte
	// CheckpointFacts is how many facts that checkpoint covered. It is what
	// makes "does the checkpoint still describe a prefix of this timeline?" an
	// answerable question rather than a guess.
	CheckpointFacts int64
	// Frozen lineages are skipped: their last committed state is preserved.
	Frozen bool
	// CustomerResolved is false when no accepted association exists yet.
	CustomerResolved bool
	// SupersededByLineage is the explicit `superseded_by_lineage_id` edge: this
	// lineage was replaced by a *different* lineage. It is deliberately not
	// derived from any fact — a supersession fact inside a Google purchase-token
	// chain is a token handover within one root-keyed lineage, and reading it as
	// a lineage replacement projected every live successor as inactive.
	SupersededByLineage bool
}

// Output is one projection command's complete result. Everything in it is
// written in a single transaction or none of it is.
type Output struct {
	Scope Scope
	// Subscriptions and OneTimes are the per-lineage results whose state
	// actually changed. A lineage whose checksum matched contributes an
	// entitlement source but no new snapshot.
	Subscriptions []SubscriptionCommit
	OneTimes      []OneTimeCommit
	// CustomerSnapshot is nil for a no-change projection.
	CustomerSnapshot *CustomerSnapshot
	SnapshotVersion  int64
	Changes          ChangeSet
	// Event is the planned Billing State Webhook announcement. It is nil for a
	// no-change projection, which is what makes "a no-change replay emits
	// nothing" a property of the plan rather than of the writer.
	Event *Event
	// Checkpoints advance even on a no-change projection: the facts were
	// examined and must not be examined again.
	Checkpoints []CheckpointCommit
	// IdempotencyKey is digest(scope, high watermark, rule version, grant
	// version set), so a repeated execution of the same command is
	// recognisable as such.
	IdempotencyKey []byte
	Outcome        string
}

// SubscriptionCommit is one new subscription snapshot to write.
type SubscriptionCommit struct {
	LineageID         string
	InstanceID        string
	ProjectionVersion int64
	Snapshot          SubscriptionSnapshot
	Timeline          []TimelineEntry
}

// OneTimeCommit is one new one-time purchase state to write.
type OneTimeCommit struct {
	LineageID         string
	InstanceID        string
	ProjectionVersion int64
	Snapshot          OneTimeSnapshot
	Timeline          []TimelineEntry
}

// CheckpointCommit advances one lineage's projection checkpoint.
type CheckpointCommit struct {
	LineageID      string
	InstanceID     string
	Type           string
	HighWatermark  string
	FactsProjected int64
	Checksum       []byte
	Invalidated    bool
}

// Projection outcomes recorded on every attempt.
const (
	OutcomeProjected  = "projected"
	OutcomeNoChange   = "no_change"
	OutcomeUnresolved = "unresolved"
	OutcomeFrozen     = "frozen"
	OutcomeFailed     = "failed"
)

// Repository is the persistence port. The commit method takes the whole
// Output because the consistency model requires one atomic write: a consumer
// must never see a new subscription state without its matching entitlement
// state, or a pointer to an incomplete snapshot.
type Repository interface {
	BillingEnabled(ctx context.Context, projectID string) (bool, error)

	// LoadInput acquires the scope's advisory lock and reads everything the
	// command needs inside one transaction, so the projection sees a
	// consistent view and no concurrent projection for the same scope can
	// interleave.
	LoadInput(ctx context.Context, scope Scope) (Input, error)

	// Commit writes snapshots, timeline entries, entitlement sources, the
	// customer snapshot, both current pointers, checkpoints, webhook events,
	// and the audit event in one transaction, guarded by a compare-and-swap on
	// the customer's current_projection_version. It returns ErrVersionConflict
	// when the CAS loses.
	Commit(ctx context.Context, input Input, output Output, now time.Time) error

	// RecordAttempt records the outcome of one execution, including no-change
	// and failed runs, outside the projection transaction so a rolled-back
	// projection still leaves an observable trace.
	RecordAttempt(ctx context.Context, scope Scope, jobID string, output Output, errorCode string, started, completed time.Time) error

	// Enqueue coalesces a projection trigger onto the scope key. A scope that
	// already has queued or leased work absorbs the trigger rather than
	// creating a second job.
	Enqueue(ctx context.Context, scope Scope, kind string, now time.Time) error
	LeaseJob(ctx context.Context, workerID string, now, leaseUntil time.Time) (Job, bool, error)
	CompleteJob(ctx context.Context, job Job, status, errorCode string, availableAt time.Time, now time.Time) error
}

// Job is one leased unit of projection work.
type Job struct {
	ID            string
	ProjectID     string
	EnvironmentID string
	ScopeKey      string
	Kind          string
	CustomerID    string
	LineageID     string
	AttemptCount  int
	MaxAttempts   int
}

// Scope reconstructs the projection scope a job names.
func (j Job) Scope() Scope {
	return Scope{
		ProjectID: j.ProjectID, EnvironmentID: j.EnvironmentID,
		CustomerID: j.CustomerID, LineageID: j.LineageID,
	}
}

// Job kinds. Each is a documented trigger from plan §12.
const (
	KindFactCommitted           = "fact_committed"
	KindAssociationEstablished  = "association_established"
	KindQuarantineRepair        = "quarantine_repair"
	KindGrantVersionPublished   = "grant_version_published"
	KindRulePromotion           = "rule_promotion"
	KindReconciliationDiscovery = "reconciliation_discovery"
	KindReplay                  = "replay"
	KindManualSync              = "manual_sync"
)

// IdempotencyKey is digest(scope, high-watermark position, rule version,
// grant version set) — plan §9.
//
// It answers "have I already done exactly this work?" without comparing
// output, which matters because the answer must be available before the work
// is done. The grant version set participates because the same facts under a
// different grant version are a genuinely different projection.
func IdempotencyKey(scope Scope, watermarks []string, grantVersionIDs []string) []byte {
	hasher := sha256.New()
	hasher.Write([]byte("mosaic-projection-command-v1"))
	write := func(value string) {
		hasher.Write([]byte{0})
		hasher.Write([]byte(value))
	}
	write(scope.Key())
	write(strconv.Itoa(RuleVersion))
	write(strconv.Itoa(OrderingVersion))

	sortedWatermarks := append([]string(nil), watermarks...)
	sort.Strings(sortedWatermarks)
	for _, watermark := range sortedWatermarks {
		write(watermark)
	}
	sortedGrants := append([]string(nil), grantVersionIDs...)
	sort.Strings(sortedGrants)
	for _, grantVersionID := range sortedGrants {
		write(grantVersionID)
	}
	return hasher.Sum(nil)
}

// HexKey renders an idempotency key for diagnostics. It is safe to log: it is
// derived from identifiers and versions, never from a customer value.
func HexKey(key []byte) string { return hex.EncodeToString(key) }
