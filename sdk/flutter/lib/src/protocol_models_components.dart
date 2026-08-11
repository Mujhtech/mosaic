part of 'protocol.dart';

sealed class MosaicAction {
  const MosaicAction();

  String get type;
}

final class MosaicPurchaseAction extends MosaicAction {
  const MosaicPurchaseAction({required this.productSelectorId});

  final String productSelectorId;

  @override
  String get type => 'purchase';
}

final class MosaicRestoreAction extends MosaicAction {
  const MosaicRestoreAction();

  @override
  String get type => 'restore';
}

final class MosaicCloseAction extends MosaicAction {
  const MosaicCloseAction();

  @override
  String get type => 'close';
}

final class MosaicNavigateToAction extends MosaicAction {
  const MosaicNavigateToAction({required this.screenId});

  final String screenId;

  @override
  String get type => 'navigateTo';
}

final class MosaicNavigateBackAction extends MosaicAction {
  const MosaicNavigateBackAction();

  @override
  String get type => 'navigateBack';
}

final class MosaicOpenExternalUrlAction extends MosaicAction {
  const MosaicOpenExternalUrlAction({required this.url});

  final Uri url;

  @override
  String get type => 'openExternalUrl';
}

/// Protocol 0.3's single native control container.
final class MosaicButtonComponent extends MosaicComponent {
  MosaicButtonComponent({
    required super.id,
    required this.direction,
    required this.gap,
    required this.mainAxisDistribution,
    required this.crossAxisAlignment,
    required Iterable<MosaicNode> children,
    required this.action,
    required this.accessibility,
    Iterable<MosaicNode>? inProgressChildren,
    this.appearance,
    this.sizing,
    this.outerInsets,
    this.visibility = const MosaicAlwaysVisible(),
    super.motion,
  })  : children = List.unmodifiable(children),
        inProgressChildren = inProgressChildren == null
            ? null
            : List.unmodifiable(inProgressChildren);

  final MosaicStackDirection direction;
  final double gap;
  final MosaicMainAxisDistribution mainAxisDistribution;
  final MosaicStackHorizontalAlignment crossAxisAlignment;
  final List<MosaicNode> children;
  final List<MosaicNode>? inProgressChildren;
  final MosaicAction action;
  final MosaicControlAccessibility accessibility;
  final MosaicBoxAppearance? appearance;
  final MosaicSizing? sizing;
  final MosaicEdgeInsets? outerInsets;
  final MosaicVisibility visibility;

  @override
  String get type => 'button';
}

final class MosaicIconComponent extends MosaicComponent {
  const MosaicIconComponent({
    required super.id,
    required this.name,
    required this.size,
    required this.color,
    required this.accessibility,
    this.appearance,
    this.sizing,
    this.outerInsets,
    this.visibility = const MosaicAlwaysVisible(),
    super.motion,
  });

  final MosaicIconName name;
  final double size;
  final MosaicColorValue color;
  final MosaicImageAccessibility accessibility;
  final MosaicBoxAppearance? appearance;
  final MosaicSizing? sizing;
  final MosaicEdgeInsets? outerInsets;
  final MosaicVisibility visibility;

  bool get mirrorsInRightToLeft => switch (name) {
        MosaicIconName.arrowBackward ||
        MosaicIconName.arrowForward ||
        MosaicIconName.chevronBackward ||
        MosaicIconName.chevronForward =>
          true,
        _ => false,
      };

  @override
  String get type => 'icon';
}

final class MosaicCarouselPage {
  const MosaicCarouselPage({
    required this.id,
    required this.accessibilityLabel,
    required this.content,
  });

  final String id;
  final MosaicLocalizedText accessibilityLabel;
  final MosaicStackComponent content;
}

final class MosaicCarouselComponent extends MosaicComponent {
  MosaicCarouselComponent({
    required super.id,
    required this.initialPageIndex,
    required this.showsIndicators,
    required Iterable<MosaicCarouselPage> pages,
    required this.accessibility,
    this.appearance,
    this.sizing,
    this.outerInsets,
    this.visibility = const MosaicAlwaysVisible(),
    super.motion,
  }) : pages = List.unmodifiable(pages);

