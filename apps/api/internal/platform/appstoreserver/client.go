// Package appstoreserver is Mosaic's read-only client for the App Store Server
// API (version 1.13).
//
// The client is deliberately read-only: it looks transactions and notification
// history up and never calls an endpoint that changes store state. Finish
// Transaction, Extend a Subscription Renewal Date, Set App Account Token, and
// Send Consumption Info are all absent by design, because every one of them is
// an act of granting or altering entitlement and Phase 9A grants nothing.
package appstoreserver

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
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
	// ProductionBaseURL and SandboxBaseURL are the hosts current Apple
	// documentation names. The legacy `*.itunes.apple.com` hosts are not used.
	ProductionBaseURL = "https://api.storekit.apple.com"
	SandboxBaseURL    = "https://api.storekit-sandbox.apple.com"

	// JWTAudience and JWTLifetime come from Apple's JWT requirements and are
	// shared by every Apple API Mosaic calls: the App Store Server API and the
	// App Store Connect API both require the same `aud`. Apple caps `exp` at
	// `iat + 3600s`; 20 minutes leaves generous room for clock skew while
	// keeping a leaked token short-lived.
	JWTAudience = "appstoreconnect-v1"
	JWTLifetime = 20 * time.Minute

	defaultBodyLimit = int64(2 << 20)
)

// Credential is the decrypted material for one Apple team. The private key is
// held only for the duration of a call; callers zero the source buffer.
type Credential struct {
	IssuerID   string
	KeyID      string
	PrivateKey *ecdsa.PrivateKey
	// BundleID scopes each request to one Application. Apple requires `bid` on
	// every JWT, so a Project with several Applications reuses one team key and
	// varies this per request.
	BundleID string
	// Sandbox selects the base URL. Apple decides the environment purely by
	// which host is called.
	Sandbox bool
}

// ParsePrivateKey reads an Apple In-App Purchase key (.p8, PKCS#8 EC P-256).
func ParsePrivateKey(pemBytes []byte) (*ecdsa.PrivateKey, error) {
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, errors.New("Apple private key is not PEM encoded")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, errors.New("Apple private key is not a PKCS#8 key")
	}
	key, ok := parsed.(*ecdsa.PrivateKey)
	if !ok {
		return nil, errors.New("Apple private key is not an EC key")
	}
	if key.Curve.Params().BitSize != 256 {
		return nil, errors.New("Apple private key is not a P-256 key")
	}
	return key, nil
}

type Config struct {
	ProductionBaseURL string
	SandboxBaseURL    string
	RequestTimeout    time.Duration
	ConnectTimeout    time.Duration
	MaxResponseBytes  int64
}

type Client struct {
	production       *url.URL
	sandbox          *url.URL
	httpClient       *http.Client
	maxResponseBytes int64
	tracer           trace.Tracer
	now              func() time.Time
}

func New(config Config) (*Client, error) {
	production, err := parseBase(config.ProductionBaseURL, ProductionBaseURL)
	if err != nil {
		return nil, err
	}
	sandbox, err := parseBase(config.SandboxBaseURL, SandboxBaseURL)
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
		production: production,
		sandbox:    sandbox,
		httpClient: &http.Client{
			Transport: transport,
			Timeout:   config.RequestTimeout,
			// Redirects are never followed: an upstream redirect would be an
			// unauthenticated instruction to send a signed JWT somewhere else.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		maxResponseBytes: config.MaxResponseBytes,
		tracer:           otel.Tracer("github.com/Mujhtech/mosaic/apps/api/appstoreserver"),
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
		return nil, fmt.Errorf("App Store Server base URL %q must be an absolute HTTP(S) URL without credentials", value)
	}
	return parsed, nil
}

// Error is a classified App Store Server API failure. It never carries a
// response body: only the HTTP status, Apple's numeric error code, and the
// retry instant Apple supplied.
type Error struct {
	HTTPStatus int
	// AppleCode is Apple's `errorCode` integer, rendered as a string so it can
	// be persisted in the safe-provider-code column without a numeric type.
	AppleCode string
	// RetryAt is the absolute instant Apple told us to retry at, if any.
	RetryAt time.Time
	Op      string
	cause   error
}

func (e *Error) Error() string {
	if e.AppleCode != "" {
		return fmt.Sprintf("App Store Server %s failed with status %d (code %s)", e.Op, e.HTTPStatus, e.AppleCode)
	}
	return fmt.Sprintf("App Store Server %s failed with status %d", e.Op, e.HTTPStatus)
}

func (e *Error) Unwrap() error { return e.cause }

