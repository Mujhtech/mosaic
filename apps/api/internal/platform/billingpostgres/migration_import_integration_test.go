package billingpostgres

import (
	"database/sql"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/googleplay"
	"github.com/Mujhtech/mosaic/apps/api/migrations"
)

// This integration test protects the crash boundary: acceptance must persist
// the Raw Input, immutable expectation, and validation job atomically, and a
// replay after process loss must reuse them without claiming a Fact exists.
func TestMigrationValidationAcceptanceIsAtomicAndIdempotent(t *testing.T) {
	pool, ctx := testPool(t)
	repository := New(pool)
	suffix := "migration_binding"
	projectID, environmentID, applicationID := seed(t, ctx, pool, suffix)
	now := time.Now().UTC()
	productID, credentialID, programID := "product_"+suffix, "migration_credential_"+suffix, "migration_program_"+suffix
	if _, err := pool.Exec(ctx, `INSERT INTO products(id,project_id,key,internal_name,type,status,metadata_source,readiness_ready,created_at,updated_at)
		VALUES($1,$2,$3,'Migration Product','subscription','connected','provider',true,$4,$4)`, productID, projectID, "migration-product", now); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_credentials(id,project_id,provider,external_project_id,status,envelope_version,algorithm,key_id,nonce,ciphertext,fingerprint,created_by_actor_id,created_at)
		VALUES($1,$2,'revenuecat','rc-project','active',1,'AES-256-GCM','test-key',decode(repeat('01',12),'hex'),decode(repeat('02',32),'hex'),decode(repeat('03',32),'hex'),'actor',$3)`, credentialID, projectID, now); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_programs(id,project_id,environment_id,source_adapter,source_adapter_version,credential_id,state,state_version,scope_digest,policy_digest,idempotency_key,request_digest,created_by_actor_id,created_at,updated_at)
		VALUES($1,$2,$3,'revenuecat','test',$4,'importing',1,decode(repeat('11',32),'hex'),decode(repeat('12',32),'hex'),'program-key',decode(repeat('13',32),'hex'),'actor',$5,$5)`, programID, projectID, environmentID, credentialID, now); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `ALTER TABLE billing_migration_validation_bindings DISABLE TRIGGER billing_migration_validation_bindings_protected`)
		_, _ = pool.Exec(ctx, `DELETE FROM billing_migration_validation_bindings WHERE project_id=$1`, projectID)
		_, _ = pool.Exec(ctx, `ALTER TABLE billing_migration_validation_bindings ENABLE TRIGGER billing_migration_validation_bindings_protected`)
		_, _ = pool.Exec(ctx, `DELETE FROM billing_migration_programs WHERE id=$1`, programID)
		_, _ = pool.Exec(ctx, `DELETE FROM billing_migration_credentials WHERE id=$1`, credentialID)
		_, _ = pool.Exec(ctx, `DELETE FROM products WHERE id=$1`, productID)
	})

	referenceDigest := billing.AppleTransactionKey(billing.StoreUnclassified, "2000000001")
	input := billing.RawInput{ID: "raw_" + suffix, ProjectID: projectID, EnvironmentID: environmentID, EnvironmentMode: "production", OrganizationID: "org_billing_" + suffix,
		ApplicationID: applicationID, Provider: billing.ProviderAppStore, Source: billing.SourceMigrationKnownReference, SourceAuthority: billing.AuthorityStoreReconciliation,
		IdempotencyKey: bytes32ForMigrationTest(1), ContentDigest: bytes32ForMigrationTest(2), TransactionReferenceDigest: referenceDigest, BodyState: "not_retained",
		AuthenticationResult: billing.AuthVerifiedTransport, StoreEnvironment: billing.StoreUnclassified, IngestionStatus: billing.IngestAccepted, CorrelationID: "binding_" + suffix, ReceivedAt: now, ExpiresAt: now.Add(24 * time.Hour)}
	binding := billing.MigrationValidationBinding{ID: "binding_" + suffix, ProgramID: programID, ProjectID: projectID, EnvironmentID: environmentID, RawInputID: input.ID,
		Provider: billing.ProviderAppStore, ReferenceKind: billing.ReferenceAppStoreTransactionID, ReferenceDigest: referenceDigest, ExpectedApplicationID: applicationID,
		ExpectedStoreProductIdentifier: "com.example.monthly", ExpectedMosaicProductID: productID, ExpectedStoreEnvironment: billing.StoreProduction, Status: billing.MigrationValidationAccepted, AcceptedAt: now}
	first, err := repository.PersistMigrationInput(ctx, input, binding, now)
	if err != nil {
		t.Fatal(err)
	}
	binding.ID = "binding_replayed_should_not_be_used"
	second, err := repository.PersistMigrationInput(ctx, input, binding, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if first.BindingID != second.BindingID || first.RawInputID != second.RawInputID || second.Status != billing.MigrationValidationAccepted {
		t.Fatalf("first=%+v second=%+v", first, second)
	}
	var rawCount, jobCount, bindingCount, factCount int
	if err = pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM billing_raw_inputs WHERE id=$1),(SELECT count(*) FROM billing_validation_jobs WHERE raw_input_id=$1),(SELECT count(*) FROM billing_migration_validation_bindings WHERE raw_input_id=$1),(SELECT count(*) FROM billing_transaction_facts WHERE source_raw_input_id=$1)`, input.ID).Scan(&rawCount, &jobCount, &bindingCount, &factCount); err != nil {
		t.Fatal(err)
	}
	if rawCount != 1 || jobCount != 1 || bindingCount != 1 || factCount != 0 {
		t.Fatalf("raw=%d job=%d binding=%d facts=%d", rawCount, jobCount, bindingCount, factCount)
	}
	db, err := sql.Open("pgx", os.Getenv("DATABASE_TEST_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	goose.SetBaseFS(migrations.Files)
	if err = goose.SetDialect("postgres"); err != nil {
		t.Fatal(err)
	}
	err = goose.DownToContext(ctx, db, ".", 58)
	if err == nil || !strings.Contains(err.Error(), "immutable migration validation evidence exists") {
		t.Fatalf("populated migration59 down guard error=%v", err)
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM billing_migration_validation_bindings WHERE raw_input_id=$1`, input.ID).Scan(&bindingCount); err != nil || bindingCount != 1 {
		t.Fatalf("down guard lost binding count=%d err=%v", bindingCount, err)
	}
}

