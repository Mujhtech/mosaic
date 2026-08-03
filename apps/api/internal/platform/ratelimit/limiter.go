package ratelimit

import (
	"math"
	"sync"
	"time"
)

type bucket struct {
	tokens float64
	last   time.Time
}

// Limiter is a bounded, single-process token bucket intended for the private-alpha
// SDK delivery edge. Multi-instance deployments must place a shared edge limiter
// in front of the API before relying on aggregate limits.
type Limiter struct {
	mu         sync.Mutex
	buckets    map[string]bucket
	rate       float64
	burst      float64
	maxEntries int
	now        func() time.Time
}

func New(requestsPerMinute, burst, maxEntries int) *Limiter {
	return &Limiter{
		buckets: make(map[string]bucket), rate: float64(requestsPerMinute) / 60,
		burst: float64(burst), maxEntries: maxEntries, now: time.Now,
	}
}

func (limiter *Limiter) Allow(key string) (bool, time.Duration) {
	return limiter.AllowN(key, 1)
}

// UnkeyedBucket is where a caller that could not name a bucket is counted.
//
// An empty key used to return "allowed" unconditionally, which turned every
// caller that failed to derive an identity — an unparsable client address, a
// missing credential digest — into an unlimited one, exactly at the moment
// least is known about them. They share one bucket instead: the limit still
// applies, and it cannot be escaped by arranging for the key to be empty. The
// NUL prefix keeps it disjoint from every derived key, which are all prefixed
// text or hex digests.
const UnkeyedBucket = "\x00unkeyed"

func (limiter *Limiter) AllowN(key string, tokens int) (bool, time.Duration) {
	// A nil Limiter is the explicit "this surface has no limiter configured"
	// case, checked for by every call site before it calls: cmd/api constructs
	// one per surface, and the surfaces that do not take one pass nil on
	// purpose. It is a wiring statement, not a failed lookup.
	if limiter == nil {
		return true, 0
	}
	if key == "" {
		key = UnkeyedBucket
	}
	if tokens < 1 {
		tokens = 1
	}
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	now := limiter.now()
	value, ok := limiter.buckets[key]
	if !ok {
		starting := limiter.burst
		if len(limiter.buckets) >= limiter.maxEntries && limiter.prune(now) {
			// The table was full and an in-use bucket had to be evicted to make
			// room. Handing the new key a full burst is what makes key rotation
			// a way around the limit: an attacker who cycles keys faster than
			// maxEntries gets `burst` free requests per key, forever, and each
			// one evicts a legitimate caller's accumulated debt. Under that
			// pressure a new key starts with a single token — enough to serve
			// one request, after which it refills at the ordinary rate like
			// everyone else.
			starting = math.Min(limiter.burst, 1)
		}
		value = bucket{tokens: starting, last: now}
	}
	elapsed := now.Sub(value.last).Seconds()
	value.tokens = math.Min(limiter.burst, value.tokens+elapsed*limiter.rate)
	value.last = now
	requested := float64(tokens)
	if value.tokens < requested {
		limiter.buckets[key] = value
		return false, time.Duration(math.Ceil((requested-value.tokens)/limiter.rate*1000)) * time.Millisecond
	}
	value.tokens -= requested
	limiter.buckets[key] = value
	return true, 0
}

// prune reclaims room in the bucket table. It reports true when it had to evict
// a bucket that was still in use, which is the caller's signal that the table
// is genuinely under pressure rather than merely holding idle entries.
func (limiter *Limiter) prune(now time.Time) bool {
	for key, value := range limiter.buckets {
		if now.Sub(value.last) > 10*time.Minute {
			delete(limiter.buckets, key)
		}
	}
	if len(limiter.buckets) < limiter.maxEntries {
		return false
	}
	var oldestKey string
	var oldest time.Time
	for key, value := range limiter.buckets {
		if oldestKey == "" || value.last.Before(oldest) {
			oldestKey, oldest = key, value.last
		}
	}
	if oldestKey == "" {
		return false
	}
	delete(limiter.buckets, oldestKey)
	return true
}
