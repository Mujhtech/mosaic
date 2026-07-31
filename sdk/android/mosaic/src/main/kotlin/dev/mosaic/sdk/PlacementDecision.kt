package dev.mosaic.sdk

import android.content.Context
import android.os.Build
import com.google.gson.JsonElement
import com.google.gson.JsonNull
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

const val MOSAIC_PLACEMENT_DECISION_VERSION: String = "1"
const val MOSAIC_CONFIGURATION_DELIVERY_VERSION_V2: String = "2"
const val MOSAIC_ROLLOUT_ALGORITHM: String = "sha256_length_prefixed_v1"

enum class MosaicTruthValue { TRUE, FALSE, UNKNOWN }
enum class MosaicAssignmentPolicy { INSTALLATION, IDENTIFIED_USER, IDENTIFIED_USER_OR_INSTALLATION }
enum class MosaicAssignmentKeyType { INSTALLATION, IDENTIFIED_USER }
enum class MosaicAttributeSensitivity { STANDARD, SENSITIVE }
enum class MosaicProductReadiness { READY, NOT_READY }
enum class MosaicProductAvailability { AVAILABLE, UNAVAILABLE, UNKNOWN, PROVIDER_UNAVAILABLE, FAILED }
enum class MosaicEntitlementState { ACTIVE, INACTIVE, UNKNOWN, PROVIDER_UNAVAILABLE, FAILED }
enum class MosaicProviderCapabilityState { AVAILABLE, UNAVAILABLE, UNKNOWN }

sealed interface MosaicTypedValue {
    data class StringValue(val value: String) : MosaicTypedValue
    data class BooleanValue(val value: Boolean) : MosaicTypedValue
    data class NumberValue(val value: Double) : MosaicTypedValue
    data class TimestampValue(val value: String) : MosaicTypedValue
    data class SemanticVersionValue(val value: String) : MosaicTypedValue
    data class StringListValue(val value: List<String>) : MosaicTypedValue
}

data class MosaicAttributeDefinition(
    val key: String,
    val type: String,
    val sensitivity: MosaicAttributeSensitivity,
    val allowedOperators: Set<String>,
)

sealed interface MosaicDecisionSource {
    data class Scalar(val kind: String) : MosaicDecisionSource
    data class UserAttribute(val key: String) : MosaicDecisionSource
    data class Entitlement(val key: String) : MosaicDecisionSource
    data class Product(val kind: String, val productId: String) : MosaicDecisionSource
    data class ProviderCapability(val capability: String) : MosaicDecisionSource
}

sealed interface MosaicConditionNode {
    data class Condition(
        val source: MosaicDecisionSource,
        val operator: String,
        val operand: MosaicTypedValue?,
    ) : MosaicConditionNode
    data class All(val children: List<MosaicConditionNode>) : MosaicConditionNode
    data class Any(val children: List<MosaicConditionNode>) : MosaicConditionNode
    data class Not(val child: MosaicConditionNode) : MosaicConditionNode
}

sealed interface MosaicDecisionOutcome {
    data class Paywall(val paywallVersionId: String, val unavailableFallbackKey: String? = null) : MosaicDecisionOutcome
    data object NoPaywall : MosaicDecisionOutcome
    data class Fallback(val key: String) : MosaicDecisionOutcome
    data class Unavailable(val reason: String) : MosaicDecisionOutcome
}

data class MosaicDecisionRollout(val thresholdBasisPoints: Int)
data class MosaicPlacementRule(
    val id: String,
    val priority: Int,
    val enabled: Boolean,
    val safeLabel: String?,
    val conditions: MosaicConditionNode,
    val rollout: MosaicDecisionRollout?,
    val outcome: MosaicDecisionOutcome,
)
data class MosaicNamedFallback(val key: String, val safeLabel: String?, val outcome: MosaicDecisionOutcome)
data class MosaicQAOverride(
    val id: String,
    val selectorDigest: String,
    val safeLabel: String,
    val startsAtEpochMillis: Long,
    val expiresAtEpochMillis: Long,
    val outcome: MosaicDecisionOutcome,
)
data class MosaicPlacementRuleSet(
    val id: String,
    val version: Long,
    val projectId: String,
    val environmentId: String,
    val environmentKey: String,
    val placementId: String,
    val placementKey: String,
    val enabled: Boolean,
    val assignmentPolicy: MosaicAssignmentPolicy,
    val attributeDefinitions: Map<String, MosaicAttributeDefinition>,
    val fallbacks: Map<String, MosaicNamedFallback>,
    val rules: List<MosaicPlacementRule>,
    val defaultOutcome: MosaicDecisionOutcome,
    val qaOverrides: List<MosaicQAOverride>,
    val requiredFeatures: Set<String>,
    val requiredBucketingAlgorithms: Set<String>,
)