// This protects the full Package E boundary rather than either half in
// isolation: an ordinary worker must terminally quarantine provider evidence
// that disagrees with the immutable migration expectation, and its transaction
// must not append a Fact while completing the binding.
func TestMigrationValidationMismatchQuarantinesBindingWithoutFact(t *testing.T) {
	pool, ctx := testPool(t)
	fixture := newRevalidationFixture(t, ctx, pool, "migration_mismatch")
	now := time.Now().UTC()
	credentialID, programID := "migration_credential_mismatch", "migration_program_mismatch"
	var productID string
	if err := pool.QueryRow(ctx, `SELECT product_id FROM provider_product_mappings WHERE project_id=$1 AND application_id=$2 AND provider='google_play'`, fixture.projectID, fixture.applicationID).Scan(&productID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_credentials(id,project_id,provider,external_project_id,status,envelope_version,algorithm,key_id,nonce,ciphertext,fingerprint,created_by_actor_id,created_at) VALUES($1,$2,'revenuecat','rc-project','active',1,'AES-256-GCM','test-key',decode(repeat('01',12),'hex'),decode(repeat('02',32),'hex'),decode(repeat('03',32),'hex'),'actor',$3)`, credentialID, fixture.projectID, now); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_programs(id,project_id,environment_id,source_adapter,source_adapter_version,credential_id,state,state_version,scope_digest,policy_digest,idempotency_key,request_digest,created_by_actor_id,created_at,updated_at) VALUES($1,$2,$3,'revenuecat','test',$4,'importing',1,decode(repeat('11',32),'hex'),decode(repeat('12',32),'hex'),'program-key',decode(repeat('13',32),'hex'),'actor',$5,$5)`, programID, fixture.projectID, fixture.environmentID, credentialID, now); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `ALTER TABLE billing_migration_validation_bindings DISABLE TRIGGER billing_migration_validation_bindings_protected`)
		_, _ = pool.Exec(ctx, `DELETE FROM billing_migration_validation_bindings WHERE project_id=$1`, fixture.projectID)
		_, _ = pool.Exec(ctx, `ALTER TABLE billing_migration_validation_bindings ENABLE TRIGGER billing_migration_validation_bindings_protected`)
		_, _ = pool.Exec(ctx, `DELETE FROM billing_migration_programs WHERE id=$1`, programID)
		_, _ = pool.Exec(ctx, `DELETE FROM billing_migration_credentials WHERE id=$1`, credentialID)
	})

	const orderID = "GPA.MIGRATION-MISMATCH"
	const purchaseToken = "provider-returned-token-never-persisted-in-import-batch"
	var order googleplay.Order
	if err := json.Unmarshal([]byte(`{"orderId":"`+orderID+`","purchaseToken":"`+purchaseToken+`","state":"PROCESSED","lineItems":[{"productId":"`+fixtureProviderProduct+`"}]}`), &order); err != nil {
		t.Fatal(err)
	}
	fixture.google.orders[orderID] = order
	fixture.google.subscriptions[purchaseToken] = subscriptionPurchase(
		fixtureProviderProduct, orderID, time.UnixMilli(1767225600000).UTC(), time.UnixMilli(1769904000000).UTC())

	accepted, err := fixture.service.AcceptMigrationValidation(ctx, billing.MigrationValidationRequest{
		ProgramID: programID, ProjectID: fixture.projectID, EnvironmentID: fixture.environmentID,
		ApplicationID: fixture.applicationID, Provider: billing.ProviderGooglePlay,
		ReferenceKind: billing.ReferenceGooglePlayOrderID, Reference: orderID,
		ExpectedStoreProductIdentifier: "different.store.product", ExpectedMosaicProductID: productID,
		ExpectedStoreEnvironment: billing.StoreProduction,
	})
	if err != nil {
		t.Fatalf("accept migration validation: %v", err)
	}
	processed, err := fixture.service.ProcessNextValidation(ctx, "migration-worker")
	if err != nil || !processed {
		t.Fatalf("processed=%v err=%v", processed, err)
	}
	var status, diagnostic string
	var factCount int
	if err = pool.QueryRow(ctx, `SELECT b.status,coalesce(b.diagnostic_code,''),(SELECT count(*) FROM billing_transaction_facts f WHERE f.source_raw_input_id=b.raw_input_id) FROM billing_migration_validation_bindings b WHERE b.id=$1`, accepted.BindingID).Scan(&status, &diagnostic, &factCount); err != nil {
		t.Fatal(err)
	}
	if status != billing.MigrationValidationQuarantined || diagnostic != billing.DiagnosticMigrationProviderProductMismatch || factCount != 0 {
		t.Fatalf("status=%q diagnostic=%q facts=%d", status, diagnostic, factCount)
	}
}

func bytes32ForMigrationTest(value byte) []byte {
	result := make([]byte, 32)
	for i := range result {
		result[i] = value
	}
	return result
}
