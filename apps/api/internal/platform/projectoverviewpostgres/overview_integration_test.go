package projectoverviewpostgres_test

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/Mujhtech/mosaic/apps/api/internal/analytics"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/analyticspostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/projectoverviewpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/projectoverview"
	"github.com/Mujhtech/mosaic/apps/api/migrations"
)

// These tests cover the guarantees that only exist once the overview's SQL runs
// against the real schema, and that a stub repository would report as passing
// while the shipped page was wrong:
//
//   - every count is scoped to the Environment in the route, not to the
//     Project. Mosaic's Billing Customer is Project-scoped identity, so getting
//     this wrong shows the sandbox population on the production page — the same
//     class of leak Environment scoping exists to prevent everywhere else;
//   - "today" and "yesterday" land on the right rows at the UTC day boundary.
//     A count that is off by one day is invisible to every reader;
//   - a revalidated purchase is one purchase. Migration 00029 accepted that
//     validator 2 mints a second immutable Fact for a provider statement already
//     recorded under validator 1, so counting rows would report a revalidation
//     pass as a purchase spike;
//   - a Subscription Instance with no committed snapshot contributes nothing,
//     so an in-flight projection cannot appear on the overview before it
//     commits.
//
// Column mapping and the authorization role bar are not re-tested here: the
// former is exercised by every assertion below, and the latter is the same
// query every other Mosaic Project surface runs.

func testPool(t *testing.T) (*pgxpool.Pool, context.Context) {
	t.Helper()
	databaseURL := os.Getenv("DATABASE_TEST_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_TEST_URL is required for PostgreSQL integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	t.Cleanup(cancel)

	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	goose.SetBaseFS(migrations.Files)
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatal(err)
	}
	if err := goose.UpContext(ctx, db, "."); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}
	_ = db.Close()

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool, ctx
}

func digestOf(value string) []byte {
	sum := sha256.Sum256([]byte(value))
	return sum[:]
}

// fixture seeds one tenant with two Environments so every count can be proven
// Environment-scoped rather than Project-scoped.
type fixture struct {
	pool                     *pgxpool.Pool
	ctx                      context.Context
	organization, project    string
	environment, otherEnv    string
	application              string
	ownerActor, outsideActor string
	now                      time.Time
	windows                  projectoverview.Windows
}

func newFixture(t *testing.T, suffix string) *fixture {
	t.Helper()
	pool, ctx := testPool(t)
	// A fixed instant rather than the wall clock: the assertions below are about
	// which side of a UTC midnight a row falls on, and a test that only fails
	// when it runs near midnight is not a test.
	now := time.Date(2026, 5, 15, 12, 0, 0, 0, time.UTC)
	f := &fixture{
		pool: pool, ctx: ctx,
		organization: "org_pov_" + suffix,
		project:      "proj_pov_" + suffix,
		environment:  "env_pov_" + suffix,
		otherEnv:     "env_pov_other_" + suffix,
		application:  "app_pov_" + suffix,
		ownerActor:   "actor_pov_owner_" + suffix,
		outsideActor: "actor_pov_outside_" + suffix,
		now:          now,
		windows:      projectoverview.NewWindows(now),
	}
	f.cleanup()
	t.Cleanup(f.cleanup)

	f.exec(t, `INSERT INTO organizations(id,name,created_at,updated_at) VALUES ($1,'Overview Test',$2,$2)`,
		f.organization, now)
	f.exec(t, `INSERT INTO organization_members(organization_id,actor_id,role,created_at,updated_at)
	           VALUES ($1,$2,'owner',$3,$3)`, f.organization, f.ownerActor, now)
	f.exec(t, `INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at)
	           VALUES ($1,$2,$3,'Overview','active',$4,$4)`,
		f.project, f.organization, "overview-"+suffix, now)
	f.exec(t, `INSERT INTO billing_project_settings(project_id,billing_enabled,updated_by_actor_id,created_at,updated_at)
	           VALUES ($1,true,'seed',$2,$2)`, f.project, now)
	f.exec(t, `INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at)
	           VALUES ($1,$2,'production','Production','production',$3,$3)`, f.environment, f.project, now)
	f.exec(t, `INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at)
	           VALUES ($1,$2,'staging','Staging','staging',$3,$3)`, f.otherEnv, f.project, now)
	f.exec(t, `INSERT INTO applications(id,project_id,name,platform,identifier,created_at,updated_at)
	           VALUES ($1,$2,'Overview App','ios',$3,$4,$4)`,
		f.application, f.project, "com.mosaic.overview."+suffix, now)
	return f
}

