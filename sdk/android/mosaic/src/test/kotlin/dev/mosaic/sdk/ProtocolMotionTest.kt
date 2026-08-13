package dev.mosaic.sdk

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.text.Charsets

/**
 * Motion decoding and the document-level rules that govern it, against the canonical fixtures
 * rather than hand-built documents.
 *
 * The risk worth protecting is not "does motion parse" but "does the reader still reject everything
 * the reference validator rejects" — every invalid motion document renders, so its failure is not a
 * crash but a paywall that is unsafe or ambiguous. The frame arithmetic is
 * [MotionFrameConformanceTest]'s subject, not this one's.
 */
class ProtocolMotionTest {
    @Test
    fun decodesTheCanonicalMotionDocumentIncludingTokensAliasesAndInlineCurves() {
        val document = protocolFixtureDocument("complete-paywall.json")

        assertEquals(MOSAIC_PROTOCOL_VERSION, document.schemaVersion)
        assertEquals(
            listOf("motion-entrance", "motion-entrance-alias", "motion-selection", "motion-pulse"),
            document.designSystem.motions.map(MosaicMotionToken::id),
        )
        // A token that names another token resolves through it: the alias carries the entrance
        // curve's own duration and easing, not a second authored pair that could drift from it.
        assertEquals(
            MosaicMotion(240, MosaicMotionEasing.DECELERATE),
            document.designSystem.motions.single { it.id == "motion-entrance-alias" }.value,
        )

        val nodes = document.walkNodesDepthFirst().associateBy(MosaicNode::id)
        val headline = requireNotNull(nodes["headline"]?.motion?.appear)
        assertEquals(MosaicAppearEffect.FADE_RISE, headline.effect)
        assertEquals(12.0, requireNotNull(headline.riseLogicalSize), 0.0)
        assertEquals(0, headline.delayMilliseconds)
        // Stagger is authored as different sibling delays; there is no stagger sugar in 0.4.
        assertEquals(80, requireNotNull(nodes["subtitle"]?.motion?.appear).delayMilliseconds)

        // An inline curve and a token curve are both accepted and both arrive resolved: the frame
        // resolver is specified against an inline motion, so an unresolved token reaching it would
        // return the frame for a duration nobody authored.
        assertEquals(
            MosaicMotion(200, MosaicMotionEasing.LINEAR),
            requireNotNull(nodes["editor-award"]?.motion?.appear).curve,
        )
        assertEquals(
            MosaicMotion(240, MosaicMotionEasing.DECELERATE),
            requireNotNull(nodes["features"]?.motion?.appear).curve,
        )

        assertEquals(
            MosaicSelectionMotion(MosaicMotion(160, MosaicMotionEasing.STANDARD)),
            nodes["plans"]?.motion?.selection,
        )
        assertEquals(
            MosaicSelectionMotion(MosaicMotion(160, MosaicMotionEasing.STANDARD)),
            nodes["billing-tabs"]?.motion?.selection,
        )

        val pulse = requireNotNull(nodes["purchase"]?.motion?.loop)
        assertEquals(0.04, pulse.scaleAmplitude, 0.0)
        assertEquals(0.12, pulse.opacityAmplitude, 0.0)
        assertEquals(3, pulse.repeatCount)
        assertEquals(900, pulse.curve.durationMilliseconds)
        // One loop per *screen*, not one per document: the second screen carries its own.
        assertEquals(1, requireNotNull(nodes["privacy-policy"]?.motion?.loop).repeatCount)
    }

    /**
     * The consolidated marker vocabulary, shared with Timeline: a single `"checkmark"` constant
     * could not express a *negated* item on a comparison paywall.
     */
    @Test
    fun featureListCarriesTheSharedMarkerUnionWithPerItemOverrides() {
        val features = protocolFixtureDocument("complete-paywall.json")
            .walkNodesDepthFirst()
            .filterIsInstance<MosaicFeatureListComponent>()
            .single { it.id == "features" }

        assertEquals(MosaicMarker.Icon(MosaicIconName.CHECKMARK), features.marker)
        assertEquals(MosaicMarker.Ordinal, features.items.single { it.id == "native-rendering" }.marker)
        assertEquals(
            MosaicMarker.Icon(MosaicIconName.CLOSE),
            features.items.single { it.id == "offline-ready" }.marker,
        )
        // An absent item marker means the item carries the list's marker; it is never a request for
        // no glyph, which is why the renderer falls back to the component's marker rather than
        // drawing nothing.
        assertNull(features.items.first().marker)
    }

