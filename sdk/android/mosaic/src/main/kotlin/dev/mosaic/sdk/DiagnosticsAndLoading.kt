package dev.mosaic.sdk

import android.content.Context
import java.io.IOException

enum class MosaicDiagnosticCode(val wireName: String) {
    PRIMARY_DOCUMENT_REJECTED("primary_document_rejected"),
    BUNDLED_FALLBACK_REJECTED("bundled_fallback_rejected"),
    BUNDLED_FALLBACK_MISSING("bundled_fallback_missing"),
    PRODUCT_LOAD_FAILED("product_load_failed"),
    PURCHASE_FAILED("purchase_failed"),
    RESTORE_FAILED("restore_failed"),
    NAVIGATION_BACK_UNAVAILABLE("navigation_back_unavailable"),
    EXTERNAL_URL_FAILED("external_url_failed"),
    IMAGE_UNAVAILABLE("image_unavailable"),
    MEDIA_BACKGROUND_UNAVAILABLE("media_background_unavailable"),
    LAYOUT_UNBOUNDED_FILL("layout_unbounded_fill"),
    RENDERING_FAILED("rendering_failed"),
    CONFIGURATION_CACHE_REJECTED("configuration.cache.rejected"),
    CONFIGURATION_BUNDLED_FALLBACK_MISSING("configuration.bundledFallback.missing"),
    CONFIGURATION_BUNDLED_FALLBACK_REJECTED("configuration.bundledFallback.rejected"),
    CONFIGURATION_REFRESH_ETAG_REJECTED("configuration.refresh.etagRejected"),
    CONFIGURATION_REFRESH_RELEASE_REJECTED("configuration.refresh.releaseRejected"),
    CONFIGURATION_REFRESH_TRANSPORT_FAILED("configuration.refresh.transportFailed"),
    CONFIGURATION_REFRESH_UNEXPECTED_NOT_MODIFIED("configuration.refresh.unexpected304"),
    CONFIGURATION_CACHE_WRITE_FAILED("configuration.cache.writeFailed"),
    COMMERCE_CONFIGURATION_UNAVAILABLE("commerce.configurationUnavailable"),
    COMMERCE_CONFIGURATION_REJECTED("commerce.configurationRejected"),
    COMMERCE_CONFIGURATION_CACHE_WRITE_FAILED("commerce.configurationCacheWriteFailed"),
    COMMERCE_MAPPING_INVALID("commerce.mappingInvalid"),
    COMMERCE_PROVIDER_UNAVAILABLE("commerce.providerUnavailable"),
    EXPERIMENT_TIME_UNRELIABLE("experiment.time_unreliable"),
    EXPERIMENT_VARIANT_UNAVAILABLE("experiment.variant_unavailable"),

    // Optional Transaction Observation handoff. Every code below is a local, secret-free operational
    // signal; none of them describes the outcome of a server-side validation, which this SDK never
    // learns and must never claim.
    TRANSACTION_OBSERVATION_QUEUED("transaction.observation.queued"),
    TRANSACTION_OBSERVATION_DELIVERY_FAILED("transaction.observation.deliveryFailed"),
    TRANSACTION_OBSERVATION_REJECTED("transaction.observation.rejected"),
    TRANSACTION_OBSERVATION_DROPPED("transaction.observation.dropped"),
    TRANSACTION_OBSERVATION_REFERENCE_UNAVAILABLE("transaction.observation.referenceUnavailable"),

    // Authoritative entitlements. Every code below describes Mosaic's ability to answer, never a
    // customer's access: none of them may ever be read as "this person is not entitled".
    CUSTOMER_ENTITLEMENTS_SNAPSHOT_REJECTED("customer.entitlements.snapshotRejected"),
    CUSTOMER_ENTITLEMENTS_BINDING_MISMATCH("customer.entitlements.bindingMismatch"),
    CUSTOMER_ENTITLEMENTS_CACHE_INVALID("customer.entitlements.cacheInvalid"),
    CUSTOMER_ENTITLEMENTS_CLOCK_UNRELIABLE("customer.entitlements.clockUnreliable"),
    CUSTOMER_ENTITLEMENTS_TOKEN_UNAVAILABLE("customer.entitlements.tokenUnavailable"),
    CUSTOMER_ENTITLEMENTS_UNAUTHORIZED("customer.entitlements.unauthorized"),
    CUSTOMER_ENTITLEMENTS_TRANSPORT_FAILED("customer.entitlements.transportFailed"),
    CUSTOMER_ENTITLEMENTS_RESTORE_VALIDATION_PENDING("customer.entitlements.restoreValidationPending"),
}

