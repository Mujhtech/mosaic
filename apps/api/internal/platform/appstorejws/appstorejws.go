// Package appstorejws verifies the JSON Web Signatures Apple attaches to App
// Store Server Notifications V2 and App Store Server API responses.
//
// This is Phase 9A's primary security boundary. Everything downstream — the
// Transaction Fact ledger, Product resolution, the operator dashboard — treats
// a verified payload as something Apple actually said, so a defect here is a
// forged-transaction defect. The package is therefore deliberately small,
// pure, and pessimistic:
//
//   - The signing algorithm is pinned to ES256. `none`, HS*, and RS* are
//     rejected before any key material is examined, because algorithm confusion
//     is the standard way a JWS verifier is turned into a rubber stamp.
//   - The trust anchor is the Apple Root CA - G3 certificate compiled into the
//     binary. The system trust pool is never consulted and the root is never
//     fetched at runtime, so a compromised or permissive host trust store
//     cannot be used to mint a chain Mosaic will accept.
//   - Certificate validity is checked at the payload's own signing time rather
//     than at time.Now(), so a genuine historical notification replayed from
//     Apple's notification history still verifies while a truly expired chain
//     does not.
package appstorejws

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"crypto/x509"
	_ "embed"
	"encoding/asn1"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"
)

// appleRootCAG3 is the trust anchor for every Apple JWS Mosaic verifies. It is
// the self-signed "Apple Root CA - G3" certificate published at
// https://www.apple.com/certificateauthority/ (SHA-256 fingerprint
// 63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79).
//
//go:embed roots/apple-root-ca-g3.pem
var appleRootCAG3 []byte

// appleWWDROID is the Apple-assigned extension OID the App Store Server
// intermediate certificate carries. Requiring it means a leaf chained to the
// Apple root through some other Apple intermediate — a device certificate, for
// example — cannot be presented as a store signature.
var appleWWDROID = asn1.ObjectIdentifier{1, 2, 840, 113635, 100, 6, 2, 1}

var (
	// ErrUnverified is returned for every verification failure. The specific
	// reason is carried on the error for telemetry but the sentinel is
	// deliberately single: callers must not branch on how a forgery failed.
	ErrUnverified = errors.New("apple JWS payload could not be verified")
)

// Reason is a stable, safe classification of a verification failure. It is
// suitable for metrics and operator display and never contains payload content.
type Reason string

const (
	ReasonMalformed          Reason = "malformed_jws"
	ReasonAlgorithmRejected  Reason = "algorithm_rejected"
	ReasonChainMissing       Reason = "certificate_chain_missing"
	ReasonChainUntrusted     Reason = "certificate_chain_untrusted"
	ReasonIntermediateWrong  Reason = "intermediate_not_app_store"
	ReasonSignatureInvalid   Reason = "signature_invalid"
	ReasonSignedDateMissing  Reason = "signed_date_missing"
	ReasonSignedDateInFuture Reason = "signed_date_in_future"
)

// VerificationError carries the safe reason behind a rejection.
type VerificationError struct {
	Reason Reason
}

func (e *VerificationError) Error() string {
	return fmt.Sprintf("%s: %s", ErrUnverified.Error(), e.Reason)
}

func (e *VerificationError) Is(target error) bool { return target == ErrUnverified }

func reject(reason Reason) error { return &VerificationError{Reason: reason} }

// ReasonOf extracts the classification from a verification error, or an empty
// Reason when err did not come from this package.
func ReasonOf(err error) Reason {
	var verification *VerificationError
	if errors.As(err, &verification) {
		return verification.Reason
	}
	return ""
}

// Verifier verifies Apple JWS payloads against the pinned root.
type Verifier struct {
	root *x509.Certificate
	// clockSkew bounds how far into the future a signedDate may sit before the
	// payload is rejected as replayed-from-a-bad-clock.
	clockSkew time.Duration
	now       func() time.Time
}

