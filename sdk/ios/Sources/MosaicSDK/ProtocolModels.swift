import Foundation

/// Protocol 0.1 remains readable. Protocol 0.2 is the latest renderer contract.
public let mosaicProtocolVersion = "0.1"
public let mosaicProtocolVersionV02 = "0.2"
public let mosaicLatestProtocolVersion = mosaicProtocolVersionV02
public let mosaicSupportedProtocolVersions = [mosaicProtocolVersion, mosaicProtocolVersionV02]
public let mosaicSDKVersion = "0.2.0-dev.1"

public enum MosaicCapabilityName: String, Codable, CaseIterable, Sendable {
  case scrollContainer = "layout.scrollContainer"
  case verticalStack = "layout.verticalStack"
  case stack = "layout.stack"
  case sizing = "layout.sizing"
  case outerInsets = "layout.outerInsets"
  case text = "component.text"
  case image = "component.image"
  case featureList = "component.featureList"
  case productSelector = "component.productSelector"
  case purchaseButton = "component.purchaseButton"
  case restoreButton = "component.restoreButton"
  case closeButton = "component.closeButton"
  case legalText = "component.legalText"
  case carousel = "component.carousel"
  case switchControl = "component.switch"
  case countdown = "component.countdown"
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
  case colors = "style.colors"
  case boxStyle = "style.box"
  case clipping = "style.clipping"
  case typography = "style.typography"
  case productCardStates = "style.productCardStates"
  case staticVisibility = "visibility.static"
  case switchVisibility = "condition.switchVisibility"
}

public enum MosaicCapabilityCatalog {
  public static let v01: [MosaicCapabilityName] = [
    .scrollContainer, .verticalStack, .text, .image, .featureList, .productSelector,
    .purchaseButton, .restoreButton, .closeButton, .legalText, .localizationCatalogs,
    .localizationRTL, .productReferences, .bundledImage, .purchaseAction, .restoreAction,
    .closeAction, .accessibilityMetadata, .assetFallback, .productFallback, .normalizedOutcome,
  ]

  public static let v02: [MosaicCapabilityName] = [
    .scrollContainer, .stack, .sizing, .outerInsets, .text, .image, .featureList,
    .productSelector, .purchaseButton, .restoreButton, .closeButton, .legalText, .carousel,
    .switchControl, .countdown, .localizationCatalogs, .localizationRTL, .productReferences,
    .bundledImage, .purchaseAction, .restoreAction, .closeAction, .accessibilityMetadata,
    .assetFallback, .productFallback, .normalizedOutcome, .colors, .boxStyle, .clipping,
    .typography, .productCardStates, .staticVisibility, .switchVisibility,
  ]
}

public struct MosaicSDKCapabilityReport: Sendable, Equatable {
  public let sdkVersion: String
  public let supportedSchemaVersions: [String]
  public let capabilities: [MosaicRequiredCapability]

