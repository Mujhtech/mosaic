import Foundation

public struct MosaicProductCardComponent: Decodable, Sendable, Equatable, Identifiable {
  public let id: String
  public let productReferenceId: String
  public let direction: MosaicStackDirection
  public let gap: Double
  public let mainAxisDistribution: MosaicMainAxisDistribution
  public let crossAxisAlignment: MosaicHorizontalAlignment
  public let children: [MosaicProductCardChild]
  public let styles: MosaicSelectionStyles
  public let sizing: MosaicBoxSizing?
  public let clipContent: Bool?
  public let motion: MosaicMotion?
  public let accessibility: MosaicProductCardAccessibility?

  private enum CodingKeys: String, CodingKey {
    case type, id, productReferenceId, direction, gap, mainAxisDistribution, crossAxisAlignment
    case children, styles, sizing, clipContent, motion, accessibility
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
    styles = try container.decode(MosaicSelectionStyles.self, forKey: .styles)
    sizing = try container.decodeIfPresent(MosaicBoxSizing.self, forKey: .sizing)
    clipContent = try container.decodeIfPresent(Bool.self, forKey: .clipContent)
    motion = try container.decodeIfPresent(MosaicMotion.self, forKey: .motion)
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
  public let motion: MosaicMotion?
  public let visibility: MosaicVisibility
  public let unavailableFallback: MosaicUnavailableProductFallback
  public let accessibility: MosaicControlAccessibility

  public var itemSpacing: Double { gap }

  private enum CodingKeys: String, CodingKey {
    case type, id, productReferenceIds, initiallySelectedProductReferenceId, direction, gap
    case itemSpacing, crossAxisAlignment, cards, initialProductCardId, cardStyles
    case appearance, sizing, outerInsets, motion, visibility
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
    motion = try container.decodeIfPresent(MosaicMotion.self, forKey: .motion)
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
  public let motion: MosaicMotion?
  public let visibility: MosaicVisibility
  public let action: MosaicAction
  public let accessibility: MosaicControlAccessibility

  private enum CodingKeys: String, CodingKey {
    case type, id, direction, gap, mainAxisDistribution, crossAxisAlignment, children
    case inProgressChildren, appearance, sizing, outerInsets, motion, visibility, action
    case accessibility
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
    motion = try container.decodeIfPresent(MosaicMotion.self, forKey: .motion)
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
  public let motion: MosaicMotion?
  public let visibility: MosaicVisibility
  public let accessibility: MosaicControlAccessibility

  private enum CodingKeys: String, CodingKey {
    case type, id, initialPageIndex, showsIndicators, pages, appearance, sizing, outerInsets
    case motion, visibility, accessibility
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
    motion = try c.decodeIfPresent(MosaicMotion.self, forKey: .motion)
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
  public let motion: MosaicMotion?
  public let visibility: MosaicVisibility
  public let accessibility: MosaicControlAccessibility

  private enum CodingKeys: String, CodingKey {
    case type, id, label, initialValue, typography, offTrackColor, onTrackColor, thumbColor
    case appearance, sizing, outerInsets, motion, visibility, accessibility
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
    motion = try c.decodeIfPresent(MosaicMotion.self, forKey: .motion)
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
  public let motion: MosaicMotion?
  public let visibility: MosaicVisibility
  public let accessibility: MosaicTextAccessibility

  private enum CodingKeys: String, CodingKey {
    case type, id, endsAt, largestUnit, smallestUnit, completedText, typography, appearance
    case sizing, outerInsets, motion, visibility, accessibility
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
    motion = try c.decodeIfPresent(MosaicMotion.self, forKey: .motion)
    visibility = try c.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
    accessibility = try c.decode(MosaicTextAccessibility.self, forKey: .accessibility)
  }
}
