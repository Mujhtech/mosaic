package dev.mosaic.sdk

import com.google.gson.JsonParser
import java.nio.file.Files
import java.nio.file.Path
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Protocol conformance for the Authoritative Entitlement Contract reader.
 *
 * Every wire record is authority-wrapped, so the fixtures are driven through
 * [MosaicCustomerAuthorityCodec] and the assertions are made about the snapshot body it unwraps —
 * which is the document [MosaicCustomerEntitlementCodec] reads.
 *
 * The canonical fixtures and the digest vectors are read from the repository rather than copied, so
 * a contract change fails here instead of drifting one platform away from the other three.
 */
class CustomerEntitlementCodecTest {
    private fun fixture(relative: String): String =
        Files.readAllBytes(repositoryFile("protocol/fixtures/authoritative-entitlement/v2/$relative"))
            .toString(Charsets.UTF_8)

    private fun fixtures(directory: String): List<Path> =
        Files.list(repositoryFile("protocol/fixtures/authoritative-entitlement/v2/$directory"))
            .filter { it.fileName.toString().endsWith(".json") }
            .sorted()
            .toList()

    private fun snapshotOf(source: String): MosaicCustomerAuthorityDecoding.Snapshot =
        MosaicCustomerAuthorityCodec.decode(source) as MosaicCustomerAuthorityDecoding.Snapshot

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

    /** Every canonical snapshot fixture decodes, and both of its digests verify. */
    @Test
    fun everyCanonicalSnapshotFixtureIsAccepted() {
        val decoded = fixtures("snapshots").map { path ->
            path.fileName.toString() to snapshotOf(Files.readAllBytes(path).toString(Charsets.UTF_8))
        }
        assertEquals(12, decoded.size)
        decoded.forEach { (name, record) ->
            assertTrue(name, record.snapshotContentDigestValid)
            assertTrue(name, record.snapshotAuthorityDigestValid)
        }
        assertTrue(
            MosaicCustomerAuthorityCodec.decode(fixture("snapshot-unchanged.json")) is
                MosaicCustomerAuthorityDecoding.Unchanged,
        )
    }

    /**
     * Version zero is the constrained pending placeholder, and it is *stated* on the next sync
     * rather than omitted.
     *
     * Omitting it would read as "this client has no snapshot at all", which is a different request:
     * the server would answer with a full projection instead of confirming the placeholder.
     */
    @Test
    fun theNeverProjectedPlaceholderVersionIsSentRatherThanOmitted() {
        val request = JsonParser.parseString(
            MosaicCustomerEntitlementCodec.encodeSyncRequest(
                correlationId = "fixture-correlation-placeholder-sync",
                knownSnapshotVersion = 0L,
                entityTag = null,
                requestedEntitlementKeys = emptyList(),
            ),
        ).asJsonObject.getAsJsonObject("payload")

        assertEquals(0L, request.get("knownSnapshotVersion").asLong)
    }

    @Test
    fun versionZeroCannotCarryProjectedEntitlementState() {
        val record = JsonParser.parseString(fixture("snapshots/active-trial.json")).asJsonObject
        record.getAsJsonObject("payload").getAsJsonObject("snapshot").addProperty("snapshotVersion", 0)

        assertTrue(
            MosaicCustomerAuthorityCodec.decode(record.toString()) is
                MosaicCustomerAuthorityDecoding.Unreadable,
        )
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
        val entry = snapshotOf(fixture("snapshots/permanent-source-no-finite-expiry.json"))
            .snapshot.entries.single()
        val state = entry.state as MosaicCustomerEntitlementState.Active
        assertTrue(state.endKnown)
        assertNull(state.effectiveEnd)
    }

