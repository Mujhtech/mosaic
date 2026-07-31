package dev.mosaic.sdk

import com.google.gson.GsonBuilder
import com.google.gson.JsonElement
import com.google.gson.JsonParser
import java.nio.file.Files
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ExperimentContractTest {
    private val canonicalGson = GsonBuilder().disableHtmlEscaping().create()

    @Test
    fun `delivery v3 canonical release is accepted atomically`() {
        val release = MosaicConfigurationDeliveryDecoder.decode(fixture("configuration-delivery/v3/experiment-release.json"))

        assertEquals("3", release.deliveryVersion)
        assertEquals("experiment_checkout", release.experimentAssignments.single().experimentId)
    }

    @Test
    fun `same Placement group candidates continue to the admitted Experiment`() {
        val source = deliveryWithGroupCandidates()
        val release = MosaicConfigurationDeliveryDecoder.decode(source)

        assertEquals(2, release.experimentAssignments.size)
        assertEquals(
            listOf("experiment_checkout", "experiment_upsell"),
            release.experimentAssignments.map { it.experimentId },
        )
        assertEquals(1, release.experimentAssignments.map { it.placementId }.distinct().size)
        val evaluated = MosaicExperimentAssignmentEngine.evaluateCandidates(
            release.experimentAssignments,
            MosaicIdentityState("installation_ignored", "customer_42", emptyMap(), 1),
            release.experimentAssignments.first().schedule.startsAtEpochMillis,
        )

        assertEquals(listOf("group_excluded"), evaluated.normalPlacementReasons)
        assertEquals("experiment_upsell", evaluated.assignment?.assignment?.experimentId)
    }

    @Test
    fun `stopped Delivery v3 replacement replaces the running cached release`() = runTest {
        val running = fixture("configuration-delivery/v3/experiment-release.json")
        val stopped = mutateDelivery(running) { release ->
            release.addProperty("number", release.get("number").asLong + 1)
            release.addProperty("id", "configuration_release_experiment_stopped")
            release.getAsJsonArray("experimentAssignments").single().asJsonObject
                .addProperty("lifecycle", "stopped")
        }
        val cache = MemoryCache(MosaicCachedConfiguration("\"release-running\"", running))
        val client = MosaicHostedConfigurationClient(
            transport = MosaicConfigurationTransport {
                MosaicConfigurationResponse.Modified(stopped, "\"release-stopped\"")
            },
            cache = cache,
        )

        val refresh = client.refresh()

        assertTrue(refresh is MosaicConfigurationRefreshResult.Updated)
        val updated = (refresh as MosaicConfigurationRefreshResult.Updated).configuration.release
        assertEquals(MosaicExperimentLifecycle.STOPPED, updated.experimentAssignments.single().lifecycle)
        assertEquals("\"release-stopped\"", cache.value?.etag)
        assertEquals(stopped, cache.value?.payload)
    }

    @Test
    fun `canonical assignment and group vectors match Kotlin engine`() {
        val assignment = assignment()
        val identified = MosaicExperimentAssignmentEngine.evaluate(
            assignment,
            MosaicIdentityState("installation_ignored", "customer_42", emptyMap(), 1),
            assignment.schedule.startsAtEpochMillis,
        ) as MosaicExperimentAssignmentResult.NormalPlacement
        // The canonical identified vector is excluded by the canonical mutual-exclusion group.
        assertEquals("group_excluded", identified.reason)

        val withoutGroup = assignment.copy(mutualExclusionGroup = null)
        val control = MosaicExperimentAssignmentEngine.evaluate(
            withoutGroup,
            MosaicIdentityState("installation_ignored", "customer_42", emptyMap(), 1),
            withoutGroup.schedule.startsAtEpochMillis,
        ) as MosaicExperimentAssignmentResult.Assigned
        assertEquals(1118, control.bucket)
        assertEquals("variant_control", control.variant.id)

        val treatment = MosaicExperimentAssignmentEngine.evaluate(
            withoutGroup.copy(assignmentKeyPolicy = MosaicAssignmentPolicy.INSTALLATION),
            MosaicIdentityState("installation_001", null, emptyMap(), 0),
            withoutGroup.schedule.startsAtEpochMillis,
        ) as MosaicExperimentAssignmentResult.Assigned
        assertEquals(9810, treatment.bucket)
        assertEquals("variant_treatment_a", treatment.variant.id)
    }

    @Test
    fun `schedule boundaries and unreliable time conservatively use normal placement`() {
        val assignment = assignment().copy(mutualExclusionGroup = null)
        assertEquals("time_unreliable", (MosaicExperimentAssignmentEngine.evaluate(assignment, identity(), null) as MosaicExperimentAssignmentResult.NormalPlacement).reason)
        assertTrue(MosaicExperimentAssignmentEngine.evaluate(assignment, identity(), assignment.schedule.startsAtEpochMillis) is MosaicExperimentAssignmentResult.Assigned)
        val ended = assignment.copy(schedule = assignment.schedule.copy(endsAtEpochMillis = assignment.schedule.startsAtEpochMillis + 1_000))
        assertEquals("expired", (MosaicExperimentAssignmentEngine.evaluate(ended, identity(), ended.schedule.endsAtEpochMillis) as MosaicExperimentAssignmentResult.NormalPlacement).reason)

        val anchor = MosaicTrustedTimeAnchor(1_000_000, 2_000_000, 3_000)
        assertEquals(1_001_000L, anchor.nowEpochMillis(2_001_000, 4_000))
        assertNull(anchor.nowEpochMillis(2_400_001, 4_000))
    }

    @Test
    fun `canonical analytics v2 experiment events round trip exactly`() {
        listOf("experiment-assigned.json", "experiment-exposed.json", "experiment-fallback-presented.json", "experiment-assignment-failed.json").forEach { name ->
            val source = fixture("analytics-event/v2/$name")
            val event = MosaicAnalyticsCodec.decodeEvent(source)
            assertEquals("2", event.eventSchemaVersion)
            assertEquals(JsonParser.parseString(source), JsonParser.parseString(MosaicAnalyticsCodec.encodeEvent(event)))
        }
        val batchSource = fixture("analytics-event/v2/batches/experiment-journey.json")
        val batch = MosaicAnalyticsCodec.decodeBatch(batchSource)
        assertEquals(JsonParser.parseString(batchSource), JsonParser.parseString(MosaicAnalyticsCodec.encodeBatch(batch)))
    }

    @Test
    fun `presentation acknowledgement is exactly once and QA is excluded`() {
        val acknowledgements = AtomicInteger()
        val experiment = MosaicExperimentAttribution("experiment_checkout", "experiment_version_checkout_1", "variant_control", "allocation_checkout_1")
        val state = MosaicPaywallState(
            canonicalDocument(), MockMosaicPurchaseProvider(), analyticsContext = MosaicAnalyticsPresentationContext(
                "placement_request_1", "presentation_1", MosaicAnalyticsContext(configurationDeliveryVersion = "3"),
                MosaicAnalyticsAttribution(paywallId = "paywall", paywallVersionId = "version", experimentId = experiment.experimentId, experimentVersionId = experiment.experimentVersionId, experimentVariantId = experiment.experimentVariantId, experimentAllocationVersion = experiment.experimentAllocationVersion),
                MosaicExperimentPresentationContext(experiment, "installation", MOSAIC_EXPERIMENT_BUCKETING_ALGORITHM, false, MosaicExperimentPresentationKind.VARIANT, presentedPaywallId = "paywall", presentedPaywallVersionId = "version"),
                acknowledgeExperimentPresentation = { acknowledgements.incrementAndGet() },
            ),
        )

        state.presented()
        state.presented()

        assertEquals(1, acknowledgements.get())
    }

    private fun assignment(): MosaicExperimentAssignment {
        val root = JsonParser.parseString(fixture("experiment-assignment/v1/running-ab.json")).asJsonObject
        return MosaicExperimentAssignmentDecoder.decode(root, production = true)
    }

    private fun identity() = MosaicIdentityState("installation_001", null, emptyMap(), 0)
    private fun fixture(path: String): String = Files.readAllBytes(repositoryFile("protocol/fixtures/$path")).toString(Charsets.UTF_8)

    private fun deliveryWithGroupCandidates(): String = mutateDelivery(
        fixture("configuration-delivery/v3/experiment-release.json"),
    ) { release ->
        val assignments = release.getAsJsonArray("experimentAssignments")
        val second = assignments.single().asJsonObject.deepCopy().apply {
            addProperty("experimentId", "experiment_upsell")
            addProperty("experimentVersionId", "experiment_version_upsell_1")
            addProperty("allocationVersion", "allocation_upsell_1")
        }
        assignments.add(second)
    }

    private fun mutateDelivery(source: String, mutation: (com.google.gson.JsonObject) -> Unit): String {
        val root = JsonParser.parseString(source).asJsonObject
        val release = root.getAsJsonObject("release")
        mutation(release)
        release.addProperty("contentDigest", canonicalDigest(release.deepCopy().also { it.remove("contentDigest") }))
        return root.toString()
    }

    private fun canonicalDigest(value: JsonElement): String = "sha256:" + MessageDigest.getInstance("SHA-256")
        .digest(canonicalJson(value).toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    private fun canonicalJson(value: JsonElement): String = when {
        value.isJsonNull -> "null"
        value.isJsonArray -> value.asJsonArray.joinToString(",", "[", "]") { canonicalJson(it) }
        value.isJsonObject -> value.asJsonObject.entrySet().sortedBy { it.key }.joinToString(",", "{", "}") { (key, child) ->
            "${canonicalGson.toJson(key)}:${canonicalJson(child)}"
        }
        value.asJsonPrimitive.isString -> canonicalGson.toJson(value.asString)
        value.asJsonPrimitive.isBoolean -> value.asBoolean.toString()
        else -> value.asBigDecimal.stripTrailingZeros().toPlainString()
    }

    private class MemoryCache(var value: MosaicCachedConfiguration?) : MosaicConfigurationCache {
        override suspend fun read(): MosaicCachedConfiguration? = value
        override suspend fun write(value: MosaicCachedConfiguration) { this.value = value }
    }
}
