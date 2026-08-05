// Package projectoverviewpostgres is the PostgreSQL read model behind Mosaic's
// Project overview summary.
//
// Every statement in this file is a SELECT and every count is grouped: one
// query per source, never one per metric. This surface renders on every visit
// to the Project overview page, so its cost must be a function of how much data
// the Environment holds and not of how many tiles the page draws.
//
// Index coverage (assessed against the migrated schema; no new index was
// required):
//
//   - customer_entitlement_pointers(environment_id, updated_at DESC), migration
//     00048, serves the customer count's Environment predicate.
//   - subscription_instances(environment_id, created_at DESC, id), migration
//     00031, serves the projection-state count; the snapshot join is a primary
//     key lookup.
//   - billing_transaction_facts(environment_id, occurred_at DESC, id),
//     migration 00024, serves the fact count, which is bounded to the two
//     windows so it never scans the Environment's fact history.
//
// The daily series reads reuse the same two indexes over a wider but still
// bounded range — at most 90 days — and group in the database, so a 90-day
// chart costs one round trip rather than ninety.
package projectoverviewpostgres

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Mujhtech/mosaic/apps/api/internal/projectoverview"
)

type Repository struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

var _ projectoverview.Repository = (*Repository)(nil)

// Authorize resolves the actor's organization role for the Project and checks
// that the Environment belongs to it.
//
// The bar is owner, admin, or member — the same bar the analytics overview
// sits at, and deliberately lower than the billing operator surface's
// owner/admin. That surface names who bought what; this one publishes
// population counts and names nobody, so raising it would hide the landing page
// from the members who are expected to open it.
//
// The Environment containment check is not optional. Without it a member of
// Project A could pair their own projectId with Project B's environmentId: the
// role check would pass and every count below, which filters on environment_id
// alone, would answer about B.
func (r *Repository) Authorize(ctx context.Context, actor projectoverview.Actor, projectID, environmentID string) error {
	if strings.TrimSpace(actor.ID) == "" {
		return projectoverview.ErrUnauthenticated
	}
	var role string
	err := r.pool.QueryRow(ctx,
		`SELECT m.role FROM projects p
		 JOIN organization_members m ON m.organization_id = p.organization_id
		 WHERE p.id = $1 AND m.actor_id = $2`, projectID, actor.ID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return projectoverview.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("resolve project overview role: %w", err)
	}
	switch role {
	case "owner", "admin", "member":
	default:
		return projectoverview.ErrForbidden
	}
	var exists bool
	err = r.pool.QueryRow(ctx,
		`SELECT true FROM environments WHERE id=$1 AND project_id=$2`, environmentID, projectID).Scan(&exists)
	if errors.Is(err, pgx.ErrNoRows) {
		return projectoverview.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("resolve project overview environment: %w", err)
	}
	return nil
}

// BillingEnabled reads the Project's billing setting. A Project with no billing
// settings row has never enabled billing, which is reported as disabled rather
// than as an error.
func (r *Repository) BillingEnabled(ctx context.Context, projectID string) (bool, error) {
	var enabled bool
	err := r.pool.QueryRow(ctx,
		`SELECT billing_enabled FROM billing_project_settings WHERE project_id = $1`, projectID).Scan(&enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read billing enablement: %w", err)
	}
	return enabled, nil
}

// CustomerCounts counts Billing Customers holding committed entitlement state
// in the Environment.
//
// The population is the set of current entitlement pointers, because a Billing
// Customer row is Project-scoped identity — one customer, one row, whatever
// Environment their purchases live in — and the pointer is the only per
// Environment record of that customer existing here. Counting billing_customers
// directly would report the sandbox population on the production page.
//
// The "new" counts use the customer's own created_at, so a customer created
// yesterday whose first purchase projected today counts as new yesterday. That
// is the honest reading of "new customer": Mosaic learned of them yesterday.
func (r *Repository) CustomerCounts(ctx context.Context, environmentID string,
	windows projectoverview.Windows) (projectoverview.CustomerCounts, error) {

	var counts projectoverview.CustomerCounts
	err := r.pool.QueryRow(ctx,
		`SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE c.created_at >= $2 AND c.created_at < $3),
			COUNT(*) FILTER (WHERE c.created_at >= $4 AND c.created_at < $5)
		 FROM customer_entitlement_pointers p
		 JOIN billing_customers c
		   ON c.id = p.billing_customer_id AND c.project_id = p.project_id
		 WHERE p.environment_id = $1`,
		environmentID,
		windows.Today.From, windows.Today.To,
		windows.Yesterday.From, windows.Yesterday.To,
	).Scan(&counts.Total, &counts.NewToday, &counts.NewYesterday)
	if err != nil {
		return projectoverview.CustomerCounts{}, fmt.Errorf("count overview customers: %w", err)
	}
	return counts, nil
}

