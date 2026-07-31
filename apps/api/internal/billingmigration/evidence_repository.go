package billingmigration

import (
	"context"
	"time"
)

type ManifestWrite struct {
	Manifest        SourceManifest
	ProjectID       string
	ObjectKey       string
	ObjectChecksum  []byte
	ObjectSizeBytes int64
	ManifestDigest  []byte
	SourceWatermark string
}

type MappingSetWrite struct {
	MappingSet    MappingSet
	ProjectID     string
	MappingDigest []byte
	ActorID       string
	CreatedAt     time.Time
}

type ImportBatchWrite struct {
	Batch                               ImportBatch
	ProjectID, ManifestID, MappingSetID string
	RequestDigest                       []byte
	CursorBefore                        string
	CreatedAt                           time.Time
}

type RunWrite struct {
	Run                                                    MigrationRun
	ProjectID                                              string
	ManifestDigest, MappingDigest, PolicyDigest, RunDigest []byte
	SourceWatermark, ProviderWatermark, ShadowWatermark    string
	Divergences                                            []DivergenceWrite
}

type DivergenceWrite struct {
	Divergence     Divergence
	EvidenceDigest []byte
}

type ReadinessWrite struct {
	Assessment      ReadinessAssessment
	ProjectID       string
	ReadinessDigest []byte
	AssessedAt      time.Time
}

type RunJobWrite struct {
	Job                                         RunJob
	ProjectID, IdempotencyKey                   string
	RequestDigest                               []byte
	ManifestDigest, MappingDigest, PolicyDigest []byte
	CreatedAt                                   time.Time
}

type EvidenceRepository interface {
	AppendManifest(ctx context.Context, expectedStateVersion int64, write ManifestWrite) error
	ListManifests(ctx context.Context, projectID, programID string, limit int) ([]SourceManifest, error)
	CreateMappingSet(ctx context.Context, expectedStateVersion int64, write MappingSetWrite) error
	FreezeMappingSet(ctx context.Context, projectID, programID, mappingSetID string, expectedStateVersion int64, at time.Time) error
	ListMappingSets(ctx context.Context, projectID, programID string, limit int) ([]MappingSet, error)
	CreateImportBatch(ctx context.Context, expectedStateVersion int64, write ImportBatchWrite) (bool, error)
	ListImportBatches(ctx context.Context, projectID, programID string, limit int) ([]ImportBatch, error)
	ImportBatch(ctx context.Context, projectID, programID, batchID string) (ImportBatch, error)
	ImportBatchByIdempotency(ctx context.Context, projectID, programID, key string) (ImportBatch, error)
	LeaseImportBatch(ctx context.Context, workerID string, now, leaseUntil time.Time) (ImportBatch, bool, error)
	CompleteImportBatch(ctx context.Context, projectID, programID, batchID, workerID string, leaseGeneration int64, cursorAfter string, validated, quarantined int, now time.Time) error
	QueueRun(ctx context.Context, expectedStateVersion int64, write RunJobWrite) (bool, error)
	RunJob(ctx context.Context, projectID, programID, jobID string) (RunJob, error)
	RunJobByIdempotency(ctx context.Context, projectID, programID, key string) (RunJob, error)
	RecordRun(ctx context.Context, expectedStateVersion int64, write RunWrite) error
	ListDivergences(ctx context.Context, projectID, programID string, limit int) ([]Divergence, error)
	ReadinessInput(ctx context.Context, projectID, programID string) (ReadinessInput, error)
	RecordReadiness(ctx context.Context, expectedStateVersion int64, write ReadinessWrite) error
	LatestReadiness(ctx context.Context, projectID, programID string) (ReadinessAssessment, error)
}
