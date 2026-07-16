package dev.mosaic.sdk

import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParseException
import com.google.gson.JsonParser

/** Strict reader for the repository's protocol 0.1 document shape. */
object MosaicProtocolDecoder {
    private val identifierPattern = Regex("^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$")
    private val localizationKeyPattern = Regex("^[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+$")
    private val productIdPattern = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    private val capabilitiesByWireName = MosaicCapabilityName.entries.associateBy { it.wireName }

    fun decode(source: String): MosaicPaywallDocument {
        val root = try {
            JsonParser.parseString(source).objectAt("$")
        } catch (error: MosaicProtocolException) {
            throw error
        } catch (error: JsonParseException) {
            throw MosaicProtocolException("Invalid JSON.", error)
        } catch (error: IllegalStateException) {
            throw MosaicProtocolException("Invalid JSON document shape.", error)
        }

        root.expectKeys(
            setOf("schemaVersion", "id", "revision", "compatibility", "layout"),
            "$",
        )
        val schemaVersion = root.requiredString("schemaVersion", "$.schemaVersion")
        if (schemaVersion != MOSAIC_PROTOCOL_VERSION) {
            throw MosaicProtocolException("Unsupported schemaVersion $schemaVersion at $.schemaVersion.")
        }

        val document = MosaicPaywallDocument(
            schemaVersion = schemaVersion,
            id = root.requiredIdentifier("id", "$.id"),
            revision = root.requiredPositiveInteger("revision", "$.revision"),
            compatibility = compatibility(root.required("compatibility", "$")),
            layout = layout(root.required("layout", "$")),
        )
        validateDocumentSemantics(document)
        return document
    }

