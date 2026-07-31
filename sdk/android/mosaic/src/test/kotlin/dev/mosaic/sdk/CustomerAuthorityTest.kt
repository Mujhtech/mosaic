package dev.mosaic.sdk

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class CustomerAuthorityTest {
    @get:Rule
    val folder = TemporaryFolder()

    private fun fixture(name: String): String = Files.readAllBytes(
        repositoryFile("protocol/fixtures/authoritative-entitlement/v2/$name.json"),
    ).toString(Charsets.UTF_8)

    @Test
    fun `canonical Android v2 records decode with authority and freshness`() {
        val full = MosaicCustomerAuthorityCodec.decode(fixture("android-full-snapshot"))
            as MosaicCustomerAuthorityDecoding.Snapshot
        assertTrue(full.snapshotAuthorityDigestValid)
        assertTrue(full.snapshotContentDigestValid)
        assertEquals(5L, full.authority.epoch)
        assertEquals(MosaicCustomerAuthorityKind.MOSAIC, full.authority.kind)
        assertEquals("android", full.authority.scope.platform)

        val unchanged = MosaicCustomerAuthorityCodec.decode(fixture("android-snapshot-unchanged"))
            as MosaicCustomerAuthorityDecoding.Unchanged
        assertEquals(4L, unchanged.unchanged.snapshotVersion)
        assertEquals("2026-07-28T13:45:00.000Z", unchanged.unchanged.freshness.refreshAfter)
    }

    @Test
    fun `v2 request reports application and capabilities without CAT scope hints`() {
        val retainedDigest = JsonParser.parseString(fixture("android-sync-request")).asJsonObject
            .getAsJsonObject("payload").get("knownSnapshotAuthorityDigest").asString
        val encoded = MosaicCustomerAuthorityCodec.encodeSyncRequest(
            MosaicCustomerAuthorityRequestContext(
                MosaicCustomerAuthorityScope(
                    "fixture-project-mosaic",
                    "fixture-environment-production",
                    "fixture-application-android",
                    "android",
                ),
                "4.2.0",
            ),
            knownAuthorityEpoch = 5,
            knownSnapshotVersion = 4,
            knownSnapshotAuthorityDigest = retainedDigest,
        )
        val payload = JsonParser.parseString(encoded).asJsonObject.getAsJsonObject("payload")
        assertEquals(
            setOf("knownAuthorityEpoch", "knownSnapshotVersion", "knownSnapshotAuthorityDigest", "request"),
            payload.keySet(),
        )
        assertEquals(retainedDigest, payload.get("knownSnapshotAuthorityDigest").asString)
        val request = payload.getAsJsonObject("request")
        assertEquals("fixture-application-android", request.get("applicationId").asString)
        assertEquals("android", request.get("platform").asString)
        assertTrue(request.getAsJsonArray("capabilities").map { it.asString }.contains("authority_epoch"))
        assertFalse(encoded.contains("billingCustomerId"))
    }

    /** The verification tuple is emitted only after the exact v2 snapshot is durably retained. */
    @Test
    fun `runtime request matches canonical digest tuple only after retention`() = runTest {
        val requests = mutableListOf<String>()
        val responses = ArrayDeque(
            listOf(fixture("android-full-snapshot"), fixture("android-snapshot-unchanged")),
        )
        val runtime = runtime(
            root = folder.newFolder("request-tuple"),
            transport = { _, request ->
                requests += request
                MosaicCustomerEntitlementTransportResult.Record(responses.removeFirst(), null)
            },
        )

        assertTrue(runtime.refreshCustomerEntitlements() is MosaicCustomerEntitlementSyncResult.Updated)
        assertTrue(runtime.refreshCustomerEntitlements() is MosaicCustomerEntitlementSyncResult.Unchanged)

        val first = JsonParser.parseString(requests.first()).asJsonObject.getAsJsonObject("payload")
        assertFalse(first.has("knownAuthorityEpoch"))
        assertFalse(first.has("knownSnapshotVersion"))
        assertFalse(first.has("knownSnapshotAuthorityDigest"))
        val second = JsonParser.parseString(requests.last()).asJsonObject.getAsJsonObject("payload")
        val canonical = JsonParser.parseString(fixture("android-sync-request")).asJsonObject
            .getAsJsonObject("payload")
        assertEquals(canonical.get("knownAuthorityEpoch"), second.get("knownAuthorityEpoch"))
        assertEquals(canonical.get("knownSnapshotVersion"), second.get("knownSnapshotVersion"))
        assertEquals(
            canonical.get("knownSnapshotAuthorityDigest"),
            second.get("knownSnapshotAuthorityDigest"),
        )
    }

    /** A stale persisted binding can never authorize snapshotUnchanged for the current app. */
    @Test
    fun `stale cached scope or authority digest omits the complete verification tuple`() = runTest {
        listOf("scope", "digest").forEach { mutation ->
            val root = folder.newFolder("stale-$mutation")
            val seed = runtime(root = root) { _, _ ->
                MosaicCustomerEntitlementTransportResult.Record(fixture("android-full-snapshot"), null)
            }
            assertTrue(seed.refreshCustomerEntitlements() is MosaicCustomerEntitlementSyncResult.Updated)

            val cacheFile = root.walkTopDown().single { it.name == "snapshot.json" }
            val cached = JsonParser.parseString(cacheFile.readText()).asJsonObject
            val body = cached.getAsJsonObject("body")
            val record = body.getAsJsonObject("record")
            val payload = record.getAsJsonObject("payload")
            if (mutation == "scope") {
                payload.getAsJsonObject("authority").getAsJsonObject("scope")
                    .addProperty("applicationId", "another-application")
                val authorityBody = JsonObject().apply {
                    add("authority", payload.getAsJsonObject("authority").deepCopy())
                    add("snapshot", payload.getAsJsonObject("snapshot").deepCopy())
                }
                payload.addProperty(
                    "snapshotAuthorityDigest",
                    MosaicCustomerEntitlementCodec.digest(authorityBody),
                )
            } else {
                payload.addProperty(
                    "snapshotAuthorityDigest",
                    "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                )
            }
            cached.addProperty("integrityDigest", MosaicCustomerEntitlementCodec.digest(body))
            cacheFile.writeText(cached.toString())

            var request: String? = null
            val reopened = runtime(root = root) { _, encoded ->
                request = encoded
                MosaicCustomerEntitlementTransportResult.Record(fixture("android-full-snapshot"), null)
            }
            reopened.refreshCustomerEntitlements()
            val sent = JsonParser.parseString(requireNotNull(request)).asJsonObject.getAsJsonObject("payload")
            assertFalse(mutation, sent.has("knownAuthorityEpoch"))
            assertFalse(mutation, sent.has("knownSnapshotVersion"))
            assertFalse(mutation, sent.has("knownSnapshotAuthorityDigest"))
        }
    }

    @Test
    fun `policy unavailable atomically tombstones restart and later full recovery`() = runTest {
        val policy = JsonParser.parseString(fixture("authority-policy-unavailable")).asJsonObject.also { root ->
            root.getAsJsonObject("payload").getAsJsonObject("scope").apply {
                addProperty("applicationId", "fixture-application-android")
                addProperty("platform", "android")
            }
        }.toString()
        val decoded = MosaicCustomerAuthorityCodec.decode(policy) as MosaicCustomerAuthorityDecoding.Unavailable
        assertEquals(MosaicCustomerAuthorityUnavailableReason.POLICY_UNAVAILABLE, decoded.reason)
        assertEquals(null, decoded.minimumSupport)

        val root = folder.newFolder("policy-unavailable")
        val responses = ArrayDeque(
            listOf(fixture("android-full-snapshot"), policy, fixture("android-full-snapshot")),
        )
        val runtime = runtime(root = root) { _, _ ->
            MosaicCustomerEntitlementTransportResult.Record(responses.removeFirst(), null)
        }
        assertTrue(runtime.refreshCustomerEntitlements() is MosaicCustomerEntitlementSyncResult.Updated)
        assertTrue(runtime.refreshCustomerEntitlements() is MosaicCustomerEntitlementSyncResult.Unavailable)
        val authority = runtime.customerAuthority.value as MosaicCustomerAuthorityState.Unavailable
        assertEquals(MosaicCustomerAuthorityUnavailableReason.POLICY_UNAVAILABLE, authority.reason)
        assertEquals(null, authority.minimumSupport)
        assertTrue(runtime.customerEntitlements.value is MosaicCustomerEntitlementSnapshotState.Unavailable)
        assertTrue(runtime.checkCustomerEntitlement("pro").state is MosaicCustomerEntitlementState.Unknown)
        val storedMarker = requireNotNull(MosaicCustomerEntitlementCache(root).read(
            MosaicCustomerEntitlementCache.bindingDigest("fixture-customer-0001"),
        ))
        assertTrue(MosaicCustomerEntitlementCache.isAuthorityPolicyUnavailableMarker(storedMarker))

        val reopened = runtime(root = root) { _, _ ->
            error("A durable authority invalidation must gate cache bootstrap without network.")
        }
        assertTrue(reopened.checkCustomerEntitlement("pro").state is MosaicCustomerEntitlementState.Unknown)
        assertTrue(reopened.customerAuthority.value is MosaicCustomerAuthorityState.Unavailable)

        assertTrue(runtime.refreshCustomerEntitlements() is MosaicCustomerEntitlementSyncResult.Updated)
        assertTrue(runtime.customerAuthority.value is MosaicCustomerAuthorityState.Available)
        assertTrue(runtime.checkCustomerEntitlement("pro").state is MosaicCustomerEntitlementState.Active)
    }

    /** The invalid canonical branch must fail closed instead of republishing old active access. */
    @Test
    fun `exact forbidden-support policy fixture tombstones stale active cache`() = runTest {
        val canonicalInvalid = fixture("invalid/policy-unavailable-with-minimum-support")
        assertTrue(
            MosaicCustomerAuthorityCodec.decode(canonicalInvalid) is
                MosaicCustomerAuthorityDecoding.PolicyUnavailableWithForbiddenSupport,
        )
        val invalid = JsonParser.parseString(
            canonicalInvalid,
        ).asJsonObject.also { root ->
            root.getAsJsonObject("payload").getAsJsonObject("scope").apply {
                addProperty("applicationId", "fixture-application-android")
                addProperty("platform", "android")
            }
        }.toString()
        assertTrue(
            MosaicCustomerAuthorityCodec.decode(invalid) is
                MosaicCustomerAuthorityDecoding.PolicyUnavailableWithForbiddenSupport,
        )
        val root = folder.newFolder("invalid-policy-unavailable")
        val responses = ArrayDeque(listOf(fixture("android-full-snapshot"), invalid))
        val runtime = runtime(root = root) { _, _ ->
            MosaicCustomerEntitlementTransportResult.Record(responses.removeFirst(), null)
        }
        assertTrue(runtime.refreshCustomerEntitlements() is MosaicCustomerEntitlementSyncResult.Updated)

        val result = runtime.refreshCustomerEntitlements()

        assertTrue(result is MosaicCustomerEntitlementSyncResult.Unavailable)
        assertTrue(runtime.customerAuthority.value is MosaicCustomerAuthorityState.Unavailable)
        assertTrue(runtime.customerEntitlements.value is MosaicCustomerEntitlementSnapshotState.Unavailable)
        assertTrue(runtime.checkCustomerEntitlement("pro").state is MosaicCustomerEntitlementState.Unknown)
        val stored = requireNotNull(MosaicCustomerEntitlementCache(root).read(
            MosaicCustomerEntitlementCache.bindingDigest("fixture-customer-0001"),
        ))
        assertTrue(MosaicCustomerEntitlementCache.isAuthorityPolicyUnavailableMarker(stored))
    }

    /** Generic malformed v2 bytes are not mistaken for the narrowly recognizable policy branch. */
    @Test
    fun `unrelated malformed v2 record preserves prior cache`() = runTest {
        val malformed = JsonParser.parseString(fixture("authority-policy-unavailable")).asJsonObject.also { root ->
            root.getAsJsonObject("payload").addProperty("reason", "not_a_policy_reason")
        }.toString()
        assertTrue(MosaicCustomerAuthorityCodec.decode(malformed) is MosaicCustomerAuthorityDecoding.Unreadable)
        val responses = ArrayDeque(listOf(fixture("android-full-snapshot"), malformed))
        val runtime = runtime(root = folder.newFolder("unrelated-malformed")) { _, _ ->
            MosaicCustomerEntitlementTransportResult.Record(responses.removeFirst(), null)
        }
        assertTrue(runtime.refreshCustomerEntitlements() is MosaicCustomerEntitlementSyncResult.Updated)
        assertTrue(runtime.refreshCustomerEntitlements() is MosaicCustomerEntitlementSyncResult.Rejected)
        assertTrue(runtime.customerAuthority.value is MosaicCustomerAuthorityState.Available)
        assertTrue(runtime.checkCustomerEntitlement("pro").state is MosaicCustomerEntitlementState.Active)
    }

    /** Publication waits for the atomic tombstone commit, never racing ahead of durable state. */
    @Test
    fun `policy invalidation publishes unavailable only after tombstone commit`() = runTest {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        var blockMarker = false
        val responses = ArrayDeque(listOf(fixture("android-full-snapshot"), androidPolicyUnavailable()))
        val runtime = runtime(
            root = folder.newFolder("policy-ordering"),
            cacheCommit = { store, digest, payload, writePointer ->
                if (MosaicCustomerEntitlementCache.isAuthorityPolicyUnavailableMarker(payload) && blockMarker) {
                    entered.countDown()
                    check(release.await(5, TimeUnit.SECONDS))
                }
                store.write(digest, payload)
                if (writePointer) store.writePointer(digest)
            },
            transport = { _, _ ->
                MosaicCustomerEntitlementTransportResult.Record(responses.removeFirst(), null)
            },
        )
        assertTrue(runtime.refreshCustomerEntitlements() is MosaicCustomerEntitlementSyncResult.Updated)
        blockMarker = true

        val refresh = async(Dispatchers.Default) { runtime.refreshCustomerEntitlements() }
        assertTrue(withContext(Dispatchers.IO) { entered.await(5, TimeUnit.SECONDS) })
        assertTrue(runtime.customerAuthority.value is MosaicCustomerAuthorityState.Available)
        assertTrue(runtime.customerEntitlements.value is MosaicCustomerEntitlementSnapshotState.Available)

        release.countDown()
        assertTrue(refresh.await() is MosaicCustomerEntitlementSyncResult.Unavailable)
        assertTrue(runtime.customerEntitlements.value is MosaicCustomerEntitlementSnapshotState.Unavailable)
    }

    /** A failed tombstone stays pending and is retried before another network request. */
    @Test
    fun `failed policy tombstone gates network until atomic retry succeeds`() = runTest {
        val events = mutableListOf<String>()
        val diagnostics = mutableListOf<MosaicDiagnostic>()
        var failMarker = true
        val responses = ArrayDeque(
            listOf(fixture("android-full-snapshot"), androidPolicyUnavailable(), fixture("android-full-snapshot")),
        )
        val root = folder.newFolder("policy-retry")
        val runtime = runtime(
            root = root,
            diagnostics = MosaicDiagnosticSink(diagnostics::add),
            cacheCommit = { store, digest, payload, writePointer ->
                if (MosaicCustomerEntitlementCache.isAuthorityPolicyUnavailableMarker(payload)) {
                    events += "tombstone"
                    if (failMarker) error("disk full")
                } else {
                    events += "snapshot"
                }
                store.write(digest, payload)
                if (writePointer) store.writePointer(digest)
            },
            transport = { _, _ ->
                events += "network"
                MosaicCustomerEntitlementTransportResult.Record(responses.removeFirst(), null)
            },
        )
        assertTrue(runtime.refreshCustomerEntitlements() is MosaicCustomerEntitlementSyncResult.Updated)
        requireNotNull(MosaicCustomerEntitlementCache(root).read(
            MosaicCustomerEntitlementCache.bindingDigest("fixture-customer-0001"),
        ))
        events.clear()

        val failed = runtime.refreshCustomerEntitlements()

        assertEquals(
            MosaicCustomerEntitlementUnavailableReason.CACHE_WRITE_FAILED,
            (failed as MosaicCustomerEntitlementSyncResult.Unavailable).reason,
        )
        assertTrue(runtime.customerEntitlements.value is MosaicCustomerEntitlementSnapshotState.Unavailable)
        assertNull(
            MosaicCustomerEntitlementCache(root).read(
                MosaicCustomerEntitlementCache.bindingDigest("fixture-customer-0001"),
            ),
        )
        assertTrue(diagnostics.any { it.code == MosaicDiagnosticCode.CUSTOMER_ENTITLEMENTS_CACHE_WRITE_FAILED })

        val restarted = runtime(
            root = root,
            transport = { _, _ -> error("cold cache check must not network") },
        )
        assertFalse(
            restarted.checkCustomerEntitlement("pro").state is
                MosaicCustomerEntitlementState.Active,
        )

        failMarker = false
        events.clear()
        assertTrue(runtime.refreshCustomerEntitlements() is MosaicCustomerEntitlementSyncResult.Updated)
        assertEquals(listOf("tombstone", "network", "snapshot"), events)
        assertTrue(runtime.checkCustomerEntitlement("pro").state is MosaicCustomerEntitlementState.Active)
    }

    @Test
    fun `authority epoch outranks snapshot version and listener replays rollback`() = runTest {
        val current = fixture("android-full-snapshot")
        val olderEpoch = authorityRecord(current, authorityEpoch = 4, snapshotVersion = 99)
        val rollback = authorityRecord(
            current,
            authorityEpoch = 6,
            snapshotVersion = 1,
            kind = "source_rollback",
            transition = "rolled_back",
        )
        val responses = ArrayDeque(listOf(current, olderEpoch, rollback))
        val runtime = runtime { _, _ ->
            val body = responses.removeFirst()
            val snapshot = JsonParser.parseString(body).asJsonObject
                .getAsJsonObject("payload").getAsJsonObject("snapshot")
            MosaicCustomerEntitlementTransportResult.Record(body, snapshot.get("entityTag").asString)
        }

        assertTrue(runtime.refreshCustomerEntitlements() is MosaicCustomerEntitlementSyncResult.Updated)
        val rejected = runtime.refreshCustomerEntitlements() as MosaicCustomerEntitlementSyncResult.Rejected
        assertEquals(MosaicCustomerSnapshotRejection.AUTHORITY_EPOCH_REGRESSION, rejected.rejection)
        assertTrue(runtime.refreshCustomerEntitlements() is MosaicCustomerEntitlementSyncResult.Updated)

        val state = runtime.customerAuthority.value as MosaicCustomerAuthorityState.Available
        assertEquals(6L, state.authority.epoch)
        assertEquals(MosaicCustomerAuthorityKind.SOURCE_ROLLBACK, state.authority.kind)
        assertEquals(1L, (runtime.customerEntitlements.value as
            MosaicCustomerEntitlementSnapshotState.Available).snapshot.snapshotVersion)
    }

    /** The authority wrapper, not only its embedded v1 snapshot, must survive a cold start. */
    @Test
    fun `v2 cache replays the bound authority and accepted access`() = runTest {
        val full = fixture("android-full-snapshot")
        val first = runtime { _, _ ->
            MosaicCustomerEntitlementTransportResult.Record(full, "cs-0001-v4")
        }
        assertTrue(first.refreshCustomerEntitlements() is MosaicCustomerEntitlementSyncResult.Updated)

        val reopened = runtime { _, _ -> error("A cache read must not make a network request.") }
        assertTrue(reopened.checkCustomerEntitlement("pro").state is MosaicCustomerEntitlementState.Active)
        val replayed = reopened.customerAuthority.value as MosaicCustomerAuthorityState.Available
        assertEquals(5L, replayed.authority.epoch)
        assertEquals(MosaicCustomerAuthorityKind.MOSAIC, replayed.authority.kind)
    }

    @Test
    fun `unchanged minimum support survives restart and gates bootstrap`() = runTest {
        val root = folder.newFolder("minimum-bootstrap")
        val full = fixture("android-full-snapshot")
        val unchanged = fixture("android-snapshot-unchanged")
        val responses = ArrayDeque(listOf(full, unchanged))
        val first = runtime(
            root = root,
            transport = { _, _ -> MosaicCustomerEntitlementTransportResult.Record(responses.removeFirst(), null) },
        )
        assertTrue(first.refreshCustomerEntitlements() is MosaicCustomerEntitlementSyncResult.Updated)
        assertTrue(first.refreshCustomerEntitlements() is MosaicCustomerEntitlementSyncResult.Unchanged)

        val reportingRestart = runtime(
            root = root,
            transport = { _, _ -> error("Bootstrap must not make a network request.") },
        )
        reportingRestart.checkCustomerEntitlement("pro")
        val reported = reportingRestart.customerAuthority.value as MosaicCustomerAuthorityState.Available
        assertEquals(null, reported.minimumSupport.maximumAppVersionInclusive)
        assertEquals(
            setOf("authority_epoch", "urgent_authority_sync"),
            reported.minimumSupport.requiredCapabilities,
        )

        val digest = MosaicCustomerEntitlementCache.bindingDigest("fixture-customer-0001")
        val stored = requireNotNull(MosaicCustomerEntitlementCache(root).read(digest))
        val durable = requireNotNull(MosaicCustomerEntitlementCodec.decodeCacheRecord(stored))
        val canonical = MosaicCustomerAuthorityCodec.decode(full) as MosaicCustomerAuthorityDecoding.Snapshot
        assertEquals(canonical.snapshot.contentDigest, durable.snapshot.contentDigest)
        assertEquals(canonical.snapshotAuthorityDigest, durable.snapshotAuthorityDigest)

        val enforcingRestart = runtime(
            root = root,
            capabilities = MosaicCustomerAuthorityCodec.capabilities - "urgent_authority_sync",
            transport = { _, _ -> error("Bootstrap must not make a network request.") },
        )
        assertTrue(enforcingRestart.checkCustomerEntitlement("pro").state is MosaicCustomerEntitlementState.Unknown)
        val unsupported = enforcingRestart.customerAuthority.value as MosaicCustomerAuthorityState.Unavailable
        assertEquals(MosaicCustomerAuthorityUnavailableReason.UNSUPPORTED_CAPABILITIES, unsupported.reason)
        assertEquals(
            setOf("authority_epoch", "urgent_authority_sync"),
            unsupported.minimumSupport?.requiredCapabilities,
        )
    }

    @Test
    fun `v2 full snapshot accepts the canonical body without an HTTP entity tag`() = runTest {
        val full = fixture("android-full-snapshot")
        val runtime = runtime { _, _ -> MosaicCustomerEntitlementTransportResult.Record(full, null) }

        assertTrue(runtime.refreshCustomerEntitlements() is MosaicCustomerEntitlementSyncResult.Updated)
        assertTrue(runtime.customerAuthority.value is MosaicCustomerAuthorityState.Available)
    }

    /** Unsupported readers must never establish Mosaic authority from otherwise valid bytes. */
    @Test
    fun `minimum support gates contract SDK app window and capabilities`() = runTest {
        data class Case(
            val name: String,
            val expected: MosaicCustomerAuthorityUnavailableReason,
            val appVersion: String = "4.2.0",
            val sdkVersion: String = "2.0.0",
            val contracts: List<String> = listOf("1", "2"),
            val capabilities: List<String> = MosaicCustomerAuthorityCodec.capabilities,
        )
        val cases = listOf(
            Case("contract", MosaicCustomerAuthorityUnavailableReason.UNSUPPORTED_CONTRACT, contracts = listOf("1")),
            Case("sdk", MosaicCustomerAuthorityUnavailableReason.UNSUPPORTED_SDK_VERSION, sdkVersion = "1.9.9"),
            Case("app", MosaicCustomerAuthorityUnavailableReason.UNSUPPORTED_APP_VERSION, appVersion = "3.9.9"),
            Case(
                "capabilities",
                MosaicCustomerAuthorityUnavailableReason.UNSUPPORTED_CAPABILITIES,
                capabilities = MosaicCustomerAuthorityCodec.capabilities - "authority_scope",
            ),
        )
        val full = fixture("android-full-snapshot")

        cases.forEach { case ->
            val runtime = runtime(
                transport = { _, _ -> MosaicCustomerEntitlementTransportResult.Record(full, null) },
                root = folder.newFolder("minimum-${case.name}"),
                appVersion = case.appVersion,
                sdkVersion = case.sdkVersion,
                supportedContracts = case.contracts,
                capabilities = case.capabilities,
            )
            assertTrue(
                case.name,
                runtime.refreshCustomerEntitlements() is MosaicCustomerEntitlementSyncResult.Unavailable,
            )
            val authority = runtime.customerAuthority.value as MosaicCustomerAuthorityState.Unavailable
            assertEquals(case.name, case.expected, authority.reason)
            assertTrue(case.name, runtime.checkCustomerEntitlement("pro").state is MosaicCustomerEntitlementState.Unknown)
        }
    }

    /** A confirmation cannot slide freshness when any retained-snapshot invariant changes. */
    @Test
    fun `v2 unchanged rejects binding evaluation projection and freshness regressions`() = runTest {
        fun JsonObject.unchanged() = getAsJsonObject("payload").getAsJsonObject("unchanged")
        val mutations: List<Pair<String, (JsonObject) -> Unit>> = listOf(
            "authority-digest" to { root ->
                root.getAsJsonObject("payload").addProperty(
                    "snapshotAuthorityDigest",
                    "sha256:0000000000000000000000000000000000000000000000000000000000000000",
                )
            },
            "scope" to { root ->
                root.getAsJsonObject("payload").getAsJsonObject("authority")
                    .getAsJsonObject("scope").addProperty("applicationId", "another-application")
            },
            "customer" to { root -> root.unchanged().addProperty("billingCustomerId", "another-customer") },
            "version" to { root -> root.unchanged().addProperty("snapshotVersion", 3) },
            "entity-tag" to { root -> root.unchanged().addProperty("entityTag", "cs-0001-v3") },
            "evaluation" to { root -> root.unchanged().addProperty("asOf", "2026-07-28T11:59:57.000Z") },
            "projection" to { root ->
                root.unchanged().getAsJsonObject("projectionStatus")
                    .addProperty("lastProjectedAt", "2026-07-28T11:59:57.000Z")
            },
            "issued-at" to { root -> root.unchanged().addProperty("issuedAt", "2026-07-28T11:59:59.000Z") },
            "refresh-after" to { root ->
                root.unchanged().addProperty("refreshAfter", "2026-07-28T12:59:59.000Z")
            },
            "valid-until" to { root ->
                root.unchanged().addProperty("validUntil", "2026-08-04T11:59:59.000Z")
            },
        )
        val full = fixture("android-full-snapshot")
        val validUnchanged = fixture("android-snapshot-unchanged")

        mutations.forEach { (name, mutate) ->
            val invalid = JsonParser.parseString(validUnchanged).asJsonObject.also { root ->
                mutate(root)
            }.toString()
            val responses = ArrayDeque(listOf(full, invalid))
            val runtime = runtime(
                transport = { _, _ -> MosaicCustomerEntitlementTransportResult.Record(responses.removeFirst(), null) },
                root = folder.newFolder("unchanged-$name"),
            )

            assertTrue(name, runtime.refreshCustomerEntitlements() is MosaicCustomerEntitlementSyncResult.Updated)
            assertTrue(name, runtime.refreshCustomerEntitlements() is MosaicCustomerEntitlementSyncResult.Rejected)
        }
    }

    @Test
    fun `explicit refresh synchronizes authority before configuration`() = runTest {
        val order = mutableListOf<String>()
        val entitlementRuntime = runtime(
            transport = { _, _ ->
                order += "authority"
                MosaicCustomerEntitlementTransportResult.Unavailable("offline")
            },
            root = folder.newFolder("refresh-order"),
        )
        val client = MosaicHostedConfigurationClient(
            transport = MosaicConfigurationTransport {
                order += "configuration"
                MosaicConfigurationResponse.NotModified
            },
            cache = object : MosaicConfigurationCache {
                override suspend fun read(): MosaicCachedConfiguration? = null
                override suspend fun write(value: MosaicCachedConfiguration) = Unit
            },
            customerEntitlementRuntime = entitlementRuntime,
        )

        client.refresh()

        assertEquals(listOf("authority", "configuration"), order)
    }

    @Test
    fun `failed initial authority cache commit publishes no accepted authority`() = runTest {
        val root = folder.newFolder("commit-initial")
        val runtime = runtime(
            root = root,
            cacheCommit = { _, _, _, _ -> error("disk full") },
            transport = { _, _ ->
                MosaicCustomerEntitlementTransportResult.Record(fixture("android-full-snapshot"), null)
            },
        )

        val result = runtime.refreshCustomerEntitlements()

        assertEquals(
            MosaicCustomerEntitlementUnavailableReason.CACHE_WRITE_FAILED,
            (result as MosaicCustomerEntitlementSyncResult.Unavailable).reason,
        )
        assertTrue(runtime.customerAuthority.value is MosaicCustomerAuthorityState.Unavailable)
        assertTrue(runtime.customerEntitlements.value is MosaicCustomerEntitlementSnapshotState.Unavailable)
        assertEquals(null, MosaicCustomerEntitlementCache(root).pointer())
    }

    @Test
    fun `blocked authority cache commit publishes only after durable completion`() = runTest {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val runtime = runtime(
            root = folder.newFolder("commit-blocked"),
            cacheCommit = { store, digest, payload, writePointer ->
                entered.countDown()
                check(release.await(5, TimeUnit.SECONDS))
                store.write(digest, payload)
                if (writePointer) store.writePointer(digest)
            },
            transport = { _, _ ->
                MosaicCustomerEntitlementTransportResult.Record(fixture("android-full-snapshot"), null)
            },
        )

        val refresh = async(Dispatchers.Default) { runtime.refreshCustomerEntitlements() }
        assertTrue(withContext(Dispatchers.IO) { entered.await(5, TimeUnit.SECONDS) })
        assertTrue(runtime.customerAuthority.value is MosaicCustomerAuthorityState.Unavailable)
        assertTrue(runtime.customerEntitlements.value is MosaicCustomerEntitlementSnapshotState.Loading)

        release.countDown()
        assertTrue(refresh.await() is MosaicCustomerEntitlementSyncResult.Updated)
        assertTrue(runtime.customerAuthority.value is MosaicCustomerAuthorityState.Available)
    }

    @Test
    fun `failed newer epoch cache commit preserves prior durable and observable authority`() = runTest {
        val root = folder.newFolder("commit-epoch")
        var failCommit = false
        val full = fixture("android-full-snapshot")
        val newer = authorityRecord(full, authorityEpoch = 6, snapshotVersion = 1)
        val responses = ArrayDeque(listOf(full, newer))
        val runtime = runtime(
            root = root,
            cacheCommit = { store, digest, payload, writePointer ->
                if (failCommit) error("disk full")
                store.write(digest, payload)
                if (writePointer) store.writePointer(digest)
            },
            transport = { _, _ -> MosaicCustomerEntitlementTransportResult.Record(responses.removeFirst(), null) },
        )
        assertTrue(runtime.refreshCustomerEntitlements() is MosaicCustomerEntitlementSyncResult.Updated)
        failCommit = true

        val failed = runtime.refreshCustomerEntitlements()

        assertTrue(failed is MosaicCustomerEntitlementSyncResult.Unavailable)
        val retainedAuthority = runtime.customerAuthority.value as MosaicCustomerAuthorityState.Available
        assertEquals(5L, retainedAuthority.authority.epoch)
        val retained = runtime.customerEntitlements.value as MosaicCustomerEntitlementSnapshotState.Available
        assertEquals(4L, retained.snapshot.snapshotVersion)
        val reopened = runtime(
            root = root,
            transport = { _, _ -> error("Durable state must be read without network.") },
        )
        reopened.checkCustomerEntitlement("pro")
        assertEquals(
            5L,
            (reopened.customerAuthority.value as
                MosaicCustomerAuthorityState.Available).authority.epoch,
        )
    }

    @Test
    fun `failed unchanged cache commit does not slide durable or in-memory freshness`() = runTest {
        val root = folder.newFolder("commit-unchanged")
        var failCommit = false
        val responses = ArrayDeque(
            listOf(fixture("android-full-snapshot"), fixture("android-snapshot-unchanged")),
        )
        val runtime = runtime(
            root = root,
            cacheCommit = { store, digest, payload, writePointer ->
                if (failCommit) error("disk full")
                store.write(digest, payload)
                if (writePointer) store.writePointer(digest)
            },
            transport = { _, _ -> MosaicCustomerEntitlementTransportResult.Record(responses.removeFirst(), null) },
        )
        assertTrue(runtime.refreshCustomerEntitlements() is MosaicCustomerEntitlementSyncResult.Updated)
        failCommit = true

        assertTrue(runtime.refreshCustomerEntitlements() is MosaicCustomerEntitlementSyncResult.Unavailable)

        val digest = MosaicCustomerEntitlementCache.bindingDigest("fixture-customer-0001")
        val stored = requireNotNull(MosaicCustomerEntitlementCache(root).read(digest))
        val decoded = requireNotNull(MosaicCustomerEntitlementCodec.decodeCacheRecord(stored))
        assertEquals("2026-07-28T13:00:00.000Z", decoded.window.refreshAfter)
        assertEquals(5L, (runtime.customerAuthority.value as MosaicCustomerAuthorityState.Available).authority.epoch)
    }

    @Test
    fun `direct checks are unknown under source and source rollback authority`() = runTest {
        val full = fixture("android-full-snapshot")
        listOf(
            "source" to "stable",
            "source_rollback" to "rolled_back",
        ).forEach { (kind, transition) ->
            val record = authorityRecord(full, 5, 4, kind, transition)
            val runtime = runtime(
                root = folder.newFolder("direct-$kind"),
                transport = { _, _ -> MosaicCustomerEntitlementTransportResult.Record(record, null) },
            )

            assertTrue(kind, runtime.refreshCustomerEntitlements() is MosaicCustomerEntitlementSyncResult.Updated)
            assertTrue(kind, runtime.checkCustomerEntitlement("pro").state is MosaicCustomerEntitlementState.Unknown)
        }
    }

    @Test
    fun `legacy v1 cache reopens as authority unknown`() = runTest {
        val legacy = Files.readAllBytes(repositoryFile(
            "protocol/fixtures/authoritative-entitlement/v1/snapshots/bounded-offline-cache.json",
        )).toString(Charsets.UTF_8)
        val first = runtime { _, _ ->
            val tag = JsonParser.parseString(legacy).asJsonObject.getAsJsonObject("payload").get("entityTag").asString
            MosaicCustomerEntitlementTransportResult.Record(legacy, tag)
        }
        first.refreshCustomerEntitlements()
        val snapshotFile = folder.root.walkTopDown().single { it.name == "snapshot.json" }
        val cached = JsonParser.parseString(snapshotFile.readText()).asJsonObject
        val body = cached.getAsJsonObject("body")
        body.addProperty("cacheFormatVersion", "1")
        cached.addProperty("integrityDigest", MosaicCustomerEntitlementCodec.digest(body))
        snapshotFile.writeText(cached.toString())
        val reopened = runtime { _, _ -> error("Legacy cache must not trigger network during a read.") }
        val check = reopened.checkCustomerEntitlement("pro")
        assertTrue(check.state is MosaicCustomerEntitlementState.Unknown)
        assertTrue(reopened.customerAuthority.value is MosaicCustomerAuthorityState.Unavailable)
    }

    private fun runtime(
        root: File = folder.root,
        appVersion: String = "4.2.0",
        sdkVersion: String = "2.0.0",
        supportedContracts: List<String> = listOf("1", "2"),
        capabilities: List<String> = MosaicCustomerAuthorityCodec.capabilities,
        diagnostics: MosaicDiagnosticSink = MosaicDiagnosticSink.None,
        cacheCommit: MosaicCustomerCacheCommit = { store, digest, payload, writePointer ->
            store.write(digest, payload)
            if (writePointer) store.writePointer(digest)
        },
        transport: MosaicCustomerEntitlementTransport,
    ) = MosaicCustomerEntitlementRuntime(
        transport,
        MosaicCustomerEntitlementCache(root),
        MosaicCustomerTokenSession(
            provider = MosaicCustomerAccessTokenProvider {
                MosaicCustomerAccessTokenResult.Issued(
                    MosaicCustomerAccessToken("mosaic-customer-token-authority"),
                    "fixture-customer-0001",
                )
            },
        ),
        trustedTime = { mosaicContractInstantMillis("2026-07-28T12:15:00.000Z") },
        diagnostics = diagnostics,
        authorityRequestContext = {
            MosaicCustomerAuthorityRequestContext(
                MosaicCustomerAuthorityScope(
                    "fixture-project-mosaic",
                    "fixture-environment-production",
                    "fixture-application-android",
                    "android",
                ),
                appVersion,
                sdkVersion,
                supportedContracts,
                capabilities,
            )
        },
        authorityAware = true,
        cacheCommit = cacheCommit,
    )

    private fun androidPolicyUnavailable(): String = JsonParser.parseString(
        fixture("authority-policy-unavailable"),
    ).asJsonObject.also { root ->
        root.getAsJsonObject("payload").getAsJsonObject("scope").apply {
            addProperty("applicationId", "fixture-application-android")
            addProperty("platform", "android")
        }
    }.toString()

    private fun authorityRecord(
        source: String,
        authorityEpoch: Long,
        snapshotVersion: Long,
        kind: String = "mosaic",
        transition: String = "stabilizing",
    ): String {
        val root = JsonParser.parseString(source).asJsonObject
        val payload = root.getAsJsonObject("payload")
        val authority = payload.getAsJsonObject("authority")
        authority.addProperty("authorityEpoch", authorityEpoch)
        authority.addProperty("authorityKind", kind)
        authority.addProperty("transitionState", transition)
        if (kind == "source") authority.remove("cutoverAt")
        val snapshot = payload.getAsJsonObject("snapshot")
        snapshot.addProperty("snapshotVersion", snapshotVersion)
        snapshot.remove("previousSnapshotVersion")
        val contentBody = snapshot.deepCopy().apply { remove("contentDigest") }
        snapshot.addProperty("contentDigest", MosaicCustomerEntitlementCodec.digest(contentBody))
        val authorityBody = JsonObject().apply {
            add("authority", authority.deepCopy())
            add("snapshot", snapshot.deepCopy())
        }
        payload.addProperty("snapshotAuthorityDigest", MosaicCustomerEntitlementCodec.digest(authorityBody))
        return root.toString()
    }
}
