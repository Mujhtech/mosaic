package dev.mosaic.sdk

import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

object MosaicAnalyticsCodec {
    fun encodeEvent(event: MosaicAnalyticsEvent): String = event.toJson().toString()

    fun decodeEvent(source: String): MosaicAnalyticsEvent {
        require(source.toByteArray(Charsets.UTF_8).size <= MOSAIC_ANALYTICS_MAX_EVENT_BYTES)
        return parseEvent(JsonParser.parseString(source).asJsonObject)
    }

    fun encodeBatch(batch: MosaicAnalyticsBatch): String = JsonObject().apply {
        val versions = batch.events.map { it.eventSchemaVersion }.toSet()
        require(versions.size == 1 && versions.single() in setOf("1", "2"))
        addProperty("analyticsEventContractVersion", versions.single())
        addProperty("batchId", batch.batchId)
        addProperty("sentAt", batch.sentAt)
        add("events", JsonArray().also { values -> batch.events.forEach { values.add(it.toJson()) } })
    }.toString()

    fun decodeBatch(source: String): MosaicAnalyticsBatch {
        require(source.toByteArray(Charsets.UTF_8).size <= 512 * 1024)
        val root = JsonParser.parseString(source).asJsonObject
        root.exact(setOf("analyticsEventContractVersion", "batchId", "sentAt", "events"))
        val contractVersion = root.string("analyticsEventContractVersion").also { require(it in setOf("1", "2")) }
        val events = root.getAsJsonArray("events").map {
            require(it.toString().toByteArray(Charsets.UTF_8).size <= MOSAIC_ANALYTICS_MAX_EVENT_BYTES)
            parseEvent(it.asJsonObject).also { event -> require(event.eventSchemaVersion == contractVersion) }
        }
        require(events.size in 1..100 && events.map { it.eventId }.toSet().size == events.size)
        return MosaicAnalyticsBatch(root.identifier("batchId"), root.timestamp("sentAt"), events)
    }

    fun decodeResponse(source: String): MosaicAnalyticsIngestionResponse {
        val root = JsonParser.parseString(source).asJsonObject
        root.exact(setOf("analyticsEventContractVersion", "batchId", "receivedAt", "results"))
        require(root.string("analyticsEventContractVersion") in setOf("1", "2"))
        val results = root.getAsJsonArray("results").map { element ->
            val item = element.asJsonObject
            val id = item.identifier("eventId")
            when (item.string("status")) {
                "accepted" -> { item.exact(setOf("eventId", "status")); MosaicAnalyticsEventResult.Accepted(id) }
                "duplicate" -> { item.exact(setOf("eventId", "status")); MosaicAnalyticsEventResult.Duplicate(id) }
                "permanently_rejected" -> {
                    item.exact(setOf("eventId", "status", "code"))
                    MosaicAnalyticsEventResult.PermanentlyRejected(id, item.string("code").also { require(it in permanentRejectionCodes) })
                }
                "retryable" -> {
                    item.exact(setOf("eventId", "status", "code"), setOf("retryAfterSeconds"))
                    val retryAfter = item.optionalInt("retryAfterSeconds")?.also { require(it in 1..300) }
                    MosaicAnalyticsEventResult.Retryable(id, item.string("code").also { require(it in retryableRejectionCodes) }, retryAfter)
                }
                else -> error("Unknown analytics result status.")
            }
        }
        require(results.isNotEmpty() && results.size <= 100 && results.map { it.eventId }.toSet().size == results.size)
        return MosaicAnalyticsIngestionResponse(root.identifier("batchId"), root.timestamp("receivedAt"), results)
    }

    private fun parseEvent(root: JsonObject): MosaicAnalyticsEvent {
        root.exact(
            setOf("eventId", "eventSchemaVersion", "eventName", "occurredAt", "queuedAt", "authority", "correlation", "attribution", "payload"),
            setOf("identity", "sessionId", "context"),
        )
        val schemaVersion = root.string("eventSchemaVersion").also { require(it in setOf("1", "2")) }
        val eventName = root.string("eventName")
        val authority = root.string("authority")
        require(authority in setOf("client_observed", "trusted_server", "provider_confirmed"))
        val identity = root.getAsJsonObject("identity")?.let {
            it.exact(setOf("installationId", "generation"), setOf("applicationUserId"))
            val userId = it.optionalString("applicationUserId")?.also { value ->
                require(value.length in 1..256 && value.none { character -> character.code < 0x20 || character.code == 0x7f })
            }
            MosaicAnalyticsIdentity(it.identifier("installationId"), userId, it.integer("generation", 0, MAX_SAFE_INTEGER))
        }
        val context = root.getAsJsonObject("context")?.let(::parseContext)
        val correlation = parseCorrelation(root.getAsJsonObject("correlation"))
        val attribution = parseAttribution(root.getAsJsonObject("attribution"))
        val event = MosaicAnalyticsEvent(
            root.identifier("eventId"), schemaVersion, eventName, root.timestamp("occurredAt"), root.timestamp("queuedAt"), authority,
            identity, root.optionalIdentifier("sessionId"), context, correlation, attribution,
            parsePayload(eventName, root.getAsJsonObject("payload")),
        )
        validateEventSemantics(event)
        return event
    }