  public init(
    sdkVersion: String = mosaicSDKVersion,
    supportedSchemaVersions: [String] = mosaicSupportedProtocolVersions,
    capabilities: [MosaicRequiredCapability] =
      MosaicCapabilityCatalog.v01.map {
        MosaicRequiredCapability(name: $0, version: mosaicProtocolVersion)
      } + MosaicCapabilityCatalog.v02.map {
        MosaicRequiredCapability(name: $0, version: mosaicProtocolVersionV02)
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

public enum MosaicImageAssetType: String, Decodable, Sendable { case image }
public enum MosaicImageSourceType: String, Decodable, Sendable { case bundled }

public struct MosaicBundledImageSource: Decodable, Sendable, Equatable {
  public let type: MosaicImageSourceType
  public let key: String
}

public enum MosaicImageFallbackType: String, Decodable, Sendable { case placeholder }

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

public enum MosaicScrollAxis: String, Decodable, Sendable { case vertical }
public enum MosaicSafeAreaPolicy: String, Decodable, Sendable { case respect }

public struct MosaicScrollContainer: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let axis: MosaicScrollAxis
  public let safeArea: MosaicSafeAreaPolicy
  public let showsIndicators: Bool
  public let background: MosaicColor?
  public let content: MosaicStack
}

public struct MosaicEdgeInsets: Decodable, Sendable, Equatable {
  public let top: Double
  public let start: Double
  public let bottom: Double
  public let end: Double

  public init(top: Double, start: Double, bottom: Double, end: Double) {
    self.top = top
    self.start = start
    self.bottom = bottom
    self.end = end
  }

  public static let zero = MosaicEdgeInsets(top: 0, start: 0, bottom: 0, end: 0)
}

public struct MosaicEdgeInsetsOverride: Decodable, Sendable, Equatable {
  public let top: Double?
  public let start: Double?
  public let bottom: Double?
  public let end: Double?

  public func resolving(_ base: MosaicEdgeInsets) -> MosaicEdgeInsets {
    MosaicEdgeInsets(
      top: top ?? base.top,
      start: start ?? base.start,
      bottom: bottom ?? base.bottom,
      end: end ?? base.end
    )
  }
}

public enum MosaicStackDirection: String, Decodable, Sendable { case vertical, horizontal }
public enum MosaicMainAxisDistribution: String, Decodable, Sendable {
  case start, center, end, spaceBetween
}
public enum MosaicHorizontalAlignment: String, Decodable, Sendable {
  case start, center, end, stretch
}

public struct MosaicStack: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let direction: MosaicStackDirection
  public let gap: Double
  public let padding: MosaicEdgeInsets
  public let mainAxisDistribution: MosaicMainAxisDistribution
  public let crossAxisAlignment: MosaicHorizontalAlignment
  public let appearance: MosaicBoxAppearance?
  public let sizing: MosaicBoxSizing?
  public let outerInsets: MosaicEdgeInsets?
  public let visibility: MosaicVisibility
  public let children: [MosaicNode]

  public var spacing: Double { gap }
  public var horizontalAlignment: MosaicHorizontalAlignment { crossAxisAlignment }

  private enum CodingKeys: String, CodingKey {
    case type, id, direction, gap, spacing, padding, mainAxisDistribution
    case crossAxisAlignment, horizontalAlignment, appearance, sizing, outerInsets, visibility
    case children
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    type = try container.decode(MosaicLayoutNodeKind.self, forKey: .type)
    id = try container.decode(String.self, forKey: .id)
    padding = try container.decode(MosaicEdgeInsets.self, forKey: .padding)
    appearance = try container.decodeIfPresent(MosaicBoxAppearance.self, forKey: .appearance)
    sizing = try container.decodeIfPresent(MosaicBoxSizing.self, forKey: .sizing)
    outerInsets = try container.decodeIfPresent(MosaicEdgeInsets.self, forKey: .outerInsets)
    visibility = try container.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
    children = try container.decode([MosaicNode].self, forKey: .children)
    if type == .verticalStack {
      direction = .vertical
      gap = try container.decode(Double.self, forKey: .spacing)
      mainAxisDistribution = .start
      crossAxisAlignment = try container.decode(
        MosaicHorizontalAlignment.self, forKey: .horizontalAlignment)
    } else {
      direction = try container.decode(MosaicStackDirection.self, forKey: .direction)
      gap = try container.decode(Double.self, forKey: .gap)
      mainAxisDistribution = try container.decode(
        MosaicMainAxisDistribution.self, forKey: .mainAxisDistribution)
      crossAxisAlignment = try container.decode(
        MosaicHorizontalAlignment.self, forKey: .crossAxisAlignment)
    }
  }
}

public typealias MosaicVerticalStack = MosaicStack

public enum MosaicLayoutNodeKind: String, Decodable, Sendable {
  case scrollContainer
  case verticalStack
  case stack
  case text
  case image
  case featureList
  case productSelector
  case purchaseButton
  case restoreButton
  case closeButton
  case legalText
  case carousel
  case switchControl = "switch"
  case countdown
}

public indirect enum MosaicNode: Decodable, Sendable, Equatable, Identifiable {
  case verticalStack(MosaicStack)
  case stack(MosaicStack)
  case text(MosaicTextComponent)
  case image(MosaicImageComponent)
  case featureList(MosaicFeatureListComponent)
  case productSelector(MosaicProductSelectorComponent)
  case purchaseButton(MosaicPurchaseButtonComponent)
  case restoreButton(MosaicRestoreButtonComponent)
  case closeButton(MosaicCloseButtonComponent)
  case legalText(MosaicLegalTextComponent)
  case carousel(MosaicCarouselComponent)
  case switchControl(MosaicSwitchComponent)
  case countdown(MosaicCountdownComponent)

  public var id: String {
    switch self {
    case .verticalStack(let value), .stack(let value): value.id
    case .text(let value): value.id
    case .image(let value): value.id
    case .featureList(let value): value.id
    case .productSelector(let value): value.id
    case .purchaseButton(let value): value.id
    case .restoreButton(let value): value.id
    case .closeButton(let value): value.id
    case .legalText(let value): value.id
    case .carousel(let value): value.id
    case .switchControl(let value): value.id
    case .countdown(let value): value.id
    }
  }

  public var kind: MosaicLayoutNodeKind {
    switch self {
    case .verticalStack: .verticalStack
    case .stack: .stack
    case .text: .text
    case .image: .image
    case .featureList: .featureList
    case .productSelector: .productSelector
    case .purchaseButton: .purchaseButton
    case .restoreButton: .restoreButton
    case .closeButton: .closeButton
    case .legalText: .legalText
    case .carousel: .carousel
    case .switchControl: .switchControl
    case .countdown: .countdown
    }
  }

  private enum CodingKeys: String, CodingKey { case type }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let type = try container.decode(MosaicLayoutNodeKind.self, forKey: .type)
    switch type {
    case .verticalStack: self = .verticalStack(try MosaicStack(from: decoder))
    case .stack: self = .stack(try MosaicStack(from: decoder))
    case .text: self = .text(try MosaicTextComponent(from: decoder))
    case .image: self = .image(try MosaicImageComponent(from: decoder))
    case .featureList: self = .featureList(try MosaicFeatureListComponent(from: decoder))
    case .productSelector:
      self = .productSelector(try MosaicProductSelectorComponent(from: decoder))
    case .purchaseButton:
      self = .purchaseButton(try MosaicPurchaseButtonComponent(from: decoder))
    case .restoreButton:
      self = .restoreButton(try MosaicRestoreButtonComponent(from: decoder))
    case .closeButton: self = .closeButton(try MosaicCloseButtonComponent(from: decoder))
    case .legalText: self = .legalText(try MosaicLegalTextComponent(from: decoder))
    case .carousel: self = .carousel(try MosaicCarouselComponent(from: decoder))
    case .switchControl: self = .switchControl(try MosaicSwitchComponent(from: decoder))
    case .countdown: self = .countdown(try MosaicCountdownComponent(from: decoder))
    case .scrollContainer:
      throw DecodingError.dataCorruptedError(
        forKey: .type, in: container,
        debugDescription: "Nested scroll containers are not supported."
      )
    }
  }
}

