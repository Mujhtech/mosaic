package dev.mosaic.sdk

import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

class ProtocolV02Test {
    @Test
    fun `decodes canonical Protocol 02 with every native component`() {
        val document = v02Document("complete-paywall.json")
        val nodes = document.layout.content.walkDepthFirst().toList()

        assertEquals(MOSAIC_PROTOCOL_VERSION_V02, document.schemaVersion)
        assertEquals(MosaicStackDirection.VERTICAL, document.layout.content.direction)
        assertTrue(nodes.any { it is MosaicCarouselComponent })
        assertEquals(2, nodes.filterIsInstance<MosaicSwitchComponent>().size)
        assertTrue(nodes.any { it is MosaicCountdownComponent })
        assertEquals(
            document.compatibility.requiredCapabilities.map { it.name }.toSet(),
            MosaicCapabilityCatalog.v02,
        )

        val selector = nodes.filterIsInstance<MosaicProductSelectorComponent>().single()
        val selected = selector.cardStyles.resolve(selected = true)
        assertEquals("surface.default", selected.background.rawValue)
        assertEquals("action.primary", selected.border.color.rawValue)
        assertEquals(2.0, selected.border.width, 0.0)
        assertEquals(18.0, selected.padding.start, 0.0)
        assertEquals(16.0, selected.padding.top, 0.0)
    }

    @Test
    fun `decodes all valid edge and migration fixtures and preserves Protocol 01`() {
        listOf(
            "edge-cases.json",
            "expired-countdown.json",
            "hidden-purchase-target.json",
            "migrated-v0.1.json",
        ).forEach { fixture ->
            assertEquals("0.2", v02Document(fixture).schemaVersion)
        }
        assertEquals("0.1", canonicalDocument().schemaVersion)
    }

    @Test
    fun `rejects noncanonical colors and wrong countdown unit order`() {
        assertThrows(MosaicProtocolException::class.java) {
            v02Document("invalid/noncanonical-color.json")
        }
        val root = v02Object("complete-paywall.json")
        findNode(root, "offer-countdown").apply {
            addProperty("largestUnit", "second")
            addProperty("smallestUnit", "day")
        }
        assertThrows(MosaicProtocolException::class.java) {
            MosaicProtocolDecoder.decode(root.toString())
        }
    }

    @Test
    fun `switch visibility and carousel runtime reset with a new accepted document state`() {
        val document = v02Document("complete-paywall.json")
        val state = MosaicPaywallState(document, MockMosaicPurchaseProvider())

        assertTrue(state.switchValue("show-offer-details"))
        assertTrue(state.isNodeVisible("show-technical-details"))
        state.setSwitchValue("show-offer-details", false)
        state.setCarouselPageIndex("offer-highlights", 0)
        assertFalse(state.isNodeVisible("show-technical-details"))

        val replacement = MosaicPaywallState(document, MockMosaicPurchaseProvider())
        assertTrue(replacement.switchValue("show-offer-details"))
        assertEquals(1, replacement.carouselPageIndex("offer-highlights"))
    }

    @Test
    fun `countdown uses the controlled device wall clock and localized completion`() {
        val component = v02Document("complete-paywall.json").layout.content.walkDepthFirst()
            .filterIsInstance<MosaicCountdownComponent>()
            .single()
        assertEquals(
            "1d 1h 1m 1s",
            MosaicCountdownText.resolve(
                component,
                component.endsAtEpochMillis - 90_061_000L,
                "Offer ended",
            ),
        )
        assertEquals(
            "Offer ended",
            MosaicCountdownText.resolve(component, component.endsAtEpochMillis, "Offer ended"),
        )
    }

    @Test
    fun `Local Preview 02 codec is exact and round trips canonical flow`() {
        val flow = JsonParser.parseString(
            Files.readAllBytes(
                repositoryFile("protocol/fixtures/local-preview/v0.2/session-flow.messages.json"),
            ).toString(Charsets.UTF_8),
        ).asJsonArray
        flow.forEach { source ->
            val decoded = MosaicLocalPreviewCodec.decode(
                source.toString(),
                MOSAIC_LOCAL_PREVIEW_VERSION_V02,
            )
            assertEquals(MOSAIC_LOCAL_PREVIEW_VERSION_V02, decoded.previewProtocolVersion)
            MosaicLocalPreviewCodec.encode(decoded, MOSAIC_LOCAL_PREVIEW_VERSION_V02)
        }
        assertThrows(MosaicPreviewCodecException::class.java) {
            MosaicLocalPreviewCodec.decode(flow.first().toString(), MOSAIC_LOCAL_PREVIEW_VERSION)
        }
    }

    private fun v02Document(name: String): MosaicPaywallDocument =
        MosaicProtocolDecoder.decode(
            Files.readAllBytes(repositoryFile("protocol/fixtures/v0.2/$name")).toString(Charsets.UTF_8),
        )

    private fun v02Object(name: String) = JsonParser.parseString(
        Files.readAllBytes(repositoryFile("protocol/fixtures/v0.2/$name")).toString(Charsets.UTF_8),
    ).asJsonObject
}
