//go:build billingdemo

// This command is excluded from every ordinary build.
//
// It constructs the real Mosaic router and the real billing service but injects
// a locally generated trust anchor through appstorejws.WithRoot, which is a
// verification seam that must never exist in a deployed image. cmd/api and
// cmd/worker call NewVerifier() with no options, so the seam is unreachable
// from the deployed path — but a buildable binary in the same module is one
// stray Dockerfile COPY away from being shipped. The tag makes that impossible
// rather than improbable:
//
//	DATABASE_URL=postgres://... go run -tags billingdemo ./cmd/billingdemo
//
// Command billingdemo drives the Phase 9A integrated provider demonstration
// against a real PostgreSQL database, the real Mosaic HTTP router, the real
// billing application service, and the real worker job functions.
//
// What is real: the schema and every constraint and append-only trigger in it;
// the chi router with its full middleware stack; every billing HTTP handler;
// the billing service, its encryption envelopes, its idempotency keys, its
// resolver, and its retry classifier; Mosaic's own App Store Server API and
// Google Play/Pub/Sub HTTP clients including the Google RS256 JWT-bearer
// assertion; and the five worker job entry points cmd/worker schedules.
//
// What is synthetic, and cannot be otherwise without a live store: the Apple
// signing chain (generated locally and injected through the verifier's
// documented WithRoot seam), the provider API responses (served by local stubs
// speaking the documented shapes), and the credential material.
//
// Usage:
//
//	DATABASE_URL=postgres://... go run -tags billingdemo ./cmd/billingdemo
//
// The command is destructive to the demo tenant it owns (org_demo9a) and
// touches nothing else.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingaccess"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingcustomer"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingdiagnostics"
	"github.com/Mujhtech/mosaic/apps/api/internal/billinggrant"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingoperator"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingrestore"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingwebhook"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/appstorejws"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/appstoreserver"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/authn"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingaccesspostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingcustomerpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingdiagnosticspostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billinggrantpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingkeys"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingoperatorpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingprojectionpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingrestorepostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingwebhookpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/googleplay"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/ratelimit"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
	billingoperatorhttp "github.com/Mujhtech/mosaic/apps/api/internal/transport/billingoperator"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "demonstration failed:", err)
		os.Exit(1)
	}
}

type demo struct {
	ctx     context.Context
	pool    *pgxpool.Pool
	service *billing.Service
	server  *httptest.Server
	// operatorServer carries the Phase 9B operator surface. See wire().
	operatorServer *httptest.Server

	apple  *appleStub
	play   *playStub
	pubsub *pubsubStub
	oauth  *oauthStub
	chain  demoChain

	publicKey apiKey
	serverKey apiKey

	appleCredentialID  string
	googleCredentialID string
	intakePath         string

	stepNumber int
	started    time.Time

	// Phase 9B services. They are the same constructions cmd/api and cmd/worker
	// perform; only the two substitutions named in wire() differ.
	projection  *billingprojection.Service
	identity    *billingcustomer.Service
	access      *billingaccess.Service
	grants      *billinggrant.Service
	webhooks    *billingwebhook.Service
	restores    *billingrestore.Service
	diagnostics *billingdiagnostics.Service
	operator    *billingoperator.Service

	tlsMaterial demoTLS
	destination *destinationStub

	// Phase 9B tenant credentials and run state.
	publicKey9B      apiKey
	serverKey9B      apiKey
	intakePath9B     string
	credentialID9B   string
	customerA        string
	customerB        string
	tokenA           string
	destinationID    string
	demoNumber       int
	oneMinute        bool
	scenarioBaseline time.Time
}

func run() error {
	phase := flag.String("phase", "9b", "which demonstration to run: 9a, 9b, all, or oneminute")
	flag.Parse()

	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	d := &demo{ctx: ctx, pool: pool, started: time.Now()}
	if err := d.wire(); err != nil {
		return err
	}
	defer d.server.Close()
	defer d.operatorServer.Close()
	defer d.destination.close()

	stages := []func() error(nil)
	switch *phase {
	case "9a":
		stages = d.stages9A()
	case "9b":
		stages = d.stages9B()
	case "all":
		stages = append(d.stages9A(), d.stages9B()...)
	case "oneminute":
		d.oneMinute = true
		stages = []func() error{d.stageOneMinute}
	default:
		return fmt.Errorf("unknown -phase %q", *phase)
	}
	for _, stage := range stages {
		if err := stage(); err != nil {
			return err
		}
	}
	fmt.Printf("\n=== demonstration complete in %s ===\n", time.Since(d.started).Round(time.Millisecond))
	return nil
}

func (d *demo) stages9A() []func() error {
	return []func() error{
		d.stageSetup,
		d.stageApple,
		d.stageGoogle,
		d.stageQuarantine,
		d.stageRetry,
		d.stageReconciliation,
		d.stageReplay,
		d.stageNoAccessState,
	}
}

