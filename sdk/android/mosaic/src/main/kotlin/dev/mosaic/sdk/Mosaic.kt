package dev.mosaic.sdk

import java.net.URI

data class MosaicConfiguration(
    val apiKey: String,
    /** Optional override for local development or self-hosting. */
    val endpoint: URI? = null,
    val applicationVersion: String? = null,
) {
    init {
        require(apiKey.isNotBlank()) { "apiKey must not be blank." }
        if (endpoint != null) {
            val scheme = endpoint.scheme?.lowercase()
            require((scheme == "http" || scheme == "https") && !endpoint.host.isNullOrBlank()) {
                "endpoint must be an absolute HTTP or HTTPS URI."
            }
        }
        require(applicationVersion == null || applicationVersion.isNotBlank()) {
            "applicationVersion must not be blank when provided."
        }
    }

    internal fun normalized(): MosaicConfiguration = copy(
        apiKey = apiKey.trim(),
        applicationVersion = applicationVersion?.trim(),
    )
}

/** An isolated configured SDK handle; Phase 0 installs no global singleton. */
class Mosaic private constructor(
    val configuration: MosaicConfiguration,
    val purchaseProvider: MosaicPurchaseProvider,
) {
    fun hostedConfiguration(
        context: android.content.Context,
        bundledFallback: MosaicPaywallDocumentSource? = MosaicCanonicalBundleSource(context),
        diagnostics: MosaicDiagnosticSink = MosaicDiagnosticSink.None,
    ): MosaicHostedConfigurationClient = MosaicHostedConfigurationClient(
        transport = MosaicHTTPConfigurationTransport(configuration),
        cache = MosaicFileConfigurationCache(context, configuration),
        bundledFallback = bundledFallback,
        diagnostics = diagnostics,
    )

    companion object {
        fun configure(
            apiKey: String,
            purchaseProvider: MosaicPurchaseProvider,
            endpoint: URI? = null,
            applicationVersion: String? = null,
        ): Mosaic = Mosaic(
            configuration = MosaicConfiguration(
                apiKey = apiKey,
                endpoint = endpoint,
                applicationVersion = applicationVersion,
            ).normalized(),
            purchaseProvider = purchaseProvider,
        )
    }
}
