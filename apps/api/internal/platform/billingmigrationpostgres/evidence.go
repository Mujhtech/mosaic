package billingmigrationpostgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
)

var _ billingmigration.EvidenceRepository = (*Repository)(nil)

func (r *Repository) AppendManifest(ctx context.Context, expectedStateVersion int64, write billingmigration.ManifestWrite) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin migration manifest: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := requireProgramVersionStateTx(ctx, tx, write.ProjectID, write.Manifest.ProgramID, expectedStateVersion,
		billingmigration.StateMapping, billingmigration.StateImporting, billingmigration.StateDryRun, billingmigration.StateShadowing); err != nil {
		return err
	}
	manifest := write.Manifest
	command, err := tx.Exec(ctx, `INSERT INTO billing_migration_source_manifests(
		id,program_id,project_id,state_version,adapter_version,provider_api_version,schema_version,
		record_count,current_access_record_count,object_key,object_checksum,object_size_bytes,
		object_encryption,manifest_digest,source_watermark,captured_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'AES-256-GCM',$13,$14,$15)`,
		manifest.ManifestID, manifest.ProgramID, write.ProjectID, manifest.StateVersion,
		manifest.AdapterVersion, manifest.ProviderAPIVersion, manifest.SchemaVersion,
		manifest.RecordCount, manifest.CurrentAccessRecordCount, write.ObjectKey, write.ObjectChecksum,
		write.ObjectSizeBytes, write.ManifestDigest, write.SourceWatermark, manifest.CapturedAt)
	if err != nil {
		return translate(err, "insert migration manifest")
	}
	if command.RowsAffected() != 1 {
		return billingmigration.ErrConflict
	}
	return tx.Commit(ctx)
}

