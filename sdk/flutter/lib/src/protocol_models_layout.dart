part of 'protocol.dart';

sealed class MosaicNode {
  const MosaicNode({required this.id});

  final String id;
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
  final MosaicStackNode content;
  final MosaicBackground? background;

  @override
  String get type => 'scrollContainer';
}

sealed class MosaicStackNode extends MosaicNode {
  const MosaicStackNode({required super.id});

  List<MosaicNode> get children;
  MosaicEdgeInsets get padding;
  double get spacing;
}

final class MosaicVerticalStack extends MosaicStackNode {
  MosaicVerticalStack({
    required super.id,
    required this.spacing,
    required this.padding,
    required this.horizontalAlignment,
    required Iterable<MosaicNode> children,
  }) : children = List.unmodifiable(children);

  final double spacing;
  final MosaicEdgeInsets padding;
  final MosaicStackHorizontalAlignment horizontalAlignment;
  final List<MosaicNode> children;

  @override
  String get type => 'verticalStack';
}

/// Protocol 0.2 generalized Stack.
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
  }) : children = List.unmodifiable(children);

  final MosaicStackDirection direction;
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
  double get spacing => gap;

  @override
  String get type => 'stack';
}

sealed class MosaicComponent extends MosaicNode {
  const MosaicComponent({required super.id});
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
  const MosaicFeatureListItem({required this.id, required this.text});

  final String id;
  final MosaicLocalizedText text;
}

final class MosaicFeatureListComponent extends MosaicComponent {
  MosaicFeatureListComponent({
    required super.id,
    required this.itemSpacing,
    required Iterable<MosaicFeatureListItem> items,
    required this.accessibility,
    this.markerColor,
    this.typography,
    this.appearance,
    this.sizing,
    this.outerInsets,
    this.visibility = const MosaicAlwaysVisible(),
  }) : items = List.unmodifiable(items);

  final double itemSpacing;
  final List<MosaicFeatureListItem> items;
  final MosaicControlAccessibility accessibility;
  final MosaicColorValue? markerColor;
  final MosaicTypography? typography;
  final MosaicBoxAppearance? appearance;
  final MosaicSizing? sizing;
  final MosaicEdgeInsets? outerInsets;
  final MosaicVisibility visibility;

  @override
  String get type => 'featureList';
}

final class MosaicUnavailableProductFallback {
  const MosaicUnavailableProductFallback({required this.message});

  final MosaicLocalizedText message;
}

final class MosaicProductCardStyle {
  const MosaicProductCardStyle({
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

/// Presence-aware, recursive Protocol 0.2 Selected overrides.
///
/// Nullable fields are absent overrides, never serialized `null` values.
final class MosaicProductCardStyleOverride {
  const MosaicProductCardStyleOverride({
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

  MosaicProductCardStyle resolve(MosaicProductCardStyle base) =>
      MosaicProductCardStyle(
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

final class MosaicProductCardStyles {
  const MosaicProductCardStyles({
    required this.defaultStyle,
    required this.selectedOverride,
  });

  final MosaicProductCardStyle defaultStyle;
  final MosaicProductCardStyleOverride selectedOverride;

  MosaicProductCardStyle resolve({required bool selected}) =>
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
  }) : children = List.unmodifiable(children);

  final MosaicProductBadgePlacement placement;
  final MosaicStackDirection direction;
  final double gap;
  final MosaicMainAxisDistribution mainAxisDistribution;
  final MosaicStackHorizontalAlignment crossAxisAlignment;
  final List<MosaicNode> children;
  final MosaicProductCardStyles styles;
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
  }) : children = List.unmodifiable(children);

  final String productReferenceId;
  final MosaicStackDirection direction;
  final double gap;
  final MosaicMainAxisDistribution mainAxisDistribution;
  final MosaicStackHorizontalAlignment crossAxisAlignment;
  final List<MosaicNode> children;
  final MosaicProductCardStyles styles;
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
    Iterable<String> productReferenceIds = const <String>[],
    this.initiallySelectedProductReferenceId,
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
  })  : productReferenceIds = List.unmodifiable(productReferenceIds),
        cards = List.unmodifiable(cards);

  final List<String> productReferenceIds;
  final String? initiallySelectedProductReferenceId;
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
