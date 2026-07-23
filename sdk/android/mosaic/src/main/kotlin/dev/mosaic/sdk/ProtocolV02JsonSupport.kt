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


internal fun walkRawNodes(root: JsonObject): Sequence<JsonObject> = sequence {
    yield(root)
    when (root.get("type")?.asString) {
        "scrollContainer" -> yieldAll(walkRawNodes(root.getAsJsonObject("content")))
        "stack" -> root.getAsJsonArray("children").forEach { child ->
            yieldAll(walkRawNodes(child.asJsonObject))
        }
        "carousel" -> root.getAsJsonArray("pages").forEach { page ->
            yieldAll(walkRawNodes(page.asJsonObject.getAsJsonObject("content")))
        }
        "button" -> {
            root.getAsJsonArray("children").forEach { child ->
                yieldAll(walkRawNodes(child.asJsonObject))
            }
            if (root.hasNonNull("inProgressChildren")) {
                root.getAsJsonArray("inProgressChildren").forEach { child ->
                    yieldAll(walkRawNodes(child.asJsonObject))
                }
            }
        }
        "productSelector" -> root.getAsJsonArray("cards").forEach { card ->
            yieldAll(walkRawNodes(card.asJsonObject))
        }
        "productCard", "productBadge" -> root.getAsJsonArray("children").forEach { child ->
            yieldAll(walkRawNodes(child.asJsonObject))
        }
    }
}

internal val colorFieldNames = setOf(
    "background", "color", "markerColor", "offTrackColor", "onTrackColor",
    "productLabelColor", "runtimePriceColor", "textColor", "thumbColor",
)

internal fun objectUsesColor(value: JsonElement): Boolean = when {
    value.isJsonArray -> value.asJsonArray.any(::objectUsesColor)
    value.isJsonObject -> value.asJsonObject.entrySet().any { (key, entry) ->
        (key in colorFieldNames &&
            (entry.isJsonPrimitive && entry.asJsonPrimitive.isString ||
                entry.isJsonObject && entry.asJsonObject.get("type")?.asString == "colorToken")) ||
            objectUsesColor(entry)
    }
    else -> false
}

internal fun objectContainsType(value: JsonElement, types: Set<String>): Boolean = when {
    value.isJsonArray -> value.asJsonArray.any { objectContainsType(it, types) }
    value.isJsonObject -> {
        val objectValue = value.asJsonObject
        objectValue.get("type")?.takeIf { it.isJsonPrimitive }?.asString in types ||
            objectValue.entrySet().any { (_, entry) -> objectContainsType(entry, types) }
    }
    else -> false
}

internal fun objectContainsField(value: JsonElement, field: String): Boolean = when {
    value.isJsonArray -> value.asJsonArray.any { objectContainsField(it, field) }
    value.isJsonObject -> value.asJsonObject.has(field) ||
        value.asJsonObject.entrySet().any { (_, entry) -> objectContainsField(entry, field) }
    else -> false
}

internal fun stackDirection(objectValue: JsonObject, name: String, path: String) =
    when (objectValue.requiredString(name, path)) {
        "vertical" -> MosaicStackDirection.VERTICAL
        "horizontal" -> MosaicStackDirection.HORIZONTAL
        else -> throw MosaicProtocolException("Invalid stack direction at $path.")
    }

internal fun mainAxisDistribution(objectValue: JsonObject, name: String, path: String) =
    when (objectValue.requiredString(name, path)) {
        "start" -> MosaicMainAxisDistribution.START
        "center" -> MosaicMainAxisDistribution.CENTER
        "end" -> MosaicMainAxisDistribution.END
        "spaceBetween" -> MosaicMainAxisDistribution.SPACE_BETWEEN
        else -> throw MosaicProtocolException("Invalid main-axis distribution at $path.")
    }

internal fun crossAxisAlignment(objectValue: JsonObject, name: String, path: String) =
    when (objectValue.requiredString(name, path)) {
        "start" -> MosaicHorizontalAlignment.START
        "center" -> MosaicHorizontalAlignment.CENTER
        "end" -> MosaicHorizontalAlignment.END
        "stretch" -> MosaicHorizontalAlignment.STRETCH
        else -> throw MosaicProtocolException("Invalid cross-axis alignment at $path.")
    }