func (r *Repository) ListManifests(ctx context.Context, projectID, programID string, limit int) ([]billingmigration.SourceManifest, error) {
	rows, err := r.pool.Query(ctx, `SELECT program_id,state_version,id,adapter_version,provider_api_version,
		schema_version,record_count,current_access_record_count,object_checksum,manifest_digest,captured_at
		FROM billing_migration_source_manifests WHERE project_id=$1 AND program_id=$2
		ORDER BY captured_at DESC,id LIMIT $3`, projectID, programID, limit)
	if err != nil {
		return nil, fmt.Errorf("list migration manifests: %w", err)
	}
	defer rows.Close()
	items := make([]billingmigration.SourceManifest, 0)
	for rows.Next() {
		var item billingmigration.SourceManifest
		var checksum, manifestDigest []byte
		if err := rows.Scan(&item.ProgramID, &item.StateVersion, &item.ManifestID, &item.AdapterVersion,
			&item.ProviderAPIVersion, &item.SchemaVersion, &item.RecordCount, &item.CurrentAccessRecordCount,
			&checksum, &manifestDigest, &item.CapturedAt); err != nil {
			return nil, err
		}
		item.ObjectChecksum, item.ManifestDigest = billingmigration.FormatDigest(checksum), billingmigration.FormatDigest(manifestDigest)
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *Repository) CreateMappingSet(ctx context.Context, expectedStateVersion int64, write billingmigration.MappingSetWrite) error {
	if len(write.MappingSet.Entries) > 10000 {
		return billingmigration.ErrInvalid
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin mapping set: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := requireProgramVersionStateTx(ctx, tx, write.ProjectID, write.MappingSet.ProgramID, expectedStateVersion, billingmigration.StateMapping); err != nil {
		return err
	}
	mapping := write.MappingSet
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_mapping_sets(
		id,program_id,project_id,version,status,mapping_digest,expected_program_state_version,
		created_by_actor_id,created_at,frozen_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL)`,
		mapping.MappingSetID, mapping.ProgramID, write.ProjectID, mapping.Version, "draft",
		write.MappingDigest, expectedStateVersion, write.ActorID, write.CreatedAt)
	if err != nil {
		return translate(err, "insert migration mapping set")
	}
	for index, entry := range mapping.Entries {
		_, err := tx.Exec(ctx, `INSERT INTO billing_migration_mapping_entries(
			id,mapping_set_id,program_id,project_id,source_kind,source_identifier,target_id,
			match_kind,application_id,platform,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL,$9)`,
			fmt.Sprintf("mme_%s_%d", mapping.MappingSetID, index), mapping.MappingSetID, mapping.ProgramID,
			write.ProjectID, entry.SourceKind, entry.SourceIdentifier, entry.TargetID, entry.MatchKind, write.CreatedAt)
		if err != nil {
			return translate(err, "insert migration mapping entry")
		}
	}
	return tx.Commit(ctx)
}

func (r *Repository) FreezeMappingSet(ctx context.Context, projectID, programID, mappingSetID string, expectedStateVersion int64, at time.Time) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := requireProgramVersionStateTx(ctx, tx, projectID, programID, expectedStateVersion, billingmigration.StateMapping); err != nil {
		return err
	}
	command, err := tx.Exec(ctx, `UPDATE billing_migration_mapping_sets SET status='frozen',frozen_at=$4
		WHERE id=$1 AND program_id=$2 AND project_id=$3 AND status='draft'`, mappingSetID, programID, projectID, at)
	if err != nil {
		return translate(err, "freeze migration mapping set")
	}
	if command.RowsAffected() != 1 {
		return billingmigration.ErrConflict
	}
	command, err = tx.Exec(ctx, `UPDATE billing_migration_programs SET state=$4,state_version=state_version+1,updated_at=$5
		WHERE id=$1 AND project_id=$2 AND state_version=$3 AND state='mapping'`, programID, projectID, expectedStateVersion, billingmigration.StateImporting, at)
	if err != nil {
		return translate(err, "advance migration to importing")
	}
	if command.RowsAffected() != 1 {
		return billingmigration.ErrConflict
	}
	return tx.Commit(ctx)
}

func (r *Repository) ListMappingSets(ctx context.Context, projectID, programID string, limit int) ([]billingmigration.MappingSet, error) {
	rows, err := r.pool.Query(ctx, `SELECT id,version,status,mapping_digest,expected_program_state_version
		FROM billing_migration_mapping_sets WHERE project_id=$1 AND program_id=$2 ORDER BY version DESC LIMIT $3`, projectID, programID, limit)
	if err != nil {
		return nil, fmt.Errorf("list migration mapping sets: %w", err)
	}
	items := make([]billingmigration.MappingSet, 0)
	for rows.Next() {
		var item billingmigration.MappingSet
		var mappingDigest []byte
		item.ProgramID = programID
		if err := rows.Scan(&item.MappingSetID, &item.Version, &item.Status, &mappingDigest, &item.StateVersion); err != nil {
			return nil, err
		}
		item.MappingDigest = billingmigration.FormatDigest(mappingDigest)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	for index := range items {
		entryRows, err := r.pool.Query(ctx, `SELECT source_kind,source_identifier,target_id,match_kind
			FROM billing_migration_mapping_entries WHERE mapping_set_id=$1 ORDER BY source_kind,source_identifier,id`, items[index].MappingSetID)
		if err != nil {
			return nil, err
		}
		for entryRows.Next() {
			var entry billingmigration.MappingEntry
			if err := entryRows.Scan(&entry.SourceKind, &entry.SourceIdentifier, &entry.TargetID, &entry.MatchKind); err != nil {
				entryRows.Close()
				return nil, err
			}
			items[index].Entries = append(items[index].Entries, entry)
		}
		if err := entryRows.Err(); err != nil {
			entryRows.Close()
			return nil, err
		}
		entryRows.Close()
	}
	return items, nil
}

func (r *Repository) CreateImportBatch(ctx context.Context, expectedStateVersion int64, write billingmigration.ImportBatchWrite) (bool, error) {
	if write.Batch.RecordCount < 0 || write.Batch.RecordCount > 1000 {
		return false, billingmigration.ErrInvalid
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("begin migration import batch: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := requireProgramVersionStateTx(ctx, tx, write.ProjectID, write.Batch.ProgramID, expectedStateVersion, billingmigration.StateImporting); err != nil {
		return false, err
	}
	batch := write.Batch
	command, err := tx.Exec(ctx, `INSERT INTO billing_migration_import_batches(
		id,program_id,project_id,manifest_id,mapping_set_id,idempotency_key,request_digest,
		expected_program_state_version,status,record_count,validated_count,quarantined_count,
		cursor_before,cursor_after,attempt_count,created_at,updated_at,due_at,max_attempts)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,0,0,$10,'',0,$11,$11,$11,8)
		ON CONFLICT (program_id,idempotency_key) DO NOTHING`,
		batch.BatchID, batch.ProgramID, write.ProjectID, write.ManifestID, write.MappingSetID,
		batch.IdempotencyKey, write.RequestDigest, expectedStateVersion, batch.RecordCount,
		write.CursorBefore, write.CreatedAt)
	if err != nil {
		return false, translate(err, "insert migration import batch")
	}
	if command.RowsAffected() == 1 {
		return false, tx.Commit(ctx)
	}
	var existing []byte
	readErr := tx.QueryRow(ctx, `SELECT request_digest FROM billing_migration_import_batches
		WHERE program_id=$1 AND idempotency_key=$2`, batch.ProgramID, batch.IdempotencyKey).Scan(&existing)
	if readErr == nil && string(existing) == string(write.RequestDigest) {
		return true, tx.Commit(ctx)
	}
	return false, billingmigration.ErrConflict
}

func (r *Repository) ListImportBatches(ctx context.Context, projectID, programID string, limit int) ([]billingmigration.ImportBatch, error) {
	rows, err := r.pool.Query(ctx, `SELECT program_id,expected_program_state_version,id,idempotency_key,status,
		record_count,validated_count,quarantined_count FROM billing_migration_import_batches
		WHERE project_id=$1 AND program_id=$2 ORDER BY created_at DESC,id LIMIT $3`, projectID, programID, limit)
	if err != nil {
		return nil, fmt.Errorf("list migration import batches: %w", err)
	}
	defer rows.Close()
	items := make([]billingmigration.ImportBatch, 0)
	for rows.Next() {
		var item billingmigration.ImportBatch
		if err := rows.Scan(&item.ProgramID, &item.StateVersion, &item.BatchID, &item.IdempotencyKey, &item.Status, &item.RecordCount, &item.ValidatedCount, &item.QuarantinedCount); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *Repository) ImportBatch(ctx context.Context, projectID, programID, batchID string) (billingmigration.ImportBatch, error) {
	return r.readImportBatch(ctx, projectID, programID, "id", batchID)
}

func (r *Repository) ImportBatchByIdempotency(ctx context.Context, projectID, programID, key string) (billingmigration.ImportBatch, error) {
	return r.readImportBatch(ctx, projectID, programID, "idempotency_key", key)
}

func (r *Repository) readImportBatch(ctx context.Context, projectID, programID, column, value string) (billingmigration.ImportBatch, error) {
	var item billingmigration.ImportBatch
	query := `SELECT program_id,expected_program_state_version,id,idempotency_key,status,
		record_count,validated_count,quarantined_count FROM billing_migration_import_batches
		WHERE project_id=$1 AND program_id=$2 AND ` + column + `=$3`
	err := r.pool.QueryRow(ctx, query, projectID, programID, value).
		Scan(&item.ProgramID, &item.StateVersion, &item.BatchID, &item.IdempotencyKey, &item.Status, &item.RecordCount, &item.ValidatedCount, &item.QuarantinedCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return item, billingmigration.ErrNotFound
	}
	if err != nil {
		return item, fmt.Errorf("read migration import batch: %w", err)
	}
	return item, nil
}

func (r *Repository) LeaseImportBatch(ctx context.Context, workerID string, now, leaseUntil time.Time) (billingmigration.ImportBatch, bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billingmigration.ImportBatch{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var batch billingmigration.ImportBatch
	err = tx.QueryRow(ctx, `SELECT id,program_id,expected_program_state_version,idempotency_key,
		status,record_count,validated_count,quarantined_count,lease_generation FROM billing_migration_import_batches
		WHERE status='pending' OR (status='running' AND lease_expires_at <= $1)
		ORDER BY updated_at,id FOR UPDATE SKIP LOCKED LIMIT 1`, now).
		Scan(&batch.BatchID, &batch.ProgramID, &batch.StateVersion, &batch.IdempotencyKey,
			&batch.Status, &batch.RecordCount, &batch.ValidatedCount, &batch.QuarantinedCount, &batch.LeaseGeneration)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingmigration.ImportBatch{}, false, nil
	}
	if err != nil {
		return billingmigration.ImportBatch{}, false, err
	}
	_, err = tx.Exec(ctx, `UPDATE billing_migration_import_batches SET status='running',lease_owner=$2,
		lease_expires_at=$3,attempt_count=attempt_count+1,lease_generation=lease_generation+1,updated_at=$1 WHERE id=$4`, now, workerID, leaseUntil, batch.BatchID)
	if err != nil {
		return billingmigration.ImportBatch{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return billingmigration.ImportBatch{}, false, err
	}
	batch.Status = "running"
	batch.LeaseGeneration++
	return batch, true, nil
}

func (r *Repository) CompleteImportBatch(ctx context.Context, projectID, programID, batchID, workerID string, leaseGeneration int64, cursorAfter string, validated, quarantined int, now time.Time) error {
	command, err := r.pool.Exec(ctx, `UPDATE billing_migration_import_batches SET status='completed',
		validated_count=$6,quarantined_count=$7,cursor_after=$8,lease_owner=NULL,lease_expires_at=NULL,updated_at=$9
		WHERE id=$1 AND program_id=$2 AND project_id=$3 AND status='running' AND lease_owner=$4
		AND lease_generation=$5 AND lease_expires_at > $9 AND $6::integer+$7::integer <= record_count`, batchID, programID, projectID,
		workerID, leaseGeneration, validated, quarantined, cursorAfter, now)
	if err != nil {
		return translate(err, "complete migration import batch")
	}
	if command.RowsAffected() != 1 {
		return billingmigration.ErrConflict
	}
	return nil
}

func (r *Repository) QueueRun(ctx context.Context, expectedStateVersion int64, write billingmigration.RunJobWrite) (bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var existingDigest []byte
	replayErr := tx.QueryRow(ctx, `SELECT request_digest FROM billing_migration_run_jobs
		WHERE program_id=$1 AND project_id=$2 AND idempotency_key=$3`, write.Job.ProgramID, write.ProjectID, write.IdempotencyKey).Scan(&existingDigest)
	if replayErr == nil {
		if string(existingDigest) != string(write.RequestDigest) {
			return false, billingmigration.ErrConflict
		}
		return true, tx.Commit(ctx)
	}
	if !errors.Is(replayErr, pgx.ErrNoRows) {
		return false, replayErr
	}
	allowedState, nextState := billingmigration.StateImporting, billingmigration.StateDryRun
	allowedStates := []string{billingmigration.StateImporting, billingmigration.StateDryRun}
	if write.Job.RunKind == "shadow" {
		allowedState, nextState = billingmigration.StateDryRun, billingmigration.StateShadowing
		allowedStates = []string{billingmigration.StateDryRun, billingmigration.StateShadowing}
	}
	if err := requireProgramVersionStateTx(ctx, tx, write.ProjectID, write.Job.ProgramID, expectedStateVersion, allowedStates...); err != nil {
		return false, err
	}
	command, err := tx.Exec(ctx, `INSERT INTO billing_migration_run_jobs(id,program_id,project_id,run_kind,idempotency_key,
		request_digest,expected_program_state_version,manifest_digest,mapping_digest,policy_digest,status,created_at,updated_at,due_at,max_attempts)
		SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$11,$11,8
		WHERE EXISTS(SELECT 1 FROM billing_migration_source_manifests WHERE program_id=$2 AND project_id=$3 AND manifest_digest=$8)
		AND EXISTS(SELECT 1 FROM billing_migration_mapping_sets WHERE program_id=$2 AND project_id=$3 AND mapping_digest=$9 AND status='frozen')
		AND EXISTS(SELECT 1 FROM billing_migration_programs WHERE id=$2 AND project_id=$3 AND policy_digest=$10)
		ON CONFLICT(program_id,idempotency_key) DO NOTHING`,
		write.Job.RunJobID, write.Job.ProgramID, write.ProjectID, write.Job.RunKind, write.IdempotencyKey, write.RequestDigest,
		expectedStateVersion, write.ManifestDigest, write.MappingDigest, write.PolicyDigest, write.CreatedAt)
	if err != nil {
		return false, translate(err, "queue migration run")
	}
	if command.RowsAffected() == 1 {
		transition, transitionErr := tx.Exec(ctx, `UPDATE billing_migration_programs SET state=$4,state_version=state_version+1,updated_at=$5
			WHERE id=$1 AND project_id=$2 AND state_version=$3 AND state=$6`, write.Job.ProgramID, write.ProjectID,
			expectedStateVersion, nextState, write.CreatedAt, allowedState)
		if transitionErr != nil {
			return false, translate(transitionErr, "advance migration run state")
		}
		if transition.RowsAffected() == 0 {
			if err := requireProgramVersionStateTx(ctx, tx, write.ProjectID, write.Job.ProgramID, expectedStateVersion, nextState); err != nil {
				return false, err
			}
		}
		return false, tx.Commit(ctx)
	}
	return false, billingmigration.ErrInvalid
}

func (r *Repository) RunJob(ctx context.Context, projectID, programID, jobID string) (billingmigration.RunJob, error) {
	return r.readRunJob(ctx, projectID, programID, "id", jobID)
}

func (r *Repository) RunJobByIdempotency(ctx context.Context, projectID, programID, key string) (billingmigration.RunJob, error) {
	return r.readRunJob(ctx, projectID, programID, "idempotency_key", key)
}

func (r *Repository) readRunJob(ctx context.Context, projectID, programID, column, value string) (billingmigration.RunJob, error) {
	var item billingmigration.RunJob
	var result *string
	query := `SELECT program_id,expected_program_state_version,id,run_kind,status,result_run_id
		FROM billing_migration_run_jobs WHERE project_id=$1 AND program_id=$2 AND ` + column + `=$3`
	err := r.pool.QueryRow(ctx, query, projectID, programID, value).
		Scan(&item.ProgramID, &item.StateVersion, &item.RunJobID, &item.RunKind, &item.Status, &result)
	if errors.Is(err, pgx.ErrNoRows) {
		return item, billingmigration.ErrNotFound
	}
	if err != nil {
		return item, err
	}
	if result != nil {
		item.ResultRunID = *result
	}
	return item, nil
}

func (r *Repository) RecordRun(ctx context.Context, expectedStateVersion int64, write billingmigration.RunWrite) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := requireProgramVersionStateTx(ctx, tx, write.ProjectID, write.Run.ProgramID, expectedStateVersion,
		billingmigration.StateDryRun, billingmigration.StateShadowing); err != nil {
		return err
	}
	run := write.Run
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_runs(id,program_id,project_id,run_kind,state_version,
		manifest_digest,mapping_digest,policy_digest,source_watermark,provider_watermark,shadow_watermark,
		critical_count,blocking_count,warning_count,informational_count,run_digest,completed_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
		run.RunID, run.ProgramID, write.ProjectID, run.RunKind, run.StateVersion,
		write.ManifestDigest, write.MappingDigest, write.PolicyDigest, write.SourceWatermark,
		write.ProviderWatermark, write.ShadowWatermark, run.Divergences.Critical,
		run.Divergences.Blocking, run.Divergences.Warning, run.Divergences.Informational,
		write.RunDigest, run.CompletedAt)
	if err != nil {
		return translate(err, "insert migration run")
	}
	for _, item := range write.Divergences {
		divergence := item.Divergence
		_, err := tx.Exec(ctx, `INSERT INTO billing_migration_divergences(id,program_id,project_id,run_id,
			state_version,classification,reason,evidence_digest,classification_rule_version,observed_at)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, divergence.DivergenceID, divergence.ProgramID,
			write.ProjectID, run.RunID, divergence.StateVersion, divergence.Classification,
			divergence.Reason, item.EvidenceDigest, divergence.ClassificationRuleVersion, divergence.ObservedAt)
		if err != nil {
			return translate(err, "insert migration divergence")
		}
	}
	return tx.Commit(ctx)
}

