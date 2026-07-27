package dev.mosaic.sdk

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

class PaywallStateTest {
    /**
     * Experiment conversion attribution joins solely on the tuple carried by the conversion event
     * itself, and the tuple is legal only on a v2 event. An SDK that emits `experiment_exposed` on
     * v2 while emitting `product_selected`/`purchase_*` on v1 makes every Experiment report zero
     * conversions, with no ingest rejection and no diagnostic. This pins the emitter to the
     * `analytics-event-v1-to-v2` MUST table: under an active assignment every conversion event is
     * v2 and carries the complete all-or-none tuple.
     */
    @Test
    fun conversionEventsCarryTheExperimentTupleOnV2UnderAnActiveAssignment() = runTest {
        val events = emitConversionJourney(experimentAssigned = true)

        val conversions = events.filter {
            it.eventName == "product_selected" || it.eventName.startsWith("purchase_")
        }
        assertTrue("expected conversion events, got ${events.map { it.eventName }}", conversions.isNotEmpty())
        assertTrue(
            listOf("product_selected", "purchase_started", "purchase_completed_client")
                .all { name -> conversions.any { it.eventName == name } },
        )
        conversions.forEach { event ->
            assertEquals("${event.eventName} must be v2", "2", event.eventSchemaVersion)
            assertTrue("${event.eventName} must carry the tuple", event.attribution.hasExperimentTuple())
            assertEquals("experiment_checkout", event.attribution.experimentId)
            assertEquals("experiment_version_checkout_1", event.attribution.experimentVersionId)
            assertEquals("variant_control", event.attribution.experimentVariantId)
            assertEquals("allocation_checkout_1", event.attribution.experimentAllocationVersion)
        }
        // The exposure denominator is emitted for the same presentation.
        assertTrue(events.any { it.eventName == "experiment_exposed" })
    }

    /** Without an Experiment the SDK stays on v1: v1 is approved and current for non-Experiment use. */
    @Test
    fun conversionEventsRemainOnV1WithoutAnExperiment() = runTest {
        val events = emitConversionJourney(experimentAssigned = false)

        assertTrue(events.isNotEmpty())
        events.forEach { event ->
            assertEquals("${event.eventName} must be v1", "1", event.eventSchemaVersion)
            assertFalse(event.attribution.hasExperimentTuple())
        }
    }

    private suspend fun emitConversionJourney(experimentAssigned: Boolean): List<MosaicAnalyticsEvent> {
        val queue = MosaicAnalyticsQueue(MemoryStore()) { 1_700_000_000_000 }
        val runtime = MosaicAnalyticsRuntime(
            identityStore = { MosaicIdentityState("installation_001", "customer_42", emptyMap(), 1) },
            queue = queue,
            transport = object : MosaicAnalyticsTransport {
                override suspend fun send(batch: MosaicAnalyticsBatch) =
                    MosaicAnalyticsTransportResult.Retryable("analytics.unavailable")
            },
            baseContext = MosaicAnalyticsContext(),
            environmentEnabled = true,
        )
        val experiment = MosaicExperimentAttribution(
            "experiment_checkout", "experiment_version_checkout_1", "variant_control", "allocation_checkout_1",
        )
        val attribution = MosaicAnalyticsAttribution(
            placementId = "placement_checkout",
            paywallId = "paywall_checkout_control",
            paywallVersionId = "paywall_version_control_7",
        ).let {
            if (!experimentAssigned) it else it.copy(
                experimentId = experiment.experimentId,
                experimentVersionId = experiment.experimentVersionId,
                experimentVariantId = experiment.experimentVariantId,
                experimentAllocationVersion = experiment.experimentAllocationVersion,
            )
        }
        val document = canonicalDocument()
        val state = MosaicPaywallState(
            document,
            MockMosaicPurchaseProvider(MockMosaicPurchaseProvider.phase1Products()),
            analyticsRuntime = runtime,
            analyticsContext = MosaicAnalyticsPresentationContext(
                "placement_request_1",
                "presentation_1",
                MosaicAnalyticsContext(configurationDeliveryVersion = if (experimentAssigned) "3" else "2"),
                attribution,
                if (!experimentAssigned) null else MosaicExperimentPresentationContext(
                    experiment, "identified_user", MOSAIC_EXPERIMENT_BUCKETING_ALGORITHM, false,
                    MosaicExperimentPresentationKind.VARIANT,
                    presentedPaywallId = "paywall_checkout_control",
                    presentedPaywallVersionId = "paywall_version_control_7",
                ),
            ),
        )
        state.presented()
        state.loadProducts()
        val selectorId = document.walkNodesDepthFirst()
            .filterIsInstance<MosaicProductSelectorComponent>().first().id
        state.selectorStates[selectorId]?.options?.lastOrNull()?.let {
            state.selectProduct(selectorId, it.reference.id)
        }
        state.purchase(selectorId)
        runtime.drainPendingRecords()
        runtime.close()
        return queue.ready(100, 2 * 1024 * 1024).map { MosaicAnalyticsCodec.decodeEvent(it.encoded) }
    }

