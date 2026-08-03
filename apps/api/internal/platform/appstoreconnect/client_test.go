package appstoreconnect

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/providercatalog"
)

const (
	testKeyID    = "ABCDE12345"
	testIssuerID = "57246542-96fe-1a63-e053-0824d011072a"
)

func testCredential(t *testing.T) providercatalog.Credential {
	t.Helper()
	return providercatalog.Credential{Secret: []byte(credentialJSON(t, CredentialDocument{
		PrivateKey: testPrivateKeyPEM(t), KeyID: testKeyID, IssuerID: testIssuerID,
	}))}
}

func newTestClient(t *testing.T, baseURL string) *Client {
	t.Helper()
	client, err := New(Config{BaseURL: baseURL, MaxAttempts: 3, RequestTimeout: 2 * time.Second, OperationTimeout: 20 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	return client
}

type jwtClaims struct {
	Issuer   string `json:"iss"`
	IssuedAt int64  `json:"iat"`
	Expires  int64  `json:"exp"`
	Audience string `json:"aud"`
	Bundle   string `json:"bid"`
}

func decodeSegment(t *testing.T, segment string, target any) {
	t.Helper()
	raw, err := base64.RawURLEncoding.DecodeString(segment)
	if err != nil {
		t.Fatalf("decode JWT segment: %v", err)
	}
	if err := json.Unmarshal(raw, target); err != nil {
		t.Fatalf("decode JWT segment JSON: %v", err)
	}
}

// TestFetchCatalogSignsAppStoreConnectTokensWithoutBundleClaim protects the one
// difference between an App Store Server assertion and an App Store Connect
// assertion: App Store Connect rejects a token carrying `bid`. Reusing the
// StoreKit signer verbatim would make every catalog call fail with a 401 that
// presents as an invalid operator credential.
func TestFetchCatalogSignsAppStoreConnectTokensWithoutBundleClaim(t *testing.T) {
	var mutex sync.Mutex
	tokens := make([]string, 0)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mutex.Lock()
		tokens = append(tokens, strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		mutex.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	defer server.Close()

	before := time.Now().UTC()
	if _, err := newTestClient(t, server.URL).FetchCatalog(context.Background(), testCredential(t)); err != nil {
		t.Fatalf("fetch catalog: %v", err)
	}
	if len(tokens) == 0 {
		t.Fatal("no request was signed")
	}
	segments := strings.Split(tokens[0], ".")
	if len(segments) != 3 {
		t.Fatalf("token is not a three-part JWS: %d segments", len(segments))
	}
	var header struct {
		Algorithm string `json:"alg"`
		KeyID     string `json:"kid"`
		Type      string `json:"typ"`
	}
	decodeSegment(t, segments[0], &header)
	if header.Algorithm != "ES256" || header.KeyID != testKeyID || header.Type != "JWT" {
		t.Fatalf("token header = %+v", header)
	}
	var claims jwtClaims
	decodeSegment(t, segments[1], &claims)
	if claims.Bundle != "" {
		t.Fatalf("App Store Connect token carried a bid claim: %q", claims.Bundle)
	}
	if claims.Audience != "appstoreconnect-v1" || claims.Issuer != testIssuerID {
		t.Fatalf("token claims = %+v", claims)
	}
	lifetime := time.Duration(claims.Expires-claims.IssuedAt) * time.Second
	if lifetime <= 0 || lifetime > 20*time.Minute {
		t.Fatalf("token lifetime = %s, want a positive value no greater than 20m", lifetime)
	}
	if claims.IssuedAt < before.Add(-time.Minute).Unix() {
		t.Fatalf("token iat = %d, want a fresh instant", claims.IssuedAt)
	}
}

// TestFetchCatalogPaginatesAndNormalizesAppleResources protects the mapping the
// import and preview paths depend on: an operator must not be offered a
// consumable as a permanent non-consumable, a subscription must be importable,
// and a product on a page Apple only reachable through links.next must not be
// silently dropped from the catalog an operator chooses from.
func TestFetchCatalogPaginatesAndNormalizesAppleResources(t *testing.T) {
	var mutex sync.Mutex
	requests := make([]string, 0)
	var baseURL string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mutex.Lock()
		requests = append(requests, r.URL.RequestURI())
		mutex.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/v1/apps" && r.URL.Query().Get("cursor") == "":
			_, _ = w.Write([]byte(`{"data":[
				{"id":"app_1","attributes":{"name":"Acme","bundleId":"com.example.app"}}
			],"links":{"next":"` + baseURL + `/v1/apps?cursor=page2&limit=200"}}`))
		case r.URL.Path == "/v1/apps":
			_, _ = w.Write([]byte(`{"data":[
				{"id":"app_2","attributes":{"name":"Acme Pro","bundleId":"com.example.pro"}}
			]}`))
		case r.URL.Path == "/v1/apps/app_1/inAppPurchasesV2":
			_, _ = w.Write([]byte(`{"data":[
				{"id":"iap_lifetime","attributes":{"name":"Lifetime","productId":"com.example.lifetime","inAppPurchaseType":"NON_CONSUMABLE","state":"APPROVED"}},
				{"id":"iap_coins","attributes":{"name":"Coins","productId":"com.example.coins","inAppPurchaseType":"CONSUMABLE","state":"APPROVED"}},
				{"id":"iap_pending","attributes":{"name":"Pending","productId":"com.example.pending","inAppPurchaseType":"NON_CONSUMABLE","state":"MISSING_METADATA"}}
			]}`))
		case r.URL.Path == "/v1/apps/app_1/subscriptionGroups":
			_, _ = w.Write([]byte(`{"data":[
				{"id":"grp_pro","attributes":{"referenceName":"Pro"}}
			]}`))
		case r.URL.Path == "/v1/subscriptionGroups/grp_pro/subscriptions":
			_, _ = w.Write([]byte(`{"data":[
				{"id":"sub_monthly","attributes":{"name":"Monthly","productId":"com.example.monthly","state":"APPROVED"}}
			]}`))
		default:
			_, _ = w.Write([]byte(`{"data":[]}`))
		}
	}))
	defer server.Close()
	baseURL = server.URL

	catalog, err := newTestClient(t, server.URL).FetchCatalog(context.Background(), testCredential(t))
	if err != nil {
		t.Fatalf("fetch catalog: %v", err)
	}
	if len(catalog.Apps) != 2 || catalog.Apps[0].Identifier != "com.example.app" ||
		catalog.Apps[0].Platform != "app_store" || catalog.Apps[1].ID != "app_2" {
		t.Fatalf("apps = %#v", catalog.Apps)
	}
	if len(catalog.Entitlements) != 0 {
		t.Fatalf("App Store Connect has no entitlements, got %#v", catalog.Entitlements)
	}
	products := make(map[string]providercatalog.Product, len(catalog.Products))
	for _, product := range catalog.Products {
		products[product.ID] = product
	}
	lifetime, ok := products["iap_lifetime"]
	if !ok || lifetime.Type != providercatalog.ProductTypeOneTimeNonConsumable ||
		lifetime.State != "active" || lifetime.StoreIdentifier != "com.example.lifetime" ||
		lifetime.AppID != "app_1" {
		t.Fatalf("approved non-consumable = %#v", lifetime)
	}
	coins, ok := products["iap_coins"]
	if !ok || coins.Type == providercatalog.ProductTypeOneTimeNonConsumable ||
		coins.Type == providercatalog.ProductTypeSubscription {
		t.Fatalf("consumable must not be importable: %#v", coins)
	}
	if pending := products["iap_pending"]; pending.State == "active" {
		t.Fatalf("unapproved product reported as active: %#v", pending)
	}
	monthly, ok := products["sub_monthly"]
	if !ok || monthly.Type != providercatalog.ProductTypeSubscription || monthly.State != "active" ||
		monthly.StoreIdentifier != "com.example.monthly" {
		t.Fatalf("subscription = %#v", monthly)
	}
	if len(catalog.Offerings) != 1 || catalog.Offerings[0].LookupKey != "grp_pro" ||
		len(catalog.Offerings[0].Packages) != 1 ||
		len(catalog.Offerings[0].Packages[0].ProductIDs) != 1 ||
		catalog.Offerings[0].Packages[0].ProductIDs[0] != "sub_monthly" {
		t.Fatalf("subscription group offering = %#v", catalog.Offerings)
	}
	followed := false
	for _, request := range requests {
		if strings.Contains(request, "cursor=page2") {
			followed = true
		}
	}
	if !followed {
		t.Fatalf("next page was never requested: %v", requests)
	}
}

