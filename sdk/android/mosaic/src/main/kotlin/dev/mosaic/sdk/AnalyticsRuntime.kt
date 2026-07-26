package dev.mosaic.sdk

import android.app.Activity
import android.app.Application
import android.os.Bundle
import java.util.concurrent.ConcurrentHashMap
import kotlin.random.Random
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal data class MosaicAnalyticsJourney(
    val correlation: MosaicAnalyticsCorrelation = MosaicAnalyticsCorrelation(),
    val attribution: MosaicAnalyticsAttribution = MosaicAnalyticsAttribution(),
    val context: MosaicAnalyticsContext? = null,
)

class MosaicAnalyticsRuntime internal constructor(
    private val identityStore: MosaicIdentityStore,
    private val queue: MosaicAnalyticsQueue,
    private val transport: MosaicAnalyticsTransport,
    private val baseContext: MosaicAnalyticsContext,
    environmentEnabled: Boolean,
    private val now: () -> Long = System::currentTimeMillis,
    private val jitter: (Long) -> Long = { cap -> if (cap <= 0) 0 else Random.nextLong(cap + 1) },
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(1))
    private val flushLock = Mutex()
    private val collectionLock = Mutex()
    @Volatile private var environmentEnabled = environmentEnabled
    @Volatile private var hostEnabled = true

    val isCollectionEnabled: Boolean get() = environmentEnabled && hostEnabled

    internal fun record(
        payload: MosaicAnalyticsPayload,
        journey: MosaicAnalyticsJourney,
        occurredAtMillis: Long = now(),
    ) {
        if (!isCollectionEnabled || !mosaicPublicRuntimeAccepts(payload)) return
        scope.launch {
            collectionLock.withLock {
                if (!isCollectionEnabled) return@withLock
                runCatching {
                    val identity = identityStore.current()
                    val session = queue.session()
                    val queuedAt = now()
                    val context = journey.context ?: baseContext
                    val event = MosaicAnalyticsEvent(
                        eventId = mosaicAnalyticsId("event"),
                        eventSchemaVersion = "1",
                        eventName = payload.eventName,
                        occurredAt = mosaicAnalyticsTimestamp(occurredAtMillis),
                        queuedAt = mosaicAnalyticsTimestamp(queuedAt),
                        authority = "client_observed",
                        identity = MosaicAnalyticsIdentity(identity.installationId, identity.userId, identity.generation),
                        sessionId = session,
                        context = context,
                        correlation = journey.correlation,
                        attribution = journey.attribution,
                        payload = payload,
                    )
                    // The codec is also the final public-SDK authority/closed-shape guard.
                    require(event.authority == "client_observed" && event.eventName != "purchase_completed_provider")
                    MosaicAnalyticsCodec.decodeEvent(MosaicAnalyticsCodec.encodeEvent(event))
                    queue.enqueue(event)
                }
            }
        }
    }

    suspend fun setEnvironmentEnabled(enabled: Boolean) {
        collectionLock.withLock {
            val changed = environmentEnabled != enabled
            environmentEnabled = enabled
            if (!enabled) { transport.cancel(); queue.clear() }
            else if (changed && hostEnabled) queue.beginNewSession()
        }
    }

    suspend fun setHostEnabled(enabled: Boolean) {
        collectionLock.withLock {
            val changed = hostEnabled != enabled
            hostEnabled = enabled
            if (!enabled) { transport.cancel(); queue.clear() }
            else if (changed && environmentEnabled) queue.beginNewSession()
        }
    }

    suspend fun identityChanged() = queue.beginNewSession()

    suspend fun flush(): MosaicAnalyticsDiagnostics = flushLock.withLock {
        if (!isCollectionEnabled) return@withLock queue.diagnostics()
        val sent = queue.ready(limit = 50, maxBytes = 500 * 1024)
        if (sent.isEmpty()) return@withLock queue.diagnostics()
        val batch = MosaicAnalyticsBatch(
            batchId = mosaicAnalyticsId("batch"),
            sentAt = mosaicAnalyticsTimestamp(now()),
            events = sent.map { MosaicAnalyticsCodec.decodeEvent(it.encoded) },
        )
        when (val result = runCatching { transport.send(batch) }.getOrNull()) {
            is MosaicAnalyticsTransportResult.Received -> queue.applyResults(
                sent,
                result.response.takeIf { it.batchId == batch.batchId },
                null,
                jitter,
            )
            is MosaicAnalyticsTransportResult.Retryable -> queue.applyResults(sent, null, result.retryAfterMillis, jitter)
            null -> queue.applyResults(sent, null, null, jitter)
        }
        queue.diagnostics()
    }

    suspend fun diagnostics(): MosaicAnalyticsDiagnostics = queue.diagnostics()
    /** Orders identity mutations after every event already observed by this runtime. */
    internal suspend fun drainPendingRecords() {
        scope.launch { }.join()
    }
    fun flushBestEffort() { if (isCollectionEnabled) scope.launch { flush() } }
    fun close() { scope.cancel() }
}

internal fun mosaicPublicRuntimeAccepts(payload: MosaicAnalyticsPayload): Boolean =
    payload !is MosaicAnalyticsPayload.ProviderCompleted

internal object MosaicAnalyticsRuntimeRegistry {
    private val runtimes = ConcurrentHashMap<String, MosaicAnalyticsRuntime>()
    private val lifecycles = ConcurrentHashMap<String, MosaicAnalyticsLifecycle>()

    fun runtime(
        application: Application,
        namespace: String,
        configuration: MosaicConfiguration,
        identityStore: MosaicIdentityStore,
    ): MosaicAnalyticsRuntime = runtimes.getOrPut(namespace) {
        MosaicAnalyticsRuntime(
            identityStore = identityStore,
            queue = MosaicAnalyticsQueue(MosaicFileAnalyticsStore(application, namespace), System::currentTimeMillis),
            transport = MosaicHTTPAnalyticsTransport(configuration),
            baseContext = MosaicAnalyticsContext(applicationVersion = configuration.applicationVersion),
            environmentEnabled = configuration.analyticsCollectionEnabled,
        ).also { runtime ->
            lifecycles[namespace] = MosaicAnalyticsLifecycle(application, runtime)
        }
    }
}

/** Application-process lifecycle only; background delivery remains explicitly best effort. */
private class MosaicAnalyticsLifecycle(
    private val application: Application,
    private val runtime: MosaicAnalyticsRuntime,
) : Application.ActivityLifecycleCallbacks {
    private var started = 0
    init { application.registerActivityLifecycleCallbacks(this) }
    override fun onActivityStarted(activity: Activity) { started += 1; if (started == 1) runtime.flushBestEffort() }
    override fun onActivityStopped(activity: Activity) { started = (started - 1).coerceAtLeast(0); if (started == 0) runtime.flushBestEffort() }
    override fun onActivityCreated(activity: Activity, state: Bundle?) = Unit
    override fun onActivityResumed(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit
}