  final int initialPageIndex;
  final bool showsIndicators;
  final List<MosaicCarouselPage> pages;
  final MosaicControlAccessibility accessibility;
  final MosaicBoxAppearance? appearance;
  final MosaicSizing? sizing;
  final MosaicEdgeInsets? outerInsets;
  final MosaicVisibility visibility;

  @override
  String get type => 'carousel';
}

final class MosaicSwitchComponent extends MosaicComponent {
  const MosaicSwitchComponent({
    required super.id,
    required this.label,
    required this.initialValue,
    required this.typography,
    required this.offTrackColor,
    required this.onTrackColor,
    required this.thumbColor,
    required this.accessibility,
    this.appearance,
    this.sizing,
    this.outerInsets,
    this.visibility = const MosaicAlwaysVisible(),
    super.motion,
  });

  final MosaicLocalizedText label;
  final bool initialValue;
  final MosaicTypography typography;
  final MosaicColorValue offTrackColor;
  final MosaicColorValue onTrackColor;
  final MosaicColorValue thumbColor;
  final MosaicControlAccessibility accessibility;
  final MosaicBoxAppearance? appearance;
  final MosaicSizing? sizing;
  final MosaicEdgeInsets? outerInsets;
  final MosaicVisibility visibility;

  @override
  String get type => 'switch';
}

final class MosaicCountdownComponent extends MosaicComponent {
  const MosaicCountdownComponent({
    required super.id,
    required this.endsAt,
    required this.largestUnit,
    required this.smallestUnit,
    required this.completedText,
    required this.typography,
    required this.accessibility,
    this.appearance,
    this.sizing,
    this.outerInsets,
    this.visibility = const MosaicAlwaysVisible(),
    super.motion,
  });

  final DateTime endsAt;
  final MosaicCountdownUnit largestUnit;
  final MosaicCountdownUnit smallestUnit;
  final MosaicLocalizedText completedText;
  final MosaicTypography typography;
  final MosaicTextAccessibility accessibility;
  final MosaicBoxAppearance? appearance;
  final MosaicSizing? sizing;
  final MosaicEdgeInsets? outerInsets;
  final MosaicVisibility visibility;

  @override
  String get type => 'countdown';
}

/// One labelled Tabs panel.
///
/// The single [label] names both the tab control and its panel, so the two can
/// never drift apart.
final class MosaicTabsEntry {
  const MosaicTabsEntry({
    required this.id,
    required this.label,
    required this.content,
  });

  final String id;
  final MosaicLocalizedText label;
  final MosaicStackComponent content;
}

/// N labelled panels with exactly one visible at a time.
///
/// The selected tab is runtime state keyed by this component's [id]. It is
/// always authored through [initialTabId]: there is no positional default, so
/// reordering [tabs] cannot change which panel opens.
final class MosaicTabsComponent extends MosaicComponent {
  MosaicTabsComponent({
    required super.id,
    required this.tabBarDirection,
    required this.tabBarGap,
    required this.tabBarDistribution,
    required this.gap,
    required this.initialTabId,
    required Iterable<MosaicTabsEntry> tabs,
    required this.styles,
    required this.labelTypography,
    required this.selectedLabelColor,
    required this.accessibility,
    this.appearance,
    this.sizing,
    this.outerInsets,
    this.visibility = const MosaicAlwaysVisible(),
    super.motion,
  }) : tabs = List.unmodifiable(tabs);

  final MosaicStackDirection tabBarDirection;
  final double tabBarGap;
  final MosaicMainAxisDistribution tabBarDistribution;

  /// Space between the tab bar and the visible panel.
  final double gap;
  final String initialTabId;
  final List<MosaicTabsEntry> tabs;
  final MosaicSelectionStyles styles;
  final MosaicTypography labelTypography;

  /// Always authored, so "the label colour deliberately does not change" and
  /// "the label colour was never authored" cannot share an encoding.
  final MosaicColorValue selectedLabelColor;
  final MosaicControlAccessibility accessibility;
  final MosaicBoxAppearance? appearance;
  final MosaicSizing? sizing;
  final MosaicEdgeInsets? outerInsets;
  final MosaicVisibility visibility;

