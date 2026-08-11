import type {
  MosaicLocalProjectV03,
  MosaicPaywallV03Asset,
  MosaicPaywallV03AwardComponent,
  MosaicPaywallV03AwardEmblem,
  MosaicPaywallV03AxisSizingValue,
  MosaicPaywallV03Background,
  MosaicPaywallV03BaseTypography,
  MosaicPaywallV03BoxSizing,
  MosaicPaywallV03ButtonAction,
  MosaicPaywallV03ButtonComponent,
  MosaicPaywallV03CarouselComponent,
  MosaicPaywallV03Color,
  MosaicPaywallV03ControlAccessibility,
  MosaicPaywallV03CountdownComponent,
  MosaicPaywallV03DesignSystem,
  MosaicPaywallV03Document,
  MosaicPaywallV03DocumentCompatibility,
  MosaicPaywallV03EdgeInsets,
  MosaicPaywallV03FeatureListComponent,
  MosaicPaywallV03FeatureListItem,
  MosaicPaywallV03IconComponent,
  MosaicPaywallV03IconName,
  MosaicPaywallV03ImageAsset,
  MosaicPaywallV03ImageComponent,
  MosaicPaywallV03LocaleCatalog,
  MosaicPaywallV03Localization,
  MosaicPaywallV03LocalizedText,
  MosaicPaywallV03Node,
  MosaicPaywallV03ProductBadgeComponent,
  MosaicPaywallV03ProductCardComponent,
  MosaicPaywallV03ProductReference,
  MosaicPaywallV03ProductSelectorComponent,
  MosaicPaywallV03RequiredCapability,
  MosaicPaywallV03Screen,
  MosaicPaywallV03SelectionStateStyle,
  MosaicPaywallV03SelectionStateStyleOverride,
  MosaicPaywallV03SelectionStyles,
  MosaicPaywallV03Shadow,
  MosaicPaywallV03SocialProofAvatar,
  MosaicPaywallV03SocialProofComponent,
  MosaicPaywallV03SocialProofRating,
  MosaicPaywallV03Stack,
  MosaicPaywallV03SwitchComponent,
  MosaicPaywallV03TabsComponent,
  MosaicPaywallV03TabsEntry,
  MosaicPaywallV03TextAccessibility,
  MosaicPaywallV03TextAlignment,
  MosaicPaywallV03TextComponent,
  MosaicPaywallV03TimelineComponent,
  MosaicPaywallV03TimelineConnector,
  MosaicPaywallV03TimelineEntry,
  MosaicPaywallV03TimelineMarker,
  MosaicPaywallV03Visibility,
  MosaicPreviewV03LocalRevision,
  MosaicPreviewV03MockCommerceState,
  MosaicPreviewV03MockProduct,
} from "@/lib/mosaic-protocol";

export type TextDirection = MosaicPaywallV03LocaleCatalog["direction"];
export type TextAlignment = MosaicPaywallV03TextAlignment;
export type HorizontalAlignment = MosaicPaywallV03Stack["crossAxisAlignment"];
export type TextStyle = MosaicPaywallV03TextComponent["typography"]["style"];
export type LocalizedText = MosaicPaywallV03LocalizedText;
export type LocaleCatalog = MosaicPaywallV03LocaleCatalog;
export type DocumentLocalization = MosaicPaywallV03Localization;
export type RequiredCapability = MosaicPaywallV03RequiredCapability;
export type DocumentCompatibility = MosaicPaywallV03DocumentCompatibility;
export type EdgeInsets = MosaicPaywallV03EdgeInsets;
export type TextAccessibility = MosaicPaywallV03TextAccessibility;
export type ControlAccessibility = MosaicPaywallV03ControlAccessibility;
export type TextComponent = MosaicPaywallV03TextComponent;
export type ImageComponent = MosaicPaywallV03ImageComponent;
export type IconComponent = MosaicPaywallV03IconComponent;
export type IconName = MosaicPaywallV03IconName;
export type FeatureListItem = MosaicPaywallV03FeatureListItem;
export type FeatureListComponent = MosaicPaywallV03FeatureListComponent;
export type ProductCardComponent = MosaicPaywallV03ProductCardComponent;
export type ProductBadgeComponent = MosaicPaywallV03ProductBadgeComponent;
export type ProductSelectorComponent = MosaicPaywallV03ProductSelectorComponent;
export type ButtonComponent = MosaicPaywallV03ButtonComponent;
export type ButtonAction = MosaicPaywallV03ButtonAction;
export type Screen = MosaicPaywallV03Screen;
export type StackComponent = MosaicPaywallV03Stack;
export type VerticalStackComponent = MosaicPaywallV03Stack;
export type CarouselComponent = MosaicPaywallV03CarouselComponent;
export type SwitchComponent = MosaicPaywallV03SwitchComponent;
export type CountdownComponent = MosaicPaywallV03CountdownComponent;
export type TabsComponent = MosaicPaywallV03TabsComponent;
export type TabsEntry = MosaicPaywallV03TabsEntry;
export type TimelineComponent = MosaicPaywallV03TimelineComponent;
export type TimelineEntry = MosaicPaywallV03TimelineEntry;
export type TimelineMarker = MosaicPaywallV03TimelineMarker;
export type TimelineConnector = MosaicPaywallV03TimelineConnector;
export type AwardComponent = MosaicPaywallV03AwardComponent;
export type AwardEmblem = MosaicPaywallV03AwardEmblem;
export type SocialProofComponent = MosaicPaywallV03SocialProofComponent;
export type SocialProofRating = MosaicPaywallV03SocialProofRating;
export type SocialProofAvatar = MosaicPaywallV03SocialProofAvatar;
export type BaseTypography = MosaicPaywallV03BaseTypography;
export type SelectionStyles = MosaicPaywallV03SelectionStyles;
export type SelectionStateStyle = MosaicPaywallV03SelectionStateStyle;
export type SelectionStateStyleOverride =
  MosaicPaywallV03SelectionStateStyleOverride;
export type Visibility = MosaicPaywallV03Visibility;
export type ProtocolColor = MosaicPaywallV03Color;
export type ProtocolBackground = MosaicPaywallV03Background;
export type ProtocolShadow = MosaicPaywallV03Shadow;
export type BoxSizing = MosaicPaywallV03BoxSizing;
export type AxisSizing = MosaicPaywallV03AxisSizingValue;
export type PaywallDesignSystem = MosaicPaywallV03DesignSystem;
export type ProtocolNode =
  | MosaicPaywallV03Node
  | MosaicPaywallV03ProductCardComponent
  | MosaicPaywallV03ProductBadgeComponent;
export type DocumentNode = MosaicPaywallV03Node;
export type ProductReference = MosaicPaywallV03ProductReference;
export type ImageAsset = MosaicPaywallV03ImageAsset;
export type Asset = MosaicPaywallV03Asset;
export type MosaicDocument = MosaicPaywallV03Document;

// Product Card and Product Badge are structural layers created only inside a
// Product Selector/Card. They intentionally stay out of the global catalogue.
export type InsertableBlockType = MosaicPaywallV03Node["type"];

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

export type LocalRevision = MosaicPreviewV03LocalRevision;
export type MockProductDefinition = MosaicPreviewV03MockProduct;
export type MockCommerceState = MosaicPreviewV03MockCommerceState;

export interface ValidationIssue {
  code: string;
  componentId?: string;
  documentPath: string;
  message: string;
  property?: string;
  recovery: string;
  severity: "error" | "warning" | "info";
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

export type LocalProjectFile = MosaicLocalProjectV03;
