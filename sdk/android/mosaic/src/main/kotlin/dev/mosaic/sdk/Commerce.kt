package dev.mosaic.sdk

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow

/** Runtime store data keyed by the stable Mosaic Product ID. */
data class MosaicProduct(
    val id: String,
    val title: String,
    val localizedPrice: String,
    val subscriptionPeriod: String? = null,
    val currencyCode: String? = null,
    val type: String? = null,
    val entitlementKeys: Set<String> = emptySet(),
    val trial: MosaicCommerceOffer? = null,
    val introductoryOffer: MosaicCommerceOffer? = null,
)

data class MosaicCommercePeriod(val unit: String, val value: Int)

data class MosaicCommerceOffer(
    val localizedPrice: String?,
    val period: MosaicCommercePeriod,
    val cycles: Int = 1,
    val paymentMode: String? = null,
    val eligibility: String = "unknown",
)

data class MosaicEntitlement(val id: String)

sealed interface MosaicProductLoadResult {
    /** Supports partial availability; unavailable products are omitted by the renderer. */
    data class Loaded(
        val products: List<MosaicProduct>,
        val unavailableProductIds: Set<String> = emptySet(),
    ) : MosaicProductLoadResult

    data class Unavailable(
        val productIds: List<String>,
        val diagnosticCode: String = MosaicDiagnosticCode.PRODUCT_LOAD_FAILED.wireName,
        val diagnostic: MosaicCommerceSafeDiagnostic? = null,
    ) : MosaicProductLoadResult
}

sealed interface MosaicPurchaseResult {
    data class Purchased(
        val productId: String,
        val transactionId: String?,
        val entitlements: Set<MosaicEntitlement> = emptySet(),
    ) : MosaicPurchaseResult

    data class AlreadyEntitled(
        val productId: String,
        val entitlements: Set<MosaicEntitlement> = emptySet(),
    ) : MosaicPurchaseResult
    data class Pending(val productId: String) : MosaicPurchaseResult
    data class Deferred(val productId: String) : MosaicPurchaseResult
    data class Cancelled(val productId: String) : MosaicPurchaseResult
    data class ProductUnavailable(val productId: String) : MosaicPurchaseResult
    data class ProviderUnavailable(
        val productId: String,
        val diagnosticCode: String = "commerce.providerUnavailable",
        val diagnostic: MosaicCommerceSafeDiagnostic? = null,
    ) : MosaicPurchaseResult

    data class Failed(
        val productId: String,
        val diagnosticCode: String = MosaicDiagnosticCode.PURCHASE_FAILED.wireName,
        val diagnostic: MosaicCommerceSafeDiagnostic? = null,
    ) : MosaicPurchaseResult
}

sealed interface MosaicRestoreResult {
    data class Restored(val entitlements: Set<MosaicEntitlement>) : MosaicRestoreResult
    data object NothingToRestore : MosaicRestoreResult
    data object Cancelled : MosaicRestoreResult
    data class ProviderUnavailable(
        val diagnosticCode: String = "commerce.providerUnavailable",
        val diagnostic: MosaicCommerceSafeDiagnostic? = null,
    ) : MosaicRestoreResult

    data class Failed(
        val diagnosticCode: String = MosaicDiagnosticCode.RESTORE_FAILED.wireName,
        val diagnostic: MosaicCommerceSafeDiagnostic? = null,
    ) : MosaicRestoreResult

    /** Complete Commerce Provider Contract v2 recovery outcome. */
    data class Detailed(
        val outcome: MosaicCommerceRecoveryOutcome,
        val entitlements: Set<MosaicEntitlement>,
        val metadata: MosaicCommerceRecoveryMetadata,
    ) : MosaicRestoreResult
}

enum class MosaicCommerceRecoveryOutcome {
    RESTORED,
    NOTHING_TO_RESTORE,
    CANCELLED,
    PROVIDER_UNAVAILABLE,
    FAILED,
}

data class MosaicCommerceRecoveryMetadata(
    val operationId: String,
    val providerId: String,
    val recoveryMode: String,
    val completedAt: String,
    val diagnostics: List<MosaicCommerceSafeDiagnostic>,
)

