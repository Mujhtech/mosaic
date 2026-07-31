package billingmigration

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

type operationsAuth struct{ err error }

func (a operationsAuth) Authorize(context.Context, Actor, string, string) (Authorization, error) {
	return Authorization{Role: "owner"}, a.err
}
func (operationsAuth) Idempotency(context.Context, string, string) (StoredIdempotency, error) {
	return StoredIdempotency{}, ErrNotFound
}
func (operationsAuth) CreateProgram(context.Context, CreateProgramCommand) (ProgramDetail, error) {
	return ProgramDetail{}, ErrUnavailable
}
func (operationsAuth) ListPrograms(context.Context, string, int) ([]ProgramDetail, error) {
	return nil, ErrUnavailable
}
func (operationsAuth) Program(context.Context, string, string) (ProgramDetail, error) {
	return ProgramDetail{}, ErrUnavailable
}

type operationsRepoStub struct {
	prepared   PreparedRepair
	settlement RepairSettlement
	settled    bool
	finish     RetentionFinish
	lease      RetentionLease
	proposal   LegalHoldProposalWrite
}

func (*operationsRepoStub) CreateCase(context.Context, CaseWrite) (MigrationCase, bool, error) {
	return MigrationCase{}, false, ErrUnavailable
}
func (*operationsRepoStub) TransitionCase(context.Context, CaseTransitionWrite) (MigrationCase, error) {
	return MigrationCase{}, ErrUnavailable
}
func (*operationsRepoStub) CreateRepairPreview(context.Context, RepairPreviewWrite) (RepairPreview, bool, error) {
	return RepairPreview{}, false, ErrUnavailable
}
func (r *operationsRepoStub) PrepareRepair(context.Context, RepairExecutionWrite) (PreparedRepair, error) {
	return r.prepared, nil
}
func (r *operationsRepoStub) SettleRepair(_ context.Context, s RepairSettlement) (RepairExecution, error) {
	r.settlement = s
	r.settled = true
	return RepairExecution{ExecutionID: s.ExecutionID, Result: s.Result}, nil
}
func (*operationsRepoStub) RemoveCredential(context.Context, CredentialRemovalWrite) (CredentialRemoval, bool, error) {
	return CredentialRemoval{}, false, ErrUnavailable
}
func (r *operationsRepoStub) ProposeLegalHold(_ context.Context, w LegalHoldProposalWrite) (LegalHoldProposal, bool, error) {
	r.proposal = w
	return w.Proposal, false, nil
}
func (*operationsRepoStub) ApproveLegalHold(context.Context, LegalHoldApprovalWrite) (LegalHold, bool, error) {
	return LegalHold{}, false, ErrUnavailable
}
func (*operationsRepoStub) CompletionPrerequisites(context.Context, string, string, time.Time) (CompletionPrerequisites, error) {
	return CompletionPrerequisites{}, ErrUnavailable
}
func (*operationsRepoStub) CompleteMigration(context.Context, CompletionWrite) (CompletionReport, bool, error) {
	return CompletionReport{}, false, ErrUnavailable
}
func (r *operationsRepoStub) ClaimRetention(context.Context, RetentionClaim) (RetentionLease, error) {
	return r.lease, nil
}
func (*operationsRepoStub) SettleRetentionObject(context.Context, RetentionObjectSettlement) error {
	return nil
}
func (r *operationsRepoStub) FinishRetention(_ context.Context, f RetentionFinish) error {
	r.finish = f
	return nil
}

type repairExecutorStub struct {
	calls       int
	executionID string
	result      RepairResult
	err         error
}

func (*repairExecutorStub) Preview(context.Context, RepairRequest) (RepairImpact, error) {
	return RepairImpact{}, ErrUnavailable
}
func (e *repairExecutorStub) Execute(_ context.Context, request RepairRequest) (RepairResult, error) {
	e.calls++
	e.executionID = request.ExecutionID
	if e.result.BeforeDigest != nil || e.result.AfterDigest != nil || e.err != nil {
		return e.result, e.err
	}
	return RepairResult{BeforeDigest: make([]byte, 32), AfterDigest: bytesFilled(1)}, nil
}
func bytesFilled(v byte) []byte {
	b := make([]byte, 32)
	for i := range b {
		b[i] = v
	}
	return b
}

