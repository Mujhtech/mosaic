import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_MOCK_PRODUCTS } from "@/features/paywall-editor/constants/editor-constants"
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import {
  applyPreviewAcknowledgement,
  derivePreviewAggregate,
  previewAcknowledgementKey,
  type PreviewAcknowledgement,
  usePreviewConnection,
} from "@/features/paywall-editor/hooks/use-preview-connection"
import type { MosaicDocument, PreviewClient } from "@/features/paywall-editor/types/editor"
import { cloneValue } from "@/features/paywall-editor/utils/clone"

type SocketEvent = { data?: string }
type SocketListener = (event: SocketEvent) => void

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static readonly instances: FakeWebSocket[] = []

  readonly url: string
  readonly requestedProtocol: string | string[] | undefined
  readonly sent: unknown[] = []
  readyState = FakeWebSocket.CONNECTING
  private readonly listeners = new Map<string, Set<SocketListener>>()

  constructor(url: string | URL, protocols?: string | string[]) {
    this.url = String(url)
    this.requestedProtocol = protocols
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: SocketListener) {
    const listeners = this.listeners.get(type) ?? new Set<SocketListener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  send(value: string) {
    this.sent.push(JSON.parse(value))
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.dispatch("open", {})
  }

  receive(message: unknown) {
    this.dispatch("message", { data: JSON.stringify(message) })
  }

  serverClose() {
    this.readyState = FakeWebSocket.CLOSED
    this.dispatch("close", {})
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    this.dispatch("close", {})
  }

  private dispatch(type: string, event: SocketEvent) {
    this.listeners.get(type)?.forEach((listener) => listener(event))
  }
}

const SESSION_ID = "session_local_01"
const EDITABLE_DOCUMENT_ID = "document_phase2_test"

function envelope(type: string, payload: object, sequence: number) {
  return {
    previewProtocolVersion: "0.1",
    messageId: `msg_test_${sequence}`,
    sessionId: SESSION_ID,
    sentAt: "2026-07-17T08:00:00Z",
    type,
    payload,
  }
}

function connected(clientId: string, sequence: number) {
  return envelope(
    "previewClientConnected",
    {
      client: {
        clientId,
        displayName: clientId.includes("flutter") ? "Flutter preview" : "iOS preview",
        renderer: {
          id: clientId.includes("flutter") ? "mosaic.flutter" : "mosaic.ios",
          version: "0.1.0",
        },
        application: {
          id: `${clientId}.app`,
          displayName: "Mosaic Example",
          version: "0.1.0",
        },
        device: {
          displayName: "Local device",
          systemName: "Example OS",
          systemVersion: "1.0",
        },
      },
    },
    sequence,
  )
}

function capability(
  document: MosaicDocument,
  clientId: string,
  sequence: number,
  maxDocumentBytes = 1_048_576,
) {
  return envelope(
    "capabilityReport",
    {
      clientId,
      supportedSchemaVersions: ["0.1"],
      supportedCapabilities: document.compatibility.requiredCapabilities,
      previewCapabilities: [
        { name: "preview.liveUpdate", version: "0.1" },
        { name: "preview.mockCommerce", version: "0.1" },
        { name: "preview.localeOverride", version: "0.1" },
        { name: "preview.textScale", version: "0.1" },
        { name: "preview.diagnostics", version: "0.1" },
      ],
      limits: { maxDocumentBytes },
    },
    sequence,
  )
}

function acknowledgement(
  clientId: string,
  revision: { revisionId: string; sequence: number },
  sequence: number,
) {
  return envelope(
    "draftAccepted",
    {
      clientId,
      editableDocumentId: EDITABLE_DOCUMENT_ID,
      revision,
    },
    sequence,
  )
}

