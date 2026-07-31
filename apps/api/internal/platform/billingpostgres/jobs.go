package billingpostgres

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingcustomer"
)

// LeaseValidationJob claims one job with SELECT ... FOR UPDATE SKIP LOCKED,
// matching the pattern the analytics and Experiment queues already use so all
// three behave identically under concurrency.
func (r *Repository) LeaseValidationJob(ctx context.Context, workerID string, now, leaseUntil time.Time) (billing.ValidationJob, bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billing.ValidationJob{}, false, fmt.Errorf("begin validation lease: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var job billing.ValidationJob
	err = tx.QueryRow(ctx,
		`SELECT id, project_id, environment_id, raw_input_id, provider, attempt_count, max_attempts
		 FROM billing_validation_jobs
		 WHERE (status = 'queued' OR (status = 'leased' AND lease_expires_at <= $1))
		   AND available_at <= $1 AND attempt_count < max_attempts
		 ORDER BY available_at, created_at, id
		 FOR UPDATE SKIP LOCKED LIMIT 1`, now).
		Scan(&job.ID, &job.ProjectID, &job.EnvironmentID, &job.RawInputID, &job.Provider,
			&job.AttemptCount, &job.MaxAttempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return billing.ValidationJob{}, false, nil
	}
	if err != nil {
		return billing.ValidationJob{}, false, fmt.Errorf("select validation job: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE billing_validation_jobs
		 SET status='leased', lease_owner=$2, lease_expires_at=$3, attempt_count=attempt_count+1, updated_at=$4
		 WHERE id=$1`, job.ID, workerID, leaseUntil, now); err != nil {
		return billing.ValidationJob{}, false, fmt.Errorf("lease validation job: %w", err)
	}
	job.AttemptCount++
	if err := tx.Commit(ctx); err != nil {
		return billing.ValidationJob{}, false, fmt.Errorf("commit validation lease: %w", err)
	}
	return job, true, nil
}

// LeaseValidationJobFor claims the validation job for one named input, creating
// it if this input has never been queued.
//
// The row is written already leased. That matters: if it were written as
// 'queued' the ordinary validation worker could claim it between this statement
// and the caller's own run, and the replay or reconciliation that asked for the
// work would attribute an outcome it never produced.
//
// Taking the lease is not, however, permission to take it *from someone*. The
// DO UPDATE is guarded so a live lease is never stolen: takeover happens only
// when the existing lease has expired or the job is already terminal. Without
// the guard, an operator's quarantine retry could overwrite lease_owner while
// ProcessNextValidation was mid-flight inside an eight-second provider call;
// both paths would then read the same NextAttemptNumber before either
// committed, one CompleteAttempt would abort on
// UNIQUE (raw_input_id, attempt_number), and the losing side would silently
// discard its attempt, fact, resolution snapshot and ledger entries while
// reporting a failure it did not cause.
//
// Zero rows updated means busy, and the caller reports that rather than
// proceeding. attempt_count is reset on a successful takeover because a
// caller-initiated revalidation is a fresh budget, exactly as an operator's
// quarantine retry is; the attempt history itself is append-only and unaffected.
func (r *Repository) LeaseValidationJobFor(ctx context.Context, workerID string, input billing.RawInput, now, leaseUntil time.Time) (billing.ValidationJob, error) {
	job := billing.ValidationJob{
		ProjectID: input.ProjectID, EnvironmentID: input.EnvironmentID,
		RawInputID: input.ID, Provider: input.Provider,
		MaxAttempts: billing.MaxValidationAttempts,
	}
	err := r.pool.QueryRow(ctx,
		`INSERT INTO billing_validation_jobs(
			id, project_id, environment_id, raw_input_id, provider, status,
			attempt_count, max_attempts, available_at, lease_owner, lease_expires_at, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,'leased',1,$6,$7,$8,$9,$7,$7)
		 ON CONFLICT (raw_input_id) DO UPDATE
		   SET status='leased', attempt_count=1, available_at=$7,
		       lease_owner=$8, lease_expires_at=$9, updated_at=$7
		 WHERE billing_validation_jobs.status <> 'leased'
		    OR billing_validation_jobs.lease_expires_at IS NULL
		    OR billing_validation_jobs.lease_expires_at <= $7
		 RETURNING id, attempt_count, max_attempts`,
		"bvj_"+hashID(input.ID, "revalidate", now), input.ProjectID, input.EnvironmentID, input.ID,
		input.Provider, billing.MaxValidationAttempts, now, workerID, leaseUntil).
		Scan(&job.ID, &job.AttemptCount, &job.MaxAttempts)
	if errors.Is(err, pgx.ErrNoRows) {
		// The ON CONFLICT WHERE clause suppressed the update: another worker
		// holds a live lease on this input.
		return billing.ValidationJob{}, billing.ErrValidationBusy
	}
	if err != nil {
		return billing.ValidationJob{}, fmt.Errorf("lease validation job for input: %w", err)
	}
	return job, nil
}

// ReplayInputsForTest lists this Environment's stored inputs. It exists so the
// lease tests can obtain a real RawInput without duplicating the scan query.
func (r *Repository) ReplayInputsForTest(ctx context.Context, projectID, environmentID string) ([]billing.RawInput, error) {
	inputs, _, err := r.ReplayInputs(ctx, billing.ReplayJob{ProjectID: projectID, EnvironmentID: environmentID},
		billing.InputFilter{}, billing.InputCursor{}, 10)
	return inputs, err
}

// FactDigestsForInput reads the fact digests already on record for one input.
func (r *Repository) FactDigestsForInput(ctx context.Context, projectID, rawInputID string) ([]string, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT encode(fact_digest,'hex') FROM billing_transaction_facts
		 WHERE project_id=$1 AND source_raw_input_id=$2`, projectID, rawInputID)
	if err != nil {
		return nil, fmt.Errorf("read fact digests for input: %w", err)
	}
	defer rows.Close()
	digests := make([]string, 0, 2)
	for rows.Next() {
		var digest string
		if err := rows.Scan(&digest); err != nil {
			return nil, fmt.Errorf("scan fact digest: %w", err)
		}
		digests = append(digests, digest)
	}
	return digests, rows.Err()
}

// ParkValidationJob returns a leased job to the queue without recording an
// attempt and without consuming one from the budget.
//
// It exists for conditions that are not failures and not the input's fault —
// today, a Project whose owner turned billing off. Recording a failed attempt
// would put a diagnostic in the append-only ledger about a decision the
// operator made deliberately, and consuming an attempt would mean re-enabling
// billing left the input with a depleted budget.
func (r *Repository) ParkValidationJob(ctx context.Context, job billing.ValidationJob, reason string, now time.Time) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE billing_validation_jobs
		 SET status='queued', attempt_count=GREATEST(attempt_count-1,0), available_at=$2,
		     lease_owner=NULL, lease_expires_at=NULL, last_error_code=NULLIF($3,''), updated_at=$2
		 WHERE id=$1`, job.ID, now.Add(parkedRetryDelay), reason)
	if err != nil {
		return fmt.Errorf("park validation job: %w", err)
	}
	return nil
}

// LeaseIdentityBindingJob claims one digest-only identity decision. Expired
// leases are recoverable, so a worker exit after BindFact but before completion
// safely repeats the idempotent identity operation.
func (r *Repository) LeaseIdentityBindingJob(ctx context.Context, workerID string, now, leaseUntil time.Time) (billing.IdentityBindingJob, bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billing.IdentityBindingJob{}, false, fmt.Errorf("begin identity-binding lease: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// A worker can exit while holding its final permitted attempt. Such a row is
	// no longer claimable, but while it remains `leased` it still occupies the
	// partial unique lineage slot and would block every queued sibling forever.
	// Terminalize a bounded batch in this transaction before selecting work, so
	// clearing the slot and claiming the next eligible job are one atomic action.
	if _, err := tx.Exec(ctx,
		`WITH exhausted AS (
			SELECT id FROM billing_identity_binding_jobs
			WHERE status='leased' AND lease_expires_at <= $1 AND attempt_count >= max_attempts
			ORDER BY lease_expires_at, id
			FOR UPDATE SKIP LOCKED LIMIT 100
		)
		UPDATE billing_identity_binding_jobs jobs
		SET status='failed', lease_owner=NULL, lease_expires_at=NULL,
		    last_error_code=COALESCE(last_error_code,'identity_binding_lease_expired_exhausted'),
		    updated_at=$1
		FROM exhausted WHERE jobs.id=exhausted.id`, now); err != nil {
		return billing.IdentityBindingJob{}, false, fmt.Errorf("terminalize exhausted identity-binding leases: %w", err)
	}

	var job billing.IdentityBindingJob
	var correlators []byte
	err = tx.QueryRow(ctx,
		`SELECT id, project_id, environment_id, validation_attempt_id, raw_input_id, provider,
		        lineage_key_digest, fact_chain_digest, reference_digests, correlators,
		        acquired_at, attempt_count, max_attempts
		 FROM billing_identity_binding_jobs candidate
		 WHERE (candidate.status='queued' OR (candidate.status='leased' AND candidate.lease_expires_at <= $1))
		   AND candidate.available_at <= $1 AND candidate.attempt_count < candidate.max_attempts
		   AND NOT EXISTS (
		       SELECT 1 FROM billing_identity_binding_jobs leased
		       WHERE leased.status='leased' AND leased.id <> candidate.id
		         AND leased.environment_id=candidate.environment_id AND leased.provider=candidate.provider
		         AND leased.lineage_key_digest=candidate.lineage_key_digest
		   )
		 ORDER BY candidate.available_at, candidate.created_at, candidate.id
		 FOR UPDATE SKIP LOCKED LIMIT 1`, now).Scan(
		&job.ID, &job.ProjectID, &job.EnvironmentID, &job.ValidationAttemptID,
		&job.Binding.RawInputID, &job.Binding.Provider, &job.Binding.LineageKeyDigest,
		&job.Binding.FactChainDigest, &job.Binding.ReferenceDigests, &correlators,
		&job.Binding.AcquiredAt, &job.AttemptCount, &job.MaxAttempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return billing.IdentityBindingJob{}, false, nil
	}
	if err != nil {
		return billing.IdentityBindingJob{}, false, fmt.Errorf("select identity-binding job: %w", err)
	}
	if err := json.Unmarshal(correlators, &job.Binding.Correlators); err != nil {
		return billing.IdentityBindingJob{}, false, fmt.Errorf("decode identity-binding correlators: %w", err)
	}
	job.Binding.ProjectID = job.ProjectID
	job.Binding.EnvironmentID = job.EnvironmentID
	job.LeaseOwner = workerID
	if _, err := tx.Exec(ctx,
		`UPDATE billing_identity_binding_jobs
		 SET status='leased', lease_owner=$2, lease_expires_at=$3,
		     attempt_count=attempt_count+1, updated_at=$4
		 WHERE id=$1`, job.ID, workerID, leaseUntil, now); err != nil {
		return billing.IdentityBindingJob{}, false, fmt.Errorf("lease identity-binding job: %w", err)
	}
	job.AttemptCount++
	if err := tx.Commit(ctx); err != nil {
		return billing.IdentityBindingJob{}, false, fmt.Errorf("commit identity-binding lease: %w", err)
	}
	return job, true, nil
}

func (r *Repository) CompleteIdentityBindingJob(ctx context.Context, job billing.IdentityBindingJob, now time.Time) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE billing_identity_binding_jobs
		 SET status='completed', lease_owner=NULL, lease_expires_at=NULL,
		     last_error_code=NULL, available_at=$2, updated_at=$2
		 WHERE id=$1 AND status='leased' AND lease_owner=$3`, job.ID, now, job.LeaseOwner)
	if err != nil {
		return fmt.Errorf("complete identity-binding job: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("complete identity-binding job: lease lost")
	}
	return nil
}

func (r *Repository) ParkIdentityBindingJob(ctx context.Context, job billing.IdentityBindingJob, reason string, now time.Time) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE billing_identity_binding_jobs
		 SET status='queued', attempt_count=GREATEST(attempt_count-1,0), available_at=$2,
		     lease_owner=NULL, lease_expires_at=NULL, last_error_code=NULLIF($3,''), updated_at=$4
		 WHERE id=$1 AND status='leased' AND lease_owner=$5`,
		job.ID, now.Add(parkedRetryDelay), reason, now, job.LeaseOwner)
	if err != nil {
		return fmt.Errorf("park identity-binding job: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("park identity-binding job: lease lost")
	}
	return nil
}

func (r *Repository) RetryIdentityBindingJob(ctx context.Context, job billing.IdentityBindingJob, reason string, availableAt, now time.Time) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE billing_identity_binding_jobs
		 SET status=CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'queued' END,
		     available_at=$2, lease_owner=NULL, lease_expires_at=NULL,
		     last_error_code=NULLIF($3,''), updated_at=$4
		 WHERE id=$1 AND status='leased' AND lease_owner=$5`, job.ID, availableAt, reason, now, job.LeaseOwner)
	if err != nil {
		return fmt.Errorf("retry identity-binding job: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("retry identity-binding job: lease lost")
	}
	return nil
}

