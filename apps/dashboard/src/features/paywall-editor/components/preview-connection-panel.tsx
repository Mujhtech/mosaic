import { CopyIcon } from "@phosphor-icons/react/dist/ssr/Copy"
import { PlugsConnectedIcon } from "@phosphor-icons/react/dist/ssr/PlugsConnected"
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { useEditorSelection } from "@/features/paywall-editor/hooks/use-editor-selection"
import { previewAcknowledgementKey } from "@/features/paywall-editor/hooks/use-preview-connection"
import { PREVIEW_WEBSOCKET_SUBPROTOCOLS } from "@/features/paywall-editor/schema/preview-message"
import type {
  PreviewAcknowledgement,
  PreviewAggregate,
} from "@/features/paywall-editor/hooks/use-preview-connection"
import type {
  MosaicDocument,
  PreviewClient,
  PreviewConnectionStatus,
  PreviewDiagnostic,
} from "@/features/paywall-editor/types/editor"
import { compatibilityWarnings } from "@/features/paywall-editor/utils/preview-compatibility"

const PREVIEW_PLATFORMS: ReadonlyArray<{
  id: Exclude<PreviewClient["platform"], "unknown">
  label: string
}> = [
  { id: "flutter", label: "Flutter" },
  { id: "ios", label: "iOS" },
  { id: "android", label: "Android" },
]

function statusLabel(status: PreviewConnectionStatus) {
  switch (status) {
    case "idle":
      return "Waiting"
    case "connecting":
      return "Connecting"
    case "connected":
      return "Relay connected"
    case "reconnecting":
      return "Reconnecting"
    case "disconnected":
      return "Disconnected"
    case "unavailable":
      return "Unavailable"
  }
}

function hasCapabilityReport(client: PreviewClient) {
  return (
    client.supportedSchemaVersions.length > 0 ||
    client.supportedCapabilities.length > 0 ||
    client.previewCapabilities.length > 0
  )
}

function platformStatus(clients: readonly PreviewClient[]) {
  if (clients.length === 0) {
    return {
      detail: "Waiting for example app",
      dotClassName: "bg-muted-foreground/35",
      label: "Not connected",
    }
  }

  const reportedCount = clients.filter(hasCapabilityReport).length
  if (reportedCount === 0) {
    return {
      detail: "Capability handshake",
      dotClassName: "bg-amber-500",
      label: "Connecting",
    }
  }
  if (reportedCount < clients.length) {
    return {
      detail: `${clients.length} preview clients`,
      dotClassName: "bg-amber-500",
      label: `${reportedCount} of ${clients.length} ready`,
    }
  }

  const onlyClient = clients.length === 1 ? clients[0] : undefined
  return {
    detail: onlyClient?.device.displayName ?? `${clients.length} preview clients`,
    dotClassName: "bg-emerald-500",
    label: clients.length === 1 ? "Connected" : `${clients.length} connected`,
  }
}

function platformLabel(platform: PreviewClient["platform"]) {
  return PREVIEW_PLATFORMS.find((entry) => entry.id === platform)?.label ?? "Native"
}

function capabilityList(capabilities: readonly { name: string; version: string }[]) {
  if (capabilities.length === 0) return "None reported"
  return capabilities.map((capability) => `${capability.name} · ${capability.version}`).join(", ")
}

function capabilitySummary(client: PreviewClient) {
  if (!hasCapabilityReport(client)) return "Waiting for report"
  return `${client.supportedCapabilities.length} protocol · ${client.previewCapabilities.length} preview`
}

function DiagnosticCard({
  diagnostic,
  onInspect,
}: {
  diagnostic: PreviewDiagnostic
  onInspect: (componentId: string) => void
}) {
  const componentId = diagnostic.componentId
  return (
    <article className="border-border rounded-lg border p-2.5 text-xs">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{diagnostic.message}</p>
        <span className="bg-muted shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize">
          {diagnostic.severity}
        </span>
      </div>
      {diagnostic.recovery ? (
        <p className="text-muted-foreground mt-1">{diagnostic.recovery}</p>
      ) : null}
      {componentId ? (
        <button
          type="button"
          className="text-primary focus-visible:ring-ring mt-2 rounded-sm font-semibold outline-none hover:underline focus-visible:ring-2"
          onClick={() => onInspect(componentId)}
        >
          Inspect affected content
        </button>
      ) : null}
      <details className="text-muted-foreground mt-2">
        <summary className="cursor-pointer">Diagnostic details</summary>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2">
          <dt>Code</dt>
          <dd className="break-all">{diagnostic.code}</dd>
          {diagnostic.revisionId ? (
            <>
              <dt>Update</dt>
              <dd className="break-all">{diagnostic.revisionId}</dd>
            </>
          ) : null}
          {diagnostic.documentPath ? (
            <>
              <dt>Path</dt>
              <dd className="break-all">{diagnostic.documentPath}</dd>
            </>
          ) : null}
        </dl>
      </details>
    </article>
  )
}

