package dev.mosaic.sdk

import android.content.Context
import android.os.SystemClock
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.OutputStreamWriter
import java.net.URI
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.HttpUrl.Companion.toHttpUrl

private const val MOSAIC_COMMERCE_CONFIGURATION_MEDIA_TYPE =
    "application/vnd.mosaic.commerce-configuration+json;version=2"
private const val MOSAIC_COMMERCE_CONFIGURATION_MEDIA_TYPE_V1 =
    "application/vnd.mosaic.commerce-configuration+json;version=1"

private fun parseHttpDate(value: String?): Long? = value?.let {
    runCatching {
        SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US).apply {
            isLenient = false
            timeZone = TimeZone.getTimeZone("GMT")
        }.parse(it)?.time
    }.getOrNull()
}

internal fun mosaicElapsedRealtime(): Long = runCatching { SystemClock.elapsedRealtime() }.getOrDefault(0L)

data class MosaicCachedConfiguration(
    val etag: String?,
    val payload: String,
    val commercePayload: String? = null,
    val trustedServerTimeEpochMillis: Long? = null,
    val trustedReceiptWallTimeEpochMillis: Long? = null,
    val trustedReceiptElapsedRealtimeMillis: Long? = null,
)

interface MosaicConfigurationCache {
    suspend fun read(): MosaicCachedConfiguration?
    suspend fun write(value: MosaicCachedConfiguration)
}

/**
 * The cache record uses an explicit Gson tree codec rather than reflective binding so R8 cannot
 * rename or strip the persisted field names of a released build. The accepted shape is closed:
 * unknown keys, missing required keys, and wrong JSON types are rejected instead of silently
 * decoding to a partially populated record.
 */
internal object MosaicCachedConfigurationCodec {
    private const val ETAG = "etag"
    private const val PAYLOAD = "payload"
    private const val COMMERCE_PAYLOAD = "commercePayload"
    private const val SERVER_TIME = "trustedServerTimeEpochMillis"
    private const val RECEIPT_WALL_TIME = "trustedReceiptWallTimeEpochMillis"
    private const val RECEIPT_ELAPSED_REALTIME = "trustedReceiptElapsedRealtimeMillis"
    private val acceptedKeys = setOf(
        ETAG, PAYLOAD, COMMERCE_PAYLOAD, SERVER_TIME, RECEIPT_WALL_TIME, RECEIPT_ELAPSED_REALTIME,
    )

    fun encode(value: MosaicCachedConfiguration): String = JsonObject().apply {
        value.etag?.let { addProperty(ETAG, it) }
        addProperty(PAYLOAD, value.payload)
        value.commercePayload?.let { addProperty(COMMERCE_PAYLOAD, it) }
        value.trustedServerTimeEpochMillis?.let { addProperty(SERVER_TIME, it) }
        value.trustedReceiptWallTimeEpochMillis?.let { addProperty(RECEIPT_WALL_TIME, it) }
        value.trustedReceiptElapsedRealtimeMillis?.let { addProperty(RECEIPT_ELAPSED_REALTIME, it) }
    }.toString()

    fun decode(source: String): MosaicCachedConfiguration {
        val root = JsonParser.parseString(source).asJsonObject
        require(root.keySet().all { it in acceptedKeys }) {
            "The Mosaic configuration cache record contains unknown fields."
        }
        require(root.has(PAYLOAD)) { "The Mosaic configuration cache record has no payload." }
        return MosaicCachedConfiguration(
            etag = root.string(ETAG),
            payload = requireNotNull(root.string(PAYLOAD)),
            commercePayload = root.string(COMMERCE_PAYLOAD),
            trustedServerTimeEpochMillis = root.long(SERVER_TIME),
            trustedReceiptWallTimeEpochMillis = root.long(RECEIPT_WALL_TIME),
            trustedReceiptElapsedRealtimeMillis = root.long(RECEIPT_ELAPSED_REALTIME),
        )
    }

    private fun JsonObject.string(key: String): String? = get(key)?.let {
        require(it.isJsonPrimitive && it.asJsonPrimitive.isString) { "$key must be a string." }
        it.asString
    }

    private fun JsonObject.long(key: String): Long? = get(key)?.let {
        require(it.isJsonPrimitive && it.asJsonPrimitive.isNumber) { "$key must be a number." }
        it.asLong
    }
}

class MosaicFileConfigurationCache(
    context: Context,
    configuration: MosaicConfiguration,
) : MosaicConfigurationCache {
    private val directory = File(
        context.applicationContext.filesDir,
        "mosaic/configuration-v1/${mosaicConfigurationCacheNamespace(configuration)}",
    )
    private val entry = File(directory, "accepted-release.json")

    override suspend fun read(): MosaicCachedConfiguration? = withContext(Dispatchers.IO) {
        if (!entry.isFile) return@withContext null
        val cached = try {
            MosaicCachedConfigurationCodec.decode(entry.readText())
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            throw IOException("The Mosaic configuration cache record is invalid.")
        }
        if (!mosaicIsStrongETag(cached.etag)) {
            throw IOException("The Mosaic configuration cache ETag is invalid.")
        }
        cached
    }

    override suspend fun write(value: MosaicCachedConfiguration) = withContext(Dispatchers.IO) {
        require(mosaicIsStrongETag(value.etag)) { "The Mosaic configuration cache ETag must be strong." }
        if (!directory.isDirectory && !directory.mkdirs()) {
            throw IOException("Could not create the Mosaic configuration cache directory.")
        }
        val temporary = File.createTempFile("accepted-release-", ".tmp", directory)
        try {
            FileOutputStream(temporary).use { output ->
                OutputStreamWriter(output, Charsets.UTF_8).buffered().use { writer ->
                    writer.write(MosaicCachedConfigurationCodec.encode(value))
                    writer.flush()
                    output.fd.sync()
                }
            }
            if (!temporary.renameTo(entry)) {
                throw IOException("Could not atomically store Mosaic configuration.")
            }
        } finally {
            if (temporary.exists()) temporary.delete()
        }
    }
}

sealed interface MosaicConfigurationResponse {
    data class Modified(val payload: String, val etag: String?, val serverTimeEpochMillis: Long? = null) : MosaicConfigurationResponse
    data object NotModified : MosaicConfigurationResponse
    data class Failed(val reason: String) : MosaicConfigurationResponse
}

sealed interface MosaicCommerceConfigurationResponse {
    data class Modified(
        val payload: String,
        val etag: String?,
        val configurationReleaseId: String?,
    ) : MosaicCommerceConfigurationResponse
    data class NotModified(
        val etag: String?,
        val configurationReleaseId: String?,
    ) : MosaicCommerceConfigurationResponse
    data class Failed(val reason: String) : MosaicCommerceConfigurationResponse
}

fun interface MosaicCommerceConfigurationTransport {
    suspend fun fetch(etag: String?): MosaicCommerceConfigurationResponse
}

fun interface MosaicConfigurationTransport {
    suspend fun fetch(etag: String?): MosaicConfigurationResponse
}

