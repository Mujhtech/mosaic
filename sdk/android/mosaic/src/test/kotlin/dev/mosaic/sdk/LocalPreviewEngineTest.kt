package dev.mosaic.sdk

import com.google.gson.JsonArray
import com.google.gson.JsonParser
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

class LocalPreviewEngineTest {
    @Test
    fun `canonical live revision waits for composition then acknowledges`() {
        val engine = engine()
        engine.process(message(2))
        val draft = message(3)

        assertTrue(engine.process(draft).isEmpty())
        val render = requireNotNull(engine.state.value.render)
        assertEquals(2, render.revision?.sequence)
        assertTrue(render.isAwaitingAcknowledgement)

        val acknowledgement = engine.confirmDraftIsLive(
            requireNotNull(render.editableDocumentId),
            requireNotNull(render.revision),
        )

        assertTrue(acknowledgement.last() is MosaicPreviewDraftAcceptedPayload)
        assertFalse(requireNotNull(engine.state.value.render).isAwaitingAcknowledgement)
    }

    @Test
    fun `stale duplicate and conflicting revisions follow independent local ordering`() {
        val engine = engine()
        val draft = message(3)
        engine.process(draft)
        val render = requireNotNull(engine.state.value.render)
        engine.confirmDraftIsLive(requireNotNull(render.editableDocumentId), requireNotNull(render.revision))

        val duplicate = engine.process(draft)
        assertTrue(duplicate.single() is MosaicPreviewDraftAcceptedPayload)

        val draftPayload = draft.payload as MosaicPreviewDraftUpdatedPayload
        val conflict = draft.copy(
            payload = draftPayload.copy(
                revision = draftPayload.revision.copy(revisionId = "revision_conflict_000002"),
            ),
        )
        val conflictResult = engine.process(conflict).single() as MosaicPreviewDraftRejectedPayload
        assertEquals(MosaicPreviewDraftRejectionReason.REVISION_CONFLICT, conflictResult.reason)

        val staleResult = engine.process(message(6)).single() as MosaicPreviewDraftRejectedPayload
        assertEquals(MosaicPreviewDraftRejectionReason.STALE_REVISION, staleResult.reason)
        assertEquals(2, engine.state.value.render?.revision?.sequence)
    }

    @Test
    fun `invalid canonical update identifies component property and keeps accepted revision`() {
        val engine = acceptedEngine()

        val responses = engine.process(message(8))

        val validation = responses.filterIsInstance<MosaicPreviewValidationErrorPayload>().single()
        val rejection = responses.filterIsInstance<MosaicPreviewDraftRejectedPayload>().single()
        assertEquals("plans", validation.errors.single().location.componentId)
        assertEquals("productReferenceIds", validation.errors.single().location.property)
        assertEquals(MosaicPreviewDraftRejectionReason.VALIDATION_FAILED, rejection.reason)
        assertEquals(2, engine.state.value.render?.revision?.sequence)
        assertEquals(MosaicPreviewProblemKind.INVALID_DOCUMENT, engine.state.value.diagnostic?.kind)
    }

    @Test
    fun `unsupported component emits blocking warning and defined fallback`() {
        val engine = acceptedEngine()
        val base = message(3)
        val payload = base.payload as MosaicPreviewDraftUpdatedPayload
        val document = JsonParser.parseString(payload.documentJson).asJsonObject
        findNode(document, "headline").addProperty("type", "carousel")
        val update = base.copy(
            payload = payload.copy(
                revision = MosaicLocalRevision("revision_unsupported_000005", 5),
                documentJson = document.toString(),
            ),
        )

        val responses = engine.process(update)

        val warning = responses.filterIsInstance<MosaicPreviewRenderWarningPayload>()
            .single().warnings.single()
        val rejection = responses.filterIsInstance<MosaicPreviewDraftRejectedPayload>().single()
        assertEquals(MosaicPreviewWarningSeverity.BLOCKING, warning.severity)
        assertEquals(MosaicPreviewFallback.KEEP_LAST_ACCEPTED_DRAFT, warning.fallback)
        assertEquals("headline", warning.location?.componentId)
        assertEquals(MosaicPreviewDraftRejectionReason.UNSUPPORTED_CAPABILITY, rejection.reason)
        assertEquals(2, engine.state.value.render?.revision?.sequence)
        assertEquals(MosaicPreviewProblemKind.UNSUPPORTED_COMPONENT, engine.state.value.diagnostic?.kind)
    }

    @Test
    fun `render failure restores the last accepted revision`() {
        val engine = acceptedEngine()
        val candidate = message(11)
        engine.process(candidate)
        val render = requireNotNull(engine.state.value.render)
        assertEquals(4, render.revision?.sequence)

        val responses = engine.reportRenderFailure(
            requireNotNull(render.editableDocumentId),
            requireNotNull(render.revision),
        )

        assertTrue(responses.first() is MosaicPreviewRenderFailurePayload)
        assertTrue(responses.last() is MosaicPreviewDraftRejectedPayload)
        assertEquals(2, engine.state.value.render?.revision?.sequence)
        assertEquals(MosaicPreviewProblemKind.RENDER_FAILURE, engine.state.value.diagnostic?.kind)
    }

