package dev.mosaic.sdk

import android.content.Context
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.io.File
import java.io.FileOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

// Observation volume is orders of magnitude lower than analytics volume — at most one entry per
// completed purchase — so the bounds are far tighter than the analytics queue's.
internal const val MOSAIC_OBSERVATION_MAX_ENTRIES = 64
internal const val MOSAIC_OBSERVATION_MAX_QUEUE_BYTES = 64 * 1024
internal const val MOSAIC_OBSERVATION_EXPIRY_MS = 7L * 24 * 60 * 60 * 1_000
internal const val MOSAIC_OBSERVATION_MAX_ATTEMPTS = 10

internal data class MosaicQueuedTransactionObservation(
    val observation: MosaicTransactionObservation,
    val queuedAtMillis: Long,
    val attempts: Int = 0,
    val nextAttemptAtMillis: Long = 0,
) {
    val encoded: String get() = MosaicTransactionObservationCodec.encode(observation)
    val bytes: Int get() = encoded.toByteArray(Charsets.UTF_8).size
}

internal interface MosaicTransactionObservationStore {
    suspend fun read(): List<MosaicQueuedTransactionObservation>
    suspend fun write(entries: List<MosaicQueuedTransactionObservation>)
}

/**
 * Durable queue file.
 *
 * Storage lives under [Context.getNoBackupFilesDir]: an observation restored from another device or
 * install describes a purchase that never happened here, and submitting it would be a false report.
 * Writes are atomic (temp file, fsync, rename) so a process death mid-write cannot corrupt the
 * queue, and every field is written by literal name so R8 needs no keep rule.
 */
internal class MosaicFileTransactionObservationStore private constructor(
    private val file: File,
) : MosaicTransactionObservationStore {
    constructor(context: Context, namespace: String) : this(
        File(context.applicationContext.noBackupFilesDir, "mosaic/transaction-observations/$namespace.json"),
    )

    internal constructor(directory: File, namespace: String) : this(File(directory, "$namespace.json"))

    override suspend fun read(): List<MosaicQueuedTransactionObservation> = withContext(Dispatchers.IO) {
        if (!file.isFile) return@withContext emptyList()
        runCatching { decode(file.readText(Charsets.UTF_8)) }.getOrDefault(emptyList())
    }

    override suspend fun write(entries: List<MosaicQueuedTransactionObservation>) = withContext(Dispatchers.IO) {
        file.parentFile?.let { require(it.isDirectory || it.mkdirs()) }
        val temporary = File.createTempFile("observations-", ".tmp", file.parentFile)
        try {
            FileOutputStream(temporary).use { output ->
                output.writer(Charsets.UTF_8).buffered().use { writer ->
                    writer.write(encode(entries)); writer.flush(); output.fd.sync()
                }
            }
            require(temporary.renameTo(file)) { "Could not atomically persist Mosaic transaction observations." }
        } finally {
            if (temporary.exists()) temporary.delete()
        }
    }

    private fun encode(entries: List<MosaicQueuedTransactionObservation>): String = JsonObject().apply {
        add(
            "observations",
            JsonArray().also { values ->
                entries.forEach { entry ->
                    values.add(
                        JsonObject().apply {
                            addProperty("encoded", entry.encoded)
                            addProperty("queuedAtMillis", entry.queuedAtMillis)
                            addProperty("attempts", entry.attempts)
                            addProperty("nextAttemptAtMillis", entry.nextAttemptAtMillis)
                        },
                    )
                }
            },
        )
    }.toString()

    private fun decode(source: String): List<MosaicQueuedTransactionObservation> {
        val root = JsonParser.parseString(source).asJsonObject
        require(root.keySet() == setOf("observations"))
        val entries = root.getAsJsonArray("observations").map { element ->
            val value = element.asJsonObject
            require(value.keySet() == setOf("encoded", "queuedAtMillis", "attempts", "nextAttemptAtMillis"))
            MosaicQueuedTransactionObservation(
                // Decoding re-validates the bounds, so a tampered or truncated file can never
                // resurrect a value this SDK would refuse to construct today.
                observation = MosaicTransactionObservationCodec.decode(value.get("encoded").asString),
                queuedAtMillis = value.get("queuedAtMillis").asLong,
                attempts = value.get("attempts").asInt,
                nextAttemptAtMillis = value.get("nextAttemptAtMillis").asLong,
            )
        }
        require(entries.size <= MOSAIC_OBSERVATION_MAX_ENTRIES)
        require(entries.sumOf { it.bytes } <= MOSAIC_OBSERVATION_MAX_QUEUE_BYTES)
        return entries
    }
}

