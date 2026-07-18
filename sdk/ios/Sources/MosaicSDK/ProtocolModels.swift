import Foundation

/// The single protocol contract supported during pre-release iteration.
public let mosaicProtocolVersion = "0.2"
public let mosaicLatestProtocolVersion = mosaicProtocolVersion
public let mosaicSupportedProtocolVersions = [mosaicProtocolVersion]
public let mosaicSDKVersion = "0.2.0-dev.1"

public enum MosaicCapabilityName: String, Codable, CaseIterable, Sendable {
  case scrollContainer = "layout.scrollContainer"
  case verticalStack = "layout.verticalStack"
  case stack = "layout.stack"
  case sizing = "layout.sizing"
  case heightSizing = "layout.heightSizing"
  case outerInsets = "layout.outerInsets"
  case screens = "navigation.screens"
  case sheets = "navigation.sheets"
  case text = "component.text"
  case image = "component.image"
  case icon = "component.icon"
  case featureList = "component.featureList"
  case productSelector = "component.productSelector"
  case productCard = "component.productCard"
  case productBadge = "component.productBadge"
  case button = "component.button"
  case purchaseButton = "component.purchaseButton"
  case restoreButton = "component.restoreButton"
  case closeButton = "component.closeButton"
  case legalText = "component.legalText"
  case carousel = "component.carousel"
  case switchControl = "component.switch"
  case countdown = "component.countdown"
  case localizationCatalogs = "localization.catalogs"
  case localizationRTL = "localization.rtl"
  case productTemplate = "localization.productTemplate"
  case productReferences = "product.references"
  case bundledImage = "asset.bundledImage"
  case remoteImage = "asset.remoteImage"
  case bundledVideo = "asset.bundledVideo"
  case remoteVideo = "asset.remoteVideo"
  case purchaseAction = "action.purchase"
  case restoreAction = "action.restore"
  case closeAction = "action.close"
  case navigateToAction = "action.navigateTo"
  case navigateBackAction = "action.navigateBack"
  case openExternalURLAction = "action.openExternalUrl"
  case accessibilityMetadata = "accessibility.metadata"
  case assetFallback = "fallback.asset"
  case productFallback = "fallback.product"
  case normalizedOutcome = "outcome.normalized"
  case colors = "style.colors"
  case designTokens = "style.designTokens"
  case gradientBackground = "style.gradientBackground"
  case mediaBackground = "style.mediaBackground"
  case shadow = "style.shadow"
  case boxStyle = "style.box"
  case clipping = "style.clipping"
  case typography = "style.typography"
  case productCardStates = "style.productCardStates"
  case staticVisibility = "visibility.static"
  case switchVisibility = "condition.switchVisibility"
}

public enum MosaicCapabilityCatalog {
  public static let v02: [MosaicCapabilityName] = [
    .scrollContainer, .stack, .sizing, .heightSizing, .outerInsets, .screens, .sheets,
    .text, .image, .icon,
    .featureList, .productSelector, .productCard, .productBadge, .button, .carousel,
    .switchControl, .countdown, .localizationCatalogs, .localizationRTL, .productTemplate,
    .productReferences, .bundledImage, .remoteImage, .bundledVideo, .remoteVideo,
    .purchaseAction, .restoreAction, .closeAction, .navigateToAction, .navigateBackAction,
    .openExternalURLAction, .accessibilityMetadata, .assetFallback, .productFallback,
    .normalizedOutcome, .colors, .designTokens, .gradientBackground, .mediaBackground,
    .shadow, .boxStyle, .clipping, .typography, .productCardStates,
    .staticVisibility, .switchVisibility,
  ]
}

public struct MosaicSDKCapabilityReport: Sendable, Equatable {
  public let sdkVersion: String
  public let supportedSchemaVersions: [String]
  public let capabilities: [MosaicRequiredCapability]

