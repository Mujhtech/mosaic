// Package billingrestorepostgres is the PostgreSQL implementation of the
// restore/sync persistence port.
//
// Its job is to answer one question honestly: where did this restore's chain
// actually get to? Everything here is a read of committed state written by
// somebody else — ingestion wrote the Raw Billing Inputs, validation wrote the
// facts, identity resolution attached the lineages, projection moved the
// pointer — and nothing in this package advances any of those stages. A restore
// that could advance a stage itself would eventually disagree with the stage's
// owner about what happened, and both answers would look authoritative.
package billingrestorepostgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingrestore"
)

type Repository struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

var _ billingrestore.Repository = (*Repository)(nil)

// providerUnavailableCodes are the validation error codes that mean the wait is
// on the store rather than on Mosaic. They are the retry classifier's own
// diagnostics, so the restore surface reports provider unavailability from the
// same evidence the validation queue retries on rather than from a guess.
var providerUnavailableCodes = []string{
	"provider_timeout", "provider_cancelled", "provider_network_error", "provider_unreachable",
	"apple_server_error", "apple_rate_limited", "apple_retryable_error",
	"google_server_error", "google_quota_exhausted",
}

// productQuarantineReasons are the quarantine reasons that mean the purchase is
// real but the Entitlement is unknown. They are kept apart from every other
// quarantine reason because "we cannot map your Product" is an operator task
// with a definite fix, while the rest are failures.
var productQuarantineReasons = []string{"product_unknown", "product_ambiguous"}

func (r *Repository) BillingEnabled(ctx context.Context, projectID string) (bool, error) {
	var enabled bool
	err := r.pool.QueryRow(ctx,
		`SELECT billing_enabled FROM billing_project_settings WHERE project_id = $1`, projectID).
		Scan(&enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		// Off by default: a Project that never opted in holds no billing state.
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read billing enablement: %w", err)
	}
	return enabled, nil
}

