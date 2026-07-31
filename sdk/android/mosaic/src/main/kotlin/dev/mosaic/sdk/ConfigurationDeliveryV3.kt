package dev.mosaic.sdk

import com.google.gson.GsonBuilder
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.security.MessageDigest

/** Strict atomic Delivery v3 reader built over the frozen Delivery v2 reader. */
object MosaicConfigurationDeliveryV3Decoder {
    private val gson = GsonBuilder().disableHtmlEscaping().create()
    private val supportedFeatures = setOf(
        "allocation.ranges", "assignment.installation", "assignment.identified_user",
        "assignment.identified_user_or_installation", "fallback.normal_placement",
        "group.mutual_exclusion", "override.qa", "schedule.trusted_server_time",
    )
    private val supportedAlgorithms = setOf(MOSAIC_EXPERIMENT_BUCKETING_ALGORITHM, MOSAIC_EXPERIMENT_GROUP_BUCKETING_ALGORITHM)

    fun decode(source: String, capabilityReport: MosaicCapabilityReport = MosaicProtocolCapabilities.report()): MosaicConfigurationRelease {
        require(source.toByteArray(Charsets.UTF_8).size <= 4 * 1024 * 1024)
        val root = JsonParser.parseString(source).asJsonObject
        root.requireExact(setOf("configurationDeliveryVersion", "release"), emptySet(), "$")
        require(root.get("configurationDeliveryVersion").asString == "3")
        val release = root.getAsJsonObject("release")
        release.requireExact(
            setOf("id", "number", "projectId", "environment", "publishedAt", "contentDigest", "compatibility", "placementDecisions", "paywallVersions", "productReferences", "entitlementReferences", "assetReferences", "experimentAssignments"),
            emptySet(), "$.release",
        )
        val declaredDigest = release.get("contentDigest").asString
        require(declaredDigest == digest(release.deepCopy().also { it.remove("contentDigest") }))

        // Reconstruct the normative v2 projection and let the existing strict reader validate every
        // unchanged field. Only after that succeeds do we decode Experiment material.
        val projection = root.deepCopy()
        projection.addProperty("configurationDeliveryVersion", "2")
        val projectedRelease = projection.getAsJsonObject("release")
        projectedRelease.remove("experimentAssignments")
        projectedRelease.getAsJsonObject("compatibility").remove("experimentAssignmentContracts")
        projectedRelease.addProperty("contentDigest", digest(projectedRelease.deepCopy().also { it.remove("contentDigest") }))
        val base = MosaicConfigurationDeliveryV2Decoder.decode(canonicalJson(projection), capabilityReport)

        val compatibility = release.getAsJsonObject("compatibility")
        compatibility.requireExact(
            setOf("placementDecisionContracts", "paywallProtocols", "acceptance", "experimentAssignmentContracts"),
            emptySet(), "$.release.compatibility",
        )
        val contracts = compatibility.getAsJsonArray("experimentAssignmentContracts")
        require(contracts.size() == 1)
        val contract = contracts.single().asJsonObject
        contract.requireExact(setOf("version", "requiredFeatures", "bucketingAlgorithms", "schedulePolicies"), emptySet(), "experimentCompatibility")
        require(contract.get("version").asString == "1")
        val declaredFeatures = contract.strings("requiredFeatures", 0, 8).toSet().also { require(it.all(supportedFeatures::contains)) }
        val declaredAlgorithms = contract.strings("bucketingAlgorithms", 0, 2).toSet().also { require(it.all(supportedAlgorithms::contains)) }
        val declaredSchedules = contract.strings("schedulePolicies", 0, 1).toSet().also {
            require(it.all { policy -> policy == MOSAIC_EXPERIMENT_TIME_POLICY })
        }

        val environmentProduction = base.environment.mode == MosaicDeliveryEnvironmentMode.PRODUCTION
        val assignments = release.getAsJsonArray("experimentAssignments").map { element ->
            MosaicExperimentAssignmentDecoder.decode(
                JsonObject().apply {
                    addProperty("experimentAssignmentVersion", "1")
                    add("assignment", element)
                },
                environmentProduction,
            )
        }
        require(assignments.map { it.experimentId }.toSet().size == assignments.size)
        require(assignments.map { it.experimentVersionId }.toSet().size == assignments.size)
        require(assignments.flatMap { it.requiredFeatures }.toSet() == declaredFeatures)
        require(assignments.flatMap { it.requiredBucketingAlgorithms }.toSet() == declaredAlgorithms)
        require(assignments.flatMap { it.requiredSchedulePolicies }.toSet() == declaredSchedules)

        val decisionsById = base.placementDecisions.values.associateBy { it.placementId }
        val groupSnapshots = mutableMapOf<Pair<String, String>, MosaicExperimentGroup>()
        assignments.forEach { assignment ->
            require(assignment.projectId == base.projectId && assignment.environmentId == base.environment.id)
            val decision = requireNotNull(decisionsById[assignment.placementId])
            require(allDecisionPaywalls(decision).contains(assignment.controlPaywallVersionId))
            assignment.mutualExclusionGroup?.let { group ->
                require(group.members.any { it.experimentId == assignment.experimentId })
                val key = group.id to group.versionId
                require(groupSnapshots.putIfAbsent(key, group)?.let { it == group } != false)
            }
            assignment.variants.forEach { variant ->
                val paywall = requireNotNull(base.paywallVersions[variant.paywallVersionId])
                require(paywall.paywallId == variant.paywallId)
                require(paywall.productReferenceIds.toSet() == variant.compatibility.requiredProductIds)
                require(variant.compatibility.requiredProductIds.all(base.productReferences::containsKey))
            }
        }
        return base.copy(
            encoded = source,
            contentDigest = declaredDigest,
            deliveryVersion = "3",
            experimentAssignments = assignments,
        )
    }

    private fun allDecisionPaywalls(ruleSet: MosaicPlacementRuleSet): Set<String> = buildSet {
        fun addOutcome(outcome: MosaicDecisionOutcome) { if (outcome is MosaicDecisionOutcome.Paywall) add(outcome.paywallVersionId) }
        ruleSet.rules.forEach { addOutcome(it.outcome) }
        ruleSet.fallbacks.values.forEach { addOutcome(it.outcome) }
        ruleSet.qaOverrides.forEach { addOutcome(it.outcome) }
        addOutcome(ruleSet.defaultOutcome)
    }

    private fun digest(value: JsonElement): String = "sha256:" + MessageDigest.getInstance("SHA-256")
        .digest(canonicalJson(value).toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    private fun canonicalJson(value: JsonElement): String = when {
        value.isJsonNull -> "null"
        value.isJsonArray -> value.asJsonArray.joinToString(",", "[", "]") { canonicalJson(it) }
        value.isJsonObject -> value.asJsonObject.entrySet().sortedBy { it.key }.joinToString(",", "{", "}") { (key, child) -> "${gson.toJson(key)}:${canonicalJson(child)}" }
        value.asJsonPrimitive.isString -> gson.toJson(value.asString)
        value.asJsonPrimitive.isBoolean -> value.asBoolean.toString()
        else -> value.asBigDecimal.stripTrailingZeros().toPlainString()
    }

    private fun JsonObject.strings(name: String, min: Int, max: Int): List<String> = getAsJsonArray(name).map { it.asString }.also {
        require(it.size in min..max && it.size == it.toSet().size)
    }
}