    private fun parseContext(value: JsonObject): MosaicAnalyticsContext {
        value.exact(setOf("platform", "sdkFamily", "sdkVersion"), setOf("operatingSystemVersion", "applicationVersion", "locale", "configurationDeliveryVersion", "commerceProviderContractVersion"))
        val platform = value.string("platform").also { require(it in setOf("ios", "android")) }
        val family = value.string("sdkFamily").also { require(it in setOf("flutter", "ios", "android")) }
        val sdkVersion = value.string("sdkVersion").also { require(VERSION_PATTERN.matches(it) && it.length <= 64) }
        val operatingSystemVersion = value.optionalString("operatingSystemVersion")?.also { require(OS_VERSION_PATTERN.matches(it) && it.length <= 64) }
        val applicationVersion = value.optionalString("applicationVersion")?.also { require(VERSION_PATTERN.matches(it) && it.length <= 64) }
        val locale = value.optionalString("locale")?.also { require(LOCALE_PATTERN.matches(it) && it.length <= 35) }
        val delivery = value.optionalString("configurationDeliveryVersion")?.also { require(it in setOf("1", "2", "3")) }
        val commerce = value.optionalString("commerceProviderContractVersion")?.also { require(it in setOf("1", "2")) }
        return MosaicAnalyticsContext(platform, family, sdkVersion, operatingSystemVersion, applicationVersion, locale, delivery, commerce)
    }

    private fun parseCorrelation(value: JsonObject): MosaicAnalyticsCorrelation {
        value.exact(emptySet(), setOf("placementRequestId", "paywallPresentationId", "productLoadAttemptId", "purchaseAttemptId", "restoreAttemptId", "providerOperationId", "providerUpdateId"))
        return MosaicAnalyticsCorrelation(value.optionalIdentifier("placementRequestId"), value.optionalIdentifier("paywallPresentationId"), value.optionalIdentifier("productLoadAttemptId"), value.optionalIdentifier("purchaseAttemptId"), value.optionalIdentifier("restoreAttemptId"), value.optionalIdentifier("providerOperationId"), value.optionalIdentifier("providerUpdateId"))
    }

    private fun parseAttribution(value: JsonObject): MosaicAnalyticsAttribution {
        value.exact(emptySet(), setOf("configurationReleaseId", "placementId", "placementRuleSetId", "placementRuleSetVersion", "winningRuleId", "paywallId", "paywallVersionId", "mosaicProductId", "planId", "providerId", "providerProductMappingId", "experimentId", "experimentVersionId", "experimentVariantId", "experimentAllocationVersion"))
        val result = MosaicAnalyticsAttribution(value.optionalIdentifier("configurationReleaseId"), value.optionalIdentifier("placementId"), value.optionalIdentifier("placementRuleSetId"), value.optionalLong("placementRuleSetVersion")?.also { require(it in 1..MAX_SAFE_INTEGER) }, value.optionalIdentifier("winningRuleId"), value.optionalIdentifier("paywallId"), value.optionalIdentifier("paywallVersionId"), value.optionalIdentifier("mosaicProductId"), value.optionalIdentifier("planId"), value.optionalIdentifier("providerId"), value.optionalIdentifier("providerProductMappingId"), value.optionalIdentifier("experimentId"), value.optionalIdentifier("experimentVersionId"), value.optionalIdentifier("experimentVariantId"), value.optionalIdentifier("experimentAllocationVersion"))
        val tuple = listOf(result.experimentId, result.experimentVersionId, result.experimentVariantId, result.experimentAllocationVersion)
        require(tuple.all { it == null } || tuple.all { it != null })
        return result
    }

