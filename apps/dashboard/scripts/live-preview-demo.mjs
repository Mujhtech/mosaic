import { readFile } from "node:fs/promises"

import WebSocket from "ws"

import {
  localPreviewWebSocketProtocol,
  validatePreviewMessage,
} from "../../../protocol/browser/index.js"

const endpoint = process.env.MOSAIC_PREVIEW_ENDPOINT ?? "ws://127.0.0.1:4317/preview"
const sessionId = process.env.MOSAIC_PREVIEW_SESSION_ID ?? "session_local_01"
const revisionSequence = Number.parseInt(process.env.MOSAIC_DEMO_SEQUENCE ?? "2", 10)
if (!Number.isSafeInteger(revisionSequence) || revisionSequence < 2) {
  throw new Error("MOSAIC_DEMO_SEQUENCE must be an integer of at least 2.")
}
const revisionSuffix = String(revisionSequence).padStart(6, "0")
const revisionId = `revision_phase2_live_demo_${revisionSuffix}`
const holdMilliseconds = Number.parseInt(process.env.MOSAIC_DEMO_HOLD_MS ?? "0", 10)
if (!Number.isSafeInteger(holdMilliseconds) || holdMilliseconds < 0) {
  throw new Error("MOSAIC_DEMO_HOLD_MS must be a non-negative integer.")
}
const expectedRenderers = new Set(["mosaic.flutter", "mosaic.ios", "mosaic.android"])
const headline = "Ship one native paywall in under a minute"
const deadline = Date.now() + 20_000

const fixtures = JSON.parse(
  await readFile(
    new URL(
      "../../../protocol/fixtures/local-preview/v0.1/session-flow.messages.json",
      import.meta.url,
    ),
    "utf8",
  ),
)

const clients = new Map()
const capabilities = new Set()
const acknowledgements = new Set()
const diagnostics = []

const studioUrl = new URL(endpoint)
studioUrl.searchParams.set("role", "studio")
studioUrl.searchParams.set("sessionId", sessionId)
const socket = new WebSocket(studioUrl, localPreviewWebSocketProtocol)

socket.on("message", (frame) => {
  const message = JSON.parse(frame.toString())
  if (!validatePreviewMessage(message).ok) {
    diagnostics.push({ type: "invalidMessage", messageId: message.messageId })
    return
  }
  if (message.type === "previewClientConnected") {
    clients.set(message.payload.client.clientId, message.payload.client)
  } else if (message.type === "capabilityReport") {
    capabilities.add(message.payload.clientId)
  } else if (
    message.type === "draftAccepted" &&
    message.payload.editableDocumentId === "document_phase2_live_demo" &&
    message.payload.revision.revisionId === revisionId &&
    message.payload.revision.sequence === revisionSequence
  ) {
    acknowledgements.add(message.payload.clientId)
  } else if (
    ["draftRejected", "validationError", "renderWarning", "renderFailure"].includes(message.type)
  ) {
    diagnostics.push({
      type: message.type,
      clientId: message.payload.clientId,
      codes: (message.payload.warnings ?? message.payload.errors ?? []).map((entry) => entry.code),
    })
  }
})

await new Promise((resolve, reject) => {
  socket.once("open", resolve)
  socket.once("error", reject)
})

await waitUntil(() => {
  const readyRenderers = new Set(
    [...clients.entries()]
      .filter(([clientId]) => capabilities.has(clientId))
      .map(([, client]) => client.renderer.id),
  )
  return [...expectedRenderers].every((renderer) => readyRenderers.has(renderer))
})

const commerce = structuredClone(
  fixtures.find((message) => message.type === "mockCommerceStateChanged"),
)
commerce.messageId = `msg_phase2_live_demo_commerce_${revisionSuffix}`
commerce.sessionId = sessionId
commerce.sentAt = new Date().toISOString()
commerce.payload.editableDocumentId = "document_phase2_live_demo"
commerce.payload.stateRevision = {
  revisionId: `revision_phase2_live_demo_commerce_${String(revisionSequence - 1).padStart(6, "0")}`,
  sequence: revisionSequence - 1,
}

const draft = structuredClone(fixtures.find((message) => message.type === "draftUpdated"))
draft.messageId = `msg_phase2_live_demo_draft_${revisionSuffix}`
draft.sessionId = sessionId
draft.sentAt = new Date().toISOString()
draft.payload.editableDocumentId = "document_phase2_live_demo"
draft.payload.revision = {
  revisionId,
  sequence: revisionSequence,
}
draft.payload.document.revision = revisionSequence
draft.payload.document.localization.locales.en.strings["paywall.headline"] = headline
const children = draft.payload.document.layout.content.children
const headlineNode = children.find((node) => node.id === "headline")
headlineNode.value.default = headline
const productSelector = children.find((node) => node.id === "plans")
if (!productSelector.productReferenceIds.includes("yearly-plan")) {
  throw new Error("The demo document does not bind the yearly product.")
}
productSelector.initiallySelectedProductReferenceId = "yearly-plan"
const featureIndex = children.findIndex((node) => node.id === "features")
const subtitleIndex = children.findIndex((node) => node.id === "subtitle")
const [features] = children.splice(featureIndex, 1)
children.splice(subtitleIndex, 0, features)

for (const message of [commerce, draft]) {
  const result = validatePreviewMessage(message)
  if (!result.ok) throw new Error(`Demo message ${message.type} is not protocol-valid.`)
  socket.send(JSON.stringify(message))
}

await waitUntil(() => {
  const acknowledgedRenderers = new Set(
    [...acknowledgements].map((clientId) => clients.get(clientId)?.renderer.id).filter(Boolean),
  )
  return [...expectedRenderers].every((renderer) => acknowledgedRenderers.has(renderer))
})

const result = {
  sessionId,
  revision: { revisionId, sequence: revisionSequence },
  headline,
  reorderedComponent: "features-before-subtitle",
  selectedMockProduct: productSelector.initiallySelectedProductReferenceId,
  clients: [...clients.values()]
    .filter((client) => expectedRenderers.has(client.renderer.id))
    .map((client) => ({
      clientId: client.clientId,
      renderer: client.renderer.id,
      capabilityReported: capabilities.has(client.clientId),
      revisionAcknowledged: acknowledgements.has(client.clientId),
    }))
    .sort((left, right) => left.renderer.localeCompare(right.renderer)),
  diagnostics,
}

console.log(JSON.stringify(result, null, 2))

const holdDeadline = Date.now() + holdMilliseconds
let heartbeatSequence = 0
while (Date.now() < holdDeadline) {
  heartbeatSequence += 1
  for (const client of result.clients) {
    const heartbeat = {
      previewProtocolVersion: "0.1",
      messageId: `msg_phase2_live_demo_heartbeat_${revisionSuffix}_${heartbeatSequence}_${client.renderer.replaceAll(".", "_")}`,
      sessionId,
      sentAt: new Date().toISOString(),
      type: "previewHeartbeat",
      payload: { clientId: client.clientId, kind: "ping", sequence: heartbeatSequence },
    }
    if (!validatePreviewMessage(heartbeat).ok) throw new Error("Demo heartbeat is not valid.")
    socket.send(JSON.stringify(heartbeat))
  }
  await new Promise((resolve) => setTimeout(resolve, Math.min(2_000, holdDeadline - Date.now())))
}
socket.close()

async function waitUntil(predicate) {
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for Flutter, SwiftUI, and Compose in ${sessionId}. ` +
          `Connected: ${[...clients.values()].map((client) => client.renderer.id).join(", ") || "none"}. ` +
          `Acknowledged: ${[...acknowledgements].join(", ") || "none"}.`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
