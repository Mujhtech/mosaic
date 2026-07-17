import Foundation

public let mosaicProtocolVersion = "0.1"
public let mosaicSDKVersion = "0.1.0-dev.2"

public enum MosaicCapabilityName: String, Codable, CaseIterable, Sendable {
  case scrollContainer = "layout.scrollContainer"
  case verticalStack = "layout.verticalStack"
  case text = "component.text"
  case image = "component.image"
  case featureList = "component.featureList"
  case productSelector = "component.productSelector"
  case purchaseButton = "component.purchaseButton"
  case restoreButton = "component.restoreButton"
  case closeButton = "component.closeButton"
  case legalText = "component.legalText"
  case localizationCatalogs = "localization.catalogs"
  case localizationRTL = "localization.rtl"
  case productReferences = "product.references"
  case bundledImage = "asset.bundledImage"
  case purchaseAction = "action.purchase"
  case restoreAction = "action.restore"
  case closeAction = "action.close"
  case accessibilityMetadata = "accessibility.metadata"
  case assetFallback = "fallback.asset"
  case productFallback = "fallback.product"
  case normalizedOutcome = "outcome.normalized"
}

public struct MosaicSDKCapabilityReport: Sendable, Equatable {
  public let sdkVersion: String
  public let supportedSchemaVersions: [String]
  public let capabilities: [MosaicRequiredCapability]

  public init(
    sdkVersion: String = mosaicSDKVersion,
    supportedSchemaVersions: [String] = [mosaicProtocolVersion],
    capabilities: [MosaicRequiredCapability] = MosaicCapabilityName.allCases.map {
      MosaicRequiredCapability(name: $0, version: mosaicProtocolVersion)
    }
  ) {
    self.sdkVersion = sdkVersion
    self.supportedSchemaVersions = supportedSchemaVersions
    self.capabilities = capabilities
  }

  public static let current = MosaicSDKCapabilityReport()
}

public struct MosaicPaywallDocument: Decodable, Sendable, Equatable {
  public let schemaVersion: String
  public let id: String
  public let revision: Int
  public let compatibility: MosaicDocumentCompatibility
  public let localization: MosaicLocalization
  public let assets: [MosaicImageAsset]
  public let products: [MosaicProductReference]
  public let layout: MosaicScrollContainer
}

public struct MosaicDocumentCompatibility: Decodable, Sendable, Equatable {
  public let requiredCapabilities: [MosaicRequiredCapability]
}

public struct MosaicRequiredCapability: Codable, Sendable, Equatable, Hashable {
  public let name: MosaicCapabilityName
  public let version: String

  public init(name: MosaicCapabilityName, version: String) {
    self.name = name
    self.version = version
  }
}

public struct MosaicLocalization: Decodable, Sendable, Equatable {
  public let defaultLocale: String
  public let fallbackLocale: String
  public let locales: [String: MosaicLocaleCatalog]
}

public enum MosaicLayoutDirection: String, Decodable, Sendable {
  case leftToRight = "ltr"
  case rightToLeft = "rtl"
}

public struct MosaicLocaleCatalog: Decodable, Sendable, Equatable {
  public let direction: MosaicLayoutDirection
  public let strings: [String: String]
}

public struct MosaicLocalizedText: Decodable, Sendable, Equatable {
  public let defaultValue: String
  public let localizationKey: String

  private enum CodingKeys: String, CodingKey {
    case defaultValue = "default"
    case localizationKey
  }
}

public enum MosaicImageAssetType: String, Decodable, Sendable {
  case image
}

public enum MosaicImageSourceType: String, Decodable, Sendable {
  case bundled
}

public struct MosaicBundledImageSource: Decodable, Sendable, Equatable {
  public let type: MosaicImageSourceType
  public let key: String
}

public enum MosaicImageFallbackType: String, Decodable, Sendable {
  case placeholder
}

public struct MosaicImageAssetFallback: Decodable, Sendable, Equatable {
  public let type: MosaicImageFallbackType
  public let value: MosaicLocalizedText
}

public struct MosaicImageAsset: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicImageAssetType
  public let id: String
  public let source: MosaicBundledImageSource
  public let fallback: MosaicImageAssetFallback
}

