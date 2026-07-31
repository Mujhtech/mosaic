package providercredential

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"testing"
)

// testKeyring is a fixed two-key keyring for the envelope-domain tests.
var testKeyring = keyring("key-a", fmt.Sprintf(`%q:%q,%q:%q`, "key-a", encodedKey(7), "key-b", encodedKey(9)))

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
		bytes.NewReader(bytes.Repeat([]byte{2}, 12*4)),
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

	// `keyring rotate` re-seals every envelope under the active key so the old
	// key can eventually be removed. If a re-sealed envelope did not decrypt
	// under a keyring holding only the new key, retiring the old key would make
	// every provider credential permanently unreadable.
	resealed, err := rotated.Encrypt([]byte("credential-value"), scope)
	if err != nil {
		t.Fatalf("re-seal envelope under the active key: %v", err)
	}
	onlyNew, err := NewAESGCMCipher(keyring("new", fmt.Sprintf(`"new":%q`, newKey)), bytes.NewReader(bytes.Repeat([]byte{3}, 12)))
	if err != nil {
		t.Fatalf("new post-rotation cipher: %v", err)
	}
	if plaintext, err := onlyNew.Decrypt(resealed, scope); err != nil || string(plaintext) != "credential-value" {
		t.Fatalf("re-sealed envelope after removing the retired key = %q, %v", plaintext, err)
	}
}

// The Phase 9A envelope domain must be cryptographically separate from the
// Provider Connection domain. This was a Stage 1A blocking prerequisite that
// the code satisfied and nothing pinned.
//
// The failure it guards is a refactor that unifies additionalData and
// subjectAdditionalData, or reorders their fields: a Store Server Credential
// envelope would then be openable in a Provider Connection scope (scope
// confusion), or a rotation would reseal under the wrong domain and make every
// store credential permanently undecryptable (data loss). Both are silent —
// AES-GCM simply fails to authenticate, and the caller sees "unavailable" —
// which is exactly why the separation needs a test rather than a comment.
func TestEnvelopeDomainsCannotCrossOpen(t *testing.T) {
	cipher, err := NewAESGCMCipher(testKeyring, rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	secret := []byte("fixture-store-credential-material")

	v1Scope := Scope{
		OrganizationID: "org_1", ProjectID: "proj_1",
		ConnectionID: "conn_1", CredentialClass: "serverSecret",
	}
	v2Scope := SubjectScope{
		OrganizationID: "org_1", ProjectID: "proj_1",
		SubjectKind: SubjectStoreServerCredential, SubjectID: "conn_1",
		CredentialClass: "serverSecret",
	}

	v1Envelope, err := cipher.Encrypt(secret, v1Scope)
	if err != nil {
		t.Fatal(err)
	}
	v2Envelope, err := cipher.EncryptSubject(secret, v2Scope)
	if err != nil {
		t.Fatal(err)
	}

	// Each opens under its own domain, so the rejections below are about the
	// domain and not about a broken cipher.
	if _, err := cipher.Decrypt(v1Envelope, v1Scope); err != nil {
		t.Fatalf("a v1 envelope did not open under its own scope: %v", err)
	}
	if _, err := cipher.DecryptSubject(v2Envelope, v2Scope); err != nil {
		t.Fatalf("a v2 envelope did not open under its own scope: %v", err)
	}

	// The two scopes name the same tenant, the same identifier, and the same
	// class deliberately: only the domain separates them.
	if _, err := cipher.DecryptSubject(v1Envelope, v2Scope); !errors.Is(err, ErrCredentialUnavailable) {
		t.Fatalf("a v1 envelope opened through the v2 path (err=%v)", err)
	}
	if _, err := cipher.Decrypt(v2Envelope, v1Scope); !errors.Is(err, ErrCredentialUnavailable) {
		t.Fatalf("a v2 envelope opened through the v1 path (err=%v)", err)
	}
}

// Within v2, the subject kind and subject id are part of the binding: a raw
// billing body must not open as a credential, and a row moved between projects
// or tables must become undecryptable rather than readable in the wrong context.
func TestSubjectScopeBindsKindAndIdentity(t *testing.T) {
	cipher, err := NewAESGCMCipher(testKeyring, rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	scope := SubjectScope{
		OrganizationID: "org_1", ProjectID: "proj_1",
		SubjectKind: SubjectStoreServerCredential, SubjectID: "ssc_1",
		CredentialClass: "appleInAppPurchaseKey",
	}
	envelope, err := cipher.EncryptSubject([]byte("fixture-p8-material"), scope)
	if err != nil {
		t.Fatal(err)
	}

	for name, mutate := range map[string]func(*SubjectScope){
		"different subject kind": func(s *SubjectScope) { s.SubjectKind = SubjectBillingRawInput },
		"different subject id":   func(s *SubjectScope) { s.SubjectID = "ssc_2" },
		"different project":      func(s *SubjectScope) { s.ProjectID = "proj_2" },
		"different organization": func(s *SubjectScope) { s.OrganizationID = "org_2" },
		"different class":        func(s *SubjectScope) { s.CredentialClass = "googleServiceAccountKey" },
	} {
		altered := scope
		mutate(&altered)
		if _, err := cipher.DecryptSubject(envelope, altered); !errors.Is(err, ErrCredentialUnavailable) {
			t.Fatalf("envelope opened under a %s (err=%v)", name, err)
		}
	}
}
