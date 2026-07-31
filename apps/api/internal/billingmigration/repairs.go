package billingmigration

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"io"
	"time"
)

const (
	RepairRevalidateProviderReference = "provider_revalidate"
	RepairReplayFactRange             = "projection_replay"
	RepairAttachProvenAlias           = "attach_proven_alias"
	RepairReplaceMappingSet           = "replace_mapping_set"
	RepairRetryQuarantinedRecord      = "retry_quarantined_record"
)

type OperationsService struct {
	auth    Repository
	repo    OperationsRepository
	repairs RepairExecutor
	now     func() time.Time
	random  io.Reader
}

func NewOperationsService(auth Repository, repo OperationsRepository, repairs RepairExecutor, options ...Option) *OperationsService {
	s := &OperationsService{auth: auth, repo: repo, repairs: repairs, now: func() time.Time { return time.Now().UTC() }, random: rand.Reader}
	base := &Service{}
	for _, o := range options {
		o(base)
	}
	if base.now != nil {
		s.now = base.now
	}
	if base.random != nil {
		s.random = base.random
	}
	return s
}
func (s *OperationsService) newID(prefix string) (string, error) {
	b := make([]byte, 12)
	if _, err := io.ReadFull(s.random, b); err != nil {
		return "", err
	}
	return prefix + "_" + FormatDigest(b)[7:31], nil
}

type RepairPreview struct {
	PreviewID            string    `json:"previewId"`
	CaseID               string    `json:"caseId"`
	ProgramID            string    `json:"programId"`
	ProjectID            string    `json:"-"`
	RepairKind           string    `json:"repairKind"`
	ScopeKind            string    `json:"scopeKind"`
	Reason               string    `json:"reason"`
	ScopeReferences      []string  `json:"scopeReferences"`
	AffectedCount        int       `json:"affectedCount"`
	ExpectedStateVersion int64     `json:"stateVersion"`
	BeforeDigest         string    `json:"beforeDigest"`
	AfterDigest          string    `json:"afterDigest"`
	PreviewDigest        string    `json:"previewDigest"`
	CaseDigest           string    `json:"caseDigest"`
	PolicyDigest         string    `json:"policyDigest"`
	ScopeDigest          string    `json:"scopeDigest"`
	CreatedAt            time.Time `json:"createdAt"`
	ExpiresAt            time.Time `json:"expiresAt"`
}
type PreviewRepairInput struct {
	ProjectID, ProgramID, CaseID, IdempotencyKey, RepairKind, ScopeKind, Reason string
	ScopeReferences                                                             []string
	ExpectedStateVersion                                                        int64
	ExpectedCaseDigest, ExpectedPolicyDigest, ExpectedScopeDigest               string
	ExpiresAt                                                                   time.Time
}
type ExecuteRepairInput struct {
	ProjectID, ProgramID, PreviewID, IdempotencyKey                                      string
	ExpectedStateVersion                                                                 int64
	ExpectedPreviewDigest, ExpectedCaseDigest, ExpectedPolicyDigest, ExpectedScopeDigest string
}
type RepairExecution struct {
	ExecutionID   string    `json:"executionId"`
	PreviewID     string    `json:"previewId"`
	ProgramID     string    `json:"programId"`
	Status        string    `json:"executionStatus"`
	Result        string    `json:"result,omitempty"`
	ErrorCode     string    `json:"errorCode,omitempty"`
	BeforeDigest  string    `json:"beforeDigest"`
	AfterDigest   string    `json:"afterDigest,omitempty"`
	ResultDigest  string    `json:"resultDigest,omitempty"`
	AttemptNumber int       `json:"attemptNumber"`
	ExecutedAt    time.Time `json:"executedAt"`
}
type RepairRequest struct {
	Kind, ProgramID, CaseID, ExecutionID string
	ScopeReferences                      []string
}
type RepairImpact struct {
	AffectedCount             int
	BeforeDigest, AfterDigest []byte
}
type RepairResult struct {
	BeforeDigest, AfterDigest []byte
	ErrorCode                 string
	Invalidations             []RepairInvalidation
}
type RepairExecutor interface {
	Preview(context.Context, RepairRequest) (RepairImpact, error)
	Execute(context.Context, RepairRequest) (RepairResult, error)
}

