package dev.mosaic.sdk

import com.google.gson.JsonArray
import com.google.gson.JsonParser
import java.nio.file.Files
import java.nio.file.Path
import kotlin.text.Charsets
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CanonicalFixtureTest {
    @Test
    fun decodesRepositoryCanonicalProtocolFixture() {
        val source = Files.readAllBytes(canonicalFixture()).toString(Charsets.UTF_8)
        val document = MosaicProtocolDecoder.decode(source)

        assertEquals("0.1", document.schemaVersion)
        assertEquals("minimal-paywall", document.id)
        assertEquals(1, document.revision)
        assertEquals("root-layout", document.layout.id)
        assertEquals(16.0, document.layout.gap, 0.0)
        assertEquals(24.0, document.layout.padding, 0.0)
        assertEquals(
            MosaicCapabilityName.entries.toSet(),
            document.compatibility.requiredCapabilities.map { it.name }.toSet(),
        )
        assertEquals(
            listOf(
                "closeButton",
                "text",
                "featureList",
                "productSelector",
                "purchaseButton",
                "restoreButton",
                "legalText",
            ),
            document.layout.children.map { it.type },
        )

        val close = document.layout.children[0] as MosaicCloseButtonComponent
        assertEquals("Close", close.label.defaultValue)
        val text = document.layout.children[1] as MosaicTextComponent
        assertEquals("paywall.headline", text.value.localizationKey)
        val features = document.layout.children[2] as MosaicFeatureListComponent
        assertEquals(
            listOf("unlimited-projects", "priority-support"),
            features.items.map { it.id },
        )
        val selector = document.layout.children[3] as MosaicProductSelectorComponent
        assertEquals("mosaic_pro_yearly", selector.initiallySelectedProductId)
        assertEquals(
            listOf("mosaic_pro_monthly", "mosaic_pro_yearly"),
            selector.products.map { it.productId },
        )
        assertTrue(document.layout.children[4] is MosaicPurchaseButtonComponent)
        assertTrue(document.layout.children[5] is MosaicRestoreButtonComponent)
        assertTrue(document.layout.children[6] is MosaicLegalTextComponent)
    }

    @Test
    fun rejectsFieldsOutsideFrozenProtocolSchema() {
        val source = Files.readAllBytes(canonicalFixture()).toString(Charsets.UTF_8)
        val root = JsonParser.parseString(source).asJsonObject
        root.addProperty("platform", "compose")

        assertThrows(MosaicProtocolException::class.java) {
            MosaicProtocolDecoder.decode(root.toString())
        }
    }

    @Test
    fun rejectsCapabilitiesThatDoNotMatchDocumentContent() {
        val root = canonicalFixtureObject()
        val compatibility = root.getAsJsonObject("compatibility")
        val filteredCapabilities = compatibility.getAsJsonArray("requiredCapabilities")
            .filterNot { capability ->
                capability.asJsonObject.get("name").asString == "component.legalText"
            }
        compatibility.add("requiredCapabilities", JsonArray().apply {
            filteredCapabilities.forEach(::add)
        })

        assertThrows(MosaicProtocolException::class.java) {
            MosaicProtocolDecoder.decode(root.toString())
        }
    }

    @Test
    fun rejectsInvalidProductSelectorRelationships() {
        val missingSelection = canonicalFixtureObject()
        productSelector(missingSelection).addProperty(
            "initiallySelectedProductId",
            "not_declared",
        )
        assertThrows(MosaicProtocolException::class.java) {
            MosaicProtocolDecoder.decode(missingSelection.toString())
        }

        val duplicateProduct = canonicalFixtureObject()
        val products = productSelector(duplicateProduct).getAsJsonArray("products")
        products.add(products.first().deepCopy())
        assertThrows(MosaicProtocolException::class.java) {
            MosaicProtocolDecoder.decode(duplicateProduct.toString())
        }
    }

    @Test
    fun acceptsIntegralRevisionSpellingsWithinThe32BitRange() {
        val integral = canonicalFixtureReplacing(
            "\"revision\": 1",
            "\"revision\": 1.0",
        )
        assertEquals(1, MosaicProtocolDecoder.decode(integral).revision)

        val maximum = canonicalFixtureReplacing(
            "\"revision\": 1",
            "\"revision\": 2147483647",
        )
        assertEquals(Int.MAX_VALUE, MosaicProtocolDecoder.decode(maximum).revision)
    }

    @Test
    fun rejectsRevisionsAboveThe32BitRange() {
        val source = canonicalFixtureReplacing(
            "\"revision\": 1",
            "\"revision\": 2147483648",
        )

        assertThrows(MosaicProtocolException::class.java) {
            MosaicProtocolDecoder.decode(source)
        }
    }

    @Test
    fun rejectsNonFiniteLayoutNumbers() {
        val source = canonicalFixtureReplacing(
            "\"gap\": 16",
            "\"gap\": 1e400",
        )

        assertThrows(MosaicProtocolException::class.java) {
            MosaicProtocolDecoder.decode(source)
        }
    }
}

private fun canonicalFixtureObject() = JsonParser.parseString(canonicalFixtureSource()).asJsonObject

private fun canonicalFixtureReplacing(original: String, replacement: String): String {
    val source = canonicalFixtureSource()
    check(original in source) { "Canonical fixture does not contain $original." }
    return source.replaceFirst(original, replacement)
}

private fun canonicalFixtureSource() =
    Files.readAllBytes(canonicalFixture()).toString(Charsets.UTF_8)

private fun productSelector(root: com.google.gson.JsonObject) =
    root.getAsJsonObject("layout")
        .getAsJsonArray("children")
        .first { component -> component.asJsonObject.get("type").asString == "productSelector" }
        .asJsonObject

private fun canonicalFixture(): Path {
    val configuredRoot = System.getProperty("mosaic.repositoryRoot")?.let(Path::of)
    if (configuredRoot != null) {
        val fixture = configuredRoot.resolve("protocol/fixtures/v0.1/minimal-paywall.json")
        if (Files.exists(fixture)) return fixture
    }

    var directory: Path? = Path.of("").toAbsolutePath()
    while (directory != null) {
        val fixture = directory.resolve("protocol/fixtures/v0.1/minimal-paywall.json")
        if (Files.exists(fixture)) return fixture
        directory = directory.parent
    }
    error("Cannot locate protocol/fixtures/v0.1/minimal-paywall.json in the Mosaic repository.")
}