    private class MemoryStore : MosaicAnalyticsStore {
        private var state = MosaicAnalyticsPersistedState()
        override suspend fun read() = state
        override suspend fun write(state: MosaicAnalyticsPersistedState) { this.state = state }
    }

    @Test
    fun renderingFailureIsTerminalAndEmittedOnlyOncePerSafeCode() {
        val state = MosaicPaywallState(canonicalDocument(), MockMosaicPurchaseProvider())

        val first = state.reportRenderingFailure("rendering.screen_unavailable")
        val duplicate = state.reportRenderingFailure("rendering.screen_unavailable")

        assertEquals("renderingFailed", first?.interaction?.wireName)
        assertTrue(first?.presentationResult is MosaicPresentationResult.RenderingFailed)
        assertNull(duplicate)
    }

    @Test
    fun retainsConfiguredSelectionWhenAvailable() = runTest {
        val state = loadedState()

        assertEquals("yearly-plan", state.selectorStates.getValue("plans").selectedProductReferenceId)
        assertEquals(
            listOf("monthly-plan", "yearly-plan", "lifetime-plan"),
            state.selectorStates.getValue("plans").options.map { it.reference.id },
        )
    }

    @Test
    fun unavailableConfiguredSelectionFallsBackToFirstAvailableInSourceOrder() = runTest {
        val state = MosaicPaywallState(
            canonicalDocument(),
            MockMosaicPurchaseProvider(MockMosaicPurchaseProvider.phase1Products().take(1)),
        )

        assertTrue(state.loadProducts().isEmpty())
        assertEquals("monthly-plan", state.selectorStates.getValue("plans").selectedProductReferenceId)
    }

    @Test
    fun noAvailableProductsClearSelectionNotifyAndDisablePurchaseState() = runTest {
        val state = MosaicPaywallState(canonicalDocument(), MockMosaicPurchaseProvider())

        val events = state.loadProducts()

        assertNull(state.selectorStates.getValue("plans").selectedProductReferenceId)
        assertTrue(state.selectorStates.getValue("plans").options.isEmpty())
        assertEquals("productUnavailable", events.single().interaction.wireName)
        assertEquals(
            "yearly-plan",
            (events.single().interaction as MosaicInteractionOutcome.ProductUnavailable).productReferenceId,
        )
        assertNull(events.single().presentationResult)
        val purchaseResult = state.purchase("plans").presentationResult
        assertTrue(purchaseResult is MosaicPresentationResult.ProductUnavailable)
        assertEquals(
            "yearly-plan",
            (purchaseResult as MosaicPresentationResult.ProductUnavailable).productReferenceId,
        )
    }