    @Test
    fun `locale RTL and accessibility text scale are preview context not document mutations`() {
        val engine = acceptedEngine()
        val base = message(3)
        val payload = base.payload as MosaicPreviewDraftUpdatedPayload
        val update = base.copy(
            payload = payload.copy(
                revision = MosaicLocalRevision("revision_accessibility_000003", 3),
                preview = MosaicPreviewContext("ar", 2f),
            ),
        )

        engine.process(update)

        val render = requireNotNull(engine.state.value.render)
        assertEquals("ar", render.locale)
        assertEquals(2f, render.textScale)
        assertEquals(
            MosaicLayoutDirection.RTL,
            MosaicLocalizationResolver(render.document.localization, render.locale).direction,
        )
        assertEquals(1, render.document.revision)
    }

    @Test
    fun `commerce ordering is separate and stale commerce cannot replace newer state`() {
        val engine = engine()
        val original = message(2)
        val payload = original.payload as MosaicPreviewMockCommerceStateChangedPayload
        val newerState = payload.state.copy(purchaseOutcome = MosaicPreviewPurchaseOutcome.CANCELLED)
        val newer = original.copy(
            payload = payload.copy(
                stateRevision = MosaicLocalRevision("revision_commerce_000002", 2),
                state = newerState,
            ),
        )
        engine.process(newer)
        engine.process(original)
        engine.process(message(3))

        assertEquals(MosaicPreviewPurchaseOutcome.CANCELLED, engine.state.value.commerce?.purchaseOutcome)
        assertEquals(2, engine.state.value.commerceRevision?.sequence)
        assertTrue(
            engine.state.value.recentDiagnostics.any { it.code == "preview.staleCommerceRevision" },
        )
    }

    @Test
    fun `unavailable commerce arriving after acceptance emits one live fallback warning`() = runTest {
        val engine = acceptedEngine()
        val source = message(2)
        val payload = source.payload as MosaicPreviewMockCommerceStateChangedPayload
        val unavailableState = payload.state.copy(
            products = payload.state.products.map { product ->
                if (product.productReferenceId == "yearly-plan") {
                    MosaicPreviewMockProduct.Unavailable(
                        productReferenceId = "yearly-plan",
                        reason = MosaicPreviewMockProduct.Unavailable.Reason.TEMPORARILY_UNAVAILABLE,
                    )
                } else {
                    product
                }
            },
        )
        val change = source.copy(
            payload = payload.copy(
                stateRevision = MosaicLocalRevision("revision_commerce_000002", 2),
                state = unavailableState,
            ),
        )

        val first = engine.process(change)
        val duplicate = engine.process(change)

        val warning = first.single() as MosaicPreviewRenderWarningPayload
        assertEquals(MosaicPreviewFallback.USE_SELECTOR_FALLBACK, warning.warnings.single().fallback)
        assertEquals(2, warning.revision.sequence)
        assertTrue(duplicate.isEmpty())
        val products = engine.purchaseProvider.loadProducts(
            listOf("mosaic_pro_monthly", "mosaic_pro_yearly"),
        ) as MosaicProductLoadResult.Loaded
        assertEquals(listOf("mosaic_pro_monthly"), products.products.map(MosaicProduct::id))
        assertEquals(setOf("mosaic_pro_yearly"), products.unavailableProductIds)
    }

    @Test
    fun `canonical commerce drives provider products purchase and entitlement`() = runTest {
        val engine = engine()
        engine.process(message(2))
        engine.process(message(3))

        val products = engine.purchaseProvider.loadProducts(
            listOf("mosaic_pro_monthly", "mosaic_pro_yearly"),
        ) as MosaicProductLoadResult.Loaded
        assertEquals(listOf("$9.99", "$79.99"), products.products.map(MosaicProduct::localizedPrice))
        assertTrue(engine.purchaseProvider.purchase("mosaic_pro_yearly") is MosaicPurchaseResult.Purchased)
        assertTrue(engine.purchaseProvider.restore() is MosaicRestoreResult.Restored)
        assertNull((engine.purchaseProvider.activeEntitlements() as MosaicActiveEntitlementsResult.Active)
            .entitlements.firstOrNull())
    }

    private fun acceptedEngine(): MosaicLocalPreviewEngine = engine().also { engine ->
        engine.process(message(2))
        engine.process(message(3))
        val render = requireNotNull(engine.state.value.render)
        engine.confirmDraftIsLive(requireNotNull(render.editableDocumentId), requireNotNull(render.revision))
    }

    private fun engine() = MosaicLocalPreviewEngine(
        clientId = "client_android_test",
        fallback = MosaicPaywallLoadResult.Loaded(
            canonicalDocument(),
            MosaicPaywallSource.BUNDLED_FALLBACK,
        ),
    )

    private fun message(index: Int): MosaicPreviewMessage = MosaicLocalPreviewCodec.decode(
        canonicalPreviewFlow()[index].toString(),
    )

    private fun canonicalPreviewFlow(): JsonArray = JsonParser.parseString(
        Files.readAllBytes(
            repositoryFile("protocol/fixtures/local-preview/v0.1/session-flow.messages.json"),
        ).toString(Charsets.UTF_8),
    ).asJsonArray
}