sealed interface MosaicActiveEntitlementsResult {
    data class Available(val entitlements: Set<MosaicEntitlement>) : MosaicActiveEntitlementsResult
    data class Unknown(
        val diagnosticCode: String,
        val diagnostic: MosaicCommerceSafeDiagnostic? = null,
    ) : MosaicActiveEntitlementsResult
    data class ProviderUnavailable(
        val diagnosticCode: String,
        val diagnostic: MosaicCommerceSafeDiagnostic? = null,
    ) : MosaicActiveEntitlementsResult
    data class Failed(
        val diagnosticCode: String,
        val diagnostic: MosaicCommerceSafeDiagnostic? = null,
    ) : MosaicActiveEntitlementsResult
}

/** Stable renderer-facing commerce interface implemented by mocks or configured provider adapters. */
interface MosaicPurchaseProvider {
    suspend fun loadProducts(productIds: List<String>): MosaicProductLoadResult

    suspend fun purchase(productId: String): MosaicPurchaseResult

    suspend fun restore(): MosaicRestoreResult

    suspend fun activeEntitlements(): MosaicActiveEntitlementsResult
}

/** Optional truthful Experiment readiness declaration; absence means no capability is accepted. */
interface MosaicExperimentCommerceCapabilityProvider {
    val mosaicExperimentCapabilities: Set<String>
}

data class MosaicAnalyticsCommerceAttribution(
    val providerId: String,
    val providerProductMappingId: String?,
)

internal interface MosaicAnalyticsCommerceProvider {
    fun analyticsAttribution(productId: String): MosaicAnalyticsCommerceAttribution
}

/**
 * Provider adapter boundary used by both optional packaged adapters and SDK-local custom providers.
 * Implementations receive only verified sidecar mappings, never arbitrary provider identifiers.
 */
interface MosaicCommerceProviderAdapter {
    /** Stable provider identity reported by this app-installed adapter. */
    val identity: MosaicCommerceProviderIdentity

    /** Runtime capabilities this adapter actually implements on this platform. */
    val capabilities: List<MosaicCommerceProviderCapability>

    /** Bounded, secret-free diagnostics produced by provider operations. */
    val diagnostics: List<MosaicCommerceSafeDiagnostic>

    /**
     * Invalidates every provider-native Product handle. Implementations must make this race-safe
     * with concurrent loads so an older load can never repopulate handles after invalidation.
     */
    fun invalidateProductHandles() = Unit

    suspend fun loadProducts(
        mappings: List<MosaicCommerceProductMapping>,
    ): MosaicProductLoadResult

    suspend fun purchase(
        mapping: MosaicCommerceProductMapping,
        entitlementMappings: List<MosaicCommerceEntitlementMapping>,
    ): MosaicPurchaseResult

    suspend fun restore(
        entitlementMappings: List<MosaicCommerceEntitlementMapping>,
    ): MosaicRestoreResult

    suspend fun activeEntitlements(
        entitlementMappings: List<MosaicCommerceEntitlementMapping>,
    ): MosaicActiveEntitlementsResult
}

enum class MosaicCommerceUpdateOutcome {
    PURCHASED,
    PENDING,
    CANCELLED,
    PROVIDER_UNAVAILABLE,
    FAILED,
    ENTITLEMENTS_CHANGED,
}

data class MosaicCommerceConfigurationReference(
    val configurationId: String,
    val configurationRevision: String,
)

/** Provider-neutral delayed commerce event. Native tokens and receipts must never enter this type. */
data class MosaicCommerceUpdate(
    val updateId: String,
    val operationId: String?,
    val providerId: String,
    val mosaicProductId: String,
    val configuration: MosaicCommerceConfigurationReference,
    val outcome: MosaicCommerceUpdateOutcome,
    val transactionReference: String?,
    val activeEntitlements: Set<MosaicEntitlement>,
    val occurredAt: String,
    val diagnostics: List<MosaicCommerceSafeDiagnostic> = emptyList(),
)

/**
 * Host acceptance is the local delivery boundary. Returning true promises idempotent acceptance;
 * adapters may only finish/acknowledge native transactions after this succeeds.
 */
enum class MosaicCommerceUpdateAcceptanceDisposition {
    ACCEPTED,
    ALREADY_ACCEPTED,
    REJECTED_STALE_CONFIGURATION,
    DELIVERY_FAILED,
}

