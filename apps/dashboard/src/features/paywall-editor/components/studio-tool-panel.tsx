import { StatusMessage } from "@mosaic/design-system"
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus"
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash"
import { useState } from "react"
import type { RefObject } from "react"

import { Button } from "@/components/ui/button"
import { ComponentLibrary } from "@/features/paywall-editor/components/component-library"
import { ComponentTree } from "@/features/paywall-editor/components/component-tree"
import { DesignSystemPanel } from "@/features/paywall-editor/components/design-system-panel"
import { MockCommercePanel } from "@/features/paywall-editor/components/mock-commerce-panel"
import { PreviewControls } from "@/features/paywall-editor/components/preview-controls"
import type { StudioResizableWorkspaceHandle } from "@/features/paywall-editor/components/studio-resizable-workspace"
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import type { StudioViewportMode } from "@/features/paywall-editor/hooks/use-studio-viewport-mode"
import { STUDIO_SHORTCUT_HINTS } from "@/features/paywall-editor/hooks/use-editor-keyboard-shortcuts"
import type { EditorState } from "@/features/paywall-editor/stores/editor-store"
import {
  useEditorActions,
  useEditorStoreSelector,
} from "@/features/paywall-editor/stores/editor-store-context"
import { useStudioWorkspaceSelector } from "@/features/paywall-editor/stores/studio-workspace-store-context"
import type { StudioWorkspaceSnapshot } from "@/features/paywall-editor/stores/studio-workspace-store"
import type {
  Asset,
  MockProductDefinition,
  MockPurchaseState,
  PreviewClient,
} from "@/features/paywall-editor/types/editor"
import type { StudioTool } from "@/features/paywall-editor/types/studio-workspace"
import { cloneValue } from "@/features/paywall-editor/utils/clone"

const selectSelectedTool = (snapshot: StudioWorkspaceSnapshot) => snapshot.preferences.selectedTool
const selectTemplateDocument = (state: EditorState) => state.document

const TOOL_TITLE_IDS: Record<StudioTool, string> = {
  layers: "component-tree-title",
  components: "component-library-title",
  templates: "templates-panel-title",
  designSystem: "design-system-panel-title",
  products: "mock-commerce-title",
  localization: "preview-context-title",
  assets: "assets-panel-title",
  settings: "settings-panel-title",
}

function TemplatesPanel() {
  const document = useEditorStoreSelector(selectTemplateDocument)
  const editor = useEditorActions()
  const [notice, setNotice] = useState<string | null>(null)

  if (!document) return null

  function applyTemplate(template: (typeof EDITOR_TEMPLATES)[number]) {
    if (
      !window.confirm(
        `Replace this single local draft with ${template.name}? Undo restores the current draft.`,
      )
    ) {
      return
    }
    const revisionBefore = editor.getSnapshot().document?.revision
    editor.updateDocument(() => cloneValue(template.document))
    const changed = editor.getSnapshot().document?.revision !== revisionBefore
    setNotice(
      changed
        ? `${template.name} replaced the open draft. Undo restores the previous draft.`
        : `The open draft already matches ${template.name}.`,
    )
  }

  return (
    <section aria-labelledby="templates-panel-title" className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold" id="templates-panel-title">
          Templates
        </h2>
        <p className="text-muted-foreground mt-0.5 text-xs leading-5">
          Replace the single local draft from Mosaic&apos;s bundled starting points.
        </p>
      </div>
      <StatusMessage className="border-border bg-muted border p-3 text-xs" tone="warning">
        Applying a template replaces the open single local draft. Confirm once, then use Undo to
        restore the draft you had before replacement.
      </StatusMessage>
      <ul aria-label="Bundled templates" className="space-y-2">
        {EDITOR_TEMPLATES.map((template) => (
          <li className="border-border bg-background rounded-lg border p-3" key={template.id}>
            <p className="text-sm font-medium">{template.name}</p>
            <p className="text-muted-foreground mt-1 text-xs leading-5">{template.description}</p>
            <Button
              className="mt-3 w-full transition-none motion-reduce:transition-none"
              onClick={() => applyTemplate(template)}
              size="sm"
              type="button"
              variant="outline"
            >
              Use {template.name}
            </Button>
          </li>
        ))}
      </ul>
      {notice ? (
        <StatusMessage
          className="border-primary/20 bg-primary/5 rounded-lg border p-3 text-xs"
          tone="success"
        >
          {notice}
        </StatusMessage>
      ) : null}
    </section>
  )
}

