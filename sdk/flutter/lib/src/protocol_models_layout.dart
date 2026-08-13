part of 'protocol.dart';

sealed class MosaicNode {
  const MosaicNode({required this.id, this.motion});

  final String id;

  /// Authored Protocol 0.4 motion, or `null` for a node that declares none and
  /// for every node of a document.
  ///
  /// Motion never reaches the accessibility tree: a node mid-entrance is
  /// already present, focusable, and announceable, and a pulsing button
  /// announces exactly what a static one announces.
  final MosaicNodeMotion? motion;

  String get type;
}

final class MosaicScrollContainer extends MosaicNode {
  const MosaicScrollContainer({
    required super.id,
    required this.showsIndicators,
    required this.content,
    this.background,
  });

  final bool showsIndicators;
  final MosaicStackComponent content;
  final MosaicBackground? background;

  @override
  String get type => 'scrollContainer';
}

sealed class MosaicStackNode extends MosaicNode {
  const MosaicStackNode({required super.id, super.motion});

  List<MosaicNode> get children;
  MosaicEdgeInsets get padding;
  double get gap;
}

/// Protocol 0.4 generalized Stack.
final class MosaicStackComponent extends MosaicStackNode {
  MosaicStackComponent({
    required super.id,
    required this.direction,
    required this.gap,
    required this.padding,
    required this.mainAxisDistribution,
    required this.crossAxisAlignment,
    required Iterable<MosaicNode> children,
    this.appearance,
    this.sizing,
    this.outerInsets,
    this.visibility = const MosaicAlwaysVisible(),
    super.motion,
  }) : children = List.unmodifiable(children);

  final MosaicStackDirection direction;
  @override
  final double gap;
  @override
  final MosaicEdgeInsets padding;
  final MosaicMainAxisDistribution mainAxisDistribution;
  final MosaicStackHorizontalAlignment crossAxisAlignment;
  @override
  final List<MosaicNode> children;
  final MosaicBoxAppearance? appearance;
  final MosaicSizing? sizing;
  final MosaicEdgeInsets? outerInsets;
  final MosaicVisibility visibility;

  @override
  String get type => 'stack';
}

sealed class MosaicComponent extends MosaicNode {
  const MosaicComponent({required super.id, super.motion});
}

final class MosaicTextAccessibility {
  const MosaicTextAccessibility({required this.role, this.level, this.label});

  final MosaicTextAccessibilityRole role;
  final int? level;
  final MosaicLocalizedText? label;
}

final class MosaicImageAccessibility {
  const MosaicImageAccessibility({required this.hidden, this.label});

  final bool hidden;
  final MosaicLocalizedText? label;
}

final class MosaicControlAccessibility {
  const MosaicControlAccessibility({required this.label, this.hint});

  final MosaicLocalizedText label;
  final MosaicLocalizedText? hint;
}

final class MosaicTextComponent extends MosaicComponent {
  const MosaicTextComponent({
    required super.id,
    required this.value,
    required this.style,
    required this.alignment,
    required this.accessibility,
    this.typography,
    this.appearance,
    this.sizing,
    this.outerInsets,
    this.visibility = const MosaicAlwaysVisible(),
    super.motion,
  });

  final MosaicLocalizedText value;
  final MosaicTextStyle style;
  final MosaicTextAlignment alignment;
  final MosaicTextAccessibility accessibility;
  final MosaicTypography? typography;
  final MosaicBoxAppearance? appearance;
  final MosaicSizing? sizing;
  final MosaicEdgeInsets? outerInsets;
  final MosaicVisibility visibility;

  @override
  String get type => 'text';
}

final class MosaicImageComponent extends MosaicComponent {
  const MosaicImageComponent({
    required super.id,
    required this.assetId,
    required this.aspectRatio,
    required this.contentMode,
    required this.accessibility,
    this.fixedHeight,
    this.width,
    this.sizing,
    this.appearance,
    this.outerInsets,
    this.visibility = const MosaicAlwaysVisible(),
    super.motion,
  });

  final String assetId;
  final double? aspectRatio;
  final double? fixedHeight;
  final MosaicSizingValue? width;
  final MosaicSizing? sizing;
  final MosaicImageContentMode contentMode;
  final MosaicImageAccessibility accessibility;
  final MosaicBoxAppearance? appearance;
  final MosaicEdgeInsets? outerInsets;
  final MosaicVisibility visibility;

  @override
  String get type => 'image';
}

final class MosaicFeatureListItem {
  const MosaicFeatureListItem({
    required this.id,
    required this.text,
    this.marker,
  });

  final String id;
  final MosaicLocalizedText text;

