import Foundation

// Protocol 0.3 adds four components: Tabs, Timeline, Award, and Social Proof.
// Every optional field below states what its absence means; none of them carries
// a decode-time default that would make an unauthored value indistinguishable
// from an authored one.

// MARK: - Tabs

/// One labelled panel.
///
/// The label names both the tab control and its panel: `0.3` authors one string
/// so a second one cannot drift from it.
public struct MosaicTabsEntry: Decodable, Sendable, Equatable, Identifiable {
  public let id: String
  public let label: MosaicLocalizedText
  public let content: MosaicStack

  public init(id: String, label: MosaicLocalizedText, content: MosaicStack) {
    self.id = id
    self.label = label
    self.content = content
  }
}

/// N labelled panels with exactly one visible at a time.
///
/// The visible panel is runtime selection state keyed by `id`. `initialTabId` is
/// required and never inferred from ordering: with a positional default,
/// reordering `tabs` would silently change which panel opens.
public struct MosaicTabsComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let tabBarDirection: MosaicStackDirection
  public let tabBarGap: Double
  public let tabBarDistribution: MosaicMainAxisDistribution
  /// Space between the tab bar and the visible panel.
  public let gap: Double
  public let initialTabId: String
  public let tabs: [MosaicTabsEntry]
  public let styles: MosaicSelectionStyles
  public let labelTypography: MosaicTypography
  /// Required rather than optional: a selected tab that deliberately keeps its
  /// Default label colour and one whose colour was never authored are different
  /// intentions that an absent field cannot tell apart.
  public let selectedLabelColor: MosaicColor
  public let appearance: MosaicBoxAppearance?
  public let sizing: MosaicBoxSizing?
  public let outerInsets: MosaicEdgeInsets?
  public let motion: MosaicMotion?
  public let visibility: MosaicVisibility
  public let accessibility: MosaicControlAccessibility

  private enum CodingKeys: String, CodingKey {
    case type, id, tabBarDirection, tabBarGap, tabBarDistribution, gap, initialTabId, tabs
    case styles, labelTypography, selectedLabelColor, appearance, sizing, outerInsets, motion
    case visibility
    case accessibility
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    type = try c.decode(MosaicLayoutNodeKind.self, forKey: .type)
    id = try c.decode(String.self, forKey: .id)
    tabBarDirection = try c.decode(MosaicStackDirection.self, forKey: .tabBarDirection)
    tabBarGap = try c.decode(Double.self, forKey: .tabBarGap)
    tabBarDistribution = try c.decode(
      MosaicMainAxisDistribution.self, forKey: .tabBarDistribution)
    gap = try c.decode(Double.self, forKey: .gap)
    initialTabId = try c.decode(String.self, forKey: .initialTabId)
    tabs = try c.decode([MosaicTabsEntry].self, forKey: .tabs)
    styles = try c.decode(MosaicSelectionStyles.self, forKey: .styles)
    labelTypography = try c.decode(MosaicTypography.self, forKey: .labelTypography)
    selectedLabelColor = try c.decode(MosaicColor.self, forKey: .selectedLabelColor)
    appearance = try c.decodeIfPresent(MosaicBoxAppearance.self, forKey: .appearance)
    sizing = try c.decodeIfPresent(MosaicBoxSizing.self, forKey: .sizing)
    outerInsets = try c.decodeIfPresent(MosaicEdgeInsets.self, forKey: .outerInsets)
    motion = try c.decodeIfPresent(MosaicMotion.self, forKey: .motion)
    visibility = try c.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
    accessibility = try c.decode(MosaicControlAccessibility.self, forKey: .accessibility)
  }

  public func tab(id tabID: String) -> MosaicTabsEntry? {
    tabs.first { $0.id == tabID }
  }
}

// MARK: - Timeline

public enum MosaicTimelineOrientation: String, Decodable, Sendable { case vertical }

public enum MosaicTimelineConnectorStyle: String, Decodable, Sendable { case solid, dashed }

public struct MosaicTimelineConnector: Decodable, Sendable, Equatable {
  public let color: MosaicColor
  public let width: Double
  public let style: MosaicTimelineConnectorStyle
}

