package dev.mosaic.sdk.revenuecat

import android.app.Activity
import com.revenuecat.purchases.PurchasesErrorCode
import dev.mosaic.sdk.MosaicCommerceAdapterMapping
import dev.mosaic.sdk.MosaicCommerceEntitlementMapping
import dev.mosaic.sdk.MosaicCommerceProductMapping
import dev.mosaic.sdk.MosaicProductLoadResult
import dev.mosaic.sdk.MosaicPurchaseResult
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MosaicRevenueCatAdapterTest {
    @Test
    fun `reports Mosaic RevenueCat adapter identity separately from native SDK version`() {
        val adapter = MosaicRevenueCatAdapter(FakeBridge()) { Activity() }

        assertEquals("revenuecat", adapter.identity.id)
        assertEquals("1.0.0", adapter.identity.adapterVersion)
    }

    @Test
    fun `loads exact direct and package mappings without guessing`() = runTest {
        val bridge = FakeBridge()
        val adapter = MosaicRevenueCatAdapter(bridge) { Activity() }
        val mappings = listOf(
            mapping(
                "product_monthly",
                "mapping_monthly",
                "store.monthly",
                MosaicCommerceAdapterMapping.DirectProduct,
            ),
            mapping(
                "product_yearly",
                "mapping_yearly",
                "store.yearly",
                MosaicCommerceAdapterMapping.RevenueCatPackage(
                    "default",
                    "\$rc_annual",
                ),
            ),
        )

        val result = adapter.loadProducts(mappings) as MosaicProductLoadResult.Loaded

        assertEquals(listOf("product_monthly", "product_yearly"), result.products.map { it.id })
        assertEquals(mappings, bridge.loadedMappings)
        assertTrue(result.unavailableProductIds.isEmpty())
    }

    @Test
    fun `purchase maps active provider entitlements and never exposes provider identity`() = runTest {
        val bridge = FakeBridge(
            purchaseResult = RevenueCatPurchaseBridgeResult.Success(
                transactionId = "order-safe-1",
                pending = false,
                activeProviderEntitlements = setOf("premium_access"),
            ),
        )
        val adapter = MosaicRevenueCatAdapter(bridge) { Activity() }
        val mapping = mapping(
            "product_monthly",
            "mapping_monthly",
            "store.monthly",
            MosaicCommerceAdapterMapping.DirectProduct,
        )
        adapter.loadProducts(listOf(mapping))

        val result = adapter.purchase(
            mapping,
            listOf(MosaicCommerceEntitlementMapping("pro", "premium_access")),
        ) as MosaicPurchaseResult.Purchased

        assertEquals("product_monthly", result.productId)
        assertEquals("order-safe-1", result.transactionId)
        assertEquals(setOf("pro"), result.entitlements.map { it.id }.toSet())
    }

    @Test
    fun `normalizes cancellation pending already-entitled unavailable and failure`() = runTest {
        assertTrue(
            normalizePurchaseError(
                PurchasesErrorCode.UnknownError,
                userCancelled = true,
            ) is RevenueCatPurchaseBridgeResult.Cancelled,
        )
        assertTrue(
            normalizePurchaseError(
                PurchasesErrorCode.PaymentPendingError,
                userCancelled = false,
            ) is RevenueCatPurchaseBridgeResult.Pending,
        )
        val entitled = normalizePurchaseError(
            PurchasesErrorCode.ProductAlreadyPurchasedError,
            userCancelled = false,
        ) { setOf("pro") } as RevenueCatPurchaseBridgeResult.AlreadyEntitled
        assertEquals(setOf("pro"), entitled.activeProviderEntitlements)
        assertTrue(
            normalizePurchaseError(
                PurchasesErrorCode.ProductNotAvailableForPurchaseError,
                userCancelled = false,
            ) is RevenueCatPurchaseBridgeResult.ProductUnavailable,
        )
        assertTrue(
            normalizePurchaseError(
                PurchasesErrorCode.NetworkError,
                userCancelled = false,
            ) is RevenueCatPurchaseBridgeResult.ProviderUnavailable,
        )
        assertTrue(
            normalizePurchaseError(
                PurchasesErrorCode.OperationAlreadyInProgressError,
                userCancelled = false,
            ) is RevenueCatPurchaseBridgeResult.Failed,
        )
        assertTrue(
            normalizeEntitlementError(PurchasesErrorCode.NetworkError) is
                RevenueCatEntitlementsBridgeResult.ProviderUnavailable,
        )
        assertTrue(
            normalizeEntitlementError(PurchasesErrorCode.OperationAlreadyInProgressError) is
                RevenueCatEntitlementsBridgeResult.Failed,
        )
    }

    @Test
    fun `package selector rejects wrong product and ambiguous matches`() {
        val candidates = listOf(
            "\$rc_annual" to "store.yearly",
            "\$rc_monthly" to "store.monthly",
        )
        assertEquals(
            0,
            selectExactRevenueCatPackageIndex(
                candidates,
                "\$rc_annual",
                "store.yearly",
            ),
        )
        assertNull(
            selectExactRevenueCatPackageIndex(
                candidates,
                "\$rc_annual",
                "different.product",
            ),
        )
        assertNull(
            selectExactRevenueCatPackageIndex(
                candidates + ("\$rc_annual" to "store.yearly"),
                "\$rc_annual",
                "store.yearly",
            ),
        )
    }

    @Test
    fun `failed reload clears stale purchase handles`() = runTest {
        val bridge = FakeBridge()
        val adapter = MosaicRevenueCatAdapter(bridge) { Activity() }
        val mapping = mapping(
            "product_monthly",
            "mapping_monthly",
            "store.monthly",
            MosaicCommerceAdapterMapping.DirectProduct,
        )
        adapter.loadProducts(listOf(mapping))
        bridge.failLoads = true
        assertTrue(adapter.loadProducts(listOf(mapping)) is MosaicProductLoadResult.Unavailable)

        assertTrue(
            adapter.purchase(mapping, emptyList()) is MosaicPurchaseResult.ProductUnavailable,
        )
    }

    @Test
    fun `configuration invalidation wins a concurrent stale product load`() = runTest {
        val loadStarted = CompletableDeferred<Unit>()
        val releaseLoad = CompletableDeferred<Unit>()
        val bridge = FakeBridge(
            purchaseResult = RevenueCatPurchaseBridgeResult.Success(
                transactionId = "transaction-new",
                pending = false,
                activeProviderEntitlements = emptySet(),
            ),
            loadStarted = loadStarted,
            releaseLoad = releaseLoad,
        )
        val adapter = MosaicRevenueCatAdapter(bridge) { Activity() }
        val stale = mapping(
            "product_monthly",
            "mapping_stale",
            "store.monthly.old",
            MosaicCommerceAdapterMapping.DirectProduct,
        )
        val current = mapping(
            "product_monthly",
            "mapping_current",
            "store.monthly.new",
            MosaicCommerceAdapterMapping.DirectProduct,
        )

        val staleLoad = async { adapter.loadProducts(listOf(stale)) }
        loadStarted.await()
        adapter.invalidateProductHandles()
        releaseLoad.complete(Unit)

        assertTrue(staleLoad.await() is MosaicProductLoadResult.Unavailable)
        assertTrue(
            adapter.purchase(current, emptyList()) is MosaicPurchaseResult.ProductUnavailable,
        )

        bridge.releaseLoad = null
        assertTrue(adapter.loadProducts(listOf(current)) is MosaicProductLoadResult.Loaded)
        assertTrue(adapter.purchase(current, emptyList()) is MosaicPurchaseResult.Purchased)
    }

    private fun mapping(
        productId: String,
        mappingId: String,
        providerReference: String,
        detail: MosaicCommerceAdapterMapping,
    ) = MosaicCommerceProductMapping(
        mosaicProductId = productId,
        mappingId = mappingId,
        providerProductReference = providerReference,
        adapterMapping = detail,
    )

    private class FakeBridge(
        var purchaseResult: RevenueCatPurchaseBridgeResult =
            RevenueCatPurchaseBridgeResult.Failed,
        private val loadStarted: CompletableDeferred<Unit>? = null,
        var releaseLoad: CompletableDeferred<Unit>? = null,
    ) : RevenueCatBridge {
        var loadedMappings: List<MosaicCommerceProductMapping> = emptyList()
        var failLoads = false

        override suspend fun loadProducts(
            mappings: List<MosaicCommerceProductMapping>,
        ): Map<String, RevenueCatProductHandle> {
            loadStarted?.complete(Unit)
            releaseLoad?.await()
            if (failLoads) error("simulated")
            loadedMappings = mappings
            return mappings.associate { mapping ->
                mapping.mappingId to RevenueCatProductHandle(
                    mapping.mappingId,
                    mapping.mosaicProductId,
                    "\$9.99",
                    "P1M",
                    "USD",
                    mapping.mappingId,
                )
            }
        }

        override suspend fun purchase(
            activity: Activity,
            handle: RevenueCatProductHandle,
        ): RevenueCatPurchaseBridgeResult = purchaseResult

        override suspend fun restore(): RevenueCatEntitlementsBridgeResult =
            RevenueCatEntitlementsBridgeResult.Available(emptySet())

        override suspend fun activeEntitlements(): RevenueCatEntitlementsBridgeResult =
            RevenueCatEntitlementsBridgeResult.Available(emptySet())
    }
}
