package dev.mosaic.sdk

import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Paywall Protocol document decoding, against the canonical corpus rather than hand-built documents.
 *
 * Motion's own rules are [ProtocolMotionTest]'s subject and the frame arithmetic is
 * [MotionFrameConformanceTest]'s; what is protected here is everything a document carries besides
 * motion, and every semantic rule the schema alone cannot express.
 */
class ProtocolDocumentTest {
    @Test
    fun `decodes the canonical document with every native component`() {
        val document = protocolFixtureDocument("complete-paywall.json")
        val nodes = document.screens.flatMap { screen ->
            screen.layout.content.walkDepthFirst().toList()
        }

        assertEquals(MOSAIC_PROTOCOL_VERSION, document.schemaVersion)
        assertEquals(MosaicStackDirection.VERTICAL, document.layout.content.direction)
        assertEquals(2, document.screens.size)
        assertEquals(MosaicScreenPresentation.SCREEN, document.screens.single { it.id == "offer" }.presentation)
        assertEquals(MosaicScreenPresentation.SHEET, document.screens.single { it.id == "details" }.presentation)
        assertEquals(4, document.assets.filterIsInstance<MosaicImageAsset>().size)
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
            MosaicCapabilityCatalog.current,
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

    /**
     * Protects the decoded shape of Tabs, Timeline, Award, and Social Proof, from the canonical
     * fixture that exercises every edge shape: an authored non-first `initialTabId`, all three
     * marker arms plus a markerless Timeline, both emblem arms plus an emblem-less Award, and
     * rated/unrated Social Proof. A silently dropped optional or a substituted default would show
     * up here.
     */
    @Test
    fun `decodes components with their authored absences intact`() {
        val nodes = protocolFixtureDocument("complete-paywall.json").walkNodesDepthFirst().toList()

        val tabs = nodes.filterIsInstance<MosaicTabsComponent>().single()
        assertEquals(3, tabs.tabs.size)
        // The authored initial tab is not the first entry, so a positional default would be visible.
        assertEquals("billing-tabs-annual", tabs.initialTabId)
        assertEquals("action.onPrimary", tabs.selectedLabelColor.rawValue)
        assertEquals(
            "action.primary",
            tabs.styles.resolve(selected = true).border.color.rawValue,
        )
        assertEquals(
            "surface.default",
            (tabs.styles.resolve(selected = false).background as MosaicBackground.Solid).color.rawValue,
        )

        val trial = nodes.filterIsInstance<MosaicTimelineComponent>().single { it.id == "trial-timeline" }
        assertEquals(
            listOf(
                MosaicMarker.Dot,
                MosaicMarker.Ordinal,
                MosaicMarker.Icon(MosaicIconName.LOCK),
            ),
            trial.entries.map(MosaicTimelineEntry::marker),
        )
        assertEquals(MosaicTimelineConnectorStyle.SOLID, trial.connector.style)
        // The last entry declares no description: nothing is substituted for it.
        assertEquals(null, trial.entries.last().description)
        val support = nodes.filterIsInstance<MosaicTimelineComponent>().single { it.id == "support-timeline" }
        assertEquals(MosaicTimelineConnectorStyle.DASHED, support.connector.style)
        assertTrue(support.entries.all { it.marker == null })
        // No entry consumes marker or description style, so the document must not declare them.
        assertEquals(null, support.markerColor)
        assertEquals(null, support.markerSize)
        assertEquals(null, support.descriptionTypography)

        val awards = nodes.filterIsInstance<MosaicAwardComponent>().associateBy(MosaicAwardComponent::id)
        assertEquals(
            MosaicAwardEmblem.Icon(MosaicIconName.CHECKMARK, 28.0, MosaicColor("action.primary")),
            awards.getValue("editor-award").emblem,
        )
        assertEquals(
            MosaicAwardEmblem.Image("award-emblem", 48.0),
            awards.getValue("press-award").emblem,
        )
        assertEquals(null, awards.getValue("press-award").subtitle)
        assertEquals(null, awards.getValue("press-award").subtitleTypography)

        val proofs = nodes.filterIsInstance<MosaicSocialProofComponent>()
            .associateBy(MosaicSocialProofComponent::id)
        val rated = checkNotNull(proofs.getValue("rated-review").rating)
        // Nine half-steps out of five points is four and a half symbols, not nine.
        assertEquals(9, rated.value)
        assertEquals(MosaicSocialProofRatingStep.HALF, rated.step)
        assertEquals(4.5, rated.filledPoints, 0.0)
        assertEquals(10, rated.maximumSteps)
        assertEquals("reviewer-avatar", proofs.getValue("rated-review").avatar?.assetId)
        assertEquals(
            MosaicSocialProofRatingStep.WHOLE,
            checkNotNull(proofs.getValue("whole-review").rating).step,
        )
        assertEquals(null, proofs.getValue("analyst-note").rating)
        assertEquals(null, proofs.getValue("analyst-note").avatar)
    }

    /**
     * The semantic rules the schema alone cannot express, each asserted against the canonical
     * document mutated in exactly one way, so a rule that stopped firing could not hide behind an
     * unrelated rejection.
     *
     * The committed invalid fixtures are swept wholesale by [ProtocolMotionTest], so only the
     * mutations that have no fixture of their own are made here.
     */
    @Test
    fun `rejects the semantic violations the schema alone cannot express`() {
        // A rating value beyond maximum x stepsPerPoint.
        protocolFixtureObject("complete-paywall.json").also { root ->
            findNode(root, "whole-review").getAsJsonObject("rating").addProperty("value", 6)
            assertThrows(MosaicProtocolException::class.java) {
                MosaicProtocolDecoder.decode(root.toString())
            }
        }

        // A marker style nothing consumes is as invalid as a missing one.
        protocolFixtureObject("complete-paywall.json").also { root ->
            findNode(root, "support-timeline").addProperty("markerSize", 12)
            assertThrows(MosaicProtocolException::class.java) {
                MosaicProtocolDecoder.decode(root.toString())
            }
        }

        // A marked entry whose component declares no marker colour.
        protocolFixtureObject("complete-paywall.json").also { root ->
            findNode(root, "trial-timeline").remove("markerColor")
            assertThrows(MosaicProtocolException::class.java) {
                MosaicProtocolDecoder.decode(root.toString())
            }
        }

        // `initialTabId` must name a declared tab; there is no positional recovery.
        protocolFixtureObject("complete-paywall.json").also { root ->
            findNode(root, "billing-tabs").addProperty("initialTabId", "billing-tabs-quarterly")
            assertThrows(MosaicProtocolException::class.java) {
                MosaicProtocolDecoder.decode(root.toString())
            }
        }

        // A tab condition inside the panel it names is dead layout, not a hidden node.
        protocolFixtureObject("complete-paywall.json").also { root ->
            findNode(root, "billing-tabs-annual-body").add(
                "visibility",
                JsonParser.parseString(
                    """{"mode":"tab","tabsId":"billing-tabs","equals":"billing-tabs-annual"}""",
                ),
            )
            assertThrows(MosaicProtocolException::class.java) {
                MosaicProtocolDecoder.decode(root.toString())
            }
        }

        // An unknown marker arm rejects; there is no substitute glyph.
        protocolFixtureObject("complete-paywall.json").also { root ->
            findNode(root, "trial-timeline").getAsJsonArray("entries")[0]
                .asJsonObject.getAsJsonObject("marker").addProperty("kind", "square")
            assertThrows(MosaicProtocolException::class.java) {
                MosaicProtocolDecoder.decode(root.toString())
            }
        }
    }

    /**
     * Reserved accessibility strings, both directions plus their derived capability.
     *
     * A missing key leaves the renderer inventing a phrase — the hardcoded-English defect these
     * keys exist to retire — and a lingering one is copy nothing reads. Neither direction can be
     * checked by the schema, and the capability is what stops a client that cannot read the keys
     * from accepting a document that needs them.
     */
    @Test
    fun `reserved accessibility strings are required and forbidden in both directions`() {
        val document = protocolFixtureDocument("complete-paywall.json")
        val defaultStrings = checkNotNull(
            document.localization.locales[document.localization.defaultLocale],
        ).strings
        assertTrue(MosaicReservedAccessibilityKey.RATING in defaultStrings)
        assertTrue(MosaicReservedAccessibilityKey.IN_PROGRESS in defaultStrings)
        assertTrue(
            MosaicCapabilityName.ACCESSIBILITY_RESERVED_STRINGS in
                document.compatibility.requiredCapabilities.map { it.name },
        )

        // Required: the document announces a rating, so the key cannot be dropped.
        assertThrows(MosaicProtocolException::class.java) {
            MosaicProtocolDecoder.decode(
                canonicalFixtureReplacing(
                    """"mosaic.a11y.rating": "{{ rating.value }} out of {{ rating.maximum }} stars",""",
                    "",
                ),
            )
        }
        // Each placeholder exactly once: a translation that drops one announces no number at all.
        assertThrows(MosaicProtocolException::class.java) {
            MosaicProtocolDecoder.decode(
                canonicalFixtureReplacing(
                    """"mosaic.a11y.rating": "{{ rating.value }} von {{ rating.maximum }} Sternen",""",
                    """"mosaic.a11y.rating": "{{ rating.value }} Sterne",""",
                ),
            )
        }
        // No other expression is interpreted there; product-template vocabulary is not valid.
        assertThrows(MosaicProtocolException::class.java) {
            MosaicProtocolDecoder.decode(
                canonicalFixtureReplacing(
                    """"mosaic.a11y.rating": "{{ rating.value }} out of {{ rating.maximum }} stars",""",
                    """"mosaic.a11y.rating": "{{ product.name }}: {{ rating.value }} of {{ rating.maximum }}",""",
                ),
            )
        }
        // Forbidden: a document with no in-progress content must not carry the key. `edge-cases`
        // declares neither key, and adding one is rejected rather than ignored as harmless copy.
        val edgeCases = protocolFixtureSource("edge-cases.json")
        assertFalse(MosaicReservedAccessibilityKey.IN_PROGRESS in edgeCases)
        assertThrows(MosaicProtocolException::class.java) {
            MosaicProtocolDecoder.decode(
                edgeCases.replaceFirst(
                    """"strings": {""",
                    """"strings": { "mosaic.a11y.in_progress": "In progress",""",
                ),
            )
        }
    }

    /**
     * A condition naming a controller the runtime state does not carry is a caller bug. Resolving
     * it to `false` would remove the node from layout and read back exactly like an authored
     * `hidden`, so evaluation throws instead.
     */
    @Test
    fun `visibility evaluation throws rather than hiding a node whose controller is absent`() {
        val condition = MosaicVisibility.TabValue("billing-tabs", "billing-tabs-annual")
        assertThrows(MosaicVisibilityStateException::class.java) {
            mosaicVisibilityIsSatisfied(condition, MosaicSelectionState(switches = mapOf("s" to true)))
        }
        assertThrows(MosaicVisibilityStateException::class.java) {
            mosaicVisibilityIsSatisfied(
                MosaicVisibility.SwitchValue("show-offer-details", true),
                MosaicSelectionState(tabs = mapOf("billing-tabs" to "billing-tabs-annual")),
            )
        }
        assertTrue(
            mosaicVisibilityIsSatisfied(
                condition,
                MosaicSelectionState(tabs = mapOf("billing-tabs" to "billing-tabs-annual")),
            ),
        )
        assertFalse(
            mosaicVisibilityIsSatisfied(
                condition,
                MosaicSelectionState(tabs = mapOf("billing-tabs" to "billing-tabs-monthly")),
            ),
        )
    }

    /**
     * Tab selection is runtime state seeded from `initialTabId`, and a newly accepted revision
     * builds a new state. Without the reset a Studio preview would keep the previous document's
     * selection and silently show a different panel than the author just published.
     */
    @Test
    fun `tab selection resets from initialTabId on a newly accepted document`() {
        val document = protocolFixtureDocument("complete-paywall.json")
        val state = MosaicPaywallState(document, MockMosaicPurchaseProvider())

        assertEquals("billing-tabs-annual", state.selectedTabId("billing-tabs"))
        assertTrue(state.isNodeVisible("annual-note"))
        state.selectTab("billing-tabs", "billing-tabs-monthly")
        assertFalse(state.isNodeVisible("annual-note"))
        // An undeclared tab is not selectable, so the map can never hold a value no panel matches.
        state.selectTab("billing-tabs", "billing-tabs-quarterly")
        assertEquals("billing-tabs-monthly", state.selectedTabId("billing-tabs"))

        assertEquals(
            "billing-tabs-annual",
            MosaicPaywallState(document, MockMosaicPurchaseProvider()).selectedTabId("billing-tabs"),
        )
    }

    @Test
    fun `navigation and external URL actions do not require normalized commerce outcomes`() {
        val document = protocolFixtureDocument("navigation-only.json")
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
            val root = protocolFixtureObject("complete-paywall.json")
            findNode(root, "privacy-policy").getAsJsonObject("action").addProperty("url", url)
            assertThrows(url, MosaicProtocolException::class.java) {
                MosaicProtocolDecoder.decode(root.toString())
            }
        }

        val punycode = protocolFixtureObject("complete-paywall.json")
        findNode(punycode, "privacy-policy").getAsJsonObject("action").addProperty(
            "url",
            "https://xn--r8jz45g.xn--zckzah/privacy",
        )
        assertEquals(MOSAIC_PROTOCOL_VERSION, MosaicProtocolDecoder.decode(punycode.toString()).schemaVersion)
    }

