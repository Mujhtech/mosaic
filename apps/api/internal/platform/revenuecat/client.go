// Package revenuecat implements the RevenueCat REST API v2 read-only catalog
// adapter behind Mosaic's provider-catalog application boundary.
package revenuecat

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

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/ratelimit"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercatalog"
)

const (
	DefaultBaseURL      = "https://api.revenuecat.com/v2"
	defaultBodyLimit    = int64(2 << 20)
	defaultMaxAttempts  = 3
	defaultOperationTTL = 60 * time.Second
	maxOperationTTL     = 5 * time.Minute
	defaultPageLimit    = 100
	defaultMaxPages     = 200
	defaultMaxRetries   = 20
	defaultMaxRetryWait = 5 * time.Second
	rateLimitDomainKey  = "project_configuration"
	authorizationPrefix = "Bearer "
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
		return nil, errors.New("RevenueCat base URL must be an absolute HTTP(S) URL without credentials")
	}
	if config.RequestTimeout <= 0 {
		config.RequestTimeout = 8 * time.Second
	}
	if config.OperationTimeout <= 0 {
		config.OperationTimeout = defaultOperationTTL
	}
	if config.OperationTimeout > maxOperationTTL {
		return nil, errors.New("RevenueCat operation timeout must not exceed 5 minutes")
	}
	if config.OperationTimeout < config.RequestTimeout {
		return nil, errors.New("RevenueCat operation timeout must not be shorter than request timeout")
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
		return nil, errors.New("RevenueCat max attempts must not exceed 5")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = (&net.Dialer{
		Timeout:   config.ConnectTimeout,
		KeepAlive: 30 * time.Second,
	}).DialContext
	transport.ResponseHeaderTimeout = config.RequestTimeout
	transport.TLSHandshakeTimeout = config.ConnectTimeout
	return &Client{
		baseURL: parsed,
		httpClient: &http.Client{
			Transport: transport,
			Timeout:   config.RequestTimeout,
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
		limiter:          ratelimit.New(60, 4, 1),
		now:              func() time.Time { return time.Now().UTC() },
	}, nil
}

type listResponse[T any] struct {
	Items    []T    `json:"items"`
	NextPage string `json:"next_page"`
}

// AssessMigration proves the separately consented key can perform the read-only
// RevenueCat v2 operations migration needs. RevenueCat has no permission-
// introspection endpoint, so capabilities are earned by successful
// representative reads rather than by trusting a caller-supplied list.
func (c *Client) AssessMigration(ctx context.Context, externalProjectID string, secret []byte) (billingmigration.CapabilityResult, error) {
	if externalProjectID == "" || len(secret) == 0 {
		return billingmigration.CapabilityResult{}, billingmigration.ErrInvalid
	}
	ctx, cancel := context.WithTimeout(ctx, c.operationTimeout)
	defer cancel()
	type assessmentCustomer struct {
		ID string `json:"id"`
	}
	var response listResponse[assessmentCustomer]
	budget := operationBudget{remainingPages: 4, remainingRetries: c.maxRetries}
	projectID := url.PathEscape(externalProjectID)
	customersPath := "/projects/" + projectID + "/customers"
	query := url.Values{"limit": {"1"}}
	err := c.get(ctx, &budget, secret, customersPath, query, &response)
	if err != nil {
		var providerError *providercatalog.Error
		if errors.As(err, &providerError) && (providerError.Code == providercatalog.ErrorCredentialInvalid || providerError.Code == providercatalog.ErrorPermissionDenied) {
			return billingmigration.CapabilityResult{}, billingmigration.ErrInvalid
		}
		return billingmigration.CapabilityResult{}, billingmigration.ErrUnavailable
	}
	capabilities := []string{"read_customers"}
	if len(response.Items) > 0 {
		customerID := response.Items[0].ID
		if customerID == "" || invalidSourceID(customerID) {
			return billingmigration.CapabilityResult{}, billingmigration.ErrUnavailable
		}
		if ok, err := c.assessReadProbe(ctx, &budget, secret, "/projects/"+projectID+"/customers/"+url.PathEscape(customerID)+"/subscriptions", nil); err != nil {
			return billingmigration.CapabilityResult{}, err
		} else if ok {
			capabilities = append(capabilities, "read_subscriptions")
		}
		if ok, err := c.assessReadProbe(ctx, &budget, secret, "/projects/"+projectID+"/customers/"+url.PathEscape(customerID)+"/aliases", nil); err != nil {
			return billingmigration.CapabilityResult{}, err
		} else if ok {
			capabilities = append(capabilities, "read_aliases")
		}
		cursor := customerID
		if response.NextPage != "" {
			next, err := opaqueCursor(response.NextPage)
			if err != nil || next == "" {
				return billingmigration.CapabilityResult{}, billingmigration.ErrUnavailable
			}
			cursor = next
		}
		deltaQuery := url.Values{"limit": {"1"}, "starting_after": {cursor}}
		if ok, err := c.assessReadProbe(ctx, &budget, secret, customersPath, deltaQuery); err != nil {
			return billingmigration.CapabilityResult{}, err
		} else if ok {
			capabilities = append(capabilities, "incremental_delta")
		}
	}
	return billingmigration.CapabilityResult{
		ProviderAPIVersion: billingmigration.ProviderAPIV2,
		Capabilities:       capabilities,
		AssessedAt:         c.now(),
	}, nil
}

func (c *Client) assessReadProbe(ctx context.Context, budget *operationBudget, secret []byte, path string, query url.Values) (bool, error) {
	var response listResponse[json.RawMessage]
	probeQuery := cloneValues(query)
	if probeQuery.Get("limit") == "" {
		probeQuery.Set("limit", "1")
	}
	if err := c.get(ctx, budget, secret, path, probeQuery, &response); err != nil {
		var providerError *providercatalog.Error
		if errors.As(err, &providerError) && (providerError.Code == providercatalog.ErrorCredentialInvalid || providerError.Code == providercatalog.ErrorPermissionDenied) {
			return false, nil
		}
		return false, billingmigration.ErrUnavailable
	}
	return true, nil
}

type appResponse struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	AppStore struct {
		BundleID string `json:"bundle_id"`
	} `json:"app_store"`
	PlayStore struct {
		PackageName string `json:"package_name"`
	} `json:"play_store"`
}

