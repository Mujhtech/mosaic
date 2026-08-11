import Foundation

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
  /// Visible only while the named Tabs component's runtime selection equals
  /// this tab. A false condition removes the node from layout, the
  /// accessibility tree, and focus order, exactly as a false Switch condition
  /// does.
  case tabValue(tabsId: String, equals: String)

  private enum CodingKeys: String, CodingKey { case mode, switchId, tabsId, equals }
  private enum Mode: String, Decodable { case always, hidden, `switch`, tab }

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
    case .tab:
      self = .tabValue(
        tabsId: try container.decode(String.self, forKey: .tabsId),
        equals: try container.decode(String.self, forKey: .equals)
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
  public let motion: MosaicMotion?
  public let visibility: MosaicVisibility
  public let accessibility: MosaicTextAccessibility

  public var style: MosaicTextStyle { typography.style }
  public var alignment: MosaicTextAlignment { typography.alignment }

  private enum CodingKeys: String, CodingKey {
    case type, id, value, style, alignment, typography, appearance, sizing, outerInsets
    case motion, visibility, accessibility
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
    motion = try container.decodeIfPresent(MosaicMotion.self, forKey: .motion)
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
  public let motion: MosaicMotion?
  public let visibility: MosaicVisibility
  public let accessibility: MosaicImageAccessibility

  private enum CodingKeys: String, CodingKey {
    case type, id, assetId, width, aspectRatio, height, contentMode, appearance, sizing, outerInsets
    case motion, visibility, accessibility
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
    motion = try container.decodeIfPresent(MosaicMotion.self, forKey: .motion)
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
  public let motion: MosaicMotion?
  public let visibility: MosaicVisibility
  public let accessibility: MosaicImageAccessibility

  private enum CodingKeys: String, CodingKey {
    case type, id, name, size, color, appearance, sizing, outerInsets, motion, visibility
    case accessibility
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
    motion = try container.decodeIfPresent(MosaicMotion.self, forKey: .motion)
    visibility =
      try container.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
    accessibility = try container.decode(MosaicImageAccessibility.self, forKey: .accessibility)
  }
}

public struct MosaicFeatureListItem: Decodable, Sendable, Equatable, Identifiable {
  public let id: String
  public let text: MosaicLocalizedText
  /// Overrides the list's marker for this item only. Absent means the item
  /// carries the list's marker; it is never a request for no glyph.
  public let marker: MosaicMarker?
}

public struct MosaicControlAccessibility: Decodable, Sendable, Equatable {
  public let label: MosaicLocalizedText
  public let hint: MosaicLocalizedText?
}

public struct MosaicFeatureListComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  /// The glyph every item carries unless the item overrides it. Marker colour
  /// and size stay component-level, exactly as they are on Timeline.
  public let marker: MosaicMarker
  public let gap: Double
  public let markerColor: MosaicColor
  /// The extent of every marker glyph, component-level exactly as `markerColor`
  /// is: an item overrides *which* glyph it draws, never how large.
  ///
  /// Optional, unlike Timeline's, because a Feature List always declares a
  /// marker and so always has a size to fall back on. Read through
  /// ``markerExtent``, never directly, so the fallback cannot be forgotten at one
  /// call site.
  public let markerSize: Double?
  public let items: [MosaicFeatureListItem]
  public let typography: MosaicTypography
  public let appearance: MosaicBoxAppearance?
  public let sizing: MosaicBoxSizing?
  public let outerInsets: MosaicEdgeInsets?
  public let motion: MosaicMotion?
  public let visibility: MosaicVisibility
  public let accessibility: MosaicControlAccessibility

  public var itemSpacing: Double { gap }

  /// The glyph drawn for one item: its own override, or the list's marker.
  public func marker(for item: MosaicFeatureListItem) -> MosaicMarker {
    item.marker ?? marker
  }

  /// The extent every marker glyph is drawn at: the authored `markerSize`, or
  /// the list's own `typography.fontSize`.
  ///
  /// The fallback is another authored value on the same component, following
  /// Timeline's precedent. It is deliberately not a renderer constant — that is
  /// how Flutter came to draw 20 while Compose drew the font size.
  public var markerExtent: Double { markerSize ?? typography.fontSize }

  private enum CodingKeys: String, CodingKey {
    case type, id, marker, gap, itemSpacing, markerColor, markerSize, items, typography
    case appearance, sizing, outerInsets, motion, visibility, accessibility
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    type = try container.decode(MosaicLayoutNodeKind.self, forKey: .type)
    id = try container.decode(String.self, forKey: .id)
    marker = try container.decode(MosaicMarker.self, forKey: .marker)
    gap =
      try container.decodeIfPresent(Double.self, forKey: .gap)
      ?? container.decode(Double.self, forKey: .itemSpacing)
    markerColor =
      try container.decodeIfPresent(MosaicColor.self, forKey: .markerColor)
      ?? .semantic(.actionPrimary)
    markerSize = try container.decodeIfPresent(Double.self, forKey: .markerSize)
    items = try container.decode([MosaicFeatureListItem].self, forKey: .items)
    typography =
      try container.decodeIfPresent(MosaicTypography.self, forKey: .typography)
      ?? .legacy(style: .body, alignment: .start)
    appearance = try container.decodeIfPresent(MosaicBoxAppearance.self, forKey: .appearance)
    sizing = try container.decodeIfPresent(MosaicBoxSizing.self, forKey: .sizing)
    outerInsets = try container.decodeIfPresent(MosaicEdgeInsets.self, forKey: .outerInsets)
    motion = try container.decodeIfPresent(MosaicMotion.self, forKey: .motion)
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

/// The complete authored appearance of a two-state selectable box in its
/// unselected state.
///
/// `0.3` expresses this through the neutral `selectionStateStyle` definition
/// that `productCardDefaultStyle` now aliases, so Product Card, Product Badge,
/// and Tabs resolve their Default/Selected states through one implementation
/// rather than three that can drift.
public struct MosaicSelectionStateStyle: Decodable, Sendable, Equatable {
  public let background: MosaicBackground
  public let border: MosaicBorder
  public let cornerRadius: Double
  public let padding: MosaicEdgeInsets
  public let opacity: Double
  public let shadow: MosaicShadow?
}

/// A recursively partial Selected-state override. Missing leaves inherit from Default.
public struct MosaicSelectionStateStyleOverride: Decodable, Sendable, Equatable {
  public let background: MosaicBackground?
  public let border: MosaicBorderOverride?
  public let cornerRadius: Double?
  public let padding: MosaicEdgeInsetsOverride?
  public let opacity: Double?
  public let shadow: MosaicShadow?

  public func resolving(_ base: MosaicSelectionStateStyle) -> MosaicSelectionStateStyle {
    MosaicSelectionStateStyle(
      background: background ?? base.background,
      border: border?.resolving(base.border) ?? base.border,
      cornerRadius: cornerRadius ?? base.cornerRadius,
      padding: padding?.resolving(base.padding) ?? base.padding,
      opacity: opacity ?? base.opacity,
      shadow: shadow ?? base.shadow
    )
  }
}

public struct MosaicSelectionStyles: Decodable, Sendable, Equatable {
  public let defaultStyle: MosaicSelectionStateStyle
  public let selected: MosaicSelectionStateStyleOverride

  private enum CodingKeys: String, CodingKey {
    case defaultStyle = "default"
    case selected
  }

  public func resolving(selected isSelected: Bool) -> MosaicSelectionStateStyle {
    isSelected ? selected.resolving(defaultStyle) : defaultStyle
  }
}

/// `productCardStyles` is an alias of `selectionStyles` in the `0.3` schema, so
/// it is an alias here too rather than a second declaration that could drift.
public typealias MosaicAuthoredProductStyles = MosaicSelectionStyles
public typealias MosaicAuthoredProductBoxStyle = MosaicSelectionStateStyle
public typealias MosaicAuthoredProductBoxStyleOverride = MosaicSelectionStateStyleOverride

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
  public let styles: MosaicSelectionStyles
  public let sizing: MosaicBoxSizing?
  public let motion: MosaicMotion?

  private enum CodingKeys: String, CodingKey {
    case type, id, placement, direction, gap, mainAxisDistribution, crossAxisAlignment, children
    case styles, sizing, motion
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
    styles = try container.decode(MosaicSelectionStyles.self, forKey: .styles)
    sizing = try container.decodeIfPresent(MosaicBoxSizing.self, forKey: .sizing)
    motion = try container.decodeIfPresent(MosaicMotion.self, forKey: .motion)
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