// parkedRetryDelay keeps a parked job from spinning the worker loop.
const parkedRetryDelay = 5 * time.Minute

func (r *Repository) NextAttemptNumber(ctx context.Context, rawInputID string) (int, error) {
	var next int
	err := r.pool.QueryRow(ctx,
		`SELECT COALESCE(max(attempt_number), 0) + 1 FROM billing_validation_attempts WHERE raw_input_id = $1`,
		rawInputID).Scan(&next)
	if err != nil {
		return 0, fmt.Errorf("read next attempt number: %w", err)
	}
	return next, nil
}

// CompleteAttempt writes everything one attempt produced in a single
// transaction.
//
// The attempt, its Resolution Snapshot, its Transaction Fact, its ledger
// entries, its quarantine record, and the queue transition either all land or
// none do. Splitting them would allow a fact with no attempt behind it, or a
// completed job with no record of why — both of which break the guarantee that
// the ledger is a complete account of what the pipeline did.
func (r *Repository) CompleteAttempt(ctx context.Context, job billing.ValidationJob, outcome billing.AttemptOutcome, now time.Time) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin attempt commit: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	attempt := outcome.Attempt
	if _, err := tx.Exec(ctx,
		`INSERT INTO billing_validation_attempts(
			id, project_id, environment_id, raw_input_id, credential_id, attempt_number, validator_version,
			started_at, completed_at, outcome, retryable, failure_category, diagnostic_code, provider_code,
			provider_http_status, store_environment, latency_ms, replay_of_attempt_id, correlation_id)
		 VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,$7,$8,$9,$10,$11,NULLIF($12,''),NULLIF($13,''),NULLIF($14,''),
			NULLIF($15,0),$16,$17,NULLIF($18,''),$19)`,
		attempt.ID, attempt.ProjectID, attempt.EnvironmentID, attempt.RawInputID, attempt.CredentialID,
		attempt.AttemptNumber, attempt.ValidatorVersion, attempt.StartedAt, attempt.CompletedAt,
		attempt.Outcome, attempt.Retryable, attempt.FailureCategory, attempt.DiagnosticCode,
		attempt.ProviderCode, attempt.ProviderHTTPStatus, attempt.StoreEnvironment, attempt.LatencyMs,
		attempt.ReplayOfAttemptID, attempt.CorrelationID); err != nil {
		return fmt.Errorf("insert validation attempt: %w", err)
	}

	if record := outcome.Resolution; record != nil {
		if _, err := tx.Exec(ctx,
			`INSERT INTO billing_product_resolutions(
				id, project_id, environment_id, application_id, validation_attempt_id, raw_input_id, provider,
				provider_product_identifier, provider_base_plan_identifier, provider_offer_identifier,
				outcome, resolution_state, mosaic_product_id, provider_product_mapping_id, matched_mapping_id,
				mapping_version, candidate_count, diagnostic_code, occurred_at, resolved_at)
			 VALUES ($1,$2,$3,NULLIF($4,''),$5,$6,$7,$8,NULLIF($9,''),NULLIF($10,''),$11,NULLIF($12,''),
				NULLIF($13,''),NULLIF($14,''),NULLIF($15,''),$16,$17,NULLIF($18,''),$19,$20)`,
			record.ID, record.ProjectID, record.EnvironmentID, record.ApplicationID, record.ValidationAttemptID,
			record.RawInputID, record.Provider, record.ProviderProductIdentifier,
			record.ProviderBasePlanIdentifier, record.ProviderOfferIdentifier, record.Outcome,
			record.ResolutionState, record.MosaicProductID, record.ProviderProductMappingID,
			record.MatchedMappingID, record.MappingVersion, record.CandidateCount, record.DiagnosticCode,
			record.OccurredAt, record.ResolvedAt); err != nil {
			return fmt.Errorf("insert product resolution: %w", err)
		}
	}

	factRecorded := false
	if fact := outcome.Fact; fact != nil {
		recorded, err := insertFact(ctx, tx, *fact)
		if err != nil {
			return err
		}
		// Zero rows means the identical fact already exists. That is the replay
		// no-op, and it is recorded as a deduplication rather than silently
		// dropped so the ledger shows the pipeline ran and found nothing new.
		factRecorded = recorded
		if !factRecorded {
			if err := insertLedger(ctx, tx, billing.LedgerEntry{
				ID: "ble_" + hashID(fact.SourceRawInputID, "dedup", now), ProjectID: fact.ProjectID,
				EnvironmentID: fact.EnvironmentID, EntryType: billing.LedgerFactDeduplicated,
				RawInputID: fact.SourceRawInputID, ValidationAttemptID: attempt.ID,
				CorrelationID: attempt.CorrelationID, OccurredAt: now,
			}); err != nil {
				return err
			}
		}
	}

	// A supersession fact rides in the same transaction as the state fact it
	// was derived from, and is recorded in the ledger only when this write is
	// the first observation of the link.
	if fact := outcome.Supersession; fact != nil {
		recorded, err := insertFact(ctx, tx, *fact)
		if err != nil {
			return err
		}
		if recorded {
			if err := insertLedger(ctx, tx, billing.LedgerEntry{
				ID: "ble_" + hashID(fact.SourceRawInputID, "supersession", now), ProjectID: fact.ProjectID,
				EnvironmentID: fact.EnvironmentID, EntryType: billing.LedgerFactRecorded,
				RawInputID: fact.SourceRawInputID, ValidationAttemptID: attempt.ID,
				TransactionFactID: fact.ID,
				CorrelationID:     attempt.CorrelationID, OccurredAt: now,
			}); err != nil {
				return err
			}
		}
	}

	for _, entry := range outcome.Ledger {
		if entry.EntryType == billing.LedgerFactRecorded {
			if !factRecorded {
				continue
			}
			entry.TransactionFactID = outcome.Fact.ID
		}
		if err := insertLedger(ctx, tx, entry); err != nil {
			return err
		}
	}

	// Completing the ordinary Phase 9A attempt is also the only operation that
	// may complete a Phase 9C validation binding. Retryable attempts deliberately
	// leave it accepted; pending is never represented as validated evidence.
	var migrationBinding billing.MigrationValidationBinding
	err = tx.QueryRow(ctx, `SELECT id,program_id,project_id,environment_id,raw_input_id,provider,reference_kind,
		expected_application_id,expected_store_product_identifier,expected_mosaic_product_id,expected_store_environment
		FROM billing_migration_validation_bindings WHERE raw_input_id=$1 FOR UPDATE`, attempt.RawInputID).
		Scan(&migrationBinding.ID, &migrationBinding.ProgramID, &migrationBinding.ProjectID, &migrationBinding.EnvironmentID,
			&migrationBinding.RawInputID, &migrationBinding.Provider, &migrationBinding.ReferenceKind,
			&migrationBinding.ExpectedApplicationID, &migrationBinding.ExpectedStoreProductIdentifier, &migrationBinding.ExpectedMosaicProductID, &migrationBinding.ExpectedStoreEnvironment)

	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("lock migration validation binding: %w", err)
	}
	if err == nil && attempt.Outcome != billing.OutcomeRetryableFailure {
		status := billing.MigrationValidationQuarantined
		if attempt.Outcome == billing.OutcomeValidated && outcome.Fact != nil {
			status = billing.MigrationValidationValidated
		}
		evidenceDigest := billing.MigrationValidationEvidenceDigest(migrationBinding, attempt)
		if _, err := tx.Exec(ctx, `UPDATE billing_migration_validation_bindings SET status=$2,diagnostic_code=NULLIF($3,''),
			validation_attempt_id=$4,evidence_digest=$5,provider_watermark=$6,completed_at=$6 WHERE id=$1 AND status='accepted'`,
			migrationBinding.ID, status, attempt.DiagnosticCode, attempt.ID, evidenceDigest, attempt.CompletedAt); err != nil {
			return fmt.Errorf("complete migration validation binding: %w", err)
		}
	}

	if write := outcome.Quarantine; write != nil {
		if err := upsertQuarantine(ctx, tx, attempt.ProjectID, attempt.EnvironmentID, *write); err != nil {
			return err
		}
	}

	// A successful attempt closes any open quarantine for the same input, and
	// records which attempt justified the closure. Closure is never possible
	// without that evidence.
	if attempt.Outcome == billing.OutcomeValidated || attempt.Outcome == billing.OutcomeRecordedNoFact {
		if _, err := tx.Exec(ctx,
			`UPDATE billing_quarantine_records
			 SET status='closed_after_success', closing_attempt_id=$2, closed_at=$3, last_attempt_at=$3
			 WHERE raw_input_id=$1 AND status IN ('open','retrying')`,
			attempt.RawInputID, attempt.ID, now); err != nil {
			return fmt.Errorf("close quarantine after success: %w", err)
		}
	}

	// A committed fact enqueues its projection in the same transaction that
	// records it. Enqueueing after the commit would leave a window in which a
	// crash loses the trigger and the fact never reaches anyone's access;
	// enqueueing inside means the trigger is exactly as durable as the fact.
	//
	// The job is scoped to the lineage the fact belongs to. It coalesces onto
	// the scope key, so a burst of facts for one purchase produces one
	// projection rather than one per fact.
	//
	// The lineage and its projection instance are materialized first, in this
	// same transaction. Nothing used to create either, so the trigger below
	// found no lineage and treated that as silence — a fact reached no
	// projection, and the whole Phase 9B read model was unreachable from a
	// purchase (defect D-1). Both writes are deterministic functions of the
	// fact's own chain digest, decide nothing, and must be exactly as durable as
	// the fact, because the trigger they enable is written here too.
	var lineage materializedLineage
	if factRecorded && outcome.Fact != nil {
		lineage, err = materializeLineage(ctx, tx, *outcome.Fact, now)
		if err != nil {
			return err
		}
		if err := enqueueProjectionForFact(ctx, tx, *outcome.Fact, lineage, now); err != nil {
			return err
		}
	}

	// Every fact-producing attempt gets its own durable identity job, including
	// a revalidation whose fact was deduplicated. The latter can carry new
	// correlator or submission evidence even though fact identity is unchanged.
	if outcome.Fact != nil && len(outcome.Fact.PurchaseChainDigest) > 0 {
		if len(lineage.RootDigest) == 0 {
			lineage.RootDigest, err = chainRootDigest(ctx, tx, *outcome.Fact)
			if err != nil {
				return err
			}
		}
		if err := enqueueIdentityBinding(ctx, tx, attempt.ID, *outcome.Fact, outcome,
			lineage.RootDigest, now); err != nil {
			return err
		}
	}

	status := outcome.JobStatus
	if status == "" {
		status = "completed"
	}
	availableAt := outcome.NextAvailableAt
	if availableAt.IsZero() {
		availableAt = now
	}
	if _, err := tx.Exec(ctx,
		`UPDATE billing_validation_jobs
		 SET status=$2, available_at=$3, lease_owner=NULL, lease_expires_at=NULL,
		     last_error_code=NULLIF($4,''), updated_at=$5
		 WHERE id=$1`, job.ID, status, availableAt, attempt.DiagnosticCode, now); err != nil {
		return fmt.Errorf("update validation job: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit attempt: %w", err)
	}
	return nil
}

