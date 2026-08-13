package dev.mosaic.sdk

import com.google.gson.GsonBuilder
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.security.MessageDigest

/**
 * Strict reader for Commerce Configuration [MOSAIC_COMMERCE_CONFIGURATION_VERSION].
 *
 * It produces a provider-neutral core model, so RevenueCat and custom adapters remain source and
 * binary independent of Google Play Billing.
 */
object MosaicCommerceConfigurationDecoder {
    /**
     * Every rejection leaves the caller with [MosaicCommerceConfigurationException] rather than
     * whichever `require` fired first: a rejected Commerce sidecar leaves the paired release
     * without commerce, and that handling must not depend on the implementation exception type of
     * a strict wire reader.
     */
    fun decode(
        source: String,
        release: MosaicConfigurationRelease,
        applicationId: String,
    ): MosaicCommerceConfiguration = try {
        decodeConfiguration(source, release, applicationId)
    } catch (error: MosaicCommerceConfigurationException) {
        throw error
    } catch (error: RuntimeException) {
        throw MosaicCommerceConfigurationException("Invalid Commerce Configuration.", error)
    }

    private val gson = GsonBuilder().disableHtmlEscaping().create()
    private val identifier = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
    private val entitlementKey = Regex("^[a-z][a-z0-9_.-]{0,63}$")
    private val digest = Regex("^sha256:[a-f0-9]{64}$")
    private val safe = Regex("^[^\\r\\n\\u0000-\\u001F\\u007F]+$")
    private val diagnosticCode = Regex("^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)+$")
    private val recoveryActions = setOf(
        "retry", "reconnectProvider", "fixProductMapping", "updateProviderConfiguration",
        "contactProvider", "none",
    )
    private val timestamp = Regex(
        "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,6})?Z$",
    )
    private val googleCapabilities = mapOf(
        "productLoading" to ("supported" to null),
        "subscriptions" to ("supported" to null),
        "oneTimeNonConsumables" to ("supported" to null),
        "trials" to ("conditional" to "provider.eligibilityRequired"),
        "introductoryOffers" to ("conditional" to "provider.eligibilityRequired"),
        "promotionalOffers" to ("unsupported" to "provider.capabilityUnavailable"),
        "restore" to ("supported" to null),
        "activeEntitlementLookup" to ("supported" to null),
        "pendingPurchases" to ("supported" to null),
        "deferredPurchases" to ("unsupported" to "provider.outcomeUnavailable"),
        "serverConfirmedTransactions" to
            ("unsupported" to "provider.serverValidationExcluded"),
        "productSynchronization" to
            ("unsupported" to "provider.serverSynchronizationUnavailable"),
        "providerDiagnostics" to ("supported" to null),
        "basePlans" to ("supported" to null),
        "explicitOffers" to ("supported" to null),
        "storeSynchronization" to ("unsupported" to "provider.recoveryModeUnavailable"),
        "activePurchaseRecovery" to ("supported" to null),
        "asynchronousCommerceUpdates" to ("supported" to null),
        "localDeliveryAcceptance" to ("supported" to null),
    )

