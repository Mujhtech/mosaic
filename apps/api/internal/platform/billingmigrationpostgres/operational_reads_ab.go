package billingmigrationpostgres

import (
	"context"
	"errors"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/jackc/pgx/v5"
)

func cursorClause(cursorValue string, atColumn, idColumn string, args *[]any) (string, error) {
	cursor, err := decodeOperationalCursor(cursorValue)
	if err != nil {
		return "", err
	}
	if cursor.At.IsZero() {
		return "", nil
	}
	start := len(*args) + 1
	*args = append(*args, cursor.At, cursor.ID)
	return " AND (" + atColumn + "," + idColumn + ")<($" + itoa(start) + ",$" + itoa(start+1) + ")", nil
}
func itoa(value int) string {
	const digits = "0123456789"
	if value < 10 {
		return string(digits[value])
	}
	return string(digits[value/10]) + string(digits[value%10])
}
func pageCursor(at time.Time, id string) string {
	return encodeOperationalCursor(at, id)
}

func (r *Repository) ListSourcePullJobs(ctx context.Context, projectID, programID, cursor string, limit int) (billingmigration.SourcePullJobPage, error) {
	args := []any{projectID, programID}
	clause, err := cursorClause(cursor, "j.created_at", "j.id", &args)
	if err != nil {
		return billingmigration.SourcePullJobPage{}, err
	}
	args = append(args, limit+1)
	rows, err := r.pool.Query(ctx, `SELECT j.id,j.project_id,j.program_id,j.intent,j.status,j.starting_cursor,j.starting_watermark,coalesce(j.predecessor_pull_job_id,''),coalesce(j.result_source_object_id,''),coalesce(j.result_manifest_id,''),coalesce(j.result_import_batch_id,''),coalesce(j.result_final_delta_job_id,''),coalesce(i.status,''),coalesce(j.last_error_code,''),j.expected_program_state_version,j.attempt_count,j.max_attempts,j.created_at,j.updated_at,j.started_at,j.completed_at,j.failed_at FROM billing_migration_source_pull_jobs j LEFT JOIN billing_migration_import_batches i ON i.id=j.result_import_batch_id WHERE j.project_id=$1 AND j.program_id=$2`+clause+` ORDER BY j.created_at DESC,j.id DESC LIMIT $`+itoa(len(args)), args...)
	if err != nil {
		return billingmigration.SourcePullJobPage{}, err
	}
	defer rows.Close()
	page := billingmigration.SourcePullJobPage{Items: make([]billingmigration.SourcePullJob, 0, limit)}
	for rows.Next() {
		var j billingmigration.SourcePullJob
		var started, completed, failed *time.Time
		if err = rows.Scan(&j.ID, &j.ProjectID, &j.ProgramID, &j.Intent, &j.Status, &j.StartingCursor, &j.StartingWatermark, &j.PredecessorPullJobID, &j.ResultSourceObjectID, &j.ResultManifestID, &j.ResultImportBatchID, &j.ResultFinalDeltaJobID, &j.ResultImportStatus, &j.FailureCode, &j.ExpectedStateVersion, &j.AttemptCount, &j.MaxAttempts, &j.CreatedAt, &j.UpdatedAt, &started, &completed, &failed); err != nil {
			return page, err
		}
		if started != nil {
			j.StartedAt = *started
		}
		if completed != nil {
			j.CompletedAt = *completed
		}
		if failed != nil {
			j.FailedAt = *failed
		}
		page.Items = append(page.Items, j)
	}
	if err = rows.Err(); err != nil {
		return page, err
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		last := page.Items[limit-1]
		page.NextCursor = pageCursor(last.CreatedAt, last.ID)
	}
	return page, nil
}
func (r *Repository) SourcePullJob(ctx context.Context, projectID, programID, id string) (billingmigration.SourcePullJob, error) {
	page, err := r.ListSourcePullJobs(ctx, projectID, programID, "", 100)
	if err != nil {
		return billingmigration.SourcePullJob{}, err
	}
	for _, j := range page.Items {
		if j.ID == id {
			return j, nil
		}
	}
	return billingmigration.SourcePullJob{}, billingmigration.ErrNotFound
}

