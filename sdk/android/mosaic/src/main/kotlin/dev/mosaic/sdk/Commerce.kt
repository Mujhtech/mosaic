package dev.mosaic.sdk

/** Runtime store data keyed by the stable Mosaic Product ID. */
data class MosaicProduct(
    val id: String,
    val title: String,
    val localizedPrice: String,
    val subscriptionPeriod: String? = null,
    val currencyCode: String? = null,
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
}

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
) : MosaicConfigurablePurchaseProvider {
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
            adapter.invalidateProductHandles()
            configurationGeneration += 1
            loadedMappingIds = emptySet()
            this.configuration = configuration
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

    private fun isCompatible(configuration: MosaicCommerceConfiguration): Boolean {
        if (
            configuration.provider.id != adapter.identity.id ||
            configuration.provider.adapterVersion != adapter.identity.adapterVersion
        ) {
            return false
        }
        val declaredCapabilities = configuration.capabilities.associateBy { it.name }
        val runtimeCapabilities = adapter.capabilities.associateBy { it.name }
        return declaredCapabilities.size == configuration.capabilities.size &&
            runtimeCapabilities.size == adapter.capabilities.size &&
            declaredCapabilities == runtimeCapabilities
    }
}
