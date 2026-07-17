package dev.mosaic.sdk

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

data class MosaicAvailableProduct(
    val reference: MosaicProductReference,
    val storeProduct: MosaicProduct,
)

data class MosaicProductSelectorState(
    val options: List<MosaicAvailableProduct>,
    val selectedProductReferenceId: String?,
    val isLoading: Boolean,
)

/** Testable commerce and selection state; all provider calls live outside composition. */
class MosaicPaywallState(
    val document: MosaicPaywallDocument,
    private val purchaseProvider: MosaicPurchaseProvider,
    private val diagnostics: MosaicDiagnosticSink = MosaicDiagnosticSink.None,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val allNodes = document.layout.content.walkDepthFirst().toList()
    private val selectors = allNodes
        .filterIsInstance<MosaicProductSelectorComponent>()
        .associateBy(MosaicProductSelectorComponent::id)
    private val switches = allNodes
        .filterIsInstance<MosaicSwitchComponent>()
        .associateBy(MosaicSwitchComponent::id)
    private val carousels = allNodes
        .filterIsInstance<MosaicCarouselComponent>()
        .associateBy(MosaicCarouselComponent::id)
    private val productReferences = document.products.associateBy(MosaicProductReference::id)

    var selectorStates: Map<String, MosaicProductSelectorState> by mutableStateOf(
        selectors.keys.associateWith {
            MosaicProductSelectorState(emptyList(), selectedProductReferenceId = null, isLoading = true)
        },
    )
        private set

    var purchaseBusySelectorIds: Set<String> by mutableStateOf(emptySet())
        private set

    var isRestoreBusy: Boolean by mutableStateOf(false)
        private set

    var switchValues: Map<String, Boolean> by mutableStateOf(
        switches.mapValues { (_, component) -> component.initialValue },
    )
        private set

    var carouselPageIndices: Map<String, Int> by mutableStateOf(
        carousels.mapValues { (_, component) -> component.initialPageIndex },
    )
        private set

    fun switchValue(switchId: String): Boolean = switchValues[switchId] ?: false

    fun setSwitchValue(switchId: String, value: Boolean) {
        if (switchId !in switches) return
        switchValues = switchValues + (switchId to value)
    }

    fun carouselPageIndex(carouselId: String): Int = carouselPageIndices[carouselId] ?: 0

    fun setCarouselPageIndex(carouselId: String, index: Int) {
        val carousel = carousels[carouselId] ?: return
        if (index !in carousel.pages.indices) return
        carouselPageIndices = carouselPageIndices + (carouselId to index)
    }

    fun isVisible(visibility: MosaicVisibility): Boolean = when (visibility) {
        MosaicVisibility.Always -> true
        MosaicVisibility.Hidden -> false
        is MosaicVisibility.SwitchValue -> switchValue(visibility.switchId) == visibility.equals
    }

    fun isNodeVisible(nodeId: String): Boolean =
        document.layout.content.findVisibility(nodeId, ancestorsVisible = true, ::isVisible) ?: false

    fun currentTimeMillis(): Long = clock()

    suspend fun loadProducts(): List<MosaicPaywallEvent> {
        val providerIds = document.products.map(MosaicProductReference::providerProductId)
        val result = try {
            purchaseProvider.loadProducts(providerIds)
        } catch (_: Exception) {
            diagnostics.record(
                MosaicDiagnostic(
                    MosaicDiagnosticCode.PRODUCT_LOAD_FAILED,
                    "The mock purchase provider could not load products.",
                ),
            )
            MosaicProductLoadResult.Unavailable(providerIds)
        }

        val loadedProducts = when (result) {
            is MosaicProductLoadResult.Loaded -> result.products
            is MosaicProductLoadResult.Unavailable -> emptyList()
        }.filter { product -> providerIds.contains(product.id) }.associateBy(MosaicProduct::id)

        val events = mutableListOf<MosaicPaywallEvent>()
        selectorStates = selectors.mapValues { (_, selector) ->
            val options = selector.productReferenceIds.mapNotNull { referenceId ->
                val reference = productReferences.getValue(referenceId)
                loadedProducts[reference.providerProductId]?.let { product ->
                    MosaicAvailableProduct(reference, product)
                }
            }
            val configuredSelection = selector.initiallySelectedProductReferenceId
                .takeIf { selectedId -> options.any { it.reference.id == selectedId } }
            val selected = configuredSelection ?: options.firstOrNull()?.reference?.id
            if (selected == null) {
                val interaction = MosaicInteractionOutcome.ProductUnavailable(
                    selector.initiallySelectedProductReferenceId,
                )
                events += MosaicPaywallEvent(
                    interaction = interaction,
                )
            }
            MosaicProductSelectorState(
                options = options,
                selectedProductReferenceId = selected,
                isLoading = false,
            )
        }
        return events
    }

    fun selectProduct(selectorId: String, productReferenceId: String): MosaicPaywallEvent? {
        val current = selectorStates[selectorId] ?: return null
        if (current.options.none { it.reference.id == productReferenceId }) return null
        if (current.selectedProductReferenceId == productReferenceId) return null
        selectorStates = selectorStates + (
            selectorId to current.copy(selectedProductReferenceId = productReferenceId)
        )
        return MosaicPaywallEvent(MosaicInteractionOutcome.ProductSelected(productReferenceId))
    }

    suspend fun purchase(selectorId: String): MosaicPaywallEvent {
        if (!isNodeVisible(selectorId)) {
            val unavailableReferenceId = selectors[selectorId]?.initiallySelectedProductReferenceId
            return MosaicPaywallEvent(
                interaction = MosaicInteractionOutcome.ProductUnavailable(unavailableReferenceId),
                presentationResult = MosaicPresentationResult.ProductUnavailable(unavailableReferenceId),
            )
        }
        val selectorState = selectorStates[selectorId]
        val selectedReferenceId = selectorState?.selectedProductReferenceId
        val unavailableReferenceId = selectedReferenceId
            ?: selectors[selectorId]?.initiallySelectedProductReferenceId
        val selected = selectorState?.options?.firstOrNull {
            it.reference.id == selectedReferenceId
        }
        if (selected == null) {
            return MosaicPaywallEvent(
                interaction = MosaicInteractionOutcome.ProductUnavailable(unavailableReferenceId),
                presentationResult = MosaicPresentationResult.ProductUnavailable(unavailableReferenceId),
            )
        }
        if (selectorId in purchaseBusySelectorIds) {
            return MosaicPaywallEvent(
                interaction = MosaicInteractionOutcome.PurchaseFailed(
                    selected.reference.id,
                    "purchase_already_in_progress",
                ),
            )
        }

        purchaseBusySelectorIds = purchaseBusySelectorIds + selectorId
        val result = try {
            purchaseProvider.purchase(selected.reference.providerProductId)
        } catch (_: Exception) {
            MosaicPurchaseResult.Failed(selected.reference.providerProductId)
        } finally {
            purchaseBusySelectorIds = purchaseBusySelectorIds - selectorId
        }

        return when (result) {
            is MosaicPurchaseResult.Purchased -> MosaicPaywallEvent(
                interaction = MosaicInteractionOutcome.Purchased(selected.reference.id),
                presentationResult = MosaicPresentationResult.Purchased(
                    productReferenceId = selected.reference.id,
                    providerProductId = selected.reference.providerProductId,
                    transactionId = result.transactionId,
                ),
            )
            is MosaicPurchaseResult.AlreadyEntitled -> MosaicPaywallEvent(
                interaction = MosaicInteractionOutcome.AlreadyEntitled(selected.reference.id),
                presentationResult = MosaicPresentationResult.AlreadyEntitled(selected.reference.id),
            )
            is MosaicPurchaseResult.Cancelled -> MosaicPaywallEvent(
                interaction = MosaicInteractionOutcome.Cancelled(selected.reference.id),
                presentationResult = MosaicPresentationResult.Cancelled(selected.reference.id),
            )
            is MosaicPurchaseResult.ProductUnavailable -> MosaicPaywallEvent(
                interaction = MosaicInteractionOutcome.ProductUnavailable(selected.reference.id),
                presentationResult = MosaicPresentationResult.ProductUnavailable(selected.reference.id),
            )
            is MosaicPurchaseResult.Failed -> {
                diagnostics.record(
                    MosaicDiagnostic(
                        MosaicDiagnosticCode.PURCHASE_FAILED,
                        "The mock purchase did not complete.",
                    ),
                )
                MosaicPaywallEvent(
                    interaction = MosaicInteractionOutcome.PurchaseFailed(
                        selected.reference.id,
                        result.diagnosticCode,
                    ),
                    presentationResult = MosaicPresentationResult.PurchaseFailed(
                        selected.reference.id,
                        result.diagnosticCode,
                    ),
                )
            }
        }
    }

    suspend fun restore(): MosaicPaywallEvent {
        if (isRestoreBusy) {
            return MosaicPaywallEvent(
                MosaicInteractionOutcome.RestoreFailed("restore_already_in_progress"),
            )
        }
        isRestoreBusy = true
        val result = try {
            purchaseProvider.restore()
        } catch (_: Exception) {
            MosaicRestoreResult.Failed()
        } finally {
            isRestoreBusy = false
        }
        return when (result) {
            is MosaicRestoreResult.Restored -> MosaicPaywallEvent(
                interaction = MosaicInteractionOutcome.Restored(result.entitlements),
                presentationResult = MosaicPresentationResult.Restored(result.entitlements),
            )
            is MosaicRestoreResult.AlreadyEntitled -> MosaicPaywallEvent(
                interaction = MosaicInteractionOutcome.AlreadyEntitled(),
                presentationResult = MosaicPresentationResult.AlreadyEntitled(
                    entitlements = result.entitlements,
                ),
            )
            MosaicRestoreResult.NothingToRestore -> MosaicPaywallEvent(
                MosaicInteractionOutcome.RestoreNoPurchases,
            )
            is MosaicRestoreResult.Failed -> {
                diagnostics.record(
                    MosaicDiagnostic(
                        MosaicDiagnosticCode.RESTORE_FAILED,
                        "The mock restore did not complete.",
                    ),
                )
                MosaicPaywallEvent(
                    MosaicInteractionOutcome.RestoreFailed(result.diagnosticCode),
                )
            }
        }
    }

    fun close(): MosaicPaywallEvent = MosaicPaywallEvent(
        interaction = MosaicInteractionOutcome.Dismissed,
        presentationResult = MosaicPresentationResult.Dismissed,
    )
}