// ParseRetryAfter interprets Apple's Retry-After header.
//
// Apple's App Store Server API documents Retry-After on 429 as an **absolute
// UNIX timestamp in milliseconds**, not the RFC 7231 delta-seconds every other
// API in this repository sends. Reusing the delta-seconds parser here would
// read a value like 1800000000000 as a delta and schedule the retry roughly
// fifty-seven thousand years out, which presents as a permanently stalled
// queue with no error. The two forms are therefore parsed by two separate
// functions and this one is never used for a non-Apple response.
//
// A value that is not a plausible absolute millisecond timestamp is treated as
// absent rather than guessed at, so the caller falls back to its own backoff.
func ParseRetryAfter(header string, now time.Time) (time.Time, bool) {
	trimmed := strings.TrimSpace(header)
	if trimmed == "" {
		return time.Time{}, false
	}
	millis, err := strconv.ParseInt(trimmed, 10, 64)
	if err != nil || millis <= 0 {
		return time.Time{}, false
	}
	retryAt := time.UnixMilli(millis).UTC()
	// Guard both ends. A value in the past is spent, and a value implausibly
	// far out is a misread rather than an instruction worth honouring.
	if !retryAt.After(now) || retryAt.After(now.Add(24*time.Hour)) {
		return time.Time{}, false
	}
	return retryAt, true
}

// TransactionInfo performs Get Transaction Info. The response carries a single
// signed transaction, which the caller verifies through appstorejws before
// trusting any field.
func (c *Client) TransactionInfo(ctx context.Context, credential Credential, transactionID string) (string, error) {
	var response struct {
		SignedTransactionInfo string `json:"signedTransactionInfo"`
	}
	// The `/inApps` path is case-sensitive per Apple's documentation.
	err := c.do(ctx, credential, http.MethodGet,
		"/inApps/v1/transactions/"+url.PathEscape(transactionID), nil, &response, "transaction_info")
	if err != nil {
		return "", err
	}
	if response.SignedTransactionInfo == "" {
		return "", &Error{HTTPStatus: http.StatusOK, Op: "transaction_info", cause: errors.New("response carried no signed transaction")}
	}
	return response.SignedTransactionInfo, nil
}

// HistoryPage is one page of Get Transaction History (v2).
type HistoryPage struct {
	Revision           string   `json:"revision"`
	HasMore            bool     `json:"hasMore"`
	BundleID           string   `json:"bundleId"`
	Environment        string   `json:"environment"`
	SignedTransactions []string `json:"signedTransactions"`
}

// TransactionHistory performs Get Transaction History. Apple returns at most
// twenty transactions per page and requires every subsequent call to repeat the
// original query parameters verbatim, so the caller passes the revision back
// unchanged.
func (c *Client) TransactionHistory(ctx context.Context, credential Credential, transactionID, revision string) (HistoryPage, error) {
	path := "/inApps/v2/history/" + url.PathEscape(transactionID)
	if revision != "" {
		path += "?revision=" + url.QueryEscape(revision)
	}
	var page HistoryPage
	if err := c.do(ctx, credential, http.MethodGet, path, nil, &page, "transaction_history"); err != nil {
		return HistoryPage{}, err
	}
	return page, nil
}

// NotificationHistoryRequest is the Get Notification History body. startDate and
// endDate are required by Apple and are milliseconds.
type NotificationHistoryRequest struct {
	StartDate     int64  `json:"startDate"`
	EndDate       int64  `json:"endDate"`
	OnlyFailures  bool   `json:"onlyFailures,omitempty"`
	TransactionID string `json:"transactionId,omitempty"`
}

// NotificationHistoryPage is one page of notification history. Each item
// carries the same signedPayload the live endpoint would have received, so
// recovered notifications rejoin the pipeline through the identical code path.
type NotificationHistoryPage struct {
	NotificationHistory []struct {
		SignedPayload string `json:"signedPayload"`
		SendAttempts  []struct {
			AttemptDate       int64  `json:"attemptDate"`
			SendAttemptResult string `json:"sendAttemptResult"`
		} `json:"sendAttempts"`
	} `json:"notificationHistory"`
	HasMore         bool   `json:"hasMore"`
	PaginationToken string `json:"paginationToken"`
}

// NotificationHistory performs Get Notification History. Apple retains 180 days
// of production history and 30 days of sandbox history, which bounds every
// reconciliation window Mosaic can ask for.
func (c *Client) NotificationHistory(ctx context.Context, credential Credential, request NotificationHistoryRequest, paginationToken string) (NotificationHistoryPage, error) {
	path := "/inApps/v1/notifications/history"
	if paginationToken != "" {
		path += "?paginationToken=" + url.QueryEscape(paginationToken)
	}
	body, err := json.Marshal(request)
	if err != nil {
		return NotificationHistoryPage{}, err
	}
	var page NotificationHistoryPage
	if err := c.do(ctx, credential, http.MethodPost, path, body, &page, "notification_history"); err != nil {
		return NotificationHistoryPage{}, err
	}
	return page, nil
}