// wire builds the real composition root with three deliberate substitutions,
// each named in the output so no reader can mistake one for production
// behaviour.
func (d *demo) wire() error {
	chain, err := newDemoChain()
	if err != nil {
		return err
	}
	d.chain = chain

	d.apple = newAppleStub()
	d.play = newPlayStub()
	d.pubsub = newPubSubStub()
	if d.oauth, err = newOAuthStub(); err != nil {
		return err
	}
	// Installed before googleplay.New, which clones http.DefaultTransport.
	d.oauth.install()

	keyring, err := newDemoKeyring()
	if err != nil {
		return err
	}
	cipher, err := providercredential.NewAESGCMCipher(keyring, rand.Reader)
	if err != nil {
		return err
	}

	// SUBSTITUTION 1: the verifier trusts a locally generated root instead of
	// the embedded Apple Root CA - G3. This is appstorejws' documented WithRoot
	// option, the same seam its unit tests use.
	verifier, err := appstorejws.NewVerifier(appstorejws.WithRoot(chain.root))
	if err != nil {
		return err
	}
	// SUBSTITUTION 2: the provider base URLs point at loopback stubs. These are
	// existing configuration knobs (MOSAIC_APPLE_STOREKIT_BASE_URL and friends);
	// the clients themselves are unmodified.
	appleClient, err := appstoreserver.New(appstoreserver.Config{
		ProductionBaseURL: d.apple.server.URL, SandboxBaseURL: d.apple.server.URL,
		RequestTimeout: 5 * time.Second,
	})
	if err != nil {
		return err
	}
	googleClient, err := googleplay.New(googleplay.Config{
		PlayBaseURL: d.play.server.URL, PubSubBaseURL: d.pubsub.server.URL,
		RequestTimeout: 5 * time.Second,
	})
	if err != nil {
		return err
	}

	d.service = billing.NewService(billingpostgres.New(d.pool), cipher, verifier,
		billing.WithProviders(appleClient, googleClient),
		billing.WithNotificationBaseURL(demoNotificationOrigin))

	// Phase 9B composition, identical to cmd/api's except that the webhook
	// policy is constructed with the self-hosted allowlist so a loopback
	// destination is permitted. HTTPS, certificate verification, redirect
	// refusal, resolve-and-pin, and the reserved-address screen are all
	// unchanged.
	if d.tlsMaterial, err = newDemoTLS(); err != nil {
		return err
	}
	d.destination = newDestinationStub(d.tlsMaterial)

	projectionRepository := billingprojectionpostgres.New(d.pool)
	d.projection = billingprojection.NewService(projectionRepository)
	keys := billingkeys.New(billingpostgres.New(d.pool))
	d.identity = billingcustomer.NewService(billingcustomerpostgres.New(d.pool), keys.Identity(), d.projection)
	d.access = billingaccess.NewService(
		billingaccesspostgres.New(d.pool),
		billingaccesspostgres.NewKeyAuthenticator(billingpostgres.New(d.pool)),
		billingaccess.WithIssuer("mosaic-billing-demo"))
	d.grants = billinggrant.NewService(billinggrantpostgres.New(d.pool))
	d.webhooks = billingwebhook.NewService(billingwebhookpostgres.New(d.pool), cipher,
		billingwebhook.NewPolicy(billingwebhook.WithSelfHostedAllowlist(true)))
	d.restores = billingrestore.NewService(billingrestorepostgres.New(d.pool), keys.Restore())
	d.diagnostics = billingdiagnostics.NewService(billingdiagnosticspostgres.New(d.pool),
		billingdiagnostics.WithReplay(d.projection, projectionRepository))
	d.operator = billingoperator.NewService(billingoperatorpostgres.New(d.pool),
		billingaccesspostgres.New(d.pool), d.identity)

	logger := zerolog.New(io.Discard)
	// SUBSTITUTION 3: the dashboard principal resolver returns a fixed actor
	// rather than validating a browser session cookie. Authorization is NOT
	// substituted: owner/admin membership is still enforced by the real
	// repository queries against the real organization_members row.
	resolver := authn.ResolverFunc(func(r *http.Request) (authn.Principal, error) {
		if r.Header.Get("X-Demo-Actor") == "" {
			return authn.Principal{}, authn.ErrUnauthenticated
		}
		return authn.Principal{ActorID: r.Header.Get("X-Demo-Actor"), Method: "demo", AuthenticatedAt: time.Now().UTC()}, nil
	})

	handler := httpserver.NewWithDependencies(httpserver.Config{
		ServiceName: "mosaic-billing-demo", RequestTimeout: 30 * time.Second,
		AllowedOrigins: []string{demoNotificationOrigin},
	}, logger, httpserver.Dependencies{
		PrincipalResolver: resolver,
		Billing:           d.service,
		BillingAccess:     d.access,
		BillingCustomer:   d.identity,
		BillingGrant:      d.grants,
		// BillingOperator is deliberately absent from this router. Registering it
		// beside Billing panics: internal/transport/billing/handler.go:87 and
		// internal/transport/billingoperator/handler.go:67 both call
		// router.Route("/environments/{environmentId}/billing", …) on the same
		// Project subrouter, and chi refuses to Mount twice on one path. cmd/api
		// passes both whenever MOSAIC_BILLING_ENABLED is set, so this is a
		// startup panic in the deployed composition, not a demo-only problem.
		// See docs/reviews/phase-9b-demo-evidence.md, defect D-3.
		BillingRestore:         d.restores,
		BillingWebhook:         d.webhooks,
		BillingDiagnostics:     d.diagnostics,
		BillingIPLimiter:       ratelimit.New(6000, 6000, 4096),
		BillingKeyLimiter:      ratelimit.New(6000, 6000, 4096),
		EntitlementSyncLimiter: ratelimit.New(6000, 6000, 4096),
		APILimiter:             ratelimit.New(6000, 6000, 4096),
		ExportLimiter:          ratelimit.New(6000, 6000, 4096),
	})
	d.server = httptest.NewServer(handler)

	// The operator surface gets its own minimal mux for the reason recorded
	// above. httpserver.NewWithDependencies cannot register BillingOperator at
	// all: the `/v1` subtree and the Project subtree it lives under are both
	// gated on Billing being non-nil, and Billing is exactly what it collides
	// with. Its handler, its ozzo validation, its application service, its
	// repository, and its authorization checks are all the real ones here; only
	// the mux and the middleware stack are the demo's.
	operatorRouter := chi.NewRouter()
	operatorRouter.Route("/v1", func(versioned chi.Router) {
		versioned.Group(func(authenticated chi.Router) {
			authenticated.Use(authn.Middleware(resolver))
			authenticated.Route("/projects/{projectId}", func(project chi.Router) {
				billingoperatorhttp.RegisterProjectRoutes(project, d.operator)
			})
		})
	})
	d.operatorServer = httptest.NewServer(operatorRouter)
	return nil
}

func newDemoKeyring() (string, error) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return "", err
	}
	return fmt.Sprintf(`{"version":1,"activeKeyId":"demo-2026-07","keys":{"demo-2026-07":%q}}`,
		base64.RawURLEncoding.EncodeToString(key)), nil
}

// ---------------------------------------------------------------------------
// Stage 0 — setup
// ---------------------------------------------------------------------------

func (d *demo) stageSetup() error {
	d.section("0", "Environment and tenant")
	publicKey, serverKey, err := seedTenant(d.ctx, d.pool)
	if err != nil {
		return err
	}
	d.publicKey, d.serverKey = publicKey, serverKey
	d.note("seeded %s / %s / %s (mode=production), applications %s (ios) and %s (android)",
		organizationID, projectID, environmentID, iosApplicationID, androidApplicationID)
	d.note("public SDK key %s.<redacted>, secret server key %s.<redacted>", publicKey.prefix, serverKey.prefix)
	d.query("provider product mappings seeded (iOS yearly deliberately absent)",
		`SELECT id, provider, provider_product_identifier, product_id, status
		 FROM provider_product_mappings WHERE project_id=$1 ORDER BY id`, projectID)

	d.step("Enable Mosaic Billing for the Project (off by default)")
	status, body := d.authed(http.MethodPut, "/v1/projects/"+projectID+"/billing/settings",
		map[string]any{"billingEnabled": true})
	d.http("PUT /v1/projects/{projectId}/billing/settings", status, body)
	return nil
}

// ---------------------------------------------------------------------------
// Stage 1 — Apple
// ---------------------------------------------------------------------------