data class MosaicDiagnostic(
    val code: MosaicDiagnosticCode,
    val message: String,
)

fun interface MosaicDiagnosticSink {
    fun record(diagnostic: MosaicDiagnostic)

    companion object {
        val None = MosaicDiagnosticSink { }
    }
}

fun interface MosaicPaywallDocumentSource {
    /** Returns UTF-8 JSON or null when the local source is absent. */
    fun read(): String?
}

enum class MosaicPaywallSource {
    PRIMARY,
    BUNDLED_FALLBACK,
}

sealed interface MosaicPaywallLoadResult {
    data class Loaded(
        val document: MosaicPaywallDocument,
        val source: MosaicPaywallSource,
    ) : MosaicPaywallLoadResult

    data class ConfigurationUnavailable(
        val presentationResult: MosaicPresentationResult.ConfigurationUnavailable =
            MosaicPresentationResult.ConfigurationUnavailable(
                diagnosticCode = MosaicDiagnosticCode.BUNDLED_FALLBACK_REJECTED.wireName,
            ),
    ) : MosaicPaywallLoadResult
}

/** Phase-1-only local candidate -> canonical packaged bundle -> unavailable resolution. */
class MosaicLocalPaywallLoader(
    private val bundledFallback: MosaicPaywallDocumentSource,
    private val capabilityReport: MosaicCapabilityReport = MosaicProtocolCapabilities.report(),
    private val diagnostics: MosaicDiagnosticSink = MosaicDiagnosticSink.None,
) {
    fun load(primaryDocumentJson: String?): MosaicPaywallLoadResult {
        if (primaryDocumentJson != null) {
            val primary = runCatching {
                MosaicProtocolDecoder.decode(primaryDocumentJson, capabilityReport)
            }.getOrNull()
            if (primary != null) {
                return MosaicPaywallLoadResult.Loaded(primary, MosaicPaywallSource.PRIMARY)
            }
            diagnostics.record(
                MosaicDiagnostic(
                    MosaicDiagnosticCode.PRIMARY_DOCUMENT_REJECTED,
                    "The local primary paywall was rejected; Mosaic is trying its bundled fallback.",
                ),
            )
        }

        val fallbackJson = runCatching { bundledFallback.read() }.getOrNull()
        if (fallbackJson == null) {
            diagnostics.record(
                MosaicDiagnostic(
                    MosaicDiagnosticCode.BUNDLED_FALLBACK_MISSING,
                    "The bundled Mosaic paywall could not be read.",
                ),
            )
            return MosaicPaywallLoadResult.ConfigurationUnavailable()
        }

        val fallback = runCatching {
            MosaicProtocolDecoder.decode(fallbackJson, capabilityReport)
        }.getOrNull()
        if (fallback == null) {
            diagnostics.record(
                MosaicDiagnostic(
                    MosaicDiagnosticCode.BUNDLED_FALLBACK_REJECTED,
                    "The bundled Mosaic paywall was rejected.",
                ),
            )
            return MosaicPaywallLoadResult.ConfigurationUnavailable()
        }
        return MosaicPaywallLoadResult.Loaded(fallback, MosaicPaywallSource.BUNDLED_FALLBACK)
    }
}

/** Reads the generated current canonical fixture packaged into the SDK AAR's assets. */
class MosaicCanonicalBundleSource(
    context: Context,
) : MosaicPaywallDocumentSource {
    private val applicationContext = context.applicationContext

    override fun read(): String? = try {
        applicationContext.assets.open(ASSET_NAME).bufferedReader(Charsets.UTF_8).use { it.readText() }
    } catch (_: IOException) {
        null
    } catch (_: SecurityException) {
        null
    }

    companion object {
        const val ASSET_NAME: String = "mosaic/complete-paywall.json"
    }
}
