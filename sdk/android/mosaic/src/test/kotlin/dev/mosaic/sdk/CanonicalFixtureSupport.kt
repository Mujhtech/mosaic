package dev.mosaic.sdk

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.nio.file.Files
import java.nio.file.Path
import kotlin.text.Charsets

internal fun canonicalFixtureSource(): String =
    Files.readAllBytes(canonicalFixture()).toString(Charsets.UTF_8)

internal fun canonicalFixtureObject(): JsonObject =
    JsonParser.parseString(canonicalFixtureSource()).asJsonObject

internal fun canonicalDocument(): MosaicPaywallDocument =
    MosaicProtocolDecoder.decode(canonicalFixtureSource())

internal fun canonicalFixtureReplacing(original: String, replacement: String): String {
    val source = canonicalFixtureSource()
    check(original in source) { "Canonical fixture does not contain $original." }
    return source.replaceFirst(original, replacement)
}

internal fun findNode(root: JsonObject, id: String): JsonObject {
    fun find(element: JsonElement): JsonObject? {
        if (!element.isJsonObject) return null
        val objectValue = element.asJsonObject
        if (objectValue.get("id")?.asString == id) return objectValue
        objectValue.getAsJsonArray("children")?.forEach { child ->
            find(child)?.let { return it }
        }
        objectValue.getAsJsonArray("inProgressChildren")?.forEach { child ->
            find(child)?.let { return it }
        }
        objectValue.getAsJsonArray("cards")?.forEach { card ->
            find(card)?.let { return it }
        }
        objectValue.getAsJsonObject("content")?.let { content ->
            find(content)?.let { return it }
        }
        objectValue.getAsJsonArray("pages")?.forEach { page ->
            page.takeIf(JsonElement::isJsonObject)?.asJsonObject
                ?.getAsJsonObject("content")
                ?.let { content -> find(content)?.let { return it } }
        }
        return null
    }
    root.getAsJsonArray("screens")?.forEach { screen ->
        screen.takeIf(JsonElement::isJsonObject)?.asJsonObject
            ?.getAsJsonObject("layout")
            ?.let { layout -> find(layout)?.let { return it } }
    }
    root.getAsJsonObject("layout")?.let { layout -> find(layout)?.let { return it } }
    error("Missing node $id.")
}

private fun canonicalFixture(): Path {
    return repositoryFile("protocol/fixtures/v0.1/complete-paywall.json")
}

internal fun repositoryFile(relativePath: String): Path {
    val configuredRoot = System.getProperty("mosaic.repositoryRoot")?.let(Path::of)
    if (configuredRoot != null) {
        val fixture = configuredRoot.resolve(relativePath)
        if (Files.exists(fixture)) return fixture
    }

    var directory: Path? = Path.of("").toAbsolutePath()
    while (directory != null) {
        val fixture = directory.resolve(relativePath)
        if (Files.exists(fixture)) return fixture
        directory = directory.parent
    }
    error("Cannot locate $relativePath in the Mosaic repository.")
}