func (d *demo) stageApple() error {
	d.section("1", "Apple flow")

	d.step("Create the Apple Store Server Credential (secret encrypted at rest)")
	secret, err := newApplePrivateKeyPEM()
	if err != nil {
		return err
	}
	status, body := d.authed(http.MethodPost, "/v1/projects/"+projectID+"/billing/store-credentials", map[string]any{
		"environmentId": environmentID, "provider": "app_store", "storeEnvironment": "production",
		"name": "Demo Apple team key", "secret": string(secret),
		"appleIssuerId": "57246542-96fe-1a63-e053-0824d011072a", "appleKeyId": "2X9R4HXF34",
		"applications": []map[string]string{{
			"applicationId": iosApplicationID, "platform": "ios", "providerApplicationIdentifier": appleBundleID,
		}},
	})
	d.http("POST /v1/projects/{projectId}/billing/store-credentials", status, redactEndpoint(body))
	if status != http.StatusCreated {
		return fmt.Errorf("apple credential create returned %d", status)
	}
	var created struct {
		Data struct {
			ID                      string `json:"id"`
			NotificationEndpointURL string `json:"notificationEndpointUrl"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(body), &created); err != nil {
		return err
	}
	d.appleCredentialID = created.Data.ID
	d.intakePath = strings.TrimPrefix(created.Data.NotificationEndpointURL, demoNotificationOrigin)
	if d.intakePath == "" {
		return errors.New("no notification endpoint URL was returned")
	}

	d.step("Prove the stored secret is ciphertext, not the PEM that was posted")
	d.query("store_server_credentials row",
		`SELECT id, provider, store_environment, status, algorithm, key_id,
		        octet_length(ciphertext) AS ciphertext_bytes,
		        encode(substring(ciphertext from 1 for 16),'hex') AS ciphertext_head,
		        (encode(ciphertext,'escape') LIKE '%PRIVATE KEY%') AS contains_pem_marker,
		        (intake_token_digest IS NOT NULL) AS has_intake_token_digest,
		        octet_length(intake_token_digest) AS intake_digest_bytes
		 FROM store_server_credentials WHERE id=$1`, d.appleCredentialID)
	d.query("the plaintext token is not stored anywhere on the row (column list)",
		`SELECT string_agg(column_name, ', ' ORDER BY ordinal_position) AS columns
		 FROM information_schema.columns WHERE table_name='store_server_credentials'`)

	d.step("Client observation through the public SDK endpoint (contract envelope)")
	status, body = d.public(http.MethodPost, "/v1/sdk/billing/observations", d.publicKey.raw, clientObservation(
		"obs_demo_apple_1", "sub_demo_apple_1", "apple_app_store",
		billing.ReferenceAppStoreTransactionID, appleTransactionID))
	d.http("POST /v1/sdk/billing/observations", status, body)

	d.step("Synthetic signed Apple notification through the intake endpoint")
	occurred := time.Now().Add(-2 * time.Minute).UTC()
	notification, err := d.chain.appleNotificationBody(appleNotificationUUID, appleTransactionID, appleMonthlyProductID, occurred)
	if err != nil {
		return err
	}
	signedTransaction, err := d.chain.signJWS(appleTransactionPayload(appleTransactionID, appleMonthlyProductID, occurred))
	if err != nil {
		return err
	}
	d.apple.addTransaction(appleTransactionID, signedTransaction)

	status, body = d.raw(http.MethodPost, d.intakePath, notification, nil)
	d.http("POST /v1/billing/apple/notifications/{intakeToken}", status, body)
	d.note("request body was %d bytes of signed JWS; it is not reproduced here", len(notification))
	d.query("raw billing input persisted, body encrypted",
		`SELECT id, provider, source, source_authority, authentication_result, store_environment,
		        notification_kind, notification_subtype, ingestion_status, body_state, algorithm,
		        octet_length(ciphertext) AS ciphertext_bytes,
		        encode(provider_event_id::bytea,'escape') AS provider_event_id
		 FROM billing_raw_inputs WHERE project_id=$1 AND provider='app_store' ORDER BY received_at`, projectID)
	d.query("validation job queued by intake (intake never validates inline)",
		`SELECT j.status, j.attempt_count, j.max_attempts, (j.available_at <= now()) AS available_now
		 FROM billing_validation_jobs j WHERE j.project_id=$1`, projectID)

	d.step("Run the validation worker job (billing.Service.ProcessNextValidation)")
	if err := d.drainValidation(4); err != nil {
		return err
	}
	d.note("Apple stub calls: %v", d.apple.callLog())
	d.query("transaction fact recorded and resolved to a Mosaic Product",
		`SELECT f.provider, f.store_environment, f.provider_transaction_id, f.provider_product_identifier,
		        f.transaction_type, f.fact_kind, f.resolution_state, f.mosaic_product_id,
		        f.provider_product_mapping_id, f.is_test_transaction, encode(f.fact_digest,'hex') AS fact_digest
		 FROM billing_transaction_facts f WHERE f.project_id=$1`, projectID)
	d.query("resolution snapshot records the exact mapping version used",
		`SELECT outcome, resolution_state, candidate_count, provider_product_identifier,
		        mosaic_product_id, provider_product_mapping_id, matched_mapping_id, mapping_version
		 FROM billing_product_resolutions WHERE project_id=$1`, projectID)

	d.step("Redeliver the identical notification (Apple retries on any non-2xx)")
	status, body = d.raw(http.MethodPost, d.intakePath, notification, nil)
	d.http("POST /v1/billing/apple/notifications/{intakeToken} (redelivery)", status, body)
	// Two Apple inputs and two jobs: the notification plus the client
	// observation from step 3, which is now validated in its own right. Two
	// facts for the same transaction, because the observation's normalized fact
	// carries no renewal expectation — see the note printed below.
	d.query("counts after the redelivery",
		`SELECT
		   (SELECT count(*) FROM billing_raw_inputs WHERE project_id=$1 AND provider='app_store') AS apple_inputs,
		   (SELECT count(*) FROM billing_transaction_facts WHERE project_id=$1) AS facts,
		   (SELECT count(*) FROM billing_validation_jobs WHERE project_id=$1) AS jobs,
		   (SELECT count(*) FROM billing_validation_attempts WHERE project_id=$1) AS attempts`, projectID)
	d.query("the notification produced exactly one input and one job on both deliveries",
		`SELECT i.source, count(DISTINCT i.id) AS inputs, count(DISTINCT j.id) AS jobs,
		        count(DISTINCT f.id) AS facts
		 FROM billing_raw_inputs i
		 LEFT JOIN billing_validation_jobs j ON j.raw_input_id=i.id
		 LEFT JOIN billing_transaction_facts f ON f.source_raw_input_id=i.id
		 WHERE i.project_id=$1 AND i.provider='app_store'
		 GROUP BY i.source ORDER BY i.source`, projectID)
	d.query("ledger entries for the Apple input",
		`SELECT entry_type, count(*) FROM billing_ledger_entries
		 WHERE project_id=$1 GROUP BY entry_type ORDER BY entry_type`, projectID)
	return nil
}

// ---------------------------------------------------------------------------
// Stage 2 — Google
// ---------------------------------------------------------------------------

func (d *demo) stageGoogle() error {
	d.section("2", "Google flow")

	d.step("Create the Google Store Server Credential")
	secret, err := newGoogleServiceAccountJSON(googleServiceAccount, pubSubProjectID)
	if err != nil {
		return err
	}
	status, body := d.authed(http.MethodPost, "/v1/projects/"+projectID+"/billing/store-credentials", map[string]any{
		"environmentId": environmentID, "provider": "google_play", "storeEnvironment": "production",
		"name": "Demo Play service account", "secret": string(secret),
		"googleClientEmail": googleServiceAccount, "googlePubSubProjectId": pubSubProjectID,
		"googlePubSubSubscriptionId": pubSubSubscriptionID,
		"applications": []map[string]string{{
			"applicationId": androidApplicationID, "platform": "android", "providerApplicationIdentifier": googlePackageName,
		}},
	})
	d.http("POST /v1/projects/{projectId}/billing/store-credentials", status, redactEndpoint(body))
	if status != http.StatusCreated {
		return fmt.Errorf("google credential create returned %d", status)
	}
	var created struct {
		Data struct {
			ID                      string `json:"id"`
			NotificationEndpointURL string `json:"notificationEndpointUrl"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(body), &created); err != nil {
		return err
	}
	d.googleCredentialID = created.Data.ID
	d.note("no notification endpoint URL is issued for Google (RTDN is pulled, not pushed): %q",
		created.Data.NotificationEndpointURL)

	d.step("Client observation carrying only the Google token digest")
	status, body = d.public(http.MethodPost, "/v1/sdk/billing/observations", d.publicKey.raw, clientObservation(
		"obs_demo_google_1", "sub_demo_google_1", "google_play",
		billing.ReferenceGooglePlayTokenDigest, hex.EncodeToString(billing.TokenDigest(googlePurchaseToken))))
	d.http("POST /v1/sdk/billing/observations", status, body)

	d.step("Publish an RTDN and run the pull consumer (billing.Service.ProcessNextRTDN)")
	d.play.setSubscription(googlePurchaseToken, googleSubscriptionPurchase(time.Now().Add(-3*time.Minute).UTC()))
	// The same encoded notification is reused for the redelivery below, because
	// Pub/Sub redelivers byte-identical content under a new ackId.
	rtdn := rtdnMessageData(googlePackageName, googleSubscriptionID, googlePurchaseToken, 4, time.Now().UTC())
	d.pubsub.enqueue("ack-demo-1", googleMessageID, rtdn, time.Now().UTC())

	processed, err := d.service.ProcessNextRTDN(d.ctx, "demo-worker")
	if err != nil {
		return err
	}
	pulls, acknowledged := d.pubsub.state()
	d.note("ProcessNextRTDN processed=%v; pub/sub pulls=%d acknowledged=%v; oauth exchanges=%d",
		processed, pulls, acknowledged, d.oauth.exchangeCount())
	d.query("RTDN persisted as a raw input, token never stored in the clear",
		`SELECT id, source, source_authority, authentication_result, store_environment, notification_kind,
		        ingestion_status, body_state, algorithm, octet_length(ciphertext) AS ciphertext_bytes,
		        encode(transaction_reference_digest,'hex') AS token_digest
		 FROM billing_raw_inputs WHERE project_id=$1 AND provider='google_play' ORDER BY received_at`, projectID)

	d.step("Validate the RTDN against the authoritative Play API lookup")
	if err := d.drainValidation(4); err != nil {
		return err
	}
	d.note("Play stub calls: %v", d.play.callLog())
	d.query("Google transaction fact",
		`SELECT provider, store_environment, provider_transaction_id, provider_product_identifier,
		        provider_base_plan_identifier, transaction_type, fact_kind, resolution_state,
		        mosaic_product_id, provider_product_mapping_id, is_test_transaction
		 FROM billing_transaction_facts WHERE project_id=$1 AND provider='google_play'`, projectID)

	d.step("Redeliver the byte-identical Pub/Sub message under a new ackId")
	d.pubsub.enqueue("ack-demo-2", googleMessageID, rtdn, time.Now().UTC())
	if _, err := d.service.ProcessNextRTDN(d.ctx, "demo-worker"); err != nil {
		return err
	}
	if err := d.drainValidation(4); err != nil {
		return err
	}
	_, acknowledged = d.pubsub.state()
	d.note("acknowledged ack ids: %v (the redelivery is acknowledged, not re-ingested)", acknowledged)
	d.query("one RTDN input, one Google fact, one duplicate ledger entry for the redelivery",
		`SELECT
		   (SELECT count(*) FROM billing_raw_inputs WHERE project_id=$1 AND provider='google_play' AND source='google_rtdn') AS rtdn_inputs,
		   (SELECT count(*) FROM billing_transaction_facts WHERE project_id=$1 AND provider='google_play') AS google_facts,
		   (SELECT count(*) FROM billing_ledger_entries l JOIN billing_raw_inputs i ON i.id=l.raw_input_id
		     WHERE l.entry_type='input_duplicate_detected' AND i.source='google_rtdn') AS rtdn_duplicate_entries`,
		projectID)

	d.step("Observation-sourced inputs: the credential is resolved from the Environment scope")
	d.query("every observation input, the credential its attempt resolved, and the outcome",
		`SELECT i.provider, i.provider_event_id,
		        COALESCE(i.credential_id,'(none on input)') AS input_credential_id,
		        COALESCE(a.credential_id,'(none)') AS resolved_credential_id,
		        a.outcome, COALESCE(a.diagnostic_code,'') AS diagnostic_code
		 FROM billing_raw_inputs i
		 LEFT JOIN billing_validation_attempts a ON a.raw_input_id=i.id
		 WHERE i.project_id=$1 AND i.source='client_observation'
		 ORDER BY i.received_at`, projectID)
	d.query("the fact the Apple client observation produced on its own",
		`SELECT f.provider, f.provider_transaction_id, f.provider_product_identifier,
		        f.resolution_state, f.mosaic_product_id, f.renewal_expected,
		        encode(f.fact_digest,'hex') AS fact_digest
		 FROM billing_transaction_facts f
		 JOIN billing_raw_inputs i ON i.id=f.source_raw_input_id
		 WHERE i.source='client_observation' AND i.project_id=$1`, projectID)
	return nil
}

// ---------------------------------------------------------------------------
// Stage 3 — quarantine and repair
// ---------------------------------------------------------------------------

func (d *demo) stageQuarantine() error {
	d.section("3", "Quarantine: authentic transaction, unmapped provider Product")

	d.step("Deliver a valid notification for com.mosaic.demo.pro.yearly, which has no mapping")
	occurred := time.Now().Add(-90 * time.Second).UTC()
	notification, err := d.chain.appleNotificationBody(appleYearlyNotificationUUID, appleYearlyTransactionID, appleYearlyProductID, occurred)
	if err != nil {
		return err
	}
	signed, err := d.chain.signJWS(appleTransactionPayload(appleYearlyTransactionID, appleYearlyProductID, occurred))
	if err != nil {
		return err
	}
	d.apple.addTransaction(appleYearlyTransactionID, signed)
	status, body := d.raw(http.MethodPost, d.intakePath, notification, nil)
	d.http("POST /v1/billing/apple/notifications/{intakeToken}", status, body)

	if err := d.drainValidation(4); err != nil {
		return err
	}
	d.query("authenticity verified, resolution failed",
		`SELECT a.attempt_number, a.outcome, a.failure_category, a.diagnostic_code, a.store_environment
		 FROM billing_validation_attempts a
		 JOIN billing_raw_inputs i ON i.id=a.raw_input_id
		 WHERE i.provider_event_id=$1 ORDER BY a.attempt_number`, appleYearlyNotificationUUID)
	d.query("quarantine record created",
		`SELECT q.id, q.reason_code, q.severity, q.status, q.diagnostic_code, q.scopes
		 FROM billing_quarantine_records q
		 JOIN billing_raw_inputs i ON i.id=q.raw_input_id
		 WHERE i.provider_event_id=$1`, appleYearlyNotificationUUID)
	d.query("the fact is still recorded, marked unresolved — evidence is never discarded",
		`SELECT provider_product_identifier, resolution_state, COALESCE(mosaic_product_id,'(none)') AS mosaic_product_id
		 FROM billing_transaction_facts WHERE provider_transaction_id=$1`, appleYearlyTransactionID)

	d.step("Operator repair: create the missing Provider Product Mapping")
	if err := addAppleYearlyMapping(d.ctx, d.pool); err != nil {
		return err
	}
	d.note("inserted %s → %s", appleYearlyMapping, mosaicYearlyProduct)

	d.step("Re-run validation through the quarantine retry endpoint")
	recordID, err := d.quarantineRecordFor(appleYearlyNotificationUUID)
	if err != nil {
		return err
	}
	status, body = d.authed(http.MethodPost,
		"/v1/projects/"+projectID+"/billing/quarantine/"+recordID+"/retry", nil)
	d.http("POST /v1/projects/{projectId}/billing/quarantine/{recordId}/retry", status, body)
	if err := d.drainValidation(4); err != nil {
		return err
	}
	d.query("attempt history is append-only: the failed attempt is still there",
		`SELECT a.attempt_number, a.outcome, COALESCE(a.diagnostic_code,'') AS diagnostic_code
		 FROM billing_validation_attempts a
		 JOIN billing_raw_inputs i ON i.id=a.raw_input_id
		 WHERE i.provider_event_id=$1 ORDER BY a.attempt_number`, appleYearlyNotificationUUID)
	d.query("the original raw input is unchanged and its encrypted body is still present",
		`SELECT id, ingestion_status, body_state, algorithm, octet_length(ciphertext) AS ciphertext_bytes,
		        received_at, envelope_rotated_at
		 FROM billing_raw_inputs WHERE provider_event_id=$1`, appleYearlyNotificationUUID)
	d.query("facts for the yearly transaction, before and after the repair",
		`SELECT resolution_state, COALESCE(mosaic_product_id,'(none)') AS mosaic_product_id,
		        COALESCE(provider_product_mapping_id,'(none)') AS mapping_id, recorded_at
		 FROM billing_transaction_facts WHERE provider_transaction_id=$1 ORDER BY recorded_at`,
		appleYearlyTransactionID)
	d.query("quarantine record and its action audit",
		`SELECT q.status, q.reason_code, COALESCE(q.closing_attempt_id,'(open)') AS closing_attempt_id,
		        (SELECT string_agg(action||'/'||outcome, ', ') FROM billing_quarantine_actions
		         WHERE quarantine_record_id=q.id) AS actions
		 FROM billing_quarantine_records q WHERE q.id=$1`, recordID)
	return nil
}

// ---------------------------------------------------------------------------
// Stage 4 — retry
// ---------------------------------------------------------------------------

func (d *demo) stageRetry() error {
	d.section("4", "Retry: provider outage, then recovery")

	d.step("Point the Apple stub at a 503 and deliver a new notification")
	occurred := time.Now().Add(-60 * time.Second).UTC()
	notification, err := d.chain.appleNotificationBody(appleRetryNotificationUUID, appleRetryTransactionID, appleMonthlyProductID, occurred)
	if err != nil {
		return err
	}
	signed, err := d.chain.signJWS(appleTransactionPayload(appleRetryTransactionID, appleMonthlyProductID, occurred))
	if err != nil {
		return err
	}
	d.apple.addTransaction(appleRetryTransactionID, signed)
	d.apple.setFailure(http.StatusServiceUnavailable)

	status, body := d.raw(http.MethodPost, d.intakePath, notification, nil)
	d.http("POST /v1/billing/apple/notifications/{intakeToken}", status, body)
	if _, err := d.service.ProcessNextValidation(d.ctx, "demo-worker"); err != nil {
		return err
	}
	d.query("retryable attempt recorded, no fact",
		`SELECT a.attempt_number, a.outcome, a.retryable, a.failure_category, a.diagnostic_code,
		        a.provider_http_status, COALESCE(a.provider_code,'') AS provider_code
		 FROM billing_validation_attempts a
		 JOIN billing_raw_inputs i ON i.id=a.raw_input_id
		 WHERE i.provider_event_id=$1 ORDER BY a.attempt_number`, appleRetryNotificationUUID)
	d.query("the job is queued again with backoff, not failed",
		`SELECT j.status, j.attempt_count, (j.available_at > now()) AS scheduled_in_future,
		        round(extract(epoch from (j.available_at - now())))::text AS seconds_until_available
		 FROM billing_validation_jobs j
		 JOIN billing_raw_inputs i ON i.id=j.raw_input_id
		 WHERE i.provider_event_id=$1`, appleRetryNotificationUUID)

	d.step("Recover the stub and wait for the scheduled retry")
	d.apple.setFailure(0)
	waited, err := d.waitForJob(appleRetryNotificationUUID, 90*time.Second)
	if err != nil {
		return err
	}
	d.note("retry became available after %s of real elapsed time; no clock was manipulated", waited.Round(time.Second))
	if err := d.drainValidation(4); err != nil {
		return err
	}
	d.query("the failed attempt is preserved beside the successful one",
		`SELECT a.attempt_number, a.outcome, COALESCE(a.diagnostic_code,'') AS diagnostic_code, a.latency_ms
		 FROM billing_validation_attempts a
		 JOIN billing_raw_inputs i ON i.id=a.raw_input_id
		 WHERE i.provider_event_id=$1 ORDER BY a.attempt_number`, appleRetryNotificationUUID)
	d.query("fact recorded on the retry",
		`SELECT provider_transaction_id, resolution_state, mosaic_product_id, fact_kind
		 FROM billing_transaction_facts WHERE provider_transaction_id=$1`, appleRetryTransactionID)
	return nil
}

// ---------------------------------------------------------------------------
// Stage 5 — reconciliation
// ---------------------------------------------------------------------------

func (d *demo) stageReconciliation() error {
	d.section("5", "Reconciliation: a notification Mosaic never received")

	d.step("Build a notification and deliberately NOT deliver it to the intake endpoint")
	occurred := time.Now().Add(-45 * time.Second).UTC()
	notification, err := d.chain.appleNotificationBody(appleMissedNotificationUUID, appleMissedTransactionID, appleMonthlyProductID, occurred)
	if err != nil {
		return err
	}
	signed, err := d.chain.signJWS(appleTransactionPayload(appleMissedTransactionID, appleMonthlyProductID, occurred))
	if err != nil {
		return err
	}
	d.apple.addTransaction(appleMissedTransactionID, signed)

	var envelope struct {
		SignedPayload string `json:"signedPayload"`
	}
	if err := json.Unmarshal([]byte(notification), &envelope); err != nil {
		return err
	}
	// Apple's Get Notification History will report it as a failed delivery.
	d.apple.setHistory(envelope.SignedPayload)
	d.query("Mosaic has no input for this notification UUID",
		`SELECT count(*) AS inputs FROM billing_raw_inputs WHERE provider_event_id=$1`, appleMissedNotificationUUID)

	d.step("Queue a reconciliation run (apple_notification_history)")
	status, body := d.authed(http.MethodPost,
		"/v1/projects/"+projectID+"/environments/"+environmentID+"/billing/reconciliation-runs", map[string]any{
			"credentialId": d.appleCredentialID, "provider": "app_store",
			"strategy":    "apple_notification_history",
			"windowStart": time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339),
			"windowEnd":   time.Now().Add(time.Minute).UTC().Format(time.RFC3339),
		})
	d.http("POST .../billing/reconciliation-runs", status, body)

	d.step("Run the reconciliation worker job")
	processed, err := d.service.ProcessNextReconciliation(d.ctx, "demo-worker")
	if err != nil {
		return err
	}
	d.note("ProcessNextReconciliation processed=%v", processed)
	d.query("run summary recorded",
		`SELECT strategy, trigger, status, examined_count, discovered_count, duplicate_count, failure_count,
		        COALESCE(last_error_code,'') AS last_error_code, started_at IS NOT NULL AS started, completed_at IS NOT NULL AS completed
		 FROM billing_reconciliation_runs WHERE project_id=$1`, projectID)
	d.query("the missed notification was discovered and ingested through the same pipeline",
		`SELECT id, source, source_authority, authentication_result, ingestion_status, body_state, correlation_id
		 FROM billing_raw_inputs WHERE provider_event_id=$1`, appleMissedNotificationUUID)

	d.step("Validate the discovered input")
	if err := d.drainValidation(4); err != nil {
		return err
	}
	d.query("fact recorded from the recovered notification",
		`SELECT provider_transaction_id, resolution_state, mosaic_product_id, fact_kind
		 FROM billing_transaction_facts WHERE provider_transaction_id=$1`, appleMissedTransactionID)

	d.step("Run reconciliation again over the same window (idempotency)")
	status, body = d.authed(http.MethodPost,
		"/v1/projects/"+projectID+"/environments/"+environmentID+"/billing/reconciliation-runs", map[string]any{
			"credentialId": d.appleCredentialID, "provider": "app_store",
			"strategy":    "apple_notification_history",
			"windowStart": time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339),
			"windowEnd":   time.Now().Add(time.Minute).UTC().Format(time.RFC3339),
		})
	d.http("POST .../billing/reconciliation-runs (second run)", status, body)
	if _, err := d.service.ProcessNextReconciliation(d.ctx, "demo-worker"); err != nil {
		return err
	}
	d.query("second run reports the item as a duplicate, not a discovery",
		`SELECT status, examined_count, discovered_count, duplicate_count
		 FROM billing_reconciliation_runs WHERE project_id=$1 ORDER BY created_at`, projectID)
	d.query("still one input and one fact for the recovered notification",
		`SELECT (SELECT count(*) FROM billing_raw_inputs WHERE provider_event_id=$1) AS inputs,
		        (SELECT count(*) FROM billing_transaction_facts WHERE provider_transaction_id=$2) AS facts`,
		appleMissedNotificationUUID, appleMissedTransactionID)

	d.step("The other wired strategy: google_token_requery")
	var attemptsBefore int
	if err := d.pool.QueryRow(d.ctx,
		`SELECT count(*) FROM billing_validation_attempts WHERE project_id=$1`, projectID).Scan(&attemptsBefore); err != nil {
		return err
	}
	status, body = d.authed(http.MethodPost,
		"/v1/projects/"+projectID+"/environments/"+environmentID+"/billing/reconciliation-runs", map[string]any{
			"credentialId": d.googleCredentialID, "provider": "google_play",
			"strategy":    "google_token_requery",
			"windowStart": time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339),
			"windowEnd":   time.Now().Add(time.Minute).UTC().Format(time.RFC3339),
		})
	d.http("POST .../billing/reconciliation-runs (google_token_requery)", status, body)
	playCallsBefore := len(d.play.callLog())
	if _, err := d.service.ProcessNextReconciliation(d.ctx, "demo-worker"); err != nil {
		return err
	}
	d.query("google_token_requery run summary",
		`SELECT strategy, status, examined_count, discovered_count, duplicate_count, failure_count
		 FROM billing_reconciliation_runs WHERE project_id=$1 AND strategy='google_token_requery'`, projectID)
	var attemptsAfter int
	if err := d.pool.QueryRow(d.ctx,
		`SELECT count(*) FROM billing_validation_attempts WHERE project_id=$1`, projectID).Scan(&attemptsAfter); err != nil {
		return err
	}
	d.note("validation attempts before the run: %d; after: %d (+%d)",
		attemptsBefore, attemptsAfter, attemptsAfter-attemptsBefore)
	d.note("Play API calls before the run: %d; after: %d (+%d)",
		playCallsBefore, len(d.play.callLog()), len(d.play.callLog())-playCallsBefore)
	d.query("the run re-queried only Google inputs, and appended an attempt to each",
		`SELECT i.provider, i.source, count(a.id) AS attempts
		 FROM billing_raw_inputs i
		 LEFT JOIN billing_validation_attempts a ON a.raw_input_id=i.id
		 WHERE i.project_id=$1 GROUP BY i.provider, i.source ORDER BY i.provider, i.source`, projectID)
	return nil
}

