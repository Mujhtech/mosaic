package dev.mosaic.sdk

import com.google.gson.JsonArray
import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.util.concurrent.CopyOnWriteArrayList

class LocalPreviewClientTest {
    @Test
    fun `handshake reports exact capabilities and accepted revision only after live confirmation`() {
        val factory = FakeSocketFactory()
        val client = client(factory)
        try {
            client.start()
            val connection = factory.connections.single()
            assertEquals(MOSAIC_LOCAL_PREVIEW_WEBSOCKET_PROTOCOL, connection.subprotocol)
            connection.listener.onOpen(connection.socket, MOSAIC_LOCAL_PREVIEW_WEBSOCKET_PROTOCOL)
            await { connection.socket.sent.size >= 2 }

            val handshake = connection.socket.sent.take(2).map(MosaicLocalPreviewCodec::decode)
            assertTrue(handshake[0].payload is MosaicPreviewClientConnectedPayload)
            val report = handshake[1].payload as MosaicPreviewCapabilityReportPayload
            assertEquals(MosaicCapabilityName.entries.map { it.wireName }, report.supportedCapabilities.map { it.name })
            assertEquals(MosaicPreviewCapabilityName.entries.toSet(), report.previewCapabilities.map { it.name }.toSet())
            assertEquals(MOSAIC_LOCAL_PREVIEW_DEFAULT_MAX_DOCUMENT_BYTES, report.limits.maxDocumentBytes)

            connection.listener.onText(canonicalMessageSource(2))
            connection.listener.onText(canonicalMessageSource(3))
            await { client.state.value.render?.revision?.sequence == 2 }
            assertFalse(connection.socket.sent.any {
                MosaicLocalPreviewCodec.decode(it).type == MosaicPreviewMessageType.DRAFT_ACCEPTED
            })

            val render = requireNotNull(client.state.value.render)
            client.confirmDisplayedDraft(
                requireNotNull(render.editableDocumentId),
                requireNotNull(render.revision),
            )
            await {
                connection.socket.sent.any {
                    MosaicLocalPreviewCodec.decode(it).type == MosaicPreviewMessageType.DRAFT_ACCEPTED
                }
            }
        } finally {
            client.close()
        }
    }

    @Test
    fun `other client disconnect is ignored and session end disconnects this client`() {
        val factory = FakeSocketFactory()
        val client = client(factory)
        try {
            client.start()
            val connection = factory.connections.single()
            connection.listener.onOpen(connection.socket, MOSAIC_LOCAL_PREVIEW_WEBSOCKET_PROTOCOL)
            await { client.state.value.connectionStatus == MosaicPreviewConnectionStatus.Connected }

            connection.listener.onText(canonicalMessageSource(16))
            Thread.sleep(25)
            assertEquals(MosaicPreviewConnectionStatus.Connected, client.state.value.connectionStatus)

            val ownDisconnect = MosaicPreviewMessage(
                messageId = "msg_android_server_disconnect",
                sessionId = "session_phase2_demo",
                sentAt = "2026-07-17T08:00:00Z",
                payload = MosaicPreviewClientDisconnectedPayload(
                    clientId = "client_android_test",
                    reason = MosaicPreviewDisconnectReason.SESSION_ENDED,
                ),
            )
            connection.listener.onText(MosaicLocalPreviewCodec.encode(ownDisconnect))
            await { client.state.value.connectionStatus == MosaicPreviewConnectionStatus.Disconnected }
        } finally {
            client.close()
        }
    }

