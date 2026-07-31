// Package providercredential implements Mosaic's provider-credential
// encryption boundary. It does not define or persist any provider credential.
package providercredential

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
)

const (
	keyringVersion          = 1
	envelopeVersion         = 1
	envelopeAlgorithm       = "AES-256-GCM"
	nonceSize               = 12
	envelopeAADDomain       = "mosaic-provider-credential-envelope-v1"
	fingerprintDeriveDomain = "mosaic-provider-credential-fingerprint-key-v1"
)

var (
	ErrInvalidKeyring        = errors.New("invalid provider credential keyring")
	ErrCredentialUnavailable = errors.New("provider credential unavailable")
)

type Scope struct {
	OrganizationID  string
	ProjectID       string
	ConnectionID    string
	CredentialClass string
}

type Envelope struct {
	Version         int
	Algorithm       string
	KeyID           string
	Nonce           []byte
	Ciphertext      []byte
	CredentialClass string
	Fingerprint     []byte
}

type CredentialCipher interface {
	Encrypt(plaintext []byte, scope Scope) (Envelope, error)
	Decrypt(envelope Envelope, scope Scope) ([]byte, error)
}

type AESGCMCipher struct {
	activeKeyID string
	keys        map[string][]byte
	random      io.Reader
}

func NewAESGCMCipher(encodedKeyring string, random io.Reader) (*AESGCMCipher, error) {
	activeKeyID, keys, err := parseKeyring(encodedKeyring)
	if err != nil {
		return nil, err
	}
	if random == nil {
		return nil, ErrInvalidKeyring
	}
	return &AESGCMCipher{activeKeyID: activeKeyID, keys: keys, random: random}, nil
}

func parseKeyring(encoded string) (string, map[string][]byte, error) {
	decoder := json.NewDecoder(strings.NewReader(encoded))
	first, err := decoder.Token()
	if err != nil || first != json.Delim('{') {
		return "", nil, ErrInvalidKeyring
	}
	seen := make(map[string]struct{}, 3)
	version := 0
	activeKeyID := ""
	var encodedKeys map[string]string
	for decoder.More() {
		nameToken, err := decoder.Token()
		name, ok := nameToken.(string)
		if err != nil || !ok {
			return "", nil, ErrInvalidKeyring
		}
		if _, duplicate := seen[name]; duplicate {
			return "", nil, ErrInvalidKeyring
		}
		seen[name] = struct{}{}
		switch name {
		case "version":
			if err := decoder.Decode(&version); err != nil {
				return "", nil, ErrInvalidKeyring
			}
		case "activeKeyId":
			if err := decoder.Decode(&activeKeyID); err != nil {
				return "", nil, ErrInvalidKeyring
			}
		case "keys":
			encodedKeys, err = decodeKeyMap(decoder)
			if err != nil {
				return "", nil, err
			}
		default:
			return "", nil, ErrInvalidKeyring
		}
	}
	if last, err := decoder.Token(); err != nil || last != json.Delim('}') {
		return "", nil, ErrInvalidKeyring
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return "", nil, ErrInvalidKeyring
	}
	if version != keyringVersion || !validKeyID(activeKeyID) || len(encodedKeys) == 0 {
		return "", nil, ErrInvalidKeyring
	}
	keys := make(map[string][]byte, len(encodedKeys))
	for keyID, value := range encodedKeys {
		if !validKeyID(keyID) || strings.Contains(value, "=") {
			return "", nil, ErrInvalidKeyring
		}
		key, err := base64.RawURLEncoding.DecodeString(value)
		if err != nil || len(key) != 32 || base64.RawURLEncoding.EncodeToString(key) != value {
			return "", nil, ErrInvalidKeyring
		}
		keys[keyID] = append([]byte(nil), key...)
	}
	if _, ok := keys[activeKeyID]; !ok {
		return "", nil, ErrInvalidKeyring
	}
	return activeKeyID, keys, nil
}

