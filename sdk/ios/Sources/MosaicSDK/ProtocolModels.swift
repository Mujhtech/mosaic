import Foundation

/// Paywall Protocol `0.4`, "Motion" — the one contract this SDK reads.
///
/// Under [ADR-0028](../../../../docs/architecture/decisions/0028-single-version-contracts.md)
/// every Mosaic contract carries exactly one version until GA, so `0.4` is both
/// the version the SDK decodes and the version it negotiates with Configuration
/// Delivery and Local Preview. A document claiming any other version is
/// rejected atomically and resolves through cached configuration, then bundled
/// fallback, then configuration unavailable.
public let mosaicProtocolVersion = "0.4"
/// Kept as a list rather than collapsed into its element so that a post-GA
/// parallel version widens this constant instead of changing its type.
public let mosaicSupportedProtocolVersions = [mosaicProtocolVersion]

/// The decodable contract, and the rules that go with it.
///
/// Version identifiers are exact: a reader declaring `0.4` accepts only `0.4`
/// and never infers support from numeric ordering. The enum keeps its single
/// case rather than being deleted so that the decoder's `init(rawValue:)` guard
/// stays the one place an unsupported version is turned into an error.
public enum MosaicSchemaVersion: String, Sendable, CaseIterable, Equatable {
  case v04 = "0.4"

  public var capabilities: [MosaicCapabilityName] { MosaicCapabilityCatalog.current }
}
/// The exact published artifact version. It must stay identical to
/// `MosaicSDK.podspec` and `StoreKit/MosaicStoreKit.podspec` because it is sent
/// as the `Mosaic-SDK-Version` header and reported in analytics context.
public let mosaicSDKVersion = "0.1.0-dev.6"

public enum MosaicCapabilityName: String, Codable, CaseIterable, Sendable {
  case scrollContainer = "layout.scrollContainer"
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
  case carousel = "component.carousel"
  case switchControl = "component.switch"
  case countdown = "component.countdown"
  case tabs = "component.tabs"
  case timeline = "component.timeline"
  case award = "component.award"
  case socialProof = "component.socialProof"
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
  case reservedStrings = "accessibility.reservedStrings"
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
  case staticVisibility = "visibility.static"
  case switchVisibility = "condition.switchVisibility"
  case tabVisibility = "condition.tabVisibility"
  case motionAppear = "motion.appear"
  case motionSelection = "motion.selection"
  case motionLoop = "motion.loop"
}

public enum MosaicCapabilityCatalog {
  /// Every capability Paywall Protocol `0.4` defines, which is every capability
  /// this SDK supports.
  ///
  /// `style.productCardStates` is absent because `0.4` removed it as a legacy
  /// co-derived signal — it was derived exactly when Product Selector, Product
  /// Card, or Product Badge was, so it carried no information of its own. A
  /// document declaring it is rejected as an unknown capability.
  public static let current: [MosaicCapabilityName] = [
    .scrollContainer, .stack, .sizing, .heightSizing, .outerInsets, .screens, .sheets,
    .text, .image, .icon,
    .featureList, .productSelector, .productCard, .productBadge, .button, .carousel,
    .switchControl, .countdown, .localizationCatalogs, .localizationRTL, .productTemplate,
    .productReferences, .bundledImage, .remoteImage, .bundledVideo, .remoteVideo,
    .purchaseAction, .restoreAction, .closeAction, .navigateToAction, .navigateBackAction,
    .openExternalURLAction, .accessibilityMetadata, .assetFallback, .productFallback,
    .normalizedOutcome, .colors, .designTokens, .gradientBackground, .mediaBackground,
    .shadow, .boxStyle, .clipping, .typography,
    .staticVisibility, .switchVisibility,
    .tabs, .timeline, .award, .socialProof, .tabVisibility, .reservedStrings,
    .motionAppear, .motionSelection, .motionLoop,
  ]

  /// The three capabilities that carry `renderWithoutMotion` rather than
  /// `rejectDocument`. A reader missing one of these renders the document
  /// statically and completely, which the terminal-state rule guarantees is the
  /// full authored design.
  ///
  /// This tier survives the single-version collapse: it is a property of motion
  /// rather than of versioning (ADR-0028).
  public static let motion: [MosaicCapabilityName] = [
    .motionAppear, .motionSelection, .motionLoop,
  ]
}

public struct MosaicSDKCapabilityReport: Sendable, Equatable {
  public let sdkVersion: String
  public let supportedSchemaVersions: [String]
  public let capabilities: [MosaicRequiredCapability]

