package dev.mosaic.sdk

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.util.concurrent.atomic.AtomicBoolean

data class MosaicAvailableProduct(
    val reference: MosaicProductReference,
    val storeProduct: MosaicProduct,
    val productCardId: String = reference.id,
    val card: MosaicProductCardComponent,
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
    private val analyticsRuntime: MosaicAnalyticsRuntime? = null,
    private val analyticsContext: MosaicAnalyticsPresentationContext? = null,
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
    private val tabsComponents = allNodes
        .filterIsInstance<MosaicTabsComponent>()
        .associateBy(MosaicTabsComponent::id)
    private val productReferences = document.products.associateBy(MosaicProductReference::id)
    private val reportedRenderingFailures = mutableSetOf<String>()
    private val reportedDegradations = mutableSetOf<String>()
    private val presentationAcknowledged = AtomicBoolean(false)

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

    /**
     * The selected tab of every Tabs component, seeded from each component's authored
     * `initialTabId`. A new accepted document builds a new state, which is what resets the map.
     */
    var tabSelections: Map<String, String> by mutableStateOf(
        tabsComponents.mapValues { (_, component) -> component.initialTabId },
    )
        private set

    var currentScreenId: String by mutableStateOf(document.initialScreenId)
        private set

    var navigationHistory: List<String> by mutableStateOf(emptyList())
        private set

    /**
     * The screen currently being presented.
     *
     * Prefer [currentScreenOrNull], which lets a caller distinguish "no such screen" from a
     * substituted one. This property never throws: a dangling screen id degrades to the document's
     * initial screen (or, failing that, its first screen, which the schema guarantees exists) and
     * records a diagnostic once. The renderer itself uses [currentScreenOrNull] and reports
     * `rendering.screen_unavailable` instead of silently showing a different screen.
     */
    val currentScreen: MosaicPaywallScreen
        get() = currentScreenOrNull ?: fallbackScreen("current_screen")

    internal val currentScreenOrNull: MosaicPaywallScreen?
        get() = document.screens.firstOrNull { it.id == currentScreenId }

    val backgroundScreen: MosaicPaywallScreen
        get() = navigationHistory.asReversed()
            .mapNotNull { id -> document.screens.firstOrNull { it.id == id } }
            .firstOrNull { it.presentation == MosaicScreenPresentation.SCREEN }
            ?: document.screens.firstOrNull { it.id == document.initialScreenId }
            ?: fallbackScreen("background_screen")

    /** `screens` has `minItems: 1`, so a first screen always exists once decoding has accepted. */
    private fun fallbackScreen(reason: String): MosaicPaywallScreen {
        diagnoseOnce(
            key = "screen_substituted.$reason",
            code = MosaicDiagnosticCode.RENDERING_FAILED,
            message = "A referenced Mosaic screen is absent; the first declared screen was used.",
        )
        return document.screens.firstOrNull { it.id == document.initialScreenId }
            ?: document.screens.first()
    }

    private fun diagnoseOnce(key: String, code: MosaicDiagnosticCode, message: String) {
        if (!reportedDegradations.add(key)) return
        diagnostics.record(MosaicDiagnostic(code, message))
    }

    fun switchValue(switchId: String): Boolean = switchValues[switchId] ?: false

    fun setSwitchValue(switchId: String, value: Boolean) {
        if (switchId !in switches) return
        switchValues = switchValues + (switchId to value)
    }

    fun selectedTabId(tabsId: String): String? = tabSelections[tabsId]

    fun selectTab(tabsId: String, tabId: String) {
        val component = tabsComponents[tabsId] ?: return
        if (component.tabs.none { it.id == tabId }) return
        tabSelections = tabSelections + (tabsId to tabId)
    }

    fun carouselPageIndex(carouselId: String): Int = carouselPageIndices[carouselId] ?: 0

    fun setCarouselPageIndex(carouselId: String, index: Int) {
        val carousel = carousels[carouselId] ?: return
        if (index !in carousel.pages.indices) return
        carouselPageIndices = carouselPageIndices + (carouselId to index)
    }

    /** The runtime selection every visibility condition on this document reads. */
    val selectionState: MosaicSelectionState
        get() = MosaicSelectionState(switches = switchValues, tabs = tabSelections)

    /**
     * Throws [MosaicVisibilityStateException] when the condition names a controller this state does
     * not carry. Both maps are built from this document's own Switch and Tabs components and the
     * decoder rejects a condition naming an undeclared controller, so the throw is unreachable for
     * an accepted document; resolving it to hidden instead would make a caller bug look like an
     * authored `hidden`.
     */
    fun isVisible(visibility: MosaicVisibility): Boolean =
        mosaicVisibilityIsSatisfied(visibility, selectionState)

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

    fun presented() {
        if (!presentationAcknowledged.compareAndSet(false, true)) return
        track(
            MosaicAnalyticsPayload.PaywallPresented(),
            MosaicAnalyticsCorrelation(
                placementRequestId = analyticsContext?.placementRequestId,
                paywallPresentationId = analyticsContext?.paywallPresentationId,
            ),
        )
        val experiment = analyticsContext?.experiment ?: return
        if (experiment.qaOverride) return
        val context = requireNotNull(analyticsContext)
        val payload = when (experiment.kind) {
            MosaicExperimentPresentationKind.VARIANT -> MosaicAnalyticsPayload.ExperimentExposed(
                experiment.assignmentKeyType, experiment.bucketingAlgorithm, qaOverride = false,
            )
            MosaicExperimentPresentationKind.FALLBACK -> MosaicAnalyticsPayload.ExperimentFallbackPresented(
                requireNotNull(experiment.fallbackReason), experiment.presentedPaywallId,
                experiment.presentedPaywallVersionId, "experiment.${experiment.fallbackReason}",
            )
        }
        val attribution = if (experiment.kind == MosaicExperimentPresentationKind.FALLBACK) {
            context.attribution.copy(paywallId = null, paywallVersionId = null)
        } else context.attribution
        analyticsRuntime?.record(
            payload,
            MosaicAnalyticsJourney(presentationCorrelation(), attribution, context.context),
        )
        context.acknowledgeExperimentPresentation?.invoke()
    }

    fun reportRenderingFailure(diagnosticCode: String = "rendering.failed"): MosaicPaywallEvent? {
        val safeDiagnosticCode = safeCode(diagnosticCode)
        if (!reportedRenderingFailures.add(safeDiagnosticCode)) return null
        diagnostics.record(
            MosaicDiagnostic(
                MosaicDiagnosticCode.RENDERING_FAILED,
                "The paywall could not be rendered safely.",
            ),
        )
        track(
            MosaicAnalyticsPayload.DiagnosticFailure("paywall_render_failed", safeDiagnosticCode, false),
            presentationCorrelation(),
        )
        return MosaicPaywallEvent(
            interaction = MosaicInteractionOutcome.RenderingFailed(safeDiagnosticCode),
            presentationResult = MosaicPresentationResult.RenderingFailed(safeDiagnosticCode),
        )
    }

    suspend fun loadProducts(requestedLocale: String? = null): List<MosaicPaywallEvent> {
        val startedAt = clock()
        val attemptId = mosaicAnalyticsId("product_load")
        val localization = MosaicLocalizationResolver(document.localization, requestedLocale)
        val providerIds = document.products.map(MosaicProductReference::providerProductId)
        if (providerIds.isNotEmpty()) track(
            MosaicAnalyticsPayload.ProductLoadStarted(providerIds.size.coerceAtMost(64)),
            MosaicAnalyticsCorrelation(
                placementRequestId = analyticsContext?.placementRequestId,
                paywallPresentationId = analyticsContext?.paywallPresentationId,
                productLoadAttemptId = attemptId,
            ),
        )
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

        if (providerIds.isNotEmpty()) {
            val duration = mosaicAnalyticsDuration(startedAt, clock())
            when (result) {
                is MosaicProductLoadResult.Loaded -> track(
                    MosaicAnalyticsPayload.ProductLoadCompleted(
                        loadedProducts.size.coerceAtMost(64),
                        (providerIds.size - loadedProducts.size).coerceIn(0, 64),
                        duration,
                    ),
                    MosaicAnalyticsCorrelation(productLoadAttemptId = attemptId),
                )
                is MosaicProductLoadResult.Unavailable -> track(
                    MosaicAnalyticsPayload.ProductLoadFailed(providerIds.size.coerceAtMost(64), duration, safeCode(result.diagnosticCode), true),
                    MosaicAnalyticsCorrelation(productLoadAttemptId = attemptId),
                )
            }
        }

        val events = mutableListOf<MosaicPaywallEvent>()
        selectorStates = selectors.mapValues { (_, selector) ->
            // `cards` is required with `minItems: 1`, so every option is card-bound. There is no
            // card-less binding: the shape that needed one belonged to a protocol version this
            // reader rejects.
            val options = selector.cards.mapNotNull { card ->
                val cardId = card.id
                val referenceId = card.productReferenceId
                // A card bound to an undeclared Product Reference is a non-conforming document. The
                // option is skipped, exactly as an unavailable product would be, rather than
                // throwing out of the whole selector — the remaining plans stay purchasable.
                val reference = productReferences[referenceId]
                if (reference == null) {
                    diagnoseOnce(
                        key = "product_reference_unavailable.$referenceId",
                        code = MosaicDiagnosticCode.PRODUCT_LOAD_FAILED,
                        message = "A Product Card references an undeclared Product; it was skipped.",
                    )
                    return@mapNotNull null
                }
                loadedProducts[reference.providerProductId]?.let { product ->
                    val requiresPrice = cardRequiresPrice(card, localization)
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
                selector.initialProductReferenceId()?.let { productId ->
                    track(
                        MosaicAnalyticsPayload.ProductUnavailable("product_not_found"),
                        MosaicAnalyticsCorrelation(productLoadAttemptId = attemptId),
                        productId,
                    )
                }
            } else {
                track(
                    MosaicAnalyticsPayload.ProductSelected("default"),
                    MosaicAnalyticsCorrelation(
                        placementRequestId = analyticsContext?.placementRequestId,
                        paywallPresentationId = analyticsContext?.paywallPresentationId,
                    ),
                    selectedOption.reference.providerProductId,
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
            .also {
                track(
                    MosaicAnalyticsPayload.ProductSelected("user"),
                    MosaicAnalyticsCorrelation(
                        placementRequestId = analyticsContext?.placementRequestId,
                        paywallPresentationId = analyticsContext?.paywallPresentationId,
                    ),
                    selected.reference.providerProductId,
                )
            }
    }

    suspend fun purchase(selectorId: String, componentId: String? = null): MosaicPaywallEvent {
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
        val attemptId = mosaicAnalyticsId("purchase_attempt")
        val startedAt = clock()
        val productId = selected.reference.providerProductId
        track(MosaicAnalyticsPayload.PaywallAction("purchase", componentId), presentationCorrelation())
        trackPurchase(MosaicAnalyticsPayload.PurchaseStarted(), attemptId, productId)
        val result = try {
            purchaseProvider.purchase(productId)
        } catch (_: Exception) {
            MosaicPurchaseResult.Failed(selected.reference.providerProductId)
        } finally {
            purchaseBusySelectorIds = purchaseBusySelectorIds - selectorId
        }

        val duration = mosaicAnalyticsDuration(startedAt, clock())
        val event = when (result) {
            is MosaicPurchaseResult.Purchased -> MosaicPaywallEvent(
                interaction = MosaicInteractionOutcome.Purchased(selected.reference.id),
                presentationResult = MosaicPresentationResult.Purchased(
                    productReferenceId = selected.reference.id,
                    providerProductId = selected.reference.providerProductId,
                    transactionId = result.transactionId,
                ),
            ).also { trackPurchase(MosaicAnalyticsPayload.PurchaseCompleted("purchased", duration, result.entitlements.map { it.id }.sorted().take(64)), attemptId, productId) }
            is MosaicPurchaseResult.AlreadyEntitled -> MosaicPaywallEvent(
                interaction = MosaicInteractionOutcome.AlreadyEntitled(selected.reference.id),
                presentationResult = MosaicPresentationResult.AlreadyEntitled(selected.reference.id),
            ).also { trackPurchase(MosaicAnalyticsPayload.PurchaseCompleted("already_entitled", duration, result.entitlements.map { it.id }.sorted().take(64)), attemptId, productId) }
            is MosaicPurchaseResult.Pending -> MosaicPaywallEvent(
                interaction = MosaicInteractionOutcome.PurchasePending(selected.reference.id),
            ).also { trackPurchase(MosaicAnalyticsPayload.PurchaseLifecycle("purchase_pending", duration), attemptId, productId) }
            is MosaicPurchaseResult.Deferred -> MosaicPaywallEvent(
                interaction = MosaicInteractionOutcome.PurchaseDeferred(selected.reference.id),
            ).also { trackPurchase(MosaicAnalyticsPayload.PurchaseLifecycle("purchase_deferred", duration), attemptId, productId) }
            is MosaicPurchaseResult.Cancelled -> MosaicPaywallEvent(
                interaction = MosaicInteractionOutcome.Cancelled(selected.reference.id),
                presentationResult = MosaicPresentationResult.Cancelled(selected.reference.id),
            ).also { trackPurchase(MosaicAnalyticsPayload.PurchaseLifecycle("purchase_cancelled", duration, "purchase.cancelled"), attemptId, productId) }
            is MosaicPurchaseResult.ProductUnavailable -> MosaicPaywallEvent(
                interaction = MosaicInteractionOutcome.ProductUnavailable(selected.reference.id),
                presentationResult = MosaicPresentationResult.ProductUnavailable(selected.reference.id),
            ).also { trackPurchase(MosaicAnalyticsPayload.PurchaseFailed(duration, "commerce.product_unavailable", false), attemptId, productId) }
            is MosaicPurchaseResult.ProviderUnavailable -> {
                diagnostics.record(
                    MosaicDiagnostic(
                        MosaicDiagnosticCode.COMMERCE_PROVIDER_UNAVAILABLE,
                        "The commerce provider is currently unavailable.",
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
                ).also { trackPurchase(MosaicAnalyticsPayload.PurchaseFailed(duration, safeCode(result.diagnosticCode), true), attemptId, productId) }
            }
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
                ).also { trackPurchase(MosaicAnalyticsPayload.PurchaseFailed(duration, safeCode(result.diagnosticCode), false), attemptId, productId) }
            }
        }
        return event
    }

    suspend fun restore(componentId: String? = null): MosaicPaywallEvent {
        if (isRestoreBusy) {
            return MosaicPaywallEvent(
                MosaicInteractionOutcome.RestoreFailed("restore_already_in_progress"),
            )
        }
        isRestoreBusy = true
        val attemptId = mosaicAnalyticsId("restore_attempt")
        val startedAt = clock()
        val providerId = analyticsProvider(null).providerId
        track(MosaicAnalyticsPayload.PaywallAction("restore", componentId), presentationCorrelation())
        track(MosaicAnalyticsPayload.RestoreStarted(providerId), MosaicAnalyticsCorrelation(restoreAttemptId = attemptId))
        val result = try {
            purchaseProvider.restore()
        } catch (_: Exception) {
            MosaicRestoreResult.Failed()
        } finally {
            isRestoreBusy = false
        }
        val duration = mosaicAnalyticsDuration(startedAt, clock())
        return when (result) {
            is MosaicRestoreResult.Restored -> MosaicPaywallEvent(
                interaction = MosaicInteractionOutcome.Restored(result.entitlements),
                presentationResult = MosaicPresentationResult.Restored(result.entitlements),
            ).also { track(MosaicAnalyticsPayload.RestoreCompleted(providerId, duration, emptyList(), result.entitlements.map { it.id }.sorted().take(64)), MosaicAnalyticsCorrelation(restoreAttemptId = attemptId)) }
            MosaicRestoreResult.NothingToRestore -> MosaicPaywallEvent(
                MosaicInteractionOutcome.RestoreNoPurchases,
            ).also { track(MosaicAnalyticsPayload.RestoreLifecycle("restore_nothing_found", providerId, duration), MosaicAnalyticsCorrelation(restoreAttemptId = attemptId)) }
            MosaicRestoreResult.Cancelled -> MosaicPaywallEvent(
                MosaicInteractionOutcome.RestoreCancelled,
            ).also { track(MosaicAnalyticsPayload.RestoreLifecycle("restore_cancelled", providerId, duration), MosaicAnalyticsCorrelation(restoreAttemptId = attemptId)) }
            is MosaicRestoreResult.ProviderUnavailable -> {
                diagnostics.record(
                    MosaicDiagnostic(
                        MosaicDiagnosticCode.COMMERCE_PROVIDER_UNAVAILABLE,
                        "The commerce provider is currently unavailable.",
                    ),
                ).also { track(MosaicAnalyticsPayload.RestoreFailed(providerId, duration, safeCode(result.diagnosticCode), true), MosaicAnalyticsCorrelation(restoreAttemptId = attemptId)) }
                MosaicPaywallEvent(
                    MosaicInteractionOutcome.RestoreFailed(result.diagnosticCode),
                )
            }
            is MosaicRestoreResult.Failed -> {
                diagnostics.record(
                    MosaicDiagnostic(
                        MosaicDiagnosticCode.RESTORE_FAILED,
                        "The mock restore did not complete.",
                    ),
                )
                MosaicPaywallEvent(
                    MosaicInteractionOutcome.RestoreFailed(result.diagnosticCode),
                ).also {
                    track(
                        MosaicAnalyticsPayload.RestoreFailed(
                            providerId,
                            duration,
                            safeCode(result.diagnosticCode),
                            false,
                        ),
                        MosaicAnalyticsCorrelation(restoreAttemptId = attemptId),
                    )
                }
            }
            is MosaicRestoreResult.Detailed -> when (result.outcome) {
                MosaicCommerceRecoveryOutcome.RESTORED -> MosaicPaywallEvent(
                    interaction = MosaicInteractionOutcome.Restored(result.entitlements),
                    presentationResult = MosaicPresentationResult.Restored(result.entitlements),
                ).also { track(MosaicAnalyticsPayload.RestoreCompleted(providerId, duration, emptyList(), result.entitlements.map { it.id }.sorted().take(64)), MosaicAnalyticsCorrelation(restoreAttemptId = attemptId, providerOperationId = result.metadata.operationId)) }
                MosaicCommerceRecoveryOutcome.NOTHING_TO_RESTORE -> MosaicPaywallEvent(
                    MosaicInteractionOutcome.RestoreNoPurchases,
                ).also { track(MosaicAnalyticsPayload.RestoreLifecycle("restore_nothing_found", providerId, duration), MosaicAnalyticsCorrelation(restoreAttemptId = attemptId, providerOperationId = result.metadata.operationId)) }
                MosaicCommerceRecoveryOutcome.CANCELLED -> MosaicPaywallEvent(
                    MosaicInteractionOutcome.RestoreCancelled,
                ).also { track(MosaicAnalyticsPayload.RestoreLifecycle("restore_cancelled", providerId, duration), MosaicAnalyticsCorrelation(restoreAttemptId = attemptId, providerOperationId = result.metadata.operationId)) }
                MosaicCommerceRecoveryOutcome.PROVIDER_UNAVAILABLE,
                MosaicCommerceRecoveryOutcome.FAILED,
                -> MosaicPaywallEvent(
                    MosaicInteractionOutcome.RestoreFailed(
                        result.metadata.diagnostics.firstOrNull()?.code
                            ?: MosaicDiagnosticCode.RESTORE_FAILED.wireName,
                    ),
                ).also { track(MosaicAnalyticsPayload.RestoreFailed(providerId, duration, safeCode(result.metadata.diagnostics.firstOrNull()?.code ?: "restore.failed"), result.outcome == MosaicCommerceRecoveryOutcome.PROVIDER_UNAVAILABLE), MosaicAnalyticsCorrelation(restoreAttemptId = attemptId, providerOperationId = result.metadata.operationId)) }
            }
        }
    }

    fun close(componentId: String? = null): MosaicPaywallEvent = MosaicPaywallEvent(
        interaction = MosaicInteractionOutcome.Dismissed,
        presentationResult = MosaicPresentationResult.Dismissed,
    ).also {
        track(MosaicAnalyticsPayload.PaywallAction("close", componentId), presentationCorrelation())
        track(MosaicAnalyticsPayload.PaywallDismissed("user"), presentationCorrelation())
    }

    fun recordAction(action: String, componentId: String) {
        track(MosaicAnalyticsPayload.PaywallAction(action, componentId), presentationCorrelation())
    }

    /**
     * True only for a presentation that emits `experiment_exposed`: the assigned Variant was
     * actually presented and the presentation was not a QA override. This is the single condition
     * that makes a conversion attributable to the Variant.
     */
    private fun MosaicExperimentPresentationContext?.isStatisticallyExposedVariant(): Boolean =
        this != null && !qaOverride && kind == MosaicExperimentPresentationKind.VARIANT

    private fun presentationCorrelation() = MosaicAnalyticsCorrelation(
        placementRequestId = analyticsContext?.placementRequestId,
        paywallPresentationId = analyticsContext?.paywallPresentationId,
    )

    private fun analyticsProvider(productId: String?): MosaicAnalyticsCommerceAttribution =
        (purchaseProvider as? MosaicAnalyticsCommerceProvider)?.analyticsAttribution(productId.orEmpty())
            ?: MosaicAnalyticsCommerceAttribution("custom", null)

    private fun trackPurchase(payload: MosaicAnalyticsPayload, attemptId: String, productId: String) {
        val provider = analyticsProvider(productId)
        track(
            payload,
            presentationCorrelation().copy(purchaseAttemptId = attemptId),
            productId,
            provider,
        )
    }

    private fun track(
        payload: MosaicAnalyticsPayload,
        correlation: MosaicAnalyticsCorrelation,
        productId: String? = null,
        provider: MosaicAnalyticsCommerceAttribution? = null,
    ) {
        val context = analyticsContext ?: return
        // The conversion events named by the `analytics-event-v1-to-v2` MUST table. Attribution
        // joins solely on the tuple carried here, and the tuple is legal only on a v2 event, so
        // dropping it from any of these silently reports zero conversions for every Experiment.
        // `purchase_completed_provider` is absent by design: the public SDK cannot emit it.
        val isConversion = payload is MosaicAnalyticsPayload.ProductSelected ||
            payload is MosaicAnalyticsPayload.PurchaseStarted ||
            payload is MosaicAnalyticsPayload.PurchaseCompleted ||
            payload is MosaicAnalyticsPayload.PurchaseLifecycle ||
            payload is MosaicAnalyticsPayload.PurchaseFailed
        // ...but only when this presentation was the assigned Variant and was statistically
        // exposed. A fallback presentation shows the normal Paywall, so its conversions are not
        // Variant outcomes: `product_selection_purchase_start` uses `product_selected` as its
        // *denominator*, so a tuple-carrying fallback conversion becomes a counted exposure and,
        // being earlier, can displace the Variant's own first unit for that bucket. A QA-override
        // presentation emits no exposure either. Both are the "fallback counted as original
        // exposure" corruption; fallbacks are measured by the `fallback_exposure` guardrail.
        val carriesExperiment = isConversion && context.experiment.isStatisticallyExposedVariant()
        val attribution = context.attribution.copy(
            mosaicProductId = productId,
            providerId = provider?.providerId,
            providerProductMappingId = provider?.providerProductMappingId,
        ).let { current ->
            if (carriesExperiment) current else current.copy(
                experimentId = null, experimentVersionId = null,
                experimentVariantId = null, experimentAllocationVersion = null,
            )
        }
        analyticsRuntime?.record(
            payload,
            MosaicAnalyticsJourney(
                correlation,
                attribution,
                context.context,
            ),
        )
    }

    private fun safeCode(value: String): String = value
        .lowercase()
        .replace(Regex("[^a-z0-9._-]+"), "_")
        .let { if (it.contains('.') || it.contains('_') || it.contains('-')) it else "analytics.$it" }
        .take(96)
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
            is MosaicTabsComponent -> node.tabs.forEach { tab ->
                if (tab.id == targetId) return nodeVisible
                tab.content.findVisibility(targetId, nodeVisible, visible)?.let { return it }
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
        is MosaicTabsComponent -> tabs.firstNotNullOfOrNull { tab ->
            tab.content.findVisibility(targetId, nodeVisible, visible)
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
    is MosaicCarouselComponent -> visibility
    is MosaicSwitchComponent -> visibility
    is MosaicCountdownComponent -> visibility
    is MosaicButtonComponent -> visibility
    is MosaicIconComponent -> visibility
    is MosaicTabsComponent -> visibility
    is MosaicTimelineComponent -> visibility
    is MosaicAwardComponent -> visibility
    is MosaicSocialProofComponent -> visibility
    // Product Cards and Badges declare no `visibility` in `schema/v0.3/paywall.schema.json`: a card
    // is shown when its Product Selector offers it, and a badge when its card is shown. Always is
    // therefore their declared visibility, not a substituted default.
    is MosaicProductCardComponent,
    is MosaicProductBadgeComponent,
    -> MosaicVisibility.Always
}
