import { StatusMessage } from "@mosaic/design-system";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus";
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash";
import { useQuery } from "@tanstack/react-query";
import type { RefObject } from "react";
import { useCallback, useState } from "react";

import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { generatedAssetAdapter } from "@/features/assets/api/generated-asset-adapter";
import { assetsQueryOptions } from "@/features/assets/queries/asset-queries";
import { ComponentLibrary } from "@/features/paywall-editor/components/component-library";
import { ComponentTree } from "@/features/paywall-editor/components/component-tree";
import { DesignSystemPanel } from "@/features/paywall-editor/components/design-system-panel";
import { MockCommercePanel } from "@/features/paywall-editor/components/mock-commerce-panel";
import { PreviewControls } from "@/features/paywall-editor/components/preview-controls";
import type { StudioResizableWorkspaceHandle } from "@/features/paywall-editor/components/studio-resizable-workspace";
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates";
import { STUDIO_SHORTCUT_HINTS } from "@/features/paywall-editor/hooks/use-editor-keyboard-shortcuts";
import type { StudioViewportMode } from "@/features/paywall-editor/hooks/use-studio-viewport-mode";
import type { EditorState } from "@/features/paywall-editor/stores/editor-store";
import {
  useEditorActions,
  useEditorStoreSelector,
} from "@/features/paywall-editor/stores/editor-store-context";
import type { StudioWorkspaceSnapshot } from "@/features/paywall-editor/stores/studio-workspace-store";
import { useStudioWorkspaceSelector } from "@/features/paywall-editor/stores/studio-workspace-store-context";
import { useStudioSource } from "@/features/paywall-editor/stores/use-studio-source";
import type {
  Asset,
  MockProductDefinition,
  MockPurchaseState,
  PreviewClient,
} from "@/features/paywall-editor/types/editor";
import type { StudioSource } from "@/features/paywall-editor/types/studio-source";
import { hostedStudioHref } from "@/features/paywall-editor/types/studio-source";
import type { StudioTool } from "@/features/paywall-editor/types/studio-workspace";
import { cloneValue } from "@/features/paywall-editor/utils/clone";

const selectSelectedTool = (snapshot: StudioWorkspaceSnapshot) =>
  snapshot.preferences.selectedTool;
const selectTemplateDocument = (state: EditorState) => state.document;

const TOOL_TITLE_IDS: Record<StudioTool, string> = {
  layers: "component-tree-title",
  components: "component-library-title",
  templates: "templates-panel-title",
  designSystem: "design-system-panel-title",
  products: "mock-commerce-title",
  localization: "preview-context-title",
  assets: "assets-panel-title",
  settings: "settings-panel-title",
};

function TemplatesPanel() {
  const document = useEditorStoreSelector(selectTemplateDocument);
  const editor = useEditorActions();
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingTemplate, setPendingTemplate] = useState<
    (typeof EDITOR_TEMPLATES)[number] | null
  >(null);

  if (!document) {
    return null;
  }

  function applyTemplate(template: (typeof EDITOR_TEMPLATES)[number]) {
    setPendingTemplate(null);
    const revisionBefore = editor.getSnapshot().document?.revision;
    editor.updateDocument(() => cloneValue(template.document));
    const changed = editor.getSnapshot().document?.revision !== revisionBefore;
    setNotice(
      changed
        ? `${template.name} replaced the open draft. Undo restores the previous draft.`
        : `The open draft already matches ${template.name}.`
    );
  }

  return (
    <section aria-labelledby="templates-panel-title" className="space-y-3">
      <div>
        <h2 className="font-semibold text-sm" id="templates-panel-title">
          Templates
        </h2>
        <p className="mt-0.5 text-muted-foreground text-xs leading-5">
          Replace the single local draft from Mosaic&apos;s bundled starting
          points.
        </p>
      </div>
      <StatusMessage
        className="border border-border bg-muted p-3 text-xs"
        tone="warning"
      >
        Applying a template replaces the open single local draft. Confirm once,
        then use Undo to restore the draft you had before replacement.
      </StatusMessage>
      <ul aria-label="Bundled templates" className="space-y-2">
        {EDITOR_TEMPLATES.map((template) => (
          <li
            className="rounded border border-border bg-background p-3"
            key={template.id}
          >
            <p className="font-medium text-sm">{template.name}</p>
            <p className="mt-1 text-muted-foreground text-xs leading-5">
              {template.description}
            </p>
            <Button
              className="mt-3 w-full transition-none motion-reduce:transition-none"
              onClick={() => setPendingTemplate(template)}
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
          className="rounded border border-primary/20 bg-primary/5 p-3 text-xs"
          tone="success"
        >
          {notice}
        </StatusMessage>
      ) : null}
      <ConfirmDialog
        confirmLabel="Replace draft"
        description={
          pendingTemplate
            ? `Replace this single local draft with ${pendingTemplate.name}? Undo restores the current draft.`
            : ""
        }
        onConfirm={() => {
          if (pendingTemplate) {
            applyTemplate(pendingTemplate);
          }
        }}
        onOpenChange={(next) => {
          if (!next) {
            setPendingTemplate(null);
          }
        }}
        open={pendingTemplate !== null}
        title="Replace the open draft"
      />
    </section>
  );
}