data class MosaicDeliveryEntitlement(val id: String, val key: String)

data class MosaicDecisionContext(
    val platform: String = "android",
    val osVersion: String? = Build.VERSION.RELEASE,
    val applicationVersion: String? = null,
    val applicationLocale: String? = Locale.getDefault().toLanguageTag(),
    /** Explicit host input. Mosaic never infers country from locale or device region. */
    val country: String? = null,
    val userPresent: Boolean = false,
    val attributes: Map<String, MosaicTypedValue> = emptyMap(),
    val entitlements: Map<String, MosaicEntitlementState> = emptyMap(),
    val products: Map<String, MosaicProductAvailability> = emptyMap(),
    val productReadiness: Map<String, MosaicProductReadiness> = emptyMap(),
    val providerCapabilities: Map<String, MosaicProviderCapabilityState> = emptyMap(),
)

data class MosaicAssignmentKey(val type: MosaicAssignmentKeyType, internal val value: String)
data class MosaicDecisionTraceStep(
    val kind: String,
    val ruleId: String? = null,
    val source: String? = null,
    val result: MosaicTruthValue? = null,
    val provenance: String? = null,
    val assignmentKeyType: MosaicAssignmentKeyType? = null,
    val rolloutBucket: Int? = null,
    val fallbackKey: String? = null,
)
data class MosaicDecisionTrace(val steps: List<MosaicDecisionTraceStep>, val truncated: Boolean)

sealed interface MosaicEvaluationResult {
    val trace: MosaicDecisionTrace
    data class Paywall(
        val paywallVersionId: String,
        val unavailableFallbackKey: String?,
        val matchedRuleId: String?,
        val fallbackPath: List<String>,
        val overrideLabel: String?,
        override val trace: MosaicDecisionTrace,
    ) : MosaicEvaluationResult
    data class NoPaywall(
        val matchedRuleId: String?,
        val overrideLabel: String?,
        override val trace: MosaicDecisionTrace,
        val fallbackPath: List<String> = emptyList(),
    ) : MosaicEvaluationResult
    data class Unavailable(
        val reason: String,
        override val trace: MosaicDecisionTrace,
        val matchedRuleId: String? = null,
        val fallbackPath: List<String> = emptyList(),
    ) : MosaicEvaluationResult
    data class Failed(
        val diagnosticCode: String,
        override val trace: MosaicDecisionTrace,
        val matchedRuleId: String? = null,
        val fallbackPath: List<String> = emptyList(),
    ) : MosaicEvaluationResult
}

data class MosaicIdentityState(
    val installationId: String,
    val userId: String?,
    val attributes: Map<String, MosaicTypedValue>,
    val generation: Long,
    /** Local-only metadata; it never changes an assignment key or enters a request/trace. */
    val alias: MosaicIdentityAliasMetadata? = null,
)
data class MosaicIdentityAliasMetadata(val anonymousGeneration: Long, val identifiedGeneration: Long)

/** App-private, no-backup, coroutine-safe identity persistence. */
class MosaicIdentityStore(context: Context, namespace: String) {
    private val lock = Mutex()
    private val file = File(context.applicationContext.noBackupFilesDir, "mosaic/identity/$namespace.json")

    suspend fun current(): MosaicIdentityState = lock.withLock { readOrCreate() }

    suspend fun identify(userId: String, attributes: Map<String, MosaicTypedValue> = emptyMap()): MosaicIdentityState =
        mutate { current ->
            require(userId.isNotBlank() && userId.toByteArray().size <= 256) { "userId must be 1-256 UTF-8 bytes." }
            validateAttributeBounds(attributes)
            val nextGeneration = current.generation + 1
            current.copy(
                userId = userId,
                attributes = attributes,
                generation = nextGeneration,
                alias = if (current.userId == null) MosaicIdentityAliasMetadata(current.generation, nextGeneration) else null,
            )
        }

