package providercredential

import (
	"bytes"
	"crypto/hmac"
	"encoding/binary"
	"io"
	"strings"
)

// envelopeAADDomainV2 is the Phase 9A additional-authenticated-data domain.
//
// Phase 9A seals two things the Provider Connection design never contemplated:
// Store Server Credentials, which are not attached to a Provider Connection at
// all, and Raw Billing Input bodies, which are payloads rather than credentials.
// Both are addressed by a (kind, id) subject rather than a connection id.
//
// Rather than widen Scope — which would have made ConnectionID optional and let
// an empty value silently weaken the binding of every existing v1 envelope —
// the new shape gets its own domain string. Because the domain is the first
// length-prefixed field of the AAD, a v1 envelope can never be opened through
// the v2 path and a v2 envelope can never be opened through the v1 path, even
// under the same keyring and the same key.
const envelopeAADDomainV2 = "mosaic-billing-envelope-v2"

// Subject kinds. Each names a distinct table, so two rows with the same
// identifier in different tables never share an AAD.
const (
	SubjectStoreServerCredential = "store_server_credential"
	SubjectBillingRawInput       = "billing_raw_input"
	// SubjectWebhookSigningSecret is the Phase 9B addition recorded in
	// ADR-0024. Binding the AAD to the destination row means a sealed secret
	// moved to another destination — by a bug, or by a compromise that can
	// write the table but not decrypt it — fails to open rather than signing
	// deliveries for the wrong tenant.
	SubjectWebhookSigningSecret = "webhook_signing_secret"
)

// SubjectScope binds a v2 envelope to one tenant and one row. Every field is
// required: an empty component would make two different subjects produce the
// same additional data.
type SubjectScope struct {
	OrganizationID  string
	ProjectID       string
	SubjectKind     string
	SubjectID       string
	CredentialClass string
}

func validSubjectScope(scope SubjectScope) bool {
	if strings.TrimSpace(scope.OrganizationID) == "" || strings.TrimSpace(scope.ProjectID) == "" ||
		strings.TrimSpace(scope.SubjectID) == "" || strings.TrimSpace(scope.CredentialClass) == "" {
		return false
	}
	switch scope.SubjectKind {
	case SubjectStoreServerCredential, SubjectBillingRawInput, SubjectWebhookSigningSecret:
		return true
	default:
		return false
	}
}

// EncryptSubject seals plaintext under the Phase 9A domain.
func (c *AESGCMCipher) EncryptSubject(plaintext []byte, scope SubjectScope) (Envelope, error) {
	if len(plaintext) == 0 || !validSubjectScope(scope) {
		return Envelope{}, ErrCredentialUnavailable
	}
	key, ok := c.keys[c.activeKeyID]
	if !ok {
		return Envelope{}, ErrCredentialUnavailable
	}
	aead, err := newGCM(key)
	if err != nil {
		return Envelope{}, ErrCredentialUnavailable
	}
	nonce := make([]byte, nonceSize)
	if _, err := io.ReadFull(c.random, nonce); err != nil {
		return Envelope{}, ErrCredentialUnavailable
	}
	return Envelope{
		Version:         envelopeVersion,
		Algorithm:       envelopeAlgorithm,
		KeyID:           c.activeKeyID,
		Nonce:           nonce,
		Ciphertext:      aead.Seal(nil, nonce, plaintext, subjectAdditionalData(scope)),
		CredentialClass: scope.CredentialClass,
		Fingerprint:     fingerprint(key, plaintext),
	}, nil
}

// DecryptSubject opens a Phase 9A envelope. It fails closed on any mismatch of
// tenant, subject, or class, so a row moved between projects or tables becomes
// undecryptable rather than readable in the wrong context.
func (c *AESGCMCipher) DecryptSubject(envelope Envelope, scope SubjectScope) ([]byte, error) {
	if !validSubjectScope(scope) || envelope.Version != envelopeVersion ||
		envelope.Algorithm != envelopeAlgorithm || envelope.CredentialClass != scope.CredentialClass ||
		len(envelope.Nonce) != nonceSize {
		return nil, ErrCredentialUnavailable
	}
	key, ok := c.keys[envelope.KeyID]
	if !ok {
		return nil, ErrCredentialUnavailable
	}
	aead, err := newGCM(key)
	if err != nil || len(envelope.Ciphertext) < aead.Overhead() {
		return nil, ErrCredentialUnavailable
	}
	plaintext, err := aead.Open(nil, envelope.Nonce, envelope.Ciphertext, subjectAdditionalData(scope))
	if err != nil || !hmac.Equal(envelope.Fingerprint, fingerprint(key, plaintext)) {
		return nil, ErrCredentialUnavailable
	}
	return plaintext, nil
}

func subjectAdditionalData(scope SubjectScope) []byte {
	var result bytes.Buffer
	for _, field := range []string{
		envelopeAADDomainV2,
		scope.OrganizationID,
		scope.ProjectID,
		scope.SubjectKind,
		scope.SubjectID,
		scope.CredentialClass,
	} {
		_ = binary.Write(&result, binary.BigEndian, uint32(len(field)))
		_, _ = result.WriteString(field)
	}
	return result.Bytes()
}

// SubjectCipher is the Phase 9A encryption port. Billing depends on this rather
// than on the concrete cipher so the domain never imports crypto packages.
type SubjectCipher interface {
	EncryptSubject(plaintext []byte, scope SubjectScope) (Envelope, error)
	DecryptSubject(envelope Envelope, scope SubjectScope) ([]byte, error)
	ActiveKeyID() string
}

var _ SubjectCipher = (*AESGCMCipher)(nil)
