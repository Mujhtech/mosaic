package dev.mosaic.sdk

import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonNull
import com.google.gson.JsonObject
import com.google.gson.JsonParseException
import com.google.gson.JsonParser
import java.math.BigDecimal
import java.net.URI
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone


internal fun compatibility(
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
            version != MOSAIC_PROTOCOL_VERSION ||
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

internal fun localization(value: JsonElement): MosaicLocalization {
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

internal fun localeCatalog(value: JsonElement, path: String): MosaicLocaleCatalog {
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

internal fun asset(value: JsonElement, path: String): MosaicAsset {
    val objectValue = value.objectAt(path)
    return when (objectValue.requiredString("type", "$path.type")) {
        "image" -> imageAsset(objectValue, path)
        "video" -> videoAsset(objectValue, path)
        else -> throw MosaicProtocolException("Unsupported asset type at $path.type.")
    }
}

internal fun assetSource(value: JsonElement, path: String): MosaicAssetSource {
    val source = value.objectAt(path)
    return when (source.requiredString("type", "$path.type")) {
        "bundled" -> {
            source.expectKeys(setOf("type", "key"), path)
            val key = source.requiredString("key", "$path.key").also {
                if (it.codePointLength() !in 1..256 || !bundledAssetKeyPattern.matches(it)) {
                    throw MosaicProtocolException("Invalid bundled asset key at $path.key.")
                }
            }
            MosaicAssetSource.Bundled(key)
        }
        "remote" -> {
            source.expectKeys(setOf("type", "url"), path)
            MosaicAssetSource.Remote(
                validateExternalUrl(source.requiredString("url", "$path.url"), "$path.url"),
            )
        }
        else -> throw MosaicProtocolException("Unsupported asset source at $path.type.")
    }
}

internal fun imageAsset(objectValue: JsonObject, path: String): MosaicImageAsset {
    objectValue.expectKeys(setOf("type", "id", "source", "fallback"), path)
    val sourcePath = "$path.source"
    val source = assetSource(objectValue.required("source", path), sourcePath)
    val fallbackPath = "$path.fallback"
    val fallback = objectValue.required("fallback", path).objectAt(fallbackPath)
    fallback.expectKeys(setOf("type", "value"), fallbackPath)
    fallback.requireConstant("type", "placeholder", "$fallbackPath.type")
    return MosaicImageAsset(
        id = objectValue.requiredIdentifier("id", "$path.id"),
        sourceKey = when (source) {
            is MosaicAssetSource.Bundled -> source.key
            is MosaicAssetSource.Remote -> source.url
        },
        placeholder = localizedText(fallback.required("value", fallbackPath), "$fallbackPath.value"),
        source = source,
    )
}

internal fun videoAsset(objectValue: JsonObject, path: String): MosaicVideoAsset {
    objectValue.expectKeys(setOf("type", "id", "source"), path)
    return MosaicVideoAsset(
        id = objectValue.requiredIdentifier("id", "$path.id"),
        source = assetSource(objectValue.required("source", path), "$path.source"),
    )
}

internal fun productReference(value: JsonElement, path: String): MosaicProductReference {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(setOf("id", "productId", "label"), path)
    val providerProductId = objectValue.requiredString("productId", "$path.productId").also {
        if (it.codePointLength() !in 1..256 || !providerProductIdPattern.matches(it)) {
            throw MosaicProtocolException("Invalid provider product ID at $path.productId.")
        }
    }
    return MosaicProductReference(
        id = objectValue.requiredIdentifier("id", "$path.id"),
        providerProductId = providerProductId,
        label = localizedText(objectValue.required("label", path), "$path.label"),
        badge = null,
    )
}

internal fun scrollContainer(value: JsonElement, path: String): MosaicScrollContainer {
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
        background = objectValue.optional("background")?.let { background(it, "$path.background") },
        content = stack(objectValue.required("content", path), "$path.content"),
    )
}

internal fun screen(value: JsonElement, path: String): MosaicPaywallScreen {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(
        setOf("id", "accessibilityLabel", "presentation", "layout"),
        path,
        optional = setOf("accessibilityLabel"),
    )
    return MosaicPaywallScreen(
        id = objectValue.requiredIdentifier("id", "$path.id"),
        accessibilityLabel = objectValue.optional("accessibilityLabel")?.let {
            localizedText(it, "$path.accessibilityLabel")
        },
        presentation = screenPresentation(objectValue.required("presentation", path), "$path.presentation"),
        layout = scrollContainer(objectValue.required("layout", path), "$path.layout"),
    )
}

internal fun screenPresentation(value: JsonElement, path: String): MosaicScreenPresentation {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(setOf("type"), path)
    return when (objectValue.requiredString("type", "$path.type")) {
        "screen" -> MosaicScreenPresentation.SCREEN
        "sheet" -> MosaicScreenPresentation.SHEET
        else -> throw MosaicProtocolException("Unsupported screen presentation at $path.type.")
    }
}

internal fun stack(value: JsonElement, path: String): MosaicStack {
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

internal fun node(value: JsonElement, path: String): MosaicNode {
    val objectValue = value.objectAt(path)
    return when (objectValue.requiredString("type", "$path.type")) {
        "stack" -> stack(value, path)
        "text" -> textComponent(objectValue, path)
        "image" -> imageComponent(objectValue, path)
        "icon" -> iconComponent(objectValue, path)
        "featureList" -> featureListComponent(objectValue, path)
        "productSelector" -> productSelectorComponent(objectValue, path)
        "button" -> buttonComponent(objectValue, path)
        "carousel" -> carouselComponent(objectValue, path)
        "switch" -> switchComponent(objectValue, path)
        "countdown" -> countdownComponent(objectValue, path)
        else -> throw MosaicProtocolException("Unsupported Protocol 0.2 component at $path.type.")
    }
}

internal fun textComponent(objectValue: JsonObject, path: String): MosaicTextComponent {
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

internal fun imageComponent(objectValue: JsonObject, path: String): MosaicImageComponent {
    objectValue.expectKeys(
        setOf(
            "type", "id", "assetId", "aspectRatio", "contentMode", "appearance", "sizing",
            "outerInsets", "visibility", "accessibility",
        ),
        path,
        optional = setOf("aspectRatio", "appearance", "sizing", "outerInsets", "visibility"),
    )
    val sizing = optionalWidthSizing(objectValue, path)
    return MosaicImageComponent(
        id = objectValue.requiredIdentifier("id", "$path.id"),
        assetId = objectValue.requiredIdentifier("assetId", "$path.assetId"),
        width = sizing?.width ?: MosaicWidthSizing.Content,
        aspectRatio = if (objectValue.hasNonNull("aspectRatio")) {
            objectValue.requiredNumber(
                "aspectRatio", "$path.aspectRatio", BigDecimal.ZERO, BigDecimal.TEN, true,
            )
        } else {
            null
        },
        height = (sizing?.height as? MosaicHeightSizing.Fixed)?.value,
        contentMode = imageContentMode(objectValue, "contentMode", "$path.contentMode"),
        appearance = optionalBoxAppearance(objectValue, path),
        sizing = sizing,
        outerInsets = optionalOuterInsets(objectValue, path),
        visibility = optionalVisibility(objectValue, path),
        accessibility = imageAccessibility(
            objectValue.required("accessibility", path),
            "$path.accessibility",
        ),
    )
}

internal fun iconComponent(objectValue: JsonObject, path: String): MosaicIconComponent {
    objectValue.expectKeys(
        setOf(
            "type", "id", "name", "size", "color", "appearance", "sizing", "outerInsets",
            "visibility", "accessibility",
        ),
        path,
        optional = setOf("appearance", "sizing", "outerInsets", "visibility"),
    )
    val name = when (objectValue.requiredString("name", "$path.name")) {
        "checkmark" -> MosaicIconName.CHECKMARK
        "close" -> MosaicIconName.CLOSE
        "lock" -> MosaicIconName.LOCK
        "restore" -> MosaicIconName.RESTORE
        "externalLink" -> MosaicIconName.EXTERNAL_LINK
        "arrowBackward" -> MosaicIconName.ARROW_BACKWARD
        "arrowForward" -> MosaicIconName.ARROW_FORWARD
        "chevronBackward" -> MosaicIconName.CHEVRON_BACKWARD
        "chevronForward" -> MosaicIconName.CHEVRON_FORWARD
        else -> throw MosaicProtocolException("Invalid icon name at $path.name.")
    }
    return MosaicIconComponent(
        id = objectValue.requiredIdentifier("id", "$path.id"),
        name = name,
        size = objectValue.requiredPositiveLogicalSize("size", "$path.size"),
        color = color(objectValue.required("color", path), "$path.color"),
        accessibility = imageAccessibility(
            objectValue.required("accessibility", path),
            "$path.accessibility",
        ),
        appearance = optionalBoxAppearance(objectValue, path),
        sizing = optionalWidthSizing(objectValue, path),
        outerInsets = optionalOuterInsets(objectValue, path),
        visibility = optionalVisibility(objectValue, path),
    )
}

internal fun buttonComponent(objectValue: JsonObject, path: String): MosaicButtonComponent {
    objectValue.expectKeys(
        setOf(
            "type", "id", "direction", "gap", "mainAxisDistribution",
            "crossAxisAlignment", "children", "inProgressChildren", "appearance", "sizing",
            "outerInsets", "visibility", "action", "accessibility",
        ),
        path,
        optional = setOf(
            "inProgressChildren", "appearance", "sizing", "outerInsets", "visibility",
        ),
    )
    val children = objectValue.required("children", path)
        .boundedArrayAt("$path.children", 1, 500)
        .mapIndexed { index, child -> node(child, "$path.children[$index]") }
    val inProgressChildren = objectValue.optional("inProgressChildren")?.let { childrenValue ->
        childrenValue.boundedArrayAt("$path.inProgressChildren", 1, 500)
            .mapIndexed { index, child -> node(child, "$path.inProgressChildren[$index]") }
    }
    return MosaicButtonComponent(
        id = objectValue.requiredIdentifier("id", "$path.id"),
        direction = stackDirection(objectValue, "direction", "$path.direction"),
        gap = objectValue.requiredLogicalSize("gap", "$path.gap"),
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
        children = children,
        inProgressChildren = inProgressChildren,
        action = buttonAction(objectValue.required("action", path), "$path.action"),
        accessibility = controlAccessibility(
            objectValue.required("accessibility", path),
            "$path.accessibility",
        ),
        appearance = optionalBoxAppearance(objectValue, path),
        sizing = optionalWidthSizing(objectValue, path),
        outerInsets = optionalOuterInsets(objectValue, path),
        visibility = optionalVisibility(objectValue, path),
    )
}

internal fun featureListComponent(objectValue: JsonObject, path: String): MosaicFeatureListComponent {
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

internal fun featureListItem(value: JsonElement, path: String): MosaicFeatureListItem {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(setOf("id", "text"), path)
    return MosaicFeatureListItem(
        id = objectValue.requiredIdentifier("id", "$path.id"),
        text = localizedText(objectValue.required("text", path), "$path.text"),
    )
}

internal fun productSelectorComponent(
    objectValue: JsonObject,
    path: String,
): MosaicProductSelectorComponent {
    objectValue.expectKeys(
        setOf(
            "type", "id", "direction", "gap", "crossAxisAlignment",
            "initialProductCardId", "cards", "appearance", "sizing", "outerInsets",
            "visibility", "unavailableFallback", "accessibility",
        ),
        path,
        optional = setOf("appearance", "sizing", "outerInsets", "visibility"),
    )
    val cards = objectValue.required("cards", path)
        .boundedArrayAt("$path.cards", 1, 20)
        .mapIndexed { index, element -> productCardComponent(element, "$path.cards[$index]") }
    val initialProductCardId = objectValue.requiredIdentifier(
        "initialProductCardId",
        "$path.initialProductCardId",
    )
    return MosaicProductSelectorComponent(
        id = objectValue.requiredIdentifier("id", "$path.id"),
        productReferenceIds = cards.map(MosaicProductCardComponent::productReferenceId),
        initiallySelectedProductReferenceId = cards
            .firstOrNull { it.id == initialProductCardId }
            ?.productReferenceId
            ?: cards.first().productReferenceId,
        direction = stackDirection(objectValue, "direction", "$path.direction"),
        gap = objectValue.requiredLogicalSize("gap", "$path.gap"),
        cardStyles = MosaicProductCardStyles.Legacy,
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
        cards = cards,
        initialProductCardId = initialProductCardId,
        crossAxisAlignment = crossAxisAlignment(
            objectValue,
            "crossAxisAlignment",
            "$path.crossAxisAlignment",
        ),
    )
}

internal fun productCardComponent(value: JsonElement, path: String): MosaicProductCardComponent {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(
        setOf(
            "type", "id", "productReferenceId", "direction", "gap",
            "mainAxisDistribution", "crossAxisAlignment", "children", "styles",
            "sizing", "clipContent", "accessibility",
        ),
        path,
        optional = setOf("sizing", "clipContent", "accessibility"),
    )
    objectValue.requireConstant("type", "productCard", "$path.type")
    if (objectValue.hasNonNull("clipContent") &&
        objectValue.requiredBoolean("clipContent", "$path.clipContent")
    ) {
        throw MosaicProtocolException("Product Card clipContent must be false at $path.clipContent.")
    }
    val children = objectValue.required("children", path)
        .boundedArrayAt("$path.children", 1, 500)
        .mapIndexed { index, child -> productCardChild(child, "$path.children[$index]") }
    return MosaicProductCardComponent(
        id = objectValue.requiredIdentifier("id", "$path.id"),
        productReferenceId = objectValue.requiredIdentifier(
            "productReferenceId",
            "$path.productReferenceId",
        ),
        direction = stackDirection(objectValue, "direction", "$path.direction"),
        gap = objectValue.requiredLogicalSize("gap", "$path.gap"),
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
        children = children,
        styles = productCardBoxStyles(objectValue.required("styles", path), "$path.styles"),
        clipContent = false,
        accessibilityLabel = objectValue.optional("accessibility")?.let {
            val accessibility = it.objectAt("$path.accessibility")
            accessibility.expectKeys(setOf("label"), "$path.accessibility")
            localizedText(accessibility.required("label", "$path.accessibility"), "$path.accessibility.label")
        },
        sizing = optionalWidthSizing(objectValue, path),
    )
}

internal fun productCardChild(value: JsonElement, path: String): MosaicNode {
    val objectValue = value.objectAt(path)
    return if (objectValue.get("type")?.asString == "productBadge") {
        productBadgeComponent(value, path)
    } else {
        node(value, path)
    }
}

internal fun productBadgeComponent(value: JsonElement, path: String): MosaicProductBadgeComponent {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(
        setOf(
            "type", "id", "placement", "direction", "gap", "mainAxisDistribution",
            "crossAxisAlignment", "children", "styles", "sizing",
        ),
        path,
        optional = setOf("sizing"),
    )
    objectValue.requireConstant("type", "productBadge", "$path.type")
    return MosaicProductBadgeComponent(
        id = objectValue.requiredIdentifier("id", "$path.id"),
        placement = productBadgePlacement(
            objectValue.required("placement", path),
            "$path.placement",
        ),
        direction = stackDirection(objectValue, "direction", "$path.direction"),
        gap = objectValue.requiredLogicalSize("gap", "$path.gap"),
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
        children = objectValue.required("children", path)
            .boundedArrayAt("$path.children", 1, 10)
            .mapIndexed { index, child -> node(child, "$path.children[$index]") },
        styles = productCardBoxStyles(objectValue.required("styles", path), "$path.styles"),
        sizing = optionalWidthSizing(objectValue, path),
    )
}

internal fun productBadgePlacement(value: JsonElement, path: String): MosaicProductBadgePlacement {
    val objectValue = value.objectAt(path)
    return when (objectValue.requiredString("mode", "$path.mode")) {
        "nested" -> {
            objectValue.expectKeys(setOf("mode"), path)
            MosaicProductBadgePlacement.Nested
        }
        "overlay" -> {
            objectValue.expectKeys(setOf("mode", "anchor", "inset"), path)
            val anchor = when (objectValue.requiredString("anchor", "$path.anchor")) {
                "topStart" -> MosaicProductBadgeAnchor.TOP_START
                "topEnd" -> MosaicProductBadgeAnchor.TOP_END
                "bottomStart" -> MosaicProductBadgeAnchor.BOTTOM_START
                "bottomEnd" -> MosaicProductBadgeAnchor.BOTTOM_END
                else -> throw MosaicProtocolException("Invalid Product Badge anchor at $path.anchor.")
            }
            MosaicProductBadgePlacement.Overlay(
                anchor,
                objectValue.requiredNumber(
                    "inset",
                    "$path.inset",
                    BigDecimal.ZERO,
                    BigDecimal("64"),
                    false,
                ),
            )
        }
        else -> throw MosaicProtocolException("Invalid Product Badge placement at $path.mode.")
    }
}

internal fun productCardBoxStyles(value: JsonElement, path: String): MosaicProductCardBoxStyles {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(setOf("default", "selected"), path)
    return MosaicProductCardBoxStyles(
        defaultStyle = productCardBoxDefaultStyle(
            objectValue.required("default", path),
            "$path.default",
        ),
        selected = productCardBoxSelectedStyle(
            objectValue.required("selected", path),
            "$path.selected",
        ),
    )
}

internal fun productCardBoxDefaultStyle(
    value: JsonElement,
    path: String,
): MosaicProductCardBoxStyle {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(
        setOf("background", "border", "cornerRadius", "padding", "opacity", "shadow"),
        path,
        optional = setOf("shadow"),
    )
    return MosaicProductCardBoxStyle(
        background = background(objectValue.required("background", path), "$path.background"),
        border = border(objectValue.required("border", path), "$path.border"),
        cornerRadius = objectValue.requiredLogicalSize("cornerRadius", "$path.cornerRadius"),
        padding = edgeInsets(objectValue.required("padding", path), "$path.padding"),
        opacity = objectValue.requiredNumber(
            "opacity",
            "$path.opacity",
            BigDecimal.ZERO,
            BigDecimal.ONE,
            false,
        ),
        shadow = objectValue.optional("shadow")?.let { shadow(it, "$path.shadow") },
    )
}

internal fun productCardBoxSelectedStyle(
    value: JsonElement,
    path: String,
): MosaicProductCardBoxStyleOverride {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(
        setOf("background", "border", "cornerRadius", "padding", "opacity", "shadow"),
        path,
        optional = setOf("background", "border", "cornerRadius", "padding", "opacity", "shadow"),
    )
    return MosaicProductCardBoxStyleOverride(
        background = objectValue.optional("background")?.let { background(it, "$path.background") },
        border = objectValue.optional("border")?.let { borderOverride(it, "$path.border") },
        cornerRadius = objectValue.optionalLogicalSize("cornerRadius", "$path.cornerRadius"),
        padding = objectValue.optional("padding")?.let {
            edgeInsetsOverride(it, "$path.padding")
        },
        opacity = objectValue.optional("opacity")?.let {
            objectValue.requiredNumber(
                "opacity",
                "$path.opacity",
                BigDecimal.ZERO,
                BigDecimal.ONE,
                false,
            )
        },
        shadow = objectValue.optional("shadow")?.let { shadow(it, "$path.shadow") },
    )
}

internal fun unavailableProductFallback(
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

internal fun carouselComponent(
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

internal fun carouselPage(value: JsonElement, path: String): MosaicCarouselPage {
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

internal fun switchComponent(
    objectValue: JsonObject,
    path: String,
): MosaicSwitchComponent {
    objectValue.expectKeys(
        setOf(
            "type", "id", "label", "initialValue", "typography", "offTrackColor",
            "onTrackColor", "thumbColor", "appearance", "sizing", "outerInsets", "visibility",
            "accessibility",
        ),
        path,
        optional = setOf("appearance", "sizing", "outerInsets", "visibility"),
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
        sizing = optionalWidthSizing(objectValue, path),
        outerInsets = optionalOuterInsets(objectValue, path),
        visibility = optionalVisibility(objectValue, path),
        accessibility = controlAccessibility(
            objectValue.required("accessibility", path),
            "$path.accessibility",
        ),
    )
}

internal fun countdownComponent(
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

