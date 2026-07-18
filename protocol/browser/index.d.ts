// Generated public declarations for protocol/browser/index.js. Do not edit.
import type {
  MosaicLocalProject,
  MosaicLocalProjectV02,
  MosaicPaywallDocument,
  MosaicPaywallV02Document,
  MosaicPaywallV02CountdownComponent,
  MosaicPaywallV02AxisSizingValue,
  MosaicPaywallV02Background,
  MosaicPaywallV02Color,
  MosaicPaywallV02NavigateBackAction,
  MosaicPaywallV02NavigateToAction,
  MosaicPaywallV02ProductBadgeComponent,
  MosaicPaywallV02ProductCardComponent,
  MosaicPaywallV02ProductCardDefaultStyle,
  MosaicPaywallV02ProductSelectorComponent,
  MosaicPaywallV02Shadow,
  MosaicPaywallV02Visibility,
  MosaicPreviewCapabilityReportPayload,
  MosaicPreviewCapabilityName,
  MosaicPreviewMessage,
  MosaicPreviewV02CapabilityReportPayload,
  MosaicPreviewV02Message,
  MosaicPreviewValidationDiagnostic,
} from "./generated/contract-types.js";

export * from "./generated/contract-types.js";

export type MosaicContractDiagnostic = MosaicPreviewValidationDiagnostic;
export type MosaicAnyPaywallDocument = MosaicPaywallV02Document;
export type MosaicAnyPreviewMessage = MosaicPreviewV02Message;
export type MosaicAnyLocalProject = MosaicLocalProjectV02;

export type MosaicLocalPreviewNegotiationDiagnostic = {
  readonly code: "preview.noMutualVersion" | "preview.incompatibleSchemaVersion" | "preview.invalidNegotiation" | "preview.invalidCapabilityReport" | "preview.invalidDraft" | "preview.unsupportedPreviewCapability" | "preview.unsupportedCapability" | "preview.documentTooLarge";
  readonly message: string;
  readonly fallback: "keepLastAcceptedDraft";
  readonly recovery: {
    readonly action: "updatePreviewClient" | "editProperty" | "removeComponent";
    readonly message: string;
  };
};
export type MosaicLocalPreviewNegotiation =
  | {
      readonly ok: true;
      readonly selectedVersion: "0.2";
      readonly selectedWebSocketSubprotocol: "mosaic.local-preview.v0.2";
    }
  | {
      readonly ok: false;
      readonly selectedVersion: null;
      readonly selectedWebSocketSubprotocol: null;
      readonly diagnostic: MosaicLocalPreviewNegotiationDiagnostic;
    };
export type MosaicLocalPreviewDeliveryDecision =
  | { readonly delivery: "send" }
  | {
      readonly delivery: "withhold";
      readonly diagnostic: MosaicLocalPreviewNegotiationDiagnostic;
    };
export type MosaicPaywallNavigationState = {
  readonly currentScreenId: string;
  readonly history: readonly string[];
};
export type MosaicPaywallRuntimeDiagnostic =
  | {
      readonly code: "purchase.hiddenProductSelector";
      readonly componentId: string;
      readonly productSelectorId: string;
      readonly behavior: "disablePurchase";
      readonly message: string;
    }
  | {
      readonly code: "navigation.noBackTarget";
      readonly componentId?: string;
      readonly screenId?: string;
      readonly behavior: "noOp";
      readonly message: string;
    };
export type MosaicProductTemplateResolution =
  | { readonly available: true; readonly value: string; readonly diagnostic: null }
  | {
      readonly available: false;
      readonly value: null;
      readonly diagnostic: "invalidTemplate" | "missingName" | "missingPrice";
    };
