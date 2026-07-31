//go:build billingdemo

//go:debug x509usefallbackroots=1

// This file belongs to the build-tagged demonstration driver and is excluded
// from every ordinary build.
//
// The `//go:debug x509usefallbackroots=1` directive above is the reason this
// file must never be reachable from a release build. It makes crypto/x509 use
// the fallback root pool this process installs instead of the platform trust
// store, which is how the demonstration can point Mosaic's real webhook
// delivery policy — HTTPS-only, no InsecureSkipVerify, no TLS seam — at a
// loopback destination stub. In a deployed binary the same directive would mean
// Mosaic trusted whatever roots the process happened to install.
package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Demonstration trust anchor
// ---------------------------------------------------------------------------

// demoTLS holds a locally generated CA and a leaf certificate for `localhost`.
//
// Mosaic's webhook policy (internal/billingwebhook/ssrf.go) refuses any
// destination that is not https, builds its own http.Transport, and exposes no
// option to relax certificate verification — correctly, because a webhook
// carries entitlement state. Verification is therefore not bypassed here: a
// real chain is minted and installed as the process fallback root, and the real
// policy performs a real TLS handshake and a real certificate verification
// against it.
type demoTLS struct {
	certificate tls.Certificate
	pool        *x509.CertPool
}

func newDemoTLS() (demoTLS, error) {
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return demoTLS{}, err
	}
	caTemplate := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Mosaic Demo Webhook Root CA (SYNTHETIC)"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTemplate, caTemplate, &caKey.PublicKey, caKey)
	if err != nil {
		return demoTLS{}, err
	}
	caCertificate, err := x509.ParseCertificate(caDER)
	if err != nil {
		return demoTLS{}, err
	}

	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return demoTLS{}, err
	}
	leafTemplate := &x509.Certificate{
		SerialNumber:          big.NewInt(2),
		Subject:               pkix.Name{CommonName: "localhost"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              []string{"localhost"},
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1")},
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leafTemplate, caCertificate, &leafKey.PublicKey, caKey)
	if err != nil {
		return demoTLS{}, err
	}

	pool := x509.NewCertPool()
	pool.AddCert(caCertificate)
	// Installed process-wide, honoured because of the //go:debug directive at the
	// top of this file. Every other TLS client in the demonstration (the Google
	// OAuth stub) pins its own RootCAs explicitly and is unaffected.
	x509.SetFallbackRoots(pool)

	return demoTLS{
		certificate: tls.Certificate{Certificate: [][]byte{leafDER}, PrivateKey: leafKey},
		pool:        pool,
	}, nil
}

// ---------------------------------------------------------------------------
// Webhook destination stub
// ---------------------------------------------------------------------------

// receivedWebhook is one delivery as the destination saw it.
type receivedWebhook struct {
	Header      string
	Body        []byte
	EventID     string
	Verified    bool
	VerifiedKey int
	Status      int
	ReceivedAt  time.Time
}

// destinationStub is the application backend a tenant would run. It verifies
// the Mosaic-Signature header exactly as the published integrator rules require
// (packages/test-fixtures/src/webhook-signature-vectors.json): recompute
// HMAC-SHA256 over "v1.{timestamp}.{eventId}.{rawBody}" using the raw bytes as
// received, accept if ANY v1 parameter verifies.
type destinationStub struct {
	mutex     sync.Mutex
	secrets   []string
	received  []receivedWebhook
	failWith  int
	failCount int

	server *httptest.Server
	url    string
}

func newDestinationStub(material demoTLS) *destinationStub {
	stub := &destinationStub{}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		header := r.Header.Get("Mosaic-Signature")

		stub.mutex.Lock()
		secrets := append([]string(nil), stub.secrets...)
		failWith := stub.failWith
		if failWith != 0 && stub.failCount > 0 {
			stub.failCount--
			if stub.failCount == 0 {
				stub.failWith = 0
			}
		}
		stub.mutex.Unlock()

		eventID := eventIDOf(body)
		verified, index := verifySignature(header, eventID, body, secrets)

		status := http.StatusNoContent
		if failWith != 0 {
			status = failWith
		}
		stub.mutex.Lock()
		stub.received = append(stub.received, receivedWebhook{
			Header: header, Body: body, EventID: eventID,
			Verified: verified, VerifiedKey: index, Status: status, ReceivedAt: time.Now().UTC(),
		})
		stub.mutex.Unlock()

		w.WriteHeader(status)
	})
	server := httptest.NewUnstartedServer(handler)
	server.TLS = &tls.Config{Certificates: []tls.Certificate{material.certificate}}
	server.StartTLS()
	stub.server = server

	_, port, _ := net.SplitHostPort(strings.TrimPrefix(server.URL, "https://"))
	// A literal loopback address rather than `localhost`: the policy screens
	// every address a name resolves to and pins the first, and `localhost`
	// resolves to ::1 as well as 127.0.0.1 on this host while httptest listens
	// on IPv4 only. The certificate carries 127.0.0.1 as an IP SAN, so the
	// handshake is verified against it rather than skipped.
	stub.url = "https://127.0.0.1:" + port + "/mosaic/webhooks"
	return stub
}

