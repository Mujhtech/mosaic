package dev.mosaic.sdk.revenuecat

import android.app.Activity
import com.revenuecat.purchases.CustomerInfo
import com.revenuecat.purchases.Package
import com.revenuecat.purchases.PurchaseParams
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesErrorCode
import com.revenuecat.purchases.PurchasesException
import com.revenuecat.purchases.PurchasesTransactionException
import com.revenuecat.purchases.awaitCustomerInfo
import com.revenuecat.purchases.awaitGetProducts
import com.revenuecat.purchases.awaitOfferings
import com.revenuecat.purchases.awaitPurchase
import com.revenuecat.purchases.awaitRestore
import com.revenuecat.purchases.models.PurchaseState
import com.revenuecat.purchases.models.StoreProduct
import dev.mosaic.sdk.MosaicActiveEntitlementsResult
import dev.mosaic.sdk.MosaicCommerceAdapterMapping
import dev.mosaic.sdk.MosaicCommerceEntitlementMapping
import dev.mosaic.sdk.MosaicCommerceProductMapping
import dev.mosaic.sdk.MosaicCommerceProviderAdapter
import dev.mosaic.sdk.MosaicCommerceProviderCapability
import dev.mosaic.sdk.MosaicCommerceProviderIdentity
import dev.mosaic.sdk.MosaicCommerceSafeDiagnostic
import dev.mosaic.sdk.MosaicDiagnosticCode
import dev.mosaic.sdk.MosaicEntitlement
import dev.mosaic.sdk.MosaicProduct
import dev.mosaic.sdk.MosaicProductLoadResult
import dev.mosaic.sdk.MosaicPurchaseResult
import dev.mosaic.sdk.MosaicRestoreResult

/**
 * Optional RevenueCat adapter. The host must configure RevenueCat once and pass that instance.
 * Mosaic never initializes RevenueCat and never accepts an API key or app-user identifier.
 */
