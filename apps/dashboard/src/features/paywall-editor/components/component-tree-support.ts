import type { DragEvent } from "react";

import {
  COMPONENT_LIBRARY_DRAG_TYPE,
  LAYER_TYPE_LABELS,
} from "@/features/paywall-editor/components/component-catalog";
import type { EditorState } from "@/features/paywall-editor/stores/editor-store";
import type { StudioWorkspaceSnapshot } from "@/features/paywall-editor/stores/studio-workspace-store";
import type {
  MosaicDocument,
  PreviewClient,
  ProtocolNode,
  RequiredCapability,
  TreeInsertionLocation,
  TreeMoveTarget,
  TreeOperationResult,
} from "@/features/paywall-editor/types/editor";
import { findAncestorNodeIds } from "@/features/paywall-editor/utils/document-tree-traversal";

export function hasCatalogPayload(event: DragEvent<HTMLDivElement>) {
  return (
    Array.from(event.dataTransfer.types ?? []).includes(
      COMPONENT_LIBRARY_DRAG_TYPE
    ) || Boolean(event.dataTransfer.getData(COMPONENT_LIBRARY_DRAG_TYPE))
  );
}

export const LAYER_DRAG_TYPE = "application/x-mosaic-layer-id";

export const selectTreeState = (state: EditorState) => ({
  document: state.document,
  expandedTreeNodes: state.expandedTreeNodes,
  hoveredComponentId: state.hoveredComponentId,
  isDocumentTransactionActive: state.isDocumentTransactionActive,
  selectedComponentId: state.selectedComponentId,
});
export const selectLayerMetadata = (snapshot: StudioWorkspaceSnapshot) =>
  snapshot.preferences.layerMetadata;

export type TreeRow =
  | {
      readonly kind: "scroll";
      readonly id: string;
      readonly screenId: string;
      readonly presentation: "screen" | "sheet";
      readonly depth: number;
      readonly parentId: null;
    }
  | {
      readonly kind: "component";
      readonly id: string;
      readonly depth: number;
      readonly parentId: string;
      readonly node: ProtocolNode;
      readonly progress?: boolean;
    };

export interface DropPreview {
  readonly key: string;
  readonly result: TreeOperationResult;
  readonly target: TreeMoveTarget;
}

export interface RowDropTarget {
  readonly key: string;
  readonly target: TreeMoveTarget;
}

export interface PointerLayerDrag {
  active: boolean;
  readonly pointerId: number;
  readonly sourceId: string;
  readonly startX: number;
  readonly startY: number;
}

export interface OperationNotice {
  readonly detail: string;
  readonly title: string;
  readonly tone: "success" | "danger";
}

export interface CatalogDropPreview {
  readonly blocked: boolean;
  readonly label: string;
  readonly location: TreeInsertionLocation | null;
  readonly rowId: string;
}

export interface LayerIssueSummary {
  errorCount: number;
  warningCount: number;
}

export interface LayerActionItemsProps {
  readonly availability: {
    readonly delete: boolean;
    readonly duplicate: boolean;
    readonly indent: boolean;
    readonly moveDown: boolean;
    readonly moveUp: boolean;
    readonly outdent: boolean;
  };
  readonly onDelete: () => void;
  readonly onDuplicate: () => void;
  readonly onIndent: () => void;
  readonly onMoveDown: () => void;
  readonly onMoveUp: () => void;
  readonly onOutdent: () => void;
  readonly onRename: () => void;
  readonly onToggleHidden: () => void;
  readonly onToggleLocked: () => void;
  readonly state: { readonly hidden: boolean; readonly locked: boolean };
}

export const EMPTY_LAYER_ISSUE_SUMMARY: LayerIssueSummary = {
  errorCount: 0,
  warningCount: 0,
};

export function supportsCapability(
  client: PreviewClient,
  requirement: RequiredCapability
) {
  return client.supportedCapabilities.some(
    (capability) =>
      capability.name === requirement.name &&
      capability.version === requirement.version
  );
}

export function validationStatusLabel(summary: LayerIssueSummary) {
  const errors = `${summary.errorCount} validation ${summary.errorCount === 1 ? "error" : "errors"}`;
  if (summary.warningCount === 0) {
    return errors;
  }
  return `${errors} and ${summary.warningCount} ${summary.warningCount === 1 ? "warning" : "warnings"}`;
}