    @Test
    fun selectionProducesNonterminalProductSelectedOutcome() = runTest {
        val state = loadedState()

        val event = state.selectProduct("plans", "monthly-plan")

        assertEquals("monthly-plan", state.selectorStates.getValue("plans").selectedProductReferenceId)
        assertEquals("productSelected", event?.interaction?.wireName)
        assertNull(event?.presentationResult)
    }

    @Test
    fun authoredCardSelectionUsesCardIdsAndFallsBackWhenPriceIsMissing() = runTest {
        val products = MockMosaicPurchaseProvider.phase1Products().map { product ->
            if (product.id == "mosaic_pro_yearly") product.copy(localizedPrice = "  ") else product
        }
        val state = MosaicPaywallState(v02Document(), MockMosaicPurchaseProvider(products))

        state.loadProducts()

        val selector = state.selectorStates.getValue("plans")
        assertEquals("plans-monthly-plan-card", selector.selectedProductCardId)
        assertEquals("monthly-plan", selector.selectedProductReferenceId)
        assertEquals(
            listOf("plans-monthly-plan-card", "plans-lifetime-plan-card"),
            selector.options.map(MosaicAvailableProduct::productCardId),
        )
        val event = state.selectProduct("plans", "plans-lifetime-plan-card")
        assertEquals("lifetime-plan", event?.interaction.let {
            (it as MosaicInteractionOutcome.ProductSelected).productReferenceId
        })
        assertEquals(
            "plans-lifetime-plan-card",
            state.selectorStates.getValue("plans").selectedProductCardId,
        )
    }

    @Test
    fun currentUnavailableCardFallsBackToFirstAuthoredAvailableCard() = runTest {
        var loadedProducts = MockMosaicPurchaseProvider.phase1Products()
        val delegate = MockMosaicPurchaseProvider(loadedProducts)
        val provider = object : MosaicPurchaseProvider by delegate {
            override suspend fun loadProducts(productIds: List<String>): MosaicProductLoadResult =
                MosaicProductLoadResult.Loaded(
                    loadedProducts.filter { it.id in productIds },
                )
        }
        val state = MosaicPaywallState(v02Document(), provider)
        state.loadProducts()
        state.selectProduct("plans", "plans-lifetime-plan-card")
        loadedProducts = loadedProducts.filterNot { it.id == "mosaic_pro_lifetime" }

        state.loadProducts()

        assertEquals(
            "plans-monthly-plan-card",
            state.selectorStates.getValue("plans").selectedProductCardId,
        )
    }

    @Test
    fun noAuthoredCardsAvailableClearsCardSelectionAndDisablesPurchase() = runTest {
        val state = MosaicPaywallState(v02Document(), MockMosaicPurchaseProvider())

        state.loadProducts()

        val selector = state.selectorStates.getValue("plans")
        assertNull(selector.selectedProductCardId)
        assertNull(selector.selectedProductReferenceId)
        assertTrue(state.purchase("plans").presentationResult is MosaicPresentationResult.ProductUnavailable)
    }

    @Test
    fun blankPriceRemainsAvailableWhenActiveLocaleCardIsNameOnly() = runTest {
        val localizationKey = "test.product_card.active_locale"
        val source = v02Document()
        val monthly = source.productCard("plans-monthly-plan-card")
        val name = monthly.children.filterIsInstance<MosaicTextComponent>().first().copy(
            value = MosaicLocalizedText("{{ product.name }}", localizationKey),
        )
        val nameOnly = monthly.copy(
            children = listOf(name),
            accessibilityLabel = null,
        )
        val document = source.withOnlyProductCard(
            nameOnly,
            localization = source.localization.withLocalizedValue(
                locale = "ar",
                key = localizationKey,
                value = "{{ product.price }}",
            ),
        )
        val product = MockMosaicPurchaseProvider.phase1Products()
            .single { it.id == "mosaic_pro_monthly" }
            .copy(localizedPrice = "  ")
        val state = MosaicPaywallState(document, MockMosaicPurchaseProvider(listOf(product)))

        assertTrue(state.loadProducts(requestedLocale = "en").isEmpty())
        assertEquals(
            listOf("plans-monthly-plan-card"),
            state.selectorStates.getValue("plans").options.map(MosaicAvailableProduct::productCardId),
        )

        assertEquals(
            "productUnavailable",
            state.loadProducts(requestedLocale = "ar-EG").single().interaction.wireName,
        )
        assertTrue(state.selectorStates.getValue("plans").options.isEmpty())
    }

