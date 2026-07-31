package billingcustomerpostgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingcustomer"
	"github.com/Mujhtech/mosaic/apps/api/migrations"
)

// These tests cover only the two guarantees that live in PostgreSQL rather than
// in Go, where a unit test with a fake repository would pass while the real
// behaviour was broken:
//
//   - one identity cannot resolve to two Billing Customers, enforced by the
//     partial unique index rather than by a pre-check the caller can race;
//   - opening an identity conflict freezes the disputed subject in the same
//     transaction, and re-opening converges on the one open conflict.
//
// Everything else in this package — role checks, column mapping, cursor
// encoding — is either already covered by the domain's own tests or is not a
// risk worth a database round trip.

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

type tenant struct {
	projectID     string
	environmentID string
	applicationID string
	firstCustomer string
	otherCustomer string
}

// seedTenant builds the minimum tenant billing identity needs: a Project with
// billing enabled, one production Environment, one Application, and two
// customers so a dispute has two parties.
func seedTenant(t *testing.T, ctx context.Context, pool *pgxpool.Pool, suffix string) tenant {
	t.Helper()
	now := time.Now().UTC()
	scope := tenant{
		projectID:     "proj_ident_" + suffix,
		environmentID: "env_ident_" + suffix,
		applicationID: "app_ident_" + suffix,
		firstCustomer: "bcu_ident_" + suffix + "_a",
		otherCustomer: "bcu_ident_" + suffix + "_b",
	}
	organizationID := "org_ident_" + suffix

	cleanupTenant(ctx, pool, scope.projectID)
	statements := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO organizations(id,name,created_at,updated_at) VALUES ($1,'Identity Test',$2,$2)
		  ON CONFLICT (id) DO NOTHING`, []any{organizationID, now}},
		{`INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at)
		  VALUES ($1,$2,$3,'Identity','active',$4,$4) ON CONFLICT (id) DO NOTHING`,
			[]any{scope.projectID, organizationID, "identity-" + suffix, now}},
		{`INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at)
		  VALUES ($1,$2,'production','Production','production',$3,$3) ON CONFLICT (id) DO NOTHING`,
			[]any{scope.environmentID, scope.projectID, now}},
		{`INSERT INTO applications(id,project_id,name,platform,identifier,created_at,updated_at)
		  VALUES ($1,$2,'Identity App','ios',$3,$4,$4) ON CONFLICT (id) DO NOTHING`,
			[]any{scope.applicationID, scope.projectID, "com.mosaic.identity." + suffix, now}},
		{`INSERT INTO billing_customers(id,project_id,status,diagnostics_status,created_at,updated_at)
		  VALUES ($1,$2,'active','none',$3,$3) ON CONFLICT (id) DO NOTHING`,
			[]any{scope.firstCustomer, scope.projectID, now}},
		{`INSERT INTO billing_customers(id,project_id,status,diagnostics_status,created_at,updated_at)
		  VALUES ($1,$2,'active','none',$3,$3) ON CONFLICT (id) DO NOTHING`,
			[]any{scope.otherCustomer, scope.projectID, now}},
	}
	for _, statement := range statements {
		if _, err := pool.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed identity tenant: %v", err)
		}
	}
	t.Cleanup(func() { cleanupTenant(context.Background(), pool, scope.projectID) })
	return scope
}

func cleanupTenant(ctx context.Context, pool *pgxpool.Pool, projectID string) {
	// Association evidence carries an append-only trigger, so it is disabled for
	// the teardown of test data only. Nothing in the package's own code path
	// touches the trigger.
	_, _ = pool.Exec(ctx,
		`ALTER TABLE billing_association_evidence DISABLE TRIGGER billing_association_evidence_append_only`)
	for _, statement := range []string{
		`DELETE FROM audit_events WHERE project_id=$1`,
		`DELETE FROM billing_identity_conflicts WHERE project_id=$1`,
		`DELETE FROM billing_association_evidence WHERE project_id=$1`,
		`DELETE FROM billing_customer_aliases WHERE project_id=$1`,
		`DELETE FROM purchase_lineages WHERE project_id=$1`,
		`DELETE FROM billing_customers WHERE project_id=$1`,
	} {
		_, _ = pool.Exec(ctx, statement, projectID)
	}
	_, _ = pool.Exec(ctx,
		`ALTER TABLE billing_association_evidence ENABLE TRIGGER billing_association_evidence_append_only`)
}

// One application-user identity must never resolve to two Billing Customers.
// Without the partial unique index behind AttachAlias, a concurrent login would
// attach the same person to two customers and each would hold half their
// purchases — the exact proliferation failure plan §5a exists to prevent. This
// is the guarantee the repository delegates to the database instead of
// pre-checking in Go, so only a real database can prove it holds.
func TestAttachAliasRefusesASecondLiveResolution(t *testing.T) {
	pool, ctx := testPool(t)
	scope := seedTenant(t, ctx, pool, "alias")
	repository := New(pool)
	now := time.Now().UTC()

	digest := billingcustomer.AliasDigest(billingcustomer.AliasApplicationUser, "user-42")
	alias := func(id, customerID string) billingcustomer.Alias {
		return billingcustomer.Alias{
			ID: id, ProjectID: scope.projectID, BillingCustomerID: customerID,
			AliasType:          billingcustomer.AliasApplicationUser,
			SourceAuthority:    billingcustomer.AuthorityTrustedServer,
			VerificationStatus: "verified", EffectiveStart: now, CreatedAt: now,
		}.WithDigest(digest)
	}

	if _, err := repository.AttachAlias(ctx, alias("bca_ident_first", scope.firstCustomer)); err != nil {
		t.Fatalf("first attach rejected: %v", err)
	}
	_, err := repository.AttachAlias(ctx, alias("bca_ident_second", scope.otherCustomer))
	if !errors.Is(err, billingcustomer.ErrConflict) {
		t.Fatalf("second attach returned %v, want ErrConflict", err)
	}

	// The resolver must still see exactly one answer for the digest, keyed the
	// way the pure resolver indexes it (raw digest bytes).
	resolutions, err := repository.ActiveAliasResolutions(ctx, scope.projectID, [][]byte{digest})
	if err != nil {
		t.Fatalf("read active resolutions: %v", err)
	}
	if got := resolutions[string(digest)]; got != scope.firstCustomer {
		t.Fatalf("digest resolves to %q, want %q", got, scope.firstCustomer)
	}
}

// Opening a lineage-scoped conflict must freeze the lineage in the same
// transaction, and re-opening must converge on the one open conflict. A
// conflict that did not freeze would let the next projection grant the purchase
// to whichever candidate it read first (OD-10), and a second conflict row for
// the same lineage would put the same dispute in an operator's queue twice with
// no way to tell which resolution wins.
func TestOpenConflictFreezesLineageAndIsIdempotent(t *testing.T) {
	pool, ctx := testPool(t)
	scope := seedTenant(t, ctx, pool, "conflict")
	repository := New(pool)
	now := time.Now().UTC()

	// The fact-commit transaction is the only writer of purchase lineages, so
	// the row is seeded the way it writes it. This test is about the conflict
	// and the freeze, not about lineage creation.
	lineageID := "bpl_ident_conflict"
	if _, err := pool.Exec(ctx,
		`INSERT INTO purchase_lineages(
			id, project_id, environment_id, environment_mode, application_id, provider,
			store_environment, lineage_key_digest, lineage_type, projection_frozen,
			diagnostic_status, created_at, updated_at)
		 VALUES ($1,$2,$3,'production',$4,'app_store','production',$5,'subscription',false,
			'identity_unresolved',$6,$6)
		 ON CONFLICT (environment_id, provider, lineage_key_digest) DO NOTHING`,
		lineageID, scope.projectID, scope.environmentID, scope.applicationID,
		sha256Of("chain-ident-conflict"), now); err != nil {
		t.Fatalf("seed purchase lineage: %v", err)
	}
	lineage, err := repository.Lineage(ctx, scope.projectID, lineageID)
	if err != nil {
		t.Fatalf("read seeded lineage: %v", err)
	}

	conflict := billingcustomer.Conflict{
		ID: "bic_ident_first", ProjectID: scope.projectID,
		Scope: billingcustomer.ConflictScopeLineage, PurchaseLineageID: lineage.ID,
		Status: "open", FirstCustomerID: scope.firstCustomer, SecondCustomerID: scope.otherCustomer,
		DiagnosticCode: billingcustomer.DiagnosticMultipleClaims, OpenedAt: now,
	}
	opened, err := repository.OpenConflict(ctx, conflict)
	if err != nil {
		t.Fatalf("open conflict: %v", err)
	}
	if opened.DiagnosticCode != billingcustomer.DiagnosticMultipleClaims {
		t.Fatalf("diagnostic code %q was not mapped out of detail", opened.DiagnosticCode)
	}

	frozen, err := repository.Lineage(ctx, scope.projectID, lineage.ID)
	if err != nil {
		t.Fatalf("re-read lineage: %v", err)
	}
	if !frozen.ProjectionFrozen || frozen.DiagnosticStatus != "identity_conflict" {
		t.Fatalf("opening a conflict left the lineage frozen=%v diagnostic=%q",
			frozen.ProjectionFrozen, frozen.DiagnosticStatus)
	}

	// Re-opening with a fresh identifier must return the existing conflict.
	second := conflict
	second.ID = "bic_ident_second"
	reopened, err := repository.OpenConflict(ctx, second)
	if err != nil {
		t.Fatalf("re-open conflict: %v", err)
	}
	if reopened.ID != opened.ID {
		t.Fatalf("re-opening produced conflict %q, want the existing %q", reopened.ID, opened.ID)
	}
	var open int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM billing_identity_conflicts
		 WHERE purchase_lineage_id=$1 AND status='open'`, lineage.ID).Scan(&open); err != nil {
		t.Fatal(err)
	}
	if open != 1 {
		t.Fatalf("two OpenConflict calls left %d open conflicts, want one", open)
	}
}

// sha256Of produces a 32-byte lineage key digest for seeded rows.
func sha256Of(value string) []byte {
	sum := sha256.Sum256([]byte(value))
	return sum[:]
}
