import { useCallback, useEffect, useRef, useState } from "react"

import { PREVIEW_ENDPOINT_DEFAULT } from "@/features/paywall-editor/constants/editor-constants"
import { mockCommerceState } from "@/features/paywall-editor/mutations/local-project-file"
import {
  createDraftUpdatedMessage,
  createHeartbeatPongMessage,
  createMockCommerceStateChangedMessage,
  parsePreviewMessage,
  previewProtocolVersionForSubprotocol,
  PREVIEW_WEBSOCKET_SUBPROTOCOLS,
  recordValue,
  type PreviewProtocolVersion,
} from "@/features/paywall-editor/schema/preview-message"
import type {
  MockProductDefinition,
  MockPurchaseState,
  MosaicDocument,
  PreviewClient,
  PreviewConnectionStatus,
  PreviewDiagnostic,
} from "@/features/paywall-editor/types/editor"
import { validatePaywallDocument, validatePreviewMessage } from "@/lib/mosaic-protocol"

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

const RECONNECT_DELAYS = [500, 1_000, 2_000, 4_000, 5_000] as const

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function previewRevisionId() {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "_")
  return `revision_${random ?? `${Date.now()}_${Math.round(Math.random() * 1_000_000)}`}`
}

function serializedDocumentBytes(document: MosaicDocument) {
  return new TextEncoder().encode(JSON.stringify(document)).byteLength
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : []
}

function reportedCapabilities(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const capability = recordValue(entry)
    const name = capability?.name
    const version = capability?.version
    return typeof name === "string" && typeof version === "string" ? [{ name, version }] : []
  })
}

function platformForRenderer(rendererId: string): PreviewClient["platform"] {
  const value = rendererId.toLowerCase()
  if (value.includes("flutter")) return "flutter"
  if (value.includes("swift") || value.includes("ios")) return "ios"
  if (value.includes("compose") || value.includes("android")) return "android"
  return "unknown"
}

function revisionFromPayload(payload: Record<string, unknown>) {
  const revision = recordValue(payload.revision)
  return {
    revisionId: stringValue(revision?.revisionId),
    sequence: numberValue(revision?.sequence),
  }
}

