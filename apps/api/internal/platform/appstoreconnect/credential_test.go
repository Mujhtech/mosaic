package appstoreconnect

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"strings"
	"testing"
)

// testPrivateKeyPEM mints a real P-256 PKCS#8 key so credential validation is
// exercised against the same parser the runtime uses rather than a stub.
func testPrivateKeyPEM(t *testing.T) string {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

func credentialJSON(t *testing.T, document CredentialDocument) string {
	t.Helper()
	encoded, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}

// TestParseCredentialAcceptsOnlyUsableAppleKeys protects the boundary that
// decides what gets encrypted and stored as a connection credential. Every
// rejected case here is one that would otherwise be sealed successfully and
// then fail on Apple's side during a background sync, presenting as an outage
// rather than as the configuration mistake it is.
func TestParseCredentialAcceptsOnlyUsableAppleKeys(t *testing.T) {
	privateKey := testPrivateKeyPEM(t)
	const keyID = "ABCDE12345"
	const issuerID = "57246542-96fe-1a63-e053-0824d011072a"

	valid := credentialJSON(t, CredentialDocument{
		PrivateKey: privateKey, KeyID: keyID, IssuerID: issuerID, VendorNumber: "85200000",
	})
	parsed, err := ParseCredential([]byte(valid))
	if err != nil {
		t.Fatalf("valid credential: %v", err)
	}
	if parsed.KeyID != keyID || parsed.IssuerID != issuerID ||
		parsed.VendorNumber != "85200000" || parsed.PrivateKey == nil {
		t.Fatalf("parsed credential = %+v", CredentialDocument{
			KeyID: parsed.KeyID, IssuerID: parsed.IssuerID, VendorNumber: parsed.VendorNumber,
		})
	}

	withoutVendor := credentialJSON(t, CredentialDocument{
		PrivateKey: privateKey, KeyID: keyID, IssuerID: issuerID,
	})
	if _, err := ParseCredential([]byte(withoutVendor)); err != nil {
		t.Fatalf("vendor number is optional: %v", err)
	}

	cases := map[string]string{
		"empty":               "",
		"not JSON":            "sk_not_a_document",
		"truncated JSON":      `{"privateKey":"x"`,
		"unknown field":       `{"privateKey":"x","keyId":"` + keyID + `","issuerId":"` + issuerID + `","teamId":"X"}`,
		"two documents":       valid + valid,
		"missing private key": credentialJSON(t, CredentialDocument{KeyID: keyID, IssuerID: issuerID}),
		"private key is not PEM": credentialJSON(t, CredentialDocument{
			PrivateKey: "not-a-pem-block", KeyID: keyID, IssuerID: issuerID,
		}),
		"private key is not PKCS#8": credentialJSON(t, CredentialDocument{
			PrivateKey: "-----BEGIN PRIVATE KEY-----\nQUJD\n-----END PRIVATE KEY-----\n",
			KeyID:      keyID, IssuerID: issuerID,
		}),
		"key ID too short": credentialJSON(t, CredentialDocument{
			PrivateKey: privateKey, KeyID: "ABCDE1234", IssuerID: issuerID,
		}),
		"key ID lower case": credentialJSON(t, CredentialDocument{
			PrivateKey: privateKey, KeyID: "abcde12345", IssuerID: issuerID,
		}),
		"issuer ID is not a UUID": credentialJSON(t, CredentialDocument{
			PrivateKey: privateKey, KeyID: keyID, IssuerID: "not-a-uuid",
		}),
		"vendor number is not numeric": credentialJSON(t, CredentialDocument{
			PrivateKey: privateKey, KeyID: keyID, IssuerID: issuerID, VendorNumber: "85200000a",
		}),
		"oversized": `{"privateKey":"` + strings.Repeat("A", 5000) + `"}`,
	}
	for name, document := range cases {
		if _, err := ParseCredential([]byte(document)); err == nil {
			t.Errorf("%s credential was accepted", name)
		}
	}
}
