package dev.mosaic.sdk

import java.net.URI

data class MosaicConfiguration(
    val apiKey: String,
    /** Optional override for local development or self-hosting. */
    val endpoint: URI? = null,
    val applicationVersion: String? = null,
    val applicationId: String? = null,
    /** Must mirror the accepted Environment setting; false is the privacy-safe default. */
    val analyticsCollectionEnabled: Boolean = false,
    /**
     * Opt in to the Transaction Observation handoff: after a purchase is finalized locally, Mosaic
     * reports a bounded, irreversible provider reference so server-side validation can start sooner.
     * The raw purchase token never leaves the device, the handoff never blocks or alters a purchase,
     * and an observation is never evidence that a transaction is authentic. False is the default.
     */
    val transactionObservationEnabled: Boolean = false,
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
        require(
            applicationId == null ||
                Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$").matches(applicationId),
        ) {
            "applicationId must be a valid Mosaic identifier when provided."
        }
    }

    internal fun normalized(): MosaicConfiguration = copy(
        apiKey = apiKey.trim(),
        applicationVersion = applicationVersion?.trim(),
        applicationId = applicationId?.trim(),
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
    ): MosaicHostedConfigurationClient {
        val namespace = mosaicConfigurationCacheNamespace(configuration)
        val identityStore = MosaicIdentityStore(context, namespace)
        val experimentStore = MosaicExperimentAssignmentStoreRegistry.store(context, namespace)
        val analytics = (context.applicationContext as? android.app.Application)?.let { application ->
            MosaicAnalyticsRuntimeRegistry.runtime(application, namespace, configuration, identityStore)
        }
        // The observation runtime subscribes to the adapter stream that already exists; no provider
        // API changes and no code runs at all unless the host opted in.
        val commerceUpdates = (purchaseProvider as? MosaicConfiguredPurchaseProvider)?.commerceUpdateSource
            ?: (purchaseProvider as? MosaicCommerceProviderAdapterV2)?.commerceUpdates
        val observations = commerceUpdates
            ?.takeIf { configuration.transactionObservationEnabled }
            ?.let { updates ->
                (context.applicationContext as? android.app.Application)?.let { application ->
                    MosaicTransactionObservationRuntimeRegistry.runtime(
                        application,
                        namespace,
                        configuration,
                        updates,
                    )
                }
            }
        return MosaicHostedConfigurationClient(
            transport = MosaicHTTPConfigurationTransport(configuration),
            commerceTransport = configuration.applicationId?.let {
                MosaicHTTPCommerceConfigurationTransport(configuration)
            },
            cache = MosaicFileConfigurationCache(context, configuration),
            bundledFallback = bundledFallback,
            applicationId = configuration.applicationId,
            configurablePurchaseProvider = purchaseProvider as? MosaicConfigurablePurchaseProvider,
            diagnostics = diagnostics,
            identityStore = identityStore,
            analyticsRuntime = analytics,
            purchaseProvider = purchaseProvider,
            applicationVersion = configuration.applicationVersion,
            experimentStore = experimentStore,
            transactionObservationRuntime = observations,
        ).also { client ->
            (context.applicationContext as? android.app.Application)?.let { application ->
                MosaicForegroundRefreshRegistry.register(application, namespace, client)
            }
        }
    }

    companion object {
        fun configure(
            apiKey: String,
            purchaseProvider: MosaicPurchaseProvider,
            endpoint: URI? = null,
            applicationVersion: String? = null,
            applicationId: String? = null,
            analyticsCollectionEnabled: Boolean = false,
            transactionObservationEnabled: Boolean = false,
        ): Mosaic = Mosaic(
            configuration = MosaicConfiguration(
                apiKey = apiKey,
                endpoint = endpoint,
                applicationVersion = applicationVersion,
                applicationId = applicationId,
                analyticsCollectionEnabled = analyticsCollectionEnabled,
                transactionObservationEnabled = transactionObservationEnabled,
            ).normalized(),
            purchaseProvider = purchaseProvider,
        )
    }
}
