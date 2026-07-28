package billing

import (
	"context"
	"errors"
	"math/rand/v2"
	"net"
	"net/http"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/appstoreserver"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/googleplay"
)

// Failure categories. The split that matters is retryable versus permanent:
// retrying a permanent failure burns provider quota and never recovers, while
// dead-lettering a transient failure loses a real transaction.
const (
	CategoryTransient         = "transient"
	CategoryRateLimited       = "rate_limited"
	CategoryAuth              = "auth"
	CategoryQuota             = "quota"
	CategoryNotFoundRetryable = "not_found_retryable"
	CategoryNotFoundTerminal  = "not_found_terminal"
	CategoryInvalid           = "invalid"
	CategorySignature         = "signature"
	CategoryResolution        = "resolution"
	CategoryConfiguration     = "configuration"
)

// Classification is the retry decision for one failure.
type Classification struct {
	Category  string
	Retryable bool
	// RetryAt is an absolute instant the provider asked us to wait until. It
	// takes precedence over computed backoff when it is later.
	RetryAt time.Time
	// ProviderCode and HTTPStatus are the safe, bounded diagnostics persisted on
	// the Validation Attempt. No provider response body is ever kept.
	ProviderCode string
	HTTPStatus   int
	// Diagnostic is Mosaic's own stable code.
	Diagnostic string
}

// appleRetryableCodes are the Apple error codes documented as retryable. Apple
// names them explicitly, which is why they are enumerated rather than inferred
// from the status.
var appleRetryableCodes = map[string]string{
	"4040002": CategoryNotFoundRetryable, // AccountNotFoundRetryableError
	"4040004": CategoryNotFoundRetryable, // AppNotFoundRetryableError
	"5000001": CategoryTransient,         // GeneralInternalRetryableError
	"4040006": CategoryNotFoundRetryable, // OriginalTransactionIdNotFoundRetryableError
}

// Classify maps a provider failure onto a retry decision.
func Classify(err error, now time.Time) Classification {
	var appleErr *appstoreserver.Error
	if errors.As(err, &appleErr) {
		return classifyApple(appleErr, now)
	}
	var googleErr *googleplay.Error
	if errors.As(err, &googleErr) {
		return classifyGoogle(googleErr, now)
	}
	return classifyTransport(err)
}

func classifyApple(err *appstoreserver.Error, now time.Time) Classification {
	result := Classification{ProviderCode: err.AppleCode, HTTPStatus: err.HTTPStatus}
	if !err.RetryAt.IsZero() {
		result.RetryAt = err.RetryAt
	}
	if category, ok := appleRetryableCodes[err.AppleCode]; ok {
		result.Category, result.Retryable, result.Diagnostic = category, true, "apple_retryable_error"
		return result
	}
	switch {
	case err.HTTPStatus == http.StatusTooManyRequests:
		result.Category, result.Retryable, result.Diagnostic = CategoryRateLimited, true, "apple_rate_limited"
	case err.HTTPStatus == http.StatusUnauthorized:
		// One retry with a freshly minted assertion, then terminal: a JWT that
		// is still rejected after a fresh signing is a credential problem an
		// operator must fix, not a wait.
		result.Category, result.Retryable, result.Diagnostic = CategoryAuth, true, "apple_unauthorized"
	case err.HTTPStatus == http.StatusNotFound:
		result.Category, result.Retryable, result.Diagnostic = CategoryNotFoundTerminal, false, "apple_transaction_not_found"
	case err.HTTPStatus >= 500:
		result.Category, result.Retryable, result.Diagnostic = CategoryTransient, true, "apple_server_error"
	case err.HTTPStatus >= 400:
		result.Category, result.Retryable, result.Diagnostic = CategoryInvalid, false, "apple_request_rejected"
	case err.HTTPStatus == 0:
		return classifyTransport(err)
	default:
		result.Category, result.Retryable, result.Diagnostic = CategoryInvalid, false, "apple_unexpected_response"
	}
	return result
}

