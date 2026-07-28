// Package billinggrantpostgres is the PostgreSQL implementation of the
// grant-version management port.
//
// Two properties shape everything here. Every read and write filters on
// project_id, so tenant isolation is a property of the query rather than of a
// caller remembering to check. And a publish is one transaction holding the
// pair's advisory lock from before the history is read until after the version,
// the audit event, and the reprojection work are written — so the decision
// cannot be made against a history that has already moved.
package billinggrantpostgres

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Mujhtech/mosaic/apps/api/internal/billinggrant"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
)

type Repository struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

var _ billinggrant.Repository = (*Repository)(nil)

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

// Role resolves the actor's organization role for the Project.
func (r *Repository) Role(ctx context.Context, actor billinggrant.Actor, projectID string) (string, error) {
	if strings.TrimSpace(actor.ID) == "" {
		return "", billinggrant.ErrUnauthenticated
	}
	var role string
	err := r.pool.QueryRow(ctx,
		`SELECT m.role FROM projects p
		 JOIN organization_members m ON m.organization_id = p.organization_id
		 WHERE p.id = $1 AND m.actor_id = $2`, projectID, actor.ID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", billinggrant.ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("resolve grant-version role: %w", err)
	}
	return role, nil
}

// versionColumns is the single projection every version read uses, so a column
// added to one read cannot be forgotten by another.
//
// `effective_start < created_at` is how a retroactive publish is recognised on
// read: a version whose meaning began before it existed was backdated. Storing
// a flag would be a second source of truth for a fact the two timestamps
// already state exactly.
const versionColumns = `v.id, v.project_id, v.product_id, p.key, v.entitlement_id, e.key,
	v.version, v.grant_policy_version, v.effective_start, v.effective_end,
	v.supported_purchase_types, v.grants_in_active, v.grants_in_trial, v.grants_in_grace,
	v.grants_in_billing_retry, v.grants_in_one_time_ownership,
	v.created_at, coalesce(v.created_by_actor_id, ''), v.reason,
	(v.effective_start < v.created_at) AS retroactive`

func scanVersion(row pgx.Row) (billinggrant.Version, error) {
	var version billinggrant.Version
	var policy billingprojection.Policy
	err := row.Scan(&version.ID, &version.ProjectID, &version.ProductID, &version.ProductKey,
		&version.EntitlementID, &version.EntitlementKey, &version.Version,
		&version.GrantPolicyVersion, &version.EffectiveStart, &version.EffectiveEnd,
		&version.SupportedPurchaseTypes, &policy.GrantsInActive, &policy.GrantsInTrial,
		&policy.GrantsInGrace, &policy.GrantsInBillingRetry, &policy.GrantsInOneTime,
		&version.CreatedAt, &version.CreatedByActorID, &version.Reason, &version.Retroactive)
	version.Policy = policy
	return version, err
}

const versionFrom = `FROM product_entitlement_grant_versions v
	JOIN products p ON p.id = v.product_id AND p.project_id = v.project_id
	JOIN entitlements e ON e.id = v.entitlement_id AND e.project_id = v.project_id`

func (r *Repository) ListVersions(ctx context.Context, projectID string,
	filter billinggrant.ListFilter) ([]billinggrant.Version, error) {

	filter = filter.Bounded()
	rows, err := r.pool.Query(ctx,
		`SELECT `+versionColumns+` `+versionFrom+`
		 WHERE v.project_id = $1
		   AND ($2 = '' OR v.id = $2)
		   AND ($3 = '' OR v.product_id = $3)
		   AND ($4 = '' OR v.entitlement_id = $4)
		   AND (NOT $5::boolean OR v.effective_end IS NULL)
		 ORDER BY v.entitlement_id, v.version DESC
		 LIMIT $6`,
		projectID, filter.VersionID, filter.ProductID, filter.EntitlementID,
		filter.CurrentOnly, filter.Limit)
	if err != nil {
		return nil, fmt.Errorf("list grant versions: %w", err)
	}
	defer rows.Close()

	versions := make([]billinggrant.Version, 0, filter.Limit)
	for rows.Next() {
		version, err := scanVersion(rows)
		if err != nil {
			return nil, fmt.Errorf("scan grant version: %w", err)
		}
		versions = append(versions, version)
	}
	return versions, rows.Err()
}

