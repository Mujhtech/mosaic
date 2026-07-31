// Package billingaccesspostgres is the PostgreSQL implementation of the
// billing access persistence port.
//
// Everything here reads committed state. There is no write path except the
// token lifecycle and audit events: an access surface that could repair or
// derive would eventually disagree with the projection, and two authoritative
// answers is worse than one slow one.
package billingaccesspostgres

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingaccess"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingmigrationpostgres"
)

type Repository struct {
	pool             *pgxpool.Pool
	migrationSignals *billingmigrationpostgres.Repository
}

func New(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool, migrationSignals: billingmigrationpostgres.New(pool)}
}

var _ billingaccess.Repository = (*Repository)(nil)
var _ billingaccess.AccessAPISignalRecorder = (*Repository)(nil)

// RecordAccessAPIResult forwards only PII-free scope, timing, and outcome to
// the Phase 9C immutable evidence repository. It intentionally has no customer,
// entitlement, credential, or request-payload parameter.
func (r *Repository) RecordAccessAPIResult(ctx context.Context, projectID, environmentID string, startedAt, endedAt time.Time, failed bool) error {
	if r == nil || r.migrationSignals == nil {
		return errors.New("billing migration access signal repository is unavailable")
	}
	return r.migrationSignals.RecordTrustedAccessAPIResult(ctx, projectID, environmentID, endedAt.Sub(startedAt), failed)
}

func (r *Repository) BillingEnabled(ctx context.Context, projectID string) (bool, error) {
	var enabled bool
	err := r.pool.QueryRow(ctx,
		`SELECT billing_enabled FROM billing_project_settings WHERE project_id = $1`, projectID).
		Scan(&enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read billing enablement: %w", err)
	}
	return enabled, nil
}

// ---------------------------------------------------------------------------
// Customer Access Tokens
// ---------------------------------------------------------------------------

