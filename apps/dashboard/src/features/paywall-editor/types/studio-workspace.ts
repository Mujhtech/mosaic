export type StudioWorkspacePanel = "left" | "properties" | "diagnostics";

export type StudioTool =
  | "layers"
  | "components"
  | "templates"
  | "designSystem"
  | "products"
  | "localization"
  | "assets"
  | "settings";

export type StudioCanvasDevice =
  | "iphone-17-pro"
  | "iphone-17-pro-max"
  | "iphone-17"
  | "ipad-pro-11"
  | "ipad-pro-13"
  | "pixel-10"
  | "pixel-10-pro"
  | "pixel-10-pro-xl"
  | "galaxy-s26"
  | "galaxy-s26-plus"
  | "galaxy-s26-ultra";
export type StudioCanvasOrientation = "portrait" | "landscape";
export type StudioCanvasFitMode = "fit" | "manual";
export type StudioCanvasAppearance = "light" | "dark";

export type StudioRecentInsertableType =
  | "stack"
  | "carousel"
  | "switch"
  | "countdown"
  | "text"
  | "image"
  | "icon"
  | "featureList"
  | "productSelector"
  | "button";

export interface StudioWorkspacePanelPreference {
  readonly collapsed: boolean;
  readonly size: number;
}

export interface StudioCanvasPreferences {
  readonly appearance: StudioCanvasAppearance;
  readonly countdownPreviewAt: string;
  readonly device: StudioCanvasDevice;
  readonly fitMode: StudioCanvasFitMode;
  readonly forceRTL: boolean;
  readonly locale: string;
  readonly orientation: StudioCanvasOrientation;
  readonly safeArea: boolean;
  readonly textScale: number;
  readonly zoom: number;
}

export interface StudioCanvasFramePosition {
  readonly x: number;
  readonly y: number;
}

export interface StudioLayerMetadata {
  readonly canvasHiddenIds: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
  readonly lockedIds: readonly string[];
}

export interface StudioWorkspacePreferencesV1 {
  readonly canvas: StudioCanvasPreferences;
  readonly framePositions: Readonly<Record<string, StudioCanvasFramePosition>>;
  readonly layerMetadata: StudioLayerMetadata;
  readonly panels: Readonly<
    Record<StudioWorkspacePanel, StudioWorkspacePanelPreference>
  >;
  readonly recentInsertions: readonly StudioRecentInsertableType[];
  readonly schemaVersion: 1;
  readonly selectedTool: StudioTool;
}

export type StudioWorkspaceParseResult =
  | {
      readonly status: "invalid";
      readonly preferences: StudioWorkspacePreferencesV1;
    }
  | {
      readonly status: "valid";
      readonly preferences: StudioWorkspacePreferencesV1;
    };

export type StudioWorkspaceReadResult =
  | {
      readonly status: "missing";
      readonly source: "default";
      readonly preferences: StudioWorkspacePreferencesV1;
    }
  | {
      readonly status: "invalid";
      readonly source: "default";
      readonly preferences: StudioWorkspacePreferencesV1;
    }
  | {
      readonly status: "valid";
      readonly source: "persisted";
      readonly preferences: StudioWorkspacePreferencesV1;
    };

export type StudioWorkspaceWriteResult =
  | { readonly status: "written" }
  | { readonly status: "invalid" }
  | { readonly status: "unavailable" }
  | { readonly status: "failed" };

export type StudioWorkspaceResetResult =
  | { readonly status: "reset" }
  | { readonly status: "unavailable" }
  | { readonly status: "failed" };