func (f *fixture) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx, query, args...); err != nil {
		t.Fatalf("seed overview fixture: %v", err)
	}
}

// customer seeds a Billing Customer, optionally with a committed entitlement
// pointer in one Environment. A customer without a pointer exists in the
// Project but holds no state in any Environment.
func (f *fixture) customer(t *testing.T, id string, createdAt time.Time, pointerEnvironment string) {
	t.Helper()
	f.exec(t, `INSERT INTO billing_customers(id,project_id,status,diagnostics_status,created_at,updated_at)
	           VALUES ($1,$2,'active','none',$3,$3)`, id, f.project, createdAt)
	if pointerEnvironment == "" {
		return
	}
	snapshotID := "ces_" + id
	f.exec(t, `INSERT INTO customer_entitlement_snapshots(
	               id,project_id,environment_id,billing_customer_id,snapshot_version,rule_version,
	               computed_at,as_of,checksum,change_reason,created_at)
	           VALUES ($1,$2,$3,$4,1,1,$5,$5,$6,'seed',$5)`,
		snapshotID, f.project, pointerEnvironment, id, createdAt, digestOf(snapshotID))
	f.exec(t, `INSERT INTO customer_entitlement_pointers(
	               project_id,environment_id,billing_customer_id,current_snapshot_id,snapshot_version,updated_at)
	           VALUES ($1,$2,$3,$4,1,$5)`, f.project, pointerEnvironment, id, snapshotID, createdAt)
}

// subscription seeds a Subscription Instance and, unless withSnapshot is false,
// the committed snapshot its pointer names.
func (f *fixture) subscription(t *testing.T, id, environmentID, mode, storeEnvironment,
	accessState, lifecycleState string, withSnapshot bool) {
	t.Helper()
	lineageID := "bpl_" + id
	f.exec(t, `INSERT INTO purchase_lineages(
	               id,project_id,environment_id,environment_mode,application_id,provider,
	               store_environment,lineage_key_digest,lineage_type,created_at,updated_at)
	           VALUES ($1,$2,$3,$4,$5,'app_store',$6,$7,'subscription',$8,$8)`,
		lineageID, f.project, environmentID, mode, f.application, storeEnvironment,
		digestOf(lineageID), f.now)
	f.exec(t, `INSERT INTO subscription_instances(
	               id,project_id,environment_id,application_id,purchase_lineage_id,provider,
	               current_projection_version,diagnostic_status,created_at,updated_at)
	           VALUES ($1,$2,$3,$4,$5,'app_store',1,'none',$6,$6)`,
		id, f.project, environmentID, f.application, lineageID, f.now)
	if !withSnapshot {
		return
	}
	snapshotID := "sns_" + id
	graceEnd := any(nil)
	if lifecycleState == "grace_period" {
		graceEnd = f.now.Add(72 * time.Hour)
	}
	f.exec(t, `INSERT INTO subscription_snapshots(
	               id,project_id,environment_id,subscription_instance_id,projection_version,rule_version,
	               computed_at,as_of,access_state,lifecycle_state,renewal_intent,billing_state,
	               grace_period_end_at,checksum,projection_reason,created_at)
	           VALUES ($1,$2,$3,$4,1,1,$5,$5,$6,$7,'auto_renew_enabled','current',$8,$9,'seed',$5)`,
		snapshotID, f.project, environmentID, id, f.now, accessState, lifecycleState,
		graceEnd, digestOf(snapshotID))
	f.exec(t, `UPDATE subscription_instances SET current_snapshot_id=$1 WHERE id=$2`, snapshotID, id)
}

// fact seeds one validated Transaction Fact. providerTransactionID is passed
// separately from the row id so a validator restatement — two immutable rows
// describing one provider statement — can be seeded.
func (f *fixture) fact(t *testing.T, id, providerTransactionID, transactionType, factKind string,
	occurredAt time.Time) {
	t.Helper()
	f.factIn(t, f.environment, id, providerTransactionID, transactionType, factKind, occurredAt)
}