  public init(
    sdkVersion: String = mosaicSDKVersion,
    supportedSchemaVersions: [String] = mosaicSupportedProtocolVersions,
    capabilities: [MosaicRequiredCapability] = MosaicCapabilityCatalog.v02.map {
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
  public let designSystem: MosaicDesignSystem?
  public let assets: [MosaicAsset]
  public let products: [MosaicProductReference]
  /// Projection of the initial screen layout for source compatibility.
  public let layout: MosaicScrollContainer
  public let initialScreenId: String?
  public let screens: [MosaicScreen]

  private enum CodingKeys: String, CodingKey {
    case schemaVersion, id, revision, compatibility, localization, designSystem, assets, products,
      layout
    case initialScreenId, screens
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    schemaVersion = try container.decode(String.self, forKey: .schemaVersion)
    id = try container.decode(String.self, forKey: .id)
    revision = try container.decode(Int.self, forKey: .revision)
    compatibility = try container.decode(MosaicDocumentCompatibility.self, forKey: .compatibility)
    localization = try container.decode(MosaicLocalization.self, forKey: .localization)
    designSystem = try container.decodeIfPresent(MosaicDesignSystem.self, forKey: .designSystem)
    assets = try container.decode([MosaicAsset].self, forKey: .assets)
    products = try container.decode([MosaicProductReference].self, forKey: .products)

    if schemaVersion == mosaicProtocolVersion {
      let decodedScreens = try container.decode([MosaicScreen].self, forKey: .screens)
      let decodedInitialScreenID = try container.decode(String.self, forKey: .initialScreenId)
      guard let fallbackLayout = decodedScreens.first?.layout else {
        throw DecodingError.dataCorruptedError(
          forKey: .screens,
          in: container,
          debugDescription: "Protocol 0.2 requires at least one screen."
        )
      }
      screens = decodedScreens
      initialScreenId = decodedInitialScreenID
      layout = decodedScreens.first { $0.id == decodedInitialScreenID }?.layout ?? fallbackLayout
    } else {
      layout = try container.decode(MosaicScrollContainer.self, forKey: .layout)
      initialScreenId = nil
      screens = []
    }
  }
}

public struct MosaicScreen: Decodable, Sendable, Equatable, Identifiable {
  public let id: String
  public let accessibilityLabel: MosaicLocalizedText?
  public let presentation: MosaicScreenPresentation?
  public let layout: MosaicScrollContainer
}

public enum MosaicScreenPresentationType: String, Decodable, Sendable { case screen, sheet }

public struct MosaicScreenPresentation: Decodable, Sendable, Equatable {
  public let type: MosaicScreenPresentationType
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

public enum MosaicAssetType: String, Decodable, Sendable { case image, video }
public enum MosaicAssetSourceType: String, Decodable, Sendable { case bundled, remote }

public enum MosaicAssetSource: Decodable, Sendable, Equatable {
  case bundled(key: String)
  case remote(url: URL)

  private enum CodingKeys: String, CodingKey { case type, key, url }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(MosaicAssetSourceType.self, forKey: .type) {
    case .bundled: self = .bundled(key: try container.decode(String.self, forKey: .key))
    case .remote: self = .remote(url: try container.decode(URL.self, forKey: .url))
    }
  }

  public var bundledKey: String? {
    guard case .bundled(let key) = self else { return nil }
    return key
  }

  public var remoteURL: URL? {
    guard case .remote(let url) = self else { return nil }
    return url
  }

  /// Compatibility projection. RC4 code should switch on the source kind.
  public var key: String { bundledKey ?? "" }
}

public enum MosaicImageFallbackType: String, Decodable, Sendable { case placeholder }

public struct MosaicImageAssetFallback: Decodable, Sendable, Equatable {
  public let type: MosaicImageFallbackType
  public let value: MosaicLocalizedText
}

public struct MosaicAsset: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicAssetType
  public let id: String
  public let source: MosaicAssetSource
  public let fallback: MosaicImageAssetFallback?
}

public typealias MosaicImageAsset = MosaicAsset

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
  public let background: MosaicBackground?
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
    visibility =
      try container.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
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
  case icon
  case featureList
  case productSelector
  case button
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
  case icon(MosaicIconComponent)
  case featureList(MosaicFeatureListComponent)
  case productSelector(MosaicProductSelectorComponent)
  case button(MosaicButtonComponent)
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
    case .icon(let value): value.id
    case .featureList(let value): value.id
    case .productSelector(let value): value.id
    case .button(let value): value.id
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
    case .icon: .icon
    case .featureList: .featureList
    case .productSelector: .productSelector
    case .button: .button
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
    case .icon: self = .icon(try MosaicIconComponent(from: decoder))
    case .featureList: self = .featureList(try MosaicFeatureListComponent(from: decoder))
    case .productSelector:
      self = .productSelector(try MosaicProductSelectorComponent(from: decoder))
    case .button: self = .button(try MosaicButtonComponent(from: decoder))
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
  case token(String)

  public var rawValue: String {
    switch self {
    case .semantic(let value): value.rawValue
    case .literal(let value): value
    case .token(let id): id
    }
  }

  public init(from decoder: any Decoder) throws {
    if let raw = try? decoder.singleValueContainer().decode(String.self) {
      self = MosaicSemanticColor(rawValue: raw).map(Self.semantic) ?? .literal(raw)
      return
    }
    let container = try decoder.container(keyedBy: TokenCodingKeys.self)
    guard try container.decode(String.self, forKey: .type) == "colorToken" else {
      throw DecodingError.dataCorruptedError(
        forKey: .type, in: container, debugDescription: "Expected colorToken reference.")
    }
    self = .token(try container.decode(String.self, forKey: .id))
  }

