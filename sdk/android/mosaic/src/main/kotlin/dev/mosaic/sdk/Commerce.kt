package dev.mosaic.sdk

/** Runtime store data keyed by the opaque provider product ID from the protocol. */
data class MosaicProduct(
    val id: String,
    val title: String,
    val localizedPrice: String,
    val subscriptionPeriod: String? = null,
)

data class MosaicEntitlement(val id: String)

sealed interface MosaicProductLoadResult {
    /** Supports partial availability; unavailable products are omitted by the renderer. */
    data class Loaded(
        val products: List<MosaicProduct>,
        val unavailableProductIds: Set<String> = emptySet(),
    ) : MosaicProductLoadResult

    data class Unavailable(
        val productIds: List<String>,
        val diagnosticCode: String = MosaicDiagnosticCode.PRODUCT_LOAD_FAILED.wireName,
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
        val diagnosticCode: String = MosaicDiagnosticCode.PURCHASE_FAILED.wireName,
    ) : MosaicPurchaseResult
}

sealed interface MosaicRestoreResult {
    data class Restored(val entitlements: Set<MosaicEntitlement>) : MosaicRestoreResult
    data class AlreadyEntitled(val entitlements: Set<MosaicEntitlement>) : MosaicRestoreResult
    data object NothingToRestore : MosaicRestoreResult

    data class Failed(
        val diagnosticCode: String = MosaicDiagnosticCode.RESTORE_FAILED.wireName,
    ) : MosaicRestoreResult
}

sealed interface MosaicActiveEntitlementsResult {
    data class Active(val entitlements: Set<MosaicEntitlement>) : MosaicActiveEntitlementsResult
    data class Unavailable(val diagnosticCode: String) : MosaicActiveEntitlementsResult
}

/** Implemented later by RevenueCat, Play Billing, or app-owned adapters; Phase 1 uses mocks only. */
interface MosaicPurchaseProvider {
    suspend fun loadProducts(productIds: List<String>): MosaicProductLoadResult

    suspend fun purchase(productId: String): MosaicPurchaseResult

    suspend fun restore(): MosaicRestoreResult

    suspend fun activeEntitlements(): MosaicActiveEntitlementsResult
}
