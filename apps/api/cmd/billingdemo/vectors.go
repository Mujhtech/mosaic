package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"time"
)

// The Apple material below is SYNTHETIC. Apple's real signing chain cannot be
// reproduced offline, so the demo generates its own three-certificate chain and
// injects its root through appstorejws.WithRoot — the same seam the verifier's
// own unit tests use. Everything downstream of the signature check is exercised
// exactly as it would be in production; the signature itself proves only that
// Mosaic's verifier accepts a chain it was told to trust.

// appleWWDROID is Apple's "App Store" certificate extension OID. The verifier
// requires it on the intermediate, so the synthetic chain carries it.
var appleWWDROID = asn1.ObjectIdentifier{1, 2, 840, 113635, 100, 6, 2, 1}

type demoChain struct {
	root    *x509.Certificate
	leafKey *ecdsa.PrivateKey
	encoded []string
}

func newDemoChain() (demoChain, error) {
	mint := func(template, parent *x509.Certificate, publicKey any, signerKey any) (*x509.Certificate, []byte, error) {
		if parent == nil {
			parent = template
		}
		der, err := x509.CreateCertificate(rand.Reader, template, parent, publicKey, signerKey)
		if err != nil {
			return nil, nil, err
		}
		parsed, err := x509.ParseCertificate(der)
		return parsed, der, err
	}

	rootKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return demoChain{}, err
	}
	rootTemplate := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Mosaic Demo Root CA (SYNTHETIC — not Apple)"},
		NotBefore:             time.Now().Add(-24 * time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign,
	}
	root, rootDER, err := mint(rootTemplate, nil, &rootKey.PublicKey, rootKey)
	if err != nil {
		return demoChain{}, err
	}

	intermediateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return demoChain{}, err
	}
	intermediateTemplate := &x509.Certificate{
		SerialNumber:          big.NewInt(2),
		Subject:               pkix.Name{CommonName: "Mosaic Demo Intermediate CA (SYNTHETIC)"},
		NotBefore:             time.Now().Add(-24 * time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign,
		ExtraExtensions:       []pkix.Extension{{Id: appleWWDROID, Value: []byte{0x05, 0x00}}},
	}
	intermediate, intermediateDER, err := mint(intermediateTemplate, root, &intermediateKey.PublicKey, rootKey)
	if err != nil {
		return demoChain{}, err
	}

	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return demoChain{}, err
	}
	leafTemplate := &x509.Certificate{
		SerialNumber: big.NewInt(3),
		Subject:      pkix.Name{CommonName: "Mosaic Demo Leaf (SYNTHETIC)"},
		NotBefore:    time.Now().Add(-24 * time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
	}
	_, leafDER, err := mint(leafTemplate, intermediate, &leafKey.PublicKey, intermediateKey)
	if err != nil {
		return demoChain{}, err
	}

	return demoChain{
		root:    root,
		leafKey: leafKey,
		encoded: []string{
			base64.StdEncoding.EncodeToString(leafDER),
			base64.StdEncoding.EncodeToString(intermediateDER),
			base64.StdEncoding.EncodeToString(rootDER),
		},
	}, nil
}

