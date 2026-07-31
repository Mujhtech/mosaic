package billingmigrationpostgres

import (
	"context"
	"errors"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/jackc/pgx/v5"
)

func (r *Repository) ListCases(ctx context.Context, projectID, programID, cursor string, limit int) (billingmigration.CasePage, error) {
	args := []any{projectID, programID}
	clause, err := cursorClause(cursor, "opened_at", "id", &args)
	if err != nil {
		return billingmigration.CasePage{}, err
	}
	args = append(args, limit+1)
	rows, err := r.pool.Query(ctx, `SELECT id,opened_at FROM billing_migration_cases WHERE project_id=$1 AND program_id=$2`+clause+` ORDER BY opened_at DESC,id DESC LIMIT $`+itoa(len(args)), args...)
	if err != nil {
		return billingmigration.CasePage{}, err
	}
	defer rows.Close()
	type caseKey struct {
		id string
		at time.Time
	}
	var keys []caseKey
	for rows.Next() {
		var key caseKey
		if err = rows.Scan(&key.id, &key.at); err != nil {
			return billingmigration.CasePage{}, err
		}
		keys = append(keys, key)
	}
	if err = rows.Err(); err != nil {
		return billingmigration.CasePage{}, err
	}
	page := billingmigration.CasePage{Items: make([]billingmigration.MigrationCase, 0, limit)}
	for _, key := range keys {
		item, readErr := caseByID(ctx, r.pool, projectID, programID, key.id)
		if readErr != nil {
			return page, readErr
		}
		page.Items = append(page.Items, item)
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		key := keys[limit-1]
		page.NextCursor = pageCursor(key.at, key.id)
	}
	return page, nil
}
func (r *Repository) ReadCase(ctx context.Context, projectID, programID, id string) (billingmigration.MigrationCase, error) {
	return caseByID(ctx, r.pool, projectID, programID, id)
}

const caseActionReadSelect = `SELECT id,case_id,program_id,actor_id,action,before_digest,after_digest,created_at FROM billing_migration_case_actions`

func scanCaseAction(row pgx.Row) (billingmigration.CaseAction, error) {
	var item billingmigration.CaseAction
	var before, after []byte
	err := row.Scan(&item.ID, &item.CaseID, &item.ProgramID, &item.ActorID, &item.Action, &before, &after, &item.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return item, billingmigration.ErrNotFound
	}
	item.BeforeDigest, item.AfterDigest = billingmigration.FormatDigest(before), billingmigration.FormatDigest(after)
	return item, err
}
func (r *Repository) ListCaseActions(ctx context.Context, projectID, programID, caseID, cursor string, limit int) (billingmigration.CaseActionPage, error) {
	args := []any{projectID, programID, caseID}
	clause, err := cursorClause(cursor, "created_at", "id", &args)
	if err != nil {
		return billingmigration.CaseActionPage{}, err
	}
	args = append(args, limit+1)
	rows, err := r.pool.Query(ctx, caseActionReadSelect+` WHERE project_id=$1 AND program_id=$2 AND case_id=$3`+clause+` ORDER BY created_at DESC,id DESC LIMIT $`+itoa(len(args)), args...)
	if err != nil {
		return billingmigration.CaseActionPage{}, err
	}
	defer rows.Close()
	page := billingmigration.CaseActionPage{Items: make([]billingmigration.CaseAction, 0, limit)}
	for rows.Next() {
		item, scanErr := scanCaseAction(rows)
		if scanErr != nil {
			return page, scanErr
		}
		page.Items = append(page.Items, item)
	}
	if err = rows.Err(); err != nil {
		return page, err
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		item := page.Items[limit-1]
		page.NextCursor = pageCursor(item.CreatedAt, item.ID)
	}
	return page, nil
}

func scanRepairPreviewRecord(row pgx.Row) (billingmigration.RepairPreviewRecord, error) {
	var out billingmigration.RepairPreviewRecord
	var before, after, preview, caseDigest, policy, scope []byte
	err := row.Scan(&out.PreviewID, &out.CaseID, &out.ProgramID, &out.ProjectID, &out.RepairKind, &out.ScopeKind, &out.Reason, &out.ScopeReferences, &out.AffectedCount, &out.ExpectedStateVersion, &before, &after, &preview, &caseDigest, &policy, &scope, &out.CreatedByActorID, &out.CreatedAt, &out.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, billingmigration.ErrNotFound
	}
	out.BeforeDigest, out.AfterDigest, out.PreviewDigest = billingmigration.FormatDigest(before), billingmigration.FormatDigest(after), billingmigration.FormatDigest(preview)
	out.CaseDigest, out.PolicyDigest, out.ScopeDigest = billingmigration.FormatDigest(caseDigest), billingmigration.FormatDigest(policy), billingmigration.FormatDigest(scope)
	return out, err
}