    private fun parsePayload(name: String, value: JsonObject): MosaicAnalyticsPayload = when (name) {
        "placement_requested" -> { value.exact(setOf("decisionContractVersion")); MosaicAnalyticsPayload.PlacementRequested(value.string("decisionContractVersion")) }
        "placement_paywall_selected", "placement_no_paywall" -> { value.exact(setOf("finalOutcome", "decisionContractVersion"), setOf("assignmentKeyType", "bucketingAlgorithm", "rolloutBucket")); MosaicAnalyticsPayload.PlacementSelected(value.string("finalOutcome"), value.string("decisionContractVersion"), value.optionalString("assignmentKeyType"), value.optionalString("bucketingAlgorithm"), value.optionalInt("rolloutBucket")) }
        "placement_fallback_used" -> { value.exact(setOf("trigger", "fallbackKey", "finalOutcome"), setOf("diagnosticCode")); MosaicAnalyticsPayload.PlacementFallback(value.string("trigger"), value.string("fallbackKey"), value.string("finalOutcome"), value.optionalString("diagnosticCode")) }
        "placement_unavailable" -> { value.exact(setOf("reason"), setOf("diagnosticCode")); MosaicAnalyticsPayload.PlacementUnavailable(value.string("reason"), value.optionalString("diagnosticCode")) }
        "placement_evaluation_failed", "paywall_render_failed" -> { value.exact(setOf("diagnosticCode", "retryable")); MosaicAnalyticsPayload.DiagnosticFailure(name, value.string("diagnosticCode"), value.get("retryable").asBoolean) }
        "paywall_presented" -> { value.exact(emptySet()); MosaicAnalyticsPayload.PaywallPresented() }
        "paywall_dismissed" -> { value.exact(setOf("reason")); MosaicAnalyticsPayload.PaywallDismissed(value.string("reason")) }
        "paywall_action_selected" -> { value.exact(setOf("action"), setOf("componentId")); MosaicAnalyticsPayload.PaywallAction(value.string("action"), value.optionalString("componentId")) }
        "product_load_started" -> { value.exact(setOf("requestedProductCount")); MosaicAnalyticsPayload.ProductLoadStarted(value.get("requestedProductCount").asInt) }
        "product_load_completed" -> { value.exact(setOf("availableProductCount", "unavailableProductCount", "durationMs")); MosaicAnalyticsPayload.ProductLoadCompleted(value.get("availableProductCount").asInt, value.get("unavailableProductCount").asInt, value.get("durationMs").asLong) }
        "product_load_failed" -> { value.exact(setOf("requestedProductCount", "durationMs", "diagnosticCode", "retryable")); MosaicAnalyticsPayload.ProductLoadFailed(value.get("requestedProductCount").asInt, value.get("durationMs").asLong, value.string("diagnosticCode"), value.get("retryable").asBoolean) }
        "product_unavailable" -> { value.exact(setOf("reason"), setOf("diagnosticCode")); MosaicAnalyticsPayload.ProductUnavailable(value.string("reason"), value.optionalString("diagnosticCode")) }
        "product_selected" -> { value.exact(setOf("source")); MosaicAnalyticsPayload.ProductSelected(value.string("source")) }
        "purchase_started" -> { value.exact(emptySet()); MosaicAnalyticsPayload.PurchaseStarted() }
        "purchase_completed_client" -> { value.exact(setOf("outcome", "durationMs", "observedEntitlementKeys"), setOf("providerResultCode")); MosaicAnalyticsPayload.PurchaseCompleted(value.string("outcome"), value.get("durationMs").asLong, value.strings("observedEntitlementKeys"), value.optionalString("providerResultCode")) }
        "purchase_completed_provider" -> { value.exact(setOf("confirmationSource", "activeEntitlementKeys"), setOf("linkedClientEventId")); MosaicAnalyticsPayload.ProviderCompleted(value.string("confirmationSource"), value.strings("activeEntitlementKeys"), value.optionalString("linkedClientEventId")) }
        "purchase_pending", "purchase_deferred", "purchase_cancelled" -> { value.exact(setOf("durationMs"), setOf("providerResultCode")); MosaicAnalyticsPayload.PurchaseLifecycle(name, value.get("durationMs").asLong, value.optionalString("providerResultCode")) }
        "purchase_failed" -> { value.exact(setOf("durationMs", "diagnosticCode", "retryable")); MosaicAnalyticsPayload.PurchaseFailed(value.get("durationMs").asLong, value.string("diagnosticCode"), value.get("retryable").asBoolean) }
        "restore_started" -> { value.exact(setOf("providerId")); MosaicAnalyticsPayload.RestoreStarted(value.identifier("providerId")) }
        "restore_completed" -> { value.exact(setOf("providerId", "durationMs", "restoredProductIds", "observedEntitlementKeys")); MosaicAnalyticsPayload.RestoreCompleted(value.identifier("providerId"), value.get("durationMs").asLong, value.strings("restoredProductIds"), value.strings("observedEntitlementKeys")) }
        "restore_nothing_found", "restore_cancelled" -> { value.exact(setOf("providerId", "durationMs"), setOf("providerResultCode")); MosaicAnalyticsPayload.RestoreLifecycle(name, value.identifier("providerId"), value.get("durationMs").asLong, value.optionalString("providerResultCode")) }
        "restore_failed" -> { value.exact(setOf("providerId", "durationMs", "diagnosticCode", "retryable")); MosaicAnalyticsPayload.RestoreFailed(value.identifier("providerId"), value.get("durationMs").asLong, value.string("diagnosticCode"), value.get("retryable").asBoolean) }
        "experiment_assigned" -> { value.exact(setOf("assignmentKeyType", "bucketingAlgorithm", "bucket", "source")); MosaicAnalyticsPayload.ExperimentAssigned(value.string("assignmentKeyType"), value.string("bucketingAlgorithm"), value.get("bucket").asInt, value.string("source")) }
        "experiment_exposed" -> { value.exact(setOf("assignmentKeyType", "bucketingAlgorithm", "productReadiness", "providerCapability", "qaOverride")); MosaicAnalyticsPayload.ExperimentExposed(value.string("assignmentKeyType"), value.string("bucketingAlgorithm"), value.string("productReadiness"), value.string("providerCapability"), value.get("qaOverride").asBoolean) }
        "experiment_fallback_presented" -> { value.exact(setOf("reason", "presentedPaywallId", "presentedPaywallVersionId", "diagnosticCode")); MosaicAnalyticsPayload.ExperimentFallbackPresented(value.string("reason"), value.identifier("presentedPaywallId"), value.identifier("presentedPaywallVersionId"), value.string("diagnosticCode")) }
        "experiment_assignment_failed" -> { value.exact(setOf("diagnosticCode", "retryable")); MosaicAnalyticsPayload.ExperimentAssignmentFailed(value.string("diagnosticCode"), value.get("retryable").asBoolean) }
        else -> error("Unsupported analytics event name.")
    }