    suspend fun setAttributes(attributes: Map<String, MosaicTypedValue>): MosaicIdentityState = mutate { current ->
        validateAttributeBounds(attributes)
        current.copy(attributes = attributes, generation = current.generation + 1)
    }

    /** Clears user-bound state while retaining the anonymous installation assignment key. */
    suspend fun resetUser(): MosaicIdentityState = mutate { current ->
        current.copy(userId = null, attributes = emptyMap(), generation = current.generation + 1, alias = null)
    }

    /** Explicitly rotates the installation identity and also clears user-bound state. */
    suspend fun resetInstallation(): MosaicIdentityState = mutate { current ->
        MosaicIdentityState(newInstallationId(), null, emptyMap(), current.generation + 1)
    }

    private suspend fun mutate(block: (MosaicIdentityState) -> MosaicIdentityState): MosaicIdentityState = lock.withLock {
        block(readOrCreate()).also { write(it) }
    }

    private suspend fun readOrCreate(): MosaicIdentityState = withContext(Dispatchers.IO) {
        if (file.isFile) {
            runCatching { decodeIdentity(file.readText()) }.getOrNull()?.let { return@withContext it }
        }
        MosaicIdentityState(newInstallationId(), null, emptyMap(), 0).also { writeOnIo(it) }
    }

    private suspend fun write(value: MosaicIdentityState) = withContext(Dispatchers.IO) { writeOnIo(value) }
    private fun writeOnIo(value: MosaicIdentityState) {
        file.parentFile?.let { if (!it.isDirectory && !it.mkdirs()) error("Could not create Mosaic identity directory.") }
        val temporary = File.createTempFile("identity-", ".tmp", file.parentFile)
        try {
            FileOutputStream(temporary).use { output ->
                output.writer(Charsets.UTF_8).buffered().use { it.write(encodeIdentity(value)); it.flush(); output.fd.sync() }
            }
            if (!temporary.renameTo(file)) error("Could not atomically persist Mosaic identity.")
        } finally {
            if (temporary.exists()) temporary.delete()
        }
    }

    private fun encodeIdentity(value: MosaicIdentityState): String {
        val root = JsonObject().apply {
            addProperty("installationId", value.installationId)
            value.userId?.let { addProperty("userId", it) }
            addProperty("generation", value.generation)
            value.alias?.let { alias ->
                add("alias", JsonObject().apply {
                    addProperty("anonymousGeneration", alias.anonymousGeneration)
                    addProperty("identifiedGeneration", alias.identifiedGeneration)
                })
            }
            add("attributes", JsonObject().also { target -> value.attributes.forEach { (key, item) -> target.add(key, item.toJson()) } })
        }
        return root.toString()
    }

    private fun decodeIdentity(source: String): MosaicIdentityState {
        val root = JsonParser.parseString(source).asJsonObject
        root.requireExact(setOf("installationId", "generation", "attributes"), setOf("userId", "alias"), "identity")
        val attributes = root.getAsJsonObject("attributes").entrySet().associate { (key, value) -> key to parseTypedValue(value.asJsonObject, "identity.attributes.$key") }
        validateAttributeBounds(attributes)
        val alias = root.getAsJsonObject("alias")?.let { value ->
            value.requireExact(setOf("anonymousGeneration", "identifiedGeneration"), emptySet(), "identity.alias")
            MosaicIdentityAliasMetadata(value.get("anonymousGeneration").asLong, value.get("identifiedGeneration").asLong)
        }
        return MosaicIdentityState(root.get("installationId").asString, root.get("userId")?.asString, attributes, root.get("generation").asLong, alias)
    }

    private fun newInstallationId(): String = "install_${UUID.randomUUID()}"
}

private fun validateAttributeBounds(attributes: Map<String, MosaicTypedValue>) {
    require(attributes.size <= 32) { "At most 32 Mosaic attributes are allowed." }
    attributes.forEach { (key, value) ->
        require(Regex("^[a-z][a-z0-9_]{0,63}$").matches(key)) { "Invalid Mosaic attribute key." }
        when (value) {
            is MosaicTypedValue.StringValue -> require(value.value.toByteArray().size <= 256)
            is MosaicTypedValue.NumberValue -> require(value.value.isFinite())
            is MosaicTypedValue.TimestampValue -> require(parseDecisionUtcMillis(value.value) != null) { "Timestamps require canonical UTC millisecond precision." }
            is MosaicTypedValue.SemanticVersionValue -> require(parseSemver(value.value) != null) { "Invalid semantic version attribute." }
            is MosaicTypedValue.StringListValue -> require(value.value.size in 1..16 && value.value.toSet().size == value.value.size && value.value.all { it.toByteArray().size <= 128 })
            else -> Unit
        }
    }
    val estimatedBytes = attributes.entries.sumOf { it.key.toByteArray().size + it.value.toString().toByteArray().size }
    require(estimatedBytes <= 8192) { "Mosaic attributes exceed 8 KiB." }
}

