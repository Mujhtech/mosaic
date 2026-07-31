package revenuecat

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/providercatalog"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func jsonResponse(status int, body string, header http.Header) *http.Response {
	if header == nil {
		header = make(http.Header)
	}
	header.Set("Content-Type", "application/json")
	return &http.Response{
		StatusCode: status,
		Header:     header,
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func TestFetchCatalogPaginatesSafelyAndNormalizesV2Resources(t *testing.T) {
	const secret = "sk_test_least_privilege"
	var mutex sync.Mutex
	requests := make([]string, 0)
	appAttempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+secret || r.Header.Get("Accept") != "application/json" {
			t.Errorf("provider request headers authorization=%q accept=%q", r.Header.Get("Authorization"), r.Header.Get("Accept"))
		}
		mutex.Lock()
		requests = append(requests, r.URL.RequestURI())
		mutex.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v2/projects/proj_1/apps":
			appAttempts++
			if appAttempts == 1 {
				w.Header().Set("Retry-After", "0")
				w.WriteHeader(http.StatusTooManyRequests)
				_, _ = w.Write([]byte(`{"sensitive":"must-not-be-decoded"}`))
				return
			}
			if r.URL.Query().Get("starting_after") == "" {
				_ = json.NewEncoder(w).Encode(map[string]any{
					"items": []any{map[string]any{
						"id": "app_resource_1", "name": "iOS", "type": "app_store",
						"app_store": map[string]any{"bundle_id": "com.example.app"},
					}},
					// The adapter must extract only the cursor and reconstruct the
					// next request against its configured origin.
					"next_page": "https://untrusted.invalid/v2/projects/other/apps?starting_after=app_cursor",
				})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"items": []any{}})
		case "/v2/projects/proj_1/products":
			_ = json.NewEncoder(w).Encode(map[string]any{"items": []any{
				map[string]any{
					"id": "prod_resource_1", "app_id": "app_resource_1",
					"store_identifier": "com.example.pro.monthly", "display_name": "Monthly",
					"type": "subscription", "state": "active",
				},
				map[string]any{
					"id": "prod_non_consumable", "app_id": "app_resource_1",
					"store_identifier": "com.example.lifetime", "display_name": "Lifetime",
					"type": "one_time", "state": "active",
					"one_time": map[string]any{"is_consumable": false},
				},
				map[string]any{
					"id": "prod_consumable", "app_id": "app_resource_1",
					"store_identifier": "com.example.coins", "display_name": "Coins",
					"type": "one_time", "state": "active",
					"one_time": map[string]any{"is_consumable": true},
				},
			}})
		case "/v2/projects/proj_1/entitlements":
			_ = json.NewEncoder(w).Encode(map[string]any{"items": []any{map[string]any{
				"id": "ent_resource_1", "lookup_key": "pro", "display_name": "Pro", "state": "active",
			}}})
		case "/v2/projects/proj_1/offerings":
			_ = json.NewEncoder(w).Encode(map[string]any{"items": []any{map[string]any{
				"id": "off_resource_1", "lookup_key": "default", "display_name": "Default",
				"state": "active", "is_current": true,
			}}})
		case "/v2/projects/proj_1/offerings/off_resource_1/packages":
			if r.URL.Query().Get("expand") != "items.product" {
				t.Errorf("package expansion = %q", r.URL.Query().Get("expand"))
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"items": []any{map[string]any{
				"id": "pkg_resource_1", "lookup_key": "$rc_monthly", "display_name": "Monthly",
				"products": map[string]any{"items": []any{
					map[string]any{"product": map[string]any{"id": "prod_resource_1"}},
					map[string]any{"product": map[string]any{"id": "prod_non_consumable"}},
					map[string]any{"product": map[string]any{"id": "prod_consumable"}},
				}},
			}}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client, err := New(Config{
		BaseURL: server.URL + "/v2", RequestTimeout: 2 * time.Second,
		ConnectTimeout: time.Second, MaxAttempts: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	observedAt := time.Date(2026, time.July, 23, 12, 0, 0, 0, time.UTC)
	client.now = func() time.Time { return observedAt }
	catalog, err := client.FetchCatalog(context.Background(), providercatalog.Credential{
		Secret: []byte(secret), ExternalProjectID: "proj_1",
	})
	if err != nil {
		t.Fatalf("fetch catalog: %v", err)
	}
	if catalog.ObservedAt != observedAt || len(catalog.Apps) != 1 || len(catalog.Products) != 2 ||
		len(catalog.Entitlements) != 1 || len(catalog.Offerings) != 1 ||
		len(catalog.Offerings[0].Packages) != 1 {
		t.Fatalf("normalized catalog = %#v", catalog)
	}
	if catalog.Apps[0].Identifier != "com.example.app" ||
		catalog.Products[0].StoreIdentifier != "com.example.pro.monthly" ||
		catalog.Entitlements[0].LookupKey != "pro" ||
		catalog.Offerings[0].LookupKey != "default" ||
		catalog.Offerings[0].Packages[0].LookupKey != "$rc_monthly" ||
		len(catalog.Offerings[0].Packages[0].ProductIDs) != 2 ||
		catalog.Products[1].Type != providercatalog.ProductTypeOneTimeNonConsumable {
		t.Fatalf("catalog lost SDK lookup values: %#v", catalog)
	}
	for _, product := range catalog.Products {
		if product.ID == "prod_consumable" {
			t.Fatalf("consumable product entered normalized catalog: %#v", product)
		}
	}
	mutex.Lock()
	defer mutex.Unlock()
	foundReconstructedCursor := false
	for _, request := range requests {
		if strings.HasPrefix(request, "/v2/projects/proj_1/apps?") &&
			strings.Contains(request, "starting_after=app_cursor") {
			foundReconstructedCursor = true
		}
	}
	if !foundReconstructedCursor {
		t.Fatalf("pagination did not reconstruct cursor on configured origin: %v", requests)
	}
}

func TestProviderFailureDoesNotExposeResponseOrCredential(t *testing.T) {
	const secret = "sk_private_material"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"message":"` + secret + ` cannot read project"}`))
	}))
	defer server.Close()
	client, err := New(Config{BaseURL: server.URL, MaxAttempts: 1})
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.FetchCatalog(context.Background(), providercatalog.Credential{
		Secret: []byte(secret), ExternalProjectID: "proj_1",
	})
	var providerError *providercatalog.Error
	if !errors.As(err, &providerError) || providerError.Code != providercatalog.ErrorPermissionDenied {
		t.Fatalf("provider error = %#v", err)
	}
	if strings.Contains(err.Error(), secret) || strings.Contains(err.Error(), "cannot read project") {
		t.Fatalf("safe provider error leaked response material: %q", err.Error())
	}
}

func TestRateLimitClassificationPreservesRetryAfter(t *testing.T) {
	providerError := classify(http.StatusTooManyRequests, "7")
	if providerError.Code != providercatalog.ErrorRateLimited || !providerError.Retryable ||
		providerError.RetryAfter != 7*time.Second {
		t.Fatalf("rate-limit classification = %#v", providerError)
	}
}

func TestNormalizeProductUsesOneTimeConsumableDiscriminator(t *testing.T) {
	nonConsumable := false
	product := productResponse{
		ID: "prod_lifetime", AppID: "app_1", StoreIdentifier: "lifetime",
		DisplayName: "Lifetime", Type: "one_time", State: "active",
	}
	product.OneTime = &struct {
		IsConsumable *bool `json:"is_consumable"`
	}{IsConsumable: &nonConsumable}
	normalized, include, err := normalizeProduct(product)
	if err != nil || !include || normalized.Type != providercatalog.ProductTypeOneTimeNonConsumable {
		t.Fatalf("non-consumable normalization = %#v include=%t err=%v", normalized, include, err)
	}

	consumable := true
	product.OneTime.IsConsumable = &consumable
	normalized, include, err = normalizeProduct(product)
	if err != nil || include || normalized.ID != "" {
		t.Fatalf("consumable normalization = %#v include=%t err=%v", normalized, include, err)
	}
}

func TestFetchCatalogRejectsOneTimeProductWithoutConsumableDiscriminator(t *testing.T) {
	client, err := New(Config{
		BaseURL: "https://revenuecat.invalid/v2", RequestTimeout: time.Second,
		OperationTimeout: time.Second, ConnectTimeout: time.Second, MaxAttempts: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	client.httpClient.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		if calls.Add(1) == 1 {
			return jsonResponse(http.StatusOK, `{"items":[]}`, nil), nil
		}
		return jsonResponse(http.StatusOK, `{"items":[{
			"id":"prod_1","app_id":"app_1","store_identifier":"coins",
			"display_name":"Coins","type":"one_time","state":"active","one_time":{}
		}]}`, nil), nil
	})

	_, err = client.FetchCatalog(context.Background(), providercatalog.Credential{
		Secret: []byte("sk_test"), ExternalProjectID: "proj_1",
	})
	var providerError *providercatalog.Error
	if !errors.As(err, &providerError) || providerError.Code != providercatalog.ErrorInvalidResponse {
		t.Fatalf("operation error = %#v", err)
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("round trips = %d, want failure while normalizing Products", got)
	}
}

func TestFetchCatalogOperationDeadlineBoundsMultipleRoundTrips(t *testing.T) {
	client, err := New(Config{
		BaseURL: "https://revenuecat.invalid/v2", RequestTimeout: 30 * time.Millisecond,
		OperationTimeout: 40 * time.Millisecond, ConnectTimeout: time.Second, MaxAttempts: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	client.httpClient.Transport = roundTripFunc(func(request *http.Request) (*http.Response, error) {
		calls.Add(1)
		select {
		case <-time.After(25 * time.Millisecond):
			return jsonResponse(http.StatusOK, `{"items":[]}`, nil), nil
		case <-request.Context().Done():
			return nil, request.Context().Err()
		}
	})

	startedAt := time.Now()
	_, err = client.FetchCatalog(context.Background(), providercatalog.Credential{
		Secret: []byte("sk_test"), ExternalProjectID: "proj_1",
	})
	var providerError *providercatalog.Error
	if !errors.As(err, &providerError) || providerError.Code != providercatalog.ErrorTimeout {
		t.Fatalf("operation error = %#v", err)
	}
	if elapsed := time.Since(startedAt); elapsed > 250*time.Millisecond {
		t.Fatalf("catalog operation exceeded deadline guard: %s", elapsed)
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("round trips = %d, want 2 before aggregate deadline", got)
	}
}

func TestFetchCatalogCapsRetryAfterAndTotalRetries(t *testing.T) {
	client, err := New(Config{
		BaseURL: "https://revenuecat.invalid/v2", RequestTimeout: time.Second,
		ConnectTimeout: time.Second, MaxAttempts: 5,
	})
	if err != nil {
		t.Fatal(err)
	}
	client.maxRetryWait = time.Millisecond
	client.maxRetries = 1
	var calls atomic.Int32
	client.httpClient.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		calls.Add(1)
		header := make(http.Header)
		header.Set("Retry-After", "3600")
		return jsonResponse(http.StatusTooManyRequests, `{}`, header), nil
	})

	_, err = client.FetchCatalog(context.Background(), providercatalog.Credential{
		Secret: []byte("sk_test"), ExternalProjectID: "proj_1",
	})
	var providerError *providercatalog.Error
	if !errors.As(err, &providerError) || providerError.Code != providercatalog.ErrorRateLimited {
		t.Fatalf("operation error = %#v", err)
	}
	if providerError.RetryAfter != time.Millisecond {
		t.Fatalf("retry after = %s, want capped %s", providerError.RetryAfter, time.Millisecond)
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("round trips = %d, want initial request plus one budgeted retry", got)
	}
}

func TestFetchCatalogCapsRetryWaitToRemainingOperationTime(t *testing.T) {
	client, err := New(Config{
		BaseURL: "https://revenuecat.invalid/v2", RequestTimeout: 10 * time.Millisecond,
		OperationTimeout: 30 * time.Millisecond, ConnectTimeout: time.Second, MaxAttempts: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	client.httpClient.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		calls.Add(1)
		header := make(http.Header)
		header.Set("Retry-After", "3600")
		return jsonResponse(http.StatusTooManyRequests, `{}`, header), nil
	})

	startedAt := time.Now()
	_, err = client.FetchCatalog(context.Background(), providercatalog.Credential{
		Secret: []byte("sk_test"), ExternalProjectID: "proj_1",
	})
	var providerError *providercatalog.Error
	if !errors.As(err, &providerError) || providerError.Code != providercatalog.ErrorTimeout {
		t.Fatalf("operation error = %#v", err)
	}
	if elapsed := time.Since(startedAt); elapsed > 250*time.Millisecond {
		t.Fatalf("Retry-After wait exceeded operation budget: %s", elapsed)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("round trips = %d, want deadline before retry", got)
	}
}

func TestFetchCatalogCapsPaginationAcrossCollections(t *testing.T) {
	client, err := New(Config{
		BaseURL: "https://revenuecat.invalid/v2", RequestTimeout: time.Second,
		ConnectTimeout: time.Second, MaxAttempts: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	client.maxPages = 2
	var calls atomic.Int32
	client.httpClient.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		call := calls.Add(1)
		body := `{"items":[],"next_page":"https://untrusted.invalid/v2/apps?starting_after=cursor_` +
			strconv.FormatInt(int64(call), 10) + `"}`
		return jsonResponse(http.StatusOK, body, nil), nil
	})

	_, err = client.FetchCatalog(context.Background(), providercatalog.Credential{
		Secret: []byte("sk_test"), ExternalProjectID: "proj_1",
	})
	var providerError *providercatalog.Error
	if !errors.As(err, &providerError) || providerError.Code != providercatalog.ErrorInvalidResponse {
		t.Fatalf("operation error = %#v", err)
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("round trips = %d, want shared page budget of 2", got)
	}
}

func TestFetchCatalogPropagatesCallerCancellationBetweenCollections(t *testing.T) {
	client, err := New(Config{
		BaseURL: "https://revenuecat.invalid/v2", RequestTimeout: time.Second,
		ConnectTimeout: time.Second, MaxAttempts: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	secondRequestStarted := make(chan struct{})
	var calls atomic.Int32
	client.httpClient.Transport = roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if calls.Add(1) == 1 {
			return jsonResponse(http.StatusOK, `{"items":[]}`, nil), nil
		}
		close(secondRequestStarted)
		<-request.Context().Done()
		return nil, request.Context().Err()
	})
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, fetchErr := client.FetchCatalog(ctx, providercatalog.Credential{
			Secret: []byte("sk_test"), ExternalProjectID: "proj_1",
		})
		result <- fetchErr
	}()

	select {
	case <-secondRequestStarted:
	case <-time.After(time.Second):
		t.Fatal("second catalog collection did not start")
	}
	cancel()
	select {
	case err = <-result:
	case <-time.After(time.Second):
		t.Fatal("catalog fetch did not stop after caller cancellation")
	}
	var providerError *providercatalog.Error
	if !errors.As(err, &providerError) || providerError.Code != providercatalog.ErrorTimeout {
		t.Fatalf("operation error = %#v", err)
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("round trips = %d, want cancellation during second collection", got)
	}
}
