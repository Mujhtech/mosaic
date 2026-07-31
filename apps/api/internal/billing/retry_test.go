package billing

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/appstoreserver"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/googleplay"
)

// Retry classification decides whether a failed validation is tried again or
// dead-lettered. Getting it wrong in one direction produces a retry storm
// against a provider; in the other it permanently loses a recoverable
// transaction. The table below pins the documented provider failures to the
// side they belong on.
func TestClassifyAssignsRetryability(t *testing.T) {
	now := time.Now().UTC()
	cases := []struct {
		name      string
		err       error
		category  string
		retryable bool
	}{
		{"apple 429", &appstoreserver.Error{HTTPStatus: http.StatusTooManyRequests}, CategoryRateLimited, true},
		{"apple 500", &appstoreserver.Error{HTTPStatus: http.StatusInternalServerError}, CategoryTransient, true},
		{"apple retryable code", &appstoreserver.Error{HTTPStatus: 404, AppleCode: "4040002"}, CategoryNotFoundRetryable, true},
		// A transaction Apple does not know will not become known by waiting.
		{"apple 404 terminal", &appstoreserver.Error{HTTPStatus: http.StatusNotFound}, CategoryNotFoundTerminal, false},
		{"apple 400", &appstoreserver.Error{HTTPStatus: http.StatusBadRequest}, CategoryInvalid, false},
		{"google quota", &googleplay.Error{HTTPStatus: 429, GoogleCode: "RESOURCE_EXHAUSTED"}, CategoryQuota, true},
		{"google 503", &googleplay.Error{HTTPStatus: http.StatusServiceUnavailable}, CategoryTransient, true},
		// A rejected service-account key is an operator action, not a wait.
		{"google invalid grant", &googleplay.Error{HTTPStatus: 400, GoogleCode: "invalid_grant"}, CategoryConfiguration, false},
		{"google 403", &googleplay.Error{HTTPStatus: http.StatusForbidden}, CategoryConfiguration, false},
		{"google 404", &googleplay.Error{HTTPStatus: http.StatusNotFound}, CategoryNotFoundTerminal, false},
		{"timeout", context.DeadlineExceeded, CategoryTransient, true},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			classification := Classify(testCase.err, now)
			if classification.Category != testCase.category {
				t.Fatalf("category %q, want %q", classification.Category, testCase.category)
			}
			if classification.Retryable != testCase.retryable {
				t.Fatalf("retryable %v, want %v", classification.Retryable, testCase.retryable)
			}
		})
	}
}

// Apple's Retry-After is an absolute UNIX timestamp in milliseconds, unlike the
// RFC 7231 delta-seconds every other API in this repository sends. Reading an
// absolute value as a delta schedules the retry tens of thousands of years out,
// which presents as a permanently stalled queue with no error anywhere. This
// test is the reason the two parsers are separate functions.
func TestAppleRetryAfterIsAbsoluteMilliseconds(t *testing.T) {
	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	retryAt := now.Add(90 * time.Second)

	parsed, ok := appstoreserver.ParseRetryAfter(millisString(retryAt), now)
	if !ok {
		t.Fatal("a valid absolute-millisecond Retry-After was not parsed")
	}
	if !parsed.Equal(retryAt) {
		t.Fatalf("parsed %s, want %s", parsed, retryAt)
	}

	// A delta-seconds value, if misread as absolute milliseconds, lands in 1970
	// and is in the past — the guard must treat it as absent rather than
	// scheduling a retry that already expired.
	if _, ok := appstoreserver.ParseRetryAfter("120", now); ok {
		t.Fatal("a delta-seconds value was accepted as an absolute timestamp")
	}
	// An implausibly distant value is a misread rather than an instruction.
	if _, ok := appstoreserver.ParseRetryAfter(millisString(now.Add(72*time.Hour)), now); ok {
		t.Fatal("an implausibly distant Retry-After was honoured")
	}
	for _, value := range []string{"", "soon", "-1", "0"} {
		if _, ok := appstoreserver.ParseRetryAfter(value, now); ok {
			t.Fatalf("malformed Retry-After %q was accepted", value)
		}
	}
}

// Google follows RFC 7231, so the delta-seconds form must still parse. Keeping
// both behaviours under test is what stops a future refactor from collapsing
// them into one parser.
func TestGoogleRetryAfterIsDeltaSeconds(t *testing.T) {
	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	delay, ok := googleplay.ParseRetryAfter("120", now)
	if !ok || delay != 2*time.Minute {
		t.Fatalf("parsed %s ok=%v, want 2m", delay, ok)
	}
	if _, ok := googleplay.ParseRetryAfter(millisString(now.Add(time.Minute)), now); ok {
		t.Fatal("an absolute-millisecond value was accepted as delta-seconds")
	}
}