    @Test
    fun activeLocalizedPriceTemplateInNestedBadgeStackMakesBlankPriceUnavailable() = runTest {
        val localizationKey = "test.product_card.badge"
        val source = v02Document()
        val monthly = source.productCard("plans-monthly-plan-card")
        val name = monthly.children.filterIsInstance<MosaicTextComponent>().first()
        val badge = source.productCard("plans-yearly-plan-card").children
            .filterIsInstance<MosaicProductBadgeComponent>()
            .single()
        val badgeText = badge.children.filterIsInstance<MosaicTextComponent>().single().copy(
            value = MosaicLocalizedText("Name-only badge", localizationKey),
        )
        val badgeStack = source.layout.content.copy(
            id = "test-product-card-badge-stack",
            children = listOf(badgeText),
        )
        val card = monthly.copy(
            children = listOf(name, badge.copy(children = listOf(badgeStack))),
            accessibilityLabel = null,
        )
        val document = source.withOnlyProductCard(
            card,
            localization = source.localization.withLocalizedValue(
                locale = "ar",
                key = localizationKey,
                value = "{{ product.price }}",
            ),
        )
        val product = MockMosaicPurchaseProvider.phase1Products()
            .single { it.id == "mosaic_pro_monthly" }
            .copy(localizedPrice = "")
        val state = MosaicPaywallState(document, MockMosaicPurchaseProvider(listOf(product)))

        assertEquals(
            "productUnavailable",
            state.loadProducts(requestedLocale = "ar-EG").single().interaction.wireName,
        )
        assertTrue(state.selectorStates.getValue("plans").options.isEmpty())
    }

    @Test
    fun activeLocalizedPriceTemplateInCardAccessibilityMakesBlankPriceUnavailable() = runTest {
        val localizationKey = "test.product_card.accessibility"
        val source = v02Document()
        val monthly = source.productCard("plans-monthly-plan-card")
        val card = monthly.copy(
            children = listOf(monthly.children.filterIsInstance<MosaicTextComponent>().first()),
            accessibilityLabel = MosaicLocalizedText("{{ product.name }}", localizationKey),
        )
        val document = source.withOnlyProductCard(
            card,
            localization = source.localization.withLocalizedValue(
                locale = "ar",
                key = localizationKey,
                value = "{{product.price}}",
            ),
        )
        val product = MockMosaicPurchaseProvider.phase1Products()
            .single { it.id == "mosaic_pro_monthly" }
            .copy(localizedPrice = " ")
        val state = MosaicPaywallState(document, MockMosaicPurchaseProvider(listOf(product)))

        assertEquals(
            "productUnavailable",
            state.loadProducts(requestedLocale = "ar-EG").single().interaction.wireName,
        )
        assertTrue(state.selectorStates.getValue("plans").options.isEmpty())
    }

    @Test
    fun mapsEveryPurchaseScenarioToExactPresentationOutcome() = runTest {
        val expected = mapOf(
            MosaicMockPurchaseScenario.SUCCESS to "purchased",
            MosaicMockPurchaseScenario.CANCELLED to "cancelled",
            MosaicMockPurchaseScenario.FAILURE to "purchaseFailed",
            MosaicMockPurchaseScenario.PRODUCT_UNAVAILABLE to "productUnavailable",
            MosaicMockPurchaseScenario.ALREADY_ENTITLED to "alreadyEntitled",
        )

        expected.forEach { (scenario, wireName) ->
            val state = loadedState(purchaseScenario = scenario)
            val event = state.purchase("plans")
            assertEquals(scenario.name, wireName, event.interaction.wireName)
            assertEquals(scenario.name, wireName, event.presentationResult?.wireName)
        }
    }