function warning(
  clientId: string,
  revision: { revisionId: string; sequence: number },
  sequence: number,
) {
  return envelope(
    "renderWarning",
    {
      clientId,
      editableDocumentId: EDITABLE_DOCUMENT_ID,
      revision,
      warnings: [
        {
          code: "render.textFallback",
          severity: "warning",
          message: "The renderer used a safe text fallback.",
          location: {
            documentPath: "/layout/content/children/1/value",
            componentId: "headline",
            property: "value",
          },
          fallback: "nativeApproximation",
          recovery: {
            action: "inspectComponent",
            message: "Inspect the affected text.",
          },
        },
      ],
    },
    sequence,
  )
}

function heartbeat(clientId: string, sequence: number) {
  return envelope("previewHeartbeat", { clientId, kind: "ping", sequence }, sequence)
}

function client(clientId: string): PreviewClient {
  return {
    clientId,
    sessionId: SESSION_ID,
    platform: "flutter",
    displayName: clientId,
    renderer: { id: "mosaic.flutter", version: "0.1.0" },
    application: { id: "example.app", displayName: "Example", version: "0.1.0" },
    device: { displayName: "Device", systemName: "OS", systemVersion: "1" },
    supportedSchemaVersions: ["0.1"],
    supportedCapabilities: [],
    previewCapabilities: [],
    lastSeenAt: "2026-07-17T08:00:00Z",
  }
}

describe("preview acknowledgement aggregation", () => {
  it("counts only acknowledgements for the current revision across clients", () => {
    const acknowledgements: Record<string, PreviewAcknowledgement> = {
      [previewAcknowledgementKey("client_flutter", EDITABLE_DOCUMENT_ID)]: {
        clientId: "client_flutter",
        editableDocumentId: EDITABLE_DOCUMENT_ID,
        revisionId: "revision_current_12",
        revisionSequence: 12,
        status: "accepted",
        message: "Updated",
      },
      [previewAcknowledgementKey("client_ios", EDITABLE_DOCUMENT_ID)]: {
        clientId: "client_ios",
        editableDocumentId: EDITABLE_DOCUMENT_ID,
        revisionId: "revision_previous_11",
        revisionSequence: 11,
        status: "rejected",
        message: "Old rejection",
      },
    }
    expect(
      derivePreviewAggregate({
        clients: [client("client_flutter"), client("client_ios")],
        acknowledgements,
        editableDocumentId: EDITABLE_DOCUMENT_ID,
        revisionId: "revision_current_12",
        revisionSequence: 12,
      }),
    ).toEqual({
      total: 2,
      accepted: 1,
      rejected: 0,
      pending: 1,
      label: "1 of 2 previews updated",
    })
  })

  it("treats the same revision pair as idempotent and reports equal-sequence ID conflicts", () => {
    const accepted: PreviewAcknowledgement = {
      clientId: "client_flutter",
      editableDocumentId: EDITABLE_DOCUMENT_ID,
      revisionId: "revision_alpha_12",
      revisionSequence: 12,
      status: "accepted",
      message: "Updated",
    }
    const key = previewAcknowledgementKey("client_flutter", EDITABLE_DOCUMENT_ID)
    const current = { [key]: accepted }

    expect(applyPreviewAcknowledgement(current, accepted)).toEqual({
      acknowledgements: current,
      conflict: null,
    })
    expect(
      applyPreviewAcknowledgement(current, {
        ...accepted,
        revisionId: "revision_beta_12",
        status: "rejected",
      }),
    ).toEqual({
      acknowledgements: current,
      conflict: {
        clientId: "client_flutter",
        editableDocumentId: EDITABLE_DOCUMENT_ID,
        revisionSequence: 12,
        existingRevisionId: "revision_alpha_12",
        incomingRevisionId: "revision_beta_12",
      },
    })
  })
})

