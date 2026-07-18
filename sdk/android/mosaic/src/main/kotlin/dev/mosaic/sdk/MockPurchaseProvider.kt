package dev.mosaic.sdk

enum class MosaicMockPurchaseScenario {
    SUCCESS,
    CANCELLED,
    FAILURE,
    PRODUCT_UNAVAILABLE,
    ALREADY_ENTITLED,
}

enum class MosaicMockRestoreScenario {
    AUTOMATIC,
    RESTORED,
    ALREADY_ENTITLED,
    NOTHING_TO_RESTORE,
    FAILURE,
}

/** Deterministic provider for examples and tests; it never talks to a store. */
class MockMosaicPurchaseProvider(
    products: List<MosaicProduct> = emptyList(),
    activeEntitlements: Set<MosaicEntitlement> = emptySet(),
    private val purchaseScenario: MosaicMockPurchaseScenario = MosaicMockPurchaseScenario.SUCCESS,
    private val restoreScenario: MosaicMockRestoreScenario = MosaicMockRestoreScenario.AUTOMATIC,
    private val restoredEntitlements: Set<MosaicEntitlement> = setOf(MosaicEntitlement("mosaic-pro")),
) : MosaicPurchaseProvider {
    private val lock = Any()
    private val productsById = products.associateBy(MosaicProduct::id)
    private val entitlements = activeEntitlements.toMutableSet()

    override suspend fun loadProducts(productIds: List<String>): MosaicProductLoadResult =
        synchronized(lock) {
            val loaded = productIds.mapNotNull(productsById::get)
            val missing = productIds.filterNot(productsById::containsKey)
            if (loaded.isEmpty() && missing.isNotEmpty()) {
                MosaicProductLoadResult.Unavailable(productIds = missing)
            } else {
                MosaicProductLoadResult.Loaded(
                    products = loaded,
                    unavailableProductIds = missing.toSet(),
                )
            }
        }

    override suspend fun purchase(productId: String): MosaicPurchaseResult = synchronized(lock) {
        if (!productsById.containsKey(productId)) {
            return@synchronized MosaicPurchaseResult.ProductUnavailable(productId)
        }
        when (purchaseScenario) {
            MosaicMockPurchaseScenario.SUCCESS -> {
                val entitlement = MosaicEntitlement(productId)
                if (!entitlements.add(entitlement)) {
                    MosaicPurchaseResult.AlreadyEntitled(productId)
                } else {
                    MosaicPurchaseResult.Purchased(
                        productId = productId,
                        transactionId = "mock-$productId",
                    )
                }
            }
            MosaicMockPurchaseScenario.CANCELLED -> MosaicPurchaseResult.Cancelled(productId)
            MosaicMockPurchaseScenario.FAILURE -> MosaicPurchaseResult.Failed(productId)
            MosaicMockPurchaseScenario.PRODUCT_UNAVAILABLE ->
                MosaicPurchaseResult.ProductUnavailable(productId)
            MosaicMockPurchaseScenario.ALREADY_ENTITLED ->
                MosaicPurchaseResult.AlreadyEntitled(productId)
        }
    }

    override suspend fun restore(): MosaicRestoreResult = synchronized(lock) {
        when (restoreScenario) {
            MosaicMockRestoreScenario.AUTOMATIC -> {
                if (entitlements.isEmpty()) {
                    MosaicRestoreResult.NothingToRestore
                } else {
                    MosaicRestoreResult.Restored(entitlements.toSet())
                }
            }
            MosaicMockRestoreScenario.RESTORED -> {
                entitlements += restoredEntitlements
                MosaicRestoreResult.Restored(restoredEntitlements)
            }
            MosaicMockRestoreScenario.ALREADY_ENTITLED -> {
                entitlements += restoredEntitlements
                MosaicRestoreResult.AlreadyEntitled(restoredEntitlements)
            }
            MosaicMockRestoreScenario.NOTHING_TO_RESTORE -> MosaicRestoreResult.NothingToRestore
            MosaicMockRestoreScenario.FAILURE -> MosaicRestoreResult.Failed()
        }
    }

    override suspend fun activeEntitlements(): MosaicActiveEntitlementsResult = synchronized(lock) {
        MosaicActiveEntitlementsResult.Active(entitlements.toSet())
    }

    companion object {
        fun phase1Products(): List<MosaicProduct> = listOf(
            MosaicProduct(
                id = "mosaic_pro_monthly",
                title = "Mosaic Pro Monthly",
                localizedPrice = "$9.99",
                subscriptionPeriod = "month",
            ),
            MosaicProduct(
                id = "mosaic_pro_yearly",
                title = "Mosaic Pro Yearly",
                localizedPrice = "$79.99",
                subscriptionPeriod = "year",
            ),
            MosaicProduct(
                id = "mosaic_pro_lifetime",
                title = "Mosaic Pro Lifetime",
                localizedPrice = "$199.99",
            ),
        )
    }
}