    @Test
    fun mapsRestoreTerminalAndNonterminalOutcomesWithoutConflation() = runTest {
        suspend fun event(scenario: MosaicMockRestoreScenario): MosaicPaywallEvent =
            loadedState(restoreScenario = scenario).restore()

        assertEquals("restored", event(MosaicMockRestoreScenario.RESTORED).presentationResult?.wireName)
        assertEquals(
            "restored",
            event(MosaicMockRestoreScenario.ALREADY_ENTITLED).presentationResult?.wireName,
        )

        val nothing = event(MosaicMockRestoreScenario.NOTHING_TO_RESTORE)
        assertEquals("restoreNoPurchases", nothing.interaction.wireName)
        assertNull(nothing.presentationResult)

        val failed = event(MosaicMockRestoreScenario.FAILURE)
        assertEquals("restoreFailed", failed.interaction.wireName)
        assertNull(failed.presentationResult)
    }

    @Test
    fun closeMapsToDismissedAndHostRetainsDismissalOwnership() = runTest {
        val event = loadedState().close()

        assertEquals("dismissed", event.interaction.wireName)
        assertEquals(MosaicPresentationResult.Dismissed, event.presentationResult)
    }

    @Test
    fun navigationAndExternalUrlsStayRuntimeOnlyAndDiagnoseSafeNoOps() {
        val diagnostics = mutableListOf<MosaicDiagnostic>()
        val document = MosaicProtocolDecoder.decode(
            Files.readAllBytes(repositoryFile("protocol/fixtures/v0.2/navigation-only.json"))
                .toString(Charsets.UTF_8),
        )
        val state = MosaicPaywallState(
            document,
            MockMosaicPurchaseProvider(),
            MosaicDiagnosticSink(diagnostics::add),
        )

        assertFalse(state.navigateBack())
        assertEquals(MosaicDiagnosticCode.NAVIGATION_BACK_UNAVAILABLE, diagnostics.last().code)
        assertTrue(state.navigateTo("details"))
        assertEquals("details", state.currentScreenId)
        assertTrue(state.navigateBack())
        assertEquals("start", state.currentScreenId)

        val diagnosticCount = diagnostics.size
        state.recordExternalUrlResult(opened = true)
        assertEquals(diagnosticCount, diagnostics.size)
        state.recordExternalUrlResult(opened = false)
        assertEquals(MosaicDiagnosticCode.EXTERNAL_URL_FAILED, diagnostics.last().code)
    }

    @Test
    fun sheetNavigationKeepsTheMostRecentScreenAsItsBackgroundAndBackDismissesIt() {
        val state = MosaicPaywallState(v02Document(), MockMosaicPurchaseProvider())

        assertEquals(MosaicScreenPresentation.SCREEN, state.currentScreen.presentation)
        assertTrue(state.navigateTo("details"))
        assertEquals(MosaicScreenPresentation.SHEET, state.currentScreen.presentation)
        assertEquals("offer", state.backgroundScreen.id)
        assertEquals(MosaicScreenPresentation.SCREEN, state.backgroundScreen.presentation)

        assertTrue(state.navigateBack())
        assertEquals("offer", state.currentScreenId)
        assertTrue(state.navigationHistory.isEmpty())
    }