  MosaicTabsEntry? tab(String id) {
    for (final entry in tabs) {
      if (entry.id == id) return entry;
    }
    return null;
  }

  @override
  String get type => 'tabs';
}

enum MosaicTimelineConnectorStyle { solid, dashed }

final class MosaicTimelineConnector {
  const MosaicTimelineConnector({
    required this.color,
    required this.width,
    required this.style,
  });

  final MosaicColorValue color;
  final double width;
  final MosaicTimelineConnectorStyle style;
}

final class MosaicTimelineEntry {
  const MosaicTimelineEntry({
    required this.id,
    required this.title,
    this.description,
    this.marker,
  });

  final String id;
  final MosaicLocalizedText title;

  /// Absent means this entry has a title and nothing else. The renderer draws
  /// no empty second line and reserves no space for one.
  final MosaicLocalizedText? description;

  /// Absent means this entry carries no glyph and the connector runs unbroken
  /// through its position. It is not a request for a default marker.
  final MosaicMarker? marker;
}

/// An ordered, vertical sequence of steps.
///
/// [entries] order is the sequence order and carries meaning; renderers must
/// not reorder it.
final class MosaicTimelineComponent extends MosaicComponent {
  MosaicTimelineComponent({
    required super.id,
    required this.gap,
    required this.connector,
    required Iterable<MosaicTimelineEntry> entries,
    required this.titleTypography,
    required this.accessibility,
    this.markerColor,
    this.markerSize,
    this.descriptionTypography,
    this.appearance,
    this.sizing,
    this.outerInsets,
    this.visibility = const MosaicAlwaysVisible(),
    super.motion,
  }) : entries = List.unmodifiable(entries);

  final double gap;
  final MosaicTimelineConnector connector;
  final List<MosaicTimelineEntry> entries;
  final MosaicTypography titleTypography;
  final MosaicControlAccessibility accessibility;

  /// Present exactly when at least one entry declares a marker.
  final MosaicColorValue? markerColor;
  final double? markerSize;

  /// Present exactly when at least one entry declares a description.
  final MosaicTypography? descriptionTypography;
  final MosaicBoxAppearance? appearance;
  final MosaicSizing? sizing;
  final MosaicEdgeInsets? outerInsets;
  final MosaicVisibility visibility;

  bool get hasMarkers => entries.any((entry) => entry.marker != null);
  bool get hasDescriptions => entries.any((entry) => entry.description != null);

  @override
  String get type => 'timeline';
}

/// The visual mark accompanying an Award. Always decorative.
sealed class MosaicAwardEmblem {
  const MosaicAwardEmblem();
}

final class MosaicAwardImageEmblem extends MosaicAwardEmblem {
  const MosaicAwardImageEmblem({required this.assetId, required this.size});

  final String assetId;
  final double size;
}

final class MosaicAwardIconEmblem extends MosaicAwardEmblem {
  const MosaicAwardIconEmblem({
    required this.name,
    required this.size,
    required this.color,
  });

  final MosaicIconName name;
  final double size;
  final MosaicColorValue color;
}

/// A recognition or accolade. Passive: no action and no runtime state.
final class MosaicAwardComponent extends MosaicComponent {
  const MosaicAwardComponent({
    required super.id,
    required this.direction,
    required this.gap,
    required this.crossAxisAlignment,
    required this.title,
    required this.titleTypography,
    required this.accessibility,
    this.emblem,
    this.subtitle,
    this.subtitleTypography,
    this.appearance,
    this.sizing,
    this.outerInsets,
    this.visibility = const MosaicAlwaysVisible(),
    super.motion,
  });

  final MosaicStackDirection direction;
  final double gap;
  final MosaicStackHorizontalAlignment crossAxisAlignment;

  /// Absent means the award renders its text alone. It is not a request for a
  /// generic badge.
  final MosaicAwardEmblem? emblem;
  final MosaicLocalizedText title;
  final MosaicTypography titleTypography;

  /// Present exactly together with [subtitleTypography].
  final MosaicLocalizedText? subtitle;
  final MosaicTypography? subtitleTypography;
  final MosaicControlAccessibility accessibility;
  final MosaicBoxAppearance? appearance;
  final MosaicSizing? sizing;
  final MosaicEdgeInsets? outerInsets;
  final MosaicVisibility visibility;

