package dev.mosaic.sdk

import com.google.gson.GsonBuilder
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParseException
import com.google.gson.JsonParser
import java.security.MessageDigest
import java.util.Calendar
import java.util.GregorianCalendar
import java.util.TimeZone

const val MOSAIC_COMMERCE_CONFIGURATION_VERSION: String = "1"

data class MosaicCommerceProviderIdentity(
    val id: String,
    val displayName: String,
    val adapterVersion: String,
)

data class MosaicCommerceProviderCapability(
    val name: String,
    val support: String,
    val reasonCode: String?,
)

sealed interface MosaicCommerceProviderActivation {
    val source: String

    data class ProviderConnection(val providerConnectionId: String) :
        MosaicCommerceProviderActivation {
        override val source: String = "providerConnection"
    }

    data class SdkLocal(val localSnapshotId: String) : MosaicCommerceProviderActivation {
        override val source: String = "sdkLocal"
    }
}

sealed interface MosaicCommerceAdapterMapping {
    val kind: String

    data object DirectProduct : MosaicCommerceAdapterMapping {
        override val kind: String = "directProduct"
    }

    data class RevenueCatPackage(
        val offeringIdentifier: String,
        val packageIdentifier: String,
    ) : MosaicCommerceAdapterMapping {
        override val kind: String = "revenueCatPackage"
    }
}

data class MosaicCommerceProductMapping(
    val mosaicProductId: String,
    val mappingId: String,
    val providerProductReference: String,
    val adapterMapping: MosaicCommerceAdapterMapping,
)

data class MosaicCommerceEntitlementMapping(
    val mosaicEntitlementKey: String,
    val providerEntitlementIdentifier: String,
)

data class MosaicCommerceFreshness(
    val source: String,
    val status: String,
    val providerObservedAt: String,
    val synchronizedAt: String,
    val staleAt: String,
    val expiresAt: String?,
)

data class MosaicCommerceSafeDiagnostic(
    val code: String,
    val safeMessage: String,
    val severity: String,
    val retryable: Boolean,
    val retryAfterSeconds: Int?,
    val correlationId: String,
    val providerCode: String?,
    val mosaicProductId: String?,
    val recoveryAction: String?,
)

data class MosaicCommerceConfiguration(
    val id: String,
    val environmentId: String,
    val applicationId: String,
    val storePlatform: String,
    val configurationReleaseId: String,
    val configurationReleaseDigest: String,
    val contentDigest: String,
    val provider: MosaicCommerceProviderIdentity,
    val activation: MosaicCommerceProviderActivation,
    val capabilities: List<MosaicCommerceProviderCapability>,
    val productMappings: Map<String, MosaicCommerceProductMapping>,
    val entitlementMappings: Map<String, MosaicCommerceEntitlementMapping>,
    val freshness: MosaicCommerceFreshness,
    val diagnostics: List<MosaicCommerceSafeDiagnostic>,
    val encoded: String,
)

object MosaicCommerceConfigurationDecoder {
    private val canonicalGson = GsonBuilder().disableHtmlEscaping().create()
    private val identifier = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
    private val entitlementKey = Regex("^[a-z][a-z0-9_.-]{0,63}$")
    private val capabilityReason = Regex("^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)+$")
    private val digest = Regex("^sha256:[a-f0-9]{64}$")
    private val timestamp = Regex(
        "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,6})?Z$",
    )
    private val safeText = Regex("^[^\\r\\n\\u0000-\\u001F\\u007F]+$")
    private val diagnosticCode = Regex(
        "^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)+$",
    )
    private val recoveryActions = setOf(
        "retry",
        "reconnectProvider",
        "fixProductMapping",
        "updateProviderConfiguration",
        "contactProvider",
        "none",
    )
    private val capabilityNames = setOf(
        "productLoading",
        "subscriptions",
        "oneTimeNonConsumables",
        "trials",
        "introductoryOffers",
        "promotionalOffers",
        "restore",
        "activeEntitlementLookup",
        "pendingPurchases",
        "deferredPurchases",
        "serverConfirmedTransactions",
        "productSynchronization",
        "providerDiagnostics",
    )

