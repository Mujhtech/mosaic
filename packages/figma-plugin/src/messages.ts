import type { ExportReport, ExportWarning } from "./mapper/report.js";

/** Messages the plugin's main thread posts to the UI iframe. */
export type PluginToUiMessage =
  | {
      readonly type: "exportReady";
      /** The serialised document, ready to download or copy verbatim. */
      readonly json: string;
      readonly fileName: string;
      /** The name the Studio bundle will be downloaded under. */
      readonly bundleFileName: string;
      readonly report: ExportReport;
    }
  | {
      readonly type: "bundleReady";
      /** The serialised `mosaic.figma-export` bundle. */
      readonly json: string;
      readonly fileName: string;
      /** Images the bundle's size caps excluded. */
      readonly dropped: readonly ExportWarning[];
    }
  | {
      readonly type: "bundleFailed";
      readonly message: string;
    }
  | {
      readonly type: "exportFailed";
      readonly message: string;
      readonly hint: string;
    };

/** Messages the UI iframe posts back to the main thread. */
export type UiToPluginMessage =
  | { readonly type: "requestExport" }
  /** Rendering images is slow, so the bundle is built only when asked for. */
  | { readonly type: "requestBundle" }
  /** Select and reveal a layer a report entry names. */
  | { readonly type: "selectNode"; readonly nodeId: string }
  | { readonly type: "notify"; readonly message: string }
  | { readonly type: "close" };