func decodeKeyMap(decoder *json.Decoder) (map[string]string, error) {
	first, err := decoder.Token()
	if err != nil || first != json.Delim('{') {
		return nil, ErrInvalidKeyring
	}
	values := make(map[string]string)
	for decoder.More() {
		keyToken, err := decoder.Token()
		key, ok := keyToken.(string)
		if err != nil || !ok {
			return nil, ErrInvalidKeyring
		}
		if _, duplicate := values[key]; duplicate {
			return nil, ErrInvalidKeyring
		}
		var value string
		if err := decoder.Decode(&value); err != nil {
			return nil, ErrInvalidKeyring
		}
		values[key] = value
	}
	if last, err := decoder.Token(); err != nil || last != json.Delim('}') {
		return nil, ErrInvalidKeyring
	}
	return values, nil
}

func validKeyID(value string) bool {
	if len(value) < 1 || len(value) > 64 {
		return false
	}
	for index := range len(value) {
		if value[index] < 0x20 || value[index] > 0x7e {
			return false
		}
	}
	return true
}

func validScope(scope Scope) bool {
	return scope.OrganizationID != "" && scope.ProjectID != "" &&
		scope.ConnectionID != "" && scope.CredentialClass != ""
}

func (c *AESGCMCipher) Encrypt(plaintext []byte, scope Scope) (Envelope, error) {
	if len(plaintext) == 0 || !validScope(scope) {
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
	ciphertext := aead.Seal(nil, nonce, plaintext, additionalData(scope))
	return Envelope{
		Version:         envelopeVersion,
		Algorithm:       envelopeAlgorithm,
		KeyID:           c.activeKeyID,
		Nonce:           nonce,
		Ciphertext:      ciphertext,
		CredentialClass: scope.CredentialClass,
		Fingerprint:     fingerprint(key, plaintext),
	}, nil
}

func (c *AESGCMCipher) Decrypt(envelope Envelope, scope Scope) ([]byte, error) {
	if !validScope(scope) || envelope.Version != envelopeVersion ||
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
	plaintext, err := aead.Open(nil, envelope.Nonce, envelope.Ciphertext, additionalData(scope))
	if err != nil || !hmac.Equal(envelope.Fingerprint, fingerprint(key, plaintext)) {
		return nil, ErrCredentialUnavailable
	}
	return plaintext, nil
}

func newGCM(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("initialize AES: %w", err)
	}
	return cipher.NewGCM(block)
}

func additionalData(scope Scope) []byte {
	var result bytes.Buffer
	for _, field := range []string{
		envelopeAADDomain,
		scope.OrganizationID,
		scope.ProjectID,
		scope.ConnectionID,
		scope.CredentialClass,
	} {
		_ = binary.Write(&result, binary.BigEndian, uint32(len(field)))
		_, _ = result.WriteString(field)
	}
	return result.Bytes()
}

func fingerprint(key, plaintext []byte) []byte {
	derive := hmac.New(sha256.New, key)
	_, _ = derive.Write([]byte(fingerprintDeriveDomain))
	fingerprintKey := derive.Sum(nil)
	mac := hmac.New(sha256.New, fingerprintKey)
	_, _ = mac.Write(plaintext)
	return mac.Sum(nil)
}

var _ CredentialCipher = (*AESGCMCipher)(nil)

// ValidateKeyring reports whether an encoded keyring is structurally usable
// without retaining any key material. It never echoes the supplied value.
func ValidateKeyring(encoded string) error {
	_, _, err := parseKeyring(encoded)
	return err
}

// ActiveKeyID is the key identifier new envelopes are sealed under.
func (c *AESGCMCipher) ActiveKeyID() string { return c.activeKeyID }

// KeyIDs lists every key identifier the keyring can decrypt with, sorted.
func (c *AESGCMCipher) KeyIDs() []string {
	ids := make([]string, 0, len(c.keys))
	for id := range c.keys {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
