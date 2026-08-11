// Package appstoreconnect implements the read-only App Store Connect API
// catalog adapter behind Mosaic's provider-catalog application boundary.
//
// The adapter reads Apps, In-App Purchases, Subscription Groups, and
// Subscriptions. It never calls an endpoint that changes App Store state:
// Mosaic imports an operator's existing App Store catalog and does not author
// products on their behalf.
package appstoreconnect

import (
	"bytes"
	"crypto/ecdsa"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"strings"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/appstoreserver"
)

// ErrCredentialInvalid reports a credential document that cannot be used. It
// never carries the offending value.
var ErrCredentialInvalid = errors.New("App Store Connect credential is invalid")

var (
	keyIDPattern        = regexp.MustCompile(`^[0-9A-Z]{10}$`)
	issuerIDPattern     = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	vendorNumberPattern = regexp.MustCompile(`^[0-9]{1,20}$`)
)

// maxCredentialBytes bounds the sealed document. A .p8 P-256 key is a few
// hundred bytes; anything near the connection credential column limit is not a
// credential.
const maxCredentialBytes = 4096

// CredentialDocument is the JSON document an operator supplies once and Mosaic
// seals as the single opaque connection credential.
//
// It is the wire form only. Parsed material is held for the duration of one
// call and the caller zeroes the source buffer.
type CredentialDocument struct {
	// PrivateKey is the PEM text of the App Store Connect API key (.p8).
	PrivateKey string `json:"privateKey"`
	// KeyID is the ten-character key identifier Apple shows beside the key.
	KeyID string `json:"keyId"`
	// IssuerID is the team-wide issuer UUID from the Keys page.
	IssuerID string `json:"issuerId"`
	// VendorNumber is the App Store Connect vendor number. It is deliberately
	// unused by catalog import: the vendor number identifies the payee for the
	// Sales and Finance reporting endpoints, which Mosaic does not call yet. It
	// is captured now so a later sales or finance feature does not have to ask
	// every operator to re-enter a credential that is otherwise complete.
	VendorNumber string `json:"vendorNumber,omitempty"`
}

// Credential is a parsed, usable App Store Connect credential.
type Credential struct {
	PrivateKey   *ecdsa.PrivateKey
	KeyID        string
	IssuerID     string
	VendorNumber string
}

// ParseCredential decodes and validates the sealed credential document.
//
// Every failure returns ErrCredentialInvalid without detail: the input is key
// material and a granular parse error is a decoding oracle in an API response.
func ParseCredential(document []byte) (Credential, error) {
	if len(document) == 0 || len(document) > maxCredentialBytes {
		return Credential{}, ErrCredentialInvalid
	}
	var parsed CredentialDocument
	decoder := json.NewDecoder(bytes.NewReader(document))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&parsed); err != nil {
		return Credential{}, ErrCredentialInvalid
	}
	// Trailing content means the operator pasted more than one document; the
	// second half would be silently ignored otherwise.
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return Credential{}, ErrCredentialInvalid
	}
	keyID := strings.TrimSpace(parsed.KeyID)
	issuerID := strings.TrimSpace(parsed.IssuerID)
	vendorNumber := strings.TrimSpace(parsed.VendorNumber)
	if !keyIDPattern.MatchString(keyID) || !issuerIDPattern.MatchString(issuerID) {
		return Credential{}, ErrCredentialInvalid
	}
	if vendorNumber != "" && !vendorNumberPattern.MatchString(vendorNumber) {
		return Credential{}, ErrCredentialInvalid
	}
	key, err := appstoreserver.ParsePrivateKey([]byte(parsed.PrivateKey))
	if err != nil {
		return Credential{}, ErrCredentialInvalid
	}
	return Credential{PrivateKey: key, KeyID: keyID, IssuerID: issuerID, VendorNumber: vendorNumber}, nil
}