func classifyGoogle(err *googleplay.Error, now time.Time) Classification {
	result := Classification{ProviderCode: err.GoogleCode, HTTPStatus: err.HTTPStatus}
	if err.RetryAfter > 0 {
		result.RetryAt = now.Add(err.RetryAfter)
	}
	switch {
	case err.GoogleCode == "RESOURCE_EXHAUSTED" || err.HTTPStatus == http.StatusTooManyRequests:
		result.Category, result.Retryable, result.Diagnostic = CategoryQuota, true, "google_quota_exhausted"
	case err.GoogleCode == "invalid_grant" || err.GoogleCode == "unauthorized_client":
		// The service-account key is rejected outright. Retrying cannot fix it.
		result.Category, result.Retryable, result.Diagnostic = CategoryConfiguration, false, "google_credential_rejected"
	case err.HTTPStatus == http.StatusUnauthorized:
		result.Category, result.Retryable, result.Diagnostic = CategoryAuth, true, "google_unauthorized"
	case err.HTTPStatus == http.StatusForbidden:
		result.Category, result.Retryable, result.Diagnostic = CategoryConfiguration, false, "google_forbidden"
	case err.HTTPStatus == http.StatusNotFound:
		// Google 404s a token it does not know. That is terminal: the token will
		// not become known later.
		result.Category, result.Retryable, result.Diagnostic = CategoryNotFoundTerminal, false, "google_purchase_not_found"
	case err.HTTPStatus >= 500:
		result.Category, result.Retryable, result.Diagnostic = CategoryTransient, true, "google_server_error"
	case err.HTTPStatus >= 400:
		result.Category, result.Retryable, result.Diagnostic = CategoryInvalid, false, "google_request_rejected"
	case err.HTTPStatus == 0:
		return classifyTransport(err)
	default:
		result.Category, result.Retryable, result.Diagnostic = CategoryInvalid, false, "google_unexpected_response"
	}
	return result
}

// classifyTransport handles dial, TLS, and deadline failures, which carry no
// provider status at all.
func classifyTransport(err error) Classification {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return Classification{Category: CategoryTransient, Retryable: true, Diagnostic: "provider_timeout"}
	case errors.Is(err, context.Canceled):
		return Classification{Category: CategoryTransient, Retryable: true, Diagnostic: "provider_cancelled"}
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return Classification{Category: CategoryTransient, Retryable: true, Diagnostic: "provider_network_error"}
	}
	return Classification{Category: CategoryTransient, Retryable: true, Diagnostic: "provider_unreachable"}
}

// Permanent builds a non-retryable classification for a Mosaic-side decision
// such as an invalid signature or an unresolvable Product.
func Permanent(category, diagnostic string) Classification {
	return Classification{Category: category, Retryable: false, Diagnostic: diagnostic}
}

const (
	backoffBase = 15 * time.Second
	backoffCap  = 10 * time.Minute
	// MaxValidationAttempts bounds a single input's validation. Eight attempts
	// across the backoff schedule below spans roughly forty minutes, which
	// comfortably outlasts a provider incident without holding a queue slot for
	// days.
	MaxValidationAttempts = 8
)

// NextAttemptAt computes when a retry becomes available.
//
// Jitter is applied because every notification for a popular application
// arrives in the same instant; without it, a provider outage would produce a
// synchronized retry burst at each backoff step and turn a recoverable incident
// into a self-inflicted rate limit.
func NextAttemptAt(now time.Time, attempt int, classification Classification, random *rand.Rand) time.Time {
	shift := attempt
	if shift < 0 {
		shift = 0
	}
	if shift > 6 {
		shift = 6
	}
	delay := backoffBase << shift
	if delay > backoffCap {
		delay = backoffCap
	}
	factor := 1.0
	if random != nil {
		factor = 1 + (random.Float64()*2-1)*0.25
	}
	scheduled := now.Add(time.Duration(float64(delay) * factor))
	// A provider instruction always wins when it asks for a longer wait. It is
	// never allowed to shorten the wait: that would let a misbehaving upstream
	// pull Mosaic into a hot loop.
	if !classification.RetryAt.IsZero() && classification.RetryAt.After(scheduled) {
		return classification.RetryAt
	}
	return scheduled
}