// factIn seeds a Fact in a named Environment, so Environment scoping can be
// proven rather than assumed.
func (f *fixture) factIn(t *testing.T, environmentID, id, providerTransactionID, transactionType, factKind string,
	occurredAt time.Time) {
	t.Helper()
	inputID, attemptID := "bri_"+id, "bva_"+id
	// Migration 00024 keys these rows to (environment_id, project_id, mode) and
	// requires the store environment to be production exactly when the
	// Environment is, so the staging fixture has to be seeded as sandbox.
	mode, storeEnvironment := "production", "production"
	if environmentID != f.environment {
		mode, storeEnvironment = "staging", "sandbox"
	}
	f.exec(t, `INSERT INTO billing_raw_inputs(
	               id,project_id,organization_id,environment_id,environment_mode,provider,
	               source,source_authority,idempotency_key,content_digest,body_state,
	               authentication_result,store_environment,ingestion_status,correlation_id,
	               received_at,expires_at)
	           VALUES ($1,$2,$3,$4,$9,'app_store','apple_notification','store_notification',
	               $5,$6,'not_retained','verified_signature',$10,'accepted','overview',$7,$8)`,
		inputID, f.project, f.organization, environmentID,
		digestOf("idem-"+id), digestOf("content-"+id), f.now, f.now.Add(time.Hour),
		mode, storeEnvironment)
	f.exec(t, `INSERT INTO billing_validation_attempts(
	               id,project_id,environment_id,raw_input_id,attempt_number,validator_version,
	               started_at,completed_at,outcome,retryable,store_environment,latency_ms,correlation_id)
	           VALUES ($1,$2,$3,$4,1,2,$5,$5,'validated',false,$6,1,'overview')`,
		attemptID, f.project, environmentID, inputID, f.now, storeEnvironment)
	// purchase_chain_digest is left NULL so the chain-closure trigger added in
	// migration 00046 has nothing to maintain: the overview never reads the
	// closure, and seeding it would only add teardown.
	f.exec(t, `INSERT INTO billing_transaction_facts(
	               id,project_id,environment_id,environment_mode,application_id,provider,
	               store_environment,provider_transaction_id,transaction_type,fact_kind,occurred_at,
	               provider_product_identifier,resolution_state,validator_version,
	               source_raw_input_id,validation_attempt_id,fact_digest,recorded_at)
	           VALUES ($1,$2,$3,$12,$4,'app_store',$13,$5,$6,$7,$8,
	               'com.mosaic.pro','unresolved',2,$9,$10,$11,$8)`,
		id, f.project, environmentID, f.application, providerTransactionID, transactionType,
		factKind, occurredAt, inputID, attemptID, digestOf("fact-"+id), mode, storeEnvironment)
}

func (f *fixture) funnelBucket(t *testing.T, environmentID string, day time.Time,
	metricID string, numerator int64, denominator any) {
	t.Helper()
	f.exec(t, `INSERT INTO analytics_daily_funnel_counts(
	               project_id,environment_id,bucket_date,metric_id,authority,numerator,denominator,
	               latest_received_at)
	           VALUES ($1,$2,$3::date,$4,'client_observed',$5,$6,$7)`,
		f.project, environmentID, day, metricID, numerator, denominator, f.now)
}