  public init(
    sdkVersion: String = mosaicSDKVersion,
    supportedSchemaVersions: [String] = mosaicSupportedProtocolVersions,
    /// Each entry still carries its version. The pair is what the Configuration
    /// Delivery and Local Preview handshakes put on the wire and what a release's
    /// `requiredCapabilities` is compared against, so it stays a pair even though
    /// one version can supply the right-hand side today.
    capabilities: [MosaicRequiredCapability] = MosaicCapabilityCatalog.current.map {
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

    // `0.4` always declares `screens`; the retired top-level `layout` shape that
    // an earlier contract also accepted no longer exists in any readable
    // version, so there is no second branch to take.
    let decodedScreens = try container.decode([MosaicScreen].self, forKey: .screens)
    let decodedInitialScreenID = try container.decode(String.self, forKey: .initialScreenId)
    guard !decodedScreens.isEmpty else {
      throw DecodingError.dataCorruptedError(
        forKey: .screens,
        in: container,
        debugDescription: "The protocol requires at least one screen."
      )
    }
    // `invalidReference` is `rejectDocument` in the reader policy. A declared
    // initial screen that no screen defines is a non-conforming document, so it
    // is rejected here rather than silently rendering the first screen, which
    // would present a paywall nobody authored.
    guard
      let initialLayout = decodedScreens.first(where: { $0.id == decodedInitialScreenID })?.layout
    else {
      throw DecodingError.dataCorruptedError(
        forKey: .initialScreenId,
        in: container,
        debugDescription: "initialScreenId does not reference a declared screen."
      )
    }
    screens = decodedScreens
    initialScreenId = decodedInitialScreenID
    layout = initialLayout
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
  public let motion: MosaicMotion?
  public let visibility: MosaicVisibility
  public let children: [MosaicNode]

  private enum CodingKeys: String, CodingKey {
    case type, id, direction, gap, padding, mainAxisDistribution
    case crossAxisAlignment, appearance, sizing, outerInsets, motion, visibility
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
    motion = try container.decodeIfPresent(MosaicMotion.self, forKey: .motion)
    visibility =
      try container.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
    children = try container.decode([MosaicNode].self, forKey: .children)
    direction = try container.decode(MosaicStackDirection.self, forKey: .direction)
    gap = try container.decode(Double.self, forKey: .gap)
    mainAxisDistribution = try container.decode(
      MosaicMainAxisDistribution.self, forKey: .mainAxisDistribution)
    crossAxisAlignment = try container.decode(
      MosaicHorizontalAlignment.self, forKey: .crossAxisAlignment)
  }
}

public enum MosaicLayoutNodeKind: String, Decodable, Sendable {
  case scrollContainer
  case stack
  case text
  case image
  case icon
  case featureList
  case productSelector
  case button
  case carousel
  case switchControl = "switch"
  case countdown
  case tabs
  case timeline
  case award
  case socialProof
}

public indirect enum MosaicNode: Decodable, Sendable, Equatable, Identifiable {
  case stack(MosaicStack)
  case text(MosaicTextComponent)
  case image(MosaicImageComponent)
  case icon(MosaicIconComponent)
  case featureList(MosaicFeatureListComponent)
  case productSelector(MosaicProductSelectorComponent)
  case button(MosaicButtonComponent)
  case carousel(MosaicCarouselComponent)
  case switchControl(MosaicSwitchComponent)
  case countdown(MosaicCountdownComponent)
  case tabs(MosaicTabsComponent)
  case timeline(MosaicTimelineComponent)
  case award(MosaicAwardComponent)
  case socialProof(MosaicSocialProofComponent)

  public var id: String {
    switch self {
    case .stack(let value): value.id
    case .text(let value): value.id
    case .image(let value): value.id
    case .icon(let value): value.id
    case .featureList(let value): value.id
    case .productSelector(let value): value.id
    case .button(let value): value.id
    case .carousel(let value): value.id
    case .switchControl(let value): value.id
    case .countdown(let value): value.id
    case .tabs(let value): value.id
    case .timeline(let value): value.id
    case .award(let value): value.id
    case .socialProof(let value): value.id
    }
  }

  public var kind: MosaicLayoutNodeKind {
    switch self {
    case .stack: .stack
    case .text: .text
    case .image: .image
    case .icon: .icon
    case .featureList: .featureList
    case .productSelector: .productSelector
    case .button: .button
    case .carousel: .carousel
    case .switchControl: .switchControl
    case .countdown: .countdown
    case .tabs: .tabs
    case .timeline: .timeline
    case .award: .award
    case .socialProof: .socialProof
    }
  }

  private enum CodingKeys: String, CodingKey { case type }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let type = try container.decode(MosaicLayoutNodeKind.self, forKey: .type)
    switch type {
    case .stack: self = .stack(try MosaicStack(from: decoder))
    case .text: self = .text(try MosaicTextComponent(from: decoder))
    case .image: self = .image(try MosaicImageComponent(from: decoder))
    case .icon: self = .icon(try MosaicIconComponent(from: decoder))
    case .featureList: self = .featureList(try MosaicFeatureListComponent(from: decoder))
    case .productSelector:
      self = .productSelector(try MosaicProductSelectorComponent(from: decoder))
    case .button: self = .button(try MosaicButtonComponent(from: decoder))
    case .carousel: self = .carousel(try MosaicCarouselComponent(from: decoder))
    case .switchControl: self = .switchControl(try MosaicSwitchComponent(from: decoder))
    case .countdown: self = .countdown(try MosaicCountdownComponent(from: decoder))
    case .tabs: self = .tabs(try MosaicTabsComponent(from: decoder))
    case .timeline: self = .timeline(try MosaicTimelineComponent(from: decoder))
    case .award: self = .award(try MosaicAwardComponent(from: decoder))
    case .socialProof: self = .socialProof(try MosaicSocialProofComponent(from: decoder))
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
  /// The fourth catalog, added by `0.4`. Required and possibly empty there, and
  /// absent from `0.3`, where the shape validator rejects the key outright — so
  /// an empty catalog here means "authored empty" in `0.4` and "not that
  /// contract" in `0.3`, and neither is a decoding default.
  public let motions: [MosaicMotionToken]

  private enum CodingKeys: String, CodingKey { case colors, backgrounds, shadows, motions }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    colors = try container.decode([MosaicColorToken].self, forKey: .colors)
    backgrounds = try container.decode([MosaicBackgroundToken].self, forKey: .backgrounds)
    shadows = try container.decode([MosaicShadowToken].self, forKey: .shadows)
    motions = try container.decodeIfPresent([MosaicMotionToken].self, forKey: .motions) ?? []
  }
}

/// A style reference the renderer could not resolve to an authored value.
///
/// Every value carries the diagnostic code the renderer records and the subject
/// it is recorded against, so one malformed token diagnoses once rather than
/// once per frame.
public struct MosaicStyleResolutionFailure: Sendable, Equatable, Hashable {
  public let code: String
  public let subjectID: String

  public init(code: String, subjectID: String) {
    self.code = code
    self.subjectID = subjectID
  }

  public static func unresolvedColorToken(_ id: String) -> Self {
    .init(code: "style_color_token_unresolved", subjectID: id)
  }

  public static func malformedColorLiteral(_ raw: String) -> Self {
    .init(code: "style_color_literal_malformed", subjectID: raw)
  }

  public static func unresolvedBackgroundToken(_ id: String) -> Self {
    .init(code: "style_background_token_unresolved", subjectID: id)
  }

  public static func unresolvedGradientStop(_ id: String) -> Self {
    .init(code: "style_gradient_stop_unresolved", subjectID: id)
  }

  public static func unresolvedShadowToken(_ id: String) -> Self {
    .init(code: "style_shadow_token_unresolved", subjectID: id)
  }
}

/// A background prepared for rendering together with everything about it that
/// could not be resolved.
public struct MosaicResolvedBackground: Sendable, Equatable {
  public let background: MosaicBackground?
  public let failures: [MosaicStyleResolutionFailure]
}

extension MosaicColor {
  /// The design-token identifier this color references, if any.
  public var tokenID: String? {
    guard case .token(let id) = self else { return nil }
    return id
  }
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

  /// Background resolution for the renderer.
  ///
  /// `resolvedBackground(_:)` is all-or-nothing because the semantic validator
  /// uses it to reject non-conforming documents. The renderer must not erase an
  /// authored background because one part of it failed, so this variant
  /// degrades: unresolvable gradient stops are dropped, unresolvable colors are
  /// handed back unresolved for the renderer to recover per role, and
  /// everything that failed is reported so it can be diagnosed once.
  public func renderableBackground(_ background: MosaicBackground) -> MosaicResolvedBackground {
    var failures: [MosaicStyleResolutionFailure] = []
    let resolved = renderBackground(background, visiting: [], failures: &failures)
    return MosaicResolvedBackground(background: resolved, failures: failures)
  }

  private func renderBackground(
    _ background: MosaicBackground,
    visiting: Set<String>,
    failures: inout [MosaicStyleResolutionFailure]
  ) -> MosaicBackground? {
    switch background {
    case .token(let id):
      guard !visiting.contains(id),
        let token = designSystem?.backgrounds.first(where: { $0.id == id })
      else {
        failures.append(.unresolvedBackgroundToken(id))
        return nil
      }
      return renderBackground(token.value, visiting: visiting.union([id]), failures: &failures)
    case .color(let color):
      return .color(resolvedColor(color) ?? color)
    case .linearGradient(let angle, let stops):
      let resolved = renderStops(stops, failures: &failures)
      guard !resolved.isEmpty else { return nil }
      return .linearGradient(angle: angle, stops: resolved)
    case .radialGradient(let center, let radius, let stops):
      let resolved = renderStops(stops, failures: &failures)
      guard !resolved.isEmpty else { return nil }
      return .radialGradient(center: center, radius: radius, stops: resolved)
    case .image(let assetID, let mode, let fallback):
      return .image(
        assetId: assetID, contentMode: mode, fallbackColor: resolvedColor(fallback) ?? fallback)
    case .video(let assetID, let posterID, let mode, let fallback):
      return .video(
        assetId: assetID, posterAssetId: posterID, contentMode: mode,
        fallbackColor: resolvedColor(fallback) ?? fallback)
    }
  }

  private func renderStops(
    _ stops: [MosaicGradientStop],
    failures: inout [MosaicStyleResolutionFailure]
  ) -> [MosaicGradientStop] {
    stops.compactMap { stop in
      guard let color = resolvedColor(stop.color) else {
        failures.append(.unresolvedGradientStop(stop.color.tokenID ?? stop.color.rawValue))
        return nil
      }
      return MosaicGradientStop(position: stop.position, color: color)
    }
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
