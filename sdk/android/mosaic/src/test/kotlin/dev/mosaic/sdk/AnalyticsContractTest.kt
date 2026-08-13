package dev.mosaic.sdk

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Analytics Event contract conformance, against the canonical corpus.
 *
 * The corpus is the Experiment journey and the events that carry Experiment attribution. The
 * non-Experiment event fixtures and the partial-ingestion response fixtures were removed with
 * Analytics Event `1` and have no successor at `2`, so the cases that consumed them are not
 * asserted here; see the SDK report for the exact list.
 */
class AnalyticsContractTest {
    /**
     * Consumes the canonical invalid fixtures directly, by exact path, rather than mutating valid
     * ones. Each names a real ingestion-boundary defect: an unrelated correlation identifier or
     * attribution field silently joins an event to a different journey, and a partial Experiment
     * tuple attributes a conversion to a Variant that cannot be identified.
     */
    @Test
    fun canonicalInvalidFixturesAreRejectedByOwnershipRules() {
        val layers = JsonParser.parseString(fixture("invalid/rejection-layers.json"))
            .asJsonObject.getAsJsonObject("layers")
        assertTrue("the canonical invalid fixture set is empty", layers.size() > 0)
        layers.keySet().forEach { name ->
            assertThrows(
                "Expected rejection of $name",
                IllegalArgumentException::class.java,
            ) { MosaicAnalyticsCodec.decodeEvent(fixture("invalid/$name")) }
        }
    }

    /**
     * The backend echoes the contract version of the submitted batch. A response that does not echo
     * it did not acknowledge what was sent, so its results must not be applied — the events are
     * retried instead, which is the difference between a delayed exposure and a lost one.
     */
    @Test
    fun ingestionResponsesCarryTheEchoedContractVersion() {
        val source = fixture("responses/accepted-exposure.json")
        assertEquals(
            MOSAIC_ANALYTICS_CONTRACT_VERSION,
            MosaicAnalyticsCodec.decodeResponse(source).analyticsEventContractVersion,
        )

        listOf("1", "3").forEach { version ->
            val relabelled = JsonParser.parseString(source).asJsonObject
                .also { it.addProperty("analyticsEventContractVersion", version) }.toString()
            assertThrows(version, IllegalArgumentException::class.java) {
                MosaicAnalyticsCodec.decodeResponse(relabelled)
            }
        }
    }

    /**
     * Experiment conversion attribution joins solely on the Experiment tuple carried by the
     * conversion event itself. If the codec rejected or dropped the attributed conversion forms,
     * every Experiment would report zero conversions with no ingest rejection and no diagnostic.
     * These fixtures are the canonical correct forms, so they must decode and re-encode
     * byte-identically — including under the per-event correlation and attribution ownership
     * allow-lists, which must permit the tuple on conversion events.
     */
    @Test
    fun canonicalAttributedConversionFixturesRoundTripExactly() {
        listOf("product-selection-attributed.json", "purchase-started-attributed.json").forEach { name ->
            val source = fixture(name)
            val event = MosaicAnalyticsCodec.decodeEvent(source)
            assertEquals(MOSAIC_ANALYTICS_CONTRACT_VERSION, event.eventSchemaVersion)
            assertTrue("$name must carry the Experiment tuple", event.attribution.hasExperimentTuple())
            assertEquals(
                JsonParser.parseString(source),
                JsonParser.parseString(MosaicAnalyticsCodec.encodeEvent(event)),
            )
        }
    }

    /**
     * An Experiment event without the tuple is unattributable, and the codec must refuse it rather
     * than emit an exposure no Variant owns. Asserted by removing one member at a time, because a
     * reader that only checked for the tuple's presence as a whole would accept a partial one.
     */
    @Test
    fun anExperimentEventWithoutACompleteTupleIsRefused() {
        val members = listOf(
            "experimentId", "experimentVersionId", "experimentVariantId", "experimentAllocationVersion",
        )
        members.forEach { member ->
            val source = JsonParser.parseString(fixture("experiment-exposed.json")).asJsonObject
            source.getAsJsonObject("attribution").remove(member)
            assertThrows(member, IllegalArgumentException::class.java) {
                MosaicAnalyticsCodec.decodeEvent(source.toString())
            }
        }
    }

    @Test
    fun canonicalEventsAndBatchRoundTripWithoutContractDrift() {
        listOf(
            "experiment-assigned.json", "experiment-exposed.json",
            "experiment-assignment-failed.json", "experiment-fallback-presented.json",
            "product-selection-attributed.json", "purchase-started-attributed.json",
        ).forEach { name ->
            val source = fixture(name)
            val decoded = MosaicAnalyticsCodec.decodeEvent(source)
            assertEquals(
                name,
                JsonParser.parseString(source),
                JsonParser.parseString(MosaicAnalyticsCodec.encodeEvent(decoded)),
            )
        }

        val batchSource = fixture("batches/experiment-journey.json")
        val batch = MosaicAnalyticsCodec.decodeBatch(batchSource)
        assertEquals(
            listOf(
                "experiment_assigned", "experiment_exposed", "product_selected",
                "purchase_started", "purchase_completed_client",
            ),
            batch.events.map(MosaicAnalyticsEvent::eventName),
        )
        assertEquals(
            JsonParser.parseString(batchSource),
            JsonParser.parseString(MosaicAnalyticsCodec.encodeBatch(batch)),
        )
    }

    @Test
    fun reconstructedEventsRejectCanonicalSemanticViolations() {
        val invalidEvents = listOf(
            mutate("purchase-started-attributed.json") { it.remove("sessionId") },
            mutate("batches/experiment-journey.json", eventIndex = 1) {
                it.getAsJsonObject("payload").remove("bucketingAlgorithm")
            },
            mutate("product-selection-attributed.json") {
                it.getAsJsonObject("correlation").remove("paywallPresentationId")
            },
            mutate("purchase-started-attributed.json") {
                it.addProperty("authority", "provider_confirmed")
            },
        )

        invalidEvents.forEach { source ->
            assertThrows(IllegalArgumentException::class.java) {
                MosaicAnalyticsCodec.decodeEvent(source)
            }
        }
    }

    @Test
    fun ingestionResponsesRejectUnknownStatusesAndInvalidResultShapes() {
        val unknownStatus = JsonParser.parseString(fixture("responses/accepted-exposure.json")).asJsonObject
        unknownStatus.getAsJsonArray("results")[0].asJsonObject.addProperty("status", "future_status")
        val invalidShape = JsonParser.parseString(fixture("responses/accepted-exposure.json")).asJsonObject
        invalidShape.getAsJsonArray("results")[0].asJsonObject.addProperty("code", "event_schema_invalid")

        listOf(unknownStatus, invalidShape).forEach { response ->
            assertThrows(RuntimeException::class.java) {
                MosaicAnalyticsCodec.decodeResponse(response.toString())
            }
        }
    }

    private fun mutate(name: String, eventIndex: Int? = null, change: (JsonObject) -> Unit): String {
        val root = JsonParser.parseString(fixture(name)).asJsonObject
        val event = eventIndex?.let { root.getAsJsonArray("events")[it].asJsonObject } ?: root
        change(event)
        return event.toString()
    }

    private fun fixture(name: String): String = Files.readAllBytes(
        repositoryFile("protocol/fixtures/analytics-event/v2/$name"),
    ).toString(Charsets.UTF_8)
}
