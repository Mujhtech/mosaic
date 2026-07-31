package billingmigration

import (
	"context"
	"time"
)

type AssessRollbackReadinessInput struct {
	ProjectID, ProgramID, ObservationID, IdempotencyKey string
	ExpectedStateVersion, ExpectedAuthorityEpoch        int64
	ExpectedObservationDigest                           string
}

type RollbackReadinessAssessment struct {
	ID                     string    `json:"assessmentId"`
	ProgramID              string    `json:"programId"`
	ProjectID              string    `json:"-"`
	ObservationID          string    `json:"observationId"`
	LatestDeltaID          string    `json:"latestDeltaId"`
	ReadinessDigest        string    `json:"readinessDigest"`
	StateVersion           int64     `json:"stateVersion"`
	SourceSupportAvailable bool      `json:"sourceSupportAvailable"`
	SourceHealthy          bool      `json:"sourceHealthy"`
	ApplicationCompatible  bool      `json:"applicationCompatible"`
	LimitationsBlocking    bool      `json:"limitationsBlocking"`
	Ready                  bool      `json:"ready"`
	CustomerImpactCount    int64     `json:"customerImpactCount"`
	AssessedAt             time.Time `json:"assessedAt"`
}

type RollbackReadinessCheckpoint struct {
	ID               string    `json:"checkpointId"`
	ProgramID        string    `json:"programId"`
	ProjectID        string    `json:"-"`
	AssessmentID     string    `json:"assessmentId"`
	AuthorityDigest  string    `json:"authorityDigest"`
	PolicyDigest     string    `json:"policyDigest"`
	EvidenceDigest   string    `json:"evidenceDigest"`
	ReadinessDigest  string    `json:"readinessDigest"`
	CheckpointDigest string    `json:"checkpointDigest"`
	StateVersion     int64     `json:"stateVersion"`
	AuthorityEpoch   int64     `json:"authorityEpoch"`
	CreatedAt        time.Time `json:"createdAt"`
}

type RollbackReadinessRepository interface {
	AssessRollbackReadiness(context.Context, AssessRollbackReadinessCommand) (RollbackReadinessAssessment, RollbackReadinessCheckpoint, bool, error)
}
type AssessRollbackReadinessCommand struct {
	Input                                    AssessRollbackReadinessInput
	ActorID                                  string
	RequestDigest, ExpectedObservationDigest []byte
}

type RollbackReadinessService struct {
	auth Repository
	repo RollbackReadinessRepository
}

func NewRollbackReadinessService(auth Repository, repo RollbackReadinessRepository) *RollbackReadinessService {
	return &RollbackReadinessService{auth: auth, repo: repo}
}
func (s *RollbackReadinessService) Assess(ctx context.Context, actor Actor, input AssessRollbackReadinessInput) (RollbackReadinessAssessment, RollbackReadinessCheckpoint, bool, error) {
	if s == nil || s.auth == nil || s.repo == nil || input.ProjectID == "" || input.ProgramID == "" || input.ObservationID == "" || input.IdempotencyKey == "" || input.ExpectedStateVersion < 1 || input.ExpectedAuthorityEpoch < 1 {
		return RollbackReadinessAssessment{}, RollbackReadinessCheckpoint{}, false, ErrInvalid
	}
	observation, err := ParseDigest(input.ExpectedObservationDigest)
	if err != nil {
		return RollbackReadinessAssessment{}, RollbackReadinessCheckpoint{}, false, ErrInvalid
	}
	if _, err := s.auth.Authorize(ctx, actor, input.ProjectID, CapabilityExecuteRollback); err != nil {
		return RollbackReadinessAssessment{}, RollbackReadinessCheckpoint{}, false, err
	}
	cmd := AssessRollbackReadinessCommand{Input: input, ActorID: actor.ID, RequestDigest: digest(input), ExpectedObservationDigest: observation}
	return s.repo.AssessRollbackReadiness(ctx, cmd)
}