const repairPreviewReadSelect = `SELECT id,case_id,program_id,project_id,repair_kind,scope_kind,reason,scope_references,affected_count,expected_program_state_version,before_digest,after_digest,preview_digest,expected_case_digest,expected_policy_digest,expected_scope_digest,created_by_actor_id,created_at,expires_at FROM billing_migration_repair_previews`

func (r *Repository) ListRepairPreviews(ctx context.Context, projectID, programID, cursor string, limit int) (billingmigration.RepairPreviewPage, error) {
	args := []any{projectID, programID}
	clause, err := cursorClause(cursor, "created_at", "id", &args)
	if err != nil {
		return billingmigration.RepairPreviewPage{}, err
	}
	args = append(args, limit+1)
	rows, err := r.pool.Query(ctx, repairPreviewReadSelect+` WHERE project_id=$1 AND program_id=$2`+clause+` ORDER BY created_at DESC,id DESC LIMIT $`+itoa(len(args)), args...)
	if err != nil {
		return billingmigration.RepairPreviewPage{}, err
	}
	defer rows.Close()
	page := billingmigration.RepairPreviewPage{Items: make([]billingmigration.RepairPreviewRecord, 0, limit)}
	for rows.Next() {
		item, e := scanRepairPreviewRecord(rows)
		if e != nil {
			return page, e
		}
		page.Items = append(page.Items, item)
	}
	if err = rows.Err(); err != nil {
		return page, err
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		item := page.Items[limit-1]
		page.NextCursor = pageCursor(item.CreatedAt, item.PreviewID)
	}
	return page, nil
}
func (r *Repository) ReadRepairPreview(ctx context.Context, projectID, programID, id string) (billingmigration.RepairPreviewRecord, error) {
	return scanRepairPreviewRecord(r.pool.QueryRow(ctx, repairPreviewReadSelect+` WHERE project_id=$1 AND program_id=$2 AND id=$3`, projectID, programID, id))
}

const repairExecutionReadSelect = `SELECT r.id,r.preview_id,r.program_id,CASE WHEN e.id IS NULL THEN 'pending' ELSE 'completed' END,COALESCE(e.result,''),COALESCE(e.error_code,''),p.before_digest,e.actual_after_digest,e.result_digest,r.attempt_number,r.actor_id,r.reserved_at,e.executed_at FROM billing_migration_repair_reservations r JOIN billing_migration_repair_previews p ON p.id=r.preview_id AND p.project_id=r.project_id AND p.program_id=r.program_id LEFT JOIN billing_migration_repair_executions e ON e.id=r.id AND e.project_id=r.project_id AND e.program_id=r.program_id`

