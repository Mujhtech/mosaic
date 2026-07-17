package dev.mosaic.sdk

import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonNull
import com.google.gson.JsonObject
import com.google.gson.JsonParseException
import com.google.gson.JsonParser
import java.math.BigDecimal
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/** Strict Protocol 0.2 reader. JSON Schema in `protocol/` remains canonical. */
internal object MosaicProtocolV02Decoder {
    private val identifierPattern = Regex("^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$")
    private val localizationKeyPattern = Regex("^[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+$")
    private val localeTagPattern = Regex("^[a-z]{2,3}(?:-(?:[A-Z]{2}|[0-9]{3}))?$")
    private val providerProductIdPattern = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    private val bundledAssetKeyPattern = Regex("^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$")
    private val literalColorPattern = Regex("^#[0-9A-F]{8}$")
    private val utcTimestampPattern = Regex(
        "^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])" +
            "T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$",
    )
    private val capabilitiesByWireName = MosaicCapabilityName.entries.associateBy { it.wireName }

    fun decode(
        source: String,
        capabilityReport: MosaicCapabilityReport,
    ): MosaicPaywallDocument {
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
            setOf(
                "schemaVersion", "id", "revision", "compatibility", "localization",
                "assets", "products", "layout",
            ),
            "$",
        )
        root.requireConstant("schemaVersion", MOSAIC_PROTOCOL_VERSION_V02, "$.schemaVersion")
        val document = MosaicPaywallDocument(
            schemaVersion = MOSAIC_PROTOCOL_VERSION_V02,
            id = root.requiredIdentifier("id", "$.id"),
            revision = root.requiredPositiveInteger("revision", "$.revision"),
            compatibility = compatibility(root.required("compatibility", "$"), capabilityReport),
            localization = localization(root.required("localization", "$")),
            assets = root.required("assets", "$").arrayAt("$.assets").mapIndexed { index, value ->
                imageAsset(value, "$.assets[$index]")
            },
            products = root.required("products", "$").arrayAt("$.products").mapIndexed { index, value ->
                productReference(value, "$.products[$index]")
            },
            layout = scrollContainer(root.required("layout", "$"), "$.layout"),
        )
        validateDocumentSemantics(document, root, capabilityReport)
        return document
    }

    private fun compatibility(
        value: JsonElement,
        capabilityReport: MosaicCapabilityReport,
    ): MosaicDocumentCompatibility {
        val path = "$.compatibility"
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("requiredCapabilities"), path)
        val entries = objectValue.required("requiredCapabilities", path)
            .boundedArrayAt("$path.requiredCapabilities", 1, 64)
        val seen = mutableSetOf<MosaicCapabilityName>()
        val capabilities = entries.mapIndexed { index, element ->
            val capabilityPath = "$path.requiredCapabilities[$index]"
            val capability = element.objectAt(capabilityPath)
            capability.expectKeys(setOf("name", "version"), capabilityPath)
            val wireName = capability.requiredString("name", "$capabilityPath.name")
            val version = capability.requiredString("version", "$capabilityPath.version")
            val name = capabilitiesByWireName[wireName]
                ?: throw MosaicProtocolException(
                    "Unsupported capability $wireName@$version at $capabilityPath.",
                )
            val required = MosaicRequiredCapability(name, version)
            if (name !in MosaicCapabilityCatalog.v02 ||
                version != MOSAIC_PROTOCOL_VERSION_V02 ||
                !capabilityReport.supports(required)
            ) {
                throw MosaicProtocolException(
                    "Unsupported capability $wireName@$version at $capabilityPath.",
                )
            }
            if (!seen.add(name)) {
                throw MosaicProtocolException("Duplicate capability $wireName at $capabilityPath.")
            }
            required
        }
        return MosaicDocumentCompatibility(capabilities)
    }

    private fun localization(value: JsonElement): MosaicLocalization {
        val path = "$.localization"
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("defaultLocale", "fallbackLocale", "locales"), path)
        val localeObject = objectValue.required("locales", path).objectAt("$path.locales")
        if (localeObject.size() !in 1..100) {
            throw MosaicProtocolException("Expected 1 to 100 locales at $path.locales.")
        }
        val locales = buildMap {
            localeObject.entrySet().forEach { (tag, catalogElement) ->
                validateLocaleTag(tag, "$path.locales")
                put(tag, localeCatalog(catalogElement, "$path.locales.$tag"))
            }
        }
        return MosaicLocalization(
            defaultLocale = objectValue.requiredLocaleTag("defaultLocale", "$path.defaultLocale"),
            fallbackLocale = objectValue.requiredLocaleTag("fallbackLocale", "$path.fallbackLocale"),
            locales = locales,
        )
    }

    private fun localeCatalog(value: JsonElement, path: String): MosaicLocaleCatalog {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("direction", "strings"), path)
        val direction = when (objectValue.requiredString("direction", "$path.direction")) {
            "ltr" -> MosaicLayoutDirection.LTR
            "rtl" -> MosaicLayoutDirection.RTL
            else -> throw MosaicProtocolException("Invalid layout direction at $path.direction.")
        }
        val stringsObject = objectValue.required("strings", path).objectAt("$path.strings")
        if (stringsObject.size() !in 1..5000) {
            throw MosaicProtocolException("Invalid localized string count at $path.strings.")
        }
        val strings = buildMap {
            stringsObject.entrySet().forEach { (key, stringElement) ->
                validateLocalizationKey(key, "$path.strings")
                put(key, stringElement.stringAt("$path.strings.$key", 1, 5000))
            }
        }
        return MosaicLocaleCatalog(direction, strings)
    }

    private fun imageAsset(value: JsonElement, path: String): MosaicImageAsset {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("type", "id", "source", "fallback"), path)
        objectValue.requireConstant("type", "image", "$path.type")
        val sourcePath = "$path.source"
        val source = objectValue.required("source", path).objectAt(sourcePath)
        source.expectKeys(setOf("type", "key"), sourcePath)
        source.requireConstant("type", "bundled", "$sourcePath.type")
        val key = source.requiredString("key", "$sourcePath.key").also {
            if (it.codePointLength() !in 1..256 || !bundledAssetKeyPattern.matches(it)) {
                throw MosaicProtocolException("Invalid bundled asset key at $sourcePath.key.")
            }
        }
        val fallbackPath = "$path.fallback"
        val fallback = objectValue.required("fallback", path).objectAt(fallbackPath)
        fallback.expectKeys(setOf("type", "value"), fallbackPath)
        fallback.requireConstant("type", "placeholder", "$fallbackPath.type")
        return MosaicImageAsset(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            sourceKey = key,
            placeholder = localizedText(fallback.required("value", fallbackPath), "$fallbackPath.value"),
        )
    }

    private fun productReference(value: JsonElement, path: String): MosaicProductReference {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(
            setOf("id", "productId", "label", "badge"),
            path,
            optional = setOf("badge"),
        )
        val providerProductId = objectValue.requiredString("productId", "$path.productId").also {
            if (it.codePointLength() !in 1..256 || !providerProductIdPattern.matches(it)) {
                throw MosaicProtocolException("Invalid provider product ID at $path.productId.")
            }
        }
        return MosaicProductReference(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            providerProductId = providerProductId,
            label = localizedText(objectValue.required("label", path), "$path.label"),
            badge = objectValue.optional("badge")?.let { localizedText(it, "$path.badge") },
        )
    }

    private fun scrollContainer(value: JsonElement, path: String): MosaicScrollContainer {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(
            setOf("type", "id", "axis", "safeArea", "showsIndicators", "background", "content"),
            path,
            optional = setOf("background"),
        )
        objectValue.requireConstant("type", "scrollContainer", "$path.type")
        objectValue.requireConstant("axis", "vertical", "$path.axis")
        objectValue.requireConstant("safeArea", "respect", "$path.safeArea")
        return MosaicScrollContainer(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            showsIndicators = objectValue.requiredBoolean("showsIndicators", "$path.showsIndicators"),
            background = objectValue.optional("background")?.let { color(it, "$path.background") },
            content = stack(objectValue.required("content", path), "$path.content"),
        )
    }

    private fun stack(value: JsonElement, path: String): MosaicStack {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(
            setOf(
                "type", "id", "direction", "gap", "padding", "mainAxisDistribution",
                "crossAxisAlignment", "appearance", "sizing", "outerInsets", "visibility",
                "children",
            ),
            path,
            optional = setOf("appearance", "sizing", "outerInsets", "visibility"),
        )
        objectValue.requireConstant("type", "stack", "$path.type")
        val children = objectValue.required("children", path).boundedArrayAt("$path.children", 0, 500)
        return MosaicStack(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            direction = stackDirection(objectValue, "direction", "$path.direction"),
            gap = objectValue.requiredLogicalSize("gap", "$path.gap"),
            padding = edgeInsets(objectValue.required("padding", path), "$path.padding"),
            mainAxisDistribution = mainAxisDistribution(
                objectValue,
                "mainAxisDistribution",
                "$path.mainAxisDistribution",
            ),
            crossAxisAlignment = crossAxisAlignment(
                objectValue,
                "crossAxisAlignment",
                "$path.crossAxisAlignment",
            ),
            children = children.mapIndexed { index, child -> node(child, "$path.children[$index]") },
            appearance = objectValue.optional("appearance")?.let {
                containerAppearance(it, "$path.appearance")
            },
            sizing = objectValue.optional("sizing")?.let { safeBoxSizing(it, "$path.sizing") },
            outerInsets = objectValue.optional("outerInsets")?.let {
                edgeInsets(it, "$path.outerInsets")
            },
            visibility = objectValue.optional("visibility")?.let {
                visibility(it, "$path.visibility")
            } ?: MosaicVisibility.Always,
        )
    }

    private fun node(value: JsonElement, path: String): MosaicNode {
        val objectValue = value.objectAt(path)
        return when (objectValue.requiredString("type", "$path.type")) {
            "stack" -> stack(value, path)
            "text" -> textComponent(objectValue, path)
            "image" -> imageComponent(objectValue, path)
            "featureList" -> featureListComponent(objectValue, path)
            "productSelector" -> productSelectorComponent(objectValue, path)
            "purchaseButton" -> purchaseButtonComponent(objectValue, path)
            "restoreButton" -> restoreButtonComponent(objectValue, path)
            "closeButton" -> closeButtonComponent(objectValue, path)
            "legalText" -> legalTextComponent(objectValue, path)
            "carousel" -> carouselComponent(objectValue, path)
            "switch" -> switchComponent(objectValue, path)
            "countdown" -> countdownComponent(objectValue, path)
            else -> throw MosaicProtocolException("Unsupported Protocol 0.2 component at $path.type.")
        }
    }

    private fun textComponent(objectValue: JsonObject, path: String): MosaicTextComponent {
        objectValue.expectKeys(
            setOf(
                "type", "id", "value", "typography", "appearance", "sizing", "outerInsets",
                "visibility", "accessibility",
            ),
            path,
            optional = setOf("appearance", "sizing", "outerInsets", "visibility"),
        )
        return MosaicTextComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            value = localizedText(objectValue.required("value", path), "$path.value"),
            typography = typography(objectValue.required("typography", path), "$path.typography", true),
            appearance = optionalBoxAppearance(objectValue, path),
            sizing = optionalWidthSizing(objectValue, path),
            outerInsets = optionalOuterInsets(objectValue, path),
            visibility = optionalVisibility(objectValue, path),
            accessibility = textAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
        )
    }

    private fun imageComponent(objectValue: JsonObject, path: String): MosaicImageComponent {
        objectValue.expectKeys(
            setOf(
                "type", "id", "assetId", "width", "aspectRatio", "height", "contentMode",
                "appearance", "outerInsets", "visibility", "accessibility",
            ),
            path,
            optional = setOf("aspectRatio", "height", "appearance", "outerInsets", "visibility"),
        )
        val hasAspectRatio = objectValue.hasNonNull("aspectRatio")
        val hasHeight = objectValue.hasNonNull("height")
        if (hasAspectRatio == hasHeight) {
            throw MosaicProtocolException("Image must declare exactly one of aspectRatio or height at $path.")
        }
        return MosaicImageComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            assetId = objectValue.requiredIdentifier("assetId", "$path.assetId"),
            width = widthSizing(objectValue.required("width", path), "$path.width"),
            aspectRatio = if (hasAspectRatio) {
                objectValue.requiredNumber(
                    "aspectRatio", "$path.aspectRatio", BigDecimal.ZERO, BigDecimal.TEN, true,
                )
            } else {
                null
            },
            height = if (hasHeight) objectValue.requiredPositiveLogicalSize("height", "$path.height") else null,
            contentMode = imageContentMode(objectValue, "contentMode", "$path.contentMode"),
            appearance = optionalBoxAppearance(objectValue, path),
            outerInsets = optionalOuterInsets(objectValue, path),
            visibility = optionalVisibility(objectValue, path),
            accessibility = imageAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
        )
    }

    private fun featureListComponent(objectValue: JsonObject, path: String): MosaicFeatureListComponent {
        objectValue.expectKeys(
            setOf(
                "type", "id", "marker", "gap", "markerColor", "items", "typography",
                "appearance", "sizing", "outerInsets", "visibility", "accessibility",
            ),
            path,
            optional = setOf("appearance", "sizing", "outerInsets", "visibility"),
        )
        objectValue.requireConstant("marker", "checkmark", "$path.marker")
        val items = objectValue.required("items", path).boundedArrayAt("$path.items", 1, 100)
        return MosaicFeatureListComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            marker = MosaicFeatureMarker.CHECKMARK,
            gap = objectValue.requiredLogicalSize("gap", "$path.gap"),
            markerColor = color(objectValue.required("markerColor", path), "$path.markerColor"),
            items = items.mapIndexed { index, item -> featureListItem(item, "$path.items[$index]") },
            typography = typography(objectValue.required("typography", path), "$path.typography", false),
            appearance = optionalBoxAppearance(objectValue, path),
            sizing = optionalWidthSizing(objectValue, path),
            outerInsets = optionalOuterInsets(objectValue, path),
            visibility = optionalVisibility(objectValue, path),
            accessibility = controlAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
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

    private fun productSelectorComponent(
        objectValue: JsonObject,
        path: String,
    ): MosaicProductSelectorComponent {
        objectValue.expectKeys(
            setOf(
                "type", "id", "productReferenceIds", "initiallySelectedProductReferenceId",
                "direction", "gap", "cardStyles", "appearance", "sizing", "outerInsets",
                "visibility", "unavailableFallback", "accessibility",
            ),
            path,
            optional = setOf("appearance", "sizing", "outerInsets", "visibility"),
        )
        val productIds = objectValue.required("productReferenceIds", path)
            .boundedArrayAt("$path.productReferenceIds", 1, 100)
            .mapIndexed { index, element -> element.identifierAt("$path.productReferenceIds[$index]") }
        if (productIds.toSet().size != productIds.size) {
            throw MosaicProtocolException("Duplicate product references at $path.productReferenceIds.")
        }
        return MosaicProductSelectorComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            productReferenceIds = productIds,
            initiallySelectedProductReferenceId = objectValue.requiredIdentifier(
                "initiallySelectedProductReferenceId",
                "$path.initiallySelectedProductReferenceId",
            ),
            direction = stackDirection(objectValue, "direction", "$path.direction"),
            gap = objectValue.requiredLogicalSize("gap", "$path.gap"),
            cardStyles = productCardStyles(
                objectValue.required("cardStyles", path),
                "$path.cardStyles",
            ),
            appearance = optionalBoxAppearance(objectValue, path),
            sizing = optionalWidthSizing(objectValue, path),
            outerInsets = optionalOuterInsets(objectValue, path),
            visibility = optionalVisibility(objectValue, path),
            unavailableFallback = unavailableProductFallback(
                objectValue.required("unavailableFallback", path),
                "$path.unavailableFallback",
            ),
            accessibility = controlAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
        )
    }

    private fun productCardStyles(value: JsonElement, path: String): MosaicProductCardStyles {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("default", "selected"), path)
        return MosaicProductCardStyles(
            defaultStyle = productCardDefaultStyle(objectValue.required("default", path), "$path.default"),
            selected = productCardSelectedStyle(objectValue.required("selected", path), "$path.selected"),
        )
    }

    private fun productCardDefaultStyle(value: JsonElement, path: String): MosaicProductCardStyle {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(
            setOf(
                "background", "border", "cornerRadius", "padding", "contentGap",
                "contentAlignment", "productLabelColor", "runtimePriceColor", "badge",
            ),
            path,
        )
        return MosaicProductCardStyle(
            background = color(objectValue.required("background", path), "$path.background"),
            border = border(objectValue.required("border", path), "$path.border"),
            cornerRadius = objectValue.requiredLogicalSize("cornerRadius", "$path.cornerRadius"),
            padding = edgeInsets(objectValue.required("padding", path), "$path.padding"),
            contentGap = objectValue.requiredLogicalSize("contentGap", "$path.contentGap"),
            contentAlignment = productCardContentAlignment(
                objectValue,
                "contentAlignment",
                "$path.contentAlignment",
            ),
            productLabelColor = color(
                objectValue.required("productLabelColor", path),
                "$path.productLabelColor",
            ),
            runtimePriceColor = color(
                objectValue.required("runtimePriceColor", path),
                "$path.runtimePriceColor",
            ),
            badge = productCardBadgeDefaultStyle(
                objectValue.required("badge", path),
                "$path.badge",
            ),
        )
    }

    private fun productCardBadgeDefaultStyle(
        value: JsonElement,
        path: String,
    ): MosaicProductCardBadgeStyle {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(
            setOf("background", "textColor", "border", "cornerRadius", "padding"),
            path,
        )
        return MosaicProductCardBadgeStyle(
            background = color(objectValue.required("background", path), "$path.background"),
            textColor = color(objectValue.required("textColor", path), "$path.textColor"),
            border = border(objectValue.required("border", path), "$path.border"),
            cornerRadius = objectValue.requiredLogicalSize("cornerRadius", "$path.cornerRadius"),
            padding = edgeInsets(objectValue.required("padding", path), "$path.padding"),
        )
    }

    private fun productCardSelectedStyle(
        value: JsonElement,
        path: String,
    ): MosaicProductCardStyleOverride {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(
            setOf(
                "background", "border", "cornerRadius", "padding", "contentGap",
                "contentAlignment", "productLabelColor", "runtimePriceColor", "badge",
            ),
            path,
            optional = setOf(
                "background", "border", "cornerRadius", "padding", "contentGap",
                "contentAlignment", "productLabelColor", "runtimePriceColor", "badge",
            ),
        )
        return MosaicProductCardStyleOverride(
            background = objectValue.optional("background")?.let { color(it, "$path.background") },
            border = objectValue.optional("border")?.let { borderOverride(it, "$path.border") },
            cornerRadius = objectValue.optionalLogicalSize("cornerRadius", "$path.cornerRadius"),
            padding = objectValue.optional("padding")?.let {
                edgeInsetsOverride(it, "$path.padding")
            },
            contentGap = objectValue.optionalLogicalSize("contentGap", "$path.contentGap"),
            contentAlignment = objectValue.optional("contentAlignment")?.let {
                productCardContentAlignment(objectValue, "contentAlignment", "$path.contentAlignment")
            },
            productLabelColor = objectValue.optional("productLabelColor")?.let {
                color(it, "$path.productLabelColor")
            },
            runtimePriceColor = objectValue.optional("runtimePriceColor")?.let {
                color(it, "$path.runtimePriceColor")
            },
            badge = objectValue.optional("badge")?.let {
                productCardBadgeSelectedStyle(it, "$path.badge")
            },
        )
    }

    private fun productCardBadgeSelectedStyle(
        value: JsonElement,
        path: String,
    ): MosaicProductCardBadgeStyleOverride {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(
            setOf("background", "textColor", "border", "cornerRadius", "padding"),
            path,
            optional = setOf("background", "textColor", "border", "cornerRadius", "padding"),
        )
        return MosaicProductCardBadgeStyleOverride(
            background = objectValue.optional("background")?.let { color(it, "$path.background") },
            textColor = objectValue.optional("textColor")?.let { color(it, "$path.textColor") },
            border = objectValue.optional("border")?.let { borderOverride(it, "$path.border") },
            cornerRadius = objectValue.optionalLogicalSize("cornerRadius", "$path.cornerRadius"),
            padding = objectValue.optional("padding")?.let {
                edgeInsetsOverride(it, "$path.padding")
            },
        )
    }

    private fun unavailableProductFallback(
        value: JsonElement,
        path: String,
    ): MosaicUnavailableProductFallback {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("selection", "whenNoneAvailable", "message"), path)
        objectValue.requireConstant("selection", "firstAvailable", "$path.selection")
        objectValue.requireConstant(
            "whenNoneAvailable",
            "showMessageAndDisablePurchase",
            "$path.whenNoneAvailable",
        )
        return MosaicUnavailableProductFallback(
            message = localizedText(objectValue.required("message", path), "$path.message"),
        )
    }

    private fun purchaseButtonComponent(
        objectValue: JsonObject,
        path: String,
    ): MosaicPurchaseButtonComponent {
        objectValue.expectStyledButtonKeys(path, includeProgress = true)
        return MosaicPurchaseButtonComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            label = localizedText(objectValue.required("label", path), "$path.label"),
            inProgressLabel = localizedText(
                objectValue.required("inProgressLabel", path),
                "$path.inProgressLabel",
            ),
            typography = typography(objectValue.required("typography", path), "$path.typography", false),
            appearance = optionalBoxAppearance(objectValue, path),
            sizing = optionalWidthSizing(objectValue, path),
            outerInsets = optionalOuterInsets(objectValue, path),
            visibility = optionalVisibility(objectValue, path),
            action = purchaseAction(objectValue.required("action", path), "$path.action"),
            accessibility = controlAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
        )
    }

    private fun restoreButtonComponent(
        objectValue: JsonObject,
        path: String,
    ): MosaicRestoreButtonComponent {
        objectValue.expectStyledButtonKeys(path, includeProgress = true)
        return MosaicRestoreButtonComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            label = localizedText(objectValue.required("label", path), "$path.label"),
            inProgressLabel = localizedText(
                objectValue.required("inProgressLabel", path),
                "$path.inProgressLabel",
            ),
            typography = typography(objectValue.required("typography", path), "$path.typography", false),
            appearance = optionalBoxAppearance(objectValue, path),
            sizing = optionalWidthSizing(objectValue, path),
            outerInsets = optionalOuterInsets(objectValue, path),
            visibility = optionalVisibility(objectValue, path),
            action = restoreAction(objectValue.required("action", path), "$path.action"),
            accessibility = controlAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
        )
    }

    private fun closeButtonComponent(
        objectValue: JsonObject,
        path: String,
    ): MosaicCloseButtonComponent {
        objectValue.expectStyledButtonKeys(path, includeProgress = false)
        return MosaicCloseButtonComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            label = localizedText(objectValue.required("label", path), "$path.label"),
            typography = typography(objectValue.required("typography", path), "$path.typography", false),
            appearance = optionalBoxAppearance(objectValue, path),
            sizing = optionalWidthSizing(objectValue, path),
            outerInsets = optionalOuterInsets(objectValue, path),
            visibility = optionalVisibility(objectValue, path),
            action = closeAction(objectValue.required("action", path), "$path.action"),
            accessibility = controlAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
        )
    }

    private fun JsonObject.expectStyledButtonKeys(path: String, includeProgress: Boolean) {
        val required = mutableSetOf(
            "type", "id", "label", "typography", "action", "accessibility",
        )
        if (includeProgress) required += "inProgressLabel"
        expectKeys(
            required + setOf("appearance", "sizing", "outerInsets", "visibility"),
            path,
            optional = setOf("appearance", "sizing", "outerInsets", "visibility"),
        )
    }

    private fun legalTextComponent(
        objectValue: JsonObject,
        path: String,
    ): MosaicLegalTextComponent {
        objectValue.expectKeys(
            setOf(
                "type", "id", "value", "typography", "appearance", "sizing", "outerInsets",
                "visibility", "accessibility",
            ),
            path,
            optional = setOf("appearance", "sizing", "outerInsets", "visibility"),
        )
        return MosaicLegalTextComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            value = localizedText(objectValue.required("value", path), "$path.value"),
            typography = typography(objectValue.required("typography", path), "$path.typography", false),
            appearance = optionalBoxAppearance(objectValue, path),
            sizing = optionalWidthSizing(objectValue, path),
            outerInsets = optionalOuterInsets(objectValue, path),
            visibility = optionalVisibility(objectValue, path),
            accessibility = legalTextAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
        )
    }

    private fun carouselComponent(
        objectValue: JsonObject,
        path: String,
    ): MosaicCarouselComponent {
        objectValue.expectKeys(
            setOf(
                "type", "id", "initialPageIndex", "showsIndicators", "pages", "appearance",
                "sizing", "outerInsets", "visibility", "accessibility",
            ),
            path,
            optional = setOf("appearance", "sizing", "outerInsets", "visibility"),
        )
        val pages = objectValue.required("pages", path).boundedArrayAt("$path.pages", 2, 20)
            .mapIndexed { index, page -> carouselPage(page, "$path.pages[$index]") }
        return MosaicCarouselComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            initialPageIndex = objectValue.requiredIntegerInRange(
                "initialPageIndex",
                "$path.initialPageIndex",
                0..19,
            ),
            showsIndicators = objectValue.requiredBoolean("showsIndicators", "$path.showsIndicators"),
            pages = pages,
            appearance = objectValue.optional("appearance")?.let {
                containerAppearance(it, "$path.appearance")
            },
            sizing = optionalWidthSizing(objectValue, path),
            outerInsets = optionalOuterInsets(objectValue, path),
            visibility = optionalVisibility(objectValue, path),
            accessibility = controlAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
        )
    }

    private fun carouselPage(value: JsonElement, path: String): MosaicCarouselPage {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("id", "accessibilityLabel", "content"), path)
        return MosaicCarouselPage(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            accessibilityLabel = localizedText(
                objectValue.required("accessibilityLabel", path),
                "$path.accessibilityLabel",
            ),
            content = stack(objectValue.required("content", path), "$path.content"),
        )
    }

    private fun switchComponent(
        objectValue: JsonObject,
        path: String,
    ): MosaicSwitchComponent {
        objectValue.expectKeys(
            setOf(
                "type", "id", "label", "initialValue", "typography", "offTrackColor",
                "onTrackColor", "thumbColor", "appearance", "outerInsets", "visibility",
                "accessibility",
            ),
            path,
            optional = setOf("appearance", "outerInsets", "visibility"),
        )
        return MosaicSwitchComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            label = localizedText(objectValue.required("label", path), "$path.label"),
            initialValue = objectValue.requiredBoolean("initialValue", "$path.initialValue"),
            typography = typography(objectValue.required("typography", path), "$path.typography", false),
            offTrackColor = color(objectValue.required("offTrackColor", path), "$path.offTrackColor"),
            onTrackColor = color(objectValue.required("onTrackColor", path), "$path.onTrackColor"),
            thumbColor = color(objectValue.required("thumbColor", path), "$path.thumbColor"),
            appearance = optionalBoxAppearance(objectValue, path),
            outerInsets = optionalOuterInsets(objectValue, path),
            visibility = optionalVisibility(objectValue, path),
            accessibility = controlAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
        )
    }

    private fun countdownComponent(
        objectValue: JsonObject,
        path: String,
    ): MosaicCountdownComponent {
        objectValue.expectKeys(
            setOf(
                "type", "id", "endsAt", "largestUnit", "smallestUnit", "completedText",
                "typography", "appearance", "sizing", "outerInsets", "visibility", "accessibility",
            ),
            path,
            optional = setOf("appearance", "sizing", "outerInsets", "visibility"),
        )
        val endsAt = objectValue.requiredString("endsAt", "$path.endsAt")
        val endsAtEpochMillis = parseCanonicalUtcTimestamp(endsAt, "$path.endsAt")
        return MosaicCountdownComponent(
            id = objectValue.requiredIdentifier("id", "$path.id"),
            endsAt = endsAt,
            endsAtEpochMillis = endsAtEpochMillis,
            largestUnit = countdownUnit(objectValue, "largestUnit", "$path.largestUnit"),
            smallestUnit = countdownUnit(objectValue, "smallestUnit", "$path.smallestUnit"),
            completedText = localizedText(
                objectValue.required("completedText", path),
                "$path.completedText",
            ),
            typography = typography(objectValue.required("typography", path), "$path.typography", false),
            appearance = optionalBoxAppearance(objectValue, path),
            sizing = optionalWidthSizing(objectValue, path),
            outerInsets = optionalOuterInsets(objectValue, path),
            visibility = optionalVisibility(objectValue, path),
            accessibility = textAccessibility(
                objectValue.required("accessibility", path),
                "$path.accessibility",
            ),
        )
    }

    private fun typography(
        value: JsonElement,
        path: String,
        supportsOverflow: Boolean,
    ): MosaicTypography {
        val objectValue = value.objectAt(path)
        val common = setOf(
            "style", "fontSize", "lineHeightMultiplier", "weight", "color", "alignment",
        )
        val expected = if (supportsOverflow) common + setOf("maxLines", "overflow") else common
        val optional = if (supportsOverflow) setOf("maxLines", "overflow") else emptySet()
        objectValue.expectKeys(expected, path, optional)
        val hasMaxLines = objectValue.hasNonNull("maxLines")
        val hasOverflow = objectValue.hasNonNull("overflow")
        if (hasMaxLines != hasOverflow) {
            throw MosaicProtocolException("maxLines and overflow must be declared together at $path.")
        }
        return MosaicTypography(
            style = typographyStyle(objectValue, "style", "$path.style"),
            fontSize = objectValue.requiredNumber(
                "fontSize", "$path.fontSize", BigDecimal("8"), BigDecimal("96"),
            ),
            lineHeightMultiplier = objectValue.requiredNumber(
                "lineHeightMultiplier",
                "$path.lineHeightMultiplier",
                BigDecimal("0.8"),
                BigDecimal("3"),
            ),
            weight = fontWeight(objectValue, "weight", "$path.weight"),
            color = color(objectValue.required("color", path), "$path.color"),
            alignment = textAlignment(objectValue, "alignment", "$path.alignment"),
            maxLines = if (hasMaxLines) {
                objectValue.requiredIntegerInRange("maxLines", "$path.maxLines", 1..100)
            } else {
                null
            },
            overflow = if (hasOverflow) {
                textOverflow(objectValue, "overflow", "$path.overflow")
            } else {
                null
            },
        )
    }

    private fun boxAppearance(value: JsonElement, path: String): MosaicBoxAppearance {
        val objectValue = value.objectAt(path)
        if (objectValue.size() == 0) throw MosaicProtocolException("Empty appearance at $path.")
        objectValue.expectKeys(
            setOf("background", "border", "cornerRadius", "opacity", "padding"),
            path,
            optional = setOf("background", "border", "cornerRadius", "opacity", "padding"),
        )
        return MosaicBoxAppearance(
            background = objectValue.optional("background")?.let { color(it, "$path.background") },
            border = objectValue.optional("border")?.let { border(it, "$path.border") },
            cornerRadius = objectValue.optionalLogicalSize("cornerRadius", "$path.cornerRadius"),
            opacity = objectValue.optionalNumber(
                "opacity", "$path.opacity", BigDecimal.ZERO, BigDecimal.ONE,
            ),
            padding = objectValue.optional("padding")?.let { edgeInsets(it, "$path.padding") },
        )
    }

    private fun containerAppearance(value: JsonElement, path: String): MosaicBoxAppearance {
        val objectValue = value.objectAt(path)
        if (objectValue.size() == 0) throw MosaicProtocolException("Empty appearance at $path.")
        objectValue.expectKeys(
            setOf("background", "border", "cornerRadius", "opacity", "clipContent"),
            path,
            optional = setOf("background", "border", "cornerRadius", "opacity", "clipContent"),
        )
        return MosaicBoxAppearance(
            background = objectValue.optional("background")?.let { color(it, "$path.background") },
            border = objectValue.optional("border")?.let { border(it, "$path.border") },
            cornerRadius = objectValue.optionalLogicalSize("cornerRadius", "$path.cornerRadius"),
            opacity = objectValue.optionalNumber(
                "opacity", "$path.opacity", BigDecimal.ZERO, BigDecimal.ONE,
            ),
            clipContent = objectValue.optionalBoolean("clipContent", "$path.clipContent"),
        )
    }

    private fun border(value: JsonElement, path: String): MosaicBorder {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("color", "width"), path)
        return MosaicBorder(
            color = color(objectValue.required("color", path), "$path.color"),
            width = objectValue.requiredLogicalSize("width", "$path.width"),
        )
    }

    private fun borderOverride(value: JsonElement, path: String): MosaicBorderOverride {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(
            setOf("color", "width"),
            path,
            optional = setOf("color", "width"),
        )
        return MosaicBorderOverride(
            color = objectValue.optional("color")?.let { color(it, "$path.color") },
            width = objectValue.optionalLogicalSize("width", "$path.width"),
        )
    }

    private fun edgeInsets(value: JsonElement, path: String): MosaicEdgeInsets {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("top", "start", "bottom", "end"), path)
        return MosaicEdgeInsets(
            top = objectValue.requiredLogicalSize("top", "$path.top"),
            start = objectValue.requiredLogicalSize("start", "$path.start"),
            bottom = objectValue.requiredLogicalSize("bottom", "$path.bottom"),
            end = objectValue.requiredLogicalSize("end", "$path.end"),
        )
    }

    private fun edgeInsetsOverride(value: JsonElement, path: String): MosaicEdgeInsetsOverride {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(
            setOf("top", "start", "bottom", "end"),
            path,
            optional = setOf("top", "start", "bottom", "end"),
        )
        return MosaicEdgeInsetsOverride(
            top = objectValue.optionalLogicalSize("top", "$path.top"),
            start = objectValue.optionalLogicalSize("start", "$path.start"),
            bottom = objectValue.optionalLogicalSize("bottom", "$path.bottom"),
            end = objectValue.optionalLogicalSize("end", "$path.end"),
        )
    }

    private fun widthOnlySizing(value: JsonElement, path: String): MosaicBoxSizing {
        val objectValue = value.objectAt(path)
        if (objectValue.size() == 0) throw MosaicProtocolException("Empty sizing at $path.")
        objectValue.expectKeys(setOf("width"), path, optional = setOf("width"))
        return MosaicBoxSizing(
            width = objectValue.optional("width")?.let { widthSizing(it, "$path.width") },
        )
    }

    private fun safeBoxSizing(value: JsonElement, path: String): MosaicBoxSizing {
        val objectValue = value.objectAt(path)
        if (objectValue.size() == 0) throw MosaicProtocolException("Empty sizing at $path.")
        objectValue.expectKeys(
            setOf("width", "height"),
            path,
            optional = setOf("width", "height"),
        )
        return MosaicBoxSizing(
            width = objectValue.optional("width")?.let { widthSizing(it, "$path.width") },
            height = objectValue.optional("height")?.let { heightSizing(it, "$path.height") },
        )
    }

    private fun widthSizing(value: JsonElement, path: String): MosaicWidthSizing {
        if (value.isJsonPrimitive && value.asJsonPrimitive.isString) {
            return when (value.asString) {
                "content" -> MosaicWidthSizing.Content
                "fill" -> MosaicWidthSizing.Fill
                else -> throw MosaicProtocolException("Invalid width sizing at $path.")
            }
        }
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("mode", "value"), path)
        objectValue.requireConstant("mode", "fixed", "$path.mode")
        return MosaicWidthSizing.Fixed(
            objectValue.requiredPositiveLogicalSize("value", "$path.value"),
        )
    }

    private fun heightSizing(value: JsonElement, path: String): MosaicHeightSizing {
        if (value.isJsonPrimitive && value.asJsonPrimitive.isString) {
            if (value.asString == "content") return MosaicHeightSizing.Content
            throw MosaicProtocolException("Invalid height sizing at $path.")
        }
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("mode", "value"), path)
        objectValue.requireConstant("mode", "fixed", "$path.mode")
        return MosaicHeightSizing.Fixed(
            objectValue.requiredPositiveLogicalSize("value", "$path.value"),
        )
    }

    private fun visibility(value: JsonElement, path: String): MosaicVisibility {
        val objectValue = value.objectAt(path)
        return when (objectValue.requiredString("mode", "$path.mode")) {
            "always" -> {
                objectValue.expectKeys(setOf("mode"), path)
                MosaicVisibility.Always
            }
            "hidden" -> {
                objectValue.expectKeys(setOf("mode"), path)
                MosaicVisibility.Hidden
            }
            "switch" -> {
                objectValue.expectKeys(setOf("mode", "switchId", "equals"), path)
                MosaicVisibility.SwitchValue(
                    switchId = objectValue.requiredIdentifier("switchId", "$path.switchId"),
                    equals = objectValue.requiredBoolean("equals", "$path.equals"),
                )
            }
            else -> throw MosaicProtocolException("Invalid visibility mode at $path.mode.")
        }
    }

    private fun color(value: JsonElement, path: String): MosaicColor {
        val raw = value.stringAt(path, 1, 64)
        val semantic = MosaicSemanticColor.entries.any { it.wireName == raw }
        if (!semantic && !literalColorPattern.matches(raw)) {
            throw MosaicProtocolException("Invalid or noncanonical color at $path.")
        }
        return MosaicColor(raw)
    }

    private fun localizedText(value: JsonElement, path: String): MosaicLocalizedText {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("default", "localizationKey"), path)
        return MosaicLocalizedText(
            defaultValue = objectValue.requiredString("default", "$path.default").also {
                if (it.codePointLength() !in 1..5000) {
                    throw MosaicProtocolException("Invalid localized default length at $path.default.")
                }
            },
            localizationKey = objectValue.requiredLocalizationKey(
                "localizationKey",
                "$path.localizationKey",
            ),
        )
    }

    private fun textAccessibility(value: JsonElement, path: String): MosaicTextAccessibility {
        val objectValue = value.objectAt(path)
        return when (objectValue.requiredString("role", "$path.role")) {
            "text" -> {
                objectValue.expectKeys(
                    setOf("role", "label"),
                    path,
                    optional = setOf("label"),
                )
                objectValue.optional("label")?.let {
                    MosaicTextAccessibility.LabelledText(localizedText(it, "$path.label"))
                } ?: MosaicTextAccessibility.Text
            }
            "heading" -> {
                objectValue.expectKeys(
                    setOf("role", "level", "label"),
                    path,
                    optional = setOf("label"),
                )
                val level = objectValue.requiredIntegerInRange("level", "$path.level", 1..6)
                objectValue.optional("label")?.let {
                    MosaicTextAccessibility.LabelledHeading(
                        level,
                        localizedText(it, "$path.label"),
                    )
                } ?: MosaicTextAccessibility.Heading(level)
            }
            else -> throw MosaicProtocolException("Invalid text accessibility role at $path.role.")
        }
    }

    private fun legalTextAccessibility(value: JsonElement, path: String): MosaicTextAccessibility {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("role", "label"), path, optional = setOf("label"))
        objectValue.requireConstant("role", "text", "$path.role")
        return objectValue.optional("label")?.let {
            MosaicTextAccessibility.LabelledText(localizedText(it, "$path.label"))
        } ?: MosaicTextAccessibility.Text
    }

    private fun imageAccessibility(value: JsonElement, path: String): MosaicImageAccessibility {
        val objectValue = value.objectAt(path)
        val hidden = objectValue.requiredBoolean("hidden", "$path.hidden")
        return if (hidden) {
            objectValue.expectKeys(setOf("hidden"), path)
            MosaicImageAccessibility.Decorative
        } else {
            objectValue.expectKeys(setOf("hidden", "label"), path)
            MosaicImageAccessibility.Informative(
                localizedText(objectValue.required("label", path), "$path.label"),
            )
        }
    }

    private fun controlAccessibility(value: JsonElement, path: String): MosaicControlAccessibility {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("label", "hint"), path, optional = setOf("hint"))
        return MosaicControlAccessibility(
            label = localizedText(objectValue.required("label", path), "$path.label"),
            hint = objectValue.optional("hint")?.let { localizedText(it, "$path.hint") },
        )
    }

    private fun purchaseAction(value: JsonElement, path: String): MosaicPurchaseAction {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("type", "productSelectorId"), path)
        objectValue.requireConstant("type", "purchase", "$path.type")
        return MosaicPurchaseAction(
            objectValue.requiredIdentifier("productSelectorId", "$path.productSelectorId"),
        )
    }

    private fun restoreAction(value: JsonElement, path: String): MosaicRestoreAction {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("type"), path)
        objectValue.requireConstant("type", "restore", "$path.type")
        return MosaicRestoreAction
    }

    private fun closeAction(value: JsonElement, path: String): MosaicCloseAction {
        val objectValue = value.objectAt(path)
        objectValue.expectKeys(setOf("type"), path)
        objectValue.requireConstant("type", "close", "$path.type")
        return MosaicCloseAction
    }

    private fun optionalBoxAppearance(objectValue: JsonObject, path: String): MosaicBoxAppearance? =
        objectValue.optional("appearance")?.let { boxAppearance(it, "$path.appearance") }

    private fun optionalWidthSizing(objectValue: JsonObject, path: String): MosaicBoxSizing? =
        objectValue.optional("sizing")?.let { widthOnlySizing(it, "$path.sizing") }

    private fun optionalOuterInsets(objectValue: JsonObject, path: String): MosaicEdgeInsets? =
        objectValue.optional("outerInsets")?.let { edgeInsets(it, "$path.outerInsets") }

    private fun optionalVisibility(objectValue: JsonObject, path: String): MosaicVisibility =
        objectValue.optional("visibility")?.let { visibility(it, "$path.visibility") }
            ?: MosaicVisibility.Always

    private fun validateDocumentSemantics(
        document: MosaicPaywallDocument,
        root: JsonObject,
        capabilityReport: MosaicCapabilityReport,
    ) {
        if (document.localization.defaultLocale !in document.localization.locales) {
            throw MosaicProtocolException("The default locale is not declared.")
        }
        if (document.localization.fallbackLocale !in document.localization.locales) {
            throw MosaicProtocolException("The fallback locale is not declared.")
        }
        if (document.layout.content.direction != MosaicStackDirection.VERTICAL) {
            throw MosaicProtocolException("Root scroll content must be a vertical stack.")
        }
        if (document.layout.content.children.isEmpty()) {
            throw MosaicProtocolException("Root scroll content must contain at least one child.")
        }

        val nodes = document.layout.content.walkDepthFirst().toList()
        val pages = nodes.filterIsInstance<MosaicCarouselComponent>().flatMap { it.pages }
        requireUnique(
            listOf(document.layout.id) + nodes.map(MosaicNode::id) + pages.map(MosaicCarouselPage::id),
            "layout/component/page IDs",
        )
        nodes.filterIsInstance<MosaicFeatureListComponent>().forEach { featureList ->
            requireUnique(featureList.items.map(MosaicFeatureListItem::id), "feature IDs in ${featureList.id}")
        }
        requireUnique(document.assets.map(MosaicImageAsset::id), "asset IDs")
        requireUnique(document.products.map(MosaicProductReference::id), "product reference IDs")
        requireUnique(document.products.map(MosaicProductReference::providerProductId), "provider product IDs")

        validateAssetReferences(document, nodes)
        validateProductReferences(document, nodes)
        validateLocalizationSemantics(document, nodes)
        validateRuntimeSemantics(document.layout.content, nodes)

        val derived = deriveCapabilities(document, root)
        val declared = document.compatibility.requiredCapabilities.map(MosaicRequiredCapability::name).toSet()
        if (declared != derived) {
            val missing = derived - declared
            val unused = declared - derived
            throw MosaicProtocolException(
                "Capability declarations do not match document content " +
                    "(missing=${missing.map { it.wireName }.sorted()}, " +
                    "unused=${unused.map { it.wireName }.sorted()}).",
            )
        }
        document.compatibility.requiredCapabilities.forEach { required ->
            if (!capabilityReport.supports(required)) {
                throw MosaicProtocolException(
                    "The Android SDK does not support ${required.name.wireName}@${required.version}.",
                )
            }
        }
    }

    private fun validateAssetReferences(
        document: MosaicPaywallDocument,
        nodes: List<MosaicNode>,
    ) {
        val assetsById = document.assets.associateBy(MosaicImageAsset::id)
        val used = nodes.filterIsInstance<MosaicImageComponent>().map { image ->
            if (image.assetId !in assetsById) {
                throw MosaicProtocolException("Image ${image.id} references an unknown asset.")
            }
            image.assetId
        }.toSet()
        if (used != assetsById.keys) {
            throw MosaicProtocolException("Asset declarations must be used exactly by the document.")
        }
    }

    private fun validateProductReferences(
        document: MosaicPaywallDocument,
        nodes: List<MosaicNode>,
    ) {
        val productsById = document.products.associateBy(MosaicProductReference::id)
        val selectors = nodes.filterIsInstance<MosaicProductSelectorComponent>()
        val usedProductIds = mutableSetOf<String>()
        selectors.forEach { selector ->
            requireUnique(selector.productReferenceIds, "product references in ${selector.id}")
            selector.productReferenceIds.forEach { referenceId ->
                if (referenceId !in productsById) {
                    throw MosaicProtocolException(
                        "Product selector ${selector.id} references an unknown product.",
                    )
                }
                usedProductIds += referenceId
            }
            if (selector.initiallySelectedProductReferenceId !in selector.productReferenceIds) {
                throw MosaicProtocolException(
                    "Product selector ${selector.id} initially selects an undeclared product.",
                )
            }
        }
        if (usedProductIds != productsById.keys) {
            throw MosaicProtocolException("Product declarations must be used exactly by the document.")
        }
        val selectorsById = selectors.associateBy(MosaicProductSelectorComponent::id)
        val purchases = nodes.filterIsInstance<MosaicPurchaseButtonComponent>()
        purchases.forEach { button ->
            if (button.action.productSelectorId !in selectorsById) {
                throw MosaicProtocolException(
                    "Purchase button ${button.id} references an unknown product selector.",
                )
            }
        }
        selectors.forEach { selector ->
            if (purchases.none { it.action.productSelectorId == selector.id }) {
                throw MosaicProtocolException("Product selector ${selector.id} has no purchase action.")
            }
        }
    }

    private fun validateLocalizationSemantics(
        document: MosaicPaywallDocument,
        nodes: List<MosaicNode>,
    ) {
        val values = buildList {
            document.assets.forEach { add(it.placeholder) }
            document.products.forEach { product ->
                add(product.label)
                product.badge?.let(::add)
            }
            nodes.forEach { node ->
                when (node) {
                    is MosaicStack -> Unit
                    is MosaicTextComponent -> {
                        add(node.value)
                        node.accessibility.labelOrNull?.let(::add)
                    }
                    is MosaicImageComponent -> {
                        val accessibility = node.accessibility
                        if (accessibility is MosaicImageAccessibility.Informative) add(accessibility.label)
                    }
                    is MosaicFeatureListComponent -> {
                        node.items.forEach { add(it.text) }
                        addControlAccessibility(node.accessibility)
                    }
                    is MosaicProductSelectorComponent -> {
                        add(node.unavailableFallback.message)
                        addControlAccessibility(node.accessibility)
                    }
                    is MosaicPurchaseButtonComponent -> {
                        add(node.label)
                        add(node.inProgressLabel)
                        addControlAccessibility(node.accessibility)
                    }
                    is MosaicRestoreButtonComponent -> {
                        add(node.label)
                        add(node.inProgressLabel)
                        addControlAccessibility(node.accessibility)
                    }
                    is MosaicCloseButtonComponent -> {
                        add(node.label)
                        addControlAccessibility(node.accessibility)
                    }
                    is MosaicLegalTextComponent -> {
                        add(node.value)
                        node.accessibility.labelOrNull?.let(::add)
                    }
                    is MosaicCarouselComponent -> {
                        addControlAccessibility(node.accessibility)
                        node.pages.forEach { add(it.accessibilityLabel) }
                    }
                    is MosaicSwitchComponent -> {
                        add(node.label)
                        addControlAccessibility(node.accessibility)
                    }
                    is MosaicCountdownComponent -> {
                        add(node.completedText)
                        node.accessibility.labelOrNull?.let(::add)
                    }
                }
            }
        }
        val defaultStrings = checkNotNull(
            document.localization.locales[document.localization.defaultLocale],
        ).strings
        val referencedKeys = values.map(MosaicLocalizedText::localizationKey).toSet()
        if (defaultStrings.keys != referencedKeys) {
            throw MosaicProtocolException(
                "Default locale keys must exactly match the document's localized values.",
            )
        }
        values.forEach { value ->
            if (defaultStrings[value.localizationKey] != value.defaultValue) {
                throw MosaicProtocolException("Inline defaults must equal the default locale catalog.")
            }
        }
        document.localization.locales.forEach { (tag, catalog) ->
            if (!defaultStrings.keys.containsAll(catalog.strings.keys)) {
                throw MosaicProtocolException("Locale $tag declares a key absent from the default locale.")
            }
        }
    }

    private fun MutableList<MosaicLocalizedText>.addControlAccessibility(
        accessibility: MosaicControlAccessibility,
    ) {
        add(accessibility.label)
        accessibility.hint?.let(::add)
    }

    private fun validateRuntimeSemantics(root: MosaicStack, nodes: List<MosaicNode>) {
        val switches = nodes.filterIsInstance<MosaicSwitchComponent>().associateBy(MosaicSwitchComponent::id)
        nodes.forEach { node ->
            val nodeVisibility = node.visibilityOrAlways()
            if (nodeVisibility is MosaicVisibility.SwitchValue) {
                if (nodeVisibility.switchId !in switches) {
                    throw MosaicProtocolException(
                        "${node.type} ${node.id} visibility references an unknown switch.",
                    )
                }
                if (nodeVisibility.switchId == node.id) {
                    throw MosaicProtocolException("${node.type} ${node.id} visibility references itself.")
                }
            }
            when (node) {
                is MosaicCarouselComponent -> {
                    if (node.initialPageIndex !in node.pages.indices) {
                        throw MosaicProtocolException(
                            "Carousel ${node.id} initialPageIndex must reference an existing page.",
                        )
                    }
                }
                is MosaicCountdownComponent -> {
                    if (node.largestUnit.rank < node.smallestUnit.rank) {
                        throw MosaicProtocolException(
                            "Countdown ${node.id} largestUnit must not be smaller than smallestUnit.",
                        )
                    }
                }
                else -> Unit
            }
        }
        validateNoNestedCarousel(root, insideCarousel = false)
    }

    private fun validateNoNestedCarousel(stack: MosaicStack, insideCarousel: Boolean) {
        stack.children.forEach { child ->
            when (child) {
                is MosaicStack -> validateNoNestedCarousel(child, insideCarousel)
                is MosaicCarouselComponent -> {
                    if (insideCarousel) {
                        throw MosaicProtocolException("Carousel ${child.id} cannot be nested in a carousel.")
                    }
                    child.pages.forEach { validateNoNestedCarousel(it.content, insideCarousel = true) }
                }
                else -> Unit
            }
        }
    }

    private fun MosaicNode.visibilityOrAlways(): MosaicVisibility = when (this) {
        is MosaicStack -> visibility
        is MosaicTextComponent -> visibility
        is MosaicImageComponent -> visibility
        is MosaicFeatureListComponent -> visibility
        is MosaicProductSelectorComponent -> visibility
        is MosaicPurchaseButtonComponent -> visibility
        is MosaicRestoreButtonComponent -> visibility
        is MosaicCloseButtonComponent -> visibility
        is MosaicLegalTextComponent -> visibility
        is MosaicCarouselComponent -> visibility
        is MosaicSwitchComponent -> visibility
        is MosaicCountdownComponent -> visibility
    }

    private fun deriveCapabilities(
        document: MosaicPaywallDocument,
        root: JsonObject,
    ): Set<MosaicCapabilityName> = buildSet {
        add(MosaicCapabilityName.LOCALIZATION_CATALOGS)
        if (document.localization.locales.values.any { it.direction == MosaicLayoutDirection.RTL }) {
            add(MosaicCapabilityName.LOCALIZATION_RTL)
        }
        if (document.products.isNotEmpty()) add(MosaicCapabilityName.PRODUCT_REFERENCES)
        if (document.assets.isNotEmpty()) {
            add(MosaicCapabilityName.BUNDLED_IMAGE)
            add(MosaicCapabilityName.ASSET_FALLBACK)
        }
        walkRawNodes(root.getAsJsonObject("layout")).forEach { node ->
            when (node.requiredString("type", "$.layout.type")) {
                "scrollContainer" -> add(MosaicCapabilityName.SCROLL_CONTAINER)
                "stack" -> add(MosaicCapabilityName.STACK)
                "text" -> add(MosaicCapabilityName.TEXT)
                "image" -> add(MosaicCapabilityName.IMAGE)
                "featureList" -> add(MosaicCapabilityName.FEATURE_LIST)
                "productSelector" -> add(MosaicCapabilityName.PRODUCT_SELECTOR)
                "purchaseButton" -> add(MosaicCapabilityName.PURCHASE_BUTTON)
                "restoreButton" -> add(MosaicCapabilityName.RESTORE_BUTTON)
                "closeButton" -> add(MosaicCapabilityName.CLOSE_BUTTON)
                "legalText" -> add(MosaicCapabilityName.LEGAL_TEXT)
                "carousel" -> add(MosaicCapabilityName.CAROUSEL)
                "switch" -> add(MosaicCapabilityName.SWITCH)
                "countdown" -> add(MosaicCapabilityName.COUNTDOWN)
            }
            val type = node.get("type")?.asString
            if (node.hasNonNull("accessibility") || type == "carousel") {
                add(MosaicCapabilityName.ACCESSIBILITY_METADATA)
            }
            if (node.hasNonNull("typography")) add(MosaicCapabilityName.TYPOGRAPHY)
            if (node.hasNonNull("appearance") ||
                node.hasNonNull("cardStyles") ||
                node.hasNonNull("padding") ||
                (type == "scrollContainer" && node.hasNonNull("background"))
            ) {
                add(MosaicCapabilityName.BOX_STYLE)
            }
            if (node.hasNonNull("sizing") || type == "image") add(MosaicCapabilityName.SIZING)
            if (node.hasNonNull("outerInsets")) add(MosaicCapabilityName.OUTER_INSETS)
            if (node.getAsJsonObjectOrNull("appearance")?.has("clipContent") == true) {
                add(MosaicCapabilityName.CLIPPING)
            }
            node.getAsJsonObjectOrNull("visibility")?.let { visibility ->
                if (visibility.get("mode")?.asString == "switch") {
                    add(MosaicCapabilityName.SWITCH_VISIBILITY)
                } else {
                    add(MosaicCapabilityName.STATIC_VISIBILITY)
                }
            }
            if (objectUsesColor(node)) add(MosaicCapabilityName.COLORS)
            if (type == "productSelector") {
                add(MosaicCapabilityName.PRODUCT_FALLBACK)
                add(MosaicCapabilityName.NORMALIZED_OUTCOME)
                add(MosaicCapabilityName.PRODUCT_CARD_STATES)
            }
            node.getAsJsonObjectOrNull("action")?.get("type")?.asString?.let { action ->
                when (action) {
                    "purchase" -> add(MosaicCapabilityName.PURCHASE_ACTION)
                    "restore" -> add(MosaicCapabilityName.RESTORE_ACTION)
                    "close" -> add(MosaicCapabilityName.CLOSE_ACTION)
                }
                add(MosaicCapabilityName.NORMALIZED_OUTCOME)
            }
        }
    }

    private fun walkRawNodes(root: JsonObject): Sequence<JsonObject> = sequence {
        yield(root)
        when (root.get("type")?.asString) {
            "scrollContainer" -> yieldAll(walkRawNodes(root.getAsJsonObject("content")))
            "stack" -> root.getAsJsonArray("children").forEach { child ->
                yieldAll(walkRawNodes(child.asJsonObject))
            }
            "carousel" -> root.getAsJsonArray("pages").forEach { page ->
                yieldAll(walkRawNodes(page.asJsonObject.getAsJsonObject("content")))
            }
        }
    }

    private val colorFieldNames = setOf(
        "background", "color", "markerColor", "offTrackColor", "onTrackColor",
        "productLabelColor", "runtimePriceColor", "textColor", "thumbColor",
    )

    private fun objectUsesColor(value: JsonElement): Boolean = when {
        value.isJsonArray -> value.asJsonArray.any(::objectUsesColor)
        value.isJsonObject -> value.asJsonObject.entrySet().any { (key, entry) ->
            (key in colorFieldNames && entry.isJsonPrimitive && entry.asJsonPrimitive.isString) ||
                objectUsesColor(entry)
        }
        else -> false
    }

    private fun stackDirection(objectValue: JsonObject, name: String, path: String) =
        when (objectValue.requiredString(name, path)) {
            "vertical" -> MosaicStackDirection.VERTICAL
            "horizontal" -> MosaicStackDirection.HORIZONTAL
            else -> throw MosaicProtocolException("Invalid stack direction at $path.")
        }

    private fun mainAxisDistribution(objectValue: JsonObject, name: String, path: String) =
        when (objectValue.requiredString(name, path)) {
            "start" -> MosaicMainAxisDistribution.START
            "center" -> MosaicMainAxisDistribution.CENTER
            "end" -> MosaicMainAxisDistribution.END
            "spaceBetween" -> MosaicMainAxisDistribution.SPACE_BETWEEN
            else -> throw MosaicProtocolException("Invalid main-axis distribution at $path.")
        }

    private fun crossAxisAlignment(objectValue: JsonObject, name: String, path: String) =
        when (objectValue.requiredString(name, path)) {
            "start" -> MosaicHorizontalAlignment.START
            "center" -> MosaicHorizontalAlignment.CENTER
            "end" -> MosaicHorizontalAlignment.END
            "stretch" -> MosaicHorizontalAlignment.STRETCH
            else -> throw MosaicProtocolException("Invalid cross-axis alignment at $path.")
        }

    private fun textAlignment(objectValue: JsonObject, name: String, path: String) =
        when (objectValue.requiredString(name, path)) {
            "start" -> MosaicTextAlignment.START
            "center" -> MosaicTextAlignment.CENTER
            "end" -> MosaicTextAlignment.END
            else -> throw MosaicProtocolException("Invalid text alignment at $path.")
        }

    private fun typographyStyle(objectValue: JsonObject, name: String, path: String) =
        when (objectValue.requiredString(name, path)) {
            "display" -> MosaicTypographyStyle.DISPLAY
            "title" -> MosaicTypographyStyle.TITLE
            "heading" -> MosaicTypographyStyle.HEADING
            "body" -> MosaicTypographyStyle.BODY
            "label" -> MosaicTypographyStyle.LABEL
            "caption" -> MosaicTypographyStyle.CAPTION
            else -> throw MosaicProtocolException("Invalid typography style at $path.")
        }

    private fun fontWeight(objectValue: JsonObject, name: String, path: String) =
        when (objectValue.requiredString(name, path)) {
            "regular" -> MosaicFontWeight.REGULAR
            "medium" -> MosaicFontWeight.MEDIUM
            "semibold" -> MosaicFontWeight.SEMIBOLD
            "bold" -> MosaicFontWeight.BOLD
            else -> throw MosaicProtocolException("Invalid font weight at $path.")
        }

    private fun textOverflow(objectValue: JsonObject, name: String, path: String) =
        when (objectValue.requiredString(name, path)) {
            "clip" -> MosaicTextOverflow.CLIP
            "ellipsis" -> MosaicTextOverflow.ELLIPSIS
            else -> throw MosaicProtocolException("Invalid text overflow at $path.")
        }

    private fun imageContentMode(objectValue: JsonObject, name: String, path: String) =
        when (objectValue.requiredString(name, path)) {
            "fit" -> MosaicImageContentMode.FIT
            "fill" -> MosaicImageContentMode.FILL
            else -> throw MosaicProtocolException("Invalid image content mode at $path.")
        }

    private fun productCardContentAlignment(
        objectValue: JsonObject,
        name: String,
        path: String,
    ) = when (objectValue.requiredString(name, path)) {
        "start" -> MosaicProductCardContentAlignment.START
        "center" -> MosaicProductCardContentAlignment.CENTER
        "end" -> MosaicProductCardContentAlignment.END
        "spaceBetween" -> MosaicProductCardContentAlignment.SPACE_BETWEEN
        else -> throw MosaicProtocolException("Invalid product-card alignment at $path.")
    }

    private fun countdownUnit(objectValue: JsonObject, name: String, path: String) =
        when (objectValue.requiredString(name, path)) {
            "day" -> MosaicCountdownUnit.DAY
            "hour" -> MosaicCountdownUnit.HOUR
            "minute" -> MosaicCountdownUnit.MINUTE
            "second" -> MosaicCountdownUnit.SECOND
            else -> throw MosaicProtocolException("Invalid countdown unit at $path.")
        }

    private fun parseCanonicalUtcTimestamp(value: String, path: String): Long {
        if (!utcTimestampPattern.matches(value)) {
            throw MosaicProtocolException("Countdown timestamp is not canonical UTC at $path.")
        }
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT).apply {
            isLenient = false
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val parsed = runCatching { format.parse(value) }.getOrNull()
            ?: throw MosaicProtocolException("Countdown timestamp is invalid at $path.")
        if (format.format(parsed) != value) {
            throw MosaicProtocolException("Countdown timestamp is not canonical UTC at $path.")
        }
        return parsed.time
    }

    private fun requireUnique(values: List<String>, description: String) {
        if (values.toSet().size != values.size) {
            throw MosaicProtocolException("Duplicate $description are not allowed.")
        }
    }

    private fun JsonObject.required(name: String, path: String): JsonElement = get(name)
        ?.takeUnless { it is JsonNull }
        ?: throw MosaicProtocolException("Missing property $name at $path.")

    private fun JsonObject.optional(name: String): JsonElement? = get(name)?.takeUnless { it is JsonNull }

    private fun JsonObject.hasNonNull(name: String): Boolean =
        has(name) && get(name) !is JsonNull

    private fun JsonObject.requiredString(name: String, path: String): String =
        required(name, path.substringBeforeLast('.', path)).stringAt(path)

    private fun JsonObject.requiredIdentifier(name: String, path: String): String =
        required(name, path.substringBeforeLast('.', path)).identifierAt(path)

    private fun JsonObject.requiredLocalizationKey(name: String, path: String): String =
        requiredString(name, path).also { validateLocalizationKey(it, path) }

    private fun JsonObject.requiredLocaleTag(name: String, path: String): String =
        requiredString(name, path).also { validateLocaleTag(it, path) }

    private fun JsonObject.requiredBoolean(name: String, path: String): Boolean {
        val value = required(name, path.substringBeforeLast('.', path))
        if (!value.isJsonPrimitive || !value.asJsonPrimitive.isBoolean) {
            throw MosaicProtocolException("Expected a boolean at $path.")
        }
        return value.asBoolean
    }

    private fun JsonObject.optionalBoolean(name: String, path: String): Boolean? =
        optional(name)?.let { value ->
            if (!value.isJsonPrimitive || !value.asJsonPrimitive.isBoolean) {
                throw MosaicProtocolException("Expected a boolean at $path.")
            }
            value.asBoolean
        }

    private fun JsonObject.requiredPositiveInteger(name: String, path: String): Int {
        val number = requiredDecimal(name, path)
        if (number.stripTrailingZeros().scale() > 0 ||
            number < BigDecimal.ONE ||
            number > BigDecimal(Int.MAX_VALUE)
        ) {
            throw MosaicProtocolException("Expected a 32-bit positive integer at $path.")
        }
        return number.intValueExact()
    }

    private fun JsonObject.requiredIntegerInRange(name: String, path: String, range: IntRange): Int {
        val number = requiredDecimal(name, path)
        if (number.stripTrailingZeros().scale() > 0) {
            throw MosaicProtocolException("Expected an integer at $path.")
        }
        val result = runCatching { number.intValueExact() }.getOrElse {
            throw MosaicProtocolException("Expected an integer at $path.")
        }
        if (result !in range) throw MosaicProtocolException("Integer is outside its range at $path.")
        return result
    }

    private fun JsonObject.requiredLogicalSize(name: String, path: String): Double = requiredNumber(
        name,
        path,
        BigDecimal.ZERO,
        BigDecimal("4096"),
    )

    private fun JsonObject.requiredPositiveLogicalSize(name: String, path: String): Double =
        requiredNumber(
            name,
            path,
            BigDecimal.ZERO,
            BigDecimal("4096"),
            exclusiveMinimum = true,
        )

    private fun JsonObject.optionalLogicalSize(name: String, path: String): Double? =
        optionalNumber(name, path, BigDecimal.ZERO, BigDecimal("4096"))

    private fun JsonObject.requiredNumber(
        name: String,
        path: String,
        minimum: BigDecimal,
        maximum: BigDecimal,
        exclusiveMinimum: Boolean = false,
    ): Double {
        val decimal = requiredDecimal(name, path)
        return checkedNumber(decimal, path, minimum, maximum, exclusiveMinimum)
    }

    private fun JsonObject.optionalNumber(
        name: String,
        path: String,
        minimum: BigDecimal,
        maximum: BigDecimal,
        exclusiveMinimum: Boolean = false,
    ): Double? = optional(name)?.let { value ->
        if (!value.isJsonPrimitive || !value.asJsonPrimitive.isNumber) {
            throw MosaicProtocolException("Expected a number at $path.")
        }
        val decimal = runCatching { value.asBigDecimal }.getOrElse {
            throw MosaicProtocolException("Expected a finite JSON number at $path.")
        }
        checkedNumber(decimal, path, minimum, maximum, exclusiveMinimum)
    }

    private fun checkedNumber(
        decimal: BigDecimal,
        path: String,
        minimum: BigDecimal,
        maximum: BigDecimal,
        exclusiveMinimum: Boolean,
    ): Double {
        val below = if (exclusiveMinimum) decimal <= minimum else decimal < minimum
        if (below || decimal > maximum) {
            throw MosaicProtocolException("Number is outside its range at $path.")
        }
        return decimal.toDouble().also { number ->
            if (!number.isFinite()) throw MosaicProtocolException("Expected a finite number at $path.")
        }
    }

    private fun JsonObject.requiredDecimal(name: String, path: String): BigDecimal {
        val value = required(name, path.substringBeforeLast('.', path))
        if (!value.isJsonPrimitive || !value.asJsonPrimitive.isNumber) {
            throw MosaicProtocolException("Expected a number at $path.")
        }
        return runCatching { value.asBigDecimal }.getOrElse {
            throw MosaicProtocolException("Expected a finite JSON number at $path.")
        }
    }

    private fun JsonObject.requireConstant(name: String, expected: String, path: String) {
        if (requiredString(name, path) != expected) {
            throw MosaicProtocolException("Expected $expected at $path.")
        }
    }

    private fun JsonElement.stringAt(
        path: String,
        minLength: Int = 0,
        maxLength: Int = Int.MAX_VALUE,
    ): String {
        if (!isJsonPrimitive || !asJsonPrimitive.isString) {
            throw MosaicProtocolException("Expected a string at $path.")
        }
        return asString.also { value ->
            if (value.codePointLength() !in minLength..maxLength) {
                throw MosaicProtocolException("String length is outside its range at $path.")
            }
        }
    }

    private fun JsonElement.identifierAt(path: String): String = stringAt(path, 1, 128).also {
        if (!identifierPattern.matches(it)) throw MosaicProtocolException("Invalid identifier at $path.")
    }

    private fun validateLocalizationKey(value: String, path: String) {
        if (value.codePointLength() > 256 || !localizationKeyPattern.matches(value)) {
            throw MosaicProtocolException("Invalid localization key at $path.")
        }
    }

    private fun validateLocaleTag(value: String, path: String) {
        if (!localeTagPattern.matches(value)) {
            throw MosaicProtocolException("Invalid locale tag at $path.")
        }
    }

    private fun JsonElement.objectAt(path: String): JsonObject {
        if (!isJsonObject) throw MosaicProtocolException("Expected an object at $path.")
        return asJsonObject
    }

    private fun JsonElement.arrayAt(path: String): JsonArray {
        if (!isJsonArray) throw MosaicProtocolException("Expected an array at $path.")
        return asJsonArray
    }

    private fun JsonElement.boundedArrayAt(path: String, minimum: Int, maximum: Int): JsonArray =
        arrayAt(path).also {
            if (it.size() !in minimum..maximum) {
                throw MosaicProtocolException("Array size is outside its range at $path.")
            }
        }

    private fun JsonObject.expectKeys(
        expected: Set<String>,
        path: String,
        optional: Set<String> = emptySet(),
    ) {
        val actual = keySet()
        val required = expected - optional
        val missing = required - actual
        val unknown = actual - expected
        if (missing.isNotEmpty()) {
            throw MosaicProtocolException("Missing properties ${missing.sorted().joinToString()} at $path.")
        }
        if (unknown.isNotEmpty()) {
            throw MosaicProtocolException("Unknown properties ${unknown.sorted().joinToString()} at $path.")
        }
        actual.forEach { key ->
            if (get(key) is JsonNull) {
                throw MosaicProtocolException("Null is not allowed for $key at $path.")
            }
        }
    }

    private fun JsonObject.getAsJsonObjectOrNull(name: String): JsonObject? =
        get(name)?.takeIf { it.isJsonObject }?.asJsonObject

    private fun String.codePointLength(): Int = codePointCount(0, length)
}