func enqueueIdentityBinding(ctx context.Context, tx pgx.Tx, attemptID string,
	fact billing.TransactionFact, outcome billing.AttemptOutcome, rootDigest []byte, now time.Time) error {

	correlatorInput := outcome.Correlators
	if correlatorInput == nil {
		correlatorInput = []billing.AssociationCorrelator{}
	}
	referenceDigests := outcome.ReferenceDigests
	if referenceDigests == nil {
		referenceDigests = [][]byte{}
	}
	correlators, err := json.Marshal(correlatorInput)
	if err != nil {
		return fmt.Errorf("encode identity-binding correlators: %w", err)
	}
	acquiredAt := fact.OccurredAt
	if fact.PeriodStartAt != nil && fact.PeriodStartAt.Before(acquiredAt) {
		acquiredAt = *fact.PeriodStartAt
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO billing_identity_binding_jobs(
			id, project_id, environment_id, validation_attempt_id, raw_input_id, provider,
			lineage_key_digest, fact_chain_digest, reference_digests, correlators, acquired_at,
			status, attempt_count, max_attempts, available_at, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'queued',0,8,$12,$12,$12)
		 ON CONFLICT (validation_attempt_id) DO NOTHING`,
		"bib_"+hashID(attemptID, "identity_binding", ""), fact.ProjectID, fact.EnvironmentID,
		attemptID, fact.SourceRawInputID, fact.Provider, rootDigest, fact.PurchaseChainDigest,
		referenceDigests, correlators, acquiredAt, now); err != nil {
		return fmt.Errorf("enqueue identity binding: %w", err)
	}
	return nil
}

// materializeLineage creates the Purchase Lineage a newly recorded fact belongs
// to, and the projection instance that lineage owns.
//
// Three rules are load-bearing here.
//
// *The lineage is keyed on the chain root, not on the fact's own digest.* A
// Google plan change hands the subscription a new purchase token and states the
// old one as `linkedPurchaseToken`; the fact for the successor therefore carries
// a different `purchase_chain_digest` from its predecessor. Keying on it would
// mint a fresh lineage on every plan change and fragment one subscription's
// history into unconnected pieces — and the projection loader would not put it
// back together, because it walks supersession edges *forward from the root*.
// The root is resolved here by walking those edges backwards.
//
// *The digest domain is the fact's own.* Every fact-to-lineage join in the
// codebase compares `purchase_chain_digest` to `lineage_key_digest`, so any
// other domain produces a lineage that can never join to the facts it was
// created for.
//
// *Neither write may disturb an existing row.* ON CONFLICT DO NOTHING on both,
// because a lineage's customer association and an instance's projection state
// are owned by other writers, and a fact arriving is not new information about
// either.
func materializeLineage(ctx context.Context, tx pgx.Tx, fact billing.TransactionFact, now time.Time) (lineage materializedLineage, err error) {
	if len(fact.PurchaseChainDigest) == 0 {
		return materializedLineage{}, nil
	}
	rootDigest, err := chainRootDigest(ctx, tx, fact)
	if err != nil {
		return materializedLineage{}, err
	}

	lineageType := billingcustomer.LineageSubscription
	if fact.TransactionType == billing.TypeNonConsumable {
		lineageType = billingcustomer.LineageOneTime
	}
	// The identifier is derived rather than random so a retry of this
	// transaction proposes the same row and the unique constraint recognises it.
	lineageID := "bpl_" + hashID(fact.EnvironmentID, fact.Provider, hex.EncodeToString(rootDigest))
	if _, err := tx.Exec(ctx,
		`INSERT INTO purchase_lineages(
			id, project_id, environment_id, environment_mode, application_id, provider,
			store_environment, lineage_key_digest, lineage_type, projection_frozen,
			diagnostic_status, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,'identity_unresolved',$10,$10)
		 ON CONFLICT (environment_id, provider, lineage_key_digest) DO NOTHING`,
		lineageID, fact.ProjectID, fact.EnvironmentID, fact.EnvironmentMode, fact.ApplicationID,
		fact.Provider, fact.StoreEnvironment, rootDigest, lineageType, now); err != nil {
		return materializedLineage{}, fmt.Errorf("materialize purchase lineage: %w", err)
	}

	// Re-read rather than trusting the proposed id: another transaction may have
	// created this lineage first, under its own identifier.
	var resolvedID, customerID string
	if err := tx.QueryRow(ctx,
		`SELECT id, COALESCE(billing_customer_id,'') FROM purchase_lineages
		 WHERE environment_id=$1 AND provider=$2 AND lineage_key_digest=$3`,
		fact.EnvironmentID, fact.Provider, rootDigest).Scan(&resolvedID, &customerID); err != nil {
		return materializedLineage{}, fmt.Errorf("read materialized purchase lineage: %w", err)
	}
	lineage = materializedLineage{
		ID: resolvedID, CustomerID: customerID, RootDigest: rootDigest, Type: lineageType,
	}

	acquiredAt := fact.OccurredAt
	if fact.PeriodStartAt != nil && fact.PeriodStartAt.Before(acquiredAt) {
		acquiredAt = *fact.PeriodStartAt
	}
	if lineageType == billingcustomer.LineageOneTime {
		if _, err := tx.Exec(ctx,
			`INSERT INTO one_time_purchase_instances(
				id, project_id, environment_id, application_id, purchase_lineage_id, provider,
				acquired_at, validity_state, created_at, updated_at)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,'owned',$8,$8)
			 ON CONFLICT (purchase_lineage_id) DO NOTHING`,
			"otp_"+hashID(resolvedID, "instance", ""), fact.ProjectID, fact.EnvironmentID,
			fact.ApplicationID, resolvedID, fact.Provider, acquiredAt, now); err != nil {
			return materializedLineage{}, fmt.Errorf("materialize one-time purchase instance: %w", err)
		}
		return lineage, nil
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO subscription_instances(
			id, project_id, environment_id, application_id, purchase_lineage_id, provider,
			created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
		 ON CONFLICT (purchase_lineage_id) DO NOTHING`,
		"sbi_"+hashID(resolvedID, "instance", ""), fact.ProjectID, fact.EnvironmentID,
		fact.ApplicationID, resolvedID, fact.Provider, now); err != nil {
		return materializedLineage{}, fmt.Errorf("materialize subscription instance: %w", err)
	}
	return lineage, nil
}