func (f *fixture) cleanup() {
	ctx := context.Background()
	for _, table := range []string{
		"billing_transaction_facts", "billing_validation_attempts",
		"subscription_snapshots", "customer_entitlement_snapshots",
	} {
		_, _ = f.pool.Exec(ctx, `ALTER TABLE `+table+` DISABLE TRIGGER `+table+`_append_only`)
	}
	// The instance-to-snapshot pointer has to be released before the snapshots
	// it references can go.
	_, _ = f.pool.Exec(ctx, `UPDATE subscription_instances SET current_snapshot_id=NULL WHERE project_id=$1`, f.project)
	for _, statement := range []string{
		`DELETE FROM analytics_daily_funnel_counts WHERE project_id=$1`,
		`DELETE FROM customer_entitlement_pointers WHERE project_id=$1`,
		`DELETE FROM customer_entitlement_snapshots WHERE project_id=$1`,
		`DELETE FROM subscription_snapshots WHERE project_id=$1`,
		`DELETE FROM subscription_instances WHERE project_id=$1`,
		`DELETE FROM billing_transaction_facts WHERE project_id=$1`,
		`DELETE FROM billing_validation_attempts WHERE project_id=$1`,
		`DELETE FROM billing_raw_inputs WHERE project_id=$1`,
		`DELETE FROM purchase_lineages WHERE project_id=$1`,
		`DELETE FROM billing_customers WHERE project_id=$1`,
		`DELETE FROM analytics_environment_settings WHERE project_id=$1`,
		// Environments carry a release-state row created by trigger; it has to
		// go before the Environment it points at.
		`DELETE FROM environment_release_state WHERE project_id=$1`,
		`DELETE FROM environments WHERE project_id=$1`,
		`DELETE FROM applications WHERE project_id=$1`,
		`DELETE FROM billing_project_settings WHERE project_id=$1`,
	} {
		_, _ = f.pool.Exec(ctx, statement, f.project)
	}
	for _, table := range []string{
		"billing_transaction_facts", "billing_validation_attempts",
		"subscription_snapshots", "customer_entitlement_snapshots",
	} {
		_, _ = f.pool.Exec(ctx, `ALTER TABLE `+table+` ENABLE TRIGGER `+table+`_append_only`)
	}
	_, _ = f.pool.Exec(ctx, `DELETE FROM projects WHERE id=$1`, f.project)
	_, _ = f.pool.Exec(ctx, `DELETE FROM organization_members WHERE organization_id=$1`, f.organization)
	_, _ = f.pool.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, f.organization)
}

// Customers are counted per Environment through their committed entitlement
// pointer, and "new" is bounded by the UTC calendar day.
func TestCustomerCountsAreEnvironmentScopedAndWindowed(t *testing.T) {
	f := newFixture(t, "customers")
	yesterday := f.windows.Yesterday.From.Add(6 * time.Hour)
	today := f.windows.Today.From.Add(3 * time.Hour)

	f.customer(t, "bcu_pov_old", f.now.Add(-7*24*time.Hour), f.environment)
	f.customer(t, "bcu_pov_today", today, f.environment)
	f.customer(t, "bcu_pov_yesterday", yesterday, f.environment)
	// Holds no state in any Environment: created by a trusted identify that has
	// never had a purchase projected.
	f.customer(t, "bcu_pov_no_pointer", today, "")
	// Holds state only in the other Environment.
	f.customer(t, "bcu_pov_other_env", today, f.otherEnv)
	// One second before this day began: the boundary case a >= comparison gets
	// right and a > comparison does not.
	f.customer(t, "bcu_pov_boundary", f.windows.Today.From.Add(-time.Second), f.environment)

	counts, err := projectoverviewpostgres.New(f.pool).CustomerCounts(f.ctx, f.environment, f.windows)
	if err != nil {
		t.Fatalf("customer counts: %v", err)
	}
	if counts.Total != 4 {
		t.Fatalf("total %d, want 4 (the Environment's pointers only)", counts.Total)
	}
	if counts.NewToday != 1 {
		t.Fatalf("newToday %d, want 1", counts.NewToday)
	}
	// The boundary customer belongs to yesterday, not to today.
	if counts.NewYesterday != 2 {
		t.Fatalf("newYesterday %d, want 2", counts.NewYesterday)
	}
}