func (s *OperationsService) PreviewRepair(ctx context.Context, actor Actor, input PreviewRepairInput) (RepairPreview, bool, error) {
	if s.repairs == nil || input.ProjectID == "" || input.ProgramID == "" || input.CaseID == "" || input.IdempotencyKey == "" || len(input.IdempotencyKey) > 128 || input.ExpectedStateVersion < 1 || !validText(input.Reason, 500) || !repairKind(input.RepairKind) || !repairScope(input.RepairKind, input.ScopeKind) || len(input.ScopeReferences) < 1 || len(input.ScopeReferences) > 100 {
		return RepairPreview{}, false, ErrInvalid
	}
	seen := make(map[string]struct{}, len(input.ScopeReferences))
	for _, reference := range input.ScopeReferences {
		if !validText(reference, 512) {
			return RepairPreview{}, false, ErrInvalid
		}
		if _, exists := seen[reference]; exists {
			return RepairPreview{}, false, ErrInvalid
		}
		seen[reference] = struct{}{}
	}
	caseDigest, err := ParseDigest(input.ExpectedCaseDigest)
	if err != nil {
		return RepairPreview{}, false, ErrInvalid
	}
	policy, err := ParseDigest(input.ExpectedPolicyDigest)
	if err != nil {
		return RepairPreview{}, false, ErrInvalid
	}
	scope, err := ParseDigest(input.ExpectedScopeDigest)
	if err != nil {
		return RepairPreview{}, false, ErrInvalid
	}
	if _, err = s.auth.Authorize(ctx, actor, input.ProjectID, CapabilityExecuteRepair); err != nil {
		return RepairPreview{}, false, err
	}
	now := s.now()
	if !input.ExpiresAt.After(now) || input.ExpiresAt.After(now.Add(time.Hour)) {
		return RepairPreview{}, false, ErrInvalid
	}
	impact, err := s.repairs.Preview(ctx, RepairRequest{Kind: input.RepairKind, ProgramID: input.ProgramID, CaseID: input.CaseID, ScopeReferences: append([]string(nil), input.ScopeReferences...)})
	if err != nil {
		return RepairPreview{}, false, err
	}
	if impact.AffectedCount < 0 || impact.AffectedCount > 1000 {
		return RepairPreview{}, false, ErrInvalid
	}
	if len(impact.BeforeDigest) != 32 || len(impact.AfterDigest) != 32 {
		return RepairPreview{}, false, ErrInvalid
	}
	id, err := s.newID("mrp")
	if err != nil {
		return RepairPreview{}, false, ErrUnavailable
	}
	p := RepairPreview{PreviewID: id, CaseID: input.CaseID, ProgramID: input.ProgramID, ProjectID: input.ProjectID, RepairKind: input.RepairKind, ScopeKind: input.ScopeKind, Reason: input.Reason, ScopeReferences: append([]string(nil), input.ScopeReferences...), AffectedCount: impact.AffectedCount, ExpectedStateVersion: input.ExpectedStateVersion, BeforeDigest: FormatDigest(impact.BeforeDigest), AfterDigest: FormatDigest(impact.AfterDigest), CaseDigest: input.ExpectedCaseDigest, PolicyDigest: input.ExpectedPolicyDigest, ScopeDigest: input.ExpectedScopeDigest, CreatedAt: now, ExpiresAt: input.ExpiresAt.UTC()}
	p.PreviewDigest = FormatDigest(digest(p))
	return s.repo.CreateRepairPreview(ctx, RepairPreviewWrite{Preview: p, ActorID: actor.ID, IdempotencyKey: input.IdempotencyKey, RequestDigest: digest(input), CaseDigest: caseDigest, PolicyDigest: policy, ScopeDigest: scope})
}