// materializedLineage is what the fact-commit transaction learned about the
// lineage it just ensured exists.
type materializedLineage struct {
	ID         string
	CustomerID string
	RootDigest []byte
	Type       string
}

// chainRootDigest walks supersession edges backwards from a fact's own chain
// digest to the root of its purchase chain.
//
// The walk is bounded and cycle-safe for the same reason the pure helper in the
// identity module is: provider data cannot contain a cycle, so reaching one
// means the data is already wrong and the safe answer is the deepest node
// reached rather than a hang.
func chainRootDigest(ctx context.Context, tx pgx.Tx, fact billing.TransactionFact) ([]byte, error) {
	var root []byte
	err := tx.QueryRow(ctx,
		`WITH RECURSIVE walk(digest, depth) AS (
			SELECT $3::bytea, 0
		  UNION ALL
			SELECT f.supersedes_chain_digest, walk.depth + 1
			FROM walk
			JOIN LATERAL (
				SELECT supersedes_chain_digest
				FROM billing_transaction_facts
				WHERE project_id = $1 AND environment_id = $2
				  AND purchase_chain_digest = walk.digest
				  AND supersedes_chain_digest IS NOT NULL
				  AND supersedes_chain_digest <> walk.digest
				LIMIT 1
			) f ON true
			WHERE walk.depth < 32
		 )
		 SELECT digest FROM walk ORDER BY depth DESC LIMIT 1`,
		fact.ProjectID, fact.EnvironmentID, fact.PurchaseChainDigest).Scan(&root)
	if err != nil {
		return nil, fmt.Errorf("walk purchase chain root: %w", err)
	}
	if len(root) == 0 {
		return fact.PurchaseChainDigest, nil
	}
	return root, nil
}