function HostedManagedAssets({
  assets,
  source,
  updateAsset,
}: {
  assets: readonly Asset[];
  source: Extract<StudioSource, { kind: "hosted" }>;
  updateAsset: (id: string, updater: (asset: Asset) => Asset) => void;
}) {
  const managedAssets = useQuery({
    ...assetsQueryOptions(source.projectId, generatedAssetAdapter),
  });
  const readyManagedAssets =
    managedAssets.data?.filter((asset) => asset.status === "ready") ?? [];
  const assetsHref = `/orgs/${encodeURIComponent(source.organizationId)}/projects/${encodeURIComponent(source.projectId)}/monetization/${encodeURIComponent(source.environmentId)}/assets?returnTo=${encodeURIComponent(hostedStudioHref(source))}`;

  function managedAssetOptions(kind: Asset["type"]) {
    return [
      { label: "Choose a managed Asset", value: "" },
      ...readyManagedAssets
        .filter((candidate) => candidate.kind === kind)
        .map((candidate) => ({ label: candidate.name, value: candidate.id })),
    ];
  }

  function selectedManagedAssetId(asset: Asset) {
    if (asset.source.type !== "remote") {
      return "";
    }
    const { url } = asset.source;
    return (
      readyManagedAssets.find((candidate) => candidate.url === url)?.id ?? ""
    );
  }

  return (
    <div className="space-y-3 rounded border border-border bg-muted/35 p-3 text-xs">
      {managedAssets.isPending ? (
        <p className="text-muted-foreground">Loading managed Assets…</p>
      ) : managedAssets.error ? (
        <div role="alert">
          <p className="text-destructive">{managedAssets.error.message}</p>
          <Button
            className="mt-2"
            onClick={() => {
              managedAssets.refetch();
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            Retry Assets
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground">
          {readyManagedAssets.length} ready managed{" "}
          {readyManagedAssets.length === 1 ? "Asset" : "Assets"}
        </p>
      )}
      {readyManagedAssets.length > 0 && assets.length > 0 ? (
        <div className="space-y-2">
          {assets.map((asset) => (
            <div className="grid gap-1 text-[11px]" key={asset.id}>
              <label
                className="text-muted-foreground"
                htmlFor={`managed-asset-${asset.id}`}
              >
                Managed Asset for {asset.id}
              </label>
              <Select
                items={managedAssetOptions(asset.type)}
                onValueChange={(value) => {
                  const selected = readyManagedAssets.find(
                    (candidate) => candidate.id === value
                  );
                  if (!selected) {
                    return;
                  }
                  updateAsset(asset.id, (current) => ({
                    ...current,
                    source: { type: "remote", url: selected.url },
                  }));
                }}
                value={selectedManagedAssetId(asset)}
              >
                <SelectTrigger
                  className="text-xs"
                  id={`managed-asset-${asset.id}`}
                  size="sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {managedAssetOptions(asset.type).map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      ) : null}
      <a
        className={buttonVariants({ size: "sm", variant: "outline" })}
        href={assetsHref}
      >
        Manage uploads
      </a>
    </div>
  );
}

function AssetsPanel({ assets }: { assets: readonly Asset[] }) {
  const editor = useEditorActions();
  const source = useStudioSource();

  const uniqueId = useCallback(
    (prefix: string) => {
      const used = new Set(assets.map((asset) => asset.id));
      let index = assets.length + 1;
      while (used.has(`${prefix}-${index}`)) {
        index += 1;
      }
      return `${prefix}-${index}`;
    },
    [assets]
  );

  const addAsset = useCallback(
    (type: Asset["type"]) => {
      const id = uniqueId(type);
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
            };
      editor.updateDocument((document) => ({
        ...document,
        assets: [...document.assets, asset],
      }));
    },
    [editor, uniqueId]
  );

  const handleClick2 = useCallback(() => addAsset("video"), [addAsset]);
  const handleClick = useCallback(() => addAsset("image"), [addAsset]);
  function updateAsset(id: string, updater: (asset: Asset) => Asset) {
    editor.updateDocument((document) => ({
      ...document,
      assets: document.assets.map((asset) =>
        asset.id === id ? updater(asset) : asset
      ),
    }));
  }

  return (
    <section aria-labelledby="assets-panel-title" className="space-y-3">
      <div>
        <h2 className="font-semibold text-sm" id="assets-panel-title">
          Assets
        </h2>
        <p className="mt-0.5 text-muted-foreground text-xs leading-5">
          {source.kind === "hosted"
            ? "Select a ready managed Asset or add a bundled key. Only managed remote URLs can publish."
            : "Add image and video assets for content and media backgrounds. Remote assets require HTTPS."}
        </p>
      </div>
      {source.kind === "hosted" ? (
        <HostedManagedAssets
          assets={assets}
          source={source}
          updateAsset={updateAsset}
        />
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={handleClick} size="sm" type="button" variant="outline">
          <PlusIcon aria-hidden /> Image
        </Button>
        <Button
          onClick={handleClick2}
          size="sm"
          type="button"
          variant="outline"
        >
          <PlusIcon aria-hidden /> Video
        </Button>
      </div>
      {assets.length === 0 ? (
        <div className="rounded border border-border border-dashed p-4 text-center">
          <p className="font-medium text-sm">No assets</p>
          <p className="mt-1 text-muted-foreground text-xs leading-5">
            Add an image or video, then select it from a component or background
            field.
          </p>
        </div>
      ) : (
        <ul aria-label="Paywall assets" className="space-y-2">
          {assets.map((asset) => (
            <li
              className="space-y-2 rounded border border-border p-3"
              key={asset.id}
            >
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 break-all font-medium text-sm">
                  {asset.id}
                </p>
                <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-[10px] uppercase">
                  {asset.type}
                </span>
                <Button
                  aria-label={`Delete ${asset.id}`}
                  onClick={() =>
                    editor.updateDocument((document) => ({
                      ...document,
                      assets: document.assets.filter(
                        (candidate) => candidate.id !== asset.id
                      ),
                    }))
                  }
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <TrashIcon aria-hidden />
                </Button>
              </div>
              <div className="grid gap-1 text-[11px]">
                <label
                  className="text-muted-foreground"
                  htmlFor={`asset-source-${asset.id}`}
                >
                  Source
                </label>
                <Select
                  items={ASSET_SOURCE_OPTIONS}
                  onValueChange={(value) =>
                    updateAsset(asset.id, (current) => ({
                      ...current,
                      source:
                        value === "remote"
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
                  <SelectTrigger
                    className="text-xs"
                    id={`asset-source-${asset.id}`}
                    size="sm"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSET_SOURCE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="grid gap-1 text-[11px]">
                <span className="text-muted-foreground">
                  {asset.source.type === "remote" ? "HTTPS URL" : "Bundle key"}
                </span>
                <input
                  className="h-8 min-w-0 rounded border border-input bg-background px-2 font-mono text-xs"
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
                  value={
                    asset.source.type === "remote"
                      ? asset.source.url
                      : asset.source.key
                  }
                />
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SettingsPanel({
  canToggleProperties,
  workspaceControllerRef,
}: {
  canToggleProperties: boolean;
  workspaceControllerRef: RefObject<StudioResizableWorkspaceHandle | null>;
}) {
  return (
    <section aria-labelledby="settings-panel-title" className="space-y-4">
      <div>
        <h2 className="font-semibold text-sm" id="settings-panel-title">
          Settings
        </h2>
        <p className="mt-0.5 text-muted-foreground text-xs leading-5">
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
          <StatusMessage className="rounded bg-muted p-3 text-xs" tone="info">
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
      <div className="rounded bg-muted p-3 text-xs leading-5">
        <h3 className="font-semibold">Keyboard commands</h3>
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-muted-foreground">
          <dt>Open commands</dt>
          <dd>{STUDIO_SHORTCUT_HINTS.commandPalette}</dd>
          <dt>Open Layers / Components</dt>
          <dd>
            {STUDIO_SHORTCUT_HINTS.openLayers} /{" "}
            {STUDIO_SHORTCUT_HINTS.openComponents}
          </dd>
          <dt>Undo / Redo</dt>
          <dd>
            {STUDIO_SHORTCUT_HINTS.undo} / {STUDIO_SHORTCUT_HINTS.redo}
          </dd>
          <dt>Fit / Reset zoom</dt>
          <dd>
            {STUDIO_SHORTCUT_HINTS.fitCanvas} /{" "}
            {STUDIO_SHORTCUT_HINTS.resetZoom}
          </dd>
        </dl>
        <p className="mt-2 text-muted-foreground">
          Shortcuts pause while an input, textarea, select, command search, or
          inline editor is active.
        </p>
      </div>
    </section>
  );
}

export interface StudioToolPanelProps {
  readonly assets: readonly Asset[];
  readonly mockProducts: readonly MockProductDefinition[];
  readonly mockPurchaseState: MockPurchaseState;
  readonly onProductsChange: (products: MockProductDefinition[]) => void;
  readonly onPurchaseStateChange: (state: MockPurchaseState) => void;
  readonly previewClients: readonly PreviewClient[];
  readonly viewportMode: StudioViewportMode;
  readonly workspaceControllerRef: RefObject<StudioResizableWorkspaceHandle | null>;
}

const ASSET_SOURCE_OPTIONS = [
  { label: "Remote HTTPS", value: "remote" },
  { label: "Bundled key", value: "bundled" },
];

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
  const selectedTool = useStudioWorkspaceSelector(selectSelectedTool);

  return (
    <aside
      aria-labelledby={TOOL_TITLE_IDS[selectedTool]}
      className="scrollbar-thin scrollbar-gutter-stable h-full overflow-y-auto bg-card"
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
            canToggleProperties={
              viewportMode === "large" || viewportMode === "medium"
            }
            workspaceControllerRef={workspaceControllerRef}
          />
        )}
      </div>
    </aside>
  );
}