    private fun decodeConfiguration(
        source: String,
        release: MosaicConfigurationRelease,
        applicationId: String,
    ): MosaicCommerceConfiguration {
        val root = objectValue(JsonParser.parseString(source).asJsonObject, setOf("commerceConfigurationVersion", "configuration"))
        require(root.string("commerceConfigurationVersion") == "2")
        val value = objectValue(
            root.obj("configuration"),
            setOf(
                "id", "environmentId", "applicationId", "storePlatform", "configurationRelease",
                "contentDigest", "activeProvider", "productMappings", "entitlementMappings",
                "freshness", "diagnostics",
            ),
        )
        val declaredDigest = value.string("contentDigest").checked(digest)
        val material = value.deepCopy().also { it.remove("contentDigest") }
        require(declaredDigest == sha256(material))
        val environmentId = value.string("environmentId").checked(identifier)
        val decodedApplicationId = value.string("applicationId").checked(identifier)
        require(environmentId == release.environment.id)
        require(decodedApplicationId == applicationId)
        require(value.string("storePlatform") == "android")

        val releaseRef = objectValue(value.obj("configurationRelease"), setOf("id", "contentDigest"))
        val releaseId = releaseRef.string("id").checked(identifier)
        val releaseDigest = releaseRef.string("contentDigest").checked(digest)
        require(releaseId == release.id && releaseDigest == release.contentDigest)

        val active = objectValue(
            value.obj("activeProvider"),
            setOf("identity", "activation", "capabilities", "recoveryMode"),
        )
        val identity = objectValue(active.obj("identity"), setOf("id", "displayName", "adapterVersion"))
        val provider = MosaicCommerceProviderIdentity(
            identity.string("id").checked(identifier),
            identity.string("displayName").checked(safe),
            identity.string("adapterVersion").checked(Regex("^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$")),
        )
        require(
            provider == MosaicCommerceProviderIdentity(
                "google_play",
                "Google Play Billing",
                "1.0.0",
            ),
        )
        val activation = objectValue(active.obj("activation"), setOf("source"))
        require(activation.string("source") == "nativeStore")
        val recoveryMode = active.string("recoveryMode")
        require(recoveryMode == "activePurchaseRecovery")
        val decodedCapabilities = active.array("capabilities").map { element ->
            val item = element.asJsonObject
            require(item.keySet() == setOf("name", "support") || item.keySet() == setOf("name", "support", "reasonCode"))
            val name = item.string("name")
            val support = item.string("support")
            require(name in googleCapabilities)
            val reason = item.get("reasonCode")?.asString
            require(googleCapabilities.getValue(name) == (support to reason))
            MosaicCommerceProviderCapability(name, support, reason)
        }.also {
            require(it.size == googleCapabilities.size)
            require(it.map { capability -> capability.name }.toSet() == googleCapabilities.keys)
        }

        val mappings = value.array("productMappings").map { element ->
            val item = objectValue(
                element.asJsonObject,
                setOf(
                    "mosaicProductId", "mappingId", "productType", "entitlementKeys",
                    "providerProductReference", "adapterMapping",
                ),
            )
            val type = item.string("productType")
            require(type in setOf("subscription", "one_time_non_consumable"))
            val adapter = item.obj("adapterMapping")
            require(adapter.get("kind")?.asString == "googlePlayProduct")
            require(adapter.keySet().all { it in setOf("kind", "basePlanId", "offerId") })
            val basePlan = adapter.get("basePlanId")?.asString?.checked(safe)
            val offer = adapter.get("offerId")?.asString?.checked(safe)
            require((type == "subscription" && basePlan != null) || (type == "one_time_non_consumable" && basePlan == null && offer == null))
            val grants = item.array("entitlementKeys").map { it.asString.checked(entitlementKey) }.toSet()
            require(grants.isNotEmpty() && grants.size == item.array("entitlementKeys").size())
            MosaicCommerceProductMapping(
                mosaicProductId = item.string("mosaicProductId").checked(identifier),
                mappingId = item.string("mappingId").checked(identifier),
                providerProductReference = item.string("providerProductReference").checked(safe),
                adapterMapping = MosaicCommerceAdapterMapping.GooglePlayProduct(basePlan, offer),
                productType = type,
                entitlementKeys = grants,
            )
        }
        require(mappings.isNotEmpty())
        require(mappings.map { it.mosaicProductId }.toSet().size == mappings.size)
        require(mappings.map { it.mappingId }.toSet().size == mappings.size)
        require(mappings.map { it.providerProductReference }.toSet().size == mappings.size)
        require(mappings.map { it.mosaicProductId }.toSet() == release.productReferences.keys)
        mappings.forEach { require(release.productReferences.getValue(it.mosaicProductId).type == it.productType) }

        val entitlementMappings = value.array("entitlementMappings").map { element ->
            val item = objectValue(element.asJsonObject, setOf("mosaicEntitlementKey", "providerEntitlementIdentifier"))
            MosaicCommerceEntitlementMapping(
                item.string("mosaicEntitlementKey").checked(entitlementKey),
                item.string("providerEntitlementIdentifier").checked(safe),
            )
        }
        require(entitlementMappings.map { it.mosaicEntitlementKey }.toSet().size == entitlementMappings.size)

        val freshness = value.obj("freshness")
        require(freshness.keySet().all { it in setOf("source", "status", "configuredAt", "observation") })
        require(freshness.string("source") == "nativeStoreConfiguration")
        require(freshness.string("status") in setOf("configured", "fresh", "stale"))
        val configuredAt = freshness.string("configuredAt").checked(timestamp)
        val status = freshness.string("status")
        val observation = freshness.get("observation")?.let {
            require(it.isJsonObject)
            objectValue(
                it.asJsonObject,
                if (it.asJsonObject.has("expiresAt")) {
                    setOf("environment", "observedAt", "expiresAt")
                } else {
                    setOf("environment", "observedAt")
                },
            )
        }
        require(status == "configured" || observation != null)
        observation?.let {
            require(it.string("environment") in setOf("test", "production", "unknown"))
            val observedAt = it.string("observedAt").checked(timestamp)
            require(timestampSortKey(observedAt) >= timestampSortKey(configuredAt))
            it.get("expiresAt")?.asString?.checked(timestamp)?.let { expiresAt ->
                require(timestampSortKey(expiresAt) >= timestampSortKey(observedAt))
            }
        }
        // A safe diagnostic is copy an operator reads and a host may log, so the closed vocabularies
        // and bounds are enforced here rather than trusted: an out-of-range retry hint or an
        // unrecognised recovery action would be acted on, and an unsafe provider code is exactly the
        // channel through which raw store text reaches a log.
        val diagnostics = value.array("diagnostics").also { require(it.size() <= 32) }.map { element ->
            val diagnostic = objectValue(
                element.asJsonObject,
                setOf("code", "safeMessage", "severity", "retryable", "correlationId") +
                    element.asJsonObject.keySet().filter {
                        it in setOf("retryAfterSeconds", "providerCode", "mosaicProductId", "recoveryAction")
                    },
            )
            MosaicCommerceSafeDiagnostic(
                code = diagnostic.string("code").also {
                    require(it.length in 3..96 && diagnosticCode.matches(it))
                },
                safeMessage = diagnostic.string("safeMessage").checked(safe),
                severity = diagnostic.string("severity")
                    .also { require(it in setOf("info", "warning", "error")) },
                retryable = diagnostic.get("retryable").asBoolean,
                retryAfterSeconds = diagnostic.get("retryAfterSeconds")?.let {
                    val number = it.asBigDecimal
                    require(number.stripTrailingZeros().scale() <= 0)
                    number.intValueExact().also { seconds -> require(seconds in 1..86_400) }
                },
                correlationId = diagnostic.string("correlationId").checked(identifier),
                providerCode = diagnostic.get("providerCode")?.asString?.checked(safe),
                mosaicProductId = diagnostic.get("mosaicProductId")?.asString?.checked(identifier),
                recoveryAction = diagnostic.get("recoveryAction")?.asString?.also {
                    require(it in recoveryActions)
                },
            )
        }
        return MosaicCommerceConfiguration(
            id = value.string("id").checked(identifier),
            environmentId = environmentId,
            applicationId = decodedApplicationId,
            storePlatform = "android",
            configurationReleaseId = releaseId,
            configurationReleaseDigest = releaseDigest,
            contentDigest = declaredDigest,
            provider = provider,
            activation = MosaicCommerceProviderActivation.NativeStore,
            capabilities = decodedCapabilities,
            productMappings = mappings.associateBy { it.mosaicProductId },
            entitlementMappings = entitlementMappings.associateBy { it.mosaicEntitlementKey },
            freshness = MosaicCommerceFreshness(
                source = "nativeStoreConfiguration",
                status = status,
                providerObservedAt = configuredAt,
                synchronizedAt = configuredAt,
                staleAt = configuredAt,
                expiresAt = null,
            ),
            diagnostics = diagnostics,
            encoded = source,
            version = "2",
            recoveryMode = recoveryMode,
        )
    }