// Lifecycle populations come from the snapshot each Instance currently points
// at, in this Environment only, and an Instance with no committed snapshot is
// not yet anything.
func TestSubscriptionStateCountsReadCommittedSnapshotsOnly(t *testing.T) {
	f := newFixture(t, "states")
	f.subscription(t, "sub_pov_active", f.environment, "production", "production", "active", "active", true)
	f.subscription(t, "sub_pov_trial", f.environment, "production", "production", "active", "trialing", true)
	f.subscription(t, "sub_pov_grace", f.environment, "production", "production", "active", "grace_period", true)
	f.subscription(t, "sub_pov_retry", f.environment, "production", "production", "active", "billing_retry", true)
	f.subscription(t, "sub_pov_expired", f.environment, "production", "production", "inactive", "expired", true)
	// Projection has not committed for this one.
	f.subscription(t, "sub_pov_pending", f.environment, "production", "production", "active", "active", false)
	// Another Environment entirely.
	f.subscription(t, "sub_pov_staging", f.otherEnv, "staging", "sandbox", "active", "active", true)

	counts, err := projectoverviewpostgres.New(f.pool).SubscriptionStateCounts(f.ctx, f.environment)
	if err != nil {
		t.Fatalf("subscription state counts: %v", err)
	}
	// A trialing subscription that grants access is deliberately counted in both
	// `active` and `trialing`: a trial is an active subscription.
	if counts.Active != 4 {
		t.Fatalf("active %d, want 4", counts.Active)
	}
	if counts.Trialing != 1 || counts.GracePeriod != 1 || counts.BillingRetry != 1 {
		t.Fatalf("trialing %d grace %d retry %d, want 1/1/1",
			counts.Trialing, counts.GracePeriod, counts.BillingRetry)
	}
}

// New subscriptions and trial starts come from validated Facts, are bounded by
// the UTC day, and count provider statements rather than rows.
func TestSubscriptionFactCountsDeduplicateValidatorRestatements(t *testing.T) {
	f := newFixture(t, "facts")
	today := f.windows.Today.From.Add(2 * time.Hour)
	yesterday := f.windows.Yesterday.From.Add(2 * time.Hour)

	f.fact(t, "btf_pov_today_a", "txn-today-a", "auto_renewable_subscription", "initial_purchase", today)
	// The same provider statement, restated under validator 2 (migration 00029).
	// Two immutable rows, one purchase.
	f.fact(t, "btf_pov_today_a_v2", "txn-today-a", "auto_renewable_subscription", "initial_purchase", today)
	f.fact(t, "btf_pov_yest_a", "txn-yest-a", "auto_renewable_subscription", "initial_purchase", yesterday)
	f.fact(t, "btf_pov_yest_b", "txn-yest-b", "auto_renewable_subscription", "initial_purchase", yesterday)

	f.fact(t, "btf_pov_trial_today", "txn-trial-today", "auto_renewable_subscription", "offer_redeemed", today)
	f.fact(t, "btf_pov_trial_yest_a", "txn-trial-yest-a", "auto_renewable_subscription", "offer_redeemed", yesterday)
	f.fact(t, "btf_pov_trial_yest_b", "txn-trial-yest-b", "auto_renewable_subscription", "offer_redeemed", yesterday)

	// Outside both windows.
	f.fact(t, "btf_pov_older", "txn-older", "auto_renewable_subscription", "initial_purchase",
		f.windows.Yesterday.From.Add(-time.Second))
	// A renewal is not a new subscription, and a non-consumable is not one either.
	f.fact(t, "btf_pov_renewal", "txn-renewal", "auto_renewable_subscription", "renewal", today)
	f.fact(t, "btf_pov_lifetime", "txn-lifetime", "non_consumable", "one_time_purchase", today)

	counts, err := projectoverviewpostgres.New(f.pool).SubscriptionFactCounts(f.ctx, f.environment, f.windows)
	if err != nil {
		t.Fatalf("subscription fact counts: %v", err)
	}
	if counts.InitialPurchasesToday != 1 {
		t.Fatalf("initial purchases today %d, want 1 (the restatement is the same purchase)",
			counts.InitialPurchasesToday)
	}
	if counts.InitialPurchasesYesterday != 2 {
		t.Fatalf("initial purchases yesterday %d, want 2", counts.InitialPurchasesYesterday)
	}
	if counts.TrialStartsToday != 1 || counts.TrialStartsYesterday != 2 {
		t.Fatalf("trial starts today %d yesterday %d, want 1/2",
			counts.TrialStartsToday, counts.TrialStartsYesterday)
	}
}