    fun decode(
        source: String,
        release: MosaicConfigurationRelease,
        applicationId: String,
    ): MosaicCommerceConfiguration {
        val root = parseObject(source, "$")
        root.exactKeys(setOf("commerceConfigurationVersion", "configuration"), "$")
        requireCommerce(
            root.string("commerceConfigurationVersion", "$") ==
                MOSAIC_COMMERCE_CONFIGURATION_VERSION,
            "Unsupported Commerce Configuration version.",
        )
        val configuration = root.obj("configuration", "$")
        configuration.exactKeys(
            setOf(
                "id",
                "environmentId",
                "applicationId",
                "storePlatform",
                "configurationRelease",
                "contentDigest",
                "activeProvider",
                "productMappings",
                "entitlementMappings",
                "freshness",
                "diagnostics",
            ),
            "$.configuration",
        )

        val declaredDigest = configuration.checkedString(
            "contentDigest",
            "$.configuration",
            digest,
        )
        val material = configuration.deepCopy().also { it.remove("contentDigest") }
        requireCommerce(
            declaredDigest == contentDigest(material),
            "Commerce Configuration contentDigest does not match.",
        )

        val environmentId = configuration.checkedString(
            "environmentId",
            "$.configuration",
            identifier,
        )
        val decodedApplicationId = configuration.checkedString(
            "applicationId",
            "$.configuration",
            identifier,
        )
        val platform = configuration.string("storePlatform", "$.configuration")
        requireCommerce(environmentId == release.environment.id, "Commerce Environment does not match.")
        requireCommerce(decodedApplicationId == applicationId, "Commerce Application does not match.")
        requireCommerce(platform == "android", "Commerce store platform does not match Android.")

        val releaseAssociation = configuration.obj(
            "configurationRelease",
            "$.configuration",
        )
        releaseAssociation.exactKeys(
            setOf("id", "contentDigest"),
            "$.configuration.configurationRelease",
        )
        val releaseId = releaseAssociation.checkedString(
            "id",
            "$.configuration.configurationRelease",
            identifier,
        )
        val releaseDigest = releaseAssociation.checkedString(
            "contentDigest",
            "$.configuration.configurationRelease",
            digest,
        )
        requireCommerce(releaseId == release.id, "Commerce Configuration Release ID does not match.")
        requireCommerce(
            releaseDigest == release.contentDigest,
            "Commerce Configuration Release digest does not match.",
        )

        val providerObject = configuration.obj("activeProvider", "$.configuration")
        providerObject.exactKeys(
            setOf("identity", "activation", "capabilities"),
            "$.configuration.activeProvider",
        )
        val identityObject = providerObject.obj(
            "identity",
            "$.configuration.activeProvider",
        )
        identityObject.exactKeys(
            setOf("id", "displayName", "adapterVersion"),
            "$.configuration.activeProvider.identity",
        )
        val provider = MosaicCommerceProviderIdentity(
            id = identityObject.checkedString(
                "id",
                "$.configuration.activeProvider.identity",
                identifier,
            ),
            displayName = identityObject.safeString(
                "displayName",
                "$.configuration.activeProvider.identity",
                240,
            ),
            adapterVersion = identityObject.checkedString(
                "adapterVersion",
                "$.configuration.activeProvider.identity",
                Regex("^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$"),
            ),
        )
        val activation = activation(
            providerObject.obj("activation", "$.configuration.activeProvider"),
        )
        val capabilities = capabilities(
            providerObject.array(
                "capabilities",
                "$.configuration.activeProvider",
                1,
                13,
            ),
        )
        val productMappings = productMappings(
            configuration.array("productMappings", "$.configuration", 1, 256),
            provider.id,
        )
        requireCommerce(
            productMappings.keys == release.productReferences.keys,
            "Commerce Product mappings must exactly match accepted release Products.",
        )
        val entitlementMappings = entitlementMappings(
            configuration.array(
                "entitlementMappings",
                "$.configuration",
                1,
                128,
            ),
        )
        val freshness = freshness(
            configuration.obj("freshness", "$.configuration"),
            activation.source,
        )
        val diagnostics = diagnostics(
            configuration.array("diagnostics", "$.configuration", 0, 32),
        )

        return MosaicCommerceConfiguration(
            id = configuration.checkedString("id", "$.configuration", identifier),
            environmentId = environmentId,
            applicationId = decodedApplicationId,
            storePlatform = platform,
            configurationReleaseId = releaseId,
            configurationReleaseDigest = releaseDigest,
            contentDigest = declaredDigest,
            provider = provider,
            activation = activation,
            capabilities = capabilities,
            productMappings = productMappings,
            entitlementMappings = entitlementMappings,
            freshness = freshness,
            diagnostics = diagnostics,
            encoded = source,
        )
    }

