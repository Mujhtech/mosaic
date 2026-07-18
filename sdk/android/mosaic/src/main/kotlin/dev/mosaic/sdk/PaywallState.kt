package dev.mosaic.sdk

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

data class MosaicAvailableProduct(
    val reference: MosaicProductReference,
    val storeProduct: MosaicProduct,
    val productCardId: String = reference.id,
    val card: MosaicProductCardComponent? = null,
)

data class MosaicProductSelectorState(
    val options: List<MosaicAvailableProduct>,
    val selectedProductReferenceId: String?,
    val selectedProductCardId: String? = selectedProductReferenceId,
    val isLoading: Boolean,
)

/** Testable commerce and selection state; all provider calls live outside composition. */
class MosaicPaywallState(
    val document: MosaicPaywallDocument,
    private val purchaseProvider: MosaicPurchaseProvider,
    private val diagnostics: MosaicDiagnosticSink = MosaicDiagnosticSink.None,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val allNodes = document.walkNodesDepthFirst().toList()
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
            MosaicProductSelectorState(
                emptyList(),
                selectedProductReferenceId = null,
                selectedProductCardId = null,
                isLoading = true,
            )
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

    var currentScreenId: String by mutableStateOf(document.initialScreenId)
        private set

    var navigationHistory: List<String> by mutableStateOf(emptyList())
        private set

    val currentScreen: MosaicPaywallScreen
        get() = document.screens.first { it.id == currentScreenId }

    val backgroundScreen: MosaicPaywallScreen
        get() = navigationHistory.asReversed()
            .mapNotNull { id -> document.screens.firstOrNull { it.id == id } }
            .firstOrNull { it.presentation == MosaicScreenPresentation.SCREEN }
            ?: document.screens.first { it.id == document.initialScreenId }

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

    fun isNodeVisible(nodeId: String): Boolean = document.screens.any { screen ->
        screen.layout.content.findVisibility(nodeId, ancestorsVisible = true, ::isVisible) == true
    }

    fun navigateTo(screenId: String): Boolean {
        if (screenId == currentScreenId || document.screens.none { it.id == screenId }) return false
        navigationHistory = navigationHistory + currentScreenId
        currentScreenId = screenId
        return true
    }

    fun navigateBack(): Boolean {
        val target = navigationHistory.lastOrNull()
        if (target == null) {
            diagnostics.record(
                MosaicDiagnostic(
                    MosaicDiagnosticCode.NAVIGATION_BACK_UNAVAILABLE,
                    "The paywall is already at the start of its screen history.",
                ),
            )
            return false
        }
        navigationHistory = navigationHistory.dropLast(1)
        currentScreenId = target
        return true
    }

    fun recordExternalUrlResult(opened: Boolean) {
        if (opened) return
        diagnostics.record(
            MosaicDiagnostic(
                MosaicDiagnosticCode.EXTERNAL_URL_FAILED,
                "The external URL could not be opened.",
            ),
        )
    }

    fun currentTimeMillis(): Long = clock()

    suspend fun loadProducts(requestedLocale: String? = null): List<MosaicPaywallEvent> {
        val localization = MosaicLocalizationResolver(document.localization, requestedLocale)
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
            is MosaicProductLoadResult.Loaded -> result.products.filterNot { product ->
                product.id in result.unavailableProductIds
            }
            is MosaicProductLoadResult.Unavailable -> emptyList()
        }.filter { product -> providerIds.contains(product.id) }.associateBy(MosaicProduct::id)

        val events = mutableListOf<MosaicPaywallEvent>()
        selectorStates = selectors.mapValues { (_, selector) ->
            val bindings = if (selector.cards.isNotEmpty()) {
                selector.cards.map { card ->
                    Triple(card.id, card.productReferenceId, card)
                }
            } else {
                selector.productReferenceIds.map { referenceId ->
                    Triple(referenceId, referenceId, null)
                }
            }
            val options = bindings.mapNotNull { (cardId, referenceId, card) ->
                val reference = productReferences.getValue(referenceId)
                loadedProducts[reference.providerProductId]?.let { product ->
                    val requiresPrice = card == null || cardRequiresPrice(card, localization)
                    product.takeUnless { requiresPrice && it.localizedPrice.isBlank() }?.let {
                        MosaicAvailableProduct(reference, it, cardId, card)
                    }
                }
            }
            val requestedCardId = selectorStates[selector.id]?.selectedProductCardId
                ?: selector.initialProductCardId
            val selectedOption = options.firstOrNull { it.productCardId == requestedCardId }
                ?: options.firstOrNull()
            if (selectedOption == null) {
                val interaction = MosaicInteractionOutcome.ProductUnavailable(
                    selector.initialProductReferenceId(),
                )
                events += MosaicPaywallEvent(
                    interaction = interaction,
                )
            }
            MosaicProductSelectorState(
                options = options,
                selectedProductReferenceId = selectedOption?.reference?.id,
                selectedProductCardId = selectedOption?.productCardId,
                isLoading = false,
            )
        }
        return events
    }

    private fun cardRequiresPrice(
        card: MosaicProductCardComponent,
        localization: MosaicLocalizationResolver,
    ): Boolean {
        fun usesPrice(text: MosaicLocalizedText): Boolean =
            PRODUCT_PRICE_TEMPLATE.containsMatchIn(localization.resolve(text))

        fun nodeRequiresPrice(node: MosaicNode): Boolean = when (node) {
            is MosaicStack -> node.children.any(::nodeRequiresPrice)
            is MosaicTextComponent -> usesPrice(node.value)
            is MosaicProductBadgeComponent -> node.children.any(::nodeRequiresPrice)
            else -> false
        }

        return card.accessibilityLabel?.let(::usesPrice) == true ||
            card.children.any(::nodeRequiresPrice)
    }

    fun selectProduct(selectorId: String, productReferenceId: String): MosaicPaywallEvent? {
        val current = selectorStates[selectorId] ?: return null
        val selected = current.options.firstOrNull {
            it.productCardId == productReferenceId || it.reference.id == productReferenceId
        } ?: return null
        if (current.selectedProductCardId == selected.productCardId) return null
        selectorStates = selectorStates + (
            selectorId to current.copy(
                selectedProductReferenceId = selected.reference.id,
                selectedProductCardId = selected.productCardId,
            )
        )
        return MosaicPaywallEvent(MosaicInteractionOutcome.ProductSelected(selected.reference.id))
    }

    suspend fun purchase(selectorId: String): MosaicPaywallEvent {
        if (!isNodeVisible(selectorId)) {
            val unavailableReferenceId = selectors[selectorId]?.initialProductReferenceId()
            return MosaicPaywallEvent(
                interaction = MosaicInteractionOutcome.ProductUnavailable(unavailableReferenceId),
                presentationResult = MosaicPresentationResult.ProductUnavailable(unavailableReferenceId),
            )
        }
        val selectorState = selectorStates[selectorId]
        val selectedReferenceId = selectorState?.selectedProductReferenceId
        val unavailableReferenceId = selectedReferenceId
            ?: selectors[selectorId]?.initialProductReferenceId()
        val selected = selectorState?.options?.firstOrNull {
            it.productCardId == selectorState.selectedProductCardId
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

private val PRODUCT_PRICE_TEMPLATE = Regex("\\{\\{\\s*product\\.price\\s*\\}\\}")

private fun MosaicProductSelectorComponent.initialProductReferenceId(): String? =
    cards.firstOrNull { it.id == initialProductCardId }?.productReferenceId
        ?: initiallySelectedProductReferenceId

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
            is MosaicButtonComponent -> {
                (node.children + node.inProgressChildren.orEmpty()).forEach { child ->
                    child.findVisibility(targetId, nodeVisible, visible)?.let { return it }
                }
            }
            is MosaicProductSelectorComponent -> node.cards.forEach { card ->
                card.findVisibility(targetId, nodeVisible, visible)?.let { return it }
            }
            is MosaicProductCardComponent -> node.children.forEach { child ->
                child.findVisibility(targetId, nodeVisible, visible)?.let { return it }
            }
            is MosaicProductBadgeComponent -> node.children.forEach { child ->
                child.findVisibility(targetId, nodeVisible, visible)?.let { return it }
            }
            else -> Unit
        }
    }
    return null
}