func (r *Repository) CurrentVersion(ctx context.Context, projectID, productID, entitlementID string) (
	billinggrant.Version, bool, error) {

	version, err := scanVersion(r.pool.QueryRow(ctx,
		`SELECT `+versionColumns+` `+versionFrom+`
		 WHERE v.project_id = $1 AND v.product_id = $2 AND v.entitlement_id = $3
		   AND v.effective_end IS NULL`,
		projectID, productID, entitlementID))
	if errors.Is(err, pgx.ErrNoRows) {
		return billinggrant.Version{}, false, nil
	}
	if err != nil {
		return billinggrant.Version{}, false, fmt.Errorf("read current grant version: %w", err)
	}
	return version, true, nil
}

// Impact counts what a change to one pair would touch.
//
// Everything is counted from *current* state — the snapshot each customer's
// pointer names, not the whole snapshot history. A preview that included
// superseded snapshots would report a number no operator action can change, and
// on a busy Project it would be a much larger number, which is the worst
// possible combination for a confirmation dialog.
//
// It is one round trip so every count describes one instant. An operator
// weighing "customers" against "sources currently granting" across two
// statements would be comparing two different moments.
func (r *Repository) Impact(ctx context.Context, projectID, productID, entitlementID string) (
	billinggrant.Impact, error) {

	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT true FROM products WHERE id = $1 AND project_id = $2`, productID, projectID).Scan(&exists)
	if errors.Is(err, pgx.ErrNoRows) {
		return billinggrant.Impact{}, billinggrant.ErrNotFound
	}
	if err != nil {
		return billinggrant.Impact{}, fmt.Errorf("resolve impact Product: %w", err)
	}
	err = r.pool.QueryRow(ctx,
		`SELECT true FROM entitlements WHERE id = $1 AND project_id = $2`, entitlementID, projectID).Scan(&exists)
	if errors.Is(err, pgx.ErrNoRows) {
		return billinggrant.Impact{}, billinggrant.ErrNotFound
	}
	if err != nil {
		return billinggrant.Impact{}, fmt.Errorf("resolve impact Entitlement: %w", err)
	}

	impact := billinggrant.Impact{ProductID: productID, EntitlementID: entitlementID}
	err = r.pool.QueryRow(ctx,
		`WITH cited AS (
			SELECT s.billing_customer_id, s.entitlement_id, s.product_id, s.source_state
			FROM entitlement_sources s
			JOIN customer_entitlement_pointers ptr
			  ON ptr.current_snapshot_id = s.customer_entitlement_snapshot_id
			 AND ptr.billing_customer_id = s.billing_customer_id
			WHERE s.project_id = $1
		),
		affected AS (
			SELECT DISTINCT billing_customer_id FROM cited WHERE product_id = $2
		)
		SELECT
			(SELECT count(*) FROM affected),
			(SELECT count(*) FROM cited WHERE product_id = $2 AND source_state = 'active'),
			-- Reprojecting an affected customer re-derives every Entitlement and
			-- every Product their current snapshot cites, not only the pair being
			-- changed. Reporting the narrower number would understate the blast
			-- radius of the confirmation the operator is about to give.
			(SELECT count(DISTINCT c.entitlement_id) FROM cited c
			  JOIN affected a ON a.billing_customer_id = c.billing_customer_id),
			(SELECT count(DISTINCT c.product_id) FROM cited c
			  JOIN affected a ON a.billing_customer_id = c.billing_customer_id),
			-- Lineages resolved to the Product regardless of whether a customer
			-- has been resolved yet: purchases that the change affects and that
			-- the customer count cannot see.
			(SELECT count(*) FROM subscription_instances
			  WHERE project_id = $1 AND current_mosaic_product_id = $2)
			+ (SELECT count(*) FROM one_time_purchase_instances
			  WHERE project_id = $1 AND mosaic_product_id = $2)`,
		projectID, productID).
		Scan(&impact.ImpactedCustomers, &impact.ImpactedActiveSources,
			&impact.ImpactedEntitlements, &impact.ImpactedProducts, &impact.ImpactedLineages)
	if err != nil {
		return billinggrant.Impact{}, fmt.Errorf("count grant-version impact: %w", err)
	}
	// A pair with no committed sources still touches its own Product and
	// Entitlement; reporting zero would read as "this change does nothing".
	if impact.ImpactedProducts == 0 {
		impact.ImpactedProducts = 1
	}
	if impact.ImpactedEntitlements == 0 {
		impact.ImpactedEntitlements = 1
	}
	return impact, nil
}

// Publish applies one validated proposal atomically.
func (r *Repository) Publish(ctx context.Context, actor billinggrant.Actor, projectID string,
	input billinggrant.PublishInput,
	plan func(existing []billinggrant.Version, at time.Time) (billinggrant.Plan, error),
	now time.Time) (billinggrant.Version, error) {

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billinggrant.Version{}, fmt.Errorf("begin grant version publish: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// The pair's advisory lock, following the accepted LockScope pattern. It is
	// taken before the history is read, so two concurrent publishes for one pair
	// serialize rather than both deciding against the same "current" version and
	// both trying to close it.
	lockScope := "billing-grant-version:" + projectID + ":" + input.ProductID + ":" + input.EntitlementID
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, lockScope); err != nil {
		return billinggrant.Version{}, fmt.Errorf("lock grant version pair: %w", err)
	}

	var organizationID string
	if err := tx.QueryRow(ctx,
		`SELECT p.organization_id FROM products pr
		 JOIN projects p ON p.id = pr.project_id
		 WHERE pr.id = $1 AND pr.project_id = $2`, input.ProductID, projectID).Scan(&organizationID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return billinggrant.Version{}, billinggrant.ErrNotFound
		}
		return billinggrant.Version{}, fmt.Errorf("resolve grant version Product: %w", err)
	}
	var entitlementKey string
	if err := tx.QueryRow(ctx, `SELECT key FROM entitlements WHERE id = $1 AND project_id = $2`,
		input.EntitlementID, projectID).Scan(&entitlementKey); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return billinggrant.Version{}, billinggrant.ErrNotFound
		}
		return billinggrant.Version{}, fmt.Errorf("resolve grant version Entitlement: %w", err)
	}
	if err := requireActiveEntitlement(ctx, tx, projectID, input.EntitlementID); err != nil {
		return billinggrant.Version{}, err
	}

	existing, err := versionsForPair(ctx, tx, projectID, input.ProductID, input.EntitlementID)
	if err != nil {
		return billinggrant.Version{}, err
	}
	decision, err := plan(existing, now)
	if err != nil {
		return billinggrant.Version{}, err
	}

	if decision.SupersededVersionID != "" {
		// The one permitted update: closing an open interval. The trigger from
		// migration 00047 refuses everything else, and the WHERE clause refuses
		// to close an interval that has been closed since the history was read —
		// which cannot happen under the lock, and is checked anyway because the
		// alternative failure is silent.
		tag, err := tx.Exec(ctx,
			`UPDATE product_entitlement_grant_versions
			 SET effective_end = $3
			 WHERE id = $1 AND project_id = $2 AND effective_end IS NULL`,
			decision.SupersededVersionID, projectID, decision.SupersededAt)
		if err != nil {
			return billinggrant.Version{}, translate(err, "close superseded grant version")
		}
		if tag.RowsAffected() != 1 {
			return billinggrant.Version{}, billinggrant.ErrConflict
		}
	}

	versionID := "pegv_" + shortHash(projectID, input.ProductID, input.EntitlementID, decision.NextVersion)
	inserted, err := scanVersion(tx.QueryRow(ctx,
		`WITH inserted AS (
			INSERT INTO product_entitlement_grant_versions(
				id, project_id, product_id, entitlement_id, version, grant_policy_version,
				effective_start, effective_end, supported_purchase_types,
				grants_in_active, grants_in_trial, grants_in_grace, grants_in_billing_retry,
				grants_in_paused, grants_in_one_time_ownership,
				created_at, created_by_actor_id, reason)
			VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10,$11,$12,false,$13,$14,$15,$16)
			RETURNING *
		)
		SELECT `+versionColumns+`
		FROM inserted v
		JOIN products p ON p.id = v.product_id AND p.project_id = v.project_id
		JOIN entitlements e ON e.id = v.entitlement_id AND e.project_id = v.project_id`,
		versionID, projectID, input.ProductID, input.EntitlementID, decision.NextVersion,
		billinggrant.GrantPolicyVersion, input.EffectiveStart.UTC(), input.SupportedPurchaseTypes,
		input.Policy.GrantsInActive, input.Policy.GrantsInTrial, input.Policy.GrantsInGrace,
		input.Policy.GrantsInBillingRetry, input.Policy.GrantsInOneTime,
		now.UTC(), actor.ID, strings.TrimSpace(input.Reason)))
	if err != nil {
		return billinggrant.Version{}, translate(err, "insert grant version")
	}

	// The legacy unversioned grant row is kept in step so the catalog surface
	// that still reads it does not disagree with the versioned history. It is
	// the projection of the versioned truth, not a second truth.
	if _, err := tx.Exec(ctx,
		`INSERT INTO product_entitlement_grants(product_id, entitlement_id, project_id, created_at)
		 VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
		input.ProductID, input.EntitlementID, projectID, now.UTC()); err != nil {
		return billinggrant.Version{}, translate(err, "align legacy grant row")
	}

	if err := recordAudit(ctx, tx, organizationID, projectID, actor.ID, inserted, decision, now); err != nil {
		return billinggrant.Version{}, err
	}
	enqueued, err := enqueueReprojection(ctx, tx, projectID, input.ProductID, now)
	if err != nil {
		return billinggrant.Version{}, err
	}
	_ = enqueued

	if err := tx.Commit(ctx); err != nil {
		return billinggrant.Version{}, fmt.Errorf("commit grant version publish: %w", err)
	}
	return inserted, nil
}