internal fun textAlignment(objectValue: JsonObject, name: String, path: String) =
    when (objectValue.requiredString(name, path)) {
        "start" -> MosaicTextAlignment.START
        "center" -> MosaicTextAlignment.CENTER
        "end" -> MosaicTextAlignment.END
        else -> throw MosaicProtocolException("Invalid text alignment at $path.")
    }

internal fun typographyStyle(objectValue: JsonObject, name: String, path: String) =
    when (objectValue.requiredString(name, path)) {
        "display" -> MosaicTypographyStyle.DISPLAY
        "title" -> MosaicTypographyStyle.TITLE
        "heading" -> MosaicTypographyStyle.HEADING
        "body" -> MosaicTypographyStyle.BODY
        "label" -> MosaicTypographyStyle.LABEL
        "caption" -> MosaicTypographyStyle.CAPTION
        else -> throw MosaicProtocolException("Invalid typography style at $path.")
    }

internal fun fontWeight(objectValue: JsonObject, name: String, path: String) =
    when (objectValue.requiredString(name, path)) {
        "regular" -> MosaicFontWeight.REGULAR
        "medium" -> MosaicFontWeight.MEDIUM
        "semibold" -> MosaicFontWeight.SEMIBOLD
        "bold" -> MosaicFontWeight.BOLD
        else -> throw MosaicProtocolException("Invalid font weight at $path.")
    }

internal fun textOverflow(objectValue: JsonObject, name: String, path: String) =
    when (objectValue.requiredString(name, path)) {
        "clip" -> MosaicTextOverflow.CLIP
        "ellipsis" -> MosaicTextOverflow.ELLIPSIS
        else -> throw MosaicProtocolException("Invalid text overflow at $path.")
    }

internal fun imageContentMode(objectValue: JsonObject, name: String, path: String) =
    when (objectValue.requiredString(name, path)) {
        "fit" -> MosaicImageContentMode.FIT
        "fill" -> MosaicImageContentMode.FILL
        else -> throw MosaicProtocolException("Invalid image content mode at $path.")
    }

