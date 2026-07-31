package billingmigrationpostgres

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/jackc/pgx/v5"
)

var _ billingmigration.OperationsRepository = (*Repository)(nil)

func operationCommandReplay(ctx context.Context, tx pgx.Tx, programID, kind, key string, requestDigest []byte) (string, bool, error) {
	var resource string
	var stored []byte
	err := tx.QueryRow(ctx, `SELECT resource_id,request_digest FROM billing_migration_command_idempotency WHERE program_id=$1 AND command_kind=$2 AND idempotency_key=$3`, programID, kind, key).Scan(&resource, &stored)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("read operation idempotency: %w", err)
	}
	if !bytes.Equal(stored, requestDigest) {
		return "", false, billingmigration.ErrIdempotencyConflict
	}
	return resource, true, nil
}

func (r *Repository) CreateCase(ctx context.Context, w billingmigration.CaseWrite) (billingmigration.MigrationCase, bool, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return billingmigration.MigrationCase{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	resource, replay, err := operationCommandReplay(ctx, tx, w.Case.ProgramID, "create_case", w.IdempotencyKey, w.RequestDigest)
	if err != nil {
		return billingmigration.MigrationCase{}, false, err
	}
	if replay {
		c, err := caseByID(ctx, tx, w.Case.ProjectID, w.Case.ProgramID, resource)
		return c, true, err
	}
	var state int64
	var environment, organization string
	if err = tx.QueryRow(ctx, `SELECT p.state_version,p.environment_id,pr.organization_id FROM billing_migration_programs p JOIN projects pr ON pr.id=p.project_id WHERE p.id=$1 AND p.project_id=$2 FOR UPDATE`, w.Case.ProgramID, w.Case.ProjectID).Scan(&state, &environment, &organization); err != nil {
		return billingmigration.MigrationCase{}, false, translate(err, "lock program for case")
	}
	if state != w.ExpectedState {
		return billingmigration.MigrationCase{}, false, billingmigration.ErrStaleState
	}
	caseRaw, _ := billingmigration.ParseDigest(w.Case.CaseDigest)
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_cases(id,program_id,project_id,state_version,classification,status,reason,case_digest,opened_at,resolved_at,updated_at,linked_divergence_id,linked_source_record_id) VALUES($1,$2,$3,$4,$5,'open',$6,$7,$8,NULL,$8,NULLIF($9,''),NULLIF($10,''))`, w.Case.CaseID, w.Case.ProgramID, w.Case.ProjectID, w.Case.StateVersion, w.Case.Classification, w.Case.Reason, caseRaw, w.Case.OpenedAt, w.LinkedDivergence, w.LinkedRecord)
	if err != nil {
		return billingmigration.MigrationCase{}, false, translate(err, "insert migration case")
	}
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_command_idempotency(id,program_id,project_id,command_kind,idempotency_key,request_digest,resource_id,created_at) VALUES('mci_'||$1,$2,$3,'create_case',$4,$5,$1,$6)`, w.Case.CaseID, w.Case.ProgramID, w.Case.ProjectID, w.IdempotencyKey, w.RequestDigest, w.Case.OpenedAt)
	if err != nil {
		return billingmigration.MigrationCase{}, false, translate(err, "insert case idempotency")
	}
	metadata, _ := json.Marshal(map[string]any{"classification": w.Case.Classification})
	_, err = tx.Exec(ctx, `INSERT INTO audit_events(id,actor_id,organization_id,project_id,environment_id,action,resource_type,resource_id,metadata,created_at) VALUES('aud_'||$1,$2,$3,$4,$5,'billing.migration.case.created','billing_migration_case',$1,$6,$7)`, w.Case.CaseID, w.ActorID, organization, w.Case.ProjectID, environment, metadata, w.Case.OpenedAt)
	if err != nil {
		return billingmigration.MigrationCase{}, false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return billingmigration.MigrationCase{}, false, err
	}
	return w.Case, false, nil
}

