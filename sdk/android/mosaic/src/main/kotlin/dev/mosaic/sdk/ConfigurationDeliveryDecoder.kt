package dev.mosaic.sdk

import com.google.gson.GsonBuilder
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.security.MessageDigest

/**
 * Strict, atomic reader for Configuration Delivery `3`, Placement Decision `1`, and Experiment
 * Assignment `1`.
 *
 * Reads the delivered envelope directly. It once validated `3` by projecting it back to `2` and `2`
 * back to `1`, so the meaning of the current contract was defined in terms of two predecessors that
 * ADR-0028 has since deleted; a projection with no target is unreachable code with a test suite.
 */
object MosaicConfigurationDeliveryDecoder {
    private val identifier = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
    private val key = Regex("^[a-z][a-z0-9_]{0,63}$")
    private val environmentKey = Regex("^[a-z][a-z0-9_-]{0,63}$")
    private val digest = Regex("^sha256:[a-f0-9]{64}$")
    private val supportedSources = setOf(
        "device.platform", "device.os_version", "application.version", "application.locale",
        "context.country", "environment.id", "environment.key", "identity.user_present",
        "user_attribute", "entitlement_state", "product_availability", "product_readiness",
        "provider_capability",
    )
    private val supportedOperators = setOf(
        "equals", "not_equals", "in", "not_in", "greater_than", "greater_than_or_equal",
        "less_than", "less_than_or_equal", "exists", "does_not_exist", "contains_any",
        "contains_all", "locale_matches",
    )
    private val supportedFeatures = buildSet {
        supportedSources.forEach { add("source.$it") }
        supportedOperators.forEach { add("operator.$it") }
        listOf("all", "any", "not").forEach { add("condition.$it") }
        listOf("paywall", "no_paywall", "fallback", "unavailable").forEach { add("outcome.$it") }
        add("override.qa")
    }
    private val supportedExperimentFeatures = setOf(
        "allocation.ranges", "assignment.installation", "assignment.identified_user",
        "assignment.identified_user_or_installation", "fallback.normal_placement",
        "group.mutual_exclusion", "override.qa", "schedule.trusted_server_time",
    )
    private val supportedExperimentAlgorithms = setOf(
        MOSAIC_EXPERIMENT_BUCKETING_ALGORITHM,
        MOSAIC_EXPERIMENT_GROUP_BUCKETING_ALGORITHM,
    )
    private val attributeOperators = mapOf(
        "string" to setOf("equals", "not_equals", "in", "not_in", "exists", "does_not_exist"),
        "boolean" to setOf("equals", "not_equals", "exists", "does_not_exist"),
        "number" to setOf("equals", "not_equals", "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "exists", "does_not_exist"),
        "timestamp" to setOf("equals", "not_equals", "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "exists", "does_not_exist"),
        "semantic_version" to setOf("equals", "not_equals", "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "exists", "does_not_exist"),
        "string_list" to setOf("contains_any", "contains_all", "exists", "does_not_exist"),
    )

    /**
     * Every rejection leaves the caller with [MosaicConfigurationDeliveryException] rather than
     * whichever `require` or `error` fired first: a rejected release resolves through cached
     * configuration and then the bundled fallback, and that recovery must not depend on the
     * implementation exception type of a strict wire reader.
     */
    fun decode(
        source: String,
        capabilityReport: MosaicCapabilityReport = MosaicProtocolCapabilities.report(),
    ): MosaicConfigurationRelease = try {
        decodeRelease(source, capabilityReport)
    } catch (error: MosaicConfigurationDeliveryException) {
        throw error
    } catch (error: RuntimeException) {
        throw MosaicConfigurationDeliveryException(
            "The Configuration Delivery release is invalid.",
            error,
        )
    }

    private fun decodeRelease(source: String, capabilityReport: MosaicCapabilityReport): MosaicConfigurationRelease {
        require(source.toByteArray().size <= 4 * 1024 * 1024) { "Configuration Delivery exceeds the SDK limit." }
        val root = JsonParser.parseString(source).asObject("$")
        root.requireExact(setOf("configurationDeliveryVersion", "release"), emptySet(), "$")
        require(root.string("configurationDeliveryVersion") == MOSAIC_CONFIGURATION_DELIVERY_VERSION)
        val release = root.objectValue("release", "$.release")
        release.requireExact(
            setOf("id", "number", "projectId", "environment", "publishedAt", "contentDigest", "compatibility", "placementDecisions", "paywallVersions", "productReferences", "entitlementReferences", "assetReferences", "experimentAssignments"),
            emptySet(), "$.release",
        )
        val projectId = release.identifier("projectId", "$.release")
        val environmentObject = release.objectValue("environment", "$.release.environment")
        environmentObject.requireExact(setOf("id", "key", "mode"), emptySet(), "$.release.environment")
        val environment = MosaicDeliveryEnvironment(
            environmentObject.identifier("id", "$.release.environment"),
            environmentObject.string("key").also { require(environmentKey.matches(it)) },
            when (environmentObject.string("mode")) {
                "development" -> MosaicDeliveryEnvironmentMode.DEVELOPMENT
                "staging" -> MosaicDeliveryEnvironmentMode.STAGING
                "production" -> MosaicDeliveryEnvironmentMode.PRODUCTION
                else -> error("Unsupported Environment mode.")
            },
        )
        val releaseCompatibility = validateCompatibility(
            release.objectValue("compatibility", "$.release.compatibility"),
            capabilityReport,
        )
        val products = release.array("productReferences", 0, 1024).mapIndexed { index, element ->
            val value = element.asObject("$.release.productReferences[$index]")
            value.requireExact(setOf("id", "type", "fallbackDisplayName", "readiness"), emptySet(), "product")
            val type = value.string("type").also { require(it == "subscription" || it == "one_time_non_consumable") }
            MosaicDeliveryProduct(
                value.identifier("id", "product"), type, value.string("fallbackDisplayName"),
                when (value.string("readiness")) { "ready" -> MosaicProductReadiness.READY; "not_ready" -> MosaicProductReadiness.NOT_READY; else -> error("Unsupported Product readiness.") },
            )
        }.associateUnique({ it.id }, "Product")
        val entitlements = release.array("entitlementReferences", 0, 1024).mapIndexed { index, element ->
            val value = element.asObject("$.release.entitlementReferences[$index]")
            value.requireExact(setOf("id", "key"), emptySet(), "entitlement")
            MosaicDeliveryEntitlement(value.identifier("id", "entitlement"), value.string("key").also { require(key.matches(it)) })
        }.associateUnique({ it.id }, "Entitlement")
        require(entitlements.values.map { it.key }.toSet().size == entitlements.size) { "Duplicate Entitlement key." }
        val assets = release.array("assetReferences", 0, 1024).mapIndexed { index, element -> parseAsset(element, index) }.associateUnique({ it.id }, "Asset")
        val paywalls = release.array("paywallVersions", 0, 256).mapIndexed { index, element -> parsePaywall(element, index, capabilityReport) }.associateUnique({ it.id }, "Paywall Version")
        val decisionList = release.array("placementDecisions", 1, 256).mapIndexed { index, element ->
            parseDecision(element, index, environment.mode)
        }
        require(decisionList.map { it.placementId }.toSet().size == decisionList.size) { "Duplicate Placement ID." }
        require(decisionList.map { it.id }.toSet().size == decisionList.size) { "Duplicate Rule Set ID." }
        val decisions = decisionList.associateUnique({ it.placementKey }, "Placement")

        decisions.values.forEach { ruleSet ->
            require(ruleSet.projectId == projectId && ruleSet.environmentId == environment.id && ruleSet.environmentKey == environment.key) { "Placement Decision ownership does not match its release." }
            allOutcomes(ruleSet).forEach { outcome ->
                if (outcome is MosaicDecisionOutcome.Paywall) require(outcome.paywallVersionId in paywalls) { "Decision references an unknown Paywall Version." }
            }
            referencedProducts(ruleSet).forEach { require(it in products) { "Decision references an unknown Product." } }
            referencedEntitlements(ruleSet).forEach { entitlementKey -> require(entitlements.values.any { it.key == entitlementKey }) { "Decision references an unknown Entitlement." } }
        }
        paywalls.values.forEach { paywall ->
            require(paywall.paywallId == paywall.document.id)
            require(paywall.productReferenceIds.toSet() == paywall.document.products.mapTo(mutableSetOf()) { it.providerProductId }) {
                "Paywall Product references must exactly equal its document Products."
            }
            require(paywall.productReferenceIds.all { it in products })
            val remoteAssets = paywall.document.assets.filter { it.source is MosaicAssetSource.Remote }.associateBy { it.id }
            require(paywall.assetBindings.keys == remoteAssets.keys) {
                "Paywall Asset bindings must exactly equal its remote document Assets."
            }
            paywall.assetBindings.forEach { (documentAssetId, referenceId) ->
                val documentAsset = remoteAssets.getValue(documentAssetId)
                val reference = requireNotNull(assets[referenceId]) { "Paywall references an unknown Asset." }
                require(reference.kind == if (documentAsset is MosaicImageAsset) "image" else "video")
                require(reference.url == (documentAsset.source as MosaicAssetSource.Remote).url)
            }
        }
        val referencedPaywalls = decisions.values.flatMap(::allOutcomes)
            .filterIsInstance<MosaicDecisionOutcome.Paywall>()
            .mapTo(mutableSetOf()) { it.paywallVersionId }
        require(referencedPaywalls == paywalls.keys) { "Paywall Versions must exactly equal decision references." }
        val referencedProductIds = decisions.values.flatMap(::referencedProducts).toMutableSet().apply {
            paywalls.values.flatMapTo(this) { it.productReferenceIds }
        }
        require(referencedProductIds == products.keys) { "Product references must exactly equal release usage." }
        val referencedEntitlementKeys = decisions.values.flatMap(::referencedEntitlements).toSet()
        require(referencedEntitlementKeys == entitlements.values.mapTo(mutableSetOf()) { it.key }) {
            "Entitlement references must exactly equal decision usage."
        }
        val requiredFeatures = decisions.values.flatMapTo(mutableSetOf()) { it.requiredFeatures }
        val requiredAlgorithms = decisions.values.flatMapTo(mutableSetOf()) { it.requiredBucketingAlgorithms }
        require(requiredFeatures == releaseCompatibility.decisionFeatures) {
            "Release requiredFeatures must exactly equal embedded Rule Set requirements."
        }
        require(requiredAlgorithms == releaseCompatibility.bucketingAlgorithms) {
            "Release bucketingAlgorithms must exactly equal embedded Rule Set requirements."
        }
        val requiredPaywallCapabilities = paywalls.values
            .flatMap { it.document.compatibility.requiredCapabilities }
            .toSet()
        require(requiredPaywallCapabilities == releaseCompatibility.paywallCapabilities) {
            "Release Paywall compatibility must exactly equal embedded documents."
        }
        require(paywalls.values.flatMap { it.assetBindings.values }.toSet() == assets.keys) {
            "Asset references must exactly equal Paywall usage."
        }
        val declaredDigest = release.string("contentDigest").also { require(digest.matches(it)) }
        val material = release.deepCopy().also { it.remove("contentDigest") }
        require(declaredDigest == canonicalDigest(material)) { "Configuration Delivery contentDigest mismatch." }

        val assignments = release.array("experimentAssignments", 0, 64).map { element ->
            MosaicExperimentAssignmentDecoder.decode(
                JsonObject().apply {
                    addProperty("experimentAssignmentVersion", "1")
                    add("assignment", element)
                },
                environment.mode == MosaicDeliveryEnvironmentMode.PRODUCTION,
            )
        }
        require(assignments.map { it.experimentId }.toSet().size == assignments.size)
        require(assignments.map { it.experimentVersionId }.toSet().size == assignments.size)
        require(assignments.flatMap { it.requiredFeatures }.toSet() == releaseCompatibility.experimentFeatures)
        require(assignments.flatMap { it.requiredBucketingAlgorithms }.toSet() == releaseCompatibility.experimentAlgorithms)
        require(assignments.flatMap { it.requiredSchedulePolicies }.toSet() == releaseCompatibility.experimentSchedules)
        val decisionsById = decisions.values.associateBy { it.placementId }
        val groupSnapshots = mutableMapOf<Pair<String, String>, MosaicExperimentGroup>()
        assignments.forEach { assignment ->
            require(assignment.projectId == projectId && assignment.environmentId == environment.id)
            val decision = requireNotNull(decisionsById[assignment.placementId])
            require(allDecisionPaywalls(decision).contains(assignment.controlPaywallVersionId))
            assignment.mutualExclusionGroup?.let { group ->
                require(group.members.any { it.experimentId == assignment.experimentId })
                val key = group.id to group.versionId
                require(groupSnapshots.putIfAbsent(key, group)?.let { it == group } != false)
            }
            assignment.variants.forEach { variant ->
                val paywall = requireNotNull(paywalls[variant.paywallVersionId])
                require(paywall.paywallId == variant.paywallId)
                require(paywall.productReferenceIds.toSet() == variant.compatibility.requiredProductIds)
                require(variant.compatibility.requiredProductIds.all(products::containsKey))
            }
        }

        return MosaicConfigurationRelease(
            id = release.identifier("id", "$.release"),
            number = release.get("number").asLong.also { require(it in 1..9_007_199_254_740_991L) },
            projectId = projectId,
            environment = environment,
            publishedAt = release.string("publishedAt").also { require(parseDecisionUtcMillis(it) != null) },
            contentDigest = declaredDigest,
            paywallVersions = paywalls,
            productReferences = products,
            assetReferences = assets,
            encoded = source,
            placementDecisions = decisions,
            entitlementReferences = entitlements,
            experimentAssignments = assignments,
        )
    }

    private fun allDecisionPaywalls(ruleSet: MosaicPlacementRuleSet): Set<String> =
        allOutcomes(ruleSet).filterIsInstance<MosaicDecisionOutcome.Paywall>()
            .mapTo(mutableSetOf()) { it.paywallVersionId }

    private data class ReleaseCompatibility(
        val decisionFeatures: Set<String>,
        val bucketingAlgorithms: Set<String>,
        val paywallCapabilities: Set<MosaicRequiredCapability>,
        val experimentFeatures: Set<String>,
        val experimentAlgorithms: Set<String>,
        val experimentSchedules: Set<String>,
    )

    private fun validateCompatibility(
        value: JsonObject,
        capabilityReport: MosaicCapabilityReport,
    ): ReleaseCompatibility {
        value.requireExact(
            setOf("placementDecisionContracts", "paywallProtocols", "acceptance", "experimentAssignmentContracts"),
            emptySet(), "compatibility",
        )
        require(value.string("acceptance") == "atomic")
        val decision = value.array("placementDecisionContracts", 1, 1).single().asObject("decision compatibility")
        decision.requireExact(setOf("version", "requiredFeatures", "bucketingAlgorithms"), emptySet(), "decision compatibility")
        require(decision.string("version") == "1")
        val features = decision.stringArray("requiredFeatures", 0, 64)
        require(features.size == features.toSet().size && features.all { it in supportedFeatures }) { "Unsupported Placement Decision feature." }
        val algorithms = decision.stringArray("bucketingAlgorithms", 0, 1)
        require(algorithms.size == algorithms.toSet().size && algorithms.all { it == MOSAIC_ROLLOUT_ALGORITHM })
        val protocol = value.array("paywallProtocols", 1, 1).single().asObject("paywall compatibility")
        protocol.requireExact(setOf("version", "requiredCapabilities"), emptySet(), "paywall compatibility")
        require(protocol.string("version") == MOSAIC_PROTOCOL_VERSION)
        val paywallCapabilities = protocol.array("requiredCapabilities", 0, 128).map { entry ->
            val capability = entry.asObject("capability")
            capability.requireExact(setOf("name", "version"), emptySet(), "capability")
            val name = MosaicCapabilityName.entries.firstOrNull { it.wireName == capability.string("name") }
            requireNotNull(name).let { MosaicRequiredCapability(it, capability.string("version")) }
                .also { require(capabilityReport.supports(it)) }
        }
        require(paywallCapabilities.size == paywallCapabilities.toSet().size)
        val experiment = value.array("experimentAssignmentContracts", 1, 1).single()
            .asObject("experiment compatibility")
        experiment.requireExact(
            setOf("version", "requiredFeatures", "bucketingAlgorithms", "schedulePolicies"),
            emptySet(), "experiment compatibility",
        )
        require(experiment.string("version") == "1")
        val experimentFeatures = experiment.uniqueStrings("requiredFeatures", 0, 8)
            .also { require(it.all(supportedExperimentFeatures::contains)) }
        val experimentAlgorithms = experiment.uniqueStrings("bucketingAlgorithms", 0, 2)
            .also { require(it.all(supportedExperimentAlgorithms::contains)) }
        val experimentSchedules = experiment.uniqueStrings("schedulePolicies", 0, 1)
            .also { require(it.all { policy -> policy == MOSAIC_EXPERIMENT_TIME_POLICY }) }
        return ReleaseCompatibility(
            features.toSet(),
            algorithms.toSet(),
            paywallCapabilities.toSet(),
            experimentFeatures,
            experimentAlgorithms,
            experimentSchedules,
        )
    }

    private fun parseDecision(
        element: JsonElement,
        index: Int,
        environmentMode: MosaicDeliveryEnvironmentMode,
    ): MosaicPlacementRuleSet {
        require(element.toString().toByteArray(Charsets.UTF_8).size <= 256 * 1024) {
            "Placement Decision exceeds 256 KiB."
        }
        val wrapper = element.asObject("placementDecisions[$index]")
        wrapper.requireExact(setOf("placementDecisionVersion", "ruleSet"), emptySet(), "decision")
        require(wrapper.string("placementDecisionVersion") == "1")
        val value = wrapper.objectValue("ruleSet", "ruleSet")
        value.requireExact(
            setOf("id", "version", "projectId", "environmentId", "environmentKey", "placementId", "placementKey", "enabled", "assignmentPolicy", "attributeDefinitions", "fallbacks", "rules", "defaultOutcome", "qaOverrides", "compatibility"),
            emptySet(), "ruleSet",
        )
        val definitions = value.array("attributeDefinitions", 0, 32).map { entry ->
            val item = entry.asObject("attributeDefinition")
            item.requireExact(setOf("key", "type", "sensitivity", "allowedOperators"), emptySet(), "attributeDefinition")
            val definitionKey = item.string("key").also { require(key.matches(it)) }
            val operators = item.stringArray("allowedOperators", 1, 13).also { require(it.size == it.toSet().size) }.toSet().also { require(it.all(supportedOperators::contains)) }
            val type = item.string("type").also { require(it in setOf("string", "boolean", "number", "timestamp", "semantic_version", "string_list")) }
            val sensitivity = when (item.string("sensitivity")) { "standard" -> MosaicAttributeSensitivity.STANDARD; "sensitive" -> MosaicAttributeSensitivity.SENSITIVE; else -> error("Unsupported attribute sensitivity.") }
            require(operators.all { it in attributeOperators.getValue(type) }) {
                "Attribute definition declares an operator incompatible with its type."
            }
            MosaicAttributeDefinition(definitionKey, type, sensitivity, operators)
        }.associateUnique({ it.key }, "attribute definition")
        val fallbacks = value.array("fallbacks", 0, 32).map { entry ->
            val item = entry.asObject("fallback")
            item.requireExact(setOf("key", "outcome"), setOf("safeLabel"), "fallback")
            MosaicNamedFallback(item.string("key").also { require(key.matches(it)) }, item.optionalString("safeLabel"), parseOutcome(item.objectValue("outcome", "fallback.outcome")))
        }.associateUnique({ it.key }, "fallback")
        val rules = value.array("rules", 0, 100).map { entry ->
            val item = entry.asObject("rule")
            item.requireExact(setOf("id", "priority", "enabled", "conditions", "outcome"), setOf("safeLabel", "rollout"), "rule")
            val stats = NodeStats()
            val conditions = parseNode(item.objectValue("conditions", "rule.conditions"), 1, stats)
            require(stats.depth <= 5 && stats.leaves <= 64)
            val rollout = item.get("rollout")?.let { rolloutElement ->
                val rollout = rolloutElement.asObject("rollout")
                rollout.requireExact(setOf("algorithm", "thresholdBasisPoints"), emptySet(), "rollout")
                require(rollout.string("algorithm") == MOSAIC_ROLLOUT_ALGORITHM)
                MosaicDecisionRollout(rollout.get("thresholdBasisPoints").asInt.also { require(it in 0..10_000) })
            }
            MosaicPlacementRule(item.identifier("id", "rule"), item.get("priority").asInt.also { require(it in 0..9999) }, item.get("enabled").asBoolean, item.optionalString("safeLabel"), conditions, rollout, parseOutcome(item.objectValue("outcome", "rule.outcome")))
        }
        require(rules.map { it.id }.toSet().size == rules.size && rules.map { it.priority }.toSet().size == rules.size) { "Duplicate rule ID or priority." }
        val overrides = value.array("qaOverrides", 0, 32).map { entry ->
            val item = entry.asObject("qaOverride")
            item.requireExact(setOf("id", "selectorDigest", "safeLabel", "startsAt", "expiresAt", "outcome"), emptySet(), "qaOverride")
            val startsAt = requireNotNull(parseDecisionUtcMillis(item.string("startsAt")))
            val expiresAt = requireNotNull(parseDecisionUtcMillis(item.string("expiresAt")))
            MosaicQAOverride(item.identifier("id", "qaOverride"), item.string("selectorDigest").also { require(digest.matches(it)) }, item.string("safeLabel"), startsAt, expiresAt, parseOutcome(item.objectValue("outcome", "qaOverride.outcome"))).also {
                require(it.expiresAtEpochMillis > it.startsAtEpochMillis)
                require(it.expiresAtEpochMillis - it.startsAtEpochMillis <= 86_400_000L) {
                    "QA overrides must expire within 24 hours."
                }
            }
        }
        require(overrides.map { it.id }.toSet().size == overrides.size)
        require(overrides.map { it.selectorDigest }.toSet().size == overrides.size)
        require(overrides.isEmpty() || environmentMode != MosaicDeliveryEnvironmentMode.PRODUCTION) {
            "QA overrides are forbidden in production."
        }
        val compatibility = value.objectValue("compatibility", "ruleSet.compatibility")
        compatibility.requireExact(setOf("requiredFeatures", "bucketingAlgorithms"), emptySet(), "ruleSet.compatibility")
        val declaredFeatureList = compatibility.stringArray("requiredFeatures", 0, 64)
        require(declaredFeatureList.size == declaredFeatureList.toSet().size)
        val features = declaredFeatureList.toSet().also { require(it.all(supportedFeatures::contains)) }
        val declaredAlgorithmList = compatibility.stringArray("bucketingAlgorithms", 0, 1)
        require(declaredAlgorithmList.size == declaredAlgorithmList.toSet().size)
        val algorithms = declaredAlgorithmList.toSet().also { require(it.all { algorithm -> algorithm == MOSAIC_ROLLOUT_ALGORITHM }) }
        val ruleSet = MosaicPlacementRuleSet(
            value.identifier("id", "ruleSet"), value.get("version").asLong.also { require(it >= 1) }, value.identifier("projectId", "ruleSet"), value.identifier("environmentId", "ruleSet"), value.string("environmentKey").also { require(environmentKey.matches(it)) }, value.identifier("placementId", "ruleSet"), value.string("placementKey").also { require(key.matches(it)) }, value.get("enabled").asBoolean,
            when (value.string("assignmentPolicy")) { "installation" -> MosaicAssignmentPolicy.INSTALLATION; "identified_user" -> MosaicAssignmentPolicy.IDENTIFIED_USER; "identified_user_or_installation" -> MosaicAssignmentPolicy.IDENTIFIED_USER_OR_INSTALLATION; else -> error("Unsupported assignment policy.") },
            definitions, fallbacks, rules, parseOutcome(value.objectValue("defaultOutcome", "defaultOutcome")), overrides, features, algorithms,
        )
        ruleSet.rules.flatMap { collectConditions(it.conditions) }.forEach { condition ->
            validateCondition(condition, definitions)
        }
        require(features == deriveFeatures(ruleSet)) {
            "Rule Set requiredFeatures must exactly equal used semantics."
        }
        val expectedAlgorithms = if (rules.any { it.rollout != null }) setOf(MOSAIC_ROLLOUT_ALGORITHM) else emptySet()
        require(algorithms == expectedAlgorithms) {
            "Rule Set bucketingAlgorithms must exactly equal used algorithms."
        }
        validateFallbackGraph(ruleSet)
        return ruleSet
    }

    private class NodeStats(var leaves: Int = 0, var depth: Int = 0)
    private fun parseNode(value: JsonObject, depth: Int, stats: NodeStats): MosaicConditionNode {
        stats.depth = maxOf(stats.depth, depth)
        return when (value.string("type")) {
            "all", "any" -> {
                value.requireExact(setOf("type", "children"), emptySet(), "condition group")
                val children = value.array("children", 2, 16).map { parseNode(it.asObject("condition child"), depth + 1, stats) }
                if (value.string("type") == "all") MosaicConditionNode.All(children) else MosaicConditionNode.Any(children)
            }
            "not" -> { value.requireExact(setOf("type", "child"), emptySet(), "not condition"); MosaicConditionNode.Not(parseNode(value.objectValue("child", "not.child"), depth + 1, stats)) }
            "condition" -> {
                stats.leaves++
                value.requireExact(setOf("type", "source", "operator"), setOf("operand"), "condition")
                val operator = value.string("operator").also { require(it in supportedOperators) }
                require((operator in setOf("exists", "does_not_exist")) == !value.has("operand"))
                MosaicConditionNode.Condition(parseSource(value.objectValue("source", "condition.source")), operator, value.get("operand")?.asObject("operand")?.let { parseTypedValue(it, "operand") })
            }
            else -> error("Unsupported condition type.")
        }
    }

    private fun parseSource(value: JsonObject): MosaicDecisionSource {
        val kind = value.string("kind").also { require(it in supportedSources) }
        return when (kind) {
            "user_attribute" -> { value.requireExact(setOf("kind", "key"), emptySet(), "source"); MosaicDecisionSource.UserAttribute(value.string("key").also { require(key.matches(it)) }) }
            "entitlement_state" -> { value.requireExact(setOf("kind", "key"), emptySet(), "source"); MosaicDecisionSource.Entitlement(value.string("key").also { require(key.matches(it)) }) }
            "product_availability", "product_readiness" -> { value.requireExact(setOf("kind", "productId"), emptySet(), "source"); MosaicDecisionSource.Product(kind, value.identifier("productId", "source")) }
            "provider_capability" -> { value.requireExact(setOf("kind", "capability"), emptySet(), "source"); MosaicDecisionSource.ProviderCapability(value.string("capability").also { require(it in setOf("product_loading", "purchase", "restore", "entitlement_lookup")) }) }
            else -> { value.requireExact(setOf("kind"), emptySet(), "source"); MosaicDecisionSource.Scalar(kind) }
        }
    }

    private fun parseOutcome(value: JsonObject): MosaicDecisionOutcome = when (value.string("type")) {
        "paywall" -> { value.requireExact(setOf("type", "paywallVersionId"), setOf("unavailableFallbackKey"), "outcome"); MosaicDecisionOutcome.Paywall(value.identifier("paywallVersionId", "outcome"), value.optionalString("unavailableFallbackKey")) }
        "no_paywall" -> { value.requireExact(setOf("type"), emptySet(), "outcome"); MosaicDecisionOutcome.NoPaywall }
        "fallback" -> { value.requireExact(setOf("type", "key"), emptySet(), "outcome"); MosaicDecisionOutcome.Fallback(value.string("key").also { require(key.matches(it)) }) }
        "unavailable" -> { value.requireExact(setOf("type", "reason"), emptySet(), "outcome"); MosaicDecisionOutcome.Unavailable(value.string("reason").also { require(it in setOf("no_safe_decision", "configuration_incompatible", "content_unavailable", "commerce_unavailable")) }) }
        else -> error("Unsupported outcome.")
    }

    private data class SourceContract(
        val type: String,
        val operators: Set<String>,
        val values: Set<String>? = null,
    )

    private fun validateCondition(
        condition: MosaicConditionNode.Condition,
        definitions: Map<String, MosaicAttributeDefinition>,
    ) {
        val contract = when (val source = condition.source) {
            is MosaicDecisionSource.Scalar -> when (source.kind) {
                "device.platform" -> SourceContract("string", setOf("equals", "not_equals", "in", "not_in"), setOf("ios", "android"))
                "device.os_version", "application.version" -> SourceContract("semantic_version", setOf("equals", "not_equals", "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "exists", "does_not_exist"))
                "application.locale" -> SourceContract("string", setOf("equals", "not_equals", "in", "not_in", "exists", "does_not_exist", "locale_matches"))
                "context.country" -> SourceContract("string", setOf("equals", "not_equals", "in", "not_in", "exists", "does_not_exist"))
                "environment.id", "environment.key" -> SourceContract("string", setOf("equals", "not_equals", "in", "not_in"))
                "identity.user_present" -> SourceContract("boolean", setOf("equals", "not_equals"))
                else -> error("Unsupported scalar source.")
            }
            is MosaicDecisionSource.UserAttribute -> requireNotNull(definitions[source.key]) {
                "Rule references an undefined attribute."
            }.let { SourceContract(it.type, it.allowedOperators) }
            is MosaicDecisionSource.Entitlement -> SourceContract(
                "string",
                setOf("equals", "not_equals", "in", "not_in"),
                setOf("active", "inactive", "unknown", "provider_unavailable", "failed"),
            )
            is MosaicDecisionSource.Product -> when (source.kind) {
                "product_availability" -> SourceContract(
                    "string",
                    setOf("equals", "not_equals", "in", "not_in"),
                    setOf("available", "unavailable", "unknown", "provider_unavailable", "failed"),
                )
                "product_readiness" -> SourceContract("string", setOf("equals", "not_equals"), setOf("ready", "not_ready"))
                else -> error("Unsupported Product source.")
            }
            is MosaicDecisionSource.ProviderCapability -> SourceContract(
                "string",
                setOf("equals", "not_equals"),
                setOf("available", "unavailable", "unknown"),
            )
        }
        require(condition.operator in contract.operators) { "Source/operator combination is incompatible." }
        val operand = condition.operand ?: return
        val expectedType = if (condition.operator in setOf("in", "not_in")) "string_list" else contract.type
        require(operand.wireType() == expectedType) { "Condition operand has the wrong type." }
        val strings = when (operand) {
            is MosaicTypedValue.StringValue -> listOf(operand.value)
            is MosaicTypedValue.StringListValue -> operand.value
            else -> emptyList()
        }
        contract.values?.let { values ->
            require(strings.all { it in values }) { "Condition operand is outside the closed source state set." }
        }
        val scalarKind = (condition.source as? MosaicDecisionSource.Scalar)?.kind
        if (scalarKind == "context.country") require(strings.all { Regex("^[A-Z]{2}$").matches(it) }) {
            "Country operands must be canonical ISO alpha-2 values."
        }
        if (condition.operator == "locale_matches") {
            require(strings.singleOrNull()?.matches(Regex("^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$")) == true) {
                "locale_matches requires a bounded BCP 47 range."
            }
        }
    }

    private fun deriveFeatures(ruleSet: MosaicPlacementRuleSet): Set<String> = buildSet {
        fun addOutcome(outcome: MosaicDecisionOutcome) {
            add(
                "outcome." + when (outcome) {
                    is MosaicDecisionOutcome.Paywall -> "paywall"
                    MosaicDecisionOutcome.NoPaywall -> "no_paywall"
                    is MosaicDecisionOutcome.Fallback -> "fallback"
                    is MosaicDecisionOutcome.Unavailable -> "unavailable"
                },
            )
        }
        fun addNode(node: MosaicConditionNode) {
            when (node) {
                is MosaicConditionNode.Condition -> {
                    add("source.${node.source.wireKind()}")
                    add("operator.${node.operator}")
                }
                is MosaicConditionNode.All -> {
                    add("condition.all")
                    node.children.forEach(::addNode)
                }
                is MosaicConditionNode.Any -> {
                    add("condition.any")
                    node.children.forEach(::addNode)
                }
                is MosaicConditionNode.Not -> {
                    add("condition.not")
                    addNode(node.child)
                }
            }
        }
        addOutcome(ruleSet.defaultOutcome)
        ruleSet.fallbacks.values.forEach { addOutcome(it.outcome) }
        ruleSet.qaOverrides.forEach {
            add("override.qa")
            addOutcome(it.outcome)
        }
        ruleSet.rules.forEach {
            addOutcome(it.outcome)
            addNode(it.conditions)
        }
    }

    private fun parsePaywall(element: JsonElement, index: Int, capabilityReport: MosaicCapabilityReport): MosaicDeliveredPaywall {
        val value = element.asObject("paywallVersions[$index]")
        value.requireExact(setOf("id", "paywallId", "protocolVersion", "documentDigest", "document", "productReferenceIds", "assetBindings"), emptySet(), "paywallVersion")
        require(value.string("protocolVersion") == MOSAIC_PROTOCOL_VERSION)
        val documentDigest = value.string("documentDigest").also { require(digest.matches(it)) }
        require(documentDigest == canonicalDigest(value.get("document")))
        val bindings = value.array("assetBindings", 0, 128).map { entry ->
            val binding = entry.asObject("assetBinding")
            binding.requireExact(setOf("documentAssetId", "assetReferenceId"), emptySet(), "assetBinding")
            binding.identifier("documentAssetId", "assetBinding") to binding.identifier("assetReferenceId", "assetBinding")
        }.associateUnique({ it.first }, "asset binding").mapValues { it.value.second }
        return MosaicDeliveredPaywall(value.identifier("id", "paywallVersion"), value.identifier("paywallId", "paywallVersion"), MOSAIC_PROTOCOL_VERSION, documentDigest, MosaicProtocolDecoder.decode(value.get("document").toString(), capabilityReport), value.stringArray("productReferenceIds", 0, 64).also { require(it.size == it.toSet().size) }, bindings)
    }

    private fun parseAsset(element: JsonElement, index: Int): MosaicDeliveryAsset {
        val value = element.asObject("assetReferences[$index]")
        value.requireExact(setOf("id", "kind", "mediaType", "byteLength", "contentDigest", "url"), emptySet(), "asset")
        return MosaicDeliveryAsset(value.identifier("id", "asset"), value.string("kind").also { require(it in setOf("image", "video")) }, value.string("mediaType"), value.get("byteLength").asLong.also { require(it > 0) }, value.string("contentDigest").also { require(digest.matches(it)) }, value.string("url").also { require(it.startsWith("https://")) })
    }

    private fun validateFallbackGraph(ruleSet: MosaicPlacementRuleSet) {
        fun visit(outcome: MosaicDecisionOutcome, path: Set<String>, depth: Int) {
            val fallbackKey = when (outcome) {
                is MosaicDecisionOutcome.Fallback -> outcome.key
                is MosaicDecisionOutcome.Paywall -> outcome.unavailableFallbackKey
                else -> null
            } ?: return
            require(fallbackKey !in path) { "Fallback cycle." }
            require(depth < 8) { "Fallback depth exceeds 8." }
            visit(
                requireNotNull(ruleSet.fallbacks[fallbackKey]) { "Outcome references an unknown fallback." }.outcome,
                path + fallbackKey,
                depth + 1,
            )
        }
        allOutcomes(ruleSet).forEach { visit(it, emptySet(), 0) }
    }

    private fun referencedProducts(ruleSet: MosaicPlacementRuleSet) = ruleSet.rules.flatMap { collectSources(it.conditions) }.filterIsInstance<MosaicDecisionSource.Product>().map { it.productId }.toSet()
    private fun referencedEntitlements(ruleSet: MosaicPlacementRuleSet) = ruleSet.rules.flatMap { collectSources(it.conditions) }.filterIsInstance<MosaicDecisionSource.Entitlement>().map { it.key }.toSet()
    private fun collectSources(node: MosaicConditionNode): List<MosaicDecisionSource> = when (node) { is MosaicConditionNode.Condition -> listOf(node.source); is MosaicConditionNode.All -> node.children.flatMap(::collectSources); is MosaicConditionNode.Any -> node.children.flatMap(::collectSources); is MosaicConditionNode.Not -> collectSources(node.child) }
    private fun collectConditions(node: MosaicConditionNode): List<MosaicConditionNode.Condition> = when (node) { is MosaicConditionNode.Condition -> listOf(node); is MosaicConditionNode.All -> node.children.flatMap(::collectConditions); is MosaicConditionNode.Any -> node.children.flatMap(::collectConditions); is MosaicConditionNode.Not -> collectConditions(node.child) }
    private fun allOutcomes(ruleSet: MosaicPlacementRuleSet) = ruleSet.rules.map { it.outcome } + ruleSet.defaultOutcome + ruleSet.fallbacks.values.map { it.outcome } + ruleSet.qaOverrides.map { it.outcome }

    private val gson = GsonBuilder().disableHtmlEscaping().create()
    private fun canonicalDigest(value: JsonElement): String = "sha256:" + MessageDigest.getInstance("SHA-256").digest(canonicalJson(value).toByteArray()).joinToString("") { "%02x".format(it) }
    private fun canonicalJson(value: JsonElement): String = when { value.isJsonNull -> "null"; value.isJsonArray -> value.asJsonArray.joinToString(",", "[", "]") { canonicalJson(it) }; value.isJsonObject -> value.asJsonObject.entrySet().sortedBy { it.key }.joinToString(",", "{", "}") { (key, child) -> "${gson.toJson(key)}:${canonicalJson(child)}" }; value.asJsonPrimitive.isString -> gson.toJson(value.asString); value.asJsonPrimitive.isBoolean -> value.asBoolean.toString(); else -> value.asBigDecimal.stripTrailingZeros().toPlainString() }

    private fun JsonElement.asObject(path: String) = takeIf(JsonElement::isJsonObject)?.asJsonObject ?: error("Expected object at $path.")
    private fun JsonObject.objectValue(name: String, path: String) = get(name)?.asObject(path) ?: error("Missing $name.")
    private fun JsonObject.string(name: String) = get(name)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString ?: error("Expected string $name.")
    private fun JsonObject.optionalString(name: String) = get(name)?.takeUnless(JsonElement::isJsonNull)?.let { require(it.isJsonPrimitive && it.asJsonPrimitive.isString); it.asString }
    private fun JsonObject.identifier(name: String, path: String) = string(name).also { require(identifier.matches(it)) { "Invalid identifier at $path." } }
    private fun JsonObject.array(name: String, min: Int, max: Int): JsonArray = get(name)?.takeIf(JsonElement::isJsonArray)?.asJsonArray?.also { require(it.size() in min..max) } ?: error("Expected array $name.")
    private fun JsonObject.stringArray(name: String, min: Int, max: Int) = array(name, min, max).map { require(it.isJsonPrimitive && it.asJsonPrimitive.isString); it.asString }
    private fun JsonObject.uniqueStrings(name: String, min: Int, max: Int): Set<String> =
        stringArray(name, min, max).also { require(it.size == it.toSet().size) }.toSet()
    private fun <T, K> List<T>.associateUnique(key: (T) -> K, label: String): Map<K, T> = associateBy(key).also { require(it.size == size) { "Duplicate $label." } }
}

private fun MosaicDecisionSource.wireKind(): String = when (this) {
    is MosaicDecisionSource.Scalar -> kind
    is MosaicDecisionSource.UserAttribute -> "user_attribute"
    is MosaicDecisionSource.Entitlement -> "entitlement_state"
    is MosaicDecisionSource.Product -> kind
    is MosaicDecisionSource.ProviderCapability -> "provider_capability"
}

private fun MosaicTypedValue.wireType(): String = when (this) {
    is MosaicTypedValue.StringValue -> "string"
    is MosaicTypedValue.BooleanValue -> "boolean"
    is MosaicTypedValue.NumberValue -> "number"
    is MosaicTypedValue.TimestampValue -> "timestamp"
    is MosaicTypedValue.SemanticVersionValue -> "semantic_version"
    is MosaicTypedValue.StringListValue -> "string_list"
}
