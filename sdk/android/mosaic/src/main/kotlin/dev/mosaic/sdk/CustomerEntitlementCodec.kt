package dev.mosaic.sdk

import com.google.gson.GsonBuilder
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.security.MessageDigest

/**
 * Explicit tree codec for Authoritative Entitlement Contract 1.
 *
 * Gson is used for its JSON tree and string-escaping APIs only. Nothing here is reflectively bound,
 * so R8 may rename every field in this SDK without changing a persisted or transmitted byte — the
 * same discipline the rest of Mosaic's persisted records already follow.
 *
 * Reading is closed at every level: an unknown field, record type, contract version, or enumeration
 * member rejects the whole record. The single exception is `entitlementKey`, which is Project data
 * rather than contract vocabulary: rejecting an unrecognized key would make *defining a new
 * Entitlement* a breaking change for every already-shipped SDK.
 */
internal sealed interface MosaicCustomerRecordDecoding {
    data class Snapshot(
        val snapshot: MosaicCustomerEntitlementSnapshot,
        /**
         * Carried rather than thrown: a digest mismatch is a cache **decision** (reject, preserve),
         * and the acceptance gate must see it in check order rather than as a parse failure.
         */
        val contentDigestValid: Boolean,
    ) : MosaicCustomerRecordDecoding

    data class Unchanged(val unchanged: MosaicCustomerSnapshotUnchanged) : MosaicCustomerRecordDecoding

    data class Unreadable(val rejection: MosaicCustomerSnapshotRejection) : MosaicCustomerRecordDecoding
}

/** A cached snapshot with the freshness window it is currently governed by. */
internal data class MosaicCachedCustomerEntitlements(
    val snapshot: MosaicCustomerEntitlementSnapshot,
    val window: MosaicCustomerEntitlementFreshnessWindow,
)

internal object MosaicCustomerEntitlementCodec {
    const val CONTRACT_VERSION: String = "1"
    const val CACHE_FORMAT_VERSION: String = "1"

    /** `limits.maxRecordBytes` from the compatibility manifest. */
    const val MAX_RECORD_BYTES: Int = 64 * 1024

    /** `limits.maxCacheHorizonSeconds`: 30 days over validity *and* grace combined. */
    const val MAX_CACHE_HORIZON_SECONDS: Long = 2_592_000

    private const val MAX_CACHE_RECORD_BYTES = 4 * MAX_RECORD_BYTES

    private val gson = GsonBuilder().disableHtmlEscaping().create()

    private val identifierPattern = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
    private val entitlementKeyPattern = Regex("^[a-z][a-z0-9_.-]{0,63}$")
    private val entityTagPattern = Regex("^[A-Za-z0-9._-]{8,128}$")
    private val digestPattern = Regex("^sha256:[a-f0-9]{64}$")
    private val diagnosticCodePattern = Regex("^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)+$")
    private val safeTextPattern = Regex("^[^\\r\\n\\u0000-\\u001F\\u007F]{1,240}$")

    // ------------------------------------------------------------------------------------------
    // Records
    // ------------------------------------------------------------------------------------------

    fun decodeRecord(source: String): MosaicCustomerRecordDecoding {
        if (source.toByteArray(Charsets.UTF_8).size > MAX_RECORD_BYTES) {
            return MosaicCustomerRecordDecoding.Unreadable(MosaicCustomerSnapshotRejection.MALFORMED_RECORD)
        }
        val root = runCatching { JsonParser.parseString(source).asJsonObject }.getOrNull()
            ?: return MosaicCustomerRecordDecoding.Unreadable(MosaicCustomerSnapshotRejection.MALFORMED_RECORD)

        // The version check runs before anything else is trusted: a document in an unknown version
        // cannot be relied on to have interpretable binding fields.
        val version = runCatching { root.get("authoritativeEntitlementContractVersion")?.asString }.getOrNull()
        if (version != CONTRACT_VERSION) {
            return MosaicCustomerRecordDecoding.Unreadable(
                MosaicCustomerSnapshotRejection.UNSUPPORTED_CONTRACT_VERSION,
            )
        }
        return runCatching {
            root.requireExact(
                setOf("authoritativeEntitlementContractVersion", "recordType", "payload"),
                emptySet(),
                "$",
            )
            val payload = root.getAsJsonObject("payload")
            when (root.get("recordType").asString) {
                "customerEntitlementSnapshot" -> decodeSnapshot(payload)
                "snapshotUnchanged" -> MosaicCustomerRecordDecoding.Unchanged(decodeUnchanged(payload))
                else -> MosaicCustomerRecordDecoding.Unreadable(
                    MosaicCustomerSnapshotRejection.MALFORMED_RECORD,
                )
            }
        }.getOrElse {
            MosaicCustomerRecordDecoding.Unreadable(MosaicCustomerSnapshotRejection.MALFORMED_RECORD)
        }
    }

