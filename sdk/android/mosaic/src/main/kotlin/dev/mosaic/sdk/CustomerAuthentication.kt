package dev.mosaic.sdk

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * A Customer Access Token, minted by the host application's own backend.
 *
 * The SDK treats the value as **opaque**: it never parses it, never inspects it for structure,
 * never persists it, and never logs it. Mosaic's tokens are opaque random values stored server-side
 * as digests, so there is nothing inside one to read; a client that learned to parse a token would
 * also have learned to depend on a shape Mosaic is free to change.
 *
 * The value class exists so a token cannot be passed where a `String` is expected — an SDK key, a
 * user identifier, a log message — by accident. [toString] is overridden for the same reason: the
 * default would print the credential into any interpolated string.
 */
@JvmInline
value class MosaicCustomerAccessToken(val value: String) {
    init {
        require(value.length in 16..4096) { "A Customer Access Token must be between 16 and 4096 characters." }
        require(value.none { it.isWhitespace() || it.isISOControl() }) {
            "A Customer Access Token must not contain whitespace or control characters."
        }
    }

    override fun toString(): String = "MosaicCustomerAccessToken(redacted)"
}

/**
 * What the host's token provider had to say.
 *
 * [SignedOut] and [Unavailable] are deliberately distinct. Signed out is a definite answer about the
 * application's own state and produces a signed-out surface with no customer at all; unavailable is
 * a failure to answer and produces `unknown`. Collapsing them would make every backend outage look
 * like a logout, and every logout look like an outage.
 */
sealed interface MosaicCustomerAccessTokenResult {
    data class Issued(
        val token: MosaicCustomerAccessToken,
        /**
         * Optional binding hint. The server always derives the customer from the token itself and
         * verifies any hint against it, so this value can never widen access; it lets the SDK
         * isolate the on-device cache before the first snapshot arrives.
         */
        val billingCustomerId: String? = null,
    ) : MosaicCustomerAccessTokenResult

    data class Unavailable(
        val diagnosticCode: String = "customer.token.unavailable",
        val retryAfterSeconds: Int? = null,
    ) : MosaicCustomerAccessTokenResult

    data object SignedOut : MosaicCustomerAccessTokenResult
}

/**
 * The host's hook for minting Customer Access Tokens.
 *
 * Mosaic Billing requires an application backend: a public SDK key can never select a Billing
 * Customer, so the token must be minted by a server that has already authenticated the user. The SDK
 * calls this on the IO dispatcher and never re-entrantly — at most one call is outstanding at a
 * time, whatever the caller concurrency — so an implementation may perform network work directly.
 *
 * `forceRefresh` is true only after Mosaic saw the current token refused. An implementation that
 * caches should bypass its cache in that case; one that always mints fresh may ignore the flag.
 */
fun interface MosaicCustomerAccessTokenProvider {
    suspend fun customerAccessToken(forceRefresh: Boolean): MosaicCustomerAccessTokenResult
}

/**
 * Single-flight token holder.
 *
 * The collapse is a [Mutex] plus a shared [CompletableDeferred] rather than a lock held across the
 * provider call: N concurrent syncs after a cold start, or after a 401, must produce exactly **one**
 * provider call, and a lock-per-caller would produce N sequential ones — on a backend that may well
 * be rate limiting per user.
 *
 * The generation counter is what makes identity changes safe. `clear()` bumps it, so a provider call
 * that was already in flight when the user logged out completes into nothing: its result is
 * discarded rather than cached under the new identity.
 */
