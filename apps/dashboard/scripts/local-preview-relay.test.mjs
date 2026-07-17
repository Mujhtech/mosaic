import assert from "node:assert/strict"
import { once } from "node:events"
import { readFile } from "node:fs/promises"
import test from "node:test"

import WebSocket from "ws"

import { createPreviewRelay, PREVIEW_SUBPROTOCOL } from "./local-preview-relay.mjs"

function heartbeat(sessionId, sequence = 1, clientId = "client_relay_test") {
  return {
    previewProtocolVersion: "0.1",
    messageId: `msg_${sessionId}_${sequence}`,
    sessionId,
    sentAt: new Date().toISOString(),
    type: "previewHeartbeat",
    payload: { clientId, kind: "ping", sequence },
  }
}

async function connect(url, sessionId, receivedMessages) {
  const target = sessionId ? `${url}?role=studio&sessionId=${encodeURIComponent(sessionId)}` : url
  const socket = new WebSocket(target, PREVIEW_SUBPROTOCOL)
  if (receivedMessages) {
    socket.on("message", (payload) => receivedMessages.push(JSON.parse(payload.toString())))
  }
  await once(socket, "open")
  assert.equal(socket.protocol, PREVIEW_SUBPROTOCOL)
  return socket
}

async function waitForMessages(messages, count) {
  const deadline = Date.now() + 2_000
  while (messages.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(messages.length, count)
}

test("relays canonical messages only within the same local preview session", async () => {
  const relay = createPreviewRelay({ port: 0 })
  await relay.ready
  const url = relay.address()
  assert.ok(url)

  const fixture = JSON.parse(
    await readFile(
      new URL(
        "../../../protocol/fixtures/local-preview/v0.1/session-flow.messages.json",
        import.meta.url,
      ),
      "utf8",
    ),
  )
  const connected = fixture.find((message) => message.type === "previewClientConnected")
  const capability = fixture.find((message) => message.type === "capabilityReport")
  assert.ok(connected)
  assert.ok(capability)
  const studioMessages = []
  const studio = await connect(url, connected.sessionId, studioMessages)
  const nativeClient = await connect(url)
  const otherStudio = await connect(url, "session_other_01")
  const otherMessages = []
  otherStudio.on("message", (payload) => otherMessages.push(payload.toString()))

  nativeClient.send(JSON.stringify(connected))
  nativeClient.send(JSON.stringify(capability))
  await waitForMessages(studioMessages, 2)
  nativeClient.send(
    JSON.stringify(heartbeat(connected.sessionId, 1, connected.payload.client.clientId)),
  )
  await waitForMessages(studioMessages, 3)
  assert.equal(studioMessages[2].sessionId, connected.sessionId)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(otherMessages.length, 0)

  studio.close()
  nativeClient.close()
  otherStudio.close()
  await relay.close()
})

test("replays cached identity then capabilities when Studio joins after a native client", async () => {
  const relay = createPreviewRelay({ port: 0 })
  await relay.ready
  const url = relay.address()
  assert.ok(url)
  const fixture = JSON.parse(
    await readFile(
      new URL(
        "../../../protocol/fixtures/local-preview/v0.1/session-flow.messages.json",
        import.meta.url,
      ),
      "utf8",
    ),
  )
  const connected = fixture.find((message) => message.type === "previewClientConnected")
  const capability = fixture.find((message) => message.type === "capabilityReport")
  assert.ok(connected)
  assert.ok(capability)

  const nativeClient = await connect(url)
  nativeClient.send(JSON.stringify(connected))
  nativeClient.send(JSON.stringify(capability))
  await new Promise((resolve) => setTimeout(resolve, 20))

  const received = []
  const studio = await connect(url, connected.sessionId, received)
  await waitForMessages(received, 2)
  assert.deepEqual(
    received.map((message) => message.type),
    ["previewClientConnected", "capabilityReport"],
  )

  studio.close()
  nativeClient.close()
  await relay.close()
})

test("notifies Studio when a connected native client closes", async () => {
  const relay = createPreviewRelay({ port: 0 })
  await relay.ready
  const url = relay.address()
  assert.ok(url)
  const fixture = JSON.parse(
    await readFile(
      new URL(
        "../../../protocol/fixtures/local-preview/v0.1/session-flow.messages.json",
        import.meta.url,
      ),
      "utf8",
    ),
  )
  const connected = fixture.find((message) => message.type === "previewClientConnected")
  assert.ok(connected)

  const studio = await connect(url, connected.sessionId)
  const nativeClient = await connect(url)
  nativeClient.send(JSON.stringify(connected))
  const [connectedPayload] = await once(studio, "message")
  assert.equal(JSON.parse(connectedPayload.toString()).type, "previewClientConnected")

  nativeClient.close()
  const [disconnectedPayload] = await once(studio, "message")
  const disconnected = JSON.parse(disconnectedPayload.toString())
  assert.equal(disconnected.type, "previewClientDisconnected")
  assert.equal(disconnected.payload.clientId, connected.payload.client.clientId)
  assert.equal(disconnected.payload.reason, "closed")

  studio.close()
  await relay.close()
})

test("rejects messages with unknown fields and requires the exact subprotocol", async () => {
  const relay = createPreviewRelay({ port: 0 })
  await relay.ready
  const url = relay.address()
  assert.ok(url)

  const invalid = await connect(url)
  invalid.send(JSON.stringify({ ...heartbeat("session_local_01"), unexpected: true }))
  const [code] = await once(invalid, "close")
  assert.equal(code, 1008)

  const noProtocol = new WebSocket(url)
  const [error] = await once(noProtocol, "error")
  assert.ok(error)

  await relay.close()
})

test("enforces client handshake order, message direction, and connected identity", async () => {
  const relay = createPreviewRelay({ port: 0 })
  await relay.ready
  const url = relay.address()
  assert.ok(url)
  const fixture = JSON.parse(
    await readFile(
      new URL(
        "../../../protocol/fixtures/local-preview/v0.1/session-flow.messages.json",
        import.meta.url,
      ),
      "utf8",
    ),
  )
  const connected = fixture.find((message) => message.type === "previewClientConnected")
  const capability = fixture.find((message) => message.type === "capabilityReport")
  const accepted = fixture.find((message) => message.type === "draftAccepted")
  const draft = fixture.find((message) => message.type === "draftUpdated")
  assert.ok(connected)
  assert.ok(capability)
  assert.ok(accepted)
  assert.ok(draft)

  const outOfOrderClient = await connect(url)
  outOfOrderClient.send(JSON.stringify(capability))
  const [outOfOrderCode] = await once(outOfOrderClient, "close")
  assert.equal(outOfOrderCode, 1008)

  const studio = await connect(url, connected.sessionId)
  studio.send(JSON.stringify(accepted))
  const [studioCode] = await once(studio, "close")
  assert.equal(studioCode, 1008)

  const mismatchedClient = await connect(url)
  mismatchedClient.send(JSON.stringify(connected))
  mismatchedClient.send(
    JSON.stringify({
      ...capability,
      messageId: "msg_identity_mismatch",
      payload: { ...capability.payload, clientId: "client_different_identity" },
    }),
  )
  const [mismatchCode] = await once(mismatchedClient, "close")
  assert.equal(mismatchCode, 1008)

  const wrongDirectionClient = await connect(url)
  wrongDirectionClient.send(JSON.stringify(connected))
  wrongDirectionClient.send(JSON.stringify(capability))
  wrongDirectionClient.send(JSON.stringify(draft))
  const [directionCode] = await once(wrongDirectionClient, "close")
  assert.equal(directionCode, 1008)

  await relay.close()
})

test("keeps the replacement socket active when a stable client identity reconnects", async () => {
  const relay = createPreviewRelay({ port: 0 })
  await relay.ready
  const url = relay.address()
  assert.ok(url)
  const fixture = JSON.parse(
    await readFile(
      new URL(
        "../../../protocol/fixtures/local-preview/v0.1/session-flow.messages.json",
        import.meta.url,
      ),
      "utf8",
    ),
  )
  const connected = fixture.find((message) => message.type === "previewClientConnected")
  const capability = fixture.find((message) => message.type === "capabilityReport")
  assert.ok(connected)
  assert.ok(capability)

  const studioMessages = []
  const studio = await connect(url, connected.sessionId, studioMessages)
  const original = await connect(url)
  original.send(JSON.stringify(connected))
  original.send(JSON.stringify(capability))
  await waitForMessages(studioMessages, 2)

  const replacement = await connect(url)
  const originalClosed = once(original, "close")
  replacement.send(JSON.stringify({ ...connected, messageId: "msg_replacement_connected" }))
  replacement.send(JSON.stringify({ ...capability, messageId: "msg_replacement_capability" }))
  await waitForMessages(studioMessages, 4)
  await originalClosed
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(
    studioMessages.filter((message) => message.type === "previewClientDisconnected").length,
    0,
  )

  replacement.send(
    JSON.stringify(heartbeat(connected.sessionId, 9, connected.payload.client.clientId)),
  )
  await waitForMessages(studioMessages, 5)
  assert.equal(studioMessages[4].type, "previewHeartbeat")

  studio.close()
  replacement.close()
  await relay.close()
})