    private fun validateEventSemantics(event: MosaicAnalyticsEvent) {
        val client = event.eventName != "purchase_completed_provider"
        if (client) {
            require(event.authority == "client_observed" && event.identity != null && event.sessionId != null && event.context != null)
        } else {
            require(event.authority in setOf("trusted_server", "provider_confirmed"))
            require(event.correlation.purchaseAttemptId != null || event.correlation.providerOperationId != null || event.correlation.providerUpdateId != null)
        }
        val correlation = event.correlation
        val attribution = event.attribution
        if (event.context?.configurationDeliveryVersion == "3") require(event.eventSchemaVersion == "2")
        val experimentEvent = event.payload.isExperimentV2()
        val experimentAllowed = experimentEvent || event.eventName == "product_selected" ||
            event.eventName.startsWith("purchase_")
        require(!attribution.hasExperimentTuple() || (event.eventSchemaVersion == "2" && experimentAllowed))
        require(!experimentEvent || (event.eventSchemaVersion == "2" && attribution.hasExperimentTuple()))
        if (event.eventSchemaVersion == "2") validateV2FieldOwnership(event)
        fun requireCorrelation(vararg values: String?) = require(values.all { it != null })
        fun requireAttribution(vararg values: String?) = require(values.all { it != null })
        when (event.eventName) {
            "placement_requested", "placement_no_paywall", "placement_fallback_used", "placement_unavailable", "placement_evaluation_failed" -> {
                requireCorrelation(correlation.placementRequestId); requireAttribution(attribution.placementId)
            }
            "placement_paywall_selected" -> {
                requireCorrelation(correlation.placementRequestId); requireAttribution(attribution.placementId, attribution.paywallId, attribution.paywallVersionId)
            }
            "paywall_presented" -> { requireCorrelation(correlation.paywallPresentationId); requireAttribution(attribution.paywallId, attribution.paywallVersionId) }
            "paywall_dismissed", "paywall_action_selected" -> requireCorrelation(correlation.paywallPresentationId)
            "product_load_started" -> requireCorrelation(correlation.productLoadAttemptId, correlation.paywallPresentationId)
            "product_load_completed", "product_load_failed" -> requireCorrelation(correlation.productLoadAttemptId)
            "product_unavailable" -> { requireCorrelation(correlation.productLoadAttemptId); requireAttribution(attribution.mosaicProductId) }
            "product_selected" -> { requireCorrelation(correlation.paywallPresentationId); requireAttribution(attribution.paywallId, attribution.paywallVersionId, attribution.mosaicProductId) }
            "purchase_started", "purchase_completed_client", "purchase_pending", "purchase_deferred", "purchase_cancelled", "purchase_failed" -> {
                requireCorrelation(correlation.purchaseAttemptId); requireAttribution(attribution.mosaicProductId, attribution.providerId)
            }
            "purchase_completed_provider" -> requireAttribution(attribution.mosaicProductId, attribution.providerId)
            "restore_started", "restore_completed", "restore_nothing_found", "restore_cancelled", "restore_failed" -> requireCorrelation(correlation.restoreAttemptId)
            "paywall_render_failed" -> Unit
            "experiment_assigned" -> { requireCorrelation(correlation.placementRequestId); requireAttribution(attribution.placementId) }
            "experiment_exposed" -> { requireCorrelation(correlation.placementRequestId, correlation.paywallPresentationId); requireAttribution(attribution.placementId, attribution.paywallId, attribution.paywallVersionId) }
            "experiment_fallback_presented" -> { requireCorrelation(correlation.placementRequestId, correlation.paywallPresentationId); requireAttribution(attribution.placementId); require(attribution.paywallId == null && attribution.paywallVersionId == null) }
            "experiment_assignment_failed" -> requireCorrelation(correlation.placementRequestId)
        }
        validatePayloadSemantics(event.eventName, event.payload)
    }

