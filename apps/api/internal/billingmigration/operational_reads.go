package billingmigration

import (
	"context"
	"time"
)

type SourcePullJobPage struct {
	Items      []SourcePullJob `json:"items"`
	NextCursor string          `json:"nextCursor,omitempty"`
}
type ProposalPage struct {
	Items      []CutoverProposal `json:"items"`
	NextCursor string            `json:"nextCursor,omitempty"`
}
type ApprovalPage struct {
	Items      []MigrationApproval `json:"items"`
	NextCursor string              `json:"nextCursor,omitempty"`
}
type CheckpointPage struct {
	Items      []MigrationCheckpoint `json:"items"`
	NextCursor string                `json:"nextCursor,omitempty"`
}
type AuthorityExecutionPage struct {
	Items      []AuthorityExecution `json:"items"`
	NextCursor string               `json:"nextCursor,omitempty"`
}
type CasePage struct {
	Items      []MigrationCase `json:"items"`
	NextCursor string          `json:"nextCursor,omitempty"`
}
type CaseAction struct {
	ID           string    `json:"actionId"`
	CaseID       string    `json:"caseId"`
	ProgramID    string    `json:"programId"`
	ActorID      string    `json:"actorId"`
	Action       string    `json:"action"`
	BeforeDigest string    `json:"beforeDigest"`
	AfterDigest  string    `json:"afterDigest"`
	CreatedAt    time.Time `json:"createdAt"`
}
type CaseActionPage struct {
	Items      []CaseAction `json:"items"`
	NextCursor string       `json:"nextCursor,omitempty"`
}
type RepairPreviewPage struct {
	Items      []RepairPreviewRecord `json:"items"`
	NextCursor string                `json:"nextCursor,omitempty"`
}
type RepairExecutionPage struct {
	Items      []RepairExecutionRecord `json:"items"`
	NextCursor string                  `json:"nextCursor,omitempty"`
}
type RedeliveryPage struct {
	Items      []RedeliveryRecord `json:"items"`
	NextCursor string             `json:"nextCursor,omitempty"`
}
type CredentialRemovalPage struct {
	Items      []CredentialRemovalRecord `json:"items"`
	NextCursor string                    `json:"nextCursor,omitempty"`
}
type LegalHoldProposalPage struct {
	Items      []LegalHoldProposalRecord `json:"items"`
	NextCursor string                    `json:"nextCursor,omitempty"`
}
type LegalHoldPage struct {
	Items      []LegalHoldRecord `json:"items"`
	NextCursor string            `json:"nextCursor,omitempty"`
}
type CompletionReportPage struct {
	Items      []CompletionReportRecord `json:"items"`
	NextCursor string                   `json:"nextCursor,omitempty"`
}
type StabilizationPolicyPage struct {
	Items      []StabilizationPolicyRecord `json:"items"`
	NextCursor string                      `json:"nextCursor,omitempty"`
}
type StabilizationObservationPage struct {
	Items      []StabilizationObservationRecord `json:"items"`
	NextCursor string                           `json:"nextCursor,omitempty"`
}
type RollbackReadinessAssessmentPage struct {
	Items      []RollbackReadinessAssessmentRecord `json:"items"`
	NextCursor string                              `json:"nextCursor,omitempty"`
}
type RollbackReadinessCheckpointPage struct {
	Items      []RollbackReadinessCheckpointRecord `json:"items"`
	NextCursor string                              `json:"nextCursor,omitempty"`
}

type OperationalReadService struct {
	auth Repository
	repo TypedOperationalReadRepository
}

