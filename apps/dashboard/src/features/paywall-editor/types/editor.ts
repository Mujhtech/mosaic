import type {
  MosaicLocalProjectV02,
  MosaicPaywallV02Asset,
  MosaicPaywallV02AxisSizingValue,
  MosaicPaywallV02Background,
  MosaicPaywallV02BoxSizing,
  MosaicPaywallV02ButtonAction,
  MosaicPaywallV02ButtonComponent,
  MosaicPaywallV02CarouselComponent,
  MosaicPaywallV02Color,
  MosaicPaywallV02ControlAccessibility,
  MosaicPaywallV02CountdownComponent,
  MosaicPaywallV02DesignSystem,
  MosaicPaywallV02Document,
  MosaicPaywallV02DocumentCompatibility,
  MosaicPaywallV02EdgeInsets,
  MosaicPaywallV02FeatureListComponent,
  MosaicPaywallV02FeatureListItem,
  MosaicPaywallV02IconComponent,
  MosaicPaywallV02IconName,
  MosaicPaywallV02ImageAsset,
  MosaicPaywallV02ImageComponent,
  MosaicPaywallV02LocaleCatalog,
  MosaicPaywallV02Localization,
  MosaicPaywallV02LocalizedText,
  MosaicPaywallV02Node,
  MosaicPaywallV02ProductBadgeComponent,
  MosaicPaywallV02ProductCardComponent,
  MosaicPaywallV02ProductReference,
  MosaicPaywallV02ProductSelectorComponent,
  MosaicPaywallV02RequiredCapability,
  MosaicPaywallV02Screen,
  MosaicPaywallV02Shadow,
  MosaicPaywallV02Stack,
  MosaicPaywallV02SwitchComponent,
  MosaicPaywallV02TextAccessibility,
  MosaicPaywallV02TextAlignment,
  MosaicPaywallV02TextComponent,
  MosaicPaywallV02Visibility,
  MosaicPreviewV02LocalRevision,
  MosaicPreviewV02MockCommerceState,
  MosaicPreviewV02MockProduct,
} from "@/lib/mosaic-protocol";

export type TextDirection = MosaicPaywallV02LocaleCatalog["direction"];
export type TextAlignment = MosaicPaywallV02TextAlignment;
export type HorizontalAlignment = MosaicPaywallV02Stack["crossAxisAlignment"];
export type TextStyle = MosaicPaywallV02TextComponent["typography"]["style"];
export type LocalizedText = MosaicPaywallV02LocalizedText;
export type LocaleCatalog = MosaicPaywallV02LocaleCatalog;
export type DocumentLocalization = MosaicPaywallV02Localization;
export type RequiredCapability = MosaicPaywallV02RequiredCapability;
export type DocumentCompatibility = MosaicPaywallV02DocumentCompatibility;
export type EdgeInsets = MosaicPaywallV02EdgeInsets;
export type TextAccessibility = MosaicPaywallV02TextAccessibility;
export type ControlAccessibility = MosaicPaywallV02ControlAccessibility;
export type TextComponent = MosaicPaywallV02TextComponent;
export type ImageComponent = MosaicPaywallV02ImageComponent;
export type IconComponent = MosaicPaywallV02IconComponent;
export type IconName = MosaicPaywallV02IconName;
export type FeatureListItem = MosaicPaywallV02FeatureListItem;
export type FeatureListComponent = MosaicPaywallV02FeatureListComponent;
export type ProductCardComponent = MosaicPaywallV02ProductCardComponent;
export type ProductBadgeComponent = MosaicPaywallV02ProductBadgeComponent;
export type ProductSelectorComponent = MosaicPaywallV02ProductSelectorComponent;
export type ButtonComponent = MosaicPaywallV02ButtonComponent;
export type ButtonAction = MosaicPaywallV02ButtonAction;
export type Screen = MosaicPaywallV02Screen;
export type StackComponent = MosaicPaywallV02Stack;
export type VerticalStackComponent = MosaicPaywallV02Stack;
export type CarouselComponent = MosaicPaywallV02CarouselComponent;
export type SwitchComponent = MosaicPaywallV02SwitchComponent;
export type CountdownComponent = MosaicPaywallV02CountdownComponent;
export type Visibility = MosaicPaywallV02Visibility;
export type ProtocolColor = MosaicPaywallV02Color;
export type ProtocolBackground = MosaicPaywallV02Background;
export type ProtocolShadow = MosaicPaywallV02Shadow;
export type BoxSizing = MosaicPaywallV02BoxSizing;
export type AxisSizing = MosaicPaywallV02AxisSizingValue;
export type PaywallDesignSystem = MosaicPaywallV02DesignSystem;
export type ProtocolNode =
  | MosaicPaywallV02Node
  | MosaicPaywallV02ProductCardComponent
  | MosaicPaywallV02ProductBadgeComponent;
