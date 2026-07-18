import { useEffect } from "react"

import {
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"
import type { StudioWorkspaceSnapshot } from "@/features/paywall-editor/stores/studio-workspace-store"
import {
  useStudioWorkspaceActions,
  useStudioWorkspaceSelector,
} from "@/features/paywall-editor/stores/studio-workspace-store-context"
import type { LocalProjectFile, MosaicDocument } from "@/features/paywall-editor/types/editor"
import type { StudioCanvasPreferences } from "@/features/paywall-editor/types/studio-workspace"

const selectCanvasPreferences = (snapshot: StudioWorkspaceSnapshot) => snapshot.preferences.canvas

export function reconcilePreviewLocale(document: MosaicDocument, requestedLocale: string) {
  if (document.localization.locales[requestedLocale]) return requestedLocale
  if (document.localization.locales[document.localization.defaultLocale]) {
    return document.localization.defaultLocale
  }
  if (document.localization.locales[document.localization.fallbackLocale]) {
    return document.localization.fallbackLocale
  }
  return Object.keys(document.localization.locales)[0] ?? "en"
}

export function resolveRestoredPreviewContext({
  document,
  localProjectPreview,
  workspaceCanvas,
  workspaceSource,
}: {
  document: MosaicDocument
  localProjectPreview: LocalProjectFile["preview"]
  workspaceCanvas: StudioCanvasPreferences
  workspaceSource: StudioWorkspaceSnapshot["initialSource"]
}) {
  const preferred = workspaceSource === "persisted" ? workspaceCanvas : localProjectPreview
  return {
    locale: reconcilePreviewLocale(document, preferred.locale),
    textScale: preferred.textScale,
  }
}

/**
 * Mirrors only the two protocol-supported native preview context values into the editor store.
 * Browser device chrome, zoom, appearance, orientation, RTL forcing, and safe-area guides remain
 * exclusively in the versioned workspace store.
 */
export function useWorkspacePreviewContext() {
  const { currentLocale, document, textScale } = useEditorStore()
  const editor = useEditorActions()
  const canvas = useStudioWorkspaceSelector(selectCanvasPreferences)
  const workspace = useStudioWorkspaceActions()

  useEffect(() => {
    if (!document) return
    const locale = reconcilePreviewLocale(document, canvas.locale)
    if (locale !== canvas.locale) workspace.setCanvasPreference("locale", locale)
    if (locale !== currentLocale) editor.setLocale(locale)
    if (canvas.textScale !== textScale) editor.setTextScale(canvas.textScale)
  }, [canvas.locale, canvas.textScale, currentLocale, document, editor, textScale, workspace])
}
