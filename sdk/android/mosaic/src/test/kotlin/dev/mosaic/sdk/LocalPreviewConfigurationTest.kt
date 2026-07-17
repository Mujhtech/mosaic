package dev.mosaic.sdk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class LocalPreviewConfigurationTest {
    @Test
    fun `default emulator endpoint and frozen session are explicit`() {
        val configuration = MosaicLocalPreviewConfiguration(client = identity())

        assertEquals("ws://10.0.2.2:4317/preview", configuration.endpoint)
        assertEquals("session_local_01", configuration.sessionId)
        assertEquals(MOSAIC_LOCAL_PREVIEW_DEFAULT_MAX_DOCUMENT_BYTES, configuration.maxDocumentBytes)
    }

    @Test
    fun `invalid session and identity fail before a socket starts`() {
        assertThrows(IllegalArgumentException::class.java) {
            MosaicLocalPreviewConfiguration(sessionId = "session_", client = identity())
        }
        assertThrows(IllegalArgumentException::class.java) {
            MosaicLocalPreviewConfiguration(
                client = identity().copy(clientId = "client_${"a".repeat(100)}"),
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            MosaicLocalPreviewConfiguration(
                client = identity().copy(displayName = "unsafe\nname"),
            )
        }
    }

    @Test
    fun `endpoint is restricted to credential free local development hosts`() {
        listOf(
            "ws://127.0.0.1:4317/preview",
            "ws://10.0.2.2:4317/preview",
            "ws://192.168.1.20:4317/preview",
            "wss://relay.local/preview",
            "ws://[::1]:4317/preview",
        ).forEach { endpoint ->
            MosaicLocalPreviewConfiguration(endpoint = endpoint, client = identity())
        }

        listOf(
            "wss://public.example.com/preview",
            "wss://fdexample.com/preview",
            "ws://user:secret@127.0.0.1:4317/preview",
            "ws://127.0.0.1:4317/preview?token=secret",
            "ws://127.0.0.1:4317/preview#fragment",
            "not-a-websocket",
        ).forEach { endpoint ->
            assertThrows(IllegalArgumentException::class.java) {
                MosaicLocalPreviewConfiguration(endpoint = endpoint, client = identity())
            }
        }
    }

    @Test
    fun `reconnect delay is exponential and capped at five seconds`() {
        val policy = MosaicPreviewReconnectPolicy()

        assertEquals(250, policy.delayMillis(1))
        assertEquals(500, policy.delayMillis(2))
        assertEquals(1_000, policy.delayMillis(3))
        assertEquals(5_000, policy.delayMillis(20))
    }

    private fun identity() = MosaicPreviewClientIdentity(
        clientId = "client_android_test",
        displayName = "Android test preview",
        renderer = MosaicPreviewSoftwareIdentity("mosaic.android", "0.1.0"),
        application = MosaicPreviewApplicationIdentity(
            "mosaic.android.test",
            "Mosaic Android Test",
            "0.1.0",
        ),
        device = MosaicPreviewDeviceIdentity("Test device", "Android", "1.0"),
    )
}