// The composed surface reads yesterday's funnel from the daily aggregate the
// analytics module already maintains, and does not serve today's partial day
// from the bucket the aggregation job has not finished.
//
// This is the one assertion that needs the real analytics service rather than a
// stub. The window arithmetic in the analytics repository decides which storage
// a range is served from, and "today" is exactly the range where getting that
// wrong reads as a silent zero for the busiest hours of the day — or, worse,
// serves a half-built bucket as a complete one.
func TestOverviewReadsYesterdayFromAggregatesAndTodayFromRawEvents(t *testing.T) {
	f := newFixture(t, "funnel")
	f.exec(t, `UPDATE analytics_environment_settings SET collection_enabled=true WHERE environment_id=$1`,
		f.environment)

	yesterdayBucket := f.windows.Yesterday.From
	f.funnelBucket(t, f.environment, yesterdayBucket, "paywall_presentations", 20, nil)
	f.funnelBucket(t, f.environment, yesterdayBucket, "purchase_starts", 8, nil)
	f.funnelBucket(t, f.environment, yesterdayBucket, "client_completed_purchases", 4, nil)
	f.funnelBucket(t, f.environment, yesterdayBucket, "presentation_to_client_completed_purchase_rate", 5, int64(20))
	// A partially aggregated bucket for today. No analytics event rows exist, so
	// the only way today can report a non-zero presentation count is by reading
	// this incomplete bucket — which is what must not happen.
	f.funnelBucket(t, f.environment, f.windows.Today.From, "paywall_presentations", 999, nil)
	// Another Environment's completed day, which must not leak in.
	f.funnelBucket(t, f.otherEnv, yesterdayBucket, "paywall_presentations", 777, nil)

	service := projectoverview.NewService(
		projectoverviewpostgres.New(f.pool),
		analytics.NewService(analyticspostgres.New(f.pool), nil),
	).WithClock(func() time.Time { return f.now })

	result, err := service.Overview(f.ctx, projectoverview.Actor{ID: f.ownerActor}, f.project, f.environment)
	if err != nil {
		t.Fatalf("overview: %v", err)
	}

	requireValue(t, "paywallViews.yesterday", result.Metrics.PaywallViews.Yesterday, 20)
	requireValue(t, "purchaseStarts.yesterday", result.Metrics.PurchaseStarts.Yesterday, 8)
	requireValue(t, "purchases.yesterday", result.Metrics.Purchases.Yesterday, 4)
	requireValue(t, "conversionRate.yesterday", result.Metrics.ConversionRate.Yesterday, 0.25)
	requireValue(t, "paywallViews.today", result.Metrics.PaywallViews.Today, 0)

	// Billing is enabled on this fixture with no billing rows seeded, so the
	// billing metrics must be an honest zero rather than unavailable.
	requireValue(t, "customers.total", result.Metrics.Customers.Total, 0)
	requireValue(t, "subscriptions.active", result.Metrics.Subscriptions.Active, 0)
	if result.AnalyticsFreshness == nil {
		t.Fatal("analytics freshness is absent from a successful read")
	}
}

func requireValue(t *testing.T, name string, metric projectoverview.Metric, want float64) {
	t.Helper()
	if !metric.Available {
		t.Fatalf("%s is unavailable (reason %q); want %v", name, metric.Reason, want)
	}
	if metric.Value == nil || *metric.Value != want {
		t.Fatalf("%s value %v, want %v", name, metric.Value, want)
	}
}

// Authorization is Environment-containment aware: pairing your own Project with
// another Project's Environment must not answer, and neither must a
// non-member.
func TestAuthorizeRequiresMembershipAndEnvironmentContainment(t *testing.T) {
	f := newFixture(t, "authz")
	repository := projectoverviewpostgres.New(f.pool)

	if err := repository.Authorize(f.ctx, projectoverview.Actor{ID: f.ownerActor}, f.project, f.environment); err != nil {
		t.Fatalf("owner authorize: %v", err)
	}
	if err := repository.Authorize(f.ctx, projectoverview.Actor{ID: f.outsideActor}, f.project, f.environment); err != projectoverview.ErrNotFound {
		t.Fatalf("non-member error %v, want ErrNotFound", err)
	}
	if err := repository.Authorize(f.ctx, projectoverview.Actor{ID: f.ownerActor}, f.project, "env_does_not_belong"); err != projectoverview.ErrNotFound {
		t.Fatalf("foreign environment error %v, want ErrNotFound", err)
	}
	if err := repository.Authorize(f.ctx, projectoverview.Actor{ID: ""}, f.project, f.environment); err != projectoverview.ErrUnauthenticated {
		t.Fatalf("anonymous error %v, want ErrUnauthenticated", err)
	}
}