class MosaicHTTPConfigurationTransport(
    private val configuration: MosaicConfiguration,
    private val capabilityReport: MosaicCapabilityReport = MosaicProtocolCapabilities.report(),
    private val client: OkHttpClient = OkHttpClient.Builder().callTimeout(15, TimeUnit.SECONDS).build(),
) : MosaicConfigurationTransport {
    override suspend fun fetch(etag: String?): MosaicConfigurationResponse = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(configuration.configurationURL().toString())
            .header("Authorization", "Bearer ${configuration.apiKey}")
            .header("Accept", "application/vnd.mosaic.configuration+json;version=3, application/vnd.mosaic.configuration+json;version=2;q=0.9, application/vnd.mosaic.configuration+json;version=1;q=0.8")
            .header("Mosaic-SDK-Platform", "android")
            .header("Mosaic-SDK-Version", MOSAIC_ANDROID_SDK_VERSION)
            .header("Mosaic-Configuration-Versions", "$MOSAIC_CONFIGURATION_DELIVERY_VERSION_V3,$MOSAIC_CONFIGURATION_DELIVERY_VERSION_V2,$MOSAIC_CONFIGURATION_DELIVERY_VERSION")
            .header("Mosaic-Placement-Decision-Versions", MOSAIC_PLACEMENT_DECISION_VERSION)
            .header("Mosaic-Decision-Features", MosaicPlacementDecisionCapabilities.features.joinToString(","))
            .header("Mosaic-Bucketing-Algorithms", MOSAIC_ROLLOUT_ALGORITHM)
            .header("Mosaic-Experiment-Assignment-Versions", MOSAIC_EXPERIMENT_ASSIGNMENT_VERSION)
            .header("Mosaic-Experiment-Features", MosaicExperimentCapabilities.features.joinToString(","))
            .header("Mosaic-Experiment-Bucketing-Algorithms", MosaicExperimentCapabilities.algorithms.joinToString(","))
            .header("Mosaic-Experiment-Schedule-Policies", MOSAIC_EXPERIMENT_TIME_POLICY)
            .header("Mosaic-Paywall-Protocol-Versions", MOSAIC_SUPPORTED_PROTOCOL_VERSIONS.sorted().joinToString(","))
            .header("Mosaic-Paywall-Capabilities", capabilityReport.configurationDeliveryCapabilitiesHeader())
            .apply { configuration.applicationVersion?.let { header("Mosaic-App-Version", it) } }
            .apply { etag?.let { header("If-None-Match", it) } }
            .build()
        try {
            client.newCall(request).execute().use { response ->
                when (response.code) {
                    304 -> MosaicConfigurationResponse.NotModified
                    200 -> response.body?.string()?.let {
                        MosaicConfigurationResponse.Modified(it, response.header("ETag"), parseHttpDate(response.header("Date")))
                    }
                        ?: MosaicConfigurationResponse.Failed("The configuration response was empty.")
                    else -> MosaicConfigurationResponse.Failed("Configuration request failed with HTTP ${response.code}.")
                }
            }
        } catch (error: IOException) {
            MosaicConfigurationResponse.Failed(error.message ?: "Configuration request failed.")
        }
    }
}

class MosaicHTTPCommerceConfigurationTransport(
    private val configuration: MosaicConfiguration,
    private val client: OkHttpClient = OkHttpClient.Builder().callTimeout(15, TimeUnit.SECONDS).build(),
) : MosaicCommerceConfigurationTransport {
    init {
        requireNotNull(configuration.applicationId) {
            "applicationId is required for hosted Commerce Configuration."
        }
    }

    override suspend fun fetch(etag: String?): MosaicCommerceConfigurationResponse =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url(configuration.commerceConfigurationURL())
                .header("Authorization", "Bearer ${configuration.apiKey}")
                .header(
                    "Accept",
                    "$MOSAIC_COMMERCE_CONFIGURATION_MEDIA_TYPE, $MOSAIC_COMMERCE_CONFIGURATION_MEDIA_TYPE_V1;q=0.9",
                )
                .header("Mosaic-Commerce-Configuration-Versions", "2,1")
                .header("Mosaic-Commerce-Provider-Contract-Versions", "2,1")
                .header("Mosaic-SDK-Platform", "android")
                .header("Mosaic-SDK-Version", MOSAIC_ANDROID_SDK_VERSION)
                .apply { etag?.let { header("If-None-Match", it) } }
                .build()
            try {
                client.newCall(request).execute().use { response ->
                    when (response.code) {
                        304 -> MosaicCommerceConfigurationResponse.NotModified(
                            etag = response.header("ETag"),
                            configurationReleaseId =
                                response.header("Mosaic-Configuration-Release-Id"),
                        )
                        200 -> {
                            if (
                                response.header("Content-Type") !in setOf(
                                    MOSAIC_COMMERCE_CONFIGURATION_MEDIA_TYPE,
                                    MOSAIC_COMMERCE_CONFIGURATION_MEDIA_TYPE_V1,
                                )
                            ) {
                                MosaicCommerceConfigurationResponse.Failed(
                                    "The Commerce Configuration response Content-Type was invalid.",
                                )
                            } else {
                                response.body?.string()?.let {
                                    MosaicCommerceConfigurationResponse.Modified(
                                        payload = it,
                                        etag = response.header("ETag"),
                                        configurationReleaseId =
                                            response.header("Mosaic-Configuration-Release-Id"),
                                    )
                                } ?: MosaicCommerceConfigurationResponse.Failed(
                                    "The Commerce Configuration response was empty.",
                                )
                            }
                        }
                        else -> MosaicCommerceConfigurationResponse.Failed(
                            "Commerce Configuration request failed with HTTP ${response.code}.",
                        )
                    }
                }
            } catch (error: IOException) {
                MosaicCommerceConfigurationResponse.Failed(
                    error.message ?: "Commerce Configuration request failed.",
                )
            }
        }
}

enum class MosaicConfigurationSource { REMOTE, CACHE, BUNDLED_FALLBACK }

data class MosaicAcceptedConfiguration(
    val release: MosaicConfigurationRelease,
    val source: MosaicConfigurationSource,
    val etag: String,
    val commerceConfiguration: MosaicCommerceConfiguration? = null,
    val trustedTimeAnchor: MosaicTrustedTimeAnchor? = null,
)

data class MosaicTrustedTimeAnchor(
    val serverTimeEpochMillis: Long,
    val receiptWallTimeEpochMillis: Long,
    val receiptElapsedRealtimeMillis: Long,
) {
    fun nowEpochMillis(
        wallTimeEpochMillis: Long = System.currentTimeMillis(),
        elapsedRealtimeMillis: Long = mosaicElapsedRealtime(),
    ): Long? {
        val elapsed = elapsedRealtimeMillis - receiptElapsedRealtimeMillis
        if (elapsed !in 0..SEVEN_DAYS_MILLIS) return null
        val expectedWall = receiptWallTimeEpochMillis + elapsed
        if (kotlin.math.abs(wallTimeEpochMillis - expectedWall) > FIVE_MINUTES_MILLIS) return null
        return serverTimeEpochMillis + elapsed
    }

    private companion object {
        const val FIVE_MINUTES_MILLIS = 5 * 60 * 1000L
        const val SEVEN_DAYS_MILLIS = 7 * 24 * 60 * 60 * 1000L
    }
}

sealed interface MosaicConfigurationRefreshResult {
    data class Updated(val configuration: MosaicAcceptedConfiguration) : MosaicConfigurationRefreshResult
    data class NotModified(val configuration: MosaicAcceptedConfiguration) : MosaicConfigurationRefreshResult
    data class Retained(
        val configuration: MosaicAcceptedConfiguration,
        val diagnosticCode: String,
    ) : MosaicConfigurationRefreshResult
    data class Unavailable(val diagnosticCode: String) : MosaicConfigurationRefreshResult
}

sealed interface MosaicCommerceConfigurationRefreshResult {
    data class Updated(
        val configuration: MosaicCommerceConfiguration,
    ) : MosaicCommerceConfigurationRefreshResult
    data class NotModified(
        val configuration: MosaicCommerceConfiguration,
    ) : MosaicCommerceConfigurationRefreshResult
    data class Retained(
        val configuration: MosaicCommerceConfiguration,
        val diagnosticCode: String,
    ) : MosaicCommerceConfigurationRefreshResult
    data class Unavailable(val diagnosticCode: String) :
        MosaicCommerceConfigurationRefreshResult
}

sealed interface MosaicPlacementResult {
    data class Available(
        val document: MosaicPaywallDocument,
        val source: MosaicConfigurationSource,
        val releaseId: String?,
        val releaseNumber: Long?,
    ) : MosaicPlacementResult
    data class PlacementUnavailable(val key: String) : MosaicPlacementResult
    data object ConfigurationUnavailable : MosaicPlacementResult
}

sealed interface MosaicPlacementDecisionResult {
    data class Available(
        val document: MosaicPaywallDocument,
        val source: MosaicConfigurationSource,
        val releaseId: String?,
        val releaseNumber: Long?,
        val trace: MosaicDecisionTrace?,
        val matchedRuleId: String?,
        val fallbackPath: List<String>,
        val resolvedProducts: List<MosaicProduct>,
        val analytics: MosaicAnalyticsPresentationContext? = null,
    ) : MosaicPlacementDecisionResult
    data class NoPaywall(val trace: MosaicDecisionTrace, val matchedRuleId: String?) : MosaicPlacementDecisionResult
    data class PlacementUnavailable(val key: String) : MosaicPlacementDecisionResult
    data class EvaluationFailed(val diagnosticCode: String, val trace: MosaicDecisionTrace) : MosaicPlacementDecisionResult
    data object ConfigurationUnavailable : MosaicPlacementDecisionResult
}