func TestExecuteRepairRerunsUnsettledReservationWithStableIdentity(t *testing.T) {
	repo := &operationsRepoStub{prepared: PreparedRepair{ExecutionID: "mre_stable", RepairKind: RepairRevalidateProviderReference, CaseID: "case", ScopeReferences: []string{"provider-ref"}, AttemptNumber: 1, PreviewBeforeDigest: make([]byte, 32), State: RepairPreparationUnsettled}}
	executor := &repairExecutorStub{}
	service := NewOperationsService(operationsAuth{}, repo, executor, WithClock(func() time.Time { return time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC) }))
	d := FormatDigest(make([]byte, 32))
	result, replay, err := service.ExecuteRepair(context.Background(), Actor{ID: "owner"}, ExecuteRepairInput{ProjectID: "project", ProgramID: "program", PreviewID: "preview", IdempotencyKey: "execute", ExpectedStateVersion: 1, ExpectedPreviewDigest: d, ExpectedCaseDigest: d, ExpectedPolicyDigest: d, ExpectedScopeDigest: d})
	if err != nil || !replay || executor.calls != 1 || result.ExecutionID != "mre_stable" {
		t.Fatalf("result=%#v replay=%v calls=%d err=%v", result, replay, executor.calls, err)
	}
	if executor.executionID != "mre_stable" {
		t.Fatalf("executor execution ID = %q", executor.executionID)
	}
	if repo.settlement.Result == "" || len(repo.settlement.ActualAfterDigest) != 32 {
		t.Fatalf("empty crash-window settlement: %#v", repo.settlement)
	}
}

func TestExecuteRepairLeavesPendingValidationReservationUnsettled(t *testing.T) {
	repo := &operationsRepoStub{prepared: PreparedRepair{ExecutionID: "mre_pending", RepairKind: RepairRevalidateProviderReference, CaseID: "case", ScopeReferences: []string{"provider-ref"}, AttemptNumber: 1, PreviewBeforeDigest: make([]byte, 32), State: RepairPreparationUnsettled}}
	executor := &repairExecutorStub{result: RepairResult{BeforeDigest: make([]byte, 32), AfterDigest: make([]byte, 32), ErrorCode: "provider_validation_pending"}, err: ErrValidationPending}
	service := NewOperationsService(operationsAuth{}, repo, executor, WithClock(func() time.Time { return time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC) }))
	d := FormatDigest(make([]byte, 32))
	result, replay, err := service.ExecuteRepair(context.Background(), Actor{ID: "owner"}, ExecuteRepairInput{ProjectID: "project", ProgramID: "program", PreviewID: "preview", IdempotencyKey: "execute", ExpectedStateVersion: 1, ExpectedPreviewDigest: d, ExpectedCaseDigest: d, ExpectedPolicyDigest: d, ExpectedScopeDigest: d})
	if err != nil || !replay || result.ExecutionID != "mre_pending" || result.Status != "pending" || result.Result != "" {
		t.Fatalf("result=%#v replay=%v err=%v", result, replay, err)
	}
	if result.AfterDigest != "" || result.ResultDigest != "" {
		t.Fatalf("pending validation claimed terminal digests: %#v", result)
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err = json.Unmarshal(encoded, &fields); err != nil {
		t.Fatal(err)
	}
	if _, exists := fields["afterDigest"]; exists {
		t.Fatalf("pending validation serialized terminal afterDigest: %s", encoded)
	}
	if _, exists := fields["resultDigest"]; exists {
		t.Fatalf("pending validation serialized terminal resultDigest: %s", encoded)
	}
	retried, replay, err := service.ExecuteRepair(context.Background(), Actor{ID: "owner"}, ExecuteRepairInput{ProjectID: "project", ProgramID: "program", PreviewID: "preview", IdempotencyKey: "execute", ExpectedStateVersion: 1, ExpectedPreviewDigest: d, ExpectedCaseDigest: d, ExpectedPolicyDigest: d, ExpectedScopeDigest: d})
	if err != nil || !replay || retried.ExecutionID != result.ExecutionID || retried.Status != "pending" || retried.Result != "" || executor.calls != 2 {
		t.Fatalf("retry result=%#v replay=%v calls=%d err=%v", retried, replay, executor.calls, err)
	}
	if repo.settled {
		t.Fatalf("pending validation settled reservation: %#v", repo.settlement)
	}
}

