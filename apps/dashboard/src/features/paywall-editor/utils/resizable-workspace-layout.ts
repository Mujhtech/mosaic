import type {
  ResizableLayoutChangedMeta,
  ResizablePanelImperativeHandle,
} from "@/components/ui/resizable"
import type {
  StudioWorkspaceActions,
  StudioWorkspaceSnapshot,
} from "@/features/paywall-editor/stores/studio-workspace-store"
import type {
  StudioWorkspacePanel,
  StudioWorkspacePanelPreference,
} from "@/features/paywall-editor/types/studio-workspace"

interface CompletedPanelLayoutInput {
  readonly meta: Pick<ResizableLayoutChangedMeta, "isUserInteraction">
  readonly panel: StudioWorkspacePanel
  readonly panelHandle: ResizablePanelImperativeHandle | null
  readonly preference: StudioWorkspacePanelPreference
  readonly actions: Pick<StudioWorkspaceActions, "commitPanelLayout">
}

export function restorePanelPreference(
  panelHandle: ResizablePanelImperativeHandle | null,
  preference: StudioWorkspacePanelPreference,
) {
  if (!panelHandle) return false
  if (panelHandle.getSize().inPixels === 0 && !panelHandle.isCollapsed()) return false
  panelHandle.resize(`${preference.size}px`)
  if (preference.collapsed) panelHandle.collapse()
  else panelHandle.expand()
  return true
}

export function restoreWorkspacePanelPreferences({
  leftPanelHandle,
  propertiesPanelHandle,
  diagnosticsPanelHandle,
  preferences,
  includeProperties,
}: {
  readonly leftPanelHandle: ResizablePanelImperativeHandle | null
  readonly propertiesPanelHandle: ResizablePanelImperativeHandle | null
  readonly diagnosticsPanelHandle: ResizablePanelImperativeHandle | null
  readonly preferences: StudioWorkspaceSnapshot["preferences"]["panels"]
  readonly includeProperties: boolean
}) {
  const leftReady =
    leftPanelHandle !== null &&
    (leftPanelHandle.getSize().inPixels > 0 || leftPanelHandle.isCollapsed())
  const diagnosticsReady =
    diagnosticsPanelHandle !== null &&
    (diagnosticsPanelHandle.getSize().inPixels > 0 || diagnosticsPanelHandle.isCollapsed())
  const propertiesReady =
    !includeProperties ||
    (propertiesPanelHandle !== null &&
      (propertiesPanelHandle.getSize().inPixels > 0 || propertiesPanelHandle.isCollapsed()))
  if (!leftReady || !diagnosticsReady || !propertiesReady) return false
  const leftApplied = restorePanelPreference(leftPanelHandle, preferences.left)
  const diagnosticsApplied = restorePanelPreference(diagnosticsPanelHandle, preferences.diagnostics)
  const propertiesApplied = includeProperties
    ? restorePanelPreference(propertiesPanelHandle, preferences.properties)
    : true
  return leftApplied && diagnosticsApplied && propertiesApplied
}

export function commitCompletedPanelLayout({
  meta,
  panel,
  panelHandle,
  preference,
  actions,
}: CompletedPanelLayoutInput) {
  if (!meta.isUserInteraction || !panelHandle) return false
  const collapsed = panelHandle.isCollapsed()
  const measuredSize = panelHandle.getSize().inPixels
  return actions.commitPanelLayout(panel, {
    collapsed,
    size: collapsed ? preference.size : measuredSize,
  })
}

export function commitUpstreamDoubleClickResult(input: Omit<CompletedPanelLayoutInput, "meta">) {
  return commitCompletedPanelLayout({ ...input, meta: { isUserInteraction: true } })
}