public struct MosaicProductReference: Decodable, Sendable, Equatable, Identifiable {
  public let id: String
  public let productId: String
  public let label: MosaicLocalizedText
  public let badge: MosaicLocalizedText?
}

public enum MosaicScrollAxis: String, Decodable, Sendable {
  case vertical
}

public enum MosaicSafeAreaPolicy: String, Decodable, Sendable {
  case respect
}

public struct MosaicScrollContainer: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let axis: MosaicScrollAxis
  public let safeArea: MosaicSafeAreaPolicy
  public let showsIndicators: Bool
  public let content: MosaicVerticalStack
}

public struct MosaicEdgeInsets: Decodable, Sendable, Equatable {
  public let top: Double
  public let start: Double
  public let bottom: Double
  public let end: Double
}

public enum MosaicHorizontalAlignment: String, Decodable, Sendable {
  case start
  case center
  case end
  case stretch
}

public struct MosaicVerticalStack: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let spacing: Double
  public let padding: MosaicEdgeInsets
  public let horizontalAlignment: MosaicHorizontalAlignment
  public let children: [MosaicNode]
}

public enum MosaicLayoutNodeKind: String, Decodable, Sendable {
  case scrollContainer
  case verticalStack
  case text
  case image
  case featureList
  case productSelector
  case purchaseButton
  case restoreButton
  case closeButton
  case legalText
}

public indirect enum MosaicNode: Decodable, Sendable, Equatable, Identifiable {
  case verticalStack(MosaicVerticalStack)
  case text(MosaicTextComponent)
  case image(MosaicImageComponent)
  case featureList(MosaicFeatureListComponent)
  case productSelector(MosaicProductSelectorComponent)
  case purchaseButton(MosaicPurchaseButtonComponent)
  case restoreButton(MosaicRestoreButtonComponent)
  case closeButton(MosaicCloseButtonComponent)
  case legalText(MosaicLegalTextComponent)

  public var id: String {
    switch self {
    case .verticalStack(let value): value.id
    case .text(let value): value.id
    case .image(let value): value.id
    case .featureList(let value): value.id
    case .productSelector(let value): value.id
    case .purchaseButton(let value): value.id
    case .restoreButton(let value): value.id
    case .closeButton(let value): value.id
    case .legalText(let value): value.id
    }
  }

  public var kind: MosaicLayoutNodeKind {
    switch self {
    case .verticalStack: .verticalStack
    case .text: .text
    case .image: .image
    case .featureList: .featureList
    case .productSelector: .productSelector
    case .purchaseButton: .purchaseButton
    case .restoreButton: .restoreButton
    case .closeButton: .closeButton
    case .legalText: .legalText
    }
  }

  private enum CodingKeys: String, CodingKey {
    case type
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let type = try container.decode(MosaicLayoutNodeKind.self, forKey: .type)
    switch type {
    case .verticalStack:
      self = .verticalStack(try MosaicVerticalStack(from: decoder))
    case .text:
      self = .text(try MosaicTextComponent(from: decoder))
    case .image:
      self = .image(try MosaicImageComponent(from: decoder))
    case .featureList:
      self = .featureList(try MosaicFeatureListComponent(from: decoder))
    case .productSelector:
      self = .productSelector(try MosaicProductSelectorComponent(from: decoder))
    case .purchaseButton:
      self = .purchaseButton(try MosaicPurchaseButtonComponent(from: decoder))
    case .restoreButton:
      self = .restoreButton(try MosaicRestoreButtonComponent(from: decoder))
    case .closeButton:
      self = .closeButton(try MosaicCloseButtonComponent(from: decoder))
    case .legalText:
      self = .legalText(try MosaicLegalTextComponent(from: decoder))
    case .scrollContainer:
      throw DecodingError.dataCorruptedError(
        forKey: .type,
        in: container,
        debugDescription: "Nested scroll containers are not supported by protocol 0.1."
      )
    }
  }
}

public enum MosaicTextStyle: String, Decodable, Sendable {
  case title
  case body
  case caption
}

public enum MosaicTextAlignment: String, Decodable, Sendable {
  case start
  case center
  case end
}

public enum MosaicTextAccessibility: Decodable, Sendable, Equatable {
  case text
  case heading(level: Int)