  private enum TokenCodingKeys: String, CodingKey { case type, id }
}

public struct MosaicGradientStop: Decodable, Sendable, Equatable {
  public let position: Double
  public let color: MosaicColor
}

public struct MosaicNormalizedPoint: Decodable, Sendable, Equatable {
  public let x: Double
  public let y: Double
}

public enum MosaicBackground: Decodable, Sendable, Equatable {
  case color(MosaicColor)
  case linearGradient(angle: Double, stops: [MosaicGradientStop])
  case radialGradient(center: MosaicNormalizedPoint, radius: Double, stops: [MosaicGradientStop])
  case image(assetId: String, contentMode: MosaicImageContentMode, fallbackColor: MosaicColor)
  case video(
    assetId: String,
    posterAssetId: String?,
    contentMode: MosaicImageContentMode,
    fallbackColor: MosaicColor
  )
  case token(String)

  private enum CodingKeys: String, CodingKey {
    case type, value, angle, stops, center, radius, assetId, posterAssetId, contentMode
    case fallbackColor, id
  }
  private enum Kind: String, Decodable {
    case color, linearGradient, radialGradient, image, video, backgroundToken
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Kind.self, forKey: .type) {
    case .color: self = .color(try container.decode(MosaicColor.self, forKey: .value))
    case .linearGradient:
      self = .linearGradient(
        angle: try container.decode(Double.self, forKey: .angle),
        stops: try container.decode([MosaicGradientStop].self, forKey: .stops))
    case .radialGradient:
      self = .radialGradient(
        center: try container.decode(MosaicNormalizedPoint.self, forKey: .center),
        radius: try container.decode(Double.self, forKey: .radius),
        stops: try container.decode([MosaicGradientStop].self, forKey: .stops))
    case .image:
      self = .image(
        assetId: try container.decode(String.self, forKey: .assetId),
        contentMode: try container.decode(MosaicImageContentMode.self, forKey: .contentMode),
        fallbackColor: try container.decode(MosaicColor.self, forKey: .fallbackColor))
    case .video:
      self = .video(
        assetId: try container.decode(String.self, forKey: .assetId),
        posterAssetId: try container.decodeIfPresent(String.self, forKey: .posterAssetId),
        contentMode: try container.decode(MosaicImageContentMode.self, forKey: .contentMode),
        fallbackColor: try container.decode(MosaicColor.self, forKey: .fallbackColor))
    case .backgroundToken:
      self = .token(try container.decode(String.self, forKey: .id))
    }
  }

  public static func legacy(_ color: MosaicColor) -> MosaicBackground { .color(color) }

  /// Source-compatibility projection for callers that previously inspected a color-only style.
  public var rawValue: String {
    switch self {
    case .color(let color): color.rawValue
    case .token(let id): id
    case .linearGradient: "linearGradient"
    case .radialGradient: "radialGradient"
    case .image: "image"
    case .video: "video"
    }
  }
}

public enum MosaicShadow: Decodable, Sendable, Equatable {
  case value(color: MosaicColor, offsetX: Double, offsetY: Double, blurRadius: Double)
  case token(String)

  private enum CodingKeys: String, CodingKey { case type, color, offsetX, offsetY, blurRadius, id }
  private enum Kind: String, Decodable { case shadow, shadowToken }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Kind.self, forKey: .type) {
    case .shadow:
      self = .value(
        color: try container.decode(MosaicColor.self, forKey: .color),
        offsetX: try container.decode(Double.self, forKey: .offsetX),
        offsetY: try container.decode(Double.self, forKey: .offsetY),
        blurRadius: try container.decode(Double.self, forKey: .blurRadius))
    case .shadowToken: self = .token(try container.decode(String.self, forKey: .id))
    }
  }
}

public struct MosaicColorToken: Decodable, Sendable, Equatable, Identifiable {
  public let id: String
  public let name: String
  public let value: MosaicColor
}

public struct MosaicBackgroundToken: Decodable, Sendable, Equatable, Identifiable {
  public let id: String
  public let name: String
  public let value: MosaicBackground
}

public struct MosaicShadowToken: Decodable, Sendable, Equatable, Identifiable {
  public let id: String
  public let name: String
  public let value: MosaicShadow
}

public struct MosaicDesignSystem: Decodable, Sendable, Equatable {
  public let colors: [MosaicColorToken]
  public let backgrounds: [MosaicBackgroundToken]
  public let shadows: [MosaicShadowToken]
}

