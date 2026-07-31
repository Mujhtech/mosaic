package dev.mosaic.sdk

import com.google.gson.GsonBuilder
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonParser

enum class MosaicCustomerAuthorityKind(val wireName: String) {
    SOURCE("source"),
    MOSAIC("mosaic"),
    SOURCE_ROLLBACK("source_rollback"),
}

enum class MosaicCustomerAuthorityTransitionState(val wireName: String) {
    STABLE("stable"),
    CUTOVER_PENDING("cutover_pending"),
    STABILIZING("stabilizing"),
    ROLLED_BACK("rolled_back"),
}

data class MosaicCustomerAuthorityScope(
    val projectId: String,
    val environmentId: String,
    val applicationId: String,
    val platform: String,
)

data class MosaicCustomerAuthority(
    val epoch: Long,
    val kind: MosaicCustomerAuthorityKind,
    val scope: MosaicCustomerAuthorityScope,
    val transitionState: MosaicCustomerAuthorityTransitionState,
    val cutoverAt: String? = null,
)

data class MosaicCustomerAuthorityMinimumSupport(
    val minimumContractVersion: String,
    val minimumSdkVersion: String,
    val minimumAppVersionInclusive: String,
    val maximumAppVersionInclusive: String? = null,
    val requiredCapabilities: Set<String>,
)

enum class MosaicCustomerAuthorityUnavailableReason(val wireName: String) {
    AUTHORITY_UNKNOWN("authority_unknown"),
    UNSUPPORTED_CONTRACT("unsupported_contract"),
    UNSUPPORTED_APP_VERSION("unsupported_app_version"),
    SCOPE_MISMATCH("scope_mismatch"),
    POLICY_UNAVAILABLE("policy_unavailable"),
    /** Local compatibility result; not currently emitted by the v2 wire schema. */
    UNSUPPORTED_SDK_VERSION("unsupported_sdk_version"),
    /** Local compatibility result; not currently emitted by the v2 wire schema. */
    UNSUPPORTED_CAPABILITIES("unsupported_capabilities"),
}

sealed interface MosaicCustomerAuthorityState {
    data class Available(
        val authority: MosaicCustomerAuthority,
        val minimumSupport: MosaicCustomerAuthorityMinimumSupport,
    ) : MosaicCustomerAuthorityState

    data class Unavailable(
        val reason: MosaicCustomerAuthorityUnavailableReason,
        val scope: MosaicCustomerAuthorityScope? = null,
        val minimumSupport: MosaicCustomerAuthorityMinimumSupport? = null,
    ) : MosaicCustomerAuthorityState
}

internal data class MosaicCustomerAuthorityRequestContext(
    val scope: MosaicCustomerAuthorityScope,
    val appVersion: String,
    val sdkVersion: String = MOSAIC_ANDROID_SDK_VERSION,
    val supportedContractVersions: List<String> = listOf("1", "2"),
    val capabilities: List<String> = MosaicCustomerAuthorityCodec.capabilities,
)

internal sealed interface MosaicCustomerAuthorityDecoding {
    data class Snapshot(
        val authority: MosaicCustomerAuthority,
        val snapshot: MosaicCustomerEntitlementSnapshot,
        val snapshotAuthorityDigest: String,
        val snapshotAuthorityDigestValid: Boolean,
        val snapshotContentDigestValid: Boolean,
        val minimumSupport: MosaicCustomerAuthorityMinimumSupport,
    ) : MosaicCustomerAuthorityDecoding

    data class Unchanged(
        val authority: MosaicCustomerAuthority,
        val unchanged: MosaicCustomerSnapshotUnchanged,
        val snapshotAuthorityDigest: String,
        val minimumSupport: MosaicCustomerAuthorityMinimumSupport,
    ) : MosaicCustomerAuthorityDecoding

    data class Unavailable(
        val scope: MosaicCustomerAuthorityScope,
        val reason: MosaicCustomerAuthorityUnavailableReason,
        val minimumSupport: MosaicCustomerAuthorityMinimumSupport?,
    ) : MosaicCustomerAuthorityDecoding

