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

/** The runtime only needs an identity snapshot, so it does not depend on the file-backed store. */
internal fun interface MosaicIdentitySnapshotSource {
    suspend fun current(): MosaicIdentityState
}

class MosaicAnalyticsRuntime internal constructor(
    private val identityStore: MosaicIdentitySnapshotSource,
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
                        eventSchemaVersion = if (
                            payload.isExperimentV2() || journey.attribution.hasExperimentTuple() ||
                            journey.context?.configurationDeliveryVersion == "3"
                        ) "2" else "1",
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

    /**
     * Applies a changed owner-approved Environment flag to an already-constructed runtime. It is
     * ordered on the same single-parallelism scope as [record], so it cannot block the caller and
     * cannot interleave with an event already accepted for enqueueing.
     */
    internal fun reconcileEnvironmentEnabled(enabled: Boolean) {
        if (environmentEnabled == enabled) return
        scope.launch { runCatching { setEnvironmentEnabled(enabled) } }
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
        val ready = queue.ready(limit = 50, maxBytes = 500 * 1024)
        if (ready.isEmpty()) return@withLock queue.diagnostics()
        val firstVersion = MosaicAnalyticsCodec.decodeEvent(ready.first().encoded).eventSchemaVersion
        val sent = ready.takeWhile { MosaicAnalyticsCodec.decodeEvent(it.encoded).eventSchemaVersion == firstVersion }
        val batch = MosaicAnalyticsBatch(
            batchId = mosaicAnalyticsId("batch"),
            sentAt = mosaicAnalyticsTimestamp(now()),
            events = sent.map { MosaicAnalyticsCodec.decodeEvent(it.encoded) },
        )
        val batchContractVersion = firstVersion
        when (val result = runCatching { transport.send(batch) }.getOrNull()) {
            // A response is authoritative only when it echoes both the exact batch ID and the
            // exact contract version that was submitted. A version mismatch means the server did
            // not acknowledge the batch that was actually sent, so the events are retried rather
            // than removed on the strength of an unrelated acknowledgement.
            is MosaicAnalyticsTransportResult.Received -> queue.applyResults(
                sent,
                result.response.takeIf {
                    it.batchId == batch.batchId && it.analyticsEventContractVersion == batchContractVersion
                },
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

    /**
     * A namespace keeps one runtime per process. A later handle for the same namespace may carry a
     * different owner-approved `analyticsCollectionEnabled` value — for example after the host
     * reconfigures Mosaic once the Environment setting has been fetched. Returning the existing
     * runtime unchanged would silently keep the stale flag, so the retrieved runtime reconciles it.
     */
    fun runtime(
        application: Application,
        namespace: String,
        configuration: MosaicConfiguration,
        identityStore: MosaicIdentityStore,
    ): MosaicAnalyticsRuntime = runtimes.getOrPut(namespace) {
        MosaicAnalyticsRuntime(
            identityStore = MosaicIdentitySnapshotSource { identityStore.current() },
            queue = MosaicAnalyticsQueue(MosaicFileAnalyticsStore(application, namespace), System::currentTimeMillis),
            transport = MosaicHTTPAnalyticsTransport(configuration),
            baseContext = MosaicAnalyticsContext(applicationVersion = configuration.applicationVersion),
            environmentEnabled = configuration.analyticsCollectionEnabled,
        ).also { runtime ->
            lifecycles[namespace] = MosaicAnalyticsLifecycle(application, runtime)
        }
    }.also { runtime ->
        runtime.reconcileEnvironmentEnabled(configuration.analyticsCollectionEnabled)
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
