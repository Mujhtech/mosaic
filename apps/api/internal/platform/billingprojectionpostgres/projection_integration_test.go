package billingprojectionpostgres

import (
	"bytes"
	"context"
	"database/sql"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
	"github.com/Mujhtech/mosaic/apps/api/migrations"
)

func scopeFor(projectID, environmentID, customerID string) billingprojection.Scope {
	return billingprojection.Scope{
		ProjectID: projectID, EnvironmentID: environmentID, CustomerID: customerID,
	}
}

// These tests cover the guarantees that live in the 9B schema rather than in
// Go: the alias uniqueness that stops one identity resolving to two customers,
// the append-only snapshot protection, the pointer's one-per-(customer,
// environment) shape, and the job coalescing that keeps a fact burst from
// becoming a job storm. A unit test with a fake repository would pass while
// every one of them was broken, because the thing under test is the database.

func testPool(t *testing.T) (*pgxpool.Pool, context.Context) {
	t.Helper()
	databaseURL := os.Getenv("DATABASE_TEST_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_TEST_URL is required for PostgreSQL integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
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

// seed builds the minimum tenant a projection needs.
func seed(t *testing.T, ctx context.Context, pool *pgxpool.Pool, suffix string) (projectID, environmentID, customerID string) {
	t.Helper()
	now := time.Now().UTC()
	organizationID := "org_proj_" + suffix
	projectID = "proj_proj_" + suffix
	environmentID = "env_proj_" + suffix
	customerID = "bcu_proj_" + suffix

	cleanup(t, ctx, pool, projectID)
	statements := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO organizations(id,name,created_at,updated_at) VALUES ($1,$2,$3,$3)
		  ON CONFLICT (id) DO NOTHING`, []any{organizationID, "Projection Test", now}},
		{`INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at)
		  VALUES ($1,$2,$3,'Projection','active',$4,$4) ON CONFLICT (id) DO NOTHING`,
			[]any{projectID, organizationID, "projection-" + suffix, now}},
		{`INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at)
		  VALUES ($1,$2,'production','Production','production',$3,$3) ON CONFLICT (id) DO NOTHING`,
			[]any{environmentID, projectID, now}},
		{`INSERT INTO billing_customers(id,project_id,status,diagnostics_status,created_at,updated_at)
		  VALUES ($1,$2,'active','none',$3,$3) ON CONFLICT (id) DO NOTHING`,
			[]any{customerID, projectID, now}},
	}
	for _, statement := range statements {
		if _, err := pool.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	t.Cleanup(func() { cleanup(t, context.Background(), pool, projectID) })
	return projectID, environmentID, customerID
}

func cleanup(t *testing.T, ctx context.Context, pool *pgxpool.Pool, projectID string) {
	t.Helper()
	for _, statement := range []string{
		`ALTER TABLE customer_entitlement_snapshots DISABLE TRIGGER customer_entitlement_snapshots_append_only`,
	} {
		_, _ = pool.Exec(ctx, statement)
	}
	for _, statement := range []string{
		`DELETE FROM projection_jobs WHERE project_id=$1`,
		`DELETE FROM customer_entitlement_pointers WHERE project_id=$1`,
		`DELETE FROM customer_entitlement_snapshots WHERE project_id=$1`,
		`DELETE FROM billing_customer_aliases WHERE project_id=$1`,
		`DELETE FROM billing_customers WHERE project_id=$1`,
	} {
		_, _ = pool.Exec(ctx, statement, projectID)
	}
	_, _ = pool.Exec(ctx,
		`ALTER TABLE customer_entitlement_snapshots ENABLE TRIGGER customer_entitlement_snapshots_append_only`)
}

// One alias value must never resolve to two active customers in one Project.
// Without the partial unique index, a concurrent login could attach the same
// person to two customers and each would hold half their purchases.
func TestAliasHasOneActiveResolution(t *testing.T) {
	pool, ctx := testPool(t)
	projectID, _, customerID := seed(t, ctx, pool, "alias")
	now := time.Now().UTC()

	second := customerID + "_b"
	if _, err := pool.Exec(ctx,
		`INSERT INTO billing_customers(id,project_id,status,diagnostics_status,created_at,updated_at)
		 VALUES ($1,$2,'active','none',$3,$3)`, second, projectID, now); err != nil {
		t.Fatal(err)
	}

	digest := make([]byte, 32)
	insert := func(id, customer string) error {
		_, err := pool.Exec(ctx,
			`INSERT INTO billing_customer_aliases(
				id, project_id, billing_customer_id, alias_type, alias_digest,
				source_authority, verification_status, effective_start, created_at)
			 VALUES ($1,$2,$3,'application_user_id',$4,'trusted_server','verified',$5,$5)`,
			id, projectID, customer, digest, now)
		return err
	}
	if err := insert("bca_first", customerID); err != nil {
		t.Fatalf("first alias rejected: %v", err)
	}
	if err := insert("bca_second", second); err == nil {
		t.Fatal("the same alias resolved to two active customers")
	}

	// End-dating the first must free the digest, so a legitimate reassignment
	// through the accepted workflow still works.
	if _, err := pool.Exec(ctx,
		`UPDATE billing_customer_aliases SET effective_end=$1 WHERE id='bca_first'`, now); err != nil {
		t.Fatal(err)
	}
	if err := insert("bca_third", second); err != nil {
		t.Fatalf("reassignment after end-dating was rejected: %v", err)
	}
}

// Customer entitlement snapshots are immutable. If they were not, a bug or an
// operator could rewrite what a customer's access was without leaving a trace.
func TestCustomerSnapshotsAreAppendOnly(t *testing.T) {
	pool, ctx := testPool(t)
	projectID, environmentID, customerID := seed(t, ctx, pool, "immutable")
	now := time.Now().UTC()

	checksum := make([]byte, 32)
	if _, err := pool.Exec(ctx,
		`INSERT INTO customer_entitlement_snapshots(
			id, project_id, environment_id, billing_customer_id, snapshot_version, rule_version,
			computed_at, as_of, checksum, change_reason, created_at)
		 VALUES ('ces_immutable',$1,$2,$3,1,1,$4,$4,$5,'entitlements_changed',$4)`,
		projectID, environmentID, customerID, now, checksum); err != nil {
		t.Fatal(err)
	}

	if _, err := pool.Exec(ctx,
		`UPDATE customer_entitlement_snapshots SET change_reason='rewritten' WHERE id='ces_immutable'`); err == nil {
		t.Fatal("a committed customer entitlement snapshot was updated")
	}
	if _, err := pool.Exec(ctx,
		`DELETE FROM customer_entitlement_snapshots WHERE id='ces_immutable'`); err == nil {
		t.Fatal("a committed customer entitlement snapshot was deleted")
	}
}

// Migration candidates consume the monotonic snapshot sequence so a future
// live projection cannot collide with them, but current/prior selection remains
// exclusively pointer-addressed. A highest-version candidate must never become
// the live projection's prior snapshot merely because it is newest.
func TestCandidateSnapshotReservesVersionWithoutBecomingCurrentOrPrior(t *testing.T) {
	pool, ctx := testPool(t)
	projectID, environmentID, customerID := seed(t, ctx, pool, "candidate_sequence")
	now := time.Now().UTC()
	liveChecksum := bytes.Repeat([]byte{0x41}, 32)
	candidateChecksum := bytes.Repeat([]byte{0x51}, 32)
	if _, err := pool.Exec(ctx, `INSERT INTO customer_entitlement_snapshots(id,project_id,environment_id,billing_customer_id,snapshot_version,rule_version,computed_at,as_of,checksum,change_reason,created_at) VALUES
		('ces_live',$1,$2,$3,1,1,$4,$4,$5,'entitlements_changed',$4),
		('ces_candidate',$1,$2,$3,5,1,$4,$4,$6,'migration_candidate',$4)`, projectID, environmentID, customerID, now, liveChecksum, candidateChecksum); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO customer_entitlement_pointers(project_id,environment_id,billing_customer_id,current_snapshot_id,snapshot_version,updated_at) VALUES($1,$2,$3,'ces_live',1,$4)`, projectID, environmentID, customerID, now); err != nil {
		t.Fatal(err)
	}
	input, err := New(pool).LoadInput(ctx, scopeFor(projectID, environmentID, customerID))
	if err != nil {
		t.Fatal(err)
	}
	if input.CurrentSnapshotVersion != 5 {
		t.Fatalf("next live allocation did not reserve past candidate: %d", input.CurrentSnapshotVersion)
	}
	if input.PriorCustomerSnapshot == nil || !bytes.Equal(input.PriorCustomerSnapshot.Checksum, liveChecksum) {
		t.Fatal("newest candidate was selected instead of pointer-addressed live prior")
	}
	var current string
	if err = pool.QueryRow(ctx, `SELECT current_snapshot_id FROM customer_entitlement_pointers WHERE billing_customer_id=$1 AND environment_id=$2`, customerID, environmentID).Scan(&current); err != nil || current != "ces_live" {
		t.Fatalf("candidate changed live pointer current=%q err=%v", current, err)
	}
}