// TestFetchCatalogClassifiesFailuresHonestly protects the classification the
// connection-health and sync-retry logic acts on. Reporting a rate limit as a
// bad credential quarantines a healthy connection, and returning a zero catalog
// with a nil error on a malformed body would import an empty catalog as if the
// operator had no products.
func TestFetchCatalogClassifiesFailuresHonestly(t *testing.T) {
	cases := []struct {
		name      string
		status    int
		body      string
		header    string
		code      providercatalog.ErrorCode
		retryable bool
	}{
		{name: "unauthorized", status: http.StatusUnauthorized, body: `{}`, code: providercatalog.ErrorCredentialInvalid},
		{name: "forbidden", status: http.StatusForbidden, body: `{}`, code: providercatalog.ErrorPermissionDenied},
		{name: "rate limited", status: http.StatusTooManyRequests, body: `{}`, header: "0", code: providercatalog.ErrorRateLimited, retryable: true},
		{name: "server error", status: http.StatusInternalServerError, body: `{}`, code: providercatalog.ErrorProviderUnavailable, retryable: true},
		{name: "not found", status: http.StatusNotFound, body: `{}`, code: providercatalog.ErrorInvalidResponse},
		// Apple returning something nobody has documented is an unknown, not a
		// proven-permanent failure.
		{name: "unknown status", status: http.StatusTeapot, body: `{}`, code: providercatalog.ErrorProviderUnavailable, retryable: true},
		{name: "malformed body", status: http.StatusOK, body: `{"data":[`, code: providercatalog.ErrorInvalidResponse},
		{name: "trailing content", status: http.StatusOK, body: `{"data":[]}{"data":[]}`, code: providercatalog.ErrorInvalidResponse},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if testCase.header != "" {
					w.Header().Set("Retry-After", testCase.header)
				}
				w.WriteHeader(testCase.status)
				_, _ = w.Write([]byte(testCase.body))
			}))
			defer server.Close()
			catalog, err := newTestClient(t, server.URL).FetchCatalog(context.Background(), testCredential(t))
			var providerError *providercatalog.Error
			if !errors.As(err, &providerError) {
				t.Fatalf("error = %v, want a provider catalog error", err)
			}
			if providerError.Code != testCase.code || providerError.Retryable != testCase.retryable {
				t.Fatalf("error = %+v, want code %s retryable %t", providerError, testCase.code, testCase.retryable)
			}
			if len(catalog.Apps) != 0 || len(catalog.Products) != 0 {
				t.Fatalf("a failed fetch returned catalog content: %#v", catalog)
			}
			if !errors.Is(err, providercatalog.ErrUnavailable) {
				t.Fatalf("error does not unwrap to the boundary sentinel: %v", err)
			}
		})
	}
}