    /** Exact policy-unavailable shape made invalid only by its forbidden minimumSupport member. */
    data class PolicyUnavailableWithForbiddenSupport(
        val scope: MosaicCustomerAuthorityScope,
    ) : MosaicCustomerAuthorityDecoding

    data object Unreadable : MosaicCustomerAuthorityDecoding
}

internal object MosaicCustomerAuthorityCodec {
    const val CONTRACT_VERSION = "2"
    val capabilities = listOf(
        "authority_epoch",
        "authority_scope",
        "urgent_authority_sync",
        "mosaic_authoritative_targeting",
    )
    private val gson = GsonBuilder().disableHtmlEscaping().create()
    private val identifier = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
    private val version = Regex("^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$")
    private val digest = Regex("^sha256:[a-f0-9]{64}$")

    fun encodeSyncRequest(
        context: MosaicCustomerAuthorityRequestContext,
        knownAuthorityEpoch: Long?,
        knownSnapshotVersion: Long?,
        knownSnapshotAuthorityDigest: String? = null,
    ): String = gson.toJson(JsonObject().apply {
        addProperty("authoritativeEntitlementContractVersion", CONTRACT_VERSION)
        addProperty("recordType", "entitlementSyncRequest")
        add("payload", JsonObject().apply {
            knownAuthorityEpoch?.let { addProperty("knownAuthorityEpoch", it) }
            knownSnapshotVersion?.let { addProperty("knownSnapshotVersion", it) }
            knownSnapshotAuthorityDigest?.also { require(digest.matches(it)) }?.let {
                addProperty("knownSnapshotAuthorityDigest", it)
            }
            add("request", JsonObject().apply {
                addProperty("applicationId", context.scope.applicationId)
                addProperty("platform", "android")
                addProperty("appVersion", context.appVersion)
                addProperty("sdkVersion", context.sdkVersion)
                add("supportedContractVersions", JsonArray().apply {
                    context.supportedContractVersions.forEach(::add)
                })
                add("capabilities", JsonArray().apply { context.capabilities.forEach(::add) })
            })
        })
    })

    /** Rewrites only outer bootstrap metadata; snapshot and authority digest inputs are untouched. */
    fun withMinimumSupport(
        snapshotRecord: String,
        support: MosaicCustomerAuthorityMinimumSupport,
    ): String {
        val root = JsonParser.parseString(snapshotRecord).asJsonObject
        require(root.get("authoritativeEntitlementContractVersion").asString == CONTRACT_VERSION)
        require(root.get("recordType").asString == "customerEntitlementSnapshot")
        root.getAsJsonObject("payload").add("minimumSupport", encodeMinimumSupport(support))
        return gson.toJson(root)
    }

    fun decode(source: String): MosaicCustomerAuthorityDecoding = runCatching {
        val root = JsonParser.parseString(source).asJsonObject
        root.requireExact(setOf("authoritativeEntitlementContractVersion", "recordType", "payload"), emptySet(), "$")
        require(root.get("authoritativeEntitlementContractVersion").asString == CONTRACT_VERSION)
        val payload = root.getAsJsonObject("payload")
        when (root.get("recordType").asString) {
            "customerEntitlementSnapshot" -> decodeSnapshot(payload)
            "snapshotUnchanged" -> decodeUnchanged(payload)
            "authorityUnavailable" -> decodeUnavailable(payload)
            else -> error("Unsupported authority record.")
        }
    }.getOrElse {
        recognizePolicyUnavailableWithForbiddenSupport(source)
            ?: MosaicCustomerAuthorityDecoding.Unreadable
    }