func (s *OperationsService) ExecuteRepair(ctx context.Context, actor Actor, input ExecuteRepairInput) (RepairExecution, bool, error) {
	if s.repairs == nil || input.ProjectID == "" || input.ProgramID == "" || input.PreviewID == "" || input.IdempotencyKey == "" || input.ExpectedStateVersion < 1 {
		return RepairExecution{}, false, ErrInvalid
	}
	preview, err := ParseDigest(input.ExpectedPreviewDigest)
	if err != nil {
		return RepairExecution{}, false, ErrInvalid
	}
	caseD, err := ParseDigest(input.ExpectedCaseDigest)
	if err != nil {
		return RepairExecution{}, false, ErrInvalid
	}
	policy, err := ParseDigest(input.ExpectedPolicyDigest)
	if err != nil {
		return RepairExecution{}, false, ErrInvalid
	}
	scope, err := ParseDigest(input.ExpectedScopeDigest)
	if err != nil {
		return RepairExecution{}, false, ErrInvalid
	}
	if _, err = s.auth.Authorize(ctx, actor, input.ProjectID, CapabilityExecuteRepair); err != nil {
		return RepairExecution{}, false, err
	}
	now := s.now()
	prepared, err := s.repo.PrepareRepair(ctx, RepairExecutionWrite{ProjectID: input.ProjectID, ProgramID: input.ProgramID, PreviewID: input.PreviewID, ActorID: actor.ID, IdempotencyKey: input.IdempotencyKey, ExpectedStateVersion: input.ExpectedStateVersion, ExpectedPreviewDigest: preview, ExpectedCaseDigest: caseD, ExpectedPolicyDigest: policy, ExpectedScopeDigest: scope, RequestDigest: digest(input), At: now})
	if err != nil {
		return RepairExecution{}, false, err
	}
	if prepared.State == RepairPreparationSettled {
		if prepared.SettledExecution == nil {
			return RepairExecution{}, false, ErrConflict
		}
		prepared.SettledExecution.Status = "completed"
		return *prepared.SettledExecution, true, nil
	}
	if prepared.State != RepairPreparationNew && prepared.State != RepairPreparationUnsettled {
		return RepairExecution{}, false, ErrConflict
	}
	replayed := prepared.State == RepairPreparationUnsettled
	result, runErr := s.repairs.Execute(ctx, RepairRequest{Kind: prepared.RepairKind, ProgramID: input.ProgramID, CaseID: prepared.CaseID, ExecutionID: prepared.ExecutionID, ScopeReferences: prepared.ScopeReferences})
	if len(result.BeforeDigest) != 32 {
		result.BeforeDigest = append([]byte(nil), prepared.PreviewBeforeDigest...)
	}
	if len(result.AfterDigest) != 32 {
		result.AfterDigest = append([]byte(nil), result.BeforeDigest...)
	}
	if errors.Is(runErr, ErrValidationPending) {
		return RepairExecution{
			ExecutionID:   prepared.ExecutionID,
			PreviewID:     input.PreviewID,
			ProgramID:     input.ProgramID,
			Status:        "pending",
			ErrorCode:     result.ErrorCode,
			BeforeDigest:  FormatDigest(result.BeforeDigest),
			AttemptNumber: prepared.AttemptNumber,
			ExecutedAt:    s.now(),
		}, replayed, nil
	}
	status, errorCode := "succeeded", ""
	if runErr != nil {
		status = "failed"
		errorCode = result.ErrorCode
		if errorCode == "" {
			errorCode = "repair_dependency_failed"
		}
	} else if bytes.Equal(result.BeforeDigest, result.AfterDigest) {
		status = "no_change"
	}
	settled, settleErr := s.repo.SettleRepair(ctx, RepairSettlement{ExecutionID: prepared.ExecutionID, ProgramID: input.ProgramID, ProjectID: input.ProjectID, Result: status, ErrorCode: errorCode, AttemptNumber: prepared.AttemptNumber, ActualBeforeDigest: result.BeforeDigest, ActualAfterDigest: result.AfterDigest, ResultDigest: digest(result), Invalidations: result.Invalidations, At: s.now()})
	if settleErr != nil {
		return RepairExecution{}, false, settleErr
	}
	settled.Status = "completed"
	if runErr != nil {
		return settled, replayed, runErr
	}
	return settled, replayed, nil
}
func repairKind(v string) bool {
	return v == RepairRevalidateProviderReference || v == RepairReplayFactRange || v == RepairAttachProvenAlias || v == RepairReplaceMappingSet || v == RepairRetryQuarantinedRecord
}
func repairScope(k, s string) bool {
	return (k == RepairRevalidateProviderReference && s == "provider_reference") || (k == RepairReplayFactRange && s == "fact_range") || (k == RepairAttachProvenAlias && s == "audited_alias") || (k == RepairReplaceMappingSet && s == "mapping_set") || (k == RepairRetryQuarantinedRecord && s == "source_record")
}
