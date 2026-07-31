package appstorejws

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"testing"
	"time"
)

// The tests below protect the single highest-severity failure in Phase 9A: a
// forged notification producing a Transaction Fact. Every case is a way a real
// verifier gets weakened — algorithm confusion, an attacker-supplied trust
// anchor, a chain that omits the App Store extension, a tampered payload — and
// each one must be rejected before any field of the payload is believed.
//
// A synthetic three-certificate chain is used rather than a recorded Apple
// payload because Apple's real leaf certificates expire, which would make a
// recorded fixture fail on a date rather than on a defect.

type testChain struct {
	root         *x509.Certificate
	rootKey      *ecdsa.PrivateKey
	intermediate *x509.Certificate
	leaf         *x509.Certificate
	leafKey      *ecdsa.PrivateKey
	encoded      []string
}

func newTestChain(t *testing.T, withAppStoreExtension bool) testChain {
	t.Helper()
	rootKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	rootTemplate := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Test Root CA"},
		NotBefore:             time.Now().Add(-24 * time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign,
	}
	rootDER, err := x509.CreateCertificate(rand.Reader, rootTemplate, rootTemplate, &rootKey.PublicKey, rootKey)
	if err != nil {
		t.Fatal(err)
	}
	root, err := x509.ParseCertificate(rootDER)
	if err != nil {
		t.Fatal(err)
	}

	intermediateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	intermediateTemplate := &x509.Certificate{
		SerialNumber:          big.NewInt(2),
		Subject:               pkix.Name{CommonName: "Test Intermediate CA"},
		NotBefore:             time.Now().Add(-24 * time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign,
	}
	if withAppStoreExtension {
		intermediateTemplate.ExtraExtensions = []pkix.Extension{{Id: appleWWDROID, Value: []byte{0x05, 0x00}}}
	}
	intermediateDER, err := x509.CreateCertificate(rand.Reader, intermediateTemplate, root, &intermediateKey.PublicKey, rootKey)
	if err != nil {
		t.Fatal(err)
	}
	intermediate, err := x509.ParseCertificate(intermediateDER)
	if err != nil {
		t.Fatal(err)
	}

	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	leafTemplate := &x509.Certificate{
		SerialNumber: big.NewInt(3),
		Subject:      pkix.Name{CommonName: "Test Leaf"},
		NotBefore:    time.Now().Add(-24 * time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leafTemplate, intermediate, &leafKey.PublicKey, intermediateKey)
	if err != nil {
		t.Fatal(err)
	}
	leaf, err := x509.ParseCertificate(leafDER)
	if err != nil {
		t.Fatal(err)
	}

	return testChain{
		root: root, rootKey: rootKey, intermediate: intermediate,
		leaf: leaf, leafKey: leafKey,
		encoded: []string{
			base64.StdEncoding.EncodeToString(leafDER),
			base64.StdEncoding.EncodeToString(intermediateDER),
			base64.StdEncoding.EncodeToString(rootDER),
		},
	}
}

// signJWS builds a compact JWS the way Apple does: ES256 over base64url header
// and payload, with the raw R||S signature form.
func signJWS(t *testing.T, chain testChain, algorithm string, payload map[string]any) string {
	t.Helper()
	header := map[string]any{"alg": algorithm, "x5c": chain.encoded}
	headerBytes, err := json.Marshal(header)
	if err != nil {
		t.Fatal(err)
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	signingInput := base64.RawURLEncoding.EncodeToString(headerBytes) + "." +
		base64.RawURLEncoding.EncodeToString(payloadBytes)
	digest := sha256.Sum256([]byte(signingInput))
	r, s, err := ecdsa.Sign(rand.Reader, chain.leafKey, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	signature := make([]byte, 64)
	rBytes, sBytes := r.Bytes(), s.Bytes()
	copy(signature[32-len(rBytes):32], rBytes)
	copy(signature[64-len(sBytes):], sBytes)
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(signature)
}

func testPayload() map[string]any {
	return map[string]any{
		"notificationType": "SUBSCRIBED",
		"notificationUUID": "fixture-notification-uuid",
		"version":          "2.0",
		"signedDate":       time.Now().Add(-time.Minute).UnixMilli(),
	}
}

func verifierFor(t *testing.T, chain testChain) *Verifier {
	t.Helper()
	verifier, err := NewVerifier(WithRoot(chain.root))
	if err != nil {
		t.Fatal(err)
	}
	return verifier
}

// A well-formed chain terminating at the pinned root must verify; without this
// the rejection tests below would pass vacuously.
func TestVerifyAcceptsChainToPinnedRoot(t *testing.T) {
	chain := newTestChain(t, true)
	compact := signJWS(t, chain, "ES256", testPayload())

	notification, err := verifierFor(t, chain).DecodeNotification(compact)
	if err != nil {
		t.Fatalf("expected a valid chain to verify, got %v", err)
	}
	if notification.NotificationUUID != "fixture-notification-uuid" {
		t.Fatalf("unexpected notification uuid %q", notification.NotificationUUID)
	}
}

// Algorithm confusion is the standard way a JWS verifier is turned into a
// rubber stamp: `none` skips verification entirely, and an RS256 header can
// trick a verifier into treating a public key as an HMAC secret. Both must be
// rejected before any key material is examined.
func TestVerifyRejectsAlgorithmConfusion(t *testing.T) {
	chain := newTestChain(t, true)
	for _, algorithm := range []string{"none", "RS256", "HS256", "ES384", ""} {
		compact := signJWS(t, chain, algorithm, testPayload())
		_, _, err := verifierFor(t, chain).Verify(compact)
		if err == nil {
			t.Fatalf("alg %q was accepted", algorithm)
		}
		if reason := ReasonOf(err); reason != ReasonAlgorithmRejected {
			t.Fatalf("alg %q rejected for %q, want %q", algorithm, reason, ReasonAlgorithmRejected)
		}
	}
}

// The chain the caller presents must terminate at the certificate compiled into
// the binary. An attacker who can mint a self-consistent chain would otherwise
// only need Mosaic to trust whatever root they attached.
func TestVerifyRejectsChainToAnotherRoot(t *testing.T) {
	trusted := newTestChain(t, true)
	attacker := newTestChain(t, true)
	compact := signJWS(t, attacker, "ES256", testPayload())

	_, _, err := verifierFor(t, trusted).Verify(compact)
	if err == nil {
		t.Fatal("a chain to an untrusted root was accepted")
	}
	if reason := ReasonOf(err); reason != ReasonChainUntrusted {
		t.Fatalf("rejected for %q, want %q", reason, ReasonChainUntrusted)
	}
}

// Chaining to the Apple root is not sufficient: Apple issues many certificates
// under it. Requiring the App Store extension is what constrains the chain to
// store signing rather than, for example, a device certificate.
func TestVerifyRejectsChainWithoutAppStoreExtension(t *testing.T) {
	chain := newTestChain(t, false)
	compact := signJWS(t, chain, "ES256", testPayload())

	_, _, err := verifierFor(t, chain).Verify(compact)
	if err == nil {
		t.Fatal("a chain without the App Store extension was accepted")
	}
	if reason := ReasonOf(err); reason != ReasonIntermediateWrong {
		t.Fatalf("rejected for %q, want %q", reason, ReasonIntermediateWrong)
	}
}

// A payload edited after signing must fail. This is the case that proves the
// signature is actually checked against the payload rather than merely parsed.
func TestVerifyRejectsTamperedPayload(t *testing.T) {
	chain := newTestChain(t, true)
	compact := signJWS(t, chain, "ES256", testPayload())

	forged := map[string]any{
		"notificationType": "REFUND",
		"notificationUUID": "fixture-forged-uuid",
		"version":          "2.0",
		"signedDate":       time.Now().UnixMilli(),
	}
	forgedBytes, err := json.Marshal(forged)
	if err != nil {
		t.Fatal(err)
	}
	// Swap the payload segment, keep the original header and signature.
	header, _, signature := split3(t, compact)
	tampered := header + "." + base64.RawURLEncoding.EncodeToString(forgedBytes) + "." + signature

	if _, _, err := verifierFor(t, chain).Verify(tampered); err == nil {
		t.Fatal("a tampered payload was accepted")
	}
}

// Certificate validity is evaluated at the payload's own signing time, not at
// time.Now(). A signedDate in the future is therefore the one time-related case
// that must still be refused: it is how a replayed payload would be given an
// artificially long life.
func TestVerifyRejectsFutureSignedDate(t *testing.T) {
	chain := newTestChain(t, true)
	payload := testPayload()
	payload["signedDate"] = time.Now().Add(2 * time.Hour).UnixMilli()
	compact := signJWS(t, chain, "ES256", payload)

	_, _, err := verifierFor(t, chain).Verify(compact)
	if err == nil {
		t.Fatal("a payload signed in the future was accepted")
	}
	if reason := ReasonOf(err); reason != ReasonSignedDateInFuture {
		t.Fatalf("rejected for %q, want %q", reason, ReasonSignedDateInFuture)
	}
}

// The embedded certificate must actually be Apple's root. A build that shipped
// a placeholder or a truncated file would otherwise fail only in production, on
// the first real notification.
func TestEmbeddedRootIsAppleRootCAG3(t *testing.T) {
	verifier, err := NewVerifier()
	if err != nil {
		t.Fatalf("embedded Apple root is unusable: %v", err)
	}
	if got := verifier.root.Subject.CommonName; got != "Apple Root CA - G3" {
		t.Fatalf("embedded root common name is %q, want %q", got, "Apple Root CA - G3")
	}
	if !verifier.root.IsCA {
		t.Fatal("embedded root is not a CA certificate")
	}
	// Self-signed: the root must verify under its own key.
	if err := verifier.root.CheckSignatureFrom(verifier.root); err != nil {
		t.Fatalf("embedded root is not self-signed: %v", err)
	}
}

func split3(t *testing.T, compact string) (string, string, string) {
	t.Helper()
	first := -1
	last := -1
	for index := range compact {
		if compact[index] == '.' {
			if first == -1 {
				first = index
			}
			last = index
		}
	}
	if first < 0 || last <= first {
		t.Fatal("compact JWS is malformed")
	}
	return compact[:first], compact[first+1 : last], compact[last+1:]
}

var _ = asn1.ObjectIdentifier{}