// A provider instruction may push a retry later but must never pull it earlier:
// otherwise a misbehaving upstream could drive Mosaic into a hot loop.
func TestNextAttemptHonoursLongerProviderInstruction(t *testing.T) {
	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	far := now.Add(30 * time.Minute)

	scheduled := NextAttemptAt(now, 1, Classification{RetryAt: far}, nil)
	if !scheduled.Equal(far) {
		t.Fatalf("scheduled %s, want the provider instant %s", scheduled, far)
	}

	near := now.Add(time.Second)
	scheduled = NextAttemptAt(now, 3, Classification{RetryAt: near}, nil)
	if !scheduled.After(near) {
		t.Fatalf("a shorter provider instruction shortened the backoff to %s", scheduled)
	}
}

// Backoff must grow and stay bounded: unbounded growth strands work, and no
// growth defeats the purpose during an outage.
func TestBackoffGrowsAndIsCapped(t *testing.T) {
	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	previous := time.Duration(0)
	for attempt := range 6 {
		delay := NextAttemptAt(now, attempt, Classification{}, nil).Sub(now)
		if delay <= previous {
			t.Fatalf("attempt %d delay %s did not grow beyond %s", attempt, delay, previous)
		}
		previous = delay
	}
	capped := NextAttemptAt(now, 30, Classification{}, nil).Sub(now)
	if capped > 10*time.Minute {
		t.Fatalf("backoff cap exceeded: %s", capped)
	}
}

// SafeError must not carry the original error's text: it is what stops a
// provider payload fragment reaching the 5xx cause-logging path.
func TestSafeFailureDropsUnderlyingMessage(t *testing.T) {
	secret := "purchase token gto5s...redacted-secret-value"
	wrapped := safeFailure(errors.New(secret), "billing_lease_failed")

	if wrapped == nil {
		t.Fatal("safeFailure returned nil for a non-nil error")
	}
	var safe *SafeError
	if !errors.As(wrapped, &safe) {
		t.Fatalf("safeFailure returned %T, want *SafeError", wrapped)
	}
	if contains(wrapped.Error(), "redacted-secret-value") {
		t.Fatalf("safe error leaked the cause: %q", wrapped.Error())
	}
	if safe.Code != "billing_lease_failed" {
		t.Fatalf("code %q, want billing_lease_failed", safe.Code)
	}
	// Unwrapping must not reach the original error either, or errors.Is on a
	// caller's side could still surface it.
	if errors.Unwrap(wrapped) != nil {
		t.Fatal("safe error still wraps the original cause")
	}
}

func millisString(value time.Time) string {
	millis := value.UnixMilli()
	digits := ""
	for millis > 0 {
		digits = string(rune('0'+millis%10)) + digits
		millis /= 10
	}
	return digits
}

func contains(haystack, needle string) bool {
	if len(needle) > len(haystack) {
		return false
	}
	for index := 0; index+len(needle) <= len(haystack); index++ {
		if haystack[index:index+len(needle)] == needle {
			return true
		}
	}
	return false
}

// An authentication failure must not consume the full attempt budget.
//
// Mosaic mints a fresh assertion on every request, so a credential still
// rejected after a second signing is revoked, expired, or wrong — an operator
// action, not a wait. Letting it run all eight attempts multiplies provider
// load across ~40 minutes of backoff per input during an outage the operator
// can already see, and plan §6 lists revoked credentials among the permanent
// categories.
func TestAuthFailuresAreCappedBelowTheQueueBudget(t *testing.T) {
	auth := Classification{Category: CategoryAuth, Retryable: true}
	transient := Classification{Category: CategoryTransient, Retryable: true}

	if auth.ExhaustedFor(1, MaxValidationAttempts) {
		t.Fatal("the first authentication failure was treated as terminal; one retry with a fresh assertion is the point")
	}
	if !auth.ExhaustedFor(MaxAuthAttempts, MaxValidationAttempts) {
		t.Fatalf("an authentication failure was still retryable at attempt %d", MaxAuthAttempts)
	}
	if MaxAuthAttempts >= MaxValidationAttempts {
		t.Fatalf("the auth cap (%d) does not actually cap anything below the queue budget (%d)",
			MaxAuthAttempts, MaxValidationAttempts)
	}

	// Every other retryable category keeps the queue's own budget: a provider
	// outage is exactly the case the eight attempts exist for.
	if transient.ExhaustedFor(MaxAuthAttempts, MaxValidationAttempts) {
		t.Fatal("the auth cap leaked onto transient failures, which would dead-letter a recoverable outage early")
	}
	if !transient.ExhaustedFor(MaxValidationAttempts, MaxValidationAttempts) {
		t.Fatal("a transient failure never exhausts")
	}
}
