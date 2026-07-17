// Generated public declarations for protocol/browser/index.js. Do not edit.
import type {
  MosaicLocalProject,
  MosaicLocalProjectV02,
  MosaicPaywallDocument,
  MosaicPaywallV02Document,
  MosaicPaywallV02CountdownComponent,
  MosaicPaywallV02ProductCardDefaultStyle,
  MosaicPaywallV02ProductSelectorComponent,
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
export type MosaicAnyPaywallDocument = MosaicPaywallDocument | MosaicPaywallV02Document;
export type MosaicAnyPreviewMessage = MosaicPreviewMessage | MosaicPreviewV02Message;
export type MosaicAnyLocalProject = MosaicLocalProject | MosaicLocalProjectV02;

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
      readonly selectedVersion: "0.1" | "0.2";
      readonly selectedWebSocketSubprotocol: "mosaic.local-preview.v0.1" | "mosaic.local-preview.v0.2";
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
export type MosaicPaywallRuntimeDiagnostic = {
  readonly code: "purchase.hiddenProductSelector";
  readonly componentId: string;
  readonly productSelectorId: string;
  readonly behavior: "disablePurchase";
  readonly message: string;
};

export type MosaicValidationResult<T> =
  | { readonly ok: true; readonly value: T; readonly diagnostics: readonly [] }
  | {
      readonly ok: false;
      readonly value: null;
      readonly diagnostics: readonly MosaicContractDiagnostic[];
    };

export declare const localPreviewContractVersion: "0.1";
export declare const localPreviewWebSocketProtocol: "mosaic.local-preview.v0.1";
export declare const localPreviewContractVersions: readonly ["0.1", "0.2"];
export declare const localPreviewVersionPreference: readonly ["0.2", "0.1"];
export declare const localPreviewWebSocketProtocols: Readonly<{
  "0.1": "mosaic.local-preview.v0.1";
  "0.2": "mosaic.local-preview.v0.2";
}>;
export declare const previewMessageTypes: readonly MosaicPreviewMessage["type"][];
export declare const previewMessageTypesByVersion: Readonly<{
  "0.1": readonly MosaicPreviewMessage["type"][];
  "0.2": readonly MosaicPreviewV02Message["type"][];
}>;
export declare const requiredPreviewCapabilities: readonly MosaicPreviewCapabilityName[];
export declare const canonicalSchemas: Readonly<{
  paywall: Readonly<Record<string, unknown>>;
  previewMessage: Readonly<Record<string, unknown>>;
  localProject: Readonly<Record<string, unknown>>;
}>;
export declare const canonicalSchemasByVersion: Readonly<{
  "0.1": typeof canonicalSchemas;
  "0.2": Readonly<{
    paywall: Readonly<Record<string, unknown>>;
    previewMessage: Readonly<Record<string, unknown>>;
    localProject: Readonly<Record<string, unknown>>;
    incompatibleClient: Readonly<Record<string, unknown>>;
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

export declare function resolveProductCardStyle(
  productSelector: MosaicPaywallV02ProductSelectorComponent,
  selected: boolean,
): MosaicPaywallV02ProductCardDefaultStyle;

export declare function runtimeStateForAcceptedRevision(
  document: MosaicPaywallV02Document,
): {
  readonly switches: Readonly<Record<string, boolean>>;
  readonly carousels: Readonly<Record<string, number>>;
};

export declare function evaluateVisibility(
  visibility: MosaicPaywallV02Visibility | undefined,
  switchValues?: Readonly<Record<string, boolean>>,
): boolean;

export declare function paywallRuntimeDiagnostics(
  document: MosaicAnyPaywallDocument,
  switchValues?: Readonly<Record<string, boolean>>,
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
