package dev.mosaic.sdk

import com.google.gson.JsonParser
import java.nio.file.Files
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * Runtime behaviour, driven by canonical fixtures through a fake transport.
 *
 * Everything here runs on the JVM: the store is constructed on a temporary directory and the device
 * clock is an explicit input, so the states that matter most — an expired cache, a manipulated
 * clock, an identity change mid-flight — are reachable deterministically instead of by waiting.
 */
class CustomerEntitlementRuntimeTest {
    @get:Rule
    val folder = TemporaryFolder()

    private val issuedAt = mosaicContractInstantMillis("2026-07-28T12:00:00.000Z")
    private var deviceNow: Long? = issuedAt + 60_000

    private fun fixture(name: String): String =
        Files.readAllBytes(
            repositoryFile("protocol/fixtures/authoritative-entitlement/v1/snapshots/$name.json"),
        ).toString(Charsets.UTF_8)

    private fun entityTag(record: String): String = JsonParser.parseString(record)
        .asJsonObject.getAsJsonObject("payload").get("entityTag").asString

    private fun record(name: String) = MosaicCustomerEntitlementTransportResult.Record(
        body = fixture(name),
        entityTag = entityTag(fixture(name)),
        freshness = null,
    )

    private fun runtime(
        transport: MosaicCustomerEntitlementTransport,
        provider: MosaicCustomerAccessTokenProvider = MosaicCustomerAccessTokenProvider {
            MosaicCustomerAccessTokenResult.Issued(MosaicCustomerAccessToken("mosaic-customer-token-0001"))
        },
        diagnostics: MosaicDiagnosticSink = MosaicDiagnosticSink.None,
    ) = MosaicCustomerEntitlementRuntime(
        transport = transport,
        cache = MosaicCustomerEntitlementCache(folder.root),
        session = MosaicCustomerTokenSession(provider),
        trustedTime = { deviceNow },
        diagnostics = diagnostics,
    )

    // ------------------------------------------------------------------------------------------
    // Acceptance gate
    // ------------------------------------------------------------------------------------------

    /** An older snapshot never rolls state backwards, and never lands the reader on inactive. */
    @Test
    fun anOlderSnapshotIsRejectedAndThePreviousOneKeepsServing() = runTest {
        val responses = ArrayDeque(listOf(record("newer-snapshot"), record("bounded-offline-cache")))
        val runtime = runtime({ _, _, _ -> responses.removeFirst() })
        // Inside the newer snapshot's own window, so freshness is not what this row is testing.
        deviceNow = mosaicContractInstantMillis("2026-07-28T14:01:00.000Z")

        val first = runtime.refreshCustomerEntitlements()
        assertEquals(14L, (first as MosaicCustomerEntitlementSyncResult.Updated).snapshot.snapshotVersion)

        val second = runtime.refreshCustomerEntitlements()
        assertEquals(
            MosaicCustomerSnapshotRejection.SNAPSHOT_VERSION_NOT_NEWER,
            (second as MosaicCustomerEntitlementSyncResult.Rejected).rejection,
        )
        val state = runtime.customerEntitlements.value as MosaicCustomerEntitlementSnapshotState.Available
        assertEquals(14L, state.snapshot.snapshotVersion)
    }

    /** A snapshot whose HTTP validator does not identify it is refused rather than trusted. */
    @Test
    fun aSnapshotWithoutAStrongMatchingEntityTagIsRejected() = runTest {
        val runtime = runtime({ _, _, _ ->
            MosaicCustomerEntitlementTransportResult.Record(fixture("active-subscription"), null, null)
        })
        val result = runtime.refreshCustomerEntitlements()
        assertEquals(
            MosaicCustomerSnapshotRejection.WEAK_ENTITY_TAG,
            (result as MosaicCustomerEntitlementSyncResult.Rejected).rejection,
        )
        assertTrue(runtime.customerEntitlements.value is MosaicCustomerEntitlementSnapshotState.Unavailable)
    }