/// The glyph rendered beside a Feature List item or at a Timeline entry's
/// position on the connector.
///
/// A closed union: an unrecognised `kind` rejects the document rather than
/// rendering an arbitrary substitute. `0.4` consolidated the two component
/// vocabularies onto this one, so a Feature List can finally express a negated
/// item — "not included" on a comparison paywall — which the single `"checkmark"`
/// constant `0.3` carried could not.
public enum MosaicMarker: Decodable, Sendable, Equatable {
  case dot
  /// The item's or entry's 1-based position, formatted by the platform's locale
  /// number formatting.
  case ordinal
  case icon(name: MosaicIconName)

  private enum CodingKeys: String, CodingKey { case kind, name }
  private enum Kind: String, Decodable { case dot, ordinal, icon }

  public init(from decoder: any Decoder) throws {
    // `0.3` authors a Feature List marker as the bare string `"checkmark"`.
    // Accepting it here is what lets one renderer draw both contracts: it is
    // the same glyph the `0.4` icon arm names, so the rendering is identical
    // and neither version needs a second marker type.
    if let raw = try? decoder.singleValueContainer().decode(String.self) {
      guard raw == MosaicIconName.checkmark.rawValue else {
        throw DecodingError.dataCorrupted(
          .init(
            codingPath: decoder.codingPath,
            debugDescription: "Protocol 0.3 admits only the checkmark marker."
          )
        )
      }
      self = .icon(name: .checkmark)
      return
    }
    let c = try decoder.container(keyedBy: CodingKeys.self)
    switch try c.decode(Kind.self, forKey: .kind) {
    case .dot: self = .dot
    case .ordinal: self = .ordinal
    case .icon: self = .icon(name: try c.decode(MosaicIconName.self, forKey: .name))
    }
  }
}

/// `0.3` named this type for Timeline alone. It is an alias rather than a second
/// declaration so the two components cannot drift apart again.
public typealias MosaicTimelineMarker = MosaicMarker

public struct MosaicTimelineEntry: Decodable, Sendable, Equatable, Identifiable {
  public let id: String
  public let title: MosaicLocalizedText
  /// Absent means this entry has a title and nothing else. The renderer draws
  /// no empty second line and reserves no space for one.
  public let description: MosaicLocalizedText?
  /// Absent means this entry carries no glyph and the connector runs unbroken
  /// through its position. It is not a request for a default marker.
  public let marker: MosaicTimelineMarker?
}

/// An ordered sequence of steps. Array order is the sequence order and carries
/// meaning; renderers must not reorder.
public struct MosaicTimelineComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let orientation: MosaicTimelineOrientation
  public let gap: Double
  public let connector: MosaicTimelineConnector
  public let entries: [MosaicTimelineEntry]
  /// Required when at least one entry declares a marker and forbidden when none
  /// does; the semantic validator enforces both directions.
  public let markerColor: MosaicColor?
  public let markerSize: Double?
  public let titleTypography: MosaicTypography
  /// Required when at least one entry declares a description and forbidden when
  /// none does.
  public let descriptionTypography: MosaicTypography?
  public let appearance: MosaicBoxAppearance?
  public let sizing: MosaicBoxSizing?
  public let outerInsets: MosaicEdgeInsets?
  public let motion: MosaicMotion?
  public let visibility: MosaicVisibility
  public let accessibility: MosaicControlAccessibility

  private enum CodingKeys: String, CodingKey {
    case type, id, orientation, gap, connector, entries, markerColor, markerSize
    case titleTypography, descriptionTypography, appearance, sizing, outerInsets, motion, visibility
    case accessibility
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    type = try c.decode(MosaicLayoutNodeKind.self, forKey: .type)
    id = try c.decode(String.self, forKey: .id)
    orientation = try c.decode(MosaicTimelineOrientation.self, forKey: .orientation)
    gap = try c.decode(Double.self, forKey: .gap)
    connector = try c.decode(MosaicTimelineConnector.self, forKey: .connector)
    entries = try c.decode([MosaicTimelineEntry].self, forKey: .entries)
    markerColor = try c.decodeIfPresent(MosaicColor.self, forKey: .markerColor)
    markerSize = try c.decodeIfPresent(Double.self, forKey: .markerSize)
    titleTypography = try c.decode(MosaicTypography.self, forKey: .titleTypography)
    descriptionTypography = try c.decodeIfPresent(
      MosaicTypography.self, forKey: .descriptionTypography)
    appearance = try c.decodeIfPresent(MosaicBoxAppearance.self, forKey: .appearance)
    sizing = try c.decodeIfPresent(MosaicBoxSizing.self, forKey: .sizing)
    outerInsets = try c.decodeIfPresent(MosaicEdgeInsets.self, forKey: .outerInsets)
    motion = try c.decodeIfPresent(MosaicMotion.self, forKey: .motion)
    visibility = try c.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
    accessibility = try c.decode(MosaicControlAccessibility.self, forKey: .accessibility)
  }

  public var consumesMarkerStyle: Bool { entries.contains { $0.marker != nil } }
  public var consumesDescriptionTypography: Bool { entries.contains { $0.description != nil } }
}