func scanRepairExecutionRecord(row pgx.Row) (billingmigration.RepairExecutionRecord, error) {
	var out billingmigration.RepairExecutionRecord
	var before, after, result []byte
	err := row.Scan(&out.ExecutionID, &out.PreviewID, &out.ProgramID, &out.ExecutionStatus, &out.Result, &out.ErrorCode, &before, &after, &result, &out.AttemptNumber, &out.ExecutedByActorID, &out.ReservedAt, &out.ExecutedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, billingmigration.ErrNotFound
	}
	out.BeforeDigest = billingmigration.FormatDigest(before)
	if len(after) == 32 {
		out.AfterDigest = billingmigration.FormatDigest(after)
	}
	if len(result) == 32 {
		out.ResultDigest = billingmigration.FormatDigest(result)
	}
	return out, err
}
func (r *Repository) ListRepairExecutions(ctx context.Context, projectID, programID, cursor string, limit int) (billingmigration.RepairExecutionPage, error) {
	args := []any{projectID, programID}
	clause, err := cursorClause(cursor, "r.reserved_at", "r.id", &args)
	if err != nil {
		return billingmigration.RepairExecutionPage{}, err
	}
	args = append(args, limit+1)
	rows, err := r.pool.Query(ctx, repairExecutionReadSelect+` WHERE r.project_id=$1 AND r.program_id=$2`+clause+` ORDER BY r.reserved_at DESC,r.id DESC LIMIT $`+itoa(len(args)), args...)
	if err != nil {
		return billingmigration.RepairExecutionPage{}, err
	}
	defer rows.Close()
	page := billingmigration.RepairExecutionPage{Items: make([]billingmigration.RepairExecutionRecord, 0, limit)}
	for rows.Next() {
		item, e := scanRepairExecutionRecord(rows)
		if e != nil {
			return page, e
		}
		page.Items = append(page.Items, item)
	}
	if err = rows.Err(); err != nil {
		return page, err
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		item := page.Items[limit-1]
		page.NextCursor = pageCursor(item.ReservedAt, item.ExecutionID)
	}
	return page, nil
}
func (r *Repository) ReadRepairExecution(ctx context.Context, projectID, programID, id string) (billingmigration.RepairExecutionRecord, error) {
	return scanRepairExecutionRecord(r.pool.QueryRow(ctx, repairExecutionReadSelect+` WHERE r.project_id=$1 AND r.program_id=$2 AND r.id=$3`, projectID, programID, id))
}

const redeliveryReadSelect = `SELECT id,program_id,webhook_event_id,webhook_destination_id,webhook_delivery_id,reason,actor_id,expected_state_version,expected_event_digest,created_at FROM billing_migration_webhook_redeliveries`

func scanRedeliveryRecord(row pgx.Row) (billingmigration.RedeliveryRecord, error) {
	var out billingmigration.RedeliveryRecord
	var digest []byte
	err := row.Scan(&out.RedeliveryID, &out.ProgramID, &out.EventID, &out.DestinationID, &out.DeliveryID, &out.Reason, &out.ActorID, &out.ExpectedStateVersion, &digest, &out.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, billingmigration.ErrNotFound
	}
	out.ExpectedEventDigest = billingmigration.FormatDigest(digest)
	return out, err
}
func (r *Repository) ListRedeliveries(ctx context.Context, projectID, programID, cursor string, limit int) (billingmigration.RedeliveryPage, error) {
	args := []any{projectID, programID}
	clause, err := cursorClause(cursor, "created_at", "id", &args)
	if err != nil {
		return billingmigration.RedeliveryPage{}, err
	}
	args = append(args, limit+1)
	rows, err := r.pool.Query(ctx, redeliveryReadSelect+` WHERE project_id=$1 AND program_id=$2`+clause+` ORDER BY created_at DESC,id DESC LIMIT $`+itoa(len(args)), args...)
	if err != nil {
		return billingmigration.RedeliveryPage{}, err
	}
	defer rows.Close()
	page := billingmigration.RedeliveryPage{Items: make([]billingmigration.RedeliveryRecord, 0, limit)}
	for rows.Next() {
		item, e := scanRedeliveryRecord(rows)
		if e != nil {
			return page, e
		}
		page.Items = append(page.Items, item)
	}
	if err = rows.Err(); err != nil {
		return page, err
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		item := page.Items[limit-1]
		page.NextCursor = pageCursor(item.CreatedAt, item.RedeliveryID)
	}
	return page, nil
}
func (r *Repository) ReadRedelivery(ctx context.Context, projectID, programID, id string) (billingmigration.RedeliveryRecord, error) {
	return scanRedeliveryRecord(r.pool.QueryRow(ctx, redeliveryReadSelect+` WHERE project_id=$1 AND program_id=$2 AND id=$3`, projectID, programID, id))
}

const credentialRemovalReadSelect = `SELECT id,program_id,credential_id,reason,actor_id,removal_digest,expected_state_version,early_removal,removed_at FROM billing_migration_credential_removals`

