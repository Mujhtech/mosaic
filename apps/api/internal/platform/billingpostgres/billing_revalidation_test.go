package billingpostgres

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/appstorejws"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/googleplay"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
)

// googleServiceAccountFixture builds a service-account key file in Google's
// documented shape around a locally generated RSA key. It is never sent
// anywhere: the worker only parses it, so this exercises the real
// ParseServiceAccount path without any real credential.
func googleServiceAccountFixture(t *testing.T) []byte {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(map[string]string{
		"type":           "service_account",
		"project_id":     "fixture-project",
		"private_key_id": "fixture-key",
		"private_key":    string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})),
		"client_email":   "fixture@example.iam.gserviceaccount.com",
		"token_uri":      "https://oauth2.googleapis.com/token",
	})
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

// The three tests in this file pin the three Stage 4 demonstration defects.
//
// All three are integration tests against PostgreSQL, and deliberately so: each
// defect lived in the interaction between the application service and SQL, not
// inside either alone. A unit test with a fake repository would have passed
// while every one of them was broken, because the fake would have enqueued the
// job the real ON CONFLICT branch silently skipped, matched the provider
// predicate the real query omitted, and returned the credential the real scope
// lookup never performed.
//
// They are also service-level rather than repository-level. The repository
// methods they exercise are new, so a repository test would only assert that
// code written today does what it was written to do. What actually regressed was
// whether ProcessNextReplay and reconcileGoogleTokens *use* them, and whether an
// observation reaches the provider at all — none of which is visible below the
// service.
//
// Google is used throughout because Google's authenticity is transport-level:
// no signature is involved, so these tests need no synthetic Apple chain and
// stay focused on the defect rather than on certificate plumbing.

// fakeGoogle is a recording stand-in for the Play Developer API. It counts calls
// so a test can assert that a lookup actually happened, which is precisely what
// defect 2 got wrong: the run reported success without making one.
type fakeGoogle struct {
	subscriptions     map[string]googleplay.SubscriptionPurchase
	orders            map[string]googleplay.Order
	subscriptionCalls int
	orderCalls        int
}

func (f *fakeGoogle) GetSubscription(_ context.Context, _ *googleplay.ServiceAccount, _, purchaseToken string) (googleplay.SubscriptionPurchase, error) {
	f.subscriptionCalls++
	purchase, ok := f.subscriptions[purchaseToken]
	if !ok {
		return googleplay.SubscriptionPurchase{}, billing.ErrNotFound
	}
	return purchase, nil
}

func (f *fakeGoogle) GetProduct(context.Context, *googleplay.ServiceAccount, string, string, string) (googleplay.ProductPurchase, error) {
	return googleplay.ProductPurchase{}, billing.ErrNotFound
}

func (f *fakeGoogle) GetOrder(_ context.Context, _ *googleplay.ServiceAccount, _, orderID string) (googleplay.Order, error) {
	f.orderCalls++
	order, ok := f.orders[orderID]
	if !ok {
		return googleplay.Order{}, billing.ErrNotFound
	}
	return order, nil
}

func (f *fakeGoogle) Pull(context.Context, *googleplay.ServiceAccount, string, string, int) ([]googleplay.ReceivedMessage, error) {
	return nil, nil
}

func (f *fakeGoogle) Acknowledge(context.Context, *googleplay.ServiceAccount, string, string, []string) error {
	return nil
}

// subscriptionPurchase builds the Play response shape, parameterised by the one
// field the tests vary. Expiry is what moves the fact digest, which is how a
// "changed provider answer" is simulated without inventing a new code path.
func subscriptionPurchase(productID, orderID string, start, expiry time.Time) googleplay.SubscriptionPurchase {
	var purchase googleplay.SubscriptionPurchase
	encoded, _ := json.Marshal(map[string]any{
		"kind":              "androidpublisher#subscriptionPurchaseV2",
		"regionCode":        "US",
		"startTime":         start.Format(time.RFC3339),
		"subscriptionState": "SUBSCRIPTION_STATE_ACTIVE",
		"latestOrderId":     orderID,
		"lineItems": []map[string]any{{
			"productId":        productID,
			"expiryTime":       expiry.Format(time.RFC3339),
			"offerDetails":     map[string]any{"basePlanId": "monthly"},
			"autoRenewingPlan": map[string]any{"autoRenewEnabled": true},
		}},
	})
	_ = json.Unmarshal(encoded, &purchase)
	return purchase
}