// MARK: - Award

/// The visual mark accompanying an award. A closed two-arm union over the
/// existing image-asset and icon vocabularies; no third form is inferred.
public enum MosaicAwardEmblem: Decodable, Sendable, Equatable {
  case image(assetId: String, size: Double)
  case icon(name: MosaicIconName, size: Double, color: MosaicColor)

  private enum CodingKeys: String, CodingKey { case type, assetId, name, size, color }
  private enum Kind: String, Decodable { case image, icon }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    switch try c.decode(Kind.self, forKey: .type) {
    case .image:
      self = .image(
        assetId: try c.decode(String.self, forKey: .assetId),
        size: try c.decode(Double.self, forKey: .size)
      )
    case .icon:
      self = .icon(
        name: try c.decode(MosaicIconName.self, forKey: .name),
        size: try c.decode(Double.self, forKey: .size),
        color: try c.decode(MosaicColor.self, forKey: .color)
      )
    }
  }

  public var imageAssetID: String? {
    guard case .image(let assetID, _) = self else { return nil }
    return assetID
  }
}

/// A recognition or accolade. Passive: no action and no runtime state.
public struct MosaicAwardComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let direction: MosaicStackDirection
  public let gap: Double
  public let crossAxisAlignment: MosaicHorizontalAlignment
  /// Absent means the award renders its text alone. It is not a request for a
  /// generic badge. The emblem is always decorative: the title already carries
  /// the award's meaning.
  public let emblem: MosaicAwardEmblem?
  public let title: MosaicLocalizedText
  public let titleTypography: MosaicTypography
  /// Absent means the award has a title and nothing else. `subtitle` and
  /// `subtitleTypography` are mutually required.
  public let subtitle: MosaicLocalizedText?
  public let subtitleTypography: MosaicTypography?
  public let appearance: MosaicBoxAppearance?
  public let sizing: MosaicBoxSizing?
  public let outerInsets: MosaicEdgeInsets?
  public let motion: MosaicMotion?
  public let visibility: MosaicVisibility
  public let accessibility: MosaicControlAccessibility

  private enum CodingKeys: String, CodingKey {
    case type, id, direction, gap, crossAxisAlignment, emblem, title, titleTypography
    case subtitle, subtitleTypography, appearance, sizing, outerInsets, motion, visibility
    case accessibility
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    type = try c.decode(MosaicLayoutNodeKind.self, forKey: .type)
    id = try c.decode(String.self, forKey: .id)
    direction = try c.decode(MosaicStackDirection.self, forKey: .direction)
    gap = try c.decode(Double.self, forKey: .gap)
    crossAxisAlignment = try c.decode(
      MosaicHorizontalAlignment.self, forKey: .crossAxisAlignment)
    emblem = try c.decodeIfPresent(MosaicAwardEmblem.self, forKey: .emblem)
    title = try c.decode(MosaicLocalizedText.self, forKey: .title)
    titleTypography = try c.decode(MosaicTypography.self, forKey: .titleTypography)
    subtitle = try c.decodeIfPresent(MosaicLocalizedText.self, forKey: .subtitle)
    subtitleTypography = try c.decodeIfPresent(
      MosaicTypography.self, forKey: .subtitleTypography)
    appearance = try c.decodeIfPresent(MosaicBoxAppearance.self, forKey: .appearance)
    sizing = try c.decodeIfPresent(MosaicBoxSizing.self, forKey: .sizing)
    outerInsets = try c.decodeIfPresent(MosaicEdgeInsets.self, forKey: .outerInsets)
    motion = try c.decodeIfPresent(MosaicMotion.self, forKey: .motion)
    visibility = try c.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
    accessibility = try c.decode(MosaicControlAccessibility.self, forKey: .accessibility)
  }
}

