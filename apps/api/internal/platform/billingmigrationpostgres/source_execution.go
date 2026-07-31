package billingmigrationpostgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
)

var _ billingmigration.SourceObjectRepository = (*Repository)(nil)
var _ billingmigration.SourceExecutionRepository = (*Repository)(nil)

func (r *Repository) ReserveSourceObject(ctx context.Context, write billingmigration.ReserveSourceObject) (billingmigration.SourceObject, bool, error) {
	o := write.SourceObject
	command, err := r.pool.Exec(ctx, `INSERT INTO billing_migration_source_objects(id,program_id,project_id,reservation_key,reservation_digest,reservation_generation,write_token_digest,object_key,source_channel,adapter_version,schema_version,state,reserved_at)
		SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'reserved',$12
		WHERE EXISTS(SELECT 1 FROM billing_migration_programs WHERE id=$2 AND project_id=$3)
		ON CONFLICT(program_id,reservation_key) DO NOTHING`, o.ObjectID, o.ProgramID, o.ProjectID, o.ReservationKey, o.ReservationDigest, o.ReservationGeneration, o.WriteTokenDigest, o.ObjectKey, o.SourceChannel, o.AdapterVersion, o.SchemaVersion, write.Now)
	if err != nil {
		return billingmigration.SourceObject{}, false, translate(err, "reserve migration source object")
	}
	var result billingmigration.SourceObject
	var envelopeVersion, chunkSize, chunkCount *int
	var algorithm, keyID, errorCode *string
	var verifiedAt *time.Time
	var nonce, aad, plainDigest, cipherDigest []byte
	var plainSize, cipherSize *int64
	err = r.pool.QueryRow(ctx, `SELECT id,program_id,project_id,reservation_key,reservation_digest,reservation_generation,write_token_digest,object_key,source_channel,adapter_version,schema_version,state,error_code,reserved_at,verified_at,envelope_version,algorithm,key_id,nonce,chunk_size,chunk_count,aad_digest,plaintext_digest,plaintext_size_bytes,ciphertext_digest,ciphertext_size_bytes FROM billing_migration_source_objects WHERE program_id=$1 AND project_id=$2 AND reservation_key=$3`, o.ProgramID, o.ProjectID, o.ReservationKey).Scan(&result.ObjectID, &result.ProgramID, &result.ProjectID, &result.ReservationKey, &result.ReservationDigest, &result.ReservationGeneration, &result.WriteTokenDigest, &result.ObjectKey, &result.SourceChannel, &result.AdapterVersion, &result.SchemaVersion, &result.State, &errorCode, &result.ReservedAt, &verifiedAt, &envelopeVersion, &algorithm, &keyID, &nonce, &chunkSize, &chunkCount, &aad, &plainDigest, &plainSize, &cipherDigest, &cipherSize)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, false, billingmigration.ErrInvalid
	}
	if err != nil {
		return result, false, err
	}
	if string(result.ReservationDigest) != string(o.ReservationDigest) || result.ObjectKey != o.ObjectKey || result.SourceChannel != o.SourceChannel || result.AdapterVersion != o.AdapterVersion || result.SchemaVersion != o.SchemaVersion {
		return result, false, billingmigration.ErrIdempotencyConflict
	}
	if errorCode != nil {
		result.ErrorCode = *errorCode
	}
	if verifiedAt != nil {
		result.VerifiedAt = *verifiedAt
	}
	if envelopeVersion != nil {
		result.Envelope = billingmigration.SourceObjectEnvelope{Version: *envelopeVersion, Algorithm: *algorithm, KeyID: *keyID, Nonce: nonce, ChunkSize: *chunkSize, ChunkCount: *chunkCount, AADDigest: aad, PlaintextDigest: plainDigest, PlaintextSize: *plainSize, CiphertextDigest: cipherDigest, CiphertextSize: *cipherSize}
	}
	return result, command.RowsAffected() == 0, nil
}

func (r *Repository) VerifySourceObject(ctx context.Context, write billingmigration.VerifySourceObject) error {
	e := write.Envelope
	command, err := r.pool.Exec(ctx, `UPDATE billing_migration_source_objects SET state='verified',envelope_version=$6,algorithm=$7,key_id=$8,nonce=$9,chunk_size=$10,chunk_count=$11,aad_digest=$12,plaintext_digest=$13,plaintext_size_bytes=$14,ciphertext_digest=$15,ciphertext_size_bytes=$16,verified_at=$17,error_code=NULL WHERE id=$1 AND program_id=$2 AND project_id=$3 AND state='reserved' AND reservation_generation=$4 AND write_token_digest=$5`, write.ObjectID, write.ProgramID, write.ProjectID, write.ReservationGeneration, write.WriteTokenDigest, e.Version, e.Algorithm, e.KeyID, e.Nonce, e.ChunkSize, e.ChunkCount, e.AADDigest, e.PlaintextDigest, e.PlaintextSize, e.CiphertextDigest, e.CiphertextSize, write.Now)
	if err != nil {
		return translate(err, "verify migration source object")
	}
	if command.RowsAffected() != 1 {
		return billingmigration.ErrConflict
	}
	return nil
}

