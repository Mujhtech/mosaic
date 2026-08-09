/**
 * The export report.
 *
 * The mapping is lossy by construction, so what was dropped is part of the
 * deliverable, not an afterthought. The UI shows this verbatim.
 *
 * Every entry carries the originating Figma node id so the UI can offer
 * click-to-select: a warning that names a layer you cannot find is a warning
 * you ignore.
 */

export type ExportWarningCode =
  | "layout.absoluteFlattened"
  | "layout.rootWrapped"
  | "layout.baselineAlignment"
  | "text.justifiedAlignment"
  | "text.mixedFontSize"
  | "text.mixedFontWeight"
  | "text.mixedStyling"
  | "style.unsupportedFill"
  | "style.mixedCornerRadius"
  | "style.shapeApproximated"
  | "style.backgroundMerged"
  | "component.buttonDetected"
  | "component.productCardCandidate"
  | "navigation.threaded"
  | "bundle.imageDropped"
  | "id.renamed"
  | "localization.keyRenamed";

export type ExportSkipReason =
  | "image"
  | "vector"
  | "unsupported"
  | "hidden"
  | "emptyText"
  | "unmeasurable"
  | "unreachable";

export type ExportWarning = {
  readonly code: ExportWarningCode;
  /** Slash-joined Figma layer path, e.g. "Paywall/Hero/Title". */
  readonly layerPath: string;
  /** The Figma node id, so the UI can select and reveal the layer. */
  readonly figmaId: string;
  readonly message: string;
};

export type ExportSkip = {
  readonly reason: ExportSkipReason;
  readonly layerPath: string;
  /** The Figma node id, so the UI can select and reveal the layer. */
  readonly figmaId: string;
  /** The originating Figma node type, e.g. RECTANGLE. */
  readonly figmaType: string;
  readonly message: string;
};

export type ExportReport = {
  readonly documentId: string;
  /** Every top-level frame that became a screen, in canvas order. */
  readonly rootLayerNames: readonly string[];
  readonly screenCount: number;
  /** Protocol nodes emitted, counting the scroll containers and every stack. */
  readonly mappedNodeCount: number;
  readonly stackCount: number;
  readonly textCount: number;
  readonly buttonCount: number;
  readonly localizedStringCount: number;
  /** Layers whose pixels the export bundle can carry. */
  readonly imageCount: number;
  readonly warnings: readonly ExportWarning[];
  readonly skipped: readonly ExportSkip[];
};

export class ReportBuilder {
  readonly warnings: ExportWarning[] = [];
  readonly skipped: ExportSkip[] = [];

  warn(
    code: ExportWarningCode,
    layerPath: string,
    figmaId: string,
    message: string,
  ): void {
    this.warnings.push({ code, layerPath, figmaId, message });
  }

  skip(
    reason: ExportSkipReason,
    layerPath: string,
    figmaId: string,
    figmaType: string,
    message: string,
  ): void {
    this.skipped.push({ reason, layerPath, figmaId, figmaType, message });
  }
}