describe("preview connection", () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0
    vi.useFakeTimers()
    vi.stubGlobal("WebSocket", FakeWebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("waits for capabilities, deduplicates diagnostics, and replays with a stable session", async () => {
    const document = cloneValue(EDITOR_TEMPLATES[0]!.document)
    const observed: { current?: ReturnType<typeof usePreviewConnection> } = {}
    const onRevisionDispatched = vi.fn()

    function result() {
      if (!observed.current) throw new Error("Preview hook result was not observed")
      return observed.current
    }

    function Harness() {
      observed.current = usePreviewConnection({
        document,
        editableDocumentId: EDITABLE_DOCUMENT_ID,
        locale: "en",
        textScale: 1,
        isValid: true,
        mockPurchaseState: "productAvailable",
        mockProducts: DEFAULT_MOCK_PRODUCTS,
        initialRevisionSequence: 10,
        onRevisionDispatched,
      })
      return null
    }

    render(<Harness />)
    const firstSocket = FakeWebSocket.instances[0]
    expect(firstSocket).toBeDefined()
    expect(firstSocket?.url).toContain(`sessionId=${SESSION_ID}`)
    expect(firstSocket?.requestedProtocol).toBe("mosaic.local-preview.v0.1")

    await act(async () => firstSocket?.open())
    expect(firstSocket?.sent).toEqual([])

    await act(async () => {
      firstSocket?.receive(connected("client_flutter", 1))
      await Promise.resolve()
    })
    expect(firstSocket?.sent).toEqual([])

    await act(async () => {
      firstSocket?.receive(capability(document, "client_flutter", 2))
      await Promise.resolve()
    })
    expect(firstSocket?.sent.map((message) => (message as { type: string }).type)).toEqual([
      "mockCommerceStateChanged",
      "draftUpdated",
    ])

    await act(async () => {
      firstSocket?.receive(connected("client_ios", 3))
      firstSocket?.receive(capability(document, "client_ios", 4))
      await Promise.resolve()
    })
    const latestDraft = [...(firstSocket?.sent ?? [])]
      .reverse()
      .find((message) => (message as { type: string }).type === "draftUpdated") as {
      payload: { revision: { revisionId: string; sequence: number } }
    }
    expect(latestDraft).toBeDefined()

    await act(async () => {
      firstSocket?.receive(acknowledgement("client_flutter", latestDraft.payload.revision, 5))
      firstSocket?.receive(acknowledgement("client_ios", latestDraft.payload.revision, 6))
      await Promise.resolve()
    })
    expect(result().aggregate).toMatchObject({
      total: 2,
      accepted: 2,
      rejected: 0,
      pending: 0,
    })

    await act(async () => {
      firstSocket?.receive(
        acknowledgement(
          "client_flutter",
          {
            ...latestDraft.payload.revision,
            revisionId: "revision_conflicting_identity",
          },
          7,
        ),
      )
      await Promise.resolve()
    })
    expect(
      result().acknowledgements[previewAcknowledgementKey("client_flutter", EDITABLE_DOCUMENT_ID)]
        ?.revisionId,
    ).toBe(latestDraft.payload.revision.revisionId)
    expect(result().diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "preview.revisionConflict" }),
    )

    const repeatedWarning = warning("client_flutter", latestDraft.payload.revision, 8)
    await act(async () => {
      firstSocket?.receive(repeatedWarning)
      firstSocket?.receive({ ...repeatedWarning, messageId: "msg_test_9" })
      await Promise.resolve()
    })
    expect(
      result().diagnostics.filter((diagnostic) => diagnostic.code === "render.textFallback"),
    ).toHaveLength(1)

    await act(async () => firstSocket?.serverClose())
    expect(result().status).toBe("reconnecting")
    await act(async () => vi.advanceTimersByTimeAsync(499))
    expect(FakeWebSocket.instances).toHaveLength(1)
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(FakeWebSocket.instances).toHaveLength(2)

    const reconnectedSocket = FakeWebSocket.instances[1]
    expect(reconnectedSocket?.url).toContain(`sessionId=${SESSION_ID}`)
    await act(async () => reconnectedSocket?.open())
    expect(reconnectedSocket?.sent).toEqual([])
    await act(async () => {
      reconnectedSocket?.receive(connected("client_flutter", 10))
      reconnectedSocket?.receive(capability(document, "client_flutter", 11))
      await Promise.resolve()
    })
    expect(reconnectedSocket?.sent.map((message) => (message as { type: string }).type)).toEqual([
      "mockCommerceStateChanged",
      "draftUpdated",
    ])
    expect(onRevisionDispatched).toHaveBeenCalled()
  })

  it("ignores capability reports without a preceding connected identity", async () => {
    const document = cloneValue(EDITOR_TEMPLATES[0]!.document)

    function Harness() {
      usePreviewConnection({
        document,
        editableDocumentId: EDITABLE_DOCUMENT_ID,
        locale: "en",
        textScale: 1,
        isValid: true,
        mockPurchaseState: "productAvailable",
        mockProducts: DEFAULT_MOCK_PRODUCTS,
      })
      return null
    }

    render(<Harness />)
    const socket = FakeWebSocket.instances[0]
    await act(async () => socket?.open())
    await act(async () => {
      socket?.receive(capability(document, "client_flutter", 1))
      await Promise.resolve()
    })

    expect(socket?.sent).toEqual([])
  })

  it("does not broadcast a draft above a connected client's reported byte limit", async () => {
    const document = cloneValue(EDITOR_TEMPLATES[0]!.document)
    for (let index = 0; index < 14; index += 1) {
      document.localization.locales.en!.strings[`test.large_${index}`] = "x".repeat(5_000)
    }
    const observed: { current?: ReturnType<typeof usePreviewConnection> } = {}

    function Harness() {
      observed.current = usePreviewConnection({
        document,
        editableDocumentId: EDITABLE_DOCUMENT_ID,
        locale: "en",
        textScale: 1,
        isValid: true,
        mockPurchaseState: "productAvailable",
        mockProducts: DEFAULT_MOCK_PRODUCTS,
      })
      return null
    }

    render(<Harness />)
    const socket = FakeWebSocket.instances[0]
    await act(async () => socket?.open())
    await act(async () => {
      socket?.receive(connected("client_flutter", 1))
      socket?.receive(capability(document, "client_flutter", 2, 65_536))
      await Promise.resolve()
    })

    expect(socket?.sent).not.toContainEqual(expect.objectContaining({ type: "draftUpdated" }))
    expect(observed.current?.diagnostics).toContainEqual(
      expect.objectContaining({ code: "preview.documentExceedsClientLimit" }),
    )
  })

  it("answers a heartbeat while the current draft is invalid", async () => {
    const invalidDocument = cloneValue(EDITOR_TEMPLATES[0]!.document)
    invalidDocument.layout.content.children = invalidDocument.layout.content.children.filter(
      (node) => node.type !== "purchaseButton",
    )

    function Harness() {
      usePreviewConnection({
        document: invalidDocument,
        editableDocumentId: EDITABLE_DOCUMENT_ID,
        locale: "en",
        textScale: 1,
        isValid: false,
        mockPurchaseState: "productAvailable",
        mockProducts: DEFAULT_MOCK_PRODUCTS,
      })
      return null
    }

    render(<Harness />)
    const socket = FakeWebSocket.instances[0]
    await act(async () => socket?.open())
    await act(async () => {
      socket?.receive(connected("client_flutter", 1))
      socket?.receive(capability(invalidDocument, "client_flutter", 2))
      await Promise.resolve()
      socket?.receive(heartbeat("client_flutter", 42))
      await Promise.resolve()
    })

    expect(socket?.sent).toContainEqual(
      expect.objectContaining({
        type: "previewHeartbeat",
        payload: { clientId: "client_flutter", kind: "pong", sequence: 42 },
      }),
    )
  })
})