func scanCredentialRemovalRecord(row pgx.Row) (billingmigration.CredentialRemovalRecord, error) {
	var out billingmigration.CredentialRemovalRecord
	var digest []byte
	err := row.Scan(&out.RemovalID, &out.ProgramID, &out.CredentialID, &out.Reason, &out.ActorID, &digest, &out.StateVersion, &out.Early, &out.RemovedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, billingmigration.ErrNotFound
	}
	out.RemovalDigest = billingmigration.FormatDigest(digest)
	return out, err
}
func (r *Repository) ListCredentialRemovals(ctx context.Context, projectID, programID, cursor string, limit int) (billingmigration.CredentialRemovalPage, error) {
	args := []any{projectID, programID}
	clause, err := cursorClause(cursor, "removed_at", "id", &args)
	if err != nil {
		return billingmigration.CredentialRemovalPage{}, err
	}
	args = append(args, limit+1)
	rows, err := r.pool.Query(ctx, credentialRemovalReadSelect+` WHERE project_id=$1 AND program_id=$2`+clause+` ORDER BY removed_at DESC,id DESC LIMIT $`+itoa(len(args)), args...)
	if err != nil {
		return billingmigration.CredentialRemovalPage{}, err
	}
	defer rows.Close()
	page := billingmigration.CredentialRemovalPage{Items: make([]billingmigration.CredentialRemovalRecord, 0, limit)}
	for rows.Next() {
		item, e := scanCredentialRemovalRecord(rows)
		if e != nil {
			return page, e
		}
		page.Items = append(page.Items, item)
	}
	if err = rows.Err(); err != nil {
		return page, err
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		item := page.Items[limit-1]
		page.NextCursor = pageCursor(item.RemovedAt, item.RemovalID)
	}
	return page, nil
}
func (r *Repository) ReadCredentialRemoval(ctx context.Context, projectID, programID, id string) (billingmigration.CredentialRemovalRecord, error) {
	return scanCredentialRemovalRecord(r.pool.QueryRow(ctx, credentialRemovalReadSelect+` WHERE project_id=$1 AND program_id=$2 AND id=$3`, projectID, programID, id))
}
func (r *Repository) CurrentCredentialRemoval(ctx context.Context, projectID, programID string) (billingmigration.CredentialRemovalRecord, error) {
	return scanCredentialRemovalRecord(r.pool.QueryRow(ctx, credentialRemovalReadSelect+` WHERE project_id=$1 AND program_id=$2 ORDER BY removed_at DESC,id DESC LIMIT 1`, projectID, programID))
}

const legalHoldProposalReadSelect = `SELECT id,program_id,command,reason,external_compliance_reference,proposer_actor_id,expected_previous_command_digest,proposal_digest,status,proposed_at,expires_at FROM billing_migration_legal_hold_proposals`

func scanLegalHoldProposalRecord(row pgx.Row) (billingmigration.LegalHoldProposalRecord, error) {
	var out billingmigration.LegalHoldProposalRecord
	var previous, digest []byte
	err := row.Scan(&out.ProposalID, &out.ProgramID, &out.Command, &out.Reason, &out.ExternalComplianceReference, &out.ProposerActorID, &previous, &digest, &out.Status, &out.ProposedAt, &out.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, billingmigration.ErrNotFound
	}
	if len(previous) > 0 {
		out.ExpectedPreviousCommandDigest = billingmigration.FormatDigest(previous)
	}
	out.ProposalDigest = billingmigration.FormatDigest(digest)
	return out, err
}
func (r *Repository) ListLegalHoldProposals(ctx context.Context, projectID, programID, cursor string, limit int) (billingmigration.LegalHoldProposalPage, error) {
	args := []any{projectID, programID}
	clause, err := cursorClause(cursor, "proposed_at", "id", &args)
	if err != nil {
		return billingmigration.LegalHoldProposalPage{}, err
	}
	args = append(args, limit+1)
	rows, err := r.pool.Query(ctx, legalHoldProposalReadSelect+` WHERE project_id=$1 AND program_id=$2`+clause+` ORDER BY proposed_at DESC,id DESC LIMIT $`+itoa(len(args)), args...)
	if err != nil {
		return billingmigration.LegalHoldProposalPage{}, err
	}
	defer rows.Close()
	page := billingmigration.LegalHoldProposalPage{Items: make([]billingmigration.LegalHoldProposalRecord, 0, limit)}
	for rows.Next() {
		item, e := scanLegalHoldProposalRecord(rows)
		if e != nil {
			return page, e
		}
		page.Items = append(page.Items, item)
	}
	if err = rows.Err(); err != nil {
		return page, err
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		item := page.Items[limit-1]
		page.NextCursor = pageCursor(item.ProposedAt, item.ProposalID)
	}
	return page, nil
}
func (r *Repository) ReadLegalHoldProposal(ctx context.Context, projectID, programID, id string) (billingmigration.LegalHoldProposalRecord, error) {
	return scanLegalHoldProposalRecord(r.pool.QueryRow(ctx, legalHoldProposalReadSelect+` WHERE project_id=$1 AND program_id=$2 AND id=$3`, projectID, programID, id))
}