export type MosaicPaywallV02RC2Candidate = Readonly<Record<string, unknown>> & {
  readonly schemaVersion: "0.2";
};
export type MosaicV02RC2MigrationDiagnostic = {
  readonly code: "migration.reviewRequired";
  readonly severity: "reviewRequired";
  readonly selectorId: string;
  readonly field: string;
  readonly message: string;
};
export type MosaicV02RC2MigrationResult = {
  readonly document: MosaicPaywallV02Document;
  readonly diagnostics: readonly MosaicV02RC2MigrationDiagnostic[];
};
export type MosaicPaywallV02RC3Candidate = Readonly<Record<string, unknown>> & {
  readonly schemaVersion: "0.2";
};
export type MosaicV02RC3MigrationResult = {
  readonly document: MosaicPaywallV02Document;
  readonly diagnostics: readonly [];
};

export type MosaicValidationResult<T> =
  | { readonly ok: true; readonly value: T; readonly diagnostics: readonly [] }
  | {
      readonly ok: false;
      readonly value: null;
      readonly diagnostics: readonly MosaicContractDiagnostic[];
    };

export declare const localPreviewContractVersion: "0.2";
export declare const localPreviewWebSocketProtocol: "mosaic.local-preview.v0.2";
export declare const localPreviewContractVersions: readonly ["0.2"];
export declare const localPreviewVersionPreference: readonly ["0.2"];
export declare const localPreviewWebSocketProtocols: Readonly<{
  "0.2": "mosaic.local-preview.v0.2";
}>;
export declare const previewMessageTypes: readonly MosaicPreviewMessage["type"][];
export declare const previewMessageTypesByVersion: Readonly<{
  "0.2": readonly MosaicPreviewV02Message["type"][];
}>;
export declare const requiredPreviewCapabilities: readonly MosaicPreviewCapabilityName[];
export declare const canonicalSchemas: Readonly<{
  paywall: Readonly<Record<string, unknown>>;
  previewMessage: Readonly<Record<string, unknown>>;
  localProject: Readonly<Record<string, unknown>>;
}>;
export declare const canonicalSchemasByVersion: Readonly<{
  "0.2": Readonly<{
    paywall: Readonly<Record<string, unknown>>;
    previewMessage: Readonly<Record<string, unknown>>;
    localProject: Readonly<Record<string, unknown>>;
  }>;
}>;

export declare function negotiateLocalPreviewVersion(
  localSupportedVersions: readonly string[],
  remoteSupportedVersions: readonly string[],
): MosaicLocalPreviewNegotiation;

export declare function decideLocalPreviewDraftDelivery(options?: {
  readonly capabilityReport?: MosaicPreviewCapabilityReportPayload | MosaicPreviewV02CapabilityReportPayload;
  readonly document?: MosaicAnyPaywallDocument;
  readonly negotiation?: MosaicLocalPreviewNegotiation;
}): MosaicLocalPreviewDeliveryDecision;

export declare function migrateV02RC2CandidateToRC3(
  document: MosaicPaywallV02RC2Candidate,
): MosaicV02RC2MigrationResult;

export declare function migrateV02RC3CandidateToRC4(
  document: MosaicPaywallV02RC3Candidate,
): MosaicV02RC3MigrationResult;

export declare function resolveColorToken(
  document: MosaicPaywallV02Document,
  color: MosaicPaywallV02Color,
): Exclude<MosaicPaywallV02Color, { readonly type: "colorToken" }> | null;

export declare function resolveBackgroundToken(
  document: MosaicPaywallV02Document,
  background: MosaicPaywallV02Background,
): Exclude<MosaicPaywallV02Background, { readonly type: "backgroundToken" }> | null;

export declare function resolveShadowToken(
  document: MosaicPaywallV02Document,
  shadow: MosaicPaywallV02Shadow,
): Exclude<MosaicPaywallV02Shadow, { readonly type: "shadowToken" }> | null;

export declare function resolveAxisSizing(
  value: MosaicPaywallV02AxisSizingValue,
  options?: {
    readonly axis?: "width" | "height";
    readonly bounded?: boolean;
    readonly componentId?: string | null;
  },
): {
  readonly value: MosaicPaywallV02AxisSizingValue;
  readonly diagnostic: null | {
    readonly code: "layout.unboundedFill";
    readonly componentId: string | null;
    readonly axis: "width" | "height";
    readonly behavior: "useFit";
    readonly message: string;
  };
};