// CreateJob records a restore and links the Raw Billing Inputs the named
// observation submissions produced, in one transaction.
//
// The inputs are resolved by the observation's idempotency key rather than by a
// caller-supplied digest. That is the security-relevant choice: a Google
// purchase-token digest is computable by anyone holding the token, so accepting
// digests would let a caller attach another submission's input to its own
// restore. A submission id is the caller's own, and the key is
// Environment-scoped, so a restore can only ever link inputs the same caller
// created.
func (r *Repository) CreateJob(ctx context.Context, job billingrestore.Job,
	submissionIDs []string, now time.Time) (billingrestore.Job, error) {

	provider := providerFor(job.StorePlatform)

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billingrestore.Job{}, fmt.Errorf("begin restore submission: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	keys := make([][]byte, 0, len(submissionIDs))
	for _, submissionID := range submissionIDs {
		keys = append(keys, billing.ObservationKey(job.EnvironmentID, submissionID))
	}

	type linkedInput struct {
		id     string
		digest []byte
	}
	linked := make([]linkedInput, 0, len(keys))
	if len(keys) > 0 {
		rows, err := tx.Query(ctx,
			`SELECT id, transaction_reference_digest
			 FROM billing_raw_inputs
			 WHERE project_id = $1 AND provider = $2 AND environment_id = $3
			   AND idempotency_key = ANY($4)
			   AND transaction_reference_digest IS NOT NULL
			 ORDER BY id`,
			job.ProjectID, provider, job.EnvironmentID, keys)
		if err != nil {
			return billingrestore.Job{}, fmt.Errorf("resolve restore observations: %w", err)
		}
		for rows.Next() {
			var input linkedInput
			if err := rows.Scan(&input.id, &input.digest); err != nil {
				rows.Close()
				return billingrestore.Job{}, fmt.Errorf("scan restore observation: %w", err)
			}
			linked = append(linked, input)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return billingrestore.Job{}, fmt.Errorf("read restore observations: %w", err)
		}
	}

	// The count reported is the number of inputs actually linked, never the
	// number the caller claimed. observedTransactionCount is never evidence of
	// access, but it is evidence of what the chain can speak about, and a
	// submission id that resolved to nothing is not part of the chain.
	job.ObservedTransactionCount = len(linked)

	var baseline *int64
	if job.CustomerID != "" {
		var version int64
		err := tx.QueryRow(ctx,
			`SELECT COALESCE((
				SELECT snapshot_version FROM customer_entitlement_pointers
				WHERE billing_customer_id = $1 AND environment_id = $2), 0)`,
			job.CustomerID, job.EnvironmentID).Scan(&version)
		if err != nil {
			return billingrestore.Job{}, fmt.Errorf("read restore baseline: %w", err)
		}
		baseline = &version
	}
	job.BaselineSnapshotVersion = baseline

	if _, err := tx.Exec(ctx,
		`INSERT INTO restore_sync_jobs(
			id, project_id, environment_id, billing_customer_id, store_platform,
			status, provider_outcome, uncertainty_reason,
			observed_transaction_count, pending_validation_count,
			baseline_snapshot_version, correlation_id,
			attempt_count, max_attempts, available_at, requested_at, updated_at)
		 VALUES ($1,$2,$3,NULLIF($4,''),$5,'queued',$6,'none',$7,$8,$9,$10,0,$11,$12,$12,$12)`,
		job.ID, job.ProjectID, job.EnvironmentID, job.CustomerID, job.StorePlatform,
		job.ProviderOutcome, job.ObservedTransactionCount, len(linked),
		baseline, job.CorrelationID, job.MaxAttempts, now); err != nil {
		if isForeignKeyViolation(err) {
			// The only caller-supplied reference here is the Billing Customer,
			// and it comes from a trusted backend naming a customer that does
			// not exist in its Project.
			return billingrestore.Job{}, billingrestore.ErrInvalid
		}
		return billingrestore.Job{}, fmt.Errorf("insert restore job: %w", err)
	}

	for _, input := range linked {
		if _, err := tx.Exec(ctx,
			`INSERT INTO restore_sync_job_inputs(
				restore_sync_job_id, project_id, raw_input_id,
				transaction_reference_digest, created_at)
			 VALUES ($1,$2,$3,$4,$5)
			 ON CONFLICT DO NOTHING`,
			job.ID, job.ProjectID, input.id, input.digest, now); err != nil {
			return billingrestore.Job{}, fmt.Errorf("link restore observation: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return billingrestore.Job{}, fmt.Errorf("commit restore submission: %w", err)
	}
	job.PendingValidationCount = len(linked)
	job.Status = billingrestore.StatusQueued
	job.RequestedAt, job.UpdatedAt = now, now
	return job, nil
}

// LeaseJob claims one due job with SELECT ... FOR UPDATE SKIP LOCKED, matching
// the pattern every other Mosaic queue uses so all of them behave identically
// under concurrency.
//
// The attempt counter is incremented on lease, so the attempt that takes the
// count to max_attempts is the attempt that has to finalize. That is what keeps
// an exhausted restore from becoming a queued row nothing will ever lease
// again — a zombie with no outcome, which is the one state the status endpoint
// could not report honestly.
func (r *Repository) LeaseJob(ctx context.Context, workerID string, now, leaseUntil time.Time) (billingrestore.Job, bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billingrestore.Job{}, false, fmt.Errorf("begin restore lease: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var job billingrestore.Job
	var customerID *string
	var baseline *int64
	err = tx.QueryRow(ctx,
		`SELECT id, project_id, environment_id, billing_customer_id, store_platform,
		        provider_outcome, uncertainty_reason, observed_transaction_count,
		        pending_validation_count, baseline_snapshot_version, correlation_id,
		        attempt_count, max_attempts, requested_at
		 FROM restore_sync_jobs
		 WHERE (status = 'queued' OR (status = 'leased' AND leased_until <= $1))
		   AND available_at <= $1 AND attempt_count < max_attempts
		 ORDER BY available_at, id
		 FOR UPDATE SKIP LOCKED LIMIT 1`, now).
		Scan(&job.ID, &job.ProjectID, &job.EnvironmentID, &customerID, &job.StorePlatform,
			&job.ProviderOutcome, &job.UncertaintyReason, &job.ObservedTransactionCount,
			&job.PendingValidationCount, &baseline, &job.CorrelationID,
			&job.AttemptCount, &job.MaxAttempts, &job.RequestedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingrestore.Job{}, false, nil
	}
	if err != nil {
		return billingrestore.Job{}, false, fmt.Errorf("select restore job: %w", err)
	}
	if customerID != nil {
		job.CustomerID = *customerID
	}
	job.BaselineSnapshotVersion = baseline

	if _, err := tx.Exec(ctx,
		`UPDATE restore_sync_jobs
		 SET status='leased', leased_by=$2, leased_until=$3,
		     attempt_count=attempt_count+1, updated_at=$4
		 WHERE id=$1`, job.ID, workerID, leaseUntil, now); err != nil {
		return billingrestore.Job{}, false, fmt.Errorf("lease restore job: %w", err)
	}
	job.AttemptCount++
	job.Status = billingrestore.StatusLeased
	if err := tx.Commit(ctx); err != nil {
		return billingrestore.Job{}, false, fmt.Errorf("commit restore lease: %w", err)
	}
	return job, true, nil
}

// LoadChain reads where the chain got to, in four reads that each answer one
// stage's question. They are not merged into one statement: the joins have
// genuinely different shapes, and a single query that produced all of it would
// be the kind nobody can read six months later.
func (r *Repository) LoadChain(ctx context.Context, job billingrestore.Job) (billingrestore.ChainState, error) {
	chain := billingrestore.ChainState{CustomerID: job.CustomerID}

	// Stage 1 and 2: the linked inputs and what validation did with each.
	//
	// A fact existing for an input is the only evidence that input validated;
	// the validation job's own status is used to tell "still working" from
	// "gave up", never to conclude success.
	var providerPending, productUnresolved, permanent int
	err := r.pool.QueryRow(ctx,
		`SELECT
			count(*),
			count(*) FILTER (WHERE f.id IS NULL AND (v.status IS NULL OR v.status IN ('queued','leased'))),
			count(*) FILTER (WHERE f.id IS NULL AND v.status IN ('queued','leased')
			                   AND v.last_error_code = ANY($2)),
			count(*) FILTER (WHERE q.id IS NOT NULL AND q.status IN ('open','retrying')
			                   AND q.reason_code = ANY($3)),
			count(*) FILTER (WHERE f.id IS NULL AND (v.status = 'failed'
			                   OR (q.id IS NOT NULL AND q.status IN ('open','retrying')
			                       AND NOT (q.reason_code = ANY($3))))),
			count(f.id)
		 FROM restore_sync_job_inputs i
		 LEFT JOIN LATERAL (
			SELECT tf.id FROM billing_transaction_facts tf
			WHERE tf.source_raw_input_id = i.raw_input_id LIMIT 1
		 ) f ON true
		 LEFT JOIN billing_validation_jobs v ON v.raw_input_id = i.raw_input_id
		 LEFT JOIN billing_quarantine_records q ON q.raw_input_id = i.raw_input_id
		 WHERE i.restore_sync_job_id = $1`,
		job.ID, providerUnavailableCodes, productQuarantineReasons).
		Scan(&chain.LinkedInputCount, &chain.PendingValidationCount, &providerPending,
			&productUnresolved, &permanent, &chain.FactCount)
	if err != nil {
		return billingrestore.ChainState{}, fmt.Errorf("read restore validation chain: %w", err)
	}
	// The query counts rows because that is what SQL aggregates do; the domain
	// only cares whether there were any.
	chain.ProviderUnavailable = providerPending > 0
	chain.ProductUnresolved = productUnresolved > 0
	chain.PermanentFailure = permanent > 0

	// Stage 3: which customer the validated facts resolved to, and whether that
	// identity is disputed. Two distinct customers behind one restore is itself
	// a conflict: Mosaic cannot know which of them asked.
	var resolved *string
	var distinct int
	var frozen, lineageProductUnresolved bool
	lineageKeys := []string{}
	err = r.pool.QueryRow(ctx,
		`SELECT
			(array_agg(DISTINCT l.billing_customer_id)
				FILTER (WHERE l.billing_customer_id IS NOT NULL))[1],
			count(DISTINCT l.billing_customer_id) FILTER (WHERE l.billing_customer_id IS NOT NULL),
			COALESCE(bool_or(l.projection_frozen OR l.diagnostic_status = 'identity_conflict'), false),
			COALESCE(bool_or(l.diagnostic_status = 'product_unresolved'), false),
			COALESCE(array_agg(DISTINCT 'lineage:' || l.id), ARRAY[]::text[])
		 FROM restore_sync_job_inputs i
		 JOIN billing_transaction_facts f ON f.source_raw_input_id = i.raw_input_id
		 JOIN purchase_lineages l ON l.id = f.purchase_lineage_id
		 WHERE i.restore_sync_job_id = $1`, job.ID).
		Scan(&resolved, &distinct, &frozen, &lineageProductUnresolved, &lineageKeys)
	if err != nil {
		return billingrestore.ChainState{}, fmt.Errorf("read restore identity chain: %w", err)
	}
	if chain.CustomerID == "" && resolved != nil {
		chain.CustomerID = *resolved
	}
	chain.IdentityConflict = frozen || distinct > 1
	chain.ProductUnresolved = chain.ProductUnresolved || lineageProductUnresolved

	if chain.CustomerID == "" {
		// Without a customer there is no pointer to read and no customer-scoped
		// projection to wait on. Reporting settled here would be a claim about
		// state that does not exist.
		return chain, nil
	}

	// Stage 4: the authoritative snapshot and whether the projection that would
	// move it has finished. Lineage-scoped projections count: a lineage that
	// has not been projected has not reached the customer aggregate either.
	scopes := append(lineageKeys, "customer:"+chain.CustomerID)
	var pending bool
	err = r.pool.QueryRow(ctx,
		`SELECT
			COALESCE((SELECT snapshot_version FROM customer_entitlement_pointers
			          WHERE billing_customer_id = $1 AND environment_id = $2), 0),
			EXISTS(SELECT 1 FROM projection_jobs
			       WHERE scope_key = ANY($3) AND status IN ('queued','leased')),
			EXISTS(SELECT 1 FROM projection_jobs
			       WHERE scope_key = ANY($3) AND status = 'failed')`,
		chain.CustomerID, job.EnvironmentID, scopes).
		Scan(&chain.SnapshotVersion, &pending, &chain.ProjectionFailed)
	if err != nil {
		return billingrestore.ChainState{}, fmt.Errorf("read restore projection chain: %w", err)
	}
	chain.ProjectionSettled = !pending
	return chain, nil
}

// AdoptBaseline records the customer and the version that existed when identity
// first resolved. The WHERE clause makes it a one-way door: a baseline that
// could move would let `restored` be proven against a version chosen after the
// snapshot it is compared with had already been written.
func (r *Repository) AdoptBaseline(ctx context.Context, job billingrestore.Job,
	customerID string, baseline int64, now time.Time) error {

	_, err := r.pool.Exec(ctx,
		`UPDATE restore_sync_jobs
		 SET billing_customer_id = $2, baseline_snapshot_version = $3, updated_at = $4
		 WHERE id = $1 AND baseline_snapshot_version IS NULL`,
		job.ID, customerID, baseline, now)
	if err != nil {
		return fmt.Errorf("adopt restore baseline: %w", err)
	}
	return nil
}

// CompleteJob writes the terminal outcome.
//
// The decision is validated again here, at the last moment before the write.
// The service already validated it and the schema will check it once more, and
// all three are kept: this is the one row in Mosaic whose whole purpose is that
// a particular pairing of columns is never wrong.
func (r *Repository) CompleteJob(ctx context.Context, job billingrestore.Job,
	decision billingrestore.Decision, chain billingrestore.ChainState, now time.Time) error {

	if err := decision.Validate(); err != nil {
		return err
	}
	var snapshotVersion *int64
	if version := decision.SnapshotVersion(); version > 0 {
		snapshotVersion = &version
	}
	// The schema refuses a customer beside identity_unresolved, and so does the
	// contract: the whole meaning of that outcome is that Mosaic does not know
	// whose purchase this is. The column is cleared outright rather than merely
	// left unwritten, so the row cannot end up naming a customer the outcome
	// denies knowing.
	clearCustomer := decision.Outcome == billingrestore.OutcomeIdentityUnresolved

	_, err := r.pool.Exec(ctx,
		`UPDATE restore_sync_jobs
		 SET status = $2,
		     outcome = $3,
		     uncertainty_reason = $4,
		     pending_validation_count = $5,
		     billing_customer_id = CASE
			     WHEN $9 THEN NULL
			     ELSE COALESCE(NULLIF($6,''), billing_customer_id)
		     END,
		     snapshot_version = $7,
		     leased_by = NULL,
		     leased_until = NULL,
		     completed_at = $8,
		     updated_at = $8
		 WHERE id = $1`,
		job.ID, billingrestore.TerminalStatus(decision), decision.Outcome,
		decision.UncertaintyReason, chain.PendingValidationCount, chain.CustomerID,
		snapshotVersion, now, clearCustomer)
	if err != nil {
		return fmt.Errorf("complete restore job: %w", err)
	}
	return nil
}

// RescheduleJob records progress and sets the next availability. The outcome
// column stays null on purpose: the chain has no answer yet, and writing a
// provisional one would make an unfinished restore look decided to every reader
// of the table. The status endpoint renders a null outcome as
// validation_pending, which is what an unfinished chain honestly means.
func (r *Repository) RescheduleJob(ctx context.Context, job billingrestore.Job,
	decision billingrestore.Decision, chain billingrestore.ChainState,
	availableAt, now time.Time) error {

	reason := decision.UncertaintyReason
	if reason == "" {
		reason = billingrestore.ReasonNone
	}
	_, err := r.pool.Exec(ctx,
		`UPDATE restore_sync_jobs
		 SET status = 'queued',
		     uncertainty_reason = $2,
		     pending_validation_count = $3,
		     available_at = $4,
		     leased_by = NULL,
		     leased_until = NULL,
		     updated_at = $5
		 WHERE id = $1`,
		job.ID, reason, chain.PendingValidationCount, availableAt, now)
	if err != nil {
		return fmt.Errorf("reschedule restore job: %w", err)
	}
	return nil
}

// Job reads one restore, scoped to the tenant that asked. A restore in another
// Project or Environment reads as absent rather than forbidden, so the surface
// cannot be used to probe for the existence of another tenant's restores.
func (r *Repository) Job(ctx context.Context, projectID, environmentID, restoreID string) (billingrestore.Job, error) {
	var job billingrestore.Job
	var customerID *string
	var outcome *string
	err := r.pool.QueryRow(ctx,
		`SELECT id, project_id, environment_id, billing_customer_id, store_platform,
		        status, outcome, provider_outcome, uncertainty_reason,
		        observed_transaction_count, pending_validation_count,
		        baseline_snapshot_version, snapshot_version, correlation_id,
		        attempt_count, max_attempts, requested_at, updated_at, completed_at
		 FROM restore_sync_jobs
		 WHERE id = $1 AND project_id = $2 AND environment_id = $3`,
		restoreID, projectID, environmentID).
		Scan(&job.ID, &job.ProjectID, &job.EnvironmentID, &customerID, &job.StorePlatform,
			&job.Status, &outcome, &job.ProviderOutcome, &job.UncertaintyReason,
			&job.ObservedTransactionCount, &job.PendingValidationCount,
			&job.BaselineSnapshotVersion, &job.SnapshotVersion, &job.CorrelationID,
			&job.AttemptCount, &job.MaxAttempts, &job.RequestedAt, &job.UpdatedAt,
			&job.CompletedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingrestore.Job{}, billingrestore.ErrNotFound
	}
	if err != nil {
		return billingrestore.Job{}, fmt.Errorf("read restore job: %w", err)
	}
	if customerID != nil {
		job.CustomerID = *customerID
	}
	if outcome != nil {
		job.Outcome = *outcome
	}
	return job, nil
}

// providerFor maps the contract's store platform onto the ingestion provider
// vocabulary. The two enumerations are deliberately separate — one is the
// frozen wire contract, the other is a storage CHECK — and this is the only
// place they meet.
func providerFor(storePlatform string) string {
	if storePlatform == billingrestore.StoreApple {
		return "app_store"
	}
	return "google_play"
}

func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}
