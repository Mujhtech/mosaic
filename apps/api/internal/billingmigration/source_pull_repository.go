package billingmigration

import (
	"context"
	"io"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
)

const (
	SourcePullSnapshot   = "snapshot"
	SourcePullDelta      = "delta"
	SourcePullFinalDelta = "final_delta"
)

type SourcePullCommand struct {
	Actor                   Actor
	ProjectID, ProgramID    string
	Intent                  string
	StartingCursor          string
	StartingWatermark       string
	StartingWatermarkDigest []byte
	IdempotencyKey          string
	ExpectedStateVersion    int64
	RequestDigest           []byte
	CreatedAt               time.Time
}

type SourcePullJob struct {
	ID                      string    `json:"sourcePullId"`
	ProjectID               string    `json:"-"`
	ProgramID               string    `json:"programId"`
	Intent                  string    `json:"intent"`
	Status                  string    `json:"status"`
	StartingCursor          string    `json:"startingCursor,omitempty"`
	StartingWatermark       string    `json:"startingWatermark,omitempty"`
	IdempotencyKey          string    `json:"-"`
	ResultSourceObjectID    string    `json:"resultSourceObjectId,omitempty"`
	ResultManifestID        string    `json:"resultManifestId,omitempty"`
	ResultImportBatchID     string    `json:"resultImportBatchId,omitempty"`
	ResultFinalDeltaJobID   string    `json:"resultFinalDeltaJobId,omitempty"`
	PredecessorPullJobID    string    `json:"predecessorPullJobId,omitempty"`
	ResultImportStatus      string    `json:"resultImportStatus,omitempty"`
	FailureCode             string    `json:"failureCode,omitempty"`
	RequestDigest           []byte    `json:"-"`
	EvidenceDigest          []byte    `json:"-"`
	SourceObjectDigest      []byte    `json:"-"`
	ManifestDigest          []byte    `json:"-"`
	ImportDigest            []byte    `json:"-"`
	FinalDeltaDigest        []byte    `json:"-"`
	StartingWatermarkDigest []byte    `json:"-"`
	ExpectedStateVersion    int64     `json:"stateVersion"`
	LeaseGeneration         int64     `json:"-"`
	AttemptCount            int       `json:"attemptCount"`
	MaxAttempts             int       `json:"maxAttempts"`
	CreatedAt               time.Time `json:"createdAt"`
	UpdatedAt               time.Time `json:"updatedAt"`
	StartedAt               time.Time `json:"startedAt,omitempty"`
	CompletedAt             time.Time `json:"completedAt,omitempty"`
	FailedAt                time.Time `json:"failedAt,omitempty"`
}

type SourcePullLease struct {
	SourcePullJob
	Owner, OrganizationID, ExternalProjectID, CredentialID string
	CredentialEnvelope                                     providercredential.Envelope
	EnvironmentID, MappingSetID                            string
	MosaicEnvironmentMode                                  string
	MappingDigest                                          []byte
	ExpiresAt                                              time.Time
}

type SourcePullSettlement struct {
	Lease                                              SourcePullLease
	Status, ErrorCode, ResumeCursor, FinalWatermark    string
	ManifestID, ImportBatchID, SourceObjectID          string
	EvidenceDigest                                     []byte
	RecordCount, CurrentAccessCount, ImportRecordCount int
	RetryAt, SettledAt                                 time.Time
}

type SourcePullRecord struct {
	Kind, SourceIdentifier, SourceRevision, Cursor        string
	Digest                                                []byte
	CurrentAccess                                         bool
	ObservedAt                                            time.Time
	CustomerID, ProductID, ExternalAppID                  string
	Store, Environment, Provider, Platform, ReferenceKind string
	ProviderReference                                     string
	StoreIdentifier                                       string
	EntitlementIDs                                        []string
	Ownership                                             []byte
	QuarantineReason                                      string
}

type SourcePullProviderResult struct {
	Records                         []SourcePullRecord
	ProvenCapabilities              []string
	ResumeCursor, FinalWatermark    string
	RecordCount, CurrentAccessCount int64
	EvidenceDigest                  []byte
}

type SourcePullRepository interface {
	QueueSourcePull(ctx context.Context, command SourcePullCommand) (SourcePullJob, bool, error)
	LeaseSourcePull(ctx context.Context, workerID string, now, leaseUntil time.Time) (SourcePullLease, bool, error)
	BindSourcePullRecords(ctx context.Context, lease SourcePullLease, records []SourcePullRecord) ([]NormalizedSourceRecord, error)
	SettleSourcePull(ctx context.Context, settlement SourcePullSettlement) error
}

type SourcePullProvider interface {
	PullSource(ctx context.Context, externalProjectID string, secret []byte, startingAfter string, output io.Writer) (SourcePullProviderResult, error)
}