    /**
     * A snapshot bound to another customer clears the cache and is never observable.
     *
     * This is the leak the binding check exists for. The assertion that matters is not only that the
     * foreign snapshot was refused, but that the *previous* customer's grants stopped being served
     * the moment a different identity appeared.
     */
    @Test
    fun aDifferentCustomerClearsTheCacheAndIsNeverObservable() = runTest {
        val observed = mutableListOf<MosaicCustomerEntitlementSnapshotState>()
        val responses = ArrayDeque(listOf(record("bounded-offline-cache"), record("test-source-sandbox-grant")))
        val diagnostics = mutableListOf<MosaicDiagnostic>()
        val runtime = runtime({ _, _, _ -> responses.removeFirst() }, diagnostics = { diagnostics += it })

        runtime.refreshCustomerEntitlements()
        observed += runtime.customerEntitlements.value
        val second = runtime.refreshCustomerEntitlements()
        observed += runtime.customerEntitlements.value

        assertEquals(
            MosaicCustomerSnapshotRejection.CUSTOMER_MISMATCH,
            (second as MosaicCustomerEntitlementSyncResult.Rejected).rejection,
        )
        assertNull(second.lastKnown)
        // Neither the foreign snapshot nor the previous customer's snapshot is served afterwards.
        assertTrue(observed.last() is MosaicCustomerEntitlementSnapshotState.Unavailable)
        assertFalse(
            observed.any {
                it is MosaicCustomerEntitlementSnapshotState.Available &&
                    it.snapshot.billingCustomerId == "fixture-customer-0002"
            },
        )
        assertTrue(
            diagnostics.any { it.code == MosaicDiagnosticCode.CUSTOMER_ENTITLEMENTS_BINDING_MISMATCH },
        )
    }

    // ------------------------------------------------------------------------------------------
    // Freshness
    // ------------------------------------------------------------------------------------------

    /** Inside the grace window access continues, and every active entry is marked stale. */
    @Test
    fun aGraceWindowKeepsAccessAndMarksItStale() = runTest {
        val runtime = runtime({ _, _, _ -> record("bounded-offline-cache") })
        runtime.refreshCustomerEntitlements()

        // validUntil + 5 minutes: inside the 24-hour bounded-grace band.
        deviceNow = mosaicContractInstantMillis("2026-08-04T12:05:00.000Z")
        val check = runtime.checkCustomerEntitlement("pro")

        assertEquals(MosaicCustomerEntitlementCacheState.STALE_WITHIN_GRACE, check.cacheState)
        assertTrue((check.state as MosaicCustomerEntitlementState.Active).isStale)
    }

    /**
     * Past the grace window, and with an unreadable clock, the answer is unknown.
     *
     * Both directions matter. A cache Mosaic has not confirmed says nothing about whether the person
     * still pays, so reporting `inactive` would revoke a paying customer on a bad network day, and a
     * clock that cannot measure the cache's age is the same situation with a different cause.
     */
    @Test
    fun anExpiredCacheAndAnUnreadableClockBothYieldUnknownNeverInactive() = runTest {
        val runtime = runtime({ _, _, _ -> record("bounded-offline-cache") })
        runtime.refreshCustomerEntitlements()

        deviceNow = mosaicContractInstantMillis("2026-08-06T12:05:00.000Z")
        val expired = runtime.checkCustomerEntitlement("pro")
        assertTrue(expired.state is MosaicCustomerEntitlementState.Unknown)
        assertEquals(MosaicCustomerEntitlementCacheState.EXPIRED, expired.cacheState)

        deviceNow = null
        runtime.refreshCustomerEntitlements()
        val unreadable = runtime.checkCustomerEntitlement("pro")
        assertTrue(unreadable.state is MosaicCustomerEntitlementState.Unknown)
        val state = runtime.customerEntitlements.value as MosaicCustomerEntitlementSnapshotState.Unavailable
        assertEquals(MosaicCustomerEntitlementUnavailableReason.CLOCK_UNRELIABLE, state.reason)
        // The snapshot is still carried as last-known so a host can explain itself; it is simply
        // not served as an answer.
        assertEquals(13L, state.lastKnown?.snapshotVersion)
    }

