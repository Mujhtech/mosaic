package billingprojectionpostgres

import (
	"context"
	"crypto/sha256"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
)

// These tests cover the parts of the projection that live in SQL rather than in
// Go: which lineages and facts a projection is allowed to read, and whether two
// projections of one customer can interleave. A unit test with a fake
// repository passes while every one of them is broken, because the thing under
// test is the query.

// fixture builds a tenant with two Environments, an Application, a Product with
// a granted Entitlement, and the ingestion rows a Transaction Fact requires.
type fixture struct {
	pool         *pgxpool.Pool
	ctx          context.Context
	organization string
	project      string
	production   string
	staging      string
	application  string
	product      string
	entitlement  string
	mapping      string
	grantVersion string
	customer     string
	now          time.Time
}

func newFixture(t *testing.T, suffix string) fixture {
	t.Helper()
	pool, ctx := testPool(t)
	f := fixture{
		pool: pool, ctx: ctx,
		organization: "org_load_" + suffix,
		project:      "proj_load_" + suffix,
		production:   "env_load_prod_" + suffix,
		staging:      "env_load_stage_" + suffix,
		application:  "app_load_" + suffix,
		product:      "prod_load_" + suffix,
		entitlement:  "ent_load_" + suffix,
		mapping:      "ppm_load_" + suffix,
		grantVersion: "pegv_load_" + suffix,
		customer:     "bcu_load_" + suffix,
		now:          time.Now().UTC(),
	}
	f.clean()
	t.Cleanup(func() {
		f.ctx = context.Background()
		f.clean()
	})

	f.exec(t, `INSERT INTO organizations(id,name,created_at,updated_at) VALUES ($1,'Loader',$2,$2)
	           ON CONFLICT (id) DO NOTHING`, f.organization, f.now)
	f.exec(t, `INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at)
	           VALUES ($1,$2,$3,'Loader','active',$4,$4) ON CONFLICT (id) DO NOTHING`,
		f.project, f.organization, "loader-"+suffix, f.now)
	f.exec(t, `INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at)
	           VALUES ($1,$2,'production','Production','production',$3,$3) ON CONFLICT (id) DO NOTHING`,
		f.production, f.project, f.now)
	f.exec(t, `INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at)
	           VALUES ($1,$2,'staging','Staging','staging',$3,$3) ON CONFLICT (id) DO NOTHING`,
		f.staging, f.project, f.now)
	f.exec(t, `INSERT INTO applications(id,project_id,name,platform,identifier,created_at,updated_at)
	           VALUES ($1,$2,'Loader','ios',$3,$4,$4) ON CONFLICT (id) DO NOTHING`,
		f.application, f.project, "com.mosaic.loader."+suffix, f.now)
	f.exec(t, `INSERT INTO products(id,project_id,key,internal_name,description,type,status,
	               metadata_source,readiness_ready,created_at,updated_at)
	           VALUES ($1,$2,$3,'Pro','','subscription','connected','mock',true,$4,$4)
	           ON CONFLICT (id) DO NOTHING`, f.product, f.project, "pro-"+suffix, f.now)
	f.exec(t, `INSERT INTO entitlements(id,project_id,key,name,description,created_at,updated_at)
	           VALUES ($1,$2,$3,'Pro','',$4,$4) ON CONFLICT (id) DO NOTHING`,
		f.entitlement, f.project, "pro-"+suffix, f.now)
	f.exec(t, `INSERT INTO provider_product_mappings(
	               id, project_id, product_id, application_id, provider,
	               provider_product_identifier, platform, status, created_at, updated_at)
	           VALUES ($1,$2,$3,$4,'app_store','com.mosaic.pro','ios','placeholder',$5,$5)
	           ON CONFLICT (id) DO NOTHING`, f.mapping, f.project, f.product, f.application, f.now)
	// Coverage and policy are stated explicitly: migration 00063 removed the
	// granting defaults so that a grant row can never grant something no caller
	// asked for.
	f.exec(t, `INSERT INTO product_entitlement_grant_versions(
	               id, project_id, product_id, entitlement_id, version, effective_start, created_at,
	               supported_purchase_types, grants_in_active, grants_in_trial, grants_in_grace,
	               grants_in_one_time_ownership)
	           VALUES ($1,$2,$3,$4,1,$5,$5,
	               ARRAY['auto_renewable_subscription','non_consumable']::text[],
	               true,true,true,true) ON CONFLICT (id) DO NOTHING`,
		f.grantVersion, f.project, f.product, f.entitlement, f.now.Add(-365*24*time.Hour))
	f.exec(t, `INSERT INTO billing_project_settings(project_id,billing_enabled,updated_by_actor_id,created_at,updated_at)
	           VALUES ($1,true,'loader',$2,$2) ON CONFLICT (project_id) DO UPDATE SET billing_enabled=true`,
		f.project, f.now)
	f.exec(t, `INSERT INTO billing_customers(id,project_id,status,diagnostics_status,created_at,updated_at)
	           VALUES ($1,$2,'active','none',$3,$3) ON CONFLICT (id) DO NOTHING`,
		f.customer, f.project, f.now)
	return f
}