function AssetsPanel({ assets }: { assets: readonly Asset[] }) {
  const editor = useEditorActions()

  function uniqueId(prefix: string) {
    const used = new Set(assets.map((asset) => asset.id))
    let index = assets.length + 1
    while (used.has(`${prefix}-${index}`)) index += 1
    return `${prefix}-${index}`
  }

  function addAsset(type: Asset["type"]) {
    const id = uniqueId(type)
    const asset: Asset =
      type === "image"
        ? {
            type,
            id,
            source: { type: "remote", url: "https://example.com/image.jpg" },
            fallback: {
              type: "placeholder",
              value: {
                default: "Image unavailable",
                localizationKey: `paywall.assets.${id.replaceAll("-", "_")}.fallback`,
              },
            },
          }
        : {
            type,
            id,
            source: { type: "remote", url: "https://example.com/video.mp4" },
          }
    editor.updateDocument((document) => ({ ...document, assets: [...document.assets, asset] }))
  }

  function updateAsset(id: string, updater: (asset: Asset) => Asset) {
    editor.updateDocument((document) => ({
      ...document,
      assets: document.assets.map((asset) => (asset.id === id ? updater(asset) : asset)),
    }))
  }

  return (
    <section aria-labelledby="assets-panel-title" className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold" id="assets-panel-title">
          Assets
        </h2>
        <p className="text-muted-foreground mt-0.5 text-xs leading-5">
          Add image and video assets for content and media backgrounds. Remote assets require HTTPS.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => addAsset("image")} size="sm" type="button" variant="outline">
          <PlusIcon aria-hidden /> Image
        </Button>
        <Button onClick={() => addAsset("video")} size="sm" type="button" variant="outline">
          <PlusIcon aria-hidden /> Video
        </Button>
      </div>
      {assets.length === 0 ? (
        <div className="border-border rounded-lg border border-dashed p-4 text-center">
          <p className="text-sm font-medium">No assets</p>
          <p className="text-muted-foreground mt-1 text-xs leading-5">
            Add an image or video, then select it from a component or background field.
          </p>
        </div>
      ) : (
        <ul aria-label="Paywall assets" className="space-y-2">
          {assets.map((asset) => (
            <li className="border-border space-y-2 rounded-lg border p-3" key={asset.id}>
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 text-sm font-medium break-all">{asset.id}</p>
                <span className="bg-muted rounded px-1.5 py-0.5 text-[10px] font-medium uppercase">
                  {asset.type}
                </span>
                <Button
                  aria-label={`Delete ${asset.id}`}
                  onClick={() =>
                    editor.updateDocument((document) => ({
                      ...document,
                      assets: document.assets.filter((candidate) => candidate.id !== asset.id),
                    }))
                  }
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <TrashIcon aria-hidden />
                </Button>
              </div>
              <label className="grid gap-1 text-[11px]">
                <span className="text-muted-foreground">Source</span>
                <select
                  className="border-input bg-background h-8 rounded-md border px-2 text-xs"
                  onChange={(event) =>
                    updateAsset(asset.id, (current) => ({
                      ...current,
                      source:
                        event.target.value === "remote"
                          ? {
                              type: "remote",
                              url:
                                current.type === "video"
                                  ? "https://example.com/video.mp4"
                                  : "https://example.com/image.jpg",
                            }
                          : { type: "bundled", key: current.id },
                    }))
                  }
                  value={asset.source.type}
                >
                  <option value="remote">Remote HTTPS</option>
                  <option value="bundled">Bundled key</option>
                </select>
              </label>
              <label className="grid gap-1 text-[11px]">
                <span className="text-muted-foreground">
                  {asset.source.type === "remote" ? "HTTPS URL" : "Bundle key"}
                </span>
                <input
                  className="border-input bg-background h-8 min-w-0 rounded-md border px-2 font-mono text-xs"
                  onChange={(event) =>
                    updateAsset(asset.id, (current) => ({
                      ...current,
                      source:
                        current.source.type === "remote"
                          ? { type: "remote", url: event.target.value }
                          : { type: "bundled", key: event.target.value },
                    }))
                  }
                  type={asset.source.type === "remote" ? "url" : "text"}
                  value={asset.source.type === "remote" ? asset.source.url : asset.source.key}
                />
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function SettingsPanel({
  canToggleProperties,
  workspaceControllerRef,
}: {
  canToggleProperties: boolean
  workspaceControllerRef: RefObject<StudioResizableWorkspaceHandle | null>
}) {
  return (
    <section aria-labelledby="settings-panel-title" className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold" id="settings-panel-title">
          Settings
        </h2>
        <p className="text-muted-foreground mt-0.5 text-xs leading-5">
          Control the local workspace layout and learn its keyboard commands.
        </p>
      </div>
      <div className="grid gap-2">
        <Button
          className="justify-start transition-none motion-reduce:transition-none"
          onClick={() => workspaceControllerRef.current?.collapse("left")}
          size="sm"
          type="button"
          variant="outline"
        >
          Collapse tool panel
        </Button>
        {canToggleProperties ? (
          <Button
            className="justify-start transition-none motion-reduce:transition-none"
            onClick={() => workspaceControllerRef.current?.toggle("properties")}
            size="sm"
            type="button"
            variant="outline"
          >
            Toggle properties
          </Button>
        ) : (
          <StatusMessage className="bg-muted rounded-lg p-3 text-xs" tone="info">
            Use the Properties button on the canvas in compact mode.
          </StatusMessage>
        )}
        <Button
          className="justify-start transition-none motion-reduce:transition-none"
          onClick={() => workspaceControllerRef.current?.toggle("diagnostics")}
          size="sm"
          type="button"
          variant="outline"
        >
          Toggle diagnostics
        </Button>
        <Button
          className="justify-start transition-none motion-reduce:transition-none"
          onClick={() => workspaceControllerRef.current?.reset()}
          size="sm"
          type="button"
          variant="outline"
        >
          Reset workspace layout
        </Button>
      </div>
      <div className="bg-muted rounded-lg p-3 text-xs leading-5">
        <h3 className="font-semibold">Keyboard commands</h3>
        <dl className="text-muted-foreground mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
          <dt>Open commands</dt>
          <dd>{STUDIO_SHORTCUT_HINTS.commandPalette}</dd>
          <dt>Open Layers / Components</dt>
          <dd>
            {STUDIO_SHORTCUT_HINTS.openLayers} / {STUDIO_SHORTCUT_HINTS.openComponents}
          </dd>
          <dt>Undo / Redo</dt>
          <dd>
            {STUDIO_SHORTCUT_HINTS.undo} / {STUDIO_SHORTCUT_HINTS.redo}
          </dd>
          <dt>Fit / Reset zoom</dt>
          <dd>
            {STUDIO_SHORTCUT_HINTS.fitCanvas} / {STUDIO_SHORTCUT_HINTS.resetZoom}
          </dd>
        </dl>
        <p className="text-muted-foreground mt-2">
          Shortcuts pause while an input, textarea, select, command search, or inline editor is
          active.
        </p>
      </div>
    </section>
  )
}

export interface StudioToolPanelProps {
  readonly assets: readonly Asset[]
  readonly mockProducts: readonly MockProductDefinition[]
  readonly mockPurchaseState: MockPurchaseState
  readonly previewClients: readonly PreviewClient[]
  readonly viewportMode: StudioViewportMode
  readonly workspaceControllerRef: RefObject<StudioResizableWorkspaceHandle | null>
  readonly onProductsChange: (products: MockProductDefinition[]) => void
  readonly onPurchaseStateChange: (state: MockPurchaseState) => void
}

export function StudioToolPanel({
  assets,
  mockProducts,
  mockPurchaseState,
  previewClients,
  viewportMode,
  workspaceControllerRef,
  onProductsChange,
  onPurchaseStateChange,
}: StudioToolPanelProps) {
  const selectedTool = useStudioWorkspaceSelector(selectSelectedTool)

  return (
    <aside
      aria-labelledby={TOOL_TITLE_IDS[selectedTool]}
      className="bg-card h-full overflow-y-auto"
    >
      <div className="p-4">
        {selectedTool === "layers" ? (
          <ComponentTree previewClients={previewClients} />
        ) : selectedTool === "components" ? (
          <ComponentLibrary />
        ) : selectedTool === "templates" ? (
          <TemplatesPanel />
        ) : selectedTool === "designSystem" ? (
          <DesignSystemPanel />
        ) : selectedTool === "products" ? (
          <MockCommercePanel
            mockProducts={mockProducts}
            mockPurchaseState={mockPurchaseState}
            onProductsChange={onProductsChange}
            onPurchaseStateChange={onPurchaseStateChange}
          />
        ) : selectedTool === "localization" ? (
          <PreviewControls />
        ) : selectedTool === "assets" ? (
          <AssetsPanel assets={assets} />
        ) : (
          <SettingsPanel
            canToggleProperties={viewportMode === "large" || viewportMode === "medium"}
            workspaceControllerRef={workspaceControllerRef}
          />
        )}
      </div>
    </aside>
  )
}
