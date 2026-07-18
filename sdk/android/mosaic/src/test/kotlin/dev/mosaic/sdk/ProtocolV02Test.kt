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
        val nodes = document.screens.flatMap { screen ->
            screen.layout.content.walkDepthFirst().toList()
        }

        assertEquals(MOSAIC_PROTOCOL_VERSION_V02, document.schemaVersion)
        assertEquals(MosaicStackDirection.VERTICAL, document.layout.content.direction)
        assertEquals(2, document.screens.size)
        assertEquals(MosaicScreenPresentation.SCREEN, document.screens.single { it.id == "offer" }.presentation)
        assertEquals(MosaicScreenPresentation.SHEET, document.screens.single { it.id == "details" }.presentation)
        assertEquals(2, document.assets.filterIsInstance<MosaicImageAsset>().size)
        assertEquals(2, document.assets.filterIsInstance<MosaicVideoAsset>().size)
        assertTrue(
            document.assets.filterIsInstance<MosaicVideoAsset>()
                .any { it.source is MosaicAssetSource.Bundled },
        )
        assertTrue(
            document.assets.filterIsInstance<MosaicVideoAsset>()
                .any { it.source is MosaicAssetSource.Remote },
        )
        assertEquals(2, document.designSystem.colors.size)
        assertEquals("#007F73FF", document.designSystem.colors.single { it.id == "brand-accent" }.value.rawValue)
        assertEquals(5, document.designSystem.backgrounds.size)
        assertTrue(
            document.designSystem.backgrounds.single { it.id == "offer-gradient" }.value
                is MosaicBackground.LinearGradient,
        )
        val sheetVideo = document.designSystem.backgrounds.single { it.id == "sheet-video" }.value
            as MosaicBackground.Video
        assertEquals("remote-sheet-video", sheetVideo.assetId)
        assertEquals("remote-texture", sheetVideo.posterAssetId)
        assertEquals(2, document.designSystem.shadows.size)
        assertEquals(
            24.0,
            document.designSystem.shadows.single { it.id == "elevated" }.value.blurRadius,
            0.0,
        )
        assertTrue(nodes.any { it is MosaicCarouselComponent })
        assertEquals(2, nodes.filterIsInstance<MosaicSwitchComponent>().size)
        assertTrue(nodes.any { it is MosaicCountdownComponent })
        assertEquals(
            document.compatibility.requiredCapabilities.map { it.name }.toSet(),
            MosaicCapabilityCatalog.v02,
        )

        val selector = nodes.filterIsInstance<MosaicProductSelectorComponent>().single()
        assertEquals(MosaicStackDirection.HORIZONTAL, selector.direction)
        assertEquals(
            listOf(
                "plans-monthly-plan-card",
                "plans-yearly-plan-card",
                "plans-lifetime-plan-card",
            ),
            selector.cards.map(MosaicProductCardComponent::id),
        )
        assertEquals("plans-yearly-plan-card", selector.initialProductCardId)
        val yearly = selector.cards.single { it.id == selector.initialProductCardId }
        val selected = yearly.styles.resolve(selected = true)
        assertEquals("surface.elevated", selected.background.rawValue)
        assertEquals("action.primary", selected.border.color.rawValue)
        assertEquals(2.0, selected.border.width, 0.0)
        assertEquals(18.0, selected.padding.start, 0.0)
        assertEquals(16.0, selected.padding.top, 0.0)
        val hero = nodes.filterIsInstance<MosaicImageComponent>().single { it.id == "hero" }
        assertEquals(MosaicWidthSizing.Fill, hero.sizing?.width)
        assertEquals(MosaicHeightSizing.Fixed(180.0), hero.sizing?.height)
        val overlay = nodes.filterIsInstance<MosaicProductBadgeComponent>()
            .single { it.id == "plans-lifetime-plan-card-badge" }
            .placement as MosaicProductBadgePlacement.Overlay
        assertEquals(MosaicProductBadgeAnchor.TOP_END, overlay.anchor)
        assertEquals(8.0, overlay.inset, 0.0)
    }

    @Test
    fun `decodes all valid edge and migration fixtures and preserves Protocol 01`() {
        listOf(
            "edge-cases.json",
            "expired-countdown.json",
            "hidden-purchase-target.json",
            "navigation-only.json",
            "migrated-v0.1.json",
        ).forEach { fixture ->
            assertEquals("0.2", v02Document(fixture).schemaVersion)
        }
        assertEquals("0.1", canonicalDocument().schemaVersion)
    }

    @Test
    fun `navigation and external URL actions do not require normalized commerce outcomes`() {
        val document = v02Document("navigation-only.json")
        val capabilities = document.compatibility.requiredCapabilities.map { it.name }.toSet()

        assertTrue(MosaicCapabilityName.NAVIGATE_TO_ACTION in capabilities)
        assertTrue(MosaicCapabilityName.NAVIGATE_BACK_ACTION in capabilities)
        assertTrue(MosaicCapabilityName.OPEN_EXTERNAL_URL_ACTION in capabilities)
        assertFalse(MosaicCapabilityName.NORMALIZED_OUTCOME in capabilities)
    }

    @Test
    fun `external URLs share the canonical parser independent safety boundary`() {
        listOf(
            "https://user:secret@example.com/privacy",
            "https://example.com/privacy policy",
            "https://例え.テスト/privacy",
            "https://example.com\\@evil.example/privacy",
            "https://example.com:70000/privacy",
        ).forEach { url ->
            val root = v02Object("complete-paywall.json")
            findNode(root, "privacy-policy").getAsJsonObject("action").addProperty("url", url)
            assertThrows(url, MosaicProtocolException::class.java) {
                MosaicProtocolDecoder.decode(root.toString())
            }
        }

        val punycode = v02Object("complete-paywall.json")
        findNode(punycode, "privacy-policy").getAsJsonObject("action").addProperty(
            "url",
            "https://xn--r8jz45g.xn--zckzah/privacy",
        )
        assertEquals("0.2", MosaicProtocolDecoder.decode(punycode.toString()).schemaVersion)
    }

    @Test
    fun `rejects noncanonical colors and wrong countdown unit order`() {
        listOf(
            "invalid/noncanonical-color.json",
            "invalid/insecure-external-url.json",
            "invalid/interactive-button-child.json",
            "invalid/navigation-cycle.json",
            "invalid/duplicate-product-reference.json",
            "invalid/incomplete-product-card-default.json",
            "invalid/interactive-product-card-child.json",
            "invalid/product-card-outside-selector.json",
            "invalid/unsafe-product-template.json",
        ).forEach { fixture ->
            assertThrows(fixture, MosaicProtocolException::class.java) {
                v02Document(fixture)
            }
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
    fun `design tokens are category scoped and reject missing or cyclic chains`() {
        v02Object("complete-paywall.json").also { root ->
            root.getAsJsonObject("designSystem").getAsJsonArray("colors")[1]
                .asJsonObject.getAsJsonObject("value").addProperty("id", "missing-color")
            assertThrows(MosaicProtocolException::class.java) {
                MosaicProtocolDecoder.decode(root.toString())
            }
        }

        v02Object("complete-paywall.json").also { root ->
            root.getAsJsonObject("designSystem").getAsJsonArray("colors")[0]
                .asJsonObject.add(
                    "value",
                    JsonParser.parseString("""{"type":"colorToken","id":"brand-accent"}"""),
                )
            assertThrows(MosaicProtocolException::class.java) {
                MosaicProtocolDecoder.decode(root.toString())
            }
        }

        v02Object("complete-paywall.json").also { root ->
            findNode(root, "paywall-content").getAsJsonObject("appearance").add(
                "background",
                JsonParser.parseString("""{"type":"backgroundToken","id":"brand-primary"}"""),
            )
            assertThrows(MosaicProtocolException::class.java) {
                MosaicProtocolDecoder.decode(root.toString())
            }
        }
    }

    @Test
    fun `initial presentation must be a screen and remote media must use HTTPS`() {
        v02Object("complete-paywall.json").also { root ->
            root.getAsJsonArray("screens")[0].asJsonObject.getAsJsonObject("presentation")
                .addProperty("type", "sheet")
            assertThrows(MosaicProtocolException::class.java) {
                MosaicProtocolDecoder.decode(root.toString())
            }
        }

        v02Object("complete-paywall.json").also { root ->
            root.getAsJsonArray("assets")[3].asJsonObject.getAsJsonObject("source")
                .addProperty("url", "http://assets.example.com/details.mp4")
            assertThrows(MosaicProtocolException::class.java) {
                MosaicProtocolDecoder.decode(root.toString())
            }
        }
    }

    @Test
    fun `linear gradient angles use physical clockwise coordinates without RTL input`() {
        val leftToRight = MosaicGradientGeometry.direction(0f)
        val topToBottom = MosaicGradientGeometry.direction(90f)
        val fullTurn = MosaicGradientGeometry.direction(360f)

        assertEquals(1f, leftToRight.x, 0.0001f)
        assertEquals(0f, leftToRight.y, 0.0001f)
        assertEquals(0f, topToBottom.x, 0.0001f)
        assertEquals(1f, topToBottom.y, 0.0001f)
        assertEquals(leftToRight.x, fullTurn.x, 0.0001f)
        assertEquals(leftToRight.y, fullTurn.y, 0.0001f)
    }

    @Test
    fun `product templates tolerate whitespace and provider title falls back to reference label`() {
        assertEquals(
            "Provider title — $9.99",
            MosaicProductTemplate.resolve(
                "{{product.name}} — {{ product.price }}",
                "Provider title",
                "Reference label",
                "$9.99",
            ),
        )
        assertEquals(
            "Reference label / $9.99",
            MosaicProductTemplate.resolve(
                "{{ product.name }} / {{product.price}}",
                "",
                "Reference label",
                "$9.99",
            ),
        )
    }

    @Test
    fun `vertical selector preserves authored cards and cross axis alignment`() {
        val root = v02Object("complete-paywall.json")
        findNode(root, "plans").apply {
            addProperty("direction", "vertical")
            addProperty("crossAxisAlignment", "start")
        }

        val selector = MosaicProtocolDecoder.decode(root.toString()).walkNodesDepthFirst()
            .filterIsInstance<MosaicProductSelectorComponent>()
            .single()

        assertEquals(MosaicStackDirection.VERTICAL, selector.direction)
        assertEquals(MosaicHorizontalAlignment.START, selector.crossAxisAlignment)
        assertEquals(3, selector.cards.size)
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
