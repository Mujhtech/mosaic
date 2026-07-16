package dev.mosaic.sdk

import java.net.URI
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Test

class ConfigurationTest {
    @Test
    fun configuresIsolatedClient() {
        val provider = MockMosaicPurchaseProvider()
        val endpoint = URI("http://localhost:8080")
        val mosaic = Mosaic.configure(
            apiKey = " public_test_key ",
            endpoint = endpoint,
            purchaseProvider = provider,
        )

        assertEquals("public_test_key", mosaic.configuration.apiKey)
        assertEquals(endpoint, mosaic.configuration.endpoint)
        assertSame(provider, mosaic.purchaseProvider)
    }

    @Test
    fun rejectsEmptyKeyAndRelativeEndpoint() {
        assertThrows(IllegalArgumentException::class.java) {
            MosaicConfiguration(apiKey = "  ")
        }
        assertThrows(IllegalArgumentException::class.java) {
            MosaicConfiguration(apiKey = "public_test_key", endpoint = URI("/local"))
        }
    }
}
