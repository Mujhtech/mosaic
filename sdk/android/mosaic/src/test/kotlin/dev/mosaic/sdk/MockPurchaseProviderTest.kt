package dev.mosaic.sdk

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MockPurchaseProviderTest {
    @Test
    fun mockProviderReturnsExplicitCommerceResults() = runTest {
        val provider = MockMosaicPurchaseProvider(
            products = MockMosaicPurchaseProvider.phase1Products(),
        )

        val load = provider.loadProducts(listOf("mosaic_pro_yearly"))
        assertTrue(load is MosaicProductLoadResult.Loaded)
        assertEquals("$79.99", (load as MosaicProductLoadResult.Loaded).products.single().localizedPrice)

        assertTrue(provider.purchase("mosaic_pro_yearly") is MosaicPurchaseResult.Purchased)
        assertTrue(provider.purchase("mosaic_pro_yearly") is MosaicPurchaseResult.AlreadyEntitled)
        assertTrue(provider.restore() is MosaicRestoreResult.Restored)
        assertTrue(provider.activeEntitlements() is MosaicActiveEntitlementsResult.Active)
    }

    @Test
    fun partialProductLoadsKeepAvailableStoreData() = runTest {
        val provider = MockMosaicPurchaseProvider(
            products = MockMosaicPurchaseProvider.phase1Products().take(1),
        )

        val result = provider.loadProducts(
            listOf("mosaic_pro_monthly", "mosaic_pro_yearly"),
        ) as MosaicProductLoadResult.Loaded

        assertEquals(listOf("mosaic_pro_monthly"), result.products.map { it.id })
        assertEquals(setOf("mosaic_pro_yearly"), result.unavailableProductIds)
    }

    @Test
    fun scenariosCoverCancellationFailureUnavailableAndRestoreStates() = runTest {
        val product = MockMosaicPurchaseProvider.phase1Products().first()

        assertTrue(
            MockMosaicPurchaseProvider(
                listOf(product),
                purchaseScenario = MosaicMockPurchaseScenario.CANCELLED,
            ).purchase(product.id) is MosaicPurchaseResult.Cancelled,
        )
        assertTrue(
            MockMosaicPurchaseProvider(
                listOf(product),
                purchaseScenario = MosaicMockPurchaseScenario.FAILURE,
            ).purchase(product.id) is MosaicPurchaseResult.Failed,
        )
        assertTrue(
            MockMosaicPurchaseProvider(
                listOf(product),
                purchaseScenario = MosaicMockPurchaseScenario.PRODUCT_UNAVAILABLE,
            ).purchase(product.id) is MosaicPurchaseResult.ProductUnavailable,
        )
        assertTrue(
            MockMosaicPurchaseProvider(
                restoreScenario = MosaicMockRestoreScenario.RESTORED,
            ).restore() is MosaicRestoreResult.Restored,
        )
        assertTrue(
            MockMosaicPurchaseProvider(
                restoreScenario = MosaicMockRestoreScenario.ALREADY_ENTITLED,
            ).restore() is MosaicRestoreResult.AlreadyEntitled,
        )
        assertEquals(
            MosaicRestoreResult.NothingToRestore,
            MockMosaicPurchaseProvider(
                restoreScenario = MosaicMockRestoreScenario.NOTHING_TO_RESTORE,
            ).restore(),
        )
        assertTrue(
            MockMosaicPurchaseProvider(
                restoreScenario = MosaicMockRestoreScenario.FAILURE,
            ).restore() is MosaicRestoreResult.Failed,
        )
    }
}
