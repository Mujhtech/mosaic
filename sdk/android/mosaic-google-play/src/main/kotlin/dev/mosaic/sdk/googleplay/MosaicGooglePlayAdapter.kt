package dev.mosaic.sdk.googleplay

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.Purchase
import dev.mosaic.sdk.MosaicActiveEntitlementsResult
import dev.mosaic.sdk.MosaicCommerceAdapterConfiguration
import dev.mosaic.sdk.MosaicCommerceConfigurationReference
import dev.mosaic.sdk.MosaicCommerceEntitlementMapping
import dev.mosaic.sdk.MosaicCommerceProviderAdapterV2
import dev.mosaic.sdk.MosaicCommerceProviderCapability
import dev.mosaic.sdk.MosaicCommerceProviderIdentity
import dev.mosaic.sdk.MosaicCommerceProductMapping
import dev.mosaic.sdk.MosaicCommerceSafeDiagnostic
import dev.mosaic.sdk.MosaicCommerceUpdate
import dev.mosaic.sdk.MosaicCommerceUpdateAcceptance
import dev.mosaic.sdk.MosaicCommerceUpdateAcceptanceDisposition
import dev.mosaic.sdk.MosaicCommerceUpdateOutcome
import dev.mosaic.sdk.MosaicCommerceRecoveryMetadata
import dev.mosaic.sdk.MosaicCommerceRecoveryOutcome
import dev.mosaic.sdk.MosaicEntitlement
import dev.mosaic.sdk.MosaicProductLoadResult
import dev.mosaic.sdk.MosaicPurchaseResult
import dev.mosaic.sdk.MosaicRestoreResult
import java.io.File
import java.io.FileOutputStream
import java.lang.ref.WeakReference
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

fun interface MosaicGooglePlayActivityProvider {
    fun resumedActivity(): Activity?
}

/**
 * First-party Google Play Billing provider. The only public types in this surface are Android
 * lifecycle types and provider-neutral Mosaic commerce types.
 */
