package appstoreconnect

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math/rand/v2"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/appstoreserver"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/ratelimit"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercatalog"
)

const (
	// DefaultBaseURL is the only host Apple publishes for the App Store Connect
	// API. It is configurable so tests can point at httptest.
	DefaultBaseURL = "https://api.appstoreconnect.apple.com"

	defaultBodyLimit    = int64(2 << 20)
	defaultMaxAttempts  = 3
	defaultOperationTTL = 60 * time.Second
	maxOperationTTL     = 5 * time.Minute
	// Apple caps `limit` at 200 for the collections this adapter reads.
	defaultPageLimit       = 200
	defaultMaxPages        = 200
	defaultMaxRetries      = 20
	defaultMaxRetryWait    = 5 * time.Second
	rateLimitCredentialKey = "app_store_connect:"

	// Apple's platform vocabulary is not Mosaic's. The catalog boundary already
	// uses RevenueCat's neutral store names, so an App Store application is
	// reported with the same identifier the import path matches on.
	platformAppStore = "app_store"

	// stateActive is the single normalized state the import path treats as
	// importable. Every other App Store Connect state is surfaced verbatim, in
	// lower case, so an operator can see why a product was not offered.
	stateActive = "active"

	// productTypeConsumable and productTypeNonRenewing are deliberately outside
	// providercatalog's importable vocabulary. Mosaic models neither, so they
	// are listed in the preview and refused by import rather than hidden.
	productTypeConsumable  = "one_time_consumable"
	productTypeNonRenewing = "non_renewing_subscription"
)

type Config struct {
	BaseURL          string
	RequestTimeout   time.Duration
	OperationTimeout time.Duration
	ConnectTimeout   time.Duration
	MaxResponseBytes int64
	MaxAttempts      int
}

type Client struct {
	baseURL          *url.URL
	httpClient       *http.Client
	maxResponseBytes int64
	maxAttempts      int
	operationTimeout time.Duration
	maxPages         int
	maxRetries       int
	maxRetryWait     time.Duration
	limiter          *ratelimit.Limiter
	now              func() time.Time
}

