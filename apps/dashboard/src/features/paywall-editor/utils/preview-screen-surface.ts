import type { CSSProperties } from "react";

import type { CanvasDeviceGeometry } from "@/features/paywall-editor/components/canvas-preview-geometry";
import {
  alignmentStyle,
  distributionStyle,
} from "@/features/paywall-editor/components/canvas-preview-node-primitives-support";
import type {
  MosaicDocument,
  Screen,
  StackComponent,
} from "@/features/paywall-editor/types/editor";
import {
  type ResolvedPreviewBackground,
  resolvedBackground,
  resolvedProtocolColor,
  resolvedShadow,
} from "@/features/paywall-editor/utils/protocol-styles";

/** Physical device insets, as the canvas geometry reports them. */
export type PreviewSafeArea = CanvasDeviceGeometry["safeArea"];

export const NO_SAFE_AREA: PreviewSafeArea = Object.freeze({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});

export interface PreviewScreenSurface {
  /** The screen background, painted behind the root content Stack. */
  readonly layoutBackground: ResolvedPreviewBackground;
  readonly root: StackComponent;
  readonly rootBackground: ResolvedPreviewBackground;
  /** Every root-Stack style the document itself decides. */
  readonly rootStyle: CSSProperties;
}

/**
 * The document-derived half of a rendered screen, shared by every surface that
 * paints one: the Studio canvas device and the Paywall list thumbnail.
 *
 * Only what the document decides lives here. Presentation chrome — sheet
 * anchoring, selection rings, canvas appearance fallbacks — stays with the
 * caller, which layers it over `rootStyle`. Keeping the document half in one
 * place is the point: a background, padding or shadow rule that the canvas
 * honours and the thumbnail forgets would make the gallery misreport what the
 * Paywall looks like.
 *
 * `safeArea` arrives already resolved, so a caller that ignores the safe area,
 * or suppresses one edge, does so explicitly rather than by re-deriving it.
 */
export function previewScreenSurface(
  document: MosaicDocument,
  layout: Screen["layout"],
  safeArea: PreviewSafeArea
): PreviewScreenSurface {
  const root = layout.content;
  const rootBackground = resolvedBackground(
    document,
    root.appearance?.background
  );

  return {
    layoutBackground: resolvedBackground(document, layout.background),
    root,
    rootBackground,
    rootStyle: {
      alignItems: alignmentStyle(root.crossAxisAlignment),
      ...rootBackground.style,
      borderColor: resolvedProtocolColor(
        document,
        root.appearance?.border?.color
      ),
      borderRadius: root.appearance?.cornerRadius,
      borderStyle: root.appearance?.border ? "solid" : undefined,
      borderWidth: root.appearance?.border?.width,
      flexDirection: root.direction === "vertical" ? "column" : "row",
      gap: root.gap,
      justifyContent: distributionStyle(root.mainAxisDistribution),
      opacity: root.appearance?.opacity,
      boxShadow: resolvedShadow(document, root.appearance?.shadow),
      isolation: "isolate",
      overflow: root.appearance?.clipContent ? "hidden" : undefined,
      paddingBlockEnd: root.padding.bottom + safeArea.bottom,
      paddingBlockStart: root.padding.top + safeArea.top,
      paddingInlineEnd: root.padding.end + safeArea.right,
      paddingInlineStart: root.padding.start + safeArea.left,
    },
  };
}

/**
 * The safe area a screen actually reserves. A screen that ignores it reserves
 * nothing on any edge.
 */
export function resolvedScreenSafeArea(
  layout: Screen["layout"],
  deviceSafeArea: PreviewSafeArea
): PreviewSafeArea {
  return layout.safeArea === "respect" ? deviceSafeArea : NO_SAFE_AREA;
}
