package billingmigrationpostgres

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
)

var _ billingmigration.SourcePullRepository = (*Repository)(nil)

func sourcePullID(programID, key string) string {
	digest := sha256.Sum256([]byte("mosaic-source-pull-v1\x1f" + programID + "\x1f" + key))
	return "msp_" + hex.EncodeToString(digest[:12])
}

func (r *Repository) QueueSourcePull(ctx context.Context, command billingmigration.SourcePullCommand) (billingmigration.SourcePullJob, bool, error) {
	auth, err := r.Authorize(ctx, command.Actor, command.ProjectID, billingmigration.CapabilityManageSource)
	if err != nil || auth.OrganizationID == "" {
		return billingmigration.SourcePullJob{}, false, err
	}
	id := sourcePullID(command.ProgramID, command.IdempotencyKey)
	tag, err := r.pool.Exec(ctx, `INSERT INTO billing_migration_source_pull_jobs(id,program_id,project_id,intent,idempotency_key,request_digest,expected_program_state_version,starting_cursor,starting_watermark,starting_watermark_digest,predecessor_pull_job_id,mapping_set_id,status,due_at,max_attempts,created_by_actor_id,created_at,updated_at)
		SELECT $1,p.id,p.project_id,$4,$5,$6,$7,$8,$9,$10,predecessor.id,m.id,'pending',$11,8,$12,$11,$11
		FROM billing_migration_programs p JOIN LATERAL (SELECT id FROM billing_migration_mapping_sets WHERE program_id=p.id AND project_id=p.project_id AND status='frozen' ORDER BY version DESC LIMIT 1) m ON true
		LEFT JOIN LATERAL (SELECT candidate.id FROM billing_migration_source_pull_jobs candidate WHERE $4<>'snapshot' AND candidate.program_id=p.id AND candidate.project_id=p.project_id AND candidate.status='completed' AND candidate.resume_cursor=$8 AND candidate.final_watermark=$9 AND candidate.evidence_digest=$10 AND ($4<>'final_delta' OR candidate.id=(SELECT head.id FROM billing_migration_source_pull_jobs head WHERE head.program_id=p.id AND head.project_id=p.project_id AND head.status='completed' ORDER BY head.completed_at DESC,head.id DESC LIMIT 1)) ORDER BY candidate.completed_at DESC,candidate.id DESC LIMIT 1) predecessor ON true
		WHERE p.id=$2 AND p.project_id=$3 AND p.state_version=$7 AND p.state IN ('mapping','importing','dry_run','shadowing','ready')
		AND (($4='snapshot' AND predecessor.id IS NULL) OR ($4<>'snapshot' AND predecessor.id IS NOT NULL))
		ON CONFLICT(program_id,idempotency_key) DO NOTHING`, id, command.ProgramID, command.ProjectID, command.Intent, command.IdempotencyKey, command.RequestDigest, command.ExpectedStateVersion, command.StartingCursor, command.StartingWatermark, command.StartingWatermarkDigest, command.CreatedAt, command.Actor.ID)
	if err != nil {
		return billingmigration.SourcePullJob{}, false, translate(err, "queue migration source pull")
	}
	job, err := r.sourcePullJob(ctx, command.ProjectID, command.ProgramID, command.IdempotencyKey)
	if err != nil {
		if errors.Is(err, billingmigration.ErrConflict) && command.Intent != billingmigration.SourcePullSnapshot {
			return job, false, billingmigration.ErrStaleCheckpoint
		}
		return job, false, err
	}
	if string(job.RequestDigest) != string(command.RequestDigest) {
		return job, true, billingmigration.ErrIdempotencyConflict
	}
	return job, tag.RowsAffected() == 0, nil
}