    /** A test-derived grant is reported as such on every surface; on Google nothing else marks it. */
    @Test
    fun testSourceGrantIsCarriedThroughDecoding() {
        val snapshot = snapshotOf(fixture("snapshots/test-source-sandbox-grant.json")).snapshot
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
        // Classified producer-side: the semantic validator guards what Mosaic emits, and the reader
        // accepts it because the document is fully interpretable. See the fixture assertion below.
        // `unchanged-scope-mismatch` joins them for a different reason: a scope is only wrong
        // relative to the reader asking, so it is refused by the runtime rather than by the codec.
        val producerSideOnly = setOf(
            "snapshot-carries-signed-payload-value.json",
            "unchanged-scope-mismatch.json",
        )
        var documentRejections = 0
        var considered = 0
        fixtures("invalid").forEach { path ->
            val name = path.fileName.toString()
            if (name == "rejection-layers.json") return@forEach
            if (name in producerSideOnly) return@forEach
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
            considered += 1
            val decoded = MosaicCustomerAuthorityCodec.decode(source)
            val expectedCacheRejection = cacheLayerRejections[name]
            if (expectedCacheRejection == null) {
                assertTrue("$name should not decode", decoded is MosaicCustomerAuthorityDecoding.Unreadable)
                documentRejections += 1
                return@forEach
            }
            // A structurally valid document the cache gate must still refuse.
            val snapshot = decoded as MosaicCustomerAuthorityDecoding.Snapshot
            val decision = MosaicCustomerEntitlementAcceptance.decide(
                cached = MosaicCustomerSnapshotBinding(
                    contractVersion = MOSAIC_AUTHORITATIVE_ENTITLEMENT_VERSION,
                    billingCustomerId = "fixture-customer-0001",
                    projectId = "fixture-project-mosaic",
                    environmentId = "fixture-environment-production",
                    snapshotVersion = 4,
                    asOfEpochMillis = mosaicContractInstantMillis("2026-07-28T11:59:58.000Z"),
                    contentDigestValid = true,
                ),
                incoming = MosaicCustomerSnapshotBinding(
                    contractVersion = MOSAIC_AUTHORITATIVE_ENTITLEMENT_VERSION,
                    billingCustomerId = snapshot.snapshot.billingCustomerId,
                    projectId = snapshot.snapshot.projectId,
                    environmentId = snapshot.snapshot.environmentId,
                    snapshotVersion = snapshot.snapshot.snapshotVersion,
                    asOfEpochMillis = snapshot.snapshot.asOfEpochMillis,
                    contentDigestValid = snapshot.snapshotContentDigestValid,
                ),
            )
            assertEquals(name, expectedCacheRejection, decision.rejection)
        }
        // Derived rather than hard-coded, so a fixture the protocol agent adds is swept on the day
        // it lands instead of on the day somebody remembers to edit a count.
        assertTrue("the canonical invalid corpus is empty", considered > 0)
        assertEquals(considered - cacheLayerRejections.size, documentRejections)
    }

    /**
     * The JWS-shaped `correlationId` fixture is accepted by the reader, on purpose.
     *
     * It is classified as a **producer-side** rejection: the semantic validator stops Mosaic from
     * emitting it. A reader that refused it would drop a customer to `unknown` because a server put
     * an odd-looking string into a field the SDK only passes through — a strictly worse outcome than
     * carrying the value. The document is fully interpretable, and interpretability is what reader
     * rejection is for.
     */
    @Test
    fun aSignedPayloadValueInAnIdentifierIsAProducerConcernNotAReaderRejection() {
        val snapshot = snapshotOf(fixture("invalid/snapshot-carries-signed-payload-value.json")).snapshot
        assertTrue(snapshot.correlationId.startsWith("eyJ"))
        // It is carried, never interpreted: the SDK does not parse it and never treats it as proof
        // of anything. This contract is not a bearer credential in any of its fields.
        assertEquals("fixture-customer-0001", snapshot.billingCustomerId)
    }

    /** The cache record survives a round trip and refuses truncation and tampering. */
    @Test
    fun cacheRecordDetectsTruncationAndTampering() {
        val source = fixture("snapshots/bounded-offline-cache.json")
        val snapshot = snapshotOf(source).snapshot
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
        val record = MosaicCustomerAuthorityCodec.decode(fixture("snapshot-unchanged.json"))
        val unchanged = (record as MosaicCustomerAuthorityDecoding.Unchanged).unchanged
        assertEquals("fixture-customer-0001", unchanged.billingCustomerId)
        assertTrue(unchanged.freshness.validUntilEpochMillis > unchanged.freshness.refreshAfterEpochMillis)
    }
}
