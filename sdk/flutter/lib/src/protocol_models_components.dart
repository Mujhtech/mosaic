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

/// Protocol 0.2's single native control container.
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

final class MosaicPurchaseButtonComponent extends MosaicComponent {
  const MosaicPurchaseButtonComponent({
    required super.id,
    required this.label,
    required this.inProgressLabel,
    required this.action,
    required this.accessibility,
    this.typography,
    this.appearance,
    this.sizing,
    this.outerInsets,
    this.visibility = const MosaicAlwaysVisible(),
  });

  final MosaicLocalizedText label;
  final MosaicLocalizedText inProgressLabel;
  final MosaicPurchaseAction action;
  final MosaicControlAccessibility accessibility;
  final MosaicTypography? typography;
  final MosaicBoxAppearance? appearance;
  final MosaicSizing? sizing;
  final MosaicEdgeInsets? outerInsets;
  final MosaicVisibility visibility;

  @override
  String get type => 'purchaseButton';
}

final class MosaicRestoreButtonComponent extends MosaicComponent {
  const MosaicRestoreButtonComponent({
    required super.id,
    required this.label,
    required this.inProgressLabel,
    required this.action,
    required this.accessibility,
    this.typography,
    this.appearance,
    this.sizing,
    this.outerInsets,
    this.visibility = const MosaicAlwaysVisible(),
  });

  final MosaicLocalizedText label;
  final MosaicLocalizedText inProgressLabel;
  final MosaicRestoreAction action;
  final MosaicControlAccessibility accessibility;
  final MosaicTypography? typography;
  final MosaicBoxAppearance? appearance;
  final MosaicSizing? sizing;
  final MosaicEdgeInsets? outerInsets;
  final MosaicVisibility visibility;

  @override
  String get type => 'restoreButton';
}

final class MosaicCloseButtonComponent extends MosaicComponent {
  const MosaicCloseButtonComponent({
    required super.id,
    required this.label,
    required this.action,
    required this.accessibility,
    this.typography,
    this.appearance,
    this.sizing,
    this.outerInsets,
    this.visibility = const MosaicAlwaysVisible(),
  });

  final MosaicLocalizedText label;
  final MosaicCloseAction action;
  final MosaicControlAccessibility accessibility;
  final MosaicTypography? typography;
  final MosaicBoxAppearance? appearance;
  final MosaicSizing? sizing;
  final MosaicEdgeInsets? outerInsets;
  final MosaicVisibility visibility;

  @override
  String get type => 'closeButton';
}

final class MosaicLegalTextComponent extends MosaicComponent {
  const MosaicLegalTextComponent({
    required super.id,
    required this.value,
    required this.alignment,
    required this.accessibility,
    this.typography,
    this.appearance,
    this.sizing,
    this.outerInsets,
    this.visibility = const MosaicAlwaysVisible(),
  });

  final MosaicLocalizedText value;
  final MosaicTextAlignment alignment;
  final MosaicTextAccessibility accessibility;
  final MosaicTypography? typography;
  final MosaicBoxAppearance? appearance;
  final MosaicSizing? sizing;
  final MosaicEdgeInsets? outerInsets;
  final MosaicVisibility visibility;

  @override
  String get type => 'legalText';
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

/// Strict native reader for the current protocol contract.
///
/// The JSON Schemas remain canonical under `protocol/`; this reader dispatches
/// by exact version and never migrates, downgrades, or partially renders.