// MARK: - Social Proof

public enum MosaicSocialProofRatingSymbol: String, Decodable, Sendable { case star }

public enum MosaicSocialProofRatingStep: String, Decodable, Sendable {
  case whole
  case half

  /// How many steps one shown symbol is worth.
  public var stepsPerPoint: Int {
    switch self {
    case .whole: 1
    case .half: 2
    }
  }
}

/// A bounded, integer-only rating.
///
/// `value` counts **steps**, not points: with `step` `half` and `maximum` 5, a
/// `value` of 9 is four and a half out of five. Integers are used throughout so
/// four runtimes cannot round one fraction four ways, and nothing here converts
/// to a floating-point intermediate.
public struct MosaicSocialProofRating: Decodable, Sendable, Equatable {
  public let symbol: MosaicSocialProofRatingSymbol
  public let value: Int
  public let maximum: Int
  public let step: MosaicSocialProofRatingStep
  public let size: Double
  public let filledColor: MosaicColor
  public let emptyColor: MosaicColor

  /// The largest `value` this scale admits. A `value` above it rejects the
  /// document.
  public var maximumSteps: Int { maximum * step.stepsPerPoint }

  /// How many steps the symbol at `index` has earned, in `0...stepsPerPoint`.
  public func steps(atSymbol index: Int) -> Int {
    let perPoint = step.stepsPerPoint
    let earned = value - index * perPoint
    return min(max(earned, 0), perPoint)
  }
}

public struct MosaicSocialProofAvatar: Decodable, Sendable, Equatable {
  public let assetId: String
  public let size: Double
}

/// A localization key the protocol reads directly rather than a component
/// referencing it.
///
/// A renderer must never compose an accessibility phrase from a string literal
/// in any language: the fallback audit found hardcoded English shipping to
/// production. These keys are how the phrasing is authored and translated
/// instead. Presence is enforced in both directions — required when the
/// document contains the feature that reads the key, forbidden when it does
/// not — so a key can neither be missing where it is announced nor linger where
/// nothing reads it.
public enum MosaicReservedAccessibilityKey: String, CaseIterable, Sendable {
  case rating = "mosaic.a11y.rating"
  case inProgress = "mosaic.a11y.in_progress"

  /// Placeholders that must each appear exactly once in every declared
  /// translation. A translation that drops one silently announces a rating with
  /// no number in it.
  public var placeholders: [String] {
    switch self {
    case .rating: ["{{ rating.value }}", "{{ rating.maximum }}"]
    case .inProgress: []
    }
  }

  public var consumer: String {
    switch self {
    case .rating: "a Social Proof rating"
    case .inProgress: "Button in-progress content"
    }
  }
}

/// How a Social Proof rating is announced.
///
/// `0.3` states the announcement as "*value* out of *maximum*", which cannot be
/// implemented literally: `value` counts steps and `maximum` counts points, so
/// announcing `value` directly says "9 out of 5" for a four-and-a-half of five
/// review. The protocol resolves this with the reserved, authored, translated
/// `mosaic.a11y.rating` template and an exact steps-to-points conversion.
public enum MosaicSocialProofRatingAnnouncement {
  /// The rating in points, as substituted into `{{ rating.value }}`.
  ///
  /// Deliberately locale-independent: ASCII digits, `.` as the decimal
  /// separator, no grouping, and one fraction digit only for a half step. Three
  /// renderers must produce the same bytes for the shared conformance vectors
  /// to mean anything, and platform number formatters disagree about fraction
  /// digits and separators across OS versions. All locale variation lives in
  /// the authored template instead. The conversion never rounds: `value` is an
  /// integer and a point is worth one or two steps, so the result is always a
  /// whole number or a whole number and a half.
  public static func points(_ rating: MosaicSocialProofRating) -> String {
    let stepsPerPoint = rating.step.stepsPerPoint
    let whole = rating.value / stepsPerPoint
    let remainder = rating.value % stepsPerPoint
    return remainder == 0 ? String(whole) : "\(whole).5"
  }

