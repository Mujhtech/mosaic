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
    IMAGE_UNAVAILABLE("image_unavailable"),
    RENDERING_FAILED("rendering_failed"),
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

/** Reads the generated canonical RC1 fixture packaged into the SDK AAR's assets. */
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
