package billinggrantpostgres

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/Mujhtech/mosaic/apps/api/internal/billinggrant"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/pgtest"
)

func testPool(t *testing.T) (*pgxpool.Pool, context.Context) {
	t.Helper()
	databaseURL := os.Getenv("DATABASE_TEST_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_TEST_URL is required for PostgreSQL integration tests")
	}

	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	if err := pgtest.Migrate(db, 0); err != nil {
		t.Fatal(err)
	}
	// The assertion clock starts after the schema is up: a deadline
	// created before migration is spent by migration.
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	t.Cleanup(cancel)
	_ = db.Close()

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool, ctx
}

type catalog struct {
	projectID     string
	productID     string
	entitlementID string
	actorID       string
}

func seedCatalog(t *testing.T, ctx context.Context, pool *pgxpool.Pool, suffix string) catalog {
	t.Helper()
	now := time.Now().UTC()
	c := catalog{
		projectID:     "proj_grant_" + suffix,
		productID:     "prod_grant_" + suffix,
		entitlementID: "ent_grant_" + suffix,
		actorID:       "actor_grant_" + suffix,
	}
	organizationID := "org_grant_" + suffix
	cleanupCatalog(ctx, pool, c, organizationID)

	statements := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO organizations(id,name,created_at,updated_at) VALUES ($1,'Grant Test',$2,$2)
		  ON CONFLICT (id) DO NOTHING`, []any{organizationID, now}},
		{`INSERT INTO organization_members(organization_id,actor_id,role,created_at,updated_at)
		  VALUES ($1,$2,'owner',$3,$3) ON CONFLICT (organization_id,actor_id) DO UPDATE SET role='owner'`,
			[]any{organizationID, c.actorID, now}},
		{`INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at)
		  VALUES ($1,$2,$3,'Grant','active',$4,$4) ON CONFLICT (id) DO NOTHING`,
			[]any{c.projectID, organizationID, "grant-" + suffix, now}},
		{`INSERT INTO billing_project_settings(project_id,billing_enabled,updated_by_actor_id,created_at,updated_at)
		  VALUES ($1,true,'seed',$2,$2) ON CONFLICT (project_id) DO UPDATE SET billing_enabled=true`,
			[]any{c.projectID, now}},
		{`INSERT INTO products(id,project_id,key,internal_name,type,status,metadata_source,
			readiness_ready,created_at,updated_at)
		  VALUES ($1,$2,$3,'Pro','subscription','connected','mock',true,$4,$4)`,
			[]any{c.productID, c.projectID, "pro-" + suffix, now}},
		{`INSERT INTO entitlements(id,project_id,key,name,created_at,updated_at)
		  VALUES ($1,$2,$3,'Pro Access',$4,$4)`,
			[]any{c.entitlementID, c.projectID, "pro-access-" + suffix, now}},
	}
	for _, statement := range statements {
		if _, err := pool.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed catalog: %v", err)
		}
	}
	t.Cleanup(func() {
		cleanupContext, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		cleanupCatalog(cleanupContext, pool, c, organizationID)
	})
	return c
}

func cleanupCatalog(ctx context.Context, pool *pgxpool.Pool, c catalog, organizationID string) {
	// Grant versions are append-only apart from their closing instant, so the
	// fixture is torn down with the trigger disabled rather than by weakening
	// the schema the tests are here to verify.
	_, _ = pool.Exec(ctx,
		`ALTER TABLE product_entitlement_grant_versions DISABLE TRIGGER product_entitlement_grant_versions_append_only`)
	_, _ = pool.Exec(ctx,
		`ALTER TABLE product_entitlement_grants DISABLE TRIGGER product_entitlement_grants_versioned_delete`)
	for _, statement := range []string{
		`DELETE FROM projection_jobs WHERE project_id=$1`,
		`DELETE FROM product_entitlement_grant_versions WHERE project_id=$1`,
		`DELETE FROM product_entitlement_grants WHERE project_id=$1`,
		`DELETE FROM entitlements WHERE project_id=$1`,
		`DELETE FROM products WHERE project_id=$1`,
		`DELETE FROM audit_events WHERE project_id=$1`,
		`DELETE FROM billing_project_settings WHERE project_id=$1`,
		`DELETE FROM projects WHERE id=$1`,
	} {
		_, _ = pool.Exec(ctx, statement, c.projectID)
	}
	_, _ = pool.Exec(ctx, `DELETE FROM organization_members WHERE organization_id=$1`, organizationID)
	_, _ = pool.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, organizationID)
	_, _ = pool.Exec(ctx,
		`ALTER TABLE product_entitlement_grants ENABLE TRIGGER product_entitlement_grants_versioned_delete`)
	_, _ = pool.Exec(ctx,
		`ALTER TABLE product_entitlement_grant_versions ENABLE TRIGGER product_entitlement_grant_versions_append_only`)
}

func fullAccess() billingprojection.Policy {
	return billingprojection.Policy{
		GrantsInActive: true, GrantsInTrial: true, GrantsInGrace: true, GrantsInOneTime: true,
	}
}

// Publishing a grant version supersedes the previous one and writes the audit
// trail in one transaction.
//
// The property that matters is that the two intervals abut exactly: the closed
// version ends at the instant the new one begins. A gap would strand every
// purchase made inside it with no applicable grant — the projection engine would
// report `unknown` for customers who bought during it — and an overlap would
// make which version applies a function of row order.
//
// This is an integration test because the close is an UPDATE the append-only
// trigger scrutinises, the insert is guarded by the one-open-version partial
// unique index, and the atomicity is the transaction. None of the three exists
// in Go.
func TestPublishSupersedesThePreviousVersionAtomically(t *testing.T) {
	pool, ctx := testPool(t)
	repository := New(pool)
	c := seedCatalog(t, ctx, pool, "publish")
	actor := billinggrant.Actor{ID: c.actorID}
	service := billinggrant.NewService(repository)

	firstStart := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	first, err := service.Publish(ctx, actor, c.projectID, billinggrant.PublishInput{
		ProductID: c.productID, EntitlementID: c.entitlementID,
		EffectiveStart: firstStart, Policy: fullAccess(), Reason: "initial grant",
	})
	if err != nil {
		t.Fatalf("first publish: %v", err)
	}
	if first.Version != 1 || !first.Current() {
		t.Fatalf("first published version is %d (current=%t), want 1 and current", first.Version, first.Current())
	}

	secondStart := firstStart.Add(24 * time.Hour)
	narrowed := fullAccess()
	narrowed.GrantsInGrace = false
	second, err := service.Publish(ctx, actor, c.projectID, billinggrant.PublishInput{
		ProductID: c.productID, EntitlementID: c.entitlementID,
		EffectiveStart: secondStart, Policy: narrowed, Reason: "stop granting during grace",
	})
	if err != nil {
		t.Fatalf("second publish: %v", err)
	}
	if second.Version != 2 || !second.Current() {
		t.Fatalf("second published version is %d (current=%t), want 2 and current", second.Version, second.Current())
	}

	versions, err := repository.ListVersions(ctx, c.projectID, billinggrant.ListFilter{
		ProductID: c.productID, EntitlementID: c.entitlementID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(versions) != 2 {
		t.Fatalf("%d recorded versions, want 2", len(versions))
	}
	closed := versions[1]
	if closed.Version != 1 {
		closed = versions[0]
	}
	if closed.EffectiveEnd == nil {
		t.Fatal("version 1 was not closed; the pair now has two open versions")
	}
	if !closed.EffectiveEnd.Equal(secondStart) {
		t.Fatalf("version 1 closed at %s, want the successor's start %s — the two intervals must abut",
			closed.EffectiveEnd, secondStart)
	}

	// The engine that derives access must agree that exactly one version applies
	// at every instant, which is the property the abutment exists to produce.
	engineVersions := []billingprojection.GrantVersion{
		{ID: closed.ID, ProductID: c.productID, EntitlementID: c.entitlementID, Version: 1,
			EffectiveStart: closed.EffectiveStart, EffectiveEnd: closed.EffectiveEnd,
			SupportedPurchaseTypes: closed.SupportedPurchaseTypes, Policy: closed.Policy},
		{ID: second.ID, ProductID: c.productID, EntitlementID: c.entitlementID, Version: 2,
			EffectiveStart: second.EffectiveStart, SupportedPurchaseTypes: second.SupportedPurchaseTypes,
			Policy: second.Policy},
	}
	for _, probe := range []struct {
		at   time.Time
		want int
	}{
		{firstStart.Add(time.Minute), 1},
		{secondStart.Add(-time.Nanosecond), 1},
		{secondStart, 2},
		{secondStart.Add(time.Hour), 2},
	} {
		selected := billingprojection.SelectGrantVersions(engineVersions, c.productID, probe.at,
			billinggrant.PurchaseTypeAutoRenewable)
		if len(selected) != 1 {
			t.Fatalf("%d versions apply at %s, want exactly 1", len(selected), probe.at)
		}
		if selected[0].Version != probe.want {
			t.Fatalf("version %d applies at %s, want %d", selected[0].Version, probe.at, probe.want)
		}
	}

	var auditRows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM audit_events
		 WHERE project_id=$1 AND action='product.entitlement_grant_version_published'`,
		c.projectID).Scan(&auditRows); err != nil {
		t.Fatal(err)
	}
	if auditRows != 2 {
		t.Fatalf("%d audit entries for two publishes, want 2", auditRows)
	}
}