type productResponse struct {
	ID              string `json:"id"`
	AppID           string `json:"app_id"`
	StoreIdentifier string `json:"store_identifier"`
	DisplayName     string `json:"display_name"`
	Type            string `json:"type"`
	State           string `json:"state"`
	OneTime         *struct {
		IsConsumable *bool `json:"is_consumable"`
	} `json:"one_time"`
}

type entitlementResponse struct {
	ID          string `json:"id"`
	LookupKey   string `json:"lookup_key"`
	DisplayName string `json:"display_name"`
	State       string `json:"state"`
}

type offeringResponse struct {
	ID          string `json:"id"`
	LookupKey   string `json:"lookup_key"`
	DisplayName string `json:"display_name"`
	State       string `json:"state"`
	IsCurrent   bool   `json:"is_current"`
}

type packageResponse struct {
	ID          string `json:"id"`
	LookupKey   string `json:"lookup_key"`
	DisplayName string `json:"display_name"`
	Products    *struct {
		Items []struct {
			Product productResponse `json:"product"`
		} `json:"items"`
	} `json:"products"`
}

func (c *Client) FetchCatalog(ctx context.Context, credential providercatalog.Credential) (providercatalog.Catalog, error) {
	ctx, span := otel.Tracer("github.com/Mujhtech/mosaic/apps/api/revenuecat").Start(
		ctx,
		"revenuecat.catalog.fetch",
		trace.WithAttributes(attribute.String("provider.system", "revenuecat")),
	)
	defer span.End()
	if len(credential.Secret) == 0 || strings.TrimSpace(credential.ExternalProjectID) == "" {
		return providercatalog.Catalog{}, &providercatalog.Error{Code: providercatalog.ErrorCredentialInvalid}
	}
	ctx, cancel := context.WithTimeout(ctx, c.operationTimeout)
	defer cancel()
	budget := operationBudget{remainingPages: c.maxPages, remainingRetries: c.maxRetries}
	projectID := url.PathEscape(credential.ExternalProjectID)
	apps, err := fetchPages[appResponse](ctx, c, &budget, credential.Secret, "/projects/"+projectID+"/apps", nil)
	if err != nil {
		return providercatalog.Catalog{}, err
	}
	products, err := fetchPages[productResponse](ctx, c, &budget, credential.Secret, "/projects/"+projectID+"/products", nil)
	if err != nil {
		return providercatalog.Catalog{}, err
	}
	normalizedProducts := make([]providercatalog.Product, 0, len(products))
	supportedProductIDs := make(map[string]struct{}, len(products))
	for _, product := range products {
		normalized, include, err := normalizeProduct(product)
		if err != nil {
			return providercatalog.Catalog{}, err
		}
		if !include {
			continue
		}
		normalizedProducts = append(normalizedProducts, normalized)
		supportedProductIDs[normalized.ID] = struct{}{}
	}
	entitlements, err := fetchPages[entitlementResponse](ctx, c, &budget, credential.Secret, "/projects/"+projectID+"/entitlements", nil)
	if err != nil {
		return providercatalog.Catalog{}, err
	}
	offerings, err := fetchPages[offeringResponse](ctx, c, &budget, credential.Secret, "/projects/"+projectID+"/offerings", nil)
	if err != nil {
		return providercatalog.Catalog{}, err
	}
	result := providercatalog.Catalog{
		Apps:         make([]providercatalog.App, 0, len(apps)),
		Products:     normalizedProducts,
		Entitlements: make([]providercatalog.Entitlement, 0, len(entitlements)),
		Offerings:    make([]providercatalog.Offering, 0, len(offerings)),
		ObservedAt:   c.now(),
	}
	for _, app := range apps {
		identifier := app.AppStore.BundleID
		if app.Type == "play_store" {
			identifier = app.PlayStore.PackageName
		}
		result.Apps = append(result.Apps, providercatalog.App{
			ID: app.ID, Name: app.Name, Platform: app.Type, Identifier: identifier,
		})
	}
	for _, entitlement := range entitlements {
		result.Entitlements = append(result.Entitlements, providercatalog.Entitlement{
			ID: entitlement.ID, LookupKey: entitlement.LookupKey,
			DisplayName: entitlement.DisplayName, State: entitlement.State,
		})
	}
	for _, offering := range offerings {
		if ctx.Err() != nil {
			return providercatalog.Catalog{}, timeoutError(ctx.Err())
		}
		query := url.Values{"expand": {"items.product"}}
		packages, err := fetchPages[packageResponse](
			ctx, c, &budget, credential.Secret,
			"/projects/"+projectID+"/offerings/"+url.PathEscape(offering.ID)+"/packages",
			query,
		)
		if err != nil {
			return providercatalog.Catalog{}, err
		}
		normalized := providercatalog.Offering{
			ID: offering.ID, LookupKey: offering.LookupKey, DisplayName: offering.DisplayName,
			State: offering.State, IsCurrent: offering.IsCurrent,
			Packages: make([]providercatalog.Package, 0, len(packages)),
		}
		for _, providerPackage := range packages {
			productIDs := make([]string, 0)
			if providerPackage.Products != nil {
				for _, association := range providerPackage.Products.Items {
					if _, supported := supportedProductIDs[association.Product.ID]; supported {
						productIDs = append(productIDs, association.Product.ID)
					}
				}
			}
			normalized.Packages = append(normalized.Packages, providercatalog.Package{
				ID: providerPackage.ID, LookupKey: providerPackage.LookupKey,
				DisplayName: providerPackage.DisplayName, ProductIDs: productIDs,
			})
		}
		result.Offerings = append(result.Offerings, normalized)
	}
	if ctx.Err() != nil {
		return providercatalog.Catalog{}, timeoutError(ctx.Err())
	}
	return result, nil
}

