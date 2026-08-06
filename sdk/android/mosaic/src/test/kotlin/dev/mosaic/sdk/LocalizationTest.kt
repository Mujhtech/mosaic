package dev.mosaic.sdk

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalizationTest {
    private val headline = canonicalDocument().layout.content.walkDepthFirst()
        .filterIsInstance<MosaicTextComponent>()
        .first { it.id == "headline" }

    @Test
    fun resolvesExactBaseFallbackAndDefaultCandidatesInOrder() {
        val localization = canonicalDocument().localization

        val exactGerman = MosaicLocalizationResolver(localization, "de")
        assertEquals("de", exactGerman.resolvedLocale(headline.value))
        assertTrue(exactGerman.resolve(headline.value).startsWith("Schalte sämtliche"))

        val baseGerman = MosaicLocalizationResolver(localization, "de-DE")
        assertEquals(listOf("de-DE", "de", "en"), baseGerman.localeCandidates)
        assertEquals(exactGerman.resolve(headline.value), baseGerman.resolve(headline.value))

        val fallbackEnglish = MosaicLocalizationResolver(localization, "fr-FR")
        assertEquals("Unlock every Mosaic Pro feature", fallbackEnglish.resolve(headline.value))

        val noRequest = MosaicLocalizationResolver(localization, null)
        assertEquals(listOf("en"), noRequest.localeCandidates)
        assertEquals("Unlock every Mosaic Pro feature", noRequest.resolve(headline.value))
    }

    /**
     * The cross-SDK corpus for Protocol 0.2 locale resolution. Binding it here is what keeps
     * Android's candidate order and canonicalization identical to
     * `protocol/tools/locale-resolution-v0.2.mjs` rather than merely similar: the corpus pins the
     * numeric-region catalog, the non-canonical `PT_br` spelling, the script subtag reducing to its
     * base language and never to language plus region, and an unusable request contributing no
     * candidate at all.
     */
    @Test
    fun canonicalLocaleResolutionCorpusResolvesExactly() {
        val corpus = JsonParser.parseString(
            repositoryFile("protocol/fixtures/v0.2/locale-resolution.json").toFile().readText(),
        ).asJsonObject
        val declared = corpus.getAsJsonObject("localization")
        // One catalog per declared key, each holding the same key with its own tag as the value, so
        // the resolved string names the catalog that was actually selected.
        val localization = MosaicLocalization(
            defaultLocale = declared.get("defaultLocale").asString,
            fallbackLocale = declared.get("fallbackLocale").asString,
            locales = declared.getAsJsonArray("locales").associate { element ->
                val tag = element.asString
                tag to MosaicLocaleCatalog(MosaicLayoutDirection.LTR, mapOf("paywall.headline" to tag))
            },
        )
        val value = MosaicLocalizedText(defaultValue = "inline default", localizationKey = "paywall.headline")

        // A `forEach` over an empty or renamed array passes silently, which would report full
        // conformance against zero cases. The floor is the corpus as ruled; it only ever rises.
        assertTrue("locale resolution corpus is empty", corpus.getAsJsonArray("cases").size() >= 13)

        corpus.getAsJsonArray("cases").map { it.asJsonObject }.forEach { case ->
            val name = case.get("name").asString
            val resolver = MosaicLocalizationResolver(localization, case.get("requested").asString)
            assertEquals(
                name,
                case.getAsJsonArray("expectedCandidates").map { it.asString },
                resolver.localeCandidates,
            )
            val expectedCatalog = case.get("expectedCatalog").takeUnless { it.isJsonNull }?.asString
            assertEquals(name, expectedCatalog, resolver.resolvedLocale(value))
            assertEquals(name, expectedCatalog ?: value.defaultValue, resolver.resolve(value))
        }
    }

    /**
     * Catalog keys are authored in one canonical form; the requested locale is whatever the host
     * hands us. The two obvious Android sources are not that form:
     * `Locale.getDefault().toLanguageTag()` carries Unicode extensions on a region-override device
     * (`en-US-u-rg-gbzzzz`) and `Locale.toString()` is underscore-separated (`en_US`). Matched raw,
     * the first misses `en-US` and quietly falls to the bare `en` catalog, and the second misses
     * even the base-language step — the pre-ruling `^[a-z]{2,3}$` guard rejected `en_US` — so the
     * user reads the document's default language. Direction rides the same chain, so an Egyptian
     * Arabic device laid out left-to-right is the same defect, which is why RTL is asserted here.
     */
    @Test
    fun rawHostAndDeviceLocaleShapesResolveTheRegionalCatalog() {
        val root = canonicalFixtureObject()
        val locales = root.getAsJsonObject("localization").getAsJsonObject("locales")
        fun catalog(direction: String, headline: String) = JsonObject().apply {
            addProperty("direction", direction)
            add("strings", JsonObject().apply { addProperty("paywall.headline", headline) })
        }
        locales.add("en-US", catalog("ltr", "Unlock every Mosaic Pro feature, in US English"))
        locales.add("ar-EG", catalog("rtl", "افتح جميع مزايا Mosaic Pro في مصر"))
        val document = MosaicProtocolDecoder.decode(root.toString())
        val value = document.layout.content.walkDepthFirst()
            .filterIsInstance<MosaicTextComponent>()
            .first { it.id == "headline" }
            .value

        // Every shape one US device can be described by must reach the same regional catalog.
        listOf(
            "en-US",
            "en-US-u-rg-gbzzzz",
            "en_US",
            "en_US_#u-rg-gbzzzz",
            "en-US-u-ca-japanese-fw-mon-mu-celsius",
        ).forEach { requested ->
            val resolver = MosaicLocalizationResolver(document.localization, requested)
            assertEquals(requested, listOf("en-US", "en"), resolver.localeCandidates)
            assertEquals(requested, "en-US", resolver.resolvedLocale(value))
            assertEquals(requested, "Unlock every Mosaic Pro feature, in US English", resolver.resolve(value))
            assertEquals(requested, MosaicLayoutDirection.LTR, resolver.direction)
        }

        listOf("ar-EG", "ar_EG", "ar-EG-u-nu-arab").forEach { requested ->
            val resolver = MosaicLocalizationResolver(document.localization, requested)
            assertEquals(requested, "ar-EG", resolver.resolvedLocale(value))
            assertEquals(requested, MosaicLayoutDirection.RTL, resolver.direction)
        }

        // Nothing usable must defer to the document's own default rather than to an `en` catalog,
        // which is why the resolver normalizes without the helper's last-resort tag.
        listOf("@calendar=chinese", "   ").forEach { requested ->
            val resolver = MosaicLocalizationResolver(document.localization, requested)
            assertEquals(requested, listOf("en"), resolver.localeCandidates)
        }
    }

    @Test
    fun longGermanAndArabicRtlLiveInTheSameCanonicalDocument() {
        val document = canonicalDocument()
        val subtitle = document.layout.content.walkDepthFirst()
            .filterIsInstance<MosaicTextComponent>()
            .first { it.id == "subtitle" }

        val german = MosaicLocalizationResolver(document.localization, "de-DE")
        assertTrue(german.resolve(subtitle.value).length > subtitle.value.defaultValue.length)
        assertEquals(MosaicLayoutDirection.LTR, german.direction)

        val arabic = MosaicLocalizationResolver(document.localization, "ar")
        assertEquals(MosaicLayoutDirection.RTL, arabic.direction)
        assertEquals("افتح جميع مزايا Mosaic Pro", arabic.resolve(headline.value))
    }

    @Test
    fun directionUsesFirstDeclaredCandidateEvenWhenStringFallsBack() {
        val root = canonicalFixtureObject()
        root.getAsJsonObject("localization")
            .getAsJsonObject("locales")
            .getAsJsonObject("ar")
            .getAsJsonObject("strings")
            .remove("paywall.legal")
        val document = MosaicProtocolDecoder.decode(root.toString())
        val legal = document.layout.content.walkDepthFirst()
            .filterIsInstance<MosaicTextComponent>()
            .single { it.id == "legal" }
        val resolver = MosaicLocalizationResolver(document.localization, "ar")

        assertEquals(MosaicLayoutDirection.RTL, resolver.direction)
        assertEquals("en", resolver.resolvedLocale(legal.value))
        assertEquals(legal.value.defaultValue, resolver.resolve(legal.value))
    }
}
