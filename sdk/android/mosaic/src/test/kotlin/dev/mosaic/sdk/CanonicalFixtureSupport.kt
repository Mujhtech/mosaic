package dev.mosaic.sdk

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.nio.file.Files
import java.nio.file.Path
import kotlin.text.Charsets

/**
 * The one canonical paywall corpus, at the one contract version there is.
 *
 * Every suite reads fixtures through these helpers rather than composing its own path, so the
 * corpus moves in one place. Before ADR-0028 there were two of each of these — one per version —
 * and the pair is what let a rule be asserted against one corpus and silently unasserted against
 * the other.
 */
private const val PROTOCOL_FIXTURE_DIRECTORY = "protocol/fixtures/v0.4"

internal fun protocolFixtureSource(relativeName: String): String =
    Files.readAllBytes(repositoryFile("$PROTOCOL_FIXTURE_DIRECTORY/$relativeName"))
        .toString(Charsets.UTF_8)

internal fun protocolFixtureObject(relativeName: String): JsonObject =
    JsonParser.parseString(protocolFixtureSource(relativeName)).asJsonObject

internal fun protocolFixtureDocument(relativeName: String): MosaicPaywallDocument =
    MosaicProtocolDecoder.decode(protocolFixtureSource(relativeName))

internal fun protocolFixtureNames(relativeDirectory: String): List<String> =
    repositoryFixtureNames("$PROTOCOL_FIXTURE_DIRECTORY/$relativeDirectory")

/**
 * Every `.json` fixture in a repository directory, sorted, minus `rejection-layers.json`.
 *
 * That one file is generated metadata describing *which layer* rejects each of its siblings, not a
 * document any reader is meant to accept or refuse, so it is excluded here rather than at each call
 * site. Enumerating from disk is what makes a fixture the protocol agent adds swept on the day it
 * lands instead of on the day somebody remembers to edit a list.
 */
internal fun repositoryFixtureNames(relativeDirectory: String): List<String> =
    Files.list(repositoryFile(relativeDirectory)).use { paths ->
        paths.map { it.fileName.toString() }
            .filter { it.endsWith(".json") && it != "rejection-layers.json" }
            .sorted()
            .toList()
    }

internal fun canonicalFixtureSource(): String = protocolFixtureSource(CANONICAL_FIXTURE_NAME)

internal fun canonicalFixtureObject(): JsonObject = protocolFixtureObject(CANONICAL_FIXTURE_NAME)

internal fun canonicalDocument(): MosaicPaywallDocument =
    protocolFixtureDocument(CANONICAL_FIXTURE_NAME)

private const val CANONICAL_FIXTURE_NAME = "complete-paywall.json"

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
        objectValue.getAsJsonArray("tabs")?.forEach { tab ->
            tab.takeIf(JsonElement::isJsonObject)?.asJsonObject
                ?.getAsJsonObject("content")
                ?.let { content -> find(content)?.let { return it } }
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