func (r *Repository) ListDivergences(ctx context.Context, projectID, programID string, limit int) ([]billingmigration.Divergence, error) {
	rows, err := r.pool.Query(ctx, `SELECT program_id,state_version,id,classification,reason,observed_at,classification_rule_version
		FROM billing_migration_divergences WHERE project_id=$1 AND program_id=$2 ORDER BY observed_at DESC,id LIMIT $3`, projectID, programID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]billingmigration.Divergence, 0)
	for rows.Next() {
		var item billingmigration.Divergence
		if err := rows.Scan(&item.ProgramID, &item.StateVersion, &item.DivergenceID, &item.Classification, &item.Reason, &item.ObservedAt, &item.ClassificationRuleVersion); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *Repository) ReadinessInput(ctx context.Context, projectID, programID string) (billingmigration.ReadinessInput, error) {
	var input billingmigration.ReadinessInput
	err := r.pool.QueryRow(ctx, `WITH current_records AS (
		SELECT source_kind,source_identifier,evidence_kind FROM billing_migration_source_records WHERE project_id=$1 AND program_id=$2 AND current_access
	), frozen_mapping AS (SELECT id FROM billing_migration_mapping_sets WHERE project_id=$1 AND program_id=$2 AND status='frozen' ORDER BY version DESC LIMIT 1),
	latest_run AS (SELECT id FROM billing_migration_runs WHERE project_id=$1 AND program_id=$2 ORDER BY completed_at DESC,id LIMIT 1),
	counts AS (SELECT classification,count(*) count FROM billing_migration_divergences WHERE run_id=(SELECT id FROM latest_run) GROUP BY classification)
		SELECT CASE WHEN count(*)=0 THEN 0 ELSE 100.0*count(*) FILTER(WHERE EXISTS(
			SELECT 1 FROM billing_migration_mapping_entries e
			WHERE e.mapping_set_id=(SELECT id FROM frozen_mapping)
			AND e.source_identifier=current_records.source_identifier
			AND ((current_records.source_kind='customer' AND e.source_kind IN ('customer_id','original_customer_id'))
				OR (current_records.source_kind='alias' AND e.source_kind='audited_alias')
				OR (current_records.source_kind='subscription' AND e.source_kind IN ('product','entitlement'))
				OR (current_records.source_kind='transaction' AND e.source_kind='product')
				OR (current_records.source_kind='transfer' AND e.source_kind='audited_alias'))
		))/count(*) END,
		CASE WHEN count(*)=0 THEN 0 ELSE 100.0*count(*) FILTER(WHERE evidence_kind IN ('provider_signed','provider_validated'))/count(*) END,
		COALESCE((SELECT count FROM counts WHERE classification='critical'),0),COALESCE((SELECT count FROM counts WHERE classification='blocking'),0),COALESCE((SELECT count FROM counts WHERE classification='warning'),0),COALESCE((SELECT count FROM counts WHERE classification='informational'),0)
		FROM current_records`, projectID, programID).Scan(&input.CurrentAccessMappingPercent, &input.CurrentAccessEvidencePercent, &input.Unresolved.Critical, &input.Unresolved.Blocking, &input.Unresolved.Warning, &input.Unresolved.Informational)
	return input, err
}