func (f fixture) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx, query, args...); err != nil {
		t.Fatalf("seed %q: %v", query[:min(48, len(query))], err)
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func (f fixture) clean() {
	for _, statement := range []string{
		`ALTER TABLE billing_transaction_facts DISABLE TRIGGER USER`,
		`ALTER TABLE billing_validation_attempts DISABLE TRIGGER USER`,
		`ALTER TABLE billing_raw_inputs DISABLE TRIGGER USER`,
		`ALTER TABLE customer_entitlement_snapshots DISABLE TRIGGER customer_entitlement_snapshots_append_only`,
		`ALTER TABLE customer_entitlement_snapshot_entries DISABLE TRIGGER customer_entitlement_snapshot_entries_append_only`,
		`ALTER TABLE entitlement_sources DISABLE TRIGGER entitlement_sources_append_only`,
		`ALTER TABLE subscription_snapshots DISABLE TRIGGER subscription_snapshots_append_only`,
		`ALTER TABLE subscription_snapshot_facts DISABLE TRIGGER subscription_snapshot_facts_append_only`,
		`ALTER TABLE subscription_timeline_entries DISABLE TRIGGER USER`,
		`ALTER TABLE webhook_events DISABLE TRIGGER webhook_events_append_only`,
	} {
		_, _ = f.pool.Exec(f.ctx, statement)
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
		`DELETE FROM purchase_lineages WHERE project_id=$1`,
		`DELETE FROM billing_transaction_facts WHERE project_id=$1`,
		`DELETE FROM billing_ledger_entries WHERE project_id=$1`,
		`DELETE FROM billing_product_resolutions WHERE project_id=$1`,
		`DELETE FROM billing_validation_attempts WHERE project_id=$1`,
		`DELETE FROM billing_raw_inputs WHERE project_id=$1`,
		`DELETE FROM product_entitlement_grant_versions WHERE project_id=$1`,
		`DELETE FROM provider_product_mappings WHERE project_id=$1`,
		`DELETE FROM billing_customers WHERE project_id=$1`,
		`DELETE FROM billing_project_settings WHERE project_id=$1`,
		`DELETE FROM audit_events WHERE project_id=$1`,
	} {
		_, _ = f.pool.Exec(f.ctx, statement, f.project)
	}
	for _, statement := range []string{
		`ALTER TABLE billing_transaction_facts ENABLE TRIGGER USER`,
		`ALTER TABLE billing_validation_attempts ENABLE TRIGGER USER`,
		`ALTER TABLE billing_raw_inputs ENABLE TRIGGER USER`,
		`ALTER TABLE customer_entitlement_snapshots ENABLE TRIGGER customer_entitlement_snapshots_append_only`,
		`ALTER TABLE customer_entitlement_snapshot_entries ENABLE TRIGGER customer_entitlement_snapshot_entries_append_only`,
		`ALTER TABLE entitlement_sources ENABLE TRIGGER entitlement_sources_append_only`,
		`ALTER TABLE subscription_snapshots ENABLE TRIGGER subscription_snapshots_append_only`,
		`ALTER TABLE subscription_snapshot_facts ENABLE TRIGGER subscription_snapshot_facts_append_only`,
		`ALTER TABLE subscription_timeline_entries ENABLE TRIGGER USER`,
		`ALTER TABLE webhook_events ENABLE TRIGGER webhook_events_append_only`,
	} {
		_, _ = f.pool.Exec(f.ctx, statement)
	}
}

func digestOf(value string) []byte {
	sum := sha256.Sum256([]byte(value))
	return sum[:]
}

// lineage seeds a subscription lineage and its instance in one Environment.
func (f fixture) lineage(t *testing.T, id, environmentID, mode, storeEnvironment, chainKey string) string {
	t.Helper()
	f.exec(t, `INSERT INTO purchase_lineages(
	               id, project_id, environment_id, environment_mode, application_id, provider,
	               store_environment, lineage_key_digest, lineage_type, billing_customer_id,
	               created_at, updated_at)
	           VALUES ($1,$2,$3,$4,$5,'app_store',$6,$7,'subscription',$8,$9,$9)`,
		id, f.project, environmentID, mode, f.application, storeEnvironment,
		digestOf(chainKey), f.customer, f.now)
	instanceID := "sub_" + id
	f.exec(t, `INSERT INTO subscription_instances(
	               id, project_id, environment_id, application_id, purchase_lineage_id,
	               billing_customer_id, provider, created_at, updated_at)
	           VALUES ($1,$2,$3,$4,$5,$6,'app_store',$7,$7)`,
		instanceID, f.project, environmentID, f.application, id, f.customer, f.now)
	return instanceID
}

// fact seeds one validated Transaction Fact together with the raw input and
// validation attempt its foreign keys require.
func (f fixture) fact(t *testing.T, id, environmentID, mode, storeEnvironment, chainKey, supersedes, kind string, start, end time.Time) {
	t.Helper()
	inputID, attemptID := "bri_"+id, "bva_"+id
	f.exec(t, `INSERT INTO billing_raw_inputs(
	               id, project_id, organization_id, environment_id, environment_mode, provider,
	               source, source_authority, idempotency_key, content_digest, body_state,
	               authentication_result, store_environment, ingestion_status, correlation_id,
	               received_at, expires_at)
	           VALUES ($1,$2,$3,$4,$5,'app_store','apple_notification','store_notification',
	               $6,$7,'not_retained','verified_signature',$8,'accepted','loader',$9,$10)`,
		inputID, f.project, f.organization, environmentID, mode,
		digestOf("idem-"+id), digestOf("content-"+id), storeEnvironment, f.now, f.now.Add(time.Hour))
	f.exec(t, `INSERT INTO billing_validation_attempts(
	               id, project_id, environment_id, raw_input_id, attempt_number, validator_version,
	               started_at, completed_at, outcome, retryable, store_environment, latency_ms, correlation_id)
	           VALUES ($1,$2,$3,$4,1,2,$5,$5,'validated',false,$6,1,'loader')`,
		attemptID, f.project, environmentID, inputID, f.now, storeEnvironment)

	var supersedesDigest any
	if supersedes != "" {
		supersedesDigest = digestOf(supersedes)
	}
	f.exec(t, `INSERT INTO billing_transaction_facts(
	               id, project_id, environment_id, environment_mode, application_id, provider,
	               store_environment, provider_transaction_id, purchase_chain_digest,
	               supersedes_chain_digest, transaction_type, fact_kind, occurred_at,
	               period_start_at, period_end_at, provider_product_identifier, resolution_state,
	               mosaic_product_id, provider_product_mapping_id, resolved_mapping_version,
	               validator_version, source_raw_input_id, validation_attempt_id,
	               fact_digest, recorded_at)
	           VALUES ($1,$2,$3,$4,$5,'app_store',$6,$7,$8,$9,'auto_renewable_subscription',$10,$11,
	               $12,$13,'com.mosaic.pro','active_mapping',$14,$15,1,2,$16,$17,$18,$11)`,
		id, f.project, environmentID, mode, f.application, storeEnvironment, id,
		digestOf(chainKey), supersedesDigest, kind, start, start, end,
		f.product, f.mapping, inputID, attemptID, digestOf("fact-"+id))
}

// A lineage in another Environment must contribute nothing to a projection.
//
// Before Environment scoping, input selection filtered by Project alone: a
// staging purchase fed the production snapshot. That is not a cosmetic leak —
// Apple sandbox transactions are free and self-service, so it is a route to
// production entitlement anyone with a sandbox account can take.
func TestProjectionInputIsEnvironmentScoped(t *testing.T) {
	f := newFixture(t, "envscope")
	repository := New(f.pool)

	start := f.now.Add(-24 * time.Hour)
	end := f.now.Add(24 * time.Hour)
	f.lineage(t, "plin_prod", f.production, "production", "production", "chain-production")
	f.fact(t, "btf_prod", f.production, "production", "production", "chain-production", "", "initial_purchase", start, end)

	f.lineage(t, "plin_stage", f.staging, "staging", "sandbox", "chain-staging")
	f.fact(t, "btf_stage", f.staging, "staging", "sandbox", "chain-staging", "", "initial_purchase", start, end)

	input, err := repository.LoadInput(f.ctx, billingprojection.Scope{
		ProjectID: f.project, EnvironmentID: f.production, CustomerID: f.customer,
	})
	if err != nil {
		t.Fatalf("load production input: %v", err)
	}
	if len(input.Lineages) != 1 {
		t.Fatalf("production projection loaded %d lineages, want only the production one", len(input.Lineages))
	}
	if input.Lineages[0].LineageID != "plin_prod" {
		t.Fatalf("production projection loaded lineage %q", input.Lineages[0].LineageID)
	}
	for _, fact := range input.Lineages[0].Facts {
		if fact.ID != "btf_prod" {
			t.Fatalf("production lineage loaded fact %q from another Environment", fact.ID)
		}
	}

	output := billingprojection.Compute(input, f.now)
	if output.CustomerSnapshot == nil {
		t.Fatal("production projection produced no snapshot")
	}
	for _, source := range output.CustomerSnapshot.Sources {
		if source.PurchaseLineageID != "plin_prod" {
			t.Fatalf("production snapshot cites source from lineage %q", source.PurchaseLineageID)
		}
	}
}

// A Google purchase-token handover is one lineage keyed on its chain root, so
// the successor token's facts must load into the predecessor's lineage and the
// subscription must stay active. Reading the supersession edge with the
// opposite sign made every live Play plan change project as inactive.
func TestChainSuccessorFactsLoadIntoTheRootLineage(t *testing.T) {
	f := newFixture(t, "chain")
	repository := New(f.pool)

	rootStart := f.now.Add(-48 * time.Hour)
	rootEnd := f.now.Add(-24 * time.Hour)
	successorEnd := f.now.Add(24 * time.Hour)

	f.lineage(t, "plin_root", f.production, "production", "production", "chain-root")
	f.fact(t, "btf_root", f.production, "production", "production", "chain-root", "", "initial_purchase", rootStart, rootEnd)
	// The successor token carries its own chain digest and names the root as
	// the chain it supersedes — exactly what the Google validator writes.
	f.fact(t, "btf_edge", f.production, "production", "production", "chain-successor", "chain-root",
		"purchase_superseded", rootEnd, rootEnd)
	f.fact(t, "btf_successor", f.production, "production", "production", "chain-successor", "chain-root",
		"renewal", rootEnd, successorEnd)

	input, err := repository.LoadInput(f.ctx, billingprojection.Scope{
		ProjectID: f.project, EnvironmentID: f.production, CustomerID: f.customer,
	})
	if err != nil {
		t.Fatalf("load input: %v", err)
	}
	if len(input.Lineages) != 1 {
		t.Fatalf("loaded %d lineages, want the single root-keyed lineage", len(input.Lineages))
	}
	if got := len(input.Lineages[0].Facts); got != 3 {
		t.Fatalf("root lineage loaded %d facts, want all three in the chain", got)
	}

	output := billingprojection.Compute(input, f.now)
	if output.CustomerSnapshot == nil || len(output.CustomerSnapshot.Entries) != 1 {
		t.Fatalf("chain projection produced %+v", output.CustomerSnapshot)
	}
	if state := output.CustomerSnapshot.Entries[0].State; state != billingprojection.AccessActive {
		t.Fatalf("live successor after a token handover projected %q, want active", state)
	}
}

// A trigger arriving while a projection is already leased must create its own
// queued job. Coalescing onto leased work absorbed it, so a fact committed
// after the running job read its input waited for an unrelated later trigger —
// which, for an expiration or a refund, may never come.
func TestTriggerDuringLeasedProjectionQueuesNewWork(t *testing.T) {
	f := newFixture(t, "coalesce2")
	repository := New(f.pool)
	scope := billingprojection.Scope{
		ProjectID: f.project, EnvironmentID: f.production, CustomerID: f.customer,
	}

	if err := repository.Enqueue(f.ctx, scope, "fact_committed", f.now); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	job, leased, err := repository.LeaseJob(f.ctx, "worker-a", f.now, f.now.Add(time.Minute))
	if err != nil || !leased {
		t.Fatalf("lease: leased=%v err=%v", leased, err)
	}

	// A fact commits while that job is running.
	if err := repository.Enqueue(f.ctx, scope, "fact_committed", f.now.Add(time.Second)); err != nil {
		t.Fatalf("enqueue during lease: %v", err)
	}

	var queued int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FROM projection_jobs WHERE scope_key=$1 AND status='queued'`,
		scope.Key()).Scan(&queued); err != nil {
		t.Fatal(err)
	}
	if queued != 1 {
		t.Fatalf("a trigger during a leased projection produced %d queued jobs, want one", queued)
	}

	// Duplicate triggers still coalesce onto that one queued job.
	if err := repository.Enqueue(f.ctx, scope, "fact_committed", f.now.Add(2*time.Second)); err != nil {
		t.Fatalf("second enqueue during lease: %v", err)
	}
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FROM projection_jobs WHERE scope_key=$1 AND status='queued'`,
		scope.Key()).Scan(&queued); err != nil {
		t.Fatal(err)
	}
	if queued != 1 {
		t.Fatalf("duplicate triggers produced %d queued jobs, want one coalesced job", queued)
	}
	_ = job
}

