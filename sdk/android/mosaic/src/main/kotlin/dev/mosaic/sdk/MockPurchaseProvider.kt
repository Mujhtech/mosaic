package dev.mosaic.sdk

/** Deterministic provider for examples and tests; it never talks to a store. */
class MockMosaicPurchaseProvider(
    products: List<MosaicProduct> = emptyList(),
    activeEntitlements: Set<MosaicEntitlement> = emptySet(),
) : MosaicPurchaseProvider {
    private val lock = Any()
    private val productsById = products.associateBy(MosaicProduct::id)
    private val entitlements = activeEntitlements.toMutableSet()

    override suspend fun loadProducts(productIds: List<String>): MosaicProductLoadResult =
        synchronized(lock) {
            val missing = productIds.filterNot(productsById::containsKey)
            if (missing.isNotEmpty()) {
                MosaicProductLoadResult.Unavailable(
                    productIds = missing,
                    message = "One or more mock products are unavailable.",
                )
            } else {
                MosaicProductLoadResult.Loaded(productIds.mapNotNull(productsById::get))
            }
        }

    override suspend fun purchase(productId: String): MosaicPurchaseResult = synchronized(lock) {
        if (!productsById.containsKey(productId)) {
            return@synchronized MosaicPurchaseResult.ProductUnavailable(productId)
        }
        val entitlement = MosaicEntitlement(productId)
        if (!entitlements.add(entitlement)) {
            return@synchronized MosaicPurchaseResult.AlreadyEntitled(productId)
        }
        MosaicPurchaseResult.Purchased(
            productId = productId,
            transactionId = "mock-$productId",
        )
    }

    override suspend fun restore(): MosaicRestoreResult = synchronized(lock) {
        if (entitlements.isEmpty()) {
            MosaicRestoreResult.NothingToRestore
        } else {
            MosaicRestoreResult.Restored(entitlements.toSet())
        }
    }

    override suspend fun activeEntitlements(): MosaicActiveEntitlementsResult = synchronized(lock) {
        MosaicActiveEntitlementsResult.Active(entitlements.toSet())
    }
}
