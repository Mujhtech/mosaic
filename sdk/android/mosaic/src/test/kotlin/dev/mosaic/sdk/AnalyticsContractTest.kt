package dev.mosaic.sdk

import com.google.gson.JsonParser
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class AnalyticsContractTest {
    /**
     * Consumes the canonical invalid fixtures directly, by exact path, rather than mutating valid
     * ones. Each names a real ingestion-boundary defect: an unrelated correlation identifier or
     * attribution field silently joins an event to a different journey, and an incomplete rollout
     * tuple corrupts Placement attribution. The ownership rules must apply to v1 as well as v2 —
     * restricting them to v2 was how the v1 cases were reaching the queue.
     */
    @Test
    fun canonicalInvalidFixturesAreRejectedByOwnershipRules() {
        listOf(
            "v1/invalid/incomplete-rollout-attribution.json",
            "v1/invalid/placement-request-unrelated-correlation.json",
            "v1/invalid/placement-request-unrelated-attribution.json",
            "v2/invalid/experiment-exposure-unrelated-correlation.json",
            "v2/invalid/experiment-fallback-unrelated-attribution.json",
            "v2/invalid/partial-experiment-attribution.json",
        ).forEach { path ->
            assertThrows(
                "Expected rejection of $path",
                IllegalArgumentException::class.java,
            ) { MosaicAnalyticsCodec.decodeEvent(versionedFixture(path)) }
        }
    }

    /**
     * The backend echoes the contract version of the submitted batch. A v2 Experiment batch must be
     * acknowledged by a v2 response and a v1 batch by a v1 response; a mismatched version means the
     * server did not acknowledge what was sent, so results must not be applied. Applying them, or
     * rejecting every v2 response outright, loses Experiment exposures permanently.
     */
    @Test
    fun ingestionResponsesCarryTheEchoedContractVersionForBothContracts() {
        val v1 = MosaicAnalyticsCodec.decodeResponse(fixture("responses/mixed-result-batch.json"))
        assertEquals("1", v1.analyticsEventContractVersion)

        val v2Source = JsonParser.parseString(fixture("responses/mixed-result-batch.json")).asJsonObject
            .also { it.addProperty("analyticsEventContractVersion", "2") }.toString()
        assertEquals("2", MosaicAnalyticsCodec.decodeResponse(v2Source).analyticsEventContractVersion)

        val unsupported = JsonParser.parseString(fixture("responses/mixed-result-batch.json")).asJsonObject
            .also { it.addProperty("analyticsEventContractVersion", "3") }.toString()
        assertThrows(IllegalArgumentException::class.java) {
            MosaicAnalyticsCodec.decodeResponse(unsupported)
        }
    }

    /**
     * Experiment conversion attribution joins solely on the Experiment tuple carried by the
     * conversion event itself, and the tuple is only legal on a v2 event. If the codec rejected or
     * dropped the attributed conversion forms, every Experiment would report zero conversions with
     * no ingest rejection and no diagnostic. These fixtures are the canonical correct forms, so they
     * must decode and re-encode byte-identically — including under the per-event correlation and
     * attribution ownership allow-lists, which must permit the tuple on conversion events.
     */
    @Test
    fun canonicalAttributedConversionFixturesRoundTripExactly() {
        listOf("product-selection-attributed.json", "purchase-started-attributed.json").forEach { name ->
            val source = versionedFixture("v2/$name")
            val event = MosaicAnalyticsCodec.decodeEvent(source)
            assertEquals("2", event.eventSchemaVersion)
            assertTrue("$name must carry the Experiment tuple", event.attribution.hasExperimentTuple())
            assertEquals(
                JsonParser.parseString(source),
                JsonParser.parseString(MosaicAnalyticsCodec.encodeEvent(event)),
            )
        }
    }

    /**
     * The Experiment tuple is permitted on exactly the conversion events named by the
     * `analytics-event-v1-to-v2` MUST table and forbidden on every other event. Each case starts
     * from that event's own canonical fixture, so the only variable is the tuple. Narrowing the
     * permitted set silently zeroes Experiment conversion metrics; widening it lets an unrelated
     * event be attributed to a Variant it never influenced.
     */
    @Test
    fun experimentTupleIsPermittedOnExactlyTheConversionEvents() {
        val permitted = listOf(
            "product-selection.json", "purchase-started.json", "purchase-completed-client.json",
            "purchase-completed-provider.json", "purchase-cancelled.json", "purchase-failed.json",
        )
        val forbidden = listOf(
            "paywall-presentation.json", "placement-request.json", "restore-completed.json",
        )

        permitted.forEach { name ->
            val event = MosaicAnalyticsCodec.decodeEvent(withTuple(fixture(name)))
            assertEquals("2", event.eventSchemaVersion)
            assertTrue("$name must accept the Experiment tuple", event.attribution.hasExperimentTuple())
        }
        forbidden.forEach { name ->
            assertThrows(
                "$name must reject the Experiment tuple",
                IllegalArgumentException::class.java,
            ) { MosaicAnalyticsCodec.decodeEvent(withTuple(fixture(name))) }
        }
    }

    @Test
    fun canonicalEventsAndBatchRoundTripWithoutContractDrift() {
        val eventFiles = listOf(
            "placement-request.json", "paywall-presentation.json", "product-selection.json",
            "purchase-started.json", "purchase-completed-client.json", "purchase-completed-provider.json",
            "purchase-cancelled.json", "purchase-failed.json", "restore-completed.json",
        )
        eventFiles.forEach { name ->
            val source = fixture(name)
            val decoded = MosaicAnalyticsCodec.decodeEvent(source)
            assertEquals(JsonParser.parseString(source), JsonParser.parseString(MosaicAnalyticsCodec.encodeEvent(decoded)))
        }
        val batchSource = fixture("batches/monetization-journey.json")
        val batch = MosaicAnalyticsCodec.decodeBatch(batchSource)
        assertEquals(6, batch.events.size)
        assertEquals(JsonParser.parseString(batchSource), JsonParser.parseString(MosaicAnalyticsCodec.encodeBatch(batch)))

        val edgeSource = fixture("batches/edge-case-conformance.json")
        val edge = MosaicAnalyticsCodec.decodeBatch(edgeSource)
        assertEquals(
            listOf(
                "placement_no_paywall", "placement_fallback_used", "placement_evaluation_failed",
                "paywall_render_failed", "product_unavailable", "purchase_failed",
                "restore_nothing_found",
            ),
            edge.events.map(MosaicAnalyticsEvent::eventName),
        )
        assertEquals(JsonParser.parseString(edgeSource), JsonParser.parseString(MosaicAnalyticsCodec.encodeBatch(edge)))
    }

    @Test
    fun canonicalPartialResponsesRetainExactTypedClassifications() {
        val mixed = MosaicAnalyticsCodec.decodeResponse(fixture("responses/mixed-result-batch.json"))
        assertTrue(mixed.results[0] is MosaicAnalyticsEventResult.Accepted)
        assertTrue(mixed.results[1] is MosaicAnalyticsEventResult.Duplicate)
        assertEquals("authority_not_allowed", (mixed.results[2] as MosaicAnalyticsEventResult.PermanentlyRejected).code)
        assertEquals(10, (mixed.results[3] as MosaicAnalyticsEventResult.Retryable).retryAfterSeconds)
    }

    @Test
    fun publicRuntimeRejectsDecodedProviderAuthorityEvent() {
        val providerEvent = MosaicAnalyticsCodec.decodeEvent(fixture("purchase-completed-provider.json"))
        assertTrue(providerEvent.payload is MosaicAnalyticsPayload.ProviderCompleted)
        assertFalse(mosaicPublicRuntimeAccepts(providerEvent.payload))
    }

    @Test
    fun reconstructedEventsRejectCanonicalSemanticViolations() {
        val invalidEvents = listOf(
            mutate("placement-request.json") { it.remove("sessionId") },
            fixture("invalid/public-sdk-provider-authority.json"),
            mutate("paywall-presentation.json") {
                it.getAsJsonObject("correlation").remove("paywallPresentationId")
            },
            mutate("batches/monetization-journey.json", eventIndex = 1) {
                it.getAsJsonObject("payload").remove("bucketingAlgorithm")
            },
            mutate("purchase-failed.json") {
                it.getAsJsonObject("payload").addProperty("durationMs", 86_400_001)
            },
            mutate("purchase-failed.json") {
                it.getAsJsonObject("payload").addProperty("diagnosticCode", "Unsafe message")
            },
        )

        invalidEvents.forEach { source ->
            assertThrows(IllegalArgumentException::class.java) {
                MosaicAnalyticsCodec.decodeEvent(source)
            }
        }
    }

    @Test
    fun ingestionResponsesRejectUnknownCodesAndInvalidRetryDelay() {
        val unknownCode = JsonParser.parseString(fixture("responses/permanent-rejection.json")).asJsonObject
        unknownCode.getAsJsonArray("results")[0].asJsonObject.addProperty("code", "future_unknown_code")
        val invalidDelay = JsonParser.parseString(fixture("responses/retryable-event.json")).asJsonObject
        invalidDelay.getAsJsonArray("results")[0].asJsonObject.addProperty("retryAfterSeconds", 301)
        val unknownStatus = JsonParser.parseString(fixture("responses/permanent-rejection.json")).asJsonObject
        unknownStatus.getAsJsonArray("results")[0].asJsonObject.addProperty("status", "future_status")
        val invalidShape = JsonParser.parseString(fixture("responses/accepted-event.json")).asJsonObject
        invalidShape.getAsJsonArray("results")[0].asJsonObject.addProperty("code", "event_schema_invalid")

        listOf(unknownCode, invalidDelay, unknownStatus, invalidShape).forEach { response ->
            assertThrows(RuntimeException::class.java) {
                MosaicAnalyticsCodec.decodeResponse(response.toString())
            }
        }
    }

    private fun mutate(name: String, eventIndex: Int? = null, change: (com.google.gson.JsonObject) -> Unit): String {
        val root = JsonParser.parseString(fixture(name)).asJsonObject
        val event = eventIndex?.let { root.getAsJsonArray("events")[it].asJsonObject } ?: root
        change(event)
        return event.toString()
    }

    private fun fixture(name: String): String = Files.readAllBytes(
        repositoryFile("protocol/fixtures/analytics-event/v1/$name"),
    ).toString(Charsets.UTF_8)

    /** Promotes a canonical v1 fixture to v2 and stamps the complete Experiment tuple onto it. */
    private fun withTuple(source: String): String =
        JsonParser.parseString(source).asJsonObject.apply {
            addProperty("eventSchemaVersion", "2")
            getAsJsonObject("attribution").apply {
                addProperty("experimentId", "experiment_checkout")
                addProperty("experimentVersionId", "experiment_version_checkout_1")
                addProperty("experimentVariantId", "variant_control")
                addProperty("experimentAllocationVersion", "allocation_checkout_1")
            }
        }.toString()

    /** Explicit contract-versioned path; no fixture directory is ever scanned. */
    private fun versionedFixture(path: String): String = Files.readAllBytes(
        repositoryFile("protocol/fixtures/analytics-event/$path"),
    ).toString(Charsets.UTF_8)
}