  public static func maximumPoints(_ rating: MosaicSocialProofRating) -> String {
    String(rating.maximum)
  }

  /// The exact string announced for a rating.
  ///
  /// `template` is the resolved `mosaic.a11y.rating` string for the resolved
  /// catalog locale. Substitution is closed to the two reserved placeholders;
  /// the template is authored copy and nothing else in it is interpreted.
  ///
  /// Returns `nil` when the template is absent or does not carry both
  /// placeholders. The caller announces nothing and diagnoses rather than
  /// inventing a phrase in a language it cannot know.
  public static func text(
    for rating: MosaicSocialProofRating,
    template: String?
  ) -> String? {
    guard let template else { return nil }
    for placeholder in MosaicReservedAccessibilityKey.rating.placeholders
    where !template.contains(placeholder) {
      return nil
    }
    return
      template
      .replacingOccurrences(of: "{{ rating.value }}", with: points(rating))
      .replacingOccurrences(of: "{{ rating.maximum }}", with: maximumPoints(rating))
  }
}

/// A testimonial: an attributed quotation, optionally rated and optionally
/// illustrated. Passive: no action and no runtime state.
public struct MosaicSocialProofComponent: Decodable, Sendable, Equatable, Identifiable {
  public let type: MosaicLayoutNodeKind
  public let id: String
  public let gap: Double
  public let quote: MosaicLocalizedText
  public let quoteTypography: MosaicTypography
  /// Required: an unattributed testimonial is not social proof, and a renderer
  /// must never be left to invent or omit the source.
  public let attribution: MosaicLocalizedText
  public let attributionTypography: MosaicTypography
  /// Absent means this testimonial carries no rating and no symbols are drawn.
  /// It is neither a zero rating nor an unknown rating.
  public let rating: MosaicSocialProofRating?
  /// Absent means no avatar is drawn and no space is reserved for one.
  public let avatar: MosaicSocialProofAvatar?
  public let appearance: MosaicBoxAppearance?
  public let sizing: MosaicBoxSizing?
  public let outerInsets: MosaicEdgeInsets?
  public let motion: MosaicMotion?
  public let visibility: MosaicVisibility
  public let accessibility: MosaicControlAccessibility

  private enum CodingKeys: String, CodingKey {
    case type, id, gap, quote, quoteTypography, attribution, attributionTypography, rating
    case avatar, appearance, sizing, outerInsets, motion, visibility, accessibility
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    type = try c.decode(MosaicLayoutNodeKind.self, forKey: .type)
    id = try c.decode(String.self, forKey: .id)
    gap = try c.decode(Double.self, forKey: .gap)
    quote = try c.decode(MosaicLocalizedText.self, forKey: .quote)
    quoteTypography = try c.decode(MosaicTypography.self, forKey: .quoteTypography)
    attribution = try c.decode(MosaicLocalizedText.self, forKey: .attribution)
    attributionTypography = try c.decode(
      MosaicTypography.self, forKey: .attributionTypography)
    rating = try c.decodeIfPresent(MosaicSocialProofRating.self, forKey: .rating)
    avatar = try c.decodeIfPresent(MosaicSocialProofAvatar.self, forKey: .avatar)
    appearance = try c.decodeIfPresent(MosaicBoxAppearance.self, forKey: .appearance)
    sizing = try c.decodeIfPresent(MosaicBoxSizing.self, forKey: .sizing)
    outerInsets = try c.decodeIfPresent(MosaicEdgeInsets.self, forKey: .outerInsets)
    motion = try c.decodeIfPresent(MosaicMotion.self, forKey: .motion)
    visibility = try c.decodeIfPresent(MosaicVisibility.self, forKey: .visibility) ?? .always
    accessibility = try c.decode(MosaicControlAccessibility.self, forKey: .accessibility)
  }
}
