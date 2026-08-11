// Generated public declarations for protocol/browser/index.js. Do not edit.
import type {
  MosaicConfigurationDeliveryV1,
  MosaicConfigurationDeliveryV2,
  MosaicCommerceConfigurationV1,
  MosaicCommerceConfigurationV2,
  MosaicCommerceProviderV1Record,
  MosaicCommerceProviderV2Record,
  MosaicLocalProject,
  MosaicLocalProjectV03,
  MosaicPaywallDocument,
  MosaicPaywallV03Document,
  MosaicPaywallV03CountdownComponent,
  MosaicPaywallV03AxisSizingValue,
  MosaicPaywallV03Background,
  MosaicPaywallV03Color,
  MosaicPaywallV03NavigateBackAction,
  MosaicPaywallV03NavigateToAction,
  MosaicPaywallV03ProductBadgeComponent,
  MosaicPaywallV03ProductCardComponent,
  MosaicPaywallV03ProductCardDefaultStyle,
  MosaicPaywallV03ProductSelectorComponent,
  MosaicPaywallV03CapabilityName,
  MosaicPaywallV03RequiredCapability,
  MosaicPaywallV03ReservedAccessibilityKey,
  MosaicPaywallV03SocialProofRating,
  MosaicPaywallV03Localization,
  MosaicPaywallV03Node,
  MosaicPaywallV03Shadow,
  MosaicPaywallV03Visibility,
  MosaicPlacementDecisionV1,
  MosaicPreviewCapabilityReportPayload,
  MosaicPreviewCapabilityName,
  MosaicPreviewMessage,
  MosaicPreviewV03CapabilityReportPayload,
  MosaicPreviewV03Message,
  MosaicPreviewValidationDiagnostic,
} from "./generated/contract-types.js";

export * from "./generated/contract-types.js";

export type MosaicContractDiagnostic = MosaicPreviewValidationDiagnostic;
export type MosaicAnyPaywallDocument = MosaicPaywallV03Document;
export type MosaicAnyPreviewMessage = MosaicPreviewV03Message;
export type MosaicAnyLocalProject = MosaicLocalProjectV03;
export type MosaicAnyCommerceProviderRecord =
  | MosaicCommerceProviderV1Record
  | MosaicCommerceProviderV2Record;
export type MosaicAnyCommerceConfiguration =
  | MosaicCommerceConfigurationV1
  | MosaicCommerceConfigurationV2;
