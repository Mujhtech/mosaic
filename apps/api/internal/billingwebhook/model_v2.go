package billingwebhook

import (
	"context"
	"time"
)

const (
	EventTypeAuthorityCutoverPending         = "authority.cutover.pending"
	EventTypeAuthorityCutoverCompleted       = "authority.cutover.completed"
	EventTypeAuthorityRollbackCompleted      = "authority.rollback.completed"
	EventTypeAuthorityStabilizationCompleted = "authority.stabilization.completed"
)

type AuthorityScope struct {
	ProjectID     string `json:"projectId"`
	EnvironmentID string `json:"environmentId"`
	ApplicationID string `json:"applicationId"`
	Platform      string `json:"platform"`
}

type EventAuthority struct {
	AuthorityEpoch          int64          `json:"authorityEpoch"`
	AuthorityKind           string         `json:"authorityKind"`
	Scope                   AuthorityScope `json:"scope"`
	TransitionState         string         `json:"transitionState"`
	CutoverAt               *time.Time     `json:"-"`
	SnapshotAuthorityDigest string         `json:"snapshotAuthorityDigest"`
}

type ChangedEntitlement struct {
	EntitlementKey string `json:"entitlementKey"`
	PreviousState  string `json:"previousState"`
	CurrentState   string `json:"currentState"`
}

// EventV2 is the strict v2 event payload. Times are rendered through
// CanonicalEventV2 so the wire always uses millisecond UTC precision.
type EventV2 struct {
	EventID                 string
	EventType               string
	BillingCustomerID       string
	Authority               EventAuthority
	SnapshotVersion         int64
	PreviousSnapshotVersion *int64
	OccurredAt              time.Time
	CreatedAt               time.Time
	CorrelationID           string
	ChangedEntitlements     []ChangedEntitlement
}

type StoredEventV2 struct {
	Event              EventV2
	CustomerSnapshotID string
	AuthorityScopeID   string
	TransitionOutboxID string
	Body               []byte
	Digest             []byte
}

type DestinationReadiness struct {
	ActiveDestinationCount int
	HealthyV2Count         int
}

func (r DestinationReadiness) Ready() bool {
	return r.ActiveDestinationCount == 0 || r.HealthyV2Count > 0
}

// DestinationReadinessReader is intentionally separate from the management
// repository. Stage 2E readiness can consume it without widening or wiring the
// shared migration service yet.
type DestinationReadinessReader interface {
	DestinationReadiness(ctx context.Context, projectID, environmentID string, recentAfter time.Time) (DestinationReadiness, error)
}