private fun MosaicStack.findVisibility(
    targetId: String,
    ancestorsVisible: Boolean,
    visible: (MosaicVisibility) -> Boolean,
): Boolean? {
    val stackVisible = ancestorsVisible && visible(visibility)
    if (id == targetId) return stackVisible
    children.forEach { node ->
        val nodeVisible = stackVisible && visible(node.visibilityOrAlways())
        if (node.id == targetId) return nodeVisible
        when (node) {
            is MosaicStack -> node.findVisibility(targetId, stackVisible, visible)?.let { return it }
            is MosaicCarouselComponent -> node.pages.forEach { page ->
                if (page.id == targetId) return nodeVisible
                page.content.findVisibility(targetId, nodeVisible, visible)?.let { return it }
            }
            else -> Unit
        }
    }
    return null
}

internal fun MosaicNode.visibilityOrAlways(): MosaicVisibility = when (this) {
    is MosaicStack -> visibility
    is MosaicTextComponent -> visibility
    is MosaicImageComponent -> visibility
    is MosaicFeatureListComponent -> visibility
    is MosaicProductSelectorComponent -> visibility
    is MosaicPurchaseButtonComponent -> visibility
    is MosaicRestoreButtonComponent -> visibility
    is MosaicCloseButtonComponent -> visibility
    is MosaicLegalTextComponent -> visibility
    is MosaicCarouselComponent -> visibility
    is MosaicSwitchComponent -> visibility
    is MosaicCountdownComponent -> visibility
}