func (r *Repository) ListProposals(ctx context.Context, p, program, cursor string, limit int) (billingmigration.ProposalPage, error) {
	args := []any{p, program}
	clause, e := cursorClause(cursor, "proposed_at", "id", &args)
	if e != nil {
		return billingmigration.ProposalPage{}, e
	}
	args = append(args, limit+1)
	rows, e := r.pool.Query(ctx, `SELECT id,proposed_at FROM billing_migration_cutover_proposals WHERE project_id=$1 AND program_id=$2`+clause+` ORDER BY proposed_at DESC,id DESC LIMIT $`+itoa(len(args)), args...)
	if e != nil {
		return billingmigration.ProposalPage{}, e
	}
	defer rows.Close()
	type key struct {
		id string
		at time.Time
	}
	var keys []key
	for rows.Next() {
		var k key
		if e = rows.Scan(&k.id, &k.at); e != nil {
			return billingmigration.ProposalPage{}, e
		}
		keys = append(keys, k)
	}
	page := billingmigration.ProposalPage{}
	for _, k := range keys {
		item, x := r.Proposal(ctx, p, program, k.id)
		if x != nil {
			return page, x
		}
		page.Items = append(page.Items, item)
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		k := keys[limit-1]
		page.NextCursor = pageCursor(k.at, k.id)
	}
	return page, rows.Err()
}
func (r *Repository) ReadProposal(ctx context.Context, p, program, id string) (billingmigration.CutoverProposal, error) {
	return r.Proposal(ctx, p, program, id)
}

const approvalReadSelect = `SELECT id,program_id,state_version,command,proposer_actor_id,approver_actor_id,approval_digest,approved_at,expires_at FROM billing_migration_approvals`

func scanApproval(row pgx.Row) (billingmigration.MigrationApproval, error) {
	var a billingmigration.MigrationApproval
	var d []byte
	e := row.Scan(&a.ApprovalID, &a.ProgramID, &a.StateVersion, &a.Command, &a.ProposerActorID, &a.ApproverActorID, &d, &a.ApprovedAt, &a.ExpiresAt)
	if errors.Is(e, pgx.ErrNoRows) {
		e = billingmigration.ErrNotFound
	}
	a.ApprovalDigest = billingmigration.FormatDigest(d)
	return a, e
}
func (r *Repository) ListApprovals(ctx context.Context, p, program, cursor string, limit int) (billingmigration.ApprovalPage, error) {
	args := []any{p, program}
	clause, e := cursorClause(cursor, "approved_at", "id", &args)
	if e != nil {
		return billingmigration.ApprovalPage{}, e
	}
	args = append(args, limit+1)
	rows, e := r.pool.Query(ctx, approvalReadSelect+` WHERE project_id=$1 AND program_id=$2`+clause+` ORDER BY approved_at DESC,id DESC LIMIT $`+itoa(len(args)), args...)
	if e != nil {
		return billingmigration.ApprovalPage{}, e
	}
	defer rows.Close()
	page := billingmigration.ApprovalPage{}
	for rows.Next() {
		a, x := scanApproval(rows)
		if x != nil {
			return page, x
		}
		page.Items = append(page.Items, a)
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		a := page.Items[limit-1]
		page.NextCursor = pageCursor(a.ApprovedAt, a.ApprovalID)
	}
	return page, rows.Err()
}
func (r *Repository) Approval(ctx context.Context, p, program, id string) (billingmigration.MigrationApproval, error) {
	return scanApproval(r.pool.QueryRow(ctx, approvalReadSelect+` WHERE project_id=$1 AND program_id=$2 AND id=$3`, p, program, id))
}