    /**
     * A clock moved backwards past issuance does not become "fresh".
     *
     * The naive implementation computes a negative cache age, concludes fresh, and hands unlimited
     * offline access to anyone willing to change their device time.
     */
    @Test
    fun aBackdatedClockDoesNotExtendAccess() = runTest {
        val runtime = runtime({ _, _, _ -> record("bounded-offline-cache") })
        runtime.refreshCustomerEntitlements()
        assertTrue(runtime.customerEntitlements.value is MosaicCustomerEntitlementSnapshotState.Available)

        deviceNow = mosaicContractInstantMillis("2026-07-28T09:00:00.000Z")
        val check = runtime.checkCustomerEntitlement("pro")
        assertTrue(check.state is MosaicCustomerEntitlementState.Unknown)
        assertTrue((runtime.customerEntitlementDiagnostics()).clockUnreliable)
    }

    // ------------------------------------------------------------------------------------------
    // Never inactive
    // ------------------------------------------------------------------------------------------

    /** An unknown entry stays unknown; only an accepted snapshot can produce inactive. */
    @Test
    fun anUnknownEntryIsNeverReportedAsInactive() = runTest {
        val runtime = runtime({ _, _, _ -> record("unknown-state-identity-unresolved") })
        runtime.refreshCustomerEntitlements()

        val check = runtime.checkCustomerEntitlement("pro")
        val state = check.state as MosaicCustomerEntitlementState.Unknown
        assertEquals(MosaicCustomerUncertaintyReason.IDENTITY_UNRESOLVED, state.uncertainty.reason)
    }

    /**
     * Billing withheld during a retry is a real, accepted `inactive`.
     *
     * It is the counterpart to the rule above: `inactive` must remain available for the case Mosaic
     * genuinely decided, or the distinction would collapse in the other direction.
     */
    @Test
    fun anAcceptedSnapshotCanReportInactive() = runTest {
        val runtime = runtime({ _, _, _ -> record("billing-retry-access-withheld") })
        runtime.refreshCustomerEntitlements()

        val check = runtime.checkCustomerEntitlement("pro")
        assertTrue(check.state is MosaicCustomerEntitlementState.Inactive)
    }

    /** A transport outage never revokes a cache that is still inside its own window. */
    @Test
    fun aTransportOutageKeepsServingAValidCache() = runTest {
        val responses = ArrayDeque<MosaicCustomerEntitlementTransportResult>(
            listOf(
                record("bounded-offline-cache"),
                MosaicCustomerEntitlementTransportResult.Unavailable("customer.entitlements.serviceUnavailable"),
            ),
        )
        val runtime = runtime({ _, _, _ -> responses.removeFirst() })
        runtime.refreshCustomerEntitlements()

        val result = runtime.refreshCustomerEntitlements()
        assertTrue(result is MosaicCustomerEntitlementSyncResult.Unavailable)
        val check = runtime.checkCustomerEntitlement("pro")
        assertTrue(check.state is MosaicCustomerEntitlementState.Active)
    }

    // ------------------------------------------------------------------------------------------
    // Conditional requests
    // ------------------------------------------------------------------------------------------