    internal fun contentDigest(configurationMaterial: JsonObject): String {
        val bytes = canonicalJson(configurationMaterial).toByteArray(Charsets.UTF_8)
        return "sha256:" + MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString("") { "%02x".format(it) }
    }

    private fun activation(value: JsonObject): MosaicCommerceProviderActivation {
        val path = "$.configuration.activeProvider.activation"
        return when (value.string("source", path)) {
            "providerConnection" -> {
                value.exactKeys(setOf("source", "providerConnectionId"), path)
                MosaicCommerceProviderActivation.ProviderConnection(
                    value.checkedString("providerConnectionId", path, identifier),
                )
            }
            "sdkLocal" -> {
                value.exactKeys(setOf("source", "localSnapshotId"), path)
                MosaicCommerceProviderActivation.SdkLocal(
                    value.checkedString("localSnapshotId", path, identifier),
                )
            }
            else -> throw MosaicCommerceConfigurationException(
                "Unsupported Commerce provider activation.",
            )
        }
    }

    private fun capabilities(values: List<JsonElement>): List<MosaicCommerceProviderCapability> {
        val result = values.mapIndexed { index, element ->
            val path = "$.configuration.activeProvider.capabilities[$index]"
            val value = element.objectAt(path)
            val allowed = setOf("name", "support", "reasonCode")
            requireCommerce(value.keySet() in setOf(allowed, allowed - "reasonCode"), "Invalid capability fields.")
            val name = value.string("name", path)
            val support = value.string("support", path)
            requireCommerce(name in capabilityNames, "Unsupported Commerce capability.")
            requireCommerce(
                support in setOf("supported", "unsupported", "conditional"),
                "Unsupported capability state.",
            )
            val reason = value.optionalString("reasonCode", path)
            requireCommerce(
                (support == "supported" && reason == null) ||
                    (support != "supported" && reason != null && capabilityReason.matches(reason)),
                "Capability reason does not match support.",
            )
            MosaicCommerceProviderCapability(name, support, reason)
        }
        requireUnique(result.map { it.name }, "Commerce capabilities")
        return result
    }

