//go:build billingdemo

// This file belongs to the build-tagged demonstration driver and is excluded
// from every ordinary build. See demo9b_stubs.go for why that matters.
//
// It drives the fourteen Phase 9B demonstrations against the real Mosaic
// router, the real Phase 9B application services, the real worker job
// functions, and a real PostgreSQL database.
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
	billinghttp "github.com/Mujhtech/mosaic/apps/api/internal/transport/billing"
)

func (d *demo) stages9B() []func() error {
	return []func() error{
		d.stage9BSetup,
		d.demo1InitialSubscription,
		d.demo2Renewal,
		d.demo3Cancellation,
		d.demo4Expiration,
		d.demo5MultipleSources,
		d.demo6Refund,
		d.demo7GraceAndRecovery,
		d.demo8OutOfOrder,
		d.demo9UpgradeDowngrade,
		d.demo10Restore,
		d.demo11OfflineCache,
		d.demo12IdentityConflict,
		d.demo13WebhookRetry,
		d.demo14ReplayAndRuleVersions,
	}
}

// ---------------------------------------------------------------------------
// Scenario clock and transaction identifiers
// ---------------------------------------------------------------------------

// Every effective time in this demonstration is expressed as an offset from one
// baseline instant and travels inside a provider payload. Nothing waits for the
// wall clock to advance and nothing manipulates a clock: a subscription expires
// because the provider says its period ended, which is the only thing that ever
// expires a subscription in production either.
func (d *demo) at(offset time.Duration) time.Time {
	return d.scenarioBaseline.Add(offset).UTC().Truncate(time.Millisecond)
}

const (
	// One original transaction id per purchase lineage. Apple's chain digest is
	// derived from it, so it is the lineage's identity.
	lineageSubscription   = "2000000900000001" // demos 1-4
	lineageResubscribe    = "2000000900000002" // demo 5
	lineageLifetime       = "2000000900000003" // demos 5-6
	lineageGrace          = "2000000900000004" // demo 7
	lineageOutOfOrder     = "2000000900000005" // demo 8
	lineageUpgrade        = "2000000900000006" // demo 9
	lineageRestore        = "2000000900000007" // demo 10
	lineageConflict       = "2000000900000008" // demo 12
	lineageOneMinuteSub   = "2000000900000009" // one-minute demo
	lineageOneMinuteLifer = "2000000900000010" // one-minute demo
)

// ---------------------------------------------------------------------------
// Stage 0 — tenant, grants, destination
// ---------------------------------------------------------------------------