object MosaicPlacementEvaluator {
    fun evaluateFallback(ruleSet: MosaicPlacementRuleSet, key: String): MosaicEvaluationResult =
        resolveOutcome(ruleSet, MosaicDecisionOutcome.Fallback(key), null, null, TraceBuilder())

    fun evaluate(
        ruleSet: MosaicPlacementRuleSet,
        context: MosaicDecisionContext,
        assignment: MosaicAssignmentKey?,
        overrideTokens: Set<String> = emptySet(),
        nowEpochMillis: Long = System.currentTimeMillis(),
    ): MosaicEvaluationResult {
        val trace = TraceBuilder()
        if (!ruleSet.enabled) return MosaicEvaluationResult.Unavailable("placement_disabled", trace.finish())
        val override = ruleSet.qaOverrides.firstOrNull { candidate ->
            nowEpochMillis >= candidate.startsAtEpochMillis && nowEpochMillis < candidate.expiresAtEpochMillis && overrideTokens.any { token -> sha256(token) == candidate.selectorDigest }
        }
        if (override != null) {
            trace.add(MosaicDecisionTraceStep("override", provenance = "local_token"))
            return resolveOutcome(ruleSet, override.outcome, null, override.safeLabel, trace)
        }
        for (rule in ruleSet.rules.sortedBy { it.priority }) {
            if (!rule.enabled) continue
            val result = evaluateNode(rule.conditions, ruleSet, context, trace, rule.id)
            trace.add(MosaicDecisionTraceStep("rule", rule.id, result = result))
            if (result != MosaicTruthValue.TRUE) continue
            if (rule.rollout != null) {
                if (assignment == null) {
                    trace.add(MosaicDecisionTraceStep("rollout", rule.id, result = MosaicTruthValue.UNKNOWN))
                    continue
                }
                val bucket = MosaicRollout.bucket(ruleSet, rule.id, assignment)
                val matches = bucket < rule.rollout.thresholdBasisPoints
                trace.add(MosaicDecisionTraceStep("rollout", rule.id, result = if (matches) MosaicTruthValue.TRUE else MosaicTruthValue.FALSE, assignmentKeyType = assignment.type, rolloutBucket = bucket))
                if (!matches) continue
            }
            return resolveOutcome(ruleSet, rule.outcome, rule.id, null, trace)
        }
        trace.add(MosaicDecisionTraceStep("default"))
        return resolveOutcome(ruleSet, ruleSet.defaultOutcome, null, null, trace)
    }

    private fun resolveOutcome(
        ruleSet: MosaicPlacementRuleSet,
        initial: MosaicDecisionOutcome,
        matchedRuleId: String?,
        overrideLabel: String?,
        trace: TraceBuilder,
    ): MosaicEvaluationResult {
        var outcome = initial
        val path = mutableListOf<String>()
        repeat(9) {
            when (outcome) {
                is MosaicDecisionOutcome.Paywall -> return MosaicEvaluationResult.Paywall(outcome.paywallVersionId, outcome.unavailableFallbackKey, matchedRuleId, path, overrideLabel, trace.finish())
                MosaicDecisionOutcome.NoPaywall -> return MosaicEvaluationResult.NoPaywall(matchedRuleId, overrideLabel, trace.finish(), path)
                is MosaicDecisionOutcome.Unavailable -> return MosaicEvaluationResult.Unavailable(outcome.reason, trace.finish(), matchedRuleId, path)
                is MosaicDecisionOutcome.Fallback -> {
                    if (!path.addUnique(outcome.key)) return MosaicEvaluationResult.Failed("decision.fallbackCycle", trace.finish(), matchedRuleId, path)
                    trace.add(MosaicDecisionTraceStep("fallback", fallbackKey = outcome.key))
                    outcome = ruleSet.fallbacks[outcome.key]?.outcome
                        ?: return MosaicEvaluationResult.Failed("decision.fallbackMissing", trace.finish(), matchedRuleId, path)
                }
            }
        }
        return MosaicEvaluationResult.Failed("decision.fallbackDepth", trace.finish(), matchedRuleId, path)
    }