// ---------------------------------------------------------------------------
// Stage 6 — replay
// ---------------------------------------------------------------------------

func (d *demo) stageReplay() error {
	d.section("6", "Replay / revalidation of a prior Raw Billing Input")

	rawInputID, err := d.rawInputFor(appleNotificationUUID)
	if err != nil {
		return err
	}
	d.note("replaying %s (the Apple notification from stage 1)", rawInputID)
	d.query("state before replay",
		`SELECT (SELECT count(*) FROM billing_validation_attempts WHERE raw_input_id=$1) AS attempts,
		        (SELECT count(*) FROM billing_transaction_facts WHERE source_raw_input_id=$1) AS facts,
		        (SELECT count(*) FROM billing_transaction_facts WHERE project_id=$2) AS facts_total`,
		rawInputID, projectID)

	d.step("Queue a replay job through the API")
	status, body := d.authed(http.MethodPost,
		"/v1/projects/"+projectID+"/environments/"+environmentID+"/billing/replay-jobs", map[string]any{
			"kind": "revalidation", "rawInputId": rawInputID,
		})
	d.http("POST .../billing/replay-jobs", status, body)

	d.step("Run the replay worker job, then drain validation")
	processed, err := d.service.ProcessNextReplay(d.ctx, "demo-worker")
	if err != nil {
		return err
	}
	d.note("ProcessNextReplay processed=%v", processed)
	d.query("replay job summary",
		`SELECT kind, status, validator_version, examined_count, unchanged_count, new_fact_count,
		        conflict_count, COALESCE(comparison_result,'') AS comparison_result
		 FROM billing_replay_jobs WHERE project_id=$1`, projectID)
	d.note("Apple stub calls during the replay: %d total (the replay really re-read the store)", len(d.apple.callLog()))
	d.query("state after replay",
		`SELECT (SELECT count(*) FROM billing_validation_attempts WHERE raw_input_id=$1) AS attempts,
		        (SELECT count(*) FROM billing_transaction_facts WHERE source_raw_input_id=$1) AS facts,
		        (SELECT count(*) FROM billing_transaction_facts WHERE project_id=$2) AS facts_total`,
		rawInputID, projectID)
	d.query("attempt history for the replayed input — appended, never rewritten",
		`SELECT attempt_number, outcome, validator_version, started_at
		 FROM billing_validation_attempts WHERE raw_input_id=$1 ORDER BY attempt_number`, rawInputID)
	d.query("the replayed attempt recomputed the identical fact digest, so nothing was appended",
		`SELECT encode(fact_digest,'hex') AS fact_digest, resolution_state, mosaic_product_id, recorded_at
		 FROM billing_transaction_facts WHERE source_raw_input_id=$1 ORDER BY recorded_at`, rawInputID)
	d.query("the deduplication is recorded rather than silent",
		`SELECT entry_type, count(*) FROM billing_ledger_entries
		 WHERE raw_input_id=$1 GROUP BY entry_type ORDER BY entry_type`, rawInputID)
	return nil
}