// The panel intentionally presents one connection aggregate; diagnostic cards and protocol state
// derivation are extracted, while the remaining markup is a single accessible status surface.
// oxlint-disable-next-line react-doctor/no-giant-component
export function PreviewConnectionPanel({
  document,
  endpoint,
  sessionId,
  status,
  clients,
  diagnostics,
  acknowledgements,
  aggregate,
  latestSentEditableDocumentId,
  latestSentRevisionId,
  onReconnect,
}: {
  document: MosaicDocument
  endpoint: string
  sessionId: string
  status: PreviewConnectionStatus
  clients: readonly PreviewClient[]
  diagnostics: readonly PreviewDiagnostic[]
  acknowledgements: Readonly<Record<string, PreviewAcknowledgement>>
  aggregate: PreviewAggregate
  latestSentEditableDocumentId: string | null
  latestSentRevisionId: string | null
  onReconnect: () => void
}) {
  const [copied, setCopied] = useState(false)
  const { selectComponent } = useEditorSelection()
  const warnings = compatibilityWarnings(document, clients)
  const incompatibleClientCount = clients.filter(
    (client) => compatibilityWarnings(document, [client]).length > 0,
  ).length
  const aggregateLabel =
    incompatibleClientCount > 0
      ? `${incompatibleClientCount} of ${clients.length} previews need compatibility attention`
      : aggregate.label
  const configuration = `command=npm run dev:studio\nendpoint=${endpoint}\nsession=${sessionId}\nsubprotocols=${PREVIEW_WEBSOCKET_SUBPROTOCOLS.join(",")}`
  const latestDiagnostic = diagnostics[0]

  return (
    <section
      id="connected-preview-panel"
      className="focus-visible:ring-ring scroll-mt-3 space-y-4 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      aria-labelledby="native-preview-title"
      tabIndex={-1}
    >
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {aggregateLabel}. {statusLabel(status)}.
      </p>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="native-preview-title" className="text-sm font-semibold">
            Native previews
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">{aggregateLabel}</p>
        </div>
        <span className="bg-muted rounded-full px-2 py-1 text-[11px] font-medium">
          {statusLabel(status)}
        </span>
      </div>

      <div className="bg-muted/70 rounded-xl p-3 text-xs">
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold">Connection instructions</p>
          <span className="text-muted-foreground">{statusLabel(status)}</span>
        </div>
        <p className="text-muted-foreground mt-1 leading-5">
          From the dashboard folder, start Studio and its relay. Then configure each example app
          with this endpoint and session.
        </p>
        <code className="bg-background mt-2 block overflow-x-auto rounded-lg border p-2 leading-5">
          npm run dev:studio
          <br />
          {endpoint}
          <br />
          {sessionId}
        </code>
        <div className="mt-2 flex gap-2">
          <Button
            size="xs"
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(configuration)
                setCopied(true)
              } catch {
                setCopied(false)
              }
            }}
          >
            <CopyIcon aria-hidden />
            {copied ? "Copied" : "Copy configuration"}
          </Button>
          {status === "disconnected" || status === "unavailable" ? (
            <Button size="xs" variant="outline" onClick={onReconnect}>
              Reconnect
            </Button>
          ) : null}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold">Platform status</h3>
        <ul className="mt-2 grid grid-cols-3 gap-2">
          {PREVIEW_PLATFORMS.map((platform) => {
            const state = platformStatus(
              clients.filter((client) => client.platform === platform.id),
            )
            return (
              <li key={platform.id} className="border-border min-w-0 rounded-lg border p-2">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${state.dotClassName}`}
                    aria-hidden
                  />
                  <p className="truncate text-xs font-medium">{platform.label}</p>
                </div>
                <p className="mt-1 truncate text-[11px] font-medium">{state.label}</p>
                <p
                  className="text-muted-foreground mt-0.5 truncate text-[10px]"
                  title={state.detail}
                >
                  {state.detail}
                </p>
              </li>
            )
          })}
        </ul>
      </div>

      {clients.length === 0 ? (
        <div className="border-border rounded-xl border border-dashed p-4 text-center">
          <PlugsConnectedIcon className="text-muted-foreground mx-auto" aria-hidden size={24} />
          <p className="mt-2 text-sm font-medium">No example app connected</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Start any example app with the configuration above to preview this draft natively.
          </p>
        </div>
      ) : (
        <div>
          <h3 className="text-xs font-semibold">Connected clients</h3>
          <ul className="mt-2 space-y-2">
            {clients.map((client) => {
              const recordedAcknowledgement = latestSentEditableDocumentId
                ? acknowledgements[
                    previewAcknowledgementKey(client.clientId, latestSentEditableDocumentId)
                  ]
                : undefined
              const acknowledgement =
                recordedAcknowledgement?.revisionId === latestSentRevisionId
                  ? recordedAcknowledgement
                  : undefined
              const hasCompatibilityWarning = compatibilityWarnings(document, [client]).length > 0
              return (
                <li key={client.clientId} className="border-border rounded-xl border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{client.displayName}</p>
                      <p className="text-muted-foreground truncate text-xs">
                        {platformLabel(client.platform)} · {client.application.displayName} ·{" "}
                        {client.device.displayName}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                        hasCompatibilityWarning
                          ? "bg-amber-100 text-amber-900"
                          : acknowledgement?.status === "accepted"
                            ? "bg-emerald-100 text-emerald-800"
                            : acknowledgement?.status === "rejected"
                              ? "bg-red-100 text-red-800"
                              : "bg-amber-100 text-amber-900"
                      }`}
                    >
                      {hasCompatibilityWarning
                        ? "Compatibility issue"
                        : acknowledgement?.status === "accepted"
                          ? "Updated"
                          : acknowledgement?.status === "rejected"
                            ? "Needs attention"
                            : "Waiting"}
                    </span>
                  </div>
                  {acknowledgement ? (
                    <>
                      <p className="text-muted-foreground mt-2 text-xs">
                        {acknowledgement.message}
                      </p>
                      <details className="text-muted-foreground mt-1 text-[11px]">
                        <summary className="cursor-pointer">Update details</summary>
                        Local update {acknowledgement.revisionSequence}
                      </details>
                    </>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div>
        <h3 className="text-xs font-semibold">Capabilities</h3>
        {clients.length === 0 ? (
          <p className="text-muted-foreground mt-1 text-xs">
            Capability reports appear after a native client connects.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {clients.map((client) => (
              <li
                key={client.clientId}
                className="border-border rounded-lg border px-2.5 py-2 text-xs"
              >
                <details>
                  <summary className="cursor-pointer font-medium">
                    {client.displayName} · {capabilitySummary(client)}
                  </summary>
                  {hasCapabilityReport(client) ? (
                    <dl className="text-muted-foreground mt-2 grid gap-1.5">
                      <div>
                        <dt className="text-foreground font-medium">Schema versions</dt>
                        <dd className="mt-0.5 break-words">
                          {client.supportedSchemaVersions.join(", ") || "None reported"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-foreground font-medium">Protocol capabilities</dt>
                        <dd className="mt-0.5 break-words">
                          {capabilityList(client.supportedCapabilities)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-foreground font-medium">Preview capabilities</dt>
                        <dd className="mt-0.5 break-words">
                          {capabilityList(client.previewCapabilities)}
                        </dd>
                      </div>
                      {client.maxDocumentBytes ? (
                        <div>
                          <dt className="text-foreground font-medium">Document limit</dt>
                          <dd className="mt-0.5">
                            {client.maxDocumentBytes.toLocaleString()} bytes
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  ) : (
                    <p className="text-muted-foreground mt-2">
                      The client is connected and has not reported capabilities yet.
                    </p>
                  )}
                </details>
              </li>
            ))}
          </ul>
        )}

        {warnings.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-xs">
            {clients.length === 0
              ? "Connect a client to check this draft."
              : "Connected clients support this draft and its preview updates."}
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {warnings.map((warning) => (
              <li
                key={warning}
                className="flex gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-950"
              >
                <WarningCircleIcon className="mt-0.5 shrink-0" aria-hidden />
                {warning}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-xs font-semibold">Last diagnostic</h3>
        {latestDiagnostic ? (
          <div className="mt-2">
            <DiagnosticCard diagnostic={latestDiagnostic} onInspect={selectComponent} />
          </div>
        ) : (
          <p className="text-muted-foreground mt-1 text-xs">No preview diagnostics yet.</p>
        )}
        {diagnostics.length > 1 ? (
          <details className="mt-2 text-xs">
            <summary className="text-muted-foreground cursor-pointer font-medium">
              {diagnostics.length - 1} earlier{" "}
              {diagnostics.length === 2 ? "diagnostic" : "diagnostics"}
            </summary>
            <ul className="mt-2 space-y-2">
              {diagnostics.slice(1).map((diagnostic) => (
                <li key={diagnostic.id}>
                  <DiagnosticCard diagnostic={diagnostic} onInspect={selectComponent} />
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </section>
  )
}