func (r *Repository) RecordReadiness(ctx context.Context, expectedStateVersion int64, write billingmigration.ReadinessWrite) error {
	if len(write.Assessment.ReadinessDigest) < 16 {
		return billingmigration.ErrInvalid
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin migration readiness: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := requireProgramVersionStateTx(ctx, tx, write.ProjectID, write.Assessment.ProgramID, expectedStateVersion, billingmigration.StateShadowing); err != nil {
		return err
	}
	a := write.Assessment
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_readiness_assessments(id,program_id,project_id,
		state_version,ready,current_access_mapping_percent,current_access_evidence_percent,critical_count,
		blocking_count,warning_count,informational_count,final_delta_completed,watermarks_fresh,
		supported_versions_authority_aware,readiness_digest,assessed_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
		"mra_"+a.ReadinessDigest[:16], a.ProgramID, write.ProjectID, a.StateVersion, a.Ready,
		a.CurrentAccessMappingPercent, a.CurrentAccessEvidencePercent, a.Unresolved.Critical,
		a.Unresolved.Blocking, a.Unresolved.Warning, a.Unresolved.Informational, a.FinalDeltaCompleted,
		a.WatermarksFresh, a.SupportedVersionsAuthorityAware, write.ReadinessDigest, write.AssessedAt)
	if err != nil {
		return translate(err, "insert migration readiness")
	}
	return tx.Commit(ctx)
}

func (r *Repository) LatestReadiness(ctx context.Context, projectID, programID string) (billingmigration.ReadinessAssessment, error) {
	var a billingmigration.ReadinessAssessment
	var digest []byte
	err := r.pool.QueryRow(ctx, `SELECT program_id,state_version,ready,current_access_mapping_percent,current_access_evidence_percent,
		critical_count,blocking_count,warning_count,informational_count,final_delta_completed,watermarks_fresh,supported_versions_authority_aware,readiness_digest
		FROM billing_migration_readiness_assessments WHERE project_id=$1 AND program_id=$2 ORDER BY assessed_at DESC,id LIMIT 1`, projectID, programID).
		Scan(&a.ProgramID, &a.StateVersion, &a.Ready, &a.CurrentAccessMappingPercent, &a.CurrentAccessEvidencePercent, &a.Unresolved.Critical, &a.Unresolved.Blocking, &a.Unresolved.Warning, &a.Unresolved.Informational, &a.FinalDeltaCompleted, &a.WatermarksFresh, &a.SupportedVersionsAuthorityAware, &digest)
	if errors.Is(err, pgx.ErrNoRows) {
		return a, billingmigration.ErrNotFound
	}
	if err != nil {
		return a, err
	}
	a.ReadinessDigest = billingmigration.FormatDigest(digest)
	return a, nil
}

func requireProgramVersionStateTx(ctx context.Context, tx pgx.Tx, projectID, programID string, expected int64, allowedStates ...string) error {
	var state string
	err := tx.QueryRow(ctx, `SELECT state FROM billing_migration_programs WHERE id=$1 AND project_id=$2 AND state_version=$3 FOR UPDATE`, programID, projectID, expected).Scan(&state)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingmigration.ErrConflict
	}
	if err != nil {
		return fmt.Errorf("read migration program version: %w", err)
	}
	for _, allowed := range allowedStates {
		if state == allowed {
			return nil
		}
	}
	return billingmigration.ErrConflict
}
