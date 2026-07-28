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
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.buffer
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex

/**
 * Collects provider commerce updates and hands completed purchases to Mosaic as Transaction
 * Observations. Off unless the host opts in with `transactionObservationEnabled`.
 *
 * Three properties are load-bearing and are what the tests protect:
 *
 * 1. **It never blocks a purchase.** The runtime is a *subscriber* to the adapter's update flow,
 *    with its own buffer, so the adapter's `emit` cannot be back-pressured by queueing or by a slow,
 *    hung, or hostile endpoint. Delivery runs on its own scope and is never awaited by anything on
 *    the purchase path. Acknowledgement — and therefore Google's refund window — is untouched.
 * 2. **It reports only what a purchase already finalized.** Only [MosaicCommerceUpdateOutcome.PURCHASED]
 *    is observed, and the Google Play adapter emits that outcome only after the local delivery marker
 *    is finalized, i.e. after acknowledgement.
 * 3. **It cannot claim validation.** A submission result never reaches [MosaicPurchaseResult];
 *    entitlement continues to come from the provider alone.
 */
class MosaicTransactionObservationRuntime internal constructor(
    private val queue: MosaicTransactionObservationQueue,
    private val transport: MosaicTransactionObservationTransport,
    enabled: Boolean,
    private val now: () -> Long = System::currentTimeMillis,
    private val jitter: (Long) -> Long = { cap -> if (cap <= 0) 0 else Random.nextLong(cap + 1) },
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val flushLock = Mutex()
    @Volatile private var enabled = enabled

    val isObservationEnabled: Boolean get() = enabled

    /** Subscribes to a provider's asynchronous commerce updates. */
    internal fun collect(updates: Flow<MosaicCommerceUpdate>) {
        scope.launch {
            // An explicit subscriber buffer: the emitting adapter is never suspended by this
            // collector, and an unreachable endpoint degrades to dropped observations rather than
            // to a stalled purchase.
            updates.buffer(capacity = 64, onBufferOverflow = BufferOverflow.DROP_OLDEST)
                .collect { observe(it) }
        }
    }

    /**
     * Queues one observation, fire and forget. Returns immediately; the caller never learns the
     * delivery outcome, because no local decision may depend on it.
     */
    internal fun observe(update: MosaicCommerceUpdate) {
        if (!enabled) return
        val observation = observation(update) ?: return
        scope.launch {
            runCatching {
                if (queue.enqueue(observation)) flush()
            }
        }
    }

    /** Delivers ready observations, one request each, best effort. */
    suspend fun flush(): MosaicTransactionObservationDiagnostics {
        if (!enabled) return queue.diagnostics()
        // A second flush while one is in flight is redundant work, not a queue.
        if (!flushLock.tryLock()) return queue.diagnostics()
        try {
            queue.ready(limit = 8).forEach { entry ->
                when (val result = runCatching { transport.submit(entry.observation) }.getOrNull()) {
                    is MosaicTransactionObservationTransportResult.Received ->
                        queue.applyResult(entry, result.result, null, jitter)
                    is MosaicTransactionObservationTransportResult.Retryable ->
                        queue.applyResult(entry, null, result.retryAfterMillis, jitter)
                    null -> queue.applyResult(entry, null, null, jitter)
                }
            }
        } finally {
            flushLock.unlock()
        }
        return queue.diagnostics()
    }

    suspend fun diagnostics(): MosaicTransactionObservationDiagnostics = queue.diagnostics()

    fun flushBestEffort() { if (enabled) scope.launch { runCatching { flush() } } }

    /** Applies a changed host opt-in without reconstructing the runtime. */
    internal fun reconcileEnabled(value: Boolean) {
        if (enabled == value) return
        enabled = value
        if (!value) {
            transport.cancel()
            scope.launch { runCatching { queue.clear() } }
        }
    }

    fun close() { transport.cancel(); scope.cancel() }

    /**
     * Builds the observation. Everything not in this function is structurally unable to reach the
     * wire: there is no raw token, receipt, signature, account identifier, price, or host text here,
     * and the reference is the adapter's irreversible token digest.
     */
    private fun observation(update: MosaicCommerceUpdate): MosaicTransactionObservation? {
        if (update.outcome != MosaicCommerceUpdateOutcome.PURCHASED) return null
        if (update.providerId != MOSAIC_GOOGLE_PLAY_PROVIDER_ID) return null
        val reference = update.transactionReference ?: return null
        return MosaicTransactionObservation(
            // The adapter's update identity is already deterministic in the reference and the
            // outcome, and is derived from neither a timestamp, a price, a Product, nor a subject.
            submissionId = update.updateId,
            referenceKind = MOSAIC_REFERENCE_GOOGLE_PLAY_TOKEN_DIGEST,
            reference = reference,
            providerOrderReference = update.providerOrderReference,
            observedAt = mosaicAnalyticsTimestamp(now()),
        )
    }
}

/** The only provider whose reference kind Billing Ingestion Contract 1 lets this SDK produce. */
internal const val MOSAIC_GOOGLE_PLAY_PROVIDER_ID = "google_play"

internal object MosaicTransactionObservationRuntimeRegistry {
    private val runtimes = ConcurrentHashMap<String, MosaicTransactionObservationRuntime>()
    private val lifecycles = ConcurrentHashMap<String, MosaicTransactionObservationLifecycle>()

    fun runtime(
        application: Application,
        namespace: String,
        configuration: MosaicConfiguration,
        updates: Flow<MosaicCommerceUpdate>,
    ): MosaicTransactionObservationRuntime = runtimes.getOrPut(namespace) {
        MosaicTransactionObservationRuntime(
            queue = MosaicTransactionObservationQueue(
                MosaicFileTransactionObservationStore(application, namespace),
                System::currentTimeMillis,
            ),
            transport = MosaicHTTPTransactionObservationTransport(configuration),
            enabled = configuration.transactionObservationEnabled,
        ).also { runtime ->
            runtime.collect(updates)
            lifecycles[namespace] = MosaicTransactionObservationLifecycle(application, runtime)
        }
    }.also { runtime ->
        runtime.reconcileEnabled(configuration.transactionObservationEnabled)
    }
}

/**
 * Foreground transitions are the only retry trigger. Phase 9A adds no WorkManager or JobScheduler:
 * store notifications and server-side reconciliation are the reliable path, and this handoff is a
 * latency and attribution optimization that is allowed to be late.
 */
private class MosaicTransactionObservationLifecycle(
    application: Application,
    private val runtime: MosaicTransactionObservationRuntime,
) : Application.ActivityLifecycleCallbacks {
    private var started = 0
    init { application.registerActivityLifecycleCallbacks(this) }
    override fun onActivityStarted(activity: Activity) {
        started += 1
        if (started == 1) runtime.flushBestEffort()
    }
    override fun onActivityStopped(activity: Activity) { started = (started - 1).coerceAtLeast(0) }
    override fun onActivityCreated(activity: Activity, state: Bundle?) = Unit
    override fun onActivityResumed(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit
}
