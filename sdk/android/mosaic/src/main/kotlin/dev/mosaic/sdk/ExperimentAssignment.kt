package dev.mosaic.sdk

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import java.security.MessageDigest

const val MOSAIC_EXPERIMENT_ASSIGNMENT_VERSION = "1"
const val MOSAIC_CONFIGURATION_DELIVERY_VERSION_V3 = "3"
const val MOSAIC_EXPERIMENT_BUCKETING_ALGORITHM = "experiment_sha256_length_prefixed_v1"
const val MOSAIC_EXPERIMENT_GROUP_BUCKETING_ALGORITHM = "experiment_group_sha256_length_prefixed_v1"
const val MOSAIC_EXPERIMENT_TIME_POLICY = "trusted_server_time_v1"

object MosaicExperimentCapabilities {
    val features = listOf(
        "allocation.ranges", "assignment.installation", "assignment.identified_user",
        "assignment.identified_user_or_installation", "fallback.normal_placement",
        "group.mutual_exclusion", "override.qa", "schedule.trusted_server_time",
    )
    val algorithms = listOf(MOSAIC_EXPERIMENT_BUCKETING_ALGORITHM, MOSAIC_EXPERIMENT_GROUP_BUCKETING_ALGORITHM)
}

enum class MosaicExperimentLifecycle { SCHEDULED, RUNNING, PAUSED, STOPPED, COMPLETED }
enum class MosaicExperimentVariantRole { CONTROL, TREATMENT }

data class MosaicExperimentVariantCompatibility(
    val requiredProductIds: Set<String>,
    val requiredProviderCapabilities: Set<String>,
)

data class MosaicExperimentVariant(
    val id: String,
    val name: String,
    val role: MosaicExperimentVariantRole,
    val paywallId: String,
    val paywallVersionId: String,
    val rangeStart: Int,
    val rangeEnd: Int,
    val compatibility: MosaicExperimentVariantCompatibility,
)

data class MosaicExperimentSchedule(val startsAtEpochMillis: Long, val endsAtEpochMillis: Long?)
data class MosaicExperimentGroupMember(val experimentId: String, val rangeStart: Int, val rangeEnd: Int)
data class MosaicExperimentRange(val rangeStart: Int, val rangeEnd: Int)
data class MosaicExperimentGroup(
    val id: String,
    val versionId: String,
    val members: List<MosaicExperimentGroupMember>,
    val normalPlacementRange: MosaicExperimentRange?,
)

data class MosaicExperimentQAOverride(
    val id: String,
    val variantId: String,
    val assignmentKeyType: MosaicAssignmentKeyType,
    val selectorDigest: String,
    val safeLabel: String,
    val startsAtEpochMillis: Long,
    val expiresAtEpochMillis: Long,
)

data class MosaicExperimentAssignment(
    val projectId: String,
    val environmentId: String,
    val experimentId: String,
    val experimentVersionId: String,
    val placementId: String,
    val controlPaywallVersionId: String,
    val allocationVersion: String,
    val variants: List<MosaicExperimentVariant>,
    val assignmentKeyPolicy: MosaicAssignmentPolicy,
    val lifecycle: MosaicExperimentLifecycle,
    val schedule: MosaicExperimentSchedule,
    val mutualExclusionGroup: MosaicExperimentGroup?,
    val qaOverrides: List<MosaicExperimentQAOverride>,
    val requiredFeatures: Set<String>,
    val requiredBucketingAlgorithms: Set<String>,
    val requiredSchedulePolicies: Set<String>,
) {
    val control: MosaicExperimentVariant get() = variants.single { it.role == MosaicExperimentVariantRole.CONTROL }
}

sealed interface MosaicExperimentAssignmentResult {
    data class Assigned(
        val assignment: MosaicExperimentAssignment,
        val variant: MosaicExperimentVariant,
        val assignmentKeyType: MosaicAssignmentKeyType,
        val bucket: Int,
        val groupBucket: Int?,
        val qaOverride: Boolean,
    ) : MosaicExperimentAssignmentResult
    data class NormalPlacement(val reason: String) : MosaicExperimentAssignmentResult
}

