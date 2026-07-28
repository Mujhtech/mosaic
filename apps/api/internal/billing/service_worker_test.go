package billing

import (
	"crypto/rand"
	"encoding/json"
	"testing"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/googleplay"
)

// These tests pin the 9A corrections classified in the Phase 9B plan (§1.2,
// OD-13): each one is a defect that live-sandbox validation would have caught,
// and each could silently return through a refactor of the Google or Apple
// fact-assembly path.

func googlePurchase(t *testing.T, raw string) googleplay.SubscriptionPurchase {
	t.Helper()
	var purchase googleplay.SubscriptionPurchase
	if err := json.Unmarshal([]byte(raw), &purchase); err != nil {
		t.Fatalf("decode fixture purchase: %v", err)
	}
	return purchase
}

func testService(now time.Time) *Service {
	return &Service{now: func() time.Time { return now }, random: rand.Reader}
}

// 9A defect B1: a Google linkedPurchaseToken is a persistent attribute of the
// successor subscription. Overwriting fact_kind with purchase_superseded hid
// every later state fact (expiration, cancellation, grace) behind the link,
// which meant indefinite entitlement after any Google plan change.
func TestGoogleSubscriptionKeepsStateKindWhenLinkedTokenPresent(t *testing.T) {
	purchase := googlePurchase(t, `{
		"startTime": "2026-01-01T00:00:00Z",
		"subscriptionState": "SUBSCRIPTION_STATE_CANCELED",
		"latestOrderId": "GPA.100-1",
		"linkedPurchaseToken": "old-token",
		"lineItems": [{"productId": "pro.monthly", "expiryTime": "2026-02-01T00:00:00Z"}]
	}`)
	fact := TransactionFact{PurchaseChainDigest: TokenDigest("new-token")}
	applyGoogleSubscription(&fact, purchase)

	if fact.FactKind != KindCancellationScheduled {
		t.Fatalf("fact kind %q, want the state-derived %q", fact.FactKind, KindCancellationScheduled)
	}
	if len(fact.SupersedesChainDigest) == 0 {
		t.Fatal("supersedes_chain_digest was not recorded for the linked purchase token")
	}
}

// 9A defect B2: a voided (refunded) Google one-time purchase re-queries as
// purchaseState != 0 and recorded no fact, leaving refunded non-consumables
// entitled forever. The voided-purchase notification must become a refund fact
// with both refund and revocation effective times.
func TestVoidedGoogleOneTimePurchaseProducesRefundFact(t *testing.T) {
	body := []byte(`{
		"version": "1.0",
		"packageName": "com.fixture.app",
		"eventTimeMillis": "1767225600000",
		"voidedPurchaseNotification": {
			"purchaseToken": "token-1", "orderId": "GPA.200-1", "productType": 2, "refundType": 1
		}
	}`)
	work, ok := decodeGoogleWork(body)
	if !ok || !work.voided || work.subscription {
		t.Fatalf("voided one-time decode: ok=%v work=%+v", ok, work)
	}
	if work.refundType != 1 || work.eventTime.IsZero() {
		t.Fatalf("void semantics lost: %+v", work)
	}

	fact := TransactionFact{}
	applyGoogleOneTime(&fact, googleplay.ProductPurchase{
		PurchaseTimeMillis: "1764547200000", PurchaseState: 1,
		OrderID: "GPA.200-1", ProductID: "lifetime.pro",
	})
	if !applyGoogleVoid(&fact, work, nil) {
		t.Fatal("void with provider event time must not be rejected")
	}
	if fact.FactKind != KindRefund {
		t.Fatalf("fact kind %q, want %q", fact.FactKind, KindRefund)
	}
	if fact.RefundedAt == nil || fact.RevokedAt == nil {
		t.Fatal("refund fact must carry refunded_at and revoked_at")
	}
	if !fact.RefundedAt.Equal(work.eventTime) || !fact.OccurredAt.Equal(work.eventTime) {
		t.Fatalf("refund must be dated with the provider event time, got %v", fact.RefundedAt)
	}
}

// A voided input with no provider timestamp anywhere must be rejected rather
// than dated with worker wall-clock (which would poison FactDigest — B7).
func TestVoidWithoutProviderTimestampIsRejected(t *testing.T) {
	fact := TransactionFact{}
	if applyGoogleVoid(&fact, googleWork{voided: true}, nil) {
		t.Fatal("a void without any provider timestamp must not produce a fact")
	}
}

// The supersession edge itself is a separate fact whose digest must be stable
// across re-observations of the same lineage: renewals change the order id and
// expiry, and if those leaked into the supersession fact every renewal would
// append a duplicate purchase_superseded fact.
func TestSupersessionFactDigestStableAcrossRenewals(t *testing.T) {
	first := googlePurchase(t, `{
		"startTime": "2026-01-01T00:00:00Z",
		"subscriptionState": "SUBSCRIPTION_STATE_ACTIVE",
		"latestOrderId": "GPA.100-1",
		"linkedPurchaseToken": "old-token",
		"lineItems": [{"productId": "pro.monthly", "expiryTime": "2026-02-01T00:00:00Z",
			"autoRenewingPlan": {"autoRenewEnabled": true}}]
	}`)
	second := googlePurchase(t, `{
		"startTime": "2026-01-01T00:00:00Z",
		"subscriptionState": "SUBSCRIPTION_STATE_CANCELED",
		"latestOrderId": "GPA.100-3",
		"linkedPurchaseToken": "old-token",
		"lineItems": [{"productId": "pro.monthly", "expiryTime": "2026-04-01T00:00:00Z",
			"autoRenewingPlan": {"autoRenewEnabled": false}}]
	}`)

	base := TransactionFact{
		EnvironmentID: "env_1", ApplicationID: "app_1", Provider: ProviderGooglePlay,
		StoreEnvironment: StoreProduction, PurchaseChainDigest: TokenDigest("new-token"),
		ValidatorVersion: ValidatorVersion, FactVersion: 1,
	}
	factOne, factTwo := base, base
	applyGoogleSubscription(&factOne, first)
	applyGoogleSubscription(&factTwo, second)

	serviceOne := testService(at("2026-01-01T01:00:00Z"))
	serviceTwo := testService(at("2026-03-15T09:30:00Z"))
	supersessionOne := serviceOne.supersessionFactFrom(factOne)
	supersessionTwo := serviceTwo.supersessionFactFrom(factTwo)
	if supersessionOne == nil || supersessionTwo == nil {
		t.Fatal("supersession fact was not built")
	}
	if supersessionOne.FactKind != KindPurchaseSuperseded {
		t.Fatalf("supersession fact kind %q", supersessionOne.FactKind)
	}
	if string(supersessionOne.FactDigest) != string(supersessionTwo.FactDigest) {
		t.Fatal("supersession fact digest changed across renewals; the link would be recorded repeatedly")
	}
}
