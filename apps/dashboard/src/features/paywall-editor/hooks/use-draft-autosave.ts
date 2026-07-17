import { useEffect, useRef, useState } from "react"

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

export function useDraftAutosave(
  mockPurchaseState: MockPurchaseState,
  mockProducts: readonly MockProductDefinition[] = DEFAULT_MOCK_PRODUCTS,
) {
  const { document, editableDocumentId, currentLocale, textScale, localRevisionSequence } =
    useEditorStore()
  const { markSaved } = useEditorActions()
  const [status, setStatus] = useState<AutosaveStatus>("idle")
  const lastSavedFingerprintRef = useRef("")

  useEffect(() => {
    if (!document || !editableDocumentId) return
    const project = createLocalProjectFile({
      editableDocumentId,
      document,
      locale: currentLocale,
      textScale,
      mockPurchaseState,
      mockProducts,
      localRevisionSequence,
    })
    const fingerprint = JSON.stringify(project)
    if (fingerprint === lastSavedFingerprintRef.current) return
    setStatus("saving")
    const revision = document.revision
    const timer = window.setTimeout(() => {
      const saved = writeLocalProject(project, mockPurchaseState)
      setStatus(saved ? "saved" : "failed")
      if (saved) {
        lastSavedFingerprintRef.current = fingerprint
        markSaved(revision)
      }
    }, AUTOSAVE_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [
    currentLocale,
    document,
    editableDocumentId,
    markSaved,
    localRevisionSequence,
    mockProducts,
    mockPurchaseState,
    textScale,
  ])

  return status
}