    private fun productMappings(
        values: List<JsonElement>,
        providerId: String,
    ): Map<String, MosaicCommerceProductMapping> {
        val result = values.mapIndexed { index, element ->
            val path = "$.configuration.productMappings[$index]"
            val value = element.objectAt(path)
            value.exactKeys(
                setOf(
                    "mosaicProductId",
                    "mappingId",
                    "providerProductReference",
                    "adapterMapping",
                ),
                path,
            )
            val adapter = adapterMapping(value.obj("adapterMapping", path), providerId)
            MosaicCommerceProductMapping(
                mosaicProductId = value.checkedString("mosaicProductId", path, identifier),
                mappingId = value.checkedString("mappingId", path, identifier),
                providerProductReference = value.opaqueString(
                    "providerProductReference",
                    path,
                ),
                adapterMapping = adapter,
            )
        }
        requireUnique(result.map { it.mosaicProductId }, "Mosaic Product mappings")
        requireUnique(result.map { it.mappingId }, "Commerce Mapping IDs")
        requireUnique(
            result.map {
                "${it.providerProductReference}:${when (val detail = it.adapterMapping) {
                    MosaicCommerceAdapterMapping.DirectProduct -> "directProduct"
                    is MosaicCommerceAdapterMapping.RevenueCatPackage ->
                        "revenueCatPackage:${detail.offeringIdentifier}:${detail.packageIdentifier}"
                }}"
            },
            "provider mapping targets",
        )
        return result.associateBy { it.mosaicProductId }
    }

    private fun adapterMapping(
        value: JsonObject,
        providerId: String,
    ): MosaicCommerceAdapterMapping {
        val path = "$.configuration.productMappings.adapterMapping"
        return when (value.string("kind", path)) {
            "directProduct" -> {
                value.exactKeys(setOf("kind"), path)
                MosaicCommerceAdapterMapping.DirectProduct
            }
            "revenueCatPackage" -> {
                value.exactKeys(
                    setOf("kind", "offeringIdentifier", "packageIdentifier"),
                    path,
                )
                requireCommerce(
                    providerId == "revenuecat",
                    "RevenueCat Package mapping requires RevenueCat.",
                )
                MosaicCommerceAdapterMapping.RevenueCatPackage(
                    value.opaqueString("offeringIdentifier", path),
                    value.opaqueString("packageIdentifier", path),
                )
            }
            else -> throw MosaicCommerceConfigurationException(
                "Unsupported Commerce adapter mapping.",
            )
        }
    }

    private fun entitlementMappings(
        values: List<JsonElement>,
    ): Map<String, MosaicCommerceEntitlementMapping> {
        val result = values.mapIndexed { index, element ->
            val path = "$.configuration.entitlementMappings[$index]"
            val value = element.objectAt(path)
            value.exactKeys(
                setOf("mosaicEntitlementKey", "providerEntitlementIdentifier"),
                path,
            )
            MosaicCommerceEntitlementMapping(
                value.checkedString("mosaicEntitlementKey", path, entitlementKey),
                value.opaqueString("providerEntitlementIdentifier", path),
            )
        }
        requireUnique(result.map { it.mosaicEntitlementKey }, "Mosaic Entitlement mappings")
        requireUnique(
            result.map { it.providerEntitlementIdentifier },
            "provider Entitlement mappings",
        )
        return result.associateBy { it.mosaicEntitlementKey }
    }

    private fun freshness(
        value: JsonObject,
        activationSource: String,
    ): MosaicCommerceFreshness {
        val path = "$.configuration.freshness"
        val allowed = setOf(
            "source",
            "status",
            "providerObservedAt",
            "synchronizedAt",
            "staleAt",
            "expiresAt",
        )
        requireCommerce(value.keySet() in setOf(allowed, allowed - "expiresAt"), "Invalid freshness fields.")
        val source = value.string("source", path)
        val expectedSource = if (activationSource == "providerConnection") {
            "providerSynchronization"
        } else {
            "sdkLocalSnapshot"
        }
        requireCommerce(source == expectedSource, "Commerce freshness source does not match activation.")
        val status = value.string("status", path)
        requireCommerce(status == "fresh" || status == "stale", "Invalid freshness status.")
        val observed = value.checkedString("providerObservedAt", path, timestamp)
        val synchronized = value.checkedString("synchronizedAt", path, timestamp)
        val stale = value.checkedString("staleAt", path, timestamp)
        val expires = value.optionalCheckedString("expiresAt", path, timestamp)
        requireCommerce(
            compareCommerceTimestamps(observed, synchronized) <= 0,
            "Invalid Commerce freshness order.",
        )
        requireCommerce(
            compareCommerceTimestamps(synchronized, stale) <= 0,
            "Invalid Commerce freshness order.",
        )
        requireCommerce(
            expires == null || compareCommerceTimestamps(stale, expires) <= 0,
            "Invalid Commerce freshness expiry.",
        )
        return MosaicCommerceFreshness(source, status, observed, synchronized, stale, expires)
    }

    private fun compareCommerceTimestamps(left: String, right: String): Int {
        val leftInstant = commerceTimestamp(left)
        val rightInstant = commerceTimestamp(right)
        return when {
            leftInstant.first != rightInstant.first ->
                leftInstant.first.compareTo(rightInstant.first)
            else -> leftInstant.second.compareTo(rightInstant.second)
        }
    }

    private fun commerceTimestamp(value: String): Pair<Long, Int> {
        val calendar = GregorianCalendar(TimeZone.getTimeZone("UTC")).apply {
            isLenient = false
            clear()
            set(
                value.substring(0, 4).toInt(),
                value.substring(5, 7).toInt() - 1,
                value.substring(8, 10).toInt(),
                value.substring(11, 13).toInt(),
                value.substring(14, 16).toInt(),
                value.substring(17, 19).toInt(),
            )
            set(Calendar.MILLISECOND, 0)
        }
        val epochSecond = try {
            calendar.timeInMillis / 1_000L
        } catch (_: IllegalArgumentException) {
            throw MosaicCommerceConfigurationException("Invalid Commerce timestamp.")
        }
        val fraction = value.substring(19, value.length - 1)
            .removePrefix(".")
            .padEnd(6, '0')
            .ifEmpty { "000000" }
            .toInt()
        return epochSecond to fraction
    }

    private fun diagnostics(values: List<JsonElement>): List<MosaicCommerceSafeDiagnostic> =
        values.mapIndexed { index, element ->
            val path = "$.configuration.diagnostics[$index]"
            val value = element.objectAt(path)
            val allowed = setOf(
                "code",
                "safeMessage",
                "severity",
                "retryable",
                "retryAfterSeconds",
                "correlationId",
                "providerCode",
                "mosaicProductId",
                "recoveryAction",
            )
            val required = setOf(
                "code",
                "safeMessage",
                "severity",
                "retryable",
                "correlationId",
            )
            requireCommerce(
                value.keySet().containsAll(required) && value.keySet().all(allowed::contains),
                "Invalid Commerce diagnostic fields.",
            )
            val retryable = value.boolean("retryable", path)
            val retryAfterSeconds = value.optionalInteger(
                "retryAfterSeconds",
                path,
                1,
                86_400,
            )
            requireCommerce(
                retryable || retryAfterSeconds == null,
                "Non-retryable diagnostic cannot declare retryAfterSeconds.",
            )
            val severity = value.string("severity", path)
            requireCommerce(
                severity in setOf("info", "warning", "error"),
                "Invalid Commerce diagnostic severity.",
            )
            val code = value.checkedString("code", path, diagnosticCode)
            requireCommerce(
                code.length in 3..96,
                "Invalid Commerce diagnostic code.",
            )
            MosaicCommerceSafeDiagnostic(
                code = code,
                safeMessage = value.safeString("safeMessage", path, 240),
                severity = severity,
                retryable = retryable,
                retryAfterSeconds = retryAfterSeconds,
                correlationId = value.checkedString("correlationId", path, identifier),
                providerCode = value.optionalSafeString("providerCode", path, 128),
                mosaicProductId = value.optionalCheckedString(
                    "mosaicProductId",
                    path,
                    identifier,
                ),
                recoveryAction = value.optionalString("recoveryAction", path)?.also {
                    requireCommerce(
                        it in recoveryActions,
                        "Invalid Commerce diagnostic recoveryAction.",
                    )
                },
            )
        }

    private fun requireUnique(values: List<String>, label: String) {
        requireCommerce(values.size == values.toSet().size, "Duplicate $label are not allowed.")
    }

    private fun parseObject(source: String, path: String): JsonObject = try {
        JsonParser.parseString(source).objectAt(path)
    } catch (error: MosaicCommerceConfigurationException) {
        throw error
    } catch (error: JsonParseException) {
        throw MosaicCommerceConfigurationException("Invalid Commerce Configuration JSON.", error)
    } catch (error: RuntimeException) {
        throw MosaicCommerceConfigurationException("Invalid Commerce Configuration shape.", error)
    }

    private fun canonicalJson(value: JsonElement): String = when {
        value.isJsonNull -> "null"
        value.isJsonArray -> value.asJsonArray.joinToString(",", "[", "]") { canonicalJson(it) }
        value.isJsonObject -> value.asJsonObject.entrySet().sortedBy { it.key }
            .joinToString(",", "{", "}") { (key, child) ->
                "${canonicalGson.toJson(key)}:${canonicalJson(child)}"
            }
        value.asJsonPrimitive.isString -> canonicalGson.toJson(value.asString)
        value.asJsonPrimitive.isBoolean -> value.asBoolean.toString()
        else -> value.asBigDecimal.stripTrailingZeros().toPlainString()
    }

    private fun requireCommerce(condition: Boolean, message: String) {
        if (!condition) throw MosaicCommerceConfigurationException(message)
    }

    private fun JsonElement.objectAt(path: String): JsonObject =
        if (isJsonObject) asJsonObject else throw MosaicCommerceConfigurationException(
            "Expected object at $path.",
        )

    private fun JsonElement.stringAt(path: String): String =
        if (isJsonPrimitive && asJsonPrimitive.isString) asString else
            throw MosaicCommerceConfigurationException("Expected string at $path.")

    private fun JsonObject.exactKeys(expected: Set<String>, path: String) {
        requireCommerce(
            keySet() == expected,
            "Unexpected or missing fields at $path: ${(keySet() - expected) + (expected - keySet())}.",
        )
    }

    private fun JsonObject.obj(name: String, path: String): JsonObject =
        get(name)?.objectAt("$path.$name")
            ?: throw MosaicCommerceConfigurationException("Missing $path.$name.")

    private fun JsonObject.string(name: String, path: String): String =
        get(name)?.stringAt("$path.$name")
            ?: throw MosaicCommerceConfigurationException("Missing $path.$name.")

    private fun JsonObject.optionalString(name: String, path: String): String? =
        if (has(name)) string(name, path) else null

    private fun JsonObject.checkedString(
        name: String,
        path: String,
        pattern: Regex,
    ): String = string(name, path).also {
        requireCommerce(pattern.matches(it), "Invalid $path.$name.")
    }

    private fun JsonObject.optionalCheckedString(
        name: String,
        path: String,
        pattern: Regex,
    ): String? = optionalString(name, path)?.also {
        requireCommerce(pattern.matches(it), "Invalid $path.$name.")
    }

    private fun JsonObject.safeString(name: String, path: String, maximum: Int): String =
        string(name, path).also {
            requireCommerce(it.length in 1..maximum && safeText.matches(it), "Invalid $path.$name.")
        }

    private fun JsonObject.optionalSafeString(
        name: String,
        path: String,
        maximum: Int,
    ): String? = if (has(name)) safeString(name, path, maximum) else null

    private fun JsonObject.opaqueString(name: String, path: String): String =
        safeString(name, path, 256)

    private fun JsonObject.boolean(name: String, path: String): Boolean {
        val value = get(name)
        requireCommerce(
            value != null && value.isJsonPrimitive && value.asJsonPrimitive.isBoolean,
            "Expected Boolean at $path.$name.",
        )
        return value!!.asBoolean
    }

    private fun JsonObject.optionalInteger(
        name: String,
        path: String,
        minimum: Int,
        maximum: Int,
    ): Int? {
        if (!has(name)) return null
        val value = get(name)
        val number = runCatching { value.asBigDecimal }.getOrNull()
        requireCommerce(
            number != null && number.scale() <= 0,
            "Expected integer at $path.$name.",
        )
        val integer = try {
            number!!.intValueExact()
        } catch (_: ArithmeticException) {
            throw MosaicCommerceConfigurationException("Integer out of range at $path.$name.")
        }
        requireCommerce(integer in minimum..maximum, "Invalid $path.$name.")
        return integer
    }

    private fun JsonObject.array(
        name: String,
        path: String,
        minimum: Int,
        maximum: Int,
    ): List<JsonElement> {
        val value = get(name)
        requireCommerce(value != null && value.isJsonArray, "Expected array at $path.$name.")
        return value!!.asJsonArray.toList().also {
            requireCommerce(it.size in minimum..maximum, "Invalid item count at $path.$name.")
        }
    }
}

class MosaicCommerceConfigurationException(
    message: String,
    cause: Throwable? = null,
) : IllegalArgumentException(message, cause)
