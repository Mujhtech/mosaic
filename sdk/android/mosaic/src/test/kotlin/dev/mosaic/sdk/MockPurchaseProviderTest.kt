package dev.mosaic.sdk

import kotlin.coroutines.Continuation
import kotlin.coroutines.EmptyCoroutineContext
import kotlin.coroutines.startCoroutine
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MockPurchaseProviderTest {
    @Test
    fun mockProviderReturnsExplicitCommerceResults() = runImmediateSuspend {
        val provider = MockMosaicPurchaseProvider(
            products = listOf(
                MosaicProduct(
                    id = "mosaic_pro_yearly",
                    title = "Mosaic Pro Yearly",
                    localizedPrice = "$49.99",
                ),
            ),
        )

        val load = provider.loadProducts(listOf("mosaic_pro_yearly"))
        assertTrue(load is MosaicProductLoadResult.Loaded)

        val purchase = provider.purchase("mosaic_pro_yearly")
        assertTrue(purchase is MosaicPurchaseResult.Purchased)

        val repeated = provider.purchase("mosaic_pro_yearly")
        assertTrue(repeated is MosaicPurchaseResult.AlreadyEntitled)

        val restore = provider.restore()
        assertTrue(restore is MosaicRestoreResult.Restored)

        val active = provider.activeEntitlements()
        assertTrue(active is MosaicActiveEntitlementsResult.Active)
    }

    @Test
    fun mockProviderReportsUnavailableAndEmptyStates() = runImmediateSuspend {
        val provider = MockMosaicPurchaseProvider()

        assertTrue(
            provider.loadProducts(listOf("missing")) is MosaicProductLoadResult.Unavailable,
        )
        assertTrue(provider.purchase("missing") is MosaicPurchaseResult.ProductUnavailable)
        assertEquals(MosaicRestoreResult.NothingToRestore, provider.restore())
    }
}

/** The Phase 0 mock does not suspend internally, so no coroutine runtime is required in tests. */
private fun <T> runImmediateSuspend(block: suspend () -> T): T {
    var outcome: Result<T>? = null
    block.startCoroutine(
        object : Continuation<T> {
            override val context = EmptyCoroutineContext

            override fun resumeWith(result: Result<T>) {
                outcome = result
            }
        },
    )
    return checkNotNull(outcome) { "The Phase 0 mock unexpectedly suspended." }.getOrThrow()
}