  /// Overrides the list's marker for this item only, from Protocol 0.4.
  ///
  /// Absent means the item carries the list's marker. It is never a request
  /// for no glyph — a negated item is authored as an item-level icon marker,
  /// not as an absent one.
  final MosaicMarker? marker;

  /// The glyph this item draws, given its list's default.
  MosaicMarker resolveMarker(MosaicMarker listMarker) => marker ?? listMarker;
}

final class MosaicFeatureListComponent extends MosaicComponent {
  MosaicFeatureListComponent({
    required super.id,
    required this.itemSpacing,
    required Iterable<MosaicFeatureListItem> items,
    required this.accessibility,
    required this.typography,
    this.marker = const MosaicIconMarker(MosaicIconName.checkmark),
    this.markerColor,
    this.markerSize,
    this.appearance,
    this.sizing,
    this.outerInsets,
    this.visibility = const MosaicAlwaysVisible(),
    super.motion,
  }) : items = List.unmodifiable(items);

  final double itemSpacing;
  final List<MosaicFeatureListItem> items;
  final MosaicControlAccessibility accessibility;

  /// The glyph every item carries unless the item overrides it.
  ///
  /// Protocol 0.4 authors this as the single constant `"checkmark"`, which is
  /// exactly this default, so both versions read through one field. Marker
  /// colour and size stay component-level, as they are on Timeline.
  final MosaicMarker marker;
  final MosaicColorValue? markerColor;

  /// The authored glyph extent, from Protocol 0.4, or `null` when the list
  /// leaves it to the default.
  ///
  /// Mirrors Timeline's `markerSize` — the same positive logical size, bounded
  /// the same way — but is optional rather than conditionally required,
  /// because a Feature List always declares a marker and so always has a size
  /// to fall back on. Read [resolvedMarkerSize] to draw; this field stays
  /// nullable so an authored size remains distinguishable from a defaulted
  /// one.
  final double? markerSize;

  /// Required by the protocol on every Feature List, and so non-null here.
  ///
  /// [resolvedMarkerSize] reads its `fontSize`, which is what makes the
  /// default an authored value on this same component rather than a constant
  /// each renderer picks for itself.
  final MosaicTypography typography;
  final MosaicBoxAppearance? appearance;
  final MosaicSizing? sizing;
  final MosaicEdgeInsets? outerInsets;
  final MosaicVisibility visibility;

  /// The glyph extent to draw: the authored [markerSize], or the schema's
  /// documented default of the list's own `typography.fontSize`.
  ///
  /// The fallback is deliberately not a renderer constant. Flutter drew a
  /// hardcoded 20 before `0.4` made the field authorable, which is exactly the
  /// per-platform divergence naming a default on the same component removes.
  double get resolvedMarkerSize => markerSize ?? typography.fontSize;

  @override
  String get type => 'featureList';
}

final class MosaicUnavailableProductFallback {
  const MosaicUnavailableProductFallback({required this.message});

  final MosaicLocalizedText message;
}

final class MosaicSelectionStateStyle {
  const MosaicSelectionStateStyle({
    required this.background,
    required this.border,
    required this.cornerRadius,
    required this.padding,
    required this.opacity,
    this.shadow,
  });

  final MosaicBackground background;
  final MosaicBorderStyle border;
  final double cornerRadius;
  final MosaicEdgeInsets padding;
  final double opacity;
  final MosaicShadow? shadow;
}

/// Presence-aware, recursive Protocol 0.4 Selected overrides.
///
/// Shared by every two-state selectable box: Product Card, Product Badge, and
/// the Tabs tab controls.
///
/// Nullable fields are absent overrides, never serialized `null` values.
final class MosaicSelectionStateStyleOverride {
  const MosaicSelectionStateStyleOverride({
    this.background,
    this.borderColor,
    this.borderWidth,
    this.cornerRadius,
    this.paddingTop,
    this.paddingStart,
    this.paddingBottom,
    this.paddingEnd,
    this.opacity,
    this.shadow,
  });

  final MosaicBackground? background;
  final MosaicColorValue? borderColor;
  final double? borderWidth;
  final double? cornerRadius;
  final double? paddingTop;
  final double? paddingStart;
  final double? paddingBottom;
  final double? paddingEnd;
  final double? opacity;
  final MosaicShadow? shadow;