    private fun recognizePolicyUnavailableWithForbiddenSupport(
        source: String,
    ): MosaicCustomerAuthorityDecoding.PolicyUnavailableWithForbiddenSupport? = runCatching {
        val root = JsonParser.parseString(source).asJsonObject
        root.requireExact(setOf("authoritativeEntitlementContractVersion", "recordType", "payload"), emptySet(), "$")
        require(root.get("authoritativeEntitlementContractVersion").asString == CONTRACT_VERSION)
        require(root.get("recordType").asString == "authorityUnavailable")
        val payload = root.getAsJsonObject("payload")
        payload.requireExact(setOf("scope", "result", "reason", "minimumSupport"), emptySet(), "$.payload")
        require(payload.get("result").asString == "unavailable")
        require(payload.get("reason").asString == MosaicCustomerAuthorityUnavailableReason.POLICY_UNAVAILABLE.wireName)
        decodeMinimumSupport(payload.getAsJsonObject("minimumSupport"))
        MosaicCustomerAuthorityDecoding.PolicyUnavailableWithForbiddenSupport(
            decodeScope(payload.getAsJsonObject("scope")),
        )
    }.getOrNull()

    private fun decodeSnapshot(payload: JsonObject): MosaicCustomerAuthorityDecoding.Snapshot {
        payload.requireExact(
            setOf("authority", "snapshot", "snapshotAuthorityDigest", "minimumSupport"),
            emptySet(),
            "$.payload",
        )
        val authorityElement = payload.getAsJsonObject("authority")
        val snapshotElement = payload.getAsJsonObject("snapshot")
        val decoded = MosaicCustomerEntitlementCodec.decodeRecord(JsonObject().apply {
            addProperty("authoritativeEntitlementContractVersion", "1")
            addProperty("recordType", "customerEntitlementSnapshot")
            add("payload", snapshotElement.deepCopy())
        }.toString()) as? MosaicCustomerRecordDecoding.Snapshot ?: error("Invalid embedded snapshot.")
        val statedDigest = payload.get("snapshotAuthorityDigest").asString.also { require(digest.matches(it)) }
        val digestBody = JsonObject().apply {
            add("authority", authorityElement.deepCopy())
            add("snapshot", snapshotElement.deepCopy())
        }
        return MosaicCustomerAuthorityDecoding.Snapshot(
            decodeAuthority(authorityElement),
            decoded.snapshot,
            statedDigest,
            statedDigest == MosaicCustomerEntitlementCodec.digest(digestBody),
            decoded.contentDigestValid,
            decodeMinimumSupport(payload.getAsJsonObject("minimumSupport")),
        )
    }

    private fun decodeUnchanged(payload: JsonObject): MosaicCustomerAuthorityDecoding.Unchanged {
        payload.requireExact(
            setOf("authority", "unchanged", "snapshotAuthorityDigest", "minimumSupport"),
            emptySet(),
            "$.payload",
        )
        val inner = MosaicCustomerEntitlementCodec.decodeRecord(JsonObject().apply {
            addProperty("authoritativeEntitlementContractVersion", "1")
            addProperty("recordType", "snapshotUnchanged")
            add("payload", payload.getAsJsonObject("unchanged").deepCopy())
        }.toString()) as? MosaicCustomerRecordDecoding.Unchanged ?: error("Invalid unchanged record.")
        return MosaicCustomerAuthorityDecoding.Unchanged(
            decodeAuthority(payload.getAsJsonObject("authority")),
            inner.unchanged,
            payload.get("snapshotAuthorityDigest").asString.also { require(digest.matches(it)) },
            decodeMinimumSupport(payload.getAsJsonObject("minimumSupport")),
        )
    }

    private fun decodeUnavailable(payload: JsonObject): MosaicCustomerAuthorityDecoding.Unavailable {
        require(payload.get("result").asString == "unavailable")
        val reason = MosaicCustomerAuthorityUnavailableReason.entries
            .filterNot { it in setOf(
                MosaicCustomerAuthorityUnavailableReason.UNSUPPORTED_SDK_VERSION,
                MosaicCustomerAuthorityUnavailableReason.UNSUPPORTED_CAPABILITIES,
            ) }
            .single { it.wireName == payload.get("reason").asString }
        val minimumSupport = if (reason == MosaicCustomerAuthorityUnavailableReason.POLICY_UNAVAILABLE) {
            payload.requireExact(setOf("scope", "result", "reason"), emptySet(), "$.payload")
            null
        } else {
            payload.requireExact(setOf("scope", "result", "reason", "minimumSupport"), emptySet(), "$.payload")
            decodeMinimumSupport(payload.getAsJsonObject("minimumSupport"))
        }
        return MosaicCustomerAuthorityDecoding.Unavailable(
            decodeScope(payload.getAsJsonObject("scope")),
            reason,
            minimumSupport,
        )
    }

