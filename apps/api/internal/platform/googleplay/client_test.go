package googleplay

import (
	"encoding/base64"
	"net/http"
	"strings"
	"testing"
	"time"
)

// Google's intake path has no signature to verify: the authenticity argument is
// that the pull was made with Mosaic's own service-account credential over TLS,
// and that what came back is a well-formed DeveloperNotification naming exactly
// one event. DecodeNotification is that second half, and it is the only thing
// standing between an arbitrary Pub/Sub message and a tenant-attributed Raw
// Billing Input. Plan §13 names it directly.
//
// These are Mosaic's own rules, not Google's library behaviour.
func TestDecodeNotificationRejectsMessagesThatCannotBeAttributed(t *testing.T) {
	encode := func(body string) string {
		return base64.StdEncoding.EncodeToString([]byte(body))
	}
	valid := `{"version":"1.0","packageName":"com.fixture.app","eventTimeMillis":"1769000000000",` +
		`"subscriptionNotification":{"version":"1.0","notificationType":4,` +
		`"purchaseToken":"fixture-token","subscriptionId":"fixture.pro.monthly"}}`

	cases := []struct {
		name    string
		message PubSubMessage
		reason  string
	}{
		{
			name:    "no message id",
			message: PubSubMessage{Data: encode(valid)},
			reason:  "the Pub/Sub message id is half the idempotency key; without it a redelivery would duplicate",
		},
		{
			name:    "data is not base64",
			message: PubSubMessage{MessageID: "m1", Data: "not-base64!!"},
			reason:  "an undecodable body cannot be a notification",
		},
		{
			name:    "data is not JSON",
			message: PubSubMessage{MessageID: "m1", Data: encode("plain text")},
			reason:  "arbitrary bytes must not become a tenant-attributed input",
		},
		{
			name:    "no package name",
			message: PubSubMessage{MessageID: "m1", Data: encode(`{"version":"1.0","testNotification":{"version":"1.0"}}`)},
			reason:  "packageName is what binds the notification to an Application; without it there is nothing to check",
		},
		{
			name:    "no event member",
			message: PubSubMessage{MessageID: "m1", Data: encode(`{"version":"1.0","packageName":"com.fixture.app"}`)},
			reason:  "a notification about nothing is not actionable",
		},
		{
			name: "two event members",
			message: PubSubMessage{MessageID: "m1", Data: encode(
				`{"version":"1.0","packageName":"com.fixture.app",` +
					`"subscriptionNotification":{"version":"1.0","notificationType":4,"purchaseToken":"a","subscriptionId":"b"},` +
					`"oneTimeProductNotification":{"version":"1.0","notificationType":1,"purchaseToken":"c","sku":"d"}}`)},
			reason: "silently truncating to the first event would discard a real event",
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if _, _, err := DecodeNotification(testCase.message); err == nil {
				t.Fatalf("message was accepted; %s", testCase.reason)
			}
		})
	}

	notification, raw, err := DecodeNotification(PubSubMessage{MessageID: "m1", Data: encode(valid)})
	if err != nil {
		t.Fatalf("a well-formed notification was rejected: %v", err)
	}
	if notification.PackageName != "com.fixture.app" || notification.SubscriptionNotification == nil {
		t.Fatal("the decoded notification lost its package name or its event")
	}
	if len(raw) == 0 {
		t.Fatal("the raw bytes are what get sealed into the encrypted body; they must be returned")
	}
}

// Google follows RFC 7231 for Retry-After. Apple does not — it sends an
// absolute UNIX millisecond timestamp — and the two parsers must never be
// interchanged: reading an absolute value as delta-seconds schedules a retry
// tens of thousands of years out, which presents as a permanently stalled queue
// with no error anywhere.
func TestParseRetryAfterAcceptsOnlyTheRFC7231Forms(t *testing.T) {
	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)

	if delay, ok := ParseRetryAfter("90", now); !ok || delay != 90*time.Second {
		t.Fatalf("delta-seconds parsed as %s (ok=%v), want 1m30s", delay, ok)
	}
	if delay, ok := ParseRetryAfter(now.Add(2*time.Minute).Format(http.TimeFormat), now); !ok || delay <= 0 {
		t.Fatalf("HTTP-date parsed as %s (ok=%v)", delay, ok)
	}
	for _, malformed := range []string{"", "soon", "-5", "0", "999999"} {
		if _, ok := ParseRetryAfter(malformed, now); ok {
			t.Fatalf("malformed or out-of-range Retry-After %q was accepted", malformed)
		}
	}
	// Apple's form must not be honoured here.
	if _, ok := ParseRetryAfter("1785283200000", now); ok {
		t.Fatal("an absolute-millisecond value was accepted as delta-seconds")
	}
}

// A provider status must land on the correct side of the retry boundary. These
// are the codes Mosaic classifies on, and a value outside the safe charset must
// be neutralised before it can reach the provider_code column or an operator's
// console.
func TestSafeCodeBoundsProviderSuppliedStatuses(t *testing.T) {
	if got := safeCode("RESOURCE_EXHAUSTED"); got != "RESOURCE_EXHAUSTED" {
		t.Fatalf("a documented status was altered: %q", got)
	}
	if got := safeCode(""); got != "" {
		t.Fatalf("an absent status became %q", got)
	}
	for _, hostile := range []string{"bad status", "a\nb", "a\x00b", "tok/en"} {
		if got := safeCode(hostile); got != "unclassified" {
			t.Fatalf("hostile status %q became %q; it must not reach a column or a log verbatim", hostile, got)
		}
	}
	if got := safeCode(strings.Repeat("A", 200)); len(got) > 128 {
		t.Fatalf("an over-length status was not bounded: %d chars", len(got))
	}
}

// The service-account key is parsed before it is ever persisted, so an operator
// learns immediately that they pasted the wrong file. The token endpoint is
// pinned: honouring an arbitrary token_uri from an uploaded file would let a
// doctored key redirect Mosaic's signed assertions to a host of the uploader's
// choosing.
func TestParseServiceAccountRejectsUnusableKeys(t *testing.T) {
	cases := map[string]string{
		"not JSON":             `not json`,
		"wrong type":           `{"type":"authorized_user","project_id":"p","private_key_id":"k","private_key":"x","client_email":"e"}`,
		"missing client email": `{"type":"service_account","project_id":"p","private_key_id":"k","private_key":"x"}`,
		"private key not PEM":  `{"type":"service_account","project_id":"p","private_key_id":"k","private_key":"not-pem","client_email":"e@x"}`,
		"foreign token uri": `{"type":"service_account","project_id":"p","private_key_id":"k","private_key":"x",` +
			`"client_email":"e@x","token_uri":"https://attacker.example/token"}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := ParseServiceAccount([]byte(body)); err == nil {
				t.Fatal("an unusable service-account key was accepted")
			}
		})
	}
}
