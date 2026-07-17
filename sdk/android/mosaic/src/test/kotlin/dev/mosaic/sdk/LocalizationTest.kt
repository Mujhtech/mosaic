package dev.mosaic.sdk

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
            .filterIsInstance<MosaicLegalTextComponent>()
            .single()
        val resolver = MosaicLocalizationResolver(document.localization, "ar")

        assertEquals(MosaicLayoutDirection.RTL, resolver.direction)
        assertEquals("en", resolver.resolvedLocale(legal.value))
        assertEquals(legal.value.defaultValue, resolver.resolve(legal.value))
    }
}