    internal fun exactFallbackTrigger(
        ruleSet: MosaicPlacementRuleSet,
        ruleId: String?,
        context: MosaicDecisionContext,
    ): String? {
        val conditions = ruleSet.rules.firstOrNull { it.id == ruleId }?.conditions ?: return null
        val triggers = mutableSetOf<String>()
        fun inspect(node: MosaicConditionNode) {
            when (node) {
                is MosaicConditionNode.All -> node.children.forEach(::inspect)
                is MosaicConditionNode.Any -> node.children.forEach(::inspect)
                is MosaicConditionNode.Not -> inspect(node.child)
                is MosaicConditionNode.Condition -> {
                    if (evaluateNode(node, ruleSet, context, TraceBuilder(), ruleId.orEmpty()) != MosaicTruthValue.TRUE) return
                    when (val source = node.source) {
                        is MosaicDecisionSource.Product -> if (source.kind == "product_availability") {
                            when (context.products[source.productId]) {
                                MosaicProductAvailability.UNAVAILABLE -> triggers += "product_unavailable"
                                MosaicProductAvailability.UNKNOWN -> triggers += "product_unknown"
                                MosaicProductAvailability.PROVIDER_UNAVAILABLE -> triggers += "provider_unavailable"
                                else -> Unit
                            }
                        }
                        is MosaicDecisionSource.ProviderCapability -> if (context.providerCapabilities[source.capability] == MosaicProviderCapabilityState.UNAVAILABLE) {
                            triggers += "provider_unavailable"
                        }
                        is MosaicDecisionSource.Entitlement -> when (context.entitlements[source.key]) {
                            MosaicEntitlementState.UNKNOWN -> triggers += "entitlement_unknown"
                            MosaicEntitlementState.PROVIDER_UNAVAILABLE -> triggers += "provider_unavailable"
                            else -> Unit
                        }
                        else -> Unit
                    }
                }
            }
        }
        inspect(conditions)
        return triggers.singleOrNull()
    }

    private fun evaluateNode(node: MosaicConditionNode, ruleSet: MosaicPlacementRuleSet, context: MosaicDecisionContext, trace: TraceBuilder, ruleId: String): MosaicTruthValue = when (node) {
        is MosaicConditionNode.All -> node.children.map { evaluateNode(it, ruleSet, context, trace, ruleId) }.allTruth()
        is MosaicConditionNode.Any -> node.children.map { evaluateNode(it, ruleSet, context, trace, ruleId) }.anyTruth()
        is MosaicConditionNode.Not -> when (val value = evaluateNode(node.child, ruleSet, context, trace, ruleId)) {
            MosaicTruthValue.TRUE -> MosaicTruthValue.FALSE
            MosaicTruthValue.FALSE -> MosaicTruthValue.TRUE
            MosaicTruthValue.UNKNOWN -> MosaicTruthValue.UNKNOWN
        }
        is MosaicConditionNode.Condition -> {
            val actual = sourceValue(node.source, ruleSet, context)
            compare(actual, node.operator, node.operand).also { result ->
                trace.add(MosaicDecisionTraceStep("condition", ruleId, sourceName(node.source), result, provenance(node.source)))
            }
        }
    }