extension MosaicPaywallDocument {
  public func resolvedColor(_ color: MosaicColor) -> MosaicColor? {
    resolveColor(color, visiting: [])
  }

  public func resolvedBackground(_ background: MosaicBackground) -> MosaicBackground? {
    resolveBackground(background, visiting: [])
  }

  public func resolvedShadow(_ shadow: MosaicShadow) -> MosaicShadow? {
    resolveShadow(shadow, visiting: [])
  }

  private func resolveColor(_ color: MosaicColor, visiting: Set<String>) -> MosaicColor? {
    guard case .token(let id) = color else { return color }
    guard !visiting.contains(id),
      let token = designSystem?.colors.first(where: { $0.id == id })
    else { return nil }
    return resolveColor(token.value, visiting: visiting.union([id]))
  }

  private func resolveBackground(
    _ background: MosaicBackground,
    visiting: Set<String>
  ) -> MosaicBackground? {
    switch background {
    case .token(let id):
      guard !visiting.contains(id),
        let token = designSystem?.backgrounds.first(where: { $0.id == id })
      else { return nil }
      return resolveBackground(token.value, visiting: visiting.union([id]))
    case .color(let color):
      return resolvedColor(color).map(MosaicBackground.color)
    case .linearGradient(let angle, let stops):
      let resolved = stops.compactMap { stop in
        resolvedColor(stop.color).map { MosaicGradientStop(position: stop.position, color: $0) }
      }
      return resolved.count == stops.count ? .linearGradient(angle: angle, stops: resolved) : nil
    case .radialGradient(let center, let radius, let stops):
      let resolved = stops.compactMap { stop in
        resolvedColor(stop.color).map { MosaicGradientStop(position: stop.position, color: $0) }
      }
      return resolved.count == stops.count
        ? .radialGradient(center: center, radius: radius, stops: resolved) : nil
    case .image(let assetId, let mode, let fallback):
      return resolvedColor(fallback).map {
        .image(assetId: assetId, contentMode: mode, fallbackColor: $0)
      }
    case .video(let assetId, let poster, let mode, let fallback):
      return resolvedColor(fallback).map {
        .video(
          assetId: assetId, posterAssetId: poster, contentMode: mode, fallbackColor: $0)
      }
    }
  }