public enum MosaicSemanticColor: String, Decodable, Sendable {
  case textPrimary = "text.primary"
  case textSecondary = "text.secondary"
  case surfaceDefault = "surface.default"
  case surfaceElevated = "surface.elevated"
  case actionPrimary = "action.primary"
  case actionOnPrimary = "action.onPrimary"
  case borderDefault = "border.default"
  case transparent
}

public enum MosaicColor: Decodable, Sendable, Equatable {
  case semantic(MosaicSemanticColor)
  case literal(String)

  public var rawValue: String {
    switch self {
    case .semantic(let value): value.rawValue
    case .literal(let value): value
    }
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.singleValueContainer()
    let raw = try container.decode(String.self)
    if let semantic = MosaicSemanticColor(rawValue: raw) {
      self = .semantic(semantic)
    } else {
      self = .literal(raw)
    }
  }
}

public struct MosaicBorder: Decodable, Sendable, Equatable {
  public let color: MosaicColor
  public let width: Double
}

public struct MosaicBorderOverride: Decodable, Sendable, Equatable {
  public let color: MosaicColor?
  public let width: Double?

  public func resolving(_ base: MosaicBorder) -> MosaicBorder {
    MosaicBorder(color: color ?? base.color, width: width ?? base.width)
  }
}

public struct MosaicBoxAppearance: Decodable, Sendable, Equatable {
  public let background: MosaicColor?
  public let border: MosaicBorder?
  public let cornerRadius: Double?
  public let opacity: Double?
  public let padding: MosaicEdgeInsets?
  public let clipContent: Bool?
}

public enum MosaicWidthSizing: Decodable, Sendable, Equatable {
  case content
  case fill
  case fixed(Double)

  private enum CodingKeys: String, CodingKey { case mode, value }

  public init(from decoder: any Decoder) throws {
    if let raw = try? decoder.singleValueContainer().decode(String.self) {
      switch raw {
      case "content": self = .content
      case "fill": self = .fill
      default:
        throw DecodingError.dataCorrupted(
          .init(codingPath: decoder.codingPath, debugDescription: "Invalid width sizing."))
      }
      return
    }
    let container = try decoder.container(keyedBy: CodingKeys.self)
    guard try container.decode(String.self, forKey: .mode) == "fixed" else {
      throw DecodingError.dataCorruptedError(
        forKey: .mode, in: container, debugDescription: "Expected fixed width sizing.")
    }
    self = .fixed(try container.decode(Double.self, forKey: .value))
  }
}

public typealias MosaicImageWidth = MosaicWidthSizing

public enum MosaicHeightSizing: Decodable, Sendable, Equatable {
  case content
  case fixed(Double)

  private enum CodingKeys: String, CodingKey { case mode, value }

  public init(from decoder: any Decoder) throws {
    if let raw = try? decoder.singleValueContainer().decode(String.self), raw == "content" {
      self = .content
      return
    }
    let container = try decoder.container(keyedBy: CodingKeys.self)
    guard try container.decode(String.self, forKey: .mode) == "fixed" else {
      throw DecodingError.dataCorruptedError(
        forKey: .mode, in: container, debugDescription: "Expected fixed height sizing.")
    }
    self = .fixed(try container.decode(Double.self, forKey: .value))
  }
}

public struct MosaicBoxSizing: Decodable, Sendable, Equatable {
  public let width: MosaicWidthSizing?
  public let height: MosaicHeightSizing?
}

public enum MosaicVisibility: Decodable, Sendable, Equatable {
  case always
  case hidden
  case switchValue(switchId: String, equals: Bool)

  private enum CodingKeys: String, CodingKey { case mode, switchId, equals }
  private enum Mode: String, Decodable { case always, hidden, `switch` }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Mode.self, forKey: .mode) {
    case .always: self = .always
    case .hidden: self = .hidden
    case .switch:
      self = .switchValue(
        switchId: try container.decode(String.self, forKey: .switchId),
        equals: try container.decode(Bool.self, forKey: .equals)
      )
    }
  }
}

public enum MosaicTypographyStyle: String, Decodable, Sendable {
  case display, title, heading, body, label, caption
}
public typealias MosaicTextStyle = MosaicTypographyStyle

public enum MosaicFontWeight: String, Decodable, Sendable {
  case regular, medium, semibold, bold
}

public enum MosaicTextAlignment: String, Decodable, Sendable { case start, center, end }
public enum MosaicTextOverflow: String, Decodable, Sendable { case clip, ellipsis }

public struct MosaicTypography: Decodable, Sendable, Equatable {
  public let style: MosaicTypographyStyle
  public let fontSize: Double
  public let lineHeightMultiplier: Double
  public let weight: MosaicFontWeight
  public let color: MosaicColor
  public let alignment: MosaicTextAlignment
  public let maxLines: Int?
  public let overflow: MosaicTextOverflow?

  public init(
    style: MosaicTypographyStyle,
    fontSize: Double,
    lineHeightMultiplier: Double,
    weight: MosaicFontWeight,
    color: MosaicColor,
    alignment: MosaicTextAlignment,
    maxLines: Int? = nil,
    overflow: MosaicTextOverflow? = nil
  ) {
    self.style = style
    self.fontSize = fontSize
    self.lineHeightMultiplier = lineHeightMultiplier
    self.weight = weight
    self.color = color
    self.alignment = alignment
    self.maxLines = maxLines
    self.overflow = overflow
  }

