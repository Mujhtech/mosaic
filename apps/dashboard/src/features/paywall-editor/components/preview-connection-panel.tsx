import { CopyIcon } from "@phosphor-icons/react/dist/ssr/Copy";
import { PlugsConnectedIcon } from "@phosphor-icons/react/dist/ssr/PlugsConnected";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useEditorSelection } from "@/features/paywall-editor/hooks/use-editor-selection";
import type {
  PreviewAcknowledgement,
  PreviewAggregate,
} from "@/features/paywall-editor/hooks/use-preview-connection";
import { previewAcknowledgementKey } from "@/features/paywall-editor/hooks/use-preview-connection";
import { PREVIEW_WEBSOCKET_SUBPROTOCOLS } from "@/features/paywall-editor/schema/preview-message";
import type {
  MosaicDocument,
  PreviewClient,
  PreviewConnectionStatus,
  PreviewDiagnostic,
} from "@/features/paywall-editor/types/editor";
import { compatibilityWarnings } from "@/features/paywall-editor/utils/preview-compatibility";

const PREVIEW_PLATFORMS: ReadonlyArray<{
  id: Exclude<PreviewClient["platform"], "unknown">;
  label: string;
}> = [
  { id: "flutter", label: "Flutter" },
  { id: "ios", label: "iOS" },
  { id: "android", label: "Android" },
];

function statusLabel(status: PreviewConnectionStatus) {
  switch (status) {
    case "idle":
      return "Waiting";
    case "connecting":
      return "Connecting";
    case "connected":
      return "Relay connected";
    case "reconnecting":
      return "Reconnecting";
    case "disconnected":
      return "Disconnected";
    case "unavailable":
      return "Unavailable";
  }
}

function hasCapabilityReport(client: PreviewClient) {
  return (
    client.supportedSchemaVersions.length > 0 ||
    client.supportedCapabilities.length > 0 ||
    client.previewCapabilities.length > 0
  );
}

function platformStatus(clients: readonly PreviewClient[]) {
  if (clients.length === 0) {
    return {
      detail: "Waiting for example app",
      dotClassName: "bg-muted-foreground/35",
      label: "Not connected",
    };
  }

  const reportedCount = clients.filter(hasCapabilityReport).length;
  if (reportedCount === 0) {
    return {
      detail: "Capability handshake",
      dotClassName: "bg-amber-500",
      label: "Connecting",
    };
  }
  if (reportedCount < clients.length) {
    return {
      detail: `${clients.length} preview clients`,
      dotClassName: "bg-amber-500",
      label: `${reportedCount} of ${clients.length} ready`,
    };
  }

  const onlyClient = clients.length === 1 ? clients[0] : undefined;
  return {
    detail:
      onlyClient?.device.displayName ?? `${clients.length} preview clients`,
    dotClassName: "bg-emerald-500",
    label: clients.length === 1 ? "Connected" : `${clients.length} connected`,
  };
}

function platformLabel(platform: PreviewClient["platform"]) {
  return (
    PREVIEW_PLATFORMS.find((entry) => entry.id === platform)?.label ?? "Native"
  );
}

function capabilityList(
  capabilities: readonly { name: string; version: string }[]
) {
  if (capabilities.length === 0) {
    return "None reported";
  }
  return capabilities
    .map((capability) => `${capability.name} · ${capability.version}`)
    .join(", ");
}

function capabilitySummary(client: PreviewClient) {
  if (!hasCapabilityReport(client)) {
    return "Waiting for report";
  }
  return `${client.supportedCapabilities.length} protocol · ${client.previewCapabilities.length} preview`;
}