internal class MosaicCustomerTokenSession(
    private val provider: MosaicCustomerAccessTokenProvider,
    private val now: () -> Long = System::currentTimeMillis,
    private val cooldownMillis: Long = 30_000,
) {
    private class Attempt(
        val forced: Boolean,
        val generation: Int,
        val deferred: CompletableDeferred<MosaicCustomerAccessTokenResult> = CompletableDeferred(),
    )

    private val mutex = Mutex()
    private var cached: MosaicCustomerAccessToken? = null
    private var cachedCustomerId: String? = null
    private var cachedAuthorityEpoch: Long? = null
    private var rejectedAuthorityEpoch: Long? = null
    private var inFlight: Attempt? = null
    private var generation = 0
    private var unavailableUntil = 0L
    private var lastUnavailable: MosaicCustomerAccessTokenResult? = null
    private var signedOut = false

    /** Provider calls made, exposed so tests can assert the collapse rather than infer it. */
    @Volatile
    var providerCallCount: Int = 0
        private set

    suspend fun generation(): Int = mutex.withLock { generation }

    suspend fun currentCustomerId(): String? = mutex.withLock { cachedCustomerId }

    /**
     * The token already held, or null. **Never** calls the provider.
     *
     * This is the read for opportunistic, fire-and-forget work — attributing a queued Transaction
     * Observation, for instance — where the token is a bonus rather than a requirement. Minting one
     * there would make a background flush initiate network work against the host's backend on a
     * path nothing is waiting for, and on a cold start it would do so before the app has any reason
     * to believe a customer is even signed in. Work that genuinely needs a token calls [token].
     */
    suspend fun heldToken(): MosaicCustomerAccessToken? = mutex.withLock { cached }

    suspend fun token(
        forceRefresh: Boolean = false,
        authorityEpoch: Long? = null,
    ): MosaicCustomerAccessTokenResult {
        // Bounded: each iteration either returns or joins an attempt, and a joined attempt clears
        // itself, so the loop cannot spin against a live provider.
        repeat(MAX_COLLAPSE_ROUNDS) {
            var owned: Attempt? = null
            val attempt: Attempt
            mutex.withLock {
                if (authorityEpoch != null && rejectedAuthorityEpoch == authorityEpoch) {
                    return MosaicCustomerAccessTokenResult.Unavailable("customer.token.authorityRejected")
                }
                if (!forceRefresh) {
                    if (signedOut) return MosaicCustomerAccessTokenResult.SignedOut
                    cached?.takeIf { cachedAuthorityEpoch == authorityEpoch }?.let {
                        return MosaicCustomerAccessTokenResult.Issued(it, cachedCustomerId)
                    }
                    if (cached != null && cachedAuthorityEpoch != authorityEpoch) cached = null
                    // A failing provider is not asked again immediately: a token backend that is
                    // down would otherwise be retried once per entitlement read.
                    if (now() < unavailableUntil) {
                        return lastUnavailable ?: MosaicCustomerAccessTokenResult.Unavailable()
                    }
                }
                // At most one provider call exists at any time, so a caller either owns the attempt
                // or joins the one already running. A forced caller that joins an unforced attempt
                // is not satisfied by it and starts its own on the next round.
                attempt = inFlight ?: Attempt(forceRefresh, generation).also { inFlight = it; owned = it }
            }

            val own = owned
            if (own == null) {
                val joined = attempt.deferred.await()
                // Joining an unforced attempt does not satisfy a forced caller; go round again and
                // start the forced call the caller actually asked for.
                if (!forceRefresh || attempt.forced) return joined
                return@repeat
            }

            val result = try {
                providerCallCount += 1
                withContext(Dispatchers.IO) { provider.customerAccessToken(forceRefresh) }
            } catch (cancellation: CancellationException) {
                mutex.withLock { if (inFlight === own) inFlight = null }
                own.deferred.completeExceptionally(cancellation)
                throw cancellation
            } catch (_: Throwable) {
                // A host token provider that throws is a host defect, never a Mosaic crash, and
                // never an entitlement decision: it degrades to "cannot answer".
                MosaicCustomerAccessTokenResult.Unavailable("customer.token.providerFailed")
            }

            mutex.withLock {
                if (inFlight === own) inFlight = null
                // A result minted for a previous identity is discarded, not cached.
                if (own.generation == generation) apply(result, authorityEpoch)
            }
            own.deferred.complete(result)
            return result
        }
        return MosaicCustomerAccessTokenResult.Unavailable("customer.token.unavailable")
    }

    /**
     * Drops the token only if it is still the one the caller saw refused.
     *
     * The compare-and-set matters: without it, a 401 answered with a token that had already been
     * replaced by a concurrent refresh would throw away the good replacement and start an
     * invalidation loop.
     */
    suspend fun invalidate(token: MosaicCustomerAccessToken) = mutex.withLock {
        if (cached == token) {
            cached = null
            cachedAuthorityEpoch = null
        }
    }

    suspend fun rejectAuthorityEpoch(authorityEpoch: Long?) = mutex.withLock {
        rejectedAuthorityEpoch = authorityEpoch
        cached = null
        cachedAuthorityEpoch = null
    }

    /** Logout. The generation bump orphans any in-flight provider call. */
    suspend fun clear() = mutex.withLock {
        generation += 1
        cached = null
        cachedAuthorityEpoch = null
        rejectedAuthorityEpoch = null
        cachedCustomerId = null
        inFlight = null
        unavailableUntil = 0
        lastUnavailable = null
        signedOut = true
    }

    /** Sign-in, or an identity change. Also orphans anything in flight for the previous identity. */
    suspend fun reset(billingCustomerId: String?) = mutex.withLock {
        generation += 1
        cached = null
        cachedAuthorityEpoch = null
        rejectedAuthorityEpoch = null
        cachedCustomerId = billingCustomerId
        inFlight = null
        unavailableUntil = 0
        lastUnavailable = null
        signedOut = false
    }

    private fun apply(result: MosaicCustomerAccessTokenResult, authorityEpoch: Long?) {
        when (result) {
            is MosaicCustomerAccessTokenResult.Issued -> {
                cached = result.token
                cachedAuthorityEpoch = authorityEpoch
                result.billingCustomerId?.let { cachedCustomerId = it }
                signedOut = false
                unavailableUntil = 0
                lastUnavailable = null
            }
            is MosaicCustomerAccessTokenResult.Unavailable -> {
                cached = null
                cachedAuthorityEpoch = null
                lastUnavailable = result
                unavailableUntil = now() +
                    (result.retryAfterSeconds?.toLong()?.times(1_000) ?: cooldownMillis)
            }
            MosaicCustomerAccessTokenResult.SignedOut -> {
                cached = null
                cachedAuthorityEpoch = null
                cachedCustomerId = null
                signedOut = true
            }
        }
    }

    private companion object {
        const val MAX_COLLAPSE_ROUNDS = 4
    }
}