// ---------------------------------------------------------------------------
// Stage 7 — no customer-access state exists
// ---------------------------------------------------------------------------

func (d *demo) stageNoAccessState() error {
	d.section("7", "No customer-access or entitlement state exists")

	d.query("tables whose name suggests customer access, entitlement state, or a subscriber record",
		`SELECT table_name FROM information_schema.tables
		 WHERE table_schema='public' AND (
		    table_name ILIKE '%customer%' OR table_name ILIKE '%subscriber%' OR
		    table_name ILIKE '%access_grant%' OR table_name ILIKE '%entitlement_state%' OR
		    table_name ILIKE '%subscription_state%' OR table_name ILIKE '%user_entitlement%' OR
		    table_name ILIKE '%revenuecat_migration%')
		 ORDER BY table_name`)
	d.query("every table whose name contains 'entitlement' (Phase 3A catalog definitions only)",
		`SELECT t.table_name, string_agg(c.column_name, ', ' ORDER BY c.ordinal_position) AS columns
		 FROM information_schema.tables t
		 JOIN information_schema.columns c ON c.table_name=t.table_name AND c.table_schema=t.table_schema
		 WHERE t.table_schema='public' AND t.table_name ILIKE '%entitlement%'
		 GROUP BY t.table_name ORDER BY t.table_name`)
	d.query("no billing table carries a customer identity, a price, or a currency",
		`SELECT table_name, column_name FROM information_schema.columns
		 WHERE table_schema='public' AND table_name LIKE 'billing_%' AND (
		    column_name ILIKE '%customer%' OR column_name ILIKE '%subscriber%' OR
		    column_name ILIKE '%user_id%' OR column_name ILIKE '%account_token%' OR
		    column_name ILIKE '%price%' OR column_name ILIKE '%currency%' OR
		    column_name ILIKE '%amount%' OR column_name ILIKE '%email%')
		 ORDER BY table_name, column_name`)
	d.query("every billing table created by Phase 9A",
		`SELECT table_name FROM information_schema.tables
		 WHERE table_schema='public' AND (table_name LIKE 'billing_%' OR table_name LIKE 'store_server_%')
		 ORDER BY table_name`)
	return nil
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const (
	appleTransactionID    = "2000000512345671"
	appleNotificationUUID = "8f2c1a4e-1111-4a1b-9c11-demo00000001"

	appleYearlyTransactionID    = "2000000512345672"
	appleYearlyNotificationUUID = "8f2c1a4e-2222-4a1b-9c11-demo00000002"

	appleRetryTransactionID    = "2000000512345673"
	appleRetryNotificationUUID = "8f2c1a4e-3333-4a1b-9c11-demo00000003"

	appleMissedTransactionID    = "2000000512345674"
	appleMissedNotificationUUID = "8f2c1a4e-4444-4a1b-9c11-demo00000004"

	googlePurchaseToken = "demo.AO-J1OxSyntheticPurchaseToken.0000000000000001"
	googleMessageID     = "8123456789012345"
)

func googleSubscriptionPurchase(start time.Time) map[string]any {
	return map[string]any{
		"kind":              "androidpublisher#subscriptionPurchaseV2",
		"regionCode":        "US",
		"startTime":         start.Format(time.RFC3339),
		"subscriptionState": "SUBSCRIPTION_STATE_ACTIVE",
		"latestOrderId":     "GPA.0000-0000-0000-00001",
		"lineItems": []map[string]any{{
			"productId":        googleSubscriptionID,
			"expiryTime":       start.Add(30 * 24 * time.Hour).Format(time.RFC3339),
			"offerDetails":     map[string]any{"basePlanId": googleBasePlanID},
			"autoRenewingPlan": map[string]any{"autoRenewEnabled": true},
		}},
		"acknowledgementState": "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
	}
}

// clientObservation builds the Billing Ingestion Contract v1 client record. It
// is written out longhand rather than generated so the evidence document can
// show exactly what an SDK sends.
func clientObservation(observationID, submissionID, platform, referenceKind, reference string) map[string]any {
	return map[string]any{
		"billingIngestionContractVersion": "1",
		"recordType":                      "clientTransactionObservation",
		"payload": map[string]any{
			"observationId":        observationID,
			"submissionId":         submissionID,
			"providerId":           platform,
			"storePlatform":        platform,
			"transactionReference": map[string]string{"referenceKind": referenceKind, "value": reference},
			"observedAt":           time.Now().UTC().Format("2006-01-02T15:04:05Z"),
			"sourceAuthority":      "client_observation",
			"context": map[string]string{
				"platform": "ios", "sdkFamily": "mosaic-ios", "sdkVersion": "1.0.0",
			},
		},
	}
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

// drainValidation runs the same job function cmd/worker's billing_validation
// family runs, until the queue reports nothing available.
func (d *demo) drainValidation(limit int) error {
	for index := 0; index < limit; index++ {
		processed, err := d.service.ProcessNextValidation(d.ctx, "demo-worker")
		if err != nil {
			return err
		}
		if !processed {
			return nil
		}
	}
	return nil
}

func (d *demo) waitForJob(notificationUUID string, budget time.Duration) (time.Duration, error) {
	started := time.Now()
	for time.Since(started) < budget {
		var available bool
		err := d.pool.QueryRow(d.ctx,
			`SELECT j.available_at <= now() FROM billing_validation_jobs j
			 JOIN billing_raw_inputs i ON i.id=j.raw_input_id
			 WHERE i.provider_event_id=$1`, notificationUUID).Scan(&available)
		if err != nil {
			return 0, err
		}
		if available {
			return time.Since(started), nil
		}
		time.Sleep(time.Second)
	}
	return 0, fmt.Errorf("retry for %s did not become available within %s", notificationUUID, budget)
}

func (d *demo) quarantineRecordFor(notificationUUID string) (string, error) {
	var id string
	err := d.pool.QueryRow(d.ctx,
		`SELECT q.id FROM billing_quarantine_records q
		 JOIN billing_raw_inputs i ON i.id=q.raw_input_id
		 WHERE i.provider_event_id=$1 ORDER BY q.first_seen_at DESC LIMIT 1`, notificationUUID).Scan(&id)
	return id, err
}

func (d *demo) rawInputFor(notificationUUID string) (string, error) {
	var id string
	err := d.pool.QueryRow(d.ctx,
		`SELECT id FROM billing_raw_inputs WHERE provider_event_id=$1`, notificationUUID).Scan(&id)
	return id, err
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

func (d *demo) authed(method, path string, body any) (int, string) {
	return d.raw(method, path, encode(body), map[string]string{"X-Demo-Actor": ownerActorID})
}

func (d *demo) public(method, path, key string, body any) (int, string) {
	return d.raw(method, path, encode(body), map[string]string{"Authorization": "Bearer " + key})
}

func (d *demo) raw(method, path, body string, headers map[string]string) (int, string) {
	var reader io.Reader
	if body != "" {
		reader = bytes.NewReader([]byte(body))
	}
	request, err := http.NewRequestWithContext(d.ctx, method, d.server.URL+path, reader)
	if err != nil {
		return 0, err.Error()
	}
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	response, err := d.server.Client().Do(request)
	if err != nil {
		return 0, err.Error()
	}
	defer func() { _ = response.Body.Close() }()
	payload, _ := io.ReadAll(response.Body)
	return response.StatusCode, strings.TrimSpace(string(payload))
}

func encode(body any) string {
	if body == nil {
		return ""
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return ""
	}
	return string(encoded)
}

// redactEndpoint removes the one-time intake token from a credential response.
// The token is an unauthenticated bearer value in a URL path; it must not reach
// an evidence document.
func redactEndpoint(body string) string {
	const marker = `"notificationEndpointUrl":"`
	index := strings.Index(body, marker)
	if index < 0 {
		return body
	}
	rest := body[index+len(marker):]
	end := strings.Index(rest, `"`)
	if end < 0 {
		return body
	}
	url := rest[:end]
	cut := strings.LastIndex(url, "/")
	if cut < 0 {
		return body
	}
	return body[:index+len(marker)] + url[:cut+1] + "<INTAKE-TOKEN-REDACTED>" + body[index+len(marker)+end:]
}

// ---------------------------------------------------------------------------
// Evidence printing
// ---------------------------------------------------------------------------

func (d *demo) section(number, title string) {
	fmt.Printf("\n\n########## STAGE %s — %s ##########\n", number, title)
	d.stepNumber = 0
}

func (d *demo) step(title string) {
	d.stepNumber++
	fmt.Printf("\n--- step %d: %s\n", d.stepNumber, title)
}

func (d *demo) note(format string, args ...any) {
	fmt.Printf("    note: "+format+"\n", args...)
}

func (d *demo) http(label string, status int, body string) {
	fmt.Printf("    HTTP %s -> %d\n", label, status)
	fmt.Printf("    %s\n", body)
}

// query runs a read and prints it as an aligned table. Every value printed here
// comes straight out of PostgreSQL; nothing is reformatted beyond alignment.
func (d *demo) query(label, sql string, args ...any) {
	fmt.Printf("    SQL: %s\n", label)
	rows, err := d.pool.Query(d.ctx, sql, args...)
	if err != nil {
		fmt.Printf("      ERROR: %v\n", err)
		return
	}
	defer rows.Close()
	descriptions := rows.FieldDescriptions()
	headers := make([]string, len(descriptions))
	for index, description := range descriptions {
		headers[index] = description.Name
	}
	table := [][]string{headers}
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			fmt.Printf("      ERROR: %v\n", err)
			return
		}
		record := make([]string, len(values))
		for index, value := range values {
			record[index] = render(value)
		}
		table = append(table, record)
	}
	if err := rows.Err(); err != nil {
		fmt.Printf("      ERROR: %v\n", err)
		return
	}
	if len(table) == 1 {
		fmt.Printf("      (no rows)\n")
		return
	}
	widths := make([]int, len(headers))
	for _, record := range table {
		for index, cell := range record {
			if len(cell) > widths[index] {
				widths[index] = len(cell)
			}
		}
	}
	for rowIndex, record := range table {
		cells := make([]string, len(record))
		for index, cell := range record {
			cells[index] = cell + strings.Repeat(" ", widths[index]-len(cell))
		}
		fmt.Printf("      %s\n", strings.TrimRight(strings.Join(cells, " | "), " "))
		if rowIndex == 0 {
			separators := make([]string, len(widths))
			for index, width := range widths {
				separators[index] = strings.Repeat("-", width)
			}
			fmt.Printf("      %s\n", strings.Join(separators, "-+-"))
		}
	}
}

func render(value any) string {
	switch typed := value.(type) {
	case nil:
		return "NULL"
	case []byte:
		return hex.EncodeToString(typed)
	case time.Time:
		return typed.UTC().Format("2006-01-02T15:04:05.000Z")
	default:
		return fmt.Sprintf("%v", typed)
	}
}
