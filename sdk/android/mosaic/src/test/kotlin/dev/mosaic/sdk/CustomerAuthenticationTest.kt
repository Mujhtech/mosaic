package dev.mosaic.sdk

import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class CustomerAuthenticationTest {
    private fun token(value: String) = MosaicCustomerAccessToken(value)

    /** A credential must not be printable by accident, which interpolation does constantly. */
    @Test
    fun tokenNeverPrintsItsValue() {
        val secret = "mosaic-customer-token-abcdefghijkl"
        assertFalse(token(secret).toString().contains(secret))
        assertFalse("holder: ${token(secret)}".contains(secret))
    }

    /**
     * N concurrent callers collapse onto one provider call.
     *
     * The failure this protects against is a cold start or a mass 401 turning into one token request
     * per concurrent entitlement read, against a host backend that may rate limit per user.
     */
    @Test
    fun concurrentCallersProduceExactlyOneProviderCall() = runTest {
        val gate = CompletableDeferred<Unit>()
        val calls = AtomicInteger()
        val session = MosaicCustomerTokenSession(
            { _ ->
                calls.incrementAndGet()
                gate.await()
                MosaicCustomerAccessTokenResult.Issued(token("mosaic-customer-token-000001"))
            },
        )

        val waiters = List(16) { async { session.token() } }
        gate.complete(Unit)
        val results = waiters.awaitAll()

        assertEquals(1, calls.get())
        assertTrue(results.all { it is MosaicCustomerAccessTokenResult.Issued })
        // The cached token satisfies later readers without touching the provider at all.
        session.token()
        assertEquals(1, calls.get())
    }

    /** A forced refresh is a distinct call: the joined token is the one that was just refused. */
    @Test
    fun forcedRefreshDoesNotReuseTheRefusedToken() = runTest {
        val issued = mutableListOf<String>()
        val session = MosaicCustomerTokenSession(
            { forced ->
                val value = if (forced) "mosaic-customer-token-refreshed" else "mosaic-customer-token-original"
                issued += value
                MosaicCustomerAccessTokenResult.Issued(token(value))
            },
        )

        val first = session.token() as MosaicCustomerAccessTokenResult.Issued
        session.invalidate(first.token)
        val second = session.token(forceRefresh = true) as MosaicCustomerAccessTokenResult.Issued

        assertEquals(listOf("mosaic-customer-token-original", "mosaic-customer-token-refreshed"), issued)
        assertEquals("mosaic-customer-token-refreshed", second.token.value)
    }

    /**
     * Invalidation is compare-and-set on the token identity.
     *
     * Without the CAS, a 401 carrying an already-replaced token discards the good replacement and
     * starts an invalidate-refresh loop that never converges.
     */
    @Test
    fun invalidatingAStaleTokenLeavesTheReplacementInPlace() = runTest {
        val calls = AtomicInteger()
        val session = MosaicCustomerTokenSession(
            { _ ->
                MosaicCustomerAccessTokenResult.Issued(token("mosaic-customer-token-${calls.incrementAndGet()}"))
            },
        )
        val stale = token("mosaic-customer-token-stale-000")
        val current = session.token() as MosaicCustomerAccessTokenResult.Issued

        session.invalidate(stale)

        val again = session.token() as MosaicCustomerAccessTokenResult.Issued
        assertEquals(current.token.value, again.token.value)
        assertEquals(1, calls.get())
    }

    /** A provider that throws degrades to "cannot answer" and never propagates into the host. */
    @Test
    fun throwingProviderBecomesUnavailableRatherThanAFailure() = runTest {
        val session = MosaicCustomerTokenSession({ _ -> throw IllegalStateException("host backend defect") })
        val result = session.token()
        assertEquals(
            "customer.token.providerFailed",
            (result as MosaicCustomerAccessTokenResult.Unavailable).diagnosticCode,
        )
    }

    /** An unavailable provider is not re-asked once per read; the cooldown is observable. */
    @Test
    fun unavailableProviderIsNotRetriedUntilTheCooldownElapses() = runTest {
        val calls = AtomicInteger()
        var clock = 1_000L
        val session = MosaicCustomerTokenSession(
            provider = { _ ->
                calls.incrementAndGet()
                MosaicCustomerAccessTokenResult.Unavailable(retryAfterSeconds = 5)
            },
            now = { clock },
        )

        session.token()
        session.token()
        assertEquals(1, calls.get())

        clock += 6_000
        session.token()
        assertEquals(2, calls.get())
    }

    /**
     * A token minted for the previous identity is discarded, not cached under the new one.
     *
     * This is the leak the generation counter exists for: the provider call was already in flight
     * when the user logged out, so its result describes somebody who is no longer signed in.
     */
    @Test
    fun tokenIssuedAcrossALogoutIsDiscarded() = runTest {
        val gate = CompletableDeferred<Unit>()
        val session = MosaicCustomerTokenSession(
            { _ ->
                gate.await()
                MosaicCustomerAccessTokenResult.Issued(token("mosaic-customer-token-previous"))
            },
        )

        val inFlight = async { session.token() }
        session.clear()
        gate.complete(Unit)
        inFlight.await()

        assertSame(MosaicCustomerAccessTokenResult.SignedOut, session.token())
    }
}