  public static func legacy(
    style: MosaicTypographyStyle, alignment: MosaicTextAlignment
  ) -> MosaicTypography {
    switch style {
    case .display:
      MosaicTypography(style: style, fontSize: 40, lineHeightMultiplier: 1.1, weight: .bold,
        color: .semantic(.textPrimary), alignment: alignment)
    case .title:
      MosaicTypography(style: style, fontSize: 34, lineHeightMultiplier: 1.18, weight: .bold,
        color: .semantic(.textPrimary), alignment: alignment)
    case .heading:
      MosaicTypography(style: style, fontSize: 22, lineHeightMultiplier: 1.25, weight: .semibold,
        color: .semantic(.textPrimary), alignment: alignment)
    case .body:
      MosaicTypography(style: style, fontSize: 17, lineHeightMultiplier: 1.35, weight: .regular,
        color: .semantic(.textPrimary), alignment: alignment)
    case .label:
      MosaicTypography(style: style, fontSize: 16, lineHeightMultiplier: 1.25, weight: .semibold,
        color: .semantic(.textPrimary), alignment: alignment)
    case .caption:
      MosaicTypography(style: style, fontSize: 13, lineHeightMultiplier: 1.3, weight: .regular,
        color: .semantic(.textSecondary), alignment: alignment)
    }
  }
}

public enum MosaicTextAccessibility: Decodable, Sendable, Equatable {
  case text
  case labelledText(MosaicLocalizedText)
  case heading(level: Int)
  case labelledHeading(level: Int, label: MosaicLocalizedText)

  private enum CodingKeys: String, CodingKey { case role, level, label }
  private enum Role: String, Decodable { case text, heading }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let label = try container.decodeIfPresent(MosaicLocalizedText.self, forKey: .label)
    switch try container.decode(Role.self, forKey: .role) {
    case .text:
      self = label.map(Self.labelledText) ?? .text
    case .heading:
      let level = try container.decode(Int.self, forKey: .level)
      self = label.map { .labelledHeading(level: level, label: $0) } ?? .heading(level: level)
    }
  }

  public var label: MosaicLocalizedText? {
    switch self {
    case .text, .heading: nil
    case .labelledText(let label), .labelledHeading(_, let label): label
    }
  }

  public var headingLevel: Int? {
    switch self {
    case .heading(let level), .labelledHeading(let level, _): level
    case .text, .labelledText: nil
    }
  }
}

public struct MosaicTextComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let value: MosaicLocalizedText
  public let typography: MosaicTypography
  public let appearance: MosaicBoxAppearance?
  public let sizing: MosaicBoxSizing?
  public let outerInsets: MosaicEdgeInsets?
  public let visibility: MosaicVisibility
  public let accessibility: MosaicTextAccessibility

  public var style: MosaicTextStyle { typography.style }
  public var alignment: MosaicTextAlignment { typography.alignment }

  private enum CodingKeys: String, CodingKey {
    case type, id, value, style, alignment, typography, appearance, sizing, outerInsets
    case visibility, accessibility
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    type = try container.decode(MosaicLayoutNodeKind.self, forKey: .type)
    id = try container.decode(String.self, forKey: .id)
    value = try container.decode(MosaicLocalizedText.self, forKey: .value)
    if let value = try container.decodeIfPresent(MosaicTypography.self, forKey: .typography) {
      typography = value
    } else {
      typography = .legacy(
        style: try container.decode(MosaicTextStyle.self, forKey: .style),
        alignment: try container.decode(MosaicTextAlignment.self, forKey: .alignment)
      )
    }
    appearance = try container.decodeIfPresent(MosaicBoxAppearance.self, forKey: .appearance)
    sizing = try container.decodeIfPresent(MosaicBoxSizing.self, forKey: .sizing)
    outerInsets = try container.decodeIfPresent(MosaicEdgeInsets.self, forKey: .outerInsets)
    visibility = try container.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
    accessibility = try container.decode(MosaicTextAccessibility.self, forKey: .accessibility)
  }
}

public enum MosaicImageContentMode: String, Decodable, Sendable { case fit, fill }

public enum MosaicImageAccessibility: Decodable, Sendable, Equatable {
  case decorative
  case informative(label: MosaicLocalizedText)

  private enum CodingKeys: String, CodingKey { case hidden, label }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    if try container.decode(Bool.self, forKey: .hidden) {
      self = .decorative
    } else {
      self = .informative(label: try container.decode(MosaicLocalizedText.self, forKey: .label))
    }
  }
}

