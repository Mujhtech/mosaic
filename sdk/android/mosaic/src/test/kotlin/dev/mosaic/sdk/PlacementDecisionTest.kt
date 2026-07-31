package dev.mosaic.sdk

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.io.File
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlacementDecisionTest {
    private val invalidFixtureNames = listOf(
        "duplicate-priority.json",
        "fallback-cycle.json",
        "incompatible-source-operator.json",
        "invalid-condition-type.json",
        "missing-unavailable-fallback.json",
        "overdeclared-features.json",
        "qa-override-over-24h.json",
        "underdeclared-features.json",
        "unsupported-operator.json",
    )

    private val invalidDeliveryFixtureNames = invalidFixtureNames + listOf(
        "invalid-environment-mode.json",
        "production-qa-override.json",
        "release-overdeclared-compatibility.json",
        "release-underdeclared-compatibility.json",
    )

    @Test
    fun `canonical Delivery v2 and evaluator corpus produce exact decisions`() {
        val release = MosaicConfigurationDeliveryDecoder.decode(fixture("configuration-delivery/v2/advanced-release.json"))
        val ruleSet = release.placementDecisions.getValue("export_pdf")
        val corpus = JsonParser.parseString(fixture("placement-decision/v1/evaluator-conformance.json")).asJsonObject

        corpus.getAsJsonArray("cases").forEach { element ->
            val case = element.asJsonObject
            val context = context(case.getAsJsonObject("context"))
            val assignmentObject = case.getAsJsonObject("assignment")
            val assignment = MosaicAssignmentKey(
                if (assignmentObject.get("type").asString == "installation") MosaicAssignmentKeyType.INSTALLATION else MosaicAssignmentKeyType.IDENTIFIED_USER,
                assignmentObject.get("value").asString,
            )
            val result = MosaicPlacementEvaluator.evaluate(ruleSet, context, assignment)
            val expected = case.getAsJsonObject("expected")
            val expectedOutcome = expected.getAsJsonObject("outcome")
            when (expectedOutcome.get("type").asString) {
                "no_paywall" -> {
                    assertTrue(case.get("name").asString, result is MosaicEvaluationResult.NoPaywall)
                    assertEquals(expected.get("matchedRuleId")?.takeUnless { it.isJsonNull }?.asString, (result as MosaicEvaluationResult.NoPaywall).matchedRuleId)
                }
                "paywall" -> {
                    assertTrue(case.get("name").asString, result is MosaicEvaluationResult.Paywall)
                    result as MosaicEvaluationResult.Paywall
                    assertEquals(expectedOutcome.get("paywallVersionId").asString, result.paywallVersionId)
                    assertEquals(expected.get("matchedRuleId")?.takeUnless { it.isJsonNull }?.asString, result.matchedRuleId)
                }
            }
            if (expected.getAsJsonArray("fallbackPath")?.size() ?: 0 > 0) {
                assertEquals(
                    "product_unavailable",
                    MosaicPlacementEvaluator.exactFallbackTrigger(
                        ruleSet,
                        (result as MosaicEvaluationResult.Paywall).matchedRuleId,
                        context,
                    ),
                )
            }
        }
    }

    @Test
    fun `rollout matches every canonical cross-platform vector and boundary`() {
        val vectors = JsonParser.parseString(fixture("placement-decision/v1/rollout-vectors.json")).asJsonObject.getAsJsonArray("vectors")
        vectors.forEach { element ->
            val vector = element.asJsonObject
            val bucket = MosaicRollout.bucket(
                vector.string("projectId"), vector.string("environmentId"), vector.string("placementId"),
                vector.string("ruleId"), vector.string("assignmentKeyType"), vector.string("assignmentKeyValue"),
            )
            assertEquals(vector.get("bucket").asInt, bucket)
            vector.getAsJsonArray("thresholdCases").forEach { threshold ->
                val item = threshold.asJsonObject
                assertEquals(item.get("matches").asBoolean, bucket < item.get("thresholdBasisPoints").asInt)
            }
        }
    }

    @Test
    fun `malformed decision candidates reject atomically`() {
        invalidFixtureNames.forEach { name ->
            val invalidDecision = JsonParser.parseString(fixture("placement-decision/v1/invalid/$name")).asJsonObject
            val release = JsonParser.parseString(fixture("configuration-delivery/v2/advanced-release.json")).asJsonObject
            release.getAsJsonObject("release").getAsJsonArray("placementDecisions").set(0, invalidDecision)
            assertTrue(name, runCatching { MosaicConfigurationDeliveryDecoder.decode(release.toString()) }.isFailure)
        }
    }

    @Test
    fun `semantic versions reject numeric prerelease identifiers with leading zero`() {
        val malformed = JsonParser.parseString(
            """{"type":"semantic_version","value":"1.2.3-01"}""",
        ).asJsonObject

        assertTrue(runCatching { parseTypedValue(malformed, "semanticVersion") }.isFailure)
    }

    @Test
    fun `all canonical Delivery v2 releases decode with authoritative Environment mode`() {
        val expected = mapOf(
            "advanced-release.json" to MosaicDeliveryEnvironmentMode.PRODUCTION,
            "no-paywall-release.json" to MosaicDeliveryEnvironmentMode.PRODUCTION,
            "staging-qa-override-release.json" to MosaicDeliveryEnvironmentMode.STAGING,
        )

        expected.forEach { (name, mode) ->
            val release = MosaicConfigurationDeliveryDecoder.decode(fixture("configuration-delivery/v2/$name"))
            assertEquals(name, mode, release.environment.mode)
        }
    }

    @Test
    fun `canonical capability request and legacy projection fixtures match Android support`() {
        val request = JsonParser.parseString(
            fixture("configuration-delivery/v2/capability-request.json"),
        ).asJsonObject
        assertEquals(
            setOf(MOSAIC_CONFIGURATION_DELIVERY_VERSION, MOSAIC_CONFIGURATION_DELIVERY_VERSION_V2),
            request.getAsJsonArray("supportedConfigurationDeliveryVersions").map { it.asString }.toSet(),
        )
        assertTrue(
            MosaicPlacementDecisionCapabilities.features.containsAll(
                request.getAsJsonArray("supportedDecisionFeatures").map { it.asString },
            ),
        )
        assertEquals(
            setOf(MOSAIC_ROLLOUT_ALGORITHM),
            request.getAsJsonArray("supportedBucketingAlgorithms").map { it.asString }.toSet(),
        )
        val report = MosaicProtocolCapabilities.report()
        request.getAsJsonArray("supportedPaywallProtocols").single().asJsonObject
            .getAsJsonArray("capabilities")
            .forEach { element ->
                val capability = element.asJsonObject
                val name = MosaicCapabilityName.entries.single { it.wireName == capability.string("name") }
                assertTrue(report.supports(MosaicRequiredCapability(name, capability.string("version"))))
            }

        val projection = JsonParser.parseString(
            fixture("configuration-delivery/v2/legacy-projection.json"),
        ).asJsonObject
        projection.getAsJsonArray("cases").forEach { element ->
            val case = element.asJsonObject
            val expected = if (case.getAsJsonObject("defaultOutcome").string("type") == "paywall") {
                "project_default_paywall"
            } else {
                "withhold_v1_candidate"
            }
            assertEquals(case.string("name"), case.string("expected"), expected)
        }
    }

    @Test
    fun `every canonical invalid Delivery v2 candidate is rejected`() {
        invalidDeliveryFixtureNames.forEach { name ->
            assertTrue(
                name,
                runCatching {
                    MosaicConfigurationDeliveryDecoder.decode(
                        fixture("configuration-delivery/v2/invalid/$name"),
                    )
                }.isFailure,
            )
        }
    }

    @Test
    fun `invalid remote v2 retains last known valid v2 cache for offline decision`() = runTest {
        val valid = fixture("configuration-delivery/v2/advanced-release.json")
        invalidDeliveryFixtureNames.forEach { name ->
            val cache = MemoryCache(MosaicCachedConfiguration("\"release-12\"", valid))
            val client = MosaicHostedConfigurationClient(
                transport = MosaicConfigurationTransport {
                    MosaicConfigurationResponse.Modified(
                        fixture("configuration-delivery/v2/invalid/$name"),
                        "\"release-13\"",
                    )
                },
                cache = cache,
            )

            val acceptedPlacement = client.decidePlacement("export_pdf")
            val refresh = client.refresh()
            val placement = client.decidePlacement("export_pdf")

            assertTrue(name, refresh is MosaicConfigurationRefreshResult.Retained)
            assertEquals(name, acceptedPlacement, placement)
            assertEquals(name, valid, cache.value?.payload)
        }
    }

    private fun context(value: JsonObject): MosaicDecisionContext {
        val attributes = value.getAsJsonObject("attributes")?.entrySet()?.associate { (key, element) -> key to parseTypedValue(element.asJsonObject, key) }.orEmpty()
        val entitlements = value.getAsJsonObject("entitlements")?.entrySet()?.associate { (key, element) -> key to MosaicEntitlementState.valueOf(element.asString.uppercase()) }.orEmpty()
        val products = value.getAsJsonObject("products")?.entrySet()?.associate { (key, element) -> key to MosaicProductAvailability.valueOf(element.asString.uppercase()) }.orEmpty()
        return MosaicDecisionContext(
            platform = value.optionalString("platform") ?: "android",
            applicationVersion = value.optionalString("applicationVersion"),
            applicationLocale = value.optionalString("applicationLocale"),
            country = value.optionalString("country"),
            attributes = attributes,
            entitlements = entitlements,
            products = products,
        )
    }

    private fun fixture(relative: String): String = File(
        System.getProperty("mosaic.repositoryRoot"),
        "protocol/fixtures/$relative",
    ).readText()

    private fun JsonObject.string(name: String) = get(name).asString
    private fun JsonObject.optionalString(name: String) = get(name)?.takeUnless { it.isJsonNull }?.asString
    private class MemoryCache(var value: MosaicCachedConfiguration?) : MosaicConfigurationCache {
        override suspend fun read() = value
        override suspend fun write(value: MosaicCachedConfiguration) { this.value = value }
    }
}