    private fun sourceValue(source: MosaicDecisionSource, ruleSet: MosaicPlacementRuleSet, context: MosaicDecisionContext): MosaicTypedValue? = when (source) {
        is MosaicDecisionSource.Scalar -> when (source.kind) {
            "device.platform" -> MosaicTypedValue.StringValue(context.platform)
            "device.os_version" -> context.osVersion?.let(MosaicTypedValue::SemanticVersionValue)
            "application.version" -> context.applicationVersion?.let(MosaicTypedValue::SemanticVersionValue)
            "application.locale" -> context.applicationLocale
                ?.let(::normalizeLocale)
                ?.let(MosaicTypedValue::StringValue)
            "context.country" -> context.country?.uppercase(Locale.ROOT)?.takeIf { Regex("^[A-Z]{2}$").matches(it) }?.let(MosaicTypedValue::StringValue)
            "environment.id" -> MosaicTypedValue.StringValue(ruleSet.environmentId)
            "environment.key" -> MosaicTypedValue.StringValue(ruleSet.environmentKey)
            "identity.user_present" -> MosaicTypedValue.BooleanValue(context.userPresent)
            else -> null
        }
        is MosaicDecisionSource.UserAttribute -> context.attributes[source.key]
        is MosaicDecisionSource.Entitlement -> context.entitlements[source.key]?.wireValue()?.let(MosaicTypedValue::StringValue)
        is MosaicDecisionSource.Product -> when (source.kind) {
            "product_availability" -> context.products[source.productId]?.wireValue()?.let(MosaicTypedValue::StringValue)
            "product_readiness" -> context.productReadiness[source.productId]?.name?.lowercase()?.let(MosaicTypedValue::StringValue)
            else -> null
        }
        is MosaicDecisionSource.ProviderCapability -> context.providerCapabilities[source.capability]
            ?.name
            ?.lowercase(Locale.ROOT)
            ?.let(MosaicTypedValue::StringValue)
    }

    private fun compare(actual: MosaicTypedValue?, operator: String, operand: MosaicTypedValue?): MosaicTruthValue {
        if (operator == "exists") return truth(actual != null)
        if (operator == "does_not_exist") return truth(actual == null)
        if (actual == null || operand == null) return MosaicTruthValue.UNKNOWN
        return when (operator) {
            "equals", "not_equals" -> {
                val equal = typedEquals(actual, operand) ?: return MosaicTruthValue.UNKNOWN
                truth(if (operator == "equals") equal else !equal)
            }
            "in", "not_in" -> {
                val values = (operand as? MosaicTypedValue.StringListValue)?.value ?: return MosaicTruthValue.UNKNOWN
                val value = (actual as? MosaicTypedValue.StringValue)?.value ?: return MosaicTruthValue.UNKNOWN
                truth((value in values) == (operator == "in"))
            }
            "contains_any", "contains_all" -> {
                val left = (actual as? MosaicTypedValue.StringListValue)?.value?.toSet() ?: return MosaicTruthValue.UNKNOWN
                val right = (operand as? MosaicTypedValue.StringListValue)?.value?.toSet() ?: return MosaicTruthValue.UNKNOWN
                truth(if (operator == "contains_any") left.intersect(right).isNotEmpty() else left.containsAll(right))
            }
            "locale_matches" -> {
                val locale = (actual as? MosaicTypedValue.StringValue)?.value?.let(::normalizeLocale) ?: return MosaicTruthValue.UNKNOWN
                val range = (operand as? MosaicTypedValue.StringValue)?.value?.let(::normalizeLocale) ?: return MosaicTruthValue.UNKNOWN
                truth(locale == range || locale.startsWith("$range-", ignoreCase = true))
            }
            "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal" -> {
                val order = compareOrdered(actual, operand) ?: return MosaicTruthValue.UNKNOWN
                truth(when (operator) { "greater_than" -> order > 0; "greater_than_or_equal" -> order >= 0; "less_than" -> order < 0; else -> order <= 0 })
            }
            else -> MosaicTruthValue.UNKNOWN
        }
    }

    private fun typedEquals(a: MosaicTypedValue, b: MosaicTypedValue): Boolean? = when {
        a is MosaicTypedValue.StringValue && b is MosaicTypedValue.StringValue -> a.value == b.value
        a is MosaicTypedValue.BooleanValue && b is MosaicTypedValue.BooleanValue -> a.value == b.value
        a is MosaicTypedValue.NumberValue && b is MosaicTypedValue.NumberValue -> a.value == b.value
        a is MosaicTypedValue.TimestampValue && b is MosaicTypedValue.TimestampValue -> a.value == b.value
        a is MosaicTypedValue.SemanticVersionValue && b is MosaicTypedValue.SemanticVersionValue ->
            compareSemver(a.value, b.value)?.let { it == 0 }
        a is MosaicTypedValue.StringListValue && b is MosaicTypedValue.StringListValue -> a.value == b.value
        else -> null
    }

    private fun compareOrdered(a: MosaicTypedValue, b: MosaicTypedValue): Int? = when {
        a is MosaicTypedValue.NumberValue && b is MosaicTypedValue.NumberValue -> a.value.compareTo(b.value)
        a is MosaicTypedValue.TimestampValue && b is MosaicTypedValue.TimestampValue ->
            parseDecisionUtcMillis(a.value)?.let { left -> parseDecisionUtcMillis(b.value)?.let(left::compareTo) }
        a is MosaicTypedValue.SemanticVersionValue && b is MosaicTypedValue.SemanticVersionValue -> compareSemver(a.value, b.value)
        else -> null
    }
}