public struct MosaicImageComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let assetId: String
  public let width: MosaicImageWidth
  public let aspectRatio: Double?
  public let height: Double?
  public let contentMode: MosaicImageContentMode
  public let appearance: MosaicBoxAppearance?
  public let outerInsets: MosaicEdgeInsets?
  public let visibility: MosaicVisibility
  public let accessibility: MosaicImageAccessibility

  private enum CodingKeys: String, CodingKey {
    case type, id, assetId, width, aspectRatio, height, contentMode, appearance, outerInsets
    case visibility, accessibility
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    type = try container.decode(MosaicLayoutNodeKind.self, forKey: .type)
    id = try container.decode(String.self, forKey: .id)
    assetId = try container.decode(String.self, forKey: .assetId)
    width = try container.decode(MosaicImageWidth.self, forKey: .width)
    aspectRatio = try container.decodeIfPresent(Double.self, forKey: .aspectRatio)
    height = try container.decodeIfPresent(Double.self, forKey: .height)
    contentMode = try container.decode(MosaicImageContentMode.self, forKey: .contentMode)
    appearance = try container.decodeIfPresent(MosaicBoxAppearance.self, forKey: .appearance)
    outerInsets = try container.decodeIfPresent(MosaicEdgeInsets.self, forKey: .outerInsets)
    visibility = try container.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
    accessibility = try container.decode(MosaicImageAccessibility.self, forKey: .accessibility)
  }
}

public struct MosaicFeatureListItem: Decodable, Sendable, Equatable, Identifiable {
  public let id: String
  public let text: MosaicLocalizedText
}

public enum MosaicFeatureMarker: String, Decodable, Sendable { case checkmark }

public struct MosaicControlAccessibility: Decodable, Sendable, Equatable {
  public let label: MosaicLocalizedText
  public let hint: MosaicLocalizedText?
}

public struct MosaicFeatureListComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let marker: MosaicFeatureMarker
  public let gap: Double
  public let markerColor: MosaicColor
  public let items: [MosaicFeatureListItem]
  public let typography: MosaicTypography
  public let appearance: MosaicBoxAppearance?
  public let sizing: MosaicBoxSizing?
  public let outerInsets: MosaicEdgeInsets?
  public let visibility: MosaicVisibility
  public let accessibility: MosaicControlAccessibility

  public var itemSpacing: Double { gap }

  private enum CodingKeys: String, CodingKey {
    case type, id, marker, gap, itemSpacing, markerColor, items, typography, appearance, sizing
    case outerInsets, visibility, accessibility
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    type = try container.decode(MosaicLayoutNodeKind.self, forKey: .type)
    id = try container.decode(String.self, forKey: .id)
    marker = try container.decode(MosaicFeatureMarker.self, forKey: .marker)
    gap = try container.decodeIfPresent(Double.self, forKey: .gap)
      ?? container.decode(Double.self, forKey: .itemSpacing)
    markerColor = try container.decodeIfPresent(MosaicColor.self, forKey: .markerColor)
      ?? .semantic(.actionPrimary)
    items = try container.decode([MosaicFeatureListItem].self, forKey: .items)
    typography = try container.decodeIfPresent(MosaicTypography.self, forKey: .typography)
      ?? .legacy(style: .body, alignment: .start)
    appearance = try container.decodeIfPresent(MosaicBoxAppearance.self, forKey: .appearance)
    sizing = try container.decodeIfPresent(MosaicBoxSizing.self, forKey: .sizing)
    outerInsets = try container.decodeIfPresent(MosaicEdgeInsets.self, forKey: .outerInsets)
    visibility = try container.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
    accessibility = try container.decode(MosaicControlAccessibility.self, forKey: .accessibility)
  }
}

public enum MosaicUnavailableProductSelection: String, Decodable, Sendable { case firstAvailable }
public enum MosaicNoAvailableProductBehavior: String, Decodable, Sendable {
  case showMessageAndDisablePurchase
}

public struct MosaicUnavailableProductFallback: Decodable, Sendable, Equatable {
  public let selection: MosaicUnavailableProductSelection
  public let whenNoneAvailable: MosaicNoAvailableProductBehavior
  public let message: MosaicLocalizedText
}

public enum MosaicProductCardContentAlignment: String, Decodable, Sendable {
  case start, center, end, spaceBetween
}

public struct MosaicProductCardBadgeStyle: Decodable, Sendable, Equatable {
  public let background: MosaicColor
  public let textColor: MosaicColor
  public let border: MosaicBorder
  public let cornerRadius: Double
  public let padding: MosaicEdgeInsets
}

public struct MosaicProductCardBadgeStyleOverride: Decodable, Sendable, Equatable {
  public let background: MosaicColor?
  public let textColor: MosaicColor?
  public let border: MosaicBorderOverride?
  public let cornerRadius: Double?
  public let padding: MosaicEdgeInsetsOverride?

  public func resolving(_ base: MosaicProductCardBadgeStyle) -> MosaicProductCardBadgeStyle {
    MosaicProductCardBadgeStyle(
      background: background ?? base.background,
      textColor: textColor ?? base.textColor,
      border: border?.resolving(base.border) ?? base.border,
      cornerRadius: cornerRadius ?? base.cornerRadius,
      padding: padding?.resolving(base.padding) ?? base.padding
    )
  }
}

public struct MosaicProductCardStyle: Decodable, Sendable, Equatable {
  public let background: MosaicColor
  public let border: MosaicBorder
  public let cornerRadius: Double
  public let padding: MosaicEdgeInsets
  public let contentGap: Double
  public let contentAlignment: MosaicProductCardContentAlignment
  public let productLabelColor: MosaicColor
  public let runtimePriceColor: MosaicColor
  public let badge: MosaicProductCardBadgeStyle

