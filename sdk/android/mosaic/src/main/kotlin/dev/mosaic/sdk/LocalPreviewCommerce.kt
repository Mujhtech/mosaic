package dev.mosaic.sdk

/** Mutable, thread-safe mock provider driven only by Local Preview commerce messages. */
class MosaicLocalPreviewPurchaseProvider : MosaicPurchaseProvider {
    private data class Snapshot(
        val document: MosaicPaywallDocument,
        val state: MosaicPreviewMockCommerceState,
    )

    @Volatile
    private var snapshot: Snapshot? = null

    internal fun update(document: MosaicPaywallDocument, state: MosaicPreviewMockCommerceState) {
        snapshot = Snapshot(document, state)
    }

    internal fun clear() {
        snapshot = null
    }

    override suspend fun loadProducts(productIds: List<String>): MosaicProductLoadResult {
        val current = snapshot ?: return MosaicProductLoadResult.Unavailable(productIds)
        val referencesByProviderId = current.document.products.associateBy(MosaicProductReference::providerProductId)
        val mockByReference = current.state.products.associateBy(MosaicPreviewMockProduct::productReferenceId)
        val loaded = mutableListOf<MosaicProduct>()
        val unavailable = mutableSetOf<String>()
        productIds.forEach { providerId ->
            val reference = referencesByProviderId[providerId]
            when (val mock = reference?.let { mockByReference[it.id] }) {
                is MosaicPreviewMockProduct.AvailableSubscription -> loaded += MosaicProduct(
                    id = providerId,
                    title = reference.label.defaultValue,
                    localizedPrice = mock.localizedPrice,
                    subscriptionPeriod = mock.billingPeriod.displayValue(),
                )
                is MosaicPreviewMockProduct.AvailableNonConsumable -> loaded += MosaicProduct(
                    id = providerId,
                    title = reference.label.defaultValue,
                    localizedPrice = mock.localizedPrice,
                )
                is MosaicPreviewMockProduct.Unavailable, null -> unavailable += providerId
            }
        }
        return if (loaded.isEmpty() && unavailable.isNotEmpty()) {
            MosaicProductLoadResult.Unavailable(unavailable.toList())
        } else {
            MosaicProductLoadResult.Loaded(loaded, unavailable)
        }
    }

    override suspend fun purchase(productId: String): MosaicPurchaseResult {
        val current = snapshot ?: return MosaicPurchaseResult.ProductUnavailable(productId)
        val reference = current.document.products.firstOrNull { it.providerProductId == productId }
            ?: return MosaicPurchaseResult.ProductUnavailable(productId)
        val product = current.state.products.firstOrNull { it.productReferenceId == reference.id }
        if (product == null || product is MosaicPreviewMockProduct.Unavailable) {
            return MosaicPurchaseResult.ProductUnavailable(productId)
        }
        return when (current.state.purchaseOutcome) {
            MosaicPreviewPurchaseOutcome.PURCHASED -> MosaicPurchaseResult.Purchased(
                productId = productId,
                transactionId = "mosaic-preview-${reference.id}",
            )
            MosaicPreviewPurchaseOutcome.ALREADY_ENTITLED -> MosaicPurchaseResult.AlreadyEntitled(productId)
            MosaicPreviewPurchaseOutcome.CANCELLED -> MosaicPurchaseResult.Cancelled(productId)
            MosaicPreviewPurchaseOutcome.PURCHASE_FAILED -> MosaicPurchaseResult.Failed(
                productId = productId,
                diagnosticCode = "preview.purchaseFailed",
            )
        }
    }

    override suspend fun restore(): MosaicRestoreResult {
        val current = snapshot ?: return MosaicRestoreResult.NothingToRestore
        val entitlements = previewEntitlements(current, fallbackToFirstAvailable = true)
        return when (current.state.restoreOutcome) {
            MosaicPreviewRestoreOutcome.RESTORED -> MosaicRestoreResult.Restored(entitlements)
            MosaicPreviewRestoreOutcome.ALREADY_ENTITLED -> MosaicRestoreResult.AlreadyEntitled(entitlements)
            MosaicPreviewRestoreOutcome.RESTORE_NO_PURCHASES -> MosaicRestoreResult.NothingToRestore
            MosaicPreviewRestoreOutcome.RESTORE_FAILED -> MosaicRestoreResult.Failed("preview.restoreFailed")
        }
    }

    override suspend fun activeEntitlements(): MosaicActiveEntitlementsResult {
        val current = snapshot ?: return MosaicActiveEntitlementsResult.Active(emptySet())
        return MosaicActiveEntitlementsResult.Active(
            previewEntitlements(current, fallbackToFirstAvailable = false),
        )
    }

    private fun previewEntitlements(
        snapshot: Snapshot,
        fallbackToFirstAvailable: Boolean,
    ): Set<MosaicEntitlement> {
        val referenceId = when (val entitlement = snapshot.state.entitlement) {
            MosaicPreviewMockEntitlement.None -> if (fallbackToFirstAvailable) {
                snapshot.state.products.firstOrNull {
                    it !is MosaicPreviewMockProduct.Unavailable
                }?.productReferenceId
            } else {
                null
            }
            is MosaicPreviewMockEntitlement.Active -> entitlement.productReferenceId
        }
        val providerId = snapshot.document.products.firstOrNull { it.id == referenceId }?.providerProductId
        return providerId?.let { setOf(MosaicEntitlement(it)) }.orEmpty()
    }
}