object MosaicRollout {
    fun bucket(ruleSet: MosaicPlacementRuleSet, ruleId: String, assignment: MosaicAssignmentKey): Int = bucket(
        ruleSet.projectId, ruleSet.environmentId, ruleSet.placementId, ruleId,
        if (assignment.type == MosaicAssignmentKeyType.INSTALLATION) "installation" else "identified_user",
        assignment.value,
    )

    fun bucket(projectId: String, environmentId: String, placementId: String, ruleId: String, assignmentKeyType: String, assignmentKeyValue: String): Int {
        val fields = listOf(projectId, environmentId, placementId, ruleId, assignmentKeyType, assignmentKeyValue)
        val canonical = buildString {
            append("mosaic-placement-rollout\n1\n")
            fields.forEach { value -> append(value.toByteArray(Charsets.UTF_8).size).append(':').append(value).append('\n') }
        }
        val digest = MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray(Charsets.UTF_8))
        var remainder = 0L
        repeat(8) { index -> remainder = ((remainder shl 8) + (digest[index].toInt() and 0xff)) % 10_000L }
        return remainder.toInt()
    }
}

private class TraceBuilder {
    private val entries = mutableListOf<MosaicDecisionTraceStep>()
    private var truncated = false
    fun add(step: MosaicDecisionTraceStep) { if (entries.size < 256) entries += step else truncated = true }
    fun finish() = MosaicDecisionTrace(entries.toList(), truncated)
}

private fun List<MosaicTruthValue>.allTruth() = when { any { it == MosaicTruthValue.FALSE } -> MosaicTruthValue.FALSE; any { it == MosaicTruthValue.UNKNOWN } -> MosaicTruthValue.UNKNOWN; else -> MosaicTruthValue.TRUE }
private fun List<MosaicTruthValue>.anyTruth() = when { any { it == MosaicTruthValue.TRUE } -> MosaicTruthValue.TRUE; any { it == MosaicTruthValue.UNKNOWN } -> MosaicTruthValue.UNKNOWN; else -> MosaicTruthValue.FALSE }
private fun truth(value: Boolean) = if (value) MosaicTruthValue.TRUE else MosaicTruthValue.FALSE
private fun <T> MutableList<T>.addUnique(value: T): Boolean = if (value in this) false else { add(value); true }
private fun MosaicEntitlementState.wireValue() = name.lowercase(Locale.ROOT)
private fun MosaicProductAvailability.wireValue() = name.lowercase(Locale.ROOT)
private fun sourceName(source: MosaicDecisionSource) = when (source) { is MosaicDecisionSource.Scalar -> source.kind; is MosaicDecisionSource.UserAttribute -> "user_attribute.${source.key}"; is MosaicDecisionSource.Entitlement -> "entitlement_state.${source.key}"; is MosaicDecisionSource.Product -> "${source.kind}.${source.productId}"; is MosaicDecisionSource.ProviderCapability -> "provider_capability.${source.capability}" }
private fun provenance(source: MosaicDecisionSource) = when (source) { is MosaicDecisionSource.UserAttribute -> "host_application_redacted"; is MosaicDecisionSource.Scalar -> if (source.kind == "context.country") "host_application" else "runtime"; is MosaicDecisionSource.Entitlement, is MosaicDecisionSource.Product, is MosaicDecisionSource.ProviderCapability -> "commerce_snapshot" }
private fun sha256(value: String) = "sha256:" + MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }

private data class Semver(val core: List<Int>, val prerelease: List<String>)
private fun parseSemver(value: String): Semver? {
    val match = Regex("^(0|[1-9][0-9]*)(?:\\.(0|[1-9][0-9]*))?(?:\\.(0|[1-9][0-9]*))?(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$").matchEntire(value) ?: return null
    val prerelease = match.groupValues[4].takeIf(String::isNotEmpty)?.split('.') ?: emptyList()
    if (prerelease.any { part -> part.length > 1 && part[0] == '0' && part.all(Char::isDigit) }) return null
    return Semver(listOf(match.groupValues[1], match.groupValues[2].ifEmpty { "0" }, match.groupValues[3].ifEmpty { "0" }).map(String::toInt), prerelease)
}
private fun compareSemver(left: String, right: String): Int? {
    val a = parseSemver(left) ?: return null
    val b = parseSemver(right) ?: return null
    a.core.indices.forEach { index -> a.core[index].compareTo(b.core[index]).takeIf { it != 0 }?.let { return it } }
    if (a.prerelease.isEmpty() || b.prerelease.isEmpty()) return when { a.prerelease.isEmpty() && b.prerelease.isEmpty() -> 0; a.prerelease.isEmpty() -> 1; else -> -1 }
    repeat(maxOf(a.prerelease.size, b.prerelease.size)) { index ->
        val x = a.prerelease.getOrNull(index) ?: return -1
        val y = b.prerelease.getOrNull(index) ?: return 1
        val xn = x.toIntOrNull(); val yn = y.toIntOrNull()
        val result = when { xn != null && yn != null -> xn.compareTo(yn); xn != null -> -1; yn != null -> 1; else -> x.compareTo(y) }
        if (result != 0) return result
    }
    return 0
}
private fun normalizeLocale(value: String): String? {
    val canonicalSeparators = value.trim().replace('_', '-')
    if (!Regex("^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$").matches(canonicalSeparators)) return null
    return canonicalSeparators.split('-').mapIndexed { index, part -> when { index == 0 -> part.lowercase(); part.length == 4 -> part.lowercase().replaceFirstChar(Char::titlecase); part.length == 2 || part.length == 3 && part.all(Char::isDigit) -> part.uppercase(); else -> part.lowercase() } }.joinToString("-")
}

internal fun parseTypedValue(value: JsonObject, path: String): MosaicTypedValue {
    value.requireExact(setOf("type", "value"), emptySet(), path)
    return when (value.get("type").asString) {
        "string" -> MosaicTypedValue.StringValue(value.get("value").asString.also { require(it.toByteArray().size <= 256) })
        "boolean" -> MosaicTypedValue.BooleanValue(value.get("value").asBoolean)
        "number" -> MosaicTypedValue.NumberValue(value.get("value").asDouble.also { require(it.isFinite()) })
        "timestamp" -> MosaicTypedValue.TimestampValue(value.get("value").asString.also { require(parseDecisionUtcMillis(it) != null) })
        "semantic_version" -> MosaicTypedValue.SemanticVersionValue(value.get("value").asString.also { require(parseSemver(it) != null) })
        "string_list" -> MosaicTypedValue.StringListValue(value.getAsJsonArray("value").map(JsonElement::getAsString).also { require(it.size in 1..16 && it.toSet().size == it.size) })
        else -> error("Unsupported typed value at $path.")
    }
}

private fun MosaicTypedValue.toJson(): JsonObject = JsonObject().also { root -> when (this) {
    is MosaicTypedValue.StringValue -> { root.addProperty("type", "string"); root.addProperty("value", value) }
    is MosaicTypedValue.BooleanValue -> { root.addProperty("type", "boolean"); root.addProperty("value", value) }
    is MosaicTypedValue.NumberValue -> { root.addProperty("type", "number"); root.addProperty("value", if (value == -0.0) 0.0 else value) }
    is MosaicTypedValue.TimestampValue -> { root.addProperty("type", "timestamp"); root.addProperty("value", value.toString()) }
    is MosaicTypedValue.SemanticVersionValue -> { root.addProperty("type", "semantic_version"); root.addProperty("value", value) }
    is MosaicTypedValue.StringListValue -> { root.addProperty("type", "string_list"); root.add("value", com.google.gson.JsonArray().also { array -> value.forEach(array::add) }) }
} }

internal fun parseDecisionUtcMillis(value: String): Long? {
    if (!Regex("^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\\.[0-9]{3}Z$").matches(value)) return null
    val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT).apply { isLenient = false; timeZone = TimeZone.getTimeZone("UTC") }
    return runCatching { format.parse(value) }.getOrNull()?.takeIf { format.format(it) == value }?.time
}

internal fun JsonObject.requireExact(required: Set<String>, optional: Set<String>, path: String) {
    val actual = entrySet().map { it.key }.toSet()
    require(actual.containsAll(required) && actual.all { it in required || it in optional }) { "Invalid fields at $path." }
    required.forEach { require(get(it) != null && get(it) !is JsonNull) { "Missing $it at $path." } }
}