  private enum CodingKeys: String, CodingKey {
    case role
    case level
  }

  private enum Role: String, Decodable {
    case text
    case heading
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Role.self, forKey: .role) {
    case .text:
      self = .text
    case .heading:
      self = .heading(level: try container.decode(Int.self, forKey: .level))
    }
  }
}

public struct MosaicTextComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let value: MosaicLocalizedText
  public let style: MosaicTextStyle
  public let alignment: MosaicTextAlignment
  public let accessibility: MosaicTextAccessibility
}

public enum MosaicImageWidth: String, Decodable, Sendable {
  case fill
}

public enum MosaicImageContentMode: String, Decodable, Sendable {
  case fit
  case fill
}

public enum MosaicImageAccessibility: Decodable, Sendable, Equatable {
  case decorative
  case informative(label: MosaicLocalizedText)

  private enum CodingKeys: String, CodingKey {
    case hidden
    case label
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    if try container.decode(Bool.self, forKey: .hidden) {
      self = .decorative
    } else {
      self = .informative(
        label: try container.decode(MosaicLocalizedText.self, forKey: .label)
      )
    }
  }
}

public struct MosaicImageComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let assetId: String
  public let width: MosaicImageWidth
  public let aspectRatio: Double
  public let contentMode: MosaicImageContentMode
  public let accessibility: MosaicImageAccessibility
}

public struct MosaicFeatureListItem: Decodable, Sendable, Equatable, Identifiable {
  public let id: String
  public let text: MosaicLocalizedText
}

public enum MosaicFeatureMarker: String, Decodable, Sendable {
  case checkmark
}

public struct MosaicControlAccessibility: Decodable, Sendable, Equatable {
  public let label: MosaicLocalizedText
  public let hint: MosaicLocalizedText?
}

public struct MosaicFeatureListComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let marker: MosaicFeatureMarker
  public let itemSpacing: Double
  public let items: [MosaicFeatureListItem]
  public let accessibility: MosaicControlAccessibility
}

public enum MosaicUnavailableProductSelection: String, Decodable, Sendable {
  case firstAvailable
}

public enum MosaicNoAvailableProductBehavior: String, Decodable, Sendable {
  case showMessageAndDisablePurchase
}

public struct MosaicUnavailableProductFallback: Decodable, Sendable, Equatable {
  public let selection: MosaicUnavailableProductSelection
  public let whenNoneAvailable: MosaicNoAvailableProductBehavior
  public let message: MosaicLocalizedText
}

public struct MosaicProductSelectorComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let productReferenceIds: [String]
  public let initiallySelectedProductReferenceId: String
  public let itemSpacing: Double
  public let unavailableFallback: MosaicUnavailableProductFallback
  public let accessibility: MosaicControlAccessibility
}

public enum MosaicAction: Decodable, Sendable, Equatable {
  case purchase(productSelectorId: String)
  case restore
  case close

  public var type: MosaicActionType {
    switch self {
    case .purchase: .purchase
    case .restore: .restore
    case .close: .close
    }
  }

  private enum CodingKeys: String, CodingKey {
    case type
    case productSelectorId
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(MosaicActionType.self, forKey: .type) {
    case .purchase:
      self = .purchase(
        productSelectorId: try container.decode(String.self, forKey: .productSelectorId)
      )
    case .restore:
      self = .restore
    case .close:
      self = .close
    }
  }
}

public enum MosaicActionType: String, Decodable, Sendable {
  case purchase
  case restore
  case close
}

public struct MosaicPurchaseButtonComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let label: MosaicLocalizedText
  public let inProgressLabel: MosaicLocalizedText
  public let action: MosaicAction
  public let accessibility: MosaicControlAccessibility
}

public struct MosaicRestoreButtonComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let label: MosaicLocalizedText
  public let inProgressLabel: MosaicLocalizedText
  public let action: MosaicAction
  public let accessibility: MosaicControlAccessibility
}

public struct MosaicCloseButtonComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let label: MosaicLocalizedText
  public let action: MosaicAction
  public let accessibility: MosaicControlAccessibility
}

public struct MosaicLegalTextComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let value: MosaicLocalizedText
  public let alignment: MosaicTextAlignment
  public let accessibility: MosaicTextAccessibility
}