function diagnosticFromProtocol(options: {
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

export function usePreviewConnection(options: {
  document: MosaicDocument | null
  editableDocumentId: string | null
  locale: string
  textScale: number
  isValid: boolean
  mockPurchaseState: MockPurchaseState
  mockProducts: readonly MockProductDefinition[]
  endpoint?: string
  initialRevisionSequence?: number
  onRevisionDispatched?: (sequence: number) => void
}) {
  const endpoint =
    options.endpoint ?? import.meta.env.VITE_MOSAIC_PREVIEW_URL ?? PREVIEW_ENDPOINT_DEFAULT
  const [status, setStatus] = useState<PreviewConnectionStatus>(() =>
    endpoint && typeof WebSocket !== "undefined" ? "idle" : "unavailable",
  )
  const [clients, setClients] = useState<PreviewClient[]>([])
  const [diagnostics, setDiagnostics] = useState<PreviewDiagnostic[]>([])
  const [acknowledgements, setAcknowledgements] = useState<Record<string, PreviewAcknowledgement>>(
    {},
  )
  const acknowledgementsRef = useRef<Record<string, PreviewAcknowledgement>>({})
  const [latestSentRevision, setLatestSentRevision] = useState<{
    editableDocumentId: string
    revisionId: string
    sequence: number
  } | null>(null)
  const latestSentRevisionRef = useRef<{
    editableDocumentId: string
    revisionId: string
    sequence: number
  } | null>(null)
  const [connectionEpoch, setConnectionEpoch] = useState(0)
  const socketRef = useRef<WebSocket | null>(null)
  const [sessionId] = useState(
    () => import.meta.env.VITE_MOSAIC_PREVIEW_SESSION_ID ?? "session_local_01",
  )
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef<number | null>(null)
  const negotiatedProtocolVersionRef = useRef<PreviewProtocolVersion | null>(null)
  const previewSequenceRef = useRef(options.initialRevisionSequence ?? 0)
  const lastSentFingerprintRef = useRef("")
  const latestDocumentRef = useRef(options.document)
  const latestEditableDocumentIdRef = useRef(options.editableDocumentId)
  const latestContextRef = useRef({ locale: options.locale, textScale: options.textScale })
  const latestValidationRef = useRef(options.isValid)
  const commerceSequenceRef = useRef(options.initialRevisionSequence ?? 1)
  const lastCommerceFingerprintRef = useRef("")
  const capabilityClientIdsRef = useRef(new Set<string>())
  const connectedClientIdsRef = useRef(new Set<string>())
  const clientDocumentLimitsRef = useRef(new Map<string, number>())
  const latestMockProductsRef = useRef(options.mockProducts)
  const latestMockPurchaseStateRef = useRef(options.mockPurchaseState)
  const onRevisionDispatchedRef = useRef(options.onRevisionDispatched)

  useEffect(() => {
    if (latestEditableDocumentIdRef.current !== options.editableDocumentId) {
      previewSequenceRef.current = options.initialRevisionSequence ?? 0
      commerceSequenceRef.current = options.initialRevisionSequence ?? 1
      lastSentFingerprintRef.current = ""
      lastCommerceFingerprintRef.current = ""
      latestSentRevisionRef.current = null
      acknowledgementsRef.current = {}
      setLatestSentRevision(null)
      setAcknowledgements({})
      setDiagnostics([])
    }
    latestDocumentRef.current = options.document
    latestEditableDocumentIdRef.current = options.editableDocumentId
    latestContextRef.current = { locale: options.locale, textScale: options.textScale }
    latestValidationRef.current = options.isValid
    latestMockProductsRef.current = options.mockProducts
    latestMockPurchaseStateRef.current = options.mockPurchaseState
    onRevisionDispatchedRef.current = options.onRevisionDispatched
    previewSequenceRef.current = Math.max(
      previewSequenceRef.current,
      options.initialRevisionSequence ?? 0,
    )
    commerceSequenceRef.current = Math.max(
      commerceSequenceRef.current,
      options.initialRevisionSequence ?? 1,
    )
  }, [
    options.document,
    options.editableDocumentId,
    options.initialRevisionSequence,
    options.isValid,
    options.locale,
    options.mockProducts,
    options.mockPurchaseState,
    options.onRevisionDispatched,
    options.textScale,
  ])

  const addDiagnostic = useCallback((diagnostic: PreviewDiagnostic) => {
    setDiagnostics((current) => {
      const next = current.filter((entry) => entry.id !== diagnostic.id)
      return [diagnostic, ...next].slice(0, 50)
    })
  }, [])

  const send = useCallback(
    (message: unknown) => {
      const socket = socketRef.current
      if (!socket || socket.readyState !== WebSocket.OPEN) return false
      const negotiatedVersion = negotiatedProtocolVersionRef.current
      const candidate = recordValue(message)
      if (!negotiatedVersion || candidate?.previewProtocolVersion !== negotiatedVersion) {
        addDiagnostic({
          id: "studio:outgoing-contract:negotiated-version",
          severity: "error",
          code: "preview.negotiatedVersionMismatch",
          message:
            "Studio withheld an envelope because its version did not match the negotiated Local Preview version.",
          recovery: "Reconnect the preview client and retry the update.",
          createdAt: new Date().toISOString(),
        })
        return false
      }
      const baseValidation = validatePreviewMessage(message)
      const reportContractFailure = (
        diagnostic: (typeof baseValidation.diagnostics)[number] | undefined,
      ) => {
        addDiagnostic({
          id: `studio:outgoing-contract:${diagnostic?.code ?? "invalid"}`,
          severity: "error",
          code: diagnostic?.code ?? "preview.invalidOutgoingMessage",
          message:
            diagnostic?.message ??
            "Studio did not send an update that failed canonical protocol validation.",
          componentId: diagnostic?.location.componentId,
          property: diagnostic?.location.property,
          documentPath: diagnostic?.location.documentPath,
          recovery: diagnostic?.recovery.message,
          createdAt: new Date().toISOString(),
        })
      }
      if (!baseValidation.ok) {
        reportContractFailure(baseValidation.diagnostics[0])
        return false
      }

      if (baseValidation.value.type === "mockCommerceStateChanged") {
        const document = latestDocumentRef.current
        const documentValidation = document ? validatePaywallDocument(document) : null
        if (!documentValidation?.ok) {
          reportContractFailure(
            documentValidation && !documentValidation.ok
              ? documentValidation.diagnostics[0]
              : undefined,
          )
          return false
        }
        const commerceValidation = validatePreviewMessage(message, {
          document: documentValidation.value,
        })
        if (!commerceValidation.ok) {
          reportContractFailure(commerceValidation.diagnostics[0])
          return false
        }
      }
      socket.send(JSON.stringify(message))
      return true
    },
    [addDiagnostic],
  )

  const recordAcknowledgement = useCallback(
    (incoming: PreviewAcknowledgement) => {
      const result = applyPreviewAcknowledgement(acknowledgementsRef.current, incoming)
      if (result.conflict) {
        addDiagnostic({
          id: `${result.conflict.clientId}:${result.conflict.revisionSequence}:revision-conflict`,
          severity: "error",
          code: "preview.revisionConflict",
          message: "The preview client reported two different update IDs for the same sequence.",
          clientId: result.conflict.clientId,
          revisionId: result.conflict.incomingRevisionId,
          revisionSequence: result.conflict.revisionSequence,
          recovery: "Reconnect the preview client before sending another update.",
          createdAt: new Date().toISOString(),
        })
        return
      }
      if (result.acknowledgements === acknowledgementsRef.current) return
      acknowledgementsRef.current = {
        ...result.acknowledgements,
      }
      setAcknowledgements(acknowledgementsRef.current)
    },
    [addDiagnostic],
  )

  const sendLatestDraft = useCallback(
    (force = false) => {
      const document = latestDocumentRef.current
      const currentEditableDocumentId = latestEditableDocumentIdRef.current
      if (
        !document ||
        !currentEditableDocumentId ||
        !latestValidationRef.current ||
        capabilityClientIdsRef.current.size === 0
      ) {
        return false
      }
      if (negotiatedProtocolVersionRef.current !== document.schemaVersion) {
        addDiagnostic({
          id: `studio:${currentEditableDocumentId}:incompatible-schema-version`,
          severity: "error",
          code: "preview.incompatibleSchemaVersion",
          message: `This connection negotiated Local Preview ${negotiatedProtocolVersionRef.current ?? "unknown"}, so Studio withheld the Protocol ${document.schemaVersion} draft.`,
          recovery: "Update the preview relay or client to Local Preview 0.2, then reconnect.",
          createdAt: new Date().toISOString(),
        })
        return false
      }
      const documentBytes = serializedDocumentBytes(document)
      const limitingClient = [...clientDocumentLimitsRef.current.entries()].find(
        ([clientId, limit]) =>
          capabilityClientIdsRef.current.has(clientId) && documentBytes > limit,
      )
      if (limitingClient) {
        addDiagnostic({
          id: `studio:${currentEditableDocumentId}:document-limit`,
          severity: "error",
          code: "preview.documentExceedsClientLimit",
          message: `This draft is ${documentBytes.toLocaleString()} bytes, above a connected preview's ${limitingClient[1].toLocaleString()}-byte limit.`,
          clientId: limitingClient[0],
          recovery:
            "Reduce the document size or reconnect a preview client that supports this draft.",
          createdAt: new Date().toISOString(),
        })
        return false
      }
      const context = latestContextRef.current
      const fingerprint = `${currentEditableDocumentId}:${document.revision}:${context.locale}:${context.textScale}`
      if (!force && fingerprint === lastSentFingerprintRef.current) return false
      const sequence = Math.max(previewSequenceRef.current + 1, document.revision)
      const revisionId = previewRevisionId()
      const sent = send(
        createDraftUpdatedMessage({
          sessionId,
          editableDocumentId: currentEditableDocumentId,
          document,
          locale: context.locale,
          textScale: context.textScale,
          revision: {
            revisionId,
            sequence,
          },
        }),
      )
      if (sent) {
        previewSequenceRef.current = sequence
        lastSentFingerprintRef.current = fingerprint
        const dispatchedRevision = {
          editableDocumentId: currentEditableDocumentId,
          revisionId,
          sequence,
        }
        latestSentRevisionRef.current = dispatchedRevision
        setLatestSentRevision(dispatchedRevision)
        onRevisionDispatchedRef.current?.(sequence)
      }
      return sent
    },
    [addDiagnostic, send, sessionId],
  )

  const sendLatestCommerce = useCallback(
    (force = false) => {
      const document = latestDocumentRef.current
      const currentEditableDocumentId = latestEditableDocumentIdRef.current
      if (!document || !currentEditableDocumentId || capabilityClientIdsRef.current.size === 0) {
        return false
      }
      if (negotiatedProtocolVersionRef.current !== document.schemaVersion) return false
      const state = mockCommerceState(
        latestMockPurchaseStateRef.current,
        latestMockProductsRef.current,
      )
      const fingerprint = JSON.stringify(state)
      if (!force && fingerprint === lastCommerceFingerprintRef.current) return false
      commerceSequenceRef.current += 1
      const sequence = commerceSequenceRef.current
      const sent = send(
        createMockCommerceStateChangedMessage({
          sessionId,
          editableDocumentId: currentEditableDocumentId,
          revision: { revisionId: previewRevisionId(), sequence },
          state,
        }),
      )
      if (sent) lastCommerceFingerprintRef.current = fingerprint
      if (sent) onRevisionDispatchedRef.current?.(sequence)
      return sent
    },
    [send, sessionId],
  )

  useEffect(() => {
    if (!endpoint || typeof WebSocket === "undefined") {
      return
    }

    let disposed = false
    setStatus(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting")
    const connectionUrl = new URL(endpoint)
    connectionUrl.searchParams.set("role", "studio")
    connectionUrl.searchParams.set("sessionId", sessionId)
    negotiatedProtocolVersionRef.current = null
    const socket = new WebSocket(connectionUrl, [...PREVIEW_WEBSOCKET_SUBPROTOCOLS])
    socketRef.current = socket

    socket.addEventListener("open", () => {
      if (disposed) return
      const negotiatedVersion = previewProtocolVersionForSubprotocol(socket.protocol)
      if (!negotiatedVersion) {
        addDiagnostic({
          id: "studio:connection:no-mutual-version",
          severity: "error",
          code: "preview.noMutualVersion",
          message:
            "Studio and the local preview endpoint did not negotiate a supported Local Preview version.",
          recovery: "Update the local preview relay or client, then reconnect.",
          createdAt: new Date().toISOString(),
        })
        setStatus("disconnected")
        socket.close(1002, "No supported Local Preview subprotocol was negotiated")
        return
      }
      negotiatedProtocolVersionRef.current = negotiatedVersion
      reconnectAttemptRef.current = 0
      lastSentFingerprintRef.current = ""
      lastCommerceFingerprintRef.current = ""
      setStatus("connected")
    })

    socket.addEventListener("message", (event) => {
      if (disposed || typeof event.data !== "string") return
      const negotiatedVersion = negotiatedProtocolVersionRef.current
      const message = parsePreviewMessage(event.data, negotiatedVersion ?? undefined)
      if (!message) {
        addDiagnostic({
          id: `studio:invalid-message:${Date.now()}`,
          severity: "error",
          code: "preview.invalidMessage",
          message: `Studio ignored a preview message that did not match Local Preview ${negotiatedVersion ?? "the negotiated version"}.`,
          recovery: "Update the local preview server or client, then reconnect.",
          createdAt: new Date().toISOString(),
        })
        return
      }
      if (message.sessionId !== sessionId) return
      const payload = message.payload

      if (message.type === "previewClientConnected") {
        const identity = recordValue(payload.client)
        const renderer = recordValue(identity?.renderer)
        const application = recordValue(identity?.application)
        const device = recordValue(identity?.device)
        const rendererId = stringValue(renderer?.id)
        const clientId = stringValue(identity?.clientId)
        if (!clientId) return
        connectedClientIdsRef.current.add(clientId)
        setClients((current) => {
          const client: PreviewClient = {
            clientId,
            sessionId: message.sessionId,
            platform: platformForRenderer(rendererId),
            displayName: stringValue(identity?.displayName, "Preview client"),
            renderer: { id: rendererId, version: stringValue(renderer?.version) },
            application: {
              id: stringValue(application?.id),
              displayName: stringValue(application?.displayName, "Example app"),
              version: stringValue(application?.version),
            },
            device: {
              displayName: stringValue(device?.displayName, "Device"),
              systemName: stringValue(device?.systemName),
              systemVersion: stringValue(device?.systemVersion),
            },
            supportedSchemaVersions: [],
            supportedCapabilities: [],
            previewCapabilities: [],
            lastSeenAt: message.sentAt,
          }
          return [client, ...current.filter((entry) => entry.clientId !== clientId)]
        })
        return
      }

      if (message.type === "previewClientDisconnected") {
        const clientId = stringValue(payload.clientId)
        connectedClientIdsRef.current.delete(clientId)
        capabilityClientIdsRef.current.delete(clientId)
        clientDocumentLimitsRef.current.delete(clientId)
        setClients((current) => current.filter((entry) => entry.clientId !== clientId))
        return
      }

      if (message.type === "capabilityReport") {
        const clientId = stringValue(payload.clientId)
        if (!clientId || !connectedClientIdsRef.current.has(clientId)) return
        capabilityClientIdsRef.current.add(clientId)
        const limits = recordValue(payload.limits)
        const maxDocumentBytes = numberValue(limits?.maxDocumentBytes)
        if (maxDocumentBytes > 0) clientDocumentLimitsRef.current.set(clientId, maxDocumentBytes)
        setClients((current) =>
          current.map((client) =>
            client.clientId === clientId
              ? {
                  ...client,
                  supportedSchemaVersions: stringList(payload.supportedSchemaVersions),
                  supportedCapabilities: reportedCapabilities(payload.supportedCapabilities),
                  previewCapabilities: reportedCapabilities(payload.previewCapabilities),
                  maxDocumentBytes: maxDocumentBytes || undefined,
                  lastSeenAt: message.sentAt,
                }
              : client,
          ),
        )
        queueMicrotask(() => {
          sendLatestCommerce(true)
          sendLatestDraft(true)
        })
        return
      }

      if (message.type === "previewHeartbeat") {
        const clientId = stringValue(payload.clientId)
        const sequence = numberValue(payload.sequence)
        if (payload.kind === "ping" && clientId && connectedClientIdsRef.current.has(clientId)) {
          send(
            createHeartbeatPongMessage({
              sessionId: message.sessionId,
              clientId,
              sequence,
              protocolVersion: message.previewProtocolVersion,
            }),
          )
        }
        setClients((current) =>
          current.map((client) =>
            client.clientId === clientId ? { ...client, lastSeenAt: message.sentAt } : client,
          ),
        )
        return
      }

      const clientId = stringValue(payload.clientId, "client_unknown")
      if (!capabilityClientIdsRef.current.has(clientId)) return
      const incomingEditableDocumentId = stringValue(payload.editableDocumentId)
      if (
        !incomingEditableDocumentId ||
        incomingEditableDocumentId !== latestEditableDocumentIdRef.current
      ) {
        return
      }
      const revision = revisionFromPayload(payload)
      const expectedRevision = latestSentRevisionRef.current
      if (
        !expectedRevision ||
        expectedRevision.editableDocumentId !== incomingEditableDocumentId ||
        expectedRevision.revisionId !== revision.revisionId ||
        expectedRevision.sequence !== revision.sequence
      ) {
        return
      }
      if (message.type === "draftAccepted") {
        recordAcknowledgement({
          clientId,
          editableDocumentId: incomingEditableDocumentId,
          revisionId: revision.revisionId,
          revisionSequence: revision.sequence,
          status: "accepted",
          message: "Latest changes are visible in this native preview.",
        })
        return
      }

      if (message.type === "draftRejected") {
        recordAcknowledgement({
          clientId,
          editableDocumentId: incomingEditableDocumentId,
          revisionId: revision.revisionId,
          revisionSequence: revision.sequence,
          status: "rejected",
          message: "This update needs attention. The last working preview remains visible.",
        })
        const rawDiagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : []
        rawDiagnostics.forEach((raw) =>
          addDiagnostic(
            diagnosticFromProtocol({
              raw,
              clientId,
              revisionId: revision.revisionId,
              revisionSequence: revision.sequence,
              severity: "error",
              fallbackCode: "preview.draftRejected",
              fallbackMessage: "The preview client rejected this revision.",
            }),
          ),
        )
        return
      }

      if (message.type === "validationError") {
        const errors = Array.isArray(payload.errors) ? payload.errors : []
        errors.forEach((raw) =>
          addDiagnostic(
            diagnosticFromProtocol({
              raw,
              clientId,
              revisionId: revision.revisionId,
              revisionSequence: revision.sequence,
              severity: "error",
              fallbackCode: "preview.validationError",
              fallbackMessage: "The native preview found an invalid property.",
            }),
          ),
        )
        return
      }

      if (message.type === "renderWarning") {
        const warnings = Array.isArray(payload.warnings) ? payload.warnings : []
        warnings.forEach((raw) =>
          addDiagnostic(
            diagnosticFromProtocol({
              raw,
              clientId,
              revisionId: revision.revisionId,
              revisionSequence: revision.sequence,
              severity: "warning",
              fallbackCode: "preview.renderWarning",
              fallbackMessage: "The native preview used a defined fallback.",
            }),
          ),
        )
        return
      }

      if (message.type === "renderFailure") {
        addDiagnostic(
          diagnosticFromProtocol({
            raw: payload.failure,
            clientId,
            revisionId: revision.revisionId,
            revisionSequence: revision.sequence,
            severity: "error",
            fallbackCode: "preview.renderFailure",
            fallbackMessage:
              "The client could not render this revision and kept the last accepted draft.",
          }),
        )
      }
    })

    socket.addEventListener("error", () => {
      if (!disposed) setStatus("reconnecting")
    })

    socket.addEventListener("close", () => {
      if (disposed) return
      socketRef.current = null
      negotiatedProtocolVersionRef.current = null
      connectedClientIdsRef.current.clear()
      capabilityClientIdsRef.current.clear()
      clientDocumentLimitsRef.current.clear()
      setClients([])
      const attempt = reconnectAttemptRef.current
      if (attempt >= RECONNECT_DELAYS.length) {
        setStatus("disconnected")
        return
      }
      setStatus("reconnecting")
      const delay = RECONNECT_DELAYS[attempt] ?? RECONNECT_DELAYS.at(-1) ?? 5_000
      reconnectAttemptRef.current = attempt + 1
      reconnectTimerRef.current = window.setTimeout(
        () => setConnectionEpoch((current) => current + 1),
        delay,
      )
    })

    return () => {
      disposed = true
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current)
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
        socket.close()
      }
    }
  }, [
    addDiagnostic,
    connectionEpoch,
    endpoint,
    recordAcknowledgement,
    send,
    sendLatestCommerce,
    sendLatestDraft,
    sessionId,
  ])

  useEffect(() => {
    if (
      status !== "connected" ||
      !options.document ||
      !options.isValid ||
      capabilityClientIdsRef.current.size === 0
    ) {
      return
    }
    sendLatestDraft()
  }, [
    options.document,
    options.isValid,
    options.locale,
    options.textScale,
    sendLatestDraft,
    status,
  ])

  useEffect(() => {
    if (status !== "connected" || !options.document || capabilityClientIdsRef.current.size === 0) {
      return
    }
    sendLatestCommerce()
  }, [
    options.document,
    options.mockProducts,
    options.mockPurchaseState,
    sendLatestCommerce,
    status,
  ])

  const reconnect = useCallback(() => {
    reconnectAttemptRef.current = 0
    setConnectionEpoch((current) => current + 1)
  }, [])

  const aggregate = derivePreviewAggregate({
    clients,
    acknowledgements,
    editableDocumentId: latestSentRevision?.editableDocumentId ?? null,
    revisionId: latestSentRevision?.revisionId ?? null,
    revisionSequence: latestSentRevision?.sequence ?? 0,
  })

  return {
    endpoint,
    status,
    clients,
    diagnostics,
    acknowledgements,
    aggregate,
    latestSentRevision: latestSentRevision?.sequence ?? 0,
    latestSentRevisionId: latestSentRevision?.revisionId ?? null,
    latestSentEditableDocumentId: latestSentRevision?.editableDocumentId ?? null,
    reconnect,
    sendLatestDraft,
    sessionId,
  }
}