class MosaicGooglePlayAdapter internal constructor(
    private val service: GooglePlayBillingService,
    private val activityProvider: MosaicGooglePlayActivityProvider,
    private val deliveryAcceptance: MosaicCommerceUpdateAcceptance,
    private val deliveryStore: DeliveryStore,
    private val lifecycle: AutoCloseable?,
    private val scope: CoroutineScope,
) : MosaicCommerceProviderAdapterV2 {
    constructor(
        context: Context,
        activityProvider: MosaicGooglePlayActivityProvider,
        deliveryAcceptance: MosaicCommerceUpdateAcceptance,
    ) : this(
        service = AndroidGooglePlayBillingService(context),
        activityProvider = activityProvider,
        deliveryAcceptance = deliveryAcceptance,
        deliveryStore = FileDeliveryStore(context),
        lifecycle = null,
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
    )

    override val identity = MosaicCommerceProviderIdentity(
        id = "google_play",
        displayName = "Google Play Billing",
        adapterVersion = "1.0.0",
    )
    override val recoveryMode: String = "activePurchaseRecovery"
    override val capabilities = listOf(
        supported("productLoading"),
        supported("subscriptions"),
        supported("oneTimeNonConsumables"),
        conditional("trials", "provider.eligibilityRequired"),
        conditional("introductoryOffers", "provider.eligibilityRequired"),
        unsupported("promotionalOffers", "provider.capabilityUnavailable"),
        supported("restore"),
        supported("activeEntitlementLookup"),
        supported("pendingPurchases"),
        unsupported("deferredPurchases", "provider.outcomeUnavailable"),
        unsupported("serverConfirmedTransactions", "provider.serverValidationExcluded"),
        unsupported(
            "productSynchronization",
            "provider.serverSynchronizationUnavailable",
        ),
        supported("providerDiagnostics"),
        supported("basePlans"),
        supported("explicitOffers"),
        unsupported("storeSynchronization", "provider.recoveryModeUnavailable"),
        supported("activePurchaseRecovery"),
        supported("asynchronousCommerceUpdates"),
        supported("localDeliveryAcceptance"),
    )
    override val diagnostics: List<MosaicCommerceSafeDiagnostic>
        get() = synchronized(diagnosticBuffer) { diagnosticBuffer.toList() }

    private val diagnosticBuffer = ArrayDeque<MosaicCommerceSafeDiagnostic>()
    private val updates = MutableSharedFlow<MosaicCommerceUpdate>(extraBufferCapacity = 16)
    override val commerceUpdates: Flow<MosaicCommerceUpdate> = updates
    private val setup = Mutex()
    private val purchaseLock = Mutex()
    private val installationLock = Any()
    private val handles = ConcurrentHashMap<String, LoadedHandle>()
    @Volatile private var installed: InstalledGeneration? = null
    private var generationCounter: Long = 0
    private var compatibilityReference: MosaicCommerceConfigurationReference? = null
    @Volatile private var activePurchase: ActivePurchase? = null
    private val pendingPurchases = ConcurrentHashMap<String, PurchaseContext>()

    init {
        service.updates = { result, purchases ->
            scope.launch {
                try {
                    onPurchasesUpdated(result, purchases)
                } catch (error: CancellationException) {
                    throw error
                } catch (_: Exception) {
                    failActiveOperation("commerce.transaction.deliveryPending")
                }
            }
        }
    }

    override fun installConfiguration(configuration: MosaicCommerceAdapterConfiguration) {
        val immutableMappings = configuration.mappings.map { it.copy(
            entitlementKeys = it.entitlementKeys.toSet(),
        ) }
        require(immutableMappings.all { it.entitlementKeys.isNotEmpty() })
        require(immutableMappings.map { it.providerProductReference }.toSet().size == immutableMappings.size)
        synchronized(installationLock) {
            generationCounter += 1
            handles.clear()
            installed = InstalledGeneration(
                id = generationCounter,
                reference = configuration.reference,
                mappingsByProviderProduct =
                    immutableMappings.associateBy { it.providerProductReference },
                mappingsById = immutableMappings.associateBy { it.mappingId },
            )
        }
    }

    /**
     * Compatibility wrapper for the pre-amendment Flutter bridge. It stages only the reference;
     * no active generation changes until [installMappings] commits both values atomically.
     */
    @Deprecated("Use installConfiguration for atomic installation.")
    fun installConfigurationReference(reference: MosaicCommerceConfigurationReference) {
        synchronized(installationLock) { compatibilityReference = reference }
    }

    @Deprecated("Use installConfiguration for atomic installation.")
    fun installMappings(mappings: List<MosaicCommerceProductMapping>) {
        val reference = synchronized(installationLock) {
            compatibilityReference.also { compatibilityReference = null }
        } ?: throw IllegalStateException("A configuration reference must be staged first.")
        installConfiguration(MosaicCommerceAdapterConfiguration(reference, mappings))
    }

    override fun invalidateProductHandles() {
        handles.clear()
        synchronized(installationLock) {
            installed = null
            compatibilityReference = null
            generationCounter += 1
        }
    }

    override suspend fun loadProducts(
        mappings: List<MosaicCommerceProductMapping>,
    ): MosaicProductLoadResult {
        val generation = installed
            ?: return unavailable(mappings, "commerce.provider.notConfigured")
        if (
            mappings.any { generation.mappingsById[it.mappingId] != it } ||
            mappings.map { it.providerProductReference }.toSet().size != mappings.size
        ) {
            return unavailable(mappings, "commerce.mapping.ambiguous")
        }
        if (!ensureReady()) return unavailable(mappings, "commerce.entitlements.providerUnavailable")
        val candidates = mutableMapOf<String, GoogleProductCandidate>()
        var providerFailure = false
        mappings.groupBy {
            if (it.productType == "subscription") BillingClient.ProductType.SUBS
            else BillingClient.ProductType.INAPP
        }.forEach { (type, group) ->
            val (result, loaded) = try {
                service.queryProducts(
                    group.map { it.providerProductReference }.distinct(),
                    type,
                )
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                providerFailure = true
                return@forEach
            }
            if (result.code != BillingClient.BillingResponseCode.OK) providerFailure = true
            loaded.forEach { candidates[it.productId] = it }
        }
        if (providerFailure && candidates.isEmpty()) {
            return unavailable(mappings, "commerce.entitlements.providerUnavailable")
        }
        val products = mutableListOf<dev.mosaic.sdk.MosaicProduct>()
        val unavailable = linkedSetOf<String>()
        mappings.forEach { mapping ->
            val selected = candidates[mapping.providerProductReference]?.let {
                GooglePlayProductSelector.select(mapping, it)
            }
            if (selected == null) {
                unavailable += mapping.mosaicProductId
                diagnose(
                    if ((mapping.adapterMapping as? dev.mosaic.sdk.MosaicCommerceAdapterMapping.GooglePlayProduct)?.offerId != null) {
                        "commerce.mapping.offerIneligible"
                    } else {
                        "commerce.product.notFound"
                    },
                    mapping.mosaicProductId,
                )
            } else {
                if (installed?.id != generation.id) {
                    return unavailable(mappings, "commerce.provider.staleConfiguration")
                }
                handles[mapping.mappingId] = LoadedHandle(generation.id, mapping, selected)
                products += selected.product
            }
        }
        return MosaicProductLoadResult.Loaded(products, unavailable)
    }

    override suspend fun purchase(
        mapping: MosaicCommerceProductMapping,
        entitlementMappings: List<MosaicCommerceEntitlementMapping>,
    ): MosaicPurchaseResult = purchaseLock.withLock {
        val handle = handles[mapping.mappingId]
            ?.takeIf { it.mapping == mapping && it.generationId == installed?.id }
            ?: return MosaicPurchaseResult.ProductUnavailable(mapping.mosaicProductId)
        val generation = installed?.takeIf { it.id == handle.generationId }
            ?: return MosaicPurchaseResult.ProductUnavailable(mapping.mosaicProductId)
        if (!ensureReady()) {
            return MosaicPurchaseResult.ProviderUnavailable(
                mapping.mosaicProductId,
                "commerce.entitlements.providerUnavailable",
            )
        }
        val activity = activityProvider.resumedActivity()
            ?: return MosaicPurchaseResult.ProviderUnavailable(
                mapping.mosaicProductId,
                "commerce.provider.activityUnavailable",
            )
        val operationId = "purchase_${UUID.randomUUID()}"
        val deferred = CompletableDeferred<MosaicPurchaseResult>()
        activePurchase = ActivePurchase(operationId, mapping, generation, deferred)
        val result = try {
            service.launch(activity, handle.selected)
        } catch (_: Exception) {
            activePurchase = null
            return MosaicPurchaseResult.ProviderUnavailable(
                mapping.mosaicProductId,
                "commerce.entitlements.providerUnavailable",
            )
        }
        if (result.code == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
            activePurchase = null
            return when (val recovered = recover(emitEntitlementChange = false, generation)) {
                is Recovery.Available -> {
                    val expected = mapping.entitlementKeys.mapTo(linkedSetOf(), ::MosaicEntitlement)
                    if (expected.isNotEmpty() && recovered.entitlements.containsAll(expected)) {
                        MosaicPurchaseResult.AlreadyEntitled(mapping.mosaicProductId, expected)
                    } else {
                        MosaicPurchaseResult.Failed(
                            mapping.mosaicProductId,
                            "commerce.purchase.activePurchaseQueryFailed",
                        )
                    }
                }
                else -> MosaicPurchaseResult.ProviderUnavailable(
                    mapping.mosaicProductId,
                    "commerce.entitlements.providerUnavailable",
                )
            }
        }
        if (result.code != BillingClient.BillingResponseCode.OK) {
            activePurchase = null
            return classifyLaunch(result.code, mapping.mosaicProductId)
        }
        try {
            deferred.await()
        } finally {
            if (activePurchase?.deferred === deferred) activePurchase = null
        }
    }

    override suspend fun restore(
        entitlementMappings: List<MosaicCommerceEntitlementMapping>,
    ): MosaicRestoreResult {
        val operationId = "recovery_${UUID.randomUUID()}"
        val generation = installed
        val result = if (generation == null) {
            Recovery.ProviderUnavailable
        } else {
            recover(emitEntitlementChange = true, generation)
        }
        val outcome = when (result) {
            is Recovery.Available -> if (result.entitlements.isEmpty()) {
                MosaicCommerceRecoveryOutcome.NOTHING_TO_RESTORE
            } else {
                MosaicCommerceRecoveryOutcome.RESTORED
            }
            Recovery.ProviderUnavailable -> MosaicCommerceRecoveryOutcome.PROVIDER_UNAVAILABLE
            Recovery.Failed -> MosaicCommerceRecoveryOutcome.FAILED
        }
        val resultDiagnostics = when (result) {
            Recovery.ProviderUnavailable -> listOf(
                safeDiagnostic("commerce.recovery.partialFailure", null),
            )
            Recovery.Failed -> listOf(safeDiagnostic("commerce.recovery.failed", null))
            is Recovery.Available -> emptyList()
        }
        return MosaicRestoreResult.Detailed(
            outcome = outcome,
            entitlements = (result as? Recovery.Available)?.entitlements.orEmpty(),
            metadata = MosaicCommerceRecoveryMetadata(
                operationId = operationId,
                providerId = identity.id,
                recoveryMode = recoveryMode,
                completedAt = utcNow(),
                diagnostics = resultDiagnostics,
            ),
        )
    }

    override suspend fun activeEntitlements(
        entitlementMappings: List<MosaicCommerceEntitlementMapping>,
    ): MosaicActiveEntitlementsResult {
        val generation = installed ?: return MosaicActiveEntitlementsResult.Unknown(
            "commerce.provider.notConfigured",
        )
        return when (val result = recover(emitEntitlementChange = false, generation)) {
            is Recovery.Available -> MosaicActiveEntitlementsResult.Available(result.entitlements)
            Recovery.ProviderUnavailable -> MosaicActiveEntitlementsResult.ProviderUnavailable(
                "commerce.entitlements.providerUnavailable",
            )
            Recovery.Failed -> MosaicActiveEntitlementsResult.Failed("commerce.entitlements.failed")
        }
    }

    override fun close() {
        service.updates = { _, _ -> }
        scope.cancel()
        runCatching { service.close() }
        runCatching { lifecycle?.close() }
        invalidateProductHandles()
    }

    private suspend fun ensureReady(): Boolean = setup.withLock {
        try {
            service.connect().code == BillingClient.BillingResponseCode.OK
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            false
        }
    }

    private suspend fun onPurchasesUpdated(
        result: GoogleBillingResult,
        purchases: List<GooglePurchase>,
    ) {
        val active = activePurchase
        if (result.code == BillingClient.BillingResponseCode.USER_CANCELED) {
            active?.deferred?.complete(MosaicPurchaseResult.Cancelled(active.mapping.mosaicProductId))
            return
        }
        if (result.code != BillingClient.BillingResponseCode.OK) {
            active?.deferred?.complete(classifyLaunch(result.code, active.mapping.mosaicProductId))
            return
        }
        purchases.forEach { purchase ->
            val digest = tokenDigest(purchase.token)
            val operation = active?.takeIf {
                it.mapping.providerProductReference in purchase.products
            }
            val context = operation?.let {
                PurchaseContext(it.generation, it.mapping, it.operationId)
            } ?: pendingPurchases[digest] ?: currentContext(purchase)
                ?: return@forEach
            val normalized = processPurchase(purchase, context)
            operation?.deferred?.complete(normalized)
        }
    }

    private suspend fun processPurchase(
        purchase: GooglePurchase,
        context: PurchaseContext,
    ): MosaicPurchaseResult {
        val mapping = context.mapping
        if (purchase.state == Purchase.PurchaseState.PENDING) {
            pendingPurchases[tokenDigest(purchase.token)] = context
            emitUpdate(purchase, context, MosaicCommerceUpdateOutcome.PENDING, emptySet())
            return MosaicPurchaseResult.Pending(mapping.mosaicProductId)
        }
        if (purchase.state != Purchase.PurchaseState.PURCHASED) {
            return MosaicPurchaseResult.Failed(mapping.mosaicProductId, "commerce.purchase.failed")
        }
        val digest = tokenDigest(purchase.token)
        val grants = mapping.entitlementKeys.mapTo(linkedSetOf(), ::MosaicEntitlement)
        if (grants.isEmpty()) {
            return MosaicPurchaseResult.Failed(
                mapping.mosaicProductId,
                "commerce.mapping.entitlementGrantMissing",
            )
        }
        val finalized = try {
            deliveryStore.isFinalized(digest)
        } catch (_: Exception) {
            return deliveryFailure(mapping.mosaicProductId)
        }
        if (finalized) {
            pendingPurchases.remove(digest)
            return MosaicPurchaseResult.Purchased(mapping.mosaicProductId, digest, grants)
        }
        val update = update(purchase, context, MosaicCommerceUpdateOutcome.PURCHASED, grants)
        try {
            deliveryStore.recordPending(digest)
        } catch (_: Exception) {
            return deliveryFailure(mapping.mosaicProductId)
        }
        val disposition = try {
            deliveryAcceptance.accept(update)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            MosaicCommerceUpdateAcceptanceDisposition.DELIVERY_FAILED
        }
        if (
            disposition != MosaicCommerceUpdateAcceptanceDisposition.ACCEPTED &&
            disposition != MosaicCommerceUpdateAcceptanceDisposition.ALREADY_ACCEPTED
        ) {
            updates.emit(update)
            val code = if (
                disposition ==
                MosaicCommerceUpdateAcceptanceDisposition.REJECTED_STALE_CONFIGURATION
            ) {
                "commerce.transaction.staleConfiguration"
            } else {
                "commerce.transaction.deliveryPending"
            }
            diagnose(code, mapping.mosaicProductId)
            return MosaicPurchaseResult.Failed(
                mapping.mosaicProductId,
                code,
            )
        }
        try {
            deliveryStore.recordAccepted(digest)
        } catch (_: Exception) {
            return deliveryFailure(mapping.mosaicProductId)
        }
        updates.emit(update)
        if (!purchase.acknowledged) {
            val acknowledgement = try {
                service.acknowledge(purchase.token)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                diagnose("commerce.transaction.finalizationFailed", mapping.mosaicProductId)
                return MosaicPurchaseResult.Failed(
                    mapping.mosaicProductId,
                    "commerce.transaction.finalizationFailed",
                )
            }
            if (acknowledgement.code != BillingClient.BillingResponseCode.OK) {
                diagnose("commerce.transaction.finalizationFailed", mapping.mosaicProductId)
                return MosaicPurchaseResult.Failed(
                    mapping.mosaicProductId,
                    "commerce.transaction.finalizationFailed",
                )
            }
        }
        try {
            deliveryStore.recordFinalized(digest)
        } catch (_: Exception) {
            return deliveryFailure(mapping.mosaicProductId)
        }
        pendingPurchases.remove(digest)
        return MosaicPurchaseResult.Purchased(mapping.mosaicProductId, digest, grants)
    }

    private suspend fun recover(
        emitEntitlementChange: Boolean,
        generation: InstalledGeneration,
    ): Recovery {
        if (!ensureReady()) return Recovery.ProviderUnavailable
        val subscriptions: Pair<GoogleBillingResult, List<GooglePurchase>>
        val inApps: Pair<GoogleBillingResult, List<GooglePurchase>>
        try {
            subscriptions = service.queryPurchases(BillingClient.ProductType.SUBS)
            inApps = service.queryPurchases(BillingClient.ProductType.INAPP)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            return Recovery.ProviderUnavailable
        }
        if (subscriptions.first.code != BillingClient.BillingResponseCode.OK ||
            inApps.first.code != BillingClient.BillingResponseCode.OK
        ) return Recovery.ProviderUnavailable
        val grants = linkedSetOf<MosaicEntitlement>()
        (subscriptions.second + inApps.second).forEach { purchase ->
            if (purchase.state != Purchase.PurchaseState.PURCHASED) return@forEach
            val context = pendingPurchases[tokenDigest(purchase.token)]
                ?: contextFor(purchase, generation)
                ?: return@forEach
            when (val processed = processPurchase(purchase, context)) {
                is MosaicPurchaseResult.Purchased -> grants += processed.entitlements
                else -> return Recovery.Failed
            }
        }
        if (emitEntitlementChange && grants.isNotEmpty()) {
            // Per-purchase purchased updates already carry the exact grant snapshot.
        }
        return Recovery.Available(grants)
    }

    private suspend fun emitUpdate(
        purchase: GooglePurchase,
        context: PurchaseContext,
        outcome: MosaicCommerceUpdateOutcome,
        grants: Set<MosaicEntitlement>,
    ) {
        updates.emit(update(purchase, context, outcome, grants))
    }

    private fun update(
        purchase: GooglePurchase,
        context: PurchaseContext,
        outcome: MosaicCommerceUpdateOutcome,
        grants: Set<MosaicEntitlement>,
    ): MosaicCommerceUpdate {
        val digest = tokenDigest(purchase.token)
        val outcomeIdentity = outcome.name.lowercase(Locale.US)
        return MosaicCommerceUpdate(
            updateId = "google_${digest}_$outcomeIdentity",
            operationId = context.operationId,
            providerId = identity.id,
            mosaicProductId = context.mapping.mosaicProductId,
            configuration = context.generation.reference,
            outcome = outcome,
            transactionReference = digest,
            activeEntitlements = grants,
            occurredAt = utcNow(),
        )
    }

    private fun classifyLaunch(code: Int, productId: String): MosaicPurchaseResult = when (code) {
        BillingClient.BillingResponseCode.USER_CANCELED ->
            MosaicPurchaseResult.Cancelled(productId)
        BillingClient.BillingResponseCode.ITEM_UNAVAILABLE ->
            MosaicPurchaseResult.ProductUnavailable(productId)
        BillingClient.BillingResponseCode.SERVICE_DISCONNECTED,
        BillingClient.BillingResponseCode.SERVICE_UNAVAILABLE,
        BillingClient.BillingResponseCode.NETWORK_ERROR ->
            MosaicPurchaseResult.ProviderUnavailable(
                productId,
                "commerce.entitlements.providerUnavailable",
            )
        BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED ->
            MosaicPurchaseResult.Failed(productId, "commerce.purchase.activePurchaseQueryRequired")
        else -> MosaicPurchaseResult.Failed(productId, "commerce.purchase.failed")
    }

    private fun unavailable(
        mappings: List<MosaicCommerceProductMapping>,
        code: String,
    ) = MosaicProductLoadResult.Unavailable(
        mappings.map { it.mosaicProductId },
        code,
    )

    private fun currentContext(purchase: GooglePurchase): PurchaseContext? =
        installed?.let { contextFor(purchase, it) }

    private fun contextFor(
        purchase: GooglePurchase,
        generation: InstalledGeneration,
    ): PurchaseContext? {
        val mappings = purchase.products.mapNotNull(generation.mappingsByProviderProduct::get)
            .distinctBy { it.mappingId }
        return mappings.singleOrNull()?.let {
            PurchaseContext(generation, it, null)
        }
    }

    private fun deliveryFailure(productId: String): MosaicPurchaseResult.Failed {
        diagnose("commerce.transaction.deliveryPending", productId)
        return MosaicPurchaseResult.Failed(
            productId,
            "commerce.transaction.deliveryPending",
        )
    }

    private fun failActiveOperation(code: String) {
        val active = activePurchase ?: return
        diagnose(code, active.mapping.mosaicProductId)
        active.deferred.complete(
            MosaicPurchaseResult.Failed(active.mapping.mosaicProductId, code),
        )
    }

    private fun diagnose(code: String, productId: String?) {
        val diagnostic = safeDiagnostic(code, productId)
        synchronized(diagnosticBuffer) {
            if (diagnosticBuffer.size == 32) diagnosticBuffer.removeFirst()
            diagnosticBuffer.addLast(diagnostic)
        }
    }

    private fun safeDiagnostic(
        code: String,
        productId: String?,
    ): MosaicCommerceSafeDiagnostic =
        MosaicCommerceSafeDiagnostic(
            code = code,
            safeMessage = "Google Play commerce operation requires attention.",
            severity = "warning",
            retryable = code.endsWith("Unavailable") ||
                code.endsWith("deliveryPending") ||
                code.endsWith("partialFailure"),
            retryAfterSeconds = null,
            correlationId = "google_${UUID.randomUUID()}",
            providerCode = null,
            mosaicProductId = productId,
            recoveryAction = if (code.contains("mapping")) "fixProductMapping" else "retry",
        )

    private data class LoadedHandle(
        val generationId: Long,
        val mapping: MosaicCommerceProductMapping,
        val selected: GoogleSelectedProduct,
    )

    private data class ActivePurchase(
        val operationId: String,
        val mapping: MosaicCommerceProductMapping,
        val generation: InstalledGeneration,
        val deferred: CompletableDeferred<MosaicPurchaseResult>,
    )

    private data class PurchaseContext(
        val generation: InstalledGeneration,
        val mapping: MosaicCommerceProductMapping,
        val operationId: String?,
    )

    private data class InstalledGeneration(
        val id: Long,
        val reference: MosaicCommerceConfigurationReference,
        val mappingsByProviderProduct: Map<String, MosaicCommerceProductMapping>,
        val mappingsById: Map<String, MosaicCommerceProductMapping>,
    )

    private sealed interface Recovery {
        data class Available(val entitlements: Set<MosaicEntitlement>) : Recovery
        data object ProviderUnavailable : Recovery
        data object Failed : Recovery
    }

    companion object {
        fun create(
            application: Application,
            deliveryAcceptance: MosaicCommerceUpdateAcceptance,
        ): MosaicGooglePlayAdapter {
            val tracker = ResumedActivityTracker(application)
            val adapter = MosaicGooglePlayAdapter(
                service = AndroidGooglePlayBillingService(application),
                activityProvider = tracker,
                deliveryAcceptance = deliveryAcceptance,
                deliveryStore = FileDeliveryStore(application),
                lifecycle = tracker,
                scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
            )
            tracker.onResume = {
                adapter.scope.launch { adapter.activeEntitlements(emptyList()) }
            }
            adapter.scope.launch { adapter.ensureReady() }
            return adapter
        }

        private fun supported(name: String) =
            MosaicCommerceProviderCapability(name, "supported", null)

        private fun conditional(name: String, reason: String) =
            MosaicCommerceProviderCapability(name, "conditional", reason)

        private fun unsupported(name: String, reason: String) =
            MosaicCommerceProviderCapability(name, "unsupported", reason)
    }
}