internal fun productCardContentAlignment(
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

internal fun countdownUnit(objectValue: JsonObject, name: String, path: String) =
    when (objectValue.requiredString(name, path)) {
        "day" -> MosaicCountdownUnit.DAY
        "hour" -> MosaicCountdownUnit.HOUR
        "minute" -> MosaicCountdownUnit.MINUTE
        "second" -> MosaicCountdownUnit.SECOND
        else -> throw MosaicProtocolException("Invalid countdown unit at $path.")
    }

internal fun parseCanonicalUtcTimestamp(value: String, path: String): Long {
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

internal fun requireUnique(values: List<String>, description: String) {
    if (values.toSet().size != values.size) {
        throw MosaicProtocolException("Duplicate $description are not allowed.")
    }
}

internal fun JsonObject.required(name: String, path: String): JsonElement = get(name)
    ?.takeUnless { it is JsonNull }
    ?: throw MosaicProtocolException("Missing property $name at $path.")

internal fun JsonObject.optional(name: String): JsonElement? = get(name)?.takeUnless { it is JsonNull }

internal fun JsonObject.hasNonNull(name: String): Boolean =
    has(name) && get(name) !is JsonNull

internal fun JsonObject.requiredString(name: String, path: String): String =
    required(name, path.substringBeforeLast('.', path)).stringAt(path)

internal fun JsonObject.requiredIdentifier(name: String, path: String): String =
    required(name, path.substringBeforeLast('.', path)).identifierAt(path)

internal fun JsonObject.requiredLocalizationKey(name: String, path: String): String =
    requiredString(name, path).also { validateLocalizationKey(it, path) }

internal fun JsonObject.requiredLocaleTag(name: String, path: String): String =
    requiredString(name, path).also { validateLocaleTag(it, path) }

internal fun JsonObject.requiredBoolean(name: String, path: String): Boolean {
    val value = required(name, path.substringBeforeLast('.', path))
    if (!value.isJsonPrimitive || !value.asJsonPrimitive.isBoolean) {
        throw MosaicProtocolException("Expected a boolean at $path.")
    }
    return value.asBoolean
}

internal fun JsonObject.optionalBoolean(name: String, path: String): Boolean? =
    optional(name)?.let { value ->
        if (!value.isJsonPrimitive || !value.asJsonPrimitive.isBoolean) {
            throw MosaicProtocolException("Expected a boolean at $path.")
        }
        value.asBoolean
    }

internal fun JsonObject.requiredPositiveInteger(name: String, path: String): Int {
    val number = requiredDecimal(name, path)
    if (number.stripTrailingZeros().scale() > 0 ||
        number < BigDecimal.ONE ||
        number > BigDecimal(Int.MAX_VALUE)
    ) {
        throw MosaicProtocolException("Expected a 32-bit positive integer at $path.")
    }
    return number.intValueExact()
}

internal fun JsonObject.requiredIntegerInRange(name: String, path: String, range: IntRange): Int {
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

internal fun JsonObject.requiredLogicalSize(name: String, path: String): Double = requiredNumber(
    name,
    path,
    BigDecimal.ZERO,
    BigDecimal("4096"),
)

internal fun JsonObject.requiredPositiveLogicalSize(name: String, path: String): Double =
    requiredNumber(
        name,
        path,
        BigDecimal.ZERO,
        BigDecimal("4096"),
        exclusiveMinimum = true,
    )

internal fun JsonObject.optionalLogicalSize(name: String, path: String): Double? =
    optionalNumber(name, path, BigDecimal.ZERO, BigDecimal("4096"))

internal fun JsonObject.requiredNumber(
    name: String,
    path: String,
    minimum: BigDecimal,
    maximum: BigDecimal,
    exclusiveMinimum: Boolean = false,
): Double {
    val decimal = requiredDecimal(name, path)
    return checkedNumber(decimal, path, minimum, maximum, exclusiveMinimum)
}

internal fun JsonObject.optionalNumber(
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

internal fun checkedNumber(
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

internal fun JsonObject.requiredDecimal(name: String, path: String): BigDecimal {
    val value = required(name, path.substringBeforeLast('.', path))
    if (!value.isJsonPrimitive || !value.asJsonPrimitive.isNumber) {
        throw MosaicProtocolException("Expected a number at $path.")
    }
    return runCatching { value.asBigDecimal }.getOrElse {
        throw MosaicProtocolException("Expected a finite JSON number at $path.")
    }
}

internal fun JsonObject.requireConstant(name: String, expected: String, path: String) {
    if (requiredString(name, path) != expected) {
        throw MosaicProtocolException("Expected $expected at $path.")
    }
}

internal fun JsonElement.stringAt(
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

internal fun JsonElement.identifierAt(path: String): String = stringAt(path, 1, 128).also {
    if (!identifierPattern.matches(it)) throw MosaicProtocolException("Invalid identifier at $path.")
}

internal fun validateLocalizationKey(value: String, path: String) {
    if (value.codePointLength() > 256 || !localizationKeyPattern.matches(value)) {
        throw MosaicProtocolException("Invalid localization key at $path.")
    }
}

internal fun validateLocaleTag(value: String, path: String) {
    if (!localeTagPattern.matches(value)) {
        throw MosaicProtocolException("Invalid locale tag at $path.")
    }
}

internal fun JsonElement.objectAt(path: String): JsonObject {
    if (!isJsonObject) throw MosaicProtocolException("Expected an object at $path.")
    return asJsonObject
}

internal fun JsonElement.arrayAt(path: String): JsonArray {
    if (!isJsonArray) throw MosaicProtocolException("Expected an array at $path.")
    return asJsonArray
}

internal fun JsonElement.boundedArrayAt(path: String, minimum: Int, maximum: Int): JsonArray =
    arrayAt(path).also {
        if (it.size() !in minimum..maximum) {
            throw MosaicProtocolException("Array size is outside its range at $path.")
        }
    }

internal fun JsonObject.expectKeys(
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

internal fun JsonObject.getAsJsonObjectOrNull(name: String): JsonObject? =
    get(name)?.takeIf { it.isJsonObject }?.asJsonObject

internal fun String.codePointLength(): Int = codePointCount(0, length)
