import { pathToFileURL } from "node:url"

import { WebSocket, WebSocketServer } from "ws"

import {
  localPreviewWebSocketProtocol,
  validatePreviewMessage,
} from "../../../protocol/browser/index.js"

export const PREVIEW_SUBPROTOCOL = localPreviewWebSocketProtocol
const HEARTBEAT_TIMEOUT_MS = 15_000
const STUDIO_MESSAGE_TYPES = new Set([
  "draftUpdated",
  "mockCommerceStateChanged",
  "previewHeartbeat",
])
const CLIENT_MESSAGE_TYPES = new Set([
  "previewClientDisconnected",
  "draftAccepted",
  "draftRejected",
  "validationError",
  "renderWarning",
  "renderFailure",
  "previewHeartbeat",
])

function isLoopbackOrigin(origin) {
  if (!origin) return true
  try {
    const hostname = new URL(origin).hostname
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]"
  } catch {
    return false
  }
}

function relayMessage(
  server,
  metadata,
  sessionId,
  sender,
  serialized,
  targetRole,
  targetClientId = null,
) {
  for (const peer of server.clients) {
    const peerMeta = metadata.get(peer)
    if (
      peer !== sender &&
      peer.readyState === WebSocket.OPEN &&
      peerMeta?.sessionId === sessionId &&
      peerMeta.role === targetRole &&
      (!targetClientId || peerMeta.clientId === targetClientId) &&
      (targetRole !== "client" || peerMeta.phase === "ready")
    ) {
      peer.send(serialized)
    }
  }
}

function relayEnvelope(sessionId, type, payload) {
  return {
    previewProtocolVersion: "0.1",
    messageId: `msg_relay_${Date.now()}_${Math.round(Math.random() * 1_000_000)}`,
    sessionId,
    sentAt: new Date().toISOString(),
    type,
    payload,
  }
}