    /**
     * A 304 preserves the snapshot, slides its window, and accepts nothing new.
     *
     * Without the slide, a device that keeps confirming the same version expires while demonstrably
     * in contact with the server — the one failure mode conditional requests are supposed to remove.
     */
    @Test
    fun notModifiedPreservesTheSnapshotAndSlidesFreshness() = runTest {
        val responses = ArrayDeque<MosaicCustomerEntitlementTransportResult>(
            listOf(
                record("bounded-offline-cache"),
                MosaicCustomerEntitlementTransportResult.NotModified(
                    entityTag = "cs-0011-v13",
                    freshness = MosaicCustomerFreshnessHeaders(
                        refreshAfter = "2026-08-05T13:00:00.000Z",
                        validUntil = "2026-08-11T12:00:00.000Z",
                        staleGraceSeconds = 86_400,
                    ),
                ),
            ),
        )
        val runtime = runtime({ _, _, _ -> responses.removeFirst() })
        runtime.refreshCustomerEntitlements()

        // Past the original validUntil, so without the slide this would be expired.
        deviceNow = mosaicContractInstantMillis("2026-08-05T12:00:00.000Z")
        val result = runtime.refreshCustomerEntitlements()

        val unchanged = result as MosaicCustomerEntitlementSyncResult.Unchanged
        assertEquals(13L, unchanged.snapshot.snapshotVersion)
        assertEquals(MosaicCustomerEntitlementCacheState.FRESH, unchanged.cacheState)
        val check = runtime.checkCustomerEntitlement("pro")
        assertTrue(check.state is MosaicCustomerEntitlementState.Active)
        assertFalse((check.state as MosaicCustomerEntitlementState.Active).isStale)
    }

    // ------------------------------------------------------------------------------------------
    // Concurrency and authorization
    // ------------------------------------------------------------------------------------------

    /** Concurrent refreshes collapse onto one request; a foreground transition and a purchase coincide often. */
    @Test
    fun concurrentRefreshesCollapseOntoOneRequest() = runTest {
        val gate = CompletableDeferred<Unit>()
        val calls = AtomicInteger()
        val tokenCalls = AtomicInteger()
        val runtime = runtime(
            transport = { _, _, _ ->
                calls.incrementAndGet()
                gate.await()
                record("bounded-offline-cache")
            },
            provider = {
                tokenCalls.incrementAndGet()
                MosaicCustomerAccessTokenResult.Issued(MosaicCustomerAccessToken("mosaic-customer-token-0001"))
            },
        )

        val refreshes = List(8) { async { runtime.refreshCustomerEntitlements() } }
        gate.complete(Unit)
        val results = refreshes.awaitAll()

        assertEquals(1, calls.get())
        assertEquals(1, tokenCalls.get())
        assertTrue(results.all { it is MosaicCustomerEntitlementSyncResult.Updated })
    }

    /**
     * A 401 forces exactly one token refresh and exactly one retry.
     *
     * More retries would turn a revoked token into a storm against the host's own backend; fewer
     * would make every ordinary token expiry look like a sign-out to the person using the app.
     */
    @Test
    fun oneRetryFollowsARefusedToken() = runTest {
        val transportCalls = AtomicInteger()
        val forced = mutableListOf<Boolean>()
        val runtime = runtime(
            transport = { _, _, _ ->
                if (transportCalls.incrementAndGet() == 1) {
                    MosaicCustomerEntitlementTransportResult.Unauthorized
                } else {
                    record("bounded-offline-cache")
                }
            },
            provider = { force ->
                forced += force
                MosaicCustomerAccessTokenResult.Issued(
                    MosaicCustomerAccessToken(if (force) "mosaic-customer-token-new1" else "mosaic-customer-token-old1"),
                )
            },
        )

        val result = runtime.refreshCustomerEntitlements()

        assertTrue(result is MosaicCustomerEntitlementSyncResult.Updated)
        assertEquals(2, transportCalls.get())
        assertEquals(listOf(false, true), forced)
    }

