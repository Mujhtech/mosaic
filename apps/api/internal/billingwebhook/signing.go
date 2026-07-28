package billingwebhook

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"
)

// HeaderName is the signature header every delivery carries.
const HeaderName = "Mosaic-Signature"

// SigningVersion prefixes the signed string and names the header element.
//
// It is inside the signed bytes on purpose: a future scheme becomes a new `v`
// element rather than a silent reinterpretation of the same bytes by receivers
// that were never told the rules changed.
const SigningVersion = "v1"

// signedPayload builds the exact bytes the HMAC covers:
//
//	v1.<unix seconds>.<event id>.<raw body>
//
// Four things are bound together deliberately (ADR-0024 §1): the scheme
// version, the timestamp — which is what makes a receiver's replay window
// enforceable — the event id, so a captured signature cannot be re-attached to
// a different body inside that window, and the exact body bytes.
//
// Note for anyone comparing this against ADR-0024's prose, which writes the
// first element as "1": the canonical cross-implementation vectors in
// packages/test-fixtures/src/webhook-signature-vectors.json, the protocol
// document, and the header element name all use "v1", and the vectors are the
// artifact the Dart, Swift, and Kotlin implementations verify against. The
// vectors win; the ADR sentence is a typo in the prose, not a second scheme.
func signedPayload(timestamp int64, eventID string, body []byte) []byte {
	stamp := strconv.FormatInt(timestamp, 10)
	payload := make([]byte, 0, len(SigningVersion)+len(stamp)+len(eventID)+len(body)+3)
	payload = append(payload, SigningVersion...)
	payload = append(payload, '.')
	payload = append(payload, stamp...)
	payload = append(payload, '.')
	payload = append(payload, eventID...)
	payload = append(payload, '.')
	payload = append(payload, body...)
	return payload
}

// Sign produces one lowercase-hex HMAC-SHA256 signature.
//
// The secret is used as its UTF-8 bytes verbatim — it is not hex- or
// base64-decoded first. That is a documented property of the scheme rather
// than an implementation detail, because a receiver that decodes the secret
// agrees with Mosaic on every ASCII vector and disagrees on none of the ones
// an integrator would notice.
func Sign(secret string, timestamp int64, eventID string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(signedPayload(timestamp, eventID, body))
	return hex.EncodeToString(mac.Sum(nil))
}

// Header renders the delivery header from one or more signatures.
//
// One `v1` element per secret still permitted to sign. During a rotation
// overlap that is two, and a receiver accepts the delivery if *any* of them
// verifies — which is the whole reason the overlap works. A receiver that
// reads only the first element drops every delivery signed with the new key,
// so the contract says so explicitly and the vectors carry a rotation case.
//
// The separator is ", " to match the reference vectors byte for byte.
func Header(signatures []string, timestamp int64) string {
	var builder strings.Builder
	builder.WriteString("t=")
	builder.WriteString(strconv.FormatInt(timestamp, 10))
	for _, signature := range signatures {
		if signature == "" {
			continue
		}
		builder.WriteString(", ")
		builder.WriteString(SigningVersion)
		builder.WriteString("=")
		builder.WriteString(signature)
	}
	return builder.String()
}

// Verify reports whether any supplied signature matches, in constant time.
//
// Mosaic is the producer and does not verify its own deliveries in the
// delivery path. This exists so the signature rule has exactly one
// implementation to point at, and so the conformance test can assert the
// must-not-verify vectors are actually refused rather than merely differing.
func Verify(secret string, timestamp int64, eventID string, body []byte, signatures []string) bool {
	expected := []byte(Sign(secret, timestamp, eventID, body))
	matched := false
	for _, candidate := range signatures {
		// Every candidate is compared; the loop does not exit early. An early
		// exit would make the number of comparisons depend on which element
		// matched, which is a signal about the secret set.
		if hmac.Equal(expected, []byte(strings.ToLower(strings.TrimSpace(candidate)))) {
			matched = true
		}
	}
	return matched
}
