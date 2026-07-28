// Package billingprojectionpostgres is the PostgreSQL implementation of the
// billing projection persistence port.
//
// The whole point of this package is one guarantee: a projection command
// writes everything or nothing. A consumer must never observe a new
// subscription state without its matching entitlement state, an entitlement
// state without its source links, a current pointer aimed at an incomplete
// snapshot, or a webhook event announcing state that was not committed. That
// is why Commit takes the entire planned output and executes it inside one
// transaction, under one advisory lock, guarded by a compare-and-swap.
package billingprojectionpostgres

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
)

type Repository struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

var _ billingprojection.Repository = (*Repository)(nil)

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

// LoadInput reads everything one projection command needs.
//
// It runs in its own transaction and takes the scope's advisory lock first, so
// two workers cannot both read the same pre-state and then both commit. The
// lock is released when this transaction ends; Commit takes it again. That is
// deliberate — holding one lock across both would mean holding it while the
// pure engines run, and the engines are the only part that could ever become
// slow.
//
// The compare-and-swap on current_projection_version is what makes the gap
// safe: if another worker commits in between, Commit's CAS loses and the job
// retries against fresh input rather than overwriting.
func (r *Repository) LoadInput(ctx context.Context, scope billingprojection.Scope) (billingprojection.Input, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billingprojection.Input{}, fmt.Errorf("begin projection read: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, scope.LockScope()); err != nil {
		return billingprojection.Input{}, fmt.Errorf("acquire projection lock: %w", err)
	}

	input := billingprojection.Input{Scope: scope}
	if scope.CustomerID != "" {
		err := tx.QueryRow(ctx,
			`SELECT current_projection_version FROM billing_customers WHERE id=$1 AND project_id=$2`,
			scope.CustomerID, scope.ProjectID).Scan(&input.CurrentProjectionVersion)
		if errors.Is(err, pgx.ErrNoRows) {
			return billingprojection.Input{}, billingprojection.ErrNotFound
		}
		if err != nil {
			return billingprojection.Input{}, fmt.Errorf("read customer projection version: %w", err)
		}
		if err := loadCustomerSnapshot(ctx, tx, scope, &input); err != nil {
			return billingprojection.Input{}, err
		}
	}

	if err := loadLineages(ctx, tx, scope, &input); err != nil {
		return billingprojection.Input{}, err
	}
	if err := loadGrantVersions(ctx, tx, scope, &input); err != nil {
		return billingprojection.Input{}, err
	}
	return input, nil
}