    private fun validateV2FieldOwnership(event: MosaicAnalyticsEvent) {
        val placement = setOf("configurationReleaseId", "placementId", "placementRuleSetId", "placementRuleSetVersion", "winningRuleId")
        val paywall = placement + setOf("paywallId", "paywallVersionId")
        val product = paywall + setOf("mosaicProductId", "planId", "providerId", "providerProductMappingId")
        val experiment = setOf("experimentId", "experimentVersionId", "experimentVariantId", "experimentAllocationVersion")
        val allowed = when (event.eventName) {
            "experiment_assigned", "experiment_fallback_presented", "experiment_assignment_failed" -> placement + experiment
            "experiment_exposed" -> paywall + experiment
            "product_selected", "purchase_started", "purchase_completed_client", "purchase_completed_provider",
            "purchase_pending", "purchase_deferred", "purchase_cancelled", "purchase_failed" -> product + experiment
            "placement_requested", "placement_evaluation_failed" -> placement - "winningRuleId"
            "placement_paywall_selected", "placement_fallback_used", "paywall_presented", "paywall_dismissed",
            "paywall_action_selected", "paywall_render_failed", "product_load_started", "product_load_completed", "product_load_failed" -> paywall
            "placement_no_paywall", "placement_unavailable" -> placement
            "product_unavailable" -> product
            "restore_started", "restore_completed", "restore_nothing_found", "restore_cancelled", "restore_failed" -> setOf("configurationReleaseId")
            else -> emptySet()
        }
        val present = buildSet {
            fun field(name: String, value: Any?) { if (value != null) add(name) }
            with(event.attribution) {
                field("configurationReleaseId", configurationReleaseId); field("placementId", placementId)
                field("placementRuleSetId", placementRuleSetId); field("placementRuleSetVersion", placementRuleSetVersion)
                field("winningRuleId", winningRuleId); field("paywallId", paywallId); field("paywallVersionId", paywallVersionId)
                field("mosaicProductId", mosaicProductId); field("planId", planId); field("providerId", providerId)
                field("providerProductMappingId", providerProductMappingId); field("experimentId", experimentId)
                field("experimentVersionId", experimentVersionId); field("experimentVariantId", experimentVariantId)
                field("experimentAllocationVersion", experimentAllocationVersion)
            }
        }
        require(present.all(allowed::contains))
        require((event.attribution.placementRuleSetId == null) == (event.attribution.placementRuleSetVersion == null))
        require(event.attribution.winningRuleId == null || event.attribution.placementRuleSetId != null)
    }

    private fun validatePayloadSemantics(name: String, payload: MosaicAnalyticsPayload) {
        fun duration(value: Long) = require(value in 0..86_400_000)
        fun safe(value: String?) { value?.let { require(SAFE_CODE_PATTERN.matches(it) && it.length <= 96) } }
        when (payload) {
            is MosaicAnalyticsPayload.PlacementRequested -> require(payload.decisionContractVersion == "1")
            is MosaicAnalyticsPayload.PlacementSelected -> {
                require(payload.decisionContractVersion == "1")
                require(payload.finalOutcome == if (name == "placement_paywall_selected") "paywall" else "no_paywall")
                val rolloutValues = listOf(payload.assignmentKeyType, payload.bucketingAlgorithm, payload.rolloutBucket)
                require(rolloutValues.all { it == null } || rolloutValues.all { it != null })
                payload.assignmentKeyType?.let { require(it in setOf("installation", "identified_user")) }
                payload.bucketingAlgorithm?.let { require(it == "sha256_length_prefixed_v1") }
                payload.rolloutBucket?.let { require(it in 0..9_999) }
            }
            is MosaicAnalyticsPayload.PlacementFallback -> {
                require(payload.trigger in FALLBACK_TRIGGERS && FALLBACK_KEY_PATTERN.matches(payload.fallbackKey) && payload.fallbackKey.length <= 64)
                require(payload.finalOutcome in setOf("paywall", "no_paywall", "unavailable")); safe(payload.diagnosticCode)
            }
            is MosaicAnalyticsPayload.PlacementUnavailable -> { require(payload.reason in PLACEMENT_UNAVAILABLE_REASONS); safe(payload.diagnosticCode) }
            is MosaicAnalyticsPayload.DiagnosticFailure -> safe(payload.diagnosticCode)
            is MosaicAnalyticsPayload.PaywallDismissed -> require(payload.reason in DISMISSAL_REASONS)
            is MosaicAnalyticsPayload.PaywallAction -> { require(payload.action in PAYWALL_ACTIONS); payload.componentId?.let { requireIdentifier(it) } }
            is MosaicAnalyticsPayload.ProductLoadStarted -> require(payload.requestedProductCount in 1..64)
            is MosaicAnalyticsPayload.ProductLoadCompleted -> { require(payload.availableProductCount in 0..64 && payload.unavailableProductCount in 0..64); duration(payload.durationMs) }
            is MosaicAnalyticsPayload.ProductLoadFailed -> { require(payload.requestedProductCount in 1..64); duration(payload.durationMs); safe(payload.diagnosticCode) }
            is MosaicAnalyticsPayload.ProductUnavailable -> { require(payload.reason in PRODUCT_UNAVAILABLE_REASONS); safe(payload.diagnosticCode) }
            is MosaicAnalyticsPayload.ProductSelected -> require(payload.source in setOf("default", "user"))
            is MosaicAnalyticsPayload.PurchaseCompleted -> { require(payload.outcome in setOf("purchased", "already_entitled")); duration(payload.durationMs); validateIdentifiers(payload.observedEntitlementKeys); safe(payload.providerResultCode) }
            is MosaicAnalyticsPayload.ProviderCompleted -> { require(payload.confirmationSource in CONFIRMATION_SOURCES); validateIdentifiers(payload.activeEntitlementKeys); payload.linkedClientEventId?.let(::requireIdentifier) }
            is MosaicAnalyticsPayload.PurchaseLifecycle -> { duration(payload.durationMs); safe(payload.providerResultCode) }
            is MosaicAnalyticsPayload.PurchaseFailed -> { duration(payload.durationMs); safe(payload.diagnosticCode) }
            is MosaicAnalyticsPayload.RestoreStarted -> requireIdentifier(payload.providerId)
            is MosaicAnalyticsPayload.RestoreCompleted -> { requireIdentifier(payload.providerId); duration(payload.durationMs); validateIdentifiers(payload.restoredProductIds); validateIdentifiers(payload.observedEntitlementKeys) }
            is MosaicAnalyticsPayload.RestoreLifecycle -> { requireIdentifier(payload.providerId); duration(payload.durationMs); safe(payload.providerResultCode) }
            is MosaicAnalyticsPayload.RestoreFailed -> { requireIdentifier(payload.providerId); duration(payload.durationMs); safe(payload.diagnosticCode) }
            is MosaicAnalyticsPayload.ExperimentAssigned -> { require(payload.assignmentKeyType in setOf("installation", "identified_user")); require(payload.bucketingAlgorithm == MOSAIC_EXPERIMENT_BUCKETING_ALGORITHM); require(payload.bucket in 0..9999); require(payload.source in setOf("deterministic", "qa_override")) }
            is MosaicAnalyticsPayload.ExperimentExposed -> { require(payload.assignmentKeyType in setOf("installation", "identified_user")); require(payload.bucketingAlgorithm == MOSAIC_EXPERIMENT_BUCKETING_ALGORITHM); require(payload.productReadiness == "ready" && payload.providerCapability == "accepted" && !payload.qaOverride) }
            is MosaicAnalyticsPayload.ExperimentFallbackPresented -> { require(payload.reason in setOf("product_unavailable", "provider_unavailable", "configuration_incompatible", "rendering_failed")); requireIdentifier(payload.presentedPaywallId); requireIdentifier(payload.presentedPaywallVersionId); safe(payload.diagnosticCode) }
            is MosaicAnalyticsPayload.ExperimentAssignmentFailed -> safe(payload.diagnosticCode)
            MosaicAnalyticsPayload.Empty, is MosaicAnalyticsPayload.PaywallPresented, is MosaicAnalyticsPayload.PurchaseStarted -> Unit
        }
    }