func (r *Repository) sourcePullJob(ctx context.Context, projectID, programID, key string) (billingmigration.SourcePullJob, error) {
	var j billingmigration.SourcePullJob
	var startedAt, completedAt, failedAt *time.Time
	err := r.pool.QueryRow(ctx, `SELECT job.id,job.project_id,job.program_id,job.intent,job.status,job.starting_cursor,job.starting_watermark,job.starting_watermark_digest,coalesce(job.predecessor_pull_job_id,''),job.idempotency_key,job.request_digest,job.expected_program_state_version,job.lease_generation,job.attempt_count,job.max_attempts,job.created_at,job.updated_at,job.started_at,job.completed_at,job.failed_at,coalesce(job.result_source_object_id,''),coalesce(job.result_manifest_id,''),coalesce(job.result_import_batch_id,''),coalesce(job.result_final_delta_job_id,''),coalesce(import.status,''),coalesce(job.last_error_code,''),job.evidence_digest,source.plaintext_digest,manifest.manifest_digest,import.request_digest,final.request_digest FROM billing_migration_source_pull_jobs job LEFT JOIN billing_migration_source_objects source ON source.id=job.result_source_object_id AND source.program_id=job.program_id AND source.project_id=job.project_id LEFT JOIN billing_migration_source_manifests manifest ON manifest.id=job.result_manifest_id AND manifest.program_id=job.program_id AND manifest.project_id=job.project_id LEFT JOIN billing_migration_import_batches import ON import.id=job.result_import_batch_id AND import.program_id=job.program_id AND import.project_id=job.project_id LEFT JOIN billing_migration_final_delta_jobs final ON final.id=job.result_final_delta_job_id AND final.program_id=job.program_id AND final.project_id=job.project_id WHERE job.project_id=$1 AND job.program_id=$2 AND job.idempotency_key=$3`, projectID, programID, key).Scan(&j.ID, &j.ProjectID, &j.ProgramID, &j.Intent, &j.Status, &j.StartingCursor, &j.StartingWatermark, &j.StartingWatermarkDigest, &j.PredecessorPullJobID, &j.IdempotencyKey, &j.RequestDigest, &j.ExpectedStateVersion, &j.LeaseGeneration, &j.AttemptCount, &j.MaxAttempts, &j.CreatedAt, &j.UpdatedAt, &startedAt, &completedAt, &failedAt, &j.ResultSourceObjectID, &j.ResultManifestID, &j.ResultImportBatchID, &j.ResultFinalDeltaJobID, &j.ResultImportStatus, &j.FailureCode, &j.EvidenceDigest, &j.SourceObjectDigest, &j.ManifestDigest, &j.ImportDigest, &j.FinalDeltaDigest)
	if errors.Is(err, pgx.ErrNoRows) {
		return j, billingmigration.ErrConflict
	}
	if err == nil {
		if startedAt != nil {
			j.StartedAt = *startedAt
		}
		if completedAt != nil {
			j.CompletedAt = *completedAt
		}
		if failedAt != nil {
			j.FailedAt = *failedAt
		}
	}
	return j, err
}

