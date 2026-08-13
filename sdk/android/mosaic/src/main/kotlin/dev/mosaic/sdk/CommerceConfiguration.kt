package dev.mosaic.sdk

/**
 * The Commerce Configuration contract this SDK reads: `2`, and nothing else (ADR-0028).
 */
const val MOSAIC_COMMERCE_CONFIGURATION_VERSION: String = "2"

data class MosaicCommerceProviderIdentity(
    val id: String,
    val displayName: String,
    val adapterVersion: String,
)

data class MosaicCommerceProviderCapability(
    val name: String,
    val support: String,
    val reasonCode: String?,
)

sealed interface MosaicCommerceProviderActivation {
    val source: String

    data class ProviderConnection(val providerConnectionId: String) :
        MosaicCommerceProviderActivation {
        override val source: String = "providerConnection"
    }

    data class SdkLocal(val localSnapshotId: String) : MosaicCommerceProviderActivation {
        override val source: String = "sdkLocal"
    }

    data object NativeStore : MosaicCommerceProviderActivation {
        override val source: String = "nativeStore"
    }
}

sealed interface MosaicCommerceAdapterMapping {
    val kind: String

    data object DirectProduct : MosaicCommerceAdapterMapping {
        override val kind: String = "directProduct"
    }

    data class RevenueCatPackage(
        val offeringIdentifier: String,
        val packageIdentifier: String,
    ) : MosaicCommerceAdapterMapping {
        override val kind: String = "revenueCatPackage"
    }

    data class GooglePlayProduct(
        val basePlanId: String?,
        val offerId: String?,
    ) : MosaicCommerceAdapterMapping {
        override val kind: String = "googlePlayProduct"
    }
}

data class MosaicCommerceProductMapping(
    val mosaicProductId: String,
    val mappingId: String,
    val providerProductReference: String,
    val adapterMapping: MosaicCommerceAdapterMapping,
    val productType: String? = null,
    val entitlementKeys: Set<String> = emptySet(),
)

data class MosaicCommerceEntitlementMapping(
    val mosaicEntitlementKey: String,
    val providerEntitlementIdentifier: String,
)

data class MosaicCommerceFreshness(
    val source: String,
    val status: String,
    val providerObservedAt: String,
    val synchronizedAt: String,
    val staleAt: String,
    val expiresAt: String?,
)

data class MosaicCommerceSafeDiagnostic(
    val code: String,
    val safeMessage: String,
    val severity: String,
    val retryable: Boolean,
    val retryAfterSeconds: Int?,
    val correlationId: String,
    val providerCode: String?,
    val mosaicProductId: String?,
    val recoveryAction: String?,
)

data class MosaicCommerceConfiguration(
    val id: String,
    val environmentId: String,
    val applicationId: String,
    val storePlatform: String,
    val configurationReleaseId: String,
    val configurationReleaseDigest: String,
    val contentDigest: String,
    val provider: MosaicCommerceProviderIdentity,
    val activation: MosaicCommerceProviderActivation,
    val capabilities: List<MosaicCommerceProviderCapability>,
    val productMappings: Map<String, MosaicCommerceProductMapping>,
    val entitlementMappings: Map<String, MosaicCommerceEntitlementMapping>,
    val freshness: MosaicCommerceFreshness,
    val diagnostics: List<MosaicCommerceSafeDiagnostic>,
    val encoded: String,
    val version: String = MOSAIC_COMMERCE_CONFIGURATION_VERSION,
    val recoveryMode: String = "providerDefined",
)


class MosaicCommerceConfigurationException(
    message: String,
    cause: Throwable? = null,
) : IllegalArgumentException(message, cause)
