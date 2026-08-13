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
    // The catalog is exact per version: `style.productCardStates` exists at `0.3` and not at `0.4`,
    // and the three `motion.*` capabilities exist at `0.4` and not at `0.3`. A document declaring
    // one from the other version is rejected as an unknown capability rather than tolerated.
    val documentVersion = activeProtocolVersion.get() ?: MOSAIC_PROTOCOL_VERSION
    val catalog = if (documentVersion == MOSAIC_PROTOCOL_V04_VERSION) {
        MosaicCapabilityCatalog.v04
    } else {
        MosaicCapabilityCatalog.v03
    }
    val capabilities = entries.mapIndexed { index, element ->
        val capabilityPath = "$path.requiredCapabilities[$index]"
        val capability = element.objectAt(capabilityPath)
        capability.expectKeys(setOf("name", "version"), capabilityPath)
        val wireName = capability.requiredString("name", "$capabilityPath.name")
        val version = capability.requiredString("version", "$capabilityPath.version")
        val name = capabilitiesByWireName[wireName]
            ?: throw MosaicProtocolException(
                "Unsupported capability $wireName@$version at $capabilityPath.",
                violation = MosaicProtocolViolation.UNSUPPORTED_CAPABILITY,
            )
        val required = MosaicRequiredCapability(name, version)
        if (name !in catalog ||
            version != documentVersion ||
            !capabilityReport.supports(required)
        ) {
            throw MosaicProtocolException(
                "Unsupported capability $wireName@$version at $capabilityPath.",
                violation = MosaicProtocolViolation.UNSUPPORTED_CAPABILITY,
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
    objectValue.expectNodeKeys(
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
        motion = optionalNodeMotion(objectValue, path, nodeMotionSlots),
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
        "tabs" -> tabsComponent(objectValue, path)
        "timeline" -> timelineComponent(objectValue, path)
        "award" -> awardComponent(objectValue, path)
        "socialProof" -> socialProofComponent(objectValue, path)
        else -> throw MosaicProtocolException(
            "Unsupported Protocol 0.3 component at $path.type.",
            violation = MosaicProtocolViolation.UNSUPPORTED_COMPONENT,
        )
    }
}

internal fun textComponent(objectValue: JsonObject, path: String): MosaicTextComponent {
    objectValue.expectNodeKeys(
        setOf(
            "type", "id", "value", "typography", "appearance", "sizing", "outerInsets",
            "visibility", "accessibility",
        ),
        path,
        optional = setOf("appearance", "sizing", "outerInsets", "visibility"),
    )
    return MosaicTextComponent(
        id = objectValue.requiredIdentifier("id", "$path.id"),
        motion = optionalNodeMotion(objectValue, path, nodeMotionSlots),
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
    objectValue.expectNodeKeys(
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
        motion = optionalNodeMotion(objectValue, path, nodeMotionSlots),
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
    objectValue.expectNodeKeys(
        setOf(
            "type", "id", "name", "size", "color", "appearance", "sizing", "outerInsets",
            "visibility", "accessibility",
        ),
        path,
        optional = setOf("appearance", "sizing", "outerInsets", "visibility"),
    )
    val name = iconName(objectValue, "name", "$path.name")
    return MosaicIconComponent(
        id = objectValue.requiredIdentifier("id", "$path.id"),
        motion = optionalNodeMotion(objectValue, path, nodeMotionSlots),
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
    objectValue.expectNodeKeys(
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
        motion = optionalNodeMotion(objectValue, path, buttonMotionSlots),
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
    // `markerSize` is a `0.4` addition that mirrors Timeline's field of the same name. It is version
    // gated rather than merely optional so that the `0.3` reader is unchanged by its existence: a
    // `0.3` document declaring one is rejected as an unknown property, exactly as it was before.
    val markerSizeKey = if (decodingProtocolV04()) setOf("markerSize") else emptySet()
    objectValue.expectNodeKeys(
        setOf(
            "type", "id", "marker", "gap", "markerColor", "items", "typography",
            "appearance", "sizing", "outerInsets", "visibility", "accessibility",
        ) + markerSizeKey,
        path,
        optional = setOf("appearance", "sizing", "outerInsets", "visibility") + markerSizeKey,
    )
    val items = objectValue.required("items", path).boundedArrayAt("$path.items", 1, 100)
    return MosaicFeatureListComponent(
        id = objectValue.requiredIdentifier("id", "$path.id"),
        motion = optionalNodeMotion(objectValue, path, nodeMotionSlots),
        marker = featureListMarker(objectValue, path),
        gap = objectValue.requiredLogicalSize("gap", "$path.gap"),
        markerColor = color(objectValue.required("markerColor", path), "$path.markerColor"),
        // Bounded exactly as Timeline's is, by the shared `positiveLogicalSize` reader: a marker of
        // zero extent is a glyph nothing draws, and the ceiling is the protocol's own.
        markerSize = if (objectValue.hasNonNull("markerSize")) {
            objectValue.requiredPositiveLogicalSize("markerSize", "$path.markerSize")
        } else {
            null
        },
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

/**
 * The list's default glyph.
 *
 * `0.3` writes the single string constant `"checkmark"`, which cannot express a *negated* item;
 * `0.4` writes the marker union Timeline already used. Reading the `0.3` constant as the equivalent
 * icon marker is what lets one renderer path serve both versions, and each version still accepts
 * only its own form.
 */
internal fun featureListMarker(objectValue: JsonObject, path: String): MosaicMarker {
    if (!decodingProtocolV04()) {
        objectValue.requireConstant("marker", "checkmark", "$path.marker")
        return MosaicMarker.Icon(MosaicIconName.CHECKMARK)
    }
    return marker(objectValue.required("marker", path), "$path.marker")
}

internal fun featureListItem(value: JsonElement, path: String): MosaicFeatureListItem {
    val objectValue = value.objectAt(path)
    val supportsOverride = decodingProtocolV04()
    val expected = if (supportsOverride) setOf("id", "text", "marker") else setOf("id", "text")
    objectValue.expectKeys(
        expected,
        path,
        optional = if (supportsOverride) setOf("marker") else emptySet(),
    )
    return MosaicFeatureListItem(
        id = objectValue.requiredIdentifier("id", "$path.id"),
        text = localizedText(objectValue.required("text", path), "$path.text"),
        // Absent means the item carries the list's marker. It is never a request for no glyph.
        marker = objectValue.optional("marker")
            ?.takeIf { supportsOverride }
            ?.let { marker(it, "$path.marker") },
    )
}

internal fun productSelectorComponent(
    objectValue: JsonObject,
    path: String,
): MosaicProductSelectorComponent {
    objectValue.expectNodeKeys(
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
        motion = optionalNodeMotion(objectValue, path, selectableMotionSlots),
        productReferenceIds = cards.map(MosaicProductCardComponent::productReferenceId),
        initiallySelectedProductReferenceId = cards
            .firstOrNull { it.id == initialProductCardId }
            ?.productReferenceId
            ?: cards.first().productReferenceId,
        direction = stackDirection(objectValue, "direction", "$path.direction"),
        gap = objectValue.requiredLogicalSize("gap", "$path.gap"),
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
    objectValue.expectNodeKeys(
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
        motion = optionalNodeMotion(objectValue, path, nodeMotionSlots),
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
        styles = selectionStyles(objectValue.required("styles", path), "$path.styles"),
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
    objectValue.expectNodeKeys(
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
        motion = optionalNodeMotion(objectValue, path, nodeMotionSlots),
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
        styles = selectionStyles(objectValue.required("styles", path), "$path.styles"),
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

internal fun selectionStyles(value: JsonElement, path: String): MosaicSelectionStyles {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(setOf("default", "selected"), path)
    return MosaicSelectionStyles(
        defaultStyle = selectionStateStyle(
            objectValue.required("default", path),
            "$path.default",
        ),
        selected = selectionStateStyleOverride(
            objectValue.required("selected", path),
            "$path.selected",
        ),
    )
}

internal fun selectionStateStyle(
    value: JsonElement,
    path: String,
): MosaicSelectionStateStyle {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(
        setOf("background", "border", "cornerRadius", "padding", "opacity", "shadow"),
        path,
        optional = setOf("shadow"),
    )
    return MosaicSelectionStateStyle(
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

internal fun selectionStateStyleOverride(
    value: JsonElement,
    path: String,
): MosaicSelectionStateStyleOverride {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(
        setOf("background", "border", "cornerRadius", "padding", "opacity", "shadow"),
        path,
        optional = setOf("background", "border", "cornerRadius", "padding", "opacity", "shadow"),
    )
    return MosaicSelectionStateStyleOverride(
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
    objectValue.expectNodeKeys(
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
        motion = optionalNodeMotion(objectValue, path, nodeMotionSlots),
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
    objectValue.expectNodeKeys(
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
        motion = optionalNodeMotion(objectValue, path, nodeMotionSlots),
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
    objectValue.expectNodeKeys(
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
        motion = optionalNodeMotion(objectValue, path, nodeMotionSlots),
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


internal fun tabsComponent(objectValue: JsonObject, path: String): MosaicTabsComponent {
    objectValue.expectNodeKeys(
        setOf(
            "type", "id", "tabBarDirection", "tabBarGap", "tabBarDistribution", "gap",
            "initialTabId", "tabs", "styles", "labelTypography", "selectedLabelColor",
            "appearance", "sizing", "outerInsets", "visibility", "accessibility",
        ),
        path,
        optional = setOf("appearance", "sizing", "outerInsets", "visibility"),
    )
    val entries = objectValue.required("tabs", path)
        .boundedArrayAt("$path.tabs", 2, 8)
        .mapIndexed { index, element -> tabsEntry(element, "$path.tabs[$index]") }
    return MosaicTabsComponent(
        id = objectValue.requiredIdentifier("id", "$path.id"),
        motion = optionalNodeMotion(objectValue, path, selectableMotionSlots),
        tabBarDirection = when (objectValue.requiredString("tabBarDirection", "$path.tabBarDirection")) {
            "vertical" -> MosaicTabBarDirection.VERTICAL
            "horizontal" -> MosaicTabBarDirection.HORIZONTAL
            else -> throw MosaicProtocolException("Invalid tab bar direction at $path.tabBarDirection.")
        },
        tabBarGap = objectValue.requiredLogicalSize("tabBarGap", "$path.tabBarGap"),
        tabBarDistribution = mainAxisDistribution(
            objectValue,
            "tabBarDistribution",
            "$path.tabBarDistribution",
        ),
        gap = objectValue.requiredLogicalSize("gap", "$path.gap"),
        initialTabId = objectValue.requiredIdentifier("initialTabId", "$path.initialTabId"),
        tabs = entries,
        styles = selectionStyles(objectValue.required("styles", path), "$path.styles"),
        labelTypography = typography(
            objectValue.required("labelTypography", path),
            "$path.labelTypography",
            false,
        ),
        selectedLabelColor = color(
            objectValue.required("selectedLabelColor", path),
            "$path.selectedLabelColor",
        ),
        accessibility = controlAccessibility(
            objectValue.required("accessibility", path),
            "$path.accessibility",
        ),
        appearance = objectValue.optional("appearance")?.let {
            containerAppearance(it, "$path.appearance")
        },
        sizing = optionalWidthSizing(objectValue, path),
        outerInsets = optionalOuterInsets(objectValue, path),
        visibility = optionalVisibility(objectValue, path),
    )
}

internal fun tabsEntry(value: JsonElement, path: String): MosaicTabEntry {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(setOf("id", "label", "content"), path)
    return MosaicTabEntry(
        id = objectValue.requiredIdentifier("id", "$path.id"),
        label = localizedText(objectValue.required("label", path), "$path.label"),
        content = stack(objectValue.required("content", path), "$path.content"),
    )
}

internal fun timelineComponent(objectValue: JsonObject, path: String): MosaicTimelineComponent {
    objectValue.expectNodeKeys(
        setOf(
            "type", "id", "orientation", "gap", "connector", "entries", "markerColor",
            "markerSize", "titleTypography", "descriptionTypography", "appearance", "sizing",
            "outerInsets", "visibility", "accessibility",
        ),
        path,
        optional = setOf(
            "markerColor", "markerSize", "descriptionTypography", "appearance", "sizing",
            "outerInsets", "visibility",
        ),
    )
    objectValue.requireConstant("orientation", "vertical", "$path.orientation")
    val entries = objectValue.required("entries", path)
        .boundedArrayAt("$path.entries", 2, 12)
        .mapIndexed { index, element -> timelineEntry(element, "$path.entries[$index]") }
    // Both directions are enforced: a marker with no declared style would leave the renderer
    // choosing a colour, and a declared style no entry consumes is a stale field nothing reads.
    val consumesMarkerStyle = entries.any { it.marker != null }
    val consumesDescriptionStyle = entries.any { it.description != null }
    listOf(
        "markerColor" to consumesMarkerStyle,
        "markerSize" to consumesMarkerStyle,
        "descriptionTypography" to consumesDescriptionStyle,
    ).forEach { (field, consumed) ->
        val declared = objectValue.hasNonNull(field)
        if (consumed && !declared) {
            throw MosaicProtocolException("Timeline must declare $field at $path.$field.")
        }
        if (!consumed && declared) {
            throw MosaicProtocolException("Timeline declares $field but no entry uses it at $path.$field.")
        }
    }
    return MosaicTimelineComponent(
        id = objectValue.requiredIdentifier("id", "$path.id"),
        motion = optionalNodeMotion(objectValue, path, nodeMotionSlots),
        gap = objectValue.requiredLogicalSize("gap", "$path.gap"),
        connector = timelineConnector(objectValue.required("connector", path), "$path.connector"),
        entries = entries,
        titleTypography = typography(
            objectValue.required("titleTypography", path),
            "$path.titleTypography",
            false,
        ),
        accessibility = controlAccessibility(
            objectValue.required("accessibility", path),
            "$path.accessibility",
        ),
        markerColor = objectValue.optional("markerColor")?.let { color(it, "$path.markerColor") },
        markerSize = if (objectValue.hasNonNull("markerSize")) {
            objectValue.requiredPositiveLogicalSize("markerSize", "$path.markerSize")
        } else {
            null
        },
        descriptionTypography = objectValue.optional("descriptionTypography")?.let {
            typography(it, "$path.descriptionTypography", false)
        },
        appearance = optionalBoxAppearance(objectValue, path),
        sizing = optionalWidthSizing(objectValue, path),
        outerInsets = optionalOuterInsets(objectValue, path),
        visibility = optionalVisibility(objectValue, path),
    )
}

internal fun timelineConnector(value: JsonElement, path: String): MosaicTimelineConnector {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(setOf("color", "width", "style"), path)
    return MosaicTimelineConnector(
        color = color(objectValue.required("color", path), "$path.color"),
        width = objectValue.requiredPositiveLogicalSize("width", "$path.width"),
        style = when (objectValue.requiredString("style", "$path.style")) {
            "solid" -> MosaicTimelineConnectorStyle.SOLID
            "dashed" -> MosaicTimelineConnectorStyle.DASHED
            else -> throw MosaicProtocolException("Invalid timeline connector style at $path.style.")
        },
    )
}

internal fun timelineEntry(value: JsonElement, path: String): MosaicTimelineEntry {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(
        setOf("id", "title", "description", "marker"),
        path,
        optional = setOf("description", "marker"),
    )
    return MosaicTimelineEntry(
        id = objectValue.requiredIdentifier("id", "$path.id"),
        title = localizedText(objectValue.required("title", path), "$path.title"),
        description = objectValue.optional("description")?.let {
            localizedText(it, "$path.description")
        },
        // The union Timeline has always used; `0.4` gives Feature List the same one.
        marker = objectValue.optional("marker")?.let { marker(it, "$path.marker") },
    )
}

internal fun awardComponent(objectValue: JsonObject, path: String): MosaicAwardComponent {
    objectValue.expectNodeKeys(
        setOf(
            "type", "id", "direction", "gap", "crossAxisAlignment", "emblem", "title",
            "titleTypography", "subtitle", "subtitleTypography", "appearance", "sizing",
            "outerInsets", "visibility", "accessibility",
        ),
        path,
        optional = setOf(
            "emblem", "subtitle", "subtitleTypography", "appearance", "sizing", "outerInsets",
            "visibility",
        ),
    )
    // `subtitle` and `subtitleTypography` are mutually dependentRequired: a subtitle with no
    // typography would leave the renderer inventing one, and typography with no subtitle is a
    // value nothing reads.
    if (objectValue.hasNonNull("subtitle") != objectValue.hasNonNull("subtitleTypography")) {
        throw MosaicProtocolException(
            "Award subtitle and subtitleTypography must be declared together at $path.",
        )
    }
    return MosaicAwardComponent(
        id = objectValue.requiredIdentifier("id", "$path.id"),
        motion = optionalNodeMotion(objectValue, path, nodeMotionSlots),
        direction = stackDirection(objectValue, "direction", "$path.direction"),
        gap = objectValue.requiredLogicalSize("gap", "$path.gap"),
        crossAxisAlignment = crossAxisAlignment(
            objectValue,
            "crossAxisAlignment",
            "$path.crossAxisAlignment",
        ),
        title = localizedText(objectValue.required("title", path), "$path.title"),
        titleTypography = typography(
            objectValue.required("titleTypography", path),
            "$path.titleTypography",
            false,
        ),
        accessibility = controlAccessibility(
            objectValue.required("accessibility", path),
            "$path.accessibility",
        ),
        emblem = objectValue.optional("emblem")?.let { awardEmblem(it, "$path.emblem") },
        subtitle = objectValue.optional("subtitle")?.let { localizedText(it, "$path.subtitle") },
        subtitleTypography = objectValue.optional("subtitleTypography")?.let {
            typography(it, "$path.subtitleTypography", false)
        },
        appearance = optionalBoxAppearance(objectValue, path),
        sizing = optionalWidthSizing(objectValue, path),
        outerInsets = optionalOuterInsets(objectValue, path),
        visibility = optionalVisibility(objectValue, path),
    )
}

internal fun awardEmblem(value: JsonElement, path: String): MosaicAwardEmblem {
    val objectValue = value.objectAt(path)
    return when (objectValue.requiredString("type", "$path.type")) {
        "image" -> {
            objectValue.expectKeys(setOf("type", "assetId", "size"), path)
            MosaicAwardEmblem.Image(
                assetId = objectValue.requiredIdentifier("assetId", "$path.assetId"),
                size = objectValue.requiredPositiveLogicalSize("size", "$path.size"),
            )
        }
        "icon" -> {
            objectValue.expectKeys(setOf("type", "name", "size", "color"), path)
            MosaicAwardEmblem.Icon(
                name = iconName(objectValue, "name", "$path.name"),
                size = objectValue.requiredPositiveLogicalSize("size", "$path.size"),
                color = color(objectValue.required("color", path), "$path.color"),
            )
        }
        else -> throw MosaicProtocolException("Invalid award emblem at $path.type.")
    }
}

internal fun socialProofComponent(
    objectValue: JsonObject,
    path: String,
): MosaicSocialProofComponent {
    objectValue.expectNodeKeys(
        setOf(
            "type", "id", "gap", "quote", "quoteTypography", "attribution",
            "attributionTypography", "rating", "avatar", "appearance", "sizing", "outerInsets",
            "visibility", "accessibility",
        ),
        path,
        optional = setOf(
            "rating", "avatar", "appearance", "sizing", "outerInsets", "visibility",
        ),
    )
    return MosaicSocialProofComponent(
        id = objectValue.requiredIdentifier("id", "$path.id"),
        motion = optionalNodeMotion(objectValue, path, nodeMotionSlots),
        gap = objectValue.requiredLogicalSize("gap", "$path.gap"),
        quote = localizedText(objectValue.required("quote", path), "$path.quote"),
        quoteTypography = typography(
            objectValue.required("quoteTypography", path),
            "$path.quoteTypography",
            false,
        ),
        attribution = localizedText(
            objectValue.required("attribution", path),
            "$path.attribution",
        ),
        attributionTypography = typography(
            objectValue.required("attributionTypography", path),
            "$path.attributionTypography",
            false,
        ),
        accessibility = controlAccessibility(
            objectValue.required("accessibility", path),
            "$path.accessibility",
        ),
        rating = objectValue.optional("rating")?.let { socialProofRating(it, "$path.rating") },
        avatar = objectValue.optional("avatar")?.let { socialProofAvatar(it, "$path.avatar") },
        appearance = optionalBoxAppearance(objectValue, path),
        sizing = optionalWidthSizing(objectValue, path),
        outerInsets = optionalOuterInsets(objectValue, path),
        visibility = optionalVisibility(objectValue, path),
    )
}

internal fun socialProofRating(value: JsonElement, path: String): MosaicSocialProofRating {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(
        setOf("symbol", "value", "maximum", "step", "size", "filledColor", "emptyColor"),
        path,
    )
    objectValue.requireConstant("symbol", "star", "$path.symbol")
    val step = when (objectValue.requiredString("step", "$path.step")) {
        "whole" -> MosaicSocialProofRatingStep.WHOLE
        "half" -> MosaicSocialProofRatingStep.HALF
        else -> throw MosaicProtocolException("Invalid social proof rating step at $path.step.")
    }
    val maximum = objectValue.requiredIntegerInRange("maximum", "$path.maximum", 1..10)
    val steps = objectValue.requiredIntegerInRange("value", "$path.value", 0..20)
    if (steps > maximum * step.stepsPerPoint) {
        throw MosaicProtocolException(
            "Social proof rating value $steps exceeds ${maximum * step.stepsPerPoint} " +
                "steps out of $maximum at $path.value.",
        )
    }
    return MosaicSocialProofRating(
        value = steps,
        maximum = maximum,
        step = step,
        size = objectValue.requiredPositiveLogicalSize("size", "$path.size"),
        filledColor = color(objectValue.required("filledColor", path), "$path.filledColor"),
        emptyColor = color(objectValue.required("emptyColor", path), "$path.emptyColor"),
    )
}

internal fun socialProofAvatar(value: JsonElement, path: String): MosaicSocialProofAvatar {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(setOf("assetId", "size"), path)
    return MosaicSocialProofAvatar(
        assetId = objectValue.requiredIdentifier("assetId", "$path.assetId"),
        size = objectValue.requiredPositiveLogicalSize("size", "$path.size"),
    )
}
