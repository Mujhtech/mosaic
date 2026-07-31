package dev.mosaic.sdk

import com.google.gson.JsonElement
import com.google.gson.GsonBuilder
import com.google.gson.JsonObject
import com.google.gson.JsonParseException
import com.google.gson.JsonParser
import java.security.MessageDigest

const val MOSAIC_CONFIGURATION_DELIVERY_VERSION: String = "1"

data class MosaicDeliveryEnvironment(val id: String, val key: String)
data class MosaicPlacementBinding(val key: String, val paywallVersionId: String)
data class MosaicDeliveryProduct(val id: String, val type: String, val fallbackDisplayName: String)
data class MosaicDeliveryAsset(
    val id: String,
    val kind: String,
    val mediaType: String,
    val byteLength: Long,
    val contentDigest: String,
    val url: String,
)
data class MosaicDeliveredPaywall(
    val id: String,
    val paywallId: String,
    val protocolVersion: String,
    val documentDigest: String,
    val document: MosaicPaywallDocument,
    val productReferenceIds: List<String>,
    val assetBindings: Map<String, String>,
)
data class MosaicConfigurationRelease(
    val id: String,
    val number: Long,
    val environment: MosaicDeliveryEnvironment,
    val publishedAt: String,
    val contentDigest: String,
    val placements: Map<String, MosaicPlacementBinding>,
    val paywallVersions: Map<String, MosaicDeliveredPaywall>,
    val productReferences: Map<String, MosaicDeliveryProduct>,
    val assetReferences: Map<String, MosaicDeliveryAsset>,
    val encoded: String,
) {
    fun paywall(forPlacement: String): MosaicDeliveredPaywall? =
        placements[forPlacement]?.paywallVersionId?.let(paywallVersions::get)
}

/** Strict reader for the frozen Configuration Delivery v1 envelope. */
object MosaicConfigurationDeliveryDecoder {
    private val canonicalGson = GsonBuilder().disableHtmlEscaping().create()
    private val identifier = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
    private val placementKey = Regex("^[a-z][a-z0-9_]{0,63}$")
    private val environmentKey = Regex("^[a-z][a-z0-9_-]{0,63}$")
    private val digest = Regex("^sha256:[a-f0-9]{64}$")