const legalHoldReadSelect = `SELECT id,proposal_id,program_id,command,reason,external_compliance_reference,proposer_actor_id,approver_actor_id,COALESCE(previous_command_id,''),command_digest,production,commanded_at FROM billing_migration_legal_hold_commands`

func scanLegalHoldRecord(row pgx.Row) (billingmigration.LegalHoldRecord, error) {
	var out billingmigration.LegalHoldRecord
	var digest []byte
	err := row.Scan(&out.HoldID, &out.ProposalID, &out.ProgramID, &out.Command, &out.Reason, &out.ExternalComplianceReference, &out.ProposerActorID, &out.ApproverActorID, &out.PreviousCommandID, &digest, &out.Production, &out.CommandedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, billingmigration.ErrNotFound
	}
	out.CommandDigest = billingmigration.FormatDigest(digest)
	return out, err
}
func (r *Repository) ListLegalHolds(ctx context.Context, projectID, programID, cursor string, limit int) (billingmigration.LegalHoldPage, error) {
	args := []any{projectID, programID}
	clause, err := cursorClause(cursor, "commanded_at", "id", &args)
	if err != nil {
		return billingmigration.LegalHoldPage{}, err
	}
	args = append(args, limit+1)
	rows, err := r.pool.Query(ctx, legalHoldReadSelect+` WHERE project_id=$1 AND program_id=$2`+clause+` ORDER BY commanded_at DESC,id DESC LIMIT $`+itoa(len(args)), args...)
	if err != nil {
		return billingmigration.LegalHoldPage{}, err
	}
	defer rows.Close()
	page := billingmigration.LegalHoldPage{Items: make([]billingmigration.LegalHoldRecord, 0, limit)}
	for rows.Next() {
		item, e := scanLegalHoldRecord(rows)
		if e != nil {
			return page, e
		}
		page.Items = append(page.Items, item)
	}
	if err = rows.Err(); err != nil {
		return page, err
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		item := page.Items[limit-1]
		page.NextCursor = pageCursor(item.CommandedAt, item.HoldID)
	}
	return page, nil
}
func (r *Repository) ReadLegalHold(ctx context.Context, projectID, programID, id string) (billingmigration.LegalHoldRecord, error) {
	return scanLegalHoldRecord(r.pool.QueryRow(ctx, legalHoldReadSelect+` WHERE project_id=$1 AND program_id=$2 AND id=$3`, projectID, programID, id))
}
func (r *Repository) CurrentLegalHold(ctx context.Context, projectID, programID string) (billingmigration.LegalHoldRecord, error) {
	return scanLegalHoldRecord(r.pool.QueryRow(ctx, legalHoldReadSelect+` WHERE project_id=$1 AND program_id=$2 ORDER BY commanded_at DESC,id DESC LIMIT 1`, projectID, programID))
}

const completionReportReadSelect = `SELECT r.id,r.program_id,r.project_id,r.state_version,r.completed_at,r.stabilization_ended_at,r.rollback_window_ended_at,r.credential_removed_at,r.legal_hold,r.source_objects_delete_at,r.completion_digest,r.authority_digest,r.stability_evidence_digest,r.completion_policy_digest,COALESCE(a.actor_id,'') FROM billing_migration_completion_reports r LEFT JOIN audit_events a ON a.id='aud_'||r.id`

