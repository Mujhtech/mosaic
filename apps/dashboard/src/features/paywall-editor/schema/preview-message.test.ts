import { describe, expect, it } from "vitest"

import canonicalDocumentFixture from "../../../../../../protocol/fixtures/v0.1/complete-paywall.json"
import sessionFlowFixture from "../../../../../../protocol/fixtures/local-preview/v0.1/session-flow.messages.json"

import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import { mockCommerceState } from "@/features/paywall-editor/mutations/local-project-file"
import {
  createDraftUpdatedMessage,
  createHeartbeatPongMessage,
  createMockCommerceStateChangedMessage,
  parsePreviewMessage,
  PREVIEW_WEBSOCKET_SUBPROTOCOL,
} from "@/features/paywall-editor/schema/preview-message"
import { validatePaywallDocument, validatePreviewMessage } from "@/lib/mosaic-protocol"

describe("preview message adapter", () => {
  it("matches the canonical fixture flow including the intentional invalid draft", () => {
    const canonicalDocument = validatePaywallDocument(canonicalDocumentFixture)
    if (!canonicalDocument.ok) throw new Error("Canonical fixture must validate")
    const results = sessionFlowFixture.map((message) => ({
      messageId: message.messageId,
      result: validatePreviewMessage(message, {
        document: canonicalDocument.value,
      }),
    }))

    expect(results.filter((entry) => entry.result.ok)).toHaveLength(16)
    expect(results.filter((entry) => !entry.result.ok).map((entry) => entry.messageId)).toEqual([
      "msg_000009",
    ])
    expect(canonicalDocument.value.schemaVersion).toBe("0.1")
  })

  it("emits exact canonical draft, commerce, and heartbeat envelopes", () => {
    const document = EDITOR_TEMPLATES[0]!.document
    const editableDocumentId = "document_message_test"
    const revision = { revisionId: "revision_test_12", sequence: 12 }
    const draft = createDraftUpdatedMessage({
      sessionId: "session_local_01",
      editableDocumentId,
      document,
      locale: "ar",
      textScale: 1.8,
      revision,
    })
    const commerce = createMockCommerceStateChangedMessage({
      sessionId: "session_local_01",
      editableDocumentId,
      revision,
      state: mockCommerceState("purchaseFailure"),
    })
    const heartbeat = createHeartbeatPongMessage({
      sessionId: "session_local_01",
      clientId: "client_flutter",
      sequence: 9,
    })
    const canonicalDocument = validatePaywallDocument(document)
    if (!canonicalDocument.ok) throw new Error("Editor template must validate")

    expect(PREVIEW_WEBSOCKET_SUBPROTOCOL).toBe("mosaic.local-preview.v0.1")
    expect(validatePreviewMessage(draft).ok).toBe(true)
    expect(validatePreviewMessage(commerce, { document: canonicalDocument.value }).ok).toBe(true)
    expect(validatePreviewMessage(heartbeat).ok).toBe(true)
    expect(draft.payload).toEqual({
      editableDocumentId,
      revision,
      document,
      preview: { locale: "ar", textScale: 1.8 },
    })
    expect(commerce.payload).toHaveProperty("stateRevision", revision)
  })

  it("drops messages with unknown envelope fields", () => {
    const heartbeat = createHeartbeatPongMessage({
      sessionId: "session_local_01",
      clientId: "client_flutter",
      sequence: 9,
    })
    expect(parsePreviewMessage(JSON.stringify({ ...heartbeat, unexpected: true }))).toBeNull()
  })
})