object MosaicPlacementDecisionCapabilities {
    val features: List<String> = listOf(
        "condition.all", "condition.any", "condition.not",
        "operator.contains_all", "operator.contains_any", "operator.does_not_exist", "operator.equals",
        "operator.exists", "operator.greater_than", "operator.greater_than_or_equal", "operator.in",
        "operator.less_than", "operator.less_than_or_equal", "operator.locale_matches", "operator.not_equals", "operator.not_in",
        "outcome.fallback", "outcome.no_paywall", "outcome.paywall", "outcome.unavailable",
        "source.application.locale", "source.application.version", "source.context.country", "source.device.os_version",
        "source.device.platform", "source.entitlement_state", "source.environment.id", "source.environment.key",
        "source.identity.user_present", "source.product_availability", "source.product_readiness",
        "source.provider_capability", "source.user_attribute", "override.qa",
    ).sorted()
}

/** Serializes refreshes so an older response can never replace a newer accepted release. */
class MosaicHostedConfigurationClient(
    private val transport: MosaicConfigurationTransport,
    private val commerceTransport: MosaicCommerceConfigurationTransport? = null,
    private val cache: MosaicConfigurationCache,
    private val bundledFallback: MosaicPaywallDocumentSource? = null,
    private val capabilityReport: MosaicCapabilityReport = MosaicProtocolCapabilities.report(),
    private val applicationId: String? = null,
    private val configurablePurchaseProvider: MosaicConfigurablePurchaseProvider? = null,
    private val diagnostics: MosaicDiagnosticSink = MosaicDiagnosticSink.None,
    private val identityStore: MosaicIdentityStore? = null,
    private val purchaseProvider: MosaicPurchaseProvider? = null,
    private val applicationVersion: String? = null,
    internal val analyticsRuntime: MosaicAnalyticsRuntime? = null,
    private val experimentStore: MosaicExperimentAssignmentStore? = null,
    internal val transactionObservationRuntime: MosaicTransactionObservationRuntime? = null,
) {
    private val refreshLock = Mutex()
    @Volatile private var accepted: MosaicAcceptedConfiguration? = null
    private val identityMutationLock = Mutex()
    @Volatile private var qaOverrideTokens: Set<String> = emptySet()

    val acceptedConfiguration: MosaicAcceptedConfiguration?
        get() = accepted

    suspend fun refresh(): MosaicConfigurationRefreshResult = refreshLock.withLock {
        loadValidCache()
        val response = try {
            transport.fetch(accepted?.etag)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            return@withLock retainOrUnavailable(MosaicDiagnosticCode.CONFIGURATION_REFRESH_TRANSPORT_FAILED)
        }
        when (response) {
            is MosaicConfigurationResponse.Modified -> {
                val responseETag = response.etag
                if (!mosaicIsStrongETag(responseETag)) {
                    return@withLock retainOrUnavailable(MosaicDiagnosticCode.CONFIGURATION_REFRESH_ETAG_REJECTED)
                }
                val acceptedETag = requireNotNull(responseETag)
                val candidate = try {
                    MosaicConfigurationDeliveryDecoder.decode(response.payload, capabilityReport)
                } catch (_: RuntimeException) {
                    return@withLock retainOrUnavailable(MosaicDiagnosticCode.CONFIGURATION_REFRESH_RELEASE_REJECTED)
                }
                val current = accepted
                if (current != null && !candidate.belongsToSameEnvironmentAs(current.release)) {
                    return@withLock retainOrUnavailable(MosaicDiagnosticCode.CONFIGURATION_REFRESH_RELEASE_REJECTED)
                }
                if (current != null && candidate.number < current.release.number) {
                    return@withLock retainOrUnavailable(MosaicDiagnosticCode.CONFIGURATION_REFRESH_RELEASE_REJECTED)
                }
                val retainedCommerce = current?.commerceConfiguration?.takeIf {
                    it.configurationReleaseId == candidate.id &&
                        it.configurationReleaseDigest == candidate.contentDigest &&
                        it.environmentId == candidate.environment.id &&
                        it.productMappings.keys == candidate.productReferences.keys
                }
                val receiptWall = System.currentTimeMillis()
                val receiptElapsed = mosaicElapsedRealtime()
                val trustedAnchor = response.serverTimeEpochMillis?.let {
                    MosaicTrustedTimeAnchor(it, receiptWall, receiptElapsed)
                }
                try {
                    cache.write(
                        MosaicCachedConfiguration(
                            acceptedETag,
                            response.payload,
                            retainedCommerce?.encoded,
                            trustedAnchor?.serverTimeEpochMillis,
                            trustedAnchor?.receiptWallTimeEpochMillis,
                            trustedAnchor?.receiptElapsedRealtimeMillis,
                        ),
                    )
                } catch (error: CancellationException) {
                    throw error
                } catch (_: Exception) {
                    return@withLock retainOrUnavailable(MosaicDiagnosticCode.CONFIGURATION_CACHE_WRITE_FAILED)
                }
                val updated = MosaicAcceptedConfiguration(
                    release = candidate,
                    source = MosaicConfigurationSource.REMOTE,
                    etag = acceptedETag,
                    commerceConfiguration = retainedCommerce,
                    trustedTimeAnchor = trustedAnchor,
                )
                if (retainedCommerce == null) {
                    configurablePurchaseProvider?.clearConfiguration()
                } else {
                    configurablePurchaseProvider?.accept(retainedCommerce)
                }
                accepted = updated
                MosaicConfigurationRefreshResult.Updated(updated)
            }
            MosaicConfigurationResponse.NotModified -> {
                val current = accepted
                if (current == null) {
                    retainOrUnavailable(MosaicDiagnosticCode.CONFIGURATION_REFRESH_UNEXPECTED_NOT_MODIFIED)
                } else {
                    MosaicConfigurationRefreshResult.NotModified(current)
                }
            }
            is MosaicConfigurationResponse.Failed ->
                retainOrUnavailable(MosaicDiagnosticCode.CONFIGURATION_REFRESH_TRANSPORT_FAILED)
        }
    }

    suspend fun refreshCommerceConfiguration(): MosaicCommerceConfigurationRefreshResult =
        refreshLock.withLock {
            val release = loadValidCache()
                ?: return@withLock MosaicCommerceConfigurationRefreshResult.Unavailable(
                    MosaicDiagnosticCode.COMMERCE_CONFIGURATION_UNAVAILABLE.wireName,
                )
            val transport = commerceTransport
                ?: return@withLock retainCommerceOrUnavailable(
                    MosaicDiagnosticCode.COMMERCE_CONFIGURATION_UNAVAILABLE,
                )
            val response = try {
                transport.fetch(release.commerceConfiguration?.let { "\"${it.contentDigest}\"" })
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                return@withLock retainCommerceOrUnavailable(
                    MosaicDiagnosticCode.COMMERCE_PROVIDER_UNAVAILABLE,
                )
            }
            when (response) {
                is MosaicCommerceConfigurationResponse.NotModified -> {
                    val current = validRetainedCommercePair()
                    if (
                        current == null ||
                        response.etag != "\"${current.contentDigest}\"" ||
                        response.configurationReleaseId != current.configurationReleaseId
                    ) {
                        retainCommerceOrUnavailable(
                            MosaicDiagnosticCode.COMMERCE_CONFIGURATION_REJECTED,
                        )
                    } else {
                        MosaicCommerceConfigurationRefreshResult.NotModified(current)
                    }
                }
                is MosaicCommerceConfigurationResponse.Failed ->
                    retainCommerceOrUnavailable(
                        MosaicDiagnosticCode.COMMERCE_PROVIDER_UNAVAILABLE,
                    )
                is MosaicCommerceConfigurationResponse.Modified ->
                    acceptCommerceCandidate(
                        response.payload,
                        response.etag,
                        response.configurationReleaseId,
                        requireHostedHeaders = true,
                    )
            }
        }

    /** Accepts an equivalently verified SDK-local custom-provider snapshot. */
    suspend fun acceptCommerceConfiguration(
        payload: String,
    ): MosaicCommerceConfigurationRefreshResult = refreshLock.withLock {
        loadValidCache()
            ?: return@withLock MosaicCommerceConfigurationRefreshResult.Unavailable(
                MosaicDiagnosticCode.COMMERCE_CONFIGURATION_UNAVAILABLE.wireName,
            )
        acceptCommerceCandidate(payload, null, null, requireHostedHeaders = false)
    }

    suspend fun identityState(): MosaicIdentityState? = identityStore?.current()

    suspend fun identify(userId: String, attributes: Map<String, MosaicTypedValue> = emptyMap()): MosaicIdentityState =
        identityMutationLock.withLock {
        validateAttributes(attributes)
        val store = requireNotNull(identityStore) { "Identity persistence is unavailable for this client." }
        analyticsRuntime?.drainPendingRecords()
        val previous = store.current()
        store.identify(userId, attributes).also {
            if (previous.userId != it.userId) analyticsRuntime?.identityChanged()
        }
    }

    suspend fun setUserAttributes(attributes: Map<String, MosaicTypedValue>): MosaicIdentityState =
        identityMutationLock.withLock {
        validateAttributes(attributes)
        analyticsRuntime?.drainPendingRecords()
        requireNotNull(identityStore) { "Identity persistence is unavailable for this client." }.setAttributes(attributes)
    }

    suspend fun resetIdentity(): MosaicIdentityState = identityMutationLock.withLock {
        qaOverrideTokens = emptySet()
        val store = requireNotNull(identityStore) { "Identity persistence is unavailable for this client." }
        analyticsRuntime?.drainPendingRecords()
        val previous = store.current()
        previous.userId?.let { experimentStore?.clearSubject(MosaicAssignmentKeyType.IDENTIFIED_USER, it) }
        store.resetUser().also { if (previous.userId != null) analyticsRuntime?.identityChanged() }
    }

    suspend fun resetInstallationIdentity(): MosaicIdentityState = identityMutationLock.withLock {
        qaOverrideTokens = emptySet()
        analyticsRuntime?.drainPendingRecords()
        val store = requireNotNull(identityStore) { "Identity persistence is unavailable for this client." }
        val previous = store.current()
        experimentStore?.clearSubject(MosaicAssignmentKeyType.INSTALLATION, previous.installationId)
        previous.userId?.let { experimentStore?.clearSubject(MosaicAssignmentKeyType.IDENTIFIED_USER, it) }
        store.resetInstallation().also {
            analyticsRuntime?.identityChanged()
        }
    }

    /** Host consent may disable collection but cannot override a disabled server Environment. */
    suspend fun setAnalyticsCollectionEnabled(enabled: Boolean) {
        analyticsRuntime?.setHostEnabled(enabled)
    }

    /** Synchronizes the separately fetched owner-approved Environment analytics setting. */
    suspend fun setAnalyticsEnvironmentEnabled(enabled: Boolean) {
        analyticsRuntime?.setEnvironmentEnabled(enabled)
    }

    suspend fun flushAnalytics(): MosaicAnalyticsDiagnostics = analyticsRuntime?.flush()
        ?: MosaicAnalyticsDiagnostics(0, 0, 0, 0, 0, 0, "analytics.unavailable")

    suspend fun analyticsDiagnostics(): MosaicAnalyticsDiagnostics = analyticsRuntime?.diagnostics()
        ?: MosaicAnalyticsDiagnostics(0, 0, 0, 0, 0, 0, "analytics.unavailable")

    /**
     * Best-effort delivery of queued Transaction Observations. Calling it is never required: nothing
     * in a paywall, a purchase, or an Entitlement depends on an observation reaching Mosaic.
     */
    suspend fun flushTransactionObservations(): MosaicTransactionObservationDiagnostics =
        transactionObservationRuntime?.flush() ?: MOSAIC_TRANSACTION_OBSERVATIONS_UNAVAILABLE

    suspend fun transactionObservationDiagnostics(): MosaicTransactionObservationDiagnostics =
        transactionObservationRuntime?.diagnostics() ?: MOSAIC_TRANSACTION_OBSERVATIONS_UNAVAILABLE

    suspend fun experimentDiagnostics(): List<MosaicExperimentAssignmentRecord> =
        experimentStore?.diagnostics().orEmpty()

    /** Tokens are held in memory only and are cleared by either identity reset operation. */
    fun setQAOverrideTokens(tokens: Set<String>) {
        require(tokens.size <= 32 && tokens.all { it.length in 16..512 })
        qaOverrideTokens = tokens.toSet()
    }

    /** Stable Delivery-v1 Placement API retained for existing applications. */
    suspend fun paywall(placement: String, refresh: Boolean = false): MosaicPlacementResult =
        when (val decision = decidePlacement(placement, refresh)) {
            is MosaicPlacementDecisionResult.Available -> MosaicPlacementResult.Available(
                decision.document,
                decision.source,
                decision.releaseId,
                decision.releaseNumber,
            )
            is MosaicPlacementDecisionResult.NoPaywall,
            is MosaicPlacementDecisionResult.EvaluationFailed,
            -> MosaicPlacementResult.PlacementUnavailable(placement)
            is MosaicPlacementDecisionResult.PlacementUnavailable -> MosaicPlacementResult.PlacementUnavailable(decision.key)
            MosaicPlacementDecisionResult.ConfigurationUnavailable -> MosaicPlacementResult.ConfigurationUnavailable
        }

    /** Advanced typed decision API; evaluation is local and does not refresh unless requested. */
    suspend fun decidePlacement(
        placement: String,
        refresh: Boolean = false,
        country: String? = null,
    ): MosaicPlacementDecisionResult {
        val placementRequestId = mosaicAnalyticsId("placement_request")
        if (refresh) refresh() else loadValidCache()
        accepted?.let { configuration ->
            configuration.release.placementDecisions[placement]?.let { ruleSet ->
                val context = MosaicAnalyticsContext(
                    applicationVersion = applicationVersion,
                    configurationDeliveryVersion = configuration.release.deliveryVersion,
                    commerceProviderContractVersion = configuration.commerceConfiguration?.version,
                )
                val baseAttribution = MosaicAnalyticsAttribution(
                    configurationReleaseId = configuration.release.id,
                    placementId = ruleSet.placementId,
                    placementRuleSetId = ruleSet.id,
                    placementRuleSetVersion = ruleSet.version,
                )
                val journey = MosaicAnalyticsJourney(
                    MosaicAnalyticsCorrelation(placementRequestId = placementRequestId),
                    baseAttribution,
                    context,
                )
                analyticsRuntime?.record(MosaicAnalyticsPayload.PlacementRequested(), journey)
                return evaluateAdvanced(configuration, ruleSet, country, placementRequestId, context, baseAttribution)
            }
            val delivered = configuration.release.paywall(placement)
                ?: return MosaicPlacementDecisionResult.PlacementUnavailable(placement)
            return MosaicPlacementDecisionResult.Available(
                delivered.document,
                configuration.source,
                configuration.release.id,
                configuration.release.number,
                null,
                null,
                emptyList(),
                emptyList(),
            )
        }
        val fallbackSource = bundledFallback
        if (fallbackSource == null) {
            diagnose(
                MosaicDiagnosticCode.CONFIGURATION_BUNDLED_FALLBACK_MISSING,
                "No valid Mosaic configuration is available.",
            )
            return MosaicPlacementDecisionResult.ConfigurationUnavailable
        }
        val fallback = runCatching { fallbackSource.read() }
            .getOrNull()
            ?.let { runCatching { MosaicProtocolDecoder.decode(it, capabilityReport) }.getOrNull() }
        if (fallback == null) {
            diagnose(
                MosaicDiagnosticCode.CONFIGURATION_BUNDLED_FALLBACK_REJECTED,
                "No valid Mosaic configuration is available.",
            )
        }
        return fallback?.let { MosaicPlacementDecisionResult.Available(it, MosaicConfigurationSource.BUNDLED_FALLBACK, null, null, null, null, emptyList(), emptyList()) }
            ?: MosaicPlacementDecisionResult.ConfigurationUnavailable
    }

    private suspend fun evaluateAdvanced(
        configuration: MosaicAcceptedConfiguration,
        ruleSet: MosaicPlacementRuleSet,
        country: String?,
        placementRequestId: String,
        analyticsContext: MosaicAnalyticsContext,
        baseAttribution: MosaicAnalyticsAttribution,
    ): MosaicPlacementDecisionResult {
        val identity = identityStore?.current() ?: MosaicIdentityState("installation_unavailable", null, emptyMap(), 0)
        val assignment = when (ruleSet.assignmentPolicy) {
            MosaicAssignmentPolicy.INSTALLATION -> MosaicAssignmentKey(MosaicAssignmentKeyType.INSTALLATION, identity.installationId)
            MosaicAssignmentPolicy.IDENTIFIED_USER -> identity.userId?.let { MosaicAssignmentKey(MosaicAssignmentKeyType.IDENTIFIED_USER, it) }
            MosaicAssignmentPolicy.IDENTIFIED_USER_OR_INSTALLATION -> identity.userId?.let { MosaicAssignmentKey(MosaicAssignmentKeyType.IDENTIFIED_USER, it) }
                ?: MosaicAssignmentKey(MosaicAssignmentKeyType.INSTALLATION, identity.installationId)
        }
        val sources = ruleSet.rules.flatMap { it.conditions.sources() }
        val entitlementKeys = sources.filterIsInstance<MosaicDecisionSource.Entitlement>().map { it.key }.toSet()
        val productIds = (
            sources.filterIsInstance<MosaicDecisionSource.Product>().map { it.productId } +
                configuration.release.paywallVersions.values.flatMap { it.productReferenceIds }
            ).toSet()
        val provider = purchaseProvider
        val entitlementStates = if (entitlementKeys.isEmpty()) emptyMap() else when (val result = provider?.activeEntitlements()) {
            is MosaicActiveEntitlementsResult.Available -> entitlementKeys.associateWith { key ->
                val referenceId = configuration.release.entitlementReferences.values.first { it.key == key }.id
                if (result.entitlements.any { it.id == referenceId }) MosaicEntitlementState.ACTIVE else MosaicEntitlementState.INACTIVE
            }
            is MosaicActiveEntitlementsResult.ProviderUnavailable, null -> entitlementKeys.associateWith { MosaicEntitlementState.PROVIDER_UNAVAILABLE }
            is MosaicActiveEntitlementsResult.Failed -> entitlementKeys.associateWith { MosaicEntitlementState.FAILED }
            is MosaicActiveEntitlementsResult.Unknown -> entitlementKeys.associateWith { MosaicEntitlementState.UNKNOWN }
        }
        var resolvedProducts: List<MosaicProduct> = emptyList()
        val productStates = if (productIds.isEmpty()) emptyMap() else when (val result = provider?.loadProducts(productIds.sorted())) {
            is MosaicProductLoadResult.Loaded -> {
                resolvedProducts = result.products
                productIds.associateWith { id -> if (result.products.any { it.id == id } && id !in result.unavailableProductIds) MosaicProductAvailability.AVAILABLE else MosaicProductAvailability.UNAVAILABLE }
            }
            is MosaicProductLoadResult.Unavailable, null -> productIds.associateWith { MosaicProductAvailability.UNKNOWN }
        }
        val context = MosaicDecisionContext(
            applicationVersion = applicationVersion,
            country = country,
            userPresent = identity.userId != null,
            attributes = identity.attributes.filterKeys(ruleSet.attributeDefinitions::containsKey),
            entitlements = entitlementStates,
            products = productStates,
            productReadiness = configuration.release.productReferences.mapValues { it.value.readiness },
            providerCapabilities = if (provider == null) {
                emptyMap()
            } else {
                setOf("product_loading", "purchase", "restore", "entitlement_lookup")
                    .associateWith { MosaicProviderCapabilityState.AVAILABLE }
            },
        )
        return when (val result = MosaicPlacementEvaluator.evaluate(ruleSet, context, assignment, qaOverrideTokens)) {
            is MosaicEvaluationResult.NoPaywall -> {
                emitRuleFallbackIfExact(ruleSet, context, result.fallbackPath, result.matchedRuleId, "no_paywall", placementRequestId, analyticsContext, baseAttribution)
                val rollout = result.trace.rolloutTuple()
                analyticsRuntime?.record(
                    MosaicAnalyticsPayload.PlacementSelected(
                        finalOutcome = "no_paywall",
                        assignmentKeyType = rollout?.assignmentKeyType,
                        bucketingAlgorithm = rollout?.bucketingAlgorithm,
                        rolloutBucket = rollout?.rolloutBucket,
                    ),
                    MosaicAnalyticsJourney(
                        MosaicAnalyticsCorrelation(placementRequestId = placementRequestId),
                        baseAttribution.copy(winningRuleId = result.matchedRuleId),
                        analyticsContext,
                    ),
                )
                MosaicPlacementDecisionResult.NoPaywall(result.trace, result.matchedRuleId)
            }
            is MosaicEvaluationResult.Unavailable -> {
                emitRuleFallbackIfExact(ruleSet, context, result.fallbackPath, result.matchedRuleId, "unavailable", placementRequestId, analyticsContext, baseAttribution)
                analyticsRuntime?.record(
                    MosaicAnalyticsPayload.PlacementUnavailable("no_safe_decision", "decision.${result.reason}"),
                    MosaicAnalyticsJourney(MosaicAnalyticsCorrelation(placementRequestId = placementRequestId), baseAttribution, analyticsContext),
                )
                MosaicPlacementDecisionResult.EvaluationFailed("decision.${result.reason}", result.trace)
            }
            is MosaicEvaluationResult.Failed -> {
                emitRuleFallbackIfExact(ruleSet, context, result.fallbackPath, result.matchedRuleId, "unavailable", placementRequestId, analyticsContext, baseAttribution)
                analyticsRuntime?.record(
                    MosaicAnalyticsPayload.DiagnosticFailure("placement_evaluation_failed", result.diagnosticCode.analyticsSafeCode(), false),
                    MosaicAnalyticsJourney(MosaicAnalyticsCorrelation(placementRequestId = placementRequestId), baseAttribution, analyticsContext),
                )
                MosaicPlacementDecisionResult.EvaluationFailed(result.diagnosticCode, result.trace)
            }
            is MosaicEvaluationResult.Paywall -> {
                val delivered = configuration.release.paywallVersions[result.paywallVersionId]
                if (delivered == null) {
                    val fallbackKey = result.unavailableFallbackKey
                    if (fallbackKey == null) {
                        emitEvaluationFailed("decision.contentUnavailable", result.trace, placementRequestId, analyticsContext, baseAttribution)
                        return MosaicPlacementDecisionResult.EvaluationFailed("decision.contentUnavailable", result.trace)
                    }
                    return resolveUnavailableFallback(
                        configuration, ruleSet, fallbackKey, "content_unavailable", result,
                        resolvedProducts, productStates, placementRequestId, analyticsContext,
                        baseAttribution,
                    )
                }
                val requiredProducts = delivered.productReferenceIds
                val availability = requiredProducts.all { productStates[it] == MosaicProductAvailability.AVAILABLE }
                if (!availability && requiredProducts.isNotEmpty()) {
                    val fallbackKey = result.unavailableFallbackKey
                    if (fallbackKey == null) {
                        emitEvaluationFailed("decision.commerceUnavailable", result.trace, placementRequestId, analyticsContext, baseAttribution)
                        return MosaicPlacementDecisionResult.EvaluationFailed("decision.commerceUnavailable", result.trace)
                    }
                    return resolveUnavailableFallback(
                        configuration, ruleSet, fallbackKey, "commerce_unavailable", result,
                        resolvedProducts, productStates, placementRequestId, analyticsContext,
                        baseAttribution,
                    )
                }
                emitRuleFallbackIfExact(ruleSet, context, result.fallbackPath, result.matchedRuleId, "paywall", placementRequestId, analyticsContext, baseAttribution)
                availableExperimentOrNormal(
                    configuration, ruleSet, delivered, result.trace, result.matchedRuleId,
                    result.fallbackPath, resolvedProducts, requiredProducts, productStates,
                    identity, placementRequestId, analyticsContext, baseAttribution,
                )
            }
        }
    }

    private suspend fun availableExperimentOrNormal(
        configuration: MosaicAcceptedConfiguration,
        ruleSet: MosaicPlacementRuleSet,
        normalPaywall: MosaicDeliveredPaywall,
        trace: MosaicDecisionTrace,
        matchedRuleId: String?,
        fallbackPath: List<String>,
        resolvedProducts: List<MosaicProduct>,
        normalRequiredProducts: List<String>,
        productStates: Map<String, MosaicProductAvailability>,
        identity: MosaicIdentityState,
        placementRequestId: String,
        context: MosaicAnalyticsContext,
        baseAttribution: MosaicAnalyticsAttribution,
    ): MosaicPlacementDecisionResult.Available {
        val candidates = configuration.release.experimentAssignments.filter {
            it.placementId == ruleSet.placementId && it.controlPaywallVersionId == normalPaywall.id
        }
        if (candidates.isEmpty()) {
            return availableAnalyticsResult(
                configuration, normalPaywall, trace, matchedRuleId, fallbackPath, resolvedProducts,
                normalRequiredProducts, placementRequestId, context, baseAttribution,
            )
        }
        val candidateEvaluation = MosaicExperimentAssignmentEngine.evaluateCandidates(
            candidates, identity, configuration.trustedTimeAnchor?.nowEpochMillis(), qaOverrideTokens,
        )
        val evaluated = candidateEvaluation.assignment
        if (evaluated == null) {
            if ("time_unreliable" in candidateEvaluation.normalPlacementReasons) {
                diagnose(MosaicDiagnosticCode.EXPERIMENT_TIME_UNRELIABLE, "Experiment scheduling time is unavailable; normal Placement was used.")
            }
            return availableAnalyticsResult(
                configuration, normalPaywall, trace, matchedRuleId, fallbackPath, resolvedProducts,
                normalRequiredProducts, placementRequestId, context, baseAttribution,
            )
        }
        val assignment = evaluated.assignment
        val experimentAttribution = MosaicExperimentAttribution(
            assignment.experimentId, assignment.experimentVersionId, evaluated.variant.id, assignment.allocationVersion,
        )
        val attributed = baseAttribution.copy(
            experimentId = experimentAttribution.experimentId,
            experimentVersionId = experimentAttribution.experimentVersionId,
            experimentVariantId = experimentAttribution.experimentVariantId,
            experimentAllocationVersion = experimentAttribution.experimentAllocationVersion,
        )
        analyticsRuntime?.record(
            MosaicAnalyticsPayload.ExperimentAssigned(
                evaluated.assignmentKeyType.experimentWireName(), MOSAIC_EXPERIMENT_BUCKETING_ALGORITHM, evaluated.bucket,
                if (evaluated.qaOverride) "qa_override" else "deterministic",
            ),
            MosaicAnalyticsJourney(MosaicAnalyticsCorrelation(placementRequestId = placementRequestId), attributed, context),
        )
        val identityValue = if (evaluated.assignmentKeyType == MosaicAssignmentKeyType.IDENTIFIED_USER) {
            requireNotNull(identity.userId)
        } else identity.installationId
        runCatching { experimentStore?.record(evaluated, identityValue, System.currentTimeMillis()) }

        val variantPaywall = configuration.release.paywallVersions.getValue(evaluated.variant.paywallVersionId)
        val requiredProducts = evaluated.variant.compatibility.requiredProductIds
        val productsReady = requiredProducts.all {
            configuration.release.productReferences[it]?.readiness == MosaicProductReadiness.READY &&
                productStates[it] == MosaicProductAvailability.AVAILABLE
        }
        val acceptedCapabilities = (purchaseProvider as? MosaicExperimentCommerceCapabilityProvider)
            ?.mosaicExperimentCapabilities.orEmpty()
        val providerReady = acceptedCapabilities.containsAll(evaluated.variant.compatibility.requiredProviderCapabilities)
        val failure = when {
            !productsReady -> "product_unavailable"
            !providerReady -> "provider_unavailable"
            else -> null
        }
        val selectedPaywall = if (failure == null) variantPaywall else normalPaywall
        val selectedProducts = if (failure == null) requiredProducts.toList() else normalRequiredProducts
        val presentation = MosaicExperimentPresentationContext(
            experimentAttribution, evaluated.assignmentKeyType.experimentWireName(), MOSAIC_EXPERIMENT_BUCKETING_ALGORITHM,
            evaluated.qaOverride,
            if (failure == null) MosaicExperimentPresentationKind.VARIANT else MosaicExperimentPresentationKind.FALLBACK,
            failure, selectedPaywall.paywallId, selectedPaywall.id,
            MosaicExperimentAssignmentStore.subjectDigest(identityValue),
        )
        if (failure != null) {
            diagnose(MosaicDiagnosticCode.EXPERIMENT_VARIANT_UNAVAILABLE, "Experiment Variant readiness failed; normal Placement was used.")
        }
        return availableAnalyticsResult(
            configuration, selectedPaywall, trace, matchedRuleId, fallbackPath, resolvedProducts,
            selectedProducts, placementRequestId, context, attributed, presentation,
        )
    }

    private fun resolveUnavailableFallback(
        configuration: MosaicAcceptedConfiguration,
        ruleSet: MosaicPlacementRuleSet,
        fallbackKey: String,
        trigger: String,
        original: MosaicEvaluationResult.Paywall,
        resolvedProducts: List<MosaicProduct>,
        productStates: Map<String, MosaicProductAvailability>,
        placementRequestId: String,
        context: MosaicAnalyticsContext,
        baseAttribution: MosaicAnalyticsAttribution,
        uses: List<Pair<String, String>> = listOf(trigger to fallbackKey),
    ): MosaicPlacementDecisionResult = when (val fallback = MosaicPlacementEvaluator.evaluateFallback(ruleSet, fallbackKey)) {
        is MosaicEvaluationResult.Paywall -> {
            val fallbackPaywall = configuration.release.paywallVersions[fallback.paywallVersionId]
            val unavailableTrigger = if (fallbackPaywall == null) {
                "content_unavailable"
            } else if (!fallbackPaywall.productReferenceIds.all { productStates[it] == MosaicProductAvailability.AVAILABLE }) {
                "commerce_unavailable"
            } else {
                null
            }
            if (unavailableTrigger == null) {
                requireNotNull(fallbackPaywall)
                emitFallbackUses(uses, "paywall", original.matchedRuleId, placementRequestId, context, baseAttribution)
                availableAnalyticsResult(
                    configuration, fallbackPaywall, fallback.trace, original.matchedRuleId,
                    original.fallbackPath + fallback.fallbackPath, resolvedProducts,
                    fallbackPaywall.productReferenceIds, placementRequestId, context,
                    baseAttribution,
                )
            } else if (fallback.unavailableFallbackKey != null && uses.none { it.second == fallback.unavailableFallbackKey }) {
                resolveUnavailableFallback(
                    configuration, ruleSet, fallback.unavailableFallbackKey, unavailableTrigger,
                    original, resolvedProducts, productStates, placementRequestId, context,
                    baseAttribution, uses + (unavailableTrigger to fallback.unavailableFallbackKey),
                )
            } else {
                val code = if (unavailableTrigger == "content_unavailable") "decision.contentUnavailable" else "decision.commerceUnavailable"
                emitFallbackUses(uses, "unavailable", original.matchedRuleId, placementRequestId, context, baseAttribution)
                emitEvaluationFailed(code, fallback.trace, placementRequestId, context, baseAttribution)
                MosaicPlacementDecisionResult.EvaluationFailed(code, fallback.trace)
            }
        }
        is MosaicEvaluationResult.NoPaywall -> {
            emitFallbackUses(uses, "no_paywall", original.matchedRuleId, placementRequestId, context, baseAttribution)
            val rollout = original.trace.rolloutTuple()
            analyticsRuntime?.record(
                MosaicAnalyticsPayload.PlacementSelected(
                    finalOutcome = "no_paywall",
                    assignmentKeyType = rollout?.assignmentKeyType,
                    bucketingAlgorithm = rollout?.bucketingAlgorithm,
                    rolloutBucket = rollout?.rolloutBucket,
                ),
                MosaicAnalyticsJourney(
                    MosaicAnalyticsCorrelation(placementRequestId = placementRequestId),
                    baseAttribution.copy(winningRuleId = original.matchedRuleId),
                    context,
                ),
            )
            MosaicPlacementDecisionResult.NoPaywall(fallback.trace, original.matchedRuleId)
        }
        is MosaicEvaluationResult.Unavailable -> {
            emitFallbackUses(uses, "unavailable", original.matchedRuleId, placementRequestId, context, baseAttribution)
            analyticsRuntime?.record(
                MosaicAnalyticsPayload.PlacementUnavailable("no_safe_decision", "decision.${fallback.reason}"),
                MosaicAnalyticsJourney(MosaicAnalyticsCorrelation(placementRequestId = placementRequestId), baseAttribution, context),
            )
            MosaicPlacementDecisionResult.EvaluationFailed("decision.${fallback.reason}", fallback.trace)
        }
        is MosaicEvaluationResult.Failed -> {
            emitFallbackUses(uses, "unavailable", original.matchedRuleId, placementRequestId, context, baseAttribution)
            emitEvaluationFailed(fallback.diagnosticCode, fallback.trace, placementRequestId, context, baseAttribution)
            MosaicPlacementDecisionResult.EvaluationFailed(fallback.diagnosticCode, fallback.trace)
        }
    }

    private fun emitFallbackUses(
        uses: List<Pair<String, String>>,
        finalOutcome: String,
        matchedRuleId: String?,
        placementRequestId: String,
        context: MosaicAnalyticsContext,
        attribution: MosaicAnalyticsAttribution,
    ) {
        uses.forEach { (trigger, fallbackKey) ->
            emitFallback(trigger, fallbackKey, finalOutcome, matchedRuleId, placementRequestId, context, attribution)
        }
    }

    private fun emitRuleFallbackIfExact(
        ruleSet: MosaicPlacementRuleSet,
        decisionContext: MosaicDecisionContext,
        fallbackPath: List<String>,
        matchedRuleId: String?,
        finalOutcome: String,
        placementRequestId: String,
        context: MosaicAnalyticsContext,
        attribution: MosaicAnalyticsAttribution,
    ) {
        val fallbackKey = fallbackPath.firstOrNull() ?: return
        val trigger = MosaicPlacementEvaluator.exactFallbackTrigger(ruleSet, matchedRuleId, decisionContext) ?: return
        emitFallback(trigger, fallbackKey, finalOutcome, matchedRuleId, placementRequestId, context, attribution)
    }

    private fun emitFallback(
        trigger: String,
        fallbackKey: String,
        finalOutcome: String,
        matchedRuleId: String?,
        placementRequestId: String,
        context: MosaicAnalyticsContext,
        attribution: MosaicAnalyticsAttribution,
    ) {
        analyticsRuntime?.record(
            MosaicAnalyticsPayload.PlacementFallback(trigger, fallbackKey, finalOutcome),
            MosaicAnalyticsJourney(
                MosaicAnalyticsCorrelation(placementRequestId = placementRequestId),
                attribution.copy(winningRuleId = matchedRuleId),
                context,
            ),
        )
    }

    private fun emitEvaluationFailed(
        code: String,
        trace: MosaicDecisionTrace,
        placementRequestId: String,
        context: MosaicAnalyticsContext,
        attribution: MosaicAnalyticsAttribution,
    ) {
        analyticsRuntime?.record(
            MosaicAnalyticsPayload.DiagnosticFailure("placement_evaluation_failed", code.analyticsSafeCode(), false),
            MosaicAnalyticsJourney(
                MosaicAnalyticsCorrelation(placementRequestId = placementRequestId),
                attribution.copy(
                    experimentId = null, experimentVersionId = null,
                    experimentVariantId = null, experimentAllocationVersion = null,
                ),
                context,
            ),
        )
    }

    private fun availableAnalyticsResult(
        configuration: MosaicAcceptedConfiguration,
        delivered: MosaicDeliveredPaywall,
        trace: MosaicDecisionTrace,
        matchedRuleId: String?,
        fallbackPath: List<String>,
        resolvedProducts: List<MosaicProduct>,
        requiredProducts: List<String>,
        placementRequestId: String,
        context: MosaicAnalyticsContext,
        baseAttribution: MosaicAnalyticsAttribution,
        experimentPresentation: MosaicExperimentPresentationContext? = null,
    ): MosaicPlacementDecisionResult.Available {
        val presentationId = mosaicAnalyticsId("presentation")
        val attribution = baseAttribution.copy(
            winningRuleId = matchedRuleId,
            paywallId = delivered.paywallId,
            paywallVersionId = delivered.id,
        )
        val rollout = trace.rolloutTuple()
        analyticsRuntime?.record(
            MosaicAnalyticsPayload.PlacementSelected(
                finalOutcome = "paywall",
                assignmentKeyType = rollout?.assignmentKeyType,
                bucketingAlgorithm = rollout?.bucketingAlgorithm,
                rolloutBucket = rollout?.rolloutBucket,
            ),
            MosaicAnalyticsJourney(
                MosaicAnalyticsCorrelation(placementRequestId = placementRequestId),
                attribution.copy(
                    experimentId = null, experimentVersionId = null,
                    experimentVariantId = null, experimentAllocationVersion = null,
                ),
                context,
            ),
        )
        return MosaicPlacementDecisionResult.Available(
            delivered.document, configuration.source, configuration.release.id, configuration.release.number,
            trace, matchedRuleId, fallbackPath, resolvedProducts.filter { it.id in requiredProducts },
            analyticsRuntime?.let {
                MosaicAnalyticsPresentationContext(
                    placementRequestId, presentationId, context, attribution, experimentPresentation,
                    experimentPresentation?.assignmentSubjectDigest?.let { digest ->
                        {
                            experimentStore?.markExposedBestEffort(
                                experimentPresentation.attribution,
                                experimentPresentation.assignmentKeyType,
                                digest,
                                System.currentTimeMillis(),
                            )
                        }
                    },
                )
            },
        )
    }

    /**
     * The rollout tuple is all-or-none by contract: `assignmentKeyType`, `bucketingAlgorithm`, and
     * `rolloutBucket` are emitted together or not at all. Deriving them from one trace step in a
     * single place makes a partial tuple structurally impossible; a partial tuple would otherwise be
     * rejected by the codec and the whole event silently dropped.
     */
    private data class MosaicRolloutTuple(
        val assignmentKeyType: String,
        val bucketingAlgorithm: String,
        val rolloutBucket: Int,
    )

    private fun MosaicDecisionTrace.rolloutTuple(): MosaicRolloutTuple? {
        val step = steps.lastOrNull { it.rolloutBucket != null && it.assignmentKeyType != null }
            ?: return null
        return MosaicRolloutTuple(
            assignmentKeyType = requireNotNull(step.assignmentKeyType).analyticsWireName(),
            bucketingAlgorithm = MOSAIC_ROLLOUT_ALGORITHM,
            rolloutBucket = requireNotNull(step.rolloutBucket),
        )
    }

    private fun validateAttributes(attributes: Map<String, MosaicTypedValue>) {
        val definitions = accepted?.release?.placementDecisions?.values.orEmpty().flatMap { it.attributeDefinitions.values }.associateBy { it.key }
        require(attributes.keys.all { it in definitions }) { "Attributes must be allow-listed by the accepted release." }
        attributes.forEach { (key, value) ->
            val expected = definitions.getValue(key).type
            val actual = when (value) { is MosaicTypedValue.StringValue -> "string"; is MosaicTypedValue.BooleanValue -> "boolean"; is MosaicTypedValue.NumberValue -> "number"; is MosaicTypedValue.TimestampValue -> "timestamp"; is MosaicTypedValue.SemanticVersionValue -> "semantic_version"; is MosaicTypedValue.StringListValue -> "string_list" }
            require(actual == expected) { "Attribute $key has the wrong type." }
        }
    }

    private suspend fun loadValidCache(): MosaicAcceptedConfiguration? {
        accepted?.let { return it }
        val cached = try {
            cache.read()
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            diagnose(
                MosaicDiagnosticCode.CONFIGURATION_CACHE_REJECTED,
                "The cached Mosaic configuration was unavailable or invalid.",
            )
            return null
        } ?: return null
        val cachedETag = cached.etag
        if (!mosaicIsStrongETag(cachedETag)) {
            diagnose(
                MosaicDiagnosticCode.CONFIGURATION_CACHE_REJECTED,
                "The cached Mosaic configuration was unavailable or invalid.",
            )
            return null
        }
        val acceptedETag = requireNotNull(cachedETag)
        val release = try {
            MosaicConfigurationDeliveryDecoder.decode(cached.payload, capabilityReport)
        } catch (_: RuntimeException) {
            diagnose(
                MosaicDiagnosticCode.CONFIGURATION_CACHE_REJECTED,
                "The cached Mosaic configuration was unavailable or invalid.",
            )
            return null
        }
        val commerce = cached.commercePayload?.let { payload ->
            val appId = applicationId ?: return@let null
            runCatching {
                MosaicCommerceConfigurationDecoder.decode(payload, release, appId)
            }.getOrNull()
        }
        if (cached.commercePayload != null && commerce == null) {
            diagnose(
                MosaicDiagnosticCode.COMMERCE_CONFIGURATION_REJECTED,
                "The cached Commerce Configuration was unavailable or invalid.",
            )
        }
        return MosaicAcceptedConfiguration(
            release,
            MosaicConfigurationSource.CACHE,
            acceptedETag,
            commerce,
            if (
                cached.trustedServerTimeEpochMillis != null &&
                cached.trustedReceiptWallTimeEpochMillis != null &&
                cached.trustedReceiptElapsedRealtimeMillis != null
            ) MosaicTrustedTimeAnchor(
                cached.trustedServerTimeEpochMillis,
                cached.trustedReceiptWallTimeEpochMillis,
                cached.trustedReceiptElapsedRealtimeMillis,
            ) else null,
        ).also {
            if (commerce == null) {
                configurablePurchaseProvider?.clearConfiguration()
            } else {
                configurablePurchaseProvider?.accept(commerce)
            }
            accepted = it
        }
    }

    private suspend fun acceptCommerceCandidate(
        payload: String,
        etag: String?,
        releaseHeader: String?,
        requireHostedHeaders: Boolean,
    ): MosaicCommerceConfigurationRefreshResult {
        val current = accepted
            ?: return MosaicCommerceConfigurationRefreshResult.Unavailable(
                MosaicDiagnosticCode.COMMERCE_CONFIGURATION_UNAVAILABLE.wireName,
            )
        val appId = applicationId
            ?: return retainCommerceOrUnavailable(
                MosaicDiagnosticCode.COMMERCE_CONFIGURATION_UNAVAILABLE,
            )
        val candidate = try {
            MosaicCommerceConfigurationDecoder.decode(payload, current.release, appId)
        } catch (_: RuntimeException) {
            return retainCommerceOrUnavailable(
                MosaicDiagnosticCode.COMMERCE_CONFIGURATION_REJECTED,
            )
        }
        if (
            (requireHostedHeaders && releaseHeader == null) ||
            (releaseHeader != null && releaseHeader != candidate.configurationReleaseId)
        ) {
            return retainCommerceOrUnavailable(
                MosaicDiagnosticCode.COMMERCE_CONFIGURATION_REJECTED,
            )
        }
        if (
            (requireHostedHeaders && etag == null) ||
            (
                etag != null &&
                    (!mosaicIsStrongETag(etag) || etag != "\"${candidate.contentDigest}\"")
            )
        ) {
            return retainCommerceOrUnavailable(
                MosaicDiagnosticCode.COMMERCE_CONFIGURATION_REJECTED,
            )
        }
        try {
            cache.write(
                MosaicCachedConfiguration(
                    current.etag,
                    current.release.encoded,
                    payload,
                    current.trustedTimeAnchor?.serverTimeEpochMillis,
                    current.trustedTimeAnchor?.receiptWallTimeEpochMillis,
                    current.trustedTimeAnchor?.receiptElapsedRealtimeMillis,
                ),
            )
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            return retainCommerceOrUnavailable(
                MosaicDiagnosticCode.COMMERCE_CONFIGURATION_CACHE_WRITE_FAILED,
            )
        }
        configurablePurchaseProvider?.accept(candidate)
        accepted = current.copy(commerceConfiguration = candidate)
        return MosaicCommerceConfigurationRefreshResult.Updated(candidate)
    }

    private fun validRetainedCommercePair(): MosaicCommerceConfiguration? {
        val current = accepted ?: return null
        val commerce = current.commerceConfiguration ?: return null
        val appId = applicationId ?: return null
        return commerce.takeIf {
            it.applicationId == appId &&
                it.environmentId == current.release.environment.id &&
                it.configurationReleaseId == current.release.id &&
                it.configurationReleaseDigest == current.release.contentDigest &&
                it.productMappings.keys == current.release.productReferences.keys &&
                mosaicIsStrongETag("\"${it.contentDigest}\"")
        }
    }

    private fun retainCommerceOrUnavailable(
        code: MosaicDiagnosticCode,
    ): MosaicCommerceConfigurationRefreshResult {
        diagnose(code, "The last accepted Commerce Configuration was preserved.")
        val current = accepted?.commerceConfiguration
        return if (current == null) {
            MosaicCommerceConfigurationRefreshResult.Unavailable(code.wireName)
        } else {
            MosaicCommerceConfigurationRefreshResult.Retained(current, code.wireName)
        }
    }

    private fun retainOrUnavailable(code: MosaicDiagnosticCode): MosaicConfigurationRefreshResult {
        val current = accepted
        diagnose(code, "The last accepted Mosaic configuration was preserved.")
        return if (current == null) {
            MosaicConfigurationRefreshResult.Unavailable(code.wireName)
        } else {
            MosaicConfigurationRefreshResult.Retained(current, code.wireName)
        }
    }

    private fun diagnose(code: MosaicDiagnosticCode, message: String) {
        diagnostics.record(MosaicDiagnostic(code, message))
    }
}