func (r *Repository) LeaseSourcePull(ctx context.Context, workerID string, now, leaseUntil time.Time) (billingmigration.SourcePullLease, bool, error) {
	if workerID == "" || !leaseUntil.After(now) {
		return billingmigration.SourcePullLease{}, false, billingmigration.ErrInvalid
	}
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return billingmigration.SourcePullLease{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var id string
	err = tx.QueryRow(ctx, `SELECT id FROM billing_migration_source_pull_jobs WHERE (status='pending' AND due_at<=$1 OR status='running' AND lease_expires_at<=$1) AND attempt_count<max_attempts ORDER BY due_at,updated_at,id FOR UPDATE SKIP LOCKED LIMIT 1`, now).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingmigration.SourcePullLease{}, false, nil
	}
	if err != nil {
		return billingmigration.SourcePullLease{}, false, err
	}
	var l billingmigration.SourcePullLease
	var version int
	err = tx.QueryRow(ctx, `UPDATE billing_migration_source_pull_jobs j SET status='running',lease_owner=$2,lease_expires_at=$3,lease_generation=lease_generation+1,attempt_count=attempt_count+1,started_at=$1,updated_at=$1 FROM billing_migration_programs p,projects project,environments environment,billing_migration_credentials c,billing_migration_mapping_sets m WHERE j.id=$4 AND p.id=j.program_id AND p.project_id=j.project_id AND project.id=p.project_id AND environment.id=p.environment_id AND environment.project_id=p.project_id AND c.id=p.credential_id AND c.project_id=p.project_id AND c.status='active' AND m.id=j.mapping_set_id AND m.program_id=j.program_id AND m.project_id=j.project_id AND m.status='frozen' AND p.state_version=j.expected_program_state_version RETURNING j.id,j.project_id,j.program_id,j.intent,j.status,j.starting_cursor,j.starting_watermark,j.starting_watermark_digest,coalesce(j.predecessor_pull_job_id,''),j.idempotency_key,j.request_digest,j.expected_program_state_version,j.lease_generation,j.attempt_count,j.max_attempts,j.created_at,j.updated_at,j.started_at,j.lease_owner,j.lease_expires_at,project.organization_id,c.external_project_id,c.id,c.envelope_version,c.algorithm,c.key_id,c.nonce,c.ciphertext,c.fingerprint,p.environment_id,environment.mode,m.id,m.mapping_digest`, now, workerID, leaseUntil, id).Scan(&l.ID, &l.ProjectID, &l.ProgramID, &l.Intent, &l.Status, &l.StartingCursor, &l.StartingWatermark, &l.StartingWatermarkDigest, &l.PredecessorPullJobID, &l.IdempotencyKey, &l.RequestDigest, &l.ExpectedStateVersion, &l.LeaseGeneration, &l.AttemptCount, &l.MaxAttempts, &l.CreatedAt, &l.UpdatedAt, &l.StartedAt, &l.Owner, &l.ExpiresAt, &l.OrganizationID, &l.ExternalProjectID, &l.CredentialID, &version, &l.CredentialEnvelope.Algorithm, &l.CredentialEnvelope.KeyID, &l.CredentialEnvelope.Nonce, &l.CredentialEnvelope.Ciphertext, &l.CredentialEnvelope.Fingerprint, &l.EnvironmentID, &l.MosaicEnvironmentMode, &l.MappingSetID, &l.MappingDigest)
	if errors.Is(err, pgx.ErrNoRows) {
		return l, false, billingmigration.ErrStaleState
	}
	if err != nil {
		return l, false, err
	}
	l.CredentialEnvelope.Version = version
	l.CredentialEnvelope.CredentialClass = "revenuecat_migration_api_key"
	if err = tx.Commit(ctx); err != nil {
		return l, false, err
	}
	return l, true, nil
}