    /**
     * Builds the sync request.
     *
     * `billingCustomerId` is deliberately **not** emitted, even though the contract permits it as a
     * hint. The Customer Access Token is the sole customer selector; a caller cannot widen access by
     * asserting an identifier, and omitting the field entirely means there is no second place where
     * a stale or wrong customer identity could be introduced. The parameter does not exist here so
     * that no future call site can reintroduce it by mistake.
     */
    fun encodeSyncRequest(
        correlationId: String,
        knownSnapshotVersion: Long?,
        entityTag: String?,
        requestedEntitlementKeys: List<String>,
    ): String {
        val payload = JsonObject().apply {
            knownSnapshotVersion?.takeIf { it > 0 }?.let { addProperty("knownSnapshotVersion", it) }
            entityTag?.let { addProperty("entityTag", it) }
            add(
                "supportedAuthoritativeEntitlementContracts",
                JsonArray().apply { add(CONTRACT_VERSION) },
            )
            requestedEntitlementKeys.takeIf { it.isNotEmpty() }?.let { keys ->
                add("requestedEntitlementKeys", JsonArray().apply { keys.forEach(::add) })
            }
            addProperty("correlationId", correlationId)
        }
        return gson.toJson(
            JsonObject().apply {
                addProperty("authoritativeEntitlementContractVersion", CONTRACT_VERSION)
                addProperty("recordType", "entitlementSyncRequest")
                add("payload", payload)
            },
        )
    }

    // ------------------------------------------------------------------------------------------
    // Cache record
    // ------------------------------------------------------------------------------------------

    /**
     * The persisted form: the accepted contract record verbatim, plus the freshness window, which a
     * `snapshotUnchanged` response slides without producing a new snapshot.
     *
     * `integrityDigest` detects local corruption and truncation. It is explicitly **not** a security
     * control: it is computed here with no secret, so anyone who can write the file can recompute
     * it. The security property this cache relies on is the private, backup-excluded directory.
     */
    fun encodeCacheRecord(record: String, window: MosaicCustomerEntitlementFreshnessWindow): String {
        val body = JsonObject().apply {
            addProperty("cacheFormatVersion", CACHE_FORMAT_VERSION)
            add(
                "freshness",
                JsonObject().apply {
                    addProperty("issuedAt", window.issuedAt)
                    addProperty("refreshAfter", window.refreshAfter)
                    addProperty("staleGraceSeconds", window.staleGraceSeconds)
                    addProperty("validUntil", window.validUntil)
                },
            )
            add("record", JsonParser.parseString(record))
        }
        val digest = digest(body)
        return gson.toJson(JsonObject().apply { add("body", body); addProperty("integrityDigest", digest) })
    }

