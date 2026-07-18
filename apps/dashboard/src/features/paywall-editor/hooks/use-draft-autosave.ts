import { useCallback, useEffect, useRef, useState } from "react"

import {
  AUTOSAVE_DELAY_MS,
  DEFAULT_MOCK_PRODUCTS,
} from "@/features/paywall-editor/constants/editor-constants"
import {
  createLocalProjectFile,
  writeLocalProject,
} from "@/features/paywall-editor/mutations/local-project-file"
import {
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"
import type {
  MockProductDefinition,
  MockPurchaseState,
} from "@/features/paywall-editor/types/editor"

export type AutosaveStatus = "idle" | "saving" | "saved" | "failed"

export interface DraftAutosaveController {
  status: AutosaveStatus
  flush: () => boolean
  retry: () => void
}

interface PendingAutosave {
  fingerprint: string
  preset: MockPurchaseState
  project: ReturnType<typeof createLocalProjectFile>
  revision: number
}

export function useDraftAutosaveController(
  mockPurchaseState: MockPurchaseState,
  mockProducts: readonly MockProductDefinition[] = DEFAULT_MOCK_PRODUCTS,
): DraftAutosaveController {
  const {
    document,
    editableDocumentId,
    currentLocale,
    textScale,
    localRevisionSequence,
    isDocumentTransactionActive,
  } = useEditorStore()
  const { markSaved } = useEditorActions()
  const [status, setStatus] = useState<AutosaveStatus>("idle")
  const lastSavedFingerprintRef = useRef("")
  const pendingAutosaveRef = useRef<PendingAutosave | null>(null)
  const compatibilityPreviewRef = useRef({
    locale: currentLocale,
    localRevisionSequence,
    textScale,
  })
  useEffect(() => {
    // Locale and text scale are workspace-owned preview preferences. Keep their latest values
    // available for the next legitimate document or mock-commerce save without making a preview-
    // only change an autosave trigger of its own. This effect intentionally runs before the save
    // effect below when context and an autosave-worthy dependency change in the same render.
    compatibilityPreviewRef.current = {
      locale: currentLocale,
      localRevisionSequence,
      textScale,
    }
  }, [currentLocale, localRevisionSequence, textScale])

  const attemptSave = useCallback(
    (pending: PendingAutosave) => {
      if (pendingAutosaveRef.current?.fingerprint !== pending.fingerprint) return false
      const saved = writeLocalProject(pending.project, pending.preset)

      setStatus(saved ? "saved" : "failed")
      if (saved) {
        lastSavedFingerprintRef.current = pending.fingerprint
        pendingAutosaveRef.current = null
        markSaved(pending.revision)
      }
      return saved
    },
    [markSaved],
  )

  const retry = useCallback(() => {
    if (isDocumentTransactionActive) return
    const pending = pendingAutosaveRef.current
    if (!pending) return
    setStatus("saving")
    attemptSave(pending)
  }, [attemptSave, isDocumentTransactionActive])

  const flush = useCallback(() => {
    if (isDocumentTransactionActive) return false
    const pending = pendingAutosaveRef.current
    if (!pending) return true
    setStatus("saving")
    return attemptSave(pending)
  }, [attemptSave, isDocumentTransactionActive])

  useEffect(() => {
    if (!document || !editableDocumentId || isDocumentTransactionActive) return
    const compatibilityPreview = compatibilityPreviewRef.current
    const project = createLocalProjectFile({
      editableDocumentId,
      document,
      locale: compatibilityPreview.locale,
      textScale: compatibilityPreview.textScale,
      mockPurchaseState,
      mockProducts,
      localRevisionSequence: compatibilityPreview.localRevisionSequence,
    })
    const fingerprint = JSON.stringify(project)
    if (fingerprint === lastSavedFingerprintRef.current) return
    const pending = {
      fingerprint,
      preset: mockPurchaseState,
      project,
      revision: document.revision,
    }
    pendingAutosaveRef.current = pending
    setStatus("saving")
    const timer = window.setTimeout(() => {
      attemptSave(pending)
    }, AUTOSAVE_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [
    document,
    editableDocumentId,
    attemptSave,
    isDocumentTransactionActive,
    mockProducts,
    mockPurchaseState,
  ])

  return { status, flush, retry }
}

export function useDraftAutosave(
  mockPurchaseState: MockPurchaseState,
  mockProducts: readonly MockProductDefinition[] = DEFAULT_MOCK_PRODUCTS,
) {
  return useDraftAutosaveController(mockPurchaseState, mockProducts).status
}