    private fun compatibility(value: JsonElement): MosaicDocumentCompatibility {
        val path = "$.compatibility"
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("requiredCapabilities"), path)
        val values = objectValue.required("requiredCapabilities", path).nonEmptyArrayAt("$path.requiredCapabilities")
        val seen = mutableSetOf<String>()
        val capabilities = values.mapIndexed { index, element ->
            val capabilityPath = "$path.requiredCapabilities[$index]"
            val capability = element.objectAt(capabilityPath)
            capability.expectKeys(setOf("name", "version"), capabilityPath)
            val name = capability.requiredString("name", "$capabilityPath.name")
            val version = capability.requiredString("version", "$capabilityPath.version")
            val knownName = capabilitiesByWireName[name]
                ?: throw MosaicProtocolException("Unsupported capability $name@$version at $capabilityPath.")
            if (version != MOSAIC_PROTOCOL_VERSION) {
                throw MosaicProtocolException("Unsupported capability $name@$version at $capabilityPath.")
            }
            if (!seen.add("$name@$version")) {
                throw MosaicProtocolException("Duplicate capability $name@$version at $capabilityPath.")
            }
            MosaicRequiredCapability(name = knownName, version = version)
        }
        return MosaicDocumentCompatibility(capabilities)
    }

    private fun layout(value: JsonElement): MosaicVerticalLayout {
        val path = "$.layout"
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("type", "id", "gap", "padding", "children"), path)
        val type = objectValue.requiredString("type", "$path.type")
        if (type != "vertical") {
            throw MosaicProtocolException("Unsupported layout $type at $path.type.")
        }
        val values = objectValue.required("children", path).nonEmptyArrayAt("$path.children")
        return MosaicVerticalLayout(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            gap = objectValue.requiredNonNegativeNumber("gap", "$path.gap"),
            padding = objectValue.requiredNonNegativeNumber("padding", "$path.padding"),
            children = values.mapIndexed { index, child -> component(child, "$path.children[$index]") },
        )
    }

    private fun component(value: JsonElement, path: String): MosaicComponent {
        val objectValue = value.objectAt(path)
        return when (val type = objectValue.requiredString("type", "$path.type")) {
            "text" -> {
                objectValue.expectKeys(setOf("type", "id", "value"), path)
                MosaicTextComponent(
                    id = objectValue.requiredIdentifier("id", "$path.id"),
                    value = localizedText(objectValue.required("value", path), "$path.value"),
                )
            }
            "featureList" -> {
                objectValue.expectKeys(setOf("type", "id", "items"), path)
                val values = objectValue.required("items", path).nonEmptyArrayAt("$path.items")
                MosaicFeatureListComponent(
                    id = objectValue.requiredIdentifier("id", "$path.id"),
                    items = values.mapIndexed { index, item ->
                        featureListItem(item, "$path.items[$index]")
                    },
                )
            }
            "productSelector" -> {
                objectValue.expectKeys(
                    setOf("type", "id", "products", "initiallySelectedProductId"),
                    path,
                )
                val products = objectValue.required("products", path).nonEmptyArrayAt("$path.products")
                MosaicProductSelectorComponent(
                    id = objectValue.requiredIdentifier("id", "$path.id"),
                    products = products.mapIndexed { index, product ->
                        productReference(product, "$path.products[$index]")
                    },
                    initiallySelectedProductId = objectValue.requiredProductId(
                        "initiallySelectedProductId",
                        "$path.initiallySelectedProductId",
                    ),
                )
            }
            "purchaseButton" -> {
                objectValue.expectKeys(setOf("type", "id", "label"), path)
                MosaicPurchaseButtonComponent(
                    id = objectValue.requiredIdentifier("id", "$path.id"),
                    label = localizedText(objectValue.required("label", path), "$path.label"),
                )
            }
            "restoreButton" -> {
                objectValue.expectKeys(setOf("type", "id", "label"), path)
                MosaicRestoreButtonComponent(
                    id = objectValue.requiredIdentifier("id", "$path.id"),
                    label = localizedText(objectValue.required("label", path), "$path.label"),
                )
            }
            "closeButton" -> {
                objectValue.expectKeys(setOf("type", "id", "label"), path)
                MosaicCloseButtonComponent(
                    id = objectValue.requiredIdentifier("id", "$path.id"),
                    label = localizedText(objectValue.required("label", path), "$path.label"),
                )
            }
            "legalText" -> {
                objectValue.expectKeys(setOf("type", "id", "value"), path)
                MosaicLegalTextComponent(
                    id = objectValue.requiredIdentifier("id", "$path.id"),
                    value = localizedText(objectValue.required("value", path), "$path.value"),
                )
            }
            else -> throw MosaicProtocolException("Unsupported component $type at $path.type.")
        }
    }

    private fun localizedText(value: JsonElement, path: String): MosaicLocalizedText {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("default", "localizationKey"), path)
        return MosaicLocalizedText(
            defaultValue = objectValue.requiredNonEmptyString("default", "$path.default"),
            localizationKey = objectValue.requiredLocalizationKey(
                "localizationKey",
                "$path.localizationKey",
            ),
        )
    }

    private fun featureListItem(value: JsonElement, path: String): MosaicFeatureListItem {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("id", "text"), path)
        return MosaicFeatureListItem(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            text = localizedText(objectValue.required("text", path), "$path.text"),
        )
    }

    private fun productReference(value: JsonElement, path: String): MosaicProductReference {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("productId"), path)
        return MosaicProductReference(
            productId = objectValue.requiredProductId("productId", "$path.productId"),
        )
    }

    private fun validateDocumentSemantics(document: MosaicPaywallDocument) {
        val expectedCapabilities = buildSet {
            add(MosaicCapabilityName.VERTICAL_LAYOUT)
            document.layout.children.forEach { component ->
                add(capabilityFor(component))
            }
        }
        val declaredCapabilities = document.compatibility.requiredCapabilities.map { it.name }.toSet()
        if (declaredCapabilities != expectedCapabilities) {
            throw MosaicProtocolException("Capability declarations do not match document content.")
        }

        document.layout.children.filterIsInstance<MosaicProductSelectorComponent>().forEach { selector ->
            val productIds = selector.products.map { it.productId }
            if (productIds.toSet().size != productIds.size) {
                throw MosaicProtocolException(
                    "Product selector ${selector.id} contains duplicate product IDs.",
                )
            }
            if (selector.initiallySelectedProductId !in productIds) {
                throw MosaicProtocolException(
                    "Product selector ${selector.id} initially selects an undeclared product.",
                )
            }
        }
    }

    private fun capabilityFor(component: MosaicComponent): MosaicCapabilityName = when (component) {
        is MosaicTextComponent -> MosaicCapabilityName.TEXT
        is MosaicFeatureListComponent -> MosaicCapabilityName.FEATURE_LIST
        is MosaicProductSelectorComponent -> MosaicCapabilityName.PRODUCT_SELECTOR
        is MosaicPurchaseButtonComponent -> MosaicCapabilityName.PURCHASE_BUTTON
        is MosaicRestoreButtonComponent -> MosaicCapabilityName.RESTORE_BUTTON
        is MosaicCloseButtonComponent -> MosaicCapabilityName.CLOSE_BUTTON
        is MosaicLegalTextComponent -> MosaicCapabilityName.LEGAL_TEXT
    }

    private fun JsonObject.required(name: String, path: String): JsonElement = get(name)
        ?: throw MosaicProtocolException("Missing property $name at $path.")

    private fun JsonObject.requiredString(name: String, path: String): String {
        val value = required(name, path.substringBeforeLast('.', path))
        if (!value.isJsonPrimitive || !value.asJsonPrimitive.isString) {
            throw MosaicProtocolException("Expected a string at $path.")
        }
        return value.asString
    }

    private fun JsonObject.requiredNonEmptyString(name: String, path: String): String =
        requiredString(name, path).also {
            if (it.isEmpty()) throw MosaicProtocolException("Expected a non-empty string at $path.")
        }

    private fun JsonObject.requiredIdentifier(name: String, path: String): String =
        requiredNonEmptyString(name, path).also {
            if (!identifierPattern.matches(it)) {
                throw MosaicProtocolException("Invalid identifier $it at $path.")
            }
        }

    private fun JsonObject.requiredLocalizationKey(name: String, path: String): String =
        requiredString(name, path).also {
            if (!localizationKeyPattern.matches(it)) {
                throw MosaicProtocolException("Invalid localization key $it at $path.")
            }
        }

    private fun JsonObject.requiredProductId(name: String, path: String): String =
        requiredNonEmptyString(name, path).also {
            if (!productIdPattern.matches(it)) {
                throw MosaicProtocolException("Invalid product ID $it at $path.")
            }
        }

    private fun JsonObject.requiredPositiveInteger(name: String, path: String): Int {
        val value = required(name, path.substringBeforeLast('.', path))
        if (!value.isJsonPrimitive || !value.asJsonPrimitive.isNumber) {
            throw MosaicProtocolException("Expected a positive integer at $path.")
        }
        val number = runCatching { value.asBigDecimal }.getOrNull()
        if (number == null || number.stripTrailingZeros().scale() > 0 || number < java.math.BigDecimal.ONE) {
            throw MosaicProtocolException("Expected a positive integer at $path.")
        }
        return runCatching { number.intValueExact() }.getOrElse {
            throw MosaicProtocolException("Expected a 32-bit positive integer at $path.")
        }
    }

    private fun JsonObject.requiredNonNegativeNumber(name: String, path: String): Double {
        val value = required(name, path.substringBeforeLast('.', path))
        if (!value.isJsonPrimitive || !value.asJsonPrimitive.isNumber) {
            throw MosaicProtocolException("Expected a non-negative number at $path.")
        }
        val number = runCatching { value.asDouble }.getOrNull()
        if (number == null || !number.isFinite() || number < 0) {
            throw MosaicProtocolException("Expected a non-negative number at $path.")
        }
        return number
    }

    private fun JsonElement.objectAt(path: String): JsonObject {
        if (!isJsonObject) throw MosaicProtocolException("Expected an object at $path.")
        return asJsonObject
    }

    private fun JsonElement.nonEmptyArrayAt(path: String): JsonArray {
        if (!isJsonArray || asJsonArray.isEmpty) {
            throw MosaicProtocolException("Expected a non-empty array at $path.")
        }
        return asJsonArray
    }

    private fun JsonObject.expectKeys(expected: Set<String>, path: String) {
        val actual = keySet()
        val missing = expected - actual
        val unknown = actual - expected
        if (missing.isNotEmpty()) {
            throw MosaicProtocolException("Missing properties ${missing.sorted().joinToString()} at $path.")
        }
        if (unknown.isNotEmpty()) {
            throw MosaicProtocolException("Unknown properties ${unknown.sorted().joinToString()} at $path.")
        }
    }
}

class MosaicProtocolException(
    message: String,
    cause: Throwable? = null,
) : IllegalArgumentException(message, cause)