func (r *Repository) TransitionCase(ctx context.Context, w billingmigration.CaseTransitionWrite) (billingmigration.MigrationCase, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return billingmigration.MigrationCase{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var current []byte
	var caseState int64
	var environment, organization string
	err = tx.QueryRow(ctx, `SELECT c.case_digest,c.state_version,p.environment_id,pr.organization_id FROM billing_migration_cases c JOIN billing_migration_programs p ON p.id=c.program_id JOIN projects pr ON pr.id=c.project_id WHERE c.id=$1 AND c.program_id=$2 AND c.project_id=$3 FOR UPDATE OF c`, w.CaseID, w.ProgramID, w.ProjectID).Scan(&current, &caseState, &environment, &organization)
	if err != nil {
		return billingmigration.MigrationCase{}, translate(err, "lock migration case")
	}
	if caseState != w.ExpectedStateVersion || !bytes.Equal(current, w.ExpectedCaseDigest) {
		return billingmigration.MigrationCase{}, billingmigration.ErrStaleDigest
	}
	var resolved any = nil
	if w.Status == "resolved" || w.Status == "dismissed" {
		resolved = w.At
	}
	tag, err := tx.Exec(ctx, `UPDATE billing_migration_cases SET status=$1,state_version=state_version+1,case_digest=$2,updated_at=$3,resolved_at=$4 WHERE id=$5 AND state_version=$6`, w.Status, w.NewCaseDigest, w.At, resolved, w.CaseID, w.ExpectedStateVersion)
	if err != nil || tag.RowsAffected() != 1 {
		if err == nil {
			return billingmigration.MigrationCase{}, billingmigration.ErrStaleState
		}
		return billingmigration.MigrationCase{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_case_actions(id,case_id,program_id,project_id,actor_id,action,before_digest,after_digest,created_at) VALUES('mca_'||substr(encode($1,'hex'),1,24),$2,$3,$4,$5,$6,$1,$7,$8)`, w.ExpectedCaseDigest, w.CaseID, w.ProgramID, w.ProjectID, w.ActorID, "transition:"+w.Status, w.NewCaseDigest, w.At)
	if err != nil {
		return billingmigration.MigrationCase{}, translate(err, "append case action")
	}
	metadata, _ := json.Marshal(map[string]any{"status": w.Status, "reason": w.Reason})
	_, err = tx.Exec(ctx, `INSERT INTO audit_events(id,actor_id,organization_id,project_id,environment_id,action,resource_type,resource_id,metadata,created_at) VALUES('aud_mcase_'||substr(encode($1,'hex'),1,20),$2,$3,$4,$5,'billing.migration.case.transitioned','billing_migration_case',$6,$7,$8)`, w.NewCaseDigest, w.ActorID, organization, w.ProjectID, environment, w.CaseID, metadata, w.At)
	if err != nil {
		return billingmigration.MigrationCase{}, err
	}
	c, err := caseByID(ctx, tx, w.ProjectID, w.ProgramID, w.CaseID)
	if err != nil {
		return c, err
	}
	if err = tx.Commit(ctx); err != nil {
		return c, err
	}
	return c, nil
}

func caseByID(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, projectID, programID, caseID string) (billingmigration.MigrationCase, error) {
	var c billingmigration.MigrationCase
	var raw []byte
	err := q.QueryRow(ctx, `SELECT id,program_id,project_id,state_version,classification,status,reason,case_digest,opened_at,updated_at,resolved_at,COALESCE(linked_divergence_id,''),COALESCE(linked_source_record_id,'') FROM billing_migration_cases WHERE id=$1 AND program_id=$2 AND project_id=$3`, caseID, programID, projectID).Scan(&c.CaseID, &c.ProgramID, &c.ProjectID, &c.StateVersion, &c.Classification, &c.Status, &c.Reason, &raw, &c.OpenedAt, &c.UpdatedAt, &c.ResolvedAt, &c.LinkedDivergenceID, &c.LinkedSourceRecordID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, billingmigration.ErrNotFound
	}
	if err != nil {
		return c, err
	}
	c.CaseDigest = billingmigration.FormatDigest(raw)
	return c, nil
}
