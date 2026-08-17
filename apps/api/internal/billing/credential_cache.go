package billing

import (
	"crypto/ecdsa"
	"sync"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/googleplay"
)

// credentialCacheTTL bounds how long worker loops reuse a resolved credential
// or a Project's billing-enabled flag without re-reading the database. Both
// change through rare operator actions, yet were re-fetched — and the
// credential re-decrypted and re-parsed — for every leased job, which at
// notification-burst volume multiplies pool load by pure repetition.
//
// The TTL is deliberately far below every job lease (60s–2m): a revoked
// credential or a disabled Project takes effect within a window the lease
// model already tolerates for in-flight work.
const credentialCacheTTL = 30 * time.Second

type ttlEntry[V any] struct {
	value   V
	expires time.Time
}

// ttlCache is a small concurrency-safe expiring map. Expired entries are swept
// on write while the lock is held, so the cache cannot grow past the set of
// keys used within one TTL plus the sweep lag.
type ttlCache[V any] struct {
	mu      sync.Mutex
	entries map[string]ttlEntry[V]
	ttl     time.Duration
}

func newTTLCache[V any](ttl time.Duration) *ttlCache[V] {
	return &ttlCache[V]{entries: make(map[string]ttlEntry[V]), ttl: ttl}
}

func (c *ttlCache[V]) get(key string, now time.Time) (V, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if !ok || !entry.expires.After(now) {
		var zero V
		return zero, false
	}
	return entry.value, true
}

func (c *ttlCache[V]) put(key string, value V, now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for existing, entry := range c.entries {
		if !entry.expires.After(now) {
			delete(c.entries, existing)
		}
	}
	c.entries[key] = ttlEntry[V]{value: value, expires: now.Add(c.ttl)}
}

// appleCredentialMaterial is the per-credential part of an Apple call that
// does not vary by input: the credential row, its default scoped bundle id,
// and the decrypted, parsed signing key. The parsed key lives in memory for at
// most the TTL — a bounded extension of the lifetime it already has for the
// duration of each call.
type appleCredentialMaterial struct {
	credential StoreServerCredential
	bundleID   string
	key        *ecdsa.PrivateKey
}

// googleCredentialMaterial is the per-credential part of a Google call that
// does not vary by input: the credential row, its default scoped package name,
// and the parsed service account.
type googleCredentialMaterial struct {
	credential  StoreServerCredential
	packageName string
	account     *googleplay.ServiceAccount
}

func credentialCacheKey(projectID, credentialID string) string {
	return projectID + "\x00" + credentialID
}