export function rowLabel(
  row: TreeRow,
  labels: Readonly<Record<string, string>>
) {
  if (row.kind === "scroll") {
    return (
      labels[row.screenId]?.trim() ||
      `${row.presentation === "sheet" ? "Sheet" : "Screen"} · ${row.screenId}`
    );
  }
  const customLabel = labels[row.id]?.trim();
  if (customLabel) {
    return row.progress ? `In progress · ${customLabel}` : customLabel;
  }
  if (row.parentId === row.id) {
    return "Content Stack";
  }
  const label = defaultNodeLabel(row.node);
  return row.progress ? `In progress · ${label}` : label;
}

export function defaultNodeLabel(node: ProtocolNode) {
  if (node.type !== "button") {
    return LAYER_TYPE_LABELS[node.type];
  }
  switch (node.action.type) {
    case "purchase":
      return "Purchase";
    case "restore":
      return "Restore";
    case "close":
      return "Close";
    case "navigateTo":
      return "Navigate to screen";
    case "navigateBack":
      return "Navigate back";
    case "openExternalUrl":
      return "Open external URL";
    default: {
      const unhandled: never = node.action;
      throw new Error(
        `Unhandled node.action.type: ${JSON.stringify(unhandled)}`
      );
    }
  }
}

export function componentLabel(
  node: ProtocolNode,
  rootContentIds: ReadonlySet<string>,
  labels: Readonly<Record<string, string>>
) {
  const customLabel = labels[node.id]?.trim();
  if (customLabel) {
    return customLabel;
  }
  return rootContentIds.has(node.id) ? "Content Stack" : defaultNodeLabel(node);
}

export function visibleRows(
  document: MosaicDocument,
  expandedTreeNodes: ReadonlySet<string>,
  collapsedScreenIds: ReadonlySet<string>
) {
  const rows: TreeRow[] = [];

  function visitChildren(node: ProtocolNode, depth: number, progress: boolean) {
    if (node.type === "productSelector") {
      for (const card of node.cards) {
        visit(card, depth, node.id, progress);
      }
      return;
    }
    if (
      node.type === "stack" ||
      node.type === "button" ||
      node.type === "productCard" ||
      node.type === "productBadge"
    ) {
      for (const child of node.children) {
        visit(child, depth, node.id, progress);
      }
      if (node.type === "button") {
        for (const child of node.inProgressChildren ?? []) {
          visit(child, depth, node.id, true);
        }
      }
      return;
    }
    if (node.type === "carousel") {
      for (const page of node.pages) {
        visit(page.content, depth, node.id, progress);
      }
      return;
    }
    if (node.type === "tabs") {
      for (const tab of node.tabs) {
        visit(tab.content, depth, node.id, progress);
      }
    }
  }

  function visit(
    node: ProtocolNode,
    depth: number,
    parentId: string,
    progress = false
  ) {
    rows.push({
      kind: "component",
      id: node.id,
      depth,
      parentId,
      node,
      progress,
    });
    if (expandedTreeNodes.has(node.id)) {
      visitChildren(node, depth + 1, progress);
    }
  }

  for (const screen of document.screens) {
    rows.push({
      kind: "scroll",
      id: screen.layout.id,
      screenId: screen.id,
      presentation: screen.presentation.type,
      depth: 1,
      parentId: null,
    });
    if (!collapsedScreenIds.has(screen.id)) {
      visit(screen.layout.content, 2, screen.layout.content.id);
    }
  }
  return rows;
}

export function isRootContentId(document: MosaicDocument, id: string) {
  return document.screens.some((screen) => screen.layout.content.id === id);
}

export function isMarked(
  document: MosaicDocument,
  id: string,
  markedIds: ReadonlySet<string>
) {
  return (
    markedIds.has(id) ||
    findAncestorNodeIds(document, id).some((ancestorId) =>
      markedIds.has(ancestorId)
    )
  );
}

export function actionDisabledReason(
  document: MosaicDocument,
  selectedComponentId: string | null,
  effectivelyLocked: boolean
) {
  if (!selectedComponentId) {
    return "Select a component first";
  }
  if (isRootContentId(document, selectedComponentId)) {
    return "The root content Stack is fixed";
  }
  if (effectivelyLocked) {
    return "Unlock this layer before changing its structure";
  }
  return null;
}