internal fun mosaicConfigurationCacheNamespace(configuration: MosaicConfiguration): String {
    val identity =
        "${configuration.configurationURL()}\n${configuration.apiKey.trim()}\n${configuration.applicationId.orEmpty()}"
    return MessageDigest.getInstance("SHA-256")
        .digest(identity.toByteArray(Charsets.UTF_8))
        .joinToString(separator = "") { byte -> "%02x".format(byte.toInt() and 0xff) }
}

internal fun mosaicIsStrongETag(value: String?): Boolean =
    value != null &&
        value.length >= 2 &&
        value.first() == '"' &&
        value.last() == '"' &&
        !value.startsWith("W/") &&
        value.drop(1).dropLast(1).all { character ->
            character == '\u0021' ||
                character in '\u0023'..'\u007e' ||
                character.code in 0x80..0xff
        }

private fun MosaicConfigurationRelease.belongsToSameEnvironmentAs(other: MosaicConfigurationRelease): Boolean =
    environment.id == other.environment.id && environment.key == other.environment.key

private fun MosaicCapabilityReport.configurationDeliveryCapabilitiesHeader(): String =
    supportedCapabilityVersions
        .sortedWith(compareBy({ it.name.wireName }, { it.version }))
        .joinToString(separator = ",") { capability ->
            "${capability.name.wireName}@${capability.version}"
        }

