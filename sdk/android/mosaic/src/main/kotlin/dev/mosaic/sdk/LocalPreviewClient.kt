package dev.mosaic.sdk

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

interface MosaicPreviewSocket {
    fun send(text: String): Boolean
    fun close(code: Int, reason: String): Boolean
    fun cancel()
}

interface MosaicPreviewSocketListener {
    fun onOpen(openedSocket: MosaicPreviewSocket, selectedProtocol: String?)
    fun onText(text: String)
    fun onBinary()
    fun onClosed(code: Int)
    fun onFailure()
}

fun interface MosaicPreviewSocketFactory {
    fun open(
        endpoint: String,
        subprotocol: String,
        listener: MosaicPreviewSocketListener,
    ): MosaicPreviewSocket
}

/** The default Android transport; OkHttp performs the native RFC 6455 socket handshake. */
object MosaicOkHttpPreviewSocketFactory : MosaicPreviewSocketFactory {
    private val client by lazy {
        OkHttpClient.Builder()
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build()
    }

    override fun open(
        endpoint: String,
        subprotocol: String,
        listener: MosaicPreviewSocketListener,
    ): MosaicPreviewSocket {
        val request = Request.Builder()
            .url(endpoint)
            .header("Sec-WebSocket-Protocol", subprotocol)
            .build()
        val socket = client.newWebSocket(
            request,
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    listener.onOpen(
                        OkHttpPreviewSocket(webSocket),
                        response.header("Sec-WebSocket-Protocol"),
                    )
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    listener.onText(text)
                }

                override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                    listener.onBinary()
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    listener.onClosed(code)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    listener.onFailure()
                }
            },
        )
        return OkHttpPreviewSocket(socket)
    }

    private class OkHttpPreviewSocket(private val socket: WebSocket) : MosaicPreviewSocket {
        override fun send(text: String): Boolean = socket.send(text)
        override fun close(code: Int, reason: String): Boolean = socket.close(code, reason)
        override fun cancel() = socket.cancel()
    }
}

data class MosaicPreviewReconnectPolicy(
    val initialDelayMillis: Long = 250,
    val maximumDelayMillis: Long = 5_000,
) {
    init {
        require(initialDelayMillis > 0)
        require(maximumDelayMillis >= initialDelayMillis)
    }

    fun delayMillis(attempt: Int): Long {
        require(attempt >= 1)
        var delay = initialDelayMillis
        repeat((attempt - 1).coerceAtMost(30)) {
            delay = (delay * 2).coerceAtMost(maximumDelayMillis)
        }
        return delay
    }
}

interface MosaicPreviewClock {
    fun elapsedRealtimeMillis(): Long
    fun utcTimestamp(): String
}

private object SystemMosaicPreviewClock : MosaicPreviewClock {
    override fun elapsedRealtimeMillis(): Long = System.nanoTime() / 1_000_000

    override fun utcTimestamp(): String = SimpleDateFormat(
        "yyyy-MM-dd'T'HH:mm:ss'Z'",
        Locale.US,
    ).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }.format(System.currentTimeMillis())
}

/**
 * Local-development-only preview client.
 *
 * It does not fetch hosted configuration, authenticate, or weaken Protocol 0.1 validation.
 */
