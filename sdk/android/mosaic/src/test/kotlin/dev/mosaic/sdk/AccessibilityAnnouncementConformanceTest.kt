package dev.mosaic.sdk

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

/**
 * The cross-SDK conformance corpus for composed accessibility announcements.
 *
 * Its purpose is mechanical: a renderer that joins segments into one string cannot match an
 * ordered `elements` list, and one that announces a decorative marker, connector, emblem, avatar,
 * or button caption cannot match `decorative`. Both defects otherwise pass an eyeball review of the
 * rendered paywall, because a joined announcement sounds correct in English.
 */
class AccessibilityAnnouncementConformanceTest {
    /** The count `docs/protocol/v0.4.md` declares; a corpus that empties must fail, not pass. */
    private val declaredCaseFloor = 11

    @Test
    fun `announcements match the canonical vectors byte for byte`() {
        val corpus = JsonParser.parseString(
            Files.readAllBytes(
                repositoryFile("protocol/fixtures/v0.4/accessibility-announcement.json"),
            ).toString(Charsets.UTF_8),
        ).asJsonObject
        val cases = corpus.getAsJsonArray("cases")
        assertTrue(
            "The accessibility-announcement corpus holds ${cases.size()} cases, below its " +
                "declared floor of $declaredCaseFloor.",
            cases.size() >= declaredCaseFloor,
        )
        // `separator: null` is the contract, not an omission. Nothing in this SDK may supply one.
        assertTrue(corpus.get("separator").isJsonNull)

        val document = canonicalDocument()
        val nodes = document.walkNodesDepthFirst().associateBy(MosaicNode::id)

        cases.forEach { element ->
            val case = element.asJsonObject
            val id = case.get("id").asString
            assertTrue(case.get("separator").isJsonNull)
            val localization = MosaicLocalizationResolver(
                document.localization,
                case.get("locale").asString,
            )
            val node = checkNotNull(nodes[case.get("componentId").asString]) {
                "$id names a component the canonical document does not declare."
            }
            val actual = when (node) {
                is MosaicSocialProofComponent -> node.accessibilityAnnouncement(localization)
                is MosaicAwardComponent -> node.accessibilityAnnouncement(localization)
                is MosaicTimelineComponent -> node.accessibilityAnnouncement(localization)
                is MosaicButtonComponent -> node.accessibilityAnnouncement(
                    localization,
                    isBusy = case.get("state")?.asString == "inProgress",
                )
                else -> error("$id names an unsupported component type ${node.type}.")
            }

            assertEquals("$id type", case.get("componentType").asString, node.type)
            assertEquals(
                "$id composition",
                case.get("composition").asString,
                when (actual.composition) {
                    MosaicAccessibilityComposition.SEPARATE_ELEMENTS -> "separateElements"
                    MosaicAccessibilityComposition.SINGLE_ELEMENT -> "singleElement"
                },
            )

            val container = case.getAsJsonObject("container")
            assertEquals("$id role", container.get("role").asString, actual.role.wireName)
            assertEquals("$id label", container.get("label").asString, actual.label)
            assertEquals("$id value", container.optionalText("value"), actual.value)
            assertEquals("$id hint", container.optionalText("hint"), actual.hint)

            assertEquals(
                "$id elements",
                case.getAsJsonArray("elements").map { it.asJsonObject }.map { expected ->
                    Triple(
                        expected.optionalText("item"),
                        expected.get("segment").asString,
                        expected.get("text").asString,
                    )
                },
                actual.elements.map { Triple(it.itemId, it.segment, it.text) },
            )
            assertEquals(
                "$id decorative",
                case.getAsJsonArray("decorative").map { it.asString },
                actual.decorative,
            )
        }
    }

    /**
     * An absent optional segment produces no element, never an empty one. A renderer that emitted
     * `("subtitle", "")` would still match a joined string but would make a screen reader pause on
     * nothing, and the corpus cases alone cannot prove the absence is structural rather than a
     * blank that happens to render as empty.
     */
    @Test
    fun `an absent optional segment contributes no element at all`() {
        val document = canonicalDocument()
        val localization = MosaicLocalizationResolver(document.localization, "en")
        val nodes = document.walkNodesDepthFirst().toList()

        val untitled = nodes.filterIsInstance<MosaicAwardComponent>().single { it.subtitle == null }
        assertEquals(
            listOf("title"),
            untitled.accessibilityAnnouncement(localization).elements.map { it.segment },
        )
        val unrated = nodes.filterIsInstance<MosaicSocialProofComponent>()
            .single { it.rating == null }
        assertEquals(
            listOf("quote", "attribution"),
            unrated.accessibilityAnnouncement(localization).elements.map { it.segment },
        )
        val trial = nodes.filterIsInstance<MosaicTimelineComponent>()
            .single { it.id == "trial-timeline" }
        assertEquals(
            listOf("title", "description", "title", "description", "title"),
            trial.accessibilityAnnouncement(localization).elements.map { it.segment },
        )

        // The Button name is identical in both states; only the value changes.
        val button = nodes.filterIsInstance<MosaicButtonComponent>()
            .first { it.inProgressChildren != null }
        val idle = button.accessibilityAnnouncement(localization, isBusy = false)
        val busy = button.accessibilityAnnouncement(localization, isBusy = true)
        assertEquals(idle.label, busy.label)
        assertNull(idle.value)
        assertEquals(
            checkNotNull(document.localization.locales["en"])
                .strings.getValue(MosaicReservedAccessibilityKey.IN_PROGRESS),
            busy.value,
        )
        assertTrue(idle.elements.isEmpty() && busy.elements.isEmpty())
    }

    private fun JsonObject.optionalText(name: String): String? =
        get(name)?.takeUnless { it.isJsonNull }?.asString
}
