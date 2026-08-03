package dev.mosaic.sdk

import java.nio.file.Files
import java.time.Instant
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AnalyticsQueueTest {
    @Test
    fun sessionSurvivesReconstructionWithinThirtyMinutesAndRotatesAfterThreshold() = runTest {
        var now = 1_000_000L
        val store = MemoryAnalyticsStore()
        val first = MosaicAnalyticsQueue(store) { now }
        val session = first.session()
        now += 29 * 60 * 1_000L
        assertEquals(session, MosaicAnalyticsQueue(store) { now }.session())
        now += 31 * 60 * 1_000L
        assertTrue(session != MosaicAnalyticsQueue(store) { now }.session())
    }

    /**
     * A queue file that cannot be decoded is correctly reset — an undecodable event must never be
     * submitted — but the events it destroyed were real. Resetting silently is indistinguishable
     * from a first launch, so the loss is reported through the diagnostics counters.
     */
    @Test
    fun unreadablePersistedQueueResetsAndReportsTheLoss() = runTest {
        val directory = Files.createTempDirectory("mosaic-analytics-corrupt").toFile()
        val store = MosaicFileAnalyticsStore(directory, "corrupt")
        val now = Instant.parse("2026-07-26T12:05:00.000Z").toEpochMilli()
        MosaicAnalyticsQueue(store) { now }.enqueue(event("purchase-started.json"))
        directory.resolve("corrupt.json").writeText("{\"events\": [ truncated")

        val restored = MosaicAnalyticsQueue(MosaicFileAnalyticsStore(directory, "corrupt")) { now }
        val diagnostics = restored.diagnostics()

        assertEquals(0, diagnostics.queuedEventCount)
        assertEquals("analytics.queue_rejected", diagnostics.lastSafeCode)
    }

    @Test
    fun queuedEventKeepsItsEventTimeIdentity() = runTest {
        val store = MemoryAnalyticsStore()
        val queue = MosaicAnalyticsQueue(store) { Instant.parse("2026-07-26T12:05:00.000Z").toEpochMilli() }
        val original = event("purchase-started.json")
        queue.enqueue(original)
        val futureIdentity = original.copy(identity = original.identity?.copy(applicationUserId = "another_user", generation = 4))
        assertEquals("customer_42", MosaicAnalyticsCodec.decodeEvent(queue.ready(1, 512 * 1024).single().encoded).identity?.applicationUserId)
        assertEquals("another_user", futureIdentity.identity?.applicationUserId)
    }

    @Test
    fun offlineQueueSurvivesReconstructionThenAppliesCanonicalPartialBatch() = runTest {
        val directory = Files.createTempDirectory("mosaic-analytics-demo").toFile()
        val store = MosaicFileAnalyticsStore(directory, "stage4")
        var now = Instant.parse("2026-07-26T12:05:00.000Z").toEpochMilli()
        val first = MosaicAnalyticsQueue(store) { now }
        val events = listOf(
            event("placement-request.json"),
            event("purchase-started.json"),
            event("purchase-started.json").copy(eventId = "event_invalid_authority_001"),
            event("restore-completed.json"),
        )
        events.forEach { assertTrue(first.enqueue(it)) }
        assertEquals(4, first.diagnostics().queuedEventCount)

        // Reconstructing both store and queue models an application process restart while offline.
        val restored = MosaicAnalyticsQueue(MosaicFileAnalyticsStore(directory, "stage4")) { now }
        val sent = restored.ready(50, 512 * 1024)
        assertEquals(4, sent.size)
        val canonical = response("responses/mixed-result-batch.json")
        restored.applyResults(sent, canonical, null) { 0 }

        val diagnostics = restored.diagnostics()
        assertEquals(1, diagnostics.queuedEventCount)
        assertEquals(1, diagnostics.permanentlyRejectedEventCount)
        assertEquals(1, diagnostics.retryableEventCount)
        now += 10_000
        assertEquals("event_restore_completed_001", restored.ready(50, 512 * 1024).single().eventId)
    }

    @Test
    fun malformedAcknowledgementRetainsWholeBatchAndRetryIsBounded() = runTest {
        var now = Instant.parse("2026-07-26T12:05:00.000Z").toEpochMilli()
        val store = MemoryAnalyticsStore()
        val queue = MosaicAnalyticsQueue(store) { now }
        queue.enqueue(event("placement-request.json"))
        repeat(MOSAIC_ANALYTICS_MAX_ATTEMPTS) {
            val sent = queue.ready(50, 512 * 1024)
            queue.applyResults(sent, null, null) { 0 }
        }
        assertEquals(0, queue.diagnostics().queuedEventCount)
        assertEquals(1, queue.diagnostics().droppedEventCount)
    }

    @Test
    fun unknownAcknowledgementCodeRetriesEverySentEvent() = runTest {
        val now = Instant.parse("2026-07-26T12:05:00.000Z").toEpochMilli()
        val queue = MosaicAnalyticsQueue(MemoryAnalyticsStore()) { now }
        queue.enqueue(event("placement-request.json"))
        queue.enqueue(event("purchase-started.json"))
        val sent = queue.ready(50, 512 * 1024)
        val invalid = MosaicAnalyticsIngestionResponse(
            batchId = "batch_invalid_ack",
            receivedAt = "2026-07-26T12:05:01.000Z",
            results = listOf(
                MosaicAnalyticsEventResult.Accepted(sent[0].eventId),
                MosaicAnalyticsEventResult.PermanentlyRejected(sent[1].eventId, "future_unknown_code"),
            ),
            analyticsEventContractVersion = "1",
        )

        queue.applyResults(sent, invalid, null) { 0 }

        assertEquals(2, queue.diagnostics().queuedEventCount)
        assertEquals(0, queue.diagnostics().permanentlyRejectedEventCount)
    }

    @Test
    fun overflowDropsOldestLowPriorityBeforePurchaseOutcome() = runTest {
        val high = queued(event("purchase-completed-client.json"), priority = 4)
        val low = queued(event("placement-request.json"), priority = 1)
        val store = MemoryAnalyticsStore(
            MosaicAnalyticsPersistedState(events = listOf(high) + List(999) { index -> low.copy(eventId = "event_low_$index") }),
        )
        val queue = MosaicAnalyticsQueue(store) { Instant.parse("2026-07-26T12:05:00.000Z").toEpochMilli() }
        queue.enqueue(event("product-selection.json").copy(eventId = "event_new_selection"))
        val retained = queue.ready(1_000, 2 * 1024 * 1024).map { it.eventId }
        assertTrue(high.eventId in retained)
        assertTrue("event_low_0" !in retained)
    }

    @Test
    fun queueEnforcesPerEventAndTotalByteBounds() = runTest {
        val store = MemoryAnalyticsStore()
        val queue = MosaicAnalyticsQueue(store) { Instant.parse("2026-07-26T12:05:00.000Z").toEpochMilli() }
        val source = event("purchase-completed-client.json")
        val payload = source.payload as MosaicAnalyticsPayload.PurchaseCompleted
        val boundedPayload = payload.copy(
            observedEntitlementKeys = List(64) { index -> "entitlement_${index}_" + "x".repeat(220) },
        )
        repeat(160) { index ->
            queue.enqueue(source.copy(eventId = "event_bounded_$index", payload = boundedPayload))
        }
        assertTrue(queue.diagnostics().queuedBytes <= MOSAIC_ANALYTICS_MAX_QUEUE_BYTES)

        val oversized = source.copy(
            eventId = "event_oversized",
            payload = payload.copy(observedEntitlementKeys = listOf("x".repeat(MOSAIC_ANALYTICS_MAX_EVENT_BYTES))),
        )
        assertTrue(!queue.enqueue(oversized))
        assertEquals("analytics.event_too_large", queue.diagnostics().lastSafeCode)
    }

    /**
     * A namespace keeps one analytics runtime per process, so a second `Mosaic.configure` carrying
     * the owner-approved Environment setting used to be silently ignored: collection stayed
     * disabled (dropping every event) or stayed enabled after the owner disabled it. Reconciliation
     * must apply the changed flag, and disabling must still clear the unsent queue.
     */
    @Test
    fun runtimeReconcilesAChangedEnvironmentCollectionFlag() = runTest {
        val queue = MosaicAnalyticsQueue(MemoryAnalyticsStore()) {
            Instant.parse("2026-07-26T12:05:00.000Z").toEpochMilli()
        }
        assertTrue(queue.enqueue(event("placement-request.json")))
        val runtime = runtime(queue, environmentEnabled = false)
        assertTrue(!runtime.isCollectionEnabled)

        runtime.reconcileEnvironmentEnabled(true)
        runtime.drainPendingRecords()
        assertTrue(runtime.isCollectionEnabled)
        assertEquals(1, queue.diagnostics().queuedEventCount)

        runtime.reconcileEnvironmentEnabled(false)
        runtime.drainPendingRecords()
        assertTrue(!runtime.isCollectionEnabled)
        assertEquals(0, queue.diagnostics().queuedEventCount)
        runtime.close()
    }

    /**
     * The blocker this protects: the backend echoes the submitted batch's contract version, so a v2
     * Experiment batch is acknowledged by a v2 response. Treating a v2 response as unusable (or
     * accepting a v1 response for a v2 batch) either retries the batch to exhaustion and drops it —
     * losing Experiment exposures silently — or removes events on an acknowledgement that never
     * referred to them. A v2 batch must be acknowledged only by a matching v2 response.
     */
    @Test
    fun v2BatchesAreAcknowledgedOnlyByV2Responses() = runTest {
        val exposure = MosaicAnalyticsCodec.decodeEvent(v2Fixture("experiment-exposed.json"))
        assertEquals("2", exposure.eventSchemaVersion)

        // A v1-versioned response must not acknowledge the v2 batch: the event is retried, not lost.
        val mismatched = MosaicAnalyticsQueue(MemoryAnalyticsStore()) { NOW }
        assertTrue(mismatched.enqueue(exposure))
        val mismatchedRuntime = runtime(mismatched, environmentEnabled = true, responseVersion = "1")
        mismatchedRuntime.flush()
        assertEquals(1, mismatched.diagnostics().queuedEventCount)
        mismatchedRuntime.close()

        // The correctly versioned v2 response acknowledges and removes it.
        val matched = MosaicAnalyticsQueue(MemoryAnalyticsStore()) { NOW }
        assertTrue(matched.enqueue(exposure))
        val matchedRuntime = runtime(matched, environmentEnabled = true, responseVersion = "2")
        matchedRuntime.flush()
        assertEquals(0, matched.diagnostics().queuedEventCount)
        matchedRuntime.close()
    }

    private fun v2Fixture(name: String) = Files.readAllBytes(
        repositoryFile("protocol/fixtures/analytics-event/v2/$name"),
    ).toString(Charsets.UTF_8)

    private fun runtime(
        queue: MosaicAnalyticsQueue,
        environmentEnabled: Boolean,
        responseVersion: String,
    ) = MosaicAnalyticsRuntime(
        identityStore = { MosaicIdentityState("installation_001", null, emptyMap(), 0) },
        queue = queue,
        transport = object : MosaicAnalyticsTransport {
            override suspend fun send(batch: MosaicAnalyticsBatch) =
                MosaicAnalyticsTransportResult.Received(
                    MosaicAnalyticsIngestionResponse(
                        batchId = batch.batchId,
                        receivedAt = "2026-07-26T12:05:01.000Z",
                        results = batch.events.map { MosaicAnalyticsEventResult.Accepted(it.eventId) },
                        analyticsEventContractVersion = responseVersion,
                    ),
                )
        },
        baseContext = MosaicAnalyticsContext(),
        environmentEnabled = environmentEnabled,
    )

    private fun runtime(queue: MosaicAnalyticsQueue, environmentEnabled: Boolean) = MosaicAnalyticsRuntime(
        identityStore = { MosaicIdentityState("installation_001", null, emptyMap(), 0) },
        queue = queue,
        transport = object : MosaicAnalyticsTransport {
            override suspend fun send(batch: MosaicAnalyticsBatch) =
                MosaicAnalyticsTransportResult.Retryable("analytics.unavailable")
        },
        baseContext = MosaicAnalyticsContext(),
        environmentEnabled = environmentEnabled,
    )

    private val NOW = Instant.parse("2026-07-26T12:05:00.000Z").toEpochMilli()

    private fun event(name: String): MosaicAnalyticsEvent = MosaicAnalyticsCodec.decodeEvent(
        Files.readAllBytes(repositoryFile("protocol/fixtures/analytics-event/v1/$name")).toString(Charsets.UTF_8),
    )
    private fun response(name: String) = MosaicAnalyticsCodec.decodeResponse(
        Files.readAllBytes(repositoryFile("protocol/fixtures/analytics-event/v1/$name")).toString(Charsets.UTF_8),
    )
    private fun queued(event: MosaicAnalyticsEvent, priority: Int) = MosaicQueuedAnalyticsEvent(
        event.eventId, event.eventName, Instant.parse(event.occurredAt).toEpochMilli(),
        MosaicAnalyticsCodec.encodeEvent(event), priority,
    )

    private class MemoryAnalyticsStore(
        var state: MosaicAnalyticsPersistedState = MosaicAnalyticsPersistedState(),
    ) : MosaicAnalyticsStore {
        override suspend fun read() = state
        override suspend fun write(state: MosaicAnalyticsPersistedState) { this.state = state }
    }
}