    fun decode(
        source: String,
        capabilityReport: MosaicCapabilityReport = MosaicProtocolCapabilities.report(),
    ): MosaicConfigurationRelease {
        val root = parseObject(source, "$")
        root.exactKeys(setOf("configurationDeliveryVersion", "release"), "$")
        root.string("configurationDeliveryVersion", "$").also {
            requireDelivery(it == MOSAIC_CONFIGURATION_DELIVERY_VERSION, "Unsupported configuration delivery version $it.")
        }
        val release = root.obj("release", "$")
        release.exactKeys(
            setOf(
                "id", "number", "environment", "publishedAt", "contentDigest", "compatibility",
                "placements", "paywallVersions", "productReferences", "assetReferences",
            ),
            "$.release",
        )

        val environmentObject = release.obj("environment", "$.release")
        environmentObject.exactKeys(setOf("id", "key"), "$.release.environment")
        val environment = MosaicDeliveryEnvironment(
            environmentObject.checkedString("id", "$.release.environment", identifier),
            environmentObject.checkedString("key", "$.release.environment", environmentKey),
        )
        val releaseCapabilities = validateCompatibility(release.obj("compatibility", "$.release"), capabilityReport)

        val productReferences = release.array("productReferences", "$.release", 0, 1024)
            .mapIndexed { index, element -> product(element, "$.release.productReferences[$index]") }
            .uniqueById("productReferences")
        val assetReferences = release.array("assetReferences", "$.release", 0, 1024)
            .mapIndexed { index, element -> asset(element, "$.release.assetReferences[$index]") }
            .uniqueById("assetReferences")
        val paywallVersions = release.array("paywallVersions", "$.release", 1, 256)
            .mapIndexed { index, element ->
                paywall(element, "$.release.paywallVersions[$index]", capabilityReport)
            }.uniqueById("paywallVersions")
        val placements = release.array("placements", "$.release", 1, 256)
            .mapIndexed { index, element -> placement(element, "$.release.placements[$index]") }
            .associateUnique({ it.key }, "placements")

        val declaredReleaseDigest = release.checkedString("contentDigest", "$.release", digest)
        val digestMaterial = release.deepCopy().also { it.remove("contentDigest") }
        requireDelivery(
            declaredReleaseDigest == sha256Digest(digestMaterial),
            "Release contentDigest does not match its canonical release material.",
        )

        placements.values.forEach { binding ->
            requireDelivery(binding.paywallVersionId in paywallVersions, "Placement ${binding.key} references an unknown Paywall Version.")
        }
        requireDelivery(
            placements.values.map { it.paywallVersionId }.toSet() == paywallVersions.keys,
            "The release must contain exactly the Paywall Versions used by Placements.",
        )
        val usedProducts = mutableSetOf<String>()
        val usedAssets = mutableSetOf<String>()
        val documentCapabilities = mutableSetOf<String>()
        paywallVersions.values.forEach { version ->
            requireDelivery(version.paywallId == version.document.id, "Paywall Version ${version.id} does not match its document ID.")
            val documentProducts = version.document.products.map { it.providerProductId }.toSet()
            requireDelivery(
                version.productReferenceIds.toSet() == documentProducts,
                "Paywall Version ${version.id} Product references do not match its document.",
            )
            version.productReferenceIds.forEach { id ->
                requireDelivery(id in productReferences, "Paywall Version ${version.id} references unknown Product $id.")
                usedProducts += id
            }
            val remoteAssets = version.document.assets.filter { it.source is MosaicAssetSource.Remote }.associateBy { it.id }
            requireDelivery(
                version.assetBindings.keys == remoteAssets.keys,
                "Paywall Version ${version.id} Asset bindings do not match its remote document Assets.",
            )
            version.assetBindings.values.forEach { id ->
                requireDelivery(id in assetReferences, "Paywall Version ${version.id} references unknown asset $id.")
                usedAssets += id
            }
            version.assetBindings.forEach { (documentAssetID, referenceID) ->
                val documentAsset = remoteAssets.getValue(documentAssetID)
                val reference = assetReferences.getValue(referenceID)
                val kind = if (documentAsset is MosaicImageAsset) "image" else "video"
                requireDelivery(reference.kind == kind, "Asset kind does not match $documentAssetID.")
                requireDelivery(
                    reference.url == (documentAsset.source as MosaicAssetSource.Remote).url,
                    "Asset URL does not match $documentAssetID.",
                )
            }
            documentCapabilities += version.document.compatibility.requiredCapabilities.map { "${it.name.wireName}@${it.version}" }
        }
        requireDelivery(usedProducts == productReferences.keys, "Product records must exactly match referenced Products.")
        requireDelivery(usedAssets == assetReferences.keys, "Asset records must exactly match referenced Assets.")
        requireDelivery(documentCapabilities == releaseCapabilities, "Release capabilities do not exactly match its documents.")

        return MosaicConfigurationRelease(
            id = release.checkedString("id", "$.release", identifier),
            number = release.positiveLong("number", "$.release"),
            environment = environment,
            publishedAt = release.string("publishedAt", "$.release"),
            contentDigest = declaredReleaseDigest,
            placements = placements,
            paywallVersions = paywallVersions,
            productReferences = productReferences,
            assetReferences = assetReferences,
            encoded = source,
        )
    }

    private fun validateCompatibility(value: JsonObject, report: MosaicCapabilityReport): Set<String> {
        val path = "$.release.compatibility"
        value.exactKeys(setOf("paywallProtocols", "acceptance"), path)
        requireDelivery(value.string("acceptance", path) == "atomic", "Only atomic release acceptance is supported.")
        val protocols = value.array("paywallProtocols", path, 1, 1)
        val protocol = protocols.single().objectAt("$path.paywallProtocols[0]")
        protocol.exactKeys(setOf("version", "requiredCapabilities"), "$path.paywallProtocols[0]")
        requireDelivery(protocol.string("version", path) == MOSAIC_PROTOCOL_VERSION, "Unsupported Paywall Protocol version.")
        val capabilities = mutableSetOf<String>()
        protocol.array("requiredCapabilities", path, 1, 128).forEachIndexed { index, entry ->
            val capability = entry.objectAt("$path.requiredCapabilities[$index]")
            capability.exactKeys(setOf("name", "version"), "$path.requiredCapabilities[$index]")
            val name = MosaicCapabilityName.entries.firstOrNull { it.wireName == capability.string("name", path) }
            val version = capability.string("version", path)
            requireDelivery(
                name != null && report.supports(MosaicRequiredCapability(name, version)),
                "Unsupported release capability ${capability.string("name", path)}@$version.",
            )
            requireDelivery(capabilities.add("${capability.string("name", path)}@$version"), "Duplicate release capability.")
        }
        return capabilities
    }

