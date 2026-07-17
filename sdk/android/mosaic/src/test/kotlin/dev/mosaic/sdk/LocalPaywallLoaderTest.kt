package dev.mosaic.sdk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalPaywallLoaderTest {
    @Test
    fun validPrimaryWinsWithoutReadingFallback() {
        var fallbackReads = 0
        val loader = MosaicLocalPaywallLoader(
            bundledFallback = MosaicPaywallDocumentSource {
                fallbackReads += 1
                canonicalFixtureSource()
            },
        )

        val result = loader.load(canonicalFixtureSource()) as MosaicPaywallLoadResult.Loaded

        assertEquals(MosaicPaywallSource.PRIMARY, result.source)
        assertEquals(0, fallbackReads)
    }

    @Test
    fun invalidPrimaryAtomicallyUsesCanonicalBundledFallback() {
        val diagnostics = mutableListOf<MosaicDiagnostic>()
        val loader = MosaicLocalPaywallLoader(
            bundledFallback = MosaicPaywallDocumentSource(::canonicalFixtureSource),
            diagnostics = MosaicDiagnosticSink(diagnostics::add),
        )

        val result = loader.load("{\"schemaVersion\":\"9.9\"}")

        assertTrue(result is MosaicPaywallLoadResult.Loaded)
        assertEquals(MosaicPaywallSource.BUNDLED_FALLBACK, (result as MosaicPaywallLoadResult.Loaded).source)
        assertEquals(
            listOf(MosaicDiagnosticCode.PRIMARY_DOCUMENT_REJECTED),
            diagnostics.map { it.code },
        )
    }

    @Test
    fun missingOrInvalidFallbackReturnsConfigurationUnavailable() {
        assertTrue(
            MosaicLocalPaywallLoader(MosaicPaywallDocumentSource { null })
                .load(null) is MosaicPaywallLoadResult.ConfigurationUnavailable,
        )
        val invalid = MosaicLocalPaywallLoader(MosaicPaywallDocumentSource { "{}" }).load(null)
        assertTrue(invalid is MosaicPaywallLoadResult.ConfigurationUnavailable)
        assertEquals(
            "configurationUnavailable",
            (invalid as MosaicPaywallLoadResult.ConfigurationUnavailable).presentationResult.wireName,
        )
    }
}