  public static let legacy = MosaicProductCardStyle(
    background: .semantic(.surfaceElevated),
    border: MosaicBorder(color: .semantic(.borderDefault), width: 1),
    cornerRadius: 14,
    padding: MosaicEdgeInsets(top: 14, start: 14, bottom: 14, end: 14),
    contentGap: 12,
    contentAlignment: .spaceBetween,
    productLabelColor: .semantic(.textPrimary),
    runtimePriceColor: .semantic(.textPrimary),
    badge: MosaicProductCardBadgeStyle(
      background: .semantic(.surfaceDefault),
      textColor: .semantic(.actionPrimary),
      border: MosaicBorder(color: .semantic(.borderDefault), width: 0),
      cornerRadius: 999,
      padding: MosaicEdgeInsets(top: 3, start: 7, bottom: 3, end: 7)
    )
  )
}

public struct MosaicProductCardStyleOverride: Decodable, Sendable, Equatable {
  public let background: MosaicColor?
  public let border: MosaicBorderOverride?
  public let cornerRadius: Double?
  public let padding: MosaicEdgeInsetsOverride?
  public let contentGap: Double?
  public let contentAlignment: MosaicProductCardContentAlignment?
  public let productLabelColor: MosaicColor?
  public let runtimePriceColor: MosaicColor?
  public let badge: MosaicProductCardBadgeStyleOverride?

  public func resolving(_ base: MosaicProductCardStyle) -> MosaicProductCardStyle {
    MosaicProductCardStyle(
      background: background ?? base.background,
      border: border?.resolving(base.border) ?? base.border,
      cornerRadius: cornerRadius ?? base.cornerRadius,
      padding: padding?.resolving(base.padding) ?? base.padding,
      contentGap: contentGap ?? base.contentGap,
      contentAlignment: contentAlignment ?? base.contentAlignment,
      productLabelColor: productLabelColor ?? base.productLabelColor,
      runtimePriceColor: runtimePriceColor ?? base.runtimePriceColor,
      badge: badge?.resolving(base.badge) ?? base.badge
    )
  }
}

public struct MosaicProductCardStyles: Decodable, Sendable, Equatable {
  public let defaultStyle: MosaicProductCardStyle
  public let selected: MosaicProductCardStyleOverride

  private enum CodingKeys: String, CodingKey { case defaultStyle = "default", selected }

  public static let legacy = MosaicProductCardStyles(
    defaultStyle: .legacy,
    selected: MosaicProductCardStyleOverride(
      background: .semantic(.surfaceDefault),
      border: MosaicBorderOverride(color: .semantic(.actionPrimary), width: 2),
      cornerRadius: nil, padding: nil, contentGap: nil, contentAlignment: nil,
      productLabelColor: nil, runtimePriceColor: nil, badge: nil
    )
  )
}

public struct MosaicProductSelectorComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let productReferenceIds: [String]
  public let initiallySelectedProductReferenceId: String
  public let direction: MosaicStackDirection
  public let gap: Double
  public let cardStyles: MosaicProductCardStyles
  public let appearance: MosaicBoxAppearance?
  public let sizing: MosaicBoxSizing?
  public let outerInsets: MosaicEdgeInsets?
  public let visibility: MosaicVisibility
  public let unavailableFallback: MosaicUnavailableProductFallback
  public let accessibility: MosaicControlAccessibility

  public var itemSpacing: Double { gap }

  private enum CodingKeys: String, CodingKey {
    case type, id, productReferenceIds, initiallySelectedProductReferenceId, direction, gap
    case itemSpacing, cardStyles, appearance, sizing, outerInsets, visibility
    case unavailableFallback, accessibility
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    type = try container.decode(MosaicLayoutNodeKind.self, forKey: .type)
    id = try container.decode(String.self, forKey: .id)
    productReferenceIds = try container.decode([String].self, forKey: .productReferenceIds)
    initiallySelectedProductReferenceId = try container.decode(
      String.self, forKey: .initiallySelectedProductReferenceId)
    direction = try container.decodeIfPresent(MosaicStackDirection.self, forKey: .direction)
      ?? .vertical
    gap = try container.decodeIfPresent(Double.self, forKey: .gap)
      ?? container.decode(Double.self, forKey: .itemSpacing)
    cardStyles = try container.decodeIfPresent(MosaicProductCardStyles.self, forKey: .cardStyles)
      ?? .legacy
    appearance = try container.decodeIfPresent(MosaicBoxAppearance.self, forKey: .appearance)
    sizing = try container.decodeIfPresent(MosaicBoxSizing.self, forKey: .sizing)
    outerInsets = try container.decodeIfPresent(MosaicEdgeInsets.self, forKey: .outerInsets)
    visibility = try container.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
    unavailableFallback = try container.decode(
      MosaicUnavailableProductFallback.self, forKey: .unavailableFallback)
    accessibility = try container.decode(MosaicControlAccessibility.self, forKey: .accessibility)
  }
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

  private enum CodingKeys: String, CodingKey { case type, productSelectorId }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(MosaicActionType.self, forKey: .type) {
    case .purchase:
      self = .purchase(productSelectorId: try container.decode(String.self, forKey: .productSelectorId))
    case .restore: self = .restore
    case .close: self = .close
    }
  }
}

public enum MosaicActionType: String, Decodable, Sendable { case purchase, restore, close }

private protocol MosaicStyledButtonDecoding: Decodable {}

public struct MosaicPurchaseButtonComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let label: MosaicLocalizedText
  public let inProgressLabel: MosaicLocalizedText
  public let typography: MosaicTypography
  public let appearance: MosaicBoxAppearance?
  public let sizing: MosaicBoxSizing?
  public let outerInsets: MosaicEdgeInsets?
  public let visibility: MosaicVisibility
  public let action: MosaicAction
  public let accessibility: MosaicControlAccessibility

  private enum CodingKeys: String, CodingKey {
    case type, id, label, inProgressLabel, typography, appearance, sizing, outerInsets
    case visibility, action, accessibility
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    type = try c.decode(MosaicLayoutNodeKind.self, forKey: .type)
    id = try c.decode(String.self, forKey: .id)
    label = try c.decode(MosaicLocalizedText.self, forKey: .label)
    inProgressLabel = try c.decode(MosaicLocalizedText.self, forKey: .inProgressLabel)
    typography = try c.decodeIfPresent(MosaicTypography.self, forKey: .typography)
      ?? .legacy(style: .label, alignment: .center)
    appearance = try c.decodeIfPresent(MosaicBoxAppearance.self, forKey: .appearance)
    sizing = try c.decodeIfPresent(MosaicBoxSizing.self, forKey: .sizing)
    outerInsets = try c.decodeIfPresent(MosaicEdgeInsets.self, forKey: .outerInsets)
    visibility = try c.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
    action = try c.decode(MosaicAction.self, forKey: .action)
    accessibility = try c.decode(MosaicControlAccessibility.self, forKey: .accessibility)
  }
}

public struct MosaicRestoreButtonComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let label: MosaicLocalizedText
  public let inProgressLabel: MosaicLocalizedText
  public let typography: MosaicTypography
  public let appearance: MosaicBoxAppearance?
  public let sizing: MosaicBoxSizing?
  public let outerInsets: MosaicEdgeInsets?
  public let visibility: MosaicVisibility
  public let action: MosaicAction
  public let accessibility: MosaicControlAccessibility

  private enum CodingKeys: String, CodingKey {
    case type, id, label, inProgressLabel, typography, appearance, sizing, outerInsets
    case visibility, action, accessibility
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    type = try c.decode(MosaicLayoutNodeKind.self, forKey: .type)
    id = try c.decode(String.self, forKey: .id)
    label = try c.decode(MosaicLocalizedText.self, forKey: .label)
    inProgressLabel = try c.decode(MosaicLocalizedText.self, forKey: .inProgressLabel)
    typography = try c.decodeIfPresent(MosaicTypography.self, forKey: .typography)
      ?? .legacy(style: .label, alignment: .center)
    appearance = try c.decodeIfPresent(MosaicBoxAppearance.self, forKey: .appearance)
    sizing = try c.decodeIfPresent(MosaicBoxSizing.self, forKey: .sizing)
    outerInsets = try c.decodeIfPresent(MosaicEdgeInsets.self, forKey: .outerInsets)
    visibility = try c.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
    action = try c.decode(MosaicAction.self, forKey: .action)
    accessibility = try c.decode(MosaicControlAccessibility.self, forKey: .accessibility)
  }
}

public struct MosaicCloseButtonComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let label: MosaicLocalizedText
  public let typography: MosaicTypography
  public let appearance: MosaicBoxAppearance?
  public let sizing: MosaicBoxSizing?
  public let outerInsets: MosaicEdgeInsets?
  public let visibility: MosaicVisibility
  public let action: MosaicAction
  public let accessibility: MosaicControlAccessibility

  private enum CodingKeys: String, CodingKey {
    case type, id, label, typography, appearance, sizing, outerInsets, visibility, action
    case accessibility
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    type = try c.decode(MosaicLayoutNodeKind.self, forKey: .type)
    id = try c.decode(String.self, forKey: .id)
    label = try c.decode(MosaicLocalizedText.self, forKey: .label)
    typography = try c.decodeIfPresent(MosaicTypography.self, forKey: .typography)
      ?? .legacy(style: .label, alignment: .center)
    appearance = try c.decodeIfPresent(MosaicBoxAppearance.self, forKey: .appearance)
    sizing = try c.decodeIfPresent(MosaicBoxSizing.self, forKey: .sizing)
    outerInsets = try c.decodeIfPresent(MosaicEdgeInsets.self, forKey: .outerInsets)
    visibility = try c.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
    action = try c.decode(MosaicAction.self, forKey: .action)
    accessibility = try c.decode(MosaicControlAccessibility.self, forKey: .accessibility)
  }
}

public struct MosaicLegalTextComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let value: MosaicLocalizedText
  public let typography: MosaicTypography
  public let appearance: MosaicBoxAppearance?
  public let sizing: MosaicBoxSizing?
  public let outerInsets: MosaicEdgeInsets?
  public let visibility: MosaicVisibility
  public let accessibility: MosaicTextAccessibility

  public var alignment: MosaicTextAlignment { typography.alignment }

  private enum CodingKeys: String, CodingKey {
    case type, id, value, alignment, typography, appearance, sizing, outerInsets, visibility
    case accessibility
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    type = try c.decode(MosaicLayoutNodeKind.self, forKey: .type)
    id = try c.decode(String.self, forKey: .id)
    value = try c.decode(MosaicLocalizedText.self, forKey: .value)
    if let value = try c.decodeIfPresent(MosaicTypography.self, forKey: .typography) {
      typography = value
    } else {
      typography = .legacy(
        style: .caption,
        alignment: try c.decode(MosaicTextAlignment.self, forKey: .alignment)
      )
    }
    appearance = try c.decodeIfPresent(MosaicBoxAppearance.self, forKey: .appearance)
    sizing = try c.decodeIfPresent(MosaicBoxSizing.self, forKey: .sizing)
    outerInsets = try c.decodeIfPresent(MosaicEdgeInsets.self, forKey: .outerInsets)
    visibility = try c.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
    accessibility = try c.decode(MosaicTextAccessibility.self, forKey: .accessibility)
  }
}