class MosaicLocalPreviewClient(
    val configuration: MosaicLocalPreviewConfiguration,
    fallback: MosaicPaywallLoadResult,
    private val socketFactory: MosaicPreviewSocketFactory = MosaicOkHttpPreviewSocketFactory,
    private val reconnectPolicy: MosaicPreviewReconnectPolicy = MosaicPreviewReconnectPolicy(),
    private val clock: MosaicPreviewClock = SystemMosaicPreviewClock,
) : AutoCloseable {
    private val engine = MosaicLocalPreviewEngine(
        clientId = configuration.client.clientId,
        fallback = fallback,
        maxDocumentBytes = configuration.maxDocumentBytes,
    )
    private val rootJob = SupervisorJob()
    private val scope = CoroutineScope(rootJob + Dispatchers.Default)
    private val messageMutex = Mutex()
    private val messageSequence = AtomicLong(0)
    private val receivedMessageIds = LinkedHashSet<String>()
    private val lifecycleLock = Any()

    @Volatile
    private var started = false
    private var generation = 0
    private var socket: MosaicPreviewSocket? = null
    private var reconnectAttempt = 0
    private var reconnectJob: Job? = null
    private var heartbeatJob: Job? = null
    private var lastValidMessageMillis: Long = 0
    private var heartbeatSequence = 0

    val state: StateFlow<MosaicLocalPreviewState> = engine.state
    val purchaseProvider: MosaicPurchaseProvider = engine.purchaseProvider

    fun start() {
        synchronized(lifecycleLock) {
            if (started) return
            started = true
            reconnectAttempt = 0
        }
        engine.updateConnection(MosaicPreviewConnectionStatus.Connecting)
        connect()
    }

    fun stop() {
        val closingSocket: MosaicPreviewSocket?
        synchronized(lifecycleLock) {
            if (!started) return
            started = false
            generation += 1
            reconnectJob?.cancel()
            heartbeatJob?.cancel()
            reconnectJob = null
            heartbeatJob = null
            closingSocket = socket
            socket = null
        }
        closingSocket?.let {
            sendPayload(
                MosaicPreviewClientDisconnectedPayload(
                    clientId = configuration.client.clientId,
                    reason = MosaicPreviewDisconnectReason.CLOSED,
                ),
                explicitSocket = it,
            )
            it.close(1000, "Local preview closed")
        }
        engine.updateConnection(MosaicPreviewConnectionStatus.Disconnected)
    }

    override fun close() {
        stop()
        scope.cancel()
    }

    fun confirmDisplayedDraft(editableDocumentId: String, revision: MosaicLocalRevision) {
        scope.launch {
            messageMutex.withLock {
                sendPayloads(engine.confirmDraftIsLive(editableDocumentId, revision))
            }
        }
    }

    fun reportAssetFallback(componentId: String) {
        scope.launch {
            messageMutex.withLock { sendPayloads(engine.reportAssetFallback(componentId)) }
        }
    }

    fun reportRenderFailure(editableDocumentId: String, revision: MosaicLocalRevision) {
        scope.launch {
            messageMutex.withLock {
                sendPayloads(engine.reportRenderFailure(editableDocumentId, revision))
            }
        }
    }

    private fun connect() {
        val connectionGeneration: Int
        synchronized(lifecycleLock) {
            if (!started) return
            generation += 1
            connectionGeneration = generation
        }
        val listener = object : MosaicPreviewSocketListener {
            override fun onOpen(openedSocket: MosaicPreviewSocket, selectedProtocol: String?) {
                if (!isCurrent(connectionGeneration)) {
                    openedSocket.close(1000, "Stale local preview connection")
                    return
                }
                if (selectedProtocol != MOSAIC_LOCAL_PREVIEW_WEBSOCKET_PROTOCOL) {
                    engine.recordConnectionDiagnostic(
                        "preview.subprotocolMismatch",
                        "The local relay did not select the required preview protocol.",
                    )
                    openedSocket.close(1002, "Preview protocol mismatch")
                    handleLost(connectionGeneration, allowReconnect = true)
                    return
                }
                synchronized(lifecycleLock) { socket = openedSocket }
                val connected = sendPayload(
                    MosaicPreviewClientConnectedPayload(configuration.client),
                    explicitSocket = openedSocket,
                )
                val capabilities = sendPayload(capabilityPayload(), explicitSocket = openedSocket)
                if (!connected || !capabilities) {
                    openedSocket.close(1011, "Preview handshake failed")
                    handleLost(connectionGeneration, allowReconnect = true)
                    return
                }
                synchronized(lifecycleLock) {
                    reconnectAttempt = 0
                    lastValidMessageMillis = clock.elapsedRealtimeMillis()
                }
                engine.updateConnection(MosaicPreviewConnectionStatus.Connected)
                startHeartbeat(connectionGeneration)
            }

            override fun onText(text: String) {
                scope.launch { processText(connectionGeneration, text) }
            }

            override fun onBinary() {
                engine.recordConnectionDiagnostic(
                    "preview.binaryFrameRejected",
                    "The local preview relay sent an unsupported binary frame.",
                )
                currentSocket(connectionGeneration)?.close(1003, "Text frames required")
            }

            override fun onClosed(code: Int) {
                handleLost(connectionGeneration, allowReconnect = true)
            }

            override fun onFailure() {
                engine.recordConnectionDiagnostic(
                    "preview.transportError",
                    "The local preview transport disconnected unexpectedly.",
                )
                handleLost(connectionGeneration, allowReconnect = true)
            }
        }
        try {
            val created = socketFactory.open(
                configuration.endpoint,
                MOSAIC_LOCAL_PREVIEW_WEBSOCKET_PROTOCOL,
                listener,
            )
            synchronized(lifecycleLock) {
                if (started && generation == connectionGeneration && socket == null) socket = created
            }
        } catch (_: Exception) {
            engine.recordConnectionDiagnostic(
                "preview.transportError",
                "The local preview transport could not connect.",
            )
            handleLost(connectionGeneration, allowReconnect = true)
        }
    }

    private suspend fun processText(connectionGeneration: Int, text: String) {
        if (!isCurrent(connectionGeneration)) return
        messageMutex.withLock {
            val message = try {
                MosaicLocalPreviewCodec.decode(text)
            } catch (_: MosaicPreviewCodecException) {
                engine.recordConnectionDiagnostic(
                    "preview.invalidMessage",
                    "The local preview relay sent a message that does not match contract 0.1.",
                )
                currentSocket(connectionGeneration)?.close(1002, "Invalid preview message")
                return
            }
            if (message.sessionId != configuration.sessionId) {
                engine.recordConnectionDiagnostic(
                    "preview.sessionMismatch",
                    "The local preview relay sent a message for another session.",
                )
                currentSocket(connectionGeneration)?.close(1002, "Preview session mismatch")
                return
            }
            synchronized(lifecycleLock) { lastValidMessageMillis = clock.elapsedRealtimeMillis() }
            if (!rememberMessage(message.messageId)) return

            when (val payload = message.payload) {
                is MosaicPreviewHeartbeatPayload -> {
                    if (payload.clientId != configuration.client.clientId) return
                    if (payload.kind == MosaicPreviewHeartbeatKind.PING) {
                        sendPayload(
                            MosaicPreviewHeartbeatPayload(
                                clientId = configuration.client.clientId,
                                kind = MosaicPreviewHeartbeatKind.PONG,
                                sequence = payload.sequence,
                            ),
                        )
                    }
                }
                is MosaicPreviewClientDisconnectedPayload -> {
                    if (payload.clientId != configuration.client.clientId) return
                    payload.diagnostic?.let {
                        engine.recordConnectionDiagnostic("preview.disconnected", it)
                    }
                    val shouldReconnect = payload.reason != MosaicPreviewDisconnectReason.SESSION_ENDED &&
                        payload.reason != MosaicPreviewDisconnectReason.CLOSED
                    currentSocket(connectionGeneration)?.close(1000, "Preview client disconnected")
                    handleLost(connectionGeneration, shouldReconnect)
                }
                else -> sendPayloads(engine.process(message))
            }
        }
    }

    private fun startHeartbeat(connectionGeneration: Int) {
        synchronized(lifecycleLock) {
            heartbeatJob?.cancel()
            heartbeatJob = scope.launch {
                while (isCurrent(connectionGeneration)) {
                    delay(MOSAIC_LOCAL_PREVIEW_HEARTBEAT_MILLIS)
                    val elapsed = clock.elapsedRealtimeMillis() - synchronized(lifecycleLock) {
                        lastValidMessageMillis
                    }
                    if (elapsed >= MOSAIC_LOCAL_PREVIEW_TIMEOUT_MILLIS) {
                        engine.recordConnectionDiagnostic(
                            "preview.heartbeatTimeout",
                            "The local preview relay stopped responding.",
                        )
                        currentSocket(connectionGeneration)?.close(1001, "Preview heartbeat timeout")
                        handleLost(connectionGeneration, allowReconnect = true)
                        return@launch
                    }
                    if (elapsed >= MOSAIC_LOCAL_PREVIEW_HEARTBEAT_MILLIS) {
                        heartbeatSequence = if (heartbeatSequence == Int.MAX_VALUE) 0 else heartbeatSequence + 1
                        sendPayload(
                            MosaicPreviewHeartbeatPayload(
                                clientId = configuration.client.clientId,
                                kind = MosaicPreviewHeartbeatKind.PING,
                                sequence = heartbeatSequence,
                            ),
                        )
                    }
                }
            }
        }
    }

    private fun handleLost(connectionGeneration: Int, allowReconnect: Boolean) {
        val delayMillis: Long
        val attempt: Int
        synchronized(lifecycleLock) {
            if (generation != connectionGeneration) return
            heartbeatJob?.cancel()
            heartbeatJob = null
            socket = null
            if (!started || !allowReconnect) {
                generation += 1
                engine.updateConnection(MosaicPreviewConnectionStatus.Disconnected)
                return
            }
            reconnectAttempt += 1
            attempt = reconnectAttempt
            delayMillis = reconnectPolicy.delayMillis(attempt)
            reconnectJob?.cancel()
            engine.updateConnection(MosaicPreviewConnectionStatus.Reconnecting(attempt, delayMillis))
            reconnectJob = scope.launch {
                delay(delayMillis)
                if (started) connect()
            }
        }
    }

    private fun capabilityPayload(): MosaicPreviewCapabilityReportPayload {
        val report = MosaicProtocolCapabilities.report()
        return MosaicPreviewCapabilityReportPayload(
            clientId = configuration.client.clientId,
            supportedSchemaVersions = report.supportedSchemaVersions.sorted(),
            supportedCapabilities = MosaicCapabilityName.entries.map { capability ->
                MosaicPreviewSupportedCapability(
                    capability.wireName,
                    checkNotNull(report.supportedCapabilities[capability]),
                )
            },
            previewCapabilities = MosaicPreviewCapabilityName.entries.map(::MosaicPreviewCapability),
            limits = MosaicPreviewLimits(configuration.maxDocumentBytes),
        )
    }

    private fun sendPayloads(payloads: List<MosaicPreviewPayload>) {
        payloads.forEach(::sendPayload)
    }

    private fun sendPayload(
        payload: MosaicPreviewPayload,
        explicitSocket: MosaicPreviewSocket? = null,
    ): Boolean {
        val target = explicitSocket ?: synchronized(lifecycleLock) { socket } ?: return false
        val sequence = messageSequence.incrementAndGet()
        val message = MosaicPreviewMessage(
            messageId = "msg_android_${sequence.toString().padStart(6, '0')}",
            sessionId = configuration.sessionId,
            sentAt = clock.utcTimestamp(),
            payload = payload,
        )
        return runCatching { target.send(MosaicLocalPreviewCodec.encode(message)) }.getOrDefault(false)
    }

    private fun rememberMessage(messageId: String): Boolean = synchronized(receivedMessageIds) {
        if (!receivedMessageIds.add(messageId)) return@synchronized false
        if (receivedMessageIds.size > 512) {
            val iterator = receivedMessageIds.iterator()
            repeat(128) {
                if (iterator.hasNext()) {
                    iterator.next()
                    iterator.remove()
                }
            }
        }
        true
    }

    private fun currentSocket(connectionGeneration: Int): MosaicPreviewSocket? =
        synchronized(lifecycleLock) { socket.takeIf { generation == connectionGeneration } }

    private fun isCurrent(connectionGeneration: Int): Boolean =
        synchronized(lifecycleLock) { started && generation == connectionGeneration }
}