// Option customizes a Verifier. Both options exist for tests and for operators
// with unusual clock discipline; neither can weaken the trust anchor.
type Option func(*Verifier)

func WithClockSkew(skew time.Duration) Option {
	return func(v *Verifier) {
		if skew > 0 {
			v.clockSkew = skew
		}
	}
}

func WithClock(now func() time.Time) Option {
	return func(v *Verifier) {
		if now != nil {
			v.now = now
		}
	}
}

// WithRoot replaces the trust anchor. It exists so tests can verify a
// synthetic chain without weakening production, and is never called from
// production wiring.
func WithRoot(root *x509.Certificate) Option {
	return func(v *Verifier) {
		if root != nil {
			v.root = root
		}
	}
}

// NewVerifier builds a verifier over the embedded Apple root. It fails at
// construction if the embedded certificate is unusable, so a broken build is
// caught at startup rather than on the first notification.
func NewVerifier(options ...Option) (*Verifier, error) {
	block, _ := pem.Decode(appleRootCAG3)
	if block == nil || block.Type != "CERTIFICATE" {
		return nil, errors.New("embedded Apple root CA is not a PEM certificate")
	}
	root, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse embedded Apple root CA: %w", err)
	}
	verifier := &Verifier{root: root, clockSkew: 5 * time.Minute, now: func() time.Time { return time.Now().UTC() }}
	for _, option := range options {
		option(verifier)
	}
	return verifier, nil
}

// Header is the decoded JWS protected header.
type Header struct {
	Algorithm string   `json:"alg"`
	X5C       []string `json:"x5c"`
}

// Verify checks a compact JWS and returns the decoded payload bytes.
//
// signedDate is read from the payload itself (Apple stamps every signed object
// with one) and is the instant the certificate chain is evaluated at.
func (v *Verifier) Verify(compact string) ([]byte, time.Time, error) {
	headerBytes, payloadBytes, signature, signingInput, err := split(compact)
	if err != nil {
		return nil, time.Time{}, err
	}

	var header Header
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return nil, time.Time{}, reject(ReasonMalformed)
	}
	// Pinned before anything else touches key material.
	if header.Algorithm != "ES256" {
		return nil, time.Time{}, reject(ReasonAlgorithmRejected)
	}
	// leaf, intermediate, root.
	if len(header.X5C) < 3 {
		return nil, time.Time{}, reject(ReasonChainMissing)
	}

	signedDate, err := signedDateOf(payloadBytes)
	if err != nil {
		return nil, time.Time{}, err
	}
	if signedDate.After(v.now().Add(v.clockSkew)) {
		return nil, time.Time{}, reject(ReasonSignedDateInFuture)
	}

	leaf, err := v.verifyChain(header.X5C, signedDate)
	if err != nil {
		return nil, time.Time{}, err
	}

	publicKey, ok := leaf.PublicKey.(*ecdsa.PublicKey)
	if !ok || publicKey.Curve != elliptic.P256() {
		return nil, time.Time{}, reject(ReasonAlgorithmRejected)
	}
	// ES256 signatures are the raw R||S pair, not the ASN.1 DER form
	// ecdsa.VerifyASN1 expects, so the halves are converted explicitly. A
	// length other than 64 is malformed rather than merely invalid.
	if len(signature) != 64 {
		return nil, time.Time{}, reject(ReasonSignatureInvalid)
	}
	digest := sha256.Sum256(signingInput)
	r := new(big.Int).SetBytes(signature[:32])
	s := new(big.Int).SetBytes(signature[32:])
	if !ecdsa.Verify(publicKey, digest[:], r, s) {
		return nil, time.Time{}, reject(ReasonSignatureInvalid)
	}
	return payloadBytes, signedDate, nil
}

