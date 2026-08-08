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
)


internal object MosaicProtocolV03Decoder {
    fun decode(
        source: String,
        capabilityReport: MosaicCapabilityReport,
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
        root.requireConstant("schemaVersion", MOSAIC_PROTOCOL_VERSION, "$.schemaVersion")
        val rawDesignSystem = rawDesignSystem(root.required("designSystem", "$"))
        activeDesignSystem.set(rawDesignSystem)
        try {
            val initialScreenId = root.requiredIdentifier("initialScreenId", "$.initialScreenId")
            val screens = root.required("screens", "$")
                .boundedArrayAt("$.screens", 1, 10)
                .mapIndexed { index, value -> screen(value, "$.screens[$index]") }
            val initialScreen = screens.singleOrNull { it.id == initialScreenId }
                ?: throw MosaicProtocolException("initialScreenId must reference exactly one declared screen.")
            if (initialScreen.presentation != MosaicScreenPresentation.SCREEN) {
                throw MosaicProtocolException("initialScreenId must reference a Screen presentation.")
            }
            val document = MosaicPaywallDocument(
                schemaVersion = MOSAIC_PROTOCOL_VERSION,
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
            return document
        } finally {
            activeDesignSystem.remove()
        }
    }

}
