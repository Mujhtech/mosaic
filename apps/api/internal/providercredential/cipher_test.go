package providercredential

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"testing"
)

func encodedKey(fill byte) string {
	return base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{fill}, 32))
}

func keyring(active string, keys string) string {
	return fmt.Sprintf(`{"version":1,"activeKeyId":%q,"keys":{%s}}`, active, keys)
}

func TestKeyringParsingRejectsAmbiguousOrInvalidConfiguration(t *testing.T) {
	validKey := encodedKey(1)
	tests := map[string]string{
		"unknown field":       fmt.Sprintf(`{"version":1,"activeKeyId":"a","keys":{"a":%q},"extra":true}`, validKey),
		"duplicate field":     fmt.Sprintf(`{"version":1,"version":1,"activeKeyId":"a","keys":{"a":%q}}`, validKey),
		"duplicate key":       fmt.Sprintf(`{"version":1,"activeKeyId":"a","keys":{"a":%q,"a":%q}}`, validKey, validKey),
		"unsupported version": fmt.Sprintf(`{"version":2,"activeKeyId":"a","keys":{"a":%q}}`, validKey),
		"missing active key":  keyring("missing", fmt.Sprintf(`"a":%q`, validKey)),
		"padded base64":       keyring("a", fmt.Sprintf(`"a":%q`, validKey+"=")),
		"wrong key length":    keyring("a", fmt.Sprintf(`"a":%q`, base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{1}, 31)))),
		"empty keyring":       `{"version":1,"activeKeyId":"a","keys":{}}`,
	}
	for name, encoded := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := NewAESGCMCipher(encoded, bytes.NewReader(make([]byte, 12))); !errors.Is(err, ErrInvalidKeyring) {
				t.Fatalf("error = %v, want invalid keyring", err)
			}
		})
	}
}

func TestEnvelopeRoundTripBindsScopeAndAuthenticatesFingerprint(t *testing.T) {
	encoded := keyring("primary", fmt.Sprintf(`"primary":%q`, encodedKey(7)))
	nonceBytes := append(bytes.Repeat([]byte{3}, 12), bytes.Repeat([]byte{4}, 12)...)
	cipher, err := NewAESGCMCipher(encoded, bytes.NewReader(nonceBytes))
	if err != nil {
		t.Fatalf("new cipher: %v", err)
	}
	scope := Scope{
		OrganizationID: "org_1", ProjectID: "project_1",
		ConnectionID: "connection_1", CredentialClass: "provider-api-credential",
	}
	first, err := cipher.Encrypt([]byte("credential-value"), scope)
	if err != nil {
		t.Fatalf("encrypt first envelope: %v", err)
	}
	second, err := cipher.Encrypt([]byte("credential-value"), scope)
	if err != nil {
		t.Fatalf("encrypt second envelope: %v", err)
	}
	if bytes.Equal(first.Ciphertext, []byte("credential-value")) || bytes.Equal(first.Ciphertext, second.Ciphertext) {
		t.Fatal("ciphertext exposed plaintext or reused a nonce")
	}
	if !bytes.Equal(first.Fingerprint, second.Fingerprint) {
		t.Fatal("equal plaintext under one key produced different recognition fingerprints")
	}
	plaintext, err := cipher.Decrypt(first, scope)
	if err != nil || string(plaintext) != "credential-value" {
		t.Fatalf("decrypt = %q, %v", plaintext, err)
	}
	wrongScope := scope
	wrongScope.ProjectID = "project_2"
	if _, err := cipher.Decrypt(first, wrongScope); !errors.Is(err, ErrCredentialUnavailable) {
		t.Fatalf("wrong-scope error = %v, want credential unavailable", err)
	}
	tampered := first
	tampered.Fingerprint = append([]byte(nil), first.Fingerprint...)
	tampered.Fingerprint[0] ^= 0xff
	if _, err := cipher.Decrypt(tampered, scope); !errors.Is(err, ErrCredentialUnavailable) {
		t.Fatalf("tampered-fingerprint error = %v, want credential unavailable", err)
	}
}

func TestKeyRotationKeepsOldEnvelopesReadableAndUsesOnlyActiveKeyForWrites(t *testing.T) {
	oldKey, newKey := encodedKey(4), encodedKey(9)
	oldCipher, err := NewAESGCMCipher(keyring("old", fmt.Sprintf(`"old":%q`, oldKey)), bytes.NewReader(bytes.Repeat([]byte{1}, 12)))
	if err != nil {
		t.Fatalf("new old cipher: %v", err)
	}
	scope := Scope{OrganizationID: "org_1", ProjectID: "project_1", ConnectionID: "connection_1", CredentialClass: "provider-api-credential"}
	oldEnvelope, err := oldCipher.Encrypt([]byte("credential-value"), scope)
	if err != nil {
		t.Fatalf("encrypt old envelope: %v", err)
	}
	rotated, err := NewAESGCMCipher(
		keyring("new", fmt.Sprintf(`"old":%q,"new":%q`, oldKey, newKey)),
		bytes.NewReader(bytes.Repeat([]byte{2}, 12)),
	)
	if err != nil {
		t.Fatalf("new rotated cipher: %v", err)
	}
	if plaintext, err := rotated.Decrypt(oldEnvelope, scope); err != nil || string(plaintext) != "credential-value" {
		t.Fatalf("decrypt old envelope after rotation = %q, %v", plaintext, err)
	}
	newEnvelope, err := rotated.Encrypt([]byte("replacement-value"), scope)
	if err != nil {
		t.Fatalf("encrypt replacement: %v", err)
	}
	if newEnvelope.KeyID != "new" {
		t.Fatalf("replacement key ID = %q, want active key", newEnvelope.KeyID)
	}
}