// The current pointer is one per (customer, environment) — OD-3(b). A second
// pointer for the same pair would mean two answers to "what does this customer
// have right now", and an SDK would see whichever it read first.
func TestOnePointerPerCustomerPerEnvironment(t *testing.T) {
	pool, ctx := testPool(t)
	projectID, environmentID, customerID := seed(t, ctx, pool, "pointer")
	now := time.Now().UTC()
	checksum := make([]byte, 32)

	for version := 1; version <= 2; version++ {
		if _, err := pool.Exec(ctx,
			`INSERT INTO customer_entitlement_snapshots(
				id, project_id, environment_id, billing_customer_id, snapshot_version, rule_version,
				computed_at, as_of, checksum, change_reason, created_at)
			 VALUES ($1,$2,$3,$4,$5,1,$6,$6,$7,'entitlements_changed',$6)`,
			"ces_pointer_"+string(rune('0'+version)), projectID, environmentID, customerID,
			version, now, checksum); err != nil {
			t.Fatal(err)
		}
	}

	upsert := func(snapshotID string, version int64) error {
		_, err := pool.Exec(ctx,
			`INSERT INTO customer_entitlement_pointers(
				project_id, environment_id, billing_customer_id, current_snapshot_id,
				snapshot_version, updated_at)
			 VALUES ($1,$2,$3,$4,$5,$6)
			 ON CONFLICT (billing_customer_id, environment_id) DO UPDATE SET
				current_snapshot_id=EXCLUDED.current_snapshot_id,
				snapshot_version=EXCLUDED.snapshot_version, updated_at=EXCLUDED.updated_at`,
			projectID, environmentID, customerID, snapshotID, version, now)
		return err
	}
	if err := upsert("ces_pointer_1", 1); err != nil {
		t.Fatal(err)
	}
	if err := upsert("ces_pointer_2", 2); err != nil {
		t.Fatal(err)
	}

	var count int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM customer_entitlement_pointers
		 WHERE billing_customer_id=$1 AND environment_id=$2`, customerID, environmentID).
		Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("got %d pointers for one (customer, environment), want exactly one", count)
	}
}

// A committed projection advances every exact Mosaic-authority Application
// scope and no source-owned scope. The authority epoch is copied from the row
// while it is locked, preventing a projection racing cutover/rollback from
// publishing a pointer under the wrong epoch.
func TestScopedPointersAdvanceOnlyForMosaicAuthority(t *testing.T) {
	pool, ctx := testPool(t)
	projectID, environmentID, customerID := seed(t, ctx, pool, "scoped_pointer")
	now := time.Now().UTC()
	applications := []struct {
		id, platform, authority string
		epoch                   int64
	}{
		{"app_scope_mosaic_ios", "ios", "mosaic", 5},
		{"app_scope_source_android", "android", "source", 4},
		{"app_scope_rollback_ios", "ios", "source_rollback", 6},
	}
	for _, app := range applications {
		if _, err := pool.Exec(ctx, `INSERT INTO applications(id,project_id,name,platform,identifier,created_at,updated_at)
		 VALUES($1,$2,$1,$3,$1,$4,$4)`, app.id, projectID, app.platform, now); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_authority_scopes(
		 id,project_id,environment_id,application_id,platform,current_authority,current_epoch,authority_digest,updated_at)
		 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, "mas_"+app.id, projectID, environmentID,
			app.id, app.platform, app.authority, app.epoch, make([]byte, 32), now); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM billing_migration_scope_current_pointers WHERE project_id=$1`, projectID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM billing_migration_authority_scopes WHERE project_id=$1`, projectID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM applications WHERE project_id=$1`, projectID)
	})

	checksum := make([]byte, 32)
	if _, err := pool.Exec(ctx, `INSERT INTO customer_entitlement_snapshots(
	 id,project_id,environment_id,billing_customer_id,snapshot_version,rule_version,computed_at,as_of,checksum,change_reason,created_at)
	 VALUES('ces_scoped_pointer',$1,$2,$3,1,1,$4,$4,$5,'entitlements_changed',$4)`,
		projectID, environmentID, customerID, now, checksum); err != nil {
		t.Fatal(err)
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := advanceScopedMosaicPointers(ctx, tx, scopeFor(projectID, environmentID, customerID), "ces_scoped_pointer", now); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	rows, err := pool.Query(ctx, `SELECT application_id,authority_epoch FROM billing_migration_scope_current_pointers
	 WHERE project_id=$1 AND billing_customer_id=$2 ORDER BY application_id`, projectID, customerID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var app string
		var epoch int64
		if err := rows.Scan(&app, &epoch); err != nil {
			t.Fatal(err)
		}
		got = append(got, app+":"+strconv.FormatInt(epoch, 10))
	}
	if len(got) != 1 || got[0] != "app_scope_mosaic_ios:5" {
		t.Fatalf("scoped pointers %v, want only Mosaic scope at epoch 5", got)
	}
}

// Projection jobs coalesce onto the scope key. Without the partial unique
// index, a burst of validated facts for one customer would queue one job per
// fact and the same projection would run dozens of times.
func TestProjectionJobsCoalesceOnScopeKey(t *testing.T) {
	pool, ctx := testPool(t)
	projectID, environmentID, customerID := seed(t, ctx, pool, "coalesce")
	repository := New(pool)
	scope := scopeFor(projectID, environmentID, customerID)

	for range 5 {
		if err := repository.Enqueue(ctx, scope, "fact_committed", time.Now().UTC()); err != nil {
			t.Fatalf("enqueue: %v", err)
		}
	}

	var queued int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM projection_jobs
		 WHERE scope_key=$1 AND status IN ('queued','leased')`, scope.Key()).Scan(&queued); err != nil {
		t.Fatal(err)
	}
	if queued != 1 {
		t.Fatalf("five triggers produced %d queued jobs, want one coalesced job", queued)
	}
}