// requireActiveEntitlement refuses a grant version for an archived Entitlement.
// Archiving preserves historical meaning; publishing new meaning onto it would
// quietly un-archive it for every future purchase.
func requireActiveEntitlement(ctx context.Context, tx pgx.Tx, projectID, entitlementID string) error {
	var lifecycle string
	if err := tx.QueryRow(ctx,
		`SELECT lifecycle_state FROM entitlements WHERE id = $1 AND project_id = $2`,
		entitlementID, projectID).Scan(&lifecycle); err != nil {
		return fmt.Errorf("read Entitlement lifecycle: %w", err)
	}
	if lifecycle != "active" {
		return fmt.Errorf("%w: the Entitlement is archived", billinggrant.ErrInvalid)
	}
	return nil
}

func versionsForPair(ctx context.Context, tx pgx.Tx, projectID, productID, entitlementID string) (
	[]billinggrant.Version, error) {

	rows, err := tx.Query(ctx,
		`SELECT `+versionColumns+` `+versionFrom+`
		 WHERE v.project_id = $1 AND v.product_id = $2 AND v.entitlement_id = $3
		 ORDER BY v.version`,
		projectID, productID, entitlementID)
	if err != nil {
		return nil, fmt.Errorf("read grant version history: %w", err)
	}
	defer rows.Close()

	versions := make([]billinggrant.Version, 0, 8)
	for rows.Next() {
		version, err := scanVersion(rows)
		if err != nil {
			return nil, fmt.Errorf("scan grant version history: %w", err)
		}
		versions = append(versions, version)
	}
	return versions, rows.Err()
}

