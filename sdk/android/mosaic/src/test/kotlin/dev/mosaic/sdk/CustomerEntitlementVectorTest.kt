package dev.mosaic.sdk

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Cross-implementation conformance against the shared reference vectors.
 *
 * These tables are the reason the four Mosaic implementations can be said to agree at all: Go,
 * Dart, Swift, and Kotlin each drive the same rows and must produce the same answers. The vectors
 * are read from `packages/test-fixtures` rather than copied here, so a protocol change that alters
 * a row fails this suite instead of silently diverging one platform.
 */
class CustomerEntitlementVectorTest {
    private fun vectors(name: String): JsonObject =
        JsonParser.parseString(
            Files.readAllBytes(repositoryFile("packages/test-fixtures/src/$name")).toString(Charsets.UTF_8),
        ).asJsonObject

    /** Every cache-decision row, including its `cacheAction`, which is the leak-prevention half. */
    @Test
    fun cacheDecisionVectorTableIsSatisfied() {
        val table = vectors("entitlement-cache-decision-vectors.json")
        assertEquals(
            MosaicCustomerEntitlementAcceptance.SUPPORTED_CONTRACT_VERSION,
            table.get("contractVersion").asString,
        )

        var rows = 0
        table.getAsJsonArray("vectors").forEach { element ->
            val vector = element.asJsonObject
            val id = vector.get("id").asString
            val cached = vector.get("cached").takeIf { !it.isJsonNull }?.asJsonObject?.let(::binding)
            val decision = MosaicCustomerEntitlementAcceptance.decide(cached, binding(vector.getAsJsonObject("incoming")))

            assertEquals(id, vector.get("decision").asString == "accept", decision.accepted)
            assertEquals(id, vector.get("reason").asString, decision.reason)
            assertEquals(
                id,
                when (vector.get("cacheAction").asString) {
                    "replace" -> MosaicCustomerCacheAction.REPLACE
                    "preserve" -> MosaicCustomerCacheAction.PRESERVE
                    "clear" -> MosaicCustomerCacheAction.CLEAR
                    else -> error("Unknown cacheAction in vector $id.")
                },
                decision.action,
            )
            // The one rule that matters most: no rejection may ever resolve to inactive.
            assertTrue(id, vector.get("resultingAccessState").asString != "inactive")
            if (!decision.accepted) assertNotNull(id, decision.rejection)
            rows += 1
        }
        assertEquals(10, rows)
    }

    /** Every freshness row, including both clock-manipulation directions. */
    @Test
    fun freshnessVectorTableIsSatisfied() {
        val table = vectors("entitlement-freshness-vectors.json")
        val policy = table.getAsJsonObject("policy")
        // Drift guard: the shipped Kotlin tolerance is the contract's tolerance, not a copy of it.
        assertEquals(
            MosaicCustomerBoundedGracePolicy.CLOCK_SKEW_TOLERANCE_SECONDS,
            policy.get("clockSkewToleranceSeconds").asLong,
        )
        assertEquals("boundedGrace", policy.get("name").asString)

        var rows = 0
        table.getAsJsonArray("vectors").forEach { element ->
            val vector = element.asJsonObject
            val id = vector.get("id").asString
            val snapshot = vector.getAsJsonObject("snapshot")
            val window = MosaicCustomerEntitlementFreshnessWindow(
                issuedAt = snapshot.get("issuedAt").asString,
                refreshAfter = snapshot.get("refreshAfter").asString,
                validUntil = snapshot.get("validUntil").asString,
                staleGraceSeconds = snapshot.get("staleGraceSeconds").asInt,
            )
            val evaluation = MosaicCustomerBoundedGracePolicy.evaluate(
                window,
                mosaicContractInstantMillis(vector.get("deviceNow").asString),
            )
            // The vector table names states in the protocol's snake_case; the SDK vocabulary is the
            // ratified cross-platform camelCase. The mapping is written out rather than derived so
            // a renamed member fails here instead of being silently transliterated.
            val expected = when (vector.get("state").asString) {
                "fresh" -> MosaicCustomerEntitlementCacheState.FRESH
                "refresh_recommended" -> MosaicCustomerEntitlementCacheState.REFRESH_RECOMMENDED
                "stale_within_grace" -> MosaicCustomerEntitlementCacheState.STALE_WITHIN_GRACE
                "expired" -> MosaicCustomerEntitlementCacheState.EXPIRED
                else -> error("Unknown freshness state in vector $id.")
            }
            assertEquals(id, expected, evaluation.state)
            // Clock unreliability is a diagnostic that forces expired-equivalent behaviour; it is
            // deliberately not a fifth cache state, so it is asserted separately from the state.
            assertEquals(id, id == "backwards-clock-before-issued-at", evaluation.clockUnreliable)
            rows += 1
        }
        assertEquals(12, rows)
    }

    /** An unreliable clock must never be reported as a distinct cache state to a caller. */
    @Test
    fun clockUnreliabilityIsNotACacheStateMember() {
        assertFalse(
            MosaicCustomerEntitlementCacheState.entries.any { it.wireName.contains("clock") },
        )
        // The seven ratified members, in order, identical on all three SDKs.
        assertEquals(
            listOf(
                "fresh", "refreshRecommended", "staleWithinGrace",
                "expired", "missing", "invalid", "differentCustomer",
            ),
            MosaicCustomerEntitlementCacheState.entries.map { it.wireName },
        )
    }

    private fun binding(value: JsonObject) = MosaicCustomerSnapshotBinding(
        contractVersion = value.get("contractVersion").asString,
        billingCustomerId = value.get("billingCustomerId").asString,
        projectId = value.get("projectId").asString,
        environmentId = value.get("environmentId").asString,
        snapshotVersion = value.get("snapshotVersion").asLong,
        asOfEpochMillis = mosaicContractInstantMillis(value.get("asOf").asString),
        contentDigestValid = value.get("contentDigestValid").asBoolean,
    )
}
