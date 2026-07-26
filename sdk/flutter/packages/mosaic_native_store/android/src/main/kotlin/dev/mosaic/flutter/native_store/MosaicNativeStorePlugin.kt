package dev.mosaic.flutter.native_store

import android.app.Application
import dev.mosaic.sdk.MosaicActiveEntitlementsResult
import dev.mosaic.sdk.MosaicCommerceAdapterMapping
import dev.mosaic.sdk.MosaicCommerceAdapterConfiguration
import dev.mosaic.sdk.MosaicCommerceConfigurationReference
import dev.mosaic.sdk.MosaicCommerceProductMapping
import dev.mosaic.sdk.MosaicCommerceSafeDiagnostic
import dev.mosaic.sdk.MosaicCommerceUpdate
import dev.mosaic.sdk.MosaicCommerceUpdateAcceptance
import dev.mosaic.sdk.MosaicCommerceUpdateAcceptanceDisposition
import dev.mosaic.sdk.MosaicProduct
import dev.mosaic.sdk.MosaicProductLoadResult
import dev.mosaic.sdk.MosaicPurchaseResult
import dev.mosaic.sdk.MosaicRestoreResult
import dev.mosaic.sdk.googleplay.MosaicGooglePlayAdapter
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

class MosaicNativeStorePlugin : FlutterPlugin, MethodChannel.MethodCallHandler {
    private lateinit var channel: MethodChannel
    private lateinit var application: Application
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var mappings = emptyList<MosaicCommerceProductMapping>()
    private var updateJob: Job? = null

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        application = binding.applicationContext as Application
        channel = MethodChannel(binding.binaryMessenger, CHANNEL)
        channel.setMethodCallHandler(this)
        bridge.attach(application, channel)
        updateJob = scope.launch {
            bridge.adapter(application).commerceUpdates.collect { update ->
                channel.invokeMethod("commerceUpdateReplay", encodeUpdate(update))
            }
        }
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        updateJob?.cancel()
        channel.setMethodCallHandler(null)
        bridge.detach(channel)
        scope.cancel()
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        val arguments = call.arguments as? Map<*, *>
        if ((arguments?.get("codecVersion") as? Number)?.toInt() != CODEC_VERSION) {
            result.error("codec_version", "Unsupported Mosaic channel codec.", null)
            return
        }
        scope.launch {
            try {
                val value = when (call.method) {
                    "profile" -> bridge.adapter(application).let { adapter ->
                        mapOf(
                            "provider" to mapOf(
                                "id" to adapter.identity.id,
                                "displayName" to adapter.identity.displayName,
                                "adapterVersion" to adapter.identity.adapterVersion,
                            ),
                            "capabilities" to adapter.capabilities.map { capability ->
                                mapOf(
                                    "name" to capability.name,
                                    "support" to capability.support,
                                    "reasonCode" to capability.reasonCode,
                                ).filterValues { it != null }
                            },
                            "recoveryMode" to adapter.recoveryMode,
                        )
                    }
                    "activate" -> activate(arguments)
                    "loadProducts" -> load(arguments)
                    "purchase" -> purchase(arguments)
                    "restore" -> encodeRestore(bridge.adapter(application).restore(emptyList()))
                    "activeEntitlements" ->
                        encodeEntitlements(bridge.adapter(application).activeEntitlements(emptyList()))
                    "diagnostics" -> mapOf(
                        "providerId" to "google_play",
                        "diagnostics" to bridge.adapter(application).diagnostics.map(::encodeDiagnostic),
                    )
                    "invalidate" -> {
                        bridge.adapter(application).invalidateProductHandles()
                        null
                    }
                    "close" -> {
                        bridge.close()
                        null
                    }
                    else -> throw IllegalArgumentException("Unknown Mosaic method.")
                }
                result.success(value)
            } catch (_: Throwable) {
                result.error(
                    "provider_unavailable",
                    "The Mosaic Google Play adapter is unavailable.",
                    null,
                )
            }
        }
    }

    private fun activate(arguments: Map<*, *>): Map<String, Any> {
        require(arguments["providerId"] == "google_play")
        val reference = arguments.map("configuration")
        mappings = arguments.list("mappings").map(::decodeMapping)
        bridge.adapter(application).apply {
            installConfiguration(
                MosaicCommerceAdapterConfiguration(
                    reference = MosaicCommerceConfigurationReference(
                    reference.string("configurationId"),
                    reference.string("configurationRevision"),
                ),
                    mappings = mappings,
                ),
            )
        }
        return mapOf("status" to "ready")
    }

    private suspend fun load(arguments: Map<*, *>): Map<String, Any?> {
        val requested = arguments.list("productIds").map { it as String }
        val selected = requested.map { productId ->
            mappings.single { it.mosaicProductId == productId }
        }
        return when (val response = bridge.adapter(application).loadProducts(selected)) {
            is MosaicProductLoadResult.Loaded -> {
                val productsById = response.products.associateBy(MosaicProduct::id)
                mapOf("products" to selected.map { mapping ->
                    productsById[mapping.mosaicProductId]?.let { product ->
                        encodeProduct(mapping, product)
                    } ?: mapOf(
                        "mosaicProductId" to mapping.mosaicProductId,
                        "availability" to "unavailable",
                    )
                })
            }
            is MosaicProductLoadResult.Unavailable -> mapOf(
                "products" to selected.map {
                    mapOf(
                        "mosaicProductId" to it.mosaicProductId,
                        "availability" to "unavailable",
                    )
                },
            )
        }
    }

    private suspend fun purchase(arguments: Map<*, *>): Map<String, Any?> {
        val productId = arguments.string("mosaicProductId")
        val mapping = mappings.single { it.mosaicProductId == productId }
        return encodePurchase(bridge.adapter(application).purchase(mapping, emptyList()))
    }

    private fun decodeMapping(value: Any?): MosaicCommerceProductMapping {
        val item = value as Map<*, *>
        val adapter = item.map("adapterMapping")
        require(adapter["kind"] == "googlePlayProduct")
        return MosaicCommerceProductMapping(
            mosaicProductId = item.string("mosaicProductId"),
            mappingId = item.string("mappingId"),
            providerProductReference = item.string("providerProductReference"),
            adapterMapping = MosaicCommerceAdapterMapping.GooglePlayProduct(
                adapter["basePlanId"] as? String,
                adapter["offerId"] as? String,
            ),
            productType = item.string("productType"),
            entitlementKeys = item.list("entitlementKeys").map { it as String }.toSet(),
        )
    }

    private companion object {
        const val CHANNEL = "dev.mosaic/native_store/commerce_v1"
        const val CODEC_VERSION = 1
        val bridge = ProcessBridge()
    }
}