// recordAudit writes the change into the audit trail inside the publish
// transaction. The actor, the reason, and what the change did to the previous
// version are all on the entry, because an investigation months later reads the
// audit trail and not the response the operator saw once.
func recordAudit(ctx context.Context, tx pgx.Tx, organizationID, projectID, actorID string,
	version billinggrant.Version, decision billinggrant.Plan, now time.Time) error {

	metadata, err := json.Marshal(map[string]any{
		"entitlementId":        version.EntitlementID,
		"entitlementKey":       version.EntitlementKey,
		"productId":            version.ProductID,
		"grantVersion":         version.Version,
		"grantPolicyVersion":   version.GrantPolicyVersion,
		"effectiveStart":       version.EffectiveStart.UTC().Format(time.RFC3339Nano),
		"retroactive":          version.Retroactive,
		"supersededVersionId":  decision.SupersededVersionID,
		"reason":               version.Reason,
		"grantsInActive":       version.Policy.GrantsInActive,
		"grantsInTrial":        version.Policy.GrantsInTrial,
		"grantsInGrace":        version.Policy.GrantsInGrace,
		"grantsInBillingRetry": version.Policy.GrantsInBillingRetry,
		"grantsInOneTime":      version.Policy.GrantsInOneTime,
	})
	if err != nil {
		return fmt.Errorf("encode grant version audit metadata: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO audit_events(id, actor_id, organization_id, project_id,
			action, resource_type, resource_id, metadata, created_at)
		 VALUES ($1,$2,$3,$4,'product.entitlement_grant_version_published',
			'product_entitlement_grant_version',$5,$6,$7)`,
		"aud_"+shortHash(version.ID, now.UnixNano()), actorID, organizationID, projectID,
		version.ID, metadata, now.UTC()); err != nil {
		return fmt.Errorf("insert grant version audit event: %w", err)
	}
	return nil
}

// enqueueReprojection queues one projection job per affected customer.
//
// It is inside the publish transaction on purpose. A grant version that is
// recorded but never applied is worse than one that was never published: every
// surface reports the new meaning while every customer keeps the old access, and
// nothing in the system is in a state that would ever retry. Committing the
// version and the work to apply it together makes that state unreachable.
//
// The insert is set-based and coalesces on the existing partial uniqueness, so a
// customer with projection work already queued absorbs the trigger rather than
// accumulating a second job.
func enqueueReprojection(ctx context.Context, tx pgx.Tx, projectID, productID string, now time.Time) (int64, error) {
	tag, err := tx.Exec(ctx,
		`INSERT INTO projection_jobs(
			id, project_id, environment_id, scope_key, kind, detail, status,
			attempt_count, max_attempts, available_at, created_at, updated_at)
		 SELECT 'pjb_' || md5(scoped.environment_id || ':' || scoped.billing_customer_id || ':' || $3::text),
		        $1, scoped.environment_id, 'customer:' || scoped.billing_customer_id,
		        $4, jsonb_build_object('customerId', scoped.billing_customer_id, 'lineageId', ''),
		        'queued', 0, 8, $5, $5, $5
		 FROM (
			SELECT DISTINCT s.environment_id, s.billing_customer_id
			FROM entitlement_sources s
			JOIN customer_entitlement_pointers ptr
			  ON ptr.current_snapshot_id = s.customer_entitlement_snapshot_id
			 AND ptr.billing_customer_id = s.billing_customer_id
			WHERE s.project_id = $1 AND s.product_id = $2
		 ) scoped
		 ON CONFLICT DO NOTHING`,
		projectID, productID, now.UTC().Format(time.RFC3339Nano),
		billingprojection.KindGrantVersionPublished, now.UTC())
	if err != nil {
		return 0, translate(err, "enqueue grant-version reprojection")
	}
	return tag.RowsAffected(), nil
}

func shortHash(parts ...any) string {
	hasher := sha256.New()
	for _, part := range parts {
		fmt.Fprintf(hasher, "%v\x00", part)
	}
	return fmt.Sprintf("%x", hasher.Sum(nil))[:24]
}

// translate maps the constraint and trigger failures this package can provoke
// onto stable domain errors, so an operator gets a sentence about grants rather
// than a constraint name.
func translate(err error, context string) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch {
		case pgErr.Code == "55000":
			// The append-only trigger refused a rewrite.
			return billinggrant.ErrImmutable
		case pgErr.Code == "23505" &&
			strings.Contains(pgErr.ConstraintName, "product_entitlement_grant_versions_open_idx"):
			// Two open-ended versions for one pair. Under the advisory lock this
			// is unreachable; if it is reached, the history moved.
			return billinggrant.ErrConflict
		case pgErr.Code == "23505":
			return billinggrant.ErrConflict
		case pgErr.Code == "23514":
			return fmt.Errorf("%w: the proposed version violates a grant invariant", billinggrant.ErrInvalid)
		case pgErr.Code == "23503":
			return billinggrant.ErrNotFound
		}
	}
	return fmt.Errorf("%s: %w", context, err)
}
