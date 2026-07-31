package billingmigrationpostgres

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/jackc/pgx/v5"
)

func (r *Repository) CreateRepairPreview(ctx context.Context, w billingmigration.RepairPreviewWrite) (billingmigration.RepairPreview, bool, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return billingmigration.RepairPreview{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	resource, replay, err := operationCommandReplay(ctx, tx, w.Preview.ProgramID, "preview_repair", w.IdempotencyKey, w.RequestDigest)
	if err != nil {
		return billingmigration.RepairPreview{}, false, err
	}
	if replay {
		p, err := repairPreviewByID(ctx, tx, w.Preview.ProjectID, w.Preview.ProgramID, resource)
		return p, true, err
	}
	var state int64
	var policy, scope, caseD []byte
	var caseStatus string
	err = tx.QueryRow(ctx, `SELECT p.state_version,p.policy_digest,p.scope_digest,c.case_digest,c.status FROM billing_migration_programs p JOIN billing_migration_cases c ON c.program_id=p.id AND c.project_id=p.project_id WHERE p.id=$1 AND p.project_id=$2 AND c.id=$3 FOR UPDATE OF p,c`, w.Preview.ProgramID, w.Preview.ProjectID, w.Preview.CaseID).Scan(&state, &policy, &scope, &caseD, &caseStatus)
	if err != nil {
		return billingmigration.RepairPreview{}, false, translate(err, "lock repair preview bindings")
	}
	if state != w.Preview.ExpectedStateVersion || caseStatus == "resolved" || caseStatus == "dismissed" || !bytes.Equal(policy, w.PolicyDigest) || !bytes.Equal(scope, w.ScopeDigest) || !bytes.Equal(caseD, w.CaseDigest) {
		return billingmigration.RepairPreview{}, false, billingmigration.ErrStaleDigest
	}
	before, _ := billingmigration.ParseDigest(w.Preview.BeforeDigest)
	after, _ := billingmigration.ParseDigest(w.Preview.AfterDigest)
	preview, _ := billingmigration.ParseDigest(w.Preview.PreviewDigest)
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_repair_previews(id,case_id,program_id,project_id,repair_kind,scope_kind,scope_references,affected_count,before_digest,after_digest,preview_digest,created_by_actor_id,created_at,expected_program_state_version,expected_case_digest,expected_policy_digest,expected_scope_digest,reason,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`, w.Preview.PreviewID, w.Preview.CaseID, w.Preview.ProgramID, w.Preview.ProjectID, w.Preview.RepairKind, w.Preview.ScopeKind, w.Preview.ScopeReferences, w.Preview.AffectedCount, before, after, preview, w.ActorID, w.Preview.CreatedAt, w.Preview.ExpectedStateVersion, w.CaseDigest, w.PolicyDigest, w.ScopeDigest, w.Preview.Reason, w.Preview.ExpiresAt)
	if err != nil {
		return billingmigration.RepairPreview{}, false, translate(err, "insert repair preview")
	}
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_command_idempotency(id,program_id,project_id,command_kind,idempotency_key,request_digest,resource_id,created_at) VALUES('mci_'||$1,$2,$3,'preview_repair',$4,$5,$1,$6)`, w.Preview.PreviewID, w.Preview.ProgramID, w.Preview.ProjectID, w.IdempotencyKey, w.RequestDigest, w.Preview.CreatedAt)
	if err != nil {
		return billingmigration.RepairPreview{}, false, translate(err, "insert repair preview idempotency")
	}
	if err = tx.Commit(ctx); err != nil {
		return billingmigration.RepairPreview{}, false, err
	}
	return w.Preview, false, nil
}

func (r *Repository) PrepareRepair(ctx context.Context, w billingmigration.RepairExecutionWrite) (billingmigration.PreparedRepair, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return billingmigration.PreparedRepair{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var existingID, previewID string
	var stored []byte
	var attempt int
	var settledAt *time.Time
	err = tx.QueryRow(ctx, `SELECT id,preview_id,request_digest,attempt_number,settled_at FROM billing_migration_repair_reservations WHERE program_id=$1 AND idempotency_key=$2`, w.ProgramID, w.IdempotencyKey).Scan(&existingID, &previewID, &stored, &attempt, &settledAt)
	if err == nil {
		if !bytes.Equal(stored, w.RequestDigest) || previewID != w.PreviewID {
			return billingmigration.PreparedRepair{}, billingmigration.ErrIdempotencyConflict
		}
		p, err := preparedRepair(ctx, tx, w.ProjectID, w.ProgramID, w.PreviewID, existingID, attempt)
		if err != nil {
			return p, err
		}
		if settledAt != nil {
			execution, e := repairExecutionByID(ctx, tx, existingID)
			if e != nil {
				return p, e
			}
			p.State = billingmigration.RepairPreparationSettled
			p.SettledExecution = &execution
		} else {
			p.State = billingmigration.RepairPreparationUnsettled
		}
		return p, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return billingmigration.PreparedRepair{}, err
	}
	var kind, caseID, state, caseStatus string
	var refs []string
	var version int64
	var previewD, caseD, policy, scope []byte
	var expires time.Time
	err = tx.QueryRow(ctx, `SELECT p.repair_kind,p.case_id,p.scope_references,p.preview_digest,p.expected_case_digest,p.expected_policy_digest,p.expected_scope_digest,p.expires_at,mp.state,mp.state_version,c.status FROM billing_migration_repair_previews p JOIN billing_migration_programs mp ON mp.id=p.program_id AND mp.project_id=p.project_id JOIN billing_migration_cases c ON c.id=p.case_id WHERE p.id=$1 AND p.program_id=$2 AND p.project_id=$3 FOR UPDATE OF mp,c`, w.PreviewID, w.ProgramID, w.ProjectID).Scan(&kind, &caseID, &refs, &previewD, &caseD, &policy, &scope, &expires, &state, &version, &caseStatus)
	if err != nil {
		return billingmigration.PreparedRepair{}, translate(err, "lock repair bindings")
	}
	if version != w.ExpectedStateVersion || caseStatus == "resolved" || caseStatus == "dismissed" || !bytes.Equal(previewD, w.ExpectedPreviewDigest) || !bytes.Equal(caseD, w.ExpectedCaseDigest) || !bytes.Equal(policy, w.ExpectedPolicyDigest) || !bytes.Equal(scope, w.ExpectedScopeDigest) || !expires.After(w.At) {
		return billingmigration.PreparedRepair{}, billingmigration.ErrStaleDigest
	}
	if kind == billingmigration.RepairReplaceMappingSet && (state == "cutover_pending" || state == "stabilizing" || state == "completed" || state == "rolled_back") {
		return billingmigration.PreparedRepair{}, billingmigration.ErrConflict
	}
	err = tx.QueryRow(ctx, `SELECT COALESCE(max(attempt_number),0)+1 FROM billing_migration_repair_reservations WHERE preview_id=$1`, w.PreviewID).Scan(&attempt)
	if err != nil || attempt > 16 {
		return billingmigration.PreparedRepair{}, billingmigration.ErrConflict
	}
	sum := sha256.Sum256(append([]byte(w.PreviewID+"\x1f"), w.RequestDigest...))
	id := "mre_" + hex.EncodeToString(sum[:12])
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_repair_reservations(id,preview_id,program_id,project_id,idempotency_key,request_digest,attempt_number,expected_program_state_version,actor_id,reserved_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, id, w.PreviewID, w.ProgramID, w.ProjectID, w.IdempotencyKey, w.RequestDigest, attempt, w.ExpectedStateVersion, w.ActorID, w.At)
	if err != nil {
		return billingmigration.PreparedRepair{}, translate(err, "reserve repair execution")
	}
	prepared, err := preparedRepair(ctx, tx, w.ProjectID, w.ProgramID, w.PreviewID, id, attempt)
	if err != nil {
		return billingmigration.PreparedRepair{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return billingmigration.PreparedRepair{}, err
	}
	prepared.State = billingmigration.RepairPreparationNew
	return prepared, nil
}

func preparedRepair(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, projectID, programID, previewID, executionID string, attempt int) (billingmigration.PreparedRepair, error) {
	var p billingmigration.PreparedRepair
	p.ExecutionID = executionID
	p.AttemptNumber = attempt
	err := q.QueryRow(ctx, `SELECT repair_kind,case_id,scope_references,before_digest FROM billing_migration_repair_previews WHERE id=$1 AND program_id=$2 AND project_id=$3`, previewID, programID, projectID).Scan(&p.RepairKind, &p.CaseID, &p.ScopeReferences, &p.PreviewBeforeDigest)
	return p, err
}

func (r *Repository) SettleRepair(ctx context.Context, s billingmigration.RepairSettlement) (billingmigration.RepairExecution, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return billingmigration.RepairExecution{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var previewID, actorID, repairKind string
	var attempt int
	var expectedStateVersion int64
	var settledAt *time.Time
	err = tx.QueryRow(ctx, `SELECT r.preview_id,r.actor_id,r.attempt_number,r.expected_program_state_version,r.settled_at,p.repair_kind FROM billing_migration_repair_reservations r JOIN billing_migration_repair_previews p ON p.id=r.preview_id WHERE r.id=$1 AND r.program_id=$2 AND r.project_id=$3 FOR UPDATE OF r`, s.ExecutionID, s.ProgramID, s.ProjectID).Scan(&previewID, &actorID, &attempt, &expectedStateVersion, &settledAt, &repairKind)
	if err != nil {
		return billingmigration.RepairExecution{}, translate(err, "lock repair reservation")
	}
	if settledAt != nil {
		e, err := repairExecutionByID(ctx, tx, s.ExecutionID)
		return e, err
	}
	if s.Result == "" {
		return billingmigration.RepairExecution{}, billingmigration.ErrConflict
	}
	if attempt != s.AttemptNumber || len(s.ActualBeforeDigest) != 32 || len(s.ActualAfterDigest) != 32 {
		return billingmigration.RepairExecution{}, billingmigration.ErrInvalid
	}
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_repair_executions(id,preview_id,program_id,project_id,idempotency_key,result,result_digest,executed_by_actor_id,executed_at,attempt_number,request_digest,actual_before_digest,actual_after_digest,error_code) SELECT r.id,r.preview_id,r.program_id,r.project_id,r.idempotency_key,$2,$3,r.actor_id,$4,r.attempt_number,r.request_digest,$5,$6,NULLIF($7,'') FROM billing_migration_repair_reservations r WHERE r.id=$1`, s.ExecutionID, s.Result, s.ResultDigest, s.At, s.ActualBeforeDigest, s.ActualAfterDigest, s.ErrorCode)
	if err != nil {
		return billingmigration.RepairExecution{}, translate(err, "append repair execution")
	}
	if repairKind == billingmigration.RepairReplaceMappingSet && s.Result != "failed" {
		var state string
		var version int64
		err = tx.QueryRow(ctx, `SELECT state,state_version FROM billing_migration_programs WHERE id=$1 AND project_id=$2 FOR UPDATE`, s.ProgramID, s.ProjectID).Scan(&state, &version)
		if err != nil {
			return billingmigration.RepairExecution{}, translate(err, "lock mapping repair rewind")
		}
		if version != expectedStateVersion || state == "cutover_pending" || state == "stabilizing" || state == "completed" || state == "rolled_back" {
			return billingmigration.RepairExecution{}, billingmigration.ErrStaleState
		}
		_, err = tx.Exec(ctx, `INSERT INTO billing_migration_repair_invalidations(id,execution_id,program_id,project_id,invalidation_kind,invalidated_reference_id,invalidation_digest,invalidated_at)
            SELECT 'mri_'||substr(md5($1||':'||x.kind||':'||x.reference_id),1,20),$1,$2,$3,x.kind,x.reference_id,
                   sha256(convert_to($1||chr(31)||x.kind||chr(31)||x.reference_id,'UTF8')),$4
            FROM (
                SELECT CASE run_kind WHEN 'dry_run' THEN 'dry_run' ELSE 'shadow' END kind,COALESCE(result_run_id,id) reference_id FROM billing_migration_run_jobs WHERE program_id=$2
                UNION ALL SELECT 'readiness',id FROM billing_migration_readiness_assessments WHERE program_id=$2
                UNION ALL SELECT 'checkpoint',id FROM billing_migration_checkpoints WHERE program_id=$2
                UNION ALL SELECT 'approval',id FROM billing_migration_approvals WHERE program_id=$2
            )x ON CONFLICT(execution_id,invalidation_kind,invalidated_reference_id) DO NOTHING`, s.ExecutionID, s.ProgramID, s.ProjectID, s.At)
		if err != nil {
			return billingmigration.RepairExecution{}, translate(err, "append mapping repair invalidations")
		}
		_, err = tx.Exec(ctx, `UPDATE billing_migration_cutover_proposals SET status='invalidated',invalidated_at=$2 WHERE program_id=$1 AND status IN('pending','approved')`, s.ProgramID, s.At)
		if err != nil {
			return billingmigration.RepairExecution{}, translate(err, "invalidate mapping repair proposals")
		}
		tag, err := tx.Exec(ctx, `UPDATE billing_migration_programs SET state='mapping',state_version=state_version+1,updated_at=$3 WHERE id=$1 AND project_id=$2 AND state_version=$4`, s.ProgramID, s.ProjectID, s.At, expectedStateVersion)
		if err != nil || tag.RowsAffected() != 1 {
			return billingmigration.RepairExecution{}, billingmigration.ErrStaleState
		}
	}
	for i, invalidation := range s.Invalidations {
		if len(invalidation.Digest) != 32 {
			return billingmigration.RepairExecution{}, billingmigration.ErrInvalid
		}
		id := fmt.Sprintf("mri_%s_%02d", s.ExecutionID[4:], i)
		_, err = tx.Exec(ctx, `INSERT INTO billing_migration_repair_invalidations(id,execution_id,program_id,project_id,invalidation_kind,invalidated_reference_id,invalidation_digest,invalidated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(execution_id,invalidation_kind,invalidated_reference_id) DO NOTHING`, id, s.ExecutionID, s.ProgramID, s.ProjectID, invalidation.Kind, invalidation.ReferenceID, invalidation.Digest, s.At)
		if err != nil {
			return billingmigration.RepairExecution{}, translate(err, "append repair invalidation")
		}
	}
	_, err = tx.Exec(ctx, `UPDATE billing_migration_repair_reservations SET settled_at=$2 WHERE id=$1 AND settled_at IS NULL`, s.ExecutionID, s.At)
	if err != nil {
		return billingmigration.RepairExecution{}, err
	}
	e, err := repairExecutionByID(ctx, tx, s.ExecutionID)
	if err != nil {
		return e, err
	}
	if err = tx.Commit(ctx); err != nil {
		return e, err
	}
	return e, nil
}

func repairPreviewByID(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, projectID, programID, id string) (billingmigration.RepairPreview, error) {
	var p billingmigration.RepairPreview
	var before, after, preview, caseD, policy, scope []byte
	err := q.QueryRow(ctx, `SELECT id,case_id,program_id,project_id,repair_kind,scope_kind,reason,scope_references,affected_count,expected_program_state_version,before_digest,after_digest,preview_digest,expected_case_digest,expected_policy_digest,expected_scope_digest,created_at,expires_at FROM billing_migration_repair_previews WHERE id=$1 AND program_id=$2 AND project_id=$3`, id, programID, projectID).Scan(&p.PreviewID, &p.CaseID, &p.ProgramID, &p.ProjectID, &p.RepairKind, &p.ScopeKind, &p.Reason, &p.ScopeReferences, &p.AffectedCount, &p.ExpectedStateVersion, &before, &after, &preview, &caseD, &policy, &scope, &p.CreatedAt, &p.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, billingmigration.ErrNotFound
	}
	p.BeforeDigest = billingmigration.FormatDigest(before)
	p.AfterDigest = billingmigration.FormatDigest(after)
	p.PreviewDigest = billingmigration.FormatDigest(preview)
	p.CaseDigest = billingmigration.FormatDigest(caseD)
	p.PolicyDigest = billingmigration.FormatDigest(policy)
	p.ScopeDigest = billingmigration.FormatDigest(scope)
	return p, err
}
func repairExecutionByID(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, id string) (billingmigration.RepairExecution, error) {
	var e billingmigration.RepairExecution
	var before, after, result []byte
	err := q.QueryRow(ctx, `SELECT id,preview_id,program_id,result,COALESCE(error_code,''),actual_before_digest,actual_after_digest,result_digest,attempt_number,executed_at FROM billing_migration_repair_executions WHERE id=$1`, id).Scan(&e.ExecutionID, &e.PreviewID, &e.ProgramID, &e.Result, &e.ErrorCode, &before, &after, &result, &e.AttemptNumber, &e.ExecutedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return e, billingmigration.ErrConflict
	}
	e.BeforeDigest = billingmigration.FormatDigest(before)
	e.AfterDigest = billingmigration.FormatDigest(after)
	e.ResultDigest = billingmigration.FormatDigest(result)
	return e, err
}