func scanCompletionReportRecord(row pgx.Row) (billingmigration.CompletionReportRecord, error) {
	var out billingmigration.CompletionReportRecord
	var completion, authority, stability, policy []byte
	err := row.Scan(&out.ReportID, &out.ProgramID, &out.ProjectID, &out.StateVersion, &out.CompletedAt, &out.StabilizationEndedAt, &out.RollbackWindowEndedAt, &out.CredentialRemovedAt, &out.LegalHold, &out.SourceObjectsDeleteAt, &completion, &authority, &stability, &policy, &out.CompletedByActorID)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, billingmigration.ErrNotFound
	}
	out.CompletionDigest, out.AuthorityDigest, out.StabilityEvidenceDigest, out.PolicyDigest = billingmigration.FormatDigest(completion), billingmigration.FormatDigest(authority), billingmigration.FormatDigest(stability), billingmigration.FormatDigest(policy)
	return out, err
}
func (r *Repository) ListCompletionReports(ctx context.Context, projectID, programID, cursor string, limit int) (billingmigration.CompletionReportPage, error) {
	args := []any{projectID, programID}
	clause, err := cursorClause(cursor, "r.completed_at", "r.id", &args)
	if err != nil {
		return billingmigration.CompletionReportPage{}, err
	}
	args = append(args, limit+1)
	rows, err := r.pool.Query(ctx, completionReportReadSelect+` WHERE r.project_id=$1 AND r.program_id=$2`+clause+` ORDER BY r.completed_at DESC,r.id DESC LIMIT $`+itoa(len(args)), args...)
	if err != nil {
		return billingmigration.CompletionReportPage{}, err
	}
	defer rows.Close()
	page := billingmigration.CompletionReportPage{Items: make([]billingmigration.CompletionReportRecord, 0, limit)}
	for rows.Next() {
		item, e := scanCompletionReportRecord(rows)
		if e != nil {
			return page, e
		}
		page.Items = append(page.Items, item)
	}
	if err = rows.Err(); err != nil {
		return page, err
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		item := page.Items[limit-1]
		page.NextCursor = pageCursor(item.CompletedAt, item.ReportID)
	}
	return page, nil
}
func (r *Repository) ReadCompletionReport(ctx context.Context, projectID, programID, id string) (billingmigration.CompletionReportRecord, error) {
	return scanCompletionReportRecord(r.pool.QueryRow(ctx, completionReportReadSelect+` WHERE r.project_id=$1 AND r.program_id=$2 AND r.id=$3`, projectID, programID, id))
}

const stabilizationPolicyReadSelect = `SELECT id,program_id,project_id,state_version,authority_mismatch_max,access_api_error_max,sdk_sync_failure_max,divergence_max,validation_backlog_max,source_delta_lag_max_seconds,webhook_failure_max,webhook_freshness_max_seconds,quarantine_max,support_case_max,old_app_version_max,worker_unhealthy_max,policy_digest,frozen_by_actor_id,frozen_at FROM billing_migration_stabilization_policies`

func scanStabilizationPolicyRecord(row pgx.Row) (billingmigration.StabilizationPolicyRecord, error) {
	var out billingmigration.StabilizationPolicyRecord
	var digest []byte
	t := &out.Thresholds
	err := row.Scan(&out.ID, &out.ProgramID, &out.ProjectID, &out.StateVersion, &t.AuthorityMismatchMax, &t.AccessAPIErrorMax, &t.SDKSyncFailureMax, &t.DivergenceMax, &t.ValidationBacklogMax, &t.SourceDeltaLagMaxSeconds, &t.WebhookFailureMax, &t.WebhookFreshnessMaxSeconds, &t.QuarantineMax, &t.SupportCaseMax, &t.OldAppVersionMax, &t.WorkerUnhealthyMax, &digest, &out.FrozenByActorID, &out.FrozenAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, billingmigration.ErrNotFound
	}
	out.PolicyDigest = billingmigration.FormatDigest(digest)
	return out, err
}
func (r *Repository) CurrentStabilizationPolicy(ctx context.Context, projectID, programID string) (billingmigration.StabilizationPolicyRecord, error) {
	return scanStabilizationPolicyRecord(r.pool.QueryRow(ctx, stabilizationPolicyReadSelect+` WHERE project_id=$1 AND program_id=$2 ORDER BY frozen_at DESC,id DESC LIMIT 1`, projectID, programID))
}

const stabilizationObservationReadSelect = `SELECT o.id,o.program_id,o.project_id,o.policy_id,p.policy_digest,o.state_version,o.authority_epoch,o.authority_mismatches,o.access_api_errors,o.sdk_sync_failures,o.divergences,o.validation_backlog,o.source_delta_lag_seconds,o.webhook_failures,o.webhook_age_seconds,o.quarantined_records,o.support_cases,o.old_app_versions,o.unhealthy_workers,o.source_watermark,o.webhook_last_success_at,o.breach_codes,o.healthy,o.evidence_digest,o.observed_at FROM billing_migration_stabilization_observations o JOIN billing_migration_stabilization_policies p ON p.id=o.policy_id AND p.project_id=o.project_id AND p.program_id=o.program_id`

