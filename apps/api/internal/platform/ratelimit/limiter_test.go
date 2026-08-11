package ratelimit

import (
	"testing"
	"time"
)

func TestLimiterBoundsKeysAndRefillsTokens(t *testing.T) {
	now := time.Date(2026, time.July, 22, 10, 0, 0, 0, time.UTC)
	limiter := New(60, 1, 2)
	limiter.now = func() time.Time { return now }

	if allowed, _ := limiter.Allow("first"); !allowed {
		t.Fatal("first token was rejected")
	}
	if allowed, retry := limiter.Allow("first"); allowed || retry < time.Second {
		t.Fatalf("empty bucket allowed=%v retry=%s, want rejection with one-second retry", allowed, retry)
	}
	now = now.Add(time.Second)
	if allowed, _ := limiter.Allow("first"); !allowed {
		t.Fatal("token did not refill at configured rate")
	}
	if allowed, _ := limiter.Allow("second"); !allowed {
		t.Fatal("independent key was rejected")
	}
	if allowed, _ := limiter.Allow("third"); !allowed || len(limiter.buckets) != 2 {
		t.Fatalf("bounded-key insert allowed=%v entries=%d, want allowed and two entries", allowed, len(limiter.buckets))
	}
}

// Fallback-audit backend #4. Two fail-open paths met in AllowN.
//
// An empty key returned "allowed" unconditionally, so a caller that could not
// derive an identity — an unparsable client address, a missing credential
// digest — became unlimited at exactly the moment least was known about it.
//
// And under maxEntries pressure a newly admitted key was handed a full burst,
// so an attacker cycling keys faster than the table holds got `burst` free
// requests per key indefinitely, each one evicting a legitimate caller's
// accumulated debt.
//
// Unit test: the limiter is a self-contained state machine and this is a
// security boundary, so the rule is pinned where it is decided.
func TestLimiterDoesNotFailOpenOnMissingKeysOrEviction(t *testing.T) {
	now := time.Date(2026, time.August, 2, 10, 0, 0, 0, time.UTC)
	limiter := New(60, 2, 8)
	limiter.now = func() time.Time { return now }

	// Unkeyed callers share one bucket rather than bypassing the limit.
	if allowed, _ := limiter.AllowN("", 1); !allowed {
		t.Fatal("the first unkeyed request was rejected")
	}
	if allowed, _ := limiter.AllowN("", 1); !allowed {
		t.Fatal("the second unkeyed request was rejected inside the burst")
	}
	if allowed, retry := limiter.AllowN("", 1); allowed || retry <= 0 {
		t.Fatalf("unkeyed requests are unlimited: allowed=%v retry=%s", allowed, retry)
	}
	if _, tracked := limiter.buckets[UnkeyedBucket]; !tracked {
		t.Fatal("unkeyed requests were not counted against a shared bucket")
	}

	// Under table pressure, a fresh key gets one token, not a whole burst.
	pressured := New(60, 5, 1)
	pressured.now = func() time.Time { return now }
	if allowed, _ := pressured.Allow("victim"); !allowed {
		t.Fatal("the first key was rejected")
	}
	if allowed, _ := pressured.Allow("rotated"); !allowed {
		t.Fatal("an evicting key was rejected outright; eviction must still admit one request")
	}
	if allowed, retry := pressured.Allow("rotated"); allowed || retry <= 0 {
		t.Fatalf("key rotation under pressure bought a full burst: allowed=%v retry=%s", allowed, retry)
	}
}
