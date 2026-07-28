package billingpostgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
)

const (
	defaultPageLimit = 25
	maxPageLimit     = 100
)

// authorizeEnvironment checks the actor's role and that the Environment belongs
// to the Project in one place, so no list query can be reached through a
// mismatched pair.
func (r *Repository) authorizeEnvironment(ctx context.Context, actor billing.Actor, projectID, environmentID string) error {
	if _, err := requireRole(ctx, r.pool, actor, projectID, "owner", "admin"); err != nil {
		return err
	}
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT true FROM environments WHERE id=$1 AND project_id=$2`, environmentID, projectID).Scan(&exists)
	if errors.Is(err, pgx.ErrNoRows) {
		return billing.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("resolve billing environment: %w", err)
	}
	return nil
}

func pageLimit(options billing.ListOptions) int {
	if options.Limit <= 0 {
		return defaultPageLimit
	}
	if options.Limit > maxPageLimit {
		return maxPageLimit
	}
	return options.Limit
}

// cursorAfter turns an opaque cursor into a keyset predicate value. The cursor
// is the last row's identifier, so paging is stable under concurrent appends —
// an offset would silently skip rows as the ledger grows.
func cursorAfter(options billing.ListOptions) string { return strings.TrimSpace(options.Cursor) }

func (r *Repository) ListFacts(ctx context.Context, actor billing.Actor, projectID, environmentID string, options billing.ListOptions) (billing.Page[billing.TransactionFact], error) {
	if err := r.authorizeEnvironment(ctx, actor, projectID, environmentID); err != nil {
		return billing.Page[billing.TransactionFact]{}, err
	}
	limit := pageLimit(options)
	rows, err := r.pool.Query(ctx,
		`SELECT id, project_id, environment_id, application_id, provider, store_environment,
		        provider_transaction_id, COALESCE(provider_original_transaction_id,''),
		        transaction_type, fact_kind, occurred_at, period_start_at, period_end_at,
		        revoked_at, refunded_at, renewal_expected, is_test_transaction,
		        provider_product_identifier, COALESCE(provider_base_plan_identifier,''),
		        COALESCE(provider_offer_identifier,''), resolution_state,
		        COALESCE(mosaic_product_id,''), COALESCE(provider_product_mapping_id,''),
		        resolved_mapping_version, validator_version, fact_version,
		        source_raw_input_id, validation_attempt_id, recorded_at
		 FROM billing_transaction_facts
		 WHERE environment_id=$1
		   AND ($2 = '' OR id < $2)
		   AND ($3::text = '' OR provider = $3)
		   AND ($4::timestamptz IS NULL OR occurred_at >= $4)
		   AND ($5::timestamptz IS NULL OR occurred_at <= $5)
		 ORDER BY occurred_at DESC, id DESC
		 LIMIT $6`, environmentID, cursorAfter(options), options.Provider, options.From, options.To, limit+1)
	if err != nil {
		return billing.Page[billing.TransactionFact]{}, fmt.Errorf("list transaction facts: %w", err)
	}
	defer rows.Close()
	items := make([]billing.TransactionFact, 0, limit)
	for rows.Next() {
		var fact billing.TransactionFact
		if err := rows.Scan(&fact.ID, &fact.ProjectID, &fact.EnvironmentID, &fact.ApplicationID,
			&fact.Provider, &fact.StoreEnvironment, &fact.ProviderTransactionID,
			&fact.ProviderOriginalTransactionID, &fact.TransactionType, &fact.FactKind, &fact.OccurredAt,
			&fact.PeriodStartAt, &fact.PeriodEndAt, &fact.RevokedAt, &fact.RefundedAt,
			&fact.RenewalExpected, &fact.IsTestTransaction, &fact.ProviderProductIdentifier,
			&fact.ProviderBasePlanIdentifier, &fact.ProviderOfferIdentifier, &fact.ResolutionState,
			&fact.MosaicProductID, &fact.ProviderProductMappingID, &fact.ResolvedMappingVersion,
			&fact.ValidatorVersion, &fact.FactVersion, &fact.SourceRawInputID,
			&fact.ValidationAttemptID, &fact.RecordedAt); err != nil {
			return billing.Page[billing.TransactionFact]{}, fmt.Errorf("scan transaction fact: %w", err)
		}
		items = append(items, fact)
	}
	if err := rows.Err(); err != nil {
		return billing.Page[billing.TransactionFact]{}, fmt.Errorf("read transaction facts: %w", err)
	}
	return paginate(items, limit, func(fact billing.TransactionFact) string { return fact.ID }), nil
}

func paginate[T any](items []T, limit int, key func(T) string) billing.Page[T] {
	page := billing.Page[T]{Items: items}
	if len(items) > limit {
		page.Items = items[:limit]
		page.NextCursor = key(page.Items[limit-1])
	}
	return page
}

func (r *Repository) ListAttempts(ctx context.Context, actor billing.Actor, projectID, environmentID string, options billing.ListOptions) (billing.Page[billing.ValidationAttempt], error) {
	if err := r.authorizeEnvironment(ctx, actor, projectID, environmentID); err != nil {
		return billing.Page[billing.ValidationAttempt]{}, err
	}
	limit := pageLimit(options)
	rows, err := r.pool.Query(ctx,
		`SELECT id, project_id, environment_id, raw_input_id, COALESCE(credential_id,''), attempt_number,
		        validator_version, started_at, completed_at, outcome, retryable,
		        COALESCE(failure_category,''), COALESCE(diagnostic_code,''), COALESCE(provider_code,''),
		        COALESCE(provider_http_status,0), store_environment, latency_ms,
		        COALESCE(replay_of_attempt_id,''), correlation_id
		 FROM billing_validation_attempts
		 WHERE environment_id=$1 AND ($2 = '' OR id < $2)
		   AND ($3::text = '' OR outcome = $3)
		   AND ($4::text = '' OR raw_input_id = $4)
		 ORDER BY started_at DESC, id DESC LIMIT $5`,
		environmentID, cursorAfter(options), options.Status, options.RawInputID, limit+1)
	if err != nil {
		return billing.Page[billing.ValidationAttempt]{}, fmt.Errorf("list validation attempts: %w", err)
	}
	defer rows.Close()
	items := make([]billing.ValidationAttempt, 0, limit)
	for rows.Next() {
		var attempt billing.ValidationAttempt
		if err := rows.Scan(&attempt.ID, &attempt.ProjectID, &attempt.EnvironmentID, &attempt.RawInputID,
			&attempt.CredentialID, &attempt.AttemptNumber, &attempt.ValidatorVersion, &attempt.StartedAt,
			&attempt.CompletedAt, &attempt.Outcome, &attempt.Retryable, &attempt.FailureCategory,
			&attempt.DiagnosticCode, &attempt.ProviderCode, &attempt.ProviderHTTPStatus,
			&attempt.StoreEnvironment, &attempt.LatencyMs, &attempt.ReplayOfAttemptID,
			&attempt.CorrelationID); err != nil {
			return billing.Page[billing.ValidationAttempt]{}, fmt.Errorf("scan validation attempt: %w", err)
		}
		items = append(items, attempt)
	}
	if err := rows.Err(); err != nil {
		return billing.Page[billing.ValidationAttempt]{}, fmt.Errorf("read validation attempts: %w", err)
	}
	return paginate(items, limit, func(a billing.ValidationAttempt) string { return a.ID }), nil
}

func (r *Repository) ListLedger(ctx context.Context, actor billing.Actor, projectID, environmentID string, options billing.ListOptions) (billing.Page[billing.LedgerEntry], error) {
	if err := r.authorizeEnvironment(ctx, actor, projectID, environmentID); err != nil {
		return billing.Page[billing.LedgerEntry]{}, err
	}
	limit := pageLimit(options)
	rows, err := r.pool.Query(ctx,
		`SELECT id, project_id, environment_id, entry_type, COALESCE(raw_input_id,''),
		        COALESCE(validation_attempt_id,''), COALESCE(transaction_fact_id,''),
		        COALESCE(credential_id,''), correlation_id, occurred_at
		 FROM billing_ledger_entries
		 WHERE environment_id=$1 AND ($2 = '' OR id < $2)
		   AND ($3::text = '' OR entry_type = $3)
		   AND ($4::timestamptz IS NULL OR occurred_at >= $4)
		   AND ($5::timestamptz IS NULL OR occurred_at <= $5)
		 ORDER BY occurred_at DESC, id DESC LIMIT $6`,
		environmentID, cursorAfter(options), options.Status, options.From, options.To, limit+1)
	if err != nil {
		return billing.Page[billing.LedgerEntry]{}, fmt.Errorf("list billing ledger: %w", err)
	}
	defer rows.Close()
	items := make([]billing.LedgerEntry, 0, limit)
	for rows.Next() {
		var entry billing.LedgerEntry
		if err := rows.Scan(&entry.ID, &entry.ProjectID, &entry.EnvironmentID, &entry.EntryType,
			&entry.RawInputID, &entry.ValidationAttemptID, &entry.TransactionFactID, &entry.CredentialID,
			&entry.CorrelationID, &entry.OccurredAt); err != nil {
			return billing.Page[billing.LedgerEntry]{}, fmt.Errorf("scan billing ledger entry: %w", err)
		}
		items = append(items, entry)
	}
	if err := rows.Err(); err != nil {
		return billing.Page[billing.LedgerEntry]{}, fmt.Errorf("read billing ledger: %w", err)
	}
	return paginate(items, limit, func(e billing.LedgerEntry) string { return e.ID }), nil
}

// quarantineColumns joins the Store Environment back from the quarantined
// input. The quarantine record does not carry its own copy — a record is
// always about exactly one input, so duplicating the column would create a
// second place for the two to disagree — but the operator surface must show it,
// because sandbox and production must stay visibly separate everywhere.
const quarantineColumns = `q.id, q.project_id, q.environment_id, q.raw_input_id, COALESCE(q.application_id,''), q.provider,
	COALESCE(i.store_environment, 'unclassified'),
	COALESCE(res.provider_product_identifier, ''),
	q.reason_code, q.severity, q.scopes, q.status, q.attempt_count, q.first_seen_at, q.last_attempt_at,
	COALESCE(q.closing_attempt_id,''), COALESCE(q.superseded_by_record_id,''), q.closed_at, COALESCE(q.diagnostic_code,'')`

// quarantineFrom is the shared join. LEFT JOIN rather than INNER: a record must
// remain listable even if its input row is somehow unreachable, and the COALESCE
// above turns that into an explicit "unclassified" instead of dropping the row.
// The resolution join is LATERAL and ordered: an input may have several
// resolution attempts, and the operator needs the most recent one — the
// Product identifier that is currently failing to resolve, not the first one
// that ever did.
const quarantineFrom = `FROM billing_quarantine_records q
	LEFT JOIN billing_raw_inputs i ON i.id = q.raw_input_id AND i.project_id = q.project_id
	LEFT JOIN LATERAL (
		SELECT r.provider_product_identifier FROM billing_product_resolutions r
		WHERE r.raw_input_id = q.raw_input_id AND r.project_id = q.project_id
		ORDER BY r.resolved_at DESC LIMIT 1
	) res ON true`

func scanQuarantine(row pgx.Row) (billing.QuarantineRecord, error) {
	var record billing.QuarantineRecord
	err := row.Scan(&record.ID, &record.ProjectID, &record.EnvironmentID, &record.RawInputID,
		&record.ApplicationID, &record.Provider, &record.StoreEnvironment,
		&record.ProviderProductIdentifier,
		&record.ReasonCode, &record.Severity, &record.Scopes,
		&record.Status, &record.AttemptCount, &record.FirstSeenAt, &record.LastAttemptAt,
		&record.ClosingAttemptID, &record.SupersededByRecordID, &record.ClosedAt, &record.DiagnosticCode)
	return record, err
}

func (r *Repository) ListQuarantine(ctx context.Context, actor billing.Actor, projectID, environmentID string, options billing.ListOptions) (billing.Page[billing.QuarantineRecord], error) {
	if err := r.authorizeEnvironment(ctx, actor, projectID, environmentID); err != nil {
		return billing.Page[billing.QuarantineRecord]{}, err
	}
	limit := pageLimit(options)
	rows, err := r.pool.Query(ctx,
		`SELECT `+quarantineColumns+`
		 `+quarantineFrom+`
		 WHERE q.environment_id=$1 AND ($2 = '' OR q.id < $2)
		   AND ($3::text = '' OR q.status = $3)
		   AND ($4::text = '' OR q.reason_code = $4)
		   AND ($5::text = '' OR q.provider = $5)
		 ORDER BY q.last_attempt_at DESC, q.id DESC LIMIT $6`,
		environmentID, cursorAfter(options), options.Status, options.ReasonCode, options.Provider, limit+1)
	if err != nil {
		return billing.Page[billing.QuarantineRecord]{}, fmt.Errorf("list quarantine records: %w", err)
	}
	defer rows.Close()
	items := make([]billing.QuarantineRecord, 0, limit)
	for rows.Next() {
		record, err := scanQuarantine(rows)
		if err != nil {
			return billing.Page[billing.QuarantineRecord]{}, fmt.Errorf("scan quarantine record: %w", err)
		}
		items = append(items, record)
	}
	if err := rows.Err(); err != nil {
		return billing.Page[billing.QuarantineRecord]{}, fmt.Errorf("read quarantine records: %w", err)
	}
	return paginate(items, limit, func(q billing.QuarantineRecord) string { return q.ID }), nil
}

func (r *Repository) Quarantine(ctx context.Context, actor billing.Actor, projectID, recordID string) (billing.QuarantineRecord, error) {
	if _, err := requireRole(ctx, r.pool, actor, projectID, "owner", "admin"); err != nil {
		return billing.QuarantineRecord{}, err
	}
	record, err := scanQuarantine(r.pool.QueryRow(ctx,
		`SELECT `+quarantineColumns+` `+quarantineFrom+` WHERE q.id=$1 AND q.project_id=$2`,
		recordID, projectID))
	if errors.Is(err, pgx.ErrNoRows) {
		return billing.QuarantineRecord{}, billing.ErrNotFound
	}
	if err != nil {
		return billing.QuarantineRecord{}, fmt.Errorf("read quarantine record: %w", err)
	}
	return record, nil
}

// RequeueValidation is the retry recovery action.
//
// It re-arms the queue row and marks the quarantine as retrying. It does not
// change the record's status to anything resembling resolved: only a subsequent
// successful attempt can do that, inside CompleteAttempt, with the attempt id
// recorded as the justification.
// OpenQuarantine records a quarantine outside a validation attempt.
//
// Reconciliation needs this because a conflicting discovery is not a failure of
// the attempt that produced it — that attempt validated successfully and
// appended a legitimate fact. What needs an operator is the contradiction
// between that fact and the one already on record, and nothing is overwritten
// either way: both facts stand and the quarantine is the diagnostic over them.
func (r *Repository) OpenQuarantine(ctx context.Context, projectID, environmentID string, write billing.QuarantineWrite) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin quarantine write: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := upsertQuarantine(ctx, tx, projectID, environmentID, write); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *Repository) RequeueValidation(ctx context.Context, actor billing.Actor, projectID, recordID string, now time.Time) (billing.QuarantineRecord, error) {
	if _, err := requireRole(ctx, r.pool, actor, projectID, "owner", "admin"); err != nil {
		return billing.QuarantineRecord{}, err
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billing.QuarantineRecord{}, fmt.Errorf("begin quarantine retry: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var rawInputID, environmentID, provider string
	err = tx.QueryRow(ctx,
		`SELECT raw_input_id, environment_id, provider FROM billing_quarantine_records
		 WHERE id=$1 AND project_id=$2 AND status IN ('open','retrying')`, recordID, projectID).
		Scan(&rawInputID, &environmentID, &provider)
	if errors.Is(err, pgx.ErrNoRows) {
		return billing.QuarantineRecord{}, billing.ErrNotFound
	}
	if err != nil {
		return billing.QuarantineRecord{}, fmt.Errorf("read quarantine record for retry: %w", err)
	}

	// attempt_count is reset so the operator's retry gets a full attempt budget
	// rather than inheriting an exhausted one; the attempt history itself is
	// append-only and unaffected.
	if _, err := tx.Exec(ctx,
		`INSERT INTO billing_validation_jobs(
			id, project_id, environment_id, raw_input_id, provider, status,
			attempt_count, max_attempts, available_at, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,'queued',0,$6,$7,$7,$7)
		 ON CONFLICT (raw_input_id) DO UPDATE
		   SET status='queued', attempt_count=0, available_at=$7, updated_at=$7,
		       lease_owner=NULL, lease_expires_at=NULL`,
		"bvj_"+hashID(rawInputID, "retry", now), projectID, environmentID, rawInputID,
		provider, billing.MaxValidationAttempts, now); err != nil {
		return billing.QuarantineRecord{}, fmt.Errorf("requeue validation: %w", err)
	}

	if _, err := tx.Exec(ctx,
		`UPDATE billing_quarantine_records SET status='retrying', last_attempt_at=$2
		 WHERE id=$1`, recordID, now); err != nil {
		return billing.QuarantineRecord{}, fmt.Errorf("mark quarantine retrying: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO billing_quarantine_actions(id, project_id, quarantine_record_id, action, outcome, actor_id, occurred_at)
		 VALUES ($1,$2,$3,'retry_validation','accepted',$4,$5)`,
		"bqa_"+hashID(recordID, "retry", now), projectID, recordID, actor.ID, now); err != nil {
		return billing.QuarantineRecord{}, fmt.Errorf("record quarantine action: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return billing.QuarantineRecord{}, fmt.Errorf("commit quarantine retry: %w", err)
	}
	return r.Quarantine(ctx, actor, projectID, recordID)
}