// revalidationFixture is the shared tenant: an organization, Project, production
// Environment, Android Application, Mosaic Product, active mapping, and a Google
// Store Server Credential scoped to the Application.
type revalidationFixture struct {
	pool    *pgxpool.Pool
	service *billing.Service
	google  *fakeGoogle

	projectID     string
	environmentID string
	applicationID string
	credentialID  string
	cipher        providercredential.SubjectCipher
	organization  string
}

const (
	fixturePackageName     = "com.fixture.demo.android"
	fixtureProviderProduct = "fixture.sub.monthly"
	fixturePurchaseToken   = "fixture-purchase-token-0001"
	fixtureOrderID         = "GPA.FIXTURE-0000-0000-0001"
)

func newRevalidationFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool, suffix string) *revalidationFixture {
	t.Helper()
	projectID, environmentID, _ := seed(t, ctx, pool, suffix)
	now := time.Now().UTC()

	var organizationID string
	if err := pool.QueryRow(ctx, `SELECT organization_id FROM projects WHERE id=$1`, projectID).
		Scan(&organizationID); err != nil {
		t.Fatal(err)
	}

	applicationID := "app_android_" + suffix
	productID := "prd_" + suffix
	mappingID := "ppm_" + suffix
	credentialID := "ssc_" + suffix

	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO applications(id,project_id,name,platform,identifier,created_at,updated_at)
		  VALUES ($1,$2,'Android','android',$3,$4,$4) ON CONFLICT (id) DO NOTHING`,
			[]any{applicationID, projectID, fixturePackageName + "." + suffix, now}},
		{`INSERT INTO products(id,project_id,key,internal_name,type,status,metadata_source,readiness_ready,created_at,updated_at)
		  VALUES ($1,$2,$3,'Fixture Monthly','subscription','connected','mock',true,$4,$4)
		  ON CONFLICT (id) DO NOTHING`, []any{productID, projectID, "fixture-" + suffix, now}},
		{`INSERT INTO provider_product_mappings(
			id,project_id,product_id,application_id,provider,provider_product_identifier,status,
			environment_id,platform,availability,sync_state,created_at,updated_at)
		  VALUES ($1,$2,$3,$4,'google_play',$5,'active',$6,'android','available','current',$7,$7)
		  ON CONFLICT (id) DO NOTHING`,
			[]any{mappingID, projectID, productID, applicationID, fixtureProviderProduct, environmentID, now}},
	} {
		if _, err := pool.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("fixture: %v", err)
		}
	}

	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	cipher, err := providercredential.NewAESGCMCipher(
		`{"version":1,"activeKeyId":"test","keys":{"test":"`+
			base64.RawURLEncoding.EncodeToString(key)+`"}}`, rand.Reader)
	if err != nil {
		t.Fatalf("cipher: %v", err)
	}

	// The owner membership these tests need to queue a replay or a
	// reconciliation through the service. Authorization is real here: the
	// service's SQL checks it.
	for _, actorID := range []string{"actor_owner_replay", "actor_owner_recon"} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO organization_members(organization_id,actor_id,role,created_at,updated_at)
			 VALUES ($1,$2,'owner',$3,$3) ON CONFLICT (organization_id,actor_id) DO NOTHING`,
			organizationID, actorID, now); err != nil {
			t.Fatal(err)
		}
	}

	google := &fakeGoogle{
		subscriptions: map[string]googleplay.SubscriptionPurchase{},
		orders:        map[string]googleplay.Order{},
	}
	// The real verifier with the real embedded Apple root. These tests never
	// present a JWS, so no trust-root substitution is needed or wanted.
	verifier, err := appstorejws.NewVerifier()
	if err != nil {
		t.Fatal(err)
	}
	service := billing.NewService(New(pool), cipher, verifier, billing.WithProviders(nil, google))

	fixture := &revalidationFixture{
		pool: pool, service: service, google: google,
		projectID: projectID, environmentID: environmentID, applicationID: applicationID,
		credentialID: credentialID, cipher: cipher, organization: organizationID,
	}
	fixture.createCredential(t, ctx)
	return fixture
}

// createCredential writes a Google credential the way the service would, sealing
// a service-account key under the real envelope so the worker can open it.
func (f *revalidationFixture) createCredential(t *testing.T, ctx context.Context) {
	t.Helper()
	now := time.Now().UTC()
	secret := googleServiceAccountFixture(t)
	envelope, err := f.cipher.EncryptSubject(secret, providercredential.SubjectScope{
		OrganizationID:  f.organization,
		ProjectID:       f.projectID,
		SubjectKind:     providercredential.SubjectStoreServerCredential,
		SubjectID:       f.credentialID,
		CredentialClass: billing.ClassGoogleServiceAccountKey,
	})
	if err != nil {
		t.Fatalf("seal credential: %v", err)
	}
	if _, err := f.pool.Exec(ctx,
		`INSERT INTO store_server_credentials(
			id, project_id, organization_id, environment_id, environment_mode, provider, store_environment,
			name, status, health_status, credential_class, envelope_version, algorithm, key_id, nonce,
			ciphertext, fingerprint, google_client_email, google_pubsub_project_id,
			google_pubsub_subscription_id, created_by_actor_id, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,'production','google_play','production','Fixture','active','untested',
			$5,$6,$7,$8,$9,$10,$11,'fixture@example.iam.gserviceaccount.com','fixture-project',
			'fixture-sub','actor_fixture',$12,$12)`,
		f.credentialID, f.projectID, f.organization, f.environmentID,
		billing.ClassGoogleServiceAccountKey, envelope.Version, envelope.Algorithm, envelope.KeyID,
		envelope.Nonce, envelope.Ciphertext, envelope.Fingerprint, now); err != nil {
		t.Fatalf("insert credential: %v", err)
	}
	if _, err := f.pool.Exec(ctx,
		`INSERT INTO store_server_credential_applications(
			credential_id, project_id, application_id, platform, provider_application_identifier, created_at)
		 VALUES ($1,$2,$3,'android',$4,$5)`,
		f.credentialID, f.projectID, f.applicationID, fixturePackageName+"."+suffixOf(f.credentialID), now); err != nil {
		t.Fatalf("scope credential: %v", err)
	}
}

func suffixOf(credentialID string) string { return credentialID[len("ssc_"):] }

// ingest writes a Raw Billing Input with a sealed body, the way intake does.
// credentialID is empty for an observation, which is the whole point of the
// third test.
func (f *revalidationFixture) ingest(t *testing.T, ctx context.Context, id, source, authority, credentialID string, body []byte, enqueue bool) billing.RawInput {
	t.Helper()
	now := time.Now().UTC()
	input := billing.RawInput{
		ID:                   id,
		ProjectID:            f.projectID,
		OrganizationID:       f.organization,
		EnvironmentID:        f.environmentID,
		EnvironmentMode:      "production",
		CredentialID:         credentialID,
		Provider:             billing.ProviderGooglePlay,
		Source:               source,
		SourceAuthority:      authority,
		ProviderEventID:      id,
		IdempotencyKey:       billing.ContentDigest([]byte(id)),
		ContentDigest:        billing.ContentDigest(body),
		AuthenticationResult: billing.AuthVerifiedTransport,
		StoreEnvironment:     billing.StoreProduction,
		IngestionStatus:      billing.IngestAccepted,
		CorrelationID:        "fixture",
		ReceivedAt:           now,
		ExpiresAt:            now.Add(90 * 24 * time.Hour),
	}
	envelope, err := f.cipher.EncryptSubject(body, providercredential.SubjectScope{
		OrganizationID:  f.organization,
		ProjectID:       f.projectID,
		SubjectKind:     providercredential.SubjectBillingRawInput,
		SubjectID:       id,
		CredentialClass: billing.ClassBillingRawPayload,
	})
	if err != nil {
		t.Fatalf("seal body: %v", err)
	}
	input.BodyState = "stored"
	input.Envelope = &billing.Envelope{
		Version: envelope.Version, Algorithm: envelope.Algorithm, KeyID: envelope.KeyID,
		Nonce: envelope.Nonce, Ciphertext: envelope.Ciphertext, Fingerprint: envelope.Fingerprint,
	}
	if _, err := New(f.pool).PersistRawInput(ctx, input, enqueue, now); err != nil {
		t.Fatalf("persist input: %v", err)
	}
	return input
}

func (f *revalidationFixture) attemptCount(t *testing.T, ctx context.Context, rawInputID string) int {
	t.Helper()
	var count int
	if err := f.pool.QueryRow(ctx,
		`SELECT count(*) FROM billing_validation_attempts WHERE raw_input_id=$1`, rawInputID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func (f *revalidationFixture) factCount(t *testing.T, ctx context.Context, rawInputID string) int {
	t.Helper()
	var count int
	if err := f.pool.QueryRow(ctx,
		`SELECT count(*) FROM billing_transaction_facts WHERE source_raw_input_id=$1`, rawInputID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func rtdnBody(packageName, subscriptionID, purchaseToken string) []byte {
	body, _ := json.Marshal(map[string]any{
		"version": "1.0", "packageName": packageName, "eventTimeMillis": "1700000000000",
		"subscriptionNotification": map[string]any{
			"version": "1.0", "notificationType": 4,
			"purchaseToken": purchaseToken, "subscriptionId": subscriptionID,
		},
	})
	return body
}

// ---------------------------------------------------------------------------
// Defect 1
// ---------------------------------------------------------------------------

// Replay must append a real Validation Attempt and report a comparison it
// actually performed.
//
// The defect this catches: ProcessNextReplay re-enqueued through
// PersistRawInput, whose duplicate branch returns before the enqueue, so nothing
// was ever revalidated — while the job still reported comparison_result
// 'identical'. That is worse than doing nothing, because an operator reads it as
// "the ledger was re-verified". The second half of the test changes the provider
// answer, which is the only way to prove the 'identical' verdict was computed
// rather than assumed.
func TestReplayAppendsAttemptAndComparesAgainstRecordedFacts(t *testing.T) {
	pool, ctx := testPool(t)
	fixture := newRevalidationFixture(t, ctx, pool, "replay")

	start := time.Now().Add(-72 * time.Hour).UTC().Truncate(time.Second)
	expiry := start.Add(30 * 24 * time.Hour)
	fixture.google.subscriptions[fixturePurchaseToken] =
		subscriptionPurchase(fixtureProviderProduct, fixtureOrderID, start, expiry)

	input := fixture.ingest(t, ctx, "bri_replay_fixture",
		billing.SourceGoogleRTDN, billing.AuthorityStoreNotification, fixture.credentialID,
		rtdnBody(fixturePackageName+"."+suffixOf(fixture.credentialID), fixtureProviderProduct, fixturePurchaseToken), true)

	if _, err := fixture.service.ProcessNextValidation(ctx, "worker"); err != nil {
		t.Fatalf("initial validation: %v", err)
	}
	if got := fixture.attemptCount(t, ctx, input.ID); got != 1 {
		t.Fatalf("%d attempts after first validation, want 1", got)
	}
	if got := fixture.factCount(t, ctx, input.ID); got != 1 {
		t.Fatalf("%d facts after first validation, want 1", got)
	}

	queueReplay := func(kind string) {
		t.Helper()
		if _, err := fixture.service.CreateReplay(ctx, billing.Actor{ID: "actor_owner_replay"}, billing.ReplayJob{
			ProjectID: fixture.projectID, EnvironmentID: fixture.environmentID,
			Kind: kind, RawInputID: input.ID,
		}); err != nil {
			t.Fatalf("queue replay: %v", err)
		}
		if _, err := fixture.service.ProcessNextReplay(ctx, "worker"); err != nil {
			t.Fatalf("run replay: %v", err)
		}
	}

	// Unchanged provider answer.
	queueReplay("revalidation")
	if got := fixture.attemptCount(t, ctx, input.ID); got != 2 {
		t.Fatalf("%d attempts after replay, want 2 — the replay appended no attempt", got)
	}
	if got := fixture.factCount(t, ctx, input.ID); got != 1 {
		t.Fatalf("%d facts after an unchanged replay, want 1 — the ledger was duplicated", got)
	}
	var comparison string
	var unchanged, newFacts int64
	if err := pool.QueryRow(ctx,
		`SELECT comparison_result, unchanged_count, new_fact_count FROM billing_replay_jobs
		 WHERE project_id=$1 ORDER BY created_at DESC LIMIT 1`, fixture.projectID).
		Scan(&comparison, &unchanged, &newFacts); err != nil {
		t.Fatal(err)
	}
	if comparison != "identical" || unchanged != 1 || newFacts != 0 {
		t.Fatalf("unchanged replay reported %q unchanged=%d new=%d", comparison, unchanged, newFacts)
	}

	// Changed provider answer: a different expiry moves the fact digest, so the
	// replay must report new_facts rather than identical.
	fixture.google.subscriptions[fixturePurchaseToken] =
		subscriptionPurchase(fixtureProviderProduct, fixtureOrderID, start, expiry.Add(24*time.Hour))
	queueReplay("revalidation")
	if got := fixture.attemptCount(t, ctx, input.ID); got != 3 {
		t.Fatalf("%d attempts after the second replay, want 3", got)
	}
	if got := fixture.factCount(t, ctx, input.ID); got != 2 {
		t.Fatalf("%d facts after a changed replay, want 2 — the new answer was not appended", got)
	}
	if err := pool.QueryRow(ctx,
		`SELECT comparison_result, unchanged_count, new_fact_count FROM billing_replay_jobs
		 WHERE project_id=$1 ORDER BY created_at DESC LIMIT 1`, fixture.projectID).
		Scan(&comparison, &unchanged, &newFacts); err != nil {
		t.Fatal(err)
	}
	if comparison != "new_facts" || newFacts != 1 {
		t.Fatalf("changed replay reported %q new=%d, want new_facts/1 — the comparison is not real", comparison, newFacts)
	}
}

// ---------------------------------------------------------------------------
// Defect 2
// ---------------------------------------------------------------------------

// google_token_requery reconciliation must actually call the Play API, and must
// examine only Google inputs.
//
// The defect this catches has two halves, and the test asserts both because
// fixing one without the other still produces a run that lies: the run reported
// success without making a single provider call, and it counted every Apple
// input in the same Environment and window as "examined" when none of them has a
// purchase token it could have re-queried.
func TestGoogleReconciliationRequeriesOnlyGoogleInputs(t *testing.T) {
	pool, ctx := testPool(t)
	fixture := newRevalidationFixture(t, ctx, pool, "recon")

	start := time.Now().Add(-48 * time.Hour).UTC().Truncate(time.Second)
	fixture.google.subscriptions[fixturePurchaseToken] =
		subscriptionPurchase(fixtureProviderProduct, fixtureOrderID, start, start.Add(30*24*time.Hour))

	googleInput := fixture.ingest(t, ctx, "bri_recon_google",
		billing.SourceGoogleRTDN, billing.AuthorityStoreNotification, fixture.credentialID,
		rtdnBody(fixturePackageName+"."+suffixOf(fixture.credentialID), fixtureProviderProduct, fixturePurchaseToken), true)
	if _, err := fixture.service.ProcessNextValidation(ctx, "worker"); err != nil {
		t.Fatal(err)
	}

	// An Apple input in the same Environment and window. A Google reconciliation
	// must not touch it.
	appleInput := sampleInput(fixture.projectID, fixture.environmentID, "", "recon-apple")
	appleInput.ID = "bri_recon_apple"
	appleInput.BodyState = "stored"
	appleBody := []byte(`{"signedPayload":"not-reachable-by-google-reconciliation"}`)
	appleEnvelope, err := fixture.cipher.EncryptSubject(appleBody, providercredential.SubjectScope{
		OrganizationID: fixture.organization, ProjectID: fixture.projectID,
		SubjectKind: providercredential.SubjectBillingRawInput, SubjectID: appleInput.ID,
		CredentialClass: billing.ClassBillingRawPayload,
	})
	if err != nil {
		t.Fatal(err)
	}
	appleInput.Envelope = &billing.Envelope{
		Version: appleEnvelope.Version, Algorithm: appleEnvelope.Algorithm, KeyID: appleEnvelope.KeyID,
		Nonce: appleEnvelope.Nonce, Ciphertext: appleEnvelope.Ciphertext, Fingerprint: appleEnvelope.Fingerprint,
	}
	if _, err := New(pool).PersistRawInput(ctx, appleInput, false, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}

	// A Google observation in the same window. It carries a token digest, which
	// cannot be reversed into the token the Play API needs, so a token re-query
	// must skip it rather than counting a guaranteed failure on every run.
	observationBody, _ := json.Marshal(map[string]string{
		"referenceKind": billing.ReferenceGooglePlayTokenDigest,
		"reference":     "0000000000000000000000000000000000000000000000000000000000000000",
	})
	observationInput := fixture.ingest(t, ctx, "bri_recon_observation",
		billing.SourceClientObservation, billing.AuthorityClient, "", observationBody, false)

	callsBefore := fixture.google.subscriptionCalls
	appleAttemptsBefore := fixture.attemptCount(t, ctx, appleInput.ID)
	observationAttemptsBefore := fixture.attemptCount(t, ctx, observationInput.ID)

	if _, err := fixture.service.CreateReconciliation(ctx, billing.Actor{ID: "actor_owner_recon"},
		billing.ReconciliationRun{
			ProjectID: fixture.projectID, EnvironmentID: fixture.environmentID,
			CredentialID: fixture.credentialID, Provider: billing.ProviderGooglePlay,
			Strategy:    "google_token_requery",
			WindowStart: time.Now().Add(-96 * time.Hour).UTC(),
			WindowEnd:   time.Now().Add(time.Hour).UTC(),
		}); err != nil {
		t.Fatalf("queue reconciliation: %v", err)
	}
	if _, err := fixture.service.ProcessNextReconciliation(ctx, "worker"); err != nil {
		t.Fatalf("run reconciliation: %v", err)
	}

	if got := fixture.google.subscriptionCalls - callsBefore; got != 1 {
		t.Fatalf("%d Play API lookups during reconciliation, want 1 — the run reported work it did not do", got)
	}
	if got := fixture.attemptCount(t, ctx, googleInput.ID); got != 2 {
		t.Fatalf("%d attempts on the Google input, want 2 — reconciliation appended none", got)
	}
	if got := fixture.attemptCount(t, ctx, appleInput.ID); got != appleAttemptsBefore {
		t.Fatalf("the Apple input gained %d attempts from a Google reconciliation",
			got-appleAttemptsBefore)
	}
	if got := fixture.attemptCount(t, ctx, observationInput.ID); got != observationAttemptsBefore {
		t.Fatalf("a digest-only observation gained %d attempts from a token re-query it can never satisfy",
			got-observationAttemptsBefore)
	}

	var examined, duplicate, discovered, failure int64
	var status string
	if err := pool.QueryRow(ctx,
		`SELECT status, examined_count, duplicate_count, discovered_count, failure_count
		 FROM billing_reconciliation_runs WHERE project_id=$1 AND strategy='google_token_requery'`,
		fixture.projectID).Scan(&status, &examined, &duplicate, &discovered, &failure); err != nil {
		t.Fatal(err)
	}
	if examined != 1 {
		t.Fatalf("examined_count=%d, want 1 — the provider filter is missing and Apple inputs were counted", examined)
	}
	if status != "completed" || duplicate != 1 || discovered != 0 || failure != 0 {
		t.Fatalf("run reported status=%q duplicate=%d discovered=%d failure=%d",
			status, duplicate, discovered, failure)
	}
}

// ---------------------------------------------------------------------------
// Defect 3
// ---------------------------------------------------------------------------

// An observation carries no credential of its own, and must still be validated
// against the credential its Environment scope has.
//
// The defect this catches made every observation quarantine as
// credential_unusable before its reference was ever read, which silently made
// the entire SDK-facing surface inert while the endpoint kept answering
// accepted_for_validation. The second half asserts the negative case reports the
// right thing: an Environment with no connection at all must say so, because
// "unusable" sends an operator to rotate a credential that does not exist.
func TestObservationValidatesAgainstEnvironmentScopedCredential(t *testing.T) {
	pool, ctx := testPool(t)
	fixture := newRevalidationFixture(t, ctx, pool, "obscred")

	start := time.Now().Add(-24 * time.Hour).UTC().Truncate(time.Second)
	fixture.google.subscriptions[fixturePurchaseToken] =
		subscriptionPurchase(fixtureProviderProduct, fixtureOrderID, start, start.Add(30*24*time.Hour))
	fixture.google.orders[fixtureOrderID] = googleplay.Order{
		OrderID: fixtureOrderID, PurchaseToken: fixturePurchaseToken, State: "PROCESSED",
	}

	// The body the service builds for an observation: a reference only, no
	// credential, no package name.
	body, _ := json.Marshal(map[string]string{
		"referenceKind":    billing.ReferenceGooglePlayOrderID,
		"reference":        fixtureOrderID,
		"orderReference":   fixtureOrderID,
		"purchaseToken":    "",
		"storeEnvironment": billing.StoreUnclassified,
	})
	input := fixture.ingest(t, ctx, "bri_observation_fixture",
		billing.SourceClientObservation, billing.AuthorityClient, "", body, true)

	if _, err := fixture.service.ProcessNextValidation(ctx, "worker"); err != nil {
		t.Fatalf("validate observation: %v", err)
	}

	var outcome, diagnostic, credentialID string
	if err := pool.QueryRow(ctx,
		`SELECT outcome, COALESCE(diagnostic_code,''), COALESCE(credential_id,'')
		 FROM billing_validation_attempts WHERE raw_input_id=$1`, input.ID).
		Scan(&outcome, &diagnostic, &credentialID); err != nil {
		t.Fatal(err)
	}
	if outcome != billing.OutcomeValidated {
		t.Fatalf("observation attempt outcome %q (%s), want validated — the credential gate still blocks observations",
			outcome, diagnostic)
	}
	if credentialID != fixture.credentialID {
		t.Fatalf("attempt recorded credential %q, want %q — provenance was not stamped",
			credentialID, fixture.credentialID)
	}
	if got := fixture.factCount(t, ctx, input.ID); got != 1 {
		t.Fatalf("%d facts from a validated observation, want 1", got)
	}
	if fixture.google.orderCalls != 1 {
		t.Fatalf("%d orders.get calls, want 1 — the order reference was never resolved", fixture.google.orderCalls)
	}

	// The negative case: an Environment with no credential must say exactly that.
	bare := newRevalidationFixture(t, ctx, pool, "nocred")
	if _, err := pool.Exec(ctx,
		`DELETE FROM store_server_credential_applications WHERE credential_id=$1`, bare.credentialID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM store_server_credentials WHERE id=$1`, bare.credentialID); err != nil {
		t.Fatal(err)
	}
	bareInput := bare.ingest(t, ctx, "bri_observation_nocred",
		billing.SourceClientObservation, billing.AuthorityClient, "", body, true)
	if _, err := bare.service.ProcessNextValidation(ctx, "worker"); err != nil {
		t.Fatal(err)
	}
	var reason, bareDiagnostic string
	if err := pool.QueryRow(ctx,
		`SELECT q.reason_code, COALESCE(q.diagnostic_code,'')
		 FROM billing_quarantine_records q WHERE q.raw_input_id=$1`, bareInput.ID).
		Scan(&reason, &bareDiagnostic); err != nil {
		t.Fatalf("no quarantine record for an observation with no credential: %v", err)
	}
	if reason != billing.QuarantineMissingCredential {
		t.Fatalf("quarantined as %q/%q, want %q — a missing connection is not a broken secret",
			reason, bareDiagnostic, billing.QuarantineMissingCredential)
	}
}