// A published grant version is immutable apart from the instant it closes.
//
// This is the guarantee that makes historical access reproducible: the grant
// version a purchase selected is chosen by the purchase's own effective time, so
// rewriting a version's policy or moving its boundary changes what a customer
// was entitled to at a moment that has already passed. Nothing in Go can enforce
// it — a direct UPDATE from a migration, a psql session, or a future repository
// method bypasses every application check — so it is enforced by the database
// and verified here.
func TestPublishedGrantVersionIsImmutableApartFromClosing(t *testing.T) {
	pool, ctx := testPool(t)
	repository := New(pool)
	c := seedCatalog(t, ctx, pool, "immutable")
	actor := billinggrant.Actor{ID: c.actorID}
	service := billinggrant.NewService(repository)

	start := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	published, err := service.Publish(ctx, actor, c.projectID, billinggrant.PublishInput{
		ProductID: c.productID, EntitlementID: c.entitlementID,
		EffectiveStart: start, Policy: fullAccess(), Reason: "initial grant",
	})
	if err != nil {
		t.Fatal(err)
	}

	for _, attempt := range []struct {
		name  string
		query string
		args  []any
	}{
		{"rewriting the access policy",
			`UPDATE product_entitlement_grant_versions SET grants_in_grace = false WHERE id = $1`,
			[]any{published.ID}},
		{"moving the effective start",
			`UPDATE product_entitlement_grant_versions SET effective_start = $2 WHERE id = $1`,
			[]any{published.ID, start.Add(-48 * time.Hour)}},
		{"rewriting the reason",
			`UPDATE product_entitlement_grant_versions SET reason = 'something else' WHERE id = $1`,
			[]any{published.ID}},
		{"deleting the version",
			`DELETE FROM product_entitlement_grant_versions WHERE id = $1`,
			[]any{published.ID}},
	} {
		if _, err := pool.Exec(ctx, attempt.query, attempt.args...); err == nil {
			t.Fatalf("%s was permitted; a published grant version must be immutable", attempt.name)
		}
	}

	// Closing is the one permitted change, and only once.
	closeAt := start.Add(24 * time.Hour)
	if _, err := pool.Exec(ctx,
		`UPDATE product_entitlement_grant_versions SET effective_end = $2 WHERE id = $1`,
		published.ID, closeAt); err != nil {
		t.Fatalf("closing an open version was refused: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE product_entitlement_grant_versions SET effective_end = $2 WHERE id = $1`,
		published.ID, closeAt.Add(time.Hour)); err == nil {
		t.Fatal("re-closing a closed version was permitted; the boundary between two versions " +
			"would move and every purchase between the old and new instant would change grant")
	}
	if _, err := pool.Exec(ctx,
		`UPDATE product_entitlement_grant_versions SET effective_end = NULL WHERE id = $1`,
		published.ID); err == nil {
		t.Fatal("reopening a closed version was permitted")
	}

	// The application answers the same refusal as a clean domain error rather
	// than a constraint failure.
	_, err = service.Publish(ctx, actor, c.projectID, billinggrant.PublishInput{
		ProductID: c.productID, EntitlementID: c.entitlementID,
		EffectiveStart: start.Add(time.Hour), Retroactive: true, Policy: fullAccess(),
		Reason: "inside the closed interval",
	})
	if !errors.Is(err, billinggrant.ErrOverlap) {
		t.Fatalf("publishing inside a closed interval returned %v, want ErrOverlap", err)
	}
}
