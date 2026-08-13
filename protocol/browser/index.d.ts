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
  MosaicLocalProjectV04,
  MosaicPaywallDocument,
  MosaicPaywallV03Document,
  MosaicPaywallV04Document,
  MosaicPaywallV04AppearMotion,
  MosaicPaywallV04CapabilityName,
  MosaicPaywallV04LoopMotion,
  MosaicPaywallV04Motion,
  MosaicPaywallV04MotionEasing,
  MosaicPaywallV04SelectionMotion,
  MosaicPaywallV04SelectionStateStyle,
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
  MosaicPreviewV04CapabilityReportPayload,
  MosaicPreviewV04Message,
  MosaicPreviewValidationDiagnostic,
} from "./generated/contract-types.js";

export * from "./generated/contract-types.js";

export type MosaicContractDiagnostic = MosaicPreviewValidationDiagnostic;
/**
 * Every paywall contract version this runtime can read.
 *
 * The 0.4 slice kept this alias at 0.3 on the grounds that widening it "would
 * tell every existing caller that a draft contract is deliverable". That
 * rationale conflated two different ideas under one name, and the reader
 * entry points are where the conflation shows: `validatePaywallDocument` and
 * `parsePortablePaywallJson` now genuinely return either generation, so an
 * alias that says 0.3 is simply a lie about what the function hands back.
 *
 * "Any" means any version the runtime understands, and that is what it now
 * means. What is *deliverable* is a separate question, it is decided by the
 * publishing backend rather than by a TypeScript alias, and no signature here
 * ever meant it. A caller that wants exactly the release candidate keeps
 * `MosaicPaywallDocument`, which stays 0.3 and is the narrow name to reach
 * for. Callers that must handle both narrow on `schemaVersion`; the union is
 * discriminated, so the compiler makes that unavoidable rather than optional.
 */
export type MosaicAnyPaywallDocument =
  | MosaicPaywallV03Document
  | MosaicPaywallV04Document;
export type MosaicAnyPreviewMessage =
  | MosaicPreviewV03Message
  | MosaicPreviewV04Message;
export type MosaicAnyLocalProject =
  | MosaicLocalProjectV03
  | MosaicLocalProjectV04;
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
      readonly ok: true;
      readonly selectedVersion: "0.4";
      readonly selectedWebSocketSubprotocol: "mosaic.local-preview.v0.4";
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
export declare const localPreviewV04ContractVersion: "0.4";
export declare const localPreviewContractVersions: readonly ["0.3", "0.4"];
/** Most preferred first: a 0.4 client renders motion, a 0.3 client still connects. */
export declare const localPreviewVersionPreference: readonly ["0.4", "0.3"];
export declare const localPreviewWebSocketProtocols: Readonly<{
  "0.3": "mosaic.local-preview.v0.3";
  "0.4": "mosaic.local-preview.v0.4";
}>;
export declare const paywallContractVersion: "0.3";

/**
 * Paywall Protocol 0.4 (draft): the motion contract.
 *
 * The reader entry points dispatch on `schemaVersion` and validate a 0.4
 * document against the 0.4 schema and the 0.4 semantic rules. The 0.4 rules
 * are expressed as a delta over the 0.3 ones -- one motion catalog, three
 * motion capabilities, one removed co-derived capability -- rather than as a
 * second copy, so the two versions cannot drift apart while each stays
 * internally consistent.
 */
export declare const paywallV04ContractVersion: "0.4";
export declare const paywallContractVersions: readonly ["0.3", "0.4"];
export declare const paywallSchemasByVersion: Readonly<{
  "0.3": Readonly<Record<string, unknown>>;
  "0.4": Readonly<Record<string, unknown>>;
}>;
export declare const paywallV04CapabilityNames: readonly MosaicPaywallV04CapabilityName[];
export declare const motionCapabilityNames: readonly [
  "motion.appear",
  "motion.selection",
  "motion.loop",
];
/** Normative cubic-bezier control points, in [x1, y1, x2, y2] order. */
export declare const motionEasingControlPoints: Readonly<
  Record<MosaicPaywallV04MotionEasing, readonly [number, number, number, number]>
>;
export declare const motionLoopMinimumDurationMilliseconds: 500;

export declare function easedMotionProgress(
  easing: MosaicPaywallV04MotionEasing,
  fraction: number,
): number;

export declare function resolveMotionToken(
  document: MosaicPaywallV04Document,
  motion: MosaicPaywallV04Motion,
): Exclude<MosaicPaywallV04Motion, { readonly type: "motionToken" }> | null;

export declare function motionCapabilitiesFor(
  document: MosaicPaywallV04Document,
): readonly MosaicPaywallV04CapabilityName[];

export declare type MosaicPaywallAppearFrame = {
  readonly trigger: "appear";
  readonly reducedMotion: boolean;
  readonly complete: boolean;
  readonly progress: number;
  readonly opacity: number;
  /** Always 0 under reduced motion: the contract owns what changes. */
  readonly translateLogicalSize: number;
};
export declare type MosaicPaywallSelectionFrame = {
  readonly trigger: "selection";
  readonly reducedMotion: boolean;
  readonly complete: boolean;
  readonly progress: number;
  readonly style: MosaicPaywallV04SelectionStateStyle;
};
export declare type MosaicPaywallLoopFrame = {
  readonly trigger: "loop";
  readonly reducedMotion: boolean;
  readonly complete: boolean;
  readonly cycle: number;
  readonly cyclePhase: number;
  readonly excursion: number;
  readonly scale: number;
  /** A fraction of the node's resolved static opacity, never an absolute. */
  readonly opacityMultiplier: number;
};

/**
 * The frame a renderer must be showing at an exact elapsed time.
 *
 * Terminal state equals the static rendering exactly, which is what makes the
 * renderWithoutMotion fallback lossless. Throws on a non-integer or negative
 * elapsed time rather than resolving a plausible-looking frame from a clock
 * that cannot be trusted.
 */
export declare function resolveMotionFrame(
  motion: MosaicPaywallV04AppearMotion,
  options: {
    readonly trigger: "appear";
    readonly elapsedMilliseconds: number;
    readonly reducedMotion?: boolean;
  },
): MosaicPaywallAppearFrame;
export declare function resolveMotionFrame(
  motion: MosaicPaywallV04SelectionMotion,
  options: {
    readonly trigger: "selection";
    readonly elapsedMilliseconds: number;
    readonly reducedMotion?: boolean;
    readonly resolvedFrom: MosaicPaywallV04SelectionStateStyle;
    readonly resolvedTo: MosaicPaywallV04SelectionStateStyle;
  },
): MosaicPaywallSelectionFrame;
export declare function resolveMotionFrame(
  motion: MosaicPaywallV04LoopMotion,
  options: {
    readonly trigger: "loop";
    readonly elapsedMilliseconds: number;
    readonly reducedMotion?: boolean;
  },
): MosaicPaywallLoopFrame;
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
  "0.4": readonly MosaicPreviewV04Message["type"][];
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
  "0.4": Readonly<{
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
  readonly capabilityReport?:
    | MosaicPreviewCapabilityReportPayload
    | MosaicPreviewV03CapabilityReportPayload
    | MosaicPreviewV04CapabilityReportPayload;
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

/**
 * The contract version a value claims, defaulting to the release candidate.
 *
 * Anything that is not an explicit 0.4 claim reads as 0.3, so a value with a
 * missing or unknown `schemaVersion` produces exactly the 0.3 diagnostics it
 * produced before 0.4 existed.
 */
export declare function paywallDocumentVersion(value: unknown): "0.3" | "0.4";

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