public struct MosaicCarouselPage: Decodable, Sendable, Equatable, Identifiable {
  public let id: String
  public let accessibilityLabel: MosaicLocalizedText
  public let content: MosaicStack
}

public struct MosaicCarouselComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let initialPageIndex: Int
  public let showsIndicators: Bool
  public let pages: [MosaicCarouselPage]
  public let appearance: MosaicBoxAppearance?
  public let sizing: MosaicBoxSizing?
  public let outerInsets: MosaicEdgeInsets?
  public let visibility: MosaicVisibility
  public let accessibility: MosaicControlAccessibility

  private enum CodingKeys: String, CodingKey {
    case type, id, initialPageIndex, showsIndicators, pages, appearance, sizing, outerInsets
    case visibility, accessibility
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    type = try c.decode(MosaicLayoutNodeKind.self, forKey: .type)
    id = try c.decode(String.self, forKey: .id)
    initialPageIndex = try c.decode(Int.self, forKey: .initialPageIndex)
    showsIndicators = try c.decode(Bool.self, forKey: .showsIndicators)
    pages = try c.decode([MosaicCarouselPage].self, forKey: .pages)
    appearance = try c.decodeIfPresent(MosaicBoxAppearance.self, forKey: .appearance)
    sizing = try c.decodeIfPresent(MosaicBoxSizing.self, forKey: .sizing)
    outerInsets = try c.decodeIfPresent(MosaicEdgeInsets.self, forKey: .outerInsets)
    visibility = try c.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
    accessibility = try c.decode(MosaicControlAccessibility.self, forKey: .accessibility)
  }
}

public struct MosaicSwitchComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let label: MosaicLocalizedText
  public let initialValue: Bool
  public let typography: MosaicTypography
  public let offTrackColor: MosaicColor
  public let onTrackColor: MosaicColor
  public let thumbColor: MosaicColor
  public let appearance: MosaicBoxAppearance?
  public let outerInsets: MosaicEdgeInsets?
  public let visibility: MosaicVisibility
  public let accessibility: MosaicControlAccessibility

  private enum CodingKeys: String, CodingKey {
    case type, id, label, initialValue, typography, offTrackColor, onTrackColor, thumbColor
    case appearance, outerInsets, visibility, accessibility
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    type = try c.decode(MosaicLayoutNodeKind.self, forKey: .type)
    id = try c.decode(String.self, forKey: .id)
    label = try c.decode(MosaicLocalizedText.self, forKey: .label)
    initialValue = try c.decode(Bool.self, forKey: .initialValue)
    typography = try c.decode(MosaicTypography.self, forKey: .typography)
    offTrackColor = try c.decode(MosaicColor.self, forKey: .offTrackColor)
    onTrackColor = try c.decode(MosaicColor.self, forKey: .onTrackColor)
    thumbColor = try c.decode(MosaicColor.self, forKey: .thumbColor)
    appearance = try c.decodeIfPresent(MosaicBoxAppearance.self, forKey: .appearance)
    outerInsets = try c.decodeIfPresent(MosaicEdgeInsets.self, forKey: .outerInsets)
    visibility = try c.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
    accessibility = try c.decode(MosaicControlAccessibility.self, forKey: .accessibility)
  }
}

public enum MosaicCountdownUnit: String, Decodable, Sendable, CaseIterable {
  case day, hour, minute, second

  public var rank: Int {
    switch self {
    case .day: 3
    case .hour: 2
    case .minute: 1
    case .second: 0
    }
  }
}

public struct MosaicCountdownComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let endsAt: String
  public let largestUnit: MosaicCountdownUnit
  public let smallestUnit: MosaicCountdownUnit
  public let completedText: MosaicLocalizedText
  public let typography: MosaicTypography
  public let appearance: MosaicBoxAppearance?
  public let sizing: MosaicBoxSizing?
  public let outerInsets: MosaicEdgeInsets?
  public let visibility: MosaicVisibility
  public let accessibility: MosaicTextAccessibility

  private enum CodingKeys: String, CodingKey {
    case type, id, endsAt, largestUnit, smallestUnit, completedText, typography, appearance
    case sizing, outerInsets, visibility, accessibility
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    type = try c.decode(MosaicLayoutNodeKind.self, forKey: .type)
    id = try c.decode(String.self, forKey: .id)
    endsAt = try c.decode(String.self, forKey: .endsAt)
    largestUnit = try c.decode(MosaicCountdownUnit.self, forKey: .largestUnit)
    smallestUnit = try c.decode(MosaicCountdownUnit.self, forKey: .smallestUnit)
    completedText = try c.decode(MosaicLocalizedText.self, forKey: .completedText)
    typography = try c.decode(MosaicTypography.self, forKey: .typography)
    appearance = try c.decodeIfPresent(MosaicBoxAppearance.self, forKey: .appearance)
    sizing = try c.decodeIfPresent(MosaicBoxSizing.self, forKey: .sizing)
    outerInsets = try c.decodeIfPresent(MosaicEdgeInsets.self, forKey: .outerInsets)
    visibility = try c.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
    accessibility = try c.decode(MosaicTextAccessibility.self, forKey: .accessibility)
  }
}