function DiagnosticCard({
  diagnostic,
  onInspect,
}: {
  diagnostic: PreviewDiagnostic;
  onInspect: (componentId: string) => void;
}) {
  const componentId = diagnostic.componentId;
  return (
    <article className="rounded border border-border p-2.5 text-xs">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{diagnostic.message}</p>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 font-medium text-[10px] capitalize">
          {diagnostic.severity}
        </span>
      </div>
      {diagnostic.recovery ? (
        <p className="mt-1 text-muted-foreground">{diagnostic.recovery}</p>
      ) : null}
      {componentId ? (
        <button
          className="mt-2 rounded font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onInspect(componentId)}
          type="button"
        >
          Inspect affected content
        </button>
      ) : null}
      <details className="mt-2 text-muted-foreground">
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
  );
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
  document: MosaicDocument;
  endpoint: string;
  sessionId: string;
  status: PreviewConnectionStatus;
  clients: readonly PreviewClient[];
  diagnostics: readonly PreviewDiagnostic[];
  acknowledgements: Readonly<Record<string, PreviewAcknowledgement>>;
  aggregate: PreviewAggregate;
  latestSentEditableDocumentId: string | null;
  latestSentRevisionId: string | null;
  onReconnect: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const { selectComponent } = useEditorSelection();
  const warnings = compatibilityWarnings(document, clients);
  const incompatibleClientCount = clients.filter(
    (client) => compatibilityWarnings(document, [client]).length > 0
  ).length;
  const aggregateLabel =
    incompatibleClientCount > 0
      ? `${incompatibleClientCount} of ${clients.length} previews need compatibility attention`
      : aggregate.label;
  const configuration = `command=npm run dev:studio\nendpoint=${endpoint}\nsession=${sessionId}\nsubprotocols=${PREVIEW_WEBSOCKET_SUBPROTOCOLS.join(",")}`;
  const latestDiagnostic = diagnostics[0];

  return (
    <section
      aria-labelledby="native-preview-title"
      className="scroll-mt-3 space-y-4 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      id="connected-preview-panel"
      tabIndex={-1}
    >
      <p aria-atomic="true" aria-live="polite" className="sr-only">
        {aggregateLabel}. {statusLabel(status)}.
      </p>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-sm" id="native-preview-title">
            Native previews
          </h2>
          <p className="mt-0.5 text-muted-foreground text-xs">
            {aggregateLabel}
          </p>
        </div>
        <span className="rounded-full bg-muted px-2 py-1 font-medium text-[11px]">
          {statusLabel(status)}
        </span>
      </div>

      <div className="rounded bg-muted/70 p-3 text-xs">
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold">Connection instructions</p>
          <span className="text-muted-foreground">{statusLabel(status)}</span>
        </div>
        <p className="mt-1 text-muted-foreground leading-5">
          From the dashboard folder, start Studio and its relay. Then configure
          each example app with this endpoint and session.
        </p>
        <code className="mt-2 block overflow-x-auto rounded border bg-background p-2 leading-5">
          npm run dev:studio
          <br />
          {endpoint}
          <br />
          {sessionId}
        </code>
        <div className="mt-2 flex gap-2">
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(configuration);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
            size="xs"
            variant="outline"
          >
            <CopyIcon aria-hidden />
            {copied ? "Copied" : "Copy configuration"}
          </Button>
          {status === "disconnected" || status === "unavailable" ? (
            <Button onClick={onReconnect} size="xs" variant="outline">
              Reconnect
            </Button>
          ) : null}
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-xs">Platform status</h3>
        <ul className="mt-2 grid grid-cols-3 gap-2">
          {PREVIEW_PLATFORMS.map((platform) => {
            const state = platformStatus(
              clients.filter((client) => client.platform === platform.id)
            );
            return (
              <li
                className="min-w-0 rounded border border-border p-2"
                key={platform.id}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={`size-1.5 shrink-0 rounded-full ${state.dotClassName}`}
                  />
                  <p className="truncate font-medium text-xs">
                    {platform.label}
                  </p>
                </div>
                <p className="mt-1 truncate font-medium text-[11px]">
                  {state.label}
                </p>
                <p
                  className="mt-0.5 truncate text-[10px] text-muted-foreground"
                  title={state.detail}
                >
                  {state.detail}
                </p>
              </li>
            );
          })}
        </ul>
      </div>

      {clients.length === 0 ? (
        <div className="rounded border border-border border-dashed p-4 text-center">
          <PlugsConnectedIcon
            aria-hidden
            className="mx-auto text-muted-foreground"
            size={24}
          />
          <p className="mt-2 font-medium text-sm">No example app connected</p>
          <p className="mt-1 text-muted-foreground text-xs">
            Start any example app with the configuration above to preview this
            draft natively.
          </p>
        </div>
      ) : (
        <div>
          <h3 className="font-semibold text-xs">Connected clients</h3>
          <ul className="mt-2 space-y-2">
            {clients.map((client) => {
              const recordedAcknowledgement = latestSentEditableDocumentId
                ? acknowledgements[
                    previewAcknowledgementKey(
                      client.clientId,
                      latestSentEditableDocumentId
                    )
                  ]
                : undefined;
              const acknowledgement =
                recordedAcknowledgement?.revisionId === latestSentRevisionId
                  ? recordedAcknowledgement
                  : undefined;
              const hasCompatibilityWarning =
                compatibilityWarnings(document, [client]).length > 0;
              return (
                <li
                  className="rounded border border-border p-3"
                  key={client.clientId}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-sm">
                        {client.displayName}
                      </p>
                      <p className="truncate text-muted-foreground text-xs">
                        {platformLabel(client.platform)} ·{" "}
                        {client.application.displayName} ·{" "}
                        {client.device.displayName}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 font-medium text-[11px] ${
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
                      <p className="mt-2 text-muted-foreground text-xs">
                        {acknowledgement.message}
                      </p>
                      <details className="mt-1 text-[11px] text-muted-foreground">
                        <summary className="cursor-pointer">
                          Update details
                        </summary>
                        Local update {acknowledgement.revisionSequence}
                      </details>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div>
        <h3 className="font-semibold text-xs">Capabilities</h3>
        {clients.length === 0 ? (
          <p className="mt-1 text-muted-foreground text-xs">
            Capability reports appear after a native client connects.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {clients.map((client) => (
              <li
                className="rounded border border-border px-2.5 py-2 text-xs"
                key={client.clientId}
              >
                <details>
                  <summary className="cursor-pointer font-medium">
                    {client.displayName} · {capabilitySummary(client)}
                  </summary>
                  {hasCapabilityReport(client) ? (
                    <dl className="mt-2 grid gap-1.5 text-muted-foreground">
                      <div>
                        <dt className="font-medium text-foreground">
                          Schema versions
                        </dt>
                        <dd className="mt-0.5 break-words">
                          {client.supportedSchemaVersions.join(", ") ||
                            "None reported"}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-foreground">
                          Protocol capabilities
                        </dt>
                        <dd className="mt-0.5 break-words">
                          {capabilityList(client.supportedCapabilities)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-foreground">
                          Preview capabilities
                        </dt>
                        <dd className="mt-0.5 break-words">
                          {capabilityList(client.previewCapabilities)}
                        </dd>
                      </div>
                      {client.maxDocumentBytes ? (
                        <div>
                          <dt className="font-medium text-foreground">
                            Document limit
                          </dt>
                          <dd className="mt-0.5">
                            {client.maxDocumentBytes.toLocaleString()} bytes
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  ) : (
                    <p className="mt-2 text-muted-foreground">
                      The client is connected and has not reported capabilities
                      yet.
                    </p>
                  )}
                </details>
              </li>
            ))}
          </ul>
        )}

        {warnings.length === 0 ? (
          <p className="mt-2 text-muted-foreground text-xs">
            {clients.length === 0
              ? "Connect a client to check this draft."
              : "Connected clients support this draft and its preview updates."}
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {warnings.map((warning) => (
              <li
                className="flex gap-2 rounded bg-amber-50 p-2 text-amber-950 text-xs"
                key={warning}
              >
                <WarningCircleIcon aria-hidden className="mt-0.5 shrink-0" />
                {warning}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="font-semibold text-xs">Last diagnostic</h3>
        {latestDiagnostic ? (
          <div className="mt-2">
            <DiagnosticCard
              diagnostic={latestDiagnostic}
              onInspect={selectComponent}
            />
          </div>
        ) : (
          <p className="mt-1 text-muted-foreground text-xs">
            No preview diagnostics yet.
          </p>
        )}
        {diagnostics.length > 1 ? (
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer font-medium text-muted-foreground">
              {diagnostics.length - 1} earlier{" "}
              {diagnostics.length === 2 ? "diagnostic" : "diagnostics"}
            </summary>
            <ul className="mt-2 space-y-2">
              {diagnostics.slice(1).map((diagnostic) => (
                <li key={diagnostic.id}>
                  <DiagnosticCard
                    diagnostic={diagnostic}
                    onInspect={selectComponent}
                  />
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </section>
  );
}
