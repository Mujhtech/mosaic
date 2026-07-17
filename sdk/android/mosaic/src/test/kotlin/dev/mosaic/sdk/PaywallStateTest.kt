package dev.mosaic.sdk

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PaywallStateTest {
    @Test
    fun retainsConfiguredSelectionWhenAvailable() = runTest {
        val state = loadedState()

        assertEquals("yearly-plan", state.selectorStates.getValue("plans").selectedProductReferenceId)
        assertEquals(
            listOf("monthly-plan", "yearly-plan"),
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
            "alreadyEntitled",
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
}