// verifyChain validates leaf -> intermediate -> pinned root at instant.
func (v *Verifier) verifyChain(encoded []string, instant time.Time) (*x509.Certificate, error) {
	certificates := make([]*x509.Certificate, 0, len(encoded))
	for _, value := range encoded {
		der, err := base64.StdEncoding.DecodeString(value)
		if err != nil {
			return nil, reject(ReasonMalformed)
		}
		certificate, err := x509.ParseCertificate(der)
		if err != nil {
			return nil, reject(ReasonMalformed)
		}
		certificates = append(certificates, certificate)
	}

	// The chain Apple presents must terminate at the certificate compiled into
	// this binary. Comparing the raw DER rather than the subject means a
	// same-named root from a different issuer is not accepted.
	presentedRoot := certificates[len(certificates)-1]
	if !presentedRoot.Equal(v.root) {
		return nil, reject(ReasonChainUntrusted)
	}

	roots := x509.NewCertPool()
	roots.AddCert(v.root)
	intermediates := x509.NewCertPool()
	for _, certificate := range certificates[1 : len(certificates)-1] {
		intermediates.AddCert(certificate)
	}

	leaf := certificates[0]
	chains, err := leaf.Verify(x509.VerifyOptions{
		Roots:         roots,
		Intermediates: intermediates,
		CurrentTime:   instant,
		// Apple's App Store leaf certificates carry no extended key usage that
		// x509 recognises, so no EKU is required; the App Store extension check
		// below is what constrains the chain to store signing.
		KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageAny},
	})
	if err != nil || len(chains) == 0 {
		return nil, reject(ReasonChainUntrusted)
	}

	if !hasAppStoreExtension(chains[0]) {
		return nil, reject(ReasonIntermediateWrong)
	}
	return leaf, nil
}

// hasAppStoreExtension reports whether any non-root certificate in the verified
// chain carries Apple's App Store Server extension OID.
func hasAppStoreExtension(chain []*x509.Certificate) bool {
	for _, certificate := range chain {
		for _, extension := range certificate.Extensions {
			if extension.Id.Equal(appleWWDROID) {
				return true
			}
		}
		for _, extension := range certificate.UnhandledCriticalExtensions {
			if extension.Equal(appleWWDROID) {
				return true
			}
		}
	}
	return false
}

// signedDateOf reads the millisecond `signedDate` Apple stamps on every signed
// object. A payload without one cannot be anchored in time and is rejected
// rather than verified against the current clock.
func signedDateOf(payload []byte) (time.Time, error) {
	var envelope struct {
		SignedDate *int64 `json:"signedDate"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return time.Time{}, reject(ReasonMalformed)
	}
	if envelope.SignedDate == nil || *envelope.SignedDate <= 0 {
		return time.Time{}, reject(ReasonSignedDateMissing)
	}
	return time.UnixMilli(*envelope.SignedDate).UTC(), nil
}

// split decomposes a compact JWS without allocating a parser dependency.
func split(compact string) (header, payload, signature, signingInput []byte, err error) {
	compact = strings.TrimSpace(compact)
	first := strings.IndexByte(compact, '.')
	last := strings.LastIndexByte(compact, '.')
	if first <= 0 || last <= first || last == len(compact)-1 {
		return nil, nil, nil, nil, reject(ReasonMalformed)
	}
	if strings.Count(compact, ".") != 2 {
		return nil, nil, nil, nil, reject(ReasonMalformed)
	}
	header, err = base64.RawURLEncoding.DecodeString(compact[:first])
	if err != nil {
		return nil, nil, nil, nil, reject(ReasonMalformed)
	}
	payload, err = base64.RawURLEncoding.DecodeString(compact[first+1 : last])
	if err != nil {
		return nil, nil, nil, nil, reject(ReasonMalformed)
	}
	signature, err = base64.RawURLEncoding.DecodeString(compact[last+1:])
	if err != nil {
		return nil, nil, nil, nil, reject(ReasonMalformed)
	}
	return header, payload, signature, []byte(compact[:last]), nil
}