    /**
     * The three `motion.*` capabilities are derived from the nodes that author them, and every
     * declared capability carries the one contract version at the exact identifier.
     *
     * The exactness is the half worth asserting: a reader that accepted a capability at a
     * neighbouring version — inferring support from numeric ordering — would accept a release it
     * cannot render, which is the failure the capability system exists to prevent and the rule that
     * has to outlive the single-version policy.
     */
    @Test
    fun capabilityDerivationDerivesMotionAtTheExactContractVersion() {
        val document = protocolFixtureDocument("complete-paywall.json")
        val declared = document.compatibility.requiredCapabilities

        assertEquals(
            setOf(MOSAIC_PROTOCOL_VERSION),
            declared.mapTo(mutableSetOf(), MosaicRequiredCapability::version),
        )
        assertTrue(
            declared.mapTo(mutableSetOf(), MosaicRequiredCapability::name)
                .containsAll(MOSAIC_MOTION_CAPABILITIES),
        )
        val report = MosaicProtocolCapabilities.report("test-sdk")
        assertEquals("test-sdk", report.sdkVersion)
        assertEquals(setOf(MOSAIC_PROTOCOL_VERSION), report.supportedSchemaVersions)
        assertEquals(MosaicCapabilityCatalog.current, report.supportedCapabilities.keys)
        assertEquals(
            MosaicCapabilityCatalog.current.mapTo(mutableSetOf()) {
                MosaicRequiredCapability(it, MOSAIC_PROTOCOL_VERSION)
            },
            report.supportedCapabilityVersions,
        )
        MOSAIC_MOTION_CAPABILITIES.forEach { capability ->
            assertTrue(report.supports(MosaicRequiredCapability(capability, MOSAIC_PROTOCOL_VERSION)))
            assertTrue(!report.supports(MosaicRequiredCapability(capability, "0.3")))
        }
    }

    /**
     * Every remaining canonical fixture decodes.
     *
     * A reader that accepted only the one document its tests name is a reader that has been tuned to
     * a fixture rather than to a contract.
     */
    @Test
    fun decodesEveryCanonicalFixture() {
        listOf(
            "edge-cases.json",
            "expired-countdown.json",
            "hidden-purchase-target.json",
            "navigation-only.json",
            "screen-round-trip.json",
        ).forEach { name ->
            val document = protocolFixtureDocument(name)
            assertEquals(name, MOSAIC_PROTOCOL_VERSION, document.schemaVersion)
        }

        // The round trip is the one fixture whose *shape* an assertion depends on: the Compose
        // re-entry test is only meaningful if both screens really are Screen presentations that
        // navigate to each other, and each really does carry a bounded loop.
        val roundTrip = protocolFixtureDocument("screen-round-trip.json")
        assertEquals(
            listOf(MosaicScreenPresentation.SCREEN, MosaicScreenPresentation.SCREEN),
            roundTrip.screens.map(MosaicPaywallScreen::presentation),
        )
        val loops = roundTrip.walkNodesDepthFirst().mapNotNull { node ->
            node.motion?.loop?.let { node.id to it.repeatCount }
        }.toList()
        assertEquals(listOf("view-details" to 3, "details-back" to 2), loops)
    }

    /**
     * Every document the reference validator rejects, reproduced — swept from the directory rather
     * than listed.
     *
     * Each of these renders: the failure it prevents is not a crash but a paywall that is unsafe or
     * ambiguous — compounded entrance opacities no two renderers agree on, a pulse fast enough to
     * approach the WCAG 2.3.1 flash threshold, a screen that pulses several controls at once, and a
     * timing value nothing has ever checked sitting in the catalog looking approved.
     *
     * Swept because a hand-maintained list silently under-tests: a rejection the protocol agent adds
     * a fixture for is a rejection this reader is expected to make on the day it lands, and a list
     * only covers it once somebody remembers to edit the list too.
     */
    @Test
    fun rejectsEveryInvalidCanonicalFixture() {
        val fixtures = protocolFixtureNames("invalid")
        assertTrue("The canonical invalid fixture directory is empty.", fixtures.isNotEmpty())
        fixtures.forEach { name ->
            assertThrows(name, MosaicProtocolException::class.java) {
                MosaicProtocolDecoder.decode(protocolFixtureSource("invalid/$name"))
            }
        }
    }