    @Test
    fun purchaseAndRestoreExposeBusyStateWhileProviderSuspends() = runTest {
        val purchaseGate = CompletableDeferred<Unit>()
        val restoreGate = CompletableDeferred<Unit>()
        val delegate = MockMosaicPurchaseProvider(MockMosaicPurchaseProvider.phase1Products())
        val provider = object : MosaicPurchaseProvider by delegate {
            override suspend fun purchase(productId: String): MosaicPurchaseResult {
                purchaseGate.await()
                return delegate.purchase(productId)
            }

            override suspend fun restore(): MosaicRestoreResult {
                restoreGate.await()
                return MosaicRestoreResult.NothingToRestore
            }
        }
        val state = MosaicPaywallState(canonicalDocument(), provider)
        state.loadProducts()

        val purchase = async { state.purchase("plans") }
        testScheduler.runCurrent()
        assertTrue("plans" in state.purchaseBusySelectorIds)
        purchaseGate.complete(Unit)
        purchase.await()
        assertFalse("plans" in state.purchaseBusySelectorIds)

        val restore = async { state.restore() }
        testScheduler.runCurrent()
        assertTrue(state.isRestoreBusy)
        restoreGate.complete(Unit)
        restore.await()
        assertFalse(state.isRestoreBusy)
    }

    @Test
    fun presentationUnionHasExactRc1WireValues() {
        val values = listOf(
            MosaicPresentationResult.Purchased("product", "provider", "transaction"),
            MosaicPresentationResult.Restored(emptySet()),
            MosaicPresentationResult.AlreadyEntitled(),
            MosaicPresentationResult.Dismissed,
            MosaicPresentationResult.Cancelled("product"),
            MosaicPresentationResult.ProductUnavailable(),
            MosaicPresentationResult.ConfigurationUnavailable("configuration"),
            MosaicPresentationResult.PurchaseFailed("product", "purchase"),
            MosaicPresentationResult.RenderingFailed(),
        ).map { it.wireName }

        assertEquals(
            listOf(
                "purchased",
                "restored",
                "alreadyEntitled",
                "dismissed",
                "cancelled",
                "productUnavailable",
                "configurationUnavailable",
                "purchaseFailed",
                "renderingFailed",
            ),
            values,
        )
    }

    private suspend fun loadedState(
        purchaseScenario: MosaicMockPurchaseScenario = MosaicMockPurchaseScenario.SUCCESS,
        restoreScenario: MosaicMockRestoreScenario = MosaicMockRestoreScenario.AUTOMATIC,
    ): MosaicPaywallState {
        val state = MosaicPaywallState(
            canonicalDocument(),
            MockMosaicPurchaseProvider(
                products = MockMosaicPurchaseProvider.phase1Products(),
                purchaseScenario = purchaseScenario,
                restoreScenario = restoreScenario,
            ),
        )
        state.loadProducts()
        return state
    }

    private fun v02Document(): MosaicPaywallDocument = MosaicProtocolDecoder.decode(
        Files.readAllBytes(repositoryFile("protocol/fixtures/v0.2/complete-paywall.json"))
            .toString(Charsets.UTF_8),
    )

    private fun MosaicPaywallDocument.productCard(id: String): MosaicProductCardComponent =
        walkNodesDepthFirst().filterIsInstance<MosaicProductCardComponent>().single { it.id == id }

    private fun MosaicPaywallDocument.withOnlyProductCard(
        card: MosaicProductCardComponent,
        localization: MosaicLocalization = this.localization,
    ): MosaicPaywallDocument {
        fun replace(node: MosaicNode): MosaicNode = when (node) {
            is MosaicStack -> node.copy(children = node.children.map(::replace))
            is MosaicProductSelectorComponent -> node.copy(
                productReferenceIds = listOf(card.productReferenceId),
                initiallySelectedProductReferenceId = card.productReferenceId,
                cards = listOf(card),
                initialProductCardId = card.id,
            )
            else -> node
        }

        val updatedScreens = screens.map { screen ->
            screen.copy(
                layout = screen.layout.copy(content = replace(screen.layout.content) as MosaicStack),
            )
        }
        return copy(
            localization = localization,
            screens = updatedScreens,
            layout = updatedScreens.first { it.id == initialScreenId }.layout,
        )
    }

    private fun MosaicLocalization.withLocalizedValue(
        locale: String,
        key: String,
        value: String,
    ): MosaicLocalization {
        val catalog = locales.getValue(locale)
        return copy(
            locales = locales + (locale to catalog.copy(strings = catalog.strings + (key to value))),
        )
    }
}
