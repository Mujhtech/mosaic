package dev.mosaic.sdk

import com.google.gson.JsonParser
import java.nio.file.Files
import java.time.Instant
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TransactionObservationQueueTest {
    /**
     * The frozen Billing Ingestion Contract 1 record — not the transport's convenience shape — is
     * what Mosaic accepts, so the serialized observation must match the canonical Google fixture
     * exactly, key for key. Only self-authored identifiers and the SDK family differ; anything else
     * would be an Android-only dialect of a shared contract.
     */
    @Test
    fun `the serialized observation matches the canonical Google client fixture`() {
        val fixture = JsonParser.parseString(
            Files.readAllBytes(
                repositoryFile("protocol/fixtures/billing-ingestion/v1/google-client-observation.json"),
            ).toString(Charsets.UTF_8),
        ).asJsonObject
        val payload = fixture.getAsJsonObject("payload")
        val context = payload.getAsJsonObject("context")
        val correlation = payload.getAsJsonObject("correlation")

        val encoded = MosaicTransactionObservationCodec.encode(
            MosaicTransactionObservation(
                observationId = payload.get("observationId").asString,
                submissionId = payload.get("submissionId").asString,
                providerId = payload.get("providerId").asString,
                referenceKind = MOSAIC_REFERENCE_GOOGLE_PLAY_TOKEN_DIGEST,
                reference = payload.getAsJsonObject("transactionReference").get("value").asString,
                providerOrderReference =
                    payload.getAsJsonObject("providerOrderReference").get("value").asString,
                observedAt = payload.get("observedAt").asString,
                context = MosaicTransactionObservationContext(
                    sdkVersion = context.get("sdkVersion").asString,
                    applicationVersion = context.get("applicationVersion").asString,
                    operatingSystemVersion = context.get("operatingSystemVersion").asString,
                ),
                correlation = MosaicTransactionObservationCorrelation(
                    purchaseAttemptId = correlation.get("purchaseAttemptId").asString,
                    providerUpdateId = correlation.get("providerUpdateId").asString,
                ),
                claimedMosaicProductId = payload.get("claimedMosaicProductId").asString,
            ),
        )

        // The fixture was authored for the Flutter family; this SDK truthfully reports its own.
        context.addProperty("sdkFamily", "android")
        assertEquals(fixture, JsonParser.parseString(encoded).asJsonObject)

        // A client may never assert a Store Environment: classification is server-side, from
        // verified provider metadata, and the contract rejects an observation that claims one.
        assertFalse(JsonParser.parseString(encoded).asJsonObject.getAsJsonObject("payload").has("storeEnvironment"))
        assertFalse(encoded.contains("storeEnvironmentClassification"))
    }

    /**
     * The Billing Ingestion Contract bounds every reference to `safeProviderCode`. A reference that
     * violates them is either rejected by the server after burning retries or, worse, stored — and
     * an over-long or control-character-bearing value is exactly the shape a leaked purchase token
     * or an injected log line would have. Rejection must happen locally, at enqueue, and must never
     * throw: a purchase cannot fail because a best-effort report was malformed.
     */
    @Test
    fun `out of bounds references are rejected at enqueue rather than queued or thrown`() = runTest {
        val queue = MosaicTransactionObservationQueue(MemoryObservationStore()) { NOW }

        assertFalse(queue.enqueue(observation(reference = "a".repeat(200))))
        assertFalse(queue.enqueue(observation(reference = "")))
        assertFalse(queue.enqueue(observation(reference = DIGEST.dropLast(1) + "\n")))
        assertFalse(queue.enqueue(observation(reference = DIGEST.uppercase())))
        assertFalse(queue.enqueue(observation(submissionId = "has space")))
        assertFalse(queue.enqueue(observation(observationId = "has space")))

        assertEquals(0, queue.diagnostics().queuedCount)
        assertEquals(6, queue.diagnostics().droppedCount)
        assertEquals(
            MosaicDiagnosticCode.TRANSACTION_OBSERVATION_REJECTED.wireName,
            queue.diagnostics().lastSafeCode,
        )

        // An unusable order reference is a join handle only, so it is dropped while the observation
        // — whose digest is the part the server needs — is still queued.
        assertTrue(queue.enqueue(observation(orderReference = "GPA.0000 0000 ")))
        assertEquals(1, queue.diagnostics().queuedCount)
        assertNull(queue.ready(8).single().observation.providerOrderReference)
    }

    /**
     * The same purchase is observed more than once by design: a pending purchase that later
     * completes, a `queryPurchasesAsync` re-observation after a cold start, and a retry after an
     * ambiguous network failure all reach the queue. Each must occupy one slot, the stored record
     * identity must not be rewritten by a later sighting, and a server `duplicate` answer must
     * remove the entry rather than retry it forever.
     */
    @Test
    fun `repeated observations of one purchase occupy one slot and duplicate removes it`() = runTest {
        val queue = MosaicTransactionObservationQueue(MemoryObservationStore()) { NOW }

        assertTrue(queue.enqueue(observation(observationId = "observation_first")))
        assertTrue(queue.enqueue(observation(observationId = "observation_second")))
        assertTrue(
            queue.enqueue(
                observation(observationId = "observation_third", orderReference = "GPA.1111-2222-3333-44444"),
            ),
        )
        assertEquals(1, queue.diagnostics().queuedCount)

        val entry = queue.ready(8).single()
        assertEquals("observation_first", entry.observation.observationId)
        queue.applyResult(entry, MosaicTransactionObservationResult.Duplicate, null) { 0 }

        assertEquals(0, queue.diagnostics().queuedCount)
        assertEquals(1, queue.diagnostics().duplicateCount)
    }

    /**
     * Users routinely background or kill an app the moment a purchase completes, so an in-memory
     * queue would silently lose the handoff exactly when it is most useful. The entry, its record
     * identity, its attempt count and its backoff must survive a process restart, and re-reading the
     * file must re-validate the contract bounds so a tampered file cannot resurrect a value this SDK
     * would refuse to build today.
     */
    @Test
    fun `queued observations and their attempt state survive a process restart`() = runTest {
        val directory = Files.createTempDirectory("mosaic-observations").toFile()
        var now = NOW
        val first = MosaicTransactionObservationQueue(
            MosaicFileTransactionObservationStore(directory, "stage3"),
        ) { now }
        assertTrue(first.enqueue(observation(orderReference = "GPA.1111-2222-3333-44444")))
        first.applyResult(
            first.ready(8).single(),
            MosaicTransactionObservationResult.RetryableFailure("rate_limited", retryAfterSeconds = 30),
            null,
        ) { it }

        // Reconstructing both the store and the queue models an application process restart.
        val restored = MosaicTransactionObservationQueue(
            MosaicFileTransactionObservationStore(directory, "stage3"),
        ) { now }
        assertTrue(restored.ready(8).isEmpty())

        now += 31_000
        val entry = restored.ready(8).single()
        assertEquals(1, entry.attempts)
        assertEquals(DIGEST, entry.observation.reference)
        assertEquals(OBSERVATION_ID, entry.observation.observationId)
        assertEquals("GPA.1111-2222-3333-44444", entry.observation.providerOrderReference)

        restored.applyResult(entry, MosaicTransactionObservationResult.AcceptedForValidation, null) { 0 }
        assertEquals(0, restored.diagnostics().queuedCount)
        assertEquals(1, restored.diagnostics().acceptedCount)
    }

    /**
     * The payload is the only thing that leaves the device, so its exact key set is a contract, not
     * an implementation detail. An extra key is a potential leak and a rejected submission; a
     * missing one is an unprocessable observation.
     */
    @Test
    fun `the encoded record carries exactly the contract fields`() {
        val encoded = MosaicTransactionObservationCodec.encode(
            observation(orderReference = "GPA.1111-2222-3333-44444"),
        )

        val root = JsonParser.parseString(encoded).asJsonObject
        assertEquals(setOf("billingIngestionContractVersion", "recordType", "payload"), root.keySet())
        assertEquals("1", root.get("billingIngestionContractVersion").asString)
        assertEquals("clientTransactionObservation", root.get("recordType").asString)

        val payload = root.getAsJsonObject("payload")
        assertEquals(
            setOf(
                "observationId", "submissionId", "providerId", "storePlatform",
                "transactionReference", "providerOrderReference", "observedAt",
                "sourceAuthority", "context", "claimedMosaicProductId",
            ),
            payload.keySet(),
        )
        assertEquals("google_play", payload.get("storePlatform").asString)
        assertEquals("client_observation", payload.get("sourceAuthority").asString)
        assertEquals(
            "google_play_token_digest",
            payload.getAsJsonObject("transactionReference").get("referenceKind").asString,
        )
        assertEquals(DIGEST, payload.getAsJsonObject("transactionReference").get("value").asString)
        assertEquals(
            "google_play_order_id",
            payload.getAsJsonObject("providerOrderReference").get("referenceKind").asString,
        )
        assertEquals("android", payload.getAsJsonObject("context").get("sdkFamily").asString)
        assertEquals(
            observation(orderReference = "GPA.1111-2222-3333-44444"),
            MosaicTransactionObservationCodec.decode(encoded),
        )
    }

    /**
     * The response is a contract record too. Every canonical response fixture must decode to the
     * matching sealed case, and anything else — a foreign record type, a foreign contract version,
     * an outcome outside the frozen set, or an answer about another submission — must not be
     * decoded, because only a result this SDK understands may justify discarding the handoff. The
     * status set has no member meaning validated.
     */
    @Test
    fun `submission results decode only from the canonical response records`() {
        assertEquals(
            MosaicTransactionObservationResult.AcceptedForValidation,
            responseFixture("accepted-for-validation.json", "fixture-submission-apple-0001"),
        )
        assertEquals(
            MosaicTransactionObservationResult.Duplicate,
            responseFixture("duplicate-observation.json", "fixture-submission-apple-0001"),
        )
        assertEquals(
            MosaicTransactionObservationResult.PermanentlyRejected("provider_reference_malformed"),
            responseFixture("permanent-rejection.json", "fixture-submission-malformed-0001"),
        )
        assertEquals(
            MosaicTransactionObservationResult.RetryableFailure("rate_limited", 30),
            responseFixture("retryable-failure.json", "fixture-submission-google-0001"),
        )

        val accepted = """
            {"billingIngestionContractVersion":"1","recordType":"observationSubmissionResult",
             "payload":{"submissionId":"submission_1","receivedAt":"2026-07-27T12:00:00.000Z",
             "status":"accepted_for_validation"}}
        """.trimIndent()
        assertEquals(
            MosaicTransactionObservationResult.AcceptedForValidation,
            MosaicTransactionObservationCodec.decodeResult(accepted, "submission_1"),
        )
        assertNull(MosaicTransactionObservationCodec.decodeResult(accepted, "another_submission"))
        assertNull(
            MosaicTransactionObservationCodec.decodeResult(
                accepted.replace("\"status\":\"accepted_for_validation\"", "\"status\":\"validated\""),
                "submission_1",
            ),
        )
        assertNull(
            MosaicTransactionObservationCodec.decodeResult(
                accepted.replace("\"billingIngestionContractVersion\":\"1\"", "\"billingIngestionContractVersion\":\"2\""),
                "submission_1",
            ),
        )
        assertNull(
            MosaicTransactionObservationCodec.decodeResult(
                accepted.replace("observationSubmissionResult", "validationResult"),
                "submission_1",
            ),
        )
        // The pre-ruling transport envelope is no longer a valid answer.
        assertNull(
            MosaicTransactionObservationCodec.decodeResult(
                """{"data":{"submissionId":"submission_1","outcome":"accepted_for_validation"}}""",
                "submission_1",
            ),
        )
    }

    /**
     * Durability must precede delivery, and delivery must never hold anything the purchase path
     * waits on. If an observation were submitted before it was persisted, the very case the queue
     * exists for — the user backgrounds or kills the app the instant the purchase completes — would
     * lose it. This pins the ordering against a transport that never answers.
     */
    @Test
    fun `an observation is durable before a submission that never completes`() = runTest {
        val store = MemoryObservationStore()
        val queue = MosaicTransactionObservationQueue(store) { NOW }
        val submitting = CompletableDeferred<Unit>()
        val runtime = MosaicTransactionObservationRuntime(
            queue = queue,
            transport = object : MosaicTransactionObservationTransport {
                override suspend fun submit(observation: MosaicTransactionObservation):
                    MosaicTransactionObservationTransportResult {
                    submitting.complete(Unit)
                    awaitCancellation()
                }
            },
            enabled = true,
            now = { NOW },
            identity = { OBSERVATION_ID },
        )

        runtime.observe(purchasedUpdate())
        submitting.await()

        assertEquals(1, queue.diagnostics().queuedCount)
        val queued = queue.ready(8).single().observation
        assertEquals(DIGEST, queued.reference)
        assertEquals("product_pro_monthly", queued.claimedMosaicProductId)
        assertEquals("google_${DIGEST}_purchased", queued.correlation?.providerUpdateId)
        runtime.close()
    }

    /**
     * The handoff is opt-in and reports one thing only. A disabled runtime must queue nothing, and
     * an enabled one must ignore every outcome except a completed purchase: a pending purchase has
     * no order reference and nothing to validate, and a cancellation or failure has no transaction
     * at all.
     */
    @Test
    fun `only opted-in completed purchases are observed`() = runTest {
        val queue = MosaicTransactionObservationQueue(MemoryObservationStore()) { NOW }
        val disabled = MosaicTransactionObservationRuntime(
            queue = queue,
            transport = SilentTransport(),
            enabled = false,
            now = { NOW },
        )
        disabled.observe(purchasedUpdate())
        assertEquals(0, queue.diagnostics().queuedCount)
        disabled.close()

        val enabled = MosaicTransactionObservationRuntime(
            queue = queue,
            transport = SilentTransport(),
            enabled = true,
            now = { NOW },
        )
        listOf(
            MosaicCommerceUpdateOutcome.PENDING,
            MosaicCommerceUpdateOutcome.CANCELLED,
            MosaicCommerceUpdateOutcome.FAILED,
            MosaicCommerceUpdateOutcome.PROVIDER_UNAVAILABLE,
            MosaicCommerceUpdateOutcome.ENTITLEMENTS_CHANGED,
        ).forEach { enabled.observe(purchasedUpdate().copy(outcome = it)) }
        assertEquals(0, queue.diagnostics().queuedCount)
        enabled.close()
    }

    private fun responseFixture(name: String, submissionId: String) =
        MosaicTransactionObservationCodec.decodeResult(
            Files.readAllBytes(
                repositoryFile("protocol/fixtures/billing-ingestion/v1/responses/$name"),
            ).toString(Charsets.UTF_8),
            submissionId,
        )

    private fun purchasedUpdate() = MosaicCommerceUpdate(
        updateId = "google_${DIGEST}_purchased",
        operationId = null,
        providerId = "google_play",
        mosaicProductId = "product_pro_monthly",
        configuration = MosaicCommerceConfigurationReference("configuration", "revision"),
        outcome = MosaicCommerceUpdateOutcome.PURCHASED,
        transactionReference = DIGEST,
        activeEntitlements = emptySet(),
        occurredAt = "2026-07-27T12:00:00Z",
        providerOrderReference = "GPA.1111-2222-3333-44444",
    )

    private class SilentTransport : MosaicTransactionObservationTransport {
        override suspend fun submit(observation: MosaicTransactionObservation) =
            MosaicTransactionObservationTransportResult.Retryable("service_temporarily_unavailable")
    }

    private fun observation(
        observationId: String = OBSERVATION_ID,
        submissionId: String = "google_${DIGEST}_purchased",
        reference: String = DIGEST,
        orderReference: String? = null,
    ) = MosaicTransactionObservation(
        observationId = observationId,
        submissionId = submissionId,
        providerId = "google_play",
        referenceKind = MOSAIC_REFERENCE_GOOGLE_PLAY_TOKEN_DIGEST,
        reference = reference,
        providerOrderReference = orderReference,
        observedAt = "2026-07-27T12:00:00.000Z",
        context = MosaicTransactionObservationContext(applicationVersion = "1.4.2"),
        claimedMosaicProductId = "product_pro_monthly",
    )

    private class MemoryObservationStore : MosaicTransactionObservationStore {
        private var entries: List<MosaicQueuedTransactionObservation> = emptyList()
        override suspend fun read() = entries
        override suspend fun write(entries: List<MosaicQueuedTransactionObservation>) {
            this.entries = entries
        }
    }

    private companion object {
        val NOW: Long = Instant.parse("2026-07-27T12:00:00.000Z").toEpochMilli()
        const val OBSERVATION_ID = "observation_0f2b6c1a"

        /**
         * The canonical Google reference, read from the shared cross-SDK vectors rather than pinned
         * here, so a regenerated digest fails this suite instead of silently diverging from the
         * contract every other SDK asserts against.
         */
        val DIGEST: String = googlePlayTokenDigestVector("canonical-fixture-token")

        private fun googlePlayTokenDigestVector(id: String): String {
            val root = JsonParser.parseString(
                Files.readAllBytes(
                    repositoryFile("packages/test-fixtures/src/billing-reference-vectors.json"),
                ).toString(Charsets.UTF_8),
            ).asJsonObject
            return root.getAsJsonObject("googlePlayTokenDigest")
                .getAsJsonArray("vectors")
                .map { it.asJsonObject }
                .single { it.get("id").asString == id }
                .get("digest").asString
        }
    }
}
