package dev.mosaic.sdk

import com.google.gson.JsonParser
import java.nio.file.Files
import java.nio.file.Path
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Protocol conformance for the Authoritative Entitlement Contract 1 reader.
 *
 * The canonical fixtures and the digest vectors are read from the repository rather than copied, so
 * a contract change fails here instead of drifting one platform away from the other three.
 */
class CustomerEntitlementCodecTest {
    private fun fixture(relative: String): String =
        Files.readAllBytes(repositoryFile("protocol/fixtures/authoritative-entitlement/v1/$relative"))
            .toString(Charsets.UTF_8)

    private fun fixtures(directory: String): List<Path> =
        Files.list(repositoryFile("protocol/fixtures/authoritative-entitlement/v1/$directory"))
            .filter { it.fileName.toString().endsWith(".json") }
            .sorted()
            .toList()

    /**
     * The canonical serialization, byte for byte.
     *
     * Asserting the serialization as well as the digest is deliberate: when a digest disagrees, the
     * serialization says *why*, and the non-ASCII and sorting rows are the ones that actually catch
     * a broken serializer.
     */
    @Test
    fun snapshotDigestVectorTableIsSatisfied() {
        val table = JsonParser.parseString(
            Files.readAllBytes(repositoryFile("packages/test-fixtures/src/entitlement-snapshot-digest-vectors.json"))
                .toString(Charsets.UTF_8),
        ).asJsonObject

        var rows = 0
        table.getAsJsonArray("vectors").forEach { element ->
            val vector = element.asJsonObject
            val id = vector.get("id").asString
            val payload = vector.get("payload")
            val canonical = MosaicCustomerEntitlementCodec.canonicalJson(payload)
            assertEquals(id, vector.get("canonicalSerialization").asString, canonical)
            assertEquals(id, vector.get("canonicalByteLength").asInt, canonical.toByteArray(Charsets.UTF_8).size)
            assertEquals(id, vector.get("digest").asString, MosaicCustomerEntitlementCodec.digest(payload))
            rows += 1
        }
        assertEquals(9, rows)
    }

    /** Every canonical snapshot fixture decodes, and its own contentDigest verifies. */
    @Test
    fun everyCanonicalSnapshotFixtureIsAccepted() {
        val decoded = fixtures("snapshots").map { path ->
            path.fileName.toString() to
                MosaicCustomerEntitlementCodec.decodeRecord(Files.readAllBytes(path).toString(Charsets.UTF_8))
        }
        assertEquals(14, decoded.size)
        decoded.forEach { (name, record) ->
            when (name) {
                "snapshot-unchanged.json" -> assertTrue(name, record is MosaicCustomerRecordDecoding.Unchanged)
                else -> {
                    assertTrue(name, record is MosaicCustomerRecordDecoding.Snapshot)
                    assertTrue(name, (record as MosaicCustomerRecordDecoding.Snapshot).contentDigestValid)
                }
            }
        }
    }

    /**
     * A permanent source must never be reported as expiring.
     *
     * `endKnown == true` with an absent `effectiveEnd` means permanent; a reader that renders a null
     * end as "no expiry known" or borrows the subscription's end tells a lifetime purchaser their
     * access ends next month.
     */
    @Test
    fun permanentSourceCarriesNoFiniteExpiry() {
        val record = MosaicCustomerEntitlementCodec.decodeRecord(
            fixture("snapshots/permanent-source-no-finite-expiry.json"),
        )
        val entry = (record as MosaicCustomerRecordDecoding.Snapshot).snapshot.entries.single()
        val state = entry.state as MosaicCustomerEntitlementState.Active
        assertTrue(state.endKnown)
        assertNull(state.effectiveEnd)
    }

    /** A test-derived grant is reported as such on every surface; on Google nothing else marks it. */
    @Test
    fun testSourceGrantIsCarriedThroughDecoding() {
        val record = MosaicCustomerEntitlementCodec.decodeRecord(fixture("snapshots/test-source-sandbox-grant.json"))
        val snapshot = (record as MosaicCustomerRecordDecoding.Snapshot).snapshot
        assertTrue(snapshot.sources.any { it.isTestSource })
    }