  private func resolveShadow(_ shadow: MosaicShadow, visiting: Set<String>) -> MosaicShadow? {
    switch shadow {
    case .token(let id):
      guard !visiting.contains(id),
        let token = designSystem?.shadows.first(where: { $0.id == id })
      else { return nil }
      return resolveShadow(token.value, visiting: visiting.union([id]))
    case .value(let color, let x, let y, let blur):
      return resolvedColor(color).map {
        .value(color: $0, offsetX: x, offsetY: y, blurRadius: blur)
      }
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
  public let background: MosaicBackground?
  public let border: MosaicBorder?
  public let cornerRadius: Double?
  public let opacity: Double?
  public let padding: MosaicEdgeInsets?
  public let clipContent: Bool?
  public let shadow: MosaicShadow?
}

public enum MosaicWidthSizing: Decodable, Sendable, Equatable {
  case content
  case fit
  case fill
  case fixed(Double)

  private enum CodingKeys: String, CodingKey { case mode, value }

  public init(from decoder: any Decoder) throws {
    if let raw = try? decoder.singleValueContainer().decode(String.self) {
      switch raw {
      case "content": self = .content
      case "fit": self = .fit
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
  case fit
  case fill
  case fixed(Double)

  private enum CodingKeys: String, CodingKey { case mode, value }

  public init(from decoder: any Decoder) throws {
    if let raw = try? decoder.singleValueContainer().decode(String.self) {
      switch raw {
      case "content": self = .content
      case "fit": self = .fit
      case "fill": self = .fill
      default:
        throw DecodingError.dataCorrupted(
          .init(codingPath: decoder.codingPath, debugDescription: "Invalid height sizing."))
      }
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
      MosaicTypography(
        style: style, fontSize: 40, lineHeightMultiplier: 1.1, weight: .bold,
        color: .semantic(.textPrimary), alignment: alignment)
    case .title:
      MosaicTypography(
        style: style, fontSize: 34, lineHeightMultiplier: 1.18, weight: .bold,
        color: .semantic(.textPrimary), alignment: alignment)
    case .heading:
      MosaicTypography(
        style: style, fontSize: 22, lineHeightMultiplier: 1.25, weight: .semibold,
        color: .semantic(.textPrimary), alignment: alignment)
    case .body:
      MosaicTypography(
        style: style, fontSize: 17, lineHeightMultiplier: 1.35, weight: .regular,
        color: .semantic(.textPrimary), alignment: alignment)
    case .label:
      MosaicTypography(
        style: style, fontSize: 16, lineHeightMultiplier: 1.25, weight: .semibold,
        color: .semantic(.textPrimary), alignment: alignment)
    case .caption:
      MosaicTypography(
        style: style, fontSize: 13, lineHeightMultiplier: 1.3, weight: .regular,
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
    visibility =
      try container.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
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
  public let sizing: MosaicBoxSizing?
  public let outerInsets: MosaicEdgeInsets?
  public let visibility: MosaicVisibility
  public let accessibility: MosaicImageAccessibility

  private enum CodingKeys: String, CodingKey {
    case type, id, assetId, width, aspectRatio, height, contentMode, appearance, sizing, outerInsets
    case visibility, accessibility
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    type = try container.decode(MosaicLayoutNodeKind.self, forKey: .type)
    id = try container.decode(String.self, forKey: .id)
    assetId = try container.decode(String.self, forKey: .assetId)
    sizing = try container.decodeIfPresent(MosaicBoxSizing.self, forKey: .sizing)
    width =
      try container.decodeIfPresent(MosaicImageWidth.self, forKey: .width)
      ?? sizing?.width ?? .fit
    aspectRatio = try container.decodeIfPresent(Double.self, forKey: .aspectRatio)
    height = try container.decodeIfPresent(Double.self, forKey: .height)
    contentMode = try container.decode(MosaicImageContentMode.self, forKey: .contentMode)
    appearance = try container.decodeIfPresent(MosaicBoxAppearance.self, forKey: .appearance)
    outerInsets = try container.decodeIfPresent(MosaicEdgeInsets.self, forKey: .outerInsets)
    visibility =
      try container.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
    accessibility = try container.decode(MosaicImageAccessibility.self, forKey: .accessibility)
  }
}

public enum MosaicIconName: String, Decodable, Sendable, CaseIterable {
  case checkmark
  case close
  case lock
  case restore
  case externalLink
  case arrowBackward
  case arrowForward
  case chevronBackward
  case chevronForward

  public var isDirectional: Bool {
    switch self {
    case .arrowBackward, .arrowForward, .chevronBackward, .chevronForward: true
    case .checkmark, .close, .lock, .restore, .externalLink: false
    }
  }
}

public struct MosaicIconComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let name: MosaicIconName
  public let size: Double
  public let color: MosaicColor
  public let appearance: MosaicBoxAppearance?
  public let sizing: MosaicBoxSizing?
  public let outerInsets: MosaicEdgeInsets?
  public let visibility: MosaicVisibility
  public let accessibility: MosaicImageAccessibility

  private enum CodingKeys: String, CodingKey {
    case type, id, name, size, color, appearance, sizing, outerInsets, visibility, accessibility
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    type = try container.decode(MosaicLayoutNodeKind.self, forKey: .type)
    id = try container.decode(String.self, forKey: .id)
    name = try container.decode(MosaicIconName.self, forKey: .name)
    size = try container.decode(Double.self, forKey: .size)
    color = try container.decode(MosaicColor.self, forKey: .color)
    appearance = try container.decodeIfPresent(MosaicBoxAppearance.self, forKey: .appearance)
    sizing = try container.decodeIfPresent(MosaicBoxSizing.self, forKey: .sizing)
    outerInsets = try container.decodeIfPresent(MosaicEdgeInsets.self, forKey: .outerInsets)
    visibility =
      try container.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
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
    gap =
      try container.decodeIfPresent(Double.self, forKey: .gap)
      ?? container.decode(Double.self, forKey: .itemSpacing)
    markerColor =
      try container.decodeIfPresent(MosaicColor.self, forKey: .markerColor)
      ?? .semantic(.actionPrimary)
    items = try container.decode([MosaicFeatureListItem].self, forKey: .items)
    typography =
      try container.decodeIfPresent(MosaicTypography.self, forKey: .typography)
      ?? .legacy(style: .body, alignment: .start)
    appearance = try container.decodeIfPresent(MosaicBoxAppearance.self, forKey: .appearance)
    sizing = try container.decodeIfPresent(MosaicBoxSizing.self, forKey: .sizing)
    outerInsets = try container.decodeIfPresent(MosaicEdgeInsets.self, forKey: .outerInsets)
    visibility =
      try container.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
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

  private enum CodingKeys: String, CodingKey {
    case defaultStyle = "default"
    case selected
  }

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

/// The complete visual state authored for a Protocol 0.2 Product Card or Product Badge.
public struct MosaicAuthoredProductBoxStyle: Decodable, Sendable, Equatable {
  public let background: MosaicBackground
  public let border: MosaicBorder
  public let cornerRadius: Double
  public let padding: MosaicEdgeInsets
  public let opacity: Double
  public let shadow: MosaicShadow?
}

/// A recursively partial Selected-state override. Missing leaves inherit from Default.
public struct MosaicAuthoredProductBoxStyleOverride: Decodable, Sendable, Equatable {
  public let background: MosaicBackground?
  public let border: MosaicBorderOverride?
  public let cornerRadius: Double?
  public let padding: MosaicEdgeInsetsOverride?
  public let opacity: Double?
  public let shadow: MosaicShadow?

  public func resolving(_ base: MosaicAuthoredProductBoxStyle) -> MosaicAuthoredProductBoxStyle {
    MosaicAuthoredProductBoxStyle(
      background: background ?? base.background,
      border: border?.resolving(base.border) ?? base.border,
      cornerRadius: cornerRadius ?? base.cornerRadius,
      padding: padding?.resolving(base.padding) ?? base.padding,
      opacity: opacity ?? base.opacity,
      shadow: shadow ?? base.shadow
    )
  }
}

public struct MosaicAuthoredProductStyles: Decodable, Sendable, Equatable {
  public let defaultStyle: MosaicAuthoredProductBoxStyle
  public let selected: MosaicAuthoredProductBoxStyleOverride

  private enum CodingKeys: String, CodingKey {
    case defaultStyle = "default"
    case selected
  }

  public func resolving(selected isSelected: Bool) -> MosaicAuthoredProductBoxStyle {
    isSelected ? selected.resolving(defaultStyle) : defaultStyle
  }
}

public struct MosaicProductCardAccessibility: Decodable, Sendable, Equatable {
  public let label: MosaicLocalizedText
}

public enum MosaicProductBadgeAnchor: String, Decodable, Sendable, Equatable {
  case topStart, topEnd, bottomStart, bottomEnd
}

public enum MosaicProductBadgePlacement: Decodable, Sendable, Equatable {
  case nested
  case overlay(anchor: MosaicProductBadgeAnchor, inset: Double)

  private enum CodingKeys: String, CodingKey { case mode, anchor, inset }
  private enum Mode: String, Decodable { case nested, overlay }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Mode.self, forKey: .mode) {
    case .nested:
      self = .nested
    case .overlay:
      self = .overlay(
        anchor: try container.decode(MosaicProductBadgeAnchor.self, forKey: .anchor),
        inset: try container.decode(Double.self, forKey: .inset)
      )
    }
  }
}

public struct MosaicProductBadgeComponent: Decodable, Sendable, Equatable, Identifiable {
  public let id: String
  public let placement: MosaicProductBadgePlacement
  public let direction: MosaicStackDirection
  public let gap: Double
  public let mainAxisDistribution: MosaicMainAxisDistribution
  public let crossAxisAlignment: MosaicHorizontalAlignment
  public let children: [MosaicNode]
  public let styles: MosaicAuthoredProductStyles
  public let sizing: MosaicBoxSizing?

  private enum CodingKeys: String, CodingKey {
    case type, id, placement, direction, gap, mainAxisDistribution, crossAxisAlignment, children
    case styles, sizing
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    guard try container.decode(String.self, forKey: .type) == "productBadge" else {
      throw DecodingError.dataCorruptedError(
        forKey: .type, in: container, debugDescription: "Expected Product Badge."
      )
    }
    id = try container.decode(String.self, forKey: .id)
    placement = try container.decode(MosaicProductBadgePlacement.self, forKey: .placement)
    direction = try container.decode(MosaicStackDirection.self, forKey: .direction)
    gap = try container.decode(Double.self, forKey: .gap)
    mainAxisDistribution = try container.decode(
      MosaicMainAxisDistribution.self, forKey: .mainAxisDistribution)
    crossAxisAlignment = try container.decode(
      MosaicHorizontalAlignment.self, forKey: .crossAxisAlignment)
    children = try container.decode([MosaicNode].self, forKey: .children)
    styles = try container.decode(MosaicAuthoredProductStyles.self, forKey: .styles)
    sizing = try container.decodeIfPresent(MosaicBoxSizing.self, forKey: .sizing)
  }
}

public enum MosaicProductCardChild: Decodable, Sendable, Equatable, Identifiable {
  case node(MosaicNode)
  case badge(MosaicProductBadgeComponent)

  public var id: String {
    switch self {
    case .node(let node): node.id
    case .badge(let badge): badge.id
    }
  }

  private enum CodingKeys: String, CodingKey { case type }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    if try container.decode(String.self, forKey: .type) == "productBadge" {
      self = .badge(try MosaicProductBadgeComponent(from: decoder))
    } else {
      self = .node(try MosaicNode(from: decoder))
    }
  }
}

public struct MosaicProductCardComponent: Decodable, Sendable, Equatable, Identifiable {
  public let id: String
  public let productReferenceId: String
  public let direction: MosaicStackDirection
  public let gap: Double
  public let mainAxisDistribution: MosaicMainAxisDistribution
  public let crossAxisAlignment: MosaicHorizontalAlignment
  public let children: [MosaicProductCardChild]
  public let styles: MosaicAuthoredProductStyles
  public let sizing: MosaicBoxSizing?
  public let clipContent: Bool?
  public let accessibility: MosaicProductCardAccessibility?

  private enum CodingKeys: String, CodingKey {
    case type, id, productReferenceId, direction, gap, mainAxisDistribution, crossAxisAlignment
    case children, styles, sizing, clipContent, accessibility
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    guard try container.decode(String.self, forKey: .type) == "productCard" else {
      throw DecodingError.dataCorruptedError(
        forKey: .type, in: container, debugDescription: "Expected Product Card."
      )
    }
    id = try container.decode(String.self, forKey: .id)
    productReferenceId = try container.decode(String.self, forKey: .productReferenceId)
    direction = try container.decode(MosaicStackDirection.self, forKey: .direction)
    gap = try container.decode(Double.self, forKey: .gap)
    mainAxisDistribution = try container.decode(
      MosaicMainAxisDistribution.self, forKey: .mainAxisDistribution)
    crossAxisAlignment = try container.decode(
      MosaicHorizontalAlignment.self, forKey: .crossAxisAlignment)
    children = try container.decode([MosaicProductCardChild].self, forKey: .children)
    styles = try container.decode(MosaicAuthoredProductStyles.self, forKey: .styles)
    sizing = try container.decodeIfPresent(MosaicBoxSizing.self, forKey: .sizing)
    clipContent = try container.decodeIfPresent(Bool.self, forKey: .clipContent)
    accessibility = try container.decodeIfPresent(
      MosaicProductCardAccessibility.self, forKey: .accessibility)
  }
}

public struct MosaicProductSelectorComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let productReferenceIds: [String]
  public let initiallySelectedProductReferenceId: String
  public let direction: MosaicStackDirection
  public let gap: Double
  public let crossAxisAlignment: MosaicHorizontalAlignment
  public let cards: [MosaicProductCardComponent]
  public let initialProductCardId: String?
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
    case itemSpacing, crossAxisAlignment, cards, initialProductCardId, cardStyles
    case appearance, sizing, outerInsets, visibility
    case unavailableFallback, accessibility
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    type = try container.decode(MosaicLayoutNodeKind.self, forKey: .type)
    id = try container.decode(String.self, forKey: .id)
    direction =
      try container.decodeIfPresent(MosaicStackDirection.self, forKey: .direction)
      ?? .vertical
    gap =
      try container.decodeIfPresent(Double.self, forKey: .gap)
      ?? container.decode(Double.self, forKey: .itemSpacing)
    crossAxisAlignment =
      try container.decodeIfPresent(MosaicHorizontalAlignment.self, forKey: .crossAxisAlignment)
      ?? .stretch
    let decodedCards =
      try container.decodeIfPresent([MosaicProductCardComponent].self, forKey: .cards) ?? []
    let decodedInitialProductCardID = try container.decodeIfPresent(
      String.self, forKey: .initialProductCardId)
    cards = decodedCards
    initialProductCardId = decodedInitialProductCardID
    if decodedCards.isEmpty {
      productReferenceIds = try container.decode([String].self, forKey: .productReferenceIds)
      initiallySelectedProductReferenceId = try container.decode(
        String.self, forKey: .initiallySelectedProductReferenceId)
      cardStyles =
        try container.decodeIfPresent(MosaicProductCardStyles.self, forKey: .cardStyles)
        ?? .legacy
    } else {
      productReferenceIds = decodedCards.map(\.productReferenceId)
      initiallySelectedProductReferenceId =
        decodedInitialProductCardID.flatMap { initialID in
          decodedCards.first { $0.id == initialID }?.productReferenceId
        }
        ?? decodedCards[0].productReferenceId
      cardStyles = .legacy
    }
    appearance = try container.decodeIfPresent(MosaicBoxAppearance.self, forKey: .appearance)
    sizing = try container.decodeIfPresent(MosaicBoxSizing.self, forKey: .sizing)
    outerInsets = try container.decodeIfPresent(MosaicEdgeInsets.self, forKey: .outerInsets)
    visibility =
      try container.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
    unavailableFallback = try container.decode(
      MosaicUnavailableProductFallback.self, forKey: .unavailableFallback)
    accessibility = try container.decode(MosaicControlAccessibility.self, forKey: .accessibility)
  }

  public var usesAuthoredCards: Bool { !cards.isEmpty }

  public var initialProductReferenceID: String {
    guard let initialProductCardId,
      let card = cards.first(where: { $0.id == initialProductCardId })
    else { return initiallySelectedProductReferenceId }
    return card.productReferenceId
  }
}

public enum MosaicAction: Decodable, Sendable, Equatable {
  case purchase(productSelectorId: String)
  case restore
  case close
  case navigateTo(screenId: String)
  case navigateBack
  case openExternalURL(URL)

  public var type: MosaicActionType {
    switch self {
    case .purchase: .purchase
    case .restore: .restore
    case .close: .close
    case .navigateTo: .navigateTo
    case .navigateBack: .navigateBack
    case .openExternalURL: .openExternalURL
    }
  }

  private enum CodingKeys: String, CodingKey { case type, productSelectorId, screenId, url }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(MosaicActionType.self, forKey: .type) {
    case .purchase:
      self = .purchase(
        productSelectorId: try container.decode(String.self, forKey: .productSelectorId))
    case .restore: self = .restore
    case .close: self = .close
    case .navigateTo:
      self = .navigateTo(screenId: try container.decode(String.self, forKey: .screenId))
    case .navigateBack: self = .navigateBack
    case .openExternalURL:
      let raw = try container.decode(String.self, forKey: .url)
      guard let url = URL(string: raw) else {
        throw DecodingError.dataCorruptedError(
          forKey: .url, in: container, debugDescription: "Expected an absolute HTTPS URL."
        )
      }
      self = .openExternalURL(url)
    }
  }
}

public enum MosaicActionType: String, Decodable, Sendable {
  case purchase, restore, close, navigateTo, navigateBack
  case openExternalURL = "openExternalUrl"
}

public struct MosaicButtonComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let direction: MosaicStackDirection
  public let gap: Double
  public let mainAxisDistribution: MosaicMainAxisDistribution
  public let crossAxisAlignment: MosaicHorizontalAlignment
  public let children: [MosaicNode]
  public let inProgressChildren: [MosaicNode]?
  public let appearance: MosaicBoxAppearance?
  public let sizing: MosaicBoxSizing?
  public let outerInsets: MosaicEdgeInsets?
  public let visibility: MosaicVisibility
  public let action: MosaicAction
  public let accessibility: MosaicControlAccessibility

  private enum CodingKeys: String, CodingKey {
    case type, id, direction, gap, mainAxisDistribution, crossAxisAlignment, children
    case inProgressChildren, appearance, sizing, outerInsets, visibility, action, accessibility
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    type = try container.decode(MosaicLayoutNodeKind.self, forKey: .type)
    id = try container.decode(String.self, forKey: .id)
    direction = try container.decode(MosaicStackDirection.self, forKey: .direction)
    gap = try container.decode(Double.self, forKey: .gap)
    mainAxisDistribution = try container.decode(
      MosaicMainAxisDistribution.self, forKey: .mainAxisDistribution)
    crossAxisAlignment = try container.decode(
      MosaicHorizontalAlignment.self, forKey: .crossAxisAlignment)
    children = try container.decode([MosaicNode].self, forKey: .children)
    inProgressChildren = try container.decodeIfPresent(
      [MosaicNode].self, forKey: .inProgressChildren)
    appearance = try container.decodeIfPresent(MosaicBoxAppearance.self, forKey: .appearance)
    sizing = try container.decodeIfPresent(MosaicBoxSizing.self, forKey: .sizing)
    outerInsets = try container.decodeIfPresent(MosaicEdgeInsets.self, forKey: .outerInsets)
    visibility =
      try container.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
    action = try container.decode(MosaicAction.self, forKey: .action)
    accessibility = try container.decode(MosaicControlAccessibility.self, forKey: .accessibility)
  }

  public func content(isInProgress: Bool) -> [MosaicNode] {
    if isInProgress, let inProgressChildren { return inProgressChildren }
    return children
  }
}

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
    typography =
      try c.decodeIfPresent(MosaicTypography.self, forKey: .typography)
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
    typography =
      try c.decodeIfPresent(MosaicTypography.self, forKey: .typography)
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
    typography =
      try c.decodeIfPresent(MosaicTypography.self, forKey: .typography)
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
  public let sizing: MosaicBoxSizing?
  public let outerInsets: MosaicEdgeInsets?
  public let visibility: MosaicVisibility
  public let accessibility: MosaicControlAccessibility

  private enum CodingKeys: String, CodingKey {
    case type, id, label, initialValue, typography, offTrackColor, onTrackColor, thumbColor
    case appearance, sizing, outerInsets, visibility, accessibility
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
    sizing = try c.decodeIfPresent(MosaicBoxSizing.self, forKey: .sizing)
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
