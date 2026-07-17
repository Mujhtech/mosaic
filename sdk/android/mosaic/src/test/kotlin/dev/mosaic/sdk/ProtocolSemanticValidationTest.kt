package dev.mosaic.sdk

import com.google.gson.JsonArray
import org.junit.Assert.assertThrows
import org.junit.Test

class ProtocolSemanticValidationTest {
    @Test
    fun rejectsUnknownRootAndNestedPropertiesAtomically() {
        canonicalFixtureObject().also { root ->
            root.addProperty("platform", "android")
            assertRejected(root.toString())
        }
        canonicalFixtureObject().also { root ->
            findNode(root, "headline").addProperty("maxLines", 1)
            assertRejected(root.toString())
        }
    }

    @Test
    fun rejectsUnknownComponentsAndUnsupportedCapabilities() {
        canonicalFixtureObject().also { root ->
            findNode(root, "headline").addProperty("type", "androidText")
            assertRejected(root.toString())
        }

        val report = MosaicProtocolCapabilities.report().copy(
            supportedCapabilities = MosaicProtocolCapabilities.report().supportedCapabilities -
                MosaicCapabilityName.IMAGE,
        )
        assertThrows(MosaicProtocolException::class.java) {
            MosaicProtocolDecoder.decode(canonicalFixtureSource(), report)
        }
    }

    @Test
    fun rejectsDuplicateIdsAndBrokenAssetReferences() {
        canonicalFixtureObject().also { root ->
            findNode(root, "subtitle").addProperty("id", "headline")
            assertRejected(root.toString())
        }
        canonicalFixtureObject().also { root ->
            findNode(root, "hero").addProperty("assetId", "missing-image")
            assertRejected(root.toString())
        }
    }

    @Test
    fun rejectsBrokenProductSelectionAndPurchaseActionReferences() {
        canonicalFixtureObject().also { root ->
            findNode(root, "plans").addProperty(
                "initiallySelectedProductReferenceId",
                "missing-plan",
            )
            assertRejected(root.toString())
        }
        canonicalFixtureObject().also { root ->
            findNode(root, "purchase").getAsJsonObject("action")
                .addProperty("productSelectorId", "missing-selector")
            assertRejected(root.toString())
        }
    }

    @Test
    fun rejectsCapabilityDeclarationsThatDoNotExactlyMatchRecursiveContent() {
        val root = canonicalFixtureObject()
        val compatibility = root.getAsJsonObject("compatibility")
        val filtered = compatibility.getAsJsonArray("requiredCapabilities")
            .filterNot { it.asJsonObject.get("name").asString == "layout.verticalStack" }
        compatibility.add("requiredCapabilities", JsonArray().apply { filtered.forEach(::add) })

        assertRejected(root.toString())
    }

    @Test
    fun rejectsInvalidLocalizationCatalogAndInlineDefault() {
        canonicalFixtureObject().also { root ->
            root.getAsJsonObject("localization")
                .getAsJsonObject("locales")
                .getAsJsonObject("en")
                .getAsJsonObject("strings")
                .addProperty("paywall.headline", "Different default")
            assertRejected(root.toString())
        }
        canonicalFixtureObject().also { root ->
            root.getAsJsonObject("localization")
                .getAsJsonObject("locales")
                .getAsJsonObject("de")
                .getAsJsonObject("strings")
                .addProperty("paywall.android_only", "Nicht erlaubt")
            assertRejected(root.toString())
        }
    }

    @Test
    fun rejectsInvalidAccessibilityAndFallbackShapes() {
        canonicalFixtureObject().also { root ->
            findNode(root, "hero").getAsJsonObject("accessibility").remove("label")
            assertRejected(root.toString())
        }
        canonicalFixtureObject().also { root ->
            findNode(root, "plans").getAsJsonObject("unavailableFallback")
                .addProperty("selection", "androidDefault")
            assertRejected(root.toString())
        }
    }

    @Test
    fun rejectsOutOfRangeOrNonFiniteLayoutNumbers() {
        assertRejected(
            canonicalFixtureReplacing("\"spacing\": 20", "\"spacing\": 1e400"),
        )
        assertRejected(
            canonicalFixtureReplacing("\"aspectRatio\": 1.7777777777777777", "\"aspectRatio\": 0"),
        )
    }

    private fun assertRejected(source: String) {
        assertThrows(MosaicProtocolException::class.java) {
            MosaicProtocolDecoder.decode(source)
        }
    }
}