    /**
     * Every invalid snapshot-layer fixture is refused, at the layer `rejection-layers.json` names.
     *
     * Two of them are structurally valid documents that only a cache-acceptance decision can refuse,
     * which is why they are driven through the acceptance gate rather than the decoder. Splitting
     * them by the recorded layer keeps the test honest about which mechanism does the work.
     */
    @Test
    fun everyInvalidSnapshotFixtureIsRefused() {
        val cacheLayerRejections = mapOf(
            "older-snapshot-version-rejected.json" to MosaicCustomerSnapshotRejection.SNAPSHOT_VERSION_NOT_NEWER,
            "different-customer-rejected.json" to MosaicCustomerSnapshotRejection.CONTENT_DIGEST_MISMATCH,
        )
        var documentRejections = 0
        fixtures("invalid").forEach { path ->
            val name = path.fileName.toString()
            if (name == "rejection-layers.json") return@forEach
            val source = Files.readAllBytes(path).toString(Charsets.UTF_8)
            val recordType = JsonParser.parseString(source).asJsonObject.get("recordType")?.asString
            // The SDK reads only the two sync-surface record types; subscription snapshots, check
            // results, and restore results reach a host through its own backend, not through here.
            if (recordType != null &&
                recordType !in setOf("customerEntitlementSnapshot", "snapshotUnchanged") &&
                name != "unknown-record-type.json" && name != "unknown-contract-version.json"
            ) {
                return@forEach
            }
            val decoded = MosaicCustomerEntitlementCodec.decodeRecord(source)
            val expectedCacheRejection = cacheLayerRejections[name]
            if (expectedCacheRejection == null) {
                assertTrue("$name should not decode", decoded is MosaicCustomerRecordDecoding.Unreadable)
                documentRejections += 1
                return@forEach
            }
            // A structurally valid document the cache gate must still refuse.
            val snapshot = decoded as MosaicCustomerRecordDecoding.Snapshot
            val decision = MosaicCustomerEntitlementAcceptance.decide(
                cached = MosaicCustomerSnapshotBinding(
                    contractVersion = "1",
                    billingCustomerId = "fixture-customer-0001",
                    projectId = "fixture-project-mosaic",
                    environmentId = "fixture-environment-production",
                    snapshotVersion = 4,
                    asOfEpochMillis = mosaicContractInstantMillis("2026-07-28T11:59:58.000Z"),
                    contentDigestValid = true,
                ),
                incoming = MosaicCustomerSnapshotBinding(
                    contractVersion = "1",
                    billingCustomerId = snapshot.snapshot.billingCustomerId,
                    projectId = snapshot.snapshot.projectId,
                    environmentId = snapshot.snapshot.environmentId,
                    snapshotVersion = snapshot.snapshot.snapshotVersion,
                    asOfEpochMillis = snapshot.snapshot.asOfEpochMillis,
                    contentDigestValid = snapshot.contentDigestValid,
                ),
            )
            assertEquals(name, expectedCacheRejection, decision.rejection)
        }
        assertEquals(16, documentRejections)
    }

    /** The cache record survives a round trip and refuses truncation and tampering. */
    @Test
    fun cacheRecordDetectsTruncationAndTampering() {
        val source = fixture("snapshots/bounded-offline-cache.json")
        val snapshot = (MosaicCustomerEntitlementCodec.decodeRecord(source) as MosaicCustomerRecordDecoding.Snapshot)
            .snapshot
        val encoded = MosaicCustomerEntitlementCodec.encodeCacheRecord(source, snapshot.freshness)

        val restored = MosaicCustomerEntitlementCodec.decodeCacheRecord(encoded)
        assertEquals(snapshot.snapshotVersion, restored?.snapshot?.snapshotVersion)
        assertEquals(86_400, restored?.window?.staleGraceSeconds)

        assertNull(MosaicCustomerEntitlementCodec.decodeCacheRecord(encoded.substring(0, encoded.length / 2)))
        assertNull(
            MosaicCustomerEntitlementCodec.decodeCacheRecord(
                encoded.replace("\"snapshotVersion\":13", "\"snapshotVersion\":99"),
            ),
        )
    }

    /**
     * A `snapshotUnchanged` record slides freshness and carries no entries.
     *
     * That absence is the point: a confirmed-current snapshot must not expire merely because it was
     * confirmed instead of resent, and equal-version re-acceptance is refused elsewhere.
     */
    @Test
    fun unchangedRecordCarriesFreshnessOnly() {
        val record = MosaicCustomerEntitlementCodec.decodeRecord(fixture("snapshots/snapshot-unchanged.json"))
        val unchanged = (record as MosaicCustomerRecordDecoding.Unchanged).unchanged
        assertEquals("fixture-customer-0001", unchanged.billingCustomerId)
        assertTrue(unchanged.freshness.validUntilEpochMillis > unchanged.freshness.refreshAfterEpochMillis)
    }
}