    private fun decodeAuthority(value: JsonObject): MosaicCustomerAuthority {
        value.requireExact(
            setOf("authorityEpoch", "authorityKind", "scope", "transitionState"),
            setOf("cutoverAt"),
            "$.payload.authority",
        )
        val kind = MosaicCustomerAuthorityKind.entries.single { it.wireName == value.get("authorityKind").asString }
        val transition = MosaicCustomerAuthorityTransitionState.entries.single {
            it.wireName == value.get("transitionState").asString
        }
        val cutover = value.get("cutoverAt")?.asString?.also { mosaicContractInstantMillis(it) }
        require(if (kind == MosaicCustomerAuthorityKind.SOURCE) cutover == null else cutover != null)
        require(kind != MosaicCustomerAuthorityKind.SOURCE || transition in setOf(
            MosaicCustomerAuthorityTransitionState.STABLE,
            MosaicCustomerAuthorityTransitionState.CUTOVER_PENDING,
        ))
        return MosaicCustomerAuthority(
            value.get("authorityEpoch").asLong.also { require(it in 0..999_999_999_999) },
            kind,
            decodeScope(value.getAsJsonObject("scope")),
            transition,
            cutover,
        )
    }

    private fun decodeScope(value: JsonObject): MosaicCustomerAuthorityScope {
        value.requireExact(setOf("projectId", "environmentId", "applicationId", "platform"), emptySet(), "scope")
        fun id(name: String) = value.get(name).asString.also { require(identifier.matches(it)) }
        val platform = value.get("platform").asString.also { require(it == "ios" || it == "android") }
        return MosaicCustomerAuthorityScope(id("projectId"), id("environmentId"), id("applicationId"), platform)
    }

    private fun decodeMinimumSupport(value: JsonObject): MosaicCustomerAuthorityMinimumSupport {
        value.requireExact(
            setOf("minimumContractVersion", "minimumSdkVersion", "supportedAppVersionWindow", "requiredCapabilities"),
            emptySet(),
            "minimumSupport",
        )
        require(value.get("minimumContractVersion").asString == "2")
        val window = value.getAsJsonObject("supportedAppVersionWindow")
        window.requireExact(setOf("minimumInclusive"), setOf("maximumInclusive"), "supportedAppVersionWindow")
        fun checkedVersion(raw: String) = raw.also { require(version.matches(it)) }
        val required = value.getAsJsonArray("requiredCapabilities").map { it.asString }.toSet()
        require(required.isNotEmpty() && "authority_epoch" in required && required.all { it in capabilities })
        return MosaicCustomerAuthorityMinimumSupport(
            "2",
            checkedVersion(value.get("minimumSdkVersion").asString),
            checkedVersion(window.get("minimumInclusive").asString),
            window.get("maximumInclusive")?.asString?.let(::checkedVersion),
            required,
        )
    }

    private fun encodeMinimumSupport(value: MosaicCustomerAuthorityMinimumSupport): JsonObject = JsonObject().apply {
        addProperty("minimumContractVersion", value.minimumContractVersion)
        addProperty("minimumSdkVersion", value.minimumSdkVersion)
        add("supportedAppVersionWindow", JsonObject().apply {
            addProperty("minimumInclusive", value.minimumAppVersionInclusive)
            value.maximumAppVersionInclusive?.let { addProperty("maximumInclusive", it) }
        })
        add("requiredCapabilities", JsonArray().apply { value.requiredCapabilities.forEach(::add) })
    }
}