// loadCustomerSnapshot reads the committed snapshot the candidate is compared
// against. Its entries and sources are both needed: the checksum covers both,
// because "pro is active for a different reason than yesterday" is a real
// change even though the entry alone looks identical.
func loadCustomerSnapshot(ctx context.Context, tx pgx.Tx, scope billingprojection.Scope, input *billingprojection.Input) error {
	var snapshotID string
	err := tx.QueryRow(ctx,
		`SELECT current_snapshot_id, snapshot_version FROM customer_entitlement_pointers
		 WHERE billing_customer_id=$1 AND environment_id=$2`,
		scope.CustomerID, scope.EnvironmentID).Scan(&snapshotID, &input.CurrentSnapshotVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read customer entitlement pointer: %w", err)
	}

	snapshot := billingprojection.CustomerSnapshot{}
	rows, err := tx.Query(ctx,
		`SELECT entitlement_id, entitlement_key, state, effective_start, effective_end,
		        end_known, source_count, uncertainty_reason, is_test_source, explanation_code
		 FROM customer_entitlement_snapshot_entries
		 WHERE customer_entitlement_snapshot_id=$1 ORDER BY entitlement_id`, snapshotID)
	if err != nil {
		return fmt.Errorf("read snapshot entries: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var entry billingprojection.EntitlementEntry
		if err := rows.Scan(&entry.EntitlementID, &entry.EntitlementKey, &entry.State,
			&entry.EffectiveStart, &entry.EffectiveEnd, &entry.EndKnown, &entry.SourceCount,
			&entry.UncertaintyReason, &entry.IsTestSource, &entry.ExplanationCode); err != nil {
			return fmt.Errorf("scan snapshot entry: %w", err)
		}
		snapshot.Entries = append(snapshot.Entries, entry)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read snapshot entries: %w", err)
	}

	// The entitlement key is deliberately not read here: it does not
	// participate in the source's checksum contribution, so reading it would
	// add a join that cannot change the comparison.
	sourceRows, err := tx.Query(ctx,
		`SELECT entitlement_id, purchase_lineage_id, product_id, grant_version_id,
		        source_type, source_state, source_start, source_end, end_known
		 FROM entitlement_sources WHERE customer_entitlement_snapshot_id=$1`, snapshotID)
	if err != nil {
		return fmt.Errorf("read entitlement sources: %w", err)
	}
	defer sourceRows.Close()
	for sourceRows.Next() {
		var source billingprojection.EntitlementSource
		if err := sourceRows.Scan(&source.EntitlementID, &source.PurchaseLineageID, &source.ProductID,
			&source.GrantVersionID, &source.SourceType, &source.SourceState,
			&source.SourceStart, &source.SourceEnd, &source.EndKnown); err != nil {
			return fmt.Errorf("scan entitlement source: %w", err)
		}
		snapshot.Sources = append(snapshot.Sources, source)
	}
	if err := sourceRows.Err(); err != nil {
		return fmt.Errorf("read entitlement sources: %w", err)
	}

	// The committed checksum is authoritative rather than recomputed: a
	// recomputation here would compare the current code's opinion against
	// itself and never detect a rule-version difference.
	if err := tx.QueryRow(ctx,
		`SELECT checksum FROM customer_entitlement_snapshots WHERE id=$1`, snapshotID).
		Scan(&snapshot.Checksum); err != nil {
		return fmt.Errorf("read snapshot checksum: %w", err)
	}
	input.PriorCustomerSnapshot = &snapshot
	return nil
}

// loadLineages reads the lineages in scope, their instances, their checkpoints,
// and every validated fact that belongs to them.
//
// Two scoping rules are load-bearing here:
//
//	Environment. Everything that holds Phase 9B state is Environment-scoped
//	(OD-3(b)), and Apple's chain digest is only unique per (store environment,
//	original transaction id) — so two sandbox Environments in one Project share
//	digests. Selecting input by Project alone would let a staging lineage
//	contribute a source to a production snapshot.
//
//	Chain root. A lineage is keyed on the *root* of the provider chain (plan
//	§5): Apple's original transaction id, Google's purchase token walked
//	backwards through linkedPurchaseToken. Facts carry their own token digest,
//	so the fact set for a lineage is the transitive closure of supersession
//	edges forward from the root, not the rows that happen to name the root.
//
// Nothing here joins by Product, customer, or time window.
func loadLineages(ctx context.Context, tx pgx.Tx, scope billingprojection.Scope, input *billingprojection.Input) error {
	rows, err := tx.Query(ctx,
		`SELECT l.id, l.lineage_type, l.lineage_key_digest, l.projection_frozen,
		        l.billing_customer_id IS NOT NULL,
		        l.superseded_by_lineage_id IS NOT NULL,
		        COALESCE(si.id, oi.id, ''), COALESCE(si.current_snapshot_id, ''),
		        COALESCE(c.high_watermark, ''), c.checksum
		 FROM purchase_lineages l
		 LEFT JOIN subscription_instances si ON si.purchase_lineage_id = l.id
		 LEFT JOIN one_time_purchase_instances oi ON oi.purchase_lineage_id = l.id
		 LEFT JOIN projection_checkpoints c
		        ON c.subscription_instance_id = si.id OR c.one_time_purchase_instance_id = oi.id
		 WHERE l.project_id = $1
		   AND l.environment_id = $2
		   AND ($3::text = '' OR l.billing_customer_id = $3)
		   AND ($4::text = '' OR l.id = $4)`,
		scope.ProjectID, scope.EnvironmentID, scope.CustomerID, scope.LineageID)
	if err != nil {
		return fmt.Errorf("read purchase lineages: %w", err)
	}
	defer rows.Close()

	type pending struct {
		lineage billingprojection.LineageInput
		digest  []byte
	}
	pendings := make([]pending, 0, 4)
	for rows.Next() {
		var item pending
		var checkpointChecksum []byte
		if err := rows.Scan(&item.lineage.LineageID, &item.lineage.Type, &item.digest,
			&item.lineage.Frozen, &item.lineage.CustomerResolved, &item.lineage.SupersededByLineage,
			&item.lineage.InstanceID, &item.lineage.SnapshotID, &item.lineage.Checkpoint,
			&checkpointChecksum); err != nil {
			return fmt.Errorf("scan purchase lineage: %w", err)
		}
		item.lineage.CheckpointChecksum = checkpointChecksum
		pendings = append(pendings, item)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read purchase lineages: %w", err)
	}

	// A customer projection reads every lineage the customer owns, so it must
	// hold those lineages' locks too. Without them a lineage-scoped projection
	// — the path a fact takes before its customer association exists — could
	// commit a subscription snapshot in the middle of the customer aggregate
	// that reads it. The locks are taken in sorted order after the scope lock
	// is already held, so no cycle is possible.
	lineageIDs := make([]string, 0, len(pendings))
	for _, item := range pendings {
		lineageIDs = append(lineageIDs, item.lineage.LineageID)
	}
	if err := lockLineages(ctx, tx, scope, lineageIDs); err != nil {
		return err
	}

	for _, item := range pendings {
		facts, err := loadFacts(ctx, tx, scope.ProjectID, scope.EnvironmentID, item.digest)
		if err != nil {
			return err
		}
		item.lineage.Facts = facts
		// Frozen and unresolved lineages are counted by Compute as it walks
		// them. Counting here as well double-counted every one of them.
		input.Lineages = append(input.Lineages, item.lineage)
	}
	return nil
}

// loadFacts reads every validated fact belonging to one lineage in one
// Environment.
//
// The recursive term walks supersession edges *forward* from the lineage root:
// a fact whose `supersedes_chain_digest` is already in the chain contributes
// its own `purchase_chain_digest` to it. That direction is the correction to
// the defect that read the edge with the opposite sign — `supersedes_chain_digest
// IS NOT NULL` says "this fact's chain replaced something", which every
// successor fact says for its whole life, so every live Google successor was
// projected superseded and inactive.
//
// UNION rather than UNION ALL terminates on a cycle: provider data cannot
// contain one, so reaching a repeat means the data is already wrong and
// stopping is safer than looping.
// lockLineages takes the per-lineage advisory locks a scope reads, skipping the
// one the scope already holds. Ordering is deterministic so two customer
// projections that overlap on a lineage queue rather than deadlock.
func lockLineages(ctx context.Context, tx pgx.Tx, scope billingprojection.Scope, lineageIDs []string) error {
	if len(lineageIDs) == 0 {
		return nil
	}
	names := make([]string, 0, len(lineageIDs))
	for _, lineageID := range lineageIDs {
		name := "billing-projection:lineage:" + lineageID
		if name == scope.LockScope() {
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, name); err != nil {
			return fmt.Errorf("acquire lineage projection lock: %w", err)
		}
	}
	return nil
}

func loadFacts(ctx context.Context, tx pgx.Tx, projectID, environmentID string, chainDigest []byte) ([]billingprojection.Fact, error) {
	if len(chainDigest) == 0 {
		return nil, nil
	}
	rows, err := tx.Query(ctx,
		`WITH RECURSIVE chain(digest) AS (
			SELECT $3::bytea
		  UNION
			SELECT f.purchase_chain_digest
			FROM billing_transaction_facts f
			JOIN chain c ON f.supersedes_chain_digest = c.digest
			WHERE f.project_id = $1 AND f.environment_id = $2
			  AND f.purchase_chain_digest IS NOT NULL
		 )
		 SELECT id, provider, provider_transaction_id, fact_kind, transaction_type,
		        occurred_at, provider_event_occurred_at, recorded_at,
		        period_start_at, period_end_at, grace_period_expires_at, revoked_at, refunded_at,
		        renewal_expected, billing_retry_active, is_upgraded, revocation_reason,
		        COALESCE(refund_type,''), COALESCE(auto_renew_product_identifier,''),
		        COALESCE(in_app_ownership_type,''), COALESCE(subscription_group_identifier,''),
		        COALESCE(mosaic_product_id,''), resolution_state, is_test_transaction
		 FROM billing_transaction_facts
		 WHERE project_id=$1 AND environment_id=$2
		   AND purchase_chain_digest IN (SELECT digest FROM chain)`,
		projectID, environmentID, chainDigest)
	if err != nil {
		return nil, fmt.Errorf("read transaction facts: %w", err)
	}
	defer rows.Close()

	facts := make([]billingprojection.Fact, 0, 8)
	for rows.Next() {
		var fact billingprojection.Fact
		if err := rows.Scan(&fact.ID, &fact.Provider, &fact.ProviderTransactionID, &fact.FactKind,
			&fact.TransactionType, &fact.OccurredAt, &fact.ProviderEventOccurredAt, &fact.RecordedAt,
			&fact.PeriodStartAt, &fact.PeriodEndAt, &fact.GracePeriodExpiresAt, &fact.RevokedAt,
			&fact.RefundedAt, &fact.RenewalExpected, &fact.BillingRetryActive, &fact.IsUpgraded,
			&fact.RevocationReason, &fact.RefundType, &fact.AutoRenewProductIdentifier,
			&fact.InAppOwnershipType, &fact.SubscriptionGroupIdentifier, &fact.MosaicProductID,
			&fact.ResolutionState, &fact.IsTestSource); err != nil {
			return nil, fmt.Errorf("scan transaction fact: %w", err)
		}
		facts = append(facts, fact)
	}
	return facts, rows.Err()
}

// loadGrantVersions reads every version for the Products the scope touches.
// Selecting the applicable one is the engine's job — it depends on the
// purchase's own effective time, which the query does not know.
func loadGrantVersions(ctx context.Context, tx pgx.Tx, scope billingprojection.Scope, input *billingprojection.Input) error {
	rows, err := tx.Query(ctx,
		`SELECT v.id, v.product_id, v.entitlement_id, e.key, v.version,
		        v.effective_start, v.effective_end, v.supported_purchase_types,
		        v.grants_in_active, v.grants_in_trial, v.grants_in_grace,
		        v.grants_in_billing_retry, v.grants_in_one_time_ownership
		 FROM product_entitlement_grant_versions v
		 JOIN entitlements e ON e.id = v.entitlement_id AND e.project_id = v.project_id
		 WHERE v.project_id = $1`, scope.ProjectID)
	if err != nil {
		return fmt.Errorf("read grant versions: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var version billingprojection.GrantVersion
		if err := rows.Scan(&version.ID, &version.ProductID, &version.EntitlementID,
			&version.EntitlementKey, &version.Version, &version.EffectiveStart, &version.EffectiveEnd,
			&version.SupportedPurchaseTypes, &version.Policy.GrantsInActive,
			&version.Policy.GrantsInTrial, &version.Policy.GrantsInGrace,
			&version.Policy.GrantsInBillingRetry, &version.Policy.GrantsInOneTime); err != nil {
			return fmt.Errorf("scan grant version: %w", err)
		}
		input.GrantVersions = append(input.GrantVersions, version)
	}
	return rows.Err()
}

// Commit writes the whole planned output in one transaction.
//
// Order matters only where foreign keys require it: subscription snapshots
// before the instance pointer that names them, the customer snapshot before
// its entries, sources, pointer, and webhook event. Everything else is grouped
// for readability.
func (r *Repository) Commit(ctx context.Context, input billingprojection.Input, output billingprojection.Output, now time.Time) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin projection commit: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	scope := output.Scope
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, scope.LockScope()); err != nil {
		return fmt.Errorf("acquire projection commit lock: %w", err)
	}
	// The commit writes the same lineages the input read, so it takes the same
	// lineage locks. LoadInput's locks were released when its read transaction
	// ended; the compare-and-swap below covers the customer aggregate across
	// that gap, and these locks cover the per-lineage writes it does not.
	commitLineages := make([]string, 0, len(input.Lineages))
	for _, lineage := range input.Lineages {
		commitLineages = append(commitLineages, lineage.LineageID)
	}
	if err := lockLineages(ctx, tx, scope, commitLineages); err != nil {
		return err
	}

	if scope.CustomerID != "" {
		// Compare-and-swap. Losing it means another worker committed newer
		// state for this customer while this command was computing, so this
		// output describes a stale world and must not be written.
		tag, err := tx.Exec(ctx,
			`UPDATE billing_customers
			 SET current_projection_version = current_projection_version + 1,
			     last_projected_at = $3, updated_at = $3
			 WHERE id = $1 AND current_projection_version = $2`,
			scope.CustomerID, input.CurrentProjectionVersion, now)
		if err != nil {
			return fmt.Errorf("advance customer projection version: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return billingprojection.ErrVersionConflict
		}
	}

	for _, commit := range output.Subscriptions {
		if err := writeSubscription(ctx, tx, scope, commit, now); err != nil {
			return err
		}
	}
	for _, commit := range output.OneTimes {
		if err := writeOneTime(ctx, tx, scope, commit, now); err != nil {
			return err
		}
	}
	for _, checkpoint := range output.Checkpoints {
		if err := writeCheckpoint(ctx, tx, scope, checkpoint, now); err != nil {
			return err
		}
	}

	if output.CustomerSnapshot != nil {
		if err := writeCustomerSnapshot(ctx, tx, scope, input, output, now); err != nil {
			return err
		}
	}

	if err := writeAudit(ctx, tx, scope, output, now); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit projection: %w", err)
	}
	return nil
}

