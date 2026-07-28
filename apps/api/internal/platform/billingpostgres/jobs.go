package billingpostgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
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
