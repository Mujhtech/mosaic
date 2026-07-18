package dev.mosaic.sdk

/** Strict entry point for the current Mosaic protocol contract. */
object MosaicProtocolDecoder {
    fun decode(
        source: String,
        capabilityReport: MosaicCapabilityReport = MosaicProtocolCapabilities.report(),
    ): MosaicPaywallDocument = MosaicProtocolV02Decoder.decode(source, capabilityReport)
}

class MosaicProtocolException(
    message: String,
    cause: Throwable? = null,
) : IllegalArgumentException(message, cause)