    private fun validateIdentifiers(values: List<String>) {
        require(values.size <= 64 && values.size == values.toSet().size)
        values.forEach(::requireIdentifier)
    }
}

private fun MosaicAnalyticsEvent.toJson(): JsonObject = JsonObject().apply {
    addProperty("eventId", eventId); addProperty("eventSchemaVersion", eventSchemaVersion); addProperty("eventName", eventName)
    addProperty("occurredAt", occurredAt); addProperty("queuedAt", queuedAt); addProperty("authority", authority)
    identity?.let { add("identity", JsonObject().apply { addProperty("installationId", it.installationId); it.applicationUserId?.let { id -> addProperty("applicationUserId", id) }; addProperty("generation", it.generation) }) }
    sessionId?.let { addProperty("sessionId", it) }
    context?.let { c -> add("context", JsonObject().apply { addProperty("platform", c.platform); addProperty("sdkFamily", c.sdkFamily); addProperty("sdkVersion", c.sdkVersion); c.operatingSystemVersion?.let { addProperty("operatingSystemVersion", it) }; c.applicationVersion?.let { addProperty("applicationVersion", it) }; c.locale?.let { addProperty("locale", it) }; c.configurationDeliveryVersion?.let { addProperty("configurationDeliveryVersion", it) }; c.commerceProviderContractVersion?.let { addProperty("commerceProviderContractVersion", it) } }) }
    add("correlation", correlation.toJson()); add("attribution", attribution.toJson()); add("payload", payload.toJson())
}

private fun MosaicAnalyticsCorrelation.toJson() = JsonObject().apply { placementRequestId?.let { addProperty("placementRequestId", it) }; paywallPresentationId?.let { addProperty("paywallPresentationId", it) }; productLoadAttemptId?.let { addProperty("productLoadAttemptId", it) }; purchaseAttemptId?.let { addProperty("purchaseAttemptId", it) }; restoreAttemptId?.let { addProperty("restoreAttemptId", it) }; providerOperationId?.let { addProperty("providerOperationId", it) }; providerUpdateId?.let { addProperty("providerUpdateId", it) } }
private fun MosaicAnalyticsAttribution.toJson() = JsonObject().apply { configurationReleaseId?.let { addProperty("configurationReleaseId", it) }; placementId?.let { addProperty("placementId", it) }; placementRuleSetId?.let { addProperty("placementRuleSetId", it) }; placementRuleSetVersion?.let { addProperty("placementRuleSetVersion", it) }; winningRuleId?.let { addProperty("winningRuleId", it) }; paywallId?.let { addProperty("paywallId", it) }; paywallVersionId?.let { addProperty("paywallVersionId", it) }; mosaicProductId?.let { addProperty("mosaicProductId", it) }; planId?.let { addProperty("planId", it) }; providerId?.let { addProperty("providerId", it) }; providerProductMappingId?.let { addProperty("providerProductMappingId", it) }; experimentId?.let { addProperty("experimentId", it) }; experimentVersionId?.let { addProperty("experimentVersionId", it) }; experimentVariantId?.let { addProperty("experimentVariantId", it) }; experimentAllocationVersion?.let { addProperty("experimentAllocationVersion", it) } }