func (r *Repository) FailSourceObject(ctx context.Context, projectID, programID, objectID, errorCode string, at time.Time) error {
	command, err := r.pool.Exec(ctx, `UPDATE billing_migration_source_objects SET state='failed',error_code=$4,failed_at=$5 WHERE id=$1 AND program_id=$2 AND project_id=$3 AND state='reserved'`, objectID, programID, projectID, errorCode, at)
	if err != nil {
		return translate(err, "fail migration source object")
	}
	if command.RowsAffected() != 1 {
		return billingmigration.ErrConflict
	}
	return nil
}

func (r *Repository) AppendVerifiedSource(ctx context.Context, write billingmigration.SourceObjectManifestWrite) error {
	currentAccess := int64(0)
	persistedRecordIDs := make(map[string]string, len(write.Records))
	for _, record := range write.Records {
		if record.CurrentAccess {
			currentAccess++
		}
	}
	if int64(len(write.Records)) != write.Manifest.Manifest.RecordCount || currentAccess != write.Manifest.Manifest.CurrentAccessRecordCount {
		return billingmigration.ErrInvalid
	}
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var objectKey string
	var checksum []byte
	var size int64
	err = tx.QueryRow(ctx, `SELECT object_key,plaintext_digest,plaintext_size_bytes FROM billing_migration_source_objects WHERE id=$1 AND program_id=$2 AND project_id=$3 AND state='verified' FOR UPDATE`, write.SourceObjectID, write.Manifest.Manifest.ProgramID, write.Manifest.ProjectID).Scan(&objectKey, &checksum, &size)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingmigration.ErrConflict
	}
	if err != nil {
		return err
	}
	if objectKey != write.Manifest.ObjectKey || string(checksum) != string(write.Manifest.ObjectChecksum) || size != write.Manifest.ObjectSizeBytes {
		return billingmigration.ErrStaleDigest
	}
	if err := requireProgramVersionStateTx(ctx, tx, write.Manifest.ProjectID, write.Manifest.Manifest.ProgramID, write.ExpectedStateVersion, billingmigration.StateMapping, billingmigration.StateImporting, billingmigration.StateDryRun, billingmigration.StateShadowing); err != nil {
		return err
	}
	m := write.Manifest.Manifest
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_source_manifests(id,program_id,project_id,state_version,adapter_version,provider_api_version,schema_version,record_count,current_access_record_count,object_key,object_checksum,object_size_bytes,object_encryption,manifest_digest,source_watermark,captured_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'AES-256-GCM',$13,$14,$15)`, m.ManifestID, m.ProgramID, write.Manifest.ProjectID, m.StateVersion, m.AdapterVersion, m.ProviderAPIVersion, m.SchemaVersion, m.RecordCount, m.CurrentAccessRecordCount, objectKey, checksum, size, write.Manifest.ManifestDigest, write.Manifest.SourceWatermark, m.CapturedAt)
	if err != nil {
		return translate(err, "append verified migration manifest")
	}
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_source_object_manifests(source_object_id,manifest_id,program_id,project_id,binding_digest,bound_at) VALUES($1,$2,$3,$4,$5,$6)`, write.SourceObjectID, m.ManifestID, m.ProgramID, write.Manifest.ProjectID, write.BindingDigest, write.Now)
	if err != nil {
		return translate(err, "bind migration source object")
	}
	for _, record := range write.Records {
		_, err = tx.Exec(ctx, `INSERT INTO billing_migration_source_records(id,program_id,project_id,manifest_id,source_kind,source_identifier,source_revision,source_cursor,record_digest,current_access,normalization_schema_version,evidence_kind,observed_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(program_id,source_kind,source_identifier,source_revision,record_digest) DO NOTHING`, record.ID, m.ProgramID, write.Manifest.ProjectID, m.ManifestID, record.SourceKind, record.SourceIdentifier, record.SourceRevision, record.SourceCursor, record.RecordDigest, record.CurrentAccess, record.NormalizationSchemaVersion, record.EvidenceKind, record.ObservedAt, record.CreatedAt)
		if err != nil {
			return translate(err, "append normalized migration source record")
		}
		var persistedID string
		err = tx.QueryRow(ctx, `SELECT id FROM billing_migration_source_records WHERE program_id=$1 AND source_kind=$2 AND source_identifier=$3 AND source_revision=$4 AND record_digest=$5`, m.ProgramID, record.SourceKind, record.SourceIdentifier, record.SourceRevision, record.RecordDigest).Scan(&persistedID)
		if err != nil {
			return err
		}
		persistedRecordIDs[record.ID] = persistedID
		entitlements := record.EntitlementIDs
		if entitlements == nil {
			entitlements = []string{}
		}
		_, err = tx.Exec(ctx, `INSERT INTO billing_migration_source_record_relationships(source_record_id,program_id,project_id,customer_source_identifier,product_source_identifier,entitlement_source_identifiers,external_application_id,store,provider_environment,store_identifier,mosaic_product_id,ownership,ownership_digest,quarantine_reason,relationship_digest,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16) ON CONFLICT(source_record_id) DO NOTHING`, persistedID, m.ProgramID, write.Manifest.ProjectID, nullIfEmpty(record.CustomerID), nullIfEmpty(record.ProductID), entitlements, nullIfEmpty(record.ExternalAppID), nullIfEmpty(record.Store), nullIfEmpty(record.SourceEnvironment), nullIfEmpty(record.StoreIdentifier), nullIfEmpty(record.TargetProductID), nullIfEmpty(string(record.Ownership)), record.OwnershipDigest, nullIfEmpty(record.QuarantineReason), relationshipDigest(record), record.CreatedAt)
		if err != nil {
			return translate(err, "append normalized migration source relationship")
		}
	}
	if work := write.ImportWork; work != nil {
		importCount := 0
		for _, record := range write.Records {
			if record.ProviderReference != nil && record.QuarantineReason == "" {
				importCount++
			}
		}
		if work.Batch.RecordCount != importCount {
			return billingmigration.ErrInvalid
		}
		_, err = tx.Exec(ctx, `INSERT INTO billing_migration_import_batches(id,program_id,project_id,manifest_id,mapping_set_id,idempotency_key,request_digest,expected_program_state_version,status,record_count,cursor_before,cursor_after,attempt_count,lease_generation,created_at,updated_at,due_at,max_attempts) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,'',0,0,$11,$11,$11,8)`, work.Batch.BatchID, work.Batch.ProgramID, work.ProjectID, work.ManifestID, work.MappingSetID, work.Batch.IdempotencyKey, work.RequestDigest, work.Batch.StateVersion, work.Batch.RecordCount, work.CursorBefore, work.CreatedAt)
		if err != nil {
			return translate(err, "queue verified migration import")
		}
		ordinal := 0
		for _, record := range write.Records {
			if record.ProviderReference == nil || record.QuarantineReason != "" {
				continue
			}
			ref := record.ProviderReference
			if (ref.Provider != "app_store" || ref.ReferenceKind != "app_store_transaction_id") &&
				(ref.Provider != "google_play" || ref.ReferenceKind != "google_play_order_id") {
				return billingmigration.ErrInvalid
			}
			_, err = tx.Exec(ctx, `INSERT INTO billing_migration_import_batch_records(import_batch_id,program_id,project_id,source_record_id,ordinal,provider,environment_id,application_id,provider_reference,reference_kind,source_product_identifier,mosaic_product_id,expected_store_product_identifier,expected_store_environment) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, work.Batch.BatchID, work.Batch.ProgramID, work.ProjectID, persistedRecordIDs[record.ID], ordinal, ref.Provider, ref.EnvironmentID, ref.ApplicationID, ref.Reference, ref.ReferenceKind, nullIfEmpty(ref.SourceProductID), nullIfEmpty(ref.TargetProductID), nullIfEmpty(ref.ExpectedStoreProductID), ref.ExpectedStoreEnvironment)
			if err != nil {
				return translate(err, "bind migration import record")
			}
			ordinal++
		}
	}
	if write.SourcePullJobID != "" {
		var importID any
		if write.ImportWork != nil {
			importID = write.ImportWork.Batch.BatchID
		}
		tag, err := tx.Exec(ctx, `UPDATE billing_migration_source_pull_jobs SET status='completed',result_source_object_id=$6,result_manifest_id=$7,result_import_batch_id=$8,resume_cursor=$9,final_watermark=$10,evidence_digest=$11,record_count=$12,current_access_count=$13,import_record_count=$14,lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,completed_at=$15,updated_at=$15 WHERE id=$1 AND program_id=$2 AND project_id=$3 AND status='running' AND lease_owner=$4 AND lease_generation=$5 AND lease_expires_at>$15`, write.SourcePullJobID, m.ProgramID, write.Manifest.ProjectID, write.SourcePullOwner, write.SourcePullGeneration, write.SourceObjectID, m.ManifestID, importID, write.SourcePullResumeCursor, write.SourcePullFinalWatermark, write.SourcePullEvidenceDigest, len(write.Records), currentAccess, func() int {
			if write.ImportWork == nil {
				return 0
			}
			return write.ImportWork.Batch.RecordCount
		}(), write.Now)
		if err != nil {
			return translate(err, "settle migration source pull")
		}
		if tag.RowsAffected() != 1 {
			return billingmigration.ErrLeaseLost
		}
		if len(write.SourcePullProvenCapabilities) > 0 {
			command, err := billingmigration.SourcePullCapabilityAssessment(write.Manifest.ProjectID, m.ProgramID, m.StateVersion, m.ProviderAPIVersion, write.SourcePullProvenCapabilities, write.SourcePullEvidenceDigest)
			if err != nil {
				return err
			}
			if _, _, err = appendCapabilityAssessmentTx(ctx, tx, command); err != nil {
				return err
			}
		}
	}
	return tx.Commit(ctx)
}

func (r *Repository) LeaseImport(ctx context.Context, workerID string, now, leaseUntil time.Time) (billingmigration.ExecutionLease, bool, error) {
	return r.leaseExecution(ctx, "import", workerID, now, leaseUntil)
}
func (r *Repository) LeaseRun(ctx context.Context, workerID string, now, leaseUntil time.Time) (billingmigration.ExecutionLease, bool, error) {
	return r.leaseExecution(ctx, "run", workerID, now, leaseUntil)
}
func (r *Repository) LeaseFinalDelta(ctx context.Context, workerID string, now, leaseUntil time.Time) (billingmigration.ExecutionLease, bool, error) {
	return r.leaseExecution(ctx, "final_delta", workerID, now, leaseUntil)
}

func (r *Repository) leaseExecution(ctx context.Context, kind, workerID string, now, leaseUntil time.Time) (billingmigration.ExecutionLease, bool, error) {
	table := "billing_migration_import_batches"
	columns := `id,program_id,project_id,expected_program_state_version,attempt_count,max_attempts,NULL::bytea,NULL::bytea,NULL::bytea,NULL::bytea`
	if kind == "run" {
		table = "billing_migration_run_jobs"
		columns = `id,program_id,project_id,expected_program_state_version,attempt_count,max_attempts,manifest_digest,mapping_digest,policy_digest,NULL::bytea`
	}
	if kind == "final_delta" {
		table = "billing_migration_final_delta_jobs"
		columns = `id,program_id,project_id,expected_program_state_version,attempt_count,max_attempts,manifest_digest,mapping_digest,NULL::bytea,evidence_digest`
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billingmigration.ExecutionLease{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	query := fmt.Sprintf(`SELECT %s FROM %s WHERE due_at<=$1 AND attempt_count<max_attempts AND (status='pending' OR (status='running' AND lease_expires_at<=$1)) ORDER BY due_at,updated_at,id FOR UPDATE SKIP LOCKED LIMIT 1`, columns, table)
	var l billingmigration.ExecutionLease
	err = tx.QueryRow(ctx, query, now).Scan(&l.JobID, &l.ProgramID, &l.ProjectID, &l.ExpectedStateVersion, &l.AttemptCount, &l.MaxAttempts, &l.ManifestDigest, &l.MappingDigest, &l.PolicyDigest, &l.EvidenceDigest)
	if errors.Is(err, pgx.ErrNoRows) {
		return l, false, nil
	}
	if err != nil {
		return l, false, err
	}
	update := fmt.Sprintf(`UPDATE %s SET status='running',lease_owner=$2,lease_expires_at=$3,lease_generation=lease_generation+1,attempt_count=attempt_count+1,updated_at=$1 WHERE id=$4 RETURNING lease_generation,attempt_count`, table)
	if err = tx.QueryRow(ctx, update, now, workerID, leaseUntil, l.JobID).Scan(&l.Generation, &l.AttemptCount); err != nil {
		return l, false, err
	}
	l.JobKind, l.Owner, l.ExpiresAt = kind, workerID, leaseUntil
	if kind == "import" {
		if err = tx.QueryRow(ctx, `SELECT record_count FROM billing_migration_import_batches WHERE id=$1`, l.JobID).Scan(&l.RecordCount); err != nil {
			return l, false, err
		}
		rows, queryErr := tx.Query(ctx, `SELECT provider,environment_id,application_id,provider_reference,reference_kind,coalesce(source_product_identifier,''),coalesce(mosaic_product_id,''),coalesce(expected_store_product_identifier,''),expected_store_environment FROM billing_migration_import_batch_records WHERE import_batch_id=$1 ORDER BY ordinal`, l.JobID)
		if queryErr != nil {
			return l, false, queryErr
		}
		for rows.Next() {
			var ref billingmigration.KnownProviderReference
			if err = rows.Scan(&ref.Provider, &ref.EnvironmentID, &ref.ApplicationID, &ref.Reference, &ref.ReferenceKind, &ref.SourceProductID, &ref.TargetProductID, &ref.ExpectedStoreProductID, &ref.ExpectedStoreEnvironment); err != nil {
				rows.Close()
				return l, false, err
			}
			l.References = append(l.References, ref)
		}
		rows.Close()
		if err = rows.Err(); err != nil {
			return l, false, err
		}
		if len(l.References) != l.RecordCount {
			return l, false, billingmigration.ErrInvalid
		}
	}
	attemptKind := kind
	if kind == "run" {
		var runKind string
		if err = tx.QueryRow(ctx, `SELECT run_kind FROM billing_migration_run_jobs WHERE id=$1`, l.JobID).Scan(&runKind); err != nil {
			return l, false, err
		}
		attemptKind = runKind
		l.JobKind = runKind
	}
	startedID := executionAttemptID(l.JobID, l.Generation, "started")
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_execution_attempts(id,program_id,project_id,job_kind,job_id,lease_owner,lease_generation,attempt_phase,result_digest,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,'started',sha256(convert_to($1,'UTF8')),$8)`, startedID, l.ProgramID, l.ProjectID, attemptKind, l.JobID, workerID, l.Generation, now)
	if err != nil {
		return l, false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return l, false, err
	}
	return l, true, nil
}

func executionAttemptID(jobID string, generation int64, phase string) string {
	return fmt.Sprintf("mxa_%s_%d_%s", jobID, generation, phase)
}

func (r *Repository) SettleImport(ctx context.Context, s billingmigration.ExecutionSettlement) error {
	return r.settleSimple(ctx, "import", s)
}

func (r *Repository) DeferImport(ctx context.Context, s billingmigration.ExecutionSettlement) error {
	if s.Status != "pending" || s.RetryAt.IsZero() {
		return billingmigration.ErrInvalid
	}
	tag, err := r.pool.Exec(ctx, `UPDATE billing_migration_import_batches SET status='pending',due_at=$6,
		attempt_count=GREATEST(attempt_count-1,0),lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,updated_at=$7
		WHERE id=$1 AND program_id=$2 AND project_id=$3 AND status='running' AND lease_owner=$4 AND lease_generation=$5 AND lease_expires_at>$7`,
		s.JobID, s.ProgramID, s.ProjectID, s.Owner, s.Generation, s.RetryAt, s.SettledAt)
	if err != nil {
		return translate(err, "defer pending migration import")
	}
	if tag.RowsAffected() != 1 {
		return billingmigration.ErrLeaseLost
	}
	return nil
}
func (r *Repository) SettleRun(ctx context.Context, s billingmigration.ExecutionSettlement) error {
	return r.settleSimple(ctx, "run", s)
}

func (r *Repository) settleSimple(ctx context.Context, kind string, s billingmigration.ExecutionSettlement) error {
	if s.Status != "completed" && s.Status != "failed" {
		return billingmigration.ErrInvalid
	}
	table := "billing_migration_import_batches"
	attemptKind := "import"
	resultColumn := ""
	if kind == "run" {
		table = "billing_migration_run_jobs"
		attemptKind = s.JobKind
		resultColumn = "result_run_id"
	}
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var attempts, max, recordCount int
	var runKind string
	if kind == "run" {
		query := fmt.Sprintf(`SELECT attempt_count,max_attempts,run_kind FROM %s WHERE id=$1 AND program_id=$2 AND project_id=$3 AND status='running' AND lease_owner=$4 AND lease_generation=$5 AND lease_expires_at>$6 FOR UPDATE`, table)
		err = tx.QueryRow(ctx, query, s.JobID, s.ProgramID, s.ProjectID, s.Owner, s.Generation, s.SettledAt).Scan(&attempts, &max, &runKind)
		attemptKind = runKind
	} else {
		query := fmt.Sprintf(`SELECT attempt_count,max_attempts,record_count FROM %s WHERE id=$1 AND program_id=$2 AND project_id=$3 AND status='running' AND lease_owner=$4 AND lease_generation=$5 AND lease_expires_at>$6 FOR UPDATE`, table)
		err = tx.QueryRow(ctx, query, s.JobID, s.ProgramID, s.ProjectID, s.Owner, s.Generation, s.SettledAt).Scan(&attempts, &max, &recordCount)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return billingmigration.ErrLeaseLost
	}
	if err != nil {
		return err
	}
	phase := s.Status
	if phase != "completed" {
		phase = "failed"
	}
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_execution_attempts(id,program_id,project_id,job_kind,job_id,lease_owner,lease_generation,attempt_phase,started_attempt_id,result_digest,error_code,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, executionAttemptID(s.JobID, s.Generation, phase), s.ProgramID, s.ProjectID, attemptKind, s.JobID, s.Owner, s.Generation, phase, executionAttemptID(s.JobID, s.Generation, "started"), s.ResultDigest, nullIfEmpty(s.ErrorCode), s.SettledAt)
	if err != nil {
		return err
	}
	if s.Status == "completed" {
		if kind == "import" && (s.ValidatedCount < 0 || s.QuarantinedCount < 0 || s.ValidatedCount+s.QuarantinedCount != recordCount || recordCount != len(s.References)) {
			return billingmigration.ErrInvalid
		}
		if kind == "import" {
			rows, queryErr := tx.Query(ctx, `SELECT provider,environment_id,application_id,provider_reference,reference_kind,coalesce(source_product_identifier,''),coalesce(mosaic_product_id,''),coalesce(expected_store_product_identifier,''),expected_store_environment FROM billing_migration_import_batch_records WHERE import_batch_id=$1 ORDER BY ordinal`, s.JobID)
			if queryErr != nil {
				return queryErr
			}
			index := 0
			for rows.Next() {
				var ref billingmigration.KnownProviderReference
				if err = rows.Scan(&ref.Provider, &ref.EnvironmentID, &ref.ApplicationID, &ref.Reference, &ref.ReferenceKind, &ref.SourceProductID, &ref.TargetProductID, &ref.ExpectedStoreProductID, &ref.ExpectedStoreEnvironment); err != nil {
					rows.Close()
					return err
				}
				expected := billingmigration.KnownProviderReference{}
				if index < len(s.References) {
					expected = s.References[index]
				}
				if index >= len(s.References) || ref != expected {
					rows.Close()
					return billingmigration.ErrInvalid
				}
				index++
			}
			rows.Close()
			if err = rows.Err(); err != nil {
				return err
			}
			if index != recordCount {
				return billingmigration.ErrInvalid
			}
		}
		if kind == "run" {
			if s.Run == nil || s.Run.SourceWatermark == "" || s.Run.ProviderWatermark == "" || s.Run.ShadowWatermark == "" {
				return billingmigration.ErrInvalid
			}
			if runKind == "dry_run" && len(s.PreparedPointers) != 0 {
				return billingmigration.ErrInvalid
			}
			var manifestDigest, mappingDigest, policyDigest []byte
			err = tx.QueryRow(ctx, `SELECT
				(SELECT manifest_digest FROM billing_migration_source_manifests WHERE program_id=p.id ORDER BY captured_at DESC,id DESC LIMIT 1),
				(SELECT mapping_digest FROM billing_migration_mapping_sets WHERE program_id=p.id AND status='frozen' ORDER BY version DESC LIMIT 1),
				p.policy_digest FROM billing_migration_programs p WHERE p.id=$1 AND p.project_id=$2`, s.ProgramID, s.ProjectID).Scan(&manifestDigest, &mappingDigest, &policyDigest)
			if err != nil {
				return err
			}
			if string(manifestDigest) != string(s.ManifestDigest) || string(mappingDigest) != string(s.MappingDigest) || string(policyDigest) != string(s.PolicyDigest) {
				return billingmigration.ErrStaleDigest
			}
			counts := billingmigration.Counts{}
			for _, item := range s.Run.Divergences {
				switch item.Divergence.Classification {
				case "critical":
					counts.Critical++
				case "blocking":
					counts.Blocking++
				case "warning":
					counts.Warning++
				case "informational":
					counts.Informational++
				default:
					return billingmigration.ErrInvalid
				}
			}
			_, err = tx.Exec(ctx, `INSERT INTO billing_migration_runs(id,program_id,project_id,run_kind,state_version,manifest_digest,mapping_digest,policy_digest,source_watermark,provider_watermark,shadow_watermark,critical_count,blocking_count,warning_count,informational_count,run_digest,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, s.ResultID, s.ProgramID, s.ProjectID, runKind, s.ExpectedStateVersion, s.ManifestDigest, s.MappingDigest, s.PolicyDigest, s.Run.SourceWatermark, s.Run.ProviderWatermark, s.Run.ShadowWatermark, counts.Critical, counts.Blocking, counts.Warning, counts.Informational, s.ResultDigest, s.SettledAt)
			if err != nil {
				return translate(err, "record migration run result")
			}
			for _, item := range s.Run.Divergences {
				d := item.Divergence
				_, err = tx.Exec(ctx, `INSERT INTO billing_migration_divergences(id,program_id,project_id,run_id,state_version,classification,reason,evidence_digest,classification_rule_version,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, d.DivergenceID, s.ProgramID, s.ProjectID, s.ResultID, d.StateVersion, d.Classification, d.Reason, item.EvidenceDigest, d.ClassificationRuleVersion, d.ObservedAt)
				if err != nil {
					return translate(err, "record executed run divergence")
				}
			}
			if runKind == "dry_run" && len(s.Run.ShadowSnapshots) != 0 {
				return billingmigration.ErrInvalid
			}
			for _, snap := range s.Run.ShadowSnapshots {
				_, err = tx.Exec(ctx, `INSERT INTO billing_migration_shadow_snapshots(id,program_id,project_id,environment_id,application_id,platform,billing_customer_id,source_snapshot_id,mosaic_snapshot_id,shadow_digest,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, snap.ID, s.ProgramID, s.ProjectID, snap.EnvironmentID, snap.ApplicationID, snap.Platform, snap.BillingCustomerID, nullIfEmpty(snap.SourceSnapshotID), snap.MosaicSnapshotID, snap.ShadowDigest, s.SettledAt)
				if err != nil {
					return translate(err, "record executed shadow snapshot")
				}
			}
			for _, p := range s.PreparedPointers {
				_, err = tx.Exec(ctx, `INSERT INTO billing_migration_scope_prepared_pointers(program_id,project_id,environment_id,application_id,platform,billing_customer_id,prepared_snapshot_id,prepared_digest,prepared_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(program_id,application_id,platform,billing_customer_id) DO UPDATE SET prepared_snapshot_id=EXCLUDED.prepared_snapshot_id,prepared_digest=EXCLUDED.prepared_digest,prepared_at=EXCLUDED.prepared_at`, s.ProgramID, s.ProjectID, p.EnvironmentID, p.ApplicationID, p.Platform, p.BillingCustomerID, p.SnapshotID, p.PreparedDigest, s.SettledAt)
				if err != nil {
					return translate(err, "write migration prepared pointer")
				}
			}
		}
		set := fmt.Sprintf(`UPDATE %s SET status='completed',lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,updated_at=$6%s WHERE id=$1 AND program_id=$2 AND project_id=$3 AND lease_owner=$4 AND lease_generation=$5`, table, map[bool]string{true: ",result_run_id=$7", false: ",validated_count=$7,quarantined_count=$8,cursor_after=$9"}[kind == "run"])
		var command pgconnCommandTag
		if kind == "run" {
			tag, e := tx.Exec(ctx, set, s.JobID, s.ProgramID, s.ProjectID, s.Owner, s.Generation, s.SettledAt, s.ResultID)
			err = e
			command = tag
		} else {
			tag, e := tx.Exec(ctx, set, s.JobID, s.ProgramID, s.ProjectID, s.Owner, s.Generation, s.SettledAt, s.ValidatedCount, s.QuarantinedCount, s.CursorAfter)
			err = e
			command = tag
		}
		if err != nil {
			return err
		}
		if command.RowsAffected() != 1 {
			return billingmigration.ErrLeaseLost
		}
		if kind == "import" {
			var pullID string
			err = tx.QueryRow(ctx, `SELECT id FROM billing_migration_source_pull_jobs WHERE result_import_batch_id=$1 AND program_id=$2 AND project_id=$3 AND intent='final_delta' AND status='completed' FOR UPDATE`, s.JobID, s.ProgramID, s.ProjectID).Scan(&pullID)
			if err == nil {
				finalJobID := "mfd_pull_" + pullID
				_, err = tx.Exec(ctx, `INSERT INTO billing_migration_final_delta_jobs(id,program_id,project_id,idempotency_key,request_digest,expected_program_state_version,manifest_digest,mapping_digest,evidence_digest,status,due_at,lease_generation,attempt_count,max_attempts,created_at,updated_at)
					SELECT $1,pull.program_id,pull.project_id,'source-pull-final-delta:'||pull.id,$2,pull.expected_program_state_version,manifest.manifest_digest,mapping.mapping_digest,$3,'pending',$4,0,0,8,$4,$4
					FROM billing_migration_source_pull_jobs pull JOIN billing_migration_source_manifests manifest ON manifest.id=pull.result_manifest_id AND manifest.program_id=pull.program_id AND manifest.project_id=pull.project_id JOIN billing_migration_mapping_sets mapping ON mapping.id=pull.mapping_set_id AND mapping.program_id=pull.program_id AND mapping.project_id=pull.project_id AND mapping.status='frozen' WHERE pull.id=$5 ON CONFLICT(program_id,idempotency_key) DO NOTHING`, finalJobID, s.ResultDigest, s.ResultDigest, s.SettledAt, pullID)
				if err != nil {
					return translate(err, "queue final delta from source pull")
				}
				_, err = tx.Exec(ctx, `UPDATE billing_migration_source_pull_jobs SET result_final_delta_job_id=$2,updated_at=$3 WHERE id=$1 AND result_final_delta_job_id IS NULL`, pullID, finalJobID, s.SettledAt)
				if err != nil {
					return err
				}
			} else if !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
		}
	} else {
		status := "pending"
		if attempts >= max {
			status = "failed"
		}
		updateQuery := fmt.Sprintf(`UPDATE %s SET status=$6,lease_owner=NULL,lease_expires_at=NULL,last_error_code=$7,due_at=$8,updated_at=$9 WHERE id=$1 AND program_id=$2 AND project_id=$3 AND lease_owner=$4 AND lease_generation=$5`, table)
		tag, err := tx.Exec(ctx, updateQuery, s.JobID, s.ProgramID, s.ProjectID, s.Owner, s.Generation, status, s.ErrorCode, s.RetryAt, s.SettledAt)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return billingmigration.ErrLeaseLost
		}
	}
	_ = resultColumn
	return tx.Commit(ctx)
}

// local interface keeps pgx's command tag concrete type out of domain code.
type pgconnCommandTag interface{ RowsAffected() int64 }

func nullIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func (r *Repository) SettleFinalDelta(ctx context.Context, s billingmigration.ExecutionSettlement) error {
	if s.Status != "completed" && s.Status != "failed" {
		return billingmigration.ErrInvalid
	}
	if s.Status == "completed" && s.FinalDelta == nil {
		return billingmigration.ErrInvalid
	}
	d := s.FinalDelta
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var attempts, max int
	err = tx.QueryRow(ctx, `SELECT attempt_count,max_attempts FROM billing_migration_final_delta_jobs WHERE id=$1 AND program_id=$2 AND project_id=$3 AND status='running' AND lease_owner=$4 AND lease_generation=$5 AND lease_expires_at>$6 FOR UPDATE`, s.JobID, s.ProgramID, s.ProjectID, s.Owner, s.Generation, s.SettledAt).Scan(&attempts, &max)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingmigration.ErrLeaseLost
	}
	if err != nil {
		return err
	}
	phase := s.Status
	if phase != "completed" {
		phase = "failed"
	}
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_execution_attempts(id,program_id,project_id,job_kind,job_id,lease_owner,lease_generation,attempt_phase,started_attempt_id,result_digest,error_code,recorded_at) VALUES($1,$2,$3,'final_delta',$4,$5,$6,$7,$8,$9,$10,$11)`, executionAttemptID(s.JobID, s.Generation, phase), s.ProgramID, s.ProjectID, s.JobID, s.Owner, s.Generation, phase, executionAttemptID(s.JobID, s.Generation, "started"), s.ResultDigest, nullIfEmpty(s.ErrorCode), s.SettledAt)
	if err != nil {
		return err
	}
	if s.Status != "completed" {
		status := "pending"
		if attempts >= max {
			status = "failed"
		}
		tag, err := tx.Exec(ctx, `UPDATE billing_migration_final_delta_jobs SET status=$6,lease_owner=NULL,lease_expires_at=NULL,last_error_code=$7,due_at=$8,updated_at=$9 WHERE id=$1 AND program_id=$2 AND project_id=$3 AND lease_owner=$4 AND lease_generation=$5`, s.JobID, s.ProgramID, s.ProjectID, s.Owner, s.Generation, status, s.ErrorCode, s.RetryAt, s.SettledAt)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return billingmigration.ErrLeaseLost
		}
		return tx.Commit(ctx)
	}
	var stateVersion int64
	var manifest, mapping []byte
	err = tx.QueryRow(ctx, `SELECT state_version,(SELECT manifest_digest FROM billing_migration_source_manifests WHERE program_id=p.id ORDER BY captured_at DESC,id DESC LIMIT 1),(SELECT mapping_digest FROM billing_migration_mapping_sets WHERE program_id=p.id AND status='frozen' ORDER BY version DESC LIMIT 1) FROM billing_migration_programs p WHERE id=$1 AND project_id=$2 AND state IN ('shadowing','ready') FOR UPDATE`, s.ProgramID, s.ProjectID).Scan(&stateVersion, &manifest, &mapping)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingmigration.ErrStaleState
	}
	if err != nil {
		return err
	}
	if stateVersion != s.ExpectedStateVersion {
		return billingmigration.ErrStaleState
	}
	if d.StateVersion != s.ExpectedStateVersion || string(manifest) != string(d.ManifestDigest) || string(mapping) != string(d.MappingDigest) || string(s.ManifestDigest) != string(d.ManifestDigest) || string(s.MappingDigest) != string(d.MappingDigest) || string(s.EvidenceDigest) != string(d.EvidenceDigest) {
		return billingmigration.ErrStaleDigest
	}
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_final_deltas(id,program_id,project_id,state_version,manifest_digest,mapping_digest,evidence_digest,final_watermark_digest,source_watermark,provider_watermark,shadow_watermark,delta_digest,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, d.ID, s.ProgramID, s.ProjectID, d.StateVersion, d.ManifestDigest, d.MappingDigest, d.EvidenceDigest, d.FinalWatermarkDigest, d.SourceWatermark, d.ProviderWatermark, d.ShadowWatermark, d.DeltaDigest, s.SettledAt)
	if err != nil {
		return translate(err, "append final delta")
	}
	cohortID := "mcs_" + d.ID
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_final_delta_cohort_sets(id,final_delta_id,program_id,project_id,customer_count,cohort_digest,frozen_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, cohortID, d.ID, s.ProgramID, s.ProjectID, len(d.Cohort), d.CohortDigest, s.SettledAt)
	if err != nil {
		return translate(err, "freeze final delta cohort")
	}
	for _, c := range d.Cohort {
		_, err = tx.Exec(ctx, `INSERT INTO billing_migration_final_delta_cohort_customers(cohort_set_id,program_id,project_id,billing_customer_id,customer_digest) VALUES($1,$2,$3,$4,$5)`, cohortID, s.ProgramID, s.ProjectID, c.BillingCustomerID, c.CustomerDigest)
		if err != nil {
			return err
		}
	}
	for _, p := range s.PreparedPointers {
		_, err = tx.Exec(ctx, `INSERT INTO billing_migration_final_delta_prepared_pointers(final_delta_job_id,lease_generation,program_id,project_id,environment_id,application_id,platform,billing_customer_id,prepared_snapshot_id,prepared_digest,prepared_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, s.JobID, s.Generation, s.ProgramID, s.ProjectID, p.EnvironmentID, p.ApplicationID, p.Platform, p.BillingCustomerID, p.SnapshotID, p.PreparedDigest, s.SettledAt)
		if err != nil {
			return translate(err, "bind final delta prepared pointer")
		}
		_, err = tx.Exec(ctx, `INSERT INTO billing_migration_scope_prepared_pointers(program_id,project_id,environment_id,application_id,platform,billing_customer_id,prepared_snapshot_id,prepared_digest,prepared_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(program_id,application_id,platform,billing_customer_id) DO UPDATE SET prepared_snapshot_id=EXCLUDED.prepared_snapshot_id,prepared_digest=EXCLUDED.prepared_digest,prepared_at=EXCLUDED.prepared_at`, s.ProgramID, s.ProjectID, p.EnvironmentID, p.ApplicationID, p.Platform, p.BillingCustomerID, p.SnapshotID, p.PreparedDigest, s.SettledAt)
		if err != nil {
			return err
		}
	}
	var invalid bool
	err = tx.QueryRow(ctx, `SELECT (SELECT count(*) FROM billing_migration_final_delta_prepared_pointers WHERE final_delta_job_id=$3 AND lease_generation=$4)<>(SELECT count(*) FROM billing_migration_program_scopes WHERE program_id=$1)*(SELECT count(*) FROM billing_migration_final_delta_cohort_customers WHERE cohort_set_id=$2) OR EXISTS(SELECT 1 FROM billing_migration_program_scopes scope CROSS JOIN billing_migration_final_delta_cohort_customers cohort WHERE scope.program_id=$1 AND cohort.cohort_set_id=$2 AND NOT EXISTS(SELECT 1 FROM billing_migration_final_delta_prepared_pointers pointer WHERE pointer.final_delta_job_id=$3 AND pointer.lease_generation=$4 AND pointer.application_id=scope.application_id AND pointer.platform=scope.platform AND pointer.billing_customer_id=cohort.billing_customer_id)) OR EXISTS(SELECT 1 FROM billing_migration_final_delta_prepared_pointers pointer WHERE pointer.final_delta_job_id=$3 AND pointer.lease_generation=$4 AND NOT EXISTS(SELECT 1 FROM billing_migration_final_delta_cohort_customers cohort WHERE cohort.cohort_set_id=$2 AND cohort.billing_customer_id=pointer.billing_customer_id))`, s.ProgramID, cohortID, s.JobID, s.Generation).Scan(&invalid)
	if err != nil {
		return err
	}
	if invalid {
		return billingmigration.ErrPointerCoverage
	}
	tag, err := tx.Exec(ctx, `UPDATE billing_migration_final_delta_jobs SET status='completed',result_final_delta_id=$6,lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,updated_at=$7 WHERE id=$1 AND program_id=$2 AND project_id=$3 AND lease_owner=$4 AND lease_generation=$5`, s.JobID, s.ProgramID, s.ProjectID, s.Owner, s.Generation, d.ID, s.SettledAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return billingmigration.ErrLeaseLost
	}
	return tx.Commit(ctx)
}