internal data class MosaicExperimentCandidateEvaluation(
    val assignment: MosaicExperimentAssignmentResult.Assigned?,
    val normalPlacementReasons: List<String>,
)

/** Pure canonical assignment and mutual-exclusion evaluator. */
object MosaicExperimentAssignmentEngine {
    /**
     * Evaluates same-Placement candidates in stable Experiment order. Group admission happens
     * inside [evaluate], so an excluded member cannot prevent the admitted member from running.
     */
    internal fun evaluateCandidates(
        assignments: List<MosaicExperimentAssignment>,
        identity: MosaicIdentityState,
        trustedNowEpochMillis: Long?,
        qaTokens: Set<String> = emptySet(),
    ): MosaicExperimentCandidateEvaluation {
        val reasons = mutableListOf<String>()
        assignments.sortedBy { it.experimentId }.forEach { assignment ->
            when (val result = evaluate(assignment, identity, trustedNowEpochMillis, qaTokens)) {
                is MosaicExperimentAssignmentResult.Assigned ->
                    return MosaicExperimentCandidateEvaluation(result, reasons)
                is MosaicExperimentAssignmentResult.NormalPlacement -> reasons += result.reason
            }
        }
        return MosaicExperimentCandidateEvaluation(null, reasons)
    }

    fun evaluate(
        assignment: MosaicExperimentAssignment,
        identity: MosaicIdentityState,
        trustedNowEpochMillis: Long?,
        qaTokens: Set<String> = emptySet(),
    ): MosaicExperimentAssignmentResult {
        val key = when (assignment.assignmentKeyPolicy) {
            MosaicAssignmentPolicy.INSTALLATION -> MosaicAssignmentKey(MosaicAssignmentKeyType.INSTALLATION, identity.installationId)
            MosaicAssignmentPolicy.IDENTIFIED_USER -> identity.userId?.let { MosaicAssignmentKey(MosaicAssignmentKeyType.IDENTIFIED_USER, it) }
                ?: return MosaicExperimentAssignmentResult.NormalPlacement("missing_identity")
            MosaicAssignmentPolicy.IDENTIFIED_USER_OR_INSTALLATION -> identity.userId
                ?.let { MosaicAssignmentKey(MosaicAssignmentKeyType.IDENTIFIED_USER, it) }
                ?: MosaicAssignmentKey(MosaicAssignmentKeyType.INSTALLATION, identity.installationId)
        }
        val now = trustedNowEpochMillis
        if (now != null) {
            val override = assignment.qaOverrides.firstOrNull { candidate ->
                candidate.assignmentKeyType == key.type && now >= candidate.startsAtEpochMillis &&
                    now < candidate.expiresAtEpochMillis && qaTokens.any { token -> sha256(token) == candidate.selectorDigest }
            }
            if (override != null) {
                return MosaicExperimentAssignmentResult.Assigned(
                    assignment, assignment.variants.single { it.id == override.variantId }, key.type,
                    experimentBucket(assignment, key), null, true,
                )
            }
        }
        if (now == null) return MosaicExperimentAssignmentResult.NormalPlacement("time_unreliable")
        if (assignment.lifecycle !in setOf(MosaicExperimentLifecycle.SCHEDULED, MosaicExperimentLifecycle.RUNNING)) {
            return MosaicExperimentAssignmentResult.NormalPlacement("inactive")
        }
        if (now < assignment.schedule.startsAtEpochMillis) return MosaicExperimentAssignmentResult.NormalPlacement("before_start")
        if (assignment.schedule.endsAtEpochMillis?.let { now >= it } == true) {
            return MosaicExperimentAssignmentResult.NormalPlacement("expired")
        }
        val group = assignment.mutualExclusionGroup
        val groupBucket = group?.let { groupBucket(assignment, it, key) }
        if (group != null && group.members.none {
                it.experimentId == assignment.experimentId && groupBucket!! in it.rangeStart until it.rangeEnd
            }) {
            return MosaicExperimentAssignmentResult.NormalPlacement("group_excluded")
        }
        val bucket = experimentBucket(assignment, key)
        val variant = assignment.variants.single { bucket in it.rangeStart until it.rangeEnd }
        return MosaicExperimentAssignmentResult.Assigned(assignment, variant, key.type, bucket, groupBucket, false)
    }