func (r *Repository) CreateToken(ctx context.Context, token billingaccess.Token, digest []byte, actorReference string) (billingaccess.Token, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billingaccess.Token{}, fmt.Errorf("begin token issuance: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx,
		`INSERT INTO customer_access_tokens(
			id, project_id, environment_id, billing_customer_id, token_digest,
			audience, scopes, issued_by_api_key_id, issued_at, expires_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,NULLIF($8,''),$9,$10)`,
		token.ID, token.ProjectID, token.EnvironmentID, token.CustomerID, digest,
		token.Audience, token.Scopes, token.IssuedByAPIKeyID, token.IssuedAt, token.ExpiresAt); err != nil {
		return billingaccess.Token{}, fmt.Errorf("insert customer access token: %w", err)
	}

	// The audit event is written in the same transaction as the token: an
	// issuance that is not auditable is a credential nobody can account for.
	if err := recordAudit(ctx, tx, token.ProjectID, token.EnvironmentID, actorReference,
		"billing.customer_token.issued", "customer_access_token", token.ID,
		map[string]string{
			"billingCustomerId": token.CustomerID,
			"audience":          token.Audience,
			"scopes":            strings.Join(token.Scopes, ","),
			"expiresAt":         token.ExpiresAt.UTC().Format(time.RFC3339),
		}, token.IssuedAt); err != nil {
		return billingaccess.Token{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return billingaccess.Token{}, fmt.Errorf("commit token issuance: %w", err)
	}
	return token, nil
}

const tokenColumns = `id, project_id, environment_id, billing_customer_id, audience, scopes,
	COALESCE(issued_by_api_key_id,''), issued_at, expires_at, revoked_at,
	COALESCE(revocation_reason,''), last_used_at`

func scanToken(row pgx.Row) (billingaccess.Token, error) {
	var token billingaccess.Token
	err := row.Scan(&token.ID, &token.ProjectID, &token.EnvironmentID, &token.CustomerID,
		&token.Audience, &token.Scopes, &token.IssuedByAPIKeyID, &token.IssuedAt,
		&token.ExpiresAt, &token.RevokedAt, &token.RevocationReason, &token.LastUsedAt)
	return token, err
}

func (r *Repository) TokenByDigest(ctx context.Context, digest []byte) (billingaccess.Token, error) {
	token, err := scanToken(r.pool.QueryRow(ctx,
		`SELECT `+tokenColumns+` FROM customer_access_tokens WHERE token_digest = $1`, digest))
	if errors.Is(err, pgx.ErrNoRows) {
		return billingaccess.Token{}, billingaccess.ErrUnauthenticated
	}
	if err != nil {
		return billingaccess.Token{}, fmt.Errorf("read customer access token: %w", err)
	}
	return token, nil
}

func (r *Repository) TouchToken(ctx context.Context, tokenID string, at time.Time) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE customer_access_tokens SET last_used_at = $2 WHERE id = $1`, tokenID, at)
	if err != nil {
		return fmt.Errorf("record token use: %w", err)
	}
	return nil
}

func (r *Repository) RevokeToken(ctx context.Context, scope billingaccess.KeyScope, tokenID, reason, actorReference string, at time.Time) (billingaccess.Token, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billingaccess.Token{}, fmt.Errorf("begin token revocation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// The tenant predicate is part of the statement, not a check the caller can
	// forget: a token id from another Project simply matches no row.
	token, err := scanToken(tx.QueryRow(ctx,
		`UPDATE customer_access_tokens
		 SET revoked_at = COALESCE(revoked_at, $4), revocation_reason = COALESCE(revocation_reason, $5)
		 WHERE id = $1 AND project_id = $2 AND environment_id = $3
		 RETURNING `+tokenColumns,
		tokenID, scope.ProjectID, scope.EnvironmentID, at, reason))
	if errors.Is(err, pgx.ErrNoRows) {
		return billingaccess.Token{}, billingaccess.ErrNotFound
	}
	if err != nil {
		return billingaccess.Token{}, fmt.Errorf("revoke customer access token: %w", err)
	}

	if err := recordAudit(ctx, tx, scope.ProjectID, scope.EnvironmentID, actorReference,
		"billing.customer_token.revoked", "customer_access_token", tokenID,
		map[string]string{"revocationReason": token.RevocationReason}, at); err != nil {
		return billingaccess.Token{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return billingaccess.Token{}, fmt.Errorf("commit token revocation: %w", err)
	}
	return token, nil
}

func (r *Repository) ListTokens(ctx context.Context, scope billingaccess.KeyScope, customerID string, limit int) ([]billingaccess.Token, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+tokenColumns+`
		 FROM customer_access_tokens
		 WHERE project_id = $1 AND environment_id = $2 AND billing_customer_id = $3
		 ORDER BY issued_at DESC, id DESC
		 LIMIT $4`, scope.ProjectID, scope.EnvironmentID, customerID, limit)
	if err != nil {
		return nil, fmt.Errorf("list customer access tokens: %w", err)
	}
	defer rows.Close()
	tokens := make([]billingaccess.Token, 0, limit)
	for rows.Next() {
		token, err := scanToken(rows)
		if err != nil {
			return nil, fmt.Errorf("scan customer access token: %w", err)
		}
		tokens = append(tokens, token)
	}
	return tokens, rows.Err()
}

// ---------------------------------------------------------------------------
// Committed projections
// ---------------------------------------------------------------------------

func (r *Repository) CurrentSnapshot(ctx context.Context, projectID, environmentID, customerID string) (billingaccess.SnapshotView, error) {
	var view billingaccess.SnapshotView
	var previousID *string
	err := r.pool.QueryRow(ctx,
		`SELECT s.id, s.project_id, s.environment_id, s.billing_customer_id, s.snapshot_version,
		        s.rule_version, s.computed_at, s.as_of, s.previous_snapshot_id, s.checksum,
		        s.change_reason
		 FROM customer_entitlement_pointers p
		 JOIN customer_entitlement_snapshots s ON s.id = p.current_snapshot_id
		 WHERE p.billing_customer_id = $1 AND p.environment_id = $2 AND p.project_id = $3`,
		customerID, environmentID, projectID).
		Scan(&view.SnapshotID, &view.ProjectID, &view.EnvironmentID, &view.CustomerID,
			&view.SnapshotVersion, &view.RuleVersion, &view.ComputedAt, &view.AsOf,
			&previousID, &view.Checksum, &view.ChangeReason)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingaccess.SnapshotView{}, billingaccess.ErrNotFound
	}
	if err != nil {
		return billingaccess.SnapshotView{}, fmt.Errorf("read current entitlement snapshot: %w", err)
	}

	if previousID != nil {
		// The previous version is read rather than assumed to be one less: a
		// snapshot sequence has no gaps today, but deriving it arithmetically
		// would make that an invariant nobody stated.
		if err := r.pool.QueryRow(ctx,
			`SELECT snapshot_version FROM customer_entitlement_snapshots WHERE id = $1`, *previousID).
			Scan(&view.PreviousSnapshotVersion); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return billingaccess.SnapshotView{}, fmt.Errorf("read previous snapshot version: %w", err)
		}
	}

	sourcesByEntitlement, sources, err := r.readSources(ctx, view.SnapshotID)
	if err != nil {
		return billingaccess.SnapshotView{}, err
	}
	view.Sources = sources

	entryRows, err := r.pool.Query(ctx,
		`SELECT entitlement_id, entitlement_key, state, effective_start, effective_end,
		        end_known, source_count, uncertainty_reason, is_test_source, explanation_code
		 FROM customer_entitlement_snapshot_entries
		 WHERE customer_entitlement_snapshot_id = $1
		 ORDER BY entitlement_key`, view.SnapshotID)
	if err != nil {
		return billingaccess.SnapshotView{}, fmt.Errorf("read snapshot entries: %w", err)
	}
	defer entryRows.Close()
	for entryRows.Next() {
		var entry billingaccess.SnapshotEntry
		if err := entryRows.Scan(&entry.EntitlementID, &entry.EntitlementKey, &entry.State,
			&entry.EffectiveStart, &entry.EffectiveEnd, &entry.EndKnown, &entry.SourceCount,
			&entry.UncertaintyReason, &entry.IsTestSource, &entry.ExplanationCode); err != nil {
			return billingaccess.SnapshotView{}, fmt.Errorf("scan snapshot entry: %w", err)
		}
		entry.SourceIDs = sourcesByEntitlement[entry.EntitlementID]
		view.Entries = append(view.Entries, entry)
	}
	if err := entryRows.Err(); err != nil {
		return billingaccess.SnapshotView{}, fmt.Errorf("read snapshot entries: %w", err)
	}

	view.Projection = billingaccess.ProjectionStatus{
		State: billingaccess.ProjectionCurrent, LastProjectedAt: view.ComputedAt,
	}
	return view, nil
}

func (r *Repository) readSources(ctx context.Context, snapshotID string) (map[string][]string, []billingaccess.SnapshotSource, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT e.id, e.entitlement_id, e.purchase_lineage_id, e.product_id, e.grant_version_id,
		        COALESCE(e.subscription_instance_id,''), COALESCE(e.one_time_purchase_instance_id,''),
		        COALESCE(e.source_snapshot_id,''), COALESCE(l.provider,''),
		        e.source_type, e.source_state, e.source_start, e.source_end, e.end_known,
		        e.uncertainty_reason, e.is_test_source, e.explanation_code
		 FROM entitlement_sources e
		 LEFT JOIN purchase_lineages l ON l.id = e.purchase_lineage_id
		 WHERE e.customer_entitlement_snapshot_id = $1
		 ORDER BY e.id`, snapshotID)
	if err != nil {
		return nil, nil, fmt.Errorf("read entitlement sources: %w", err)
	}
	defer rows.Close()

	byEntitlement := map[string][]string{}
	sources := make([]billingaccess.SnapshotSource, 0, 8)
	for rows.Next() {
		var source billingaccess.SnapshotSource
		if err := rows.Scan(&source.RowID, &source.EntitlementID, &source.PurchaseLineageID,
			&source.ProductID, &source.GrantVersionID, &source.SubscriptionInstanceID,
			&source.OneTimePurchaseInstanceID, &source.SourceSnapshotID, &source.StorePlatform,
			&source.SourceType, &source.SourceState, &source.SourceStart, &source.SourceEnd,
			&source.EndKnown, &source.UncertaintyReason, &source.IsTestSource,
			&source.ExplanationCode); err != nil {
			return nil, nil, fmt.Errorf("scan entitlement source: %w", err)
		}
		byEntitlement[source.EntitlementID] = append(byEntitlement[source.EntitlementID], source.RowID)
		sources = append(sources, source)
	}
	return byEntitlement, sources, rows.Err()
}