    private fun placement(value: JsonElement, path: String): MosaicPlacementBinding {
        val item = value.objectAt(path)
        item.exactKeys(setOf("key", "paywallVersionId"), path)
        return MosaicPlacementBinding(
            item.checkedString("key", path, placementKey),
            item.checkedString("paywallVersionId", path, identifier),
        )
    }

    private fun paywall(value: JsonElement, path: String, report: MosaicCapabilityReport): MosaicDeliveredPaywall {
        val item = value.objectAt(path)
        item.exactKeys(
            setOf("id", "paywallId", "protocolVersion", "documentDigest", "document", "productReferenceIds", "assetBindings"),
            path,
        )
        requireDelivery(item.string("protocolVersion", path) == MOSAIC_PROTOCOL_VERSION, "Unsupported Paywall Protocol version.")
        val documentJson = item.get("document").toString()
        val bindings = item.array("assetBindings", path, 0, 128).mapIndexed { index, element ->
            val bindingPath = "$path.assetBindings[$index]"
            val binding = element.objectAt(bindingPath)
            binding.exactKeys(setOf("documentAssetId", "assetReferenceId"), bindingPath)
            binding.checkedString("documentAssetId", bindingPath, identifier) to
                binding.checkedString("assetReferenceId", bindingPath, identifier)
        }.associateUnique({ it.first }, "assetBindings").mapValues { it.value.second }
        val documentDigest = item.checkedString("documentDigest", path, digest)
        val computedDocumentDigest = sha256Digest(item.get("document"))
        requireDelivery(
            documentDigest == computedDocumentDigest,
            "Document digest does not match at $path (declared $documentDigest, computed $computedDocumentDigest).",
        )
        return MosaicDeliveredPaywall(
            id = item.checkedString("id", path, identifier),
            paywallId = item.checkedString("paywallId", path, identifier),
            protocolVersion = MOSAIC_PROTOCOL_VERSION,
            documentDigest = documentDigest,
            document = MosaicProtocolDecoder.decode(documentJson, report),
            productReferenceIds = item.array("productReferenceIds", path, 0, 64).map { it.stringAt(path) }.also {
                requireDelivery(it.size == it.toSet().size, "Duplicate Product references are not allowed.")
            },
            assetBindings = bindings,
        )
    }

    private fun product(value: JsonElement, path: String): MosaicDeliveryProduct {
        val item = value.objectAt(path)
        item.exactKeys(setOf("id", "type", "fallbackDisplayName"), path)
        val type = item.string("type", path)
        requireDelivery(type == "subscription" || type == "one_time_non_consumable", "Unsupported Product type at $path.")
        return MosaicDeliveryProduct(item.checkedString("id", path, identifier), type, item.string("fallbackDisplayName", path))
    }

    private fun asset(value: JsonElement, path: String): MosaicDeliveryAsset {
        val item = value.objectAt(path)
        item.exactKeys(setOf("id", "kind", "mediaType", "byteLength", "contentDigest", "url"), path)
        val kind = item.string("kind", path)
        requireDelivery(kind == "image" || kind == "video", "Unsupported asset kind at $path.")
        val url = item.string("url", path)
        requireDelivery(url.startsWith("https://"), "Hosted asset URLs must use HTTPS.")
        return MosaicDeliveryAsset(
            item.checkedString("id", path, identifier), kind, item.string("mediaType", path),
            item.positiveLong("byteLength", path), item.checkedString("contentDigest", path, digest), url,
        )
    }

