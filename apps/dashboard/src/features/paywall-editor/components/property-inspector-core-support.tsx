import { AlignBottomSimpleIcon } from "@phosphor-icons/react/dist/ssr/AlignBottomSimple";
import { AlignCenterHorizontalSimpleIcon } from "@phosphor-icons/react/dist/ssr/AlignCenterHorizontalSimple";
import { AlignCenterVerticalSimpleIcon } from "@phosphor-icons/react/dist/ssr/AlignCenterVerticalSimple";
import { AlignLeftSimpleIcon } from "@phosphor-icons/react/dist/ssr/AlignLeftSimple";
import { AlignRightSimpleIcon } from "@phosphor-icons/react/dist/ssr/AlignRightSimple";
import { AlignTopSimpleIcon } from "@phosphor-icons/react/dist/ssr/AlignTopSimple";
import { ArrowsHorizontalIcon } from "@phosphor-icons/react/dist/ssr/ArrowsHorizontal";
import { ArrowsVerticalIcon } from "@phosphor-icons/react/dist/ssr/ArrowsVertical";
import { ColumnsIcon } from "@phosphor-icons/react/dist/ssr/Columns";
import { RowsIcon } from "@phosphor-icons/react/dist/ssr/Rows";
import type { KeyboardEvent, ReactNode } from "react";
import { createContext } from "react";

import { LAYER_TYPE_LABELS } from "@/features/paywall-editor/components/component-catalog";
import type { StudioWorkspaceSnapshot } from "@/features/paywall-editor/stores/studio-workspace-store";
import type {
  MosaicDocument,
  ProtocolNode,
  Screen,
  ValidationIssue,
} from "@/features/paywall-editor/types/editor";
import { findNode } from "@/features/paywall-editor/utils/document-tree-traversal";
import {
  withDocumentParts,
  withScreenParts,
} from "@/features/paywall-editor/utils/document-version";
import type { MosaicPaywallV04EdgeInsets } from "@/lib/mosaic-protocol";

export const ZERO_INSETS: MosaicPaywallV04EdgeInsets = {
  top: 0,
  start: 0,
  bottom: 0,
  end: 0,
};
export const PRODUCT_VARIABLE_TOKENS = [
  { label: "Product name", value: "{{ product.name }}" },
  { label: "Product price", value: "{{ product.price }}" },
] as const;
export const selectLayerMetadata = (snapshot: StudioWorkspaceSnapshot) =>
  snapshot.preferences.layerMetadata;

export type ScrollContainer = Screen["layout"];
export type ControlNode = Extract<
  ProtocolNode,
  {
    type:
      | "featureList"
      | "productSelector"
      | "button"
      | "carousel"
      | "switch"
      | "tabs"
      | "timeline"
      | "award"
      | "socialProof";
  }
>;

export function isControlNode(node: ProtocolNode): node is ControlNode {
  return (
    node.type === "featureList" ||
    node.type === "productSelector" ||
    node.type === "button" ||
    node.type === "carousel" ||
    node.type === "switch" ||
    node.type === "tabs" ||
    node.type === "timeline" ||
    node.type === "award" ||
    node.type === "socialProof"
  );
}

export function layerDisplayLabel(
  document: MosaicDocument,
  id: string,
  labels: Readonly<Record<string, string>>
) {
  if (document.screens.some((screen) => id === screen.layout.id)) {
    return "Scroll Container";
  }
  const customLabel = labels[id]?.trim();
  if (customLabel) {
    return customLabel;
  }
  const node = findNode(document, id);
  if (!node) {
    return "Unknown layer";
  }
  return document.screens.some((screen) => node.id === screen.layout.content.id)
    ? "Content Stack"
    : LAYER_TYPE_LABELS[node.type];
}

export function updateScrollContainer(
  document: MosaicDocument,
  layoutId: string,
  updater: (layout: ScrollContainer) => ScrollContainer
) {
  return withDocumentParts(document, {
    screens: document.screens.map((screen) =>
      screen.layout.id === layoutId
        ? withScreenParts(screen, { layout: updater(screen.layout) })
        : screen
    ),
  });
}

export interface InspectorContextValue {
  readonly componentId: string;
  readonly disabled: boolean;
  readonly document: MosaicDocument;
  readonly issues: readonly ValidationIssue[];
  readonly locale: string;
}

export const InspectorContext = createContext<InspectorContextValue | null>(
  null
);
export const EMPTY_VALIDATION_ISSUES: readonly ValidationIssue[] = [];

export interface CompactOption {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string;
}

export const FLOW_OPTIONS: readonly CompactOption[] = [
  {
    icon: <RowsIcon aria-hidden className="size-4" />,
    label: "Vertical",
    value: "vertical",
  },
  {
    icon: <ColumnsIcon aria-hidden className="size-4" />,
    label: "Horizontal",
    value: "horizontal",
  },
];

export function distributionOptions(
  direction: "horizontal" | "vertical"
): readonly CompactOption[] {
  const vertical = direction === "vertical";
  return [
    {
      icon: vertical ? (
        <AlignTopSimpleIcon aria-hidden className="size-4" />
      ) : (
        <AlignLeftSimpleIcon aria-hidden className="size-4" />
      ),
      label: "Start",
      value: "start",
    },
    {
      icon: vertical ? (
        <AlignCenterVerticalSimpleIcon aria-hidden className="size-4" />
      ) : (
        <AlignCenterHorizontalSimpleIcon aria-hidden className="size-4" />
      ),
      label: "Centre",
      value: "center",
    },
    {
      icon: vertical ? (
        <AlignBottomSimpleIcon aria-hidden className="size-4" />
      ) : (
        <AlignRightSimpleIcon aria-hidden className="size-4" />
      ),
      label: "End",
      value: "end",
    },
    {
      icon: vertical ? (
        <ArrowsVerticalIcon aria-hidden className="size-4" />
      ) : (
        <ArrowsHorizontalIcon aria-hidden className="size-4" />
      ),
      label: "Space between",
      value: "spaceBetween",
    },
  ];
}

export function alignmentOptions(
  direction: "horizontal" | "vertical"
): readonly CompactOption[] {
  const vertical = direction === "vertical";
  return [
    {
      icon: vertical ? (
        <AlignLeftSimpleIcon aria-hidden className="size-4" />
      ) : (
        <AlignTopSimpleIcon aria-hidden className="size-4" />
      ),
      label: "Start",
      value: "start",
    },
    {
      icon: vertical ? (
        <AlignCenterHorizontalSimpleIcon aria-hidden className="size-4" />
      ) : (
        <AlignCenterVerticalSimpleIcon aria-hidden className="size-4" />
      ),
      label: "Centre",
      value: "center",
    },
    {
      icon: vertical ? (
        <AlignRightSimpleIcon aria-hidden className="size-4" />
      ) : (
        <AlignBottomSimpleIcon aria-hidden className="size-4" />
      ),
      label: "End",
      value: "end",
    },
    {
      icon: vertical ? (
        <ArrowsHorizontalIcon aria-hidden className="size-4" />
      ) : (
        <ArrowsVerticalIcon aria-hidden className="size-4" />
      ),
      label: "Stretch",
      value: "stretch",
    },
  ];
}

export function transactionEscape(
  event: KeyboardEvent<HTMLElement>,
  cancel: () => boolean
) {
  if (event.key !== "Escape") {
    return;
  }
  event.preventDefault();
  cancel();
  event.currentTarget.blur();
}