/** Bounded, secret-free counters for the example app and host diagnostics surfaces. */
data class MosaicTransactionObservationDiagnostics(
    val queuedCount: Int,
    val queuedBytes: Int,
    val acceptedCount: Long,
    val duplicateCount: Long,
    val permanentlyRejectedCount: Long,
    val retryableCount: Long,
    val droppedCount: Long,
    val lastSafeCode: String?,
)

/** Reported when the host has not opted in, so no observation runtime exists. */
internal val MOSAIC_TRANSACTION_OBSERVATIONS_UNAVAILABLE = MosaicTransactionObservationDiagnostics(
    queuedCount = 0,
    queuedBytes = 0,
    acceptedCount = 0,
    duplicateCount = 0,
    permanentlyRejectedCount = 0,
    retryableCount = 0,
    droppedCount = 0,
    lastSafeCode = "transaction.observation.disabled",
)

/**
 * Duplicate-safe, bounded, restart-surviving queue of pending observations.
 *
 * Duplicate safety is keyed on `submissionId`, which is derived deterministically from the provider
 * reference and outcome. The same purchase re-observed after a cold start, after a pending→purchased
 * transition, or after an ambiguous network failure therefore occupies exactly one queue slot.
 */
internal class MosaicTransactionObservationQueue(
    private val store: MosaicTransactionObservationStore,
    private val now: () -> Long,
) {
    private val lock = Mutex()
    private var loaded = false
    private var entries: List<MosaicQueuedTransactionObservation> = emptyList()
    private var accepted = 0L
    private var duplicate = 0L
    private var permanent = 0L
    private var retryable = 0L
    private var dropped = 0L
    private var lastCode: String? = null

    /**
     * Returns true when the observation is retained for delivery. A rejected observation is counted
     * and reported through diagnostics; it never throws, because a purchase must not fail because a
     * best-effort report could not be queued.
     */
    suspend fun enqueue(observation: MosaicTransactionObservation): Boolean = lock.withLock {
        load()
        val orderReference = observation.providerOrderReference
        val candidate = when {
            orderReference == null -> observation
            MosaicTransactionObservationBounds.isValidOrderReference(orderReference) -> observation
            // The order reference is a join handle only, so an unusable one is dropped rather than
            // failing the observation whose digest is the part the server actually needs.
            else -> {
                lastCode = MosaicDiagnosticCode.TRANSACTION_OBSERVATION_REFERENCE_UNAVAILABLE.wireName
                observation.copy(providerOrderReference = null)
            }
        }
        if (!MosaicTransactionObservationBounds.isSubmittable(candidate)) {
            dropped += 1
            lastCode = MosaicDiagnosticCode.TRANSACTION_OBSERVATION_REJECTED.wireName
            return@withLock false
        }
        removeExpired()
        if (entries.any { it.observation.submissionId == candidate.submissionId }) {
            persist()
            return@withLock true
        }
        val queued = MosaicQueuedTransactionObservation(candidate, now())
        if (queued.bytes > MOSAIC_OBSERVATION_MAX_QUEUE_BYTES) {
            dropped += 1
            lastCode = MosaicDiagnosticCode.TRANSACTION_OBSERVATION_REJECTED.wireName
            return@withLock false
        }
        val values = entries.toMutableList().apply { add(queued) }
        while (values.size > MOSAIC_OBSERVATION_MAX_ENTRIES ||
            values.sumOf { it.bytes } > MOSAIC_OBSERVATION_MAX_QUEUE_BYTES
        ) {
            values.removeAt(0)
            dropped += 1
            lastCode = MosaicDiagnosticCode.TRANSACTION_OBSERVATION_DROPPED.wireName
        }
        val retained = values.any { it.observation.submissionId == candidate.submissionId }
        if (retained) lastCode = MosaicDiagnosticCode.TRANSACTION_OBSERVATION_QUEUED.wireName
        entries = values
        persist()
        retained
    }

    suspend fun ready(limit: Int): List<MosaicQueuedTransactionObservation> = lock.withLock {
        load(); removeExpired(); persist()
        val current = now()
        entries.filter { it.nextAttemptAtMillis <= current }.take(limit)
    }

    suspend fun applyResult(
        sent: MosaicQueuedTransactionObservation,
        result: MosaicTransactionObservationResult?,
        retryAfterMillis: Long?,
        jitter: (Long) -> Long,
    ) = lock.withLock {
        load()
        val submissionId = sent.observation.submissionId
        var remove = false
        var replacement: MosaicQueuedTransactionObservation? = null
        when (result) {
            MosaicTransactionObservationResult.AcceptedForValidation -> { remove = true; accepted += 1 }
            MosaicTransactionObservationResult.Duplicate -> { remove = true; duplicate += 1 }
            is MosaicTransactionObservationResult.PermanentlyRejected -> {
                remove = true; permanent += 1; lastCode = result.code
            }
            is MosaicTransactionObservationResult.RetryableFailure -> {
                retryable += 1; lastCode = result.code
                replacement = retried(sent, result.retryAfterSeconds?.times(1_000L), jitter)
            }
            null -> {
                lastCode = MosaicDiagnosticCode.TRANSACTION_OBSERVATION_DELIVERY_FAILED.wireName
                replacement = retried(sent, retryAfterMillis, jitter)
            }
        }
        if (replacement != null && replacement.attempts >= MOSAIC_OBSERVATION_MAX_ATTEMPTS) {
            remove = true
            replacement = null
            dropped += 1
            lastCode = MosaicDiagnosticCode.TRANSACTION_OBSERVATION_DROPPED.wireName
        }
        entries = entries.mapNotNull { entry ->
            when {
                entry.observation.submissionId != submissionId -> entry
                remove -> null
                else -> replacement ?: entry
            }
        }
        persist()
    }

    suspend fun clear() = lock.withLock { load(); entries = emptyList(); persist() }

    suspend fun diagnostics(): MosaicTransactionObservationDiagnostics = lock.withLock {
        load()
        MosaicTransactionObservationDiagnostics(
            queuedCount = entries.size,
            queuedBytes = entries.sumOf { it.bytes },
            acceptedCount = accepted,
            duplicateCount = duplicate,
            permanentlyRejectedCount = permanent,
            retryableCount = retryable,
            droppedCount = dropped,
            lastSafeCode = lastCode,
        )
    }

    private fun retried(
        entry: MosaicQueuedTransactionObservation,
        requestedDelay: Long?,
        jitter: (Long) -> Long,
    ): MosaicQueuedTransactionObservation {
        val attempt = entry.attempts + 1
        val cap = requestedDelay?.coerceIn(1_000, 300_000)
            ?: (1_000L shl (attempt - 1).coerceAtMost(8)).coerceAtMost(300_000)
        return entry.copy(attempts = attempt, nextAttemptAtMillis = now() + jitter(cap).coerceIn(0, cap))
    }

    private fun removeExpired() {
        val cutoff = now() - MOSAIC_OBSERVATION_EXPIRY_MS
        val retained = entries.filter { it.queuedAtMillis >= cutoff }
        if (retained.size != entries.size) {
            dropped += entries.size - retained.size
            lastCode = MosaicDiagnosticCode.TRANSACTION_OBSERVATION_DROPPED.wireName
        }
        entries = retained
    }

    private suspend fun load() { if (!loaded) { entries = store.read(); loaded = true } }
    private suspend fun persist() = store.write(entries)
}
