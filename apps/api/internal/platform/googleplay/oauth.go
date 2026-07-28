// Package googleplay is Mosaic's read-only client for the Google Play
// Developer API and the Cloud Pub/Sub pull endpoint that carries Real-time
// Developer Notifications.
//
// Two deliberate absences define this package:
//
//   - There is no acknowledge, consume, or refund call. Acknowledging a Google
//     purchase is an assertion that the goods were delivered; it is an
//     entitlement act, and Phase 9A grants nothing. Acknowledgement stays with
//     the application and its Play Billing adapter. The operator-visible
//     consequence — an unacknowledged purchase auto-refunds after three days —
//     is documented rather than quietly worked around.
//   - There is no OAuth library dependency. The service-account JWT-bearer
//     exchange is about eighty lines, an ES256 signer already had to be written
//     for Apple, and the RevenueCat client set the precedent of hand-rolling
//     provider transport rather than adopting a vendor SDK.
package googleplay

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	tokenEndpoint = "https://oauth2.googleapis.com/token"
	jwtBearerType = "urn:ietf:params:oauth:grant-type:jwt-bearer"

	// ScopeAndroidPublisher authorizes the purchase and order lookups.
	ScopeAndroidPublisher = "https://www.googleapis.com/auth/androidpublisher"
	// ScopePubSub authorizes pulling the RTDN subscription.
	ScopePubSub = "https://www.googleapis.com/auth/pubsub"

	assertionLifetime = 30 * time.Minute
	// refreshMargin renews an access token before it expires so an in-flight
	// call never fails on a token that expired between mint and use.
	refreshMargin = 60 * time.Second
)

// ServiceAccount is the parsed Google service-account key. The whole JSON file
// is what an operator rotates, so the whole file is what Mosaic stores; these
// are the fields the client reads back out of it.
type ServiceAccount struct {
	Type         string `json:"type"`
	ProjectID    string `json:"project_id"`
	PrivateKeyID string `json:"private_key_id"`
	PrivateKey   string `json:"private_key"`
	ClientEmail  string `json:"client_email"`
	TokenURI     string `json:"token_uri"`

	parsedKey *rsa.PrivateKey
}

// ParseServiceAccount validates a service-account JSON key without contacting
// Google. It is used both at credential-create time (so an unusable key is
// rejected before it is ever persisted) and on every worker run.
func ParseServiceAccount(raw []byte) (*ServiceAccount, error) {
	var account ServiceAccount
	if err := json.Unmarshal(raw, &account); err != nil {
		return nil, errors.New("Google service-account key is not valid JSON")
	}
	if account.Type != "service_account" {
		return nil, errors.New("Google credential is not a service-account key")
	}
	if strings.TrimSpace(account.ClientEmail) == "" || strings.TrimSpace(account.PrivateKey) == "" ||
		strings.TrimSpace(account.PrivateKeyID) == "" || strings.TrimSpace(account.ProjectID) == "" {
		return nil, errors.New("Google service-account key is missing required fields")
	}
	block, _ := pem.Decode([]byte(account.PrivateKey))
	if block == nil {
		return nil, errors.New("Google service-account private key is not PEM encoded")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, errors.New("Google service-account private key is not a PKCS#8 key")
	}
	key, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("Google service-account private key is not an RSA key")
	}
	if account.TokenURI == "" {
		account.TokenURI = tokenEndpoint
	}
	if account.TokenURI != tokenEndpoint {
		// The token URI comes out of a file an operator pasted. Honouring an
		// arbitrary value would let a doctored key redirect signed assertions to
		// a host of the uploader's choosing.
		return nil, errors.New("Google service-account key names an unexpected token endpoint")
	}
	account.parsedKey = key
	return &account, nil
}

// tokenCache holds one access token per (service account, scope set). Tokens
// are process-local and never persisted.
type tokenCache struct {
	mutex  sync.Mutex
	tokens map[string]cachedToken
}

type cachedToken struct {
	value     string
	expiresAt time.Time
}

func newTokenCache() *tokenCache { return &tokenCache{tokens: make(map[string]cachedToken)} }

// accessToken returns a bearer token for the requested scopes, minting one when
// the cache is cold or the cached token is inside the refresh margin.
func (c *Client) accessToken(ctx context.Context, account *ServiceAccount, scopes ...string) (string, error) {
	key := account.ClientEmail + "\x00" + strings.Join(scopes, " ")
	now := c.now()

	c.tokens.mutex.Lock()
	if cached, ok := c.tokens.tokens[key]; ok && cached.expiresAt.After(now.Add(refreshMargin)) {
		c.tokens.mutex.Unlock()
		return cached.value, nil
	}
	c.tokens.mutex.Unlock()

	assertion, err := signAssertion(account, strings.Join(scopes, " "), now)
	if err != nil {
		return "", err
	}
	form := url.Values{}
	form.Set("grant_type", jwtBearerType)
	form.Set("assertion", assertion)

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, account.TokenURI, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	var response struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
		TokenType   string `json:"token_type"`
		Error       string `json:"error"`
	}
	status, err := c.execute(ctx, request, &response)
	if err != nil {
		return "", err
	}
	if status != http.StatusOK || response.AccessToken == "" {
		// response.Error is Google's stable machine code (`invalid_grant`,
		// `unauthorized_client`); it is safe to classify on and is the only part
		// of the token response that ever leaves this function.
		return "", &Error{HTTPStatus: status, GoogleCode: safeCode(response.Error), Op: "oauth_token"}
	}
	expiresIn := response.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 3600
	}

	c.tokens.mutex.Lock()
	c.tokens.tokens[key] = cachedToken{value: response.AccessToken, expiresAt: now.Add(time.Duration(expiresIn) * time.Second)}
	c.tokens.mutex.Unlock()
	return response.AccessToken, nil
}

// signAssertion builds the RS256 JWT-bearer assertion Google exchanges for an
// access token.
func signAssertion(account *ServiceAccount, scope string, now time.Time) (string, error) {
	if account.parsedKey == nil {
		return "", errors.New("Google service-account key was not parsed")
	}
	header, err := json.Marshal(map[string]string{"alg": "RS256", "typ": "JWT", "kid": account.PrivateKeyID})
	if err != nil {
		return "", err
	}
	claims, err := json.Marshal(map[string]any{
		"iss":   account.ClientEmail,
		"scope": scope,
		"aud":   account.TokenURI,
		"iat":   now.Unix(),
		"exp":   now.Add(assertionLifetime).Unix(),
	})
	if err != nil {
		return "", err
	}
	signingInput := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(claims)
	digest := sha256.Sum256([]byte(signingInput))
	signature, err := rsa.SignPKCS1v15(rand.Reader, account.parsedKey, crypto.SHA256, digest[:])
	if err != nil {
		return "", fmt.Errorf("sign Google assertion: %w", err)
	}
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}
