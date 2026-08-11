import type {
  MosaicAnyLocalProject,
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
  MosaicPaywallV04AppearMotion,
  MosaicPaywallV04AwardComponent,
  MosaicPaywallV04ButtonComponent,
  MosaicPaywallV04ButtonMotion,
  MosaicPaywallV04CarouselComponent,
  MosaicPaywallV04CountdownComponent,
  MosaicPaywallV04DesignSystem,
  MosaicPaywallV04Document,
  MosaicPaywallV04DocumentCompatibility,
  MosaicPaywallV04FeatureListComponent,
  MosaicPaywallV04FeatureListItem,
  MosaicPaywallV04IconComponent,
  MosaicPaywallV04ImageComponent,
  MosaicPaywallV04InlineMotion,
  MosaicPaywallV04LoopMotion,
  MosaicPaywallV04Marker,
  MosaicPaywallV04Motion,
  MosaicPaywallV04MotionEasing,
  MosaicPaywallV04MotionToken,
  MosaicPaywallV04Node,
  MosaicPaywallV04NodeMotion,
  MosaicPaywallV04ProductBadgeComponent,
  MosaicPaywallV04ProductCardComponent,
  MosaicPaywallV04ProductSelectorComponent,
  MosaicPaywallV04RequiredCapability,
  MosaicPaywallV04Screen,
  MosaicPaywallV04SelectableMotion,
  MosaicPaywallV04SelectionMotion,
  MosaicPaywallV04SocialProofComponent,
  MosaicPaywallV04Stack,
  MosaicPaywallV04SwitchComponent,
  MosaicPaywallV04TabsComponent,
  MosaicPaywallV04TabsEntry,
  MosaicPaywallV04TextComponent,
  MosaicPaywallV04TimelineComponent,
  MosaicPaywallV04TimelineMarker,
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
export type RequiredCapability =
  | MosaicPaywallV03RequiredCapability
  | MosaicPaywallV04RequiredCapability;
export type DocumentCompatibility =
  | MosaicPaywallV03DocumentCompatibility
  | MosaicPaywallV04DocumentCompatibility;
export type EdgeInsets = MosaicPaywallV03EdgeInsets;
export type TextAccessibility = MosaicPaywallV03TextAccessibility;
export type ControlAccessibility = MosaicPaywallV03ControlAccessibility;
export type TextComponent =
  | MosaicPaywallV03TextComponent
  | MosaicPaywallV04TextComponent;
export type ImageComponent =
  | MosaicPaywallV03ImageComponent
  | MosaicPaywallV04ImageComponent;
export type IconComponent =
  | MosaicPaywallV03IconComponent
  | MosaicPaywallV04IconComponent;
export type IconName = MosaicPaywallV03IconName;
export type FeatureListItem =
  | MosaicPaywallV03FeatureListItem
  | MosaicPaywallV04FeatureListItem;
export type FeatureListComponent =
  | MosaicPaywallV03FeatureListComponent
  | MosaicPaywallV04FeatureListComponent;
export type ProductCardComponent =
  | MosaicPaywallV03ProductCardComponent
  | MosaicPaywallV04ProductCardComponent;
export type ProductBadgeComponent =
  | MosaicPaywallV03ProductBadgeComponent
  | MosaicPaywallV04ProductBadgeComponent;
export type ProductSelectorComponent =
  | MosaicPaywallV03ProductSelectorComponent
  | MosaicPaywallV04ProductSelectorComponent;
export type ButtonComponent =
  | MosaicPaywallV03ButtonComponent
  | MosaicPaywallV04ButtonComponent;
export type ButtonAction = MosaicPaywallV03ButtonAction;
export type Screen = MosaicPaywallV03Screen | MosaicPaywallV04Screen;
export type StackComponent = MosaicPaywallV03Stack | MosaicPaywallV04Stack;
export type VerticalStackComponent =
  | MosaicPaywallV03Stack
  | MosaicPaywallV04Stack;
export type CarouselComponent =
  | MosaicPaywallV03CarouselComponent
  | MosaicPaywallV04CarouselComponent;
export type SwitchComponent =
  | MosaicPaywallV03SwitchComponent
  | MosaicPaywallV04SwitchComponent;
export type CountdownComponent =
  | MosaicPaywallV03CountdownComponent
  | MosaicPaywallV04CountdownComponent;
export type TabsComponent =
  | MosaicPaywallV03TabsComponent
  | MosaicPaywallV04TabsComponent;
export type TabsEntry = MosaicPaywallV03TabsEntry | MosaicPaywallV04TabsEntry;
export type TimelineComponent =
  | MosaicPaywallV03TimelineComponent
  | MosaicPaywallV04TimelineComponent;
export type TimelineEntry = MosaicPaywallV03TimelineEntry;
export type TimelineMarker =
  | MosaicPaywallV03TimelineMarker
  | MosaicPaywallV04TimelineMarker;
export type TimelineConnector = MosaicPaywallV03TimelineConnector;
export type AwardComponent =
  | MosaicPaywallV03AwardComponent
  | MosaicPaywallV04AwardComponent;
export type AwardEmblem = MosaicPaywallV03AwardEmblem;
export type SocialProofComponent =
  | MosaicPaywallV03SocialProofComponent
  | MosaicPaywallV04SocialProofComponent;
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
export type PaywallDesignSystem =
  | MosaicPaywallV03DesignSystem
  | MosaicPaywallV04DesignSystem;
export type ProtocolNode =
  | MosaicPaywallV03Node
  | MosaicPaywallV03ProductCardComponent
  | MosaicPaywallV03ProductBadgeComponent
  | MosaicPaywallV04Node
  | MosaicPaywallV04ProductCardComponent
  | MosaicPaywallV04ProductBadgeComponent;
export type DocumentNode = MosaicPaywallV03Node | MosaicPaywallV04Node;
export type ProductReference = MosaicPaywallV03ProductReference;
export type ImageAsset = MosaicPaywallV03ImageAsset;
export type Asset = MosaicPaywallV03Asset;
export type MosaicDocument =
  | MosaicPaywallV03Document
  | MosaicPaywallV04Document;

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
