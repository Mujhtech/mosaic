import { recordValue } from "@/features/paywall-editor/schema/preview-message"
import type {
  MosaicDocument,
  PreviewClient,
  PreviewDiagnostic,
} from "@/features/paywall-editor/types/editor"

export interface PreviewAcknowledgement {
  clientId: string
  editableDocumentId: string
  revisionId: string
  revisionSequence: number
  status: "accepted" | "rejected"
  message: string
}

export interface PreviewAcknowledgementConflict {
  clientId: string
  editableDocumentId: string
  revisionSequence: number
  existingRevisionId: string
  incomingRevisionId: string
}

export function previewAcknowledgementKey(clientId: string, editableDocumentId: string) {
  return `${clientId}::${editableDocumentId}`
}

export function applyPreviewAcknowledgement(
  current: Readonly<Record<string, PreviewAcknowledgement>>,
  incoming: PreviewAcknowledgement,
): {
  acknowledgements: Readonly<Record<string, PreviewAcknowledgement>>
  conflict: PreviewAcknowledgementConflict | null
} {
  const key = previewAcknowledgementKey(incoming.clientId, incoming.editableDocumentId)
  const previous = current[key]
  if (!previous || incoming.revisionSequence > previous.revisionSequence) {
    return {
      acknowledgements: { ...current, [key]: incoming },
      conflict: null,
    }
  }
  if (incoming.revisionSequence < previous.revisionSequence) {
    return { acknowledgements: current, conflict: null }
  }
  if (incoming.revisionId === previous.revisionId) {
    return { acknowledgements: current, conflict: null }
  }
  return {
    acknowledgements: current,
    conflict: {
      clientId: incoming.clientId,
      editableDocumentId: incoming.editableDocumentId,
      revisionSequence: incoming.revisionSequence,
      existingRevisionId: previous.revisionId,
      incomingRevisionId: incoming.revisionId,
    },
  }
}

export interface PreviewAggregate {
  total: number
  accepted: number
  rejected: number
  pending: number
  label: string
}

export function derivePreviewAggregate(options: {
  clients: readonly PreviewClient[]
  acknowledgements: Readonly<Record<string, PreviewAcknowledgement>>
  editableDocumentId: string | null
  revisionId: string | null
  revisionSequence: number
}): PreviewAggregate {
  const total = options.clients.length
  let accepted = 0
  let rejected = 0
  for (const client of options.clients) {
    if (!options.editableDocumentId || !options.revisionId) continue
    const acknowledgement =
      options.acknowledgements[
        previewAcknowledgementKey(client.clientId, options.editableDocumentId)
      ]
    if (
      !acknowledgement ||
      acknowledgement.revisionSequence !== options.revisionSequence ||
      acknowledgement.revisionId !== options.revisionId
    ) {
      continue
    }
    if (acknowledgement.status === "accepted") accepted += 1
    else rejected += 1
  }
  const pending = Math.max(0, total - accepted - rejected)
  return {
    total,
    accepted,
    rejected,
    pending,
    label:
      total === 0
        ? "No native previews connected"
        : rejected > 0
          ? `${rejected} of ${total} previews need attention`
          : pending > 0
            ? `${accepted} of ${total} previews updated`
            : `${accepted} of ${total} previews updated`,
  }
}

export const RECONNECT_DELAYS = [500, 1_000, 2_000, 4_000, 5_000] as const

export function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback
}

export function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

export function previewRevisionId() {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "_")
  return `revision_${random ?? `${Date.now()}_${Math.round(Math.random() * 1_000_000)}`}`
}

export function serializedDocumentBytes(document: MosaicDocument) {
  return new TextEncoder().encode(JSON.stringify(document)).byteLength
}

export function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : []
}

export function reportedCapabilities(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const capability = recordValue(entry)
    const name = capability?.name
    const version = capability?.version
    return typeof name === "string" && typeof version === "string" ? [{ name, version }] : []
  })
}

export function platformForRenderer(rendererId: string): PreviewClient["platform"] {
  const value = rendererId.toLowerCase()
  if (value.includes("flutter")) return "flutter"
  if (value.includes("swift") || value.includes("ios")) return "ios"
  if (value.includes("compose") || value.includes("android")) return "android"
  return "unknown"
}

export function revisionFromPayload(payload: Record<string, unknown>) {
  const revision = recordValue(payload.revision)
  return {
    revisionId: stringValue(revision?.revisionId),
    sequence: numberValue(revision?.sequence),
  }
}

export function diagnosticFromProtocol(options: {
  raw: unknown
  clientId: string
  revisionId: string
  revisionSequence: number
  severity: PreviewDiagnostic["severity"]
  fallbackCode: string
  fallbackMessage: string
}): PreviewDiagnostic {
  const raw = recordValue(options.raw)
  const location = recordValue(raw?.location)
  const recovery = recordValue(raw?.recovery)
  const code = stringValue(raw?.code, options.fallbackCode)
  return {
    id: `${options.clientId}:${options.revisionId}:${code}`,
    severity: options.severity,
    code,
    message: stringValue(raw?.message, options.fallbackMessage),
    clientId: options.clientId,
    componentId: stringValue(location?.componentId) || undefined,
    property: stringValue(location?.property) || undefined,
    documentPath: stringValue(location?.documentPath) || undefined,
    revisionId: options.revisionId,
    revisionSequence: options.revisionSequence,
    recovery: stringValue(recovery?.message) || undefined,
    createdAt: new Date().toISOString(),
  }
}
