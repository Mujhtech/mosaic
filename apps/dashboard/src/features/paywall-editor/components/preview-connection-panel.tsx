import { CopyIcon } from "@phosphor-icons/react/dist/ssr/Copy"
import { PlugsConnectedIcon } from "@phosphor-icons/react/dist/ssr/PlugsConnected"
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { previewAcknowledgementKey } from "@/features/paywall-editor/hooks/use-preview-connection"
import type {
  PreviewAcknowledgement,
  PreviewAggregate,
} from "@/features/paywall-editor/hooks/use-preview-connection"
import { useEditorSelection } from "@/features/paywall-editor/hooks/use-editor-selection"
import type {
  MosaicDocument,
  PreviewClient,
  PreviewConnectionStatus,
  PreviewDiagnostic,
} from "@/features/paywall-editor/types/editor"
import { compatibilityWarnings } from "@/features/paywall-editor/utils/preview-compatibility"

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
  const configuration = `command=npm run dev:studio\nendpoint=${endpoint}\nsession=${sessionId}\nsubprotocol=mosaic.local-preview.v0.1`

  return (
    <section className="space-y-4" aria-labelledby="native-preview-title">
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
        <p className="font-semibold">Connect an example app</p>
        <p className="text-muted-foreground mt-1 leading-5">
          From the dashboard folder run the command below, then configure the example app with this
          endpoint and session.
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
              Retry
            </Button>
          ) : null}
        </div>
      </div>

      {clients.length === 0 ? (
        <div className="border-border rounded-xl border border-dashed p-4 text-center">
          <PlugsConnectedIcon className="text-muted-foreground mx-auto" aria-hidden size={24} />
          <p className="mt-2 text-sm font-medium">No example app connected</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Editing remains safe; no acknowledgement is shown until a real client responds.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
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
                      {client.application.displayName} · {client.device.displayName}
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
                    <p className="text-muted-foreground mt-2 text-xs">{acknowledgement.message}</p>
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
      )}

      <div>
        <h3 className="text-xs font-semibold">Compatibility</h3>
        {warnings.length === 0 ? (
          <p className="text-muted-foreground mt-1 text-xs">
            {clients.length === 0
              ? "Capabilities appear after a native client connects."
              : "Connected clients report the required capabilities."}
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

      {diagnostics.length > 0 ? (
        <div>
          <h3 className="text-xs font-semibold">Preview diagnostics</h3>
          <ul className="mt-2 space-y-2">
            {diagnostics.map((diagnostic) => (
              <li key={diagnostic.id} className="border-border rounded-lg border p-2.5 text-xs">
                <p className="font-medium">{diagnostic.message}</p>
                {diagnostic.recovery ? (
                  <p className="text-muted-foreground mt-1">{diagnostic.recovery}</p>
                ) : null}
                {diagnostic.componentId ? (
                  <button
                    type="button"
                    className="text-primary mt-2 font-semibold hover:underline"
                    onClick={() => selectComponent(diagnostic.componentId ?? null)}
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
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