func NewOperationalReadService(auth Repository, repo TypedOperationalReadRepository) *OperationalReadService {
	return &OperationalReadService{auth: auth, repo: repo}
}
func (s *OperationalReadService) typed() (TypedOperationalReadRepository, error) {
	if s == nil || s.repo == nil {
		return nil, ErrUnavailable
	}
	return s.repo, nil
}
func (s *OperationalReadService) view(ctx context.Context, a Actor, p string) error {
	_, e := s.auth.Authorize(ctx, a, p, CapabilityView)
	return e
}
func (s *OperationalReadService) SourcePulls(ctx context.Context, a Actor, p, program, cursor string, limit int) (SourcePullJobPage, error) {
	if e := s.view(ctx, a, p); e != nil {
		return SourcePullJobPage{}, e
	}
	r, e := s.typed()
	if e != nil {
		return SourcePullJobPage{}, e
	}
	return r.ListSourcePullJobs(ctx, p, program, cursor, limit)
}
func (s *OperationalReadService) SourcePull(ctx context.Context, a Actor, p, program, id string) (SourcePullJob, error) {
	if e := s.view(ctx, a, p); e != nil {
		return SourcePullJob{}, e
	}
	r, e := s.typed()
	if e != nil {
		return SourcePullJob{}, e
	}
	return r.SourcePullJob(ctx, p, program, id)
}
func (s *OperationalReadService) Proposals(ctx context.Context, a Actor, p, program, cursor string, limit int) (ProposalPage, error) {
	if e := s.view(ctx, a, p); e != nil {
		return ProposalPage{}, e
	}
	r, e := s.typed()
	if e != nil {
		return ProposalPage{}, e
	}
	return r.ListProposals(ctx, p, program, cursor, limit)
}
func (s *OperationalReadService) Proposal(ctx context.Context, a Actor, p, program, id string) (CutoverProposal, error) {
	if e := s.view(ctx, a, p); e != nil {
		return CutoverProposal{}, e
	}
	r, e := s.typed()
	if e != nil {
		return CutoverProposal{}, e
	}
	return r.ReadProposal(ctx, p, program, id)
}
func (s *OperationalReadService) Approvals(ctx context.Context, a Actor, p, program, cursor string, limit int) (ApprovalPage, error) {
	if e := s.view(ctx, a, p); e != nil {
		return ApprovalPage{}, e
	}
	r, e := s.typed()
	if e != nil {
		return ApprovalPage{}, e
	}
	return r.ListApprovals(ctx, p, program, cursor, limit)
}
func (s *OperationalReadService) Approval(ctx context.Context, a Actor, p, program, id string) (MigrationApproval, error) {
	if e := s.view(ctx, a, p); e != nil {
		return MigrationApproval{}, e
	}
	r, e := s.typed()
	if e != nil {
		return MigrationApproval{}, e
	}
	return r.Approval(ctx, p, program, id)
}
func (s *OperationalReadService) Checkpoints(ctx context.Context, a Actor, p, program, cursor string, limit int) (CheckpointPage, error) {
	if e := s.view(ctx, a, p); e != nil {
		return CheckpointPage{}, e
	}
	r, e := s.typed()
	if e != nil {
		return CheckpointPage{}, e
	}
	return r.ListCheckpoints(ctx, p, program, cursor, limit)
}
func (s *OperationalReadService) Checkpoint(ctx context.Context, a Actor, p, program, id string) (MigrationCheckpoint, error) {
	if e := s.view(ctx, a, p); e != nil {
		return MigrationCheckpoint{}, e
	}
	r, e := s.typed()
	if e != nil {
		return MigrationCheckpoint{}, e
	}
	return r.Checkpoint(ctx, p, program, id)
}
func (s *OperationalReadService) LatestCheckpoint(ctx context.Context, a Actor, p, program string) (MigrationCheckpoint, error) {
	if e := s.view(ctx, a, p); e != nil {
		return MigrationCheckpoint{}, e
	}
	r, e := s.typed()
	if e != nil {
		return MigrationCheckpoint{}, e
	}
	return r.LatestCheckpoint(ctx, p, program)
}
func (s *OperationalReadService) AuthorityExecutions(ctx context.Context, a Actor, p, program, cursor string, limit int) (AuthorityExecutionPage, error) {
	if e := s.view(ctx, a, p); e != nil {
		return AuthorityExecutionPage{}, e
	}
	r, e := s.typed()
	if e != nil {
		return AuthorityExecutionPage{}, e
	}
	return r.ListAuthorityExecutions(ctx, p, program, cursor, limit)
}
func (s *OperationalReadService) AuthorityExecution(ctx context.Context, a Actor, p, program, id string) (AuthorityExecution, error) {
	if e := s.view(ctx, a, p); e != nil {
		return AuthorityExecution{}, e
	}
	r, e := s.typed()
	if e != nil {
		return AuthorityExecution{}, e
	}
	return r.AuthorityExecution(ctx, p, program, id)
}