// CloseQuarantineSuperseded closes a record because a later record replaced it.
// It asserts nothing about the original input's authenticity and produces no
// Transaction Fact.
func (r *Repository) CloseQuarantineSuperseded(ctx context.Context, actor billing.Actor, projectID, recordID, supersededBy string, now time.Time) (billing.QuarantineRecord, error) {
	if _, err := requireRole(ctx, r.pool, actor, projectID, "owner", "admin"); err != nil {
		return billing.QuarantineRecord{}, err
	}
	tag, err := r.pool.Exec(ctx,
		`UPDATE billing_quarantine_records
		 SET status='closed_superseded', superseded_by_record_id=$3, closed_at=$4,
		     closed_by_actor_id=$5, last_attempt_at=$4
		 WHERE id=$1 AND project_id=$2 AND status IN ('open','retrying')`,
		recordID, projectID, supersededBy, now, actor.ID)
	if err != nil {
		return billing.QuarantineRecord{}, fmt.Errorf("close quarantine record: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return billing.QuarantineRecord{}, billing.ErrNotFound
	}
	_, _ = r.pool.Exec(ctx,
		`INSERT INTO billing_quarantine_actions(id, project_id, quarantine_record_id, action, outcome, actor_id, occurred_at)
		 VALUES ($1,$2,$3,'close_superseded','succeeded',$4,$5)`,
		"bqa_"+hashID(recordID, "superseded", now), projectID, recordID, actor.ID, now)
	return r.Quarantine(ctx, actor, projectID, recordID)
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

const reconciliationColumns = `id, project_id, environment_id, credential_id, provider, trigger, strategy,
	status, window_start, window_end, COALESCE(cursor_token,''), examined_count, discovered_count,
	duplicate_count, failure_count, conflict_count, COALESCE(last_error_code,''), created_at, started_at, completed_at,
	cursor_received_at, COALESCE(cursor_input_id,'')`

func scanReconciliation(row pgx.Row) (billing.ReconciliationRun, error) {
	var run billing.ReconciliationRun
	err := row.Scan(&run.ID, &run.ProjectID, &run.EnvironmentID, &run.CredentialID, &run.Provider,
		&run.Trigger, &run.Strategy, &run.Status, &run.WindowStart, &run.WindowEnd, &run.CursorToken,
		&run.ExaminedCount, &run.DiscoveredCount, &run.DuplicateCount, &run.FailureCount,
		&run.ConflictCount, &run.LastErrorCode, &run.CreatedAt, &run.StartedAt, &run.CompletedAt,
		&run.Cursor.ReceivedAt, &run.Cursor.InputID)
	return run, err
}

// writeAuditEvent records a sensitive billing operation in the shared audit
// log.
//
// Credential lifecycle and quarantine recovery already have append-only domain
// tables of their own. Replay and manual reconciliation did not: their only
// actor record was `requested_by_actor_id` on a mutable job row, which anyone
// with database access could rewrite after the fact. Metadata carries
// identifiers and enumerations only — never a token, a payload, or a window an
// attacker could use to infer content.
func writeAuditEvent(ctx context.Context, q execer, actor billing.Actor, organizationID, projectID, environmentID,
	action, resourceType, resourceID string, metadata map[string]string, now time.Time) error {
	encoded := []byte("{}")
	if len(metadata) > 0 {
		if raw, err := json.Marshal(metadata); err == nil {
			encoded = raw
		}
	}
	_, err := q.Exec(ctx,
		`INSERT INTO audit_events(id, actor_id, organization_id, project_id, environment_id,
			action, resource_type, resource_id, metadata, created_at)
		 VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,$7,$8,$9,$10)`,
		"aud_"+hashID(resourceID, action, now), actor.ID, organizationID, projectID, environmentID,
		action, resourceType, resourceID, encoded, now)
	if err != nil {
		return fmt.Errorf("write billing audit event: %w", err)
	}
	return nil
}

type execer interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func (r *Repository) CreateReconciliationRun(ctx context.Context, actor billing.Actor, run billing.ReconciliationRun, now time.Time) (billing.ReconciliationRun, error) {
	organizationID, err := requireRole(ctx, r.pool, actor, run.ProjectID, "owner", "admin")
	if err != nil {
		return billing.ReconciliationRun{}, err
	}
	_, err = r.pool.Exec(ctx,
		`INSERT INTO billing_reconciliation_runs(
			id, project_id, environment_id, credential_id, provider, trigger, strategy, status,
			window_start, window_end, available_at, requested_by_actor_id, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,'queued',$8,$9,$10,$11,$10,$10)`,
		run.ID, run.ProjectID, run.EnvironmentID, run.CredentialID, run.Provider, run.Trigger,
		run.Strategy, run.WindowStart, run.WindowEnd, now, actor.ID)
	if err != nil {
		if isUniqueViolation(err) {
			// A run for this credential and strategy is already live. Refusing
			// keeps two runs from scanning the same window concurrently.
			return billing.ReconciliationRun{}, billing.ErrConflict
		}
		return billing.ReconciliationRun{}, fmt.Errorf("create reconciliation run: %w", err)
	}
	if err := writeAuditEvent(ctx, r.pool, actor, organizationID, run.ProjectID, run.EnvironmentID,
		"billing.reconciliation_run.created", "billing_reconciliation_run", run.ID,
		map[string]string{"provider": run.Provider, "strategy": run.Strategy, "trigger": run.Trigger},
		now); err != nil {
		return billing.ReconciliationRun{}, err
	}
	return scanReconciliation(r.pool.QueryRow(ctx,
		`SELECT `+reconciliationColumns+` FROM billing_reconciliation_runs WHERE id=$1`, run.ID))
}

func (r *Repository) ListReconciliationRuns(ctx context.Context, actor billing.Actor, projectID, environmentID string, options billing.ListOptions) (billing.Page[billing.ReconciliationRun], error) {
	if err := r.authorizeEnvironment(ctx, actor, projectID, environmentID); err != nil {
		return billing.Page[billing.ReconciliationRun]{}, err
	}
	limit := pageLimit(options)
	rows, err := r.pool.Query(ctx,
		`SELECT `+reconciliationColumns+` FROM billing_reconciliation_runs
		 WHERE environment_id=$1 AND ($2 = '' OR id < $2) AND ($3::text = '' OR status = $3)
		 ORDER BY created_at DESC, id DESC LIMIT $4`,
		environmentID, cursorAfter(options), options.Status, limit+1)
	if err != nil {
		return billing.Page[billing.ReconciliationRun]{}, fmt.Errorf("list reconciliation runs: %w", err)
	}
	defer rows.Close()
	items := make([]billing.ReconciliationRun, 0, limit)
	for rows.Next() {
		run, err := scanReconciliation(rows)
		if err != nil {
			return billing.Page[billing.ReconciliationRun]{}, fmt.Errorf("scan reconciliation run: %w", err)
		}
		items = append(items, run)
	}
	if err := rows.Err(); err != nil {
		return billing.Page[billing.ReconciliationRun]{}, fmt.Errorf("read reconciliation runs: %w", err)
	}
	return paginate(items, limit, func(run billing.ReconciliationRun) string { return run.ID }), nil
}

func (r *Repository) LeaseReconciliationRun(ctx context.Context, workerID string, now, leaseUntil time.Time) (billing.ReconciliationRun, bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billing.ReconciliationRun{}, false, fmt.Errorf("begin reconciliation lease: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var id string
	err = tx.QueryRow(ctx,
		`SELECT id FROM billing_reconciliation_runs
		 WHERE (status='queued' OR (status='leased' AND lease_expires_at <= $1))
		   AND available_at <= $1 AND attempt_count < max_attempts
		 ORDER BY available_at, created_at, id FOR UPDATE SKIP LOCKED LIMIT 1`, now).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return billing.ReconciliationRun{}, false, nil
	}
	if err != nil {
		return billing.ReconciliationRun{}, false, fmt.Errorf("select reconciliation run: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE billing_reconciliation_runs
		 SET status='leased', lease_owner=$2, lease_expires_at=$3, attempt_count=attempt_count+1,
		     started_at=COALESCE(started_at,$4), updated_at=$4
		 WHERE id=$1`, id, workerID, leaseUntil, now); err != nil {
		return billing.ReconciliationRun{}, false, fmt.Errorf("lease reconciliation run: %w", err)
	}
	run, err := scanReconciliation(tx.QueryRow(ctx,
		`SELECT `+reconciliationColumns+` FROM billing_reconciliation_runs WHERE id=$1`, id))
	if err != nil {
		return billing.ReconciliationRun{}, false, fmt.Errorf("read leased reconciliation run: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return billing.ReconciliationRun{}, false, fmt.Errorf("commit reconciliation lease: %w", err)
	}
	return run, true, nil
}

// UpdateReconciliationProgress commits the cursor and returns the run to the
// queue. Committing after each page is what makes a run restart-safe.
func (r *Repository) UpdateReconciliationProgress(ctx context.Context, run billing.ReconciliationRun, cursorToken string, cursor billing.InputCursor, now time.Time) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE billing_reconciliation_runs
		 SET status='queued', cursor_token=NULLIF($2,''), examined_count=$3, discovered_count=$4,
		     duplicate_count=$5, failure_count=$6, conflict_count=$7, available_at=$8, lease_owner=NULL,
		     lease_expires_at=NULL, cursor_received_at=$9, cursor_input_id=NULLIF($10,''), updated_at=$8
		 WHERE id=$1`, run.ID, cursorToken, run.ExaminedCount, run.DiscoveredCount,
		run.DuplicateCount, run.FailureCount, run.ConflictCount, now,
		cursor.ReceivedAt, cursor.InputID)
	if err != nil {
		return fmt.Errorf("update reconciliation progress: %w", err)
	}
	return nil
}

func (r *Repository) CompleteReconciliationRun(ctx context.Context, run billing.ReconciliationRun, status, errorCode string, now time.Time) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE billing_reconciliation_runs
		 SET status=$2, examined_count=$3, discovered_count=$4, duplicate_count=$5, failure_count=$6,
		     conflict_count=$7,
		     last_error_code=NULLIF($8,''), completed_at=$9, lease_owner=NULL, lease_expires_at=NULL, updated_at=$9
		 WHERE id=$1`, run.ID, status, run.ExaminedCount, run.DiscoveredCount, run.DuplicateCount,
		run.FailureCount, run.ConflictCount, errorCode, now)
	if err != nil {
		return fmt.Errorf("complete reconciliation run: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

const replayColumns = `id, project_id, environment_id, kind, COALESCE(raw_input_id,''), window_start, window_end,
	validator_version, status, COALESCE(comparison_result,''), examined_count, unchanged_count,
	new_fact_count, conflict_count, COALESCE(last_error_code,''), created_at, completed_at,
	cursor_received_at, COALESCE(cursor_input_id,'')`

func scanReplay(row pgx.Row) (billing.ReplayJob, error) {
	var job billing.ReplayJob
	err := row.Scan(&job.ID, &job.ProjectID, &job.EnvironmentID, &job.Kind, &job.RawInputID,
		&job.WindowStart, &job.WindowEnd, &job.ValidatorVersion, &job.Status, &job.ComparisonResult,
		&job.ExaminedCount, &job.UnchangedCount, &job.NewFactCount, &job.ConflictCount,
		&job.LastErrorCode, &job.CreatedAt, &job.CompletedAt,
		&job.Cursor.ReceivedAt, &job.Cursor.InputID)
	return job, err
}

func (r *Repository) CreateReplayJob(ctx context.Context, actor billing.Actor, job billing.ReplayJob, now time.Time) (billing.ReplayJob, error) {
	organizationID, err := requireRole(ctx, r.pool, actor, job.ProjectID, "owner", "admin")
	if err != nil {
		return billing.ReplayJob{}, err
	}
	_, err = r.pool.Exec(ctx,
		`INSERT INTO billing_replay_jobs(
			id, project_id, environment_id, kind, raw_input_id, window_start, window_end,
			validator_version, status, available_at, requested_by_actor_id, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,$7,$8,'queued',$9,$10,$9,$9)`,
		job.ID, job.ProjectID, job.EnvironmentID, job.Kind, job.RawInputID, job.WindowStart,
		job.WindowEnd, job.ValidatorVersion, now, actor.ID)
	if err != nil {
		return billing.ReplayJob{}, fmt.Errorf("create replay job: %w", err)
	}
	if err := writeAuditEvent(ctx, r.pool, actor, organizationID, job.ProjectID, job.EnvironmentID,
		"billing.replay_job.created", "billing_replay_job", job.ID,
		map[string]string{"kind": job.Kind, "validatorVersion": strconv.Itoa(job.ValidatorVersion)},
		now); err != nil {
		return billing.ReplayJob{}, err
	}
	return scanReplay(r.pool.QueryRow(ctx, `SELECT `+replayColumns+` FROM billing_replay_jobs WHERE id=$1`, job.ID))
}

func (r *Repository) ListReplayJobs(ctx context.Context, actor billing.Actor, projectID, environmentID string, options billing.ListOptions) (billing.Page[billing.ReplayJob], error) {
	if err := r.authorizeEnvironment(ctx, actor, projectID, environmentID); err != nil {
		return billing.Page[billing.ReplayJob]{}, err
	}
	limit := pageLimit(options)
	rows, err := r.pool.Query(ctx,
		`SELECT `+replayColumns+` FROM billing_replay_jobs
		 WHERE environment_id=$1 AND ($2 = '' OR id < $2) AND ($3::text = '' OR status = $3)
		 ORDER BY created_at DESC, id DESC LIMIT $4`,
		environmentID, cursorAfter(options), options.Status, limit+1)
	if err != nil {
		return billing.Page[billing.ReplayJob]{}, fmt.Errorf("list replay jobs: %w", err)
	}
	defer rows.Close()
	items := make([]billing.ReplayJob, 0, limit)
	for rows.Next() {
		job, err := scanReplay(rows)
		if err != nil {
			return billing.Page[billing.ReplayJob]{}, fmt.Errorf("scan replay job: %w", err)
		}
		items = append(items, job)
	}
	if err := rows.Err(); err != nil {
		return billing.Page[billing.ReplayJob]{}, fmt.Errorf("read replay jobs: %w", err)
	}
	return paginate(items, limit, func(job billing.ReplayJob) string { return job.ID }), nil
}

func (r *Repository) LeaseReplayJob(ctx context.Context, workerID string, now, leaseUntil time.Time) (billing.ReplayJob, bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billing.ReplayJob{}, false, fmt.Errorf("begin replay lease: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var id string
	err = tx.QueryRow(ctx,
		`SELECT id FROM billing_replay_jobs
		 WHERE (status='queued' OR (status='leased' AND lease_expires_at <= $1))
		   AND available_at <= $1 AND attempt_count < max_attempts
		 ORDER BY available_at, created_at, id FOR UPDATE SKIP LOCKED LIMIT 1`, now).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return billing.ReplayJob{}, false, nil
	}
	if err != nil {
		return billing.ReplayJob{}, false, fmt.Errorf("select replay job: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE billing_replay_jobs
		 SET status='leased', lease_owner=$2, lease_expires_at=$3, attempt_count=attempt_count+1, updated_at=$4
		 WHERE id=$1`, id, workerID, leaseUntil, now); err != nil {
		return billing.ReplayJob{}, false, fmt.Errorf("lease replay job: %w", err)
	}
	job, err := scanReplay(tx.QueryRow(ctx, `SELECT `+replayColumns+` FROM billing_replay_jobs WHERE id=$1`, id))
	if err != nil {
		return billing.ReplayJob{}, false, fmt.Errorf("read leased replay job: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return billing.ReplayJob{}, false, fmt.Errorf("commit replay lease: %w", err)
	}
	return job, true, nil
}

// ReplayInputs selects the inputs a replay or reconciliation step will re-run.
// Only inputs whose body is still retained are eligible: an expired body cannot
// be re-validated, and pretending otherwise would produce an attempt with
// nothing behind it.
func (r *Repository) ReplayInputs(ctx context.Context, job billing.ReplayJob, filter billing.InputFilter, cursor billing.InputCursor, limit int) ([]billing.RawInput, billing.InputCursor, error) {
	if limit <= 0 {
		limit = 50
	}
	sources := filter.Sources
	if sources == nil {
		sources = []string{}
	}
	// The keyset predicate. Ordering by (received_at, id) is stable under the
	// continuous appends this table sees, so resuming strictly after the last
	// examined position can neither skip nor repeat a row — which an OFFSET
	// would do in both directions as the window fills underneath a multi-pass
	// scan.
	rows, err := r.pool.Query(ctx,
		`SELECT id, received_at FROM billing_raw_inputs
		 WHERE project_id=$1 AND environment_id=$2 AND body_state='stored'
		   AND ($3 = '' OR id = $3)
		   AND ($4::timestamptz IS NULL OR received_at >= $4)
		   AND ($5::timestamptz IS NULL OR received_at <= $5)
		   AND ($6 = '' OR provider = $6)
		   AND (cardinality($7::text[]) = 0 OR source = ANY($7::text[]))
		   AND ($8::timestamptz IS NULL OR (received_at, id) > ($8::timestamptz, $9))
		 ORDER BY received_at, id LIMIT $10`,
		job.ProjectID, job.EnvironmentID, job.RawInputID, job.WindowStart, job.WindowEnd,
		filter.Provider, sources, cursor.ReceivedAt, cursor.InputID, limit)
	if err != nil {
		return nil, billing.InputCursor{}, fmt.Errorf("select replay inputs: %w", err)
	}
	defer rows.Close()
	ids := make([]string, 0, limit)
	next := cursor
	for rows.Next() {
		var id string
		var receivedAt time.Time
		if err := rows.Scan(&id, &receivedAt); err != nil {
			return nil, billing.InputCursor{}, fmt.Errorf("scan replay input id: %w", err)
		}
		ids = append(ids, id)
		at := receivedAt
		next = billing.InputCursor{ReceivedAt: &at, InputID: id}
	}
	if err := rows.Err(); err != nil {
		return nil, billing.InputCursor{}, fmt.Errorf("read replay inputs: %w", err)
	}
	inputs := make([]billing.RawInput, 0, len(ids))
	for _, id := range ids {
		input, err := r.RawInput(ctx, job.ProjectID, id)
		if err != nil {
			continue
		}
		inputs = append(inputs, input)
	}
	return inputs, next, nil
}

// UpdateReplayProgress commits counters and the cursor and returns the job to
// the queue. Committing after each page is what makes a long replay resumable:
// a worker that dies mid-window resumes from the last committed position rather
// than restarting or, worse, reporting the partial scan as complete.
func (r *Repository) UpdateReplayProgress(ctx context.Context, job billing.ReplayJob, cursor billing.InputCursor, now time.Time) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE billing_replay_jobs
		 SET status='queued', examined_count=$2, unchanged_count=$3, new_fact_count=$4,
		     conflict_count=$5, available_at=$6, lease_owner=NULL, lease_expires_at=NULL,
		     cursor_received_at=$7, cursor_input_id=NULLIF($8,''), updated_at=$6
		 WHERE id=$1`, job.ID, job.ExaminedCount, job.UnchangedCount, job.NewFactCount,
		job.ConflictCount, now, cursor.ReceivedAt, cursor.InputID)
	if err != nil {
		return fmt.Errorf("update replay progress: %w", err)
	}
	return nil
}

func (r *Repository) CompleteReplayJob(ctx context.Context, job billing.ReplayJob, comparison, errorCode string, now time.Time) error {
	status := "completed"
	if errorCode != "" {
		status = "failed"
	}
	_, err := r.pool.Exec(ctx,
		`UPDATE billing_replay_jobs
		 SET status=$2, comparison_result=NULLIF($3,''), examined_count=$4, unchanged_count=$5,
		     new_fact_count=$6, conflict_count=$7, last_error_code=NULLIF($8,''), completed_at=$9,
		     lease_owner=NULL, lease_expires_at=NULL, updated_at=$9
		 WHERE id=$1`, job.ID, status, comparison, job.ExaminedCount, job.UnchangedCount,
		job.NewFactCount, job.ConflictCount, errorCode, now)
	if err != nil {
		return fmt.Errorf("complete replay job: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

func (r *Repository) Health(ctx context.Context, actor billing.Actor, projectID, environmentID string) (billing.Health, error) {
	if err := r.authorizeEnvironment(ctx, actor, projectID, environmentID); err != nil {
		return billing.Health{}, err
	}
	health := billing.Health{EnvironmentID: environmentID}
	enabled, err := r.BillingEnabled(ctx, projectID)
	if err != nil {
		return billing.Health{}, err
	}
	health.BillingEnabled = enabled

	err = r.pool.QueryRow(ctx,
		`SELECT
			(SELECT count(*) FROM store_server_credentials WHERE environment_id=$1 AND status='active'),
			(SELECT count(*) FROM store_server_credentials WHERE environment_id=$1 AND status='active'
			   AND health_status IN ('degraded','unavailable')),
			(SELECT count(*) FROM billing_validation_jobs WHERE environment_id=$1 AND status IN ('queued','leased')),
			(SELECT COALESCE(max(extract(epoch from (now()-created_at))),0) FROM billing_validation_jobs
			   WHERE environment_id=$1 AND status IN ('queued','leased')),
			(SELECT count(*) FROM billing_quarantine_records WHERE environment_id=$1 AND status IN ('open','retrying')),
			(SELECT count(*) FROM billing_transaction_facts WHERE environment_id=$1),
			(SELECT max(recorded_at) FROM billing_transaction_facts WHERE environment_id=$1),
			(SELECT max(completed_at) FROM billing_reconciliation_runs WHERE environment_id=$1 AND status='completed')`,
		environmentID).
		Scan(&health.CredentialCount, &health.UnhealthyCredentials, &health.QueueDepth,
			&health.OldestQueuedAgeSecs, &health.OpenQuarantineCount, &health.FactCount,
			&health.LastFactRecordedAt, &health.LastReconciliationAt)
	if err != nil {
		return billing.Health{}, fmt.Errorf("read billing health: %w", err)
	}
	return health, nil
}

var _ = strings.TrimSpace