class MosaicRevenueCatAdapter internal constructor(
    private val client: RevenueCatBridge,
    private val activityProvider: () -> Activity?,
) : MosaicCommerceProviderAdapter {
    private val lock = Any()
    private var handlesByMappingId: Map<String, RevenueCatProductHandle> = emptyMap()
    private var handleGeneration: Long = 0
    private var diagnosticSequence: Long = 0
    private val recentDiagnostics = ArrayDeque<MosaicCommerceSafeDiagnostic>()

    override val identity = MosaicCommerceProviderIdentity(
        id = "revenuecat",
        displayName = "RevenueCat",
        adapterVersion = "1.0.0",
    )

    override val capabilities = listOf(
        MosaicCommerceProviderCapability("productLoading", "supported", null),
        MosaicCommerceProviderCapability("subscriptions", "supported", null),
        MosaicCommerceProviderCapability("oneTimeNonConsumables", "supported", null),
        MosaicCommerceProviderCapability(
            "trials",
            "conditional",
            "provider.platformCapabilityVaries",
        ),
        MosaicCommerceProviderCapability(
            "introductoryOffers",
            "conditional",
            "provider.platformCapabilityVaries",
        ),
        MosaicCommerceProviderCapability(
            "promotionalOffers",
            "conditional",
            "provider.runtimeEligibilityRequired",
        ),
        MosaicCommerceProviderCapability("restore", "supported", null),
        MosaicCommerceProviderCapability("activeEntitlementLookup", "supported", null),
        MosaicCommerceProviderCapability("pendingPurchases", "supported", null),
        MosaicCommerceProviderCapability(
            "deferredPurchases",
            "unsupported",
            "provider.outcomeNotDistinct",
        ),
        MosaicCommerceProviderCapability(
            "serverConfirmedTransactions",
            "conditional",
            "provider.runtimeConfirmation",
        ),
        MosaicCommerceProviderCapability("productSynchronization", "supported", null),
        MosaicCommerceProviderCapability("providerDiagnostics", "supported", null),
    )

    override val diagnostics: List<MosaicCommerceSafeDiagnostic>
        get() = synchronized(lock) { recentDiagnostics.toList() }

    constructor(
        purchases: Purchases,
        activityProvider: () -> Activity?,
    ) : this(PurchasesRevenueCatBridge(purchases), activityProvider)

    override fun invalidateProductHandles() {
        synchronized(lock) {
            handleGeneration += 1
            handlesByMappingId = emptyMap()
        }
    }

    override suspend fun loadProducts(
        mappings: List<MosaicCommerceProductMapping>,
    ): MosaicProductLoadResult {
        val generation = synchronized(lock) { handleGeneration }
        val loaded = try {
            client.loadProducts(mappings)
        } catch (_: Exception) {
            synchronized(lock) {
                if (handleGeneration == generation) {
                    handlesByMappingId = emptyMap()
                }
            }
            val diagnostic = recordDiagnostic(
                code = MosaicDiagnosticCode.COMMERCE_PROVIDER_UNAVAILABLE.wireName,
                safeMessage = "RevenueCat Products are temporarily unavailable.",
                providerCode = "revenuecat.productLoadFailed",
                retryable = true,
                recoveryAction = "retry",
            )
            return MosaicProductLoadResult.Unavailable(
                mappings.map { it.mosaicProductId },
                MosaicDiagnosticCode.COMMERCE_PROVIDER_UNAVAILABLE.wireName,
                diagnostic,
            )
        }
        val accepted = synchronized(lock) {
            if (handleGeneration == generation) {
                handlesByMappingId = loaded
                true
            } else {
                false
            }
        }
        if (!accepted) {
            return MosaicProductLoadResult.Unavailable(
                mappings.map { it.mosaicProductId },
                MosaicDiagnosticCode.COMMERCE_CONFIGURATION_UNAVAILABLE.wireName,
            )
        }
        val products = mappings.mapNotNull { mapping ->
            loaded[mapping.mappingId]?.let { handle ->
                MosaicProduct(
                    id = mapping.mosaicProductId,
                    title = handle.title,
                    localizedPrice = handle.localizedPrice,
                    subscriptionPeriod = handle.subscriptionPeriod,
                    currencyCode = handle.currencyCode,
                )
            }
        }
        val available = products.map { it.id }.toSet()
        return MosaicProductLoadResult.Loaded(
            products,
            mappings.map { it.mosaicProductId }.filterNot(available::contains).toSet(),
        )
    }

    override suspend fun purchase(
        mapping: MosaicCommerceProductMapping,
        entitlementMappings: List<MosaicCommerceEntitlementMapping>,
    ): MosaicPurchaseResult {
        val handle = synchronized(lock) { handlesByMappingId[mapping.mappingId] }
            ?: return MosaicPurchaseResult.ProductUnavailable(mapping.mosaicProductId)
        val activity = activityProvider()
            ?: run {
                val diagnostic = recordDiagnostic(
                    code = "commerce.providerUnavailable",
                    safeMessage = "A visible Android Activity is required to purchase.",
                    providerCode = "revenuecat.activityUnavailable",
                    mosaicProductId = mapping.mosaicProductId,
                    recoveryAction = "retry",
                )
                return MosaicPurchaseResult.ProviderUnavailable(
                    mapping.mosaicProductId,
                    diagnostic.code,
                    diagnostic,
                )
            }
        return when (val result = client.purchase(activity, handle)) {
            is RevenueCatPurchaseBridgeResult.Success -> {
                if (result.pending) {
                    MosaicPurchaseResult.Pending(mapping.mosaicProductId)
                } else {
                    MosaicPurchaseResult.Purchased(
                        mapping.mosaicProductId,
                        result.transactionId,
                        mapEntitlements(result.activeProviderEntitlements, entitlementMappings),
                    )
                }
            }
            is RevenueCatPurchaseBridgeResult.AlreadyEntitled ->
                MosaicPurchaseResult.AlreadyEntitled(
                    mapping.mosaicProductId,
                    mapEntitlements(result.activeProviderEntitlements, entitlementMappings),
                )
            RevenueCatPurchaseBridgeResult.Cancelled ->
                MosaicPurchaseResult.Cancelled(mapping.mosaicProductId)
            RevenueCatPurchaseBridgeResult.Pending ->
                MosaicPurchaseResult.Pending(mapping.mosaicProductId)
            RevenueCatPurchaseBridgeResult.ProductUnavailable ->
                MosaicPurchaseResult.ProductUnavailable(mapping.mosaicProductId)
            RevenueCatPurchaseBridgeResult.ProviderUnavailable -> {
                val diagnostic = recordDiagnostic(
                    code = "commerce.providerUnavailable",
                    safeMessage = "RevenueCat is temporarily unavailable.",
                    providerCode = "revenuecat.providerUnavailable",
                    retryable = true,
                    mosaicProductId = mapping.mosaicProductId,
                    recoveryAction = "retry",
                )
                MosaicPurchaseResult.ProviderUnavailable(
                    mapping.mosaicProductId,
                    diagnostic.code,
                    diagnostic,
                )
            }
            RevenueCatPurchaseBridgeResult.Failed -> {
                val diagnostic = recordDiagnostic(
                    code = MosaicDiagnosticCode.PURCHASE_FAILED.wireName,
                    safeMessage = "The RevenueCat purchase failed.",
                    providerCode = "revenuecat.purchaseFailed",
                    mosaicProductId = mapping.mosaicProductId,
                    recoveryAction = "contactProvider",
                )
                MosaicPurchaseResult.Failed(
                    mapping.mosaicProductId,
                    diagnostic.code,
                    diagnostic,
                )
            }
        }
    }

    override suspend fun restore(
        entitlementMappings: List<MosaicCommerceEntitlementMapping>,
    ): MosaicRestoreResult = when (val result = client.restore()) {
        is RevenueCatEntitlementsBridgeResult.Available -> {
            val entitlements = mapEntitlements(
                result.activeProviderEntitlements,
                entitlementMappings,
            )
            if (entitlements.isEmpty()) {
                MosaicRestoreResult.NothingToRestore
            } else {
                MosaicRestoreResult.Restored(entitlements)
            }
        }
        RevenueCatEntitlementsBridgeResult.Cancelled -> MosaicRestoreResult.Cancelled
        RevenueCatEntitlementsBridgeResult.ProviderUnavailable -> {
            val diagnostic = recordDiagnostic(
                code = "commerce.providerUnavailable",
                safeMessage = "RevenueCat restore is temporarily unavailable.",
                providerCode = "revenuecat.providerUnavailable",
                retryable = true,
                recoveryAction = "retry",
            )
            MosaicRestoreResult.ProviderUnavailable(diagnostic.code, diagnostic)
        }
        RevenueCatEntitlementsBridgeResult.Failed -> {
            val diagnostic = recordDiagnostic(
                code = MosaicDiagnosticCode.RESTORE_FAILED.wireName,
                safeMessage = "The RevenueCat restore failed.",
                providerCode = "revenuecat.restoreFailed",
                recoveryAction = "contactProvider",
            )
            MosaicRestoreResult.Failed(diagnostic.code, diagnostic)
        }
    }

    override suspend fun activeEntitlements(
        entitlementMappings: List<MosaicCommerceEntitlementMapping>,
    ): MosaicActiveEntitlementsResult = when (val result = client.activeEntitlements()) {
        is RevenueCatEntitlementsBridgeResult.Available ->
            MosaicActiveEntitlementsResult.Available(
                mapEntitlements(
                    result.activeProviderEntitlements,
                    entitlementMappings,
                ),
            )
        RevenueCatEntitlementsBridgeResult.Cancelled -> {
            val diagnostic = recordDiagnostic(
                code = "commerce.entitlementsUnknown",
                safeMessage = "Active Access could not be confirmed.",
                providerCode = "revenuecat.entitlementsCancelled",
                recoveryAction = "retry",
            )
            MosaicActiveEntitlementsResult.Unknown(diagnostic.code, diagnostic)
        }
        RevenueCatEntitlementsBridgeResult.ProviderUnavailable -> {
            val diagnostic = recordDiagnostic(
                code = "commerce.providerUnavailable",
                safeMessage = "RevenueCat Access lookup is temporarily unavailable.",
                providerCode = "revenuecat.providerUnavailable",
                retryable = true,
                recoveryAction = "retry",
            )
            MosaicActiveEntitlementsResult.ProviderUnavailable(diagnostic.code, diagnostic)
        }
        RevenueCatEntitlementsBridgeResult.Failed -> {
            val diagnostic = recordDiagnostic(
                code = "commerce.entitlementsFailed",
                safeMessage = "RevenueCat Access lookup failed.",
                providerCode = "revenuecat.entitlementsFailed",
                recoveryAction = "contactProvider",
            )
            MosaicActiveEntitlementsResult.Failed(diagnostic.code, diagnostic)
        }
    }

    private fun mapEntitlements(
        providerIdentifiers: Set<String>,
        mappings: List<MosaicCommerceEntitlementMapping>,
    ): Set<MosaicEntitlement> = mappings
        .filter { it.providerEntitlementIdentifier in providerIdentifiers }
        .mapTo(mutableSetOf()) { MosaicEntitlement(it.mosaicEntitlementKey) }

    private fun recordDiagnostic(
        code: String,
        safeMessage: String,
        providerCode: String,
        retryable: Boolean = false,
        mosaicProductId: String? = null,
        recoveryAction: String,
    ): MosaicCommerceSafeDiagnostic = synchronized(lock) {
        diagnosticSequence += 1
        val diagnostic = MosaicCommerceSafeDiagnostic(
            code = code,
            safeMessage = safeMessage,
            severity = "error",
            retryable = retryable,
            retryAfterSeconds = null,
            correlationId = "android_revenuecat_$diagnosticSequence",
            providerCode = providerCode,
            mosaicProductId = mosaicProductId,
            recoveryAction = recoveryAction,
        )
        if (recentDiagnostics.size == 32) recentDiagnostics.removeFirst()
        recentDiagnostics.addLast(diagnostic)
        diagnostic
    }
}