// SubscriptionStateCounts counts current subscription lifecycle populations.
//
// It reads each Subscription Instance's current snapshot rather than the latest
// snapshot by version, because the pointer is what every other Mosaic surface
// treats as committed state. Reading "latest" would let an in-flight projection
// show on the overview before the transaction that publishes it commits.
//
// `active` is the access axis and the lifecycle populations are the lifecycle
// axis, so a trialing subscription that grants access is counted in both. That
// is intended: a trial is an active subscription, and reporting them as
// disjoint would make the tiles fail to add up against the customer's own view.
func (r *Repository) SubscriptionStateCounts(ctx context.Context, environmentID string) (
	projectoverview.SubscriptionStateCounts, error) {

	var counts projectoverview.SubscriptionStateCounts
	err := r.pool.QueryRow(ctx,
		`SELECT
			COUNT(*) FILTER (WHERE s.access_state = 'active'),
			COUNT(*) FILTER (WHERE s.lifecycle_state = 'trialing'),
			COUNT(*) FILTER (WHERE s.lifecycle_state = 'grace_period'),
			COUNT(*) FILTER (WHERE s.lifecycle_state = 'billing_retry')
		 FROM subscription_instances i
		 JOIN subscription_snapshots s ON s.id = i.current_snapshot_id
		 WHERE i.environment_id = $1`, environmentID,
	).Scan(&counts.Active, &counts.Trialing, &counts.GracePeriod, &counts.BillingRetry)
	if err != nil {
		return projectoverview.SubscriptionStateCounts{}, fmt.Errorf("count overview subscription states: %w", err)
	}
	return counts, nil
}

// SubscriptionFactCounts counts new subscriptions and trial starts in both
// windows from validated Transaction Facts.
//
// A trial start is an `offer_redeemed` Fact: that is exactly the Fact kind the
// projection engine treats as entering the trialing lifecycle
// (internal/billingprojection/subscription.go). The kind also covers
// introductory and promotional offers that are not free trials, so this counts
// offer redemptions and the projector agrees with it — the two cannot drift,
// which matters more here than a narrower definition neither could enforce.
//
// The counts are DISTINCT over the provider transaction identifier rather than
// over rows. Migration 00029 states the consequence it accepted: revalidating a
// 9A input under validator 2 mints a second, immutable Fact describing the same
// provider statement. Counting rows would report a revalidation pass as a
// purchase spike. The provider transaction id is stable across validator
// versions, so counting it counts provider statements.
func (r *Repository) SubscriptionFactCounts(ctx context.Context, environmentID string,
	windows projectoverview.Windows) (projectoverview.SubscriptionFactCounts, error) {

	var counts projectoverview.SubscriptionFactCounts
	err := r.pool.QueryRow(ctx,
		`SELECT
			COUNT(DISTINCT provider_transaction_id)
				FILTER (WHERE fact_kind = 'initial_purchase' AND occurred_at >= $2 AND occurred_at < $3),
			COUNT(DISTINCT provider_transaction_id)
				FILTER (WHERE fact_kind = 'initial_purchase' AND occurred_at >= $4 AND occurred_at < $5),
			COUNT(DISTINCT provider_transaction_id)
				FILTER (WHERE fact_kind = 'offer_redeemed' AND occurred_at >= $2 AND occurred_at < $3),
			COUNT(DISTINCT provider_transaction_id)
				FILTER (WHERE fact_kind = 'offer_redeemed' AND occurred_at >= $4 AND occurred_at < $5)
		 FROM billing_transaction_facts
		 WHERE environment_id = $1
		   AND transaction_type = 'auto_renewable_subscription'
		   AND occurred_at >= $4 AND occurred_at < $3`,
		environmentID,
		windows.Today.From, windows.Today.To,
		windows.Yesterday.From, windows.Yesterday.To,
	).Scan(&counts.InitialPurchasesToday, &counts.InitialPurchasesYesterday,
		&counts.TrialStartsToday, &counts.TrialStartsYesterday)
	if err != nil {
		return projectoverview.SubscriptionFactCounts{}, fmt.Errorf("count overview subscription facts: %w", err)
	}
	return counts, nil
}

