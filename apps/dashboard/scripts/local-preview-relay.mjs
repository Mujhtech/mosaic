import { pathToFileURL } from "node:url"

import { WebSocket, WebSocketServer } from "ws"

import {
  decideLocalPreviewDraftDelivery,
  localPreviewVersionPreference,
  localPreviewWebSocketProtocols,
  validatePreviewMessage,
} from "../../../protocol/browser/index.js"

export const PREVIEW_SUBPROTOCOLS = Object.freeze(
  localPreviewVersionPreference.map((version) => localPreviewWebSocketProtocols[version]),
)
export const PREVIEW_SUBPROTOCOL = localPreviewWebSocketProtocols["0.2"]
const HEARTBEAT_TIMEOUT_MS = 15_000
const STUDIO_MESSAGE_TYPES = new Set([
  "draftUpdated",
  "mockCommerceStateChanged",
  "previewHeartbeat",
])
const VERSION_BY_SUBPROTOCOL = new Map(
  Object.entries(localPreviewWebSocketProtocols).map(([version, protocol]) => [protocol, version]),
)
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

function messageForVersion(message, targetVersion) {
  if (message.previewProtocolVersion === targetVersion) return message
  if (message.type === "draftUpdated" || message.type === "mockCommerceStateChanged") return null
  const translated = {
    ...message,
    previewProtocolVersion: targetVersion,
    payload:
      message.type === "capabilityReport"
        ? {
            ...message.payload,
            previewCapabilities: message.payload.previewCapabilities.map((capability) => ({
              ...capability,
              version: targetVersion,
            })),
          }
        : message.payload,
  }
  return validatePreviewMessage(translated).ok ? translated : null
}

function sendCanonical(socket, meta, message) {
  const translated = messageForVersion(message, meta.protocolVersion)
  if (!translated) return false
  socket.send(JSON.stringify(translated))
  return true
}

function incompatibleDraftDecision(message, peerMeta) {
  const document = message.payload.document
  if (document.schemaVersion === "0.2") {
    return decideLocalPreviewDraftDelivery({
      capabilityReport: peerMeta.capabilityReport,
      document,
      negotiation: {
        ok: true,
        selectedVersion: peerMeta.protocolVersion,
        selectedWebSocketSubprotocol: peerMeta.protocol,
      },
    })
  }
  if (document.schemaVersion === peerMeta.protocolVersion) return { delivery: "send" }
  return {
    delivery: "withhold",
    diagnostic: {
      code: "preview.incompatibleSchemaVersion",
      message: `This Local Preview ${peerMeta.protocolVersion} client cannot receive a Protocol ${document.schemaVersion} draft.`,
      fallback: "keepLastAcceptedDraft",
      recovery: {
        action: "updatePreviewClient",
        message: "Update the preview client to a version that supports this paywall format.",
      },
    },
  }
}

function rejectionReason(code) {
  if (code === "preview.incompatibleSchemaVersion") return "unsupportedSchemaVersion"
  if (code === "preview.unsupportedCapability") return "unsupportedCapability"
  if (code === "preview.documentTooLarge") return "documentTooLarge"
  return "validationFailed"
}

function draftRejection(message, clientId, diagnostic, protocolVersion) {
  return {
    previewProtocolVersion: protocolVersion,
    messageId: `msg_relay_${Date.now()}_${Math.round(Math.random() * 1_000_000)}`,
    sessionId: message.sessionId,
    sentAt: new Date().toISOString(),
    type: "draftRejected",
    payload: {
      clientId,
      editableDocumentId: message.payload.editableDocumentId,
      revision: message.payload.revision,
      reason: rejectionReason(diagnostic.code),
      diagnostics: [
        {
          code: diagnostic.code,
          message: diagnostic.message,
          location: { documentPath: "/schemaVersion", property: "schemaVersion" },
          recovery: diagnostic.recovery,
        },
      ],
    },
  }
}