private fun MosaicNode.findVisibility(
    targetId: String,
    ancestorsVisible: Boolean,
    visible: (MosaicVisibility) -> Boolean,
): Boolean? {
    val nodeVisible = ancestorsVisible && visible(visibilityOrAlways())
    if (id == targetId) return nodeVisible
    return when (this) {
        is MosaicStack -> findVisibility(targetId, ancestorsVisible, visible)
        is MosaicCarouselComponent -> pages.firstNotNullOfOrNull { page ->
            page.content.findVisibility(targetId, nodeVisible, visible)
        }
        is MosaicButtonComponent -> (children + inProgressChildren.orEmpty()).firstNotNullOfOrNull {
            child -> child.findVisibility(targetId, nodeVisible, visible)
        }
        is MosaicProductSelectorComponent -> cards.firstNotNullOfOrNull { card ->
            card.findVisibility(targetId, nodeVisible, visible)
        }
        is MosaicProductCardComponent -> children.firstNotNullOfOrNull { child ->
            child.findVisibility(targetId, nodeVisible, visible)
        }
        is MosaicProductBadgeComponent -> children.firstNotNullOfOrNull { child ->
            child.findVisibility(targetId, nodeVisible, visible)
        }
        else -> null
    }
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
    is MosaicButtonComponent -> visibility
    is MosaicIconComponent -> visibility
    is MosaicProductCardComponent,
    is MosaicProductBadgeComponent,
    -> MosaicVisibility.Always
}