func (c *Client) do(ctx context.Context, credential Credential, method, path string, body []byte, out any, operation string) error {
	base := c.production
	environment := "production"
	if credential.Sandbox {
		base = c.sandbox
		environment = "sandbox"
	}
	ctx, span := c.tracer.Start(ctx, "billing.provider.apple."+operation, trace.WithAttributes(
		attribute.String("mosaic.billing.provider", "app_store"),
		attribute.String("mosaic.billing.store_environment", environment),
	))
	defer span.End()

	token, err := c.signJWT(credential)
	if err != nil {
		span.SetStatus(codes.Error, "credential_unusable")
		return &Error{Op: operation, cause: err}
	}

	endpoint := *base
	target, err := url.Parse(path)
	if err != nil {
		return &Error{Op: operation, cause: err}
	}
	// url.Parse puts the decoded form in Path and the escaped form in RawPath.
	// Copying only Path and letting URL.String() re-encode silently drops the
	// escaping every url.PathEscape call above added, so a %2F would become a
	// real path separator. Both halves are carried so the escaping survives.
	endpoint.Path += target.Path
	endpoint.RawPath = escapedPath(base) + escapedPath(target)
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

	response, err := c.httpClient.Do(request)
	if err != nil {
		span.SetStatus(codes.Error, "transport_failure")
		// The transport error is wrapped but never surfaced to a response body:
		// it can name internal hosts and proxies.
		return &Error{Op: operation, cause: err}
	}
	defer func() {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, c.maxResponseBytes))
		_ = response.Body.Close()
	}()
	span.SetAttributes(attribute.Int("http.response.status_code", response.StatusCode))

	payload, err := io.ReadAll(io.LimitReader(response.Body, c.maxResponseBytes))
	if err != nil {
		return &Error{HTTPStatus: response.StatusCode, Op: operation, cause: err}
	}

	if response.StatusCode != http.StatusOK {
		apiError := &Error{HTTPStatus: response.StatusCode, Op: operation}
		var decoded struct {
			ErrorCode    int64  `json:"errorCode"`
			ErrorMessage string `json:"errorMessage"`
		}
		// The message is decoded only so it can be discarded deliberately:
		// Apple's errorMessage is free text and is never logged or persisted.
		if json.Unmarshal(payload, &decoded) == nil && decoded.ErrorCode != 0 {
			apiError.AppleCode = strconv.FormatInt(decoded.ErrorCode, 10)
		}
		if retryAt, ok := ParseRetryAfter(response.Header.Get("Retry-After"), c.now()); ok {
			apiError.RetryAt = retryAt
		}
		span.SetStatus(codes.Error, "provider_error")
		span.SetAttributes(attribute.String("mosaic.billing.provider_code", apiError.AppleCode))
		return apiError
	}
	if out != nil {
		if err := json.Unmarshal(payload, out); err != nil {
			return &Error{HTTPStatus: response.StatusCode, Op: operation, cause: errors.New("provider response was not valid JSON")}
		}
	}
	return nil
}

// signJWT mints a fresh ES256 assertion per request. Tokens are never cached:
// they are cheap to produce and a cached token outlives the credential
// revocation that should have invalidated it.
//
// The App Store Server API requires `bid` on every token, so an incomplete
// credential is rejected here rather than inside the shared signer.
func (c *Client) signJWT(credential Credential) (string, error) {
	if credential.BundleID == "" {
		return "", errors.New("Apple credential is incomplete")
	}
	return SignJWT(credential.PrivateKey, credential.KeyID, credential.IssuerID, credential.BundleID, c.now())
}

// SignJWT mints an ES256 assertion for an Apple API.
//
// bundleID becomes the `bid` claim. It is required by the App Store Server API
// and must be empty for App Store Connect API tokens: the App Store Connect API
// rejects a token that carries `bid`, so the claim is omitted rather than sent
// blank when no bundle identifier is supplied.
func SignJWT(key *ecdsa.PrivateKey, keyID, issuerID, bundleID string, issuedAt time.Time) (string, error) {
	if key == nil || issuerID == "" || keyID == "" {
		return "", errors.New("Apple credential is incomplete")
	}
	header, err := json.Marshal(map[string]string{"alg": "ES256", "kid": keyID, "typ": "JWT"})
	if err != nil {
		return "", err
	}
	claimSet := map[string]any{
		"iss": issuerID,
		"iat": issuedAt.Unix(),
		"exp": issuedAt.Add(JWTLifetime).Unix(),
		"aud": JWTAudience,
	}
	if bundleID != "" {
		claimSet["bid"] = bundleID
	}
	claims, err := json.Marshal(claimSet)
	if err != nil {
		return "", err
	}
	signingInput := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(claims)
	digest := sha256.Sum256([]byte(signingInput))
	r, s, err := ecdsa.Sign(rand.Reader, key, digest[:])
	if err != nil {
		return "", err
	}
	signature := make([]byte, 64)
	copyPadded(signature[:32], r)
	copyPadded(signature[32:], s)
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

func copyPadded(destination []byte, value *big.Int) {
	bytesValue := value.Bytes()
	copy(destination[len(destination)-len(bytesValue):], bytesValue)
}

// escapedPath returns the percent-encoded path of u, falling back to the
// decoded form when the two are identical (url.URL leaves RawPath empty then).
func escapedPath(u *url.URL) string {
	if u.RawPath != "" {
		return u.RawPath
	}
	return u.Path
}