export type MosaicAnyPlacementDecision = MosaicPlacementDecisionV1;
export type MosaicAnyConfigurationDelivery =
  | MosaicConfigurationDeliveryV1
  | MosaicConfigurationDeliveryV2;

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
      readonly selectedVersion: "0.3";
      readonly selectedWebSocketSubprotocol: "mosaic.local-preview.v0.3";
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
export type MosaicPaywallSelectionState = {
  readonly switches: Readonly<Record<string, boolean>>;
  readonly tabs: Readonly<Record<string, string>>;
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
export type MosaicValidationResult<T> =
  | { readonly ok: true; readonly value: T; readonly diagnostics: readonly [] }
  | {
      readonly ok: false;
      readonly value: null;
      readonly diagnostics: readonly MosaicContractDiagnostic[];
    };

export declare const localPreviewContractVersion: "0.3";
export declare const localPreviewWebSocketProtocol: "mosaic.local-preview.v0.3";
export declare const localPreviewContractVersions: readonly ["0.3"];
export declare const localPreviewVersionPreference: readonly ["0.3"];
export declare const localPreviewWebSocketProtocols: Readonly<{
  "0.3": "mosaic.local-preview.v0.3";
}>;
export declare const paywallContractVersion: "0.3";
export declare const capabilityNames: readonly MosaicPaywallV03CapabilityName[];
export declare const capabilityByComponentType: Readonly<
  Record<string, MosaicPaywallV03CapabilityName>
>;
export declare const colorFieldNames: readonly string[];
export declare const reservedAccessibilityKeys: Readonly<
  Record<
    MosaicPaywallV03ReservedAccessibilityKey,
    {
      readonly placeholders: readonly string[];
      readonly consumedBy: (
        entries: readonly { readonly node: Record<string, unknown> }[],
      ) => boolean;
      readonly consumer: string;
    }
  >
>;

export declare function usesColor(value: unknown): boolean;

export declare function expectedDocumentCapabilities(
  document: MosaicPaywallV03Document,
): readonly MosaicPaywallV03CapabilityName[];

export declare function requiredCapabilitiesFor(
  document: MosaicPaywallV03Document,
): readonly MosaicPaywallV03RequiredCapability[];

export declare type MosaicPaywallAnnouncement = {
  readonly composition: "separateElements" | "singleElement";
  /** Null by contract: segments are never joined. */
  readonly separator: null;
  readonly container: {
    readonly role: "group" | "list" | "button";
    readonly label: string;
    readonly value: string | null;
    readonly hint: string | null;
  };
  readonly elements: readonly {
    readonly item?: string;
    readonly segment: string;
    readonly text: string;
  }[];
  readonly decorative: readonly string[];
};

export declare function resolvedCatalogStrings(
  localization: MosaicPaywallV03Localization,
  requestedLocale: string,
): Readonly<Record<string, string>>;

export declare function accessibilityAnnouncement(
  node: MosaicPaywallV03Node,
  options: {
    readonly strings: Readonly<Record<string, string>>;
    readonly state?: "idle" | "inProgress" | null;
  },
): MosaicPaywallAnnouncement;

export declare function ratingPoints(
  rating: MosaicPaywallV03SocialProofRating,
): string;
export declare function ratingMaximumPoints(
  rating: MosaicPaywallV03SocialProofRating,
): string;
export declare function resolveRatingAnnouncement(
  rating: MosaicPaywallV03SocialProofRating,
  template: string,
): string;

export declare const previewMessageTypes: readonly MosaicPreviewMessage["type"][];
export declare const previewMessageTypesByVersion: Readonly<{
  "0.3": readonly MosaicPreviewV03Message["type"][];
}>;
export declare const requiredPreviewCapabilities: readonly MosaicPreviewCapabilityName[];
export declare const canonicalSchemas: Readonly<{
  paywall: Readonly<Record<string, unknown>>;
  previewMessage: Readonly<Record<string, unknown>>;
  localProject: Readonly<Record<string, unknown>>;
}>;
export declare const canonicalSchemasByVersion: Readonly<{
  "0.3": Readonly<{
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
  readonly capabilityReport?: MosaicPreviewCapabilityReportPayload | MosaicPreviewV03CapabilityReportPayload;
  readonly document?: MosaicAnyPaywallDocument;
  readonly negotiation?: MosaicLocalPreviewNegotiation;
}): MosaicLocalPreviewDeliveryDecision;

export declare function resolveColorToken(
  document: MosaicPaywallV03Document,
  color: MosaicPaywallV03Color,
): Exclude<MosaicPaywallV03Color, { readonly type: "colorToken" }> | null;

export declare function resolveBackgroundToken(
  document: MosaicPaywallV03Document,
  background: MosaicPaywallV03Background,
): Exclude<MosaicPaywallV03Background, { readonly type: "backgroundToken" }> | null;

export declare function resolveShadowToken(
  document: MosaicPaywallV03Document,
  shadow: MosaicPaywallV03Shadow,
): Exclude<MosaicPaywallV03Shadow, { readonly type: "shadowToken" }> | null;

export declare function resolveAxisSizing(
  value: MosaicPaywallV03AxisSizingValue,
  options?: {
    readonly axis?: "width" | "height";
    readonly bounded?: boolean;
    readonly componentId?: string | null;
  },
): {
  readonly value: MosaicPaywallV03AxisSizingValue;
  readonly diagnostic: null | {
    readonly code: "layout.unboundedFill";
    readonly componentId: string | null;
    readonly axis: "width" | "height";
    readonly behavior: "useFit";
    readonly message: string;
  };
};

export declare function resolveMediaBackgroundFallback(
  document: MosaicPaywallV03Document,
  background: MosaicPaywallV03Background,
  availableAssetIds: readonly string[],
): {
  readonly background: MosaicPaywallV03Background | null;
  readonly diagnostic: null | Readonly<{
    code: "background.videoUnavailable" | "background.imageUnavailable";
    assetId: string;
    behavior: "usePoster" | "useFallbackColor";
    message: string;
  }>;
};

export declare function resolveProductCardStyle(
  productCard: MosaicPaywallV03ProductCardComponent,
  selected: boolean,
): MosaicPaywallV03ProductCardDefaultStyle;

export declare function resolveProductBadgeStyle(
  productBadge: MosaicPaywallV03ProductBadgeComponent,
  selected: boolean,
): MosaicPaywallV03ProductCardDefaultStyle;

export declare function interpolateProductText(
  value: string,
  product?: {
    readonly name?: string;
    readonly fallbackName?: string;
    readonly price?: string;
  },
): MosaicProductTemplateResolution;

export declare function resolveProductSelectorSelection(
  productSelector: MosaicPaywallV03ProductSelectorComponent,
  availableProductReferenceIds: readonly string[],
  currentProductCardId?: string,
): {
  readonly selectedProductCardId: string | null;
  readonly selectedProductReferenceId: string | null;
  readonly purchaseEnabled: boolean;
  readonly showUnavailableFallback: boolean;
};

export declare function runtimeStateForAcceptedRevision(
  document: MosaicPaywallV03Document,
): {
  readonly switches: Readonly<Record<string, boolean>>;
  readonly tabs: Readonly<Record<string, string>>;
  readonly carousels: Readonly<Record<string, number>>;
  readonly navigation: MosaicPaywallNavigationState;
  readonly selectedProducts: Readonly<Record<string, string>>;
};

export declare function applyNavigationAction(
  navigationState: MosaicPaywallNavigationState,
  action: MosaicPaywallV03NavigateToAction | MosaicPaywallV03NavigateBackAction,
): {
  readonly state: MosaicPaywallNavigationState;
  readonly diagnostic: MosaicPaywallRuntimeDiagnostic | null;
};

export declare function evaluateVisibility(
  visibility: MosaicPaywallV03Visibility | undefined,
  selectionState?: Partial<MosaicPaywallSelectionState>,
): boolean;

export declare function paywallRuntimeDiagnostics(
  document: MosaicAnyPaywallDocument,
  selectionState?: MosaicPaywallSelectionState,
  navigationState?: MosaicPaywallNavigationState,
): readonly MosaicPaywallRuntimeDiagnostic[];

export declare function resolveCountdownState(
  countdown: MosaicPaywallV03CountdownComponent,
  now: Date | string | number,
): {
  readonly completed: boolean;
  readonly remainingMilliseconds: number;
  readonly largestUnit: MosaicPaywallV03CountdownComponent["largestUnit"];
  readonly smallestUnit: MosaicPaywallV03CountdownComponent["smallestUnit"];
  readonly completedText: MosaicPaywallV03CountdownComponent["completedText"];
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
