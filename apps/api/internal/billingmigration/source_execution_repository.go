package billingmigration

import (
	"context"
	"time"
)

type ExecutionLease struct {
	JobID, JobKind, ProjectID, ProgramID, Owner                 string
	Generation, ExpectedStateVersion                            int64
	AttemptCount, MaxAttempts                                   int
	ManifestDigest, MappingDigest, PolicyDigest, EvidenceDigest []byte
	ExpiresAt                                                   time.Time
	RecordCount                                                 int
	References                                                  []KnownProviderReference
}

type ExecutionSettlement struct {
	ExecutionLease
	Status, ResultID, CursorAfter, ErrorCode string
	ValidatedCount, QuarantinedCount         int
	ResultDigest                             []byte
	RetryAt, SettledAt                       time.Time
	FinalDelta                               *FinalDeltaResult
	PreparedPointers                         []PreparedPointer
	Run                                      *RunExecutionResult
}

type FinalDeltaResult struct {
	ID                                                                                             string
	StateVersion                                                                                   int64
	ManifestDigest, MappingDigest, EvidenceDigest, FinalWatermarkDigest, DeltaDigest, CohortDigest []byte
	SourceWatermark, ProviderWatermark, ShadowWatermark                                            time.Time
	Cohort                                                                                         []CohortCustomer
}

type CohortCustomer struct {
	BillingCustomerID string
	CustomerDigest    []byte
}

type PreparedPointer struct {
	EnvironmentID, ApplicationID, Platform, BillingCustomerID, SnapshotID string
	PreparedDigest                                                        []byte
}

type RunExecutionResult struct {
	SourceWatermark, ProviderWatermark, ShadowWatermark string
	Divergences                                         []DivergenceWrite
	ShadowSnapshots                                     []ShadowSnapshotWrite
}

type ShadowSnapshotWrite struct {
	ID, EnvironmentID, ApplicationID, Platform, BillingCustomerID, SourceSnapshotID, MosaicSnapshotID string
	ShadowDigest                                                                                      []byte
}

type SourceExecutionRepository interface {
	LeaseImport(ctx context.Context, workerID string, now, leaseUntil time.Time) (ExecutionLease, bool, error)
	SettleImport(ctx context.Context, settlement ExecutionSettlement) error
	DeferImport(ctx context.Context, settlement ExecutionSettlement) error
	LeaseRun(ctx context.Context, workerID string, now, leaseUntil time.Time) (ExecutionLease, bool, error)
	SettleRun(ctx context.Context, settlement ExecutionSettlement) error
	LeaseFinalDelta(ctx context.Context, workerID string, now, leaseUntil time.Time) (ExecutionLease, bool, error)
	SettleFinalDelta(ctx context.Context, settlement ExecutionSettlement) error
}

// ProviderEvidenceImporter is the only source-execution path into Phase 9A.
// It accepts already-known Apple/Google references for ordinary revalidation;
// it intentionally has no method that inserts a Transaction Fact.
type ProviderEvidenceImporter interface {
	RevalidateKnownReferences(ctx context.Context, projectID, programID string, references []KnownProviderReference) (ProviderEvidenceResult, error)
}

type KnownProviderReference struct {
	Provider, EnvironmentID, ApplicationID, Reference, ReferenceKind string
	SourceProductID, TargetProductID, ExpectedStoreProductID         string
	ExpectedStoreEnvironment                                         string
}

type ProviderEvidenceResult struct {
	Accepted, Validated, Quarantined int
	ProviderWatermark                time.Time
	EvidenceDigest                   []byte
}

// PreparedSnapshotBuilder can create immutable candidates and migration-owned
// prepared pointers only. No live-pointer, CAT, or webhook port is present.
type PreparedSnapshotBuilder interface {
	Evaluate(ctx context.Context, lease ExecutionLease) (*RunExecutionResult, []PreparedPointer, []byte, error)
}

type FinalDeltaBuilder interface {
	BuildFinalDelta(ctx context.Context, lease ExecutionLease) (*FinalDeltaResult, []PreparedPointer, []byte, error)
}