fun interface MosaicCommerceUpdateAcceptance {
    suspend fun accept(update: MosaicCommerceUpdate): MosaicCommerceUpdateAcceptanceDisposition
}

data class MosaicCommerceAdapterConfiguration(
    val reference: MosaicCommerceConfigurationReference,
    val mappings: List<MosaicCommerceProductMapping>,
) {
    init {
        require(mappings.isNotEmpty())
        require(mappings.map { it.mappingId }.toSet().size == mappings.size)
        require(mappings.map { it.providerProductReference }.toSet().size == mappings.size)
    }
}

/** Optional v2 lifecycle surface used by native-store modules and thin platform bridges. */
interface MosaicCommerceProviderAdapterV2 : MosaicCommerceProviderAdapter, AutoCloseable {
    val recoveryMode: String
    val commerceUpdates: Flow<MosaicCommerceUpdate>
        get() = emptyFlow()

    /** Atomically installs one immutable mapping/grant snapshot and invalidates older handles. */
    fun installConfiguration(configuration: MosaicCommerceAdapterConfiguration)
}

interface MosaicConfigurablePurchaseProvider : MosaicPurchaseProvider {
    fun accept(configuration: MosaicCommerceConfiguration)
    fun clearConfiguration()
}

/**
 * Resolves stable Mosaic Product IDs through one accepted Commerce Configuration snapshot.
 * Calls fail safely until an exact release-associated snapshot has been accepted.
 */