type TypedOperationalReadRepository interface {
	ListSourcePullJobs(context.Context, string, string, string, int) (SourcePullJobPage, error)
	SourcePullJob(context.Context, string, string, string) (SourcePullJob, error)
	ListProposals(context.Context, string, string, string, int) (ProposalPage, error)
	ReadProposal(context.Context, string, string, string) (CutoverProposal, error)
	ListApprovals(context.Context, string, string, string, int) (ApprovalPage, error)
	Approval(context.Context, string, string, string) (MigrationApproval, error)
	ListCheckpoints(context.Context, string, string, string, int) (CheckpointPage, error)
	Checkpoint(context.Context, string, string, string) (MigrationCheckpoint, error)
	LatestCheckpoint(context.Context, string, string) (MigrationCheckpoint, error)
	ListAuthorityExecutions(context.Context, string, string, string, int) (AuthorityExecutionPage, error)
	AuthorityExecution(context.Context, string, string, string) (AuthorityExecution, error)
	ListCases(context.Context, string, string, string, int) (CasePage, error)
	ReadCase(context.Context, string, string, string) (MigrationCase, error)
	ListCaseActions(context.Context, string, string, string, string, int) (CaseActionPage, error)
	ListRepairPreviews(context.Context, string, string, string, int) (RepairPreviewPage, error)
	ReadRepairPreview(context.Context, string, string, string) (RepairPreviewRecord, error)
	ListRepairExecutions(context.Context, string, string, string, int) (RepairExecutionPage, error)
	ReadRepairExecution(context.Context, string, string, string) (RepairExecutionRecord, error)
	ListRedeliveries(context.Context, string, string, string, int) (RedeliveryPage, error)
	ReadRedelivery(context.Context, string, string, string) (RedeliveryRecord, error)
	ListCredentialRemovals(context.Context, string, string, string, int) (CredentialRemovalPage, error)
	ReadCredentialRemoval(context.Context, string, string, string) (CredentialRemovalRecord, error)
	CurrentCredentialRemoval(context.Context, string, string) (CredentialRemovalRecord, error)
	ListLegalHoldProposals(context.Context, string, string, string, int) (LegalHoldProposalPage, error)
	ReadLegalHoldProposal(context.Context, string, string, string) (LegalHoldProposalRecord, error)
	ListLegalHolds(context.Context, string, string, string, int) (LegalHoldPage, error)
	ReadLegalHold(context.Context, string, string, string) (LegalHoldRecord, error)
	CurrentLegalHold(context.Context, string, string) (LegalHoldRecord, error)
	ListCompletionReports(context.Context, string, string, string, int) (CompletionReportPage, error)
	ReadCompletionReport(context.Context, string, string, string) (CompletionReportRecord, error)
	CurrentStabilizationPolicy(context.Context, string, string) (StabilizationPolicyRecord, error)
	ListStabilizationObservations(context.Context, string, string, string, int) (StabilizationObservationPage, error)
	LatestStabilizationObservation(context.Context, string, string) (StabilizationObservationRecord, error)
	ListRollbackReadinessAssessments(context.Context, string, string, string, int) (RollbackReadinessAssessmentPage, error)
	LatestRollbackReadinessAssessment(context.Context, string, string) (RollbackReadinessAssessmentRecord, error)
	LatestRollbackReadinessCheckpoint(context.Context, string, string) (RollbackReadinessCheckpointRecord, error)
}
