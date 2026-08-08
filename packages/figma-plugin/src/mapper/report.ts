/**
 * The export report.
 *
 * The mapping is lossy by construction, so what was dropped is part of the
 * deliverable, not an afterthought. The UI shows this verbatim.
 */

export type ExportWarningCode =
  | "layout.absoluteFlattened"
  | "layout.rootWrapped"
  | "layout.baselineAlignment"
  | "text.justifiedAlignment"
  | "text.mixedFontSize"
  | "text.mixedFontWeight"
  | "style.unsupportedFill"
  | "style.mixedCornerRadius"
  | "id.renamed"
  | "localization.keyRenamed";

export type ExportSkipReason =
  | "image"
  | "vector"
  | "unsupported"
  | "hidden"
  | "emptyText";

export type ExportWarning = {
  readonly code: ExportWarningCode;
  /** Slash-joined Figma layer path, e.g. "Paywall/Hero/Title". */
  readonly layerPath: string;
  readonly message: string;
};

export type ExportSkip = {
  readonly reason: ExportSkipReason;
  readonly layerPath: string;
  /** The originating Figma node type, e.g. RECTANGLE. */
  readonly figmaType: string;
  readonly message: string;
};

export type ExportReport = {
  readonly documentId: string;
  readonly rootLayerName: string;
  /** Protocol nodes emitted, counting the scroll container and every stack. */
  readonly mappedNodeCount: number;
  readonly stackCount: number;
  readonly textCount: number;
  readonly localizedStringCount: number;
  readonly warnings: readonly ExportWarning[];
  readonly skipped: readonly ExportSkip[];
};

export class ReportBuilder {
  readonly warnings: ExportWarning[] = [];
  readonly skipped: ExportSkip[] = [];

  warn(code: ExportWarningCode, layerPath: string, message: string): void {
    this.warnings.push({ code, layerPath, message });
  }

  skip(
    reason: ExportSkipReason,
    layerPath: string,
    figmaType: string,
    message: string,
  ): void {
    this.skipped.push({ reason, layerPath, figmaType, message });
  }
}
