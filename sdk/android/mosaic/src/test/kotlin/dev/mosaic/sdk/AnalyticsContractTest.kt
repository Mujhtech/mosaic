package dev.mosaic.sdk

import com.google.gson.JsonParser
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class AnalyticsContractTest {
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
}
