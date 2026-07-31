package billingmigration

import (
	"encoding/hex"
	"strings"
	"time"
)

const digestPrefix = "sha256:"

func FormatDigest(value []byte) string { return digestPrefix + hex.EncodeToString(value) }

func ParseDigest(value string) ([]byte, error) {
	if len(value) != len(digestPrefix)+64 || !strings.HasPrefix(value, digestPrefix) {
		return nil, ErrInvalid
	}
	raw, err := hex.DecodeString(strings.TrimPrefix(value, digestPrefix))
	if err != nil || FormatDigest(raw) != value {
		return nil, ErrInvalid
	}
	return raw, nil
}

func validSourceIdentifier(value string) bool {
	if len(value) == 0 || len(value) > 512 {
		return false
	}
	for _, character := range value {
		if character <= 0x1f || character == 0x7f {
			return false
		}
	}
	return true
}

type CreateMappingSetInput struct {
	ProjectID, ProgramID string
	ExpectedStateVersion int64
	Version              int
	Entries              []MappingEntry
}

type CreateImportBatchInput struct {
	ProjectID, ProgramID, ManifestID, MappingSetID, IdempotencyKey, CursorBefore string
	ExpectedStateVersion                                                         int64
	RecordCount                                                                  int
}

type QueueRunInput struct {
	ProjectID, ProgramID, RunKind, IdempotencyKey string
	ExpectedStateVersion                          int64
	ManifestDigest, MappingDigest                 string
}

type Counts struct {
	Critical      int64 `json:"critical"`
	Blocking      int64 `json:"blocking"`
	Warning       int64 `json:"warning"`
	Informational int64 `json:"informational"`
}

type SourceManifest struct {
	ProgramID                string    `json:"programId"`
	StateVersion             int64     `json:"stateVersion"`
	ManifestID               string    `json:"manifestId"`
	AdapterVersion           string    `json:"adapterVersion"`
	ProviderAPIVersion       string    `json:"providerApiVersion"`
	SchemaVersion            string    `json:"schemaVersion"`
	RecordCount              int64     `json:"recordCount"`
	CurrentAccessRecordCount int64     `json:"currentAccessRecordCount"`
	ObjectChecksum           string    `json:"objectChecksum"`
	ManifestDigest           string    `json:"manifestDigest"`
	CapturedAt               time.Time `json:"capturedAt"`
}

type MappingEntry struct {
	SourceKind       string `json:"sourceKind"`
	SourceIdentifier string `json:"sourceIdentifier"`
	TargetID         string `json:"targetId"`
	MatchKind        string `json:"matchKind"`
}

type MappingSet struct {
	ProgramID     string         `json:"programId"`
	StateVersion  int64          `json:"stateVersion"`
	MappingSetID  string         `json:"mappingSetId"`
	Version       int            `json:"version"`
	Status        string         `json:"status"`
	Entries       []MappingEntry `json:"entries"`
	MappingDigest string         `json:"mappingDigest"`
}

type ImportBatch struct {
	ProgramID        string `json:"programId"`
	StateVersion     int64  `json:"stateVersion"`
	BatchID          string `json:"batchId"`
	IdempotencyKey   string `json:"idempotencyKey"`
	Status           string `json:"status"`
	RecordCount      int    `json:"recordCount"`
	ValidatedCount   int    `json:"validatedCount"`
	QuarantinedCount int    `json:"quarantinedCount"`
	LeaseGeneration  int64  `json:"-"`
}

type RunJob struct {
	ProgramID    string `json:"programId"`
	StateVersion int64  `json:"stateVersion"`
	RunJobID     string `json:"runJobId"`
	RunKind      string `json:"runKind"`
	Status       string `json:"status"`
	ResultRunID  string `json:"resultRunId,omitempty"`
}

type MigrationRun struct {
	ProgramID      string    `json:"programId"`
	StateVersion   int64     `json:"stateVersion"`
	RunID          string    `json:"runId"`
	RunKind        string    `json:"runKind"`
	ManifestDigest string    `json:"manifestDigest"`
	MappingDigest  string    `json:"mappingDigest"`
	PolicyDigest   string    `json:"policyDigest"`
	Divergences    Counts    `json:"divergences"`
	CompletedAt    time.Time `json:"completedAt"`
}

type Divergence struct {
	ProgramID                 string    `json:"programId"`
	StateVersion              int64     `json:"stateVersion"`
	DivergenceID              string    `json:"divergenceId"`
	Classification            string    `json:"classification"`
	Reason                    string    `json:"reason"`
	ObservedAt                time.Time `json:"observedAt"`
	ClassificationRuleVersion string    `json:"classificationRuleVersion"`
}

type ReadinessInput struct {
	CurrentAccessMappingPercent     float64
	CurrentAccessEvidencePercent    float64
	Unresolved                      Counts
	FinalDeltaCompleted             bool
	WatermarksFresh                 bool
	SupportedVersionsAuthorityAware bool
}

type ReadinessAssessment struct {
	ProgramID                       string  `json:"programId"`
	StateVersion                    int64   `json:"stateVersion"`
	Ready                           bool    `json:"ready"`
	CurrentAccessMappingPercent     float64 `json:"currentAccessMappingPercent"`
	CurrentAccessEvidencePercent    float64 `json:"currentAccessEvidencePercent"`
	Unresolved                      Counts  `json:"unresolved"`
	FinalDeltaCompleted             bool    `json:"finalDeltaCompleted"`
	WatermarksFresh                 bool    `json:"watermarksFresh"`
	SupportedVersionsAuthorityAware bool    `json:"supportedVersionsAuthorityAware"`
	ReadinessDigest                 string  `json:"readinessDigest"`
}

// AssessReadiness implements OD-9C-5 as a deterministic calculation. Warning
// and informational divergences remain visible but do not silently become
// blockers; their thresholds belong to the separately frozen program policy.
func AssessReadiness(programID string, stateVersion int64, input ReadinessInput) (ReadinessAssessment, error) {
	if programID == "" || stateVersion < 1 || input.CurrentAccessMappingPercent < 0 ||
		input.CurrentAccessMappingPercent > 100 || input.CurrentAccessEvidencePercent < 0 ||
		input.CurrentAccessEvidencePercent > 100 || input.Unresolved.Critical < 0 ||
		input.Unresolved.Blocking < 0 || input.Unresolved.Warning < 0 || input.Unresolved.Informational < 0 {
		return ReadinessAssessment{}, ErrInvalid
	}
	assessment := ReadinessAssessment{
		ProgramID: programID, StateVersion: stateVersion,
		CurrentAccessMappingPercent:  input.CurrentAccessMappingPercent,
		CurrentAccessEvidencePercent: input.CurrentAccessEvidencePercent,
		Unresolved:                   input.Unresolved, FinalDeltaCompleted: input.FinalDeltaCompleted,
		WatermarksFresh:                 input.WatermarksFresh,
		SupportedVersionsAuthorityAware: input.SupportedVersionsAuthorityAware,
	}
	assessment.Ready = assessment.CurrentAccessMappingPercent == 100 &&
		assessment.CurrentAccessEvidencePercent == 100 && assessment.Unresolved.Critical == 0 &&
		assessment.Unresolved.Blocking == 0 && assessment.FinalDeltaCompleted &&
		assessment.WatermarksFresh && assessment.SupportedVersionsAuthorityAware
	assessment.ReadinessDigest = FormatDigest(digest(struct {
		ProgramID    string
		StateVersion int64
		Input        ReadinessInput
	}{programID, stateVersion, input}))
	return assessment, nil
}
