import type {
  MosaicLocalProject,
  MosaicPaywallCloseButtonComponent,
  MosaicPaywallControlAccessibility,
  MosaicPaywallDocument,
  MosaicPaywallDocumentCompatibility,
  MosaicPaywallEdgeInsets,
  MosaicPaywallFeatureListComponent,
  MosaicPaywallFeatureListItem,
  MosaicPaywallImageAsset,
  MosaicPaywallImageComponent,
  MosaicPaywallLegalTextComponent,
  MosaicPaywallLocaleCatalog,
  MosaicPaywallLocalization,
  MosaicPaywallLocalizedText,
  MosaicPaywallNode,
  MosaicPaywallProductReference,
  MosaicPaywallProductSelectorComponent,
  MosaicPaywallPurchaseButtonComponent,
  MosaicPaywallRequiredCapability,
  MosaicPaywallRestoreButtonComponent,
  MosaicPaywallTextAccessibility,
  MosaicPaywallTextAlignment,
  MosaicPaywallTextComponent,
  MosaicPaywallVerticalStack,
  MosaicPreviewLocalRevision,
  MosaicPreviewMockCommerceState,
  MosaicPreviewMockProduct,
} from "@/lib/mosaic-protocol"

export type TextDirection = MosaicPaywallLocaleCatalog["direction"]
export type TextAlignment = MosaicPaywallTextAlignment
export type HorizontalAlignment = MosaicPaywallVerticalStack["horizontalAlignment"]
export type TextStyle = MosaicPaywallTextComponent["style"]
export type LocalizedText = MosaicPaywallLocalizedText
export type LocaleCatalog = MosaicPaywallLocaleCatalog
export type DocumentLocalization = MosaicPaywallLocalization
export type RequiredCapability = MosaicPaywallRequiredCapability
export type DocumentCompatibility = MosaicPaywallDocumentCompatibility
export type EdgeInsets = MosaicPaywallEdgeInsets
export type TextAccessibility = MosaicPaywallTextAccessibility
export type ControlAccessibility = MosaicPaywallControlAccessibility
export type TextComponent = MosaicPaywallTextComponent
export type LegalTextComponent = MosaicPaywallLegalTextComponent
export type ImageComponent = MosaicPaywallImageComponent
export type FeatureListItem = MosaicPaywallFeatureListItem
export type FeatureListComponent = MosaicPaywallFeatureListComponent
export type ProductSelectorComponent = MosaicPaywallProductSelectorComponent
export type PurchaseButtonComponent = MosaicPaywallPurchaseButtonComponent
export type RestoreButtonComponent = MosaicPaywallRestoreButtonComponent
export type CloseButtonComponent = MosaicPaywallCloseButtonComponent
export type VerticalStackComponent = MosaicPaywallVerticalStack
export type ProtocolNode = MosaicPaywallNode
export type ProductReference = MosaicPaywallProductReference
export type ImageAsset = MosaicPaywallImageAsset
export type MosaicDocument = MosaicPaywallDocument

export type InsertableBlockType = Exclude<ProtocolNode["type"], "verticalStack">

export type PreviewMode = "phone" | "tablet" | "landscape"

export type MockPurchaseState =
  | "productAvailable"
  | "productUnavailable"
  | "purchaseSuccess"
  | "purchaseCancellation"
  | "purchaseFailure"
  | "restoreSuccess"
  | "restoreNoPurchases"
  | "restoreFailure"
  | "alreadyEntitled"

export type LocalRevision = MosaicPreviewLocalRevision
export type MockProductDefinition = MosaicPreviewMockProduct
export type MockCommerceState = MosaicPreviewMockCommerceState

export interface ValidationIssue {
  code: string
  message: string
  severity: "error" | "warning"
  componentId?: string
  property?: string
  documentPath: string
  recovery: string
}

export interface PreviewDiagnostic {
  id: string
  severity: "info" | "warning" | "error"
  code: string
  message: string
  clientId?: string
  componentId?: string
  property?: string
  documentPath?: string
  revisionId?: string
  revisionSequence?: number
  recovery?: string
  createdAt: string
}

export interface PreviewClient {
  clientId: string
  sessionId: string
  platform: "flutter" | "ios" | "android" | "unknown"
  displayName: string
  renderer: { id: string; version: string }
  application: { id: string; displayName: string; version: string }
  device: { displayName: string; systemName: string; systemVersion: string }
  supportedSchemaVersions: string[]
  supportedCapabilities: { name: string; version: string }[]
  previewCapabilities: { name: string; version: string }[]
  maxDocumentBytes?: number
  lastSeenAt: string
}

export type PreviewConnectionStatus =
  "idle" | "connecting" | "connected" | "reconnecting" | "disconnected" | "unavailable"

export type LocalProjectFile = MosaicLocalProject