    fun experimentBucket(assignment: MosaicExperimentAssignment, key: MosaicAssignmentKey): Int = bucket(
        "mosaic-experiment-assignment",
        listOf(assignment.projectId, assignment.environmentId, assignment.experimentId, assignment.experimentVersionId, key.type.experimentWireName(), key.value),
    )

    fun groupBucket(assignment: MosaicExperimentAssignment, group: MosaicExperimentGroup, key: MosaicAssignmentKey): Int = bucket(
        "mosaic-experiment-group",
        listOf(assignment.projectId, assignment.environmentId, group.id, group.versionId, key.type.experimentWireName(), key.value),
    )

    internal fun canonicalBytes(domain: String, values: List<String>): ByteArray = buildString {
        append(domain).append('\n').append("1\n")
        values.forEach { value -> append(value.toByteArray(Charsets.UTF_8).size).append(':').append(value).append('\n') }
    }.toByteArray(Charsets.UTF_8)

    private fun bucket(domain: String, values: List<String>): Int {
        val digest = MessageDigest.getInstance("SHA-256").digest(canonicalBytes(domain, values))
        var first = 0L
        for (index in 0 until 8) first = (first shl 8) or (digest[index].toLong() and 0xff)
        return java.lang.Long.remainderUnsigned(first, 10_000L).toInt()
    }

    private fun sha256(value: String): String = "sha256:" + MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}

internal object MosaicExperimentAssignmentDecoder {
    private val identifier = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
    private val digest = Regex("^sha256:[a-f0-9]{64}$")
    private val features = setOf(
        "allocation.ranges", "assignment.installation", "assignment.identified_user",
        "assignment.identified_user_or_installation", "fallback.normal_placement",
        "group.mutual_exclusion", "override.qa", "schedule.trusted_server_time",
    )
    private val providerCapabilities = setOf("product_load", "purchase", "restore", "entitlement_lookup", "native_recovery")

