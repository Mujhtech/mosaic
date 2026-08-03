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

internal const val MOSAIC_ANALYTICS_MAX_EVENTS = 1_000
internal const val MOSAIC_ANALYTICS_MAX_QUEUE_BYTES = 2 * 1024 * 1024
internal const val MOSAIC_ANALYTICS_MAX_EVENT_BYTES = 32 * 1024
internal const val MOSAIC_ANALYTICS_EVENT_EXPIRY_MS = 7L * 24 * 60 * 60 * 1_000
internal const val MOSAIC_ANALYTICS_MAX_ATTEMPTS = 10

internal data class MosaicQueuedAnalyticsEvent(
    val eventId: String,
    val eventName: String,
    val occurredAtMillis: Long,
    val encoded: String,
    val priority: Int,
    val attempts: Int = 0,
    val nextAttemptAtMillis: Long = 0,
) {
    val bytes: Int get() = encoded.toByteArray(Charsets.UTF_8).size
}

internal data class MosaicAnalyticsPersistedState(
    val events: List<MosaicQueuedAnalyticsEvent> = emptyList(),
    val sessionId: String? = null,
    val lastActivityAtMillis: Long? = null,
)

internal interface MosaicAnalyticsStore {
    suspend fun read(): MosaicAnalyticsPersistedState
    suspend fun write(state: MosaicAnalyticsPersistedState)

    /**
     * True when the most recent [read] discarded an unreadable persisted queue. Resetting is the
     * correct recovery, but the events it destroyed were real, so the loss is reported rather than
     * being indistinguishable from a first launch.
     */
    val lastReadDiscarded: Boolean get() = false
}

internal class MosaicFileAnalyticsStore private constructor(private val file: File) : MosaicAnalyticsStore {
    constructor(context: Context, namespace: String) : this(
        File(context.applicationContext.noBackupFilesDir, "mosaic/analytics/$namespace.json"),
    )

    internal constructor(directory: File, namespace: String) : this(File(directory, "$namespace.json"))

    @Volatile private var discarded = false

    override val lastReadDiscarded: Boolean get() = discarded

    override suspend fun read(): MosaicAnalyticsPersistedState = withContext(Dispatchers.IO) {
        if (!file.isFile) return@withContext MosaicAnalyticsPersistedState()
        runCatching { decode(file.readText(Charsets.UTF_8)) }
            .onFailure { discarded = true }
            .getOrDefault(MosaicAnalyticsPersistedState())
    }

    override suspend fun write(state: MosaicAnalyticsPersistedState) = withContext(Dispatchers.IO) {
        file.parentFile?.let { require(it.isDirectory || it.mkdirs()) }
        val temporary = File.createTempFile("analytics-", ".tmp", file.parentFile)
        try {
            FileOutputStream(temporary).use { output ->
                output.writer(Charsets.UTF_8).buffered().use { writer ->
                    writer.write(encode(state)); writer.flush(); output.fd.sync()
                }
            }
            require(temporary.renameTo(file)) { "Could not atomically persist Mosaic analytics." }
        } finally {
            if (temporary.exists()) temporary.delete()
        }
    }

    private fun encode(state: MosaicAnalyticsPersistedState): String = JsonObject().apply {
        state.sessionId?.let { addProperty("sessionId", it) }
        state.lastActivityAtMillis?.let { addProperty("lastActivityAtMillis", it) }
        add("events", JsonArray().also { values -> state.events.forEach { event -> values.add(JsonObject().apply {
            addProperty("eventId", event.eventId); addProperty("eventName", event.eventName)
            addProperty("occurredAtMillis", event.occurredAtMillis); addProperty("encoded", event.encoded)
            addProperty("priority", event.priority); addProperty("attempts", event.attempts)
            addProperty("nextAttemptAtMillis", event.nextAttemptAtMillis)
        }) } })
    }.toString()

