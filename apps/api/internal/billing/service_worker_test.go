package billing

import (
	"crypto/rand"
	"encoding/json"
	"testing"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/appstorejws"
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

// 9A defect B7: worker wall-clock must never date a fact. An Apple payload
// with no provider timestamp yields no fact, and two validations of the same
// payload at different wall-clock instants produce identical digests.
func TestAppleFactRejectsMissingProviderTimestamp(t *testing.T) {
	fact := TransactionFact{StoreEnvironment: StoreProduction}
	if applyAppleTransaction(&fact, appstorejws.TransactionPayload{TransactionID: "100"}, nil) {
		t.Fatal("a payload with no provider timestamp must not produce a fact")
	}

	// SignedDate alone is an acceptable provider timestamp.
	fact = TransactionFact{StoreEnvironment: StoreProduction}
	if !applyAppleTransaction(&fact, appstorejws.TransactionPayload{TransactionID: "100", SignedDate: 1767225600000}, nil) {
		t.Fatal("signedDate is a provider timestamp and must be accepted")
	}
	if !fact.OccurredAt.Equal(time.UnixMilli(1767225600000).UTC()) {
		t.Fatalf("occurred_at %v, want the provider signedDate", fact.OccurredAt)
	}
}

// Digest stability across validations at different wall-clock times is the
// property B7 protects: replay of the same input must be a structural no-op.
func TestFactDigestStableAcrossWallClock(t *testing.T) {
	build := func() TransactionFact {
		fact := TransactionFact{
			EnvironmentID: "env_1", ApplicationID: "app_1", Provider: ProviderAppStore,
			StoreEnvironment: StoreProduction, ProviderTransactionID: "100",
			TransactionType: TypeAutoRenewableSubscription, ValidatorVersion: ValidatorVersion, FactVersion: 1,
		}
		applyAppleTransaction(&fact, appstorejws.TransactionPayload{
			TransactionID: "100", OriginalTransactionID: "90",
			PurchaseDate: 1767225600000, ExpiresDate: 1769904000000,
		}, nil)
		fact.FactKind = KindRenewal
		return fact
	}
	one, two := build(), build()
	one.RecordedAt = at("2026-01-01T00:00:00Z")
	two.RecordedAt = at("2026-06-01T12:34:56Z")
	if string(FactDigest(one)) != string(FactDigest(two)) {
		t.Fatal("FactDigest depends on wall-clock state; replay idempotency is broken")
	}
}

// 9A correction: both Apple revocation reasons are refunds. Reason 0
// ("refunded for another reason") previously recorded revoked_at with no
// refunded_at, so the refund scope was invisible to any consumer.
func TestAppleRevocationAlwaysCarriesRefund(t *testing.T) {
	reason := 0
	fact := TransactionFact{StoreEnvironment: StoreProduction}
	applyAppleTransaction(&fact, appstorejws.TransactionPayload{
		TransactionID: "100", PurchaseDate: 1767225600000,
		RevocationDate: 1768000000000, RevocationReason: &reason,
	}, nil)
	if fact.RevokedAt == nil || fact.RefundedAt == nil {
		t.Fatalf("revocation with reason 0 must set both revoked_at and refunded_at, got %+v", fact)
	}
	if !fact.RefundedAt.Equal(time.UnixMilli(1768000000000).UTC()) {
		t.Fatalf("refunded_at %v, want the provider revocationDate", fact.RefundedAt)
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
	supersessionOne, errOne := serviceOne.supersessionFactFrom(factOne)
	supersessionTwo, errTwo := serviceTwo.supersessionFactFrom(factTwo)
	if errOne != nil || errTwo != nil {
		t.Fatalf("supersession fact was not built: %v / %v", errOne, errTwo)
	}
	if supersessionOne.FactKind != KindPurchaseSuperseded {
		t.Fatalf("supersession fact kind %q", supersessionOne.FactKind)
	}
	if string(supersessionOne.FactDigest) != string(supersessionTwo.FactDigest) {
		t.Fatal("supersession fact digest changed across renewals; the link would be recorded repeatedly")
	}
}

// Review finding I-4: a Google void whose Product cannot be attributed used to
// produce no Transaction Fact at all — a multi-line-item order quarantined the
// input as a malformed reference, and a permanently failing orders.get burned
// its attempts — so the refunded purchase kept granting its Entitlement
// indefinitely. Money left the merchant and access did not.
//
// This pins the shape of the recovery: a refund fact is recorded with an
// unresolved Product (which the projection reads as `unknown`, never `owned`),
// dated with the provider's own event time, and the input is quarantined under
// its own reason code so the operator queue can tell "refund recorded, product
// attribution owed" from a broken input.
func TestVoidWithoutResolvableProductStillRecordsTheRefund(t *testing.T) {
	now := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	service := testService(now)
	eventTime := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)

	input := RawInput{
		ID: "bri_1", ProjectID: "prj_1", EnvironmentID: "env_1",
		EnvironmentMode: "production", Provider: ProviderGooglePlay,
		CorrelationID: "corr_1",
	}
	fact := TransactionFact{
		ProjectID: "prj_1", EnvironmentID: "env_1", EnvironmentMode: "production",
		ApplicationID: "app_1", Provider: ProviderGooglePlay,
		StoreEnvironment: StoreProduction, PurchaseChainDigest: TokenDigest("token-1"),
		ValidatorVersion: ValidatorVersion, FactVersion: 1,
		SourceRawInputID: "bri_1", ValidationAttemptID: "bva_1",
	}
	work := googleWork{voided: true, refundType: 1, eventTime: eventTime}

	outcome := service.voidWithoutProduct(ValidationJob{}, input, fact, work,
		"bva_1", 1, now, "GPA.900-1", "void_order_line_items_ambiguous")

	if outcome.Fact == nil {
		t.Fatal("an unattributable void produced no fact; the refunded purchase would keep granting")
	}
	if outcome.Fact.FactKind != KindRefund {
		t.Fatalf("fact kind %q, want %q", outcome.Fact.FactKind, KindRefund)
	}
	if outcome.Fact.ResolutionState != StateUnresolved || outcome.Fact.MosaicProductID != "" {
		t.Fatalf("fact must be product-unresolved, got state %q product %q",
			outcome.Fact.ResolutionState, outcome.Fact.MosaicProductID)
	}
	if !outcome.Fact.OccurredAt.Equal(eventTime) || outcome.Fact.RefundedAt == nil {
		t.Fatalf("refund must be dated with the provider event time, got %v", outcome.Fact.OccurredAt)
	}
	if len(outcome.Fact.FactDigest) == 0 {
		t.Fatal("fact digest was not computed; duplicate delivery would not deduplicate")
	}
	if outcome.Quarantine == nil || outcome.Quarantine.ReasonCode != QuarantineVoidProductUnresolved {
		t.Fatalf("quarantine reason %+v, want %q", outcome.Quarantine, QuarantineVoidProductUnresolved)
	}
	if outcome.JobStatus != "completed" {
		t.Fatalf("job status %q, want completed: re-running reaches the same answer", outcome.JobStatus)
	}

	// No provider timestamp anywhere still yields no fact (9A correction B7);
	// the recovery must not become a wall-clock backdoor.
	undated := service.voidWithoutProduct(ValidationJob{}, input, fact,
		googleWork{voided: true}, "bva_2", 1, now, "GPA.900-1", "void_order_line_items_ambiguous")
	if undated.Fact != nil {
		t.Fatal("a void with no provider timestamp produced a fact")
	}
	if undated.Quarantine == nil || undated.Quarantine.ReasonCode != QuarantineMissingProviderTimestamp {
		t.Fatalf("undated void quarantine %+v, want missing_provider_timestamp", undated.Quarantine)
	}
}

func TestMigrationBindingRejectsWrongApplicationProviderProductAndTargetProduct(t *testing.T) {
	binding := &MigrationValidationBinding{ExpectedApplicationID: "app_expected", ExpectedStoreProductIdentifier: "store_expected", ExpectedMosaicProductID: "product_expected", ExpectedStoreEnvironment: StoreProduction}
	if diagnostic, _ := migrationApplicationMismatch(binding, "app_other"); diagnostic != DiagnosticMigrationApplicationMismatch {
		t.Fatalf("application diagnostic=%q", diagnostic)
	}
	for _, product := range []string{"", "store_other"} {
		if diagnostic, _ := migrationProviderProductMismatch(binding, product); diagnostic != DiagnosticMigrationProviderProductMismatch {
			t.Fatalf("provider Product %q diagnostic=%q", product, diagnostic)
		}
	}
	if diagnostic, _ := migrationStoreEnvironmentMismatch(binding, ""); diagnostic != DiagnosticMigrationStoreEnvironmentMismatch {
		t.Fatalf("empty environment diagnostic=%q", diagnostic)
	}
	if diagnostic, _ := migrationStoreEnvironmentMismatch(binding, StoreSandbox); diagnostic != DiagnosticMigrationStoreEnvironmentMismatch {
		t.Fatalf("wrong environment diagnostic=%q", diagnostic)
	}
	if diagnostic, _ := migrationResolutionMismatch(binding, Resolution{Outcome: ResolutionResolved, MosaicProductID: "product_other"}); diagnostic != DiagnosticMigrationMosaicProductMismatch {
		t.Fatalf("target diagnostic=%q", diagnostic)
	}
}

func TestMigrationUnresolvedOrAmbiguousResolutionQuarantinesWithoutFact(t *testing.T) {
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	service := testService(now)
	input := RawInput{ID: "raw", ProjectID: "project", EnvironmentID: "environment", Provider: ProviderAppStore, CorrelationID: "binding", MigrationValidation: &MigrationValidationBinding{ExpectedMosaicProductID: "product_expected"}}
	for _, resolution := range []Resolution{{Outcome: ResolutionUnknown}, {Outcome: ResolutionAmbiguous, CandidateCount: 2}} {
		outcome, quarantined := service.enforceMigrationResolution(ValidationJob{}, input, resolution, "attempt", 1, now)
		if !quarantined || outcome.Fact != nil || outcome.Quarantine == nil || outcome.Attempt.DiagnosticCode != DiagnosticMigrationMosaicProductUnresolved {
			t.Fatalf("resolution=%+v outcome=%+v quarantined=%v", resolution, outcome, quarantined)
		}
	}
}