// enqueueProjectionForFact queues a projection for the lineage a newly
// recorded fact belongs to.
//
// The lineage always exists by the time this runs: materializeLineage created
// it a few statements earlier, in this same transaction. An unassociated lineage
// still enqueues — at lineage scope — so the subscription state advances while
// the identity half of the seam is still deciding who owns it.
func enqueueProjectionForFact(ctx context.Context, tx pgx.Tx, fact billing.TransactionFact,
	lineage materializedLineage, now time.Time) error {

	if lineage.ID == "" {
		// A fact with no provider chain digest names no purchase chain, so there
		// is nothing to project. Nothing else reaches here now that the lineage
		// is materialized in this same transaction — before it was, a missing
		// lineage was the ordinary case and this function was silence (defect
		// D-1).
		return nil
	}

	// A customer snapshot may only ever be minted from *all* of the customer's
	// lineages, so a job that names a customer must never also name a lineage
	// (defect D-4).
	//
	// The detail used to carry both. `loadLineages` filters on the lineage when
	// one is present, while `Compute` branches on the customer being present and
	// mints a full customer aggregate — so committing a fact on one of a
	// customer's lineages rewrote their authoritative snapshot from that lineage
	// alone. Every other Entitlement Source vanished and any Entitlement that
	// depended on one flipped to inactive: no refund, no revocation, no expiry,
	// just sources that were never loaded. A customer holding a subscription and
	// a lifetime purchase lost the lifetime purchase on the subscription's next
	// renewal.
	//
	// The two scopes are now disjoint. A resolved lineage enqueues customer
	// scope and nothing else; an unresolved one enqueues lineage scope, which
	// advances the subscription state and mints no customer snapshot at all.
	// That also restores the coalescing index's meaning: `customer:…` and
	// `lineage:…` keys can no longer stand for two different amounts of work.
	scopeKey := "lineage:" + lineage.ID
	detail := map[string]string{"lineageId": lineage.ID}
	if lineage.CustomerID != "" {
		scopeKey = "customer:" + lineage.CustomerID
		detail = map[string]string{"customerId": lineage.CustomerID}
	}
	encodedDetail, err := json.Marshal(detail)
	if err != nil {
		return fmt.Errorf("encode projection job detail: %w", err)
	}
	// ON CONFLICT DO NOTHING against the scope-key partial unique index is the
	// coalescing: a scope that already has queued or leased work absorbs this
	// trigger rather than creating a second job.
	if _, err := tx.Exec(ctx,
		`INSERT INTO projection_jobs(
			id, project_id, environment_id, scope_key, kind, detail, status,
			attempt_count, max_attempts, available_at, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,'fact_committed',$5,'queued',0,8,$6,$6,$6)
		 ON CONFLICT DO NOTHING`,
		"pjb_"+hashID(scopeKey, "fact_committed", fact.ID), fact.ProjectID, fact.EnvironmentID,
		scopeKey, encodedDetail, now); err != nil {
		return fmt.Errorf("enqueue projection for committed fact: %w", err)
	}
	return nil
}