    private fun decode(source: String): MosaicAnalyticsPersistedState {
        val root = JsonParser.parseString(source).asJsonObject
        require(root.keySet().all { it in setOf("sessionId", "lastActivityAtMillis", "events") })
        val events = root.getAsJsonArray("events").map { element ->
            val value = element.asJsonObject
            require(value.keySet() == setOf("eventId", "eventName", "occurredAtMillis", "encoded", "priority", "attempts", "nextAttemptAtMillis"))
            MosaicQueuedAnalyticsEvent(
                value.get("eventId").asString, value.get("eventName").asString,
                value.get("occurredAtMillis").asLong, value.get("encoded").asString,
                value.get("priority").asInt, value.get("attempts").asInt,
                value.get("nextAttemptAtMillis").asLong,
            )
        }
        require(events.size <= MOSAIC_ANALYTICS_MAX_EVENTS && events.sumOf { it.bytes } <= MOSAIC_ANALYTICS_MAX_QUEUE_BYTES)
        return MosaicAnalyticsPersistedState(events, root.get("sessionId")?.asString, root.get("lastActivityAtMillis")?.asLong)
    }
}

data class MosaicAnalyticsDiagnostics(
    val queuedEventCount: Int,
    val queuedBytes: Int,
    val droppedEventCount: Long,
    val expiredEventCount: Long,
    val permanentlyRejectedEventCount: Long,
    val retryableEventCount: Long,
    val lastSafeCode: String?,
)