private fun MosaicAnalyticsPayload.toJson() = JsonObject().apply {
    when (val p = this@toJson) {
        MosaicAnalyticsPayload.Empty, is MosaicAnalyticsPayload.PaywallPresented, is MosaicAnalyticsPayload.PurchaseStarted -> Unit
        is MosaicAnalyticsPayload.PlacementRequested -> addProperty("decisionContractVersion", p.decisionContractVersion)
        is MosaicAnalyticsPayload.PlacementSelected -> { addProperty("finalOutcome", p.finalOutcome); addProperty("decisionContractVersion", p.decisionContractVersion); p.assignmentKeyType?.let { addProperty("assignmentKeyType", it) }; p.bucketingAlgorithm?.let { addProperty("bucketingAlgorithm", it) }; p.rolloutBucket?.let { addProperty("rolloutBucket", it) } }
        is MosaicAnalyticsPayload.PlacementFallback -> { addProperty("trigger", p.trigger); addProperty("fallbackKey", p.fallbackKey); addProperty("finalOutcome", p.finalOutcome); p.diagnosticCode?.let { addProperty("diagnosticCode", it) } }
        is MosaicAnalyticsPayload.PlacementUnavailable -> { addProperty("reason", p.reason); p.diagnosticCode?.let { addProperty("diagnosticCode", it) } }
        is MosaicAnalyticsPayload.DiagnosticFailure -> { addProperty("diagnosticCode", p.diagnosticCode); addProperty("retryable", p.retryable) }
        is MosaicAnalyticsPayload.PaywallDismissed -> addProperty("reason", p.reason)
        is MosaicAnalyticsPayload.PaywallAction -> { addProperty("action", p.action); p.componentId?.let { addProperty("componentId", it) } }
        is MosaicAnalyticsPayload.ProductLoadStarted -> addProperty("requestedProductCount", p.requestedProductCount)
        is MosaicAnalyticsPayload.ProductLoadCompleted -> { addProperty("availableProductCount", p.availableProductCount); addProperty("unavailableProductCount", p.unavailableProductCount); addProperty("durationMs", p.durationMs) }
        is MosaicAnalyticsPayload.ProductLoadFailed -> { addProperty("requestedProductCount", p.requestedProductCount); addProperty("durationMs", p.durationMs); addProperty("diagnosticCode", p.diagnosticCode); addProperty("retryable", p.retryable) }
        is MosaicAnalyticsPayload.ProductUnavailable -> { addProperty("reason", p.reason); p.diagnosticCode?.let { addProperty("diagnosticCode", it) } }
        is MosaicAnalyticsPayload.ProductSelected -> addProperty("source", p.source)
        is MosaicAnalyticsPayload.PurchaseCompleted -> { addProperty("outcome", p.outcome); addProperty("durationMs", p.durationMs); add("observedEntitlementKeys", p.observedEntitlementKeys.toJsonArray()); p.providerResultCode?.let { addProperty("providerResultCode", it) } }
        is MosaicAnalyticsPayload.PurchaseLifecycle -> { addProperty("durationMs", p.durationMs); p.providerResultCode?.let { addProperty("providerResultCode", it) } }
        is MosaicAnalyticsPayload.PurchaseFailed -> { addProperty("durationMs", p.durationMs); addProperty("diagnosticCode", p.diagnosticCode); addProperty("retryable", p.retryable) }
        is MosaicAnalyticsPayload.RestoreStarted -> addProperty("providerId", p.providerId)
        is MosaicAnalyticsPayload.RestoreCompleted -> { addProperty("providerId", p.providerId); addProperty("durationMs", p.durationMs); add("restoredProductIds", p.restoredProductIds.toJsonArray()); add("observedEntitlementKeys", p.observedEntitlementKeys.toJsonArray()) }
        is MosaicAnalyticsPayload.RestoreLifecycle -> { addProperty("providerId", p.providerId); addProperty("durationMs", p.durationMs); p.providerResultCode?.let { addProperty("providerResultCode", it) } }
        is MosaicAnalyticsPayload.RestoreFailed -> { addProperty("providerId", p.providerId); addProperty("durationMs", p.durationMs); addProperty("diagnosticCode", p.diagnosticCode); addProperty("retryable", p.retryable) }
        is MosaicAnalyticsPayload.ProviderCompleted -> { addProperty("confirmationSource", p.confirmationSource); add("activeEntitlementKeys", p.activeEntitlementKeys.toJsonArray()); p.linkedClientEventId?.let { addProperty("linkedClientEventId", it) } }
        is MosaicAnalyticsPayload.ExperimentAssigned -> { addProperty("assignmentKeyType", p.assignmentKeyType); addProperty("bucketingAlgorithm", p.bucketingAlgorithm); addProperty("bucket", p.bucket); addProperty("source", p.source) }
        is MosaicAnalyticsPayload.ExperimentExposed -> { addProperty("assignmentKeyType", p.assignmentKeyType); addProperty("bucketingAlgorithm", p.bucketingAlgorithm); addProperty("productReadiness", p.productReadiness); addProperty("providerCapability", p.providerCapability); addProperty("qaOverride", p.qaOverride) }
        is MosaicAnalyticsPayload.ExperimentFallbackPresented -> { addProperty("reason", p.reason); addProperty("presentedPaywallId", p.presentedPaywallId); addProperty("presentedPaywallVersionId", p.presentedPaywallVersionId); addProperty("diagnosticCode", p.diagnosticCode) }
        is MosaicAnalyticsPayload.ExperimentAssignmentFailed -> { addProperty("diagnosticCode", p.diagnosticCode); addProperty("retryable", p.retryable) }
    }
}