    private fun objectValue(value: JsonObject, keys: Set<String>): JsonObject =
        value.also { require(it.keySet() == keys) }

    private fun JsonObject.string(name: String): String =
        get(name)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString
            ?: throw IllegalArgumentException("Invalid Commerce Configuration v2.")

    private fun JsonObject.obj(name: String): JsonObject =
        get(name)?.takeIf { it.isJsonObject }?.asJsonObject
            ?: throw IllegalArgumentException("Invalid Commerce Configuration v2.")

    private fun JsonObject.array(name: String) =
        get(name)?.takeIf { it.isJsonArray }?.asJsonArray
            ?: throw IllegalArgumentException("Invalid Commerce Configuration v2.")

    private fun String.checked(pattern: Regex): String = also { require(pattern.matches(it)) }

    private fun timestampSortKey(value: String): String {
        val withoutZulu = value.removeSuffix("Z")
        val separator = withoutZulu.indexOf('.')
        val seconds = if (separator == -1) withoutZulu else withoutZulu.substring(0, separator)
        val fraction = if (separator == -1) "" else withoutZulu.substring(separator + 1)
        return seconds + fraction.padEnd(6, '0')
    }

    /**
     * The canonical digest over a sidecar's own material, exposed so a caller that rewrites a
     * configuration can restate it rather than reimplement the canonicalization it depends on.
     */
    internal fun contentDigest(material: JsonObject): String = sha256(material)

    private fun sha256(value: JsonObject): String {
        val bytes = canonicalJson(value).toByteArray(Charsets.UTF_8)
        return "sha256:" + MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString("") { "%02x".format(it) }
    }

    private fun canonicalJson(value: JsonElement): String = when {
        value.isJsonNull -> "null"
        value.isJsonArray -> value.asJsonArray.joinToString(",", "[", "]") { canonicalJson(it) }
        value.isJsonObject -> value.asJsonObject.entrySet().sortedBy { it.key }
            .joinToString(",", "{", "}") { (key, child) ->
                "${gson.toJson(key)}:${canonicalJson(child)}"
            }
        value.asJsonPrimitive.isString -> gson.toJson(value.asString)
        value.asJsonPrimitive.isBoolean -> value.asBoolean.toString()
        else -> value.asBigDecimal.stripTrailingZeros().toPlainString()
    }
}