  MosaicSelectionStateStyle resolve(MosaicSelectionStateStyle base) =>
      MosaicSelectionStateStyle(
        background: background ?? base.background,
        border: MosaicBorderStyle(
          color: borderColor ?? base.border.color,
          width: borderWidth ?? base.border.width,
        ),
        cornerRadius: cornerRadius ?? base.cornerRadius,
        padding: MosaicEdgeInsets(
          top: paddingTop ?? base.padding.top,
          start: paddingStart ?? base.padding.start,
          bottom: paddingBottom ?? base.padding.bottom,
          end: paddingEnd ?? base.padding.end,
        ),
        opacity: opacity ?? base.opacity,
        shadow: shadow ?? base.shadow,
      );
}

final class MosaicSelectionStyles {
  const MosaicSelectionStyles({
    required this.defaultStyle,
    required this.selectedOverride,
  });

  final MosaicSelectionStateStyle defaultStyle;
  final MosaicSelectionStateStyleOverride selectedOverride;

  MosaicSelectionStateStyle resolve({required bool selected}) =>
      selected ? selectedOverride.resolve(defaultStyle) : defaultStyle;
}

sealed class MosaicProductBadgePlacement {
  const MosaicProductBadgePlacement();
}

final class MosaicNestedProductBadgePlacement
    extends MosaicProductBadgePlacement {
  const MosaicNestedProductBadgePlacement();
}

final class MosaicOverlayProductBadgePlacement
    extends MosaicProductBadgePlacement {
  const MosaicOverlayProductBadgePlacement({
    required this.anchor,
    required this.inset,
  });

  final MosaicProductBadgeAnchor anchor;
  final double inset;
}

/// Authored passive Product Badge structure owned directly by a Product Card.
final class MosaicProductBadgeComponent extends MosaicComponent {
  MosaicProductBadgeComponent({
    required super.id,
    required this.placement,
    required this.direction,
    required this.gap,
    required this.mainAxisDistribution,
    required this.crossAxisAlignment,
    required Iterable<MosaicNode> children,
    required this.styles,
    this.sizing,
    super.motion,
  }) : children = List.unmodifiable(children);

  final MosaicProductBadgePlacement placement;
  final MosaicStackDirection direction;
  final double gap;
  final MosaicMainAxisDistribution mainAxisDistribution;
  final MosaicStackHorizontalAlignment crossAxisAlignment;
  final List<MosaicNode> children;
  final MosaicSelectionStyles styles;
  final MosaicSizing? sizing;

  @override
  String get type => 'productBadge';
}

/// One authored, provider-bound selectable layer inside a Product Selector.
final class MosaicProductCardComponent extends MosaicComponent {
  MosaicProductCardComponent({
    required super.id,
    required this.productReferenceId,
    required this.direction,
    required this.gap,
    required this.mainAxisDistribution,
    required this.crossAxisAlignment,
    required Iterable<MosaicNode> children,
    required this.styles,
    this.accessibilityLabel,
    this.sizing,
    super.motion,
  }) : children = List.unmodifiable(children);

  final String productReferenceId;
  final MosaicStackDirection direction;
  final double gap;
  final MosaicMainAxisDistribution mainAxisDistribution;
  final MosaicStackHorizontalAlignment crossAxisAlignment;
  final List<MosaicNode> children;
  final MosaicSelectionStyles styles;
  final MosaicLocalizedText? accessibilityLabel;
  final MosaicSizing? sizing;

  MosaicProductBadgeComponent? get badge {
    for (final child in children) {
      if (child is MosaicProductBadgeComponent) return child;
    }
    return null;
  }

  @override
  String get type => 'productCard';
}

final class MosaicProductSelectorComponent extends MosaicComponent {
  MosaicProductSelectorComponent({
    required super.id,
    Iterable<MosaicProductCardComponent> cards =
        const <MosaicProductCardComponent>[],
    this.initialProductCardId,
    required this.itemSpacing,
    required this.unavailableFallback,
    required this.accessibility,
    this.direction = MosaicProductSelectorDirection.vertical,
    this.crossAxisAlignment = MosaicStackHorizontalAlignment.stretch,
    this.appearance,
    this.sizing,
    this.outerInsets,
    this.visibility = const MosaicAlwaysVisible(),
    super.motion,
  }) : cards = List.unmodifiable(cards);

  final List<MosaicProductCardComponent> cards;
  final String? initialProductCardId;
  final double itemSpacing;
  final MosaicUnavailableProductFallback unavailableFallback;
  final MosaicControlAccessibility accessibility;
  final MosaicProductSelectorDirection direction;
  final MosaicStackHorizontalAlignment crossAxisAlignment;
  final MosaicBoxAppearance? appearance;
  final MosaicSizing? sizing;
  final MosaicEdgeInsets? outerInsets;
  final MosaicVisibility visibility;

  @override
  String get type => 'productSelector';
}