export type DocumentNode = MosaicPaywallV02Node;
export type ProductReference = MosaicPaywallV02ProductReference;
export type ImageAsset = MosaicPaywallV02ImageAsset;
export type Asset = MosaicPaywallV02Asset;
export type MosaicDocument = MosaicPaywallV02Document;

// Product Card and Product Badge are structural layers created only inside a
// Product Selector/Card. They intentionally stay out of the global catalogue.
export type InsertableBlockType = MosaicPaywallV02Node["type"];

export interface BlockInsertionConfiguration {
  readonly countdownEndsAt?: string;
}

export interface TreeInsertionLocation {
  readonly collection?: "children" | "inProgressChildren" | "cards";
  readonly index: number;
  readonly parentId: string;
}

export type TreeMoveTarget =
  | {
      readonly placement: "before" | "after";
      readonly targetId: string;
    }
  | {
      readonly placement: "inside";
      readonly targetId: string;
      readonly index?: number;
    };

export type TreeOperationKind = "insert" | "move" | "duplicate" | "delete";

export type TreeOperationRejectionReason =
  | "document-unavailable"
  | "transaction-active"
  | "selection-unavailable"
  | "unknown-node"
  | "unknown-target"
  | "unknown-parent"
  | "non-stack-parent"
  | "invalid-index"
  | "configuration-required"
  | "invalid-node"
  | "duplicate-id"
  | "root-immutable"
  | "self-target"
  | "descendant-cycle"
  | "empty-source-stack"
  | "no-op"
  | "sibling-boundary"
  | "indent-target-unavailable"
  | "outdent-boundary";

export interface TreeOperationAccepted {
  readonly document: MosaicDocument;
  readonly index: number;
  readonly nodeId: string;
  readonly operation: TreeOperationKind;
  readonly parentId: string;
  readonly selectionId: string | null;
  readonly status: "accepted";
}

export interface TreeOperationRejected {
  readonly message: string;
  readonly nodeId?: string;
  readonly operation: TreeOperationKind;
  readonly reason: TreeOperationRejectionReason;
  readonly recovery: string;
  readonly status: "rejected";
  readonly targetId?: string;
}

export type TreeOperationResult = TreeOperationAccepted | TreeOperationRejected;

export type PreviewMode = "phone" | "tablet" | "landscape";

export type MockPurchaseState =
  | "productAvailable"
  | "productUnavailable"
  | "purchaseSuccess"
  | "purchaseCancellation"
  | "purchaseFailure"
  | "restoreSuccess"
  | "restoreNoPurchases"
  | "restoreFailure"
  | "alreadyEntitled";

export type LocalRevision = MosaicPreviewV02LocalRevision;
export type MockProductDefinition = MosaicPreviewV02MockProduct;
export type MockCommerceState = MosaicPreviewV02MockCommerceState;

export interface ValidationIssue {
  code: string;
  componentId?: string;
  documentPath: string;
  message: string;
  property?: string;
  recovery: string;
  severity: "error" | "warning";
}

export interface PreviewDiagnostic {
  clientId?: string;
  code: string;
  componentId?: string;
  createdAt: string;
  documentPath?: string;
  id: string;
  message: string;
  property?: string;
  recovery?: string;
  revisionId?: string;
  revisionSequence?: number;
  severity: "info" | "warning" | "error";
}

export interface PreviewClient {
  application: { id: string; displayName: string; version: string };
  clientId: string;
  device: { displayName: string; systemName: string; systemVersion: string };
  displayName: string;
  lastSeenAt: string;
  maxDocumentBytes?: number;
  platform: "flutter" | "ios" | "android" | "unknown";
  previewCapabilities: { name: string; version: string }[];
  renderer: { id: string; version: string };
  sessionId: string;
  supportedCapabilities: { name: string; version: string }[];
  supportedSchemaVersions: string[];
}

export type PreviewConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "unavailable";

export type LocalProjectFile = MosaicLocalProjectV02;
