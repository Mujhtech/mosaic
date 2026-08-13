package dev.mosaic.sdk

/**
 * The Configuration Delivery contract this SDK reads: `3`, and nothing else.
 *
 * ADR-0028 gives every contract exactly one version until GA. Delivery `3` is re-pinned to carry
 * Paywall Protocol [MOSAIC_PROTOCOL_VERSION], which is what makes an authored `0.4` document
 * deliverable at all — the predecessor pinned `0.3` in a `const`, so a `0.4` document had no hosted
 * representation.
 */
const val MOSAIC_CONFIGURATION_DELIVERY_VERSION: String = "3"

enum class MosaicDeliveryEnvironmentMode { DEVELOPMENT, STAGING, PRODUCTION }

data class MosaicDeliveryEnvironment(
    val id: String,
    val key: String,
    val mode: MosaicDeliveryEnvironmentMode,
)

data class MosaicDeliveryProduct(
    val id: String,
    val type: String,
    val fallbackDisplayName: String,
    val readiness: MosaicProductReadiness = MosaicProductReadiness.READY,
)

data class MosaicDeliveryAsset(
    val id: String,
    val kind: String,
    val mediaType: String,
    val byteLength: Long,
    val contentDigest: String,
    val url: String,
)

data class MosaicDeliveredPaywall(
    val id: String,
    val paywallId: String,
    val protocolVersion: String,
    val documentDigest: String,
    val document: MosaicPaywallDocument,
    val productReferenceIds: List<String>,
    val assetBindings: Map<String, String>,
)

data class MosaicConfigurationRelease(
    val id: String,
    val number: Long,
    val projectId: String,
    val environment: MosaicDeliveryEnvironment,
    val publishedAt: String,
    val contentDigest: String,
    val paywallVersions: Map<String, MosaicDeliveredPaywall>,
    val productReferences: Map<String, MosaicDeliveryProduct>,
    val assetReferences: Map<String, MosaicDeliveryAsset>,
    val encoded: String,
    val placementDecisions: Map<String, MosaicPlacementRuleSet> = emptyMap(),
    val entitlementReferences: Map<String, MosaicDeliveryEntitlement> = emptyMap(),
    val deliveryVersion: String = MOSAIC_CONFIGURATION_DELIVERY_VERSION,
    /** Canonical candidate order is retained; multiple Experiments may target one Placement. */
    val experimentAssignments: List<MosaicExperimentAssignment> = emptyList(),
)

class MosaicConfigurationDeliveryException(message: String, cause: Throwable? = null) :
    IllegalArgumentException(message, cause)
