package billingwebhook

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The signature is the only thing standing between an entitlement-change
// webhook and an unauthenticated instruction to grant someone access. Four
// implementations have to agree on it byte for byte — Go here, and Dart, Swift,
// and Kotlin in the SDKs — and the published vector file is the only artifact
// all four can be checked against.
//
// The test loads the vectors rather than restating any expected string. A
// hand-written expectation would freeze whatever this implementation happened
// to do on the day it was written, which is exactly the drift the vectors
// exist to prevent.

type signatureVectors struct {
	Scheme struct {
		Header         string `json:"header"`
		SigningVersion string `json:"signingVersion"`
	} `json:"scheme"`
	Vectors []struct {
		ID            string `json:"id"`
		Secret        string `json:"secret"`
		Timestamp     int64  `json:"timestamp"`
		EventID       string `json:"eventId"`
		RawBody       string `json:"rawBody"`
		SignedPayload string `json:"signedPayload"`
		Signature     string `json:"signature"`
		Header        string `json:"header"`
	} `json:"vectors"`
}

func loadVectors(t *testing.T) signatureVectors {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"packages", "test-fixtures", "src", "webhook-signature-vectors.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read signature vectors: %v", err)
	}
	var vectors signatureVectors
	if err := json.Unmarshal(raw, &vectors); err != nil {
		t.Fatalf("decode signature vectors: %v", err)
	}
	if len(vectors.Vectors) == 0 {
		t.Fatal("signature vectors file contains no vectors")
	}
	return vectors
}

// TestSignMatchesPublishedVectors is the cross-implementation conformance
// check. It fails if Go's signing disagrees with the published contract in any
// way at all: a different separator, a decoded secret, a non-UTF-8 body
// encoding, uppercase hex, or a signed string that omits the timestamp or the
// event id.
func TestSignMatchesPublishedVectors(t *testing.T) {
	vectors := loadVectors(t)

	if vectors.Scheme.Header != HeaderName {
		t.Fatalf("header name = %q, vectors say %q", HeaderName, vectors.Scheme.Header)
	}
	if vectors.Scheme.SigningVersion != SigningVersion {
		t.Fatalf("signing version = %q, vectors say %q", SigningVersion, vectors.Scheme.SigningVersion)
	}

	for _, vector := range vectors.Vectors {
		t.Run(vector.ID, func(t *testing.T) {
			body := []byte(vector.RawBody)

			// The signed string itself is asserted, not only the digest. A
			// mismatch here names the bug directly instead of reporting two
			// unequal hex strings.
			if got := string(signedPayload(vector.Timestamp, vector.EventID, body)); got != vector.SignedPayload {
				t.Fatalf("signed payload mismatch\n got: %q\nwant: %q", got, vector.SignedPayload)
			}
			signature := Sign(vector.Secret, vector.Timestamp, vector.EventID, body)
			if signature != vector.Signature {
				t.Fatalf("signature = %s, want %s", signature, vector.Signature)
			}
			if signature != strings.ToLower(signature) {
				t.Fatalf("signature is not lowercase hex: %s", signature)
			}
			if header := Header([]string{signature}, vector.Timestamp); header != vector.Header {
				t.Fatalf("header = %q, want %q", header, vector.Header)
			}
			if !Verify(vector.Secret, vector.Timestamp, vector.EventID, body, []string{signature}) {
				t.Fatal("Verify rejected a signature this implementation produced")
			}
		})
	}
}

// TestMustNotVerifyVectors pins the negative half of the contract.
//
// The three tampering vectors carry a changed body, a changed event id, and a
// changed timestamp. Each one must fail against the canonical body, because
// that is the entire security property: without it a signature would be a
// decoration a receiver could not use to reject anything.
func TestMustNotVerifyVectors(t *testing.T) {
	vectors := loadVectors(t)

	var canonical struct {
		secret    string
		timestamp int64
		eventID   string
		body      []byte
		signature string
	}
	tampered := map[string]string{}
	for _, vector := range vectors.Vectors {
		switch vector.ID {
		case "canonical-event-primary-key":
			canonical.secret = vector.Secret
			canonical.timestamp = vector.Timestamp
			canonical.eventID = vector.EventID
			canonical.body = []byte(vector.RawBody)
			canonical.signature = vector.Signature
		case "tampered-body-must-not-verify",
			"different-event-id-must-not-verify",
			"different-timestamp-must-not-verify":
			tampered[vector.ID] = vector.Signature
		}
	}
	if canonical.signature == "" || len(tampered) != 3 {
		t.Fatalf("vector file no longer carries the canonical and three tampering vectors: %d found", len(tampered))
	}

	for id, signature := range tampered {
		if signature == canonical.signature {
			t.Fatalf("%s produced the canonical signature; the field it changes is not covered", id)
		}
		if Verify(canonical.secret, canonical.timestamp, canonical.eventID, canonical.body,
			[]string{signature}) {
			t.Fatalf("%s verified against the canonical delivery", id)
		}
	}
}

// TestHeaderCarriesEveryActiveSignature covers the rotation overlap on the
// wire.
//
// During a rotation the header must carry one v1 element per signing secret,
// and the rotation vector proves the second element is a real second key rather
// than a repeat of the first. A header that emitted only one element would
// drop every receiver that had already adopted the new secret, which is a
// silent, tenant-wide outage of exactly the mechanism rotation exists to avoid.
func TestHeaderCarriesEveryActiveSignature(t *testing.T) {
	vectors := loadVectors(t)

	var primary, rotation string
	var timestamp int64
	for _, vector := range vectors.Vectors {
		switch vector.ID {
		case "canonical-event-primary-key":
			primary, timestamp = vector.Signature, vector.Timestamp
		case "canonical-event-rotation-key":
			rotation = vector.Signature
		}
	}
	if primary == "" || rotation == "" {
		t.Fatal("vector file no longer carries both the primary and rotation keys")
	}
	if primary == rotation {
		t.Fatal("the rotation vector repeats the primary signature")
	}

	header := Header([]string{primary, rotation}, timestamp)
	if strings.Count(header, "v1=") != 2 {
		t.Fatalf("header carries %d v1 elements, want 2: %q", strings.Count(header, "v1="), header)
	}
	if !strings.Contains(header, "v1="+primary) || !strings.Contains(header, "v1="+rotation) {
		t.Fatalf("header omits one of the active signatures: %q", header)
	}
	// A retired secret drops out of the list; the header must then carry only
	// what remains, with no empty element left behind.
	retired := Header([]string{primary}, timestamp)
	if strings.Count(retired, "v1=") != 1 || strings.Contains(retired, rotation) {
		t.Fatalf("retired secret still present in header: %q", retired)
	}
}