// T-6 — the trusted-server Google observation must reach a fact using the token
// it carried.
//
// This is the end-to-end half of BL-1, and it is the only server-actionable
// Google observation path: a client observation carries a digest, a digest
// cannot be reversed, and it correctly quarantines as `purchase_token_unavailable`
// until an RTDN arrives. The token travels handler -> Observation.PurchaseToken
// -> sealed raw body under the key "purchaseToken" -> decodeGoogleWork ->
// GetSubscription.
//
// Every link in that chain is a rename away from silently restoring BL-1 — every
// Google trusted observation dead-ending again — with a green suite, because
// nothing else asserts the token survives the round trip through encryption.
func TestTrustedServerObservationValidatesUsingItsPurchaseToken(t *testing.T) {
	pool, ctx := testPool(t)
	fixture := newRevalidationFixture(t, ctx, pool, "trustedtok")

	start := time.Now().Add(-24 * time.Hour).UTC().Truncate(time.Second)
	fixture.google.subscriptions[fixturePurchaseToken] =
		subscriptionPurchase(fixtureProviderProduct, fixtureOrderID, start, start.Add(30*24*time.Hour))

	// Exactly the body the service seals for a trusted-server observation: the
	// reference is the token's own digest, and the token itself rides alongside.
	digest := hexDigestOf(fixturePurchaseToken)
	body, _ := json.Marshal(map[string]string{
		"referenceKind":    billing.ReferenceGooglePlayTokenDigest,
		"reference":        digest,
		"orderReference":   "",
		"purchaseToken":    fixturePurchaseToken,
		"storeEnvironment": billing.StoreUnclassified,
	})
	input := fixture.ingest(t, ctx, "bri_trusted_token",
		billing.SourceTrustedServerObservation, billing.AuthorityTrustedServer, "", body, true)

	if _, err := fixture.service.ProcessNextValidation(ctx, "worker"); err != nil {
		t.Fatalf("validate trusted-server observation: %v", err)
	}

	var outcome, diagnostic string
	if err := pool.QueryRow(ctx,
		`SELECT outcome, COALESCE(diagnostic_code,'') FROM billing_validation_attempts WHERE raw_input_id=$1`,
		input.ID).Scan(&outcome, &diagnostic); err != nil {
		t.Fatal(err)
	}
	if outcome != billing.OutcomeValidated {
		t.Fatalf("trusted-server observation outcome %q (%s), want validated — the purchase token did not "+
			"survive the round trip through the sealed body, so BL-1 has regressed", outcome, diagnostic)
	}
	if got := fixture.factCount(t, ctx, input.ID); got != 1 {
		t.Fatalf("%d facts from a validated trusted-server observation, want 1", got)
	}
	// The token had to be used: no order id was supplied, so orders.get cannot
	// have stood in for it.
	if fixture.google.orderCalls != 0 {
		t.Fatalf("%d orders.get calls; the observation carried a token and needed none", fixture.google.orderCalls)
	}

	// The fact must carry the token's digest as the purchase chain, and the raw
	// token must not appear anywhere in the ledger or the fact row.
	var chainDigest []byte
	if err := pool.QueryRow(ctx,
		`SELECT purchase_chain_digest FROM billing_transaction_facts WHERE source_raw_input_id=$1`,
		input.ID).Scan(&chainDigest); err != nil {
		t.Fatal(err)
	}
	if hexOfBytes(chainDigest) != digest {
		t.Fatalf("fact chain digest %s, want %s", hexOfBytes(chainDigest), digest)
	}
	var leaked int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM billing_ledger_entries WHERE project_id=$1 AND detail::text LIKE '%'||$2||'%'`,
		fixture.projectID, fixturePurchaseToken).Scan(&leaked); err != nil {
		t.Fatal(err)
	}
	if leaked != 0 {
		t.Fatalf("the raw purchase token appears in %d ledger entries; it must never leave the sealed body", leaked)
	}
}

// T-3 — a wrong-Application input must quarantine.
//
// Tenant and Application isolation is the highest-value property of the intake
// design, and plan §13 names it: "wrong-application and wrong-environment inputs
// quarantine". The environment half is covered by
// TestSandboxFactCannotLandInProductionEnvironment; this is the application
// half. A regression in ApplicationForIdentifier or its wiring would attribute
// another Application's transaction to this credential's Application, silently.
func TestInputForAnUnscopedApplicationQuarantines(t *testing.T) {
	pool, ctx := testPool(t)
	fixture := newRevalidationFixture(t, ctx, pool, "wrongapp")

	start := time.Now().Add(-24 * time.Hour).UTC().Truncate(time.Second)
	fixture.google.subscriptions[fixturePurchaseToken] =
		subscriptionPurchase(fixtureProviderProduct, fixtureOrderID, start, start.Add(30*24*time.Hour))

	// The credential no longer scopes any Application, so the package name the
	// notification carries cannot be attributed.
	if _, err := pool.Exec(ctx,
		`DELETE FROM store_server_credential_applications WHERE credential_id=$1`, fixture.credentialID); err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]string{
		"referenceKind":    billing.ReferenceGooglePlayTokenDigest,
		"reference":        hexDigestOf(fixturePurchaseToken),
		"purchaseToken":    fixturePurchaseToken,
		"storeEnvironment": billing.StoreUnclassified,
	})
	input := fixture.ingest(t, ctx, "bri_wrong_application",
		billing.SourceTrustedServerObservation, billing.AuthorityTrustedServer, "", body, true)

	if _, err := fixture.service.ProcessNextValidation(ctx, "worker"); err != nil {
		t.Fatal(err)
	}

	var outcome string
	if err := pool.QueryRow(ctx,
		`SELECT outcome FROM billing_validation_attempts WHERE raw_input_id=$1`, input.ID).Scan(&outcome); err != nil {
		t.Fatal(err)
	}
	if outcome == billing.OutcomeValidated {
		t.Fatal("an input whose Application is not scoped to the credential produced a validated attempt; " +
			"that is a cross-Application attribution")
	}
	var reason string
	if err := pool.QueryRow(ctx,
		`SELECT reason_code FROM billing_quarantine_records WHERE raw_input_id=$1`, input.ID).Scan(&reason); err != nil {
		t.Fatalf("no quarantine record for an unscoped Application: %v", err)
	}
	if reason != billing.QuarantineApplicationMismatch && reason != billing.QuarantineMissingCredential {
		t.Fatalf("quarantined as %q; an unscoped Application must be reported as an attribution problem", reason)
	}
	if got := fixture.factCount(t, ctx, input.ID); got != 0 {
		t.Fatalf("%d facts recorded for an unattributable input, want 0", got)
	}
}

func hexDigestOf(token string) string { return hexOfBytes(billing.TokenDigest(token)) }

func hexOfBytes(value []byte) string {
	const digits = "0123456789abcdef"
	out := make([]byte, len(value)*2)
	for i, b := range value {
		out[i*2] = digits[b>>4]
		out[i*2+1] = digits[b&0x0f]
	}
	return string(out)
}
