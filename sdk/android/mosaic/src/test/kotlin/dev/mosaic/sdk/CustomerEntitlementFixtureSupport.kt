package dev.mosaic.sdk

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.nio.file.Files

/**
 * Shared access to the canonical Authoritative Entitlement corpus.
 *
 * Every record in that corpus is authority-wrapped, and the snapshot scenarios are authored against
 * an iOS scope. An Android reader refuses a record scoped to another platform — deliberately, and
 * [CustomerAuthorityTest] is where that refusal is asserted — so a suite whose subject is the
 * entitlement state machine re-scopes the canonical record here rather than owning a hand-built one.
 *
 * Both digests are restated after the rewrite, because the authority digest covers the authority
 * block. That is safe precisely because digest verification is not what these suites protect: it is
 * asserted in [CustomerEntitlementCodecTest] against untouched fixtures.
 */
internal const val MOSAIC_TEST_AUTHORITY_PROJECT_ID = "fixture-project-mosaic"
internal const val MOSAIC_TEST_AUTHORITY_ENVIRONMENT_ID = "fixture-environment-production"
internal const val MOSAIC_TEST_AUTHORITY_APPLICATION_ID = "fixture-application-android"

internal fun entitlementFixtureSource(relative: String): String =
    Files.readAllBytes(repositoryFile("protocol/fixtures/authoritative-entitlement/v2/$relative"))
        .toString(Charsets.UTF_8)

internal val mosaicTestAuthorityScope = MosaicCustomerAuthorityScope(
    MOSAIC_TEST_AUTHORITY_PROJECT_ID,
    MOSAIC_TEST_AUTHORITY_ENVIRONMENT_ID,
    MOSAIC_TEST_AUTHORITY_APPLICATION_ID,
    "android",
)

internal fun mosaicTestAuthorityRequestContext(
    applicationVersion: String = "4.2.0",
    sdkVersion: String = "2.0.0",
): MosaicCustomerAuthorityRequestContext = MosaicCustomerAuthorityRequestContext(
    mosaicTestAuthorityScope,
    applicationVersion,
    sdkVersion,
    listOf(MOSAIC_AUTHORITATIVE_ENTITLEMENT_VERSION),
    MosaicCustomerAuthorityCodec.capabilities,
)

/**
 * A canonical snapshot record re-scoped to Android, with both digests restated.
 *
 * [billingCustomerId] rebinds the snapshot to another customer while leaving its scope alone, which
 * is the only way to reach the customer-binding rules: the scope checks run first, so a fixture that
 * differs in *both* is refused for its environment before its customer is ever compared.
 */
internal fun androidSnapshotRecord(name: String, billingCustomerId: String? = null): String {
    val root = JsonParser.parseString(entitlementFixtureSource("snapshots/$name.json")).asJsonObject
    val payload = root.getAsJsonObject("payload")
    val authority = payload.getAsJsonObject("authority")
    authority.getAsJsonObject("scope").apply {
        addProperty("applicationId", MOSAIC_TEST_AUTHORITY_APPLICATION_ID)
        addProperty("platform", "android")
    }
    val snapshot = payload.getAsJsonObject("snapshot")
    billingCustomerId?.let {
        snapshot.addProperty("billingCustomerId", it)
        snapshot.remove("contentDigest")
        snapshot.addProperty(
            "contentDigest",
            MosaicCustomerEntitlementCodec.digest(snapshot.deepCopy()),
        )
    }
    payload.addProperty(
        "snapshotAuthorityDigest",
        MosaicCustomerEntitlementCodec.digest(
            JsonObject().apply {
                add("authority", authority.deepCopy())
                add("snapshot", snapshot.deepCopy())
            },
        ),
    )
    return root.toString()
}

/**
 * The canonical `snapshotUnchanged` record, retargeted at an accepted snapshot record.
 *
 * A confirmation is only accepted when it identifies the cached snapshot exactly — same authority,
 * same authority digest, same version, tag, `asOf`, and projection status — so it is derived from
 * the record it confirms rather than hand-built. [edit] then moves only what the caller is testing.
 */
internal fun androidUnchangedRecordFor(
    acceptedSnapshotRecord: String,
    edit: (JsonObject) -> Unit = {},
): String {
    val accepted = JsonParser.parseString(acceptedSnapshotRecord).asJsonObject.getAsJsonObject("payload")
    val snapshot = accepted.getAsJsonObject("snapshot")
    val root = JsonParser.parseString(entitlementFixtureSource("snapshot-unchanged.json")).asJsonObject
    val payload = root.getAsJsonObject("payload")
    payload.add("authority", accepted.getAsJsonObject("authority").deepCopy())
    payload.addProperty("snapshotAuthorityDigest", accepted.get("snapshotAuthorityDigest").asString)
    val unchanged = payload.getAsJsonObject("unchanged")
    listOf(
        "billingCustomerId", "projectId", "environmentId", "snapshotVersion", "entityTag",
        "issuedAt", "asOf", "refreshAfter", "validUntil",
    ).forEach { unchanged.add(it, snapshot.get(it).deepCopy()) }
    unchanged.add("projectionStatus", snapshot.getAsJsonObject("projectionStatus").deepCopy())
    edit(unchanged)
    return root.toString()
}

/** The `entityTag` of the snapshot embedded in an authority-wrapped record. */
internal fun snapshotEntityTag(record: String): String = JsonParser.parseString(record)
    .asJsonObject.getAsJsonObject("payload").getAsJsonObject("snapshot").get("entityTag").asString