private class ProcessBridge {
    private var adapter: MosaicGooglePlayAdapter? = null
    private val channels = linkedSetOf<MethodChannel>()

    @Synchronized
    fun attach(application: Application, channel: MethodChannel) {
        channels += channel
        adapter(application)
    }

    @Synchronized
    fun detach(channel: MethodChannel) {
        channels -= channel
    }

    @Synchronized
    fun adapter(application: Application): MosaicGooglePlayAdapter =
        adapter ?: MosaicGooglePlayAdapter.create(
            application,
            MosaicCommerceUpdateAcceptance { update -> accept(update) },
        ).also { adapter = it }

    suspend fun accept(
        update: MosaicCommerceUpdate,
    ): MosaicCommerceUpdateAcceptanceDisposition {
        val target = synchronized(this) { channels.lastOrNull() }
            ?: return MosaicCommerceUpdateAcceptanceDisposition.DELIVERY_FAILED
        return suspendCancellableCoroutine { continuation ->
            target.invokeMethod("commerceUpdate", encodeUpdate(update), object : MethodChannel.Result {
                override fun success(result: Any?) {
                    val disposition = when (result as? String) {
                        "accepted" -> MosaicCommerceUpdateAcceptanceDisposition.ACCEPTED
                        "alreadyAccepted" ->
                            MosaicCommerceUpdateAcceptanceDisposition.ALREADY_ACCEPTED
                        "rejectedStaleConfiguration" ->
                            MosaicCommerceUpdateAcceptanceDisposition.REJECTED_STALE_CONFIGURATION
                        else -> MosaicCommerceUpdateAcceptanceDisposition.DELIVERY_FAILED
                    }
                    if (continuation.isActive) continuation.resume(disposition)
                }
                override fun error(code: String, message: String?, details: Any?) {
                    if (continuation.isActive) continuation.resume(
                        MosaicCommerceUpdateAcceptanceDisposition.DELIVERY_FAILED,
                    )
                }
                override fun notImplemented() {
                    if (continuation.isActive) continuation.resume(
                        MosaicCommerceUpdateAcceptanceDisposition.DELIVERY_FAILED,
                    )
                }
            })
        }
    }

