//go:build billingdemo

// This file belongs to the build-tagged demonstration driver and is excluded
// from every ordinary build. See demo9b_stubs.go for why that matters.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingwebhook"
	billingaccesshttp "github.com/Mujhtech/mosaic/apps/api/internal/transport/billingaccess"
	billingrestorehttp "github.com/Mujhtech/mosaic/apps/api/internal/transport/billingrestore"
)

// billingWebhookSign is Mosaic's own signing function, used to check the
// published cross-implementation vectors. The destination stub verifies with an
// independent implementation on purpose (demo9b_stubs.go).
func billingWebhookSign(secret string, timestamp int64, eventID string, body []byte) string {
	return billingwebhook.Sign(secret, timestamp, eventID, body)
}

// ---------------------------------------------------------------------------
// HTTP helpers for the Phase 9B tenant
// ---------------------------------------------------------------------------

// actor9B calls a dashboard-authenticated operator route as the 9B owner.
func (d *demo) actor9B(method, path string, body any) (int, string) {
	return d.raw(method, path, encode(body), map[string]string{"X-Demo-Actor": ownerActorID9B})
}

// operator9B calls the Phase 9B dashboard operator surface. It goes to the
// second mux built in wire(); see the defect recorded there.
func (d *demo) operator9B(method, path string, body any) (int, string) {
	var reader io.Reader
	if encoded := encode(body); encoded != "" {
		reader = bytes.NewReader([]byte(encoded))
	}
	request, err := http.NewRequestWithContext(d.ctx, method, d.operatorServer.URL+path, reader)
	if err != nil {
		return 0, err.Error()
	}
	if reader != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	request.Header.Set("X-Demo-Actor", ownerActorID9B)
	response, err := d.operatorServer.Client().Do(request)
	if err != nil {
		return 0, err.Error()
	}
	defer func() { _ = response.Body.Close() }()
	payload, _ := io.ReadAll(response.Body)
	return response.StatusCode, strings.TrimSpace(string(payload))
}

// server9B calls a trusted-server route with the Project's secret server key.
func (d *demo) server9B(method, path string, body any) (int, string) {
	return d.raw(method, path, encode(body), map[string]string{
		"Authorization": "Bearer " + d.serverKey9B.raw,
	})
}

// sdkRaw calls an SDK route with only the public SDK key, which is all the
// restore surface takes.
func (d *demo) sdkRaw(method, path string, body any) (int, string) {
	return d.raw(method, path, encode(body), map[string]string{
		billingrestorehttp.SDKKeyHeader: d.publicKey9B.raw,
	})
}

// sdkSync posts the ratified Authoritative Entitlement sync request — the exact
// wire form the Flutter, iOS, and Android SDKs send.
func (d *demo) sdkSync(token string, knownVersion int64, entityTag string, keys []string) (int, string, http.Header) {
	payload := map[string]any{
		"supportedAuthoritativeEntitlementContracts": []string{"1"},
		"correlationId": "demo-9b-sync",
	}
	if knownVersion > 0 {
		payload["knownSnapshotVersion"] = knownVersion
	}
	if entityTag != "" {
		payload["entityTag"] = entityTag
	}
	if len(keys) > 0 {
		payload["requestedEntitlementKeys"] = keys
	}
	return d.rawWithHeaders(http.MethodPost, "/v1/sdk/billing/entitlements", encode(map[string]any{
		"authoritativeEntitlementContractVersion": "1",
		"recordType": "entitlementSyncRequest",
		"payload":    payload,
	}), map[string]string{
		"Authorization":                d.bearer(token),
		billingaccesshttp.SDKKeyHeader: d.publicKey9B.raw,
	})
}

func (d *demo) sdkConditionalGet(token, entityTag string) (int, string, http.Header) {
	return d.rawWithHeaders(http.MethodGet, "/v1/sdk/billing/entitlements", "", map[string]string{
		"Authorization":                d.bearer(token),
		billingaccesshttp.SDKKeyHeader: d.publicKey9B.raw,
		"If-None-Match":                `"` + entityTag + `"`,
	})
}

func (d *demo) bearer(token string) string { return "Bearer " + token }

