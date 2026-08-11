package dev.mosaic.sdk

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.text.Charsets

/**
 * Protocol `0.4` decoding, against the canonical fixtures rather than hand-built documents.
 *
 * `0.4` is a pure superset of `0.3` apart from two cleanups it named for this version, so the risk
 * worth protecting is not "does motion parse" but "did adding `0.4` change what `0.3` accepts, and
 * does `0.4` still reject everything the reference validator rejects". Both directions are asserted
 * here; the frame arithmetic is [MotionFrameConformanceTest]'s subject, not this one's.
 */
class ProtocolV04Test {
    @Test
    fun decodesTheCanonicalMotionDocumentIncludingTokensAliasesAndInlineCurves() {
        val document = v04Document("complete-paywall.json")

        assertEquals(MOSAIC_PROTOCOL_V04_VERSION, document.schemaVersion)
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
     * The consolidated marker vocabulary, which is the reason the bundled cleanup exists: `0.3`'s
     * single `"checkmark"` constant could not express a *negated* item on a comparison paywall.
     */
    @Test
    fun featureListCarriesTheSharedMarkerUnionWithPerItemOverrides() {
        val features = v04Document("complete-paywall.json")
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
     * `style.productCardStates` is gone and the three `motion.*` capabilities take the tier. A
     * capability that can never vary independently of another carries no information, so the
     * derivation must stop producing it — otherwise every `0.4` document is rejected for declaring
     * a capability the schema no longer has.
     */
    @Test
    fun capabilityDerivationDropsProductCardStatesAndDerivesMotion() {
        val document = v04Document("complete-paywall.json")
        val declared = document.compatibility.requiredCapabilities

        assertEquals(
            setOf(MOSAIC_PROTOCOL_V04_VERSION),
            declared.mapTo(mutableSetOf(), MosaicRequiredCapability::version),
        )
        val names = declared.mapTo(mutableSetOf(), MosaicRequiredCapability::name)
        assertTrue(names.containsAll(MOSAIC_MOTION_CAPABILITIES))
        assertTrue(MosaicCapabilityName.PRODUCT_CARD_STATES !in names)
        assertTrue(MosaicCapabilityName.PRODUCT_CARD_STATES !in MosaicCapabilityCatalog.v04)
        // The SDK reports both contracts, and reports each capability at the versions it exists at.
        val report = MosaicProtocolCapabilities.report()
        assertEquals(setOf("0.3", "0.4"), report.supportedSchemaVersions)
        MOSAIC_MOTION_CAPABILITIES.forEach { capability ->
            assertTrue(report.supports(MosaicRequiredCapability(capability, "0.4")))
            assertTrue(!report.supports(MosaicRequiredCapability(capability, "0.3")))
        }
        assertTrue(
            report.supports(
                MosaicRequiredCapability(MosaicCapabilityName.PRODUCT_CARD_STATES, "0.3"),
            ),
        )
        assertTrue(
            !report.supports(
                MosaicRequiredCapability(MosaicCapabilityName.PRODUCT_CARD_STATES, "0.4"),
            ),
        )
    }

    /**
     * Every remaining canonical `0.4` fixture decodes.
     *
     * A reader that accepted only the one document its tests name is a reader that has been tuned to
     * a fixture rather than to a contract.
     */
    @Test
    fun decodesEveryCanonicalV04Fixture() {
        listOf(
            "edge-cases.json",
            "expired-countdown.json",
            "hidden-purchase-target.json",
            "navigation-only.json",
        ).forEach { name ->
            val document = v04Document(name)
            assertEquals(name, MOSAIC_PROTOCOL_V04_VERSION, document.schemaVersion)
        }
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
    fun rejectsEveryInvalidCanonicalV04Fixture() {
        val directory = repositoryFile("protocol/fixtures/v0.4/invalid")
        val fixtures = Files.list(directory).use { paths ->
            paths.map { it.fileName.toString() }
                .filter { it.endsWith(".json") }
                .sorted()
                .toList()
        }
        assertTrue("The canonical invalid fixture directory is empty.", fixtures.isNotEmpty())
        fixtures.forEach { name ->
            assertThrows(name, MosaicProtocolException::class.java) {
                MosaicProtocolDecoder.decode(v04Source("invalid/$name"))
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
            MosaicProtocolDecoder.decode(v04Source("invalid/unused-token-transitive.json"))
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
        val document = JsonParser.parseString(v04Source("complete-paywall.json")).asJsonObject
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
        val authored = v04Document("complete-paywall.json")
            .walkNodesDepthFirst()
            .filterIsInstance<MosaicFeatureListComponent>()
            .single { it.id == "features" }
        assertEquals(18.0, requireNotNull(authored.markerSize), 0.0)
        assertEquals(18.0, authored.resolvedMarkerSize, 0.0)
        assertNotEquals(authored.typography.fontSize, authored.resolvedMarkerSize)

        val undeclared = JsonParser.parseString(v04Source("complete-paywall.json")).asJsonObject
        findNode(undeclared, "features").remove("markerSize")
        val derived = MosaicProtocolDecoder.decode(undeclared.toString())
            .walkNodesDepthFirst()
            .filterIsInstance<MosaicFeatureListComponent>()
            .single { it.id == "features" }
        assertNull(derived.markerSize)
        assertEquals(derived.typography.fontSize, derived.resolvedMarkerSize, 0.0)

        // A non-positive extent is a glyph nothing draws, so it is rejected rather than clamped --
        // through the same `positiveLogicalSize` reader Timeline's `markerSize` goes through.
        val zeroed = JsonParser.parseString(v04Source("complete-paywall.json")).asJsonObject
        findNode(zeroed, "features").addProperty("markerSize", 0)
        assertThrows(MosaicProtocolException::class.java) {
            MosaicProtocolDecoder.decode(zeroed.toString())
        }

        // ...and `0.3` is unchanged by the field's existence: it has no `markerSize` on a Feature
        // List, so a `0.3` document declaring one is an unknown property exactly as before.
        val v03 = canonicalFixtureObject()
        findNode(v03, "features").addProperty("markerSize", 20)
        assertEquals(
            MosaicProtocolViolation.UNKNOWN_PROPERTY,
            assertThrows(MosaicProtocolException::class.java) {
                MosaicProtocolDecoder.decode(v03.toString())
            }.violation,
        )
    }

    /**
     * Versions are exact identifiers.
     *
     * `0.4` does not read `0.3` documents and `0.3` does not read `0.4` documents. This is what
     * stops the shared parser from becoming a single permissive reader that accepts a union of both
     * shapes and therefore conforms to neither.
     */
    @Test
    fun eachReaderAcceptsOnlyItsOwnContract() {
        val v04 = v04Source("complete-paywall.json")
        // A 0.4 body relabelled 0.3 must fail: the motions catalog and the marker union are not
        // 0.3 shapes, and a 0.3 reader that tolerated them would silently render a document whose
        // declared version does not describe it.
        assertThrows(MosaicProtocolException::class.java) {
            MosaicProtocolDecoder.decode(v04.replaceFirst("\"0.4\"", "\"0.3\""))
        }
        // ...and a 0.3 body relabelled 0.4 must fail for the mirrored reason: it declares
        // style.productCardStates, omits the motions catalog, and writes the string-constant marker.
        assertThrows(MosaicProtocolException::class.java) {
            MosaicProtocolDecoder.decode(canonicalFixtureReplacing("\"0.3\"", "\"0.4\""))
        }
        assertThrows(MosaicProtocolException::class.java) {
            MosaicProtocolDecoder.decode(v04.replaceFirst("\"0.4\"", "\"0.5\""))
        }
    }

    /**
     * The `0.3` reader is unchanged by the existence of `0.4`.
     *
     * The two contracts share one parser rather than two copies that can drift, so the thing worth
     * asserting is that sharing did not widen `0.3`: a `motion` block and a `motions` catalog are
     * still unknown properties there.
     */
    @Test
    fun protocolV03StillRejectsMotionItDoesNotDeclare() {
        val withMotion = canonicalFixtureReplacing(
            "\"id\": \"headline\",",
            "\"id\": \"headline\", \"motion\": {\"appear\": {\"effect\": \"fade\", " +
                "\"curve\": {\"type\": \"motion\", \"durationMilliseconds\": 200, " +
                "\"easing\": \"linear\"}, \"delayMilliseconds\": 0}},",
        )
        val failure = assertThrows(MosaicProtocolException::class.java) {
            MosaicProtocolDecoder.decode(withMotion)
        }
        assertEquals(MosaicProtocolViolation.UNKNOWN_PROPERTY, failure.violation)

        val withMotions = canonicalFixtureReplacing(
            "\"shadows\": [",
            "\"motions\": [], \"shadows\": [",
        )
        assertEquals(
            MosaicProtocolViolation.UNKNOWN_PROPERTY,
            assertThrows(MosaicProtocolException::class.java) {
                MosaicProtocolDecoder.decode(withMotions)
            }.violation,
        )
        // The 0.3 document itself still decodes, and its Feature List still carries the checkmark
        // the string constant names -- read through the shared union so one renderer path serves
        // both versions.
        val features = canonicalDocument().walkNodesDepthFirst()
            .filterIsInstance<MosaicFeatureListComponent>()
            .first()
        assertEquals(MosaicMarker.Icon(MosaicIconName.CHECKMARK), features.marker)
        assertTrue(features.items.all { it.marker == null })
        assertTrue(canonicalDocument().designSystem.motions.isEmpty())
        assertTrue(canonicalDocument().walkNodesDepthFirst().all { it.motion == null })
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

internal fun v04Source(relativeName: String): String =
    Files.readAllBytes(repositoryFile("protocol/fixtures/v0.4/$relativeName"))
        .toString(Charsets.UTF_8)

internal fun v04Document(relativeName: String): MosaicPaywallDocument =
    MosaicProtocolDecoder.decode(v04Source(relativeName))
