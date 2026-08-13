import type {
  MosaicAnyLocalProject,
  MosaicPaywallV04AppearMotion,
  MosaicPaywallV04Asset,
  MosaicPaywallV04AwardComponent,
  MosaicPaywallV04AwardEmblem,
  MosaicPaywallV04AxisSizingValue,
  MosaicPaywallV04Background,
  MosaicPaywallV04BaseTypography,
  MosaicPaywallV04BoxSizing,
  MosaicPaywallV04ButtonAction,
  MosaicPaywallV04ButtonComponent,
  MosaicPaywallV04ButtonMotion,
  MosaicPaywallV04CarouselComponent,
  MosaicPaywallV04Color,
  MosaicPaywallV04ControlAccessibility,
  MosaicPaywallV04CountdownComponent,
  MosaicPaywallV04DesignSystem,
  MosaicPaywallV04Document,
  MosaicPaywallV04DocumentCompatibility,
  MosaicPaywallV04EdgeInsets,
  MosaicPaywallV04FeatureListComponent,
  MosaicPaywallV04FeatureListItem,
  MosaicPaywallV04IconComponent,
  MosaicPaywallV04IconName,
  MosaicPaywallV04ImageAsset,
  MosaicPaywallV04ImageComponent,
  MosaicPaywallV04InlineMotion,
  MosaicPaywallV04LocaleCatalog,
  MosaicPaywallV04Localization,
  MosaicPaywallV04LocalizedText,
  MosaicPaywallV04LoopMotion,
  MosaicPaywallV04Marker,
  MosaicPaywallV04Motion,
  MosaicPaywallV04MotionEasing,
  MosaicPaywallV04MotionToken,
  MosaicPaywallV04Node,
  MosaicPaywallV04NodeMotion,
  MosaicPaywallV04ProductBadgeComponent,
  MosaicPaywallV04ProductCardComponent,
  MosaicPaywallV04ProductReference,
  MosaicPaywallV04ProductSelectorComponent,
  MosaicPaywallV04RequiredCapability,
  MosaicPaywallV04Screen,
  MosaicPaywallV04SelectableMotion,
  MosaicPaywallV04SelectionMotion,
  MosaicPaywallV04SelectionStateStyle,
  MosaicPaywallV04SelectionStateStyleOverride,
  MosaicPaywallV04SelectionStyles,
  MosaicPaywallV04Shadow,
  MosaicPaywallV04SocialProofAvatar,
  MosaicPaywallV04SocialProofComponent,
  MosaicPaywallV04SocialProofRating,
  MosaicPaywallV04Stack,
  MosaicPaywallV04SwitchComponent,
  MosaicPaywallV04TabsComponent,
  MosaicPaywallV04TabsEntry,
  MosaicPaywallV04TextAccessibility,
  MosaicPaywallV04TextAlignment,
  MosaicPaywallV04TextComponent,
  MosaicPaywallV04TimelineComponent,
  MosaicPaywallV04TimelineConnector,
  MosaicPaywallV04TimelineEntry,
  MosaicPaywallV04TimelineMarker,
  MosaicPaywallV04Visibility,
  MosaicPreviewV04LocalRevision,
  MosaicPreviewV04MockCommerceState,
  MosaicPreviewV04MockProduct,
} from "@/lib/mosaic-protocol";

