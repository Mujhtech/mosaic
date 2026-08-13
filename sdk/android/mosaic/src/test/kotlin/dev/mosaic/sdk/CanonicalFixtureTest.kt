package dev.mosaic.sdk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CanonicalFixtureTest {
    @Test
    fun decodesRepositoryCanonicalProtocolFixtureDirectly() {
        val document = canonicalDocument()

        assertEquals(MOSAIC_PROTOCOL_VERSION, document.schemaVersion)
        assertEquals("phase1-complete-paywall", document.id)
        assertEquals(1, document.revision)
        assertEquals("paywall-scroll", document.layout.id)
        assertTrue(document.layout.showsIndicators)
        assertEquals("paywall-content", document.layout.content.id)
        assertEquals(20.0, document.layout.content.spacing, 0.0)
        assertEquals(MosaicHorizontalAlignment.STRETCH, document.layout.content.horizontalAlignment)
        assertEquals(
            MosaicCapabilityCatalog.v03,
            document.compatibility.requiredCapabilities.map { it.name }.toSet(),
        )
        val nodeTypes = document.layout.content.walkDepthFirst().map { it.type }.toSet()
        assertTrue(
            nodeTypes.containsAll(
                setOf(
                    "stack", "image", "text", "featureList", "productSelector",
                    "productCard", "productBadge", "button", "icon", "switch", "countdown",
                ),
            ),
        )
        assertEquals(setOf("en", "de", "ar"), document.localization.locales.keys)
        assertEquals(MosaicLayoutDirection.RTL, document.localization.locales.getValue("ar").direction)
        assertEquals("mosaic.paywall.hero", document.assets.first().sourceKey)
        assertEquals(
            listOf("mosaic_pro_monthly", "mosaic_pro_yearly", "mosaic_pro_lifetime"),
            document.products.map { it.providerProductId },
        )
        val selector = document.layout.content.walkDepthFirst()
            .filterIsInstance<MosaicProductSelectorComponent>()
            .single()
        assertEquals("yearly-plan", selector.initiallySelectedProductReferenceId)
    }

    /**
     * The report is per contract version, not a flattened set of names.
     *
     * `style.productCardStates` exists at `0.3` and not at `0.4`, and the three `motion.*`
     * capabilities exist at `0.4` and not at `0.3`. Reporting only names would make a `0.4`-only
     * capability look supported on a `0.3` document and vice versa.
     */
    @Test
    fun capabilityReportDeclaresExactCapabilitiesPerSupportedContract() {
        val report = MosaicProtocolCapabilities.report("test-sdk")

        assertEquals("test-sdk", report.sdkVersion)
        assertEquals(MOSAIC_SUPPORTED_PROTOCOL_VERSIONS, report.supportedSchemaVersions)
        assertEquals(
            MosaicCapabilityCatalog.v03 + MosaicCapabilityCatalog.v04,
            report.supportedCapabilities.keys,
        )
        assertEquals(
            MosaicCapabilityCatalog.v03.map {
                MosaicRequiredCapability(it, MOSAIC_PROTOCOL_VERSION)
            }.toSet() +
                MosaicCapabilityCatalog.v04.map {
                    MosaicRequiredCapability(it, MOSAIC_PROTOCOL_V04_VERSION)
                }.toSet(),
            report.supportedCapabilityVersions,
        )
    }

    @Test
    fun acceptsMathematicallyIntegralRevisionAndRejectsOverflow() {
        assertEquals(
            1,
            MosaicProtocolDecoder.decode(
                canonicalFixtureReplacing("\"revision\": 1", "\"revision\": 1.0"),
            ).revision,
        )
        assertEquals(
            Int.MAX_VALUE,
            MosaicProtocolDecoder.decode(
                canonicalFixtureReplacing("\"revision\": 1", "\"revision\": 2147483647"),
            ).revision,
        )
        assertThrows(MosaicProtocolException::class.java) {
            MosaicProtocolDecoder.decode(
                canonicalFixtureReplacing("\"revision\": 1", "\"revision\": 2147483648"),
            )
        }
    }
}
