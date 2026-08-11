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


internal fun typography(
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

internal fun boxAppearance(value: JsonElement, path: String): MosaicBoxAppearance {
    val objectValue = value.objectAt(path)
    if (objectValue.size() == 0) throw MosaicProtocolException("Empty appearance at $path.")
    objectValue.expectKeys(
        setOf("background", "border", "cornerRadius", "opacity", "padding", "shadow"),
        path,
        optional = setOf("background", "border", "cornerRadius", "opacity", "padding", "shadow"),
    )
    return MosaicBoxAppearance(
        background = objectValue.optional("background")?.let { background(it, "$path.background") },
        border = objectValue.optional("border")?.let { border(it, "$path.border") },
        cornerRadius = objectValue.optionalLogicalSize("cornerRadius", "$path.cornerRadius"),
        opacity = objectValue.optionalNumber(
            "opacity", "$path.opacity", BigDecimal.ZERO, BigDecimal.ONE,
        ),
        padding = objectValue.optional("padding")?.let { edgeInsets(it, "$path.padding") },
        shadow = objectValue.optional("shadow")?.let { shadow(it, "$path.shadow") },
    )
}

internal fun containerAppearance(value: JsonElement, path: String): MosaicBoxAppearance {
    val objectValue = value.objectAt(path)
    if (objectValue.size() == 0) throw MosaicProtocolException("Empty appearance at $path.")
    objectValue.expectKeys(
        setOf("background", "border", "cornerRadius", "opacity", "clipContent", "shadow"),
        path,
        optional = setOf("background", "border", "cornerRadius", "opacity", "clipContent", "shadow"),
    )
    return MosaicBoxAppearance(
        background = objectValue.optional("background")?.let { background(it, "$path.background") },
        border = objectValue.optional("border")?.let { border(it, "$path.border") },
        cornerRadius = objectValue.optionalLogicalSize("cornerRadius", "$path.cornerRadius"),
        opacity = objectValue.optionalNumber(
            "opacity", "$path.opacity", BigDecimal.ZERO, BigDecimal.ONE,
        ),
        clipContent = objectValue.optionalBoolean("clipContent", "$path.clipContent"),
        shadow = objectValue.optional("shadow")?.let { shadow(it, "$path.shadow") },
    )
}

internal fun border(value: JsonElement, path: String): MosaicBorder {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(setOf("color", "width"), path)
    return MosaicBorder(
        color = color(objectValue.required("color", path), "$path.color"),
        width = objectValue.requiredLogicalSize("width", "$path.width"),
    )
}

internal fun borderOverride(value: JsonElement, path: String): MosaicBorderOverride {
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

internal fun edgeInsets(value: JsonElement, path: String): MosaicEdgeInsets {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(setOf("top", "start", "bottom", "end"), path)
    return MosaicEdgeInsets(
        top = objectValue.requiredLogicalSize("top", "$path.top"),
        start = objectValue.requiredLogicalSize("start", "$path.start"),
        bottom = objectValue.requiredLogicalSize("bottom", "$path.bottom"),
        end = objectValue.requiredLogicalSize("end", "$path.end"),
    )
}

internal fun edgeInsetsOverride(value: JsonElement, path: String): MosaicEdgeInsetsOverride {
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

internal fun safeBoxSizing(value: JsonElement, path: String): MosaicBoxSizing {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(setOf("width", "height"), path)
    return MosaicBoxSizing(
        width = widthSizing(objectValue.required("width", path), "$path.width"),
        height = heightSizing(objectValue.required("height", path), "$path.height"),
    )
}

internal fun widthSizing(value: JsonElement, path: String): MosaicWidthSizing {
    if (value.isJsonPrimitive && value.asJsonPrimitive.isString) {
        return when (value.asString) {
            "fit" -> MosaicWidthSizing.Content
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

internal fun heightSizing(value: JsonElement, path: String): MosaicHeightSizing {
    if (value.isJsonPrimitive && value.asJsonPrimitive.isString) {
        return when (value.asString) {
            "fit" -> MosaicHeightSizing.Content
            "fill" -> MosaicHeightSizing.Fill
            else -> throw MosaicProtocolException("Invalid height sizing at $path.")
        }
    }
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(setOf("mode", "value"), path)
    objectValue.requireConstant("mode", "fixed", "$path.mode")
    return MosaicHeightSizing.Fixed(
        objectValue.requiredPositiveLogicalSize("value", "$path.value"),
    )
}

internal fun visibility(value: JsonElement, path: String): MosaicVisibility {
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
        "tab" -> {
            objectValue.expectKeys(setOf("mode", "tabsId", "equals"), path)
            MosaicVisibility.TabValue(
                tabsId = objectValue.requiredIdentifier("tabsId", "$path.tabsId"),
                equals = objectValue.requiredIdentifier("equals", "$path.equals"),
            )
        }
        else -> throw MosaicProtocolException("Invalid visibility mode at $path.mode.")
    }
}

internal fun rawDesignSystem(value: JsonElement): RawDesignSystem {
    val path = "$.designSystem"
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(setOf("colors", "backgrounds", "shadows"), path)

    fun tokens(name: String): LinkedHashMap<String, RawToken> {
        val tokenPath = "$path.$name"
        val values = objectValue.required(name, path).boundedArrayAt(tokenPath, 0, 256)
        val result = linkedMapOf<String, RawToken>()
        val names = mutableSetOf<String>()
        values.forEachIndexed { index, element ->
            val itemPath = "$tokenPath[$index]"
            val item = element.objectAt(itemPath)
            item.expectKeys(setOf("id", "name", "value"), itemPath)
            val id = item.requiredIdentifier("id", "$itemPath.id")
            val displayName = item.requiredString("name", "$itemPath.name").also {
                if (it.codePointLength() !in 1..80) {
                    throw MosaicProtocolException("Invalid design token name at $itemPath.name.")
                }
            }
            if (result.containsKey(id)) {
                throw MosaicProtocolException("Duplicate $name token ID $id at $itemPath.id.")
            }
            if (!names.add(displayName)) {
                throw MosaicProtocolException("Duplicate $name token name at $itemPath.name.")
            }
            result[id] = RawToken(id, displayName, item.required("value", itemPath), itemPath)
        }
        return result
    }

    return RawDesignSystem(tokens("colors"), tokens("backgrounds"), tokens("shadows"))
}

internal fun designSystem(raw: RawDesignSystem): MosaicDesignSystem = MosaicDesignSystem(
    colors = raw.colors.values.map { token ->
        MosaicColorToken(token.id, token.name, resolveColorToken(token.id, token.path, linkedSetOf()))
    },
    backgrounds = raw.backgrounds.values.map { token ->
        MosaicBackgroundToken(
            token.id,
            token.name,
            resolveBackgroundToken(token.id, token.path, linkedSetOf()),
        )
    },
    shadows = raw.shadows.values.map { token ->
        MosaicShadowToken(token.id, token.name, resolveShadowToken(token.id, token.path, linkedSetOf()))
    },
)

internal fun color(value: JsonElement, path: String): MosaicColor =
    resolveColor(value, path, linkedSetOf())

internal fun resolveColor(
    value: JsonElement,
    path: String,
    visiting: MutableSet<String>,
): MosaicColor {
    if (value.isJsonPrimitive && value.asJsonPrimitive.isString) {
        val raw = value.stringAt(path, 1, 64)
        val semantic = MosaicSemanticColor.entries.any { it.wireName == raw }
        if (!semantic && !literalColorPattern.matches(raw)) {
            throw MosaicProtocolException("Invalid or noncanonical color at $path.")
        }
        return MosaicColor(raw)
    }
    val reference = value.objectAt(path)
    reference.expectKeys(setOf("type", "id"), path)
    reference.requireConstant("type", "colorToken", "$path.type")
    return resolveColorToken(reference.requiredIdentifier("id", "$path.id"), path, visiting)
}

internal fun resolveColorToken(id: String, path: String, visiting: MutableSet<String>): MosaicColor {
    val token = activeDesignSystem.get()?.colors?.get(id)
        ?: throw MosaicProtocolException("Unknown colour token $id at $path.")
    if (!visiting.add(id)) throw MosaicProtocolException("Cyclic colour token reference at $path.")
    return try {
        resolveColor(token.value, "${token.path}.value", visiting)
    } finally {
        visiting.remove(id)
    }
}

internal fun background(value: JsonElement, path: String): MosaicBackground =
    resolveBackground(value, path, linkedSetOf())

internal fun resolveBackground(
    value: JsonElement,
    path: String,
    visiting: MutableSet<String>,
): MosaicBackground {
    val objectValue = value.objectAt(path)
    return when (objectValue.requiredString("type", "$path.type")) {
        "color" -> {
            objectValue.expectKeys(setOf("type", "value"), path)
            MosaicBackground.Solid(color(objectValue.required("value", path), "$path.value"))
        }
        "linearGradient" -> {
            objectValue.expectKeys(setOf("type", "angle", "stops"), path)
            MosaicBackground.LinearGradient(
                objectValue.requiredNumber(
                    "angle", "$path.angle", BigDecimal.ZERO, BigDecimal("360"), false,
                ).toFloat(),
                gradientStops(objectValue.required("stops", path), "$path.stops"),
            )
        }
        "radialGradient" -> {
            objectValue.expectKeys(setOf("type", "center", "radius", "stops"), path)
            val center = objectValue.required("center", path).objectAt("$path.center")
            center.expectKeys(setOf("x", "y"), "$path.center")
            MosaicBackground.RadialGradient(
                center.requiredNumber(
                    "x", "$path.center.x", BigDecimal.ZERO, BigDecimal.ONE, false,
                ).toFloat(),
                center.requiredNumber(
                    "y", "$path.center.y", BigDecimal.ZERO, BigDecimal.ONE, false,
                ).toFloat(),
                objectValue.requiredNumber(
                    "radius", "$path.radius", BigDecimal.ZERO, BigDecimal("2"), true,
                ).toFloat(),
                gradientStops(objectValue.required("stops", path), "$path.stops"),
            )
        }
        "image" -> {
            objectValue.expectKeys(setOf("type", "assetId", "contentMode", "fallbackColor"), path)
            MosaicBackground.Image(
                objectValue.requiredIdentifier("assetId", "$path.assetId"),
                imageContentMode(objectValue, "contentMode", "$path.contentMode"),
                color(objectValue.required("fallbackColor", path), "$path.fallbackColor"),
            )
        }
        "video" -> {
            objectValue.expectKeys(
                setOf("type", "assetId", "posterAssetId", "contentMode", "fallbackColor"),
                path,
                optional = setOf("posterAssetId"),
            )
            MosaicBackground.Video(
                objectValue.requiredIdentifier("assetId", "$path.assetId"),
                objectValue.optional("posterAssetId")?.let {
                    objectValue.requiredIdentifier("posterAssetId", "$path.posterAssetId")
                },
                imageContentMode(objectValue, "contentMode", "$path.contentMode"),
                color(objectValue.required("fallbackColor", path), "$path.fallbackColor"),
            )
        }
        "backgroundToken" -> {
            objectValue.expectKeys(setOf("type", "id"), path)
            resolveBackgroundToken(
                objectValue.requiredIdentifier("id", "$path.id"),
                path,
                visiting,
            )
        }
        else -> throw MosaicProtocolException("Invalid background at $path.type.")
    }
}

internal fun resolveBackgroundToken(
    id: String,
    path: String,
    visiting: MutableSet<String>,
): MosaicBackground {
    val token = activeDesignSystem.get()?.backgrounds?.get(id)
        ?: throw MosaicProtocolException("Unknown background token $id at $path.")
    if (!visiting.add(id)) throw MosaicProtocolException("Cyclic background token reference at $path.")
    return try {
        resolveBackground(token.value, "${token.path}.value", visiting)
    } finally {
        visiting.remove(id)
    }
}

internal fun gradientStops(value: JsonElement, path: String): List<MosaicGradientStop> {
    val stops = value.boundedArrayAt(path, 2, 8).mapIndexed { index, stopElement ->
        val stopPath = "$path[$index]"
        val stop = stopElement.objectAt(stopPath)
        stop.expectKeys(setOf("position", "color"), stopPath)
        MosaicGradientStop(
            stop.requiredNumber(
                "position", "$stopPath.position", BigDecimal.ZERO, BigDecimal.ONE, false,
            ).toFloat(),
            color(stop.required("color", stopPath), "$stopPath.color"),
        )
    }
    if (stops.zipWithNext().any { (left, right) -> left.position >= right.position }) {
        throw MosaicProtocolException("Gradient stops must be strictly ordered at $path.")
    }
    return stops
}

internal fun shadow(value: JsonElement, path: String): MosaicShadow =
    resolveShadow(value, path, linkedSetOf())

internal fun resolveShadow(
    value: JsonElement,
    path: String,
    visiting: MutableSet<String>,
): MosaicShadow {
    val objectValue = value.objectAt(path)
    return when (objectValue.requiredString("type", "$path.type")) {
        "shadow" -> {
            objectValue.expectKeys(
                setOf("type", "color", "offsetX", "offsetY", "blurRadius"), path,
            )
            MosaicShadow(
                color(objectValue.required("color", path), "$path.color"),
                objectValue.requiredNumber(
                    "offsetX", "$path.offsetX", BigDecimal("-4096"), BigDecimal("4096"), false,
                ),
                objectValue.requiredNumber(
                    "offsetY", "$path.offsetY", BigDecimal("-4096"), BigDecimal("4096"), false,
                ),
                objectValue.requiredLogicalSize("blurRadius", "$path.blurRadius"),
            )
        }
        "shadowToken" -> {
            objectValue.expectKeys(setOf("type", "id"), path)
            resolveShadowToken(objectValue.requiredIdentifier("id", "$path.id"), path, visiting)
        }
        else -> throw MosaicProtocolException("Invalid shadow at $path.type.")
    }
}

internal fun resolveShadowToken(
    id: String,
    path: String,
    visiting: MutableSet<String>,
): MosaicShadow {
    val token = activeDesignSystem.get()?.shadows?.get(id)
        ?: throw MosaicProtocolException("Unknown shadow token $id at $path.")
    if (!visiting.add(id)) throw MosaicProtocolException("Cyclic shadow token reference at $path.")
    return try {
        resolveShadow(token.value, "${token.path}.value", visiting)
    } finally {
        visiting.remove(id)
    }
}

internal fun localizedText(value: JsonElement, path: String): MosaicLocalizedText {
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

internal fun textAccessibility(value: JsonElement, path: String): MosaicTextAccessibility {
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

internal fun imageAccessibility(value: JsonElement, path: String): MosaicImageAccessibility {
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

internal fun controlAccessibility(value: JsonElement, path: String): MosaicControlAccessibility {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(setOf("label", "hint"), path, optional = setOf("hint"))
    return MosaicControlAccessibility(
        label = localizedText(objectValue.required("label", path), "$path.label"),
        hint = objectValue.optional("hint")?.let { localizedText(it, "$path.hint") },
    )
}

internal fun purchaseAction(value: JsonElement, path: String): MosaicPurchaseAction {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(setOf("type", "productSelectorId"), path)
    objectValue.requireConstant("type", "purchase", "$path.type")
    return MosaicPurchaseAction(
        objectValue.requiredIdentifier("productSelectorId", "$path.productSelectorId"),
    )
}

internal fun restoreAction(value: JsonElement, path: String): MosaicRestoreAction {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(setOf("type"), path)
    objectValue.requireConstant("type", "restore", "$path.type")
    return MosaicRestoreAction
}

internal fun closeAction(value: JsonElement, path: String): MosaicCloseAction {
    val objectValue = value.objectAt(path)
    objectValue.expectKeys(setOf("type"), path)
    objectValue.requireConstant("type", "close", "$path.type")
    return MosaicCloseAction
}

internal fun buttonAction(value: JsonElement, path: String): MosaicAction {
    val objectValue = value.objectAt(path)
    return when (objectValue.requiredString("type", "$path.type")) {
        "purchase" -> purchaseAction(value, path)
        "restore" -> restoreAction(value, path)
        "close" -> closeAction(value, path)
        "navigateTo" -> {
            objectValue.expectKeys(setOf("type", "screenId"), path)
            MosaicNavigateToAction(
                objectValue.requiredIdentifier("screenId", "$path.screenId"),
            )
        }
        "navigateBack" -> {
            objectValue.expectKeys(setOf("type"), path)
            MosaicNavigateBackAction
        }
        "openExternalUrl" -> {
            objectValue.expectKeys(setOf("type", "url"), path)
            MosaicOpenExternalUrlAction(
                validateExternalUrl(objectValue.requiredString("url", "$path.url"), "$path.url"),
            )
        }
        else -> throw MosaicProtocolException("Invalid button action at $path.type.")
    }
}

internal fun validateExternalUrl(rawUrl: String, path: String): String {
    val match = externalUrlPattern.matchEntire(rawUrl)
    if (rawUrl.codePointLength() !in 1..2048 || match == null) {
        throw MosaicProtocolException("Invalid external URL at $path.")
    }
    val parsed = try {
        URI(rawUrl)
    } catch (_: Exception) {
        throw MosaicProtocolException("Invalid external URL at $path.")
    }
    val rawHost = match.groupValues[1]
    val rawPort = match.groupValues[2].takeIf(String::isNotEmpty)?.toInt()
    if (parsed.scheme != "https" || parsed.host.isNullOrBlank() || parsed.userInfo != null ||
        rawHost.contains("..") || !rawHost.equals(parsed.host, ignoreCase = true) ||
        (rawPort != null && rawPort > 65535)
    ) {
        throw MosaicProtocolException(
            "External URLs must be absolute HTTPS URLs without credentials at $path.",
        )
    }
    return rawUrl
}

internal fun optionalBoxAppearance(objectValue: JsonObject, path: String): MosaicBoxAppearance? =
    objectValue.optional("appearance")?.let { boxAppearance(it, "$path.appearance") }

internal fun optionalWidthSizing(objectValue: JsonObject, path: String): MosaicBoxSizing? =
    objectValue.optional("sizing")?.let { safeBoxSizing(it, "$path.sizing") }

internal fun optionalOuterInsets(objectValue: JsonObject, path: String): MosaicEdgeInsets? =
    objectValue.optional("outerInsets")?.let { edgeInsets(it, "$path.outerInsets") }

internal fun optionalVisibility(objectValue: JsonObject, path: String): MosaicVisibility =
    objectValue.optional("visibility")?.let { visibility(it, "$path.visibility") }
        ?: MosaicVisibility.Always