    /** Returns null for every unreadable, truncated, tampered, or foreign-format cache entry. */
    fun decodeCacheRecord(source: String): MosaicCachedCustomerEntitlements? = runCatching {
        require(source.toByteArray(Charsets.UTF_8).size <= MAX_CACHE_RECORD_BYTES)
        val root = JsonParser.parseString(source).asJsonObject
        root.requireExact(setOf("body", "integrityDigest"), emptySet(), "$")
        val body = root.getAsJsonObject("body")
        require(root.get("integrityDigest").asString == digest(body))
        body.requireExact(setOf("cacheFormatVersion", "freshness", "record"), emptySet(), "$.body")
        require(body.get("cacheFormatVersion").asString == CACHE_FORMAT_VERSION)

        val freshness = body.getAsJsonObject("freshness")
        freshness.requireExact(
            setOf("issuedAt", "refreshAfter", "staleGraceSeconds", "validUntil"),
            emptySet(),
            "$.body.freshness",
        )
        val window = MosaicCustomerEntitlementFreshnessWindow(
            issuedAt = timestamp(freshness, "issuedAt"),
            refreshAfter = timestamp(freshness, "refreshAfter"),
            validUntil = timestamp(freshness, "validUntil"),
            staleGraceSeconds = boundedInt(freshness, "staleGraceSeconds", 0, MAX_CACHE_HORIZON_SECONDS.toInt()),
        )
        requireBoundedHorizon(window)

        val decoded = decodeRecord(gson.toJson(body.get("record")))
        require(decoded is MosaicCustomerRecordDecoding.Snapshot)
        // A cache entry whose own record fails its content digest is corrupt, not merely stale.
        require(decoded.contentDigestValid)
        MosaicCachedCustomerEntitlements(decoded.snapshot, window)
    }.getOrNull()

    // ------------------------------------------------------------------------------------------
    // Canonical serialization
    // ------------------------------------------------------------------------------------------

