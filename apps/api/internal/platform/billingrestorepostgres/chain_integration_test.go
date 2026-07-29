package billingrestorepostgres

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

	"github.com/Mujhtech/mosaic/apps/api/internal/billingrestore"
	"github.com/Mujhtech/mosaic/apps/api/migrations"
)

// This file covers exactly one thing: that LoadChain's stage-3 read resolves a
// validated fact to the Purchase Lineage that owns it, against the real schema.
//
// It exists because that read referenced `billing_transaction_facts.
// purchase_lineage_id`, a column no migration creates. Every restore that got
// as far as stage 3 failed with SQLSTATE 42703, was rescheduled, burned its
// twelve attempts, and reported `validation_pending` forever (defect D-2). No
// unit test could have caught it: the query is a string until PostgreSQL parses
// it, and the fake repository in the domain's own tests never runs any SQL.
//
// The seeding below is deliberately the minimum the foreign keys demand, and
// nothing else in this package gets a database round trip.

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

// TestLoadChainResolvesTheCustomerThroughTheLineageDigest is the regression for
// defect D-2.
//
// A restore whose linked input produced a validated fact must report the
// Billing Customer that owns the fact's lineage. The join is by provider chain
// digest — the only fact-to-lineage relationship the schema has — scoped by
// Environment and provider, because Apple's chain digest is unique only per
// (store environment, original transaction id).
func TestLoadChainResolvesTheCustomerThroughTheLineageDigest(t *testing.T) {
	pool, ctx := testPool(t)
	scope := seedRestoreTenant(t, ctx, pool, "d2")
	repository := New(pool)

	chain, err := repository.LoadChain(ctx, billingrestore.Job{
		ID: scope.restoreID, ProjectID: scope.projectID, EnvironmentID: scope.environmentID,
	})
	if err != nil {
		t.Fatalf("load restore chain: %v", err)
	}
	if chain.LinkedInputCount != 1 {
		t.Fatalf("linked inputs = %d, want 1", chain.LinkedInputCount)
	}
	if chain.FactCount != 1 {
		t.Fatalf("facts = %d, want 1", chain.FactCount)
	}
	if chain.CustomerID != scope.customerID {
		t.Fatalf("customer = %q, want %q — the fact never resolved to its lineage",
			chain.CustomerID, scope.customerID)
	}
	if chain.IdentityConflict {
		t.Fatal("a single unfrozen lineage was reported as an identity conflict")
	}
}

type restoreTenant struct {
	projectID     string
	environmentID string
	applicationID string
	customerID    string
	restoreID     string
}