// signJWS builds a compact JWS the way Apple does: ES256 over base64url header
// and payload, with the raw R||S signature form.
func (c demoChain) signJWS(payload map[string]any) (string, error) {
	headerBytes, err := json.Marshal(map[string]any{"alg": "ES256", "x5c": c.encoded})
	if err != nil {
		return "", err
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	signingInput := base64.RawURLEncoding.EncodeToString(headerBytes) + "." +
		base64.RawURLEncoding.EncodeToString(payloadBytes)
	digest := sha256.Sum256([]byte(signingInput))
	r, s, err := ecdsa.Sign(rand.Reader, c.leafKey, digest[:])
	if err != nil {
		return "", err
	}
	signature := make([]byte, 64)
	rBytes, sBytes := r.Bytes(), s.Bytes()
	copy(signature[32-len(rBytes):32], rBytes)
	copy(signature[64-len(sBytes):], sBytes)
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

// appleTransactionPayload is the JWSTransactionDecodedPayload a validation
// lookup returns.
func appleTransactionPayload(transactionID, productID string, occurred time.Time) map[string]any {
	return map[string]any{
		"transactionId":               transactionID,
		"originalTransactionId":       transactionID,
		"webOrderLineItemId":          "1000000" + transactionID[len(transactionID)-6:],
		"bundleId":                    appleBundleID,
		"productId":                   productID,
		"subscriptionGroupIdentifier": "21456789",
		"purchaseDate":                occurred.UnixMilli(),
		"originalPurchaseDate":        occurred.UnixMilli(),
		"expiresDate":                 occurred.Add(30 * 24 * time.Hour).UnixMilli(),
		"quantity":                    1,
		"type":                        "Auto-Renewable Subscription",
		"transactionReason":           "PURCHASE",
		"inAppOwnershipType":          "PURCHASED",
		"signedDate":                  occurred.UnixMilli(),
		"environment":                 "Production",
		"storefront":                  "USA",
	}
}

// appleNotificationBody builds the exact JSON body Apple POSTs to the intake
// endpoint: {"signedPayload": "<JWS>"}.
func (c demoChain) appleNotificationBody(uuid, transactionID, productID string, occurred time.Time) (string, error) {
	signedTransaction, err := c.signJWS(appleTransactionPayload(transactionID, productID, occurred))
	if err != nil {
		return "", err
	}
	signedRenewal, err := c.signJWS(map[string]any{
		"originalTransactionId": transactionID,
		"autoRenewStatus":       1,
		"autoRenewProductId":    productID,
		"productId":             productID,
		"signedDate":            occurred.UnixMilli(),
		"environment":           "Production",
	})
	if err != nil {
		return "", err
	}
	signedPayload, err := c.signJWS(map[string]any{
		"notificationType": "SUBSCRIBED",
		"subtype":          "INITIAL_BUY",
		"notificationUUID": uuid,
		"version":          "2.0",
		"signedDate":       occurred.UnixMilli(),
		"data": map[string]any{
			"appAppleId":            1234567890,
			"bundleId":              appleBundleID,
			"bundleVersion":         "1",
			"environment":           "Production",
			"signedTransactionInfo": signedTransaction,
			"signedRenewalInfo":     signedRenewal,
			"status":                1,
		},
	})
	if err != nil {
		return "", err
	}
	body, err := json.Marshal(map[string]string{"signedPayload": signedPayload})
	return string(body), err
}

// ---------------------------------------------------------------------------
// Credential material (synthetic)
// ---------------------------------------------------------------------------

// newApplePrivateKeyPEM produces a PKCS#8 P-256 key in the shape of an Apple
// In-App Purchase .p8. It is generated locally and is not an Apple key.
func newApplePrivateKeyPEM() ([]byte, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, err
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), nil
}

// newGoogleServiceAccountJSON produces a service-account key file in Google's
// documented shape with a locally generated RSA key. token_uri is Google's real
// endpoint because ParseServiceAccount pins it — a deliberate control that
// stops a doctored key redirecting signed assertions. The demo reaches its
// local token stub through a loopback CONNECT proxy instead of weakening it.
func newGoogleServiceAccountJSON(clientEmail, projectID string) ([]byte, error) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, err
	}
	return json.Marshal(map[string]string{
		"type":                        "service_account",
		"project_id":                  projectID,
		"private_key_id":              "demo-key-0001",
		"private_key":                 string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})),
		"client_email":                clientEmail,
		"client_id":                   "100000000000000000001",
		"auth_uri":                    "https://accounts.google.com/o/oauth2/auth",
		"token_uri":                   "https://oauth2.googleapis.com/token",
		"auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
		"client_x509_cert_url":        fmt.Sprintf("https://www.googleapis.com/robot/v1/metadata/x509/%s", clientEmail),
	})
}

// rtdnMessageData builds the base64 `data` member of a Pub/Sub message carrying
// a subscription Real-time Developer Notification.
func rtdnMessageData(packageName, subscriptionID, purchaseToken string, notificationType int, when time.Time) string {
	body, _ := json.Marshal(map[string]any{
		"version":         "1.0",
		"packageName":     packageName,
		"eventTimeMillis": fmt.Sprintf("%d", when.UnixMilli()),
		"subscriptionNotification": map[string]any{
			"version":          "1.0",
			"notificationType": notificationType,
			"purchaseToken":    purchaseToken,
			"subscriptionId":   subscriptionID,
		},
	})
	return base64.StdEncoding.EncodeToString(body)
}