export declare function resolveMediaBackgroundFallback(
  document: MosaicPaywallV02Document,
  background: MosaicPaywallV02Background,
  availableAssetIds: readonly string[],
): {
  readonly background: MosaicPaywallV02Background | null;
  readonly diagnostic: null | Readonly<{
    code: "background.videoUnavailable" | "background.imageUnavailable";
    assetId: string;
    behavior: "usePoster" | "useFallbackColor";
    message: string;
  }>;
};

export declare function resolveProductCardStyle(
  productCard: MosaicPaywallV02ProductCardComponent,
  selected: boolean,
): MosaicPaywallV02ProductCardDefaultStyle;

export declare function resolveProductBadgeStyle(
  productBadge: MosaicPaywallV02ProductBadgeComponent,
  selected: boolean,
): MosaicPaywallV02ProductCardDefaultStyle;

export declare function interpolateProductText(
  value: string,
  product?: {
    readonly name?: string;
    readonly fallbackName?: string;
    readonly price?: string;
  },
): MosaicProductTemplateResolution;

export declare function resolveProductSelectorSelection(
  productSelector: MosaicPaywallV02ProductSelectorComponent,
  availableProductReferenceIds: readonly string[],
  currentProductCardId?: string,
): {
  readonly selectedProductCardId: string | null;
  readonly selectedProductReferenceId: string | null;
  readonly purchaseEnabled: boolean;
  readonly showUnavailableFallback: boolean;
};

export declare function runtimeStateForAcceptedRevision(
  document: MosaicPaywallV02Document,
): {
  readonly switches: Readonly<Record<string, boolean>>;
  readonly carousels: Readonly<Record<string, number>>;
  readonly navigation: MosaicPaywallNavigationState;
  readonly selectedProducts: Readonly<Record<string, string>>;
};

export declare function applyNavigationAction(
  navigationState: MosaicPaywallNavigationState,
  action: MosaicPaywallV02NavigateToAction | MosaicPaywallV02NavigateBackAction,
): {
  readonly state: MosaicPaywallNavigationState;
  readonly diagnostic: MosaicPaywallRuntimeDiagnostic | null;
};

export declare function evaluateVisibility(
  visibility: MosaicPaywallV02Visibility | undefined,
  switchValues?: Readonly<Record<string, boolean>>,
): boolean;

export declare function paywallRuntimeDiagnostics(
  document: MosaicAnyPaywallDocument,
  switchValues?: Readonly<Record<string, boolean>>,
  navigationState?: MosaicPaywallNavigationState,
): readonly MosaicPaywallRuntimeDiagnostic[];

export declare function resolveCountdownState(
  countdown: MosaicPaywallV02CountdownComponent,
  now: Date | string | number,
): {
  readonly completed: boolean;
  readonly remainingMilliseconds: number;
  readonly largestUnit: MosaicPaywallV02CountdownComponent["largestUnit"];
  readonly smallestUnit: MosaicPaywallV02CountdownComponent["smallestUnit"];
  readonly completedText: MosaicPaywallV02CountdownComponent["completedText"];
};

export declare function validatePaywallDocument(
  value: unknown,
): MosaicValidationResult<MosaicAnyPaywallDocument>;

export declare function validatePreviewMessage(
  value: unknown,
  options?: { readonly document?: MosaicAnyPaywallDocument },
): MosaicValidationResult<MosaicAnyPreviewMessage>;

export declare function validateLocalProject(
  value: unknown,
): MosaicValidationResult<MosaicAnyLocalProject>;

export declare function parsePortablePaywallJson(
  source: string,
  options?: { readonly maxDocumentBytes?: number },
): MosaicValidationResult<MosaicAnyPaywallDocument>;

export declare function serializePortablePaywallJson(
  value: unknown,
): MosaicValidationResult<string>;