    @Synchronized
    fun close() {
        adapter?.close()
        adapter = null
    }
}

private fun encodeProduct(
    mapping: MosaicCommerceProductMapping,
    product: MosaicProduct,
): Map<String, Any?> = mapOf(
    "mosaicProductId" to mapping.mosaicProductId,
    "productType" to mapping.productType,
    "entitlementKeys" to mapping.entitlementKeys.toList(),
    "availability" to "available",
    "metadata" to mapOf(
        "localizedDisplayName" to product.title,
        "localizedPrice" to product.localizedPrice,
        "localizedPeriod" to product.subscriptionPeriod,
        "currencyCode" to product.currencyCode,
        "trial" to product.trial?.let(::encodeOffer),
        "introductoryOffer" to product.introductoryOffer?.let(::encodeOffer),
    ).filterValues { it != null },
)

private fun encodePeriod(value: dev.mosaic.sdk.MosaicCommercePeriod) =
    mapOf("unit" to value.unit, "value" to value.value)

private fun encodeOffer(value: dev.mosaic.sdk.MosaicCommerceOffer) = mapOf(
    "localizedPrice" to value.localizedPrice,
    "period" to encodePeriod(value.period),
    "cycles" to value.cycles,
    "paymentMode" to value.paymentMode,
    "eligibility" to value.eligibility,
).filterValues { it != null }

private fun encodePurchase(value: MosaicPurchaseResult): Map<String, Any?> = when (value) {
    is MosaicPurchaseResult.Purchased -> mapOf(
        "outcome" to "purchased",
        "transactionReference" to value.transactionId,
        "activeEntitlementKeys" to value.entitlements.map { it.id },
    )
    is MosaicPurchaseResult.AlreadyEntitled -> mapOf(
        "outcome" to "alreadyEntitled",
        "activeEntitlementKeys" to value.entitlements.map { it.id },
    )
    is MosaicPurchaseResult.Pending -> mapOf("outcome" to "pending")
    is MosaicPurchaseResult.Deferred -> mapOf("outcome" to "deferred")
    is MosaicPurchaseResult.Cancelled -> mapOf("outcome" to "cancelled")
    is MosaicPurchaseResult.ProductUnavailable -> mapOf("outcome" to "productUnavailable")
    is MosaicPurchaseResult.ProviderUnavailable -> mapOf(
        "outcome" to "providerUnavailable",
        "diagnostics" to listOfNotNull(value.diagnostic?.let(::encodeDiagnostic)),
    )
    is MosaicPurchaseResult.Failed -> mapOf(
        "outcome" to "failed",
        "diagnostics" to listOfNotNull(value.diagnostic?.let(::encodeDiagnostic)),
    )
}

