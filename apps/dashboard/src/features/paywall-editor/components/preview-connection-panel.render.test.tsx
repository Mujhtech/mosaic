import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { PreviewConnectionPanel } from "@/features/paywall-editor/components/preview-connection-panel"
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import type { PreviewAggregate } from "@/features/paywall-editor/hooks/use-preview-connection"
import { PREVIEW_PROTOCOL_VERSION } from "@/features/paywall-editor/schema/preview-message"
import { EditorStoreProvider } from "@/features/paywall-editor/stores/editor-store-context"
import type {
  PreviewClient,
  PreviewConnectionStatus,
  PreviewDiagnostic,
} from "@/features/paywall-editor/types/editor"
import { requiredPreviewCapabilities } from "@/lib/mosaic-protocol"

const document = EDITOR_TEMPLATES[0]!.document

function previewClient(
  platform: PreviewClient["platform"],
  options: { capabilities?: boolean; id?: string } = {},
): PreviewClient {
  const capabilities = options.capabilities ?? true
  const id = options.id ?? `client_${platform}`
  return {
    clientId: id,
    sessionId: "session_local_01",
    platform,
    displayName: `${platform === "ios" ? "iOS" : "Flutter"} preview`,
    renderer: { id: `mosaic.${platform}`, version: "0.1.0" },
    application: { id: "example.app", displayName: "Example", version: "0.1.0" },
    device: { displayName: "Test device", systemName: "OS", systemVersion: "1" },
    supportedSchemaVersions: capabilities ? [document.schemaVersion] : [],
    supportedCapabilities: capabilities
      ? document.compatibility.requiredCapabilities.map((capability) => ({ ...capability }))
      : [],
    previewCapabilities: capabilities
      ? requiredPreviewCapabilities.map((name) => ({
          name,
          version: PREVIEW_PROTOCOL_VERSION,
        }))
      : [],
    maxDocumentBytes: capabilities ? 1_048_576 : undefined,
    lastSeenAt: "2026-07-17T08:00:00Z",
  }
}

function aggregate(total: number): PreviewAggregate {
  return {
    total,
    accepted: 0,
    rejected: 0,
    pending: total,
    label: total === 0 ? "No native previews connected" : `0 of ${total} previews updated`,
  }
}

function renderPanel({
  clients = [],
  diagnostics = [],
  onReconnect = vi.fn(),
  status = "connected",
}: {
  clients?: readonly PreviewClient[]
  diagnostics?: readonly PreviewDiagnostic[]
  onReconnect?: () => void
  status?: PreviewConnectionStatus
} = {}) {
  render(
    <EditorStoreProvider>
      <PreviewConnectionPanel
        acknowledgements={{}}
        aggregate={aggregate(clients.length)}
        clients={clients}
        diagnostics={diagnostics}
        document={document}
        endpoint="ws://127.0.0.1:8787/preview"
        latestSentEditableDocumentId={null}
        latestSentRevisionId={null}
        onReconnect={onReconnect}
        sessionId="session_local_01"
        status={status}
      />
    </EditorStoreProvider>,
  )
}

describe("PreviewConnectionPanel", () => {
  it("keeps the empty state actionable and reports all three native platforms", () => {
    renderPanel({ status: "reconnecting" })

    const panel = screen.getByRole("region", { name: "Native previews" })
    expect(panel).toHaveAttribute("id", "connected-preview-panel")
    expect(panel).toHaveAttribute("tabindex", "-1")
    expect(within(panel).getByText("Connection instructions")).toBeVisible()
    expect(within(panel).getByText(/npm run dev:studio/, { selector: "code" })).toBeVisible()
    expect(within(panel).getByText("Flutter")).toBeVisible()
    expect(within(panel).getByText("iOS")).toBeVisible()
    expect(within(panel).getByText("Android")).toBeVisible()
    expect(within(panel).getAllByText("Not connected")).toHaveLength(3)
    expect(within(panel).getByRole("heading", { name: "Capabilities" })).toBeVisible()
    expect(within(panel).getByRole("heading", { name: "Last diagnostic" })).toBeVisible()
    expect(within(panel).getByText("No preview diagnostics yet.")).toBeVisible()
    expect(within(panel).getAllByText("Reconnecting").length).toBeGreaterThan(0)
  })

  it("separates connected, handshaking, and disconnected platform status", () => {
    renderPanel({
      clients: [previewClient("flutter"), previewClient("ios", { capabilities: false })],
    })

    const flutterRow = screen.getByText("Flutter").closest("li")
    const iosRow = screen.getByText("iOS").closest("li")
    const androidRow = screen.getByText("Android").closest("li")
    expect(flutterRow).not.toBeNull()
    expect(iosRow).not.toBeNull()
    expect(androidRow).not.toBeNull()
    if (!flutterRow || !iosRow || !androidRow) throw new Error("Expected all platform rows")
    expect(within(flutterRow).getByText("Connected")).toBeVisible()
    expect(within(iosRow).getByText("Connecting")).toBeVisible()
    expect(within(androidRow).getByText("Not connected")).toBeVisible()

    expect(screen.getByText(/Flutter preview · \d+ protocol · \d+ preview/)).toBeVisible()
    expect(screen.getByText("iOS preview · Waiting for report")).toBeVisible()
    expect(screen.getByText("Schema versions")).toBeInTheDocument()
    expect(screen.getByText("Document limit")).toBeInTheDocument()
  })

  it("shows the latest diagnostic and exposes reconnect as a recovery action", () => {
    const onReconnect = vi.fn()
    renderPanel({
      diagnostics: [
        {
          id: "client_flutter:revision_2:unsupported",
          severity: "warning",
          code: "preview.unsupportedComponent",
          message: "Flutter used the component fallback.",
          recovery: "Replace the unsupported component, then resend the draft.",
          createdAt: "2026-07-17T08:00:00Z",
        },
      ],
      onReconnect,
      status: "disconnected",
    })

    expect(screen.getByText("Flutter used the component fallback.")).toBeVisible()
    expect(
      screen.getByText("Replace the unsupported component, then resend the draft."),
    ).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }))
    expect(onReconnect).toHaveBeenCalledOnce()
  })
})