func scanStabilizationObservationRecord(row pgx.Row) (billingmigration.StabilizationObservationRecord, error) {
	var out billingmigration.StabilizationObservationRecord
	var policy, evidence []byte
	m := &out.Metrics
	err := row.Scan(&out.ID, &out.ProgramID, &out.ProjectID, &out.PolicyID, &policy, &out.StateVersion, &out.AuthorityEpoch, &m.AuthorityMismatches, &m.AccessAPIErrors, &m.SDKSyncFailures, &m.Divergences, &m.ValidationBacklog, &m.SourceDeltaLagSeconds, &m.WebhookFailures, &m.WebhookAgeSeconds, &m.QuarantinedRecords, &m.SupportCases, &m.OldAppVersions, &m.UnhealthyWorkers, &out.SourceWatermark, &out.WebhookLastSuccessAt, &out.BreachCodes, &out.Healthy, &evidence, &out.ObservedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, billingmigration.ErrNotFound
	}
	out.PolicyDigest, out.EvidenceDigest = billingmigration.FormatDigest(policy), billingmigration.FormatDigest(evidence)
	return out, err
}
func (r *Repository) ListStabilizationObservations(ctx context.Context, projectID, programID, cursor string, limit int) (billingmigration.StabilizationObservationPage, error) {
	args := []any{projectID, programID}
	clause, err := cursorClause(cursor, "o.observed_at", "o.id", &args)
	if err != nil {
		return billingmigration.StabilizationObservationPage{}, err
	}
	args = append(args, limit+1)
	rows, err := r.pool.Query(ctx, stabilizationObservationReadSelect+` WHERE o.project_id=$1 AND o.program_id=$2`+clause+` ORDER BY o.observed_at DESC,o.id DESC LIMIT $`+itoa(len(args)), args...)
	if err != nil {
		return billingmigration.StabilizationObservationPage{}, err
	}
	defer rows.Close()
	page := billingmigration.StabilizationObservationPage{Items: make([]billingmigration.StabilizationObservationRecord, 0, limit)}
	for rows.Next() {
		item, e := scanStabilizationObservationRecord(rows)
		if e != nil {
			return page, e
		}
		page.Items = append(page.Items, item)
	}
	if err = rows.Err(); err != nil {
		return page, err
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		item := page.Items[limit-1]
		page.NextCursor = pageCursor(item.ObservedAt, item.ID)
	}
	return page, nil
}
func (r *Repository) LatestStabilizationObservation(ctx context.Context, projectID, programID string) (billingmigration.StabilizationObservationRecord, error) {
	return scanStabilizationObservationRecord(r.pool.QueryRow(ctx, stabilizationObservationReadSelect+` WHERE o.project_id=$1 AND o.program_id=$2 ORDER BY o.observed_at DESC,o.id DESC LIMIT 1`, projectID, programID))
}

const rollbackAssessmentReadSelect = `SELECT id,program_id,project_id,observation_id,latest_delta_id,readiness_digest,state_version,source_support_available,source_healthy,application_compatible,limitations_blocking,ready,customer_impact_count,assessed_at,source_health_digest,source_current_access_digest,latest_delta_digest,customer_impact_digest,application_compatibility_digest,limitation_report_digest,audit_digest,stabilization_healthy,assessed_by_actor_id,source_current_access_at FROM billing_migration_rollback_readiness_assessments`

