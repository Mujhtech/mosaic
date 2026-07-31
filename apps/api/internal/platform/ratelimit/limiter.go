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

func (limiter *Limiter) AllowN(key string, tokens int) (bool, time.Duration) {
	if limiter == nil || key == "" {
		return true, 0
	}
	if tokens < 1 {
		tokens = 1
	}
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	now := limiter.now()
	value, ok := limiter.buckets[key]
	if !ok {
		if len(limiter.buckets) >= limiter.maxEntries {
			limiter.prune(now)
		}
		value = bucket{tokens: limiter.burst, last: now}
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

func (limiter *Limiter) prune(now time.Time) {
	for key, value := range limiter.buckets {
		if now.Sub(value.last) > 10*time.Minute {
			delete(limiter.buckets, key)
		}
	}
	if len(limiter.buckets) < limiter.maxEntries {
		return
	}
	var oldestKey string
	var oldest time.Time
	for key, value := range limiter.buckets {
		if oldestKey == "" || value.last.Before(oldest) {
			oldestKey, oldest = key, value.last
		}
	}
	delete(limiter.buckets, oldestKey)
}
