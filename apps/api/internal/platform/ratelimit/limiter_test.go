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