    /**
     * The unused-motion-token rule is transitive reachability rooted at *node* reference sites.
     *
     * The canonical fixture's two orphans reference each other, and **both** must be reported. The
     * sweep above already proves the document is rejected, which is the weaker half: a validator
     * that treated the catalog itself as a usage root would let the orphans vouch for one another,
     * report only the head of the chain as unused, and still reject the document — passing the sweep
     * while holding the wrong semantics. Naming both is also what stops an author fixing one token
     * and re-running straight into the other.
     */
    @Test
    fun namesEveryMotionTokenReachableOnlyFromAnUnusedToken() {
        val failure = assertThrows(MosaicProtocolException::class.java) {
            MosaicProtocolDecoder.decode(protocolFixtureSource("invalid/unused-token-transitive.json"))
        }
        // As one sorted list rather than two substring checks, because "motion-orphan-a" and
        // "motion-orphan-b" would each match a message naming only the other's prefix.
        assertTrue(
            failure.message,
            failure.message.orEmpty().contains("motion-orphan-a, motion-orphan-b"),
        )
    }

    /**
     * ...and reachability has no depth limit: a node reaching a token through two aliases uses all
     * three.
     *
     * The canonical fixture only ever aliases one hop deep, so a reader that resolved exactly one
     * indirection would pass every committed fixture and reject a legitimate document the first time
     * a design system grew a second alias layer.
     */
    @Test
    fun acceptsAMotionTokenReachedThroughAChainOfAliases() {
        val document = JsonParser.parseString(protocolFixtureSource("complete-paywall.json")).asJsonObject
        val motions = document.getAsJsonObject("designSystem").getAsJsonArray("motions")
        // `features` names `motion-entrance-alias`, so re-pointing the alias at a new hop leaves the
        // node's own reference untouched and puts one more indirection under it.
        motions.first { it.asJsonObject.get("id").asString == "motion-entrance-alias" }
            .asJsonObject
            .add("value", tokenReference("motion-entrance-hop"))
        motions.add(
            motionToken("motion-entrance-hop", "Entrance Hop", tokenReference("motion-entrance")),
        )

        val decoded = MosaicProtocolDecoder.decode(document.toString())
        // Every hop collapses to the one authored pair, so a three-deep chain still resolves to the
        // entrance curve rather than to a second duration that could drift from it.
        assertEquals(
            MosaicMotion(240, MosaicMotionEasing.DECELERATE),
            decoded.designSystem.motions.single { it.id == "motion-entrance-hop" }.value,
        )
        assertEquals(
            MosaicMotion(240, MosaicMotionEasing.DECELERATE),
            requireNotNull(
                decoded.walkNodesDepthFirst().single { it.id == "features" }.motion?.appear,
            ).curve,
        )
    }

    /**
     * Reduced motion stops a decorative video background, and nothing else does.
     *
     * The rule was version-gated while `0.3` and `0.4` were both readable; ADR-0028 deleted `0.3`,
     * so it is unconditional. Both directions still matter: without the preference the video must
     * still play, or "honour reduced motion" quietly becomes "never play video". And unavailability
     * is recorded independently of the preference, so a customer who asked for less motion is not
     * reported as having hit a broken paywall while an operator debugging a genuinely missing asset
     * still is.
     *
     * Asserted here, at the layer CI runs, rather than only in the Compose suite — the instrumented
     * tests do not run in CI, so an assertion made only there could not fail a build.
     */
    @Test
    fun reducedMotionStopsAVideoBackgroundWithoutRecordingItAsUnavailable() {
        assertEquals(
            MosaicVideoBackgroundPresentation.Still(recordsUnavailable = false),
            MosaicVideoBackgroundPresentation.resolve(
                hasSource = true,
                playbackFailed = false,
                reducedMotion = true,
            ),
        )
        assertEquals(
            MosaicVideoBackgroundPresentation.Play,
            MosaicVideoBackgroundPresentation.resolve(
                hasSource = true,
                playbackFailed = false,
                reducedMotion = false,
            ),
        )
        assertEquals(
            MosaicVideoBackgroundPresentation.Still(recordsUnavailable = true),
            MosaicVideoBackgroundPresentation.resolve(
                hasSource = false,
                playbackFailed = false,
                reducedMotion = true,
            ),
        )
        assertEquals(
            MosaicVideoBackgroundPresentation.Still(recordsUnavailable = true),
            MosaicVideoBackgroundPresentation.resolve(
                hasSource = true,
                playbackFailed = true,
                reducedMotion = false,
            ),
        )
    }