class MosaicConfiguredPurchaseProvider(
    private val adapter: MosaicCommerceProviderAdapter,
) : MosaicConfigurablePurchaseProvider, MosaicAnalyticsCommerceProvider, MosaicExperimentCommerceCapabilityProvider {
    override val mosaicExperimentCapabilities: Set<String>
        get() = buildSet {
            val accepted = adapter.capabilities.filter { it.support == "supported" }.mapTo(mutableSetOf()) { it.name }
            if ("productLoading" in accepted) add("product_load")
            if ("productLoading" in accepted && accepted.any { it in setOf("subscriptions", "oneTimeNonConsumables") }) add("purchase")
            if ("restore" in accepted) add("restore")
            if ("activeEntitlementLookup" in accepted) add("entitlement_lookup")
            if (adapter is MosaicCommerceProviderAdapterV2) add("native_recovery")
        }
    private val lock = Any()
    private var configuration: MosaicCommerceConfiguration? = null
    private var configurationGeneration: Long = 0
    private var loadedMappingIds: Set<String> = emptySet()

    override fun accept(configuration: MosaicCommerceConfiguration) {
        synchronized(lock) {
            if (!isCompatible(configuration)) {
                adapter.invalidateProductHandles()
                configurationGeneration += 1
                loadedMappingIds = emptySet()
                this.configuration = null
                return
            }
            if (this.configuration?.contentDigest == configuration.contentDigest) return
            configurationGeneration += 1
            loadedMappingIds = emptySet()
            this.configuration = configuration
            val v2Adapter = adapter as? MosaicCommerceProviderAdapterV2
            if (v2Adapter == null) {
                adapter.invalidateProductHandles()
            } else {
                v2Adapter.installConfiguration(
                    MosaicCommerceAdapterConfiguration(
                        reference = MosaicCommerceConfigurationReference(
                            configurationId = configuration.id,
                            configurationRevision = configuration.contentDigest,
                        ),
                        mappings = configuration.productMappings.values.toList(),
                    ),
                )
            }
        }
    }

    override fun clearConfiguration() {
        synchronized(lock) {
            adapter.invalidateProductHandles()
            configurationGeneration += 1
            loadedMappingIds = emptySet()
            configuration = null
        }
    }

    override suspend fun loadProducts(productIds: List<String>): MosaicProductLoadResult {
        val (snapshot, generation) = synchronized(lock) {
            configuration?.let { it to configurationGeneration }
        }
            ?: return MosaicProductLoadResult.Unavailable(
                productIds,
                MosaicDiagnosticCode.COMMERCE_CONFIGURATION_UNAVAILABLE.wireName,
            )
        if (productIds.size != productIds.toSet().size) {
            return MosaicProductLoadResult.Unavailable(
                productIds,
                MosaicDiagnosticCode.COMMERCE_MAPPING_INVALID.wireName,
            )
        }
        val mappings = productIds.mapNotNull(snapshot.productMappings::get)
        if (mappings.size != productIds.size) {
            return MosaicProductLoadResult.Unavailable(
                productIds,
                MosaicDiagnosticCode.COMMERCE_MAPPING_INVALID.wireName,
            )
        }
        synchronized(lock) {
            if (configurationGeneration == generation) {
                loadedMappingIds -= mappings.mapTo(mutableSetOf()) { it.mappingId }
            }
        }
        val result = adapter.loadProducts(mappings)
        return synchronized(lock) {
            val isCurrent =
                configurationGeneration == generation &&
                    configuration?.contentDigest == snapshot.contentDigest
            if (!isCurrent) {
                MosaicProductLoadResult.Unavailable(
                    productIds,
                    MosaicDiagnosticCode.COMMERCE_CONFIGURATION_UNAVAILABLE.wireName,
                )
            } else {
                if (result is MosaicProductLoadResult.Loaded) {
                    val loadedProductIds = result.products.mapTo(mutableSetOf()) { it.id }
                    loadedMappingIds += mappings
                        .filter { it.mosaicProductId in loadedProductIds }
                        .mapTo(mutableSetOf()) { it.mappingId }
                }
                result
            }
        }
    }

    override suspend fun purchase(productId: String): MosaicPurchaseResult {
        val resolved = synchronized(lock) {
            val snapshot = configuration
                ?: return MosaicPurchaseResult.ProviderUnavailable(
                    productId,
                    MosaicDiagnosticCode.COMMERCE_CONFIGURATION_UNAVAILABLE.wireName,
                )
            val mapping = snapshot.productMappings[productId]
                ?: return MosaicPurchaseResult.ProductUnavailable(productId)
            if (mapping.mappingId !in loadedMappingIds) {
                return MosaicPurchaseResult.ProductUnavailable(productId)
            }
            mapping to snapshot.entitlementMappings.values.toList()
        }
        return adapter.purchase(resolved.first, resolved.second)
    }

    override suspend fun restore(): MosaicRestoreResult {
        val snapshot = synchronized(lock) { configuration }
            ?: return MosaicRestoreResult.ProviderUnavailable(
                MosaicDiagnosticCode.COMMERCE_CONFIGURATION_UNAVAILABLE.wireName,
            )
        return adapter.restore(snapshot.entitlementMappings.values.toList())
    }

    override suspend fun activeEntitlements(): MosaicActiveEntitlementsResult {
        val snapshot = synchronized(lock) { configuration }
            ?: return MosaicActiveEntitlementsResult.Unknown(
                MosaicDiagnosticCode.COMMERCE_CONFIGURATION_UNAVAILABLE.wireName,
            )
        return adapter.activeEntitlements(snapshot.entitlementMappings.values.toList())
    }

    override fun analyticsAttribution(productId: String): MosaicAnalyticsCommerceAttribution = synchronized(lock) {
        MosaicAnalyticsCommerceAttribution(
            providerId = adapter.identity.id,
            providerProductMappingId = configuration?.productMappings?.get(productId)?.mappingId,
        )
    }

    private fun isCompatible(configuration: MosaicCommerceConfiguration): Boolean {
        if (
            configuration.provider.id != adapter.identity.id ||
            configuration.provider.adapterVersion != adapter.identity.adapterVersion
        ) {
            return false
        }
        val declaredCapabilities = configuration.capabilities.associateBy { it.name }
        val runtimeCapabilities = adapter.capabilities.associateBy { it.name }
        val capabilitiesMatch =
            declaredCapabilities.size == configuration.capabilities.size &&
                runtimeCapabilities.size == adapter.capabilities.size &&
                declaredCapabilities == runtimeCapabilities
        if (!capabilitiesMatch) return false
        val v2Adapter = adapter as? MosaicCommerceProviderAdapterV2
        return if (configuration.version == "2") {
            v2Adapter != null && configuration.recoveryMode == v2Adapter.recoveryMode
        } else {
            true
        }
    }
}
