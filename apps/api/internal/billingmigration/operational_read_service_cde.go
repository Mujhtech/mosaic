package billingmigration

import "context"

func (s *OperationalReadService) Cases(ctx context.Context, actor Actor, projectID, programID, cursor string, limit int) (CasePage, error) {
	if err := s.view(ctx, actor, projectID); err != nil {
		return CasePage{}, err
	}
	return s.repo.ListCases(ctx, projectID, programID, cursor, limit)
}
func (s *OperationalReadService) Case(ctx context.Context, actor Actor, projectID, programID, id string) (MigrationCase, error) {
	if err := s.view(ctx, actor, projectID); err != nil {
		return MigrationCase{}, err
	}
	return s.repo.ReadCase(ctx, projectID, programID, id)
}
func (s *OperationalReadService) CaseActions(ctx context.Context, actor Actor, projectID, programID, caseID, cursor string, limit int) (CaseActionPage, error) {
	if err := s.view(ctx, actor, projectID); err != nil {
		return CaseActionPage{}, err
	}
	return s.repo.ListCaseActions(ctx, projectID, programID, caseID, cursor, limit)
}
func (s *OperationalReadService) RepairPreviews(ctx context.Context, actor Actor, projectID, programID, cursor string, limit int) (RepairPreviewPage, error) {
	if err := s.view(ctx, actor, projectID); err != nil {
		return RepairPreviewPage{}, err
	}
	return s.repo.ListRepairPreviews(ctx, projectID, programID, cursor, limit)
}
func (s *OperationalReadService) RepairPreview(ctx context.Context, actor Actor, projectID, programID, id string) (RepairPreviewRecord, error) {
	if err := s.view(ctx, actor, projectID); err != nil {
		return RepairPreviewRecord{}, err
	}
	return s.repo.ReadRepairPreview(ctx, projectID, programID, id)
}
func (s *OperationalReadService) RepairExecutions(ctx context.Context, actor Actor, projectID, programID, cursor string, limit int) (RepairExecutionPage, error) {
	if err := s.view(ctx, actor, projectID); err != nil {
		return RepairExecutionPage{}, err
	}
	return s.repo.ListRepairExecutions(ctx, projectID, programID, cursor, limit)
}
func (s *OperationalReadService) RepairExecution(ctx context.Context, actor Actor, projectID, programID, id string) (RepairExecutionRecord, error) {
	if err := s.view(ctx, actor, projectID); err != nil {
		return RepairExecutionRecord{}, err
	}
	return s.repo.ReadRepairExecution(ctx, projectID, programID, id)
}
func (s *OperationalReadService) Redeliveries(ctx context.Context, actor Actor, projectID, programID, cursor string, limit int) (RedeliveryPage, error) {
	if err := s.view(ctx, actor, projectID); err != nil {
		return RedeliveryPage{}, err
	}
	return s.repo.ListRedeliveries(ctx, projectID, programID, cursor, limit)
}
func (s *OperationalReadService) Redelivery(ctx context.Context, actor Actor, projectID, programID, id string) (RedeliveryRecord, error) {
	if err := s.view(ctx, actor, projectID); err != nil {
		return RedeliveryRecord{}, err
	}
	return s.repo.ReadRedelivery(ctx, projectID, programID, id)
}
func (s *OperationalReadService) CredentialRemovals(ctx context.Context, actor Actor, projectID, programID, cursor string, limit int) (CredentialRemovalPage, error) {
	if err := s.view(ctx, actor, projectID); err != nil {
		return CredentialRemovalPage{}, err
	}
	return s.repo.ListCredentialRemovals(ctx, projectID, programID, cursor, limit)
}
func (s *OperationalReadService) CredentialRemoval(ctx context.Context, actor Actor, projectID, programID, id string) (CredentialRemovalRecord, error) {
	if err := s.view(ctx, actor, projectID); err != nil {
		return CredentialRemovalRecord{}, err
	}
	return s.repo.ReadCredentialRemoval(ctx, projectID, programID, id)
}
func (s *OperationalReadService) CurrentCredentialRemoval(ctx context.Context, actor Actor, projectID, programID string) (CredentialRemovalRecord, error) {
	if err := s.view(ctx, actor, projectID); err != nil {
		return CredentialRemovalRecord{}, err
	}
	return s.repo.CurrentCredentialRemoval(ctx, projectID, programID)
}
func (s *OperationalReadService) LegalHoldProposals(ctx context.Context, actor Actor, projectID, programID, cursor string, limit int) (LegalHoldProposalPage, error) {
	if err := s.view(ctx, actor, projectID); err != nil {
		return LegalHoldProposalPage{}, err
	}
	return s.repo.ListLegalHoldProposals(ctx, projectID, programID, cursor, limit)
}
func (s *OperationalReadService) LegalHoldProposal(ctx context.Context, actor Actor, projectID, programID, id string) (LegalHoldProposalRecord, error) {
	if err := s.view(ctx, actor, projectID); err != nil {
		return LegalHoldProposalRecord{}, err
	}
	return s.repo.ReadLegalHoldProposal(ctx, projectID, programID, id)
}
func (s *OperationalReadService) LegalHolds(ctx context.Context, actor Actor, projectID, programID, cursor string, limit int) (LegalHoldPage, error) {
	if err := s.view(ctx, actor, projectID); err != nil {
		return LegalHoldPage{}, err
	}
	return s.repo.ListLegalHolds(ctx, projectID, programID, cursor, limit)
}
func (s *OperationalReadService) LegalHold(ctx context.Context, actor Actor, projectID, programID, id string) (LegalHoldRecord, error) {
	if err := s.view(ctx, actor, projectID); err != nil {
		return LegalHoldRecord{}, err
	}
	return s.repo.ReadLegalHold(ctx, projectID, programID, id)
}
func (s *OperationalReadService) CurrentLegalHold(ctx context.Context, actor Actor, projectID, programID string) (LegalHoldRecord, error) {
	if err := s.view(ctx, actor, projectID); err != nil {
		return LegalHoldRecord{}, err
	}
	return s.repo.CurrentLegalHold(ctx, projectID, programID)
}
func (s *OperationalReadService) CompletionReports(ctx context.Context, actor Actor, projectID, programID, cursor string, limit int) (CompletionReportPage, error) {
	if err := s.view(ctx, actor, projectID); err != nil {
		return CompletionReportPage{}, err
	}
	return s.repo.ListCompletionReports(ctx, projectID, programID, cursor, limit)
}
func (s *OperationalReadService) CompletionReport(ctx context.Context, actor Actor, projectID, programID, id string) (CompletionReportRecord, error) {
	if err := s.view(ctx, actor, projectID); err != nil {
		return CompletionReportRecord{}, err
	}
	return s.repo.ReadCompletionReport(ctx, projectID, programID, id)
}
func (s *OperationalReadService) CurrentStabilizationPolicy(ctx context.Context, actor Actor, projectID, programID string) (StabilizationPolicyRecord, error) {
	if err := s.view(ctx, actor, projectID); err != nil {
		return StabilizationPolicyRecord{}, err
	}
	return s.repo.CurrentStabilizationPolicy(ctx, projectID, programID)
}
func (s *OperationalReadService) StabilizationObservations(ctx context.Context, actor Actor, projectID, programID, cursor string, limit int) (StabilizationObservationPage, error) {
	if err := s.view(ctx, actor, projectID); err != nil {
		return StabilizationObservationPage{}, err
	}
	return s.repo.ListStabilizationObservations(ctx, projectID, programID, cursor, limit)
}
func (s *OperationalReadService) LatestStabilizationObservation(ctx context.Context, actor Actor, projectID, programID string) (StabilizationObservationRecord, error) {
	if err := s.view(ctx, actor, projectID); err != nil {
		return StabilizationObservationRecord{}, err
	}
	return s.repo.LatestStabilizationObservation(ctx, projectID, programID)
}
func (s *OperationalReadService) RollbackReadinessAssessments(ctx context.Context, actor Actor, projectID, programID, cursor string, limit int) (RollbackReadinessAssessmentPage, error) {
	if err := s.view(ctx, actor, projectID); err != nil {
		return RollbackReadinessAssessmentPage{}, err
	}
	return s.repo.ListRollbackReadinessAssessments(ctx, projectID, programID, cursor, limit)
}
func (s *OperationalReadService) LatestRollbackReadinessAssessment(ctx context.Context, actor Actor, projectID, programID string) (RollbackReadinessAssessmentRecord, error) {
	if err := s.view(ctx, actor, projectID); err != nil {
		return RollbackReadinessAssessmentRecord{}, err
	}
	return s.repo.LatestRollbackReadinessAssessment(ctx, projectID, programID)
}
func (s *OperationalReadService) LatestRollbackReadinessCheckpoint(ctx context.Context, actor Actor, projectID, programID string) (RollbackReadinessCheckpointRecord, error) {
	if err := s.view(ctx, actor, projectID); err != nil {
		return RollbackReadinessCheckpointRecord{}, err
	}
	return s.repo.LatestRollbackReadinessCheckpoint(ctx, projectID, programID)
}