func New(config Config) (*Client, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(config.BaseURL), "/")
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme != "https" && parsed.Scheme != "http" || parsed.Host == "" || parsed.User != nil {
		return nil, errors.New("App Store Connect base URL must be an absolute HTTP(S) URL without credentials")
	}
	if config.RequestTimeout <= 0 {
		config.RequestTimeout = 8 * time.Second
	}
	if config.OperationTimeout <= 0 {
		config.OperationTimeout = defaultOperationTTL
	}
	if config.OperationTimeout > maxOperationTTL {
		return nil, errors.New("App Store Connect operation timeout must not exceed 5 minutes")
	}
	if config.OperationTimeout < config.RequestTimeout {
		return nil, errors.New("App Store Connect operation timeout must not be shorter than request timeout")
	}
	if config.ConnectTimeout <= 0 {
		config.ConnectTimeout = 3 * time.Second
	}
	if config.MaxResponseBytes <= 0 {
		config.MaxResponseBytes = defaultBodyLimit
	}
	if config.MaxAttempts <= 0 {
		config.MaxAttempts = defaultMaxAttempts
	}
	if config.MaxAttempts > 5 {
		return nil, errors.New("App Store Connect max attempts must not exceed 5")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = (&net.Dialer{
		Timeout:   config.ConnectTimeout,
		KeepAlive: 30 * time.Second,
	}).DialContext
	transport.ResponseHeaderTimeout = config.RequestTimeout
	transport.TLSHandshakeTimeout = config.ConnectTimeout
	// The default of 2 idle connections per host discards completed
	// connections as soon as more than two callers overlap, forcing fresh
	// TCP+TLS handshakes on a single-host client.
	transport.MaxIdleConnsPerHost = 16
	return &Client{
		baseURL: parsed,
		httpClient: &http.Client{
			Transport: transport,
			Timeout:   config.RequestTimeout,
			// A redirect would be an unauthenticated instruction to send a
			// signed Apple assertion somewhere else.
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		maxResponseBytes: config.MaxResponseBytes,
		maxAttempts:      config.MaxAttempts,
		operationTimeout: config.OperationTimeout,
		maxPages:         defaultMaxPages,
		maxRetries:       defaultMaxRetries,
		maxRetryWait:     defaultMaxRetryWait,
		// Apple documents roughly 3600 requests per hour per key. The limiter
		// keeps a large catalog import well inside that without relying on
		// 429, with one bucket per tenant credential because the limit Apple
		// enforces is per key.
		limiter: ratelimit.New(50, 10, 256),
		now:     func() time.Time { return time.Now().UTC() },
	}, nil
}

type resourceLinks struct {
	Next string `json:"next"`
}

type listResponse[T any] struct {
	Data  []T           `json:"data"`
	Links resourceLinks `json:"links"`
}

type appResource struct {
	ID         string `json:"id"`
	Attributes struct {
		Name     string `json:"name"`
		BundleID string `json:"bundleId"`
	} `json:"attributes"`
}

type inAppPurchaseResource struct {
	ID         string `json:"id"`
	Attributes struct {
		Name              string `json:"name"`
		ProductID         string `json:"productId"`
		InAppPurchaseType string `json:"inAppPurchaseType"`
		State             string `json:"state"`
	} `json:"attributes"`
}

type subscriptionGroupResource struct {
	ID         string `json:"id"`
	Attributes struct {
		ReferenceName string `json:"referenceName"`
	} `json:"attributes"`
}

type subscriptionResource struct {
	ID         string `json:"id"`
	Attributes struct {
		Name      string `json:"name"`
		ProductID string `json:"productId"`
		State     string `json:"state"`
	} `json:"attributes"`
}

// FetchCatalog reads the operator's App Store catalog.
//
// App Store Connect has no entitlement concept, so the returned catalog always
// carries an empty entitlement list. Subscription groups become Offerings so
// the existing preview shows the grouping an operator already recognizes.
func (c *Client) FetchCatalog(ctx context.Context, credential providercatalog.Credential) (providercatalog.Catalog, error) {
	ctx, span := otel.Tracer("github.com/Mujhtech/mosaic/apps/api/appstoreconnect").Start(
		ctx,
		"appstoreconnect.catalog.fetch",
		trace.WithAttributes(attribute.String("provider.system", "app_store_connect")),
	)
	defer span.End()
	parsed, err := ParseCredential(credential.Secret)
	if err != nil {
		return providercatalog.Catalog{}, &providercatalog.Error{Code: providercatalog.ErrorCredentialInvalid}
	}
	ctx, cancel := context.WithTimeout(ctx, c.operationTimeout)
	defer cancel()
	budget := operationBudget{remainingPages: c.maxPages, remainingRetries: c.maxRetries}

	apps, err := fetchPages[appResource](ctx, c, &budget, parsed, "/v1/apps", nil)
	if err != nil {
		return providercatalog.Catalog{}, err
	}
	result := providercatalog.Catalog{
		Apps:         make([]providercatalog.App, 0, len(apps)),
		Products:     make([]providercatalog.Product, 0, len(apps)),
		Entitlements: []providercatalog.Entitlement{},
		Offerings:    make([]providercatalog.Offering, 0),
		ObservedAt:   c.now(),
	}
	for _, app := range apps {
		result.Apps = append(result.Apps, providercatalog.App{
			ID: app.ID, Name: app.Attributes.Name,
			Platform: platformAppStore, Identifier: app.Attributes.BundleID,
		})
	}
	for _, app := range apps {
		purchases, err := fetchPages[inAppPurchaseResource](
			ctx, c, &budget, parsed, "/v1/apps/"+url.PathEscape(app.ID)+"/inAppPurchasesV2", nil,
		)
		if err != nil {
			return providercatalog.Catalog{}, err
		}
		for _, purchase := range purchases {
			result.Products = append(result.Products, providercatalog.Product{
				ID: purchase.ID, AppID: app.ID, StoreIdentifier: purchase.Attributes.ProductID,
				DisplayName: purchase.Attributes.Name,
				Type:        inAppPurchaseType(purchase.Attributes.InAppPurchaseType),
				State:       normalizeState(purchase.Attributes.State),
			})
		}
		groups, err := fetchPages[subscriptionGroupResource](
			ctx, c, &budget, parsed, "/v1/apps/"+url.PathEscape(app.ID)+"/subscriptionGroups", nil,
		)
		if err != nil {
			return providercatalog.Catalog{}, err
		}
		for _, group := range groups {
			subscriptions, err := fetchPages[subscriptionResource](
				ctx, c, &budget, parsed, "/v1/subscriptionGroups/"+url.PathEscape(group.ID)+"/subscriptions", nil,
			)
			if err != nil {
				return providercatalog.Catalog{}, err
			}
			productIDs := make([]string, 0, len(subscriptions))
			for _, subscription := range subscriptions {
				result.Products = append(result.Products, providercatalog.Product{
					ID: subscription.ID, AppID: app.ID, StoreIdentifier: subscription.Attributes.ProductID,
					DisplayName: subscription.Attributes.Name,
					Type:        providercatalog.ProductTypeSubscription,
					State:       normalizeState(subscription.Attributes.State),
				})
				productIDs = append(productIDs, subscription.ID)
			}
			// The group resource ID is used as the lookup key on both the
			// Offering and its Package. The reference name is operator-editable
			// and not unique, so it is display text only.
			result.Offerings = append(result.Offerings, providercatalog.Offering{
				ID: group.ID, LookupKey: group.ID, DisplayName: group.Attributes.ReferenceName,
				State: stateActive, IsCurrent: false,
				Packages: []providercatalog.Package{{
					ID: group.ID, LookupKey: group.ID,
					DisplayName: group.Attributes.ReferenceName, ProductIDs: productIDs,
				}},
			})
		}
	}
	if ctx.Err() != nil {
		return providercatalog.Catalog{}, timeoutError(ctx.Err())
	}
	return result, nil
}

// inAppPurchaseType maps Apple's in-app purchase kind onto Mosaic's Product
// vocabulary. Only a non-consumable is importable: Mosaic has no model for a
// consumable or a non-renewing subscription, and quietly importing one as a
// non-consumable would grant a permanent entitlement for a purchase that is
// not permanent.
func inAppPurchaseType(value string) string {
	switch value {
	case "NON_CONSUMABLE":
		return providercatalog.ProductTypeOneTimeNonConsumable
	case "CONSUMABLE":
		return productTypeConsumable
	case "NON_RENEWING_SUBSCRIPTION":
		return productTypeNonRenewing
	default:
		return strings.ToLower(strings.TrimSpace(value))
	}
}

// normalizeState maps Apple's product state onto the catalog boundary's state.
// Only APPROVED — approved for sale — becomes "active"; everything else is
// reported verbatim so the operator sees the real reason it is not offered.
func normalizeState(value string) string {
	if value == "APPROVED" {
		return stateActive
	}
	return strings.ToLower(strings.TrimSpace(value))
}

type operationBudget struct {
	remainingPages   int
	remainingRetries int
}

func (b *operationBudget) takePage() bool {
	if b.remainingPages <= 0 {
		return false
	}
	b.remainingPages--
	return true
}

func (b *operationBudget) takeRetry() bool {
	if b.remainingRetries <= 0 {
		return false
	}
	b.remainingRetries--
	return true
}

// fetchPages walks an App Store Connect collection. Apple returns the next page
// as an absolute URL in `links.next`; it is only followed when it names the
// configured host, so a compromised or spoofed response cannot redirect a
// signed Apple assertion to another origin.
func fetchPages[T any](ctx context.Context, client *Client, budget *operationBudget, credential Credential, path string, baseQuery url.Values) ([]T, error) {
	result := make([]T, 0)
	query := cloneValues(baseQuery)
	query.Set("limit", strconv.Itoa(defaultPageLimit))
	next := ""
	for {
		if ctx.Err() != nil {
			return nil, timeoutError(ctx.Err())
		}
		if !budget.takePage() {
			return nil, &providercatalog.Error{Code: providercatalog.ErrorInvalidResponse}
		}
		requestURL := *client.baseURL
		requestURL.Path = strings.TrimRight(client.baseURL.Path, "/") + path
		requestURL.RawQuery = query.Encode()
		if next != "" {
			parsed, err := url.Parse(next)
			if err != nil || parsed.Scheme != client.baseURL.Scheme || parsed.Host != client.baseURL.Host {
				return nil, &providercatalog.Error{Code: providercatalog.ErrorInvalidResponse}
			}
			requestURL = *parsed
		}
		var response listResponse[T]
		if err := client.get(ctx, budget, credential, requestURL, &response); err != nil {
			return nil, err
		}
		result = append(result, response.Data...)
		if response.Links.Next == "" {
			return result, nil
		}
		if response.Links.Next == next || response.Links.Next == requestURL.String() {
			// A next link that points at the page just read is a loop, not a
			// page. Refuse rather than spend the whole page budget on it.
			return nil, &providercatalog.Error{Code: providercatalog.ErrorInvalidResponse}
		}
		next = response.Links.Next
	}
}

func cloneValues(source url.Values) url.Values {
	result := make(url.Values, len(source))
	for key, values := range source {
		result[key] = append([]string(nil), values...)
	}
	return result
}

func (c *Client) get(ctx context.Context, budget *operationBudget, credential Credential, requestURL url.URL, target any) error {
	for attempt := 0; attempt < c.maxAttempts; attempt++ {
		if ctx.Err() != nil {
			return timeoutError(ctx.Err())
		}
		// Allow only debits a token when it admits the caller, so a denied
		// caller must re-acquire after waiting; proceeding after one sleep
		// would let every concurrently denied goroutine fire at once. The
		// bucket is keyed per credential because Apple's limit is per key: a
		// single shared bucket lets one tenant's catalog import starve every
		// other tenant on this instance.
		for {
			allowed, delay := c.limiter.Allow(rateLimitCredentialKey + credential.IssuerID + "/" + credential.KeyID)
			if allowed {
				break
			}
			if err := wait(ctx, delay); err != nil {
				return timeoutError(err)
			}
		}
		// A fresh assertion per attempt: a retry after a long backoff must not
		// present a token that expired while waiting.
		token, err := appstoreserver.SignJWT(
			credential.PrivateKey, credential.KeyID, credential.IssuerID, "", c.now(),
		)
		if err != nil {
			return &providercatalog.Error{Code: providercatalog.ErrorCredentialInvalid}
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL.String(), nil)
		if err != nil {
			return &providercatalog.Error{Code: providercatalog.ErrorInvalidResponse}
		}
		request.Header.Set("Accept", "application/json")
		request.Header.Set("Authorization", "Bearer "+token)
		response, err := c.httpClient.Do(request)
		if err != nil {
			if ctx.Err() != nil || isTimeout(err) {
				return timeoutError(err)
			}
			if attempt+1 < c.maxAttempts && budget.takeRetry() {
				delay := capRetryWait(ctx, backoff(attempt), c.maxRetryWait)
				if !retryFitsOperation(ctx, delay) {
					return timeoutError(context.DeadlineExceeded)
				}
				if err := wait(ctx, delay); err != nil {
					return timeoutError(err)
				}
				continue
			}
			return &providercatalog.Error{Code: providercatalog.ErrorProviderUnavailable, Retryable: true}
		}
		body, readErr := io.ReadAll(io.LimitReader(response.Body, c.maxResponseBytes+1))
		closeErr := response.Body.Close()
		if readErr != nil || closeErr != nil {
			return &providercatalog.Error{Code: providercatalog.ErrorProviderUnavailable, Retryable: true}
		}
		if int64(len(body)) > c.maxResponseBytes {
			return &providercatalog.Error{Code: providercatalog.ErrorInvalidResponse}
		}
		if response.StatusCode >= 200 && response.StatusCode < 300 {
			decoder := json.NewDecoder(bytes.NewReader(body))
			if err := decoder.Decode(target); err != nil {
				return &providercatalog.Error{Code: providercatalog.ErrorInvalidResponse}
			}
			if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
				return &providercatalog.Error{Code: providercatalog.ErrorInvalidResponse}
			}
			return nil
		}
		providerErr := classify(response.StatusCode, response.Header.Get("Retry-After"), c.now())
		providerErr.RetryAfter = capRetryWait(ctx, providerErr.RetryAfter, c.maxRetryWait)
		if providerErr.Retryable && attempt+1 < c.maxAttempts && budget.takeRetry() {
			delay := providerErr.RetryAfter
			if delay <= 0 {
				delay = backoff(attempt)
			}
			delay = capRetryWait(ctx, delay, c.maxRetryWait)
			if !retryFitsOperation(ctx, delay) {
				return timeoutError(context.DeadlineExceeded)
			}
			if err := wait(ctx, delay); err != nil {
				return timeoutError(err)
			}
			continue
		}
		return providerErr
	}
	return &providercatalog.Error{Code: providercatalog.ErrorProviderUnavailable, Retryable: true}
}

