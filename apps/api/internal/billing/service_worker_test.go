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