    /** Countdown units read largest to smallest; there is no committed fixture for the inversion. */
    @Test
    fun `rejects a countdown whose unit order is inverted`() {
        val root = protocolFixtureObject("complete-paywall.json")
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
        protocolFixtureObject("complete-paywall.json").also { root ->
            root.getAsJsonObject("designSystem").getAsJsonArray("colors")[1]
                .asJsonObject.getAsJsonObject("value").addProperty("id", "missing-color")
            assertThrows(MosaicProtocolException::class.java) {
                MosaicProtocolDecoder.decode(root.toString())
            }
        }

        protocolFixtureObject("complete-paywall.json").also { root ->
            root.getAsJsonObject("designSystem").getAsJsonArray("colors")[0]
                .asJsonObject.add(
                    "value",
                    JsonParser.parseString("""{"type":"colorToken","id":"brand-accent"}"""),
                )
            assertThrows(MosaicProtocolException::class.java) {
                MosaicProtocolDecoder.decode(root.toString())
            }
        }

        protocolFixtureObject("complete-paywall.json").also { root ->
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
        protocolFixtureObject("complete-paywall.json").also { root ->
            root.getAsJsonArray("screens")[0].asJsonObject.getAsJsonObject("presentation")
                .addProperty("type", "sheet")
            assertThrows(MosaicProtocolException::class.java) {
                MosaicProtocolDecoder.decode(root.toString())
            }
        }

        protocolFixtureObject("complete-paywall.json").also { root ->
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
        val root = protocolFixtureObject("complete-paywall.json")
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
        val document = protocolFixtureDocument("complete-paywall.json")
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
        val component = protocolFixtureDocument("complete-paywall.json").layout.content.walkDepthFirst()
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

}