    /** A second refusal is authoritative: unavailable, no retry storm, and no customer switch. */
    @Test
    fun aSecondRefusalReportsUnauthorizedWithoutSwitchingCustomer() = runTest {
        val transportCalls = AtomicInteger()
        val runtime = runtime(
            transport = { _, _, _ ->
                transportCalls.incrementAndGet()
                MosaicCustomerEntitlementTransportResult.Unauthorized
            },
            provider = { _ ->
                MosaicCustomerAccessTokenResult.Issued(MosaicCustomerAccessToken("mosaic-customer-token-0001"))
            },
        )

        val result = runtime.refreshCustomerEntitlements()

        assertTrue(result is MosaicCustomerEntitlementSyncResult.Unauthorized)
        assertEquals(2, transportCalls.get())
        val state = runtime.customerEntitlements.value as MosaicCustomerEntitlementSnapshotState.Unavailable
        assertEquals(MosaicCustomerEntitlementUnavailableReason.UNAUTHORIZED, state.reason)
    }

    // ------------------------------------------------------------------------------------------
    // Identity transitions
    // ------------------------------------------------------------------------------------------

    /**
     * Signing out removes the previous customer's snapshot from memory and from disk.
     *
     * "Unreachable but present" is not sufficient: a snapshot file is a readable record of what
     * somebody paid for, on a device they may have handed to someone else.
     */
    @Test
    fun signingOutClearsEverythingObservableAndPersisted() = runTest {
        val runtime = runtime({ _, _, _ -> record("bounded-offline-cache") })
        runtime.refreshCustomerEntitlements()
        assertTrue(folder.root.walkTopDown().any { it.name == "snapshot.json" })

        runtime.signOutCustomer()

        assertSame(
            MosaicCustomerEntitlementSnapshotState.SignedOut,
            runtime.customerEntitlements.value,
        )
        assertFalse(folder.root.walkTopDown().any { it.name == "snapshot.json" })
        val check = runtime.checkCustomerEntitlement("pro")
        // Signed out is not "not entitled": there is no customer to answer about.
        assertTrue(check.state is MosaicCustomerEntitlementState.Unavailable)
    }

    /**
     * An identity change publishes `Loading` before it reads anything.
     *
     * If the previous customer's grants remained observable for even one frame after sign-in, the
     * new user would see somebody else's subscription unlock the app.
     */
    @Test
    fun identifyingPublishesLoadingBeforeAnythingIsRead() = runTest {
        val gate = CompletableDeferred<Unit>()
        val reached = CompletableDeferred<Unit>()
        val responses = ArrayDeque(listOf(record("bounded-offline-cache"), record("test-source-sandbox-grant")))
        val runtime = runtime({ _, _, _ ->
            val next = responses.removeFirst()
            if (responses.isEmpty()) {
                reached.complete(Unit)
                gate.await()
            }
            next
        })
        runtime.refreshCustomerEntitlements()
        assertTrue(runtime.customerEntitlements.value is MosaicCustomerEntitlementSnapshotState.Available)

        val identifying = async { runtime.identifyCustomer("fixture-customer-0002") }
        // Asserted once the new identity's request is genuinely in flight, so the assertion cannot
        // pass merely because the coroutine had not started yet.
        reached.await()
        assertSame(MosaicCustomerEntitlementSnapshotState.Loading, runtime.customerEntitlements.value)
        gate.complete(Unit)
        identifying.await()

        val state = runtime.customerEntitlements.value as MosaicCustomerEntitlementSnapshotState.Available
        assertEquals("fixture-customer-0002", state.snapshot.billingCustomerId)
    }

    /** A response that lands after a sign-out belongs to nobody and is never published. */
    @Test
    fun aResponseArrivingAfterSignOutIsDiscarded() = runTest {
        val gate = CompletableDeferred<Unit>()
        val reached = CompletableDeferred<Unit>()
        val runtime = runtime({ _, _, _ ->
            reached.complete(Unit)
            gate.await()
            record("bounded-offline-cache")
        })

        val inFlight = async { runtime.refreshCustomerEntitlements() }
        // The request is already on the wire when the user signs out; that is the case worth testing.
        reached.await()
        runtime.signOutCustomer()
        gate.complete(Unit)
        inFlight.await()

        assertSame(MosaicCustomerEntitlementSnapshotState.SignedOut, runtime.customerEntitlements.value)
        assertFalse(folder.root.walkTopDown().any { it.name == "snapshot.json" })
    }