// TestFetchCatalogRejectsUnusableCredential keeps an unparsable stored
// credential from being reported as a provider outage: an operator whose key
// was mangled must be told the credential is invalid, not that Apple is down.
func TestFetchCatalogRejectsUnusableCredential(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("a request was sent with an unusable credential")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	_, err := newTestClient(t, server.URL).FetchCatalog(
		context.Background(), providercatalog.Credential{Secret: []byte("sk_wrong_provider")},
	)
	var providerError *providercatalog.Error
	if !errors.As(err, &providerError) || providerError.Code != providercatalog.ErrorCredentialInvalid {
		t.Fatalf("error = %v, want credentialInvalid", err)
	}
}

// TestFetchCatalogRefusesForeignNextLink keeps Apple's pagination from being
// used to send a signed Apple assertion to another origin.
func TestFetchCatalogRefusesForeignNextLink(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[],"links":{"next":"https://attacker.example/v1/apps"}}`))
	}))
	defer server.Close()
	_, err := newTestClient(t, server.URL).FetchCatalog(context.Background(), testCredential(t))
	var providerError *providercatalog.Error
	if !errors.As(err, &providerError) || providerError.Code != providercatalog.ErrorInvalidResponse {
		t.Fatalf("error = %v, want invalidResponse", err)
	}
}