  @override
  String get type => 'award';
}

/// One step per point, or two.
enum MosaicRatingStep { whole, half }

/// A bounded, integer-only rating.
///
/// [value] counts steps, not points, so `value: 9, maximum: 5, step: half` is
/// four and a half out of five. Integers are used throughout so that four
/// runtimes cannot round one fraction four ways.
final class MosaicSocialProofRating {
  const MosaicSocialProofRating({
    required this.value,
    required this.maximum,
    required this.step,
    required this.size,
    required this.filledColor,
    required this.emptyColor,
  });

  final int value;
  final int maximum;
  final MosaicRatingStep step;
  final double size;
  final MosaicColorValue filledColor;
  final MosaicColorValue emptyColor;

  int get stepsPerPoint => step == MosaicRatingStep.half ? 2 : 1;

  /// The largest [value] this scale admits.
  int get maximumSteps => maximum * stepsPerPoint;

  /// Whole symbols drawn filled.
  int get filledPoints => value ~/ stepsPerPoint;

  /// Whether one half symbol follows the filled ones.
  bool get hasHalfPoint => step == MosaicRatingStep.half && value % 2 == 1;

  /// The rating in points, as substituted into `{{ rating.value }}`.
  ///
  /// [value] counts steps while [maximum] counts points, so announcing the two
  /// verbatim would read "9 out of 5" for a four-and-a-half-of-five rating.
  /// The conversion is exact: [value] is an integer and there are one or two
  /// steps per point, so the result is a whole number or a whole number and a
  /// half and never needs rounding.
  ///
  /// The form is deliberately locale-independent — ASCII digits, `.` as the
  /// decimal separator, no grouping, and one fraction digit only for a half
  /// step — so that three renderers produce identical bytes. All locale
  /// variation lives in the authored `mosaic.a11y.rating` template instead.
  String get announcedPoints =>
      hasHalfPoint ? '$filledPoints.5' : '$filledPoints';

  /// The complete announced string for [template].
  ///
  /// [template] is the resolved `mosaic.a11y.rating` catalog string, which
  /// carries all the wording and its localization. Substitution is closed to
  /// the two reserved placeholders; nothing else in the template is
  /// interpreted.
  String announcement(String template) => template
      .replaceAll('{{ rating.value }}', announcedPoints)
      .replaceAll('{{ rating.maximum }}', '$maximum');
}

final class MosaicSocialProofAvatar {
  const MosaicSocialProofAvatar({required this.assetId, required this.size});

  final String assetId;
  final double size;
}

/// An attributed testimonial. Passive: no action and no runtime state.
final class MosaicSocialProofComponent extends MosaicComponent {
  const MosaicSocialProofComponent({
    required super.id,
    required this.gap,
    required this.quote,
    required this.quoteTypography,
    required this.attribution,
    required this.attributionTypography,
    required this.accessibility,
    this.rating,
    this.avatar,
    this.appearance,
    this.sizing,
    this.outerInsets,
    this.visibility = const MosaicAlwaysVisible(),
    super.motion,
  });

  final double gap;
  final MosaicLocalizedText quote;
  final MosaicTypography quoteTypography;

  /// Required: an unattributed testimonial is not social proof.
  final MosaicLocalizedText attribution;
  final MosaicTypography attributionTypography;

  /// Absent means this testimonial carries no rating and no symbols are drawn.
  /// It is neither a zero rating nor an unknown rating.
  final MosaicSocialProofRating? rating;

  /// Absent means no avatar is drawn and no space is reserved for one.
  final MosaicSocialProofAvatar? avatar;
  final MosaicControlAccessibility accessibility;
  final MosaicBoxAppearance? appearance;
  final MosaicSizing? sizing;
  final MosaicEdgeInsets? outerInsets;
  final MosaicVisibility visibility;

  @override
  String get type => 'socialProof';
}

/// Strict native reader for the current protocol contract.
///
/// The JSON Schemas remain canonical under `protocol/`; this reader dispatches
/// by exact version and never migrates, downgrades, or partially renders.