private fun MosaicConfiguration.configurationURL(): URI {
    val base = endpoint ?: URI("https://api.mosaic.dev")
    val normalized = base.toString().trimEnd('/')
    return URI("$normalized/v1/sdk/configuration")
}

private fun MosaicConfiguration.commerceConfigurationURL(): String {
    val base = endpoint ?: URI("https://api.mosaic.dev")
    val normalized = base.toString().trimEnd('/')
    return "$normalized/v1/sdk/commerce-configuration".toHttpUrl()
        .newBuilder()
        .addQueryParameter("applicationId", requireNotNull(applicationId))
        .build()
        .toString()
}

private fun MosaicConditionNode.sources(): List<MosaicDecisionSource> = when (this) {
    is MosaicConditionNode.Condition -> listOf(source)
    is MosaicConditionNode.All -> children.flatMap { it.sources() }
    is MosaicConditionNode.Any -> children.flatMap { it.sources() }
    is MosaicConditionNode.Not -> child.sources()
}

private fun MosaicAssignmentKeyType.analyticsWireName(): String = when (this) {
    MosaicAssignmentKeyType.INSTALLATION -> "installation"
    MosaicAssignmentKeyType.IDENTIFIED_USER -> "identified_user"
}

private fun String.analyticsSafeCode(): String = lowercase()
    .replace(Regex("[^a-z0-9._-]+"), "_")
    .let { if (it.contains('.') || it.contains('_') || it.contains('-')) it else "analytics.$it" }
    .take(96)
