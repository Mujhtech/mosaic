import { useEffect } from "react";
import { PropertyInspector } from "@/features/paywall-editor/components/property-inspector";
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates";
import { useEditorValidation } from "@/features/paywall-editor/hooks/use-editor-validation";
import {
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context";
import { useStudioWorkspaceActions } from "@/features/paywall-editor/stores/studio-workspace-store-context";
import type {
  MosaicDocument,
  ValidationIssue,
} from "@/features/paywall-editor/types/editor";
import { findNode } from "@/features/paywall-editor/utils/document-tree-traversal";
import { required } from "@/test/required";

const NO_ISSUES: readonly ValidationIssue[] = [];

export function InspectorHarness({
  initialDocument,
  issues = NO_ISSUES,
  lockedLayerId,
  lockSelection = false,
  selection = "plans",
  templateIndex = 0,
}: {
  initialDocument?: MosaicDocument;
  issues?: readonly ValidationIssue[];
  lockedLayerId?: string;
  lockSelection?: boolean;
  selection?: string;
  templateIndex?: number;
}) {
  const { document, productLayerPreview, selectedComponentId, undoStack } =
    useEditorStore();
  const { loadTemplate, selectComponent, undo } = useEditorActions();
  const workspace = useStudioWorkspaceActions();

  useEffect(() => {
    if (document) {
      if (selectedComponentId !== selection) {
        selectComponent(selection);
      }
      const layerToLock = lockedLayerId ?? (lockSelection ? selection : null);
      if (layerToLock) {
        workspace.setLayerLocked(layerToLock, true);
      }
    } else {
      loadTemplate(
        initialDocument ??
          required(
            EDITOR_TEMPLATES[templateIndex],
            "EDITOR_TEMPLATES[templateIndex]"
          ).document
      );
    }
  }, [
    document,
    initialDocument,
    loadTemplate,
    lockedLayerId,
    lockSelection,
    selectComponent,
    selectedComponentId,
    selection,
    templateIndex,
    workspace,
  ]);

  const selector = document ? findNode(document, "plans") : null;
  const firstCard =
    selector?.type === "productSelector" ? selector.cards[0] : null;
  return (
    <>
      <PropertyInspector issues={issues} />
      <button onClick={undo} type="button">
        Undo editor change
      </button>
      <output data-testid="bindings">
        {selector?.type === "productSelector"
          ? selector.cards.map((card) => card.productReferenceId).join(",")
          : ""}
      </output>
      <output data-testid="selected-card-style">
        {firstCard ? JSON.stringify(firstCard.styles.selected) : ""}
      </output>
      <output data-testid="inspector-undo-count">{undoStack.length}</output>
      <output data-testid="product-layer-preview">
        {productLayerPreview
          ? `${productLayerPreview.nodeId}:${productLayerPreview.state}`
          : "none"}
      </output>
      <output data-testid="inspector-document">
        {document ? JSON.stringify(document) : ""}
      </output>
    </>
  );
}

export type SeedMode = "feature" | "hint" | "image";

export function SeededLocalizedTextHarness({ mode }: { mode: SeedMode }) {
  const { document, selectedComponentId } = useEditorStore();
  const editor = useEditorActions();
  const validation = useEditorValidation();

  useEffect(() => {
    if (!document) {
      editor.loadTemplate(
        required(
          EDITOR_TEMPLATES[mode === "feature" ? 1 : 0],
          'EDITOR_TEMPLATES[mode === "feature" ? 1 : 0]'
        ).document
      );
      return;
    }
    if (mode === "image") {
      const image = findNode(document, "image-1");
      if (!image) {
        const result = editor.insertComponentAt("image", {
          parentId: required(document.screens[0], "document.screens[0]").layout
            .content.id,
          index: 0,
        });
        if (result.status === "accepted") {
          editor.selectComponent(result.nodeId);
        }
        return;
      }
      if (selectedComponentId !== image.id) {
        editor.selectComponent(image.id);
      }
      return;
    }
    const selection = mode === "feature" ? "features" : "purchase";
    if (selectedComponentId !== selection) {
      editor.selectComponent(selection);
    }
  }, [document, editor, mode, selectedComponentId]);

  const selected = document ? findNode(document, selectedComponentId) : null;
  const createdText = (() => {
    if (
      mode === "feature" &&
      selected?.type === "featureList" &&
      selected.items.length > 2
    ) {
      return selected.items.at(-1)?.text;
    }
    if (mode === "hint" && selected?.type === "button") {
      return selected.accessibility.hint;
    }
    if (
      mode === "image" &&
      selected?.type === "image" &&
      !selected.accessibility.hidden
    ) {
      return selected.accessibility.label;
    }
  })();
  const seeded =
    createdText && document
      ? Object.values(document.localization.locales).every((catalog) =>
          catalog.strings[createdText.localizationKey]?.trim()
        )
      : false;

  return (
    <>
      <PropertyInspector issues={validation.issues} />
      <output data-testid="validation-count">{validation.errors.length}</output>
      <output data-testid="all-locales-seeded">{String(seeded)}</output>
    </>
  );
}