internal interface DeliveryStore {
    suspend fun recordPending(digest: String)
    suspend fun recordAccepted(digest: String)
    suspend fun recordFinalized(digest: String)
    suspend fun isFinalized(digest: String): Boolean
}

/**
 * Local delivery markers are app-private, excluded from Android auto-backup, bounded, and written
 * atomically off the main thread.
 *
 * Storage lives under [Context.getNoBackupFilesDir] because a restored marker from another device
 * or install would let a purchase short-circuit host delivery and grant Entitlements that were
 * never delivered on this device. The legacy `mosaic-google-play-delivery-v1` SharedPreferences
 * file was backup-eligible, so it is deliberately not migrated: its contents cannot be trusted.
 * It is deleted once, and losing a genuine marker is safe because re-delivery is idempotent — the
 * host reports `ALREADY_ACCEPTED` and Google Play acknowledgement is skipped for an already
 * acknowledged purchase.
 *
 * The file is bounded to [MAX_DIGESTS] entries; the least recently written entries are evicted
 * first. An evicted marker degrades to another idempotent re-delivery, never to a lost purchase.
 *
 * The record is a line-delimited `state<tab>digest` list written by literal name. Both fields are
 * closed vocabularies (three states, hexadecimal digests), so the adapter needs no JSON dependency
 * and no reflective binding that R8 could rename.
 */