// rawWithHeaders is d.raw with the response headers preserved. The freshness
// window travels in headers as well as in the record, so a demonstration that
// dropped them would not be showing the whole contract.
func (d *demo) rawWithHeaders(method, path, body string, headers map[string]string) (int, string, http.Header) {
	var reader io.Reader
	if body != "" {
		reader = bytes.NewReader([]byte(body))
	}
	request, err := http.NewRequestWithContext(d.ctx, method, d.server.URL+path, reader)
	if err != nil {
		return 0, err.Error(), http.Header{}
	}
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	response, err := d.server.Client().Do(request)
	if err != nil {
		return 0, err.Error(), http.Header{}
	}
	defer func() { _ = response.Body.Close() }()
	payload, _ := io.ReadAll(response.Body)
	return response.StatusCode, strings.TrimSpace(string(payload)), response.Header
}

// issueToken mints a Customer Access Token through the real trusted API.
func (d *demo) issueToken(customerID, correlationID string) (string, error) {
	status, body := d.server9B(http.MethodPost, "/v1/billing/server/customer-tokens", map[string]any{
		"customerAccessTokenContractVersion": "1",
		"recordType":                         "customerAccessTokenIssuanceRequest",
		"payload": map[string]any{
			"billingCustomerId":   customerID,
			"audience":            "sdk_sync",
			"scopes":              []string{"entitlements.read", "entitlements.sync"},
			"requestedTtlSeconds": 3600,
			"correlationId":       correlationID,
		},
	})
	d.http("POST /v1/billing/server/customer-tokens", status, redactToken(body))
	if status != http.StatusCreated {
		return "", fmt.Errorf("token issuance returned %d", status)
	}
	var issued struct {
		Data struct {
			Payload struct {
				Token string `json:"token"`
			} `json:"payload"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(body), &issued); err != nil {
		return "", err
	}
	if issued.Data.Payload.Token == "" {
		return "", fmt.Errorf("no token in issuance response")
	}
	return issued.Data.Payload.Token, nil
}

// observation9B builds the Billing Ingestion Contract v1 client record an SDK
// sends after a purchase or a restore.
func observation9B(observationID, submissionID, transactionID string) map[string]any {
	return map[string]any{
		"billingIngestionContractVersion": "1",
		"recordType":                      "clientTransactionObservation",
		"payload": map[string]any{
			"observationId": observationID,
			"submissionId":  submissionID,
			"providerId":    "apple_app_store",
			"storePlatform": "apple_app_store",
			"transactionReference": map[string]string{
				"referenceKind": billing.ReferenceAppStoreTransactionID, "value": transactionID,
			},
			"observedAt":      time.Now().UTC().Format("2006-01-02T15:04:05Z"),
			"sourceAuthority": "client_observation",
			"context": map[string]string{
				"platform": "ios", "sdkFamily": "mosaic-ios", "sdkVersion": "1.0.0",
			},
		},
	}
}

// ---------------------------------------------------------------------------
// Reads used by more than one demonstration
// ---------------------------------------------------------------------------

func (d *demo) showSubscriptionState() {
	d.query("current Subscription Snapshot",
		`SELECT ss.projection_version, ss.access_state, ss.lifecycle_state, ss.renewal_intent,
		        ss.billing_state, ss.uncertainty_reason, ss.period_start_at, ss.period_end_at,
		        ss.grace_period_end_at, ss.cancellation_effective_at, ss.expiration_effective_at,
		        ss.current_product_id
		 FROM subscription_snapshots ss
		 JOIN subscription_instances si ON si.current_snapshot_id = ss.id
		 WHERE ss.project_id=$1 ORDER BY ss.created_at DESC LIMIT 4`, projectID9B)
}

func (d *demo) showCustomerSnapshot() {
	d.query("current Customer Entitlement Snapshot and its entries",
		`SELECT s.snapshot_version, s.change_reason, e.entitlement_key, e.state, e.end_known,
		        e.effective_start, e.effective_end, e.source_count, e.uncertainty_reason, e.explanation_code
		 FROM customer_entitlement_pointers p
		 JOIN customer_entitlement_snapshots s ON s.id = p.current_snapshot_id
		 LEFT JOIN customer_entitlement_snapshot_entries e ON e.customer_entitlement_snapshot_id = s.id
		 WHERE p.billing_customer_id=$1 AND p.environment_id=$2
		 ORDER BY e.entitlement_key`, d.customerA, environmentID9B)
}

func (d *demo) showSources() {
	d.query("every Entitlement Source on the current snapshot, with its explanation",
		`SELECT s.source_type, s.source_state, s.explanation_code, s.source_start, s.source_end,
		        s.end_known, s.is_test_source,
		        (s.subscription_instance_id IS NOT NULL) AS from_subscription,
		        (s.one_time_purchase_instance_id IS NOT NULL) AS from_one_time
		 FROM entitlement_sources s
		 WHERE s.customer_entitlement_snapshot_id = (
		   SELECT current_snapshot_id FROM customer_entitlement_pointers
		   WHERE billing_customer_id=$1 AND environment_id=$2)
		 ORDER BY s.source_type, s.source_start, s.id`, d.customerA, environmentID9B)
}

func (d *demo) showTimeline(originalTransactionID string) {
	d.query("Subscription Timeline (append-only)",
		`SELECT t.entry_type, t.effective_at, t.explanation_code, t.rule_version
		 FROM subscription_timeline_entries t
		 JOIN subscription_instances si ON si.id = t.subscription_instance_id
		 JOIN purchase_lineages l ON l.id = si.purchase_lineage_id
		 WHERE l.lineage_key_digest=$1 ORDER BY t.effective_at, t.id`,
		billing.AppleTransactionKey("production", originalTransactionID))
}

func (d *demo) showDeliveries() {
	received := d.destination.deliveries()
	if len(received) == 0 {
		d.note("no webhook has reached the destination stub yet")
		return
	}
	for _, delivery := range received[max(0, len(received)-4):] {
		d.note("destination received event %s (answered %d); signature verified against key %d: %v",
			delivery.EventID, delivery.Status, delivery.VerifiedKey, delivery.Verified)
	}
	d.query("delivery outcomes recorded by Mosaic",
		`SELECT dl.status, dl.attempt_count, a.outcome, a.response_status
		 FROM webhook_deliveries dl
		 LEFT JOIN webhook_delivery_attempts a ON a.webhook_delivery_id = dl.id
		 WHERE dl.project_id=$1 ORDER BY dl.created_at DESC, a.attempt_number DESC LIMIT 6`, projectID9B)
}

// compareRetryDeliveries proves the retry carried the same event id and a
// byte-identical body.
func (d *demo) compareRetryDeliveries() {
	received := d.destination.deliveries()
	byEvent := map[string][]receivedWebhook{}
	for _, delivery := range received {
		byEvent[delivery.EventID] = append(byEvent[delivery.EventID], delivery)
	}
	for eventID, attempts := range byEvent {
		if len(attempts) < 2 {
			continue
		}
		identical := true
		for index := 1; index < len(attempts); index++ {
			if !bytes.Equal(attempts[0].Body, attempts[index].Body) {
				identical = false
			}
		}
		d.note("event %s was delivered %d times; body byte-identical across attempts: %v",
			eventID, len(attempts), identical)
		d.note("first attempt answered %d, last answered %d; signature verified each time: %v/%v",
			attempts[0].Status, attempts[len(attempts)-1].Status,
			attempts[0].Verified, attempts[len(attempts)-1].Verified)
	}
}

func (d *demo) snapshotVersion(customerID string) int64 {
	if customerID == "" {
		return 0
	}
	var version int64
	_ = d.pool.QueryRow(d.ctx,
		`SELECT COALESCE(snapshot_version,0) FROM customer_entitlement_pointers
		 WHERE billing_customer_id=$1 AND environment_id=$2`, customerID, environmentID9B).Scan(&version)
	return version
}

func (d *demo) currentChecksum(customerID string) string {
	var checksum string
	_ = d.pool.QueryRow(d.ctx,
		`SELECT encode(s.checksum,'hex') FROM customer_entitlement_pointers p
		 JOIN customer_entitlement_snapshots s ON s.id = p.current_snapshot_id
		 WHERE p.billing_customer_id=$1 AND p.environment_id=$2`, customerID, environmentID9B).Scan(&checksum)
	return checksum
}

func (d *demo) counts() (snapshots int, events int) {
	_ = d.pool.QueryRow(d.ctx,
		`SELECT (SELECT count(*) FROM customer_entitlement_snapshots WHERE project_id=$1),
		        (SELECT count(*) FROM webhook_events WHERE project_id=$1)`, projectID9B).Scan(&snapshots, &events)
	return snapshots, events
}

func (d *demo) subscriptionPeriodEnd(originalTransactionID string) string {
	var value *time.Time
	_ = d.pool.QueryRow(d.ctx,
		`SELECT ss.period_end_at FROM subscription_snapshots ss
		 JOIN subscription_instances si ON si.current_snapshot_id = ss.id
		 JOIN purchase_lineages l ON l.id = si.purchase_lineage_id
		 WHERE l.lineage_key_digest=$1`,
		billing.AppleTransactionKey("production", originalTransactionID)).Scan(&value)
	if value == nil {
		return "(none)"
	}
	return value.UTC().Format(time.RFC3339)
}

func (d *demo) lineageFor(originalTransactionID string) (string, error) {
	var id string
	err := d.pool.QueryRow(d.ctx,
		`SELECT id FROM purchase_lineages WHERE project_id=$1 AND lineage_key_digest=$2`,
		projectID9B, billing.AppleTransactionKey("production", originalTransactionID)).Scan(&id)
	return id, err
}

func (d *demo) latestRawInput() (string, error) {
	var id string
	err := d.pool.QueryRow(d.ctx,
		`SELECT id FROM billing_raw_inputs WHERE project_id=$1 ORDER BY received_at DESC LIMIT 1`,
		projectID9B).Scan(&id)
	return id, err
}

// ---------------------------------------------------------------------------
// Transcript helpers
// ---------------------------------------------------------------------------

func (d *demo) demonstration(number int, title string) {
	if number == 0 {
		fmt.Printf("\n\n########## ONE-MINUTE DEMONSTRATION — %s ##########\n", title)
	} else {
		fmt.Printf("\n\n########## DEMONSTRATION %d — %s ##########\n", number, title)
	}
	d.stepNumber = 0
	d.demoNumber = number
}

func truncate(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "… (" + fmt.Sprint(len(value)) + " bytes)"
}

func orDash(value string) string {
	if value == "" {
		return "-"
	}
	return value
}

// redactToken removes the one Customer Access Token value a response ever
// carries. It is a bearer credential and must not reach an evidence document.
func redactToken(body string) string {
	return redactMember(body, `"token":"`)
}

// redactSecret removes the webhook signing secret from a destination response.
func redactSecret(body string) string {
	return redactMember(body, `"secret":"`)
}

func redactMember(body, marker string) string {
	index := strings.Index(body, marker)
	if index < 0 {
		return body
	}
	rest := body[index+len(marker):]
	end := strings.Index(rest, `"`)
	if end < 0 {
		return body
	}
	return body[:index+len(marker)] + "<REDACTED>" + body[index+len(marker)+end:]
}

func max(left, right int) int {
	if left > right {
		return left
	}
	return right
}

// probe runs a read that is expected to reveal something, and prints the error
// rather than aborting when it fails. A demonstration that hides a failing
// query is not a demonstration.
func (d *demo) probe(label, sql string, args ...any) {
	fmt.Printf("    PROBE: %s\n", label)
	rows, err := d.pool.Query(d.ctx, sql, args...)
	if err != nil {
		fmt.Printf("      FAILED: %v\n", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		values, valueErr := rows.Values()
		if valueErr != nil {
			fmt.Printf("      FAILED: %v\n", valueErr)
			return
		}
		cells := make([]string, len(values))
		for index, value := range values {
			cells[index] = render(value)
		}
		fmt.Printf("      %s\n", strings.Join(cells, " | "))
	}
	if err := rows.Err(); err != nil {
		fmt.Printf("      FAILED: %v\n", err)
	}
}