func (r *Repository) ListCheckpoints(ctx context.Context, p, program, cursor string, limit int) (billingmigration.CheckpointPage, error) {
	args := []any{p, program}
	clause, e := cursorClause(cursor, "c.created_at", "c.id", &args)
	if e != nil {
		return billingmigration.CheckpointPage{}, e
	}
	args = append(args, limit+1)
	rows, e := r.pool.Query(ctx, checkpointSelect+` WHERE c.project_id=$1 AND c.program_id=$2`+clause+` ORDER BY c.created_at DESC,c.id DESC LIMIT $`+itoa(len(args)), args...)
	if e != nil {
		return billingmigration.CheckpointPage{}, e
	}
	defer rows.Close()
	page := billingmigration.CheckpointPage{}
	for rows.Next() {
		var c billingmigration.MigrationCheckpoint
		if e = scanCheckpoint(rows, &c); e != nil {
			return page, e
		}
		page.Items = append(page.Items, c)
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		c := page.Items[limit-1]
		page.NextCursor = pageCursor(c.CreatedAt, c.CheckpointID)
	}
	return page, rows.Err()
}
func (r *Repository) Checkpoint(ctx context.Context, p, program, id string) (billingmigration.MigrationCheckpoint, error) {
	var c billingmigration.MigrationCheckpoint
	e := scanCheckpoint(r.pool.QueryRow(ctx, checkpointSelect+` WHERE c.project_id=$1 AND c.program_id=$2 AND c.id=$3`, p, program, id), &c)
	if errors.Is(e, pgx.ErrNoRows) {
		e = billingmigration.ErrNotFound
	}
	return c, e
}
func (r *Repository) LatestCheckpoint(ctx context.Context, p, program string) (billingmigration.MigrationCheckpoint, error) {
	var c billingmigration.MigrationCheckpoint
	e := scanCheckpoint(r.pool.QueryRow(ctx, checkpointSelect+` WHERE c.project_id=$1 AND c.program_id=$2 ORDER BY c.created_at DESC,c.id DESC LIMIT 1`, p, program), &c)
	if errors.Is(e, pgx.ErrNoRows) {
		e = billingmigration.ErrNotFound
	}
	return c, e
}

func (r *Repository) ListAuthorityExecutions(ctx context.Context, p, program, cursor string, limit int) (billingmigration.AuthorityExecutionPage, error) {
	args := []any{p, program}
	clause, e := cursorClause(cursor, "created_at", "resource_id", &args)
	if e != nil {
		return billingmigration.AuthorityExecutionPage{}, e
	}
	args = append(args, limit+1)
	rows, e := r.pool.Query(ctx, `SELECT resource_id,replace(command_kind,'execute_',''),created_at FROM billing_migration_command_idempotency WHERE project_id=$1 AND program_id=$2 AND command_kind IN('execute_cutover','execute_rollback')`+clause+` ORDER BY created_at DESC,resource_id DESC LIMIT $`+itoa(len(args)), args...)
	if e != nil {
		return billingmigration.AuthorityExecutionPage{}, e
	}
	defer rows.Close()
	page := billingmigration.AuthorityExecutionPage{}
	for rows.Next() {
		var a billingmigration.AuthorityExecution
		if e = rows.Scan(&a.ExecutionID, &a.Command, &a.ExecutedAt); e != nil {
			return page, e
		}
		a.ProgramID = program
		a.State = "executed"
		page.Items = append(page.Items, a)
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		a := page.Items[limit-1]
		page.NextCursor = pageCursor(a.ExecutedAt, a.ExecutionID)
	}
	return page, rows.Err()
}
func (r *Repository) AuthorityExecution(ctx context.Context, p, program, id string) (billingmigration.AuthorityExecution, error) {
	var a billingmigration.AuthorityExecution
	e := r.pool.QueryRow(ctx, `SELECT resource_id,replace(command_kind,'execute_',''),created_at FROM billing_migration_command_idempotency WHERE project_id=$1 AND program_id=$2 AND resource_id=$3 AND command_kind IN('execute_cutover','execute_rollback')`, p, program, id).Scan(&a.ExecutionID, &a.Command, &a.ExecutedAt)
	if errors.Is(e, pgx.ErrNoRows) {
		e = billingmigration.ErrNotFound
	}
	a.ProgramID = program
	a.State = "executed"
	return a, e
}
