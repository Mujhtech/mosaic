package dev.mosaic.sdk

/** Strict entry point for the current Mosaic protocol contract. */
object MosaicProtocolDecoder {
    fun decode(
        source: String,
        capabilityReport: MosaicCapabilityReport = MosaicProtocolCapabilities.report(),
    ): MosaicPaywallDocument = MosaicProtocolV02Decoder.decode(source, capabilityReport)
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