internal data class RevenueCatProductHandle(
    val mappingId: String,
    val title: String,
    val localizedPrice: String,
    val subscriptionPeriod: String?,
    val currencyCode: String?,
    val target: Any,
)

internal sealed interface RevenueCatPurchaseBridgeResult {
    data class Success(
        val transactionId: String?,
        val pending: Boolean,
        val activeProviderEntitlements: Set<String>,
    ) : RevenueCatPurchaseBridgeResult
    data class AlreadyEntitled(
        val activeProviderEntitlements: Set<String>,
    ) : RevenueCatPurchaseBridgeResult
    data object Cancelled : RevenueCatPurchaseBridgeResult
    data object Pending : RevenueCatPurchaseBridgeResult
    data object ProductUnavailable : RevenueCatPurchaseBridgeResult
    data object ProviderUnavailable : RevenueCatPurchaseBridgeResult
    data object Failed : RevenueCatPurchaseBridgeResult
}

internal sealed interface RevenueCatEntitlementsBridgeResult {
    data class Available(
        val activeProviderEntitlements: Set<String>,
    ) : RevenueCatEntitlementsBridgeResult
    data object Cancelled : RevenueCatEntitlementsBridgeResult
    data object ProviderUnavailable : RevenueCatEntitlementsBridgeResult
    data object Failed : RevenueCatEntitlementsBridgeResult
}

