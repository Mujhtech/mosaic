package dev.mosaic.sdk

import android.os.Build
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * The Analytics Event contract this SDK emits and reads: `2`, and nothing else (ADR-0028).
 *
 * One constant rather than two, because the contract requires an event's `eventSchemaVersion` to
 * equal its batch's `analyticsEventContractVersion`; two names could disagree.
 */
const val MOSAIC_ANALYTICS_CONTRACT_VERSION = "2"

data class MosaicAnalyticsIdentity(
    val installationId: String,
    val applicationUserId: String?,
    val generation: Long,
)

data class MosaicAnalyticsContext(
    val platform: String = "android",
    val sdkFamily: String = "android",
    val sdkVersion: String = MOSAIC_ANDROID_SDK_VERSION,
    val operatingSystemVersion: String? = Build.VERSION.RELEASE?.takeIf(String::isNotBlank),
    val applicationVersion: String? = null,
    val locale: String? = MosaicDeviceLocale.currentForEventContext,
    val configurationDeliveryVersion: String? = null,
    val commerceProviderContractVersion: String? = null,
)

data class MosaicAnalyticsCorrelation(
    val placementRequestId: String? = null,
    val paywallPresentationId: String? = null,
    val productLoadAttemptId: String? = null,
    val purchaseAttemptId: String? = null,
    val restoreAttemptId: String? = null,
    val providerOperationId: String? = null,
    val providerUpdateId: String? = null,
)

data class MosaicAnalyticsAttribution(
    val configurationReleaseId: String? = null,
    val placementId: String? = null,
    val placementRuleSetId: String? = null,
    val placementRuleSetVersion: Long? = null,
    val winningRuleId: String? = null,
    val paywallId: String? = null,
    val paywallVersionId: String? = null,
    val mosaicProductId: String? = null,
    val planId: String? = null,
    val providerId: String? = null,
    val providerProductMappingId: String? = null,
    val experimentId: String? = null,
    val experimentVersionId: String? = null,
    val experimentVariantId: String? = null,
    val experimentAllocationVersion: String? = null,
)

data class MosaicExperimentAttribution(
    val experimentId: String,
    val experimentVersionId: String,
    val experimentVariantId: String,
    val experimentAllocationVersion: String,
)

enum class MosaicExperimentPresentationKind { VARIANT, FALLBACK }

data class MosaicExperimentPresentationContext(
    val attribution: MosaicExperimentAttribution,
    val assignmentKeyType: String,
    val bucketingAlgorithm: String,
    val qaOverride: Boolean,
    val kind: MosaicExperimentPresentationKind,
    val fallbackReason: String? = null,
    val presentedPaywallId: String,
    val presentedPaywallVersionId: String,
    internal val assignmentSubjectDigest: String? = null,
)

data class MosaicAnalyticsPresentationContext(
    val placementRequestId: String,
    val paywallPresentationId: String,
    val context: MosaicAnalyticsContext,
    val attribution: MosaicAnalyticsAttribution,
    val experiment: MosaicExperimentPresentationContext? = null,
    internal val acknowledgeExperimentPresentation: (() -> Unit)? = null,
)

sealed interface MosaicAnalyticsPayload {
    val eventName: String