    fun decode(wrapper: JsonObject, production: Boolean): MosaicExperimentAssignment {
        wrapper.requireExact(setOf("experimentAssignmentVersion", "assignment"), emptySet(), "experimentAssignment")
        require(wrapper.get("experimentAssignmentVersion").asString == "1")
        val value = wrapper.getAsJsonObject("assignment")
        value.requireExact(
            setOf("projectId", "environmentId", "experimentId", "experimentVersionId", "placementId", "controlPaywallVersionId", "allocationVersion", "variants", "assignmentKeyPolicy", "bucketingAlgorithm", "lifecycle", "schedule", "qaOverrides", "fallback", "compatibility"),
            setOf("mutualExclusionGroup"), "assignment",
        )
        require(value.string("bucketingAlgorithm") == MOSAIC_EXPERIMENT_BUCKETING_ALGORITHM)
        require(value.string("fallback") == "normal_placement")
        val variants = value.getAsJsonArray("variants").map { parseVariant(it) }
        require(variants.size in 2..4 && variants.map { it.id }.toSet().size == variants.size)
        require(variants.count { it.role == MosaicExperimentVariantRole.CONTROL } == 1)
        require(variants.count { it.role == MosaicExperimentVariantRole.TREATMENT } in 1..3)
        validateRanges(variants.map { it.rangeStart to it.rangeEnd })
        val controlId = value.id("controlPaywallVersionId")
        require(variants.single { it.role == MosaicExperimentVariantRole.CONTROL }.paywallVersionId == controlId)
        val policy = when (value.string("assignmentKeyPolicy")) {
            "installation" -> MosaicAssignmentPolicy.INSTALLATION
            "identified_user" -> MosaicAssignmentPolicy.IDENTIFIED_USER
            "identified_user_or_installation" -> MosaicAssignmentPolicy.IDENTIFIED_USER_OR_INSTALLATION
            else -> error("Unsupported Experiment assignment policy.")
        }
        val scheduleValue = value.getAsJsonObject("schedule")
        scheduleValue.requireExact(setOf("startsAt", "timePolicy", "unreliableTimeBehavior"), setOf("endsAt"), "schedule")
        require(scheduleValue.string("timePolicy") == MOSAIC_EXPERIMENT_TIME_POLICY && scheduleValue.string("unreliableTimeBehavior") == "normal_placement")
        val startsAt = requireNotNull(parseDecisionUtcMillis(scheduleValue.string("startsAt")))
        val endsAt = scheduleValue.get("endsAt")?.asString?.let { requireNotNull(parseDecisionUtcMillis(it)) }
        require(endsAt == null || endsAt > startsAt)
        val group = value.getAsJsonObject("mutualExclusionGroup")?.let(::parseGroup)
        val overrides = value.getAsJsonArray("qaOverrides").map { parseOverride(it) }
        require(overrides.size <= 32 && overrides.map { it.id }.toSet().size == overrides.size)
        require(!production || overrides.isEmpty())
        require(overrides.all { it.variantId in variants.map(MosaicExperimentVariant::id) })
        val compatibility = value.getAsJsonObject("compatibility")
        compatibility.requireExact(setOf("requiredFeatures", "bucketingAlgorithms", "schedulePolicies"), emptySet(), "compatibility")
        val declaredFeatures = compatibility.strings("requiredFeatures", 4, 8).toSet().also { require(it.all(features::contains)) }
        val algorithms = compatibility.strings("bucketingAlgorithms", 1, 2).toSet().also {
            require(it.all { algorithm -> algorithm in setOf(MOSAIC_EXPERIMENT_BUCKETING_ALGORITHM, MOSAIC_EXPERIMENT_GROUP_BUCKETING_ALGORITHM) })
        }
        val schedules = compatibility.strings("schedulePolicies", 1, 1).toSet().also { require(it == setOf(MOSAIC_EXPERIMENT_TIME_POLICY)) }
        val expectedFeatures = buildSet {
            add("allocation.ranges"); add("fallback.normal_placement"); add("schedule.trusted_server_time")
            add("assignment.${value.string("assignmentKeyPolicy")}")
            if (group != null) add("group.mutual_exclusion")
            if (overrides.isNotEmpty()) add("override.qa")
        }
        val expectedAlgorithms = buildSet {
            add(MOSAIC_EXPERIMENT_BUCKETING_ALGORITHM)
            if (group != null) add(MOSAIC_EXPERIMENT_GROUP_BUCKETING_ALGORITHM)
        }
        require(declaredFeatures == expectedFeatures && algorithms == expectedAlgorithms)
        return MosaicExperimentAssignment(
            value.id("projectId"), value.id("environmentId"), value.id("experimentId"), value.id("experimentVersionId"),
            value.id("placementId"), controlId, value.id("allocationVersion"), variants, policy,
            when (value.string("lifecycle")) {
                "scheduled" -> MosaicExperimentLifecycle.SCHEDULED; "running" -> MosaicExperimentLifecycle.RUNNING
                "paused" -> MosaicExperimentLifecycle.PAUSED; "stopped" -> MosaicExperimentLifecycle.STOPPED
                "completed" -> MosaicExperimentLifecycle.COMPLETED; else -> error("Unsupported Experiment lifecycle.")
            },
            MosaicExperimentSchedule(startsAt, endsAt), group, overrides, declaredFeatures, algorithms, schedules,
        )
    }

    private fun parseVariant(element: JsonElement): MosaicExperimentVariant {
        val value = element.asJsonObject
        value.requireExact(setOf("id", "name", "role", "paywallId", "paywallVersionId", "rangeStart", "rangeEnd", "compatibility"), emptySet(), "variant")
        val compatibility = value.getAsJsonObject("compatibility")
        compatibility.requireExact(setOf("requiredProductIds", "requiredProviderCapabilities"), emptySet(), "variant.compatibility")
        val products = compatibility.strings("requiredProductIds", 0, 64).toSet().also { require(it.all(identifier::matches)) }
        val capabilities = compatibility.strings("requiredProviderCapabilities", 0, 32).toSet().also { require(it.all(providerCapabilities::contains)) }
        return MosaicExperimentVariant(
            value.id("id"), value.string("name").also { require(it.length in 1..160 && it.none { c -> c == '\n' || c == '\r' || c.code < 0x20 }) },
            when (value.string("role")) { "control" -> MosaicExperimentVariantRole.CONTROL; "treatment" -> MosaicExperimentVariantRole.TREATMENT; else -> error("Unsupported Variant role.") },
            value.id("paywallId"), value.id("paywallVersionId"), value.int("rangeStart", 0, 9999), value.int("rangeEnd", 1, 10000),
            MosaicExperimentVariantCompatibility(products, capabilities),
        )
    }