func (s *destinationStub) addSecret(secret string) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	s.secrets = append(s.secrets, secret)
}

// failNext makes the destination answer `status` for the next `count`
// deliveries and then recover on its own.
func (s *destinationStub) failNext(status, count int) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	s.failWith, s.failCount = status, count
}

func (s *destinationStub) deliveries() []receivedWebhook {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return append([]receivedWebhook(nil), s.received...)
}

func (s *destinationStub) close() { s.server.Close() }

// eventIDOf reads the event id out of a delivery body. A real receiver needs it
// for deduplication and for signature verification, and it is inside the signed
// payload precisely so a captured signature cannot be moved onto another event.
func eventIDOf(body []byte) string {
	var envelope struct {
		Payload struct {
			EventID string `json:"eventId"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return ""
	}
	return envelope.Payload.EventID
}

// verifySignature is an independent implementation of the published rules. It
// deliberately does not call billingwebhook.Sign: a verifier that reuses the
// producer's own function proves only that the function agrees with itself.
func verifySignature(header, eventID string, body []byte, secrets []string) (bool, int) {
	timestamp := ""
	candidates := []string{}
	for _, part := range strings.Split(header, ",") {
		name, value, found := strings.Cut(strings.TrimSpace(part), "=")
		if !found {
			continue
		}
		switch name {
		case "t":
			timestamp = value
		case "v1":
			candidates = append(candidates, strings.ToLower(value))
		}
	}
	if timestamp == "" || len(candidates) == 0 {
		return false, -1
	}
	seconds, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return false, -1
	}
	// The replay window is checked before any signature comparison, exactly as
	// the integrator rules require.
	if delta := time.Since(time.Unix(seconds, 0)); delta > 300*time.Second || delta < -300*time.Second {
		return false, -1
	}
	signed := "v1." + timestamp + "." + eventID + "." + string(body)
	for index, secret := range secrets {
		expected := hmacHex(secret, signed)
		for _, candidate := range candidates {
			if constantTimeEqual(expected, candidate) {
				return true, index
			}
		}
	}
	return false, -1
}

func hmacHex(secret, message string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(message))
	return hex.EncodeToString(mac.Sum(nil))
}

func constantTimeEqual(left, right string) bool {
	if len(left) != len(right) {
		return false
	}
	var difference byte
	for index := 0; index < len(left); index++ {
		difference |= left[index] ^ right[index]
	}
	return difference == 0
}

// ---------------------------------------------------------------------------
// Shared reference vectors
// ---------------------------------------------------------------------------

// webhookVectorFile is the cross-implementation signature vector set every SDK
// and every integrator is expected to agree with.
const webhookVectorFile = "../../packages/test-fixtures/src/webhook-signature-vectors.json"

type signatureVector struct {
	ID        string `json:"id"`
	Secret    string `json:"secret"`
	Timestamp int64  `json:"timestamp"`
	EventID   string `json:"eventId"`
	RawBody   string `json:"rawBody"`
	Signature string `json:"signature"`
	Header    string `json:"header"`
	Notes     string `json:"notes"`
}

func loadSignatureVectors(path string) ([]signatureVector, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var file struct {
		Vectors []signatureVector `json:"vectors"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		return nil, err
	}
	if len(file.Vectors) == 0 {
		return nil, fmt.Errorf("no signature vectors in %s", path)
	}
	return file.Vectors, nil
}

// digestPreview renders the first bytes of a digest for the transcript.
func digestPreview(value []byte) string {
	encoded := hex.EncodeToString(value)
	if len(encoded) <= 24 {
		return encoded
	}
	return encoded[:24] + "…"
}

func sha256Hex(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
