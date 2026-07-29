package dev.mosaic.sdk

import com.google.gson.JsonParser
import java.nio.file.Files
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class CustomerRestoreSyncTest {
    @get:Rule
    val folder = TemporaryFolder()

    private var deviceNow: Long? = mosaicContractInstantMillis("2026-07-28T12:01:00.000Z")

    private fun fixture(name: String): String =
        Files.readAllBytes(
            repositoryFile("protocol/fixtures/authoritative-entitlement/v1/snapshots/$name.json"),
        ).toString(Charsets.UTF_8)

    private fun record(name: String) = MosaicCustomerEntitlementTransportResult.Record(
        body = fixture(name),
        entityTag = JsonParser.parseString(fixture(name))
            .asJsonObject.getAsJsonObject("payload").get("entityTag").asString,
        freshness = null,
    )

    private fun runtime(transport: MosaicCustomerEntitlementTransport) = MosaicCustomerEntitlementRuntime(
        transport = transport,
        cache = MosaicCustomerEntitlementCache(folder.root),
        session = MosaicCustomerTokenSession({
            MosaicCustomerAccessTokenResult.Issued(MosaicCustomerAccessToken("mosaic-customer-token-0001"))
        }),
        trustedTime = { deviceNow },
    )

    private fun restoringProvider(result: MosaicRestoreResult) = object : MosaicPurchaseProvider {
        override suspend fun loadProducts(productIds: List<String>) =
            MosaicProductLoadResult.Loaded(emptyList())
        override suspend fun purchase(productId: String) = MosaicPurchaseResult.Cancelled(productId)
        override suspend fun restore(): MosaicRestoreResult = result
        override suspend fun activeEntitlements() =
            MosaicActiveEntitlementsResult.Available(emptySet())
    }

    private fun detailedRestore(outcome: MosaicCommerceRecoveryOutcome) = MosaicRestoreResult.Detailed(
        outcome = outcome,
        entitlements = emptySet(),
        metadata = MosaicCommerceRecoveryMetadata(
            operationId = "operation-0001",
            providerId = "google_play",
            recoveryMode = "query_purchases",
            completedAt = "2026-07-28T12:01:00.000Z",
            diagnostics = emptyList(),
        ),
    )

    /**
     * A native recovery that Mosaic has not validated is never reported as restored.
     *
     * Reporting success here is the failure mode worth preventing: the person is told their purchase
     * came back, the app asks Mosaic a moment later, and Mosaic answers `unknown`.
     */
    @Test
    fun anUnvalidatedRecoveryReportsValidationPending() = runTest {
        val syncs = AtomicInteger()
        val runtime = runtime({ _, _, _ ->
            syncs.incrementAndGet()
            record("bounded-offline-cache")
        })
        // The first accepted snapshot is the state the restore starts from.
        runtime.refreshCustomerEntitlements()

        val result = mosaicRestoreAndSyncCustomerEntitlements(
            runtime,
            restoringProvider(detailedRestore(MosaicCommerceRecoveryOutcome.RESTORED)),
        )

        assertTrue(result is MosaicCustomerSyncResult.NativeRecoveryCompleted)
        assertTrue((result as MosaicCustomerSyncResult.NativeRecoveryCompleted).validationPending)
        // Bounded: three attempts, not an open-ended wait behind a restore button.
        assertEquals(1 + MOSAIC_CUSTOMER_RESTORE_POLL_ATTEMPTS, syncs.get())
    }

    /** Success requires an accepted snapshot that actually advanced past the pre-restore version. */
    @Test
    fun anAcceptedNewerSnapshotReportsAuthoritativeUpdate() = runTest {
        val responses = ArrayDeque(listOf(record("bounded-offline-cache"), record("newer-snapshot")))
        val runtime = runtime({ _, _, _ -> responses.removeFirst() })
        runtime.refreshCustomerEntitlements()
        deviceNow = mosaicContractInstantMillis("2026-07-28T14:01:00.000Z")

        val result = mosaicRestoreAndSyncCustomerEntitlements(
            runtime,
            restoringProvider(detailedRestore(MosaicCommerceRecoveryOutcome.RESTORED)),
        )

        val updated = result as MosaicCustomerSyncResult.AuthoritativeEntitlementsUpdated
        assertEquals(14L, updated.snapshot.snapshotVersion)
        assertEquals(MosaicCustomerRestoreProviderOutcome.COMPLETED, updated.providerOutcome)
    }

    /** A cancelled restore neither syncs nor reports anything about entitlement. */
    @Test
    fun aCancelledRestoreDoesNotSync() = runTest {
        val runtime = runtime({ _, _, _ -> error("A cancelled restore must not reach the network.") })
        val result = mosaicRestoreAndSyncCustomerEntitlements(
            runtime,
            restoringProvider(detailedRestore(MosaicCommerceRecoveryOutcome.CANCELLED)),
        )
        assertTrue(result is MosaicCustomerSyncResult.Cancelled)
    }

    /** A provider that found nothing still gets one sync, because another device may have bought. */
    @Test
    fun nothingToRestoreStillSynchronizesOnce() = runTest {
        val syncs = AtomicInteger()
        val runtime = runtime({ _, _, _ ->
            syncs.incrementAndGet()
            record("bounded-offline-cache")
        })
        runtime.refreshCustomerEntitlements()

        val result = mosaicRestoreAndSyncCustomerEntitlements(
            runtime,
            restoringProvider(detailedRestore(MosaicCommerceRecoveryOutcome.NOTHING_TO_RESTORE)),
        )

        assertTrue(result is MosaicCustomerSyncResult.NoAdditionalPurchases)
        assertEquals(2, syncs.get())
    }

    /**
     * A hung entitlement endpoint must never back-pressure the purchase path.
     *
     * The adapter emits its commerce updates into this collector, so if the collector could suspend
     * the emitter, a hung Mosaic endpoint would stall a purchase — the one thing an entitlement
     * refresh is never allowed to cost.
     */
    @Test
    fun aHungTransportNeverBlocksPurchaseUpdates() = runTest {
        val hang = CompletableDeferred<Unit>()
        val scope = TestScope(UnconfinedTestDispatcher(testScheduler))
        val runtime = runtime({ _, _, _ ->
            hang.await()
            record("bounded-offline-cache")
        })
        val refresher = MosaicCustomerPurchaseRefresh(runtime, debounceMillis = 10, scope = scope)
        val updates = MutableSharedFlow<MosaicCommerceUpdate>()
        refresher.collect(updates)
        runCurrent()

        val emitting = async {
            withTimeout(5_000) {
                repeat(200) { index -> updates.emit(update(index)) }
            }
        }
        scope.advanceTimeBy(1_000)
        runCurrent()

        // Every emission completed while the refresh is still stuck inside the transport.
        emitting.await()
        assertTrue(hang.isActive || !hang.isCompleted)
        hang.complete(Unit)
        refresher.close()
    }

    private fun update(index: Int) = MosaicCommerceUpdate(
        updateId = "update-$index",
        operationId = "operation-$index",
        providerId = "google_play",
        mosaicProductId = "product-pro-monthly",
        configuration = MosaicCommerceConfigurationReference("configuration-0001", "revision-0001"),
        outcome = MosaicCommerceUpdateOutcome.PURCHASED,
        transactionReference = "sha256:${"0".repeat(64)}",
        activeEntitlements = emptySet(),
        occurredAt = "2026-07-28T12:01:00.000Z",
    )
}