// insertFact appends one Transaction Fact, reporting whether the row was new.
// The ON CONFLICT target is the fact-identity constraint, so a recomputed
// identical fact is a structural no-op.
func insertFact(ctx context.Context, tx pgx.Tx, fact billing.TransactionFact) (bool, error) {
	tag, err := tx.Exec(ctx,
		`INSERT INTO billing_transaction_facts(
			id, project_id, environment_id, environment_mode, application_id, provider, store_environment,
			provider_transaction_id, provider_original_transaction_id, purchase_chain_digest,
			supersedes_chain_digest, transaction_type, fact_kind, occurred_at, period_start_at,
			period_end_at, revoked_at, refunded_at, renewal_expected, is_test_transaction,
			provider_product_identifier, provider_base_plan_identifier, provider_offer_identifier,
			resolution_state, mosaic_product_id, provider_product_mapping_id, resolved_mapping_version,
			validator_version, fact_version, source_raw_input_id, validation_attempt_id, fact_digest, recorded_at,
			grace_period_expires_at, billing_retry_active, auto_renew_product_identifier, is_upgraded,
			revocation_reason, refund_type, in_app_ownership_type, subscription_group_identifier,
			provider_event_occurred_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULLIF($9,''),$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
			$21,NULLIF($22,''),NULLIF($23,''),$24,NULLIF($25,''),NULLIF($26,''),$27,$28,$29,$30,$31,$32,$33,
			$34,$35,NULLIF($36,''),$37,$38,NULLIF($39,''),NULLIF($40,''),NULLIF($41,''),$42)
		 ON CONFLICT (environment_id, fact_digest) DO NOTHING`,
		fact.ID, fact.ProjectID, fact.EnvironmentID, fact.EnvironmentMode, fact.ApplicationID,
		fact.Provider, fact.StoreEnvironment, fact.ProviderTransactionID,
		fact.ProviderOriginalTransactionID, nullBytes(fact.PurchaseChainDigest),
		nullBytes(fact.SupersedesChainDigest), fact.TransactionType, fact.FactKind, fact.OccurredAt,
		fact.PeriodStartAt, fact.PeriodEndAt, fact.RevokedAt, fact.RefundedAt, fact.RenewalExpected,
		fact.IsTestTransaction, fact.ProviderProductIdentifier, fact.ProviderBasePlanIdentifier,
		fact.ProviderOfferIdentifier, fact.ResolutionState, fact.MosaicProductID,
		fact.ProviderProductMappingID, fact.ResolvedMappingVersion, fact.ValidatorVersion,
		fact.FactVersion, fact.SourceRawInputID, fact.ValidationAttemptID, fact.FactDigest, fact.RecordedAt,
		fact.GracePeriodExpiresAt, fact.BillingRetryActive, fact.AutoRenewProductIdentifier,
		fact.IsUpgraded, fact.RevocationReason, fact.RefundType, fact.InAppOwnershipType,
		fact.SubscriptionGroupIdentifier, fact.ProviderEventOccurredAt)
	if err != nil {
		return false, fmt.Errorf("append transaction fact: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// MappingCandidates returns every mapping in scope regardless of status.
//
// Filtering by status in SQL would hide exactly the rows the resolver needs:
// archived mappings are what make historical resolution reproducible, and the
// decision about which one applies depends on the transaction's own timestamp,
// which the resolver owns.
func (r *Repository) MappingCandidates(ctx context.Context, environmentID, applicationID, platform, provider, providerProductIdentifier string) ([]billing.MappingCandidate, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT m.id, m.project_id, m.product_id, p.type, m.status, m.archived_at,
		        COALESCE(m.replaces_mapping_id,''), COALESCE(m.provider_base_plan_identifier,''),
		        COALESCE(m.provider_offer_identifier,''),
		        (extract(epoch from m.updated_at) * 1000)::bigint
		 FROM provider_product_mappings m
		 JOIN products p ON p.id = m.product_id AND p.project_id = m.project_id
		 WHERE m.connection_id IS NULL AND m.environment_id = $1 AND m.application_id = $2
		   AND m.platform = $3 AND m.provider = $4 AND m.provider_product_identifier = $5`,
		environmentID, applicationID, platform, provider, providerProductIdentifier)
	if err != nil {
		return nil, fmt.Errorf("read mapping candidates: %w", err)
	}
	defer rows.Close()
	candidates := make([]billing.MappingCandidate, 0, 4)
	for rows.Next() {
		var candidate billing.MappingCandidate
		if err := rows.Scan(&candidate.ID, &candidate.ProjectID, &candidate.MosaicProductID,
			&candidate.MosaicProductType, &candidate.Status, &candidate.ArchivedAt,
			&candidate.ReplacesMappingID, &candidate.ProviderBasePlanIdentifier,
			&candidate.ProviderOfferIdentifier, &candidate.Version); err != nil {
			return nil, fmt.Errorf("scan mapping candidate: %w", err)
		}
		candidates = append(candidates, candidate)
	}
	return candidates, rows.Err()
}

// MappingSuccessors resolves the replacement chain transitively.
//
// The walk is done here in a recursive CTE rather than by round-tripping per
// hop, and it is bounded by the same depth the resolver enforces so a data
// defect cannot turn into an unbounded query.
func (r *Repository) MappingSuccessors(ctx context.Context, projectID string, mappingIDs []string) (map[string]billing.MappingCandidate, error) {
	successors := make(map[string]billing.MappingCandidate)
	if len(mappingIDs) == 0 {
		return successors, nil
	}
	rows, err := r.pool.Query(ctx,
		`WITH RECURSIVE chain AS (
			SELECT m.id, m.replaces_mapping_id, 1 AS depth
			FROM provider_product_mappings m
			WHERE m.project_id = $1 AND m.replaces_mapping_id = ANY($2)
			UNION ALL
			SELECT n.id, n.replaces_mapping_id, chain.depth + 1
			FROM provider_product_mappings n
			JOIN chain ON n.replaces_mapping_id = chain.id
			WHERE n.project_id = $1 AND chain.depth < 32
		)
		SELECT chain.replaces_mapping_id, m.id, m.project_id, m.product_id, p.type, m.status, m.archived_at,
		       COALESCE(m.replaces_mapping_id,''), COALESCE(m.provider_base_plan_identifier,''),
		       COALESCE(m.provider_offer_identifier,''),
		       (extract(epoch from m.updated_at) * 1000)::bigint
		FROM chain
		JOIN provider_product_mappings m ON m.id = chain.id
		JOIN products p ON p.id = m.product_id AND p.project_id = m.project_id`,
		projectID, mappingIDs)
	if err != nil {
		return nil, fmt.Errorf("read mapping successors: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var predecessor string
		var candidate billing.MappingCandidate
		if err := rows.Scan(&predecessor, &candidate.ID, &candidate.ProjectID, &candidate.MosaicProductID,
			&candidate.MosaicProductType, &candidate.Status, &candidate.ArchivedAt,
			&candidate.ReplacesMappingID, &candidate.ProviderBasePlanIdentifier,
			&candidate.ProviderOfferIdentifier, &candidate.Version); err != nil {
			return nil, fmt.Errorf("scan mapping successor: %w", err)
		}
		successors[predecessor] = candidate
	}
	return successors, rows.Err()
}

// ExpireRawInputBodies removes bodies past their retention window.
//
// Only the encrypted body goes: the input row, its attempts, its facts, and its
// ledger entries all remain, so the ledger stays a complete account after the
// sensitive payload behind it is gone.
func (r *Repository) ExpireRawInputBodies(ctx context.Context, now time.Time, limit int) (int64, error) {
	if limit <= 0 {
		limit = 500
	}
	// The append-only trigger permits an UPDATE only when nothing but the
	// envelope columns changed, so retention clears the envelope and leaves the
	// state column to a companion statement the trigger also allows.
	tag, err := r.pool.Exec(ctx,
		`UPDATE billing_raw_inputs
		 SET envelope_version=NULL, algorithm=NULL, key_id=NULL, nonce=NULL, ciphertext=NULL,
		     fingerprint=NULL, envelope_rotated_at=$1, body_state='expired'
		 WHERE id IN (
			SELECT id FROM billing_raw_inputs
			WHERE body_state='stored' AND expires_at <= $1
			ORDER BY expires_at, id LIMIT $2)`, now, limit)
	if err != nil {
		return 0, fmt.Errorf("expire raw billing input bodies: %w", err)
	}
	return tag.RowsAffected(), nil
}