// ProjectionStatusFor reports how far behind the customer's projection is.
//
// `pending` and `stale` are the same condition at different ages: facts exist
// that no snapshot has consumed. The distinction exists because a reader can
// reasonably wait out a pending projection and should escalate a stale one.
func (r *Repository) ProjectionStatusFor(ctx context.Context, projectID, environmentID, customerID string) (billingaccess.ProjectionStatus, error) {
	status := billingaccess.ProjectionStatus{State: billingaccess.ProjectionCurrent}

	var lastProjected *time.Time
	var diagnostics string
	if err := r.pool.QueryRow(ctx,
		`SELECT last_projected_at, diagnostics_status FROM billing_customers
		 WHERE id = $1 AND project_id = $2`, customerID, projectID).
		Scan(&lastProjected, &diagnostics); err != nil {
		return status, fmt.Errorf("read customer projection state: %w", err)
	}
	if lastProjected != nil {
		status.LastProjectedAt = lastProjected.UTC()
	}

	// Facts recorded after the last projection are the backlog. Counting rows
	// rather than trusting a queue depth means an enqueue that never happened
	// still shows up.
	//
	// The join goes through the materialized chain-digest closure rather than
	// comparing `lineage_key_digest` to `purchase_chain_digest` directly. Only
	// the first fact of a Google chain carries the lineage's root digest; every
	// fact recorded after a plan change carries the successor token's digest, so
	// the direct comparison omitted precisely the customers whose state is most
	// likely to be behind and reported them as current. Reaching for the
	// projection loader's recursive CTE instead would put a per-customer chain
	// walk on the SDK sync path, which is the highest-QPS authenticated surface
	// Mosaic has — the closure is maintained by trigger so this stays one join.
	var pending int
	if err := r.pool.QueryRow(ctx,
		`SELECT count(*)
		 FROM billing_transaction_facts f
		 JOIN purchase_chain_digest_links d
		   ON d.project_id = f.project_id
		  AND d.environment_id = f.environment_id
		  AND d.chain_digest = f.purchase_chain_digest
		 JOIN purchase_lineages l
		   ON l.environment_id = d.environment_id
		  AND l.lineage_key_digest = d.root_digest
		 WHERE l.project_id = $1 AND l.environment_id = $2 AND l.billing_customer_id = $3
		   AND ($4::timestamptz IS NULL OR f.recorded_at > $4)`,
		projectID, environmentID, customerID, lastProjected).Scan(&pending); err != nil {
		return status, fmt.Errorf("count pending facts: %w", err)
	}
	status.PendingFactCount = pending

	var failedJobs int
	if err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM projection_jobs
		 WHERE project_id = $1 AND scope_key = $2 AND status = 'failed'`,
		projectID, "customer:"+customerID).Scan(&failedJobs); err != nil {
		return status, fmt.Errorf("count failed projections: %w", err)
	}

	switch {
	case failedJobs > 0:
		status.State = billingaccess.ProjectionFailed
		status.DiagnosticCode = "entitlement.projection.failed"
	case diagnostics == "identity_conflict":
		status.State = billingaccess.ProjectionDegraded
		status.DiagnosticCode = "entitlement.identity.conflictOpen"
	case pending > 0 && lastProjected != nil && time.Since(*lastProjected) > billingaccess.StaleAfter:
		status.State = billingaccess.ProjectionStale
	case pending > 0:
		status.State = billingaccess.ProjectionPending
	}
	if status.LastProjectedAt.IsZero() {
		status.LastProjectedAt = time.Now().UTC()
		if status.State == billingaccess.ProjectionCurrent {
			status.State = billingaccess.ProjectionPending
		}
	}
	return status, nil
}

func (r *Repository) Customer(ctx context.Context, projectID, customerID string) (billingaccess.CustomerView, error) {
	var view billingaccess.CustomerView
	err := r.pool.QueryRow(ctx,
		`SELECT c.id, c.project_id, c.status, c.diagnostics_status, c.current_projection_version,
		        c.last_projected_at, c.created_at, c.updated_at,
		        EXISTS (SELECT 1 FROM billing_customer_aliases a
		                WHERE a.billing_customer_id = c.id
		                  AND a.alias_type = 'application_user_id'
		                  AND a.effective_end IS NULL)
		 FROM billing_customers c
		 WHERE c.id = $1 AND c.project_id = $2`, customerID, projectID).
		Scan(&view.ID, &view.ProjectID, &view.Status, &view.DiagnosticsStatus,
			&view.CurrentProjectionVersion, &view.LastProjectedAt, &view.CreatedAt,
			&view.UpdatedAt, &view.Identified)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingaccess.CustomerView{}, billingaccess.ErrNotFound
	}
	if err != nil {
		return billingaccess.CustomerView{}, fmt.Errorf("read billing customer: %w", err)
	}
	return view, nil
}

const subscriptionColumns = `s.id, s.subscription_instance_id, COALESCE(i.purchase_lineage_id,''),
	COALESCE(i.billing_customer_id,''), s.project_id, s.environment_id, s.projection_version,
	s.rule_version, s.computed_at, s.as_of, COALESCE(i.provider,''),
	COALESCE(s.current_product_id,''), COALESCE(s.prior_product_id,''),
	s.access_state, s.lifecycle_state, s.renewal_intent, s.billing_state, s.uncertainty_reason,
	s.period_start_at, s.period_end_at, s.grace_period_end_at, s.billing_retry_start_at,
	s.pause_start_at, s.pause_resume_at, s.cancellation_effective_at, s.expiration_effective_at,
	s.revocation_effective_at, s.refund_effective_at, s.is_test_source, s.checksum,
	s.projection_reason,
	COALESCE((SELECT si2.id FROM purchase_lineages l2
	          JOIN subscription_instances si2 ON si2.purchase_lineage_id = l2.id
	          WHERE l2.id = (SELECT superseded_by_lineage_id FROM purchase_lineages
	                         WHERE id = i.purchase_lineage_id)), ''),
	COALESCE((SELECT count(*) FROM subscription_snapshot_facts f WHERE f.snapshot_id = s.id), 0)`

func scanSubscription(row pgx.Row) (billingaccess.SubscriptionView, error) {
	var view billingaccess.SubscriptionView
	err := row.Scan(&view.SnapshotID, &view.SubscriptionInstanceID, &view.PurchaseLineageID,
		&view.CustomerID, &view.ProjectID, &view.EnvironmentID, &view.ProjectionVersion,
		&view.RuleVersion, &view.ComputedAt, &view.AsOf, &view.StorePlatform,
		&view.ProductID, &view.PriorProductID, &view.AccessState, &view.LifecycleState,
		&view.RenewalIntent, &view.BillingState, &view.UncertaintyReason,
		&view.PeriodStart, &view.PeriodEnd, &view.GracePeriodEnd, &view.BillingRetryStart,
		&view.PauseEffectiveAt, &view.PauseResumeAt, &view.CancellationEffectiveAt,
		&view.ExpirationEffectiveAt, &view.RevocationEffectiveAt, &view.RefundEffectiveAt,
		&view.IsTestSource, &view.Checksum, &view.ChangeReason,
		&view.SupersededByInstanceID, &view.SourceFactCount)
	return view, err
}

func (r *Repository) Subscriptions(ctx context.Context, projectID, environmentID, customerID string, limit int, cursor string) ([]billingaccess.SubscriptionView, string, error) {
	after, err := decodeCursor(cursor)
	if err != nil {
		return nil, "", billingaccess.ErrInvalid
	}
	rows, err := r.pool.Query(ctx,
		`SELECT `+subscriptionColumns+`
		 FROM subscription_instances i
		 JOIN subscription_snapshots s ON s.id = i.current_snapshot_id
		 WHERE i.project_id = $1 AND i.environment_id = $2 AND i.billing_customer_id = $3
		   AND ($4::text = '' OR i.id > $4)
		 ORDER BY i.id
		 LIMIT $5`, projectID, environmentID, customerID, after, limit+1)
	if err != nil {
		return nil, "", fmt.Errorf("list subscriptions: %w", err)
	}
	defer rows.Close()

	views := make([]billingaccess.SubscriptionView, 0, limit)
	for rows.Next() {
		view, err := scanSubscription(rows)
		if err != nil {
			return nil, "", fmt.Errorf("scan subscription snapshot: %w", err)
		}
		views = append(views, view)
	}
	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("list subscriptions: %w", err)
	}
	// Keyset paging: one extra row is read to learn whether another page exists,
	// which is cheaper and more stable under concurrent writes than an offset.
	next := ""
	if len(views) > limit {
		views = views[:limit]
		next = encodeCursor(views[len(views)-1].SubscriptionInstanceID)
	}
	return views, next, nil
}

func (r *Repository) Subscription(ctx context.Context, projectID, instanceID string) (billingaccess.SubscriptionView, error) {
	view, err := scanSubscription(r.pool.QueryRow(ctx,
		`SELECT `+subscriptionColumns+`
		 FROM subscription_instances i
		 JOIN subscription_snapshots s ON s.id = i.current_snapshot_id
		 WHERE i.project_id = $1 AND i.id = $2`, projectID, instanceID))
	if errors.Is(err, pgx.ErrNoRows) {
		return billingaccess.SubscriptionView{}, billingaccess.ErrNotFound
	}
	if err != nil {
		return billingaccess.SubscriptionView{}, fmt.Errorf("read subscription snapshot: %w", err)
	}
	return view, nil
}

func (r *Repository) Timeline(ctx context.Context, projectID, instanceID string, limit int, cursor string) ([]billingaccess.TimelineEntry, string, error) {
	after, err := decodeCursor(cursor)
	if err != nil {
		return nil, "", billingaccess.ErrInvalid
	}
	rows, err := r.pool.Query(ctx,
		`SELECT id, entry_type, effective_at, observed_at,
		        COALESCE(subscription_instance_id,''), COALESCE(one_time_purchase_instance_id,''),
		        COALESCE(product_id,''), COALESCE(prior_product_id,''), explanation_code, detail
		 FROM subscription_timeline_entries
		 WHERE project_id = $1 AND subscription_instance_id = $2
		   AND ($3::text = '' OR id > $3)
		 ORDER BY id
		 LIMIT $4`, projectID, instanceID, after, limit+1)
	if err != nil {
		return nil, "", fmt.Errorf("read subscription timeline: %w", err)
	}
	defer rows.Close()

	entries := make([]billingaccess.TimelineEntry, 0, limit)
	for rows.Next() {
		var entry billingaccess.TimelineEntry
		var detail []byte
		if err := rows.Scan(&entry.ID, &entry.EntryType, &entry.EffectiveAt, &entry.ObservedAt,
			&entry.SubscriptionInstanceID, &entry.OneTimeInstanceID, &entry.ProductID,
			&entry.PriorProductID, &entry.ExplanationCode, &detail); err != nil {
			return nil, "", fmt.Errorf("scan timeline entry: %w", err)
		}
		// The detail column already passed the ledger safety guard on write, so
		// it is decoded rather than re-filtered here.
		if len(detail) > 0 {
			_ = json.Unmarshal(detail, &entry.Detail)
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("read subscription timeline: %w", err)
	}
	next := ""
	if len(entries) > limit {
		entries = entries[:limit]
		next = encodeCursor(entries[len(entries)-1].ID)
	}
	return entries, next, nil
}

func (r *Repository) RecordAudit(ctx context.Context, projectID, environmentID, actorReference, action, resourceType, resourceID string, metadata map[string]string, at time.Time) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin audit write: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := recordAudit(ctx, tx, projectID, environmentID, actorReference, action, resourceType, resourceID, metadata, at); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func recordAudit(ctx context.Context, tx pgx.Tx, projectID, environmentID, actorReference, action, resourceType, resourceID string, metadata map[string]string, at time.Time) error {
	var organizationID string
	if err := tx.QueryRow(ctx, `SELECT organization_id FROM projects WHERE id = $1`, projectID).
		Scan(&organizationID); err != nil {
		return fmt.Errorf("read organization for audit: %w", err)
	}
	encoded := []byte("{}")
	if len(metadata) > 0 {
		if payload, err := json.Marshal(metadata); err == nil {
			encoded = payload
		}
	}
	actor := actorReference
	if actor == "" {
		actor = "system"
	}
	id := "aud_" + base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf("%s-%d", resourceID, at.UnixNano())))
	if len(id) > 96 {
		id = id[:96]
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO audit_events(id, actor_id, organization_id, project_id, environment_id,
			action, resource_type, resource_id, metadata, created_at)
		 VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,$7,$8,$9,$10)
		 ON CONFLICT (id) DO NOTHING`,
		id, actor, organizationID, projectID, environmentID, action, resourceType,
		resourceID, encoded, at)
	if err != nil {
		return fmt.Errorf("insert audit event: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Cursors
// ---------------------------------------------------------------------------

// Cursors are opaque to the caller and carry exactly one value: the last id of
// the previous page. Encoding it keeps callers from constructing one by hand
// and then depending on its shape.
func encodeCursor(value string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(value))
}

func decodeCursor(cursor string) (string, error) {
	if cursor == "" {
		return "", nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return "", err
	}
	if len(decoded) > 128 {
		return "", errors.New("cursor too long")
	}
	return string(decoded), nil
}
