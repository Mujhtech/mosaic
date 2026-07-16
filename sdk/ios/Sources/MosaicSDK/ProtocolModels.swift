import Foundation

public let mosaicProtocolVersion = "0.1"

public enum MosaicCapabilityName: String, Codable, CaseIterable, Sendable {
  case verticalLayout = "layout.vertical"
  case text = "component.text"
  case featureList = "component.featureList"
  case productSelector = "component.productSelector"
  case purchaseButton = "component.purchaseButton"
  case restoreButton = "component.restoreButton"
  case closeButton = "component.closeButton"
  case legalText = "component.legalText"
}

public struct MosaicPaywallDocument: Decodable, Sendable, Equatable {
  public let schemaVersion: String
  public let id: String
  public let revision: Int
  public let compatibility: MosaicDocumentCompatibility
  public let layout: MosaicVerticalLayout
}

public struct MosaicDocumentCompatibility: Decodable, Sendable, Equatable {
  public let requiredCapabilities: [MosaicRequiredCapability]
}

public struct MosaicRequiredCapability: Decodable, Sendable, Equatable {
  public let name: MosaicCapabilityName
  public let version: String
}

public enum MosaicLayoutKind: String, Decodable, Sendable {
  case vertical
}

public struct MosaicVerticalLayout: Decodable, Sendable, Equatable {
  public let type: MosaicLayoutKind
  public let id: String
  public let gap: Double
  public let padding: Double
  public let children: [MosaicComponent]
}

public enum MosaicComponentKind: String, Decodable, Sendable {
  case text
  case featureList
  case productSelector
  case purchaseButton
  case restoreButton
  case closeButton
  case legalText
}

public enum MosaicComponent: Decodable, Sendable, Equatable {
  case text(MosaicTextComponent)
  case featureList(MosaicFeatureListComponent)
  case productSelector(MosaicProductSelectorComponent)
  case purchaseButton(MosaicPurchaseButtonComponent)
  case restoreButton(MosaicRestoreButtonComponent)
  case closeButton(MosaicCloseButtonComponent)
  case legalText(MosaicLegalTextComponent)

  public var kind: MosaicComponentKind {
    switch self {
    case .text: .text
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
    switch try container.decode(MosaicComponentKind.self, forKey: .type) {
    case .text:
      self = .text(try MosaicTextComponent(from: decoder))
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
    }
  }
}

public struct MosaicTextComponent: Decodable, Sendable, Equatable {
  public let id: String
  public let value: MosaicLocalizedText
}

public struct MosaicFeatureListComponent: Decodable, Sendable, Equatable {
  public let id: String
  public let items: [MosaicFeatureListItem]
}

public struct MosaicProductSelectorComponent: Decodable, Sendable, Equatable {
  public let id: String
  public let products: [MosaicProductReference]
  public let initiallySelectedProductId: String
}

public struct MosaicPurchaseButtonComponent: Decodable, Sendable, Equatable {
  public let id: String
  public let label: MosaicLocalizedText
}

public struct MosaicRestoreButtonComponent: Decodable, Sendable, Equatable {
  public let id: String
  public let label: MosaicLocalizedText
}

public struct MosaicCloseButtonComponent: Decodable, Sendable, Equatable {
  public let id: String
  public let label: MosaicLocalizedText
}

public struct MosaicLegalTextComponent: Decodable, Sendable, Equatable {
  public let id: String
  public let value: MosaicLocalizedText
}

public struct MosaicLocalizedText: Decodable, Sendable, Equatable {
  public let defaultValue: String
  public let localizationKey: String

  private enum CodingKeys: String, CodingKey {
    case defaultValue = "default"
    case localizationKey
  }
}

public struct MosaicFeatureListItem: Decodable, Sendable, Equatable {
  public let id: String
  public let text: MosaicLocalizedText
}

public struct MosaicProductReference: Decodable, Sendable, Equatable {
  public let productId: String
}
