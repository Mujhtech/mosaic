package googleplay

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

const (
	DefaultPlayBaseURL   = "https://androidpublisher.googleapis.com"
	DefaultPubSubBaseURL = "https://pubsub.googleapis.com"
	defaultBodyLimit     = int64(2 << 20)
)

type Config struct {
	PlayBaseURL      string
	PubSubBaseURL    string
	RequestTimeout   time.Duration
	ConnectTimeout   time.Duration
	MaxResponseBytes int64
}

type Client struct {
	play             *url.URL
	pubsub           *url.URL
	httpClient       *http.Client
	maxResponseBytes int64
	tokens           *tokenCache
	tracer           trace.Tracer
	now              func() time.Time
}

func New(config Config) (*Client, error) {
	play, err := parseBase(config.PlayBaseURL, DefaultPlayBaseURL)
	if err != nil {
		return nil, err
	}
	pubsub, err := parseBase(config.PubSubBaseURL, DefaultPubSubBaseURL)
	if err != nil {
		return nil, err
	}
	if config.RequestTimeout <= 0 {
		config.RequestTimeout = 8 * time.Second
	}
	if config.ConnectTimeout <= 0 {
		config.ConnectTimeout = 3 * time.Second
	}
	if config.MaxResponseBytes <= 0 {
		config.MaxResponseBytes = defaultBodyLimit
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = (&net.Dialer{Timeout: config.ConnectTimeout, KeepAlive: 30 * time.Second}).DialContext
	transport.ResponseHeaderTimeout = config.RequestTimeout
	transport.TLSHandshakeTimeout = config.ConnectTimeout
	return &Client{
		play:   play,
		pubsub: pubsub,
		httpClient: &http.Client{
			Transport:     transport,
			Timeout:       config.RequestTimeout,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		maxResponseBytes: config.MaxResponseBytes,
		tokens:           newTokenCache(),
		tracer:           otel.Tracer("github.com/Mujhtech/mosaic/apps/api/googleplay"),
		now:              func() time.Time { return time.Now().UTC() },
	}, nil
}

func parseBase(value, fallback string) (*url.URL, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(value), "/")
	if trimmed == "" {
		trimmed = fallback
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" || parsed.User != nil ||
		(parsed.Scheme != "https" && parsed.Scheme != "http") {
		return nil, fmt.Errorf("Google base URL %q must be an absolute HTTP(S) URL without credentials", value)
	}
	return parsed, nil
}

// Error is a classified Google failure. Like the Apple client it carries a
// status and a machine code but never a response body.
type Error struct {
	HTTPStatus int
	GoogleCode string
	RetryAfter time.Duration
	Op         string
	cause      error
}

func (e *Error) Error() string {
	if e.GoogleCode != "" {
		return fmt.Sprintf("Google %s failed with status %d (code %s)", e.Op, e.HTTPStatus, e.GoogleCode)
	}
	return fmt.Sprintf("Google %s failed with status %d", e.Op, e.HTTPStatus)
}

func (e *Error) Unwrap() error { return e.cause }

// safeCode bounds a provider-supplied status string to the charset the
// provider_code column accepts, so a hostile or malformed value can never
// become a persistence failure or a log-injection vector.
func safeCode(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	if len(trimmed) > 128 {
		trimmed = trimmed[:128]
	}
	for _, r := range trimmed {
		if !(r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '_' || r == '.' || r == '-') {
			return "unclassified"
		}
	}
	return trimmed
}

// ParseRetryAfter reads an RFC 7231 Retry-After (delta-seconds or HTTP-date).
// Google follows the standard; Apple does not, which is exactly why the two
// parsers live in two packages and are never interchanged.
func ParseRetryAfter(header string, now time.Time) (time.Duration, bool) {
	trimmed := strings.TrimSpace(header)
	if trimmed == "" {
		return 0, false
	}
	if seconds, err := strconv.Atoi(trimmed); err == nil {
		if seconds <= 0 || seconds > 86400 {
			return 0, false
		}
		return time.Duration(seconds) * time.Second, true
	}
	if when, err := http.ParseTime(trimmed); err == nil {
		delta := when.Sub(now)
		if delta <= 0 || delta > 24*time.Hour {
			return 0, false
		}
		return delta, true
	}
	return 0, false
}

// SubscriptionPurchase is the subset of SubscriptionPurchaseV2 Phase 9A reads.
// externalAccountIdentifiers, subscribeWithGoogleInfo, and every other
// customer-identifying member are deliberately not decoded.
type SubscriptionPurchase struct {
	Kind                 string          `json:"kind"`
	RegionCode           string          `json:"regionCode"`
	StartTime            string          `json:"startTime"`
	SubscriptionState    string          `json:"subscriptionState"`
	LatestOrderID        string          `json:"latestOrderId"`
	LinkedPurchaseToken  string          `json:"linkedPurchaseToken"`
	AcknowledgementState string          `json:"acknowledgementState"`
	TestPurchase         *struct{}       `json:"testPurchase"`
	CanceledStateContext json.RawMessage `json:"canceledStateContext"`
	PausedStateContext   json.RawMessage `json:"pausedStateContext"`
	LineItems            []struct {
		ProductID    string `json:"productId"`
		ExpiryTime   string `json:"expiryTime"`
		OfferDetails *struct {
			BasePlanID string   `json:"basePlanId"`
			OfferID    string   `json:"offerId"`
			OfferTags  []string `json:"offerTags"`
		} `json:"offerDetails"`
		AutoRenewingPlan *struct {
			AutoRenewEnabled bool `json:"autoRenewEnabled"`
		} `json:"autoRenewingPlan"`
		PrepaidPlan json.RawMessage `json:"prepaidPlan"`
	} `json:"lineItems"`
}

// GetSubscription performs purchases.subscriptionsv2.get. It is a pure read;
// no acknowledgement follows it.
func (c *Client) GetSubscription(ctx context.Context, account *ServiceAccount, packageName, purchaseToken string) (SubscriptionPurchase, error) {
	var purchase SubscriptionPurchase
	path := fmt.Sprintf("/androidpublisher/v3/applications/%s/purchases/subscriptionsv2/tokens/%s",
		url.PathEscape(packageName), url.PathEscape(purchaseToken))
	err := c.call(ctx, account, http.MethodGet, c.play, path, nil, &purchase, "subscription_get", ScopeAndroidPublisher)
	return purchase, err
}

// ProductPurchase is the subset of ProductPurchase Phase 9A reads.
type ProductPurchase struct {
	Kind                 string `json:"kind"`
	PurchaseTimeMillis   string `json:"purchaseTimeMillis"`
	PurchaseState        int    `json:"purchaseState"`
	ConsumptionState     int    `json:"consumptionState"`
	AcknowledgementState int    `json:"acknowledgementState"`
	PurchaseType         *int   `json:"purchaseType"`
	OrderID              string `json:"orderId"`
	ProductID            string `json:"productId"`
	Quantity             int    `json:"quantity"`
	RegionCode           string `json:"regionCode"`
}

// GetProduct performs purchases.products.get.
func (c *Client) GetProduct(ctx context.Context, account *ServiceAccount, packageName, productID, purchaseToken string) (ProductPurchase, error) {
	var purchase ProductPurchase
	path := fmt.Sprintf("/androidpublisher/v3/applications/%s/purchases/products/%s/tokens/%s",
		url.PathEscape(packageName), url.PathEscape(productID), url.PathEscape(purchaseToken))
	err := c.call(ctx, account, http.MethodGet, c.play, path, nil, &purchase, "product_get", ScopeAndroidPublisher)
	return purchase, err
}

// Order is the subset of the orders resource Phase 9A reads. The resource
// exists in this client for exactly one reason: it returns the full
// purchaseToken for an orderId, which is what makes a client observation that
// carries only an order ID actionable server-side.
type Order struct {
	OrderID       string `json:"orderId"`
	PurchaseToken string `json:"purchaseToken"`
	State         string `json:"state"`
	LineItems     []struct {
		ProductID string `json:"productId"`
	} `json:"lineItems"`
}

// GetOrder performs orders.get.
func (c *Client) GetOrder(ctx context.Context, account *ServiceAccount, packageName, orderID string) (Order, error) {
	var order Order
	path := fmt.Sprintf("/androidpublisher/v3/applications/%s/orders/%s",
		url.PathEscape(packageName), url.PathEscape(orderID))
	err := c.call(ctx, account, http.MethodGet, c.play, path, nil, &order, "order_get", ScopeAndroidPublisher)
	return order, err
}

// ReceivedMessage is one Pub/Sub message from a pull response.
type ReceivedMessage struct {
	AckID   string
	Message PubSubMessage
}

// PubSubMessage is the Pub/Sub envelope. `data` is base64 in transit.
type PubSubMessage struct {
	Data        string            `json:"data"`
	MessageID   string            `json:"messageId"`
	PublishTime string            `json:"publishTime"`
	Attributes  map[string]string `json:"attributes"`
}

// Pull consumes up to maxMessages from an RTDN subscription.
//
// Google's RTDN transport is a pull subscription rather than a push endpoint by
// owner decision: a push subscription would require Mosaic to expose a second
// public unauthenticated endpoint and to verify Google's OIDC tokens, and a
// misconfigured push subscription produces an unbounded retry loop against that
// endpoint. Pulling inverts the control: the worker asks for work when it is
// ready, using the same service-account credential it already holds.
func (c *Client) Pull(ctx context.Context, account *ServiceAccount, projectID, subscriptionID string, maxMessages int) ([]ReceivedMessage, error) {
	if maxMessages <= 0 || maxMessages > 100 {
		maxMessages = 25
	}
	body, err := json.Marshal(map[string]any{"maxMessages": maxMessages})
	if err != nil {
		return nil, err
	}
	var response struct {
		ReceivedMessages []struct {
			AckID   string        `json:"ackId"`
			Message PubSubMessage `json:"message"`
		} `json:"receivedMessages"`
	}
	path := fmt.Sprintf("/v1/projects/%s/subscriptions/%s:pull",
		url.PathEscape(projectID), url.PathEscape(subscriptionID))
	if err := c.call(ctx, account, http.MethodPost, c.pubsub, path, body, &response, "pubsub_pull", ScopePubSub); err != nil {
		return nil, err
	}
	messages := make([]ReceivedMessage, 0, len(response.ReceivedMessages))
	for _, received := range response.ReceivedMessages {
		messages = append(messages, ReceivedMessage{AckID: received.AckID, Message: received.Message})
	}
	return messages, nil
}

// Acknowledge confirms delivery of pulled messages. It is called only after the
// Raw Billing Input is durably committed, so a crash between pull and commit
// causes redelivery rather than data loss; the idempotency key makes the
// redelivery a no-op.
func (c *Client) Acknowledge(ctx context.Context, account *ServiceAccount, projectID, subscriptionID string, ackIDs []string) error {
	if len(ackIDs) == 0 {
		return nil
	}
	body, err := json.Marshal(map[string]any{"ackIds": ackIDs})
	if err != nil {
		return err
	}
	path := fmt.Sprintf("/v1/projects/%s/subscriptions/%s:acknowledge",
		url.PathEscape(projectID), url.PathEscape(subscriptionID))
	return c.call(ctx, account, http.MethodPost, c.pubsub, path, body, nil, "pubsub_acknowledge", ScopePubSub)
}

// DeveloperNotification is the decoded RTDN payload. It is a trigger only:
// Google's own documentation states an RTDN signals that state changed and that
// the authoritative state must be read from the Developer API, so nothing in
// this structure is ever normalized into a Transaction Fact directly.
type DeveloperNotification struct {
	Version                  string `json:"version"`
	PackageName              string `json:"packageName"`
	EventTimeMillis          string `json:"eventTimeMillis"`
	SubscriptionNotification *struct {
		Version          string `json:"version"`
		NotificationType int    `json:"notificationType"`
		PurchaseToken    string `json:"purchaseToken"`
		SubscriptionID   string `json:"subscriptionId"`
	} `json:"subscriptionNotification"`
	OneTimeProductNotification *struct {
		Version          string `json:"version"`
		NotificationType int    `json:"notificationType"`
		PurchaseToken    string `json:"purchaseToken"`
		SKU              string `json:"sku"`
	} `json:"oneTimeProductNotification"`
	VoidedPurchaseNotification *struct {
		PurchaseToken string `json:"purchaseToken"`
		OrderID       string `json:"orderId"`
		ProductType   int    `json:"productType"`
		RefundType    int    `json:"refundType"`
	} `json:"voidedPurchaseNotification"`
	TestNotification *struct {
		Version string `json:"version"`
	} `json:"testNotification"`
}

// DecodeNotification base64-decodes and parses a Pub/Sub message body.
//
// The envelope is "validated" in the only sense available: Pub/Sub itself is
// the authenticated channel (the pull was made with Mosaic's own service-account
// credential over TLS), and the decoded content must be a well-formed
// DeveloperNotification naming exactly one event. Content that does not satisfy
// that is not a notification Mosaic can attribute and is rejected before any
// tenant is touched.
func DecodeNotification(message PubSubMessage) (DeveloperNotification, []byte, error) {
	if strings.TrimSpace(message.MessageID) == "" {
		return DeveloperNotification{}, nil, errors.New("Pub/Sub message carried no message id")
	}
	raw, err := base64.StdEncoding.DecodeString(message.Data)
	if err != nil {
		return DeveloperNotification{}, nil, errors.New("Pub/Sub message data was not base64")
	}
	var notification DeveloperNotification
	if err := json.Unmarshal(raw, &notification); err != nil {
		return DeveloperNotification{}, nil, errors.New("Pub/Sub message data was not a developer notification")
	}
	if strings.TrimSpace(notification.PackageName) == "" {
		return DeveloperNotification{}, nil, errors.New("developer notification carried no package name")
	}
	present := 0
	for _, set := range []bool{
		notification.SubscriptionNotification != nil,
		notification.OneTimeProductNotification != nil,
		notification.VoidedPurchaseNotification != nil,
		notification.TestNotification != nil,
	} {
		if set {
			present++
		}
	}
	if present != 1 {
		return DeveloperNotification{}, nil, errors.New("developer notification did not carry exactly one event")
	}
	return notification, raw, nil
}

func (c *Client) call(ctx context.Context, account *ServiceAccount, method string, base *url.URL, path string, body []byte, out any, operation string, scopes ...string) error {
	ctx, span := c.tracer.Start(ctx, "billing.provider.google."+operation, trace.WithAttributes(
		attribute.String("mosaic.billing.provider", "google_play"),
	))
	defer span.End()

	token, err := c.accessToken(ctx, account, scopes...)
	if err != nil {
		span.SetStatus(codes.Error, "credential_unusable")
		return err
	}

	endpoint := *base
	target, err := url.Parse(path)
	if err != nil {
		return &Error{Op: operation, cause: err}
	}
	endpoint.Path += target.Path
	endpoint.RawQuery = target.RawQuery

	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint.String(), reader)
	if err != nil {
		return &Error{Op: operation, cause: err}
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}

	var envelope struct {
		Error struct {
			Code    int    `json:"code"`
			Status  string `json:"status"`
			Message string `json:"message"`
		} `json:"error"`
	}
	raw, status, header, err := c.executeRaw(ctx, request)
	if err != nil {
		span.SetStatus(codes.Error, "transport_failure")
		return &Error{Op: operation, cause: err}
	}
	span.SetAttributes(attribute.Int("http.response.status_code", status))
	if status < 200 || status > 299 {
		apiError := &Error{HTTPStatus: status, Op: operation}
		if json.Unmarshal(raw, &envelope) == nil {
			apiError.GoogleCode = safeCode(envelope.Error.Status)
		}
		if retryAfter, ok := ParseRetryAfter(header.Get("Retry-After"), c.now()); ok {
			apiError.RetryAfter = retryAfter
		}
		span.SetStatus(codes.Error, "provider_error")
		span.SetAttributes(attribute.String("mosaic.billing.provider_code", apiError.GoogleCode))
		return apiError
	}
	if out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			return &Error{HTTPStatus: status, Op: operation, cause: errors.New("provider response was not valid JSON")}
		}
	}
	return nil
}

func (c *Client) execute(ctx context.Context, request *http.Request, out any) (int, error) {
	raw, status, _, err := c.executeRaw(ctx, request)
	if err != nil {
		return 0, err
	}
	if out != nil && len(raw) > 0 {
		_ = json.Unmarshal(raw, out)
	}
	return status, nil
}

func (c *Client) executeRaw(ctx context.Context, request *http.Request) ([]byte, int, http.Header, error) {
	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, 0, nil, err
	}
	defer func() {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, c.maxResponseBytes))
		_ = response.Body.Close()
	}()
	payload, err := io.ReadAll(io.LimitReader(response.Body, c.maxResponseBytes))
	if err != nil {
		return nil, response.StatusCode, response.Header, err
	}
	_ = ctx
	return payload, response.StatusCode, response.Header, nil
}