private fun encodeRestore(value: MosaicRestoreResult): Map<String, Any?> = when (value) {
    is MosaicRestoreResult.Restored -> mapOf(
        "outcome" to "restored",
        "activeEntitlementKeys" to value.entitlements.map { it.id },
    )
    MosaicRestoreResult.NothingToRestore -> mapOf("outcome" to "nothingToRestore")
    MosaicRestoreResult.Cancelled -> mapOf("outcome" to "cancelled")
    is MosaicRestoreResult.ProviderUnavailable -> mapOf("outcome" to "providerUnavailable")
    is MosaicRestoreResult.Failed -> mapOf("outcome" to "failed")
    is MosaicRestoreResult.Detailed -> mapOf(
        "outcome" to when (value.outcome) {
            dev.mosaic.sdk.MosaicCommerceRecoveryOutcome.RESTORED -> "restored"
            dev.mosaic.sdk.MosaicCommerceRecoveryOutcome.NOTHING_TO_RESTORE ->
                "nothingToRestore"
            dev.mosaic.sdk.MosaicCommerceRecoveryOutcome.CANCELLED -> "cancelled"
            dev.mosaic.sdk.MosaicCommerceRecoveryOutcome.PROVIDER_UNAVAILABLE ->
                "providerUnavailable"
            dev.mosaic.sdk.MosaicCommerceRecoveryOutcome.FAILED -> "failed"
        },
        "activeEntitlementKeys" to value.entitlements.map { it.id },
        "operationId" to value.metadata.operationId,
        "providerId" to value.metadata.providerId,
        "recoveryMode" to value.metadata.recoveryMode,
        "completedAt" to value.metadata.completedAt,
        "diagnostics" to value.metadata.diagnostics.map(::encodeDiagnostic),
    )
}

private fun encodeEntitlements(value: MosaicActiveEntitlementsResult): Map<String, Any?> =
    when (value) {
        is MosaicActiveEntitlementsResult.Available -> mapOf(
            "outcome" to "available",
            "activeEntitlementKeys" to value.entitlements.map { it.id },
        )
        is MosaicActiveEntitlementsResult.Unknown -> mapOf("outcome" to "unknown")
        is MosaicActiveEntitlementsResult.ProviderUnavailable ->
            mapOf("outcome" to "providerUnavailable")
        is MosaicActiveEntitlementsResult.Failed -> mapOf("outcome" to "failed")
    }

private fun encodeUpdate(value: MosaicCommerceUpdate): Map<String, Any?> = mapOf(
    "updateId" to value.updateId,
    "operationId" to value.operationId,
    "providerId" to value.providerId,
    "mosaicProductId" to value.mosaicProductId,
    "configuration" to mapOf(
        "configurationId" to value.configuration.configurationId,
        "configurationRevision" to value.configuration.configurationRevision,
    ),
    "outcome" to when (value.outcome) {
        dev.mosaic.sdk.MosaicCommerceUpdateOutcome.PURCHASED -> "purchased"
        dev.mosaic.sdk.MosaicCommerceUpdateOutcome.PENDING -> "pending"
        dev.mosaic.sdk.MosaicCommerceUpdateOutcome.CANCELLED -> "cancelled"
        dev.mosaic.sdk.MosaicCommerceUpdateOutcome.PROVIDER_UNAVAILABLE ->
            "providerUnavailable"
        dev.mosaic.sdk.MosaicCommerceUpdateOutcome.FAILED -> "failed"
        dev.mosaic.sdk.MosaicCommerceUpdateOutcome.ENTITLEMENTS_CHANGED ->
            "entitlementsChanged"
    },
    "transactionReference" to value.transactionReference,
    "activeEntitlementKeys" to value.activeEntitlements.map { it.id },
    "occurredAt" to value.occurredAt,
    "diagnostics" to value.diagnostics.map(::encodeDiagnostic),
).filterValues { it != null }

private fun encodeDiagnostic(value: MosaicCommerceSafeDiagnostic): Map<String, Any?> = mapOf(
    "code" to value.code,
    "safeMessage" to value.safeMessage,
    "severity" to value.severity,
    "retryable" to value.retryable,
    "retryAfterSeconds" to value.retryAfterSeconds,
    "correlationId" to value.correlationId,
    "providerCode" to value.providerCode,
    "mosaicProductId" to value.mosaicProductId,
    "recoveryAction" to value.recoveryAction,
).filterValues { it != null }

private fun Map<*, *>.string(name: String): String = get(name) as String
private fun Map<*, *>.map(name: String): Map<*, *> = get(name) as Map<*, *>
private fun Map<*, *>.list(name: String): List<*> = get(name) as List<*>