export function createPreviewRelay({ host = "127.0.0.1", port = 4317, path = "/preview" } = {}) {
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
    throw new Error("The Phase 2 preview relay may only bind to a loopback interface.")
  }

  const metadata = new WeakMap()
  const cachedClients = new Map()
  const server = new WebSocketServer({
    host,
    port,
    path,
    maxPayload: 2_097_152,
    handleProtocols(protocols) {
      return protocols.has(PREVIEW_SUBPROTOCOL) ? PREVIEW_SUBPROTOCOL : false
    },
    verifyClient(info, done) {
      if (!isLoopbackOrigin(info.origin)) {
        done(false, 403, "Loopback origins only")
        return
      }
      if (info.req.headers["sec-websocket-protocol"] !== PREVIEW_SUBPROTOCOL) {
        done(false, 426, "Required WebSocket subprotocol missing")
        return
      }
      done(true)
    },
  })
  const ready = new Promise((resolve, reject) => {
    server.once("listening", resolve)
    server.once("error", reject)
  })

  function sessionCache(sessionId) {
    let cache = cachedClients.get(sessionId)
    if (!cache) {
      cache = new Map()
      cachedClients.set(sessionId, cache)
    }
    return cache
  }

  function replayClients(socket, sessionId) {
    const cache = cachedClients.get(sessionId)
    if (!cache) return
    for (const client of cache.values()) {
      if (client.connected) socket.send(client.connected)
      if (client.capability) socket.send(client.capability)
    }
  }

  function disconnectClient(socket, reason) {
    const meta = metadata.get(socket)
    if (!meta?.clientId || !meta.sessionId || meta.disconnected) return
    meta.disconnected = true
    const cache = cachedClients.get(meta.sessionId)
    if (cache?.get(meta.clientId)?.socket !== socket) return
    cache?.delete(meta.clientId)
    if (cache?.size === 0) cachedClients.delete(meta.sessionId)
    const message = relayEnvelope(meta.sessionId, "previewClientDisconnected", {
      clientId: meta.clientId,
      reason,
    })
    relayMessage(server, metadata, meta.sessionId, socket, JSON.stringify(message), "studio")
  }

  server.on("connection", (socket, request) => {
    const requestUrl = new URL(request.url ?? path, `http://${host}`)
    const requestedRole = requestUrl.searchParams.get("role")
    const isStudio = requestedRole === "studio"
    const querySession = requestUrl.searchParams.get("sessionId")
    const meta = {
      role: isStudio ? "studio" : "client",
      sessionId: isStudio && querySession?.startsWith("session_") ? querySession : null,
      clientId: null,
      phase: isStudio ? "ready" : "awaitingConnected",
      lastActivityAt: Date.now(),
      disconnected: false,
    }
    metadata.set(socket, meta)
    if (
      (requestedRole && requestedRole !== "studio" && requestedRole !== "client") ||
      (isStudio && !meta.sessionId)
    ) {
      socket.close(1008, "A Studio connection requires a valid role and sessionId")
      return
    }
    if (meta.role === "studio" && meta.sessionId) replayClients(socket, meta.sessionId)

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        socket.close(1003, "JSON text messages only")
        return
      }

      let message
      try {
        message = JSON.parse(data.toString())
      } catch {
        socket.close(1007, "Invalid JSON")
        return
      }
      if (!validatePreviewMessage(message).ok) {
        socket.close(1008, "Invalid preview message")
        return
      }

      if (meta.sessionId && meta.sessionId !== message.sessionId) {
        socket.close(1008, "Session cannot change")
        return
      }

      if (meta.role === "studio") {
        if (!STUDIO_MESSAGE_TYPES.has(message.type)) {
          socket.close(1008, "Message direction is not allowed for Studio")
          return
        }
      } else if (meta.phase === "awaitingConnected") {
        if (message.type !== "previewClientConnected") {
          socket.close(1008, "The first client message must identify the preview client")
          return
        }
      } else if (meta.phase === "awaitingCapability") {
        if (message.type !== "capabilityReport") {
          socket.close(1008, "The capability report must follow client identity")
          return
        }
      } else if (meta.phase !== "ready" || !CLIENT_MESSAGE_TYPES.has(message.type)) {
        socket.close(1008, "Message direction is not allowed for a preview client")
        return
      }

      if (
        meta.role === "client" &&
        meta.phase === "ready" &&
        cachedClients.get(message.sessionId)?.get(meta.clientId)?.socket !== socket
      ) {
        socket.close(1008, "This preview client connection has been replaced")
        return
      }

      meta.sessionId = message.sessionId

      const serialized = JSON.stringify(message)
      if (message.type === "previewClientConnected") {
        meta.clientId = message.payload.client.clientId
        meta.phase = "awaitingCapability"
        meta.disconnected = false
        meta.connected = serialized
        const cache = sessionCache(message.sessionId)
        if (!cache.has(meta.clientId)) {
          cache.set(meta.clientId, { connected: serialized, capability: null, socket })
        }
      } else if (message.type === "capabilityReport") {
        if (message.payload.clientId !== meta.clientId) {
          socket.close(1008, "Capability identity does not match the connected client")
          return
        }
        meta.phase = "ready"
        const cache = sessionCache(message.sessionId)
        const previousSocket = cache.get(meta.clientId)?.socket
        cache.set(meta.clientId, {
          connected: meta.connected,
          capability: serialized,
          socket,
        })
        if (previousSocket && previousSocket !== socket) {
          queueMicrotask(() => previousSocket.close(1000, "Replaced by reconnect"))
        }
      } else if (message.type === "previewClientDisconnected") {
        if (message.payload.clientId !== meta.clientId) {
          socket.close(1008, "Disconnect identity does not match the connected client")
          return
        }
        if (sessionCache(message.sessionId).get(meta.clientId)?.socket !== socket) {
          meta.disconnected = true
          meta.phase = "disconnected"
          queueMicrotask(() => socket.close(1000, "Preview client connection replaced"))
          return
        }
        meta.disconnected = true
        meta.phase = "disconnected"
        sessionCache(message.sessionId).delete(meta.clientId)
      } else if (meta.role === "client" && message.payload.clientId !== meta.clientId) {
        socket.close(1008, "Message identity does not match the connected client")
        return
      }

      meta.lastActivityAt = Date.now()
      relayMessage(
        server,
        metadata,
        message.sessionId,
        socket,
        serialized,
        meta.role === "studio" ? "client" : "studio",
        meta.role === "studio" && message.type === "previewHeartbeat"
          ? message.payload.clientId
          : null,
      )
      if (message.type === "previewClientDisconnected") {
        queueMicrotask(() => socket.close(1000, "Preview client disconnected"))
      }
    })

    socket.on("close", () => disconnectClient(socket, "closed"))
  })

  const heartbeatTimer = setInterval(() => {
    const now = Date.now()
    for (const socket of server.clients) {
      const meta = metadata.get(socket)
      if (
        meta?.role === "client" &&
        meta.clientId &&
        now - meta.lastActivityAt > HEARTBEAT_TIMEOUT_MS
      ) {
        disconnectClient(socket, "timeout")
        socket.terminate()
      }
    }
  }, 1_000)
  heartbeatTimer.unref()

  return {
    server,
    ready,
    address() {
      const address = server.address()
      if (!address || typeof address === "string") return null
      const hostname = address.address === "::1" ? "[::1]" : address.address
      return `ws://${hostname}:${address.port}${path}`
    },
    close() {
      clearInterval(heartbeatTimer)
      for (const client of server.clients) client.terminate()
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const relay = createPreviewRelay()
  await relay.ready
  console.log(`Mosaic local preview relay listening at ${relay.address()}`)
  console.log(`WebSocket subprotocol: ${PREVIEW_SUBPROTOCOL}`)

  async function shutdown() {
    await relay.close()
    process.exit(0)
  }

  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
}