func seedRestoreTenant(t *testing.T, ctx context.Context, pool *pgxpool.Pool, suffix string) restoreTenant {
	t.Helper()
	now := time.Now().UTC()
	scope := restoreTenant{
		projectID:     "proj_rst_" + suffix,
		environmentID: "env_rst_" + suffix,
		applicationID: "app_rst_" + suffix,
		customerID:    "bcu_rst_" + suffix,
		restoreID:     "rst_rst_" + suffix,
	}
	organizationID := "org_rst_" + suffix
	rawInputID := "bri_rst_" + suffix
	attemptID := "bva_rst_" + suffix
	lineageID := "bpl_rst_" + suffix
	factID := "btf_rst_" + suffix

	digest := sha256.Sum256([]byte("chain-" + suffix))
	reference := sha256.Sum256([]byte("reference-" + suffix))
	idempotency := sha256.Sum256([]byte("idempotency-" + suffix))
	content := sha256.Sum256([]byte("content-" + suffix))
	factDigest := sha256.Sum256([]byte("fact-" + suffix))

	cleanupRestoreTenant(ctx, pool, scope.projectID)
	statements := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO organizations(id,name,created_at,updated_at) VALUES ($1,'Restore Test',$2,$2)
		  ON CONFLICT (id) DO NOTHING`, []any{organizationID, now}},
		{`INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at)
		  VALUES ($1,$2,$3,'Restore','active',$4,$4) ON CONFLICT (id) DO NOTHING`,
			[]any{scope.projectID, organizationID, "restore-" + suffix, now}},
		{`INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at)
		  VALUES ($1,$2,'production','Production','production',$3,$3) ON CONFLICT (id) DO NOTHING`,
			[]any{scope.environmentID, scope.projectID, now}},
		{`INSERT INTO applications(id,project_id,name,platform,identifier,created_at,updated_at)
		  VALUES ($1,$2,'Restore App','ios',$3,$4,$4) ON CONFLICT (id) DO NOTHING`,
			[]any{scope.applicationID, scope.projectID, "com.mosaic.restore." + suffix, now}},
		{`INSERT INTO billing_customers(id,project_id,status,diagnostics_status,created_at,updated_at)
		  VALUES ($1,$2,'active','none',$3,$3) ON CONFLICT (id) DO NOTHING`,
			[]any{scope.customerID, scope.projectID, now}},
		{`INSERT INTO purchase_lineages(id,project_id,environment_id,environment_mode,application_id,
			provider,store_environment,lineage_key_digest,lineage_type,billing_customer_id,
			projection_frozen,diagnostic_status,created_at,updated_at)
		  VALUES ($1,$2,$3,'production',$4,'app_store','production',$5,'subscription',$6,false,'none',$7,$7)`,
			[]any{lineageID, scope.projectID, scope.environmentID, scope.applicationID,
				digest[:], scope.customerID, now}},
		{`INSERT INTO billing_raw_inputs(id,project_id,organization_id,environment_id,environment_mode,
			application_id,provider,source,source_authority,idempotency_key,content_digest,
			transaction_reference_digest,body_state,authentication_result,store_environment,
			ingestion_status,correlation_id,received_at,expires_at)
		  VALUES ($1,$2,$3,$4,'production',$5,'app_store','client_observation','client_observation',
			$6,$7,$8,'not_retained','unauthenticated_client','production','accepted','corr-` + suffix + `',
			$9,$9::timestamptz + interval '30 days')`,
			[]any{rawInputID, scope.projectID, organizationID, scope.environmentID, scope.applicationID,
				idempotency[:], content[:], reference[:], now}},
		{`INSERT INTO billing_validation_attempts(id,project_id,environment_id,raw_input_id,attempt_number,
			validator_version,started_at,completed_at,outcome,retryable,store_environment,latency_ms,
			correlation_id)
		  VALUES ($1,$2,$3,$4,1,2,$5,$5,'validated',false,'production',1,'corr-` + suffix + `')`,
			[]any{attemptID, scope.projectID, scope.environmentID, rawInputID, now}},
		{`INSERT INTO billing_transaction_facts(id,project_id,environment_id,environment_mode,application_id,
			provider,store_environment,provider_transaction_id,purchase_chain_digest,transaction_type,
			fact_kind,occurred_at,provider_product_identifier,resolution_state,validator_version,
			fact_version,source_raw_input_id,validation_attempt_id,fact_digest,recorded_at)
		  VALUES ($1,$2,$3,'production',$4,'app_store','production','3000000000000001',$5,
			'auto_renewable_subscription','initial_purchase',$6,'com.mosaic.pro.monthly','unresolved',
			2,1,$7,$8,$9,$6)`,
			[]any{factID, scope.projectID, scope.environmentID, scope.applicationID, digest[:], now,
				rawInputID, attemptID, factDigest[:]}},
		{`INSERT INTO restore_sync_jobs(id,project_id,environment_id,store_platform,status,provider_outcome,
			uncertainty_reason,observed_transaction_count,pending_validation_count,correlation_id,
			attempt_count,max_attempts,available_at,requested_at,updated_at)
		  VALUES ($1,$2,$3,'apple_app_store','queued','completed','none',1,0,'corr-` + suffix + `',0,12,$4,$4,$4)`,
			[]any{scope.restoreID, scope.projectID, scope.environmentID, now}},
		{`INSERT INTO restore_sync_job_inputs(restore_sync_job_id,project_id,raw_input_id,
			transaction_reference_digest,created_at)
		  VALUES ($1,$2,$3,$4,$5)`,
			[]any{scope.restoreID, scope.projectID, rawInputID, reference[:], now}},
	}
	for _, statement := range statements {
		if _, err := pool.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed restore tenant: %v", err)
		}
	}
	t.Cleanup(func() { cleanupRestoreTenant(context.Background(), pool, scope.projectID) })
	return scope
}

// appendOnlyTables carry triggers that refuse UPDATE and DELETE. They are
// disabled for the teardown of this test's own rows only; nothing in the
// package's code path touches them.
var appendOnlyTables = []string{
	"restore_sync_job_inputs",
	"billing_transaction_facts",
	"billing_validation_attempts",
	"billing_raw_inputs",
}

func cleanupRestoreTenant(ctx context.Context, pool *pgxpool.Pool, projectID string) {
	for _, table := range appendOnlyTables {
		_, _ = pool.Exec(ctx, `ALTER TABLE `+table+` DISABLE TRIGGER USER`)
	}
	for _, statement := range []string{
		`DELETE FROM restore_sync_job_inputs WHERE project_id=$1`,
		`DELETE FROM restore_sync_jobs WHERE project_id=$1`,
		`DELETE FROM billing_transaction_facts WHERE project_id=$1`,
		`DELETE FROM billing_validation_attempts WHERE project_id=$1`,
		`DELETE FROM billing_raw_inputs WHERE project_id=$1`,
		`DELETE FROM purchase_lineages WHERE project_id=$1`,
		`DELETE FROM billing_customers WHERE project_id=$1`,
	} {
		_, _ = pool.Exec(ctx, statement, projectID)
	}
	for _, table := range appendOnlyTables {
		_, _ = pool.Exec(ctx, `ALTER TABLE `+table+` ENABLE TRIGGER USER`)
	}
}
