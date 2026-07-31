import { useCallback, useEffect, useRef, useState } from "react"

import { AUTOSAVE_DELAY_MS } from "@/features/paywall-editor/constants/editor-constants"
import type { DraftAutosaveController } from "@/features/paywall-editor/hooks/use-draft-autosave"
import type { MosaicDocument } from "@/features/paywall-editor/types/editor"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import {
  HostedDraftConflictError,
  HostedDraftOfflineError,
  type HostedDraft,
} from "@/features/publishing/api/hosted-publishing-adapter"

export interface HostedAutosaveConflict {
  readonly expectedRevision: number
  readonly latestRevision: number
  readonly localDocument: MosaicDocument
  readonly serverUpdatedAt?: string
}

export interface HostedDraftAutosaveController extends DraftAutosaveController {
  readonly conflict: HostedAutosaveConflict | null
  readonly reconcileWithLatest: (draft: HostedDraft) => void
  readonly reloadLatest: (draft: HostedDraft) => void
}

interface PendingSave {
  readonly document: MosaicDocument
  readonly fingerprint: string
}

interface UseHostedDraftAutosaveOptions {
  readonly document: MosaicDocument | null
  readonly draftId: string
  readonly enabled: boolean
  readonly initialDocument: MosaicDocument | null
  readonly initialRevision: number
  readonly onSaved?: (draft: HostedDraft) => void
  readonly saveDraft: (input: {
    document: MosaicDocument
    draftId: string
    expectedRevision: number
  }) => Promise<HostedDraft>
  readonly delayMs?: number
}

function fingerprint(document: MosaicDocument) {
  return JSON.stringify(document)
}

export function useHostedDraftAutosave({
  delayMs = AUTOSAVE_DELAY_MS,
  document,
  draftId,
  enabled,
  initialDocument,
  initialRevision,
  onSaved,
  saveDraft,
}: UseHostedDraftAutosaveOptions): HostedDraftAutosaveController {
  const [status, setStatus] = useState<DraftAutosaveController["status"]>("idle")
  const [conflict, setConflict] = useState<HostedAutosaveConflict | null>(null)
  const acknowledgedRevisionRef = useRef(initialRevision)
  const lastSavedFingerprintRef = useRef(initialDocument ? fingerprint(initialDocument) : "")
  const pendingRef = useRef<PendingSave | null>(null)
  const savingRef = useRef(false)
  const conflictRef = useRef<HostedAutosaveConflict | null>(null)
  const attemptSave = useCallback(async () => {
    if (!enabled || savingRef.current || conflictRef.current) return false
    savingRef.current = true

    try {
      while (pendingRef.current && !conflictRef.current) {
        const candidate = pendingRef.current
        const expectedRevision = acknowledgedRevisionRef.current
        setStatus("saving")

        try {
          const saved = await saveDraft({
            document: cloneValue(candidate.document),
            draftId,
            expectedRevision,
          })
          acknowledgedRevisionRef.current = saved.revision
          lastSavedFingerprintRef.current = candidate.fingerprint
          onSaved?.(saved)

          if (pendingRef.current?.fingerprint === candidate.fingerprint) {
            pendingRef.current = null
          }
          setStatus(pendingRef.current ? "unsaved" : "saved")
        } catch (error) {
          if (error instanceof HostedDraftConflictError) {
            const nextConflict: HostedAutosaveConflict = {
              expectedRevision,
              latestRevision: error.latestRevision,
              localDocument: cloneValue(candidate.document),
              ...(error.serverUpdatedAt ? { serverUpdatedAt: error.serverUpdatedAt } : {}),
            }
            conflictRef.current = nextConflict
            setConflict(nextConflict)
            setStatus("conflict")
          } else {
            setStatus(error instanceof HostedDraftOfflineError ? "offline" : "failed")
          }
          return false
        }
      }
      return pendingRef.current === null
    } finally {
      savingRef.current = false
    }
  }, [draftId, enabled, onSaved, saveDraft])

  useEffect(() => {
    if (!enabled || !document) return
    const nextFingerprint = fingerprint(document)
    if (nextFingerprint === lastSavedFingerprintRef.current) {
      if (!conflictRef.current) setStatus("saved")
      return
    }

    const pending = { document: cloneValue(document), fingerprint: nextFingerprint }
    pendingRef.current = pending
    if (conflictRef.current) {
      const nextConflict = {
        ...conflictRef.current,
        localDocument: cloneValue(document),
      }
      conflictRef.current = nextConflict
      setConflict(nextConflict)
      setStatus("conflict")
      return
    }

    setStatus("unsaved")
    const timer = window.setTimeout(() => void attemptSave(), delayMs)
    return () => window.clearTimeout(timer)
  }, [attemptSave, delayMs, document, enabled])

  const retry = useCallback(() => {
    if (!enabled || conflictRef.current || !pendingRef.current) return
    void attemptSave()
  }, [attemptSave, enabled])

  const flush = useCallback(() => {
    if (!enabled || !pendingRef.current) return true
    void attemptSave()
    return false
  }, [attemptSave, enabled])

  const reconcileWithLatest = useCallback(
    (latest: HostedDraft) => {
      acknowledgedRevisionRef.current = latest.revision
      conflictRef.current = null
      setConflict(null)
      setStatus(pendingRef.current ? "unsaved" : "saved")
      if (pendingRef.current) void attemptSave()
    },
    [attemptSave],
  )

  const reloadLatest = useCallback((latest: HostedDraft) => {
    acknowledgedRevisionRef.current = latest.revision
    lastSavedFingerprintRef.current = fingerprint(latest.document)
    pendingRef.current = null
    conflictRef.current = null
    setConflict(null)
    setStatus("saved")
  }, [])

  return { conflict, flush, reconcileWithLatest, reloadLatest, retry, status }
}