    // ------------------------------------------------------------------------------------------
    // Persistence
    // ------------------------------------------------------------------------------------------

    /** A tampered cache file is discarded whole, and the result is unknown rather than inactive. */
    @Test
    fun aTamperedCacheIsDiscardedWholeAndReportsUnknown() = runTest {
        val runtime = runtime({ _, _, _ -> record("bounded-offline-cache") })
        runtime.refreshCustomerEntitlements()

        val stored = folder.root.walkTopDown().first { it.name == "snapshot.json" }
        stored.writeText(stored.readText().replace("\"snapshotVersion\":13", "\"snapshotVersion\":99"))

        val reopened = runtime({ _, _, _ -> error("A cold start must read the cache before syncing.") })
        val check = reopened.checkCustomerEntitlement("pro")

        assertTrue(check.state is MosaicCustomerEntitlementState.Unknown)
        assertEquals(MosaicCustomerEntitlementCacheState.INVALID, check.cacheState)
    }

    /** A cold start serves the persisted snapshot without any network at all. */
    @Test
    fun aColdStartServesThePersistedSnapshot() = runTest {
        runtime({ _, _, _ -> record("bounded-offline-cache") }).refreshCustomerEntitlements()

        val reopened = runtime({ _, _, _ -> error("A cold start must read the cache before syncing.") })
        val check = reopened.checkCustomerEntitlement("pro")

        assertTrue(check.state is MosaicCustomerEntitlementState.Active)
        assertEquals(13L, check.snapshotVersion)
    }
}

/**
 * The feature is off unless the host opted in, and being off is never an answer about a person.
 *
 * This is the row that protects every existing application: an app that never heard of authoritative
 * entitlements must keep behaving exactly as it did, and must never have a customer's access
 * silently reported as inactive because Mosaic Billing was not configured.
 */
class CustomerEntitlementWiringTest {
    private val client = MosaicHostedConfigurationClient(
        transport = MosaicConfigurationTransport { MosaicConfigurationResponse.NotModified },
        cache = object : MosaicConfigurationCache {
            override suspend fun read(): MosaicCachedConfiguration? = null
            override suspend fun write(value: MosaicCachedConfiguration) = Unit
        },
    )

    @Test
    fun anUnconfiguredClientReportsUnavailableEverywhereAndNeverInactive() = runTest {
        val state = client.customerEntitlements.value as MosaicCustomerEntitlementSnapshotState.Unavailable
        assertEquals(MosaicCustomerEntitlementUnavailableReason.NOT_CONFIGURED, state.reason)

        val check = client.checkCustomerEntitlement("pro")
        assertTrue(check.state is MosaicCustomerEntitlementState.Unavailable)

        val refreshed = client.refreshCustomerEntitlements()
        assertEquals(
            MosaicCustomerEntitlementUnavailableReason.NOT_CONFIGURED,
            (refreshed as MosaicCustomerEntitlementSyncResult.Unavailable).reason,
        )

        assertFalse(client.customerEntitlementDiagnostics().configured)
        assertTrue(
            client.restoreAndSyncCustomerEntitlements() is MosaicCustomerSyncResult.CustomerUnavailable,
        )
        // Signing out an unconfigured client is a no-op rather than an error.
        client.signOutCustomer()
    }

    @Test
    fun theProviderObservedCommerceApiIsUnchanged() {
        // Authoritative entitlements are purely additive: the frozen provider-observed result type
        // still exists with its own vocabulary, and nothing above renamed or deprecated it.
        val provider = MockMosaicPurchaseProvider(MockMosaicPurchaseProvider.phase1Products())
        assertTrue(provider is MosaicPurchaseProvider)
    }
}