// CustomerDailyCounts groups new Billing Customers by UTC day over the series
// window.
//
// The population and the "new" definition are the scalar endpoint's, unchanged:
// the Environment's current entitlement pointers joined to the Project-scoped
// customer identity, dated by when Mosaic first learned of the customer. Two
// surfaces disagreeing about who is a customer would be worse than either being
// wrong on its own.
//
// One statement covering the whole window, grouped by day. Days with no new
// customers are simply absent, and the service turns those into explicit zeros.
func (r *Repository) CustomerDailyCounts(ctx context.Context, environmentID string,
	window projectoverview.Window) ([]projectoverview.DailyCount, error) {

	rows, err := r.pool.Query(ctx,
		`SELECT (c.created_at AT TIME ZONE 'UTC')::date, COUNT(*)
		 FROM customer_entitlement_pointers p
		 JOIN billing_customers c
		   ON c.id = p.billing_customer_id AND c.project_id = p.project_id
		 WHERE p.environment_id = $1 AND c.created_at >= $2 AND c.created_at < $3
		 GROUP BY 1
		 ORDER BY 1`,
		environmentID, window.From, window.To)
	if err != nil {
		return nil, fmt.Errorf("count overview daily customers: %w", err)
	}
	defer rows.Close()
	counts := []projectoverview.DailyCount{}
	for rows.Next() {
		var count projectoverview.DailyCount
		if err = rows.Scan(&count.Day, &count.Count); err != nil {
			return nil, fmt.Errorf("scan overview daily customers: %w", err)
		}
		counts = append(counts, count)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("read overview daily customers: %w", err)
	}
	return counts, nil
}

// SubscriptionFactDailyCounts groups new subscriptions and trial starts by UTC
// day over the series window.
//
// Both counts come from the same statement and carry the scalar endpoint's
// rules verbatim: auto-renewable subscriptions only, `initial_purchase` for a
// new subscription and `offer_redeemed` for a trial start, and DISTINCT over the
// provider transaction identifier rather than over rows.
//
// The dedup is per day and that is the only sound reading. Migration 00029
// accepted that revalidating a 9A input under validator 2 mints a second
// immutable Fact for a provider statement already recorded, and both rows carry
// the provider's occurred_at — so they land in the same day's bucket and
// collapse to one. Counting rows would draw a revalidation pass as a purchase
// spike on whichever day the backlog happened to cover.
func (r *Repository) SubscriptionFactDailyCounts(ctx context.Context, environmentID string,
	window projectoverview.Window) ([]projectoverview.DailyFactCounts, error) {

	rows, err := r.pool.Query(ctx,
		`SELECT (occurred_at AT TIME ZONE 'UTC')::date,
			COUNT(DISTINCT provider_transaction_id) FILTER (WHERE fact_kind = 'initial_purchase'),
			COUNT(DISTINCT provider_transaction_id) FILTER (WHERE fact_kind = 'offer_redeemed')
		 FROM billing_transaction_facts
		 WHERE environment_id = $1
		   AND transaction_type = 'auto_renewable_subscription'
		   AND fact_kind IN ('initial_purchase', 'offer_redeemed')
		   AND occurred_at >= $2 AND occurred_at < $3
		 GROUP BY 1
		 ORDER BY 1`,
		environmentID, window.From, window.To)
	if err != nil {
		return nil, fmt.Errorf("count overview daily subscription facts: %w", err)
	}
	defer rows.Close()
	counts := []projectoverview.DailyFactCounts{}
	for rows.Next() {
		var count projectoverview.DailyFactCounts
		if err = rows.Scan(&count.Day, &count.InitialPurchases, &count.TrialStarts); err != nil {
			return nil, fmt.Errorf("scan overview daily subscription facts: %w", err)
		}
		counts = append(counts, count)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("read overview daily subscription facts: %w", err)
	}
	return counts, nil
}