    private fun parseObject(source: String, path: String): JsonObject = try {
        JsonParser.parseString(source).objectAt(path)
    } catch (error: MosaicConfigurationDeliveryException) {
        throw error
    } catch (error: JsonParseException) {
        throw MosaicConfigurationDeliveryException("Invalid Configuration Delivery JSON.", error)
    } catch (error: IllegalStateException) {
        throw MosaicConfigurationDeliveryException("Invalid Configuration Delivery shape.", error)
    }

    private fun requireDelivery(condition: Boolean, message: String) {
        if (!condition) throw MosaicConfigurationDeliveryException(message)
    }

    private fun sha256Digest(value: JsonElement): String {
        val bytes = canonicalJson(value).toByteArray(Charsets.UTF_8)
        return "sha256:" + MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString("") { "%02x".format(it) }
    }

    private fun canonicalJson(value: JsonElement): String = when {
        value.isJsonNull -> "null"
        value.isJsonArray -> value.asJsonArray.joinToString(separator = ",", prefix = "[", postfix = "]") { canonicalJson(it) }
        value.isJsonObject -> value.asJsonObject.entrySet().sortedBy { it.key }.joinToString(
            separator = ",",
            prefix = "{",
            postfix = "}",
        ) { (key, child) -> "${canonicalGson.toJson(key)}:${canonicalJson(child)}" }
        value.asJsonPrimitive.isString -> canonicalGson.toJson(value.asString)
        value.asJsonPrimitive.isBoolean -> value.asBoolean.toString()
        else -> value.asBigDecimal.stripTrailingZeros().toPlainString()
    }

    private fun <T> List<T>.associateUnique(key: (T) -> String, label: String): Map<String, T> {
        val result = associateBy(key)
        requireDelivery(result.size == size, "Duplicate $label entries are not allowed.")
        return result
    }
    private fun <T> List<T>.uniqueById(label: String): Map<String, T> where T : Any {
        val id: (T) -> String = { value ->
            when (value) {
                is MosaicDeliveryProduct -> value.id
                is MosaicDeliveryAsset -> value.id
                is MosaicDeliveredPaywall -> value.id
                else -> error("Unsupported delivery model")
            }
        }
        return associateUnique(id, label)
    }

    private fun JsonElement.objectAt(path: String): JsonObject =
        if (isJsonObject) asJsonObject else throw MosaicConfigurationDeliveryException("Expected object at $path.")
    private fun JsonElement.stringAt(path: String): String =
        if (isJsonPrimitive && asJsonPrimitive.isString) asString else throw MosaicConfigurationDeliveryException("Expected string at $path.")
    private fun JsonObject.exactKeys(expected: Set<String>, path: String) {
        val actual = keySet()
        requireDelivery(actual == expected, "Unexpected or missing fields at $path: ${(actual - expected) + (expected - actual)}.")
    }
    private fun JsonObject.obj(name: String, path: String): JsonObject =
        get(name)?.objectAt("$path.$name") ?: throw MosaicConfigurationDeliveryException("Missing $path.$name.")
    private fun JsonObject.string(name: String, path: String): String =
        get(name)?.stringAt("$path.$name") ?: throw MosaicConfigurationDeliveryException("Missing $path.$name.")
    private fun JsonObject.checkedString(name: String, path: String, pattern: Regex): String = string(name, path).also {
        requireDelivery(pattern.matches(it), "Invalid $path.$name.")
    }
    private fun JsonObject.positiveLong(name: String, path: String): Long {
        val value = get(name) ?: throw MosaicConfigurationDeliveryException("Missing $path.$name.")
        val number = runCatching { value.asBigDecimal }.getOrNull()
        requireDelivery(number != null && number.scale() <= 0 && number.signum() > 0, "Expected positive integer at $path.$name.")
        return try { number!!.longValueExact() } catch (_: ArithmeticException) {
            throw MosaicConfigurationDeliveryException("Integer out of range at $path.$name.")
        }
    }
    private fun JsonObject.array(name: String, path: String, minimum: Int, maximum: Int): List<JsonElement> {
        val value = get(name)
        requireDelivery(value != null && value.isJsonArray, "Expected array at $path.$name.")
        val entries = value!!.asJsonArray.toList()
        requireDelivery(entries.size in minimum..maximum, "Invalid item count at $path.$name.")
        return entries
    }
}

class MosaicConfigurationDeliveryException(message: String, cause: Throwable? = null) :
    IllegalArgumentException(message, cause)