internal class FileDeliveryStore internal constructor(
    private val file: File,
    private val io: CoroutineDispatcher,
    private val legacyPreferences: (() -> Unit)? = null,
) : DeliveryStore {
    constructor(context: Context, io: CoroutineDispatcher = Dispatchers.IO) : this(
        file = File(
            context.applicationContext.noBackupFilesDir,
            "mosaic/google-play/delivery-v2/markers.txt",
        ),
        io = io,
        legacyPreferences = {
            context.applicationContext.deleteSharedPreferences(
                "mosaic-google-play-delivery-v1",
            )
        },
    )

    private val lock = Mutex()
    private var discardedLegacy = false

    override suspend fun recordPending(digest: String) = write(digest, "pending")
    override suspend fun recordAccepted(digest: String) = write(digest, "accepted")
    override suspend fun recordFinalized(digest: String) = write(digest, "finalized")

    override suspend fun isFinalized(digest: String): Boolean = lock.withLock {
        read()[digest] == "finalized"
    }

    private suspend fun write(digest: String, state: String) = lock.withLock {
        val markers = LinkedHashMap(read())
        markers.remove(digest)
        markers[digest] = state
        while (markers.size > MAX_DIGESTS) {
            markers.remove(markers.keys.first())
        }
        persist(markers)
    }

    /** Insertion order is the write order, so the first key is always the least recently written. */
    private suspend fun read(): Map<String, String> = withContext(io) {
        discardLegacyPreferencesOnce()
        if (!file.isFile) return@withContext emptyMap()
        runCatching { decode(file.readText(Charsets.UTF_8)) }.getOrDefault(emptyMap())
    }

    private suspend fun persist(markers: Map<String, String>) = withContext(io) {
        file.parentFile?.let {
            if (!it.isDirectory && !it.mkdirs()) {
                error("Could not create the Mosaic Google Play delivery directory.")
            }
        }
        val temporary = File.createTempFile("markers-", ".tmp", file.parentFile)
        try {
            FileOutputStream(temporary).use { output ->
                output.writer(Charsets.UTF_8).buffered().use { writer ->
                    writer.write(encode(markers)); writer.flush(); output.fd.sync()
                }
            }
            if (!temporary.renameTo(file)) {
                error("Could not atomically persist Google Play delivery state.")
            }
        } finally {
            if (temporary.exists()) temporary.delete()
        }
    }

    private fun discardLegacyPreferencesOnce() {
        if (discardedLegacy) return
        discardedLegacy = true
        legacyPreferences?.let { discard -> runCatching { discard() } }
    }

    private fun encode(markers: Map<String, String>): String =
        markers.entries.joinToString("\n") { (digest, state) -> "$state\t$digest" }

    private fun decode(source: String): Map<String, String> {
        val markers = LinkedHashMap<String, String>()
        source.lineSequence().filter(String::isNotEmpty).forEach { line ->
            val separator = line.indexOf('\t')
            require(separator > 0) { "A Google Play delivery marker line is malformed." }
            val state = line.substring(0, separator)
            val digest = line.substring(separator + 1)
            require(state in STATES && digest.isNotEmpty() && digest.all { it in HEXADECIMAL })
            markers[digest] = state
        }
        require(markers.size <= MAX_DIGESTS)
        return markers
    }

    private companion object {
        const val MAX_DIGESTS = 256
        val STATES = setOf("pending", "accepted", "finalized")
        const val HEXADECIMAL = "0123456789abcdef"
    }
}

private class ResumedActivityTracker(
    private val application: Application,
) : MosaicGooglePlayActivityProvider, Application.ActivityLifecycleCallbacks, AutoCloseable {
    private var activity = WeakReference<Activity>(null)
    var onResume: () -> Unit = {}

    init {
        application.registerActivityLifecycleCallbacks(this)
    }

    override fun resumedActivity(): Activity? = activity.get()
    override fun onActivityResumed(value: Activity) {
        activity = WeakReference(value)
        onResume()
    }
    override fun onActivityPaused(value: Activity) {
        if (activity.get() === value) activity.clear()
    }
    override fun close() {
        application.unregisterActivityLifecycleCallbacks(this)
        activity.clear()
    }
    override fun onActivityCreated(activity: Activity, state: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit
}

private fun tokenDigest(token: String): String =
    MessageDigest.getInstance("SHA-256").digest(token.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

private fun utcNow(): String = SimpleDateFormat(
    "yyyy-MM-dd'T'HH:mm:ss'Z'",
    Locale.US,
).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())