    /**
     * Feature List honours an authored `markerSize`, and falls back to its own font size without one.
     *
     * Both directions are asserted because the risk is one-sided in each. The canonical list authors
     * `18` against a `16` font size, so a renderer that kept deriving the extent from typography
     * would still draw a plausible glyph and pass every other assertion in this suite — the two
     * values have to differ for the authored one to be provably read. The fallback is the schema's
     * own default (`typography.fontSize`, not a constant), and it is what keeps a list that declares
     * no size rendering exactly as it did before the field existed.
     */
    @Test
    fun featureListMarkerSizeIsAuthoredWhenDeclaredAndDerivedWhenAbsent() {
        val authored = protocolFixtureDocument("complete-paywall.json")
            .walkNodesDepthFirst()
            .filterIsInstance<MosaicFeatureListComponent>()
            .single { it.id == "features" }
        assertEquals(18.0, requireNotNull(authored.markerSize), 0.0)
        assertEquals(18.0, authored.resolvedMarkerSize, 0.0)
        assertNotEquals(authored.typography.fontSize, authored.resolvedMarkerSize)

        val undeclared = JsonParser.parseString(protocolFixtureSource("complete-paywall.json")).asJsonObject
        findNode(undeclared, "features").remove("markerSize")
        val derived = MosaicProtocolDecoder.decode(undeclared.toString())
            .walkNodesDepthFirst()
            .filterIsInstance<MosaicFeatureListComponent>()
            .single { it.id == "features" }
        assertNull(derived.markerSize)
        assertEquals(derived.typography.fontSize, derived.resolvedMarkerSize, 0.0)

        // A non-positive extent is a glyph nothing draws, so it is rejected rather than clamped --
        // through the same `positiveLogicalSize` reader Timeline's `markerSize` goes through.
        val zeroed = JsonParser.parseString(protocolFixtureSource("complete-paywall.json")).asJsonObject
        findNode(zeroed, "features").addProperty("markerSize", 0)
        assertThrows(MosaicProtocolException::class.java) {
            MosaicProtocolDecoder.decode(zeroed.toString())
        }
    }

    /**
     * Version identifiers are exact, and support is never inferred from numeric ordering.
     *
     * Both neighbours are asserted because the failure modes are different: relabelling the
     * canonical body `0.3` names a version that was deleted, and `0.5` names one that does not
     * exist yet. Either would have to be rejected atomically before any structure is read —
     * resolving through cached configuration and then the bundled fallback — rather than decoded
     * hopefully against the nearest reader the SDK happens to have.
     */
    @Test
    fun theReaderAcceptsOnlyItsOwnContractVersion() {
        val canonical = protocolFixtureSource("complete-paywall.json")

        listOf("0.3", "0.5").forEach { version ->
            assertEquals(
                version,
                MosaicProtocolViolation.INVALID_DOCUMENT,
                assertThrows(version, MosaicProtocolException::class.java) {
                    MosaicProtocolDecoder.decode(
                        canonical.replaceFirst("\"$MOSAIC_PROTOCOL_VERSION\"", "\"$version\""),
                    )
                }.violation,
            )
        }
    }
}

private fun motionToken(id: String, name: String, value: JsonElement): JsonObject =
    JsonObject().apply {
        addProperty("id", id)
        addProperty("name", name)
        add("value", value)
    }

private fun tokenReference(id: String): JsonObject = JsonObject().apply {
    addProperty("type", "motionToken")
    addProperty("id", id)
}