export type TextDirection = MosaicPaywallV04LocaleCatalog["direction"];
export type TextAlignment = MosaicPaywallV04TextAlignment;
export type HorizontalAlignment = MosaicPaywallV04Stack["crossAxisAlignment"];
export type TextStyle = MosaicPaywallV04TextComponent["typography"]["style"];
export type LocalizedText = MosaicPaywallV04LocalizedText;
export type LocaleCatalog = MosaicPaywallV04LocaleCatalog;
export type DocumentLocalization = MosaicPaywallV04Localization;
export type RequiredCapability = MosaicPaywallV04RequiredCapability;
export type DocumentCompatibility = MosaicPaywallV04DocumentCompatibility;
export type EdgeInsets = MosaicPaywallV04EdgeInsets;
export type TextAccessibility = MosaicPaywallV04TextAccessibility;
export type ControlAccessibility = MosaicPaywallV04ControlAccessibility;
export type TextComponent = MosaicPaywallV04TextComponent;
export type ImageComponent = MosaicPaywallV04ImageComponent;
export type IconComponent = MosaicPaywallV04IconComponent;
export type IconName = MosaicPaywallV04IconName;
export type FeatureListItem = MosaicPaywallV04FeatureListItem;
export type FeatureListComponent = MosaicPaywallV04FeatureListComponent;
export type ProductCardComponent = MosaicPaywallV04ProductCardComponent;
export type ProductBadgeComponent = MosaicPaywallV04ProductBadgeComponent;
export type ProductSelectorComponent = MosaicPaywallV04ProductSelectorComponent;
export type ButtonComponent = MosaicPaywallV04ButtonComponent;
export type ButtonAction = MosaicPaywallV04ButtonAction;
export type Screen = MosaicPaywallV04Screen;
export type StackComponent = MosaicPaywallV04Stack;
export type VerticalStackComponent = MosaicPaywallV04Stack;
export type CarouselComponent = MosaicPaywallV04CarouselComponent;
export type SwitchComponent = MosaicPaywallV04SwitchComponent;
export type CountdownComponent = MosaicPaywallV04CountdownComponent;
export type TabsComponent = MosaicPaywallV04TabsComponent;
export type TabsEntry = MosaicPaywallV04TabsEntry;
export type TimelineComponent = MosaicPaywallV04TimelineComponent;
export type TimelineEntry = MosaicPaywallV04TimelineEntry;
export type TimelineMarker = MosaicPaywallV04TimelineMarker;
export type TimelineConnector = MosaicPaywallV04TimelineConnector;
export type AwardComponent = MosaicPaywallV04AwardComponent;
export type AwardEmblem = MosaicPaywallV04AwardEmblem;
export type SocialProofComponent = MosaicPaywallV04SocialProofComponent;
export type SocialProofRating = MosaicPaywallV04SocialProofRating;
export type SocialProofAvatar = MosaicPaywallV04SocialProofAvatar;
export type BaseTypography = MosaicPaywallV04BaseTypography;
export type SelectionStyles = MosaicPaywallV04SelectionStyles;
export type SelectionStateStyle = MosaicPaywallV04SelectionStateStyle;
export type SelectionStateStyleOverride =
  MosaicPaywallV04SelectionStateStyleOverride;
export type Visibility = MosaicPaywallV04Visibility;
export type ProtocolColor = MosaicPaywallV04Color;
export type ProtocolBackground = MosaicPaywallV04Background;
export type ProtocolShadow = MosaicPaywallV04Shadow;
export type BoxSizing = MosaicPaywallV04BoxSizing;
export type AxisSizing = MosaicPaywallV04AxisSizingValue;
export type PaywallDesignSystem = MosaicPaywallV04DesignSystem;
export type ProtocolNode =
  | MosaicPaywallV04Node
  | MosaicPaywallV04ProductCardComponent
  | MosaicPaywallV04ProductBadgeComponent;
export type DocumentNode = MosaicPaywallV04Node;
export type ProductReference = MosaicPaywallV04ProductReference;
export type ImageAsset = MosaicPaywallV04ImageAsset;
export type Asset = MosaicPaywallV04Asset;
export type MosaicDocument = MosaicPaywallV04Document;

// Product Card and Product Badge are structural layers created only inside a
// Product Selector/Card. They intentionally stay out of the global catalogue.
export type InsertableBlockType = MosaicPaywallV04Node["type"];

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

export type LocalRevision = MosaicPreviewV04LocalRevision;
export type MockProductDefinition = MosaicPreviewV04MockProduct;
export type MockCommerceState = MosaicPreviewV04MockCommerceState;

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

export type MotionToken = MosaicPaywallV04MotionToken;
export type MotionEasing = MosaicPaywallV04MotionEasing;
export type MotionValue = MosaicPaywallV04Motion;
export type InlineMotion = MosaicPaywallV04InlineMotion;
export type NodeMotion = MosaicPaywallV04NodeMotion;
export type ButtonMotion = MosaicPaywallV04ButtonMotion;
export type SelectableMotion = MosaicPaywallV04SelectableMotion;
export type AppearMotion = MosaicPaywallV04AppearMotion;
export type SelectionMotion = MosaicPaywallV04SelectionMotion;
export type LoopMotion = MosaicPaywallV04LoopMotion;
/**
 * Every motion trigger a node can carry, in one shape.
 *
 * The contract splits this three ways by node type -- `NodeMotion` has only
 * `appear`, `ButtonMotion` adds `loop`, `SelectableMotion` adds `selection` --
 * which is exactly right for a renderer reading one node. An authoring surface
 * offers all three and gates them by node type, so it reads through this shape
 * and writes back a value the node's own type accepts.
 */
export interface AuthoredNodeMotion {
  readonly appear?: MosaicPaywallV04AppearMotion;
  readonly loop?: MosaicPaywallV04LoopMotion;
  readonly selection?: MosaicPaywallV04SelectionMotion;
}

/** The 0.4 marker union, shared by Feature List and Timeline. */
export type Marker = MosaicPaywallV04Marker;

export type LocalProjectFile = MosaicAnyLocalProject;