func normalizeProduct(product productResponse) (providercatalog.Product, bool, error) {
	productType := ""
	switch product.Type {
	case providercatalog.ProductTypeSubscription:
		productType = providercatalog.ProductTypeSubscription
	case "one_time":
		if product.OneTime == nil || product.OneTime.IsConsumable == nil {
			return providercatalog.Product{}, false, &providercatalog.Error{Code: providercatalog.ErrorInvalidResponse}
		}
		if *product.OneTime.IsConsumable {
			return providercatalog.Product{}, false, nil
		}
		productType = providercatalog.ProductTypeOneTimeNonConsumable
	default:
		return providercatalog.Product{}, false, nil
	}
	return providercatalog.Product{
		ID: product.ID, AppID: product.AppID, StoreIdentifier: product.StoreIdentifier,
		DisplayName: product.DisplayName, Type: productType, State: product.State,
	}, true, nil
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

func fetchPages[T any](ctx context.Context, client *Client, budget *operationBudget, secret []byte, path string, baseQuery url.Values) ([]T, error) {
	result := make([]T, 0)
	cursor := ""
	for {
		if ctx.Err() != nil {
			return nil, timeoutError(ctx.Err())
		}
		if !budget.takePage() {
			return nil, &providercatalog.Error{Code: providercatalog.ErrorInvalidResponse}
		}
		query := cloneValues(baseQuery)
		query.Set("limit", strconv.Itoa(defaultPageLimit))
		if cursor != "" {
			query.Set("starting_after", cursor)
		}
		var response listResponse[T]
		if err := client.get(ctx, budget, secret, path, query, &response); err != nil {
			return nil, err
		}
		result = append(result, response.Items...)
		if response.NextPage == "" {
			return result, nil
		}
		next, err := url.Parse(response.NextPage)
		if err != nil {
			return nil, &providercatalog.Error{Code: providercatalog.ErrorInvalidResponse}
		}
		nextCursor := next.Query().Get("starting_after")
		if nextCursor == "" || nextCursor == cursor {
			return nil, &providercatalog.Error{Code: providercatalog.ErrorInvalidResponse}
		}
		cursor = nextCursor
	}
}

func cloneValues(source url.Values) url.Values {
	result := make(url.Values, len(source))
	for key, values := range source {
		result[key] = append([]string(nil), values...)
	}
	return result
}

func (c *Client) get(ctx context.Context, budget *operationBudget, secret []byte, path string, query url.Values, target any) error {
	for attempt := 0; attempt < c.maxAttempts; attempt++ {
		if ctx.Err() != nil {
			return timeoutError(ctx.Err())
		}
		if allowed, delay := c.limiter.Allow(rateLimitDomainKey); !allowed {
			if err := wait(ctx, delay); err != nil {
				return timeoutError(err)
			}
		}
		requestURL := *c.baseURL
		requestURL.Path = strings.TrimRight(c.baseURL.Path, "/") + path
		requestURL.RawQuery = query.Encode()
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL.String(), nil)
		if err != nil {
			return &providercatalog.Error{Code: providercatalog.ErrorInvalidResponse}
		}
		request.Header.Set("Accept", "application/json")
		request.Header.Set("Authorization", authorizationPrefix+string(secret))
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
		providerErr := classify(response.StatusCode, response.Header.Get("Retry-After"))
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

func classify(status int, retryAfter string) *providercatalog.Error {
	switch status {
	case http.StatusUnauthorized:
		return &providercatalog.Error{Code: providercatalog.ErrorCredentialInvalid}
	case http.StatusForbidden:
		return &providercatalog.Error{Code: providercatalog.ErrorPermissionDenied}
	case http.StatusTooManyRequests:
		return &providercatalog.Error{
			Code: providercatalog.ErrorRateLimited, Retryable: true,
			RetryAfter: parseRetryAfter(retryAfter, time.Now()),
		}
	case http.StatusInternalServerError, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return &providercatalog.Error{Code: providercatalog.ErrorProviderUnavailable, Retryable: true}
	default:
		return &providercatalog.Error{Code: providercatalog.ErrorInvalidResponse}
	}
}

func parseRetryAfter(value string, now time.Time) time.Duration {
	if seconds, err := strconv.Atoi(strings.TrimSpace(value)); err == nil && seconds >= 0 {
		return time.Duration(seconds) * time.Second
	}
	if at, err := http.ParseTime(value); err == nil && at.After(now) {
		return at.Sub(now)
	}
	return 0
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
