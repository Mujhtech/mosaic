package dev.mosaic.sdk

/** Strict entry point for the Mosaic protocol contracts this SDK reads. */
object MosaicProtocolDecoder {
    /**
     * Decodes a Paywall Protocol [MOSAIC_PROTOCOL_VERSION] document.
     *
     * Version identifiers are exact and there is exactly one of them, so this checks rather than
     * dispatches: a document declaring any other version is rejected before any structure is read,
     * rather than being decoded hopefully against the nearest reader. Checking first is what makes
     * the rejection atomic — no partial acceptance and no best-effort interpretation of a contract
     * this reader does not have.
     */
    fun decode(
        source: String,
        capabilityReport: MosaicCapabilityReport = MosaicProtocolCapabilities.report(),
    ): MosaicPaywallDocument {
        val declared = peekSchemaVersion(source)
        if (declared !in MOSAIC_SUPPORTED_PROTOCOL_VERSIONS) {
            // Deliberately the default INVALID_DOCUMENT category: an unreadable version is a
            // malformed document, not a capability this reader happens to lack, and consumers such
            // as the local preview client choose a recovery action from that category.
            throw MosaicProtocolException(
                "Unsupported Mosaic protocol version $declared at $.schemaVersion.",
            )
        }
        return MosaicPaywallDocumentDecoder.decode(source, capabilityReport)
    }

    /**
     * The declared version, or null when the document does not carry a readable one.
     *
     * Deliberately tolerant: a malformed document must reach the full reader and be rejected with
     * the reason it is malformed, not with a version complaint that hides it.
     */
    private fun peekSchemaVersion(source: String): String? = runCatching {
        com.google.gson.JsonParser.parseString(source)
            .asJsonObject
            .get("schemaVersion")
            ?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }
            ?.asString
    }.getOrNull() ?: MOSAIC_PROTOCOL_VERSION
}

/**
 * What a rejected document got wrong, as a value rather than as prose.
 *
 * Consumers such as the local preview client classify a rejection to choose a diagnostic code and a
 * recovery action. Reading the exception message to do that makes rewording a message a silent
 * behaviour change, so the decoder states the category itself.
 */
enum class MosaicProtocolViolation {
    UNKNOWN_PROPERTY,
    INVALID_REFERENCE,
    UNSUPPORTED_COMPONENT,
    UNSUPPORTED_CAPABILITY,
    INVALID_DOCUMENT,
}

class MosaicProtocolException(
    message: String,
    cause: Throwable? = null,
    val violation: MosaicProtocolViolation = MosaicProtocolViolation.INVALID_DOCUMENT,
) : IllegalArgumentException(message, cause)