    private fun parseGroup(value: JsonObject): MosaicExperimentGroup {
        value.requireExact(setOf("id", "versionId", "members", "bucketingAlgorithm"), setOf("normalPlacementRange"), "group")
        require(value.string("bucketingAlgorithm") == MOSAIC_EXPERIMENT_GROUP_BUCKETING_ALGORITHM)
        val members = value.getAsJsonArray("members").map { element ->
            val item = element.asJsonObject
            item.requireExact(setOf("experimentId", "rangeStart", "rangeEnd"), emptySet(), "group.member")
            MosaicExperimentGroupMember(item.id("experimentId"), item.int("rangeStart", 0, 9999), item.int("rangeEnd", 1, 10000))
        }
        require(members.size in 1..128 && members.map { it.experimentId }.toSet().size == members.size)
        val normal = value.getAsJsonObject("normalPlacementRange")?.let {
            it.requireExact(setOf("rangeStart", "rangeEnd"), emptySet(), "group.normalPlacementRange")
            MosaicExperimentRange(it.int("rangeStart", 0, 9999), it.int("rangeEnd", 1, 10000))
        }
        validateRanges(members.map { it.rangeStart to it.rangeEnd } + listOfNotNull(normal?.let { it.rangeStart to it.rangeEnd }))
        return MosaicExperimentGroup(value.id("id"), value.id("versionId"), members, normal)
    }

    private fun parseOverride(element: JsonElement): MosaicExperimentQAOverride {
        val value = element.asJsonObject
        value.requireExact(setOf("id", "variantId", "assignmentKeyType", "selectorDigest", "safeLabel", "startsAt", "expiresAt", "visibility"), emptySet(), "qaOverride")
        require(value.string("visibility") == "diagnostic")
        val starts = requireNotNull(parseDecisionUtcMillis(value.string("startsAt")))
        val expires = requireNotNull(parseDecisionUtcMillis(value.string("expiresAt")))
        require(expires > starts && expires - starts <= 86_400_000L)
        return MosaicExperimentQAOverride(
            value.id("id"), value.id("variantId"),
            when (value.string("assignmentKeyType")) { "installation" -> MosaicAssignmentKeyType.INSTALLATION; "identified_user" -> MosaicAssignmentKeyType.IDENTIFIED_USER; else -> error("Unsupported QA key type.") },
            value.string("selectorDigest").also { require(digest.matches(it)) }, value.string("safeLabel"), starts, expires,
        )
    }

    private fun validateRanges(ranges: List<Pair<Int, Int>>) {
        require(ranges.isNotEmpty())
        val sorted = ranges.sortedBy { it.first }
        require(sorted.first().first == 0 && sorted.last().second == 10_000)
        require(sorted.all { it.first < it.second })
        require(sorted.zipWithNext().all { (left, right) -> left.second == right.first })
    }

    private fun JsonObject.id(name: String): String = string(name).also { require(identifier.matches(it)) }
    private fun JsonObject.string(name: String): String = get(name).asString
    private fun JsonObject.int(name: String, min: Int, max: Int): Int = get(name).asJsonPrimitive.let {
        require(it.isNumber && !it.toString().contains('.') && !it.toString().contains('e', true)); it.asInt.also { result -> require(result in min..max) }
    }
    private fun JsonObject.strings(name: String, min: Int, max: Int): List<String> = getAsJsonArray(name).map { it.asString }.also {
        require(it.size in min..max && it.size == it.toSet().size)
    }
}

internal fun MosaicAssignmentKeyType.experimentWireName() =
    if (this == MosaicAssignmentKeyType.INSTALLATION) "installation" else "identified_user"