    /**
     * SHA-256 over the canonical serialization: minified, members ascending by UTF-16 code unit at
     * every depth, array order preserved exactly, absent members omitted, and `null` never emitted.
     *
     * Array order is normative in this contract — entries ascend by `entitlementKey`, sources by
     * `sourceId` — so sorting an array here would silently repair a document the semantic rules
     * exist to reject.
     */
    fun digest(value: JsonElement): String = "sha256:" + MessageDigest.getInstance("SHA-256")
        .digest(canonicalJson(value).toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    fun canonicalJson(value: JsonElement): String = when {
        value.isJsonNull -> throw IllegalArgumentException("null is never admissible in this contract.")
        value.isJsonArray -> value.asJsonArray.joinToString(",", "[", "]") { canonicalJson(it) }
        value.isJsonObject -> value.asJsonObject.entrySet()
            .sortedBy { it.key }
            .joinToString(",", "{", "}") { (key, child) -> "${gson.toJson(key)}:${canonicalJson(child)}" }
        value.asJsonPrimitive.isString -> gson.toJson(value.asString)
        value.asJsonPrimitive.isBoolean -> value.asBoolean.toString()
        // This contract contains no non-integer numbers, so shortest decimal form is exact.
        else -> value.asBigDecimal.stripTrailingZeros().toPlainString()
    }

    // ------------------------------------------------------------------------------------------
    // Snapshot decoding
    // ------------------------------------------------------------------------------------------

    private fun decodeSnapshot(payload: JsonObject): MosaicCustomerRecordDecoding {
        payload.requireExact(
            required = setOf(
                "snapshotId", "billingCustomerId", "projectId", "environmentId", "snapshotVersion",
                "projectionRuleVersion", "issuedAt", "asOf", "refreshAfter", "validUntil",
                "entityTag", "contentDigest", "entries", "sources", "projectionStatus",
                "changeReason", "correlationId",
            ),
            optional = setOf("previousSnapshotVersion", "staleGraceSeconds", "diagnostics"),
            path = "$.payload",
        )

        val declaredDigest = payload.get("contentDigest").asString
        require(digestPattern.matches(declaredDigest))
        val recomputed = digest(payload.deepCopy().also { it.remove("contentDigest") })

        val window = MosaicCustomerEntitlementFreshnessWindow(
            issuedAt = timestamp(payload, "issuedAt"),
            refreshAfter = timestamp(payload, "refreshAfter"),
            validUntil = timestamp(payload, "validUntil"),
            staleGraceSeconds = payload.get("staleGraceSeconds")
                ?.let { boundedInt(payload, "staleGraceSeconds", 0, MAX_CACHE_HORIZON_SECONDS.toInt()) }
                // Absent means zero, so a producer that intends bounded grace states it explicitly.
                ?: 0,
        )
        require(window.refreshAfterEpochMillis <= window.validUntilEpochMillis) {
            "refreshAfter must not be later than validUntil."
        }
        requireBoundedHorizon(window)

        val entries = payload.getAsJsonArray("entries").map { decodeEntry(it.asJsonObject) }
        val sources = payload.getAsJsonArray("sources").map { decodeSource(it.asJsonObject) }
        require(entries.size <= 200 && sources.size <= 200)

        val snapshot = MosaicCustomerEntitlementSnapshot(
            snapshotId = identifier(payload, "snapshotId"),
            billingCustomerId = identifier(payload, "billingCustomerId"),
            projectId = identifier(payload, "projectId"),
            environmentId = identifier(payload, "environmentId"),
            snapshotVersion = boundedLong(payload, "snapshotVersion", 1, 999_999_999_999),
            previousSnapshotVersion = payload.get("previousSnapshotVersion")
                ?.let { boundedLong(payload, "previousSnapshotVersion", 0, 999_999_999_999) },
            projectionRuleVersion = boundedInt(payload, "projectionRuleVersion", 1, 1_000_000),
            asOf = timestamp(payload, "asOf"),
            freshness = window,
            entityTag = payload.get("entityTag").asString.also { require(entityTagPattern.matches(it)) },
            contentDigest = declaredDigest,
            entries = entries,
            sources = sources,
            projectionStatus = decodeProjectionStatus(payload.getAsJsonObject("projectionStatus")),
            changeReason = requireNotNull(
                MosaicCustomerSnapshotChangeReason.from(payload.get("changeReason").asString),
            ),
            correlationId = identifier(payload, "correlationId"),
            diagnostics = payload.getAsJsonArray("diagnostics")
                ?.also { require(it.size() <= 10) }
                ?.map { decodeDiagnostic(it.asJsonObject) }
                .orEmpty(),
        )
        validateEntitlementGraph(snapshot)
        return MosaicCustomerRecordDecoding.Snapshot(snapshot, contentDigestValid = declaredDigest == recomputed)
    }

    private fun decodeUnchanged(payload: JsonObject): MosaicCustomerSnapshotUnchanged {
        payload.requireExact(
            required = setOf(
                "billingCustomerId", "projectId", "environmentId", "snapshotVersion", "entityTag",
                "issuedAt", "asOf", "refreshAfter", "validUntil", "projectionStatus", "correlationId",
            ),
            optional = setOf("staleGraceSeconds", "diagnostics"),
            path = "$.payload",
        )
        val window = MosaicCustomerEntitlementFreshnessWindow(
            issuedAt = timestamp(payload, "issuedAt"),
            refreshAfter = timestamp(payload, "refreshAfter"),
            validUntil = timestamp(payload, "validUntil"),
            staleGraceSeconds = payload.get("staleGraceSeconds")
                ?.let { boundedInt(payload, "staleGraceSeconds", 0, MAX_CACHE_HORIZON_SECONDS.toInt()) }
                ?: 0,
        )
        require(window.refreshAfterEpochMillis <= window.validUntilEpochMillis)
        // Enforced on the unchanged record too: otherwise the 30-day horizon could be evaded by
        // confirming a snapshot rather than reissuing it.
        requireBoundedHorizon(window)
        return MosaicCustomerSnapshotUnchanged(
            billingCustomerId = identifier(payload, "billingCustomerId"),
            projectId = identifier(payload, "projectId"),
            environmentId = identifier(payload, "environmentId"),
            snapshotVersion = boundedLong(payload, "snapshotVersion", 1, 999_999_999_999),
            entityTag = payload.get("entityTag").asString.also { require(entityTagPattern.matches(it)) },
            asOf = timestamp(payload, "asOf"),
            freshness = window,
            projectionStatus = decodeProjectionStatus(payload.getAsJsonObject("projectionStatus")),
            correlationId = identifier(payload, "correlationId"),
        )
    }

    private fun decodeEntry(value: JsonObject): MosaicCustomerEntitlementEntry {
        value.requireExact(
            required = setOf(
                "entitlementId", "entitlementKey", "state", "endKnown", "sourceIds", "sourceCount",
                "primaryExplanation",
            ),
            optional = setOf("effectiveStart", "effectiveEnd", "refreshRecommendedAt", "uncertainty"),
            path = "$.payload.entries[]",
        )
        val key = value.get("entitlementKey").asString
        require(entitlementKeyPattern.matches(key))
        val explanation = decodeExplanation(value.getAsJsonObject("primaryExplanation"))
        val endKnown = value.get("endKnown").asBoolean
        val effectiveEnd = value.get("effectiveEnd")?.let { timestamp(value, "effectiveEnd") }
        require(endKnown || effectiveEnd == null) {
            "An uncertain end must not carry an effectiveEnd; a reader must display no expiry at all."
        }
        val uncertainty = value.get("uncertainty")?.let { decodeUncertainty(value.getAsJsonObject("uncertainty")) }

        val state = when (val declared = value.get("state").asString) {
            "active" -> MosaicCustomerEntitlementState.Active(
                explanation = explanation,
                effectiveStart = timestamp(value, "effectiveStart"),
                effectiveEnd = effectiveEnd,
                endKnown = endKnown,
            )
            "inactive" -> MosaicCustomerEntitlementState.Inactive(explanation)
            "unknown" -> MosaicCustomerEntitlementState.Unknown(
                explanation,
                requireNotNull(uncertainty) { "An unknown entry must explain itself." }
                    .also { require(it.reason != MosaicCustomerUncertaintyReason.NONE) },
            )
            // "unavailable" is a service state and is structurally inadmissible inside an immutable
            // snapshot: a service failure must never be persisted as customer state.
            else -> throw IllegalArgumentException("Unsupported persisted entitlement state $declared.")
        }

        val sourceIds = value.getAsJsonArray("sourceIds").map { it.asString.also(::requireIdentifier) }
        require(sourceIds.size == sourceIds.toSet().size && sourceIds.size <= 64)
        require(sourceIds == sourceIds.sorted()) { "sourceIds must ascend." }
        val sourceCount = boundedInt(value, "sourceCount", 0, 64)
        require(sourceCount == sourceIds.size) { "sourceCount must equal the number of sourceIds." }

        return MosaicCustomerEntitlementEntry(
            entitlementId = identifier(value, "entitlementId"),
            entitlementKey = key,
            state = state,
            sourceIds = sourceIds,
            sourceCount = sourceCount,
            refreshRecommendedAt = value.get("refreshRecommendedAt")?.let { timestamp(value, "refreshRecommendedAt") },
        )
    }

    private fun decodeSource(value: JsonObject): MosaicCustomerEntitlementSource {
        value.requireExact(
            required = setOf(
                "sourceId", "sourceType", "mosaicProductId", "grantVersionId", "sourceSnapshotId",
                "start", "sourceState", "uncertainty", "explanationCode", "isTestSource",
            ),
            optional = setOf("subscriptionInstanceId", "oneTimePurchaseInstanceId", "storePlatform", "end"),
            path = "$.payload.sources[]",
        )
        val sourceType = requireNotNull(MosaicCustomerSourceType.from(value.get("sourceType").asString))
        val subscriptionInstanceId = value.get("subscriptionInstanceId")?.let { identifier(value, "subscriptionInstanceId") }
        val oneTimePurchaseInstanceId = value.get("oneTimePurchaseInstanceId")?.let { identifier(value, "oneTimePurchaseInstanceId") }
        if (sourceType == MosaicCustomerSourceType.ONE_TIME_NON_CONSUMABLE) {
            require(oneTimePurchaseInstanceId != null && subscriptionInstanceId == null)
        } else {
            require(subscriptionInstanceId != null && oneTimePurchaseInstanceId == null)
        }
        val sourceState = requireNotNull(MosaicCustomerSourceState.from(value.get("sourceState").asString))
        val uncertainty = decodeUncertainty(value.getAsJsonObject("uncertainty"))
        if (sourceState == MosaicCustomerSourceState.UNKNOWN) {
            require(uncertainty.reason != MosaicCustomerUncertaintyReason.NONE)
        }
        return MosaicCustomerEntitlementSource(
            sourceId = identifier(value, "sourceId"),
            sourceType = sourceType,
            subscriptionInstanceId = subscriptionInstanceId,
            oneTimePurchaseInstanceId = oneTimePurchaseInstanceId,
            mosaicProductId = identifier(value, "mosaicProductId"),
            grantVersionId = identifier(value, "grantVersionId"),
            sourceSnapshotId = identifier(value, "sourceSnapshotId"),
            storePlatform = value.get("storePlatform")
                ?.let { requireNotNull(MosaicCustomerStorePlatform.from(it.asString)) },
            start = timestamp(value, "start"),
            end = value.get("end")?.let { timestamp(value, "end") },
            sourceState = sourceState,
            uncertainty = uncertainty,
            explanationCode = requireNotNull(
                MosaicCustomerEntitlementExplanationCode.from(value.get("explanationCode").asString),
            ),
            isTestSource = value.get("isTestSource").asBoolean,
        )
    }

    private fun decodeExplanation(value: JsonObject): MosaicCustomerEntitlementExplanation {
        value.requireExact(setOf("code"), setOf("sourceId", "safeSummary"), "primaryExplanation")
        val summary = value.get("safeSummary")?.asString
        require(summary == null || safeTextPattern.matches(summary))
        return MosaicCustomerEntitlementExplanation(
            code = requireNotNull(MosaicCustomerEntitlementExplanationCode.from(value.get("code").asString)),
            sourceId = value.get("sourceId")?.let { identifier(value, "sourceId") },
            safeSummary = summary,
        )
    }

    private fun decodeUncertainty(value: JsonObject): MosaicCustomerUncertainty {
        value.requireExact(
            setOf("reason"),
            setOf("since", "expectedResolution", "diagnosticCode"),
            "uncertainty",
        )
        val reason = requireNotNull(MosaicCustomerUncertaintyReason.from(value.get("reason").asString))
        val since = value.get("since")?.let { timestamp(value, "since") }
        // The pairing is enforced in both directions: a definite state has no `since`, and a
        // non-definite one must say when it started.
        require((reason == MosaicCustomerUncertaintyReason.NONE) == (since == null))
        val diagnosticCode = value.get("diagnosticCode")?.asString
        require(diagnosticCode == null || diagnosticCodePattern.matches(diagnosticCode))
        return MosaicCustomerUncertainty(
            reason = reason,
            since = since,
            expectedResolution = value.get("expectedResolution")
                ?.let { requireNotNull(MosaicCustomerExpectedResolution.from(it.asString)) },
            diagnosticCode = diagnosticCode,
        )
    }

    private fun decodeProjectionStatus(value: JsonObject): MosaicCustomerProjectionStatus {
        value.requireExact(
            setOf("state", "lastProjectedAt"),
            setOf("pendingFactCount", "diagnosticCode"),
            "projectionStatus",
        )
        val state = requireNotNull(MosaicCustomerProjectionState.from(value.get("state").asString))
        val pending = value.get("pendingFactCount")?.let { boundedInt(value, "pendingFactCount", 0, 1_000_000) }
        val diagnosticCode = value.get("diagnosticCode")?.asString
        require(diagnosticCode == null || diagnosticCodePattern.matches(diagnosticCode))
        if (state == MosaicCustomerProjectionState.PENDING) require(pending != null)
        if (state == MosaicCustomerProjectionState.DEGRADED || state == MosaicCustomerProjectionState.FAILED) {
            require(diagnosticCode != null)
        }
        return MosaicCustomerProjectionStatus(state, timestamp(value, "lastProjectedAt"), pending, diagnosticCode)
    }

    private fun decodeDiagnostic(value: JsonObject): MosaicCustomerEntitlementDiagnostic {
        value.requireExact(
            setOf("code", "safeMessage", "severity", "retryable", "correlationId"),
            setOf("retryAfterSeconds", "recoveryAction"),
            "diagnostic",
        )
        val code = value.get("code").asString
        require(diagnosticCodePattern.matches(code))
        val message = value.get("safeMessage").asString
        require(safeTextPattern.matches(message))
        val severity = value.get("severity").asString
        require(severity in setOf("info", "warning", "error"))
        val recovery = value.get("recoveryAction")?.asString
        require(
            recovery == null || recovery in setOf(
                "retry", "refreshCustomerAccessToken", "requestAuthoritativeSync",
                "resolveIdentityConflict", "fixProductMapping", "contactProvider", "none",
            ),
        )
        return MosaicCustomerEntitlementDiagnostic(
            code = code,
            safeMessage = message,
            severity = severity,
            retryable = value.get("retryable").asBoolean,
            correlationId = identifier(value, "correlationId"),
            retryAfterSeconds = value.get("retryAfterSeconds")?.let { boundedInt(value, "retryAfterSeconds", 1, 86_400) },
            recoveryAction = recovery,
        )
    }

    /**
     * The semantic rules no JSON Schema can express.
     *
     * The two access rules are the projection's half of the contract's top rule: an active entry
     * always has a reason, and unresolved evidence yields `unknown` rather than `inactive`.
     */
    private fun validateEntitlementGraph(snapshot: MosaicCustomerEntitlementSnapshot) {
        val keys = snapshot.entries.map { it.entitlementKey }
        require(keys == keys.sorted() && keys.size == keys.toSet().size) {
            "Entries must ascend by entitlementKey and be unique."
        }
        val sourceIds = snapshot.sources.map { it.sourceId }
        require(sourceIds == sourceIds.sorted() && sourceIds.size == sourceIds.toSet().size) {
            "Sources must ascend by sourceId and be unique."
        }
        val byId = snapshot.sources.associateBy { it.sourceId }
        val referenced = mutableSetOf<String>()
        snapshot.entries.forEach { entry ->
            val contributing = entry.sourceIds.map { id ->
                requireNotNull(byId[id]) { "An entry references a source the snapshot does not carry." }
            }
            referenced += entry.sourceIds
            when (entry.state) {
                is MosaicCustomerEntitlementState.Active -> require(
                    contributing.any { it.sourceState == MosaicCustomerSourceState.GRANTING },
                ) { "An active Entitlement always has a granting source." }
                is MosaicCustomerEntitlementState.Inactive -> require(
                    contributing.none {
                        it.sourceState == MosaicCustomerSourceState.GRANTING ||
                            it.sourceState == MosaicCustomerSourceState.UNKNOWN
                    },
                ) { "Unresolved evidence yields unknown, never inactive." }
                else -> Unit
            }
        }
        require(referenced.containsAll(sourceIds)) {
            "Every source must be accounted for by at least one entry."
        }
    }

    // ------------------------------------------------------------------------------------------
    // Primitives
    // ------------------------------------------------------------------------------------------

    private fun requireBoundedHorizon(window: MosaicCustomerEntitlementFreshnessWindow) {
        val horizonSeconds =
            (window.validUntilEpochMillis - window.issuedAtEpochMillis) / 1_000 + window.staleGraceSeconds
        require(horizonSeconds in 0..MAX_CACHE_HORIZON_SECONDS) {
            "Validity and grace may never compose into more than a 30-day unconfirmed horizon."
        }
    }

    private fun identifier(value: JsonObject, name: String): String =
        value.get(name).asString.also(::requireIdentifier)

    /**
     * Identifiers are validated against the contract pattern and nothing more.
     *
     * A JWS-shaped value in an identifier field — a signed provider payload smuggled into, say, a
     * `correlationId` — is a **producer-side** defect, caught by the semantic validator that guards
     * what Mosaic emits. It is deliberately not a reader rejection: the reader's job is to refuse
     * documents it cannot interpret, and this one is fully interpretable. Rejecting it here would
     * mean a customer loses access because a server put an odd-looking string in a field the SDK
     * only ever passes through, which is a worse outcome than carrying it.
     */
    private fun requireIdentifier(value: String) {
        require(identifierPattern.matches(value)) { "Invalid Mosaic identifier." }
    }

    private fun timestamp(value: JsonObject, name: String): String =
        value.get(name).asString.also { mosaicContractInstantMillis(it) }

    private fun boundedInt(value: JsonObject, name: String, min: Int, max: Int): Int {
        val number = value.get(name).asBigDecimal
        require(number.stripTrailingZeros().scale() <= 0) { "This contract contains no non-integer numbers." }
        return number.toInt().also { require(it in min..max) }
    }

    private fun boundedLong(value: JsonObject, name: String, min: Long, max: Long): Long {
        val number = value.get(name).asBigDecimal
        require(number.stripTrailingZeros().scale() <= 0) { "This contract contains no non-integer numbers." }
        return number.toLong().also { require(it in min..max) }
    }
}