// classify turns an App Store Connect HTTP status into a catalog error.
//
// A status Apple has not documented for these endpoints is reported as an
// unavailable provider and stays retryable. Calling an unrecognized status
// permanent would quarantine a healthy connection on the first unfamiliar
// response Apple ever returns.
func classify(status int, retryAfter string, now time.Time) *providercatalog.Error {
	switch status {
	case http.StatusUnauthorized:
		return &providercatalog.Error{Code: providercatalog.ErrorCredentialInvalid}
	case http.StatusForbidden:
		return &providercatalog.Error{Code: providercatalog.ErrorPermissionDenied}
	case http.StatusTooManyRequests:
		return &providercatalog.Error{
			Code: providercatalog.ErrorRateLimited, Retryable: true,
			RetryAfter: parseRetryAfter(retryAfter, now),
		}
	case http.StatusBadRequest, http.StatusNotFound, http.StatusConflict, http.StatusUnprocessableEntity:
		return &providercatalog.Error{Code: providercatalog.ErrorInvalidResponse}
	default:
		return &providercatalog.Error{Code: providercatalog.ErrorProviderUnavailable, Retryable: true}
	}
}

// parseRetryAfter reads the RFC 7231 form. The App Store Connect API is not the
// App Store Server API: it does not send the absolute-milliseconds variant
// appstoreserver.ParseRetryAfter exists for, so that parser is deliberately not
// reused here.
func parseRetryAfter(value string, now time.Time) time.Duration {
	if seconds, err := strconv.Atoi(strings.TrimSpace(value)); err == nil && seconds >= 0 {
		return time.Duration(seconds) * time.Second
	}
	if at, err := http.ParseTime(value); err == nil && at.After(now) {
		return at.Sub(now)
	}
	return 0
}

func capRetryWait(ctx context.Context, value, maximum time.Duration) time.Duration {
	if maximum > 0 && value > maximum {
		value = maximum
	}
	if deadline, ok := ctx.Deadline(); ok {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return 0
		}
		if value > remaining {
			return remaining
		}
	}
	return value
}

func retryFitsOperation(ctx context.Context, delay time.Duration) bool {
	if delay < 0 {
		return false
	}
	deadline, ok := ctx.Deadline()
	return !ok || time.Now().Add(delay).Before(deadline)
}

func backoff(attempt int) time.Duration {
	base := 100 * time.Millisecond * time.Duration(1<<attempt)
	return base + time.Duration(rand.IntN(50))*time.Millisecond
}

func wait(ctx context.Context, duration time.Duration) error {
	if duration <= 0 {
		return nil
	}
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func isTimeout(err error) bool {
	var netError net.Error
	return errors.As(err, &netError) && netError.Timeout()
}

func timeoutError(error) error {
	return &providercatalog.Error{Code: providercatalog.ErrorTimeout, Retryable: true}
}

var _ providercatalog.Client = (*Client)(nil)