func TestExecuteRepairReturnsSettledReplayWithoutExecutorCall(t *testing.T) {
	stored := RepairExecution{ExecutionID: "mre_settled", ProgramID: "program", Result: "succeeded", AttemptNumber: 1}
	repo := &operationsRepoStub{prepared: PreparedRepair{ExecutionID: stored.ExecutionID, State: RepairPreparationSettled, SettledExecution: &stored}}
	executor := &repairExecutorStub{}
	service := NewOperationsService(operationsAuth{}, repo, executor)
	d := FormatDigest(make([]byte, 32))
	result, replay, err := service.ExecuteRepair(context.Background(), Actor{ID: "owner"}, ExecuteRepairInput{ProjectID: "project", ProgramID: "program", PreviewID: "preview", IdempotencyKey: "execute", ExpectedStateVersion: 1, ExpectedPreviewDigest: d, ExpectedCaseDigest: d, ExpectedPolicyDigest: d, ExpectedScopeDigest: d})
	if err != nil || !replay || executor.calls != 0 || result.ExecutionID != stored.ExecutionID || result.Status != "completed" {
		t.Fatalf("result=%#v replay=%v calls=%d err=%v", result, replay, executor.calls, err)
	}
}

type retryableDeleter struct{}

func (retryableDeleter) DeleteRawSourceObject(context.Context, string) (string, error) {
	return "retryable_failure", nil
}
func TestRetentionRetriesExplicitRetryableResultWithoutError(t *testing.T) {
	repo := &operationsRepoStub{lease: RetentionLease{JobID: "job", ProgramID: "program", ProjectID: "project", Generation: 2, AttemptNumber: 1, MaxAttempts: 8, ObjectKeys: []string{"private/object"}}}
	service := NewOperationsService(operationsAuth{}, repo, nil, WithClock(func() time.Time { return time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC) }))
	if err := service.RunRetention(context.Background(), "worker", time.Minute, retryableDeleter{}); err != nil {
		t.Fatal(err)
	}
	if repo.finish.ErrorCode != "object_delete_retryable" || repo.finish.RetryAt.IsZero() {
		t.Fatalf("finish=%#v", repo.finish)
	}
}

func TestLegalHoldProposalUsesAuthenticatedActor(t *testing.T) {
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	repo := &operationsRepoStub{}
	service := NewOperationsService(operationsAuth{}, repo, nil, WithClock(func() time.Time { return now }))
	proposal, _, err := service.ProposeLegalHold(context.Background(), Actor{ID: "actual_owner"}, ProposeLegalHoldInput{ProjectID: "project", ProgramID: "program", IdempotencyKey: "hold", Command: "set", Reason: "Regulatory preservation request", ExternalComplianceReference: "LEGAL-1", ExpiresAt: now.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	if proposal.ProposerActorID != "actual_owner" || repo.proposal.Proposal.ProposerActorID != "actual_owner" {
		t.Fatalf("proposal actor=%q write actor=%q", proposal.ProposerActorID, repo.proposal.Proposal.ProposerActorID)
	}
}

func TestOperationsServiceEnforcesCapabilityAuthorization(t *testing.T) {
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	repo := &operationsRepoStub{}
	service := NewOperationsService(operationsAuth{err: ErrForbidden}, repo, nil, WithClock(func() time.Time { return now }))
	_, _, err := service.ProposeLegalHold(context.Background(), Actor{ID: "admin"}, ProposeLegalHoldInput{ProjectID: "project", ProgramID: "program", IdempotencyKey: "hold", Command: "set", Reason: "Regulatory preservation request", ExternalComplianceReference: "LEGAL-1", ExpiresAt: now.Add(time.Hour)})
	if err != ErrForbidden {
		t.Fatalf("authorization error=%v", err)
	}
	if repo.proposal.Proposal.ProposalID != "" {
		t.Fatal("repository called after authorization denial")
	}
}

func TestCompletionSyncFreshnessWindow(t *testing.T) {
	completed := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	if !SyncObservationFresh(completed.Add(-5*time.Minute), completed, 600) {
		t.Fatal("fresh current-epoch observation rejected")
	}
	if SyncObservationFresh(completed.Add(-11*time.Minute), completed, 600) {
		t.Fatal("stale observation accepted")
	}
	if SyncObservationFresh(completed.Add(time.Second), completed, 600) {
		t.Fatal("future observation accepted")
	}
}