internal interface RevenueCatBridge {
    suspend fun loadProducts(
        mappings: List<MosaicCommerceProductMapping>,
    ): Map<String, RevenueCatProductHandle>

    suspend fun purchase(
        activity: Activity,
        handle: RevenueCatProductHandle,
    ): RevenueCatPurchaseBridgeResult

    suspend fun restore(): RevenueCatEntitlementsBridgeResult
    suspend fun activeEntitlements(): RevenueCatEntitlementsBridgeResult
}

private class PurchasesRevenueCatBridge(
    private val purchases: Purchases,
) : RevenueCatBridge {
    override suspend fun loadProducts(
        mappings: List<MosaicCommerceProductMapping>,
    ): Map<String, RevenueCatProductHandle> {
        val directMappings = mappings.filter {
            it.adapterMapping is MosaicCommerceAdapterMapping.DirectProduct
        }
        val directProducts = if (directMappings.isEmpty()) {
            emptyMap()
        } else {
            purchases.awaitGetProducts(
                directMappings.map { it.providerProductReference }.distinct(),
            ).associateBy(StoreProduct::id)
        }
        val packageMappings = mappings.filter {
            it.adapterMapping is MosaicCommerceAdapterMapping.RevenueCatPackage
        }
        val offerings = if (packageMappings.isEmpty()) {
            null
        } else {
            purchases.awaitOfferings()
        }
        return mappings.mapNotNull { mapping ->
            val target: Any = when (val detail = mapping.adapterMapping) {
                MosaicCommerceAdapterMapping.DirectProduct ->
                    directProducts[mapping.providerProductReference]
                is MosaicCommerceAdapterMapping.RevenueCatPackage -> offerings
                    ?.getOffering(detail.offeringIdentifier)
                    ?.availablePackages
                    ?.let { packages ->
                        selectExactRevenueCatPackageIndex(
                            candidates = packages.map {
                                it.identifier to it.product.id
                            },
                            packageIdentifier = detail.packageIdentifier,
                            productReference = mapping.providerProductReference,
                        )?.let(packages::get)
                    }
            } ?: return@mapNotNull null
            val product = when (target) {
                is StoreProduct -> target
                is Package -> target.product
                else -> return@mapNotNull null
            }
            mapping.mappingId to RevenueCatProductHandle(
                mappingId = mapping.mappingId,
                title = product.name.ifBlank { product.title },
                localizedPrice = product.price.formatted,
                subscriptionPeriod = product.period?.iso8601,
                currencyCode = product.price.currencyCode,
                target = target,
            )
        }.toMap()
    }

    override suspend fun purchase(
        activity: Activity,
        handle: RevenueCatProductHandle,
    ): RevenueCatPurchaseBridgeResult = try {
        val params = when (val target = handle.target) {
            is StoreProduct -> PurchaseParams.Builder(activity, target).build()
            is Package -> PurchaseParams.Builder(activity, target).build()
            else -> return RevenueCatPurchaseBridgeResult.ProductUnavailable
        }
        val result = purchases.awaitPurchase(params)
        when (result.storeTransaction.purchaseState) {
            PurchaseState.PURCHASED -> RevenueCatPurchaseBridgeResult.Success(
                transactionId = result.storeTransaction.orderId,
                pending = false,
                activeProviderEntitlements = result.customerInfo.entitlements.active.keys,
            )
            PurchaseState.PENDING -> RevenueCatPurchaseBridgeResult.Pending
            PurchaseState.UNSPECIFIED_STATE -> RevenueCatPurchaseBridgeResult.Failed
        }
    } catch (error: PurchasesTransactionException) {
        normalizePurchaseError(error.code, error.userCancelled) {
            activeEntitlementsOrEmpty()
        }
    } catch (_: PurchasesException) {
        RevenueCatPurchaseBridgeResult.Failed
    }

    override suspend fun restore(): RevenueCatEntitlementsBridgeResult = try {
        RevenueCatEntitlementsBridgeResult.Available(
            purchases.awaitRestore().entitlements.active.keys,
        )
    } catch (error: PurchasesException) {
        normalizeEntitlementError(error.code)
    }

    override suspend fun activeEntitlements(): RevenueCatEntitlementsBridgeResult = try {
        RevenueCatEntitlementsBridgeResult.Available(
            purchases.awaitCustomerInfo().entitlements.active.keys,
        )
    } catch (error: PurchasesException) {
        normalizeEntitlementError(error.code)
    }

    private suspend fun activeEntitlementsOrEmpty(): Set<String> = try {
        purchases.awaitCustomerInfo().entitlements.active.keys
    } catch (_: PurchasesException) {
        emptySet()
    }
}