// Two genuinely concurrent projections of one customer must serialize. The
// advisory lock is what makes the read-compute-commit sequence atomic across
// workers; without it both would read the same version, both would compute from
// the same facts, and one would silently overwrite the other's snapshot.
func TestConcurrentCustomerProjectionsSerialize(t *testing.T) {
	f := newFixture(t, "concurrent")
	repository := New(f.pool)
	scope := billingprojection.Scope{
		ProjectID: f.project, EnvironmentID: f.production, CustomerID: f.customer,
	}

	start := f.now.Add(-24 * time.Hour)
	end := f.now.Add(24 * time.Hour)
	f.lineage(t, "plin_conc", f.production, "production", "production", "chain-concurrent")
	f.fact(t, "btf_conc", f.production, "production", "production", "chain-concurrent", "", "initial_purchase", start, end)

	service := billingprojection.NewService(repository)

	var wait sync.WaitGroup
	results := make([]error, 2)
	for index := range results {
		wait.Add(1)
		go func(slot int) {
			defer wait.Done()
			_, err := service.Project(context.Background(), scope, "")
			results[slot] = err
		}(index)
	}
	wait.Wait()

	// Exactly one snapshot may exist for the customer: either the second
	// projection lost the compare-and-swap, or it read the first's committed
	// state and found nothing to change. Both are correct; two snapshots at the
	// same version, or a version gap, are not.
	var snapshots int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FROM customer_entitlement_snapshots
		 WHERE billing_customer_id=$1 AND environment_id=$2`,
		f.customer, f.production).Scan(&snapshots); err != nil {
		t.Fatal(err)
	}
	if snapshots != 1 {
		t.Fatalf("two concurrent projections produced %d snapshots, want exactly one", snapshots)
	}

	var version, pointerVersion int64
	if err := f.pool.QueryRow(f.ctx,
		`SELECT max(snapshot_version) FROM customer_entitlement_snapshots
		 WHERE billing_customer_id=$1 AND environment_id=$2`,
		f.customer, f.production).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if err := f.pool.QueryRow(f.ctx,
		`SELECT snapshot_version FROM customer_entitlement_pointers
		 WHERE billing_customer_id=$1 AND environment_id=$2`,
		f.customer, f.production).Scan(&pointerVersion); err != nil {
		t.Fatal(err)
	}
	if version != 1 || pointerVersion != 1 {
		t.Fatalf("snapshot version %d and pointer version %d, want both at 1", version, pointerVersion)
	}
	for _, err := range results {
		if err != nil && err != billingprojection.ErrVersionConflict {
			t.Fatalf("concurrent projection failed with an unexpected error: %v", err)
		}
	}
}

// oneTimeLineage seeds a non-consumable lineage and its instance.
func (f fixture) oneTimeLineage(t *testing.T, id, environmentID, mode, storeEnvironment, chainKey string) string {
	t.Helper()
	f.exec(t, `INSERT INTO purchase_lineages(
	               id, project_id, environment_id, environment_mode, application_id, provider,
	               store_environment, lineage_key_digest, lineage_type, billing_customer_id,
	               created_at, updated_at)
	           VALUES ($1,$2,$3,$4,$5,'app_store',$6,$7,'one_time',$8,$9,$9)`,
		id, f.project, environmentID, mode, f.application, storeEnvironment,
		digestOf(chainKey), f.customer, f.now)
	instanceID := "otp_" + id
	f.exec(t, `INSERT INTO one_time_purchase_instances(
	               id, project_id, environment_id, application_id, purchase_lineage_id,
	               billing_customer_id, provider, acquired_at, validity_state, created_at, updated_at)
	           VALUES ($1,$2,$3,$4,$5,$6,'app_store',$7,'owned',$8,$8)`,
		instanceID, f.project, environmentID, f.application, id, f.customer,
		f.now.Add(-24*time.Hour), f.now)
	return instanceID
}

// oneTimeFact seeds one validated non-consumable purchase fact.
func (f fixture) oneTimeFact(t *testing.T, id, environmentID, mode, storeEnvironment, chainKey string, acquired time.Time) {
	t.Helper()
	inputID, attemptID := "bri_"+id, "bva_"+id
	f.exec(t, `INSERT INTO billing_raw_inputs(
	               id, project_id, organization_id, environment_id, environment_mode, provider,
	               source, source_authority, idempotency_key, content_digest, body_state,
	               authentication_result, store_environment, ingestion_status, correlation_id,
	               received_at, expires_at)
	           VALUES ($1,$2,$3,$4,$5,'app_store','apple_notification','store_notification',
	               $6,$7,'not_retained','verified_signature',$8,'accepted','loader',$9,$10)`,
		inputID, f.project, f.organization, environmentID, mode,
		digestOf("idem-"+id), digestOf("content-"+id), storeEnvironment, f.now, f.now.Add(time.Hour))
	f.exec(t, `INSERT INTO billing_validation_attempts(
	               id, project_id, environment_id, raw_input_id, attempt_number, validator_version,
	               started_at, completed_at, outcome, retryable, store_environment, latency_ms, correlation_id)
	           VALUES ($1,$2,$3,$4,1,2,$5,$5,'validated',false,$6,1,'loader')`,
		attemptID, f.project, environmentID, inputID, f.now, storeEnvironment)
	f.exec(t, `INSERT INTO billing_transaction_facts(
	               id, project_id, environment_id, environment_mode, application_id, provider,
	               store_environment, provider_transaction_id, purchase_chain_digest,
	               transaction_type, fact_kind, occurred_at, period_start_at,
	               provider_product_identifier, resolution_state, mosaic_product_id,
	               provider_product_mapping_id, resolved_mapping_version, validator_version,
	               source_raw_input_id, validation_attempt_id, fact_digest, recorded_at)
	           VALUES ($1,$2,$3,$4,$5,'app_store',$6,$7,$8,'non_consumable','one_time_purchase',$9,$9,
	               'com.mosaic.lifetime','active_mapping',$10,$11,1,2,$12,$13,$14,$9)`,
		id, f.project, environmentID, mode, f.application, storeEnvironment, id,
		digestOf(chainKey), acquired, f.product, f.mapping, inputID, attemptID, digestOf("fact-"+id))
}

// A fact on one of a customer's lineages must never revoke the others.
//
// This is demonstration 5 of the Phase 9B integrated demonstration, reduced to
// its failing core (defect D-4). A customer holds a subscription and a lifetime
// non-consumable, both granting the same Entitlement. A fact commits on the
// subscription lineage. The job that trigger writes used to name *both* the
// customer and that one lineage: `loadLineages` filtered to the lineage while
// `Compute` still minted a full customer aggregate, so the lifetime purchase
// disappeared from the snapshot and the Entitlement read `inactive` while an
// unrefunded lifetime purchase sat in the database still marked `owned`.
//
// Nothing about that failure is loud. No error is raised, no constraint is
// violated, and the customer simply loses access they paid for — which is why
// this test asserts the source set and the entitlement state rather than the
// absence of an error.
func TestFactOnOneLineageDoesNotRevokeTheCustomersOthers(t *testing.T) {
	f := newFixture(t, "d4revoke")
	repository := New(f.pool)
	service := billingprojection.NewService(repository)

	subscription := "bpl_d4_sub"
	lifetime := "bpl_d4_life"
	f.lineage(t, subscription, f.production, "production", "production", "chain-sub")
	f.oneTimeLineage(t, lifetime, f.production, "production", "production", "chain-life")
	f.fact(t, "btf_d4_sub", f.production, "production", "production", "chain-sub", "",
		"initial_purchase", f.now.Add(-30*24*time.Hour), f.now.Add(30*24*time.Hour))
	f.oneTimeFact(t, "btf_d4_life", f.production, "production", "production", "chain-life",
		f.now.Add(-20*24*time.Hour))

	// The job exactly as the fact-commit trigger writes it: customer scope, and
	// no lineage in the detail.
	f.exec(t, `INSERT INTO projection_jobs(
	               id, project_id, environment_id, scope_key, kind, detail, status,
	               attempt_count, max_attempts, available_at, created_at, updated_at)
	           VALUES ($1,$2,$3,$4,'fact_committed',$5,'queued',0,8,$6,$6,$6)`,
		"pjb_d4", f.project, f.production, "customer:"+f.customer,
		`{"customerId":"`+f.customer+`"}`, f.now)

	// Lease until this fixture's own job comes up. The queue is global, and
	// other packages in the same database leave their own jobs behind; leasing
	// blind would assert against whichever one happened to be oldest.
	var job billingprojection.Job
	for range 32 {
		leased, ok, err := repository.LeaseJob(f.ctx, "worker", f.now, f.now.Add(time.Minute))
		if err != nil {
			t.Fatalf("lease projection job: %v", err)
		}
		if !ok {
			t.Fatal("this fixture's projection job was never leased")
		}
		if leased.ProjectID == f.project {
			job = leased
			break
		}
	}
	if job.ID == "" {
		t.Fatal("this fixture's projection job was never leased")
	}
	if scope := job.Scope(); scope.LineageID != "" {
		t.Fatalf("a customer-scoped job carried lineage %q; the aggregate would be "+
			"recomputed from one source and the rest silently revoked", scope.LineageID)
	}

	if _, err := service.Project(f.ctx, job.Scope(), job.ID); err != nil {
		t.Fatalf("project: %v", err)
	}

	var sources int
	var state string
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FROM entitlement_sources s
		   JOIN customer_entitlement_pointers p
		     ON p.current_snapshot_id = s.customer_entitlement_snapshot_id
		  WHERE p.billing_customer_id=$1 AND p.environment_id=$2`,
		f.customer, f.production).Scan(&sources); err != nil {
		t.Fatalf("read entitlement sources: %v", err)
	}
	if err := f.pool.QueryRow(f.ctx,
		`SELECT e.state FROM customer_entitlement_snapshot_entries e
		   JOIN customer_entitlement_pointers p
		     ON p.current_snapshot_id = e.customer_entitlement_snapshot_id
		  WHERE p.billing_customer_id=$1 AND p.environment_id=$2`,
		f.customer, f.production).Scan(&state); err != nil {
		t.Fatalf("read entitlement entry: %v", err)
	}
	if sources != 2 {
		t.Fatalf("entitlement sources = %d, want 2 (the subscription and the lifetime purchase)", sources)
	}
	if state != "active" {
		t.Fatalf("entitlement state = %q, want active", state)
	}
}
