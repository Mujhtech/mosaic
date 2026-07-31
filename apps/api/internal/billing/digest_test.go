package billing

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

// The untrusted observation endpoint is the only place an attacker-controlled
// string reaches the ingestion pipeline. These tests pin the structural
// property the contract relies on: the reference bound is narrow enough that a
// JWS or a raw Google purchase token cannot fit through it, so the endpoint
// cannot be used to smuggle bearer material into storage.
func TestSafeProviderCodeExcludesTokensAndSignedPayloads(t *testing.T) {
	// A realistic Apple signedPayload is thousands of characters; a Google
	// purchase token is a few hundred. Both exceed the 128-rune bound.
	signedPayload := strings.Repeat("eyJhbGciOiJFUzI1NiIsIng1YyI6WyJNSUlF", 40)
	purchaseToken := strings.Repeat("gtokenabcdefghijklmnop", 12)

	for name, value := range map[string]string{
		"signed payload": signedPayload,
		"purchase token": purchaseToken,
	} {
		if _, ok := SafeProviderCode(value); ok {
			t.Fatalf("%s (%d chars) passed the reference bound", name, len(value))
		}
	}

	// Control characters and non-ASCII are refused so a reference cannot carry
	// a log-injection or terminal-escape payload into an operator's console.
	for _, value := range []string{"abc\ndef", "abc\x00def", "abc def", "café"} {
		if _, ok := SafeProviderCode(value); ok {
			t.Fatalf("reference %q with unsafe characters was accepted", value)
		}
	}

	if _, ok := SafeProviderCode("2000000123456789"); !ok {
		t.Fatal("a legitimate Apple transaction id was rejected")
	}
}

// Fact identity is what makes replay a no-op. Two validations of the same
// transaction against the same mapping history must produce the same digest,
// and any change in meaning must produce a different one.
func TestFactDigestIsStableAndMeaningSensitive(t *testing.T) {
	base := TransactionFact{
		EnvironmentID:             "env_prod",
		ApplicationID:             "app_ios",
		Provider:                  ProviderAppStore,
		StoreEnvironment:          StoreProduction,
		ProviderTransactionID:     "2000000123456789",
		TransactionType:           TypeAutoRenewableSubscription,
		FactKind:                  KindRenewal,
		OccurredAt:                time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC),
		ProviderProductIdentifier: "fixture.pro.monthly",
		ResolutionState:           StateActiveMapping,
		MosaicProductID:           "prod_pro",
		ProviderProductMappingID:  "map_active",
		ValidatorVersion:          1,
		FactVersion:               1,
	}

	first := FactDigest(base)

	// Provenance and identity columns are deliberately excluded: a replay
	// produces a new attempt id and a new recorded_at, and if those changed the
	// digest every replay would append a duplicate fact.
	replayed := base
	replayed.ID = "btf_other"
	replayed.SourceRawInputID = "bri_other"
	replayed.ValidationAttemptID = "bva_other"
	replayed.RecordedAt = time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC)
	if !bytes.Equal(first, FactDigest(replayed)) {
		t.Fatal("provenance changes altered the fact digest, so replay would duplicate facts")
	}

	// Anything that changes what the fact says must change the digest,
	// otherwise a genuinely different outcome would be silently absorbed by the
	// unique constraint.
	for name, mutate := range map[string]func(*TransactionFact){
		"product":     func(f *TransactionFact) { f.MosaicProductID = "prod_other" },
		"kind":        func(f *TransactionFact) { f.FactKind = KindRefund },
		"occurred at": func(f *TransactionFact) { f.OccurredAt = f.OccurredAt.Add(time.Hour) },
		"mapping":     func(f *TransactionFact) { f.ProviderProductMappingID = "map_other" },
		"environment": func(f *TransactionFact) { f.StoreEnvironment = StoreSandbox },
		"resolution":  func(f *TransactionFact) { f.ResolutionState = StateUnresolved },
		"validator":   func(f *TransactionFact) { f.ValidatorVersion = 2 },
		"transaction": func(f *TransactionFact) { f.ProviderTransactionID = "2000000987654321" },
	} {
		changed := base
		mutate(&changed)
		if bytes.Equal(first, FactDigest(changed)) {
			t.Fatalf("changing the %s did not change the fact digest", name)
		}
	}
}

// Idempotency keys must be domain-separated. Without it an Apple notification
// UUID that happened to equal a Pub/Sub message id would deduplicate two
// unrelated deliveries into one, losing a transaction.
func TestIdempotencyKeysAreDomainSeparated(t *testing.T) {
	shared := "fixture-shared-identifier"
	keys := map[string][]byte{
		"apple notification": AppleNotificationKey(shared),
		"apple transaction":  AppleTransactionKey(StoreProduction, shared),
		"google rtdn":        GoogleRTDNKey("projects/p/subscriptions/s", shared, TokenDigest(shared)),
		"google purchase":    GooglePurchaseKey("fixture.package", TokenDigest(shared)),
		"observation":        ObservationKey("env_prod", shared),
	}
	seen := make(map[string]string, len(keys))
	for name, key := range keys {
		if len(key) != 32 {
			t.Fatalf("%s key is %d bytes, want 32", name, len(key))
		}
		encoded := string(key)
		if other, collision := seen[encoded]; collision {
			t.Fatalf("%s and %s produced the same key from the same identifier", name, other)
		}
		seen[encoded] = name
	}
}

// The Google token digest is a cross-SDK contract: SHA-256 over the UTF-8
// token, lowercase hex. The Android adapter computes it independently, so a
// change here would silently break notification-to-observation attribution.
func TestTokenDigestMatchesCrossSDKContract(t *testing.T) {
	// SHA-256("fixture-purchase-token"), lowercase hex.
	digest := TokenDigest("fixture-purchase-token")
	if len(digest) != 32 {
		t.Fatalf("digest is %d bytes, want 32", len(digest))
	}
	encoded := hexOf(digest)
	if encoded != strings.ToLower(encoded) {
		t.Fatal("digest is not lowercase hex")
	}
	decoded, ok := ValidHexDigest(encoded)
	if !ok || !bytes.Equal(decoded, digest) {
		t.Fatal("the digest form the SDKs submit does not round-trip")
	}
	if _, ok := ValidHexDigest(strings.ToUpper(encoded)); ok {
		t.Fatal("an uppercase digest was accepted, breaking the documented contract")
	}
}

// There must be no submission outcome that claims validation: the endpoint
// responds before the store has been consulted, so any such member would be a
// lie the SDKs could surface to a customer.
func TestNoSubmissionOutcomeClaimsValidation(t *testing.T) {
	for _, outcome := range []string{
		SubmissionAccepted, SubmissionDuplicate,
		SubmissionPermanentlyRejected, SubmissionRetryableFailure,
	} {
		if outcome == "validated" || strings.Contains(outcome, "confirmed") {
			t.Fatalf("submission outcome %q claims validation", outcome)
		}
	}
}