    @Test
    fun `heartbeat responds only when targeted to this preview client`() {
        val factory = FakeSocketFactory()
        val client = client(factory)
        try {
            client.start()
            val connection = factory.connections.single()
            connection.listener.onOpen(connection.socket, MOSAIC_LOCAL_PREVIEW_WEBSOCKET_PROTOCOL)
            await { connection.socket.sent.size >= 2 }

            connection.listener.onText(canonicalMessageSource(14))
            Thread.sleep(25)
            assertFalse(connection.socket.sent.drop(2).any {
                MosaicLocalPreviewCodec.decode(it).payload is MosaicPreviewHeartbeatPayload
            })

            val targetedPing = MosaicPreviewMessage(
                messageId = "msg_android_targeted_ping",
                sessionId = "session_phase2_demo",
                sentAt = "2026-07-17T08:00:00Z",
                payload = MosaicPreviewHeartbeatPayload(
                    clientId = "client_android_test",
                    kind = MosaicPreviewHeartbeatKind.PING,
                    sequence = 42,
                ),
            )
            connection.listener.onText(MosaicLocalPreviewCodec.encode(targetedPing))
            await {
                connection.socket.sent.drop(2).map(MosaicLocalPreviewCodec::decode).any {
                    val payload = it.payload as? MosaicPreviewHeartbeatPayload
                    payload?.kind == MosaicPreviewHeartbeatKind.PONG && payload.sequence == 42
                }
            }
        } finally {
            client.close()
        }
    }

    @Test
    fun `transport failure reconnects with a bounded delay and safe diagnostic`() {
        val factory = FakeSocketFactory()
        val client = client(
            factory,
            reconnectPolicy = MosaicPreviewReconnectPolicy(1, 5),
        )
        try {
            client.start()
            val first = factory.connections.single()
            first.listener.onOpen(first.socket, MOSAIC_LOCAL_PREVIEW_WEBSOCKET_PROTOCOL)
            first.listener.onFailure()

            await { factory.connections.size >= 2 }

            assertTrue(client.state.value.connectionStatus is MosaicPreviewConnectionStatus.Reconnecting)
            val diagnostic = requireNotNull(client.state.value.diagnostic)
            assertEquals("preview.transportError", diagnostic.code)
            assertFalse(diagnostic.message.contains("ws://"))
            assertFalse(diagnostic.message.contains("Exception"))
        } finally {
            client.close()
        }
    }

    private fun client(
        factory: FakeSocketFactory,
        reconnectPolicy: MosaicPreviewReconnectPolicy = MosaicPreviewReconnectPolicy(),
    ) = MosaicLocalPreviewClient(
        configuration = MosaicLocalPreviewConfiguration(
            endpoint = "ws://127.0.0.1:4317/preview",
            sessionId = "session_phase2_demo",
            client = identity(),
        ),
        fallback = MosaicPaywallLoadResult.Loaded(
            canonicalDocument(),
            MosaicPaywallSource.BUNDLED_FALLBACK,
        ),
        socketFactory = factory,
        reconnectPolicy = reconnectPolicy,
        clock = object : MosaicPreviewClock {
            override fun elapsedRealtimeMillis() = 1_000L
            override fun utcTimestamp() = "2026-07-17T08:00:00Z"
        },
    )

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

    private fun canonicalMessageSource(index: Int): String = canonicalPreviewFlow()[index].toString()

    private fun canonicalPreviewFlow(): JsonArray = JsonParser.parseString(
        Files.readAllBytes(
            repositoryFile("protocol/fixtures/local-preview/v0.1/session-flow.messages.json"),
        ).toString(Charsets.UTF_8),
    ).asJsonArray

    private fun await(predicate: () -> Boolean) {
        val deadline = System.nanoTime() + 2_000_000_000L
        while (!predicate()) {
            if (System.nanoTime() >= deadline) error("Timed out waiting for preview client state.")
            Thread.sleep(5)
        }
    }

    private class FakeSocketFactory : MosaicPreviewSocketFactory {
        val connections = CopyOnWriteArrayList<Connection>()

        override fun open(
            endpoint: String,
            subprotocol: String,
            listener: MosaicPreviewSocketListener,
        ): MosaicPreviewSocket = FakeSocket().also { socket ->
            connections += Connection(endpoint, subprotocol, listener, socket)
        }
    }

    private data class Connection(
        val endpoint: String,
        val subprotocol: String,
        val listener: MosaicPreviewSocketListener,
        val socket: FakeSocket,
    )

    private class FakeSocket : MosaicPreviewSocket {
        val sent = CopyOnWriteArrayList<String>()
        override fun send(text: String): Boolean = sent.add(text)
        override fun close(code: Int, reason: String): Boolean = true
        override fun cancel() = Unit
    }
}