private fun List<String>.toJsonArray() = JsonArray().also { a -> forEach(a::add) }
private fun JsonObject.exact(required: Set<String>, optional: Set<String> = emptySet()) { require(keySet().containsAll(required) && keySet().all { it in required || it in optional }) }
private fun JsonObject.string(name: String) = get(name).asString
private fun JsonObject.optionalString(name: String) = get(name)?.asString
private fun JsonObject.identifier(name: String): String = string(name).also(::requireIdentifier)
private fun JsonObject.optionalIdentifier(name: String): String? = optionalString(name)?.also(::requireIdentifier)
private fun JsonObject.timestamp(name: String): String = string(name).also { value ->
    val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT).apply {
        isLenient = false
        timeZone = TimeZone.getTimeZone("UTC")
    }
    require(TIMESTAMP_PATTERN.matches(value) && runCatching { format.parse(value) }.getOrNull()?.let(format::format) == value)
}
private fun JsonObject.integer(name: String, minimum: Long, maximum: Long): Long = get(name).asJsonPrimitive.let { primitive ->
    require(primitive.isNumber && !primitive.toString().contains('.') && !primitive.toString().contains('e', true))
    primitive.asLong.also { require(it in minimum..maximum) }
}
private fun JsonObject.optionalLong(name: String): Long? = get(name)?.let { integer(name, Long.MIN_VALUE, Long.MAX_VALUE) }
private fun JsonObject.optionalInt(name: String): Int? = get(name)?.let { integer(name, Int.MIN_VALUE.toLong(), Int.MAX_VALUE.toLong()).toInt() }
private fun JsonObject.strings(name: String): List<String> = getAsJsonArray(name).map(JsonElement::getAsString).also { require(it.size <= 64 && it.toSet().size == it.size && it.all(IDENTIFIER_PATTERN::matches)) }

private fun requireIdentifier(value: String) = require(IDENTIFIER_PATTERN.matches(value))
private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L
private val IDENTIFIER_PATTERN = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
private val TIMESTAMP_PATTERN = Regex("^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\\.[0-9]{3}Z$")
private val SAFE_CODE_PATTERN = Regex("^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$")
private val VERSION_PATTERN = Regex("^[A-Za-z0-9][A-Za-z0-9.+_-]*$")
private val OS_VERSION_PATTERN = Regex("^[A-Za-z0-9][A-Za-z0-9.+_ -]*$")
private val LOCALE_PATTERN = Regex("^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$")
private val FALLBACK_KEY_PATTERN = Regex("^[a-z][a-z0-9_]*$")
private val FALLBACK_TRIGGERS = setOf("configuration_incompatible", "content_unavailable", "commerce_unavailable", "product_unavailable", "product_unknown", "provider_unavailable", "entitlement_unknown", "unsafe_rendering")
private val PLACEMENT_UNAVAILABLE_REASONS = setOf("no_safe_decision", "configuration_incompatible", "content_unavailable", "commerce_unavailable")
private val DISMISSAL_REASONS = setOf("user", "system", "purchase_completed", "host_application", "unknown")
private val PAYWALL_ACTIONS = setOf("purchase", "restore", "close", "navigate_to", "navigate_back", "open_external_url")
private val PRODUCT_UNAVAILABLE_REASONS = setOf("mapping_missing", "mapping_invalid", "product_not_found", "temporarily_unavailable", "provider_unavailable", "unsupported_product_type", "metadata_unavailable")
private val CONFIRMATION_SOURCES = setOf("trusted_provider_integration", "trusted_server_endpoint", "accepted_adapter_source")
internal val permanentRejectionCodes = setOf("event_schema_invalid", "unsupported_event_schema", "unsupported_event_name", "unknown_field", "invalid_identifier", "invalid_timestamp", "occurred_at_too_far_future", "event_expired", "event_too_large", "batch_event_limit_exceeded", "duplicate_event_id_in_batch", "authority_not_allowed", "tenant_field_forbidden", "attribution_not_found", "attribution_scope_mismatch", "event_id_conflict", "sensitive_value_rejected")
internal val retryableRejectionCodes = setOf("rate_limited", "storage_temporarily_unavailable", "service_temporarily_unavailable", "ingestion_timeout")