internal suspend fun normalizePurchaseError(
    code: PurchasesErrorCode,
    userCancelled: Boolean,
    activeEntitlements: suspend () -> Set<String> = { emptySet() },
): RevenueCatPurchaseBridgeResult = when {
    userCancelled || code == PurchasesErrorCode.PurchaseCancelledError ->
        RevenueCatPurchaseBridgeResult.Cancelled
    code == PurchasesErrorCode.PaymentPendingError ->
        RevenueCatPurchaseBridgeResult.Pending
    code == PurchasesErrorCode.ProductAlreadyPurchasedError ->
        RevenueCatPurchaseBridgeResult.AlreadyEntitled(activeEntitlements())
    code == PurchasesErrorCode.ProductNotAvailableForPurchaseError ->
        RevenueCatPurchaseBridgeResult.ProductUnavailable
    code in providerUnavailableErrors ->
        RevenueCatPurchaseBridgeResult.ProviderUnavailable
    else -> RevenueCatPurchaseBridgeResult.Failed
}

internal fun normalizeEntitlementError(
    code: PurchasesErrorCode,
): RevenueCatEntitlementsBridgeResult = when {
    code == PurchasesErrorCode.PurchaseCancelledError ->
        RevenueCatEntitlementsBridgeResult.Cancelled
    code in providerUnavailableErrors ->
        RevenueCatEntitlementsBridgeResult.ProviderUnavailable
    else -> RevenueCatEntitlementsBridgeResult.Failed
}

private val providerUnavailableErrors = setOf(
    PurchasesErrorCode.NetworkError,
    PurchasesErrorCode.StoreProblemError,
    PurchasesErrorCode.InvalidCredentialsError,
    PurchasesErrorCode.ConfigurationError,
    PurchasesErrorCode.UnexpectedBackendResponseError,
    PurchasesErrorCode.UnknownBackendError,
    PurchasesErrorCode.CustomerInfoError,
)

internal fun selectExactRevenueCatPackageIndex(
    candidates: List<Pair<String, String>>,
    packageIdentifier: String,
    productReference: String,
): Int? = candidates
    .mapIndexedNotNull { index, candidate ->
        index.takeIf {
            candidate.first == packageIdentifier &&
                candidate.second == productReference
        }
    }
    .singleOrNull()