internal class MosaicAnalyticsQueue(
    private val store: MosaicAnalyticsStore,
    private val now: () -> Long,
) {
    private val lock = Mutex()
    private var loaded = false
    private var state = MosaicAnalyticsPersistedState()
    private var dropped = 0L
    private var expired = 0L
    private var permanent = 0L
    private var retryable = 0L
    private var lastCode: String? = null

    suspend fun session(forceNew: Boolean = false): String = lock.withLock {
        load()
        val current = now()
        val active = state.sessionId?.takeIf {
            !forceNew && state.lastActivityAtMillis?.let { last -> current - last in 0 until 30 * 60 * 1_000L } == true
        } ?: mosaicAnalyticsId("session")
        state = state.copy(sessionId = active, lastActivityAtMillis = current)
        persist()
        active
    }

    suspend fun beginNewSession() = lock.withLock {
        load(); state = state.copy(sessionId = null, lastActivityAtMillis = null); persist()
    }

    suspend fun enqueue(event: MosaicAnalyticsEvent): Boolean = lock.withLock {
        load()
        val encoded = MosaicAnalyticsCodec.encodeEvent(event)
        val bytes = encoded.toByteArray(Charsets.UTF_8).size
        if (bytes > MOSAIC_ANALYTICS_MAX_EVENT_BYTES) {
            dropped += 1; lastCode = "analytics.event_too_large"; return@withLock false
        }
        removeExpired()
        val candidate = MosaicQueuedAnalyticsEvent(
            event.eventId, event.eventName, mosaicAnalyticsTimestampMillis(event.occurredAt),
            encoded, priority(event.eventName),
        )
        val values = state.events.toMutableList().apply { add(candidate) }
        while (values.size > MOSAIC_ANALYTICS_MAX_EVENTS || values.sumOf { it.bytes } > MOSAIC_ANALYTICS_MAX_QUEUE_BYTES) {
            val victim = values.indices.minWithOrNull(compareBy<Int>({ values[it].priority }, { values[it].occurredAtMillis })) ?: break
            values.removeAt(victim); dropped += 1; lastCode = "analytics.queue_overflow"
        }
        val retained = values.any { it.eventId == candidate.eventId }
        state = state.copy(events = values); persist(); retained
    }

    suspend fun ready(limit: Int, maxBytes: Int): List<MosaicQueuedAnalyticsEvent> = lock.withLock {
        load(); removeExpired(); persist()
        val current = now()
        val selected = mutableListOf<MosaicQueuedAnalyticsEvent>()
        var bytes = 0
        for (event in state.events) {
            if (event.nextAttemptAtMillis > current) continue
            if (selected.size == limit) break
            if (bytes + event.bytes > maxBytes && selected.isNotEmpty()) break
            selected += event; bytes += event.bytes
        }
        selected
    }

    suspend fun applyResults(
        sent: List<MosaicQueuedAnalyticsEvent>,
        response: MosaicAnalyticsIngestionResponse?,
        retryAfterMillis: Long?,
        jitter: (Long) -> Long,
    ) = lock.withLock {
        load()
        val sentById = sent.associateBy { it.eventId }
        val valid = response?.results?.takeIf { results ->
            response.batchId.isNotBlank() &&
                results.size == sent.size &&
                results.map { it.eventId }.toSet() == sentById.keys &&
                results.all(::isValidAnalyticsAcknowledgementResult)
        }
        val remove = mutableSetOf<String>()
        val updates = mutableMapOf<String, MosaicQueuedAnalyticsEvent>()
        if (valid == null) {
            sent.forEach { updates[it.eventId] = retried(it, retryAfterMillis, jitter) }
        } else {
            valid.forEach { result -> when (result) {
                is MosaicAnalyticsEventResult.Accepted, is MosaicAnalyticsEventResult.Duplicate -> remove += result.eventId
                is MosaicAnalyticsEventResult.PermanentlyRejected -> { remove += result.eventId; permanent += 1; lastCode = result.code }
                is MosaicAnalyticsEventResult.Retryable -> {
                    retryable += 1; lastCode = result.code
                    updates[result.eventId] = retried(sentById.getValue(result.eventId), result.retryAfterSeconds?.times(1_000L), jitter)
                }
            } }
        }
        updates.values.filter { it.attempts >= MOSAIC_ANALYTICS_MAX_ATTEMPTS }.forEach { remove += it.eventId; dropped += 1; lastCode = "analytics.retry_exhausted" }
        state = state.copy(events = state.events.mapNotNull { event -> if (event.eventId in remove) null else updates[event.eventId] ?: event })
        persist()
    }

    private fun isValidAnalyticsAcknowledgementResult(result: MosaicAnalyticsEventResult): Boolean = when (result) {
        is MosaicAnalyticsEventResult.Accepted, is MosaicAnalyticsEventResult.Duplicate -> true
        is MosaicAnalyticsEventResult.PermanentlyRejected -> result.code in permanentRejectionCodes
        is MosaicAnalyticsEventResult.Retryable ->
            result.code in retryableRejectionCodes && result.retryAfterSeconds?.let { it in 1..300 } != false
    }

    suspend fun clear() = lock.withLock { load(); state = state.copy(events = emptyList()); persist() }
    suspend fun diagnostics(): MosaicAnalyticsDiagnostics = lock.withLock { load(); MosaicAnalyticsDiagnostics(state.events.size, state.events.sumOf { it.bytes }, dropped, expired, permanent, retryable, lastCode) }

    private fun retried(event: MosaicQueuedAnalyticsEvent, requestedDelay: Long?, jitter: (Long) -> Long): MosaicQueuedAnalyticsEvent {
        val attempt = event.attempts + 1
        val cap = requestedDelay?.coerceIn(1_000, 300_000)
            ?: (1_000L shl (attempt - 1).coerceAtMost(8)).coerceAtMost(300_000)
        return event.copy(attempts = attempt, nextAttemptAtMillis = now() + jitter(cap).coerceIn(0, cap))
    }

    private fun removeExpired() {
        val cutoff = now() - MOSAIC_ANALYTICS_EVENT_EXPIRY_MS
        val retained = state.events.filter { it.occurredAtMillis >= cutoff }
        expired += state.events.size - retained.size
        if (retained.size != state.events.size) lastCode = "analytics.event_expired"
        state = state.copy(events = retained)
    }
    private suspend fun load() {
        if (loaded) return
        state = store.read()
        loaded = true
        if (store.lastReadDiscarded) lastCode = "analytics.queue_rejected"
    }
    private suspend fun persist() = store.write(state)

    private fun priority(name: String): Int = when {
        name.startsWith("purchase_") || name.startsWith("restore_") -> 4
        name == "paywall_presented" || name == "paywall_dismissed" -> 3
        name == "product_selected" || name.startsWith("placement_paywall") || name.startsWith("placement_no") -> 2
        else -> 1
    }
}
