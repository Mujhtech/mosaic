package dev.mosaic.sdk

import java.net.URI

data class MosaicConfiguration(
    val apiKey: String,
    /** Optional override for local development or self-hosting. */
    val endpoint: URI? = null,
) {
    init {
        require(apiKey.isNotBlank()) { "apiKey must not be blank." }
        if (endpoint != null) {
            val scheme = endpoint.scheme?.lowercase()
            require((scheme == "http" || scheme == "https") && !endpoint.host.isNullOrBlank()) {
                "endpoint must be an absolute HTTP or HTTPS URI."
            }
        }
    }

    internal fun normalized(): MosaicConfiguration = copy(apiKey = apiKey.trim())
}

/** An isolated configured SDK handle; Phase 0 installs no global singleton. */
class Mosaic private constructor(
    val configuration: MosaicConfiguration,
    val purchaseProvider: MosaicPurchaseProvider,
) {
    companion object {
        fun configure(
            apiKey: String,
            purchaseProvider: MosaicPurchaseProvider,
            endpoint: URI? = null,
        ): Mosaic = Mosaic(
            configuration = MosaicConfiguration(apiKey = apiKey, endpoint = endpoint).normalized(),
            purchaseProvider = purchaseProvider,
        )
    }
}