func (r *Repository) BindSourcePullRecords(ctx context.Context, lease billingmigration.SourcePullLease, pulled []billingmigration.SourcePullRecord) ([]billingmigration.NormalizedSourceRecord, error) {
	type productBinding struct{ app, platform, targetProduct string }
	bindings := map[string][]productBinding{}
	rows, err := r.pool.Query(ctx, `SELECT source_identifier,application_id,platform,target_id FROM billing_migration_mapping_entries WHERE mapping_set_id=$1 AND program_id=$2 AND project_id=$3 AND source_kind='product' AND application_id IS NOT NULL ORDER BY source_identifier,application_id`, lease.MappingSetID, lease.ProgramID, lease.ProjectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var product string
		var binding productBinding
		if err = rows.Scan(&product, &binding.app, &binding.platform, &binding.targetProduct); err != nil {
			return nil, err
		}
		bindings[product] = append(bindings[product], binding)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	result := make([]billingmigration.NormalizedSourceRecord, 0, len(pulled))
	now := time.Now().UTC()
	productEvidence := make(map[string]billingmigration.SourcePullRecord)
	for _, source := range pulled {
		if source.Kind == "product" {
			productEvidence[source.SourceIdentifier] = source
		}
	}
	for _, source := range pulled {
		idDigest := sha256.Sum256([]byte(lease.ProgramID + "\x1f" + source.Kind + "\x1f" + source.SourceIdentifier + "\x1f" + source.SourceRevision + "\x1f" + hex.EncodeToString(source.Digest)))
		record := billingmigration.NormalizedSourceRecord{ID: "msr_" + hex.EncodeToString(idDigest[:12]), SourceKind: source.Kind, SourceIdentifier: source.SourceIdentifier, SourceRevision: source.SourceRevision, SourceCursor: source.Cursor, RecordDigest: source.Digest, CurrentAccess: source.CurrentAccess, NormalizationSchemaVersion: "revenuecat-migration-source-v2", EvidenceKind: "trusted_provider_api", ObservedAt: source.ObservedAt, CreatedAt: now, CustomerID: source.CustomerID, ProductID: source.ProductID, ExternalAppID: source.ExternalAppID, Store: source.Store, SourceEnvironment: source.Environment, StoreIdentifier: source.StoreIdentifier, EntitlementIDs: append([]string(nil), source.EntitlementIDs...), Ownership: append([]byte(nil), source.Ownership...), QuarantineReason: source.QuarantineReason}
		if len(source.Ownership) > 0 {
			d := sha256.Sum256(source.Ownership)
			record.OwnershipDigest = d[:]
		}
		if source.Kind == "subscription" && record.QuarantineReason == "" {
			expectedEnvironment := "sandbox"
			if lease.MosaicEnvironmentMode == "production" {
				expectedEnvironment = "production"
			}
			if source.Environment != "production" && source.Environment != "sandbox" {
				record.QuarantineReason = "unsupported_environment"
			} else if source.Environment != expectedEnvironment {
				record.QuarantineReason = "environment_mismatch"
			}
		}
		if source.Kind == "subscription" && record.QuarantineReason == "" {
			candidates := bindings[source.ProductID]
			matched := candidates[:0]
			for _, candidate := range candidates {
				if candidate.platform == source.Platform {
					matched = append(matched, candidate)
				}
			}
			switch len(matched) {
			case 0:
				record.QuarantineReason = "missing_application_binding"
			case 1:
				product, hasProductEvidence := productEvidence[source.ProductID]
				if source.ProviderReference == "" {
					record.QuarantineReason = "missing_provider_reference"
				} else if !hasProductEvidence || product.StoreIdentifier == "" || product.ExternalAppID == "" || product.Platform != source.Platform {
					record.QuarantineReason = "missing_application_binding"
				} else {
					record.TargetProductID = matched[0].targetProduct
					record.ProviderReference = &billingmigration.KnownProviderReference{Provider: source.Provider, EnvironmentID: lease.EnvironmentID, ApplicationID: matched[0].app, Reference: source.ProviderReference, ReferenceKind: source.ReferenceKind, SourceProductID: source.ProductID, TargetProductID: matched[0].targetProduct, ExpectedStoreProductID: product.StoreIdentifier, ExpectedStoreEnvironment: source.Environment}
				}
			default:
				record.QuarantineReason = "ambiguous_application"
			}
		}
		result = append(result, record)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result, nil
}

func (r *Repository) SettleSourcePull(ctx context.Context, s billingmigration.SourcePullSettlement) error {
	if s.Status != "failed" {
		return billingmigration.ErrInvalid
	}
	status := "pending"
	if s.Lease.AttemptCount >= s.Lease.MaxAttempts {
		status = "failed"
	}
	tag, err := r.pool.Exec(ctx, `UPDATE billing_migration_source_pull_jobs SET status=$6,lease_owner=NULL,lease_expires_at=NULL,last_error_code=$7,due_at=$8,started_at=CASE WHEN $6='pending' THEN NULL ELSE started_at END,failed_at=CASE WHEN $6='failed' THEN $9 ELSE NULL END,updated_at=$9 WHERE id=$1 AND program_id=$2 AND project_id=$3 AND status='running' AND lease_owner=$4 AND lease_generation=$5 AND lease_expires_at>$9`, s.Lease.ID, s.Lease.ProgramID, s.Lease.ProjectID, s.Lease.Owner, s.Lease.LeaseGeneration, status, s.ErrorCode, s.RetryAt, s.SettledAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return billingmigration.ErrLeaseLost
	}
	return nil
}

func relationshipDigest(record billingmigration.NormalizedSourceRecord) []byte {
	value, _ := json.Marshal([]any{record.CustomerID, record.ProductID, record.TargetProductID, record.EntitlementIDs, record.ExternalAppID, record.Store, record.SourceEnvironment, record.StoreIdentifier, record.Ownership, record.QuarantineReason})
	d := sha256.Sum256(value)
	return d[:]
}
