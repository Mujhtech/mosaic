import type { ExportReport } from "./mapper/report.js";

/** Messages the plugin's main thread posts to the UI iframe. */
export type PluginToUiMessage =
  | {
      readonly type: "exportReady";
      /** The serialised document, ready to download or copy verbatim. */
      readonly json: string;
      readonly fileName: string;
      readonly report: ExportReport;
    }
  | {
      readonly type: "exportFailed";
      readonly message: string;
      readonly hint: string;
    };

/** Messages the UI iframe posts back to the main thread. */
export type UiToPluginMessage =
  | { readonly type: "requestExport" }
  | { readonly type: "notify"; readonly message: string }
  | { readonly type: "close" };
