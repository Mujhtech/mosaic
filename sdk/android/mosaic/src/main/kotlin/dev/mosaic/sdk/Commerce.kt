package dev.mosaic.sdk

data class MosaicProduct(
    val id: String,
    val title: String,
    val localizedPrice: String,
)

data class MosaicEntitlement(val id: String)

sealed interface MosaicProductLoadResult {
    data class Loaded(val products: List<MosaicProduct>) : MosaicProductLoadResult

    data class Unavailable(
        val productIds: List<String>,
        val message: String? = null,
    ) : MosaicProductLoadResult
}

sealed interface MosaicPurchaseResult {
    data class Purchased(
        val productId: String,
        val transactionId: String,
    ) : MosaicPurchaseResult

    data class AlreadyEntitled(val productId: String) : MosaicPurchaseResult
    data class Cancelled(val productId: String) : MosaicPurchaseResult
    data class ProductUnavailable(val productId: String) : MosaicPurchaseResult

    data class Failed(
        val productId: String,
        val message: String,
    ) : MosaicPurchaseResult
}

sealed interface MosaicRestoreResult {
    data class Restored(val entitlements: Set<MosaicEntitlement>) : MosaicRestoreResult
    data object NothingToRestore : MosaicRestoreResult
    data class Failed(val message: String) : MosaicRestoreResult
}

sealed interface MosaicActiveEntitlementsResult {
    data class Active(val entitlements: Set<MosaicEntitlement>) : MosaicActiveEntitlementsResult
    data class Unavailable(val message: String) : MosaicActiveEntitlementsResult
}

/** Implemented by RevenueCat, Play Billing, or app-owned purchase adapters. */
interface MosaicPurchaseProvider {
    suspend fun loadProducts(productIds: List<String>): MosaicProductLoadResult
    suspend fun purchase(productId: String): MosaicPurchaseResult
    suspend fun restore(): MosaicRestoreResult
    suspend fun activeEntitlements(): MosaicActiveEntitlementsResult
}