function relayMessage(
  server,
  metadata,
  sessionId,
  sender,
  message,
  targetRole,
  targetClientId = null,
) {
  const senderMeta = metadata.get(sender)
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
      if (targetRole === "client" && message.type === "draftUpdated") {
        const decision = incompatibleDraftDecision(message, peerMeta)
        if (decision.delivery === "withhold") {
          sendCanonical(
            sender,
            senderMeta,
            draftRejection(
              message,
              peerMeta.clientId,
              decision.diagnostic,
              senderMeta.protocolVersion,
            ),
          )
          continue
        }
      }
      if (
        targetRole === "client" &&
        message.type === "mockCommerceStateChanged" &&
        message.previewProtocolVersion !== peerMeta.protocolVersion
      ) {
        continue
      }
      sendCanonical(peer, peerMeta, message)
    }
  }
}

function relayEnvelope(protocolVersion, sessionId, type, payload) {
  return {
    previewProtocolVersion: protocolVersion,
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
      return PREVIEW_SUBPROTOCOLS.find((protocol) => protocols.has(protocol)) ?? false
    },
    verifyClient(info, done) {
      if (!isLoopbackOrigin(info.origin)) {
        done(false, 403, "Loopback origins only")
        return
      }
      const requestedProtocols = String(info.req.headers["sec-websocket-protocol"] ?? "")
        .split(",")
        .map((value) => value.trim())
      if (!PREVIEW_SUBPROTOCOLS.some((protocol) => requestedProtocols.includes(protocol))) {
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
    const meta = metadata.get(socket)
    for (const client of cache.values()) {
      if (client.connected) sendCanonical(socket, meta, client.connected)
      if (client.capability) sendCanonical(socket, meta, client.capability)
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
    const message = relayEnvelope(
      meta.protocolVersion,
      meta.sessionId,
      "previewClientDisconnected",
      {
        clientId: meta.clientId,
        reason,
      },
    )
    relayMessage(server, metadata, meta.sessionId, socket, message, "studio")
  }

  server.on("connection", (socket, request) => {
    const requestUrl = new URL(request.url ?? path, `http://${host}`)
    const requestedRole = requestUrl.searchParams.get("role")
    const isStudio = requestedRole === "studio"
    const querySession = requestUrl.searchParams.get("sessionId")
    const protocol = socket.protocol
    const protocolVersion = VERSION_BY_SUBPROTOCOL.get(protocol)
    const meta = {
      role: isStudio ? "studio" : "client",
      sessionId: isStudio && querySession?.startsWith("session_") ? querySession : null,
      clientId: null,
      phase: isStudio ? "ready" : "awaitingConnected",
      lastActivityAt: Date.now(),
      disconnected: false,
      protocol,
      protocolVersion,
      capabilityReport: null,
    }
    metadata.set(socket, meta)
    if (
      !protocolVersion ||
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
      if (message.previewProtocolVersion !== meta.protocolVersion) {
        socket.close(1008, "Message version does not match the negotiated subprotocol")
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

      if (message.type === "previewClientConnected") {
        meta.clientId = message.payload.client.clientId
        meta.phase = "awaitingCapability"
        meta.disconnected = false
        meta.connected = message
        const cache = sessionCache(message.sessionId)
        if (!cache.has(meta.clientId)) {
          cache.set(meta.clientId, { connected: message, capability: null, socket })
        }
      } else if (message.type === "capabilityReport") {
        if (message.payload.clientId !== meta.clientId) {
          socket.close(1008, "Capability identity does not match the connected client")
          return
        }
        meta.phase = "ready"
        meta.capabilityReport = message.payload
        const cache = sessionCache(message.sessionId)
        const previousSocket = cache.get(meta.clientId)?.socket
        cache.set(meta.clientId, {
          connected: meta.connected,
          capability: message,
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
        message,
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
  console.log(`WebSocket subprotocols: ${PREVIEW_SUBPROTOCOLS.join(", ")}`)

  async function shutdown() {
    await relay.close()
    process.exit(0)
  }

  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
}