    data object Empty : MosaicAnalyticsPayload { override val eventName = "" }
    data class PlacementRequested(val decisionContractVersion: String = "1") : MosaicAnalyticsPayload { override val eventName = "placement_requested" }
    data class PlacementSelected(
        val finalOutcome: String,
        val decisionContractVersion: String = "1",
        val assignmentKeyType: String? = null,
        val bucketingAlgorithm: String? = null,
        val rolloutBucket: Int? = null,
    ) : MosaicAnalyticsPayload { override val eventName = if (finalOutcome == "paywall") "placement_paywall_selected" else "placement_no_paywall" }
    data class PlacementFallback(val trigger: String, val fallbackKey: String, val finalOutcome: String, val diagnosticCode: String? = null) : MosaicAnalyticsPayload { override val eventName = "placement_fallback_used" }
    data class PlacementUnavailable(val reason: String, val diagnosticCode: String? = null) : MosaicAnalyticsPayload { override val eventName = "placement_unavailable" }
    data class DiagnosticFailure(override val eventName: String, val diagnosticCode: String, val retryable: Boolean) : MosaicAnalyticsPayload
    data class PaywallPresented(val marker: Unit = Unit) : MosaicAnalyticsPayload { override val eventName = "paywall_presented" }
    data class PaywallDismissed(val reason: String) : MosaicAnalyticsPayload { override val eventName = "paywall_dismissed" }
    data class PaywallAction(val action: String, val componentId: String? = null) : MosaicAnalyticsPayload { override val eventName = "paywall_action_selected" }
    data class ProductLoadStarted(val requestedProductCount: Int) : MosaicAnalyticsPayload { override val eventName = "product_load_started" }
    data class ProductLoadCompleted(val availableProductCount: Int, val unavailableProductCount: Int, val durationMs: Long) : MosaicAnalyticsPayload { override val eventName = "product_load_completed" }
    data class ProductLoadFailed(val requestedProductCount: Int, val durationMs: Long, val diagnosticCode: String, val retryable: Boolean) : MosaicAnalyticsPayload { override val eventName = "product_load_failed" }
    data class ProductUnavailable(val reason: String, val diagnosticCode: String? = null) : MosaicAnalyticsPayload { override val eventName = "product_unavailable" }
    data class ProductSelected(val source: String) : MosaicAnalyticsPayload { override val eventName = "product_selected" }
    data class PurchaseStarted(val marker: Unit = Unit) : MosaicAnalyticsPayload { override val eventName = "purchase_started" }
    data class PurchaseCompleted(val outcome: String, val durationMs: Long, val observedEntitlementKeys: List<String>, val providerResultCode: String? = null) : MosaicAnalyticsPayload { override val eventName = "purchase_completed_client" }
    data class PurchaseLifecycle(override val eventName: String, val durationMs: Long, val providerResultCode: String? = null) : MosaicAnalyticsPayload
    data class PurchaseFailed(val durationMs: Long, val diagnosticCode: String, val retryable: Boolean) : MosaicAnalyticsPayload { override val eventName = "purchase_failed" }
    data class RestoreStarted(val providerId: String) : MosaicAnalyticsPayload { override val eventName = "restore_started" }
    data class RestoreCompleted(val providerId: String, val durationMs: Long, val restoredProductIds: List<String>, val observedEntitlementKeys: List<String>) : MosaicAnalyticsPayload { override val eventName = "restore_completed" }
    data class RestoreLifecycle(override val eventName: String, val providerId: String, val durationMs: Long, val providerResultCode: String? = null) : MosaicAnalyticsPayload
    data class RestoreFailed(val providerId: String, val durationMs: Long, val diagnosticCode: String, val retryable: Boolean) : MosaicAnalyticsPayload { override val eventName = "restore_failed" }
    /** Decode-only representation for the trusted provider fixture; the public runtime refuses to enqueue it. */
    data class ProviderCompleted(val confirmationSource: String, val activeEntitlementKeys: List<String>, val linkedClientEventId: String?) : MosaicAnalyticsPayload { override val eventName = "purchase_completed_provider" }
    data class ExperimentAssigned(val assignmentKeyType: String, val bucketingAlgorithm: String, val bucket: Int, val source: String = "deterministic") : MosaicAnalyticsPayload { override val eventName = "experiment_assigned" }
    data class ExperimentExposed(val assignmentKeyType: String, val bucketingAlgorithm: String, val productReadiness: String = "ready", val providerCapability: String = "accepted", val qaOverride: Boolean = false) : MosaicAnalyticsPayload { override val eventName = "experiment_exposed" }
    data class ExperimentFallbackPresented(val reason: String, val presentedPaywallId: String, val presentedPaywallVersionId: String, val diagnosticCode: String) : MosaicAnalyticsPayload { override val eventName = "experiment_fallback_presented" }
    data class ExperimentAssignmentFailed(val diagnosticCode: String, val retryable: Boolean) : MosaicAnalyticsPayload { override val eventName = "experiment_assignment_failed" }
}

data class MosaicAnalyticsEvent(
    val eventId: String,
    val eventSchemaVersion: String,
    val eventName: String,
    val occurredAt: String,
    val queuedAt: String,
    val authority: String,
    val identity: MosaicAnalyticsIdentity?,
    val sessionId: String?,
    val context: MosaicAnalyticsContext?,
    val correlation: MosaicAnalyticsCorrelation,
    val attribution: MosaicAnalyticsAttribution,
    val payload: MosaicAnalyticsPayload,
)

data class MosaicAnalyticsBatch(val batchId: String, val sentAt: String, val events: List<MosaicAnalyticsEvent>)

sealed interface MosaicAnalyticsEventResult {
    val eventId: String
    data class Accepted(override val eventId: String) : MosaicAnalyticsEventResult
    data class Duplicate(override val eventId: String) : MosaicAnalyticsEventResult
    data class PermanentlyRejected(override val eventId: String, val code: String) : MosaicAnalyticsEventResult
    data class Retryable(override val eventId: String, val code: String, val retryAfterSeconds: Int?) : MosaicAnalyticsEventResult
}

data class MosaicAnalyticsIngestionResponse(
    val batchId: String,
    val receivedAt: String,
    val results: List<MosaicAnalyticsEventResult>,
    /**
     * The contract version the server echoed. It must equal the submitted batch's version before
     * any result is applied: a v2 Experiment batch is acknowledged only by a v2 response.
     */
    val analyticsEventContractVersion: String,
)

internal fun mosaicAnalyticsId(prefix: String): String = "${prefix}_${UUID.randomUUID()}"

internal fun mosaicAnalyticsTimestamp(epochMillis: Long): String =
    SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
        isLenient = false
    }.format(Date(epochMillis))

internal fun mosaicAnalyticsTimestampMillis(value: String): Long =
    requireNotNull(SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
        isLenient = false
    }.parse(value)).time

internal fun mosaicAnalyticsDuration(startedAt: Long, endedAt: Long): Long =
    (endedAt - startedAt).coerceIn(0, 86_400_000)

internal fun MosaicAnalyticsAttribution.hasExperimentTuple(): Boolean =
    listOf(experimentId, experimentVersionId, experimentVariantId, experimentAllocationVersion).all { it != null }

internal fun MosaicAnalyticsPayload.isExperimentV2(): Boolean = when (this) {
    is MosaicAnalyticsPayload.ExperimentAssigned,
    is MosaicAnalyticsPayload.ExperimentExposed,
    is MosaicAnalyticsPayload.ExperimentFallbackPresented,
    is MosaicAnalyticsPayload.ExperimentAssignmentFailed,
    -> true
    else -> false
}
