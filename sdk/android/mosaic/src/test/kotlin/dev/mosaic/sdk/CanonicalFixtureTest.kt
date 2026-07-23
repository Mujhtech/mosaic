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
            MosaicCapabilityCatalog.v02,
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

    @Test
    fun capabilityReportDeclaresExactProtocol02Capabilities() {
        val report = MosaicProtocolCapabilities.report("test-sdk")

        assertEquals("test-sdk", report.sdkVersion)
        assertEquals(setOf(MOSAIC_PROTOCOL_VERSION), report.supportedSchemaVersions)
        assertEquals(MosaicCapabilityCatalog.v02, report.supportedCapabilities.keys)
        assertEquals(
            MosaicCapabilityCatalog.v02.map {
                MosaicRequiredCapability(it, MOSAIC_PROTOCOL_VERSION)
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
