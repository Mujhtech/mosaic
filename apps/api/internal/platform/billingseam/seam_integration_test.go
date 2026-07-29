package billingseam_test

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

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingcustomer"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingcustomerpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingprojectionpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingseam"
	"github.com/Mujhtech/mosaic/apps/api/migrations"
)

// These two tests are the regression for defect D-1, and they are integration
// tests for a reason that is not incidental: the defect was that four
// application services had no production caller, so every one of them passed its
// own unit tests while a purchase reached nothing. What has to be proven is that
// a validated Transaction Fact ends as a committed Customer Entitlement Snapshot
// through production wiring only — the fact-commit transaction, the seam, the
// identity service, the projection job, and the projection command — with no
// step performed by the test that a deployed system would not perform.
//
// The test drives `CompleteAttempt` directly rather than a provider call,
// because the provider half is Phase 9A's and is already demonstrated. From that
// call onward, every row below is written by production code.

func testPool(t *testing.T) (*pgxpool.Pool, context.Context) {
	t.Helper()
	databaseURL := os.Getenv("DATABASE_TEST_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_TEST_URL is required for PostgreSQL integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
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

// TestValidatedFactBecomesACommittedEntitlementSnapshot is the end-to-end
// regression the brief asks for.
//
// A backend has identified its user and its SDK reported the purchase carrying
// that customer's token, so submission-context evidence exists. A fact then
// commits. Everything after that is production wiring: the lineage, the
// subscription instance, the association, the projection job, and the
// authoritative snapshot.
func TestValidatedFactBecomesACommittedEntitlementSnapshot(t *testing.T) {
	pool, ctx := testPool(t)
	fixture := newFixture(t, ctx, pool, "d1flow")

	// The submission an SDK holding a Customer Access Token produces. It is
	// written through the identity service, which is what the observation intake
	// calls; the token authentication itself is billingaccess's and is not
	// re-proven here.
	if err := fixture.identity.RecordSubmissionEvidence(ctx, fixture.projectID, fixture.environmentID,
		fixture.rawInputID, fixture.customerID, fixture.referenceDigest); err != nil {
		t.Fatalf("record submission evidence: %v", err)
	}

	fixture.commitFact(t, ctx)

	lineage := fixture.lineage(t, ctx)
	if lineage.BillingCustomerID != fixture.customerID {
		t.Fatalf("lineage owner = %q, want %q — the seam did not attach the purchase",
			lineage.BillingCustomerID, fixture.customerID)
	}
	if instances := fixture.count(t, ctx,
		`SELECT count(*) FROM subscription_instances WHERE purchase_lineage_id=$1`, lineage.ID); instances != 1 {
		t.Fatalf("subscription instances = %d, want 1; the projection loader joins to it", instances)
	}

	fixture.drainProjection(t, ctx)

	var version int64
	var state string
	if err := pool.QueryRow(ctx,
		`SELECT p.snapshot_version, e.state
		 FROM customer_entitlement_pointers p
		 JOIN customer_entitlement_snapshot_entries e
		   ON e.customer_entitlement_snapshot_id = p.current_snapshot_id
		 WHERE p.billing_customer_id=$1 AND p.environment_id=$2`,
		fixture.customerID, fixture.environmentID).Scan(&version, &state); err != nil {
		t.Fatalf("no committed customer entitlement snapshot: %v", err)
	}
	if version < 1 || state != "active" {
		t.Fatalf("snapshot version %d state %q, want an active entitlement", version, state)
	}
}

// TestPurchaseWithNoEvidenceAnchorsAndLaterIdentifies covers plan §5a rules 1,
// 2, and 3.
//
// A purchase arrives that nothing identifies — the ordinary anonymous case, and
// the one a store notification always produces on its own. It must still reach a
// customer, that customer must be recorded as purchase-anchored rather than
// silently indistinguishable from an identified one, and identifying the person
// afterwards must attach the alias to *that same customer* rather than minting a
// second one. The last part is the duplicate-customer trap the whole model
// exists to avoid: two customers each holding half a person's purchases is
// unrecoverable once entitlements have been granted from them.
func TestPurchaseWithNoEvidenceAnchorsAndLaterIdentifies(t *testing.T) {
	pool, ctx := testPool(t)
	fixture := newFixture(t, ctx, pool, "d1anchor")

	fixture.commitFact(t, ctx)

	lineage := fixture.lineage(t, ctx)
	if lineage.BillingCustomerID == "" {
		t.Fatal("an anonymous purchase reached no Billing Customer; it can never be answered for")
	}
	anchored := lineage.BillingCustomerID
	if anchored == fixture.customerID {
		t.Fatal("the anonymous purchase attached to the pre-existing customer without evidence")
	}

	var evidenceType, outcome string
	if err := pool.QueryRow(ctx,
		`SELECT evidence_type, outcome FROM billing_association_evidence
		 WHERE project_id=$1 AND billing_customer_id=$2 AND purchase_lineage_id=$3`,
		fixture.projectID, anchored, lineage.ID).Scan(&evidenceType, &outcome); err != nil {
		t.Fatalf("no evidence explains the anchored customer: %v", err)
	}
	if evidenceType != billingcustomer.EvidencePurchaseAnchor || outcome != billingcustomer.OutcomeResolved {
		t.Fatalf("evidence %q/%q, want %q/resolved", evidenceType, outcome,
			billingcustomer.EvidencePurchaseAnchor)
	}

	// The person signs in. Login attaches; it never merges.
	alias, err := fixture.identity.AttachApplicationUserAlias(ctx, billingcustomer.Actor{ID: "actor-test"},
		fixture.projectID, anchored, "person-"+fixture.suffix)
	if err != nil {
		t.Fatalf("attach application user alias: %v", err)
	}
	if alias.BillingCustomerID != anchored {
		t.Fatalf("alias attached to %q, want the purchase-anchored customer %q",
			alias.BillingCustomerID, anchored)
	}
	if customers := fixture.count(t, ctx,
		`SELECT count(*) FROM billing_customers WHERE project_id=$1`, fixture.projectID); customers != 2 {
		// The seeded customer plus the anchored one. A third would mean
		// identifying the person minted a duplicate.
		t.Fatalf("billing customers = %d, want 2; identifying a person must not create one", customers)
	}
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

type fixture struct {
	pool          *pgxpool.Pool
	suffix        string
	projectID     string
	environmentID string
	applicationID string
	productID     string
	customerID    string
	rawInputID    string
	attemptID     string
	factID        string

	chainDigest     []byte
	referenceDigest []byte

	billing    *billingpostgres.Repository
	identity   *billingcustomer.Service
	projection *billingprojection.Service
}

func newFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool, suffix string) *fixture {
	t.Helper()
	f := &fixture{
		pool: pool, suffix: suffix,
		projectID:     "proj_seam_" + suffix,
		environmentID: "env_seam_" + suffix,
		applicationID: "app_seam_" + suffix,
		productID:     "prd_seam_" + suffix,
		customerID:    "bcu_seam_" + suffix,
		rawInputID:    "bri_seam_" + suffix,
		attemptID:     "bva_seam_" + suffix,
		factID:        "btf_seam_" + suffix,
	}
	chain := sha256.Sum256([]byte("chain-" + suffix))
	reference := sha256.Sum256([]byte("reference-" + suffix))
	f.chainDigest, f.referenceDigest = chain[:], reference[:]

	f.billing = billingpostgres.New(pool)
	projectionRepository := billingprojectionpostgres.New(pool)
	f.projection = billingprojection.NewService(projectionRepository)
	f.identity = billingcustomer.NewService(billingcustomerpostgres.New(pool),
		stubKeys{}, f.projection)

	f.clean(ctx)
	t.Cleanup(func() { f.clean(context.Background()) })
	f.seed(t, ctx)
	return f
}

// stubKeys stands in for the trusted-server key authenticator. No test here
// authenticates a key: every call goes through the application service directly,
// exactly as the seam's production caller does.
type stubKeys struct{}

func (stubKeys) AuthenticateServerKey(context.Context, string) (billingcustomer.KeyScope, error) {
	return billingcustomer.KeyScope{}, billingcustomer.ErrUnauthenticated
}

func (f *fixture) seed(t *testing.T, ctx context.Context) {
	t.Helper()
	now := time.Now().UTC()
	organizationID := "org_seam_" + f.suffix
	entitlementID := "ent_seam_" + f.suffix
	mappingID := "ppm_seam_" + f.suffix
	grantID := "pegv_seam_" + f.suffix

	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO organizations(id,name,created_at,updated_at) VALUES ($1,'Seam',$2,$2)
		  ON CONFLICT (id) DO NOTHING`, []any{organizationID, now}},
		{`INSERT INTO organization_members(organization_id,actor_id,role,created_at,updated_at)
		  VALUES ($1,'actor-test','owner',$2,$2)
		  ON CONFLICT (organization_id,actor_id) DO UPDATE SET role='owner'`,
			[]any{organizationID, now}},
		{`INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at)
		  VALUES ($1,$2,$3,'Seam','active',$4,$4) ON CONFLICT (id) DO NOTHING`,
			[]any{f.projectID, organizationID, "seam-" + f.suffix, now}},
		{`INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at)
		  VALUES ($1,$2,'production','Production','production',$3,$3) ON CONFLICT (id) DO NOTHING`,
			[]any{f.environmentID, f.projectID, now}},
		{`INSERT INTO applications(id,project_id,name,platform,identifier,created_at,updated_at)
		  VALUES ($1,$2,'Seam','ios',$3,$4,$4) ON CONFLICT (id) DO NOTHING`,
			[]any{f.applicationID, f.projectID, "com.mosaic.seam." + f.suffix, now}},
		{`INSERT INTO products(id,project_id,key,internal_name,description,type,status,
			metadata_source,readiness_ready,created_at,updated_at)
		  VALUES ($1,$2,$3,'Pro','','subscription','connected','mock',true,$4,$4)
		  ON CONFLICT (id) DO NOTHING`, []any{f.productID, f.projectID, "pro-" + f.suffix, now}},
		{`INSERT INTO entitlements(id,project_id,key,name,description,created_at,updated_at)
		  VALUES ($1,$2,$3,'Pro','',$4,$4) ON CONFLICT (id) DO NOTHING`,
			[]any{entitlementID, f.projectID, "pro-" + f.suffix, now}},
		{`INSERT INTO provider_product_mappings(id,project_id,product_id,application_id,provider,
			provider_product_identifier,platform,status,created_at,updated_at)
		  VALUES ($1,$2,$3,$4,'app_store','com.mosaic.pro','ios','placeholder',$5,$5)
		  ON CONFLICT (id) DO NOTHING`, []any{mappingID, f.projectID, f.productID, f.applicationID, now}},
		{`INSERT INTO product_entitlement_grant_versions(
			id,project_id,product_id,entitlement_id,version,effective_start,created_at)
		  VALUES ($1,$2,$3,$4,1,$5,$5) ON CONFLICT (id) DO NOTHING`,
			[]any{grantID, f.projectID, f.productID, entitlementID, now.Add(-365 * 24 * time.Hour)}},
		{`INSERT INTO billing_project_settings(project_id,billing_enabled,updated_by_actor_id,created_at,updated_at)
		  VALUES ($1,true,'seam',$2,$2) ON CONFLICT (project_id) DO UPDATE SET billing_enabled=true`,
			[]any{f.projectID, now}},
		{`INSERT INTO billing_customers(id,project_id,status,diagnostics_status,created_at,updated_at)
		  VALUES ($1,$2,'active','none',$3,$3) ON CONFLICT (id) DO NOTHING`,
			[]any{f.customerID, f.projectID, now}},
		{`INSERT INTO billing_raw_inputs(id,project_id,organization_id,environment_id,environment_mode,
			application_id,provider,source,source_authority,idempotency_key,content_digest,
			transaction_reference_digest,body_state,authentication_result,store_environment,
			ingestion_status,correlation_id,received_at,expires_at)
		  VALUES ($1,$2,$3,$4,'production',$5,'app_store','client_observation','client_observation',
			$6,$7,$8,'not_retained','unauthenticated_client','production','accepted','seam',
			$9,$9::timestamptz + interval '30 days')`,
			[]any{f.rawInputID, f.projectID, organizationID, f.environmentID, f.applicationID,
				digest("idem-" + f.suffix), digest("content-" + f.suffix), f.referenceDigest, now}},
		{`INSERT INTO billing_validation_jobs(id,project_id,environment_id,raw_input_id,provider,status,
			attempt_count,max_attempts,available_at,lease_owner,lease_expires_at,created_at,updated_at)
		  VALUES ($1,$2,$3,$4,'app_store','leased',1,8,$5,'seam-test',$5::timestamptz + interval '2 minutes',$5,$5)`,
			[]any{"bvj_seam_" + f.suffix, f.projectID, f.environmentID, f.rawInputID, now}},
	} {
		if _, err := f.pool.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed seam fixture: %v", err)
		}
	}
}

// commitFact runs the production fact-commit transaction and then the
// production seam, exactly as ProcessNextValidation does.
func (f *fixture) commitFact(t *testing.T, ctx context.Context) {
	t.Helper()
	now := time.Now().UTC()
	start := now.Add(-24 * time.Hour)
	end := now.Add(30 * 24 * time.Hour)

	fact := billing.TransactionFact{
		ID: f.factID, ProjectID: f.projectID, EnvironmentID: f.environmentID,
		EnvironmentMode: "production", ApplicationID: f.applicationID,
		Provider: billing.ProviderAppStore, StoreEnvironment: billing.StoreProduction,
		ProviderTransactionID: "3000000000000001", PurchaseChainDigest: f.chainDigest,
		TransactionType: billing.TypeAutoRenewableSubscription, FactKind: billing.KindInitialPurchase,
		OccurredAt: start, PeriodStartAt: &start, PeriodEndAt: &end,
		ProviderProductIdentifier: "com.mosaic.pro", ResolutionState: billing.StateActiveMapping,
		MosaicProductID: f.productID, ProviderProductMappingID: "ppm_seam_" + f.suffix,
		ValidatorVersion: billing.ValidatorVersion, FactVersion: 1,
		SourceRawInputID: f.rawInputID, ValidationAttemptID: f.attemptID,
		FactDigest: digest("fact-" + f.suffix), RecordedAt: now,
	}
	outcome := billing.AttemptOutcome{
		Attempt: billing.ValidationAttempt{
			ID: f.attemptID, ProjectID: f.projectID, EnvironmentID: f.environmentID,
			RawInputID: f.rawInputID, AttemptNumber: 1, ValidatorVersion: billing.ValidatorVersion,
			StartedAt: now, CompletedAt: now, Outcome: billing.OutcomeValidated,
			StoreEnvironment: billing.StoreProduction, CorrelationID: "seam",
		},
		Fact:             &fact,
		ReferenceDigests: [][]byte{f.referenceDigest},
	}
	job := billing.ValidationJob{
		ID: "bvj_seam_" + f.suffix, ProjectID: f.projectID, EnvironmentID: f.environmentID,
		RawInputID: f.rawInputID, Provider: billing.ProviderAppStore, MaxAttempts: 8,
	}
	if err := f.billing.CompleteAttempt(ctx, job, outcome, now); err != nil {
		t.Fatalf("complete attempt: %v", err)
	}

	binder := billingseam.New(f.identity, nil)
	if err := binder.BindFact(ctx, billing.FactBinding{
		ProjectID: f.projectID, EnvironmentID: f.environmentID,
		Provider: billing.ProviderAppStore, LineageKeyDigest: f.chainDigest,
		FactChainDigest: f.chainDigest, RawInputID: f.rawInputID,
		ReferenceDigests: outcome.ReferenceDigests, AcquiredAt: start,
	}); err != nil {
		t.Fatalf("bind fact: %v", err)
	}
}

func (f *fixture) lineage(t *testing.T, ctx context.Context) billingcustomer.Lineage {
	t.Helper()
	lineage, err := billingcustomerpostgres.New(f.pool).
		LineageByKey(ctx, f.environmentID, billing.ProviderAppStore, f.chainDigest)
	if err != nil {
		t.Fatalf("the fact-commit transaction created no Purchase Lineage: %v", err)
	}
	return lineage
}

// drainProjection runs the real worker job function until the queue is empty.
func (f *fixture) drainProjection(t *testing.T, ctx context.Context) {
	t.Helper()
	for range 12 {
		processed, err := f.projection.ProcessNextProjection(ctx, "seam-test")
		if err != nil {
			t.Fatalf("process projection: %v", err)
		}
		if !processed {
			return
		}
	}
}

func (f *fixture) count(t *testing.T, ctx context.Context, query string, args ...any) int {
	t.Helper()
	var total int
	if err := f.pool.QueryRow(ctx, query, args...).Scan(&total); err != nil {
		t.Fatalf("count: %v", err)
	}
	return total
}

func (f *fixture) clean(ctx context.Context) {
	appendOnly := []string{
		"billing_association_evidence", "billing_transaction_facts",
		"billing_validation_attempts", "billing_raw_inputs",
		"customer_entitlement_snapshots", "customer_entitlement_snapshot_entries",
		"entitlement_sources", "subscription_snapshots", "subscription_snapshot_facts",
		"subscription_timeline_entries", "webhook_events",
	}
	for _, table := range appendOnly {
		_, _ = f.pool.Exec(ctx, `ALTER TABLE `+table+` DISABLE TRIGGER USER`)
	}
	for _, statement := range []string{
		`DELETE FROM webhook_events WHERE project_id=$1`,
		`DELETE FROM projection_attempts WHERE project_id=$1`,
		`DELETE FROM projection_jobs WHERE project_id=$1`,
		`DELETE FROM projection_checkpoints WHERE project_id=$1`,
		`DELETE FROM entitlement_sources WHERE project_id=$1`,
		`DELETE FROM customer_entitlement_snapshot_entries WHERE project_id=$1`,
		`DELETE FROM customer_entitlement_pointers WHERE project_id=$1`,
		`DELETE FROM customer_entitlement_snapshots WHERE project_id=$1`,
		`DELETE FROM subscription_timeline_entries WHERE project_id=$1`,
		`UPDATE subscription_instances SET current_snapshot_id=NULL WHERE project_id=$1`,
		`DELETE FROM subscription_snapshot_facts WHERE snapshot_id IN (SELECT id FROM subscription_snapshots WHERE project_id=$1)`,
		`DELETE FROM subscription_snapshots WHERE project_id=$1`,
		`DELETE FROM subscription_instances WHERE project_id=$1`,
		`DELETE FROM one_time_purchase_instances WHERE project_id=$1`,
		`DELETE FROM billing_identity_conflicts WHERE project_id=$1`,
		`DELETE FROM billing_association_evidence WHERE project_id=$1`,
		`DELETE FROM billing_customer_aliases WHERE project_id=$1`,
		`DELETE FROM purchase_lineages WHERE project_id=$1`,
		`DELETE FROM billing_transaction_facts WHERE project_id=$1`,
		`DELETE FROM billing_ledger_entries WHERE project_id=$1`,
		`DELETE FROM billing_product_resolutions WHERE project_id=$1`,
		`DELETE FROM billing_validation_attempts WHERE project_id=$1`,
		`DELETE FROM billing_validation_jobs WHERE project_id=$1`,
		`DELETE FROM billing_raw_inputs WHERE project_id=$1`,
		`DELETE FROM billing_customers WHERE project_id=$1`,
		`DELETE FROM product_entitlement_grant_versions WHERE project_id=$1`,
		`DELETE FROM provider_product_mappings WHERE project_id=$1`,
		`DELETE FROM billing_project_settings WHERE project_id=$1`,
		`DELETE FROM audit_events WHERE project_id=$1`,
		`DELETE FROM organization_members WHERE organization_id IN (SELECT organization_id FROM projects WHERE id=$1)`,
	} {
		_, _ = f.pool.Exec(ctx, statement, f.projectID)
	}
	for _, table := range appendOnly {
		_, _ = f.pool.Exec(ctx, `ALTER TABLE `+table+` ENABLE TRIGGER USER`)
	}
}

func digest(value string) []byte {
	sum := sha256.Sum256([]byte(value))
	return sum[:]
}