func writeSubscription(ctx context.Context, tx pgx.Tx, scope billingprojection.Scope, commit billingprojection.SubscriptionCommit, now time.Time) error {
	var version int64
	if err := tx.QueryRow(ctx,
		`SELECT current_projection_version + 1 FROM subscription_instances WHERE id=$1 FOR UPDATE`,
		commit.InstanceID).Scan(&version); err != nil {
		return fmt.Errorf("read subscription projection version: %w", err)
	}
	snapshot := commit.Snapshot
	snapshotID := "bss_" + hashID(commit.InstanceID, version)

	if _, err := tx.Exec(ctx,
		`INSERT INTO subscription_snapshots(
			id, project_id, environment_id, subscription_instance_id, projection_version, rule_version,
			computed_at, as_of, access_state, lifecycle_state, renewal_intent, billing_state,
			uncertainty_reason, period_start_at, period_end_at, grace_period_end_at,
			billing_retry_start_at, pause_start_at, pause_resume_at, cancellation_effective_at,
			expiration_effective_at, revocation_effective_at, refund_effective_at,
			current_product_id, prior_product_id, scheduled_product_identifier,
			is_test_source, terminal, checksum, projection_reason, created_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
			NULLIF($24,''),NULLIF($25,''),NULLIF($26,''),$27,$28,$29,$30,$7)`,
		snapshotID, scope.ProjectID, scope.EnvironmentID, commit.InstanceID, version,
		billingprojection.RuleVersion, now, snapshot.AsOf,
		snapshot.AccessState, snapshot.LifecycleState, snapshot.RenewalIntent, snapshot.BillingState,
		snapshot.UncertaintyReason, snapshot.PeriodStartAt, snapshot.PeriodEndAt,
		snapshot.GracePeriodEndAt, snapshot.BillingRetryStartAt, snapshot.PauseStartAt,
		snapshot.PauseResumeAt, snapshot.CancellationEffectiveAt, snapshot.ExpirationEffectiveAt,
		snapshot.RevocationEffectiveAt, snapshot.RefundEffectiveAt,
		snapshot.CurrentProductID, snapshot.PriorProductID, snapshot.ScheduledProductIdentifier,
		snapshot.IsTestSource, snapshot.Terminal, snapshot.Checksum, "fact_projection"); err != nil {
		return fmt.Errorf("insert subscription snapshot: %w", err)
	}

	for position, factID := range snapshot.SourceFactIDs {
		if _, err := tx.Exec(ctx,
			`INSERT INTO subscription_snapshot_facts(snapshot_id, transaction_fact_id, position)
			 VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, snapshotID, factID, position); err != nil {
			return fmt.Errorf("link snapshot fact: %w", err)
		}
	}

	for index, entry := range commit.Timeline {
		if err := writeTimeline(ctx, tx, scope, entry, snapshotID, commit.InstanceID, "", index, now); err != nil {
			return err
		}
	}

	if _, err := tx.Exec(ctx,
		`UPDATE subscription_instances
		 SET current_snapshot_id=$2, current_projection_version=$3,
		     current_mosaic_product_id=NULLIF($4,''), updated_at=$5,
		     terminal_at = CASE WHEN $6 THEN COALESCE(terminal_at,$5) ELSE NULL END
		 WHERE id=$1`,
		commit.InstanceID, snapshotID, version, snapshot.CurrentProductID, now, snapshot.Terminal); err != nil {
		return fmt.Errorf("update subscription instance pointer: %w", err)
	}
	return nil
}

func writeOneTime(ctx context.Context, tx pgx.Tx, scope billingprojection.Scope, commit billingprojection.OneTimeCommit, now time.Time) error {
	snapshot := commit.Snapshot
	if _, err := tx.Exec(ctx,
		`UPDATE one_time_purchase_instances
		 SET validity_state=$2, refund_effective_at=$3, revocation_effective_at=$4,
		     mosaic_product_id=NULLIF($5,''),
		     current_projection_version=current_projection_version+1, updated_at=$6
		 WHERE id=$1`,
		commit.InstanceID, snapshot.ValidityState, snapshot.RefundEffectiveAt,
		snapshot.RevocationEffectiveAt, snapshot.MosaicProductID, now); err != nil {
		return fmt.Errorf("update one-time purchase instance: %w", err)
	}
	for index, entry := range commit.Timeline {
		if err := writeTimeline(ctx, tx, scope, entry, "", "", commit.InstanceID, index, now); err != nil {
			return err
		}
	}
	return nil
}

func writeTimeline(ctx context.Context, tx pgx.Tx, scope billingprojection.Scope, entry billingprojection.TimelineEntry, snapshotID, subscriptionInstanceID, oneTimeInstanceID string, index int, now time.Time) error {
	detail := []byte("{}")
	if len(entry.Detail) > 0 {
		if encoded, err := json.Marshal(entry.Detail); err == nil {
			detail = encoded
		}
	}
	// The entry id is derived from its content so a reprojection of the same
	// timeline is absorbed rather than duplicating history.
	id := "bte_" + hashID(subscriptionInstanceID, oneTimeInstanceID, entry.EntryType,
		entry.EffectiveAt.UnixMilli(), strings.Join(entry.SourceFactIDs, ","), index)
	_, err := tx.Exec(ctx,
		`INSERT INTO subscription_timeline_entries(
			id, project_id, environment_id, subscription_instance_id, one_time_purchase_instance_id,
			entry_type, effective_at, observed_at, new_snapshot_id, product_id,
			source_fact_ids, explanation_code, detail, rule_version, created_at)
		 VALUES ($1,$2,$3,NULLIF($4,''),NULLIF($5,''),$6,$7,$8,NULLIF($9,''),NULLIF($10,''),
			$11,$12,$13,$14,$15)
		 ON CONFLICT (id) DO NOTHING`,
		id, scope.ProjectID, scope.EnvironmentID, subscriptionInstanceID, oneTimeInstanceID,
		entry.EntryType, entry.EffectiveAt, entry.ObservedAt, snapshotID, entry.ProductID,
		entry.SourceFactIDs, entry.ExplanationCode, detail, billingprojection.RuleVersion, now)
	if err != nil {
		return fmt.Errorf("insert timeline entry: %w", err)
	}
	return nil
}

func writeCheckpoint(ctx context.Context, tx pgx.Tx, scope billingprojection.Scope, checkpoint billingprojection.CheckpointCommit, now time.Time) error {
	subscriptionID, oneTimeID := checkpoint.InstanceID, ""
	if checkpoint.Type == "one_time" {
		subscriptionID, oneTimeID = "", checkpoint.InstanceID
	}
	id := "bpc_" + hashID(checkpoint.InstanceID)
	_, err := tx.Exec(ctx,
		`INSERT INTO projection_checkpoints(
			id, project_id, environment_id, subscription_instance_id, one_time_purchase_instance_id,
			high_watermark, facts_projected, rule_version, checksum, invalidated, updated_at)
		 VALUES ($1,$2,$3,NULLIF($4,''),NULLIF($5,''),$6,$7,$8,$9,$10,$11)
		 ON CONFLICT (id) DO UPDATE SET
			high_watermark=EXCLUDED.high_watermark, facts_projected=EXCLUDED.facts_projected,
			rule_version=EXCLUDED.rule_version, checksum=EXCLUDED.checksum,
			invalidated=EXCLUDED.invalidated, updated_at=EXCLUDED.updated_at`,
		id, scope.ProjectID, scope.EnvironmentID, subscriptionID, oneTimeID,
		checkpoint.HighWatermark, checkpoint.FactsProjected, billingprojection.RuleVersion,
		checkpoint.Checksum, checkpoint.Invalidated, now)
	if err != nil {
		return fmt.Errorf("write projection checkpoint: %w", err)
	}
	return nil
}

func writeCustomerSnapshot(ctx context.Context, tx pgx.Tx, scope billingprojection.Scope, input billingprojection.Input, output billingprojection.Output, now time.Time) error {
	snapshot := output.CustomerSnapshot
	snapshotID := "ces_" + hashID(scope.CustomerID, scope.EnvironmentID, output.SnapshotVersion)

	var previousID *string
	if err := tx.QueryRow(ctx,
		`SELECT current_snapshot_id FROM customer_entitlement_pointers
		 WHERE billing_customer_id=$1 AND environment_id=$2`,
		scope.CustomerID, scope.EnvironmentID).Scan(&previousID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("read previous snapshot pointer: %w", err)
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO customer_entitlement_snapshots(
			id, project_id, environment_id, billing_customer_id, snapshot_version, rule_version,
			computed_at, as_of, previous_snapshot_id, checksum, change_reason, created_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$7)`,
		snapshotID, scope.ProjectID, scope.EnvironmentID, scope.CustomerID, output.SnapshotVersion,
		billingprojection.RuleVersion, now, snapshot.AsOf, previousID, snapshot.Checksum,
		changeReason(output)); err != nil {
		return fmt.Errorf("insert customer entitlement snapshot: %w", err)
	}

	for index, entry := range snapshot.Entries {
		if _, err := tx.Exec(ctx,
			`INSERT INTO customer_entitlement_snapshot_entries(
				id, project_id, customer_entitlement_snapshot_id, entitlement_id, entitlement_key,
				state, effective_start, effective_end, end_known, source_count,
				uncertainty_reason, is_test_source, explanation_code)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
			"cee_"+hashID(snapshotID, index), scope.ProjectID, snapshotID, entry.EntitlementID,
			entry.EntitlementKey, entry.State, entry.EffectiveStart, entry.EffectiveEnd,
			entry.EndKnown, entry.SourceCount, entry.UncertaintyReason, entry.IsTestSource,
			entry.ExplanationCode); err != nil {
			return fmt.Errorf("insert snapshot entry: %w", err)
		}
	}

	for index, source := range snapshot.Sources {
		if _, err := tx.Exec(ctx,
			`INSERT INTO entitlement_sources(
				id, project_id, environment_id, customer_entitlement_snapshot_id, billing_customer_id,
				entitlement_id, purchase_lineage_id, product_id, grant_version_id,
				subscription_instance_id, one_time_purchase_instance_id, source_snapshot_id,
				source_type, source_state, source_start, source_end, end_known,
				uncertainty_reason, is_test_source, explanation_code, created_at)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULLIF($10,''),NULLIF($11,''),NULLIF($12,''),
				$13,$14,$15,$16,$17,$18,$19,$20,$21)
			 ON CONFLICT (customer_entitlement_snapshot_id, purchase_lineage_id, entitlement_id, grant_version_id)
			 DO NOTHING`,
			"esr_"+hashID(snapshotID, index), scope.ProjectID, scope.EnvironmentID, snapshotID,
			scope.CustomerID, source.EntitlementID, source.PurchaseLineageID, source.ProductID,
			source.GrantVersionID, source.SubscriptionInstanceID, source.OneTimePurchaseInstanceID,
			source.SourceSubscriptionSnapshot, source.SourceType, source.SourceState,
			source.SourceStart, source.SourceEnd, source.EndKnown, source.UncertaintyReason,
			source.IsTestSource, source.ExplanationCode, now); err != nil {
			return fmt.Errorf("insert entitlement source: %w", err)
		}
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO customer_entitlement_pointers(
			project_id, environment_id, billing_customer_id, current_snapshot_id, snapshot_version, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6)
		 ON CONFLICT (billing_customer_id, environment_id) DO UPDATE SET
			current_snapshot_id=EXCLUDED.current_snapshot_id,
			snapshot_version=EXCLUDED.snapshot_version, updated_at=EXCLUDED.updated_at`,
		scope.ProjectID, scope.EnvironmentID, scope.CustomerID, snapshotID,
		output.SnapshotVersion, now); err != nil {
		return fmt.Errorf("update customer entitlement pointer: %w", err)
	}

	// The webhook event is created here, inside the same transaction as the
	// state it announces, so an event can never exist for state that was not
	// committed. Delivery happens elsewhere, outside this transaction.
	if len(output.Changes.Changed) > 0 {
		payload, err := json.Marshal(map[string]any{
			"billingCustomerId":   scope.CustomerID,
			"environmentId":       scope.EnvironmentID,
			"snapshotVersion":     output.SnapshotVersion,
			"changedEntitlements": output.Changes.Changed,
		})
		if err != nil {
			return fmt.Errorf("encode webhook payload: %w", err)
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO webhook_events(
				id, project_id, environment_id, event_type, billing_customer_id,
				customer_entitlement_snapshot_id, snapshot_version, payload, occurred_at, created_at)
			 VALUES ($1,$2,$3,'customer.entitlements.changed',$4,$5,$6,$7,$8,$8)
			 ON CONFLICT (customer_entitlement_snapshot_id, event_type) DO NOTHING`,
			"whe_"+hashID(snapshotID), scope.ProjectID, scope.EnvironmentID, scope.CustomerID,
			snapshotID, output.SnapshotVersion, payload, now); err != nil {
			return fmt.Errorf("create webhook event: %w", err)
		}
	}
	return nil
}

func changeReason(output billingprojection.Output) string {
	if len(output.Changes.Changed) > 0 {
		return "entitlements_changed"
	}
	return "subscription_state_changed"
}

func writeAudit(ctx context.Context, tx pgx.Tx, scope billingprojection.Scope, output billingprojection.Output, now time.Time) error {
	if output.Outcome == billingprojection.OutcomeNoChange {
		// A no-change projection records an attempt, not an audit event: an
		// audit trail full of "nothing happened" hides the entries that matter.
		return nil
	}
	var organizationID string
	if err := tx.QueryRow(ctx, `SELECT organization_id FROM projects WHERE id=$1`, scope.ProjectID).
		Scan(&organizationID); err != nil {
		return fmt.Errorf("read organization for audit: %w", err)
	}
	metadata, _ := json.Marshal(map[string]any{
		"scope":          scope.Key(),
		"outcome":        output.Outcome,
		"idempotencyKey": billingprojection.HexKey(output.IdempotencyKey),
	})
	_, err := tx.Exec(ctx,
		`INSERT INTO audit_events(id, actor_id, organization_id, project_id, environment_id,
			action, resource_type, resource_id, metadata, created_at)
		 VALUES ($1,'system',$2,$3,NULLIF($4,''),'billing.projection.committed','billing_projection',$5,$6,$7)`,
		"aud_"+hashID(scope.Key(), now.UnixNano()), organizationID, scope.ProjectID,
		scope.EnvironmentID, scope.Key(), metadata, now)
	if err != nil {
		return fmt.Errorf("insert projection audit event: %w", err)
	}
	return nil
}

// RecordAttempt writes outside the projection transaction so a rolled-back
// projection still leaves a trace that it ran.
func (r *Repository) RecordAttempt(ctx context.Context, scope billingprojection.Scope, jobID string, output billingprojection.Output, errorCode string, started, completed time.Time) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO projection_attempts(
			id, project_id, projection_job_id, scope_key, rule_version, idempotency_key,
			outcome, error_code, started_at, completed_at)
		 VALUES ($1,$2,NULLIF($3,''),$4,$5,$6,$7,NULLIF($8,''),$9,$10)`,
		"pat_"+hashID(scope.Key(), started.UnixNano()), scope.ProjectID, jobID, scope.Key(),
		billingprojection.RuleVersion, nullBytes(output.IdempotencyKey),
		outcomeOrFailed(output.Outcome), errorCode, started, completed)
	if err != nil {
		return fmt.Errorf("record projection attempt: %w", err)
	}
	return nil
}

func outcomeOrFailed(outcome string) string {
	if outcome == "" {
		return billingprojection.OutcomeFailed
	}
	return outcome
}

// Enqueue coalesces onto the scope key. The partial unique index means a scope
// with queued or leased work absorbs the trigger, so a burst of facts for one
// customer produces one projection rather than a job storm.
func (r *Repository) Enqueue(ctx context.Context, scope billingprojection.Scope, kind string, now time.Time) error {
	detail, err := json.Marshal(map[string]string{
		"customerId": scope.CustomerID, "lineageId": scope.LineageID,
	})
	if err != nil {
		return fmt.Errorf("encode projection job detail: %w", err)
	}
	_, err = r.pool.Exec(ctx,
		`INSERT INTO projection_jobs(
			id, project_id, environment_id, scope_key, kind, detail, status,
			attempt_count, max_attempts, available_at, created_at, updated_at)
		 VALUES ($1,$2,NULLIF($3,''),$4,$5,$6,'queued',0,8,$7,$7,$7)
		 ON CONFLICT DO NOTHING`,
		"pjb_"+hashID(scope.Key(), kind, now.UnixNano()), scope.ProjectID, scope.EnvironmentID,
		scope.Key(), kind, detail, now)
	if err != nil && !isUniqueViolation(err) {
		return fmt.Errorf("enqueue projection job: %w", err)
	}
	return nil
}

// LeaseJob claims one job with SELECT ... FOR UPDATE SKIP LOCKED, matching the
// pattern every other Mosaic queue uses so all of them behave identically
// under concurrency.
func (r *Repository) LeaseJob(ctx context.Context, workerID string, now, leaseUntil time.Time) (billingprojection.Job, bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billingprojection.Job{}, false, fmt.Errorf("begin projection lease: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var job billingprojection.Job
	var environmentID *string
	var detail []byte
	err = tx.QueryRow(ctx,
		`SELECT id, project_id, environment_id, scope_key, kind, detail, attempt_count, max_attempts
		 FROM projection_jobs
		 WHERE (status = 'queued' OR (status = 'leased' AND lease_expires_at <= $1))
		   AND available_at <= $1 AND attempt_count < max_attempts
		 ORDER BY available_at, created_at, id
		 FOR UPDATE SKIP LOCKED LIMIT 1`, now).
		Scan(&job.ID, &job.ProjectID, &environmentID, &job.ScopeKey, &job.Kind, &detail,
			&job.AttemptCount, &job.MaxAttempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingprojection.Job{}, false, nil
	}
	if err != nil {
		return billingprojection.Job{}, false, fmt.Errorf("select projection job: %w", err)
	}
	if environmentID != nil {
		job.EnvironmentID = *environmentID
	}
	var scopeDetail struct {
		CustomerID string `json:"customerId"`
		LineageID  string `json:"lineageId"`
	}
	_ = json.Unmarshal(detail, &scopeDetail)
	job.CustomerID, job.LineageID = scopeDetail.CustomerID, scopeDetail.LineageID

	if _, err := tx.Exec(ctx,
		`UPDATE projection_jobs
		 SET status='leased', lease_owner=$2, lease_expires_at=$3,
		     attempt_count=attempt_count+1, updated_at=$4
		 WHERE id=$1`, job.ID, workerID, leaseUntil, now); err != nil {
		return billingprojection.Job{}, false, fmt.Errorf("lease projection job: %w", err)
	}
	job.AttemptCount++
	if err := tx.Commit(ctx); err != nil {
		return billingprojection.Job{}, false, fmt.Errorf("commit projection lease: %w", err)
	}
	return job, true, nil
}

func (r *Repository) CompleteJob(ctx context.Context, job billingprojection.Job, status, errorCode string, availableAt, now time.Time) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE projection_jobs
		 SET status=$2, available_at=$3, lease_owner=NULL, lease_expires_at=NULL,
		     last_error_code=NULLIF($4,''), updated_at=$5
		 WHERE id=$1`, job.ID, status, availableAt, errorCode, now)
	if err != nil {
		return fmt.Errorf("complete projection job: %w", err)
	}
	return nil
}

// ScopesForReplay enumerates the scopes a bounded replay will recompute.
func (r *Repository) ScopesForReplay(ctx context.Context, replay billingprojection.ReplayScope, limit int) ([]billingprojection.Scope, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT DISTINCT l.project_id, l.environment_id, COALESCE(l.billing_customer_id,''), l.id
		 FROM purchase_lineages l
		 LEFT JOIN subscription_instances si ON si.purchase_lineage_id = l.id
		 WHERE ($1::text = '' OR l.project_id = $1)
		   AND ($2::text = '' OR l.billing_customer_id = $2)
		   AND ($3::text = '' OR si.id = $3)
		   AND ($4::timestamptz IS NULL OR l.created_at >= $4)
		   AND ($5::timestamptz IS NULL OR l.created_at <= $5)
		 ORDER BY l.project_id, l.environment_id, 3, l.id
		 LIMIT $6`,
		replay.ProjectID, replay.CustomerID, replay.SubscriptionInstanceID,
		replay.WindowStart, replay.WindowEnd, limit)
	if err != nil {
		return nil, fmt.Errorf("read replay scopes: %w", err)
	}
	defer rows.Close()

	seen := map[string]struct{}{}
	scopes := make([]billingprojection.Scope, 0, limit)
	for rows.Next() {
		var scope billingprojection.Scope
		if err := rows.Scan(&scope.ProjectID, &scope.EnvironmentID, &scope.CustomerID, &scope.LineageID); err != nil {
			return nil, fmt.Errorf("scan replay scope: %w", err)
		}
		if scope.CustomerID != "" {
			// Collapse to the customer scope: replaying two lineages of one
			// customer separately would recompute the same aggregate twice and
			// mint two snapshot versions for one logical change.
			scope.LineageID = ""
		}
		if _, duplicate := seen[scope.Key()]; duplicate {
			continue
		}
		seen[scope.Key()] = struct{}{}
		scopes = append(scopes, scope)
	}
	return scopes, rows.Err()
}

func nullBytes(value []byte) any {
	if len(value) == 0 {
		return nil
	}
	return value
}

func hashID(parts ...any) string {
	hasher := sha256.New()
	for _, part := range parts {
		fmt.Fprintf(hasher, "%v\x00", part)
	}
	return fmt.Sprintf("%x", hasher.Sum(nil))[:24]
}

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "SQLSTATE 23505")
}
