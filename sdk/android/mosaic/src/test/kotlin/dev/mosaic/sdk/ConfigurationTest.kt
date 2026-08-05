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
        // Analytics collection is opt-out: a host that never touches the flag collects. Flipping
        // this default silently is a privacy-visible change, so it is pinned rather than inferred.
        assertEquals(true, mosaic.configuration.analyticsCollectionEnabled)
        // Deliberately unchanged: the observation handoff and authoritative entitlements stay
        // opt-in, so a default flip on one must never drift onto the others.
        assertEquals(false, mosaic.configuration.transactionObservationEnabled)
        assertEquals(null, mosaic.configuration.customerAccessTokenProvider)
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