func scanRollbackAssessmentRecord(row pgx.Row) (billingmigration.RollbackReadinessAssessmentRecord, error) {
	var out billingmigration.RollbackReadinessAssessmentRecord
	var readiness, sourceHealth, sourceAccess, delta, impact, compatibility, limitation, audit []byte
	err := row.Scan(&out.ID, &out.ProgramID, &out.ProjectID, &out.ObservationID, &out.LatestDeltaID, &readiness, &out.StateVersion, &out.SourceSupportAvailable, &out.SourceHealthy, &out.ApplicationCompatible, &out.LimitationsBlocking, &out.Ready, &out.CustomerImpactCount, &out.AssessedAt, &sourceHealth, &sourceAccess, &delta, &impact, &compatibility, &limitation, &audit, &out.StabilizationHealthy, &out.AssessedByActorID, &out.SourceCurrentAccessAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, billingmigration.ErrNotFound
	}
	out.ReadinessDigest = billingmigration.FormatDigest(readiness)
	out.SourceHealthDigest = billingmigration.FormatDigest(sourceHealth)
	out.SourceCurrentAccessDigest = billingmigration.FormatDigest(sourceAccess)
	out.LatestDeltaDigest = billingmigration.FormatDigest(delta)
	out.CustomerImpactDigest = billingmigration.FormatDigest(impact)
	out.ApplicationCompatibilityDigest = billingmigration.FormatDigest(compatibility)
	out.LimitationReportDigest = billingmigration.FormatDigest(limitation)
	out.AuditDigest = billingmigration.FormatDigest(audit)
	return out, err
}
func (r *Repository) ListRollbackReadinessAssessments(ctx context.Context, projectID, programID, cursor string, limit int) (billingmigration.RollbackReadinessAssessmentPage, error) {
	args := []any{projectID, programID}
	clause, err := cursorClause(cursor, "assessed_at", "id", &args)
	if err != nil {
		return billingmigration.RollbackReadinessAssessmentPage{}, err
	}
	args = append(args, limit+1)
	rows, err := r.pool.Query(ctx, rollbackAssessmentReadSelect+` WHERE project_id=$1 AND program_id=$2`+clause+` ORDER BY assessed_at DESC,id DESC LIMIT $`+itoa(len(args)), args...)
	if err != nil {
		return billingmigration.RollbackReadinessAssessmentPage{}, err
	}
	defer rows.Close()
	page := billingmigration.RollbackReadinessAssessmentPage{Items: make([]billingmigration.RollbackReadinessAssessmentRecord, 0, limit)}
	for rows.Next() {
		item, e := scanRollbackAssessmentRecord(rows)
		if e != nil {
			return page, e
		}
		page.Items = append(page.Items, item)
	}
	if err = rows.Err(); err != nil {
		return page, err
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		item := page.Items[limit-1]
		page.NextCursor = pageCursor(item.AssessedAt, item.ID)
	}
	return page, nil
}
func (r *Repository) LatestRollbackReadinessAssessment(ctx context.Context, projectID, programID string) (billingmigration.RollbackReadinessAssessmentRecord, error) {
	return scanRollbackAssessmentRecord(r.pool.QueryRow(ctx, rollbackAssessmentReadSelect+` WHERE project_id=$1 AND program_id=$2 ORDER BY assessed_at DESC,id DESC LIMIT 1`, projectID, programID))
}

const rollbackCheckpointReadSelect = `SELECT id,program_id,project_id,assessment_id,authority_digest,policy_digest,evidence_digest,readiness_digest,checkpoint_digest,state_version,authority_epoch,created_by_actor_id,created_at FROM billing_migration_rollback_readiness_checkpoints`

func scanRollbackCheckpointRecord(row pgx.Row) (billingmigration.RollbackReadinessCheckpointRecord, error) {
	var out billingmigration.RollbackReadinessCheckpointRecord
	var authority, policy, evidence, readiness, checkpoint []byte
	err := row.Scan(&out.ID, &out.ProgramID, &out.ProjectID, &out.AssessmentID, &authority, &policy, &evidence, &readiness, &checkpoint, &out.StateVersion, &out.AuthorityEpoch, &out.CreatedByActorID, &out.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, billingmigration.ErrNotFound
	}
	out.AuthorityDigest = billingmigration.FormatDigest(authority)
	out.PolicyDigest = billingmigration.FormatDigest(policy)
	out.EvidenceDigest = billingmigration.FormatDigest(evidence)
	out.ReadinessDigest = billingmigration.FormatDigest(readiness)
	out.CheckpointDigest = billingmigration.FormatDigest(checkpoint)
	return out, err
}
func (r *Repository) LatestRollbackReadinessCheckpoint(ctx context.Context, projectID, programID string) (billingmigration.RollbackReadinessCheckpointRecord, error) {
	return scanRollbackCheckpointRecord(r.pool.QueryRow(ctx, rollbackCheckpointReadSelect+` WHERE project_id=$1 AND program_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1`, projectID, programID))
}
