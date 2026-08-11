package dev.mosaic.sdk

import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParseException
import com.google.gson.JsonParser
import java.math.BigDecimal

/** Strict JSON reader/writer for exact Local Preview 0.3 sessions. */

internal fun previewParseDocument(source: String): JsonElement = try {
    JsonParser.parseString(source).also {
        if (!it.isJsonObject) throw MosaicPreviewCodecException("The preview document must be an object.")
    }
} catch (error: MosaicPreviewCodecException) {
    throw error
} catch (_: Exception) {
    throw MosaicPreviewCodecException("The preview document is not valid JSON.")
}

internal fun previewObjectOf(vararg entries: Pair<String, JsonElement?>): JsonObject = JsonObject().apply {
    entries.forEach { (key, value) -> if (value != null) add(key, value) }
}

internal fun previewArrayOf(values: List<JsonElement>): JsonArray = JsonArray().apply {
    values.forEach(::add)
}
internal fun previewJson(value: String): JsonElement = com.google.gson.JsonPrimitive(value)
internal fun previewJson(value: Number): JsonElement = com.google.gson.JsonPrimitive(value)

internal fun JsonObject.previewRequired(name: String, path: String): JsonElement = get(name)
    ?: throw MosaicPreviewCodecException("Missing property $name at $path.")

internal fun JsonObject.previewOptional(name: String): JsonElement? = get(name)

internal fun JsonObject.previewRequiredString(name: String, path: String): String =
    previewRequired(name, path.substringBeforeLast('.', path)).previewStringAt(path)

internal fun JsonObject.previewRequiredPatternString(
    name: String,
    path: String,
    minLength: Int,
    maxLength: Int,
    pattern: Regex,
): String = previewRequired(name, path.substringBeforeLast('.', path))
    .previewPatternStringAt(path, minLength, maxLength, pattern)

internal fun JsonObject.previewRequiredSingleLine(
    name: String,
    path: String,
    minLength: Int,
    maxLength: Int,
): String = previewRequired(name, path.substringBeforeLast('.', path)).previewSingleLineAt(path, minLength, maxLength)

internal fun JsonObject.previewRequiredSafeDisplayName(name: String, path: String): String =
    previewRequiredSingleLine(name, path, 1, 80)

internal fun JsonObject.previewRequiredMachineIdentifier(name: String, path: String): String =
    previewRequiredPatternString(name, path, 1, 128, previewMachineIdentifierPattern)

internal fun JsonObject.previewRequiredSemanticVersion(name: String, path: String): String =
    previewRequiredPatternString(name, path, 1, 64, previewSemanticVersionPattern)

internal fun JsonObject.previewRequiredClientId(name: String, path: String): String =
    previewRequiredPatternString(name, path, 8, 100, previewClientIdPattern)

internal fun JsonObject.previewRequiredDocumentId(name: String, path: String): String =
    previewRequiredPatternString(name, path, 10, 100, previewDocumentIdPattern)

internal fun JsonObject.previewRequiredComponentId(name: String, path: String): String =
    previewRequiredPatternString(name, path, 1, 128, previewComponentIdPattern)

internal fun JsonObject.previewRequiredInteger(name: String, path: String, range: IntRange): Int =
    previewRequired(name, path.substringBeforeLast('.', path)).previewIntegerAt(path, range)

internal fun JsonObject.previewRequiredNumber(name: String, path: String, range: ClosedRange<Double>): Double =
    previewRequired(name, path.substringBeforeLast('.', path)).previewNumberAt(path, range)

internal fun JsonElement.previewStringAt(path: String): String {
    if (!isJsonPrimitive || !asJsonPrimitive.isString) {
        throw MosaicPreviewCodecException("Expected a string at $path.")
    }
    return asString
}

internal fun JsonElement.previewPatternStringAt(
    path: String,
    minLength: Int,
    maxLength: Int,
    pattern: Regex,
): String = previewSingleLineAt(path, minLength, maxLength).also {
    if (!pattern.matches(it)) throw MosaicPreviewCodecException("Invalid string value at $path.")
}

internal fun JsonElement.previewSingleLineAt(path: String, minLength: Int, maxLength: Int): String =
    previewStringAt(path).also {
        if (it.codePointCount(0, it.length) !in minLength..maxLength || '\r' in it || '\n' in it) {
            throw MosaicPreviewCodecException("Invalid string length or line break at $path.")
        }
    }

internal fun JsonElement.previewSafeTextAt(path: String): String = previewSingleLineAt(path, 1, 512)

internal fun JsonElement.previewSemanticVersionAt(path: String): String =
    previewPatternStringAt(path, 1, 64, previewSemanticVersionPattern)

internal fun JsonElement.previewIntegerAt(path: String, range: IntRange): Int {
    if (!isJsonPrimitive || !asJsonPrimitive.isNumber) {
        throw MosaicPreviewCodecException("Expected an integer at $path.")
    }
    val decimal = runCatching { asBigDecimal }.getOrNull()
        ?: throw MosaicPreviewCodecException("Expected an integer at $path.")
    val normalized = decimal.stripTrailingZeros()
    if (normalized.scale() > 0 || decimal < BigDecimal(range.first) || decimal > BigDecimal(range.last)) {
        throw MosaicPreviewCodecException("Integer is outside its range at $path.")
    }
    return decimal.toInt()
}

internal fun JsonElement.previewNumberAt(path: String, range: ClosedRange<Double>): Double {
    if (!isJsonPrimitive || !asJsonPrimitive.isNumber) {
        throw MosaicPreviewCodecException("Expected a number at $path.")
    }
    val value = runCatching { asBigDecimal.toDouble() }.getOrNull()
        ?: throw MosaicPreviewCodecException("Expected a number at $path.")
    if (!value.isFinite() || value !in range) {
        throw MosaicPreviewCodecException("Number is outside its range at $path.")
    }
    return value
}

internal fun JsonElement.previewObjectAt(path: String): JsonObject {
    if (!isJsonObject) throw MosaicPreviewCodecException("Expected an object at $path.")
    return asJsonObject
}

internal fun JsonElement.previewArrayAt(path: String): JsonArray {
    if (!isJsonArray) throw MosaicPreviewCodecException("Expected an array at $path.")
    return asJsonArray
}

internal fun JsonArray.previewBounded(min: Int, max: Int, path: String): JsonArray = also {
    if (size() !in min..max) throw MosaicPreviewCodecException("Array size is outside its range at $path.")
}

internal fun JsonObject.previewExpectKeys(
    expected: Set<String>,
    path: String,
    previewOptional: Set<String> = emptySet(),
) {
    val actual = keySet()
    val missing = (expected - previewOptional) - actual
    val unknown = actual - expected
    if (missing.isNotEmpty()) {
        throw MosaicPreviewCodecException("Missing properties ${missing.sorted().joinToString()} at $path.")
    }
    if (unknown.isNotEmpty()) {
        throw MosaicPreviewCodecException("Unknown properties ${unknown.sorted().joinToString()} at $path.")
    }
}

internal fun <T> previewRequireUnique(values: List<T>, path: String) {
    if (values.distinct().size != values.size) {
        throw MosaicPreviewCodecException("Duplicate entries are not allowed at $path.")
    }
}
