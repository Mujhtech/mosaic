package dev.mosaic.sdk

import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonNull
import com.google.gson.JsonObject
import com.google.gson.JsonParseException
import com.google.gson.JsonParser
import java.math.BigDecimal
import java.net.URI
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/** Strict Protocol 0.3 reader. JSON Schema in `protocol/` remains canonical. */
internal val identifierPattern = Regex("^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$")
internal val localizationKeyPattern = Regex("^[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+$")
internal val localeTagPattern = Regex("^[a-z]{2,3}(?:-(?:[A-Z]{2}|[0-9]{3}))?$")
internal val providerProductIdPattern = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]*$")
internal val bundledAssetKeyPattern = Regex("^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$")
internal val literalColorPattern = Regex("^#[0-9A-F]{8}$")
internal val productTemplatePattern = Regex("\\{\\{\\s*product\\.(name|price)\\s*\\}\\}")
internal val externalUrlPattern = Regex(
    """^https://([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::([0-9]{1,5}))?(?:[/?#][^\s\\\u0000-\u001F\u007F]*)?$""",
)
internal val utcTimestampPattern = Regex(
    "^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])" +
        "T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$",
)
internal val capabilitiesByWireName = MosaicCapabilityName.entries.associateBy { it.wireName }
internal val activeDesignSystem = ThreadLocal<RawDesignSystem?>()

/**
 * The contract version currently being decoded.
 *
 * `0.4` is a superset of `0.3` apart from two cleanups, so the two readers share one parser rather
 * than owning two copies that can drift while each stays internally consistent. Exactly three
 * things differ, and each reads this: the `motions` catalog, the per-node `motion` block, and the
 * marker vocabulary. Everything else is byte-identical for both versions by construction.
 */
internal val activeProtocolVersion = ThreadLocal<String?>()

internal fun decodingProtocolV04(): Boolean =
    activeProtocolVersion.get() == MOSAIC_PROTOCOL_V04_VERSION

/**
 * Motion token ids reached from a node while its screens are being parsed.
 *
 * Non-null only during the screen walk, so building the catalog's own model afterwards does not
 * mark every token as used. `0.4` rejects an unreferenced motion token — deliberately asymmetric
 * with the colour, background, and shadow catalogs, which carry no such rule — because the
 * flash-safety floor is checked at a motion's *reference* site. A token nothing references has
 * therefore never been checked against anything and sits in the catalog looking approved.
 */
internal val referencedMotionTokens = ThreadLocal<MutableSet<String>?>()

internal data class RawToken(
    val id: String,
    val name: String,
    val value: JsonElement,
    val path: String,
)

internal data class RawDesignSystem(
    val colors: LinkedHashMap<String, RawToken>,
    val backgrounds: LinkedHashMap<String, RawToken>,
    val shadows: LinkedHashMap<String, RawToken>,
    val motions: LinkedHashMap<String, RawToken> = linkedMapOf(),
)


internal object MosaicProtocolV03Decoder {
    fun decode(
        source: String,
        capabilityReport: MosaicCapabilityReport,
        schemaVersion: String = MOSAIC_PROTOCOL_VERSION,
    ): MosaicPaywallDocument {
        val root = try {
            JsonParser.parseString(source).objectAt("$")
        } catch (error: MosaicProtocolException) {
            throw error
        } catch (error: JsonParseException) {
            throw MosaicProtocolException("Invalid JSON.", error)
        } catch (error: IllegalStateException) {
            throw MosaicProtocolException("Invalid JSON document shape.", error)
        }
        root.expectKeys(
            setOf(
                "schemaVersion", "id", "revision", "compatibility", "localization",
                "designSystem", "assets", "products", "initialScreenId", "screens",
            ),
            "$",
        )
        root.requireConstant("schemaVersion", schemaVersion, "$.schemaVersion")
        activeProtocolVersion.set(schemaVersion)
        try {
            val rawDesignSystem = rawDesignSystem(root.required("designSystem", "$"))
            activeDesignSystem.set(rawDesignSystem)
            val motionReferences = mutableSetOf<String>()
            referencedMotionTokens.set(motionReferences)
            val initialScreenId = root.requiredIdentifier("initialScreenId", "$.initialScreenId")
            val screens = root.required("screens", "$")
                .boundedArrayAt("$.screens", 1, 10)
                .mapIndexed { index, value -> screen(value, "$.screens[$index]") }
            // Only the screen walk marks references; the catalog's own model is resolved after the
            // tracker is cleared so that resolving a token cannot make it look used.
            referencedMotionTokens.remove()
            val initialScreen = screens.singleOrNull { it.id == initialScreenId }
                ?: throw MosaicProtocolException("initialScreenId must reference exactly one declared screen.")
            if (initialScreen.presentation != MosaicScreenPresentation.SCREEN) {
                throw MosaicProtocolException("initialScreenId must reference a Screen presentation.")
            }
            val document = MosaicPaywallDocument(
                schemaVersion = schemaVersion,
                id = root.requiredIdentifier("id", "$.id"),
                revision = root.requiredPositiveInteger("revision", "$.revision"),
                compatibility = compatibility(root.required("compatibility", "$"), capabilityReport),
                localization = localization(root.required("localization", "$")),
                assets = root.required("assets", "$").arrayAt("$.assets").mapIndexed { index, value ->
                    asset(value, "$.assets[$index]")
                },
                products = root.required("products", "$").arrayAt("$.products").mapIndexed { index, value ->
                    productReference(value, "$.products[$index]")
                },
                layout = initialScreen.layout,
                initialScreenId = initialScreenId,
                screens = screens,
                designSystem = designSystem(rawDesignSystem),
            )
            validateDocumentSemantics(document, root, capabilityReport)
            if (decodingProtocolV04()) {
                validateMotionSemantics(document, rawDesignSystem, motionReferences)
            }
            return document
        } finally {
            activeDesignSystem.remove()
            activeProtocolVersion.remove()
            referencedMotionTokens.remove()
        }
    }

}