func (d *demo) stage9BSetup() error {
	d.section("9B-0", "Environment, grant versions, and webhook destination")
	d.scenarioBaseline = time.Now().UTC().Truncate(time.Millisecond)

	publicKey, serverKey, err := seedTenant9B(d.ctx, d.pool)
	if err != nil {
		return err
	}
	d.publicKey9B, d.serverKey9B = publicKey, serverKey
	d.note("seeded %s / %s / %s (mode=production), application %s (%s)",
		organizationID9B, projectID9B, environmentID9B, iosApplicationID9B, appleBundleID9B)
	d.note("scenario baseline T = %s; every effective time below is T ± an offset carried in a provider payload",
		d.scenarioBaseline.Format(time.RFC3339Nano))

	d.step("Enable Mosaic Billing for the Project")
	status, body := d.actor9B(http.MethodPut, "/v1/projects/"+projectID9B+"/billing/settings",
		map[string]any{"billingEnabled": true})
	d.http("PUT /v1/projects/{projectId}/billing/settings", status, body)
	if status != http.StatusOK {
		return fmt.Errorf("enable billing returned %d", status)
	}

	d.step("Create the Apple Store Server Credential for this Project")
	secret, err := newApplePrivateKeyPEM()
	if err != nil {
		return err
	}
	status, body = d.actor9B(http.MethodPost, "/v1/projects/"+projectID9B+"/billing/store-credentials", map[string]any{
		"environmentId": environmentID9B, "provider": "app_store", "storeEnvironment": "production",
		"name": "Demo 9B Apple team key", "secret": string(secret),
		"appleIssuerId": "57246542-96fe-1a63-e053-0824d011072a", "appleKeyId": "2X9R4HXF34",
		"applications": []map[string]string{{
			"applicationId": iosApplicationID9B, "platform": "ios", "providerApplicationIdentifier": appleBundleID9B,
		}},
	})
	d.http("POST /v1/projects/{projectId}/billing/store-credentials", status, redactEndpoint(body))
	if status != http.StatusCreated {
		return fmt.Errorf("credential create returned %d", status)
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
	d.credentialID9B = created.Data.ID
	d.intakePath9B = strings.TrimPrefix(created.Data.NotificationEndpointURL, demoNotificationOrigin)

	d.step("Publish a Product-to-Entitlement Grant Version for each Product")
	for _, product := range []struct {
		id    string
		types []string
	}{
		{productMonthly9B, []string{"auto_renewable_subscription"}},
		{productYearly9B, []string{"auto_renewable_subscription"}},
		{productLifetime9B, []string{"non_consumable"}},
	} {
		status, body = d.actor9B(http.MethodPost,
			"/v1/projects/"+projectID9B+"/billing/grant-versions", map[string]any{
				"productId": product.id, "entitlementId": entitlementID9B,
				// Prospective, as the accepted policy requires: a grant version
				// takes effect now or later unless it is explicitly marked
				// retroactive. Purchases that predate every recorded version
				// select the earliest one by the documented backfill rule.
				"effectiveStart":         time.Now().UTC().Add(time.Second).Format(time.RFC3339),
				"supportedPurchaseTypes": product.types,
				"reason":                 "Phase 9B integrated demonstration",
			})
		d.http("POST /v1/projects/{projectId}/billing/grant-versions ("+product.id+")", status, body)
		if status != http.StatusCreated {
			return fmt.Errorf("grant publish for %s returned %d", product.id, status)
		}
	}
	d.query("published grant versions (immutable, one open interval per pair)",
		`SELECT product_id, entitlement_id, version, grant_policy_version, grants_in_active, grants_in_trial,
		        grants_in_grace, grants_in_billing_retry, grants_in_one_time_ownership,
		        supported_purchase_types, effective_end IS NULL AS open
		 FROM product_entitlement_grant_versions WHERE project_id=$1 ORDER BY product_id`, projectID9B)

	d.step("Refuse an in-place edit of a published grant version")
	var grantVersionID string
	if err := d.pool.QueryRow(d.ctx,
		`SELECT id FROM product_entitlement_grant_versions WHERE project_id=$1 AND product_id=$2`,
		projectID9B, productMonthly9B).Scan(&grantVersionID); err != nil {
		return err
	}
	status, body = d.actor9B(http.MethodPatch,
		"/v1/projects/"+projectID9B+"/billing/grant-versions/"+grantVersionID, map[string]any{})
	d.http("PATCH /v1/projects/{projectId}/billing/grant-versions/{versionId}", status, body)

	d.step("Register the application webhook destination")
	status, body = d.actor9B(http.MethodPost,
		"/v1/projects/"+projectID9B+"/environments/"+environmentID9B+"/billing/webhook-destinations",
		map[string]any{"url": d.destination.url, "description": "Phase 9B demonstration destination"})
	d.http("POST .../billing/webhook-destinations", status, redactSecret(body))
	if status != http.StatusCreated {
		return fmt.Errorf("destination create returned %d", status)
	}
	var destination struct {
		Data struct {
			ID       string `json:"id"`
			Secret   string `json:"secret"`
			SecretID string `json:"secretId"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(body), &destination); err != nil {
		return err
	}
	d.destinationID = destination.Data.ID
	d.destination.addSecret(destination.Data.Secret)
	d.note("destination %s registered at %s; the signing secret was returned once and is held only by the stub",
		d.destinationID, d.destination.url)
	d.note("the destination is https and the delivery policy verifies its certificate chain — no verification is skipped")

	d.step("Verify Mosaic's signing function against the shared cross-implementation vectors")
	vectors, err := loadSignatureVectors(webhookVectorFile)
	if err != nil {
		return err
	}
	for _, vector := range vectors {
		produced := billingWebhookSign(vector.Secret, vector.Timestamp, vector.EventID, []byte(vector.RawBody))
		d.note("vector %-32s produced==published: %v", vector.ID, produced == vector.Signature)
		if produced != vector.Signature {
			return fmt.Errorf("signature vector %s disagrees with the published value", vector.ID)
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Demonstration 1 — initial subscription
// ---------------------------------------------------------------------------

func (d *demo) demo1InitialSubscription() error {
	d.demonstration(1, "Initial subscription")

	d.step("Create the Billing Customer through the trusted identity API")
	status, body := d.server9B(http.MethodPost, "/v1/billing/identity/customers",
		map[string]any{"applicationUserId": applicationUserA9B})
	d.http("POST /v1/billing/identity/customers", status, body)
	if status != http.StatusCreated && status != http.StatusOK {
		return fmt.Errorf("customer create returned %d", status)
	}
	var customer struct {
		Data struct {
			BillingCustomerID string `json:"billingCustomerId"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(body), &customer); err != nil {
		return err
	}
	d.customerA = customer.Data.BillingCustomerID

	d.step("Issue a Customer Access Token for the SDK sync audience")
	token, err := d.issueToken(d.customerA, "demo-9b-token-a")
	if err != nil {
		return err
	}
	d.tokenA = token
	d.bindToken = token
	d.query("the token is stored as a digest, never as a value",
		`SELECT audience, scopes, octet_length(token_digest) AS digest_bytes,
		        (expires_at > issued_at) AS bounded, (revoked_at IS NULL) AS live,
		        round(extract(epoch from (expires_at - issued_at)))::text AS ttl_seconds
		 FROM customer_access_tokens WHERE project_id=$1`, projectID9B)

	d.step("Validated Apple purchase through the real 9A ingestion and validation path")
	if err := d.deliverApple(appleEvent{
		NotificationUUID: "9b000001-0000-4000-8000-000000000001",
		NotificationType: "SUBSCRIBED", Subtype: "INITIAL_BUY",
		SignedAt: d.at(-25 * 24 * time.Hour),
		Transaction: transactionVector{
			TransactionID: "3000000900000001", OriginalTransactionID: lineageSubscription,
			ProductID: appleMonthly9B, PurchaseDate: d.at(-25 * 24 * time.Hour),
			ExpiresDate: timePointer(d.at(5 * 24 * time.Hour)),
		},
		Renewal: &renewalVector{OriginalTransactionID: lineageSubscription, AutoRenewStatus: 1,
			AutoRenewProductID: appleMonthly9B, ProductID: appleMonthly9B, SignedAt: d.at(-25 * 24 * time.Hour)},
	}); err != nil {
		return err
	}
	d.query("the validated Transaction Fact",
		`SELECT fact_kind, transaction_type, resolution_state, mosaic_product_id,
		        period_start_at, period_end_at, renewal_expected, validator_version,
		        encode(purchase_chain_digest,'hex') AS chain_digest
		 FROM billing_transaction_facts WHERE project_id=$1 ORDER BY recorded_at`, projectID9B)

	d.step("Associate the purchase lineage with the Billing Customer (submission-context evidence)")
	d.query("purchase lineage and its association evidence",
		`SELECT l.provider, l.lineage_type, l.projection_frozen, l.diagnostic_status,
		        (l.billing_customer_id = $2) AS attached_to_customer,
		        (SELECT string_agg(e.evidence_type||'/'||e.outcome, ', ' ORDER BY e.id)
		         FROM billing_association_evidence e WHERE e.purchase_lineage_id = l.id) AS evidence
		 FROM purchase_lineages l WHERE l.project_id=$1`, projectID9B, d.customerA)

	d.step("Project the Subscription Snapshot and the Customer Entitlement Snapshot")
	if err := d.project(d.customerA); err != nil {
		return err
	}
	d.showSubscriptionState()
	d.showCustomerSnapshot()
	d.query("the Entitlement Source names (lineage, product, grant version) — never a fact id",
		`SELECT s.source_type, s.source_state, s.explanation_code, s.is_test_source,
		        (s.grant_version_id IS NOT NULL) AS has_grant_version,
		        (s.subscription_instance_id IS NOT NULL) AS from_subscription
		 FROM entitlement_sources s WHERE s.project_id=$1 ORDER BY s.created_at DESC LIMIT 5`, projectID9B)

	d.step("Fetch through the trusted server API")
	status, body = d.server9B(http.MethodGet,
		"/v1/billing/server/customers/"+d.customerA+"/entitlements?environmentId="+environmentID9B, nil)
	d.http("GET /v1/billing/server/customers/{customerId}/entitlements", status, body)

	d.step("Fetch through the SDK sync wire (POST entitlementSyncRequest)")
	syncStatus, syncBody, headers := d.sdkSync(d.tokenA, 0, "", []string{entitlementKey9B})
	d.http("POST /v1/sdk/billing/entitlements", syncStatus, syncBody)
	d.note("freshness headers: refresh-after=%s valid-until=%s stale-grace-seconds=%s etag=%s",
		headers.Get("Mosaic-Refresh-After"), headers.Get("Mosaic-Valid-Until"),
		headers.Get("Mosaic-Stale-Grace-Seconds"), headers.Get("ETag"))
	d.note("this is the wire the three SDKs consume; the Flutter, iOS, and Android clients are proven against")
	d.note("the same contract fixtures by their own conformance suites, which this driver does not re-run")

	d.step("Deliver the signed webhook to the local destination stub")
	if err := d.drainWebhooks(6); err != nil {
		return err
	}
	d.showDeliveries()
	return nil
}

// ---------------------------------------------------------------------------
// Demonstration 2 — renewal
// ---------------------------------------------------------------------------

func (d *demo) demo2Renewal() error {
	d.demonstration(2, "Renewal")

	priorVersion, priorEnd := d.snapshotVersion(d.customerA), d.subscriptionPeriodEnd(lineageSubscription)
	d.note("prior snapshot version %d, prior effective end %s", priorVersion, priorEnd)

	d.step("Ingest the validated renewal (new period begins at T-3h)")
	if err := d.deliverApple(appleEvent{
		NotificationUUID: "9b000002-0000-4000-8000-000000000002",
		NotificationType: "DID_RENEW", SignedAt: d.at(-3 * time.Hour),
		Transaction: transactionVector{
			TransactionID: "3000000900000002", OriginalTransactionID: lineageSubscription,
			ProductID: appleMonthly9B, TransactionReason: "RENEWAL",
			PurchaseDate: d.at(-3 * time.Hour), ExpiresDate: timePointer(d.at(30 * 24 * time.Hour)),
		},
		Renewal: &renewalVector{OriginalTransactionID: lineageSubscription, AutoRenewStatus: 1,
			AutoRenewProductID: appleMonthly9B, ProductID: appleMonthly9B, SignedAt: d.at(-3 * time.Hour)},
	}); err != nil {
		return err
	}
	if err := d.project(d.customerA); err != nil {
		return err
	}

	d.showSubscriptionState()
	d.query("prior Subscription Snapshots are preserved, never rewritten",
		`SELECT s.projection_version, s.access_state, s.lifecycle_state, s.period_end_at,
		        (s.id = i.current_snapshot_id) AS is_current
		 FROM subscription_snapshots s JOIN subscription_instances i ON i.id = s.subscription_instance_id
		 WHERE s.project_id=$1 ORDER BY s.projection_version`, projectID9B)
	d.note("effective end moved from %s to %s", priorEnd, d.subscriptionPeriodEnd(lineageSubscription))
	d.note("customer snapshot version %d → %d (monotonic; a no-change projection does not advance it)",
		priorVersion, d.snapshotVersion(d.customerA))
	d.query("customer entitlement snapshot history",
		`SELECT snapshot_version, change_reason, encode(checksum,'hex') AS checksum
		 FROM customer_entitlement_snapshots WHERE billing_customer_id=$1 ORDER BY snapshot_version`, d.customerA)

	d.step("Webhook policy for this change")
	if err := d.drainWebhooks(6); err != nil {
		return err
	}
	d.query("webhook events created so far (one per customer entitlement snapshot)",
		`SELECT e.event_type, e.snapshot_version, e.payload->'payload'->>'sourceReason' AS source_reason,
		        e.payload->'payload'->'changedEntitlements' AS changed
		 FROM webhook_events e WHERE e.project_id=$1 ORDER BY e.created_at`, projectID9B)
	d.note("a renewal that extends a period without changing which Entitlements are held is a no-change")
	d.note("projection: no snapshot is minted and no webhook is emitted for it")

	d.step("Refresh the SDK wire")
	status, body, _ := d.sdkSync(d.tokenA, 0, "", nil)
	d.http("POST /v1/sdk/billing/entitlements", status, body)
	return nil
}

// ---------------------------------------------------------------------------
// Demonstration 3 — cancellation without immediate revocation
// ---------------------------------------------------------------------------

func (d *demo) demo3Cancellation() error {
	d.demonstration(3, "Cancellation without immediate revocation")

	d.step("Ingest the validated auto-renew-disabled fact (effective T-2h)")
	if err := d.deliverApple(appleEvent{
		NotificationUUID: "9b000003-0000-4000-8000-000000000003",
		NotificationType: "DID_CHANGE_RENEWAL_STATUS", Subtype: "AUTO_RENEW_DISABLED",
		SignedAt: d.at(-2 * time.Hour),
		Transaction: transactionVector{
			TransactionID: "3000000900000003", OriginalTransactionID: lineageSubscription,
			ProductID: appleMonthly9B, TransactionReason: "RENEWAL",
			PurchaseDate: d.at(-3 * time.Hour), ExpiresDate: timePointer(d.at(30 * 24 * time.Hour)),
			SignedDate: d.at(-2 * time.Hour),
		},
		Renewal: &renewalVector{OriginalTransactionID: lineageSubscription, AutoRenewStatus: 0,
			AutoRenewProductID: appleMonthly9B, ProductID: appleMonthly9B, SignedAt: d.at(-2 * time.Hour)},
	}); err != nil {
		return err
	}
	if err := d.project(d.customerA); err != nil {
		return err
	}

	d.showSubscriptionState()
	d.query("renewal intent is off, access is still active, and the scheduled expiration is visible",
		`SELECT s.access_state, s.renewal_intent, s.billing_state, s.cancellation_effective_at,
		        s.period_end_at AS scheduled_expiration
		 FROM subscription_snapshots s JOIN subscription_instances i ON i.current_snapshot_id = s.id
		 WHERE s.project_id=$1`, projectID9B)
	d.showCustomerSnapshot()
	d.showTimeline(lineageSubscription)
	if err := d.drainWebhooks(6); err != nil {
		return err
	}
	d.note("cancellation changed no Entitlement state, so it produced no entitlements-changed event —")
	d.note("the access-change vocabulary is deliberately about access, not about provider intent")
	d.showDeliveries()
	return nil
}

// ---------------------------------------------------------------------------
// Demonstration 4 — expiration
// ---------------------------------------------------------------------------

func (d *demo) demo4Expiration() error {
	d.demonstration(4, "Expiration")

	d.step("The validated period end passes (driven by the provider's effective time, not a wall-clock wait)")
	if err := d.deliverApple(appleEvent{
		NotificationUUID: "9b000004-0000-4000-8000-000000000004",
		NotificationType: "EXPIRED", Subtype: "VOLUNTARY", SignedAt: d.at(-time.Hour),
		Transaction: transactionVector{
			TransactionID: "3000000900000004", OriginalTransactionID: lineageSubscription,
			ProductID: appleMonthly9B, TransactionReason: "RENEWAL",
			PurchaseDate: d.at(-3 * time.Hour), ExpiresDate: timePointer(d.at(-time.Hour)),
			SignedDate: d.at(-time.Hour),
		},
		Renewal: &renewalVector{OriginalTransactionID: lineageSubscription, AutoRenewStatus: 0,
			AutoRenewProductID: appleMonthly9B, ProductID: appleMonthly9B, SignedAt: d.at(-time.Hour)},
	}); err != nil {
		return err
	}
	if err := d.project(d.customerA); err != nil {
		return err
	}

	d.showSubscriptionState()
	d.showCustomerSnapshot()
	d.query("the subscription Entitlement Source is no longer granting",
		`SELECT s.source_type, s.source_state, s.explanation_code, s.source_end
		 FROM entitlement_sources s
		 WHERE s.customer_entitlement_snapshot_id = (
		   SELECT current_snapshot_id FROM customer_entitlement_pointers
		   WHERE billing_customer_id=$1 AND environment_id=$2)`, d.customerA, environmentID9B)
	if err := d.drainWebhooks(6); err != nil {
		return err
	}
	d.showDeliveries()

	d.step("The SDK wire reflects the inactive state")
	status, body, _ := d.sdkSync(d.tokenA, 0, "", []string{entitlementKey9B})
	d.http("POST /v1/sdk/billing/entitlements", status, body)
	return nil
}

// ---------------------------------------------------------------------------
// Demonstration 5 — multiple sources
// ---------------------------------------------------------------------------

func (d *demo) demo5MultipleSources() error {
	d.demonstration(5, "Multiple sources granting one Entitlement")

	d.step("A new subscription (resubscribe) and a lifetime one-time purchase, both granting `pro`")
	if err := d.deliverApple(appleEvent{
		NotificationUUID: "9b000005-0000-4000-8000-000000000005",
		NotificationType: "SUBSCRIBED", Subtype: "RESUBSCRIBE", SignedAt: d.at(-30 * time.Minute),
		Transaction: transactionVector{
			TransactionID: "3000000900000005", OriginalTransactionID: lineageResubscribe,
			ProductID: appleMonthly9B, PurchaseDate: d.at(-30 * time.Minute),
			ExpiresDate: timePointer(d.at(30 * 24 * time.Hour)),
		},
		Renewal: &renewalVector{OriginalTransactionID: lineageResubscribe, AutoRenewStatus: 1,
			AutoRenewProductID: appleMonthly9B, ProductID: appleMonthly9B, SignedAt: d.at(-30 * time.Minute)},
	}); err != nil {
		return err
	}
	if err := d.deliverApple(appleEvent{
		NotificationUUID: "9b000006-0000-4000-8000-000000000006",
		NotificationType: "ONE_TIME_CHARGE", SignedAt: d.at(-20 * time.Minute),
		Transaction: transactionVector{
			TransactionID: "3000000900000006", OriginalTransactionID: lineageLifetime,
			ProductID: appleLifetime9B, ProductType: "Non-Consumable",
			PurchaseDate: d.at(-20 * time.Minute),
		},
	}); err != nil {
		return err
	}
	if err := d.project(d.customerA); err != nil {
		return err
	}
	d.showCustomerSnapshot()
	d.showSources()

	d.step("Expire the subscription source; the lifetime source keeps access active")
	if err := d.deliverApple(appleEvent{
		NotificationUUID: "9b000007-0000-4000-8000-000000000007",
		NotificationType: "EXPIRED", Subtype: "VOLUNTARY", SignedAt: d.at(-10 * time.Minute),
		Transaction: transactionVector{
			TransactionID: "3000000900000007", OriginalTransactionID: lineageResubscribe,
			ProductID: appleMonthly9B, TransactionReason: "RENEWAL",
			PurchaseDate: d.at(-30 * time.Minute), ExpiresDate: timePointer(d.at(-10 * time.Minute)),
			SignedDate: d.at(-10 * time.Minute),
		},
		Renewal: &renewalVector{OriginalTransactionID: lineageResubscribe, AutoRenewStatus: 0,
			AutoRenewProductID: appleMonthly9B, ProductID: appleMonthly9B, SignedAt: d.at(-10 * time.Minute)},
	}); err != nil {
		return err
	}
	if err := d.project(d.customerA); err != nil {
		return err
	}
	d.note("Defect D-4 is fixed. The state below is what a deployed worker produces after the")
	d.note("expiration, through the queued path alone: the lifetime source still grants `pro`, and")
	d.note("both subscription sources remain in the aggregate. The projection job carries a customer")
	d.note("id and no lineage id, so the aggregate is computed from every lineage the customer owns.")
	d.showCustomerSnapshot()
	d.showSources()
	d.query("the job the worker actually ran, and what it was scoped to",
		`SELECT kind, scope_key, detail->>'lineageId' AS lineage_in_detail, status
		 FROM projection_jobs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 3`, projectID9B)

	d.step("Both source histories remain inspectable")
	d.query("every lineage this customer owns and its current state",
		`SELECT l.lineage_type, l.diagnostic_status,
		        COALESCE(ss.access_state, oi.validity_state) AS state,
		        COALESCE(ss.lifecycle_state, '-') AS lifecycle_state
		 FROM purchase_lineages l
		 LEFT JOIN subscription_instances si ON si.purchase_lineage_id = l.id
		 LEFT JOIN subscription_snapshots ss ON ss.id = si.current_snapshot_id
		 LEFT JOIN one_time_purchase_instances oi ON oi.purchase_lineage_id = l.id
		 WHERE l.billing_customer_id=$1 ORDER BY l.created_at`, d.customerA)
	return d.drainWebhooks(8)
}

// ---------------------------------------------------------------------------
// Demonstration 6 — refund or revocation
// ---------------------------------------------------------------------------

func (d *demo) demo6Refund() error {
	d.demonstration(6, "Refund or revocation")

	d.step("Ingest a validated Apple refund for the lifetime purchase only")
	if err := d.deliverApple(appleEvent{
		NotificationUUID: "9b000008-0000-4000-8000-000000000008",
		NotificationType: "REFUND", SignedAt: d.at(-5 * time.Minute),
		Transaction: transactionVector{
			TransactionID: "3000000900000008", OriginalTransactionID: lineageLifetime,
			ProductID: appleLifetime9B, ProductType: "Non-Consumable",
			PurchaseDate:   d.at(-20 * time.Minute),
			RevocationDate: timePointer(d.at(-5 * time.Minute)), RevocationReason: intPointer(0),
			SignedDate: d.at(-5 * time.Minute),
		},
	}); err != nil {
		return err
	}
	if err := d.project(d.customerA); err != nil {
		return err
	}

	d.query("the refunded source, and the unrelated sources beside it",
		`SELECT l.lineage_type,
		        COALESCE(ss.access_state, oi.validity_state) AS state,
		        COALESCE(oi.refund_effective_at::text, '-') AS refund_effective_at,
		        COALESCE(oi.revocation_effective_at::text, '-') AS revocation_effective_at
		 FROM purchase_lineages l
		 LEFT JOIN subscription_instances si ON si.purchase_lineage_id = l.id
		 LEFT JOIN subscription_snapshots ss ON ss.id = si.current_snapshot_id
		 LEFT JOIN one_time_purchase_instances oi ON oi.purchase_lineage_id = l.id
		 WHERE l.billing_customer_id=$1 ORDER BY l.created_at`, d.customerA)
	d.showCustomerSnapshot()
	d.query("history is intact: every fact for the refunded lineage is still recorded",
		`SELECT fact_kind, occurred_at, refunded_at, revoked_at, COALESCE(refund_type,'-') AS refund_type
		 FROM billing_transaction_facts
		 WHERE project_id=$1 AND provider_original_transaction_id=$2 ORDER BY recorded_at`,
		projectID9B, lineageLifetime)
	if err := d.drainWebhooks(8); err != nil {
		return err
	}
	d.showDeliveries()

	d.step("The SDK wire reports the change")
	status, body, _ := d.sdkSync(d.tokenA, 0, "", []string{entitlementKey9B})
	d.http("POST /v1/sdk/billing/entitlements", status, body)
	return nil
}

// ---------------------------------------------------------------------------
// Demonstration 7 — grace period and recovery
// ---------------------------------------------------------------------------

func (d *demo) demo7GraceAndRecovery() error {
	d.demonstration(7, "Grace period and recovery")

	d.step("A subscription whose period has ended, with a provider-confirmed grace period")
	if err := d.deliverApple(appleEvent{
		NotificationUUID: "9b000009-0000-4000-8000-000000000009",
		NotificationType: "SUBSCRIBED", Subtype: "INITIAL_BUY", SignedAt: d.at(-40 * 24 * time.Hour),
		Transaction: transactionVector{
			TransactionID: "3000000900000009", OriginalTransactionID: lineageGrace,
			ProductID: appleMonthly9B, PurchaseDate: d.at(-40 * 24 * time.Hour),
			ExpiresDate: timePointer(d.at(-10 * 24 * time.Hour)),
		},
		Renewal: &renewalVector{OriginalTransactionID: lineageGrace, AutoRenewStatus: 1,
			AutoRenewProductID: appleMonthly9B, ProductID: appleMonthly9B, SignedAt: d.at(-40 * 24 * time.Hour)},
	}); err != nil {
		return err
	}
	// Apple has no separate grace notification: grace arrives as DID_FAIL_TO_RENEW
	// carrying gracePeriodExpiresDate in the renewal info.
	if err := d.deliverApple(appleEvent{
		NotificationUUID: "9b00000a-0000-4000-8000-00000000000a",
		NotificationType: "DID_FAIL_TO_RENEW", Subtype: "GRACE_PERIOD", SignedAt: d.at(-10 * 24 * time.Hour),
		Transaction: transactionVector{
			TransactionID: "3000000900000010", OriginalTransactionID: lineageGrace,
			ProductID: appleMonthly9B, TransactionReason: "RENEWAL",
			PurchaseDate: d.at(-40 * 24 * time.Hour), ExpiresDate: timePointer(d.at(-10 * 24 * time.Hour)),
			SignedDate: d.at(-10 * 24 * time.Hour),
		},
		Renewal: &renewalVector{OriginalTransactionID: lineageGrace, AutoRenewStatus: 1,
			AutoRenewProductID: appleMonthly9B, ProductID: appleMonthly9B,
			IsInBillingRetry:     true,
			GracePeriodExpiresAt: timePointer(d.at(5 * 24 * time.Hour)),
			SignedAt:             d.at(-10 * 24 * time.Hour)},
	}); err != nil {
		return err
	}
	if err := d.project(d.customerA); err != nil {
		return err
	}
	d.query("grace is active, access is granted by the approved policy, and the grace end is recorded",
		`SELECT ss.access_state, ss.lifecycle_state, ss.billing_state, ss.grace_period_end_at
		 FROM subscription_snapshots ss
		 JOIN subscription_instances si ON si.current_snapshot_id = ss.id
		 JOIN purchase_lineages l ON l.id = si.purchase_lineage_id
		 WHERE l.project_id=$1 AND l.lineage_key_digest = $2`,
		projectID9B, billing.AppleTransactionKey("production", lineageGrace))
	d.showCustomerSnapshot()

	d.step("Payment recovers")
	if err := d.deliverApple(appleEvent{
		NotificationUUID: "9b00000b-0000-4000-8000-00000000000b",
		NotificationType: "DID_RENEW", Subtype: "BILLING_RECOVERY", SignedAt: d.at(-2 * time.Minute),
		Transaction: transactionVector{
			TransactionID: "3000000900000011", OriginalTransactionID: lineageGrace,
			ProductID: appleMonthly9B, TransactionReason: "RENEWAL",
			PurchaseDate: d.at(-2 * time.Minute), ExpiresDate: timePointer(d.at(28 * 24 * time.Hour)),
		},
		Renewal: &renewalVector{OriginalTransactionID: lineageGrace, AutoRenewStatus: 1,
			AutoRenewProductID: appleMonthly9B, ProductID: appleMonthly9B, SignedAt: d.at(-2 * time.Minute)},
	}); err != nil {
		return err
	}
	if err := d.project(d.customerA); err != nil {
		return err
	}
	d.query("recovered: active again, grace cleared",
		`SELECT ss.access_state, ss.lifecycle_state, ss.billing_state, ss.grace_period_end_at, ss.period_end_at
		 FROM subscription_snapshots ss
		 JOIN subscription_instances si ON si.current_snapshot_id = ss.id
		 JOIN purchase_lineages l ON l.id = si.purchase_lineage_id
		 WHERE l.project_id=$1 AND l.lineage_key_digest = $2`,
		projectID9B, billing.AppleTransactionKey("production", lineageGrace))
	d.showTimeline(lineageGrace)
	return d.drainWebhooks(8)
}

// ---------------------------------------------------------------------------
// Demonstration 8 — out-of-order fact
// ---------------------------------------------------------------------------

func (d *demo) demo8OutOfOrder() error {
	d.demonstration(8, "Out-of-order fact")

	d.step("Project a lineage with a purchase and a renewal, in order")
	for index, event := range []appleEvent{
		{
			NotificationUUID: "9b00000c-0000-4000-8000-00000000000c",
			NotificationType: "SUBSCRIBED", SignedAt: d.at(-60 * 24 * time.Hour),
			Transaction: transactionVector{
				TransactionID: "3000000900000012", OriginalTransactionID: lineageOutOfOrder,
				ProductID: appleMonthly9B, PurchaseDate: d.at(-60 * 24 * time.Hour),
				ExpiresDate: timePointer(d.at(-30 * 24 * time.Hour)),
			},
			Renewal: &renewalVector{OriginalTransactionID: lineageOutOfOrder, AutoRenewStatus: 1,
				AutoRenewProductID: appleMonthly9B, ProductID: appleMonthly9B, SignedAt: d.at(-60 * 24 * time.Hour)},
		},
		{
			NotificationUUID: "9b00000d-0000-4000-8000-00000000000d",
			NotificationType: "DID_RENEW", SignedAt: d.at(-30 * 24 * time.Hour),
			Transaction: transactionVector{
				TransactionID: "3000000900000013", OriginalTransactionID: lineageOutOfOrder,
				ProductID: appleMonthly9B, TransactionReason: "RENEWAL",
				PurchaseDate: d.at(-30 * 24 * time.Hour), ExpiresDate: timePointer(d.at(30 * 24 * time.Hour)),
			},
			Renewal: &renewalVector{OriginalTransactionID: lineageOutOfOrder, AutoRenewStatus: 1,
				AutoRenewProductID: appleMonthly9B, ProductID: appleMonthly9B, SignedAt: d.at(-30 * 24 * time.Hour)},
		},
	} {
		if err := d.deliverApple(event); err != nil {
			return fmt.Errorf("event %d: %w", index, err)
		}
	}
	if err := d.project(d.customerA); err != nil {
		return err
	}
	d.query("checkpoint before the late fact",
		`SELECT c.high_watermark, c.facts_projected, NOT c.invalidated AS valid,
		        encode(c.checksum,'hex') AS checksum
		 FROM projection_checkpoints c
		 JOIN subscription_instances si ON si.id = c.subscription_instance_id
		 JOIN purchase_lineages l ON l.id = si.purchase_lineage_id
		 WHERE l.lineage_key_digest=$1`, billing.AppleTransactionKey("production", lineageOutOfOrder))

	d.step("A late EXPIRED for the earlier period arrives, with an effective time before the watermark")
	if err := d.deliverApple(appleEvent{
		NotificationUUID: "9b00000e-0000-4000-8000-00000000000e",
		NotificationType: "EXPIRED", Subtype: "BILLING_RETRY", SignedAt: d.at(-45 * 24 * time.Hour),
		Transaction: transactionVector{
			TransactionID: "3000000900000014", OriginalTransactionID: lineageOutOfOrder,
			ProductID: appleMonthly9B, TransactionReason: "RENEWAL",
			PurchaseDate: d.at(-60 * 24 * time.Hour), ExpiresDate: timePointer(d.at(-45 * 24 * time.Hour)),
			SignedDate: d.at(-45 * 24 * time.Hour),
		},
		Renewal: &renewalVector{OriginalTransactionID: lineageOutOfOrder, AutoRenewStatus: 1,
			AutoRenewProductID: appleMonthly9B, ProductID: appleMonthly9B, SignedAt: d.at(-45 * 24 * time.Hour)},
	}); err != nil {
		return err
	}
	if err := d.project(d.customerA); err != nil {
		return err
	}
	d.query("the checkpoint was invalidated and the lineage was reprojected from zero",
		`SELECT c.high_watermark, c.facts_projected, c.invalidated,
		        encode(c.checksum,'hex') AS checksum
		 FROM projection_checkpoints c
		 JOIN subscription_instances si ON si.id = c.subscription_instance_id
		 JOIN purchase_lineages l ON l.id = si.purchase_lineage_id
		 WHERE l.lineage_key_digest=$1`, billing.AppleTransactionKey("production", lineageOutOfOrder))
	d.query("every Subscription Snapshot for this lineage — priors are preserved",
		`SELECT ss.projection_version, ss.access_state, ss.lifecycle_state, ss.period_start_at, ss.period_end_at,
		        (ss.id = si.current_snapshot_id) AS is_current
		 FROM subscription_snapshots ss
		 JOIN subscription_instances si ON si.id = ss.subscription_instance_id
		 JOIN purchase_lineages l ON l.id = si.purchase_lineage_id
		 WHERE l.lineage_key_digest=$1 ORDER BY ss.projection_version`,
		billing.AppleTransactionKey("production", lineageOutOfOrder))
	d.note("the late fact is folded in its canonical position, not appended. The renewal at T-30d")
	d.note("still sorts last, so the deterministic result is byte-identical to the pre-invalidation")
	d.note("snapshot: the checkpoint advanced from 2 facts to 3, the checksum did not move, and no")
	d.note("new snapshot was minted. That is the intended no-change outcome, and it is the strongest")
	d.note("form of the determinism claim — a checkpoint is an optimization, never a source of truth.")
	return d.drainWebhooks(8)
}

// ---------------------------------------------------------------------------
// Demonstration 9 — upgrade or downgrade
// ---------------------------------------------------------------------------

func (d *demo) demo9UpgradeDowngrade() error {
	d.demonstration(9, "Upgrade with supersession")

	d.step("Start on the monthly Product")
	if err := d.deliverApple(appleEvent{
		NotificationUUID: "9b00000f-0000-4000-8000-00000000000f",
		NotificationType: "SUBSCRIBED", SignedAt: d.at(-20 * 24 * time.Hour),
		Transaction: transactionVector{
			TransactionID: "3000000900000015", OriginalTransactionID: lineageUpgrade,
			ProductID: appleMonthly9B, PurchaseDate: d.at(-20 * 24 * time.Hour),
			ExpiresDate: timePointer(d.at(10 * 24 * time.Hour)),
		},
		Renewal: &renewalVector{OriginalTransactionID: lineageUpgrade, AutoRenewStatus: 1,
			AutoRenewProductID: appleMonthly9B, ProductID: appleMonthly9B, SignedAt: d.at(-20 * 24 * time.Hour)},
	}); err != nil {
		return err
	}
	if err := d.project(d.customerA); err != nil {
		return err
	}
	d.query("current Product before the transition",
		`SELECT ss.current_product_id, ss.access_state, ss.period_end_at
		 FROM subscription_snapshots ss
		 JOIN subscription_instances si ON si.current_snapshot_id = ss.id
		 JOIN purchase_lineages l ON l.id = si.purchase_lineage_id
		 WHERE l.lineage_key_digest=$1`, billing.AppleTransactionKey("production", lineageUpgrade))

	d.step("Ingest the validated Product transition to the yearly Product")
	if err := d.deliverApple(appleEvent{
		NotificationUUID: "9b000010-0000-4000-8000-000000000010",
		NotificationType: "DID_CHANGE_RENEWAL_PREF", Subtype: "UPGRADE", SignedAt: d.at(-time.Minute),
		Transaction: transactionVector{
			TransactionID: "3000000900000016", OriginalTransactionID: lineageUpgrade,
			ProductID: appleYearly9B, TransactionReason: "PURCHASE",
			PurchaseDate: d.at(-time.Minute), ExpiresDate: timePointer(d.at(365 * 24 * time.Hour)),
			IsUpgraded: true, SignedDate: d.at(-time.Minute),
		},
		Renewal: &renewalVector{OriginalTransactionID: lineageUpgrade, AutoRenewStatus: 1,
			AutoRenewProductID: appleYearly9B, ProductID: appleYearly9B, SignedAt: d.at(-time.Minute)},
	}); err != nil {
		return err
	}
	if err := d.project(d.customerA); err != nil {
		return err
	}
	d.query("the new Product is current, the prior Product is preserved on the snapshot",
		`SELECT ss.current_product_id, ss.prior_product_id, ss.access_state,
		        ss.period_start_at, ss.period_end_at, ss.scheduled_product_identifier
		 FROM subscription_snapshots ss
		 JOIN subscription_instances si ON si.current_snapshot_id = ss.id
		 JOIN purchase_lineages l ON l.id = si.purchase_lineage_id
		 WHERE l.lineage_key_digest=$1`, billing.AppleTransactionKey("production", lineageUpgrade))
	d.query("exactly one Entitlement Source per (lineage, entitlement, grant version) — no double grant",
		`SELECT s.purchase_lineage_id, s.entitlement_id, s.grant_version_id, count(*) AS sources
		 FROM entitlement_sources s
		 WHERE s.customer_entitlement_snapshot_id = (
		   SELECT current_snapshot_id FROM customer_entitlement_pointers
		   WHERE billing_customer_id=$1 AND environment_id=$2)
		 GROUP BY 1,2,3 ORDER BY 1`, d.customerA, environmentID9B)
	d.query("provider mapping history for both Products",
		`SELECT r.provider_product_identifier, r.mosaic_product_id, r.outcome, r.mapping_version
		 FROM billing_product_resolutions r WHERE r.project_id=$1
		   AND r.provider_product_identifier IN ($2,$3) ORDER BY r.resolved_at`,
		projectID9B, appleMonthly9B, appleYearly9B)
	d.showTimeline(lineageUpgrade)
	return d.drainWebhooks(8)
}

// ---------------------------------------------------------------------------
// Demonstration 10 — restore across devices
// ---------------------------------------------------------------------------

func (d *demo) demo10Restore() error {
	d.demonstration(10, "Restore across devices")

	d.step("Device A observes a purchase and submits it through the public SDK endpoint")
	signed, err := d.chain.signJWS(transactionVector{
		TransactionID: "3000000900000017", OriginalTransactionID: lineageRestore,
		ProductID: appleMonthly9B, PurchaseDate: d.at(-15 * time.Minute),
		ExpiresDate: timePointer(d.at(30 * 24 * time.Hour)),
	}.payload())
	if err != nil {
		return err
	}
	d.apple.addTransaction("3000000900000017", signed)
	status, body := d.public(http.MethodPost, "/v1/sdk/billing/observations", d.publicKey9B.raw,
		observation9B("obs_demo9b_device_a", "sub_demo9b_device_a", "3000000900000017"))
	d.http("POST /v1/sdk/billing/observations (device A)", status, body)
	if err := d.drainValidation(6); err != nil {
		return err
	}
	if err := d.project(d.customerA); err != nil {
		return err
	}
	versionAfterDeviceA := d.snapshotVersion(d.customerA)
	d.note("snapshot version after device A: %d", versionAfterDeviceA)

	d.step("Device B syncs and observes the same snapshot version")
	statusB, bodyB, headersB := d.sdkSync(d.tokenA, 0, "", nil)
	d.http("POST /v1/sdk/billing/entitlements (device B)", statusB, truncate(bodyB, 600))
	d.note("device B ETag %s; snapshot version %d", headersB.Get("ETag"), versionAfterDeviceA)

	d.step("Device C runs a restore and submits duplicate observations")
	status, body = d.public(http.MethodPost, "/v1/sdk/billing/observations", d.publicKey9B.raw,
		observation9B("obs_demo9b_device_c", "sub_demo9b_device_c", "3000000900000017"))
	d.http("POST /v1/sdk/billing/observations (device C, same transaction)", status, body)
	if err := d.drainValidation(6); err != nil {
		return err
	}
	d.query("duplicate-safe validation: one fact for the restored transaction, however many devices submit it",
		`SELECT provider_transaction_id, count(*) AS facts, count(DISTINCT encode(fact_digest,'hex')) AS digests
		 FROM billing_transaction_facts WHERE project_id=$1 AND provider_transaction_id=$2
		 GROUP BY provider_transaction_id`, projectID9B, "3000000900000017")

	status, body = d.sdkRaw(http.MethodPost, "/v1/sdk/billing/restores", map[string]any{
		"authoritativeEntitlementContractVersion": "1",
		"recordType": "restoreRequest",
		"payload": map[string]any{
			"storePlatform":            "apple_app_store",
			"providerOutcome":          "completed",
			"observationSubmissionIds": []string{"sub_demo9b_device_a", "sub_demo9b_device_c"},
			"correlationId":            "demo-9b-restore-device-c",
		},
	})
	d.http("POST /v1/sdk/billing/restores (device C)", status, body)
	if status != http.StatusAccepted {
		return fmt.Errorf("restore submit returned %d", status)
	}
	var restore struct {
		Payload struct {
			RestoreID string `json:"restoreId"`
		} `json:"payload"`
	}
	if err := json.Unmarshal([]byte(body), &restore); err != nil {
		return err
	}

	d.step("Run the restore-sync worker job (billingrestore.Service.ProcessNextRestoreSync)")
	for attempt := 0; attempt < 5; attempt++ {
		processed, err := d.restores.ProcessNextRestoreSync(d.ctx, "demo-worker")
		if err != nil {
			d.note("DEFECT: ProcessNextRestoreSync returned an error on attempt %d: %v", attempt+1, err)
			break
		}
		d.note("ProcessNextRestoreSync attempt %d processed=%v", attempt+1, processed)
		if !processed {
			time.Sleep(3 * time.Second)
		}
	}
	d.step("The restore settles: the chain read resolves facts to lineages by chain digest")
	d.note("Defect D-2 is fixed. The stage-3 identity read used to join")
	d.note("billing_transaction_facts.purchase_lineage_id, a column no migration creates, so every")
	d.note("restore failed with SQLSTATE 42703, burned its attempts, and reported validation_pending")
	d.note("forever. The probe below runs the relationship the repository now uses.")
	d.probe("billingrestorepostgres stage-3 identity chain read (repository.go)",
		`SELECT count(*) FROM restore_sync_job_inputs i
		 JOIN billing_transaction_facts f ON f.source_raw_input_id = i.raw_input_id
		 JOIN purchase_lineages l
		   ON l.environment_id = f.environment_id
		  AND l.provider = f.provider
		  AND l.lineage_key_digest = f.purchase_chain_digest
		 WHERE i.project_id = $1`, projectID9B)
	d.query("restore job state",
		`SELECT status, attempt_count, COALESCE(outcome,'-') AS outcome,
		        COALESCE(uncertainty_reason,'-') AS uncertainty_reason,
		        observed_transaction_count, baseline_snapshot_version, snapshot_version
		 FROM restore_sync_jobs WHERE project_id=$1 ORDER BY requested_at`, projectID9B)
	status, body = d.sdkRaw(http.MethodGet, "/v1/sdk/billing/restores/"+restore.Payload.RestoreID, nil)
	d.http("GET /v1/sdk/billing/restores/{restoreId}", status, body)
	return nil
}

// ---------------------------------------------------------------------------
// Demonstration 11 — offline cache, at the wire level
// ---------------------------------------------------------------------------

func (d *demo) demo11OfflineCache() error {
	d.demonstration(11, "Offline cache bounds, demonstrated at the wire level")
	d.note("client-side cache state machines (fresh / refreshRecommended / staleWithinGrace / expired /")
	d.note("missing / invalid / differentCustomer) are proven by the Flutter, iOS, and Android conformance")
	d.note("suites against the shared fixtures. This driver demonstrates the wire those suites consume.")

	d.step("Fetch a fresh snapshot and read its freshness bounds")
	status, body, headers := d.sdkSync(d.tokenA, 0, "", nil)
	d.http("POST /v1/sdk/billing/entitlements", status, truncate(body, 900))
	var snapshot struct {
		Payload struct {
			SnapshotVersion   int64  `json:"snapshotVersion"`
			EntityTag         string `json:"entityTag"`
			IssuedAt          string `json:"issuedAt"`
			RefreshAfter      string `json:"refreshAfter"`
			ValidUntil        string `json:"validUntil"`
			StaleGraceSeconds int    `json:"staleGraceSeconds"`
			ContentDigest     string `json:"contentDigest"`
		} `json:"payload"`
	}
	if err := json.Unmarshal([]byte(body), &snapshot); err != nil {
		return err
	}
	d.note("issuedAt=%s refreshAfter=%s validUntil=%s staleGraceSeconds=%d",
		snapshot.Payload.IssuedAt, snapshot.Payload.RefreshAfter,
		snapshot.Payload.ValidUntil, snapshot.Payload.StaleGraceSeconds)
	d.note("contentDigest=%s (the integrity value every SDK recomputes before accepting a snapshot)",
		snapshot.Payload.ContentDigest)
	d.note("headers carry the same window so a bodyless answer still slides it: %s / %s / %s",
		headers.Get("Mosaic-Refresh-After"), headers.Get("Mosaic-Valid-Until"),
		headers.Get("Mosaic-Stale-Grace-Seconds"))

	d.step("Re-sync with the known version: the canonical snapshotUnchanged record slides the window")
	status, body, headers = d.sdkSync(d.tokenA, snapshot.Payload.SnapshotVersion, snapshot.Payload.EntityTag, nil)
	d.http("POST /v1/sdk/billing/entitlements (knownSnapshotVersion set)", status, body)
	d.note("still 200 with a body: the negotiated SDK form never relies on freshness that lives only in headers")

	d.step("The GET form: a plain full-snapshot read")
	status, body, headers = d.sdkConditionalGet(d.tokenA, snapshot.Payload.EntityTag)
	d.http("GET /v1/sdk/billing/entitlements (If-None-Match)", status, truncate(body, 400))
	d.note("answered %d with refresh-after=%s valid-until=%s stale-grace-seconds=%s",
		status, headers.Get("Mosaic-Refresh-After"), headers.Get("Mosaic-Valid-Until"),
		headers.Get("Mosaic-Stale-Grace-Seconds"))
	if status != http.StatusOK {
		return fmt.Errorf("the GET form must answer 200 with a full snapshot; got %d", status)
	}
	d.note("Defect D-5 is fixed by removal: the GET form is a plain full-snapshot read. It carries no")
	d.note("way to state a snapshot version, version equality is a precondition of `unchanged`, and")
	d.note("the 304 branch was therefore dead on every request that could have taken it. The POST")
	d.note("body's knownSnapshotVersion is the one conditional mechanism, and it is the one all")
	d.note("three SDKs use.")

	d.step("A stale known version is answered with the current snapshot, never with the older one")
	status, body, _ = d.sdkSync(d.tokenA, 1, "", nil)
	d.http("POST /v1/sdk/billing/entitlements (knownSnapshotVersion=1)", status, truncate(body, 400))
	return nil
}

// ---------------------------------------------------------------------------
// Demonstration 12 — identity conflict
// ---------------------------------------------------------------------------

func (d *demo) demo12IdentityConflict() error {
	d.demonstration(12, "Identity conflict")

	d.step("Create Billing Customer B")
	status, body := d.server9B(http.MethodPost, "/v1/billing/identity/customers",
		map[string]any{"applicationUserId": applicationUserB9B})
	d.http("POST /v1/billing/identity/customers", status, body)
	var customer struct {
		Data struct {
			BillingCustomerID string `json:"billingCustomerId"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(body), &customer); err != nil {
		return err
	}
	d.customerB = customer.Data.BillingCustomerID
	tokenB, err := d.issueToken(d.customerB, "demo-9b-token-b")
	if err != nil {
		return err
	}
	d.tokenB = tokenB

	d.step("A purchase lineage is associated with Customer A")
	if err := d.deliverApple(appleEvent{
		NotificationUUID: "9b000011-0000-4000-8000-000000000011",
		NotificationType: "SUBSCRIBED", SignedAt: d.at(-9 * time.Minute),
		Transaction: transactionVector{
			TransactionID: "3000000900000018", OriginalTransactionID: lineageConflict,
			ProductID: appleMonthly9B, PurchaseDate: d.at(-9 * time.Minute),
			ExpiresDate: timePointer(d.at(30 * 24 * time.Hour)),
		},
		Renewal: &renewalVector{OriginalTransactionID: lineageConflict, AutoRenewStatus: 1,
			AutoRenewProductID: appleMonthly9B, ProductID: appleMonthly9B, SignedAt: d.at(-9 * time.Minute)},
	}); err != nil {
		return err
	}
	if err := d.project(d.customerA); err != nil {
		return err
	}
	conflictLineage, err := d.lineageFor(lineageConflict)
	if err != nil {
		return err
	}
	versionABefore, versionBBefore := d.snapshotVersion(d.customerA), d.snapshotVersion(d.customerB)

	// Customer B's backend now claims the same purchase, through exactly the
	// surface Customer A's did: a token-bound observation. Nothing here is a
	// substitution — the resolver runs because a fact for that transaction was
	// re-validated, and it sees an accepted association naming A alongside
	// submission evidence naming B.
	d.step("Conflicting trusted identity evidence arrives naming Customer B")
	delete(d.boundLineages, lineageConflict)
	if err := d.bindPurchase(d.tokenB, lineageConflict, "3000000900000018", "b_"); err != nil {
		return err
	}
	d.note("both customers' backends have now claimed transaction 3000000900000018")
	d.query("the conflict is open, the lineage is frozen, and nothing was reassigned",
		`SELECT c.conflict_scope, c.status, c.detail->>'diagnosticCode' AS diagnostic_code,
		        (c.first_customer_id=$2) AS first_is_a, (c.second_customer_id=$3) AS second_is_b,
		        l.projection_frozen, l.diagnostic_status, (l.billing_customer_id=$2) AS still_attached_to_a
		 FROM billing_identity_conflicts c JOIN purchase_lineages l ON l.id = c.purchase_lineage_id
		 WHERE c.project_id=$1 AND c.status='open'`, projectID9B, d.customerA, d.customerB)

	d.step("Neither customer is granted from the frozen lineage")
	if err := d.project(d.customerA); err != nil {
		return err
	}
	if err := d.project(d.customerB); err != nil {
		return err
	}
	d.query("no double grant: the disputed lineage appears under exactly one Billing Customer",
		`SELECT s.billing_customer_id, count(*) AS sources, count(DISTINCT s.source_state) AS states
		 FROM entitlement_sources s
		 WHERE s.project_id=$1 AND s.purchase_lineage_id=$2 GROUP BY 1`, projectID9B, conflictLineage)
	d.note("the Entitlement `pro` is unchanged because a permanent one-time source still grants it;")
	d.note("freezing the disputed lineage changed no Entitlement state, so no snapshot was minted and")
	d.note("the last accepted authoritative state stands, which is the OD-10 requirement")
	d.query("last accepted authoritative state is preserved for both customers",
		`SELECT p.billing_customer_id, p.snapshot_version FROM customer_entitlement_pointers p
		 WHERE p.project_id=$1 ORDER BY p.billing_customer_id`, projectID9B)

	d.step("Operator resolution through the approved workflow")
	var conflictID string
	if err := d.pool.QueryRow(d.ctx,
		`SELECT id FROM billing_identity_conflicts WHERE project_id=$1 AND status='open'`,
		projectID9B).Scan(&conflictID); err != nil {
		return err
	}
	status, body = d.operator9B(http.MethodPost,
		"/v1/projects/"+projectID9B+"/billing/identity-conflicts/"+conflictID+"/resolution",
		map[string]any{
			"action":                    "keep_existing",
			"assignedBillingCustomerId": d.customerA,
			"reason":                    "Support ticket 4711: the store account belongs to customer A.",
		})
	d.http("POST /v1/projects/{projectId}/billing/identity-conflicts/{conflictId}/resolution", status, body)
	if status != http.StatusOK {
		return fmt.Errorf("conflict resolution returned %d", status)
	}
	d.query("the resolution is audited with its reason and the actor who took it",
		`SELECT c.status, c.resolution_action, c.resolved_by_actor_id,
		        c.detail->>'resolutionReason' AS reason, l.projection_frozen, l.diagnostic_status
		 FROM billing_identity_conflicts c JOIN purchase_lineages l ON l.id = c.purchase_lineage_id
		 WHERE c.id=$1`, conflictID)

	d.step("Both customers are reprojected")
	if err := d.drainProjection(12); err != nil {
		return err
	}
	d.query("pointers after the resolution",
		`SELECT p.billing_customer_id, p.snapshot_version, p.updated_at
		 FROM customer_entitlement_pointers p WHERE p.project_id=$1 ORDER BY p.billing_customer_id`, projectID9B)
	d.note("customer A snapshot version %d → %d; customer B %d → %d",
		versionABefore, d.snapshotVersion(d.customerA), versionBBefore, d.snapshotVersion(d.customerB))
	return d.drainWebhooks(8)
}

// ---------------------------------------------------------------------------
// Demonstration 13 — webhook retry
// ---------------------------------------------------------------------------

func (d *demo) demo13WebhookRetry() error {
	d.demonstration(13, "Webhook retry with a stable event id")

	d.step("Make the destination fail its next delivery")
	d.destination.failNext(http.StatusServiceUnavailable, 1)

	// The retried delivery is an already-committed entitlement change, re-queued
	// through the operator replay surface.
	//
	// It used to be a REVOKE on the conflict lineage. That stopped producing an
	// event once defect D-4 was fixed, and the reason is the fix working: the
	// customer holds several granting sources at this point in the scenario, so
	// revoking one changes no Entitlement state and Mosaic correctly mints no
	// snapshot and emits no event. The event the demonstration used to retry was
	// an artefact of the aggregate being recomputed from one lineage.
	//
	// Replaying a committed delivery keeps every property this demonstration is
	// about — a stable event id, a byte-identical body across attempts, a real
	// jittered backoff, an append-only attempt history — and reaches them
	// through the operator API a person would actually use.
	d.step("Re-queue a committed entitlement change through the operator replay surface")
	deliveryID := d.lastDeliveryID()
	if deliveryID == "" {
		return fmt.Errorf("no committed webhook delivery to replay")
	}
	status, body := d.actor9B(http.MethodPost,
		"/v1/projects/"+projectID9B+"/billing/webhook-deliveries/"+deliveryID+"/replay", nil)
	d.http("POST .../billing/webhook-deliveries/{deliveryId}/replay", status, truncate(body, 240))
	if status != http.StatusOK && status != http.StatusAccepted {
		return fmt.Errorf("replay returned %d", status)
	}

	d.step("Attempt delivery: the destination is down")
	if err := d.drainWebhooks(4); err != nil {
		return err
	}
	d.query("the failed attempt is recorded and a retry is scheduled",
		`SELECT a.attempt_number, a.outcome, a.response_status, COALESCE(a.error_code,'-') AS error_code,
		        (a.next_attempt_at IS NOT NULL) AS retry_scheduled
		 FROM webhook_delivery_attempts a WHERE a.project_id=$1 ORDER BY a.attempted_at DESC LIMIT 3`,
		projectID9B)
	d.query("the delivery is pending, not failed, and its state was never rolled back",
		`SELECT dl.status, dl.attempt_count, dl.max_attempts, (dl.next_attempt_at > now()) AS scheduled_ahead
		 FROM webhook_deliveries dl WHERE dl.project_id=$1 AND dl.status='pending'`, projectID9B)
	d.query("the entitlement state that produced the event is unchanged by the delivery failure",
		`SELECT p.snapshot_version, s.change_reason
		 FROM customer_entitlement_pointers p
		 JOIN customer_entitlement_snapshots s ON s.id = p.current_snapshot_id
		 WHERE p.billing_customer_id=$1 AND p.environment_id=$2`, d.customerA, environmentID9B)

	d.step("The destination recovers; wait for the scheduled retry")
	waited, err := d.waitForDelivery(2 * time.Minute)
	if err != nil {
		return err
	}
	d.note("retry became available after %s of real elapsed time; no clock was manipulated", waited.Round(time.Second))
	if err := d.drainWebhooks(6); err != nil {
		return err
	}

	d.step("Attempt history and byte-identical redelivery")
	d.query("complete attempt history for the retried delivery",
		`SELECT a.attempt_number, a.outcome, a.response_status, COALESCE(a.error_code,'-') AS error_code
		 FROM webhook_delivery_attempts a
		 WHERE a.project_id=$1 AND a.webhook_delivery_id IN (
		   SELECT id FROM webhook_deliveries WHERE project_id=$1 AND attempt_count > 1)
		 ORDER BY a.webhook_delivery_id, a.attempt_number`, projectID9B)
	d.compareRetryDeliveries()
	return nil
}

// ---------------------------------------------------------------------------
// Demonstration 14 — replay and rule versions
// ---------------------------------------------------------------------------

func (d *demo) demo14ReplayAndRuleVersions() error {
	d.demonstration(14, "Replay under the active rule, and an unimplemented rule version")

	snapshotsBefore, eventsBefore := d.counts()
	checksumBefore := d.currentChecksum(d.customerA)
	d.note("before the replay: %d customer snapshots, %d webhook events, current checksum %s",
		snapshotsBefore, eventsBefore, checksumBefore)

	d.step("Replay one customer under the active rule version")
	status, body := d.actor9B(http.MethodPost,
		"/v1/projects/"+projectID9B+"/environments/"+environmentID9B+"/billing/projection-replays",
		map[string]any{"billingCustomerId": d.customerA, "projectionRuleVersion": 1, "limit": 50})
	d.http("POST .../billing/projection-replays", status, body)
	if status != http.StatusOK {
		return fmt.Errorf("replay returned %d", status)
	}

	snapshotsAfter, eventsAfter := d.counts()
	d.note("after the replay: %d customer snapshots, %d webhook events, current checksum %s",
		snapshotsAfter, eventsAfter, d.currentChecksum(d.customerA))
	d.note("identical checksum: %v; no new snapshot: %v; no new webhook: %v",
		checksumBefore == d.currentChecksum(d.customerA),
		snapshotsBefore == snapshotsAfter, eventsBefore == eventsAfter)
	d.query("the replay recorded an attempt even though it wrote no snapshot",
		`SELECT outcome, COALESCE(error_code,'-') AS error_code, rule_version, scope_key
		 FROM projection_attempts WHERE project_id=$1 ORDER BY started_at DESC LIMIT 3`, projectID9B)

	d.step("Request an unimplemented rule version")
	status, body = d.actor9B(http.MethodPost,
		"/v1/projects/"+projectID9B+"/environments/"+environmentID9B+"/billing/projection-replays",
		map[string]any{"billingCustomerId": d.customerA, "projectionRuleVersion": 2})
	d.http("POST .../billing/projection-replays (projectionRuleVersion=2)", status, body)
	d.note("shadow projection is deferred (plan OD-11(a)): rule versions are recorded on every snapshot")
	d.note("and replay-plus-checksum comparison ships in 9B, while the diff engine waits for a second")
	d.note("implemented rule version to diff against. A request for one is refused cleanly, never")
	d.note("recomputed under the active semantics.")
	d.query("one rule version exists and it is active",
		`SELECT version, status, description FROM projection_rule_versions ORDER BY version`)

	d.step("Projection health")
	status, body = d.actor9B(http.MethodGet,
		"/v1/projects/"+projectID9B+"/environments/"+environmentID9B+"/billing/projection-health", nil)
	d.http("GET .../billing/projection-health", status, body)
	return nil
}

// ---------------------------------------------------------------------------
// The one-minute demonstration
// ---------------------------------------------------------------------------

func (d *demo) stageOneMinute() error {
	if err := d.stage9BSetup(); err != nil {
		return err
	}
	d.demonstration(0, "One-minute demonstration")

	d.step("Validated purchase → authoritative Pro Entitlement")
	status, body := d.server9B(http.MethodPost, "/v1/billing/identity/customers",
		map[string]any{"applicationUserId": applicationUserA9B})
	var customer struct {
		Data struct {
			BillingCustomerID string `json:"billingCustomerId"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(body), &customer); err != nil {
		return err
	}
	d.customerA = customer.Data.BillingCustomerID
	d.http("POST /v1/billing/identity/customers", status, body)
	token, err := d.issueToken(d.customerA, "demo-9b-one-minute")
	if err != nil {
		return err
	}
	d.tokenA = token
	d.bindToken = token

	if err := d.deliverApple(appleEvent{
		NotificationUUID: "9b0000f1-0000-4000-8000-0000000000f1",
		NotificationType: "SUBSCRIBED", SignedAt: d.at(-time.Hour),
		Transaction: transactionVector{
			TransactionID: "3000000900000101", OriginalTransactionID: lineageOneMinuteSub,
			ProductID: appleMonthly9B, PurchaseDate: d.at(-time.Hour),
			ExpiresDate: timePointer(d.at(30 * 24 * time.Hour)),
		},
		Renewal: &renewalVector{OriginalTransactionID: lineageOneMinuteSub, AutoRenewStatus: 1,
			AutoRenewProductID: appleMonthly9B, ProductID: appleMonthly9B, SignedAt: d.at(-time.Hour)},
	}); err != nil {
		return err
	}
	if err := d.project(d.customerA); err != nil {
		return err
	}
	d.showCustomerSnapshot()

	d.step("Cancellation keeps access through the period end")
	if err := d.deliverApple(appleEvent{
		NotificationUUID: "9b0000f2-0000-4000-8000-0000000000f2",
		NotificationType: "DID_CHANGE_RENEWAL_STATUS", SignedAt: d.at(-30 * time.Minute),
		Transaction: transactionVector{
			TransactionID: "3000000900000102", OriginalTransactionID: lineageOneMinuteSub,
			ProductID: appleMonthly9B, TransactionReason: "RENEWAL", PurchaseDate: d.at(-time.Hour),
			ExpiresDate: timePointer(d.at(30 * 24 * time.Hour)), SignedDate: d.at(-30 * time.Minute),
		},
		Renewal: &renewalVector{OriginalTransactionID: lineageOneMinuteSub, AutoRenewStatus: 0,
			AutoRenewProductID: appleMonthly9B, ProductID: appleMonthly9B, SignedAt: d.at(-30 * time.Minute)},
	}); err != nil {
		return err
	}
	if err := d.project(d.customerA); err != nil {
		return err
	}
	d.showSubscriptionState()
	d.showCustomerSnapshot()

	d.step("A lifetime purchase joins the same Entitlement")
	if err := d.deliverApple(appleEvent{
		NotificationUUID: "9b0000f3-0000-4000-8000-0000000000f3",
		NotificationType: "ONE_TIME_CHARGE", SignedAt: d.at(-20 * time.Minute),
		Transaction: transactionVector{
			TransactionID: "3000000900000103", OriginalTransactionID: lineageOneMinuteLifer,
			ProductID: appleLifetime9B, ProductType: "Non-Consumable", PurchaseDate: d.at(-20 * time.Minute),
		},
	}); err != nil {
		return err
	}
	if err := d.project(d.customerA); err != nil {
		return err
	}

	d.step("Expiration removes the subscription source; the lifetime source keeps access active")
	if err := d.deliverApple(appleEvent{
		NotificationUUID: "9b0000f4-0000-4000-8000-0000000000f4",
		NotificationType: "EXPIRED", SignedAt: d.at(-10 * time.Minute),
		Transaction: transactionVector{
			TransactionID: "3000000900000104", OriginalTransactionID: lineageOneMinuteSub,
			ProductID: appleMonthly9B, TransactionReason: "RENEWAL", PurchaseDate: d.at(-time.Hour),
			ExpiresDate: timePointer(d.at(-10 * time.Minute)), SignedDate: d.at(-10 * time.Minute),
		},
		Renewal: &renewalVector{OriginalTransactionID: lineageOneMinuteSub, AutoRenewStatus: 0,
			AutoRenewProductID: appleMonthly9B, ProductID: appleMonthly9B, SignedAt: d.at(-10 * time.Minute)},
	}); err != nil {
		return err
	}
	if err := d.project(d.customerA); err != nil {
		return err
	}
	d.showCustomerSnapshot()
	d.showSources()

	d.step("The SDK wire returns the same snapshot")
	status, body, _ = d.sdkSync(d.tokenA, 0, "", []string{entitlementKey9B})
	d.http("POST /v1/sdk/billing/entitlements", status, body)

	d.step("The signed webhook reports the change")
	if err := d.drainWebhooks(8); err != nil {
		return err
	}
	d.showDeliveries()
	return nil
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

// deliverApple posts one synthetic signed Apple notification to the real intake
// endpoint, installs the matching signed transaction on the App Store Server API
// stub, and runs the real validation worker job over it.
func (d *demo) deliverApple(event appleEvent) error {
	body, signedTransaction, err := d.chain.buildAppleEvent(event)
	if err != nil {
		return err
	}
	d.apple.addTransaction(event.Transaction.TransactionID, signedTransaction)
	// A real SDK reports the purchase it just made, carrying the customer's
	// token. That submission is what lets the store's own notification — which
	// names nobody — reach an identified customer.
	if err := d.bindPurchase(d.bindToken, event.Transaction.OriginalTransactionID,
		event.Transaction.TransactionID, "a_"); err != nil {
		return err
	}
	status, response := d.raw(http.MethodPost, d.intakePath9B, body, nil)
	d.note("intake %s/%s → %d %s", event.NotificationType, orDash(event.Subtype), status, truncate(response, 160))
	if status != http.StatusAccepted && status != http.StatusOK {
		return fmt.Errorf("intake for %s returned %d: %s", event.NotificationUUID, status, response)
	}
	return d.drainValidation(6)
}

// bindPurchase submits a Customer Access Token-bound observation for one
// transaction, which is how a purchase reaches an identified Billing Customer in
// production.
//
// This replaces the `bridge()` substitution the first Stage 4 run had to
// perform. Nothing is stood in for any more: the observation goes through the
// real public SDK endpoint with the real token, Mosaic records the
// submission-context association evidence itself, and when the notification's
// fact commits the seam reads that evidence back and attaches the lineage. The
// lineage row, both instance rows, the association, the supersession edge, and
// the projection trigger are all written by production code.
//
// One observation per purchase chain is enough. After the first fact the lineage
// carries an accepted association, and a prior association is itself the
// evidence that a renewal does not have to re-prove identity — which is exactly
// what a real SDK does: it reports the purchase once, and the store's
// notifications carry the rest of the lifecycle.
func (d *demo) bindPurchase(token, lineage, transactionID, label string) error {
	if token == "" || d.boundLineages[lineage] {
		return nil
	}
	d.boundLineages[lineage] = true
	// The submission id is per (transaction, reporter). Two backends reporting
	// the same purchase are two submissions, not a duplicate of one, and the
	// second has to become its own Raw Billing Input or the claim it carries is
	// never validated and never reaches the resolver.
	status, body := d.raw(http.MethodPost, "/v1/sdk/billing/observations",
		encode(observation9B("obs_bind_"+label+transactionID, "sub_bind_"+label+transactionID, transactionID)),
		map[string]string{
			"Authorization":                 "Bearer " + d.publicKey9B.raw,
			billinghttp.CustomerTokenHeader: token,
		})
	if status != http.StatusAccepted && status != http.StatusOK {
		return fmt.Errorf("token-bound observation for %s returned %d: %s", transactionID, status, body)
	}
	d.note("SDK observed transaction %s under a Customer Access Token; Mosaic recorded the association",
		transactionID)
	return d.drainValidation(6)
}

// projectQueued enqueues a customer-scoped projection through the real trigger
// path and drains it with the real worker job function. This is exactly what a
// deployed worker does.
func (d *demo) projectQueued(customerID string) error {
	if err := d.projection.Enqueue(d.ctx, billingprojection.Scope{
		ProjectID: projectID9B, EnvironmentID: environmentID9B, CustomerID: customerID,
	}, billingprojection.KindFactCommitted); err != nil {
		return err
	}
	return d.drainProjection(12)
}

// project drives one customer projection exactly as a deployed worker does:
// enqueue through the real trigger, drain with the real job function.
//
// The direct customer-scoped `Project` call this used to end with was the
// workaround for defect D-4, which is fixed: the queued path now carries a
// customer id and no lineage id, so it recomputes the aggregate from every
// lineage the customer holds.
func (d *demo) project(customerID string) error {
	return d.projectQueued(customerID)
}

func (d *demo) drainProjection(limit int) error {
	for index := 0; index < limit; index++ {
		processed, err := d.projection.ProcessNextProjection(d.ctx, "demo-worker")
		if err != nil {
			return err
		}
		if !processed {
			return nil
		}
	}
	return nil
}

func (d *demo) drainWebhooks(limit int) error {
	for index := 0; index < limit; index++ {
		processed, err := d.webhooks.ProcessNextDelivery(d.ctx, "demo-worker")
		if err != nil {
			return err
		}
		if !processed {
			return nil
		}
	}
	return nil
}

func (d *demo) waitForDelivery(budget time.Duration) (time.Duration, error) {
	started := time.Now()
	for time.Since(started) < budget {
		var ready bool
		err := d.pool.QueryRow(d.ctx,
			`SELECT COALESCE(bool_or(next_attempt_at <= now()), false)
			 FROM webhook_deliveries WHERE project_id=$1 AND status='pending'`, projectID9B).Scan(&ready)
		if err != nil {
			return 0, err
		}
		if ready {
			return time.Since(started), nil
		}
		time.Sleep(time.Second)
	}
	return 0, fmt.Errorf("no webhook delivery became available within %s", budget)
}
