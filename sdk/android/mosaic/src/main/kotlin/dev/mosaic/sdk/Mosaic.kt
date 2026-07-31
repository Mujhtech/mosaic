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
    /**
     * Opt in to authoritative entitlements by supplying a way to mint Customer Access Tokens.
     *
     * `null` — the default — leaves the whole feature inert: no request is made, no file is written,
     * and every authoritative surface reports `unavailable`. It is null by default because Mosaic
     * Billing structurally requires an application backend: a public SDK key can never select a
     * Billing Customer, so an SDK that tried to enable this on its own could only guess at identity.
     *
     * Authoritative entitlements are additive. The provider-observed commerce API is unchanged and
     * still drives Placement targeting; this answers the different question of what **Mosaic** has
     * validated, which is the answer worth trusting after a refund, a revocation, or a reinstall.
     */
    val customerAccessTokenProvider: MosaicCustomerAccessTokenProvider? = null,
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
        // Authoritative entitlements exist only when the host supplied a token provider. The
        // reference is resolved lazily because the trusted time anchor the freshness policy measures
        // against lives on the accepted configuration, which the client below owns.
        val clientReference = java.util.concurrent.atomic.AtomicReference<MosaicHostedConfigurationClient?>()
        // One session for both consumers. Sharing it is what makes an observation's attribution
        // consistent with the entitlement state the same app is reading, and it keeps a single
        // single-flight boundary in front of the host's token backend rather than two competing ones.
        val customerTokenSession = configuration.customerAccessTokenProvider?.let(::MosaicCustomerTokenSession)
        val customerEntitlements = customerTokenSession?.let { session ->
            MosaicCustomerEntitlementRuntime(
                transport = MosaicHTTPCustomerEntitlementTransport(configuration),
                cache = MosaicCustomerEntitlementCache(context, namespace),
                session = session,
                trustedTime = {
                    clientReference.get()?.acceptedConfiguration?.trustedTimeAnchor?.nowEpochMillis()
                },
                diagnostics = diagnostics,
            )
        }
        val customerPurchaseRefresh = customerEntitlements?.let { runtime ->
            commerceUpdates?.let { updates ->
                MosaicCustomerPurchaseRefresh(runtime).also { it.collect(updates) }
            }
        }
        // Attribution for the optional observation handoff. Without it a validated purchase anchors
        // anonymously to its store lineage; with it, Mosaic can bind the purchase to the Billing
        // Customer the host has already authenticated. The observation record itself is unchanged —
        // this is a transport header, not a contract field.
        if (customerTokenSession != null && observations != null) {
            // Cached-only, and never a mint. Attribution is a bonus on a fire-and-forget path, so a
            // background flush must not initiate network work against the host's backend — least of
            // all on a cold start, before the app has any reason to believe anyone is signed in. If
            // no token is already held, the submission goes out anonymously.
            observations.bindCustomerTokenSource { customerTokenSession.heldToken() }
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
            customerEntitlementRuntime = customerEntitlements,
        ).also { client ->
            client.customerPurchaseRefresh = customerPurchaseRefresh
            clientReference.set(client)
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
            customerAccessTokenProvider: MosaicCustomerAccessTokenProvider? = null,
        ): Mosaic = Mosaic(
            configuration = MosaicConfiguration(
                apiKey = apiKey,
                endpoint = endpoint,
                applicationVersion = applicationVersion,
                applicationId = applicationId,
                analyticsCollectionEnabled = analyticsCollectionEnabled,
                transactionObservationEnabled = transactionObservationEnabled,
                customerAccessTokenProvider = customerAccessTokenProvider,
            ).normalized(),
            purchaseProvider = purchaseProvider,
        )
    }
}
