import type {
  LocalRevision,
  MockCommerceState,
  MosaicDocument,
} from "@/features/paywall-editor/types/editor";
import {
  localPreviewContractVersion,
  localPreviewVersionPreference,
  localPreviewWebSocketProtocols,
  type previewMessageTypesByVersion,
  validatePreviewMessage,
} from "@/lib/mosaic-protocol";

export const PREVIEW_PROTOCOL_VERSION = localPreviewContractVersion;
export const PREVIEW_WEBSOCKET_SUBPROTOCOL =
  localPreviewWebSocketProtocols[localPreviewContractVersion];
export const PREVIEW_PROTOCOL_VERSIONS = localPreviewVersionPreference;
export const PREVIEW_WEBSOCKET_SUBPROTOCOLS = PREVIEW_PROTOCOL_VERSIONS.map(
  (version) => localPreviewWebSocketProtocols[version]
);

export type PreviewProtocolVersion = (typeof PREVIEW_PROTOCOL_VERSIONS)[number];

export type PreviewMessageType =
  (typeof previewMessageTypesByVersion)["0.3"][number];

export interface PreviewMessageEnvelope<TPayload = Record<string, unknown>> {
  messageId: string;
  payload: TPayload;
  previewProtocolVersion: PreviewProtocolVersion;
  sentAt: string;
  sessionId: string;
  type: PreviewMessageType;
}

function safeToken(prefix: string) {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "_");
  return `${prefix}_${random ?? `${Date.now()}_${Math.round(Math.random() * 1_000_000)}`}`;
}

export function localRevision(document: MosaicDocument): LocalRevision {
  return {
    revisionId: `revision_${document.id}_${document.revision}`,
    sequence: document.revision,
  };
}

function envelope<TPayload>(
  sessionId: string,
  type: PreviewMessageType,
  payload: TPayload,
  protocolVersion: PreviewProtocolVersion = PREVIEW_PROTOCOL_VERSION
): PreviewMessageEnvelope<TPayload> {
  return {
    previewProtocolVersion: protocolVersion,
    messageId: safeToken("msg"),
    sessionId,
    sentAt: new Date().toISOString(),
    type,
    payload,
  };
}

export function createDraftUpdatedMessage(options: {
  sessionId: string;
  editableDocumentId: string;
  document: MosaicDocument;
  locale: string;
  textScale: number;
  revision?: LocalRevision;
}) {
  return envelope(options.sessionId, "draftUpdated", {
    editableDocumentId: options.editableDocumentId,
    revision: options.revision ?? localRevision(options.document),
    document: options.document,
    preview: { locale: options.locale, textScale: options.textScale },
  });
}

export function createMockCommerceStateChangedMessage(options: {
  sessionId: string;
  editableDocumentId: string;
  revision: LocalRevision;
  state: MockCommerceState;
}) {
  return envelope(options.sessionId, "mockCommerceStateChanged", {
    editableDocumentId: options.editableDocumentId,
    stateRevision: options.revision,
    state: options.state,
  });
}

export function createHeartbeatPongMessage(options: {
  sessionId: string;
  clientId: string;
  sequence: number;
  protocolVersion?: PreviewProtocolVersion;
}) {
  return envelope(
    options.sessionId,
    "previewHeartbeat",
    {
      clientId: options.clientId,
      kind: "pong" as const,
      sequence: options.sequence,
    },
    options.protocolVersion
  );
}

export function previewProtocolVersionForSubprotocol(
  subprotocol: string
): PreviewProtocolVersion | null {
  return (
    PREVIEW_PROTOCOL_VERSIONS.find(
      (version) => localPreviewWebSocketProtocols[version] === subprotocol
    ) ?? null
  );
}

export function parsePreviewMessage(
  value: string,
  expectedVersion?: PreviewProtocolVersion
): PreviewMessageEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  const result = validatePreviewMessage(parsed);
  if (
    !result.ok ||
    (expectedVersion && result.value.previewProtocolVersion !== expectedVersion)
  ) {
    return null;
  }
  return result.value as PreviewMessageEnvelope;
}

export function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
