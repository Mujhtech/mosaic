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
