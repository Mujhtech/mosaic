import 'dart:convert';

const String mosaicProtocolVersion = '0.1';
const String mosaicProtocolV02Version = '0.2';
const String mosaicFlutterSdkVersion = '0.2.0-dev.2';

/// Every Protocol 0.1 capability implemented by this Flutter SDK.
const Set<String> mosaicProtocolV01Capabilities = <String>{
  'layout.scrollContainer',
  'layout.verticalStack',
  'component.text',
  'component.image',
  'component.featureList',
  'component.productSelector',
  'component.purchaseButton',
  'component.restoreButton',
  'component.closeButton',
  'component.legalText',
  'localization.catalogs',
  'localization.rtl',
  'product.references',
  'asset.bundledImage',
  'action.purchase',
  'action.restore',
  'action.close',
  'accessibility.metadata',
  'fallback.asset',
  'fallback.product',
  'outcome.normalized',
};

/// Every Protocol 0.2 capability implemented by this Flutter SDK.
const Set<String> mosaicProtocolV02Capabilities = <String>{
  'layout.scrollContainer',
  'layout.stack',
  'layout.sizing',
  'layout.outerInsets',
  'component.text',
  'component.image',
  'component.featureList',
  'component.productSelector',
  'component.purchaseButton',
  'component.restoreButton',
  'component.closeButton',
  'component.legalText',
  'component.carousel',
  'component.switch',
  'component.countdown',
  'localization.catalogs',
  'localization.rtl',
  'product.references',
  'asset.bundledImage',
  'action.purchase',
  'action.restore',
  'action.close',
  'accessibility.metadata',
  'fallback.asset',
  'fallback.product',
  'outcome.normalized',
  'style.colors',
  'style.box',
  'style.clipping',
  'style.typography',
  'style.productCardStates',
  'visibility.static',
  'condition.switchVisibility',
};

/// Machine-readable compatibility information for host diagnostics and Studio.
final class MosaicCapabilityReport {
  MosaicCapabilityReport({
    required this.sdkVersion,
    required Iterable<String> supportedSchemaVersions,
    required Map<String, String> supportedCapabilities,
  })  : supportedSchemaVersions = Set.unmodifiable(supportedSchemaVersions),
        supportedCapabilities = Map.unmodifiable(supportedCapabilities);

  final String sdkVersion;
  final Set<String> supportedSchemaVersions;
  final Map<String, String> supportedCapabilities;
}

final MosaicCapabilityReport mosaicFlutterCapabilityReport =
    MosaicCapabilityReport(
  sdkVersion: mosaicFlutterSdkVersion,
  supportedSchemaVersions: const <String>{
    mosaicProtocolVersion,
    mosaicProtocolV02Version,
  },
  supportedCapabilities: <String, String>{
    for (final capability in mosaicProtocolV01Capabilities)
      capability: mosaicProtocolVersion,
    for (final capability in mosaicProtocolV02Capabilities)
      capability: mosaicProtocolV02Version,
  },
);

enum MosaicLocaleDirection { ltr, rtl }

enum MosaicStackHorizontalAlignment { start, center, end, stretch }

enum MosaicTextStyle { display, title, heading, body, label, caption }

enum MosaicTextAlignment { start, center, end }

enum MosaicImageContentMode { fit, fill }

enum MosaicTextAccessibilityRole { text, heading }

enum MosaicStackDirection { vertical, horizontal }

enum MosaicMainAxisDistribution { start, center, end, spaceBetween }

enum MosaicProductSelectorDirection { vertical, horizontal }

enum MosaicFontWeight { regular, medium, semibold, bold }

enum MosaicTextOverflow { clip, ellipsis }

enum MosaicCountdownUnit { day, hour, minute, second }

enum MosaicSizingMode { content, fill, fixed }

/// A frozen Protocol 0.2 semantic token or canonical literal sRGB color.
final class MosaicColorValue {
  const MosaicColorValue._(this.value, this.isLiteral);

  factory MosaicColorValue.parse(String value) {
    if (_semanticColors.contains(value)) {
      return MosaicColorValue._(value, false);
    }
    if (RegExp(r'^#[0-9A-F]{8}$').hasMatch(value)) {
      return MosaicColorValue._(value, true);
    }
    throw MosaicProtocolException(
      'Expected a semantic color or uppercase #RRGGBBAA literal.',
    );
  }

  final String value;
  final bool isLiteral;
}

const Set<String> _semanticColors = <String>{
  'text.primary',
  'text.secondary',
  'surface.default',
  'surface.elevated',
  'action.primary',
  'action.onPrimary',
  'border.default',
  'transparent',
};

final class MosaicSizingValue {
  const MosaicSizingValue._(this.mode, this.value);

  const MosaicSizingValue.content() : this._(MosaicSizingMode.content, null);

  const MosaicSizingValue.fill() : this._(MosaicSizingMode.fill, null);

  const MosaicSizingValue.fixed(double value)
      : this._(MosaicSizingMode.fixed, value);

  final MosaicSizingMode mode;
  final double? value;
}

final class MosaicSizing {
  const MosaicSizing({this.width, this.height});

  final MosaicSizingValue? width;
  final MosaicSizingValue? height;
}

final class MosaicBorderStyle {
  const MosaicBorderStyle({required this.color, required this.width});

  final MosaicColorValue color;
  final double width;
}

final class MosaicBoxAppearance {
  const MosaicBoxAppearance({
    this.background,
    this.border,
    this.cornerRadius,
    this.opacity,
    this.padding,
    this.clipContent,
  });

  final MosaicColorValue? background;
  final MosaicBorderStyle? border;
  final double? cornerRadius;
  final double? opacity;
  final MosaicEdgeInsets? padding;
  final bool? clipContent;
}

final class MosaicTypography {
  const MosaicTypography({
    required this.style,
    required this.fontSize,
    required this.lineHeightMultiplier,
    required this.weight,
    required this.color,
    required this.alignment,
    this.maxLines,
    this.overflow,
  });

  final MosaicTextStyle style;
  final double fontSize;
  final double lineHeightMultiplier;
  final MosaicFontWeight weight;
  final MosaicColorValue color;
  final MosaicTextAlignment alignment;
  final int? maxLines;
  final MosaicTextOverflow? overflow;
}

sealed class MosaicVisibility {
  const MosaicVisibility();
}

final class MosaicAlwaysVisible extends MosaicVisibility {
  const MosaicAlwaysVisible();
}

final class MosaicStaticallyHidden extends MosaicVisibility {
  const MosaicStaticallyHidden();
}

final class MosaicSwitchVisibility extends MosaicVisibility {
  const MosaicSwitchVisibility({required this.switchId, required this.equals});

  final String switchId;
  final bool equals;
}

final class MosaicPaywallDocument {
  MosaicPaywallDocument({
    required this.schemaVersion,
    required this.id,
    required this.revision,
    required this.compatibility,
    required this.localization,
    required Iterable<MosaicImageAsset> assets,
    required Iterable<MosaicProductReference> products,
    required this.layout,
  })  : assets = List.unmodifiable(assets),
        products = List.unmodifiable(products);

  final String schemaVersion;
  final String id;
  final int revision;
  final MosaicDocumentCompatibility compatibility;
  final MosaicLocalization localization;
  final List<MosaicImageAsset> assets;
  final List<MosaicProductReference> products;
  final MosaicScrollContainer layout;

  Iterable<MosaicNode> get nodes sync* {
    yield layout;
    yield* _walkStack(layout.content);
  }

  static Iterable<MosaicNode> _walkStack(MosaicStackNode stack) sync* {
    yield stack;
    for (final child in stack.children) {
      yield child;
      if (child is MosaicStackNode) {
        for (final descendant in _walkStack(child).skip(1)) {
          yield descendant;
        }
      } else if (child is MosaicCarouselComponent) {
        for (final page in child.pages) {
          yield* _walkStack(page.content);
        }
      }
    }
  }

  MosaicProductReference? productReference(String id) {
    for (final product in products) {
      if (product.id == id) {
        return product;
      }
    }
    return null;
  }

  MosaicImageAsset? imageAsset(String id) {
    for (final asset in assets) {
      if (asset.id == id) {
        return asset;
      }
    }
    return null;
  }
}

final class MosaicDocumentCompatibility {
  MosaicDocumentCompatibility(Iterable<MosaicRequiredCapability> capabilities)
      : requiredCapabilities = List.unmodifiable(capabilities);

  final List<MosaicRequiredCapability> requiredCapabilities;
}

final class MosaicRequiredCapability {
  const MosaicRequiredCapability({required this.name, required this.version});

  final String name;
  final String version;
}

final class MosaicLocalization {
  MosaicLocalization({
    required this.defaultLocale,
    required this.fallbackLocale,
    required Map<String, MosaicLocaleCatalog> locales,
  }) : locales = Map.unmodifiable(locales);

  final String defaultLocale;
  final String fallbackLocale;
  final Map<String, MosaicLocaleCatalog> locales;
}

final class MosaicLocaleCatalog {
  MosaicLocaleCatalog({
    required this.direction,
    required Map<String, String> strings,
  }) : strings = Map.unmodifiable(strings);

  final MosaicLocaleDirection direction;
  final Map<String, String> strings;
}

final class MosaicLocalizedText {
  const MosaicLocalizedText({
    required this.defaultValue,
    required this.localizationKey,
  });

  final String defaultValue;
  final String localizationKey;
}

final class MosaicImageAsset {
  const MosaicImageAsset({
    required this.id,
    required this.sourceKey,
    required this.placeholder,
  });

  final String id;
  final String sourceKey;
  final MosaicLocalizedText placeholder;
}

final class MosaicProductReference {
  const MosaicProductReference({
    required this.id,
    required this.productId,
    required this.label,
    this.badge,
  });

  /// Document-local identifier used by actions and normalized outcomes.
  final String id;

  /// Opaque identifier passed unchanged to the purchase provider.
  final String productId;
  final MosaicLocalizedText label;
  final MosaicLocalizedText? badge;
}

final class MosaicEdgeInsets {
  const MosaicEdgeInsets({
    required this.top,
    required this.start,
    required this.bottom,
    required this.end,
  });

  final double top;
  final double start;
  final double bottom;
  final double end;
}

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
  final MosaicColorValue? background;

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

/// Protocol 0.2 generalized Stack. Protocol 0.1 continues to decode to
/// [MosaicVerticalStack] so its immutable model and behavior remain distinct.
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
    this.appearance,
    this.outerInsets,
    this.visibility = const MosaicAlwaysVisible(),
  });

  final String assetId;
  final double? aspectRatio;
  final double? fixedHeight;
  final MosaicSizingValue? width;
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

final class MosaicProductCardBadgeStyle {
  const MosaicProductCardBadgeStyle({
    required this.background,
    required this.textColor,
    required this.border,
    required this.cornerRadius,
    required this.padding,
  });

  final MosaicColorValue background;
  final MosaicColorValue textColor;
  final MosaicBorderStyle border;
  final double cornerRadius;
  final MosaicEdgeInsets padding;
}

final class MosaicProductCardStyle {
  const MosaicProductCardStyle({
    required this.background,
    required this.border,
    required this.cornerRadius,
    required this.padding,
    required this.contentGap,
    required this.contentAlignment,
    required this.productLabelColor,
    required this.runtimePriceColor,
    required this.badge,
  });

  final MosaicColorValue background;
  final MosaicBorderStyle border;
  final double cornerRadius;
  final MosaicEdgeInsets padding;
  final double contentGap;
  final MosaicMainAxisDistribution contentAlignment;
  final MosaicColorValue productLabelColor;
  final MosaicColorValue runtimePriceColor;
  final MosaicProductCardBadgeStyle badge;
}

/// Presence-aware, recursive Protocol 0.2 Selected overrides.
///
/// Nullable fields are absent overrides, never serialized `null` values.
final class MosaicProductCardBadgeStyleOverride {
  const MosaicProductCardBadgeStyleOverride({
    this.background,
    this.textColor,
    this.borderColor,
    this.borderWidth,
    this.cornerRadius,
    this.paddingTop,
    this.paddingStart,
    this.paddingBottom,
    this.paddingEnd,
  });

  final MosaicColorValue? background;
  final MosaicColorValue? textColor;
  final MosaicColorValue? borderColor;
  final double? borderWidth;
  final double? cornerRadius;
  final double? paddingTop;
  final double? paddingStart;
  final double? paddingBottom;
  final double? paddingEnd;

  MosaicProductCardBadgeStyle resolve(MosaicProductCardBadgeStyle base) =>
      MosaicProductCardBadgeStyle(
        background: background ?? base.background,
        textColor: textColor ?? base.textColor,
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
      );
}

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
    this.contentGap,
    this.contentAlignment,
    this.productLabelColor,
    this.runtimePriceColor,
    this.badge,
  });

  final MosaicColorValue? background;
  final MosaicColorValue? borderColor;
  final double? borderWidth;
  final double? cornerRadius;
  final double? paddingTop;
  final double? paddingStart;
  final double? paddingBottom;
  final double? paddingEnd;
  final double? contentGap;
  final MosaicMainAxisDistribution? contentAlignment;
  final MosaicColorValue? productLabelColor;
  final MosaicColorValue? runtimePriceColor;
  final MosaicProductCardBadgeStyleOverride? badge;

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
        contentGap: contentGap ?? base.contentGap,
        contentAlignment: contentAlignment ?? base.contentAlignment,
        productLabelColor: productLabelColor ?? base.productLabelColor,
        runtimePriceColor: runtimePriceColor ?? base.runtimePriceColor,
        badge: badge?.resolve(base.badge) ?? base.badge,
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

final class MosaicProductSelectorComponent extends MosaicComponent {
  MosaicProductSelectorComponent({
    required super.id,
    required Iterable<String> productReferenceIds,
    required this.initiallySelectedProductReferenceId,
    required this.itemSpacing,
    required this.unavailableFallback,
    required this.accessibility,
    this.direction = MosaicProductSelectorDirection.vertical,
    this.cardStyles,
    this.appearance,
    this.sizing,
    this.outerInsets,
    this.visibility = const MosaicAlwaysVisible(),
  }) : productReferenceIds = List.unmodifiable(productReferenceIds);

  final List<String> productReferenceIds;
  final String initiallySelectedProductReferenceId;
  final double itemSpacing;
  final MosaicUnavailableProductFallback unavailableFallback;
  final MosaicControlAccessibility accessibility;
  final MosaicProductSelectorDirection direction;
  final MosaicProductCardStyles? cardStyles;
  final MosaicBoxAppearance? appearance;
  final MosaicSizing? sizing;
  final MosaicEdgeInsets? outerInsets;
  final MosaicVisibility visibility;

  @override
  String get type => 'productSelector';
}

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

/// Strict native reader for the closed Protocol 0.1 and 0.2 contracts.
///
/// The JSON Schemas remain canonical under `protocol/`; this reader dispatches
/// by exact version and never migrates, downgrades, or partially renders.
final class MosaicProtocolDecoder {
  const MosaicProtocolDecoder();

  MosaicPaywallDocument decode(String source) {
    final Object? value;
    try {
      value = jsonDecode(source);
    } on FormatException catch (error) {
      throw MosaicProtocolException('Invalid JSON: ${error.message}');
    }

    final root = _object(value, r'$');
    _expectKeys(
      root,
      const <String>{
        'schemaVersion',
        'id',
        'revision',
        'compatibility',
        'localization',
        'assets',
        'products',
        'layout',
      },
      r'$',
    );

    final schemaVersion = _string(root['schemaVersion'], r'$.schemaVersion');
    if (schemaVersion == mosaicProtocolV02Version) {
      return _decodeV02(root);
    }
    if (schemaVersion != mosaicProtocolVersion) {
      throw MosaicProtocolException(
        'Unsupported schemaVersion "$schemaVersion" at \$.schemaVersion.',
      );
    }

    final document = MosaicPaywallDocument(
      schemaVersion: schemaVersion,
      id: _identifier(root['id'], r'$.id'),
      revision: _positiveInteger(root['revision'], r'$.revision'),
      compatibility: _compatibility(root['compatibility']),
      localization: _localization(root['localization']),
      assets: _assets(root['assets']),
      products: _products(root['products']),
      layout: _scrollContainer(root['layout'], r'$.layout'),
    );
    _validateDocumentSemantics(document);
    return document;
  }

  MosaicPaywallDocument _decodeV02(Map<String, Object?> root) {
    final document = MosaicPaywallDocument(
      schemaVersion: mosaicProtocolV02Version,
      id: _identifier(root['id'], r'$.id'),
      revision: _positiveInteger(root['revision'], r'$.revision'),
      compatibility: _compatibilityFor(
        root['compatibility'],
        version: mosaicProtocolV02Version,
        supported: mosaicProtocolV02Capabilities,
      ),
      localization: _localization(root['localization']),
      assets: _assets(root['assets']),
      products: _products(root['products']),
      layout: _v02ScrollContainer(root['layout'], r'$.layout'),
    );
    _validateDocumentSemantics(document);
    return document;
  }

  MosaicDocumentCompatibility _compatibilityFor(
    Object? value, {
    required String version,
    required Set<String> supported,
  }) {
    const path = r'$.compatibility';
    final object = _object(value, path);
    _expectKeys(object, const <String>{'requiredCapabilities'}, path);
    final entries = _nonEmptyList(
      object['requiredCapabilities'],
      '$path.requiredCapabilities',
    );
    final capabilities = <MosaicRequiredCapability>[];
    final seen = <String>{};
    for (var index = 0; index < entries.length; index += 1) {
      final capabilityPath = '$path.requiredCapabilities[$index]';
      final capability = _object(entries[index], capabilityPath);
      _expectKeys(
        capability,
        const <String>{'name', 'version'},
        capabilityPath,
      );
      final name = _string(capability['name'], '$capabilityPath.name');
      final capabilityVersion =
          _string(capability['version'], '$capabilityPath.version');
      if (!supported.contains(name) || capabilityVersion != version) {
        throw MosaicProtocolException(
          'Unsupported capability "$name@$capabilityVersion" at '
          '$capabilityPath.',
        );
      }
      if (!seen.add(name)) {
        throw MosaicProtocolException(
          'Duplicate capability "$name" at $capabilityPath.',
        );
      }
      capabilities.add(
        MosaicRequiredCapability(name: name, version: capabilityVersion),
      );
    }
    return MosaicDocumentCompatibility(capabilities);
  }

  MosaicScrollContainer _v02ScrollContainer(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{
        'type',
        'id',
        'axis',
        'safeArea',
        'showsIndicators',
        'content',
      },
      path,
      optional: const <String>{'background'},
    );
    _expectConst(object['type'], 'scrollContainer', '$path.type');
    _expectConst(object['axis'], 'vertical', '$path.axis');
    _expectConst(object['safeArea'], 'respect', '$path.safeArea');
    return MosaicScrollContainer(
      id: _identifier(object['id'], '$path.id'),
      showsIndicators: _boolean(
        object['showsIndicators'],
        '$path.showsIndicators',
      ),
      content: _v02Stack(object['content'], '$path.content'),
      background: object.containsKey('background')
          ? _v02Color(object['background'], '$path.background')
          : null,
    );
  }

  MosaicStackComponent _v02Stack(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{
        'type',
        'id',
        'direction',
        'gap',
        'padding',
        'mainAxisDistribution',
        'crossAxisAlignment',
        'children',
      },
      path,
      optional: const <String>{
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
    );
    _expectConst(object['type'], 'stack', '$path.type');
    final children = _list(object['children'], '$path.children');
    return MosaicStackComponent(
      id: _identifier(object['id'], '$path.id'),
      direction: switch (_enumValue(
        object['direction'],
        const <String>{'vertical', 'horizontal'},
        '$path.direction',
      )) {
        'vertical' => MosaicStackDirection.vertical,
        _ => MosaicStackDirection.horizontal,
      },
      gap: _logicalSize(object['gap'], '$path.gap'),
      padding: _edgeInsets(object['padding'], '$path.padding'),
      mainAxisDistribution: _v02Distribution(
        object['mainAxisDistribution'],
        '$path.mainAxisDistribution',
      ),
      crossAxisAlignment: _stackAlignment(
        object['crossAxisAlignment'],
        '$path.crossAxisAlignment',
      ),
      children: <MosaicNode>[
        for (var index = 0; index < children.length; index += 1)
          _v02Node(children[index], '$path.children[$index]'),
      ],
      appearance: _v02OptionalAppearance(
        object,
        path,
        container: true,
      ),
      sizing: _v02OptionalSizing(object, path, allowHeight: true),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  MosaicNode _v02Node(Object? value, String path) {
    final object = _object(value, path);
    final type = _string(object['type'], '$path.type');
    return switch (type) {
      'stack' => _v02Stack(object, path),
      'text' => _v02Text(object, path),
      'image' => _v02Image(object, path),
      'featureList' => _v02FeatureList(object, path),
      'productSelector' => _v02ProductSelector(object, path),
      'purchaseButton' => _v02PurchaseButton(object, path),
      'restoreButton' => _v02RestoreButton(object, path),
      'closeButton' => _v02CloseButton(object, path),
      'legalText' => _v02LegalText(object, path),
      'carousel' => _v02Carousel(object, path),
      'switch' => _v02Switch(object, path),
      'countdown' => _v02Countdown(object, path),
      _ => throw MosaicProtocolException(
          'Unsupported component type "$type" at $path.type.',
        ),
    };
  }

  MosaicTextComponent _v02Text(Map<String, Object?> object, String path) {
    _expectV02ComponentKeys(
      object,
      path,
      required: const <String>{
        'type',
        'id',
        'value',
        'typography',
        'accessibility',
      },
      optional: const <String>{
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
    );
    final typography = _v02Typography(
      object['typography'],
      '$path.typography',
      allowMaximumLines: true,
    );
    return MosaicTextComponent(
      id: _identifier(object['id'], '$path.id'),
      value: _localizedText(object['value'], '$path.value'),
      style: typography.style,
      alignment: typography.alignment,
      accessibility: _v02TextAccessibility(
        object['accessibility'],
        '$path.accessibility',
        allowHeading: true,
      ),
      typography: typography,
      appearance: _v02OptionalAppearance(object, path),
      sizing: _v02OptionalSizing(object, path),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  MosaicImageComponent _v02Image(Map<String, Object?> object, String path) {
    _expectV02ComponentKeys(
      object,
      path,
      required: const <String>{
        'type',
        'id',
        'assetId',
        'width',
        'contentMode',
        'accessibility',
      },
      optional: const <String>{
        'aspectRatio',
        'height',
        'appearance',
        'outerInsets',
        'visibility',
      },
    );
    final hasAspect = object.containsKey('aspectRatio');
    final hasHeight = object.containsKey('height');
    if (hasAspect == hasHeight) {
      throw MosaicProtocolException(
        'Image must define exactly one of aspectRatio or height at $path.',
      );
    }
    return MosaicImageComponent(
      id: _identifier(object['id'], '$path.id'),
      assetId: _identifier(object['assetId'], '$path.assetId'),
      aspectRatio: hasAspect
          ? _boundedNumber(
              object['aspectRatio'],
              '$path.aspectRatio',
              minimumExclusive: 0,
              maximum: 10,
            )
          : null,
      fixedHeight: hasHeight
          ? _boundedNumber(
              object['height'],
              '$path.height',
              minimumExclusive: 0,
              maximum: 4096,
            )
          : null,
      width: _v02SizingValue(
        object['width'],
        '$path.width',
        allowFill: true,
      ),
      contentMode: _enumValue(
                object['contentMode'],
                const <String>{'fit', 'fill'},
                '$path.contentMode',
              ) ==
              'fit'
          ? MosaicImageContentMode.fit
          : MosaicImageContentMode.fill,
      accessibility: _imageAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
      appearance: _v02OptionalAppearance(object, path),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  MosaicFeatureListComponent _v02FeatureList(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV02ComponentKeys(
      object,
      path,
      required: const <String>{
        'type',
        'id',
        'marker',
        'gap',
        'markerColor',
        'items',
        'typography',
        'accessibility',
      },
      optional: const <String>{
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
    );
    _expectConst(object['marker'], 'checkmark', '$path.marker');
    final items = _nonEmptyList(object['items'], '$path.items');
    final typography = _v02Typography(
      object['typography'],
      '$path.typography',
      allowMaximumLines: false,
    );
    return MosaicFeatureListComponent(
      id: _identifier(object['id'], '$path.id'),
      itemSpacing: _logicalSize(object['gap'], '$path.gap'),
      items: <MosaicFeatureListItem>[
        for (var index = 0; index < items.length; index += 1)
          _featureListItem(items[index], '$path.items[$index]'),
      ],
      accessibility: _controlAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
      markerColor: _v02Color(object['markerColor'], '$path.markerColor'),
      typography: typography,
      appearance: _v02OptionalAppearance(object, path),
      sizing: _v02OptionalSizing(object, path),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  MosaicProductSelectorComponent _v02ProductSelector(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV02ComponentKeys(
      object,
      path,
      required: const <String>{
        'type',
        'id',
        'productReferenceIds',
        'initiallySelectedProductReferenceId',
        'direction',
        'gap',
        'cardStyles',
        'unavailableFallback',
        'accessibility',
      },
      optional: const <String>{
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
    );
    final values = _nonEmptyList(
      object['productReferenceIds'],
      '$path.productReferenceIds',
    );
    final referenceIds = <String>[
      for (var index = 0; index < values.length; index += 1)
        _identifier(values[index], '$path.productReferenceIds[$index]'),
    ];
    if (referenceIds.toSet().length != referenceIds.length) {
      throw MosaicProtocolException(
        'Duplicate product reference ID at $path.productReferenceIds.',
      );
    }
    final direction = _enumValue(
      object['direction'],
      const <String>{'vertical', 'horizontal'},
      '$path.direction',
    );
    return MosaicProductSelectorComponent(
      id: _identifier(object['id'], '$path.id'),
      productReferenceIds: referenceIds,
      initiallySelectedProductReferenceId: _identifier(
        object['initiallySelectedProductReferenceId'],
        '$path.initiallySelectedProductReferenceId',
      ),
      itemSpacing: _logicalSize(object['gap'], '$path.gap'),
      unavailableFallback: _unavailableProductFallback(
        object['unavailableFallback'],
        '$path.unavailableFallback',
      ),
      accessibility: _controlAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
      direction: direction == 'vertical'
          ? MosaicProductSelectorDirection.vertical
          : MosaicProductSelectorDirection.horizontal,
      cardStyles: _v02ProductCardStyles(
        object['cardStyles'],
        '$path.cardStyles',
      ),
      appearance: _v02OptionalAppearance(object, path),
      sizing: _v02OptionalSizing(object, path),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  MosaicPurchaseButtonComponent _v02PurchaseButton(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV02ActionButtonKeys(object, path);
    return MosaicPurchaseButtonComponent(
      id: _identifier(object['id'], '$path.id'),
      label: _localizedText(object['label'], '$path.label'),
      inProgressLabel: _localizedText(
        object['inProgressLabel'],
        '$path.inProgressLabel',
      ),
      action: _purchaseAction(object['action'], '$path.action'),
      accessibility: _controlAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
      typography: _v02Typography(
        object['typography'],
        '$path.typography',
        allowMaximumLines: false,
      ),
      appearance: _v02OptionalAppearance(object, path),
      sizing: _v02OptionalSizing(object, path),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  MosaicRestoreButtonComponent _v02RestoreButton(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV02ActionButtonKeys(object, path);
    return MosaicRestoreButtonComponent(
      id: _identifier(object['id'], '$path.id'),
      label: _localizedText(object['label'], '$path.label'),
      inProgressLabel: _localizedText(
        object['inProgressLabel'],
        '$path.inProgressLabel',
      ),
      action: _restoreAction(object['action'], '$path.action'),
      accessibility: _controlAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
      typography: _v02Typography(
        object['typography'],
        '$path.typography',
        allowMaximumLines: false,
      ),
      appearance: _v02OptionalAppearance(object, path),
      sizing: _v02OptionalSizing(object, path),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  MosaicCloseButtonComponent _v02CloseButton(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV02ComponentKeys(
      object,
      path,
      required: const <String>{
        'type',
        'id',
        'label',
        'typography',
        'action',
        'accessibility',
      },
      optional: const <String>{
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
    );
    return MosaicCloseButtonComponent(
      id: _identifier(object['id'], '$path.id'),
      label: _localizedText(object['label'], '$path.label'),
      action: _closeAction(object['action'], '$path.action'),
      accessibility: _controlAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
      typography: _v02Typography(
        object['typography'],
        '$path.typography',
        allowMaximumLines: false,
      ),
      appearance: _v02OptionalAppearance(object, path),
      sizing: _v02OptionalSizing(object, path),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  MosaicLegalTextComponent _v02LegalText(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV02ComponentKeys(
      object,
      path,
      required: const <String>{
        'type',
        'id',
        'value',
        'typography',
        'accessibility',
      },
      optional: const <String>{
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
    );
    final typography = _v02Typography(
      object['typography'],
      '$path.typography',
      allowMaximumLines: false,
    );
    return MosaicLegalTextComponent(
      id: _identifier(object['id'], '$path.id'),
      value: _localizedText(object['value'], '$path.value'),
      alignment: typography.alignment,
      accessibility: _v02TextAccessibility(
        object['accessibility'],
        '$path.accessibility',
        allowHeading: false,
      ),
      typography: typography,
      appearance: _v02OptionalAppearance(object, path),
      sizing: _v02OptionalSizing(object, path),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  MosaicCarouselComponent _v02Carousel(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV02ComponentKeys(
      object,
      path,
      required: const <String>{
        'type',
        'id',
        'initialPageIndex',
        'showsIndicators',
        'pages',
        'accessibility',
      },
      optional: const <String>{
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
    );
    final values = _list(object['pages'], '$path.pages');
    if (values.length < 2 || values.length > 20) {
      throw MosaicProtocolException(
        'Carousel pages must contain 2 through 20 entries at $path.pages.',
      );
    }
    final pages = <MosaicCarouselPage>[];
    for (var index = 0; index < values.length; index += 1) {
      final pagePath = '$path.pages[$index]';
      final page = _object(values[index], pagePath);
      _expectKeys(
        page,
        const <String>{'id', 'accessibilityLabel', 'content'},
        pagePath,
      );
      pages.add(
        MosaicCarouselPage(
          id: _identifier(page['id'], '$pagePath.id'),
          accessibilityLabel: _localizedText(
            page['accessibilityLabel'],
            '$pagePath.accessibilityLabel',
          ),
          content: _v02Stack(page['content'], '$pagePath.content'),
        ),
      );
    }
    return MosaicCarouselComponent(
      id: _identifier(object['id'], '$path.id'),
      initialPageIndex: _integerInRange(
        object['initialPageIndex'],
        '$path.initialPageIndex',
        minimum: 0,
        maximum: 19,
      ),
      showsIndicators: _boolean(
        object['showsIndicators'],
        '$path.showsIndicators',
      ),
      pages: pages,
      accessibility: _controlAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
      appearance: _v02OptionalAppearance(
        object,
        path,
        container: true,
      ),
      sizing: _v02OptionalSizing(object, path),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  MosaicSwitchComponent _v02Switch(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV02ComponentKeys(
      object,
      path,
      required: const <String>{
        'type',
        'id',
        'label',
        'initialValue',
        'typography',
        'offTrackColor',
        'onTrackColor',
        'thumbColor',
        'accessibility',
      },
      optional: const <String>{'appearance', 'outerInsets', 'visibility'},
    );
    return MosaicSwitchComponent(
      id: _identifier(object['id'], '$path.id'),
      label: _localizedText(object['label'], '$path.label'),
      initialValue: _boolean(object['initialValue'], '$path.initialValue'),
      typography: _v02Typography(
        object['typography'],
        '$path.typography',
        allowMaximumLines: false,
      ),
      offTrackColor: _v02Color(
        object['offTrackColor'],
        '$path.offTrackColor',
      ),
      onTrackColor: _v02Color(
        object['onTrackColor'],
        '$path.onTrackColor',
      ),
      thumbColor: _v02Color(object['thumbColor'], '$path.thumbColor'),
      accessibility: _controlAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
      appearance: _v02OptionalAppearance(object, path),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  MosaicCountdownComponent _v02Countdown(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV02ComponentKeys(
      object,
      path,
      required: const <String>{
        'type',
        'id',
        'endsAt',
        'largestUnit',
        'smallestUnit',
        'completedText',
        'typography',
        'accessibility',
      },
      optional: const <String>{
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
    );
    final endsAtSource = _string(object['endsAt'], '$path.endsAt');
    if (!RegExp(
      r'^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$',
    ).hasMatch(endsAtSource)) {
      throw MosaicProtocolException(
        'Countdown endsAt must be a canonical UTC instant at $path.endsAt.',
      );
    }
    final endsAt = DateTime.tryParse(endsAtSource);
    if (endsAt == null ||
        '${endsAt.toUtc().toIso8601String().split('.').first}Z' !=
            endsAtSource) {
      throw MosaicProtocolException(
        'Countdown endsAt must be a real canonical UTC instant at '
        '$path.endsAt.',
      );
    }
    final largest = _v02CountdownUnit(
      object['largestUnit'],
      '$path.largestUnit',
    );
    final smallest = _v02CountdownUnit(
      object['smallestUnit'],
      '$path.smallestUnit',
    );
    if (largest.index > smallest.index) {
      throw MosaicProtocolException(
        'Countdown largestUnit must not be smaller than smallestUnit at '
        '$path.',
      );
    }
    return MosaicCountdownComponent(
      id: _identifier(object['id'], '$path.id'),
      endsAt: endsAt.toUtc(),
      largestUnit: largest,
      smallestUnit: smallest,
      completedText: _localizedText(
        object['completedText'],
        '$path.completedText',
      ),
      typography: _v02Typography(
        object['typography'],
        '$path.typography',
        allowMaximumLines: false,
      ),
      accessibility: _v02TextAccessibility(
        object['accessibility'],
        '$path.accessibility',
        allowHeading: true,
      ),
      appearance: _v02OptionalAppearance(object, path),
      sizing: _v02OptionalSizing(object, path),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  void _expectV02ActionButtonKeys(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV02ComponentKeys(
      object,
      path,
      required: const <String>{
        'type',
        'id',
        'label',
        'inProgressLabel',
        'typography',
        'action',
        'accessibility',
      },
      optional: const <String>{
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
    );
  }

  void _expectV02ComponentKeys(
    Map<String, Object?> object,
    String path, {
    required Set<String> required,
    required Set<String> optional,
  }) {
    _expectKeys(object, required, path, optional: optional);
  }

  MosaicColorValue _v02Color(Object? value, String path) {
    final source = _string(value, path);
    try {
      return MosaicColorValue.parse(source);
    } on MosaicProtocolException {
      throw MosaicProtocolException('Invalid color "$source" at $path.');
    }
  }

  MosaicBoxAppearance? _v02OptionalAppearance(
    Map<String, Object?> parent,
    String parentPath, {
    bool container = false,
  }) {
    if (!parent.containsKey('appearance')) return null;
    final path = '$parentPath.appearance';
    final object = _object(parent['appearance'], path);
    final allowed = <String>{
      'background',
      'border',
      'cornerRadius',
      'opacity',
      if (!container) 'padding',
      if (container) 'clipContent',
    };
    if (object.isEmpty) {
      throw MosaicProtocolException(
        'Expected at least one appearance property at $path.',
      );
    }
    _expectKeys(object, const <String>{}, path, optional: allowed);
    return MosaicBoxAppearance(
      background: object.containsKey('background')
          ? _v02Color(object['background'], '$path.background')
          : null,
      border: object.containsKey('border')
          ? _v02Border(object['border'], '$path.border')
          : null,
      cornerRadius: object.containsKey('cornerRadius')
          ? _logicalSize(object['cornerRadius'], '$path.cornerRadius')
          : null,
      opacity: object.containsKey('opacity')
          ? _boundedNumber(
              object['opacity'],
              '$path.opacity',
              minimum: 0,
              maximum: 1,
            )
          : null,
      padding: object.containsKey('padding')
          ? _edgeInsets(object['padding'], '$path.padding')
          : null,
      clipContent: object.containsKey('clipContent')
          ? _boolean(object['clipContent'], '$path.clipContent')
          : null,
    );
  }

  MosaicBorderStyle _v02Border(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'color', 'width'}, path);
    return MosaicBorderStyle(
      color: _v02Color(object['color'], '$path.color'),
      width: _logicalSize(object['width'], '$path.width'),
    );
  }

  MosaicSizing? _v02OptionalSizing(
    Map<String, Object?> parent,
    String parentPath, {
    bool allowHeight = false,
  }) {
    if (!parent.containsKey('sizing')) return null;
    final path = '$parentPath.sizing';
    final object = _object(parent['sizing'], path);
    if (object.isEmpty) {
      throw MosaicProtocolException(
        'Expected at least one sizing property at $path.',
      );
    }
    _expectKeys(
      object,
      const <String>{},
      path,
      optional: <String>{'width', if (allowHeight) 'height'},
    );
    return MosaicSizing(
      width: object.containsKey('width')
          ? _v02SizingValue(
              object['width'],
              '$path.width',
              allowFill: true,
            )
          : null,
      height: object.containsKey('height')
          ? _v02SizingValue(
              object['height'],
              '$path.height',
              allowFill: false,
            )
          : null,
    );
  }

  MosaicSizingValue _v02SizingValue(
    Object? value,
    String path, {
    required bool allowFill,
  }) {
    if (value is String) {
      final allowed = <String>{'content', if (allowFill) 'fill'};
      final mode = _enumValue(value, allowed, path);
      return mode == 'fill'
          ? const MosaicSizingValue.fill()
          : const MosaicSizingValue.content();
    }
    final object = _object(value, path);
    _expectKeys(object, const <String>{'mode', 'value'}, path);
    _expectConst(object['mode'], 'fixed', '$path.mode');
    return MosaicSizingValue.fixed(
      _boundedNumber(
        object['value'],
        '$path.value',
        minimumExclusive: 0,
        maximum: 4096,
      ),
    );
  }

  MosaicEdgeInsets? _v02OptionalInsets(
    Map<String, Object?> parent,
    String parentPath,
    String key,
  ) =>
      parent.containsKey(key)
          ? _edgeInsets(parent[key], '$parentPath.$key')
          : null;

  MosaicVisibility _v02OptionalVisibility(
    Map<String, Object?> parent,
    String parentPath,
  ) {
    if (!parent.containsKey('visibility')) {
      return const MosaicAlwaysVisible();
    }
    final path = '$parentPath.visibility';
    final object = _object(parent['visibility'], path);
    final mode = _string(object['mode'], '$path.mode');
    switch (mode) {
      case 'always':
        _expectKeys(object, const <String>{'mode'}, path);
        return const MosaicAlwaysVisible();
      case 'hidden':
        _expectKeys(object, const <String>{'mode'}, path);
        return const MosaicStaticallyHidden();
      case 'switch':
        _expectKeys(
          object,
          const <String>{'mode', 'switchId', 'equals'},
          path,
        );
        return MosaicSwitchVisibility(
          switchId: _identifier(object['switchId'], '$path.switchId'),
          equals: _boolean(object['equals'], '$path.equals'),
        );
      default:
        throw MosaicProtocolException('Invalid visibility mode at $path.mode.');
    }
  }

  MosaicTypography _v02Typography(
    Object? value,
    String path, {
    required bool allowMaximumLines,
  }) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{
        'style',
        'fontSize',
        'lineHeightMultiplier',
        'weight',
        'color',
        'alignment',
      },
      path,
      optional: allowMaximumLines
          ? const <String>{'maxLines', 'overflow'}
          : const <String>{},
    );
    final hasMaximum = object.containsKey('maxLines');
    final hasOverflow = object.containsKey('overflow');
    if (hasMaximum != hasOverflow) {
      throw MosaicProtocolException(
        'Typography maxLines and overflow must appear together at $path.',
      );
    }
    return MosaicTypography(
      style: _v02TextStyle(object['style'], '$path.style'),
      fontSize: _boundedNumber(
        object['fontSize'],
        '$path.fontSize',
        minimum: 8,
        maximum: 96,
      ),
      lineHeightMultiplier: _boundedNumber(
        object['lineHeightMultiplier'],
        '$path.lineHeightMultiplier',
        minimum: 0.8,
        maximum: 3,
      ),
      weight: _v02FontWeight(object['weight'], '$path.weight'),
      color: _v02Color(object['color'], '$path.color'),
      alignment: _textAlignment(object['alignment'], '$path.alignment'),
      maxLines: hasMaximum
          ? _integerInRange(
              object['maxLines'],
              '$path.maxLines',
              minimum: 1,
              maximum: 100,
            )
          : null,
      overflow: hasOverflow
          ? switch (_enumValue(
              object['overflow'],
              const <String>{'clip', 'ellipsis'},
              '$path.overflow',
            )) {
              'clip' => MosaicTextOverflow.clip,
              _ => MosaicTextOverflow.ellipsis,
            }
          : null,
    );
  }

  MosaicTextAccessibility _v02TextAccessibility(
    Object? value,
    String path, {
    required bool allowHeading,
  }) {
    final object = _object(value, path);
    final role = _string(object['role'], '$path.role');
    final optional = const <String>{'label'};
    if (role == 'text') {
      _expectKeys(
        object,
        const <String>{'role'},
        path,
        optional: optional,
      );
      return MosaicTextAccessibility(
        role: MosaicTextAccessibilityRole.text,
        label: object.containsKey('label')
            ? _localizedText(object['label'], '$path.label')
            : null,
      );
    }
    if (allowHeading && role == 'heading') {
      _expectKeys(
        object,
        const <String>{'role', 'level'},
        path,
        optional: optional,
      );
      return MosaicTextAccessibility(
        role: MosaicTextAccessibilityRole.heading,
        level: _integerInRange(
          object['level'],
          '$path.level',
          minimum: 1,
          maximum: 6,
        ),
        label: object.containsKey('label')
            ? _localizedText(object['label'], '$path.label')
            : null,
      );
    }
    throw MosaicProtocolException('Invalid text accessibility role at $path.');
  }

  MosaicProductCardStyles _v02ProductCardStyles(
    Object? value,
    String path,
  ) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'default', 'selected'}, path);
    return MosaicProductCardStyles(
      defaultStyle: _v02ProductCardDefault(
        object['default'],
        '$path.default',
      ),
      selectedOverride: _v02ProductCardOverride(
        object['selected'],
        '$path.selected',
      ),
    );
  }

  MosaicProductCardStyle _v02ProductCardDefault(
    Object? value,
    String path,
  ) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{
        'background',
        'border',
        'cornerRadius',
        'padding',
        'contentGap',
        'contentAlignment',
        'productLabelColor',
        'runtimePriceColor',
        'badge',
      },
      path,
    );
    return MosaicProductCardStyle(
      background: _v02Color(object['background'], '$path.background'),
      border: _v02Border(object['border'], '$path.border'),
      cornerRadius: _logicalSize(
        object['cornerRadius'],
        '$path.cornerRadius',
      ),
      padding: _edgeInsets(object['padding'], '$path.padding'),
      contentGap: _logicalSize(object['contentGap'], '$path.contentGap'),
      contentAlignment: _v02Distribution(
        object['contentAlignment'],
        '$path.contentAlignment',
      ),
      productLabelColor: _v02Color(
        object['productLabelColor'],
        '$path.productLabelColor',
      ),
      runtimePriceColor: _v02Color(
        object['runtimePriceColor'],
        '$path.runtimePriceColor',
      ),
      badge: _v02ProductCardBadgeDefault(
        object['badge'],
        '$path.badge',
      ),
    );
  }

  MosaicProductCardBadgeStyle _v02ProductCardBadgeDefault(
    Object? value,
    String path,
  ) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{
        'background',
        'textColor',
        'border',
        'cornerRadius',
        'padding',
      },
      path,
    );
    return MosaicProductCardBadgeStyle(
      background: _v02Color(object['background'], '$path.background'),
      textColor: _v02Color(object['textColor'], '$path.textColor'),
      border: _v02Border(object['border'], '$path.border'),
      cornerRadius: _logicalSize(
        object['cornerRadius'],
        '$path.cornerRadius',
      ),
      padding: _edgeInsets(object['padding'], '$path.padding'),
    );
  }

  MosaicProductCardStyleOverride _v02ProductCardOverride(
    Object? value,
    String path,
  ) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{},
      path,
      optional: const <String>{
        'background',
        'border',
        'cornerRadius',
        'padding',
        'contentGap',
        'contentAlignment',
        'productLabelColor',
        'runtimePriceColor',
        'badge',
      },
    );
    final border = object.containsKey('border')
        ? _object(object['border'], '$path.border')
        : null;
    if (border != null) {
      _expectKeys(
        border,
        const <String>{},
        '$path.border',
        optional: const <String>{'color', 'width'},
      );
    }
    final padding = object.containsKey('padding')
        ? _v02InsetsOverride(object['padding'], '$path.padding')
        : null;
    return MosaicProductCardStyleOverride(
      background: object.containsKey('background')
          ? _v02Color(object['background'], '$path.background')
          : null,
      borderColor: border?.containsKey('color') ?? false
          ? _v02Color(border!['color'], '$path.border.color')
          : null,
      borderWidth: border?.containsKey('width') ?? false
          ? _logicalSize(border!['width'], '$path.border.width')
          : null,
      cornerRadius: object.containsKey('cornerRadius')
          ? _logicalSize(object['cornerRadius'], '$path.cornerRadius')
          : null,
      paddingTop: padding?['top'],
      paddingStart: padding?['start'],
      paddingBottom: padding?['bottom'],
      paddingEnd: padding?['end'],
      contentGap: object.containsKey('contentGap')
          ? _logicalSize(object['contentGap'], '$path.contentGap')
          : null,
      contentAlignment: object.containsKey('contentAlignment')
          ? _v02Distribution(
              object['contentAlignment'],
              '$path.contentAlignment',
            )
          : null,
      productLabelColor: object.containsKey('productLabelColor')
          ? _v02Color(
              object['productLabelColor'],
              '$path.productLabelColor',
            )
          : null,
      runtimePriceColor: object.containsKey('runtimePriceColor')
          ? _v02Color(
              object['runtimePriceColor'],
              '$path.runtimePriceColor',
            )
          : null,
      badge: object.containsKey('badge')
          ? _v02ProductCardBadgeOverride(object['badge'], '$path.badge')
          : null,
    );
  }

  MosaicProductCardBadgeStyleOverride _v02ProductCardBadgeOverride(
    Object? value,
    String path,
  ) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{},
      path,
      optional: const <String>{
        'background',
        'textColor',
        'border',
        'cornerRadius',
        'padding',
      },
    );
    final border = object.containsKey('border')
        ? _object(object['border'], '$path.border')
        : null;
    if (border != null) {
      _expectKeys(
        border,
        const <String>{},
        '$path.border',
        optional: const <String>{'color', 'width'},
      );
    }
    final padding = object.containsKey('padding')
        ? _v02InsetsOverride(object['padding'], '$path.padding')
        : null;
    return MosaicProductCardBadgeStyleOverride(
      background: object.containsKey('background')
          ? _v02Color(object['background'], '$path.background')
          : null,
      textColor: object.containsKey('textColor')
          ? _v02Color(object['textColor'], '$path.textColor')
          : null,
      borderColor: border?.containsKey('color') ?? false
          ? _v02Color(border!['color'], '$path.border.color')
          : null,
      borderWidth: border?.containsKey('width') ?? false
          ? _logicalSize(border!['width'], '$path.border.width')
          : null,
      cornerRadius: object.containsKey('cornerRadius')
          ? _logicalSize(object['cornerRadius'], '$path.cornerRadius')
          : null,
      paddingTop: padding?['top'],
      paddingStart: padding?['start'],
      paddingBottom: padding?['bottom'],
      paddingEnd: padding?['end'],
    );
  }

  Map<String, double> _v02InsetsOverride(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{},
      path,
      optional: const <String>{'top', 'start', 'bottom', 'end'},
    );
    return <String, double>{
      for (final key in const <String>['top', 'start', 'bottom', 'end'])
        if (object.containsKey(key))
          key: _logicalSize(object[key], '$path.$key'),
    };
  }

  MosaicMainAxisDistribution _v02Distribution(Object? value, String path) {
    final source = _enumValue(
      value,
      const <String>{'start', 'center', 'end', 'spaceBetween'},
      path,
    );
    return switch (source) {
      'start' => MosaicMainAxisDistribution.start,
      'center' => MosaicMainAxisDistribution.center,
      'end' => MosaicMainAxisDistribution.end,
      _ => MosaicMainAxisDistribution.spaceBetween,
    };
  }

  MosaicTextStyle _v02TextStyle(Object? value, String path) {
    final source = _enumValue(
      value,
      const <String>{'display', 'title', 'heading', 'body', 'label', 'caption'},
      path,
    );
    return MosaicTextStyle.values.byName(source);
  }

  MosaicFontWeight _v02FontWeight(Object? value, String path) {
    final source = _enumValue(
      value,
      const <String>{'regular', 'medium', 'semibold', 'bold'},
      path,
    );
    return MosaicFontWeight.values.byName(source);
  }

  MosaicCountdownUnit _v02CountdownUnit(Object? value, String path) {
    final source = _enumValue(
      value,
      const <String>{'day', 'hour', 'minute', 'second'},
      path,
    );
    return MosaicCountdownUnit.values.byName(source);
  }

  MosaicDocumentCompatibility _compatibility(Object? value) {
    const path = r'$.compatibility';
    final object = _object(value, path);
    _expectKeys(object, const <String>{'requiredCapabilities'}, path);
    final entries = _nonEmptyList(
      object['requiredCapabilities'],
      '$path.requiredCapabilities',
    );
    final capabilities = <MosaicRequiredCapability>[];
    final seen = <String>{};
    for (var index = 0; index < entries.length; index += 1) {
      final capabilityPath = '$path.requiredCapabilities[$index]';
      final capability = _object(entries[index], capabilityPath);
      _expectKeys(
        capability,
        const <String>{'name', 'version'},
        capabilityPath,
      );
      final name = _string(capability['name'], '$capabilityPath.name');
      final version = _string(
        capability['version'],
        '$capabilityPath.version',
      );
      if (!mosaicProtocolV01Capabilities.contains(name) ||
          version != mosaicProtocolVersion) {
        throw MosaicProtocolException(
          'Unsupported capability "$name@$version" at $capabilityPath.',
        );
      }
      if (!seen.add(name)) {
        throw MosaicProtocolException(
          'Duplicate capability "$name" at $capabilityPath.',
        );
      }
      capabilities.add(MosaicRequiredCapability(name: name, version: version));
    }
    return MosaicDocumentCompatibility(capabilities);
  }

  MosaicLocalization _localization(Object? value) {
    const path = r'$.localization';
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{'defaultLocale', 'fallbackLocale', 'locales'},
      path,
    );
    final localeValues = _object(object['locales'], '$path.locales');
    if (localeValues.isEmpty) {
      throw MosaicProtocolException(
        'Expected at least one locale at $path.locales.',
      );
    }
    final locales = <String, MosaicLocaleCatalog>{};
    for (final entry in localeValues.entries) {
      final locale = _localeTag(entry.key, '$path.locales key');
      locales[locale] = _localeCatalog(
        entry.value,
        '$path.locales.$locale',
      );
    }
    return MosaicLocalization(
      defaultLocale: _localeTag(
        object['defaultLocale'],
        '$path.defaultLocale',
      ),
      fallbackLocale: _localeTag(
        object['fallbackLocale'],
        '$path.fallbackLocale',
      ),
      locales: locales,
    );
  }

  MosaicLocaleCatalog _localeCatalog(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'direction', 'strings'}, path);
    final directionValue = _enumValue(
      object['direction'],
      const <String>{'ltr', 'rtl'},
      '$path.direction',
    );
    final stringValues = _object(object['strings'], '$path.strings');
    if (stringValues.isEmpty) {
      throw MosaicProtocolException(
        'Expected at least one localized string at $path.strings.',
      );
    }
    final strings = <String, String>{};
    for (final entry in stringValues.entries) {
      final key = _localizationKey(entry.key, '$path.strings key');
      strings[key] = _boundedNonEmptyString(
        entry.value,
        '$path.strings.$key',
        maximumLength: 5000,
      );
    }
    return MosaicLocaleCatalog(
      direction: directionValue == 'ltr'
          ? MosaicLocaleDirection.ltr
          : MosaicLocaleDirection.rtl,
      strings: strings,
    );
  }

  List<MosaicImageAsset> _assets(Object? value) {
    const path = r'$.assets';
    final values = _list(value, path);
    return <MosaicImageAsset>[
      for (var index = 0; index < values.length; index += 1)
        _imageAsset(values[index], '$path[$index]'),
    ];
  }

  MosaicImageAsset _imageAsset(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{'type', 'id', 'source', 'fallback'},
      path,
    );
    _expectConst(object['type'], 'image', '$path.type');

    final source = _object(object['source'], '$path.source');
    _expectKeys(source, const <String>{'type', 'key'}, '$path.source');
    _expectConst(source['type'], 'bundled', '$path.source.type');

    final fallback = _object(object['fallback'], '$path.fallback');
    _expectKeys(fallback, const <String>{'type', 'value'}, '$path.fallback');
    _expectConst(fallback['type'], 'placeholder', '$path.fallback.type');

    return MosaicImageAsset(
      id: _identifier(object['id'], '$path.id'),
      sourceKey: _assetKey(source['key'], '$path.source.key'),
      placeholder: _localizedText(fallback['value'], '$path.fallback.value'),
    );
  }

  List<MosaicProductReference> _products(Object? value) {
    const path = r'$.products';
    final values = _list(value, path);
    return <MosaicProductReference>[
      for (var index = 0; index < values.length; index += 1)
        _productReference(values[index], '$path[$index]'),
    ];
  }

  MosaicProductReference _productReference(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{'id', 'productId', 'label'},
      path,
      optional: const <String>{'badge'},
    );
    return MosaicProductReference(
      id: _identifier(object['id'], '$path.id'),
      productId: _productId(object['productId'], '$path.productId'),
      label: _localizedText(object['label'], '$path.label'),
      badge: object.containsKey('badge')
          ? _localizedText(object['badge'], '$path.badge')
          : null,
    );
  }

  MosaicScrollContainer _scrollContainer(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{
        'type',
        'id',
        'axis',
        'safeArea',
        'showsIndicators',
        'content',
      },
      path,
    );
    _expectConst(object['type'], 'scrollContainer', '$path.type');
    _expectConst(object['axis'], 'vertical', '$path.axis');
    _expectConst(object['safeArea'], 'respect', '$path.safeArea');
    return MosaicScrollContainer(
      id: _identifier(object['id'], '$path.id'),
      showsIndicators: _boolean(
        object['showsIndicators'],
        '$path.showsIndicators',
      ),
      content: _verticalStack(object['content'], '$path.content'),
    );
  }

  MosaicVerticalStack _verticalStack(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{
        'type',
        'id',
        'spacing',
        'padding',
        'horizontalAlignment',
        'children',
      },
      path,
    );
    _expectConst(object['type'], 'verticalStack', '$path.type');
    final children = _nonEmptyList(object['children'], '$path.children');
    return MosaicVerticalStack(
      id: _identifier(object['id'], '$path.id'),
      spacing: _logicalSize(object['spacing'], '$path.spacing'),
      padding: _edgeInsets(object['padding'], '$path.padding'),
      horizontalAlignment: _stackAlignment(
        object['horizontalAlignment'],
        '$path.horizontalAlignment',
      ),
      children: <MosaicNode>[
        for (var index = 0; index < children.length; index += 1)
          _node(children[index], '$path.children[$index]'),
      ],
    );
  }

  MosaicEdgeInsets _edgeInsets(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{'top', 'start', 'bottom', 'end'},
      path,
    );
    return MosaicEdgeInsets(
      top: _logicalSize(object['top'], '$path.top'),
      start: _logicalSize(object['start'], '$path.start'),
      bottom: _logicalSize(object['bottom'], '$path.bottom'),
      end: _logicalSize(object['end'], '$path.end'),
    );
  }

  MosaicNode _node(Object? value, String path) {
    final object = _object(value, path);
    final type = _string(object['type'], '$path.type');
    switch (type) {
      case 'verticalStack':
        return _verticalStack(value, path);
      case 'text':
        return _textComponent(object, path);
      case 'image':
        return _imageComponent(object, path);
      case 'featureList':
        return _featureListComponent(object, path);
      case 'productSelector':
        return _productSelectorComponent(object, path);
      case 'purchaseButton':
        return _purchaseButtonComponent(object, path);
      case 'restoreButton':
        return _restoreButtonComponent(object, path);
      case 'closeButton':
        return _closeButtonComponent(object, path);
      case 'legalText':
        return _legalTextComponent(object, path);
      default:
        throw MosaicProtocolException(
          'Unsupported component "$type" at $path.type.',
        );
    }
  }

  MosaicTextComponent _textComponent(
    Map<String, Object?> object,
    String path,
  ) {
    _expectKeys(
      object,
      const <String>{
        'type',
        'id',
        'value',
        'style',
        'alignment',
        'accessibility',
      },
      path,
    );
    return MosaicTextComponent(
      id: _identifier(object['id'], '$path.id'),
      value: _localizedText(object['value'], '$path.value'),
      style: _textStyle(object['style'], '$path.style'),
      alignment: _textAlignment(object['alignment'], '$path.alignment'),
      accessibility: _textAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
    );
  }

  MosaicImageComponent _imageComponent(
    Map<String, Object?> object,
    String path,
  ) {
    _expectKeys(
      object,
      const <String>{
        'type',
        'id',
        'assetId',
        'width',
        'aspectRatio',
        'contentMode',
        'accessibility',
      },
      path,
    );
    _expectConst(object['width'], 'fill', '$path.width');
    final mode = _enumValue(
      object['contentMode'],
      const <String>{'fit', 'fill'},
      '$path.contentMode',
    );
    return MosaicImageComponent(
      id: _identifier(object['id'], '$path.id'),
      assetId: _identifier(object['assetId'], '$path.assetId'),
      aspectRatio: _boundedNumber(
        object['aspectRatio'],
        '$path.aspectRatio',
        minimumExclusive: 0,
        maximum: 10,
      ),
      contentMode: mode == 'fit'
          ? MosaicImageContentMode.fit
          : MosaicImageContentMode.fill,
      accessibility: _imageAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
    );
  }

  MosaicFeatureListComponent _featureListComponent(
    Map<String, Object?> object,
    String path,
  ) {
    _expectKeys(
      object,
      const <String>{
        'type',
        'id',
        'marker',
        'itemSpacing',
        'items',
        'accessibility',
      },
      path,
    );
    _expectConst(object['marker'], 'checkmark', '$path.marker');
    final values = _nonEmptyList(object['items'], '$path.items');
    return MosaicFeatureListComponent(
      id: _identifier(object['id'], '$path.id'),
      itemSpacing: _logicalSize(object['itemSpacing'], '$path.itemSpacing'),
      items: <MosaicFeatureListItem>[
        for (var index = 0; index < values.length; index += 1)
          _featureListItem(values[index], '$path.items[$index]'),
      ],
      accessibility: _controlAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
    );
  }

  MosaicFeatureListItem _featureListItem(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'id', 'text'}, path);
    return MosaicFeatureListItem(
      id: _identifier(object['id'], '$path.id'),
      text: _localizedText(object['text'], '$path.text'),
    );
  }

  MosaicProductSelectorComponent _productSelectorComponent(
    Map<String, Object?> object,
    String path,
  ) {
    _expectKeys(
      object,
      const <String>{
        'type',
        'id',
        'productReferenceIds',
        'initiallySelectedProductReferenceId',
        'itemSpacing',
        'unavailableFallback',
        'accessibility',
      },
      path,
    );
    final values = _nonEmptyList(
      object['productReferenceIds'],
      '$path.productReferenceIds',
    );
    final referenceIds = <String>[
      for (var index = 0; index < values.length; index += 1)
        _identifier(values[index], '$path.productReferenceIds[$index]'),
    ];
    if (referenceIds.toSet().length != referenceIds.length) {
      throw MosaicProtocolException(
        'Duplicate product reference ID at $path.productReferenceIds.',
      );
    }
    return MosaicProductSelectorComponent(
      id: _identifier(object['id'], '$path.id'),
      productReferenceIds: referenceIds,
      initiallySelectedProductReferenceId: _identifier(
        object['initiallySelectedProductReferenceId'],
        '$path.initiallySelectedProductReferenceId',
      ),
      itemSpacing: _logicalSize(object['itemSpacing'], '$path.itemSpacing'),
      unavailableFallback: _unavailableProductFallback(
        object['unavailableFallback'],
        '$path.unavailableFallback',
      ),
      accessibility: _controlAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
    );
  }

  MosaicUnavailableProductFallback _unavailableProductFallback(
    Object? value,
    String path,
  ) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{'selection', 'whenNoneAvailable', 'message'},
      path,
    );
    _expectConst(object['selection'], 'firstAvailable', '$path.selection');
    _expectConst(
      object['whenNoneAvailable'],
      'showMessageAndDisablePurchase',
      '$path.whenNoneAvailable',
    );
    return MosaicUnavailableProductFallback(
      message: _localizedText(object['message'], '$path.message'),
    );
  }

  MosaicPurchaseButtonComponent _purchaseButtonComponent(
    Map<String, Object?> object,
    String path,
  ) {
    _expectKeys(
      object,
      const <String>{
        'type',
        'id',
        'label',
        'inProgressLabel',
        'action',
        'accessibility',
      },
      path,
    );
    return MosaicPurchaseButtonComponent(
      id: _identifier(object['id'], '$path.id'),
      label: _localizedText(object['label'], '$path.label'),
      inProgressLabel: _localizedText(
        object['inProgressLabel'],
        '$path.inProgressLabel',
      ),
      action: _purchaseAction(object['action'], '$path.action'),
      accessibility: _controlAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
    );
  }

  MosaicRestoreButtonComponent _restoreButtonComponent(
    Map<String, Object?> object,
    String path,
  ) {
    _expectKeys(
      object,
      const <String>{
        'type',
        'id',
        'label',
        'inProgressLabel',
        'action',
        'accessibility',
      },
      path,
    );
    return MosaicRestoreButtonComponent(
      id: _identifier(object['id'], '$path.id'),
      label: _localizedText(object['label'], '$path.label'),
      inProgressLabel: _localizedText(
        object['inProgressLabel'],
        '$path.inProgressLabel',
      ),
      action: _restoreAction(object['action'], '$path.action'),
      accessibility: _controlAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
    );
  }

  MosaicCloseButtonComponent _closeButtonComponent(
    Map<String, Object?> object,
    String path,
  ) {
    _expectKeys(
      object,
      const <String>{'type', 'id', 'label', 'action', 'accessibility'},
      path,
    );
    return MosaicCloseButtonComponent(
      id: _identifier(object['id'], '$path.id'),
      label: _localizedText(object['label'], '$path.label'),
      action: _closeAction(object['action'], '$path.action'),
      accessibility: _controlAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
    );
  }

  MosaicLegalTextComponent _legalTextComponent(
    Map<String, Object?> object,
    String path,
  ) {
    _expectKeys(
      object,
      const <String>{'type', 'id', 'value', 'alignment', 'accessibility'},
      path,
    );
    return MosaicLegalTextComponent(
      id: _identifier(object['id'], '$path.id'),
      value: _localizedText(object['value'], '$path.value'),
      alignment: _textAlignment(object['alignment'], '$path.alignment'),
      accessibility: _textAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
    );
  }

  MosaicPurchaseAction _purchaseAction(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'type', 'productSelectorId'}, path);
    _expectConst(object['type'], 'purchase', '$path.type');
    return MosaicPurchaseAction(
      productSelectorId: _identifier(
        object['productSelectorId'],
        '$path.productSelectorId',
      ),
    );
  }

  MosaicRestoreAction _restoreAction(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'type'}, path);
    _expectConst(object['type'], 'restore', '$path.type');
    return const MosaicRestoreAction();
  }

  MosaicCloseAction _closeAction(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'type'}, path);
    _expectConst(object['type'], 'close', '$path.type');
    return const MosaicCloseAction();
  }

  MosaicLocalizedText _localizedText(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'default', 'localizationKey'}, path);
    return MosaicLocalizedText(
      defaultValue: _boundedNonEmptyString(
        object['default'],
        '$path.default',
        maximumLength: 5000,
      ),
      localizationKey: _localizationKey(
        object['localizationKey'],
        '$path.localizationKey',
      ),
    );
  }

  MosaicTextAccessibility _textAccessibility(Object? value, String path) {
    final object = _object(value, path);
    final role = _string(object['role'], '$path.role');
    if (role == 'text') {
      _expectKeys(object, const <String>{'role'}, path);
      return const MosaicTextAccessibility(
        role: MosaicTextAccessibilityRole.text,
      );
    }
    if (role == 'heading') {
      _expectKeys(object, const <String>{'role', 'level'}, path);
      return MosaicTextAccessibility(
        role: MosaicTextAccessibilityRole.heading,
        level: _integerInRange(
          object['level'],
          '$path.level',
          minimum: 1,
          maximum: 6,
        ),
      );
    }
    throw MosaicProtocolException(
      'Expected text or heading accessibility role at $path.role.',
    );
  }

  MosaicImageAccessibility _imageAccessibility(Object? value, String path) {
    final object = _object(value, path);
    final hidden = _boolean(object['hidden'], '$path.hidden');
    if (hidden) {
      _expectKeys(object, const <String>{'hidden'}, path);
      return const MosaicImageAccessibility(hidden: true);
    }
    _expectKeys(object, const <String>{'hidden', 'label'}, path);
    return MosaicImageAccessibility(
      hidden: false,
      label: _localizedText(object['label'], '$path.label'),
    );
  }

  MosaicControlAccessibility _controlAccessibility(
    Object? value,
    String path,
  ) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{'label'},
      path,
      optional: const <String>{'hint'},
    );
    return MosaicControlAccessibility(
      label: _localizedText(object['label'], '$path.label'),
      hint: object.containsKey('hint')
          ? _localizedText(object['hint'], '$path.hint')
          : null,
    );
  }
}

void _validateDocumentSemantics(MosaicPaywallDocument document) {
  final nodes = document.nodes.toList(growable: false);
  _requireUnique(
    nodes.map((node) => node.id),
    'layout tree node identifier',
  );

  for (final node in nodes.whereType<MosaicFeatureListComponent>()) {
    _requireUnique(
      node.items.map((item) => item.id),
      'feature item identifier in ${node.id}',
    );
  }
  if (document.schemaVersion == mosaicProtocolV02Version) {
    if (document.layout.content is! MosaicStackComponent ||
        (document.layout.content as MosaicStackComponent).direction !=
            MosaicStackDirection.vertical) {
      throw const MosaicProtocolException(
        'Protocol 0.2 root scroll content must be a vertical Stack.',
      );
    }
    if (document.layout.content.children.isEmpty) {
      throw const MosaicProtocolException(
        'Protocol 0.2 root Stack must contain at least one child.',
      );
    }
    final pageIds = <String>[];
    for (final carousel in nodes.whereType<MosaicCarouselComponent>()) {
      if (carousel.initialPageIndex >= carousel.pages.length) {
        throw MosaicProtocolException(
          'Carousel ${carousel.id} initialPageIndex does not reference a page.',
        );
      }
      pageIds.addAll(carousel.pages.map((page) => page.id));
    }
    _requireUnique(
      <String>[...nodes.map((node) => node.id), ...pageIds],
      'layout tree node or Carousel page identifier',
    );
    _validateV02RuntimeSemantics(document);
  }

  _requireUnique(
    document.assets.map((asset) => asset.id),
    'asset identifier',
  );
  _requireUnique(
    document.products.map((product) => product.id),
    'product reference identifier',
  );
  _requireUnique(
    document.products.map((product) => product.productId),
    'provider product identifier',
  );

  final assetsById = <String, MosaicImageAsset>{
    for (final asset in document.assets) asset.id: asset,
  };
  final referencedAssets = <String>{};
  for (final image in nodes.whereType<MosaicImageComponent>()) {
    if (!assetsById.containsKey(image.assetId)) {
      throw MosaicProtocolException(
        'Image ${image.id} references unknown asset ${image.assetId}.',
      );
    }
    referencedAssets.add(image.assetId);
  }
  for (final asset in document.assets) {
    if (!referencedAssets.contains(asset.id)) {
      throw MosaicProtocolException('Asset ${asset.id} is unused.');
    }
  }

  final productsById = <String, MosaicProductReference>{
    for (final product in document.products) product.id: product,
  };
  final referencedProducts = <String>{};
  final selectors = <String, MosaicProductSelectorComponent>{};
  for (final selector in nodes.whereType<MosaicProductSelectorComponent>()) {
    selectors[selector.id] = selector;
    for (final referenceId in selector.productReferenceIds) {
      if (!productsById.containsKey(referenceId)) {
        throw MosaicProtocolException(
          'Product selector ${selector.id} references unknown product '
          '$referenceId.',
        );
      }
      referencedProducts.add(referenceId);
    }
    if (!selector.productReferenceIds
        .contains(selector.initiallySelectedProductReferenceId)) {
      throw MosaicProtocolException(
        'Product selector ${selector.id} initially selects an undeclared '
        'product.',
      );
    }
  }

  final selectorsWithPurchaseActions = <String>{};
  for (final button in nodes.whereType<MosaicPurchaseButtonComponent>()) {
    final selectorId = button.action.productSelectorId;
    if (!selectors.containsKey(selectorId)) {
      throw MosaicProtocolException(
        'Purchase button ${button.id} references unknown product selector '
        '$selectorId.',
      );
    }
    selectorsWithPurchaseActions.add(selectorId);
  }
  for (final selector in selectors.values) {
    if (!selectorsWithPurchaseActions.contains(selector.id)) {
      throw MosaicProtocolException(
        'Product selector ${selector.id} has no purchase action.',
      );
    }
  }
  for (final product in document.products) {
    if (!referencedProducts.contains(product.id)) {
      throw MosaicProtocolException('Product ${product.id} is unused.');
    }
  }

  _validateLocalizationSemantics(document);
  _validateCapabilities(document, nodes);
}

void _validateV02RuntimeSemantics(MosaicPaywallDocument document) {
  final switches = <String, MosaicSwitchComponent>{
    for (final node in document.nodes.whereType<MosaicSwitchComponent>())
      node.id: node,
  };

  void visit(MosaicNode node, {required bool insideCarousel}) {
    final visibility = _nodeVisibility(node);
    if (visibility is MosaicSwitchVisibility) {
      if (!switches.containsKey(visibility.switchId)) {
        throw MosaicProtocolException(
          '${node.type} ${node.id} visibility references unknown switch '
          '${visibility.switchId}.',
        );
      }
      if (visibility.switchId == node.id) {
        throw MosaicProtocolException(
          '${node.type} ${node.id} visibility cannot reference itself.',
        );
      }
    }
    switch (node) {
      case MosaicStackNode():
        for (final child in node.children) {
          visit(child, insideCarousel: insideCarousel);
        }
      case MosaicCarouselComponent():
        if (insideCarousel) {
          throw MosaicProtocolException(
            'Carousel ${node.id} cannot be nested inside another Carousel.',
          );
        }
        for (final page in node.pages) {
          visit(page.content, insideCarousel: true);
        }
      default:
        break;
    }
  }

  visit(document.layout.content, insideCarousel: false);
}

void _validateLocalizationSemantics(MosaicPaywallDocument document) {
  final localization = document.localization;
  final defaultCatalog = localization.locales[localization.defaultLocale];
  if (defaultCatalog == null) {
    throw MosaicProtocolException(
      'Default locale ${localization.defaultLocale} is not declared.',
    );
  }
  if (!localization.locales.containsKey(localization.fallbackLocale)) {
    throw MosaicProtocolException(
      'Fallback locale ${localization.fallbackLocale} is not declared.',
    );
  }

  final localizedTexts = _localizedTexts(document);
  final referencedKeys = <String>{};
  for (final text in localizedTexts) {
    referencedKeys.add(text.localizationKey);
    final defaultValue = defaultCatalog.strings[text.localizationKey];
    if (defaultValue == null) {
      throw MosaicProtocolException(
        'Missing default localization key ${text.localizationKey}.',
      );
    }
    if (defaultValue != text.defaultValue) {
      throw MosaicProtocolException(
        'Inline default for ${text.localizationKey} does not match the '
        '${localization.defaultLocale} catalog.',
      );
    }
  }

  final unusedKeys = defaultCatalog.strings.keys.toSet().difference(
        referencedKeys,
      );
  if (unusedKeys.isNotEmpty) {
    throw MosaicProtocolException(
      'Default localization catalog contains unused keys: '
      '${unusedKeys.join(', ')}.',
    );
  }

  for (final entry in localization.locales.entries) {
    if (entry.key == localization.defaultLocale) {
      continue;
    }
    final unknown = entry.value.strings.keys
        .toSet()
        .difference(defaultCatalog.strings.keys.toSet());
    if (unknown.isNotEmpty) {
      throw MosaicProtocolException(
        'Localization catalog ${entry.key} contains unknown keys: '
        '${unknown.join(', ')}.',
      );
    }
  }
}

Iterable<MosaicLocalizedText> _localizedTexts(
  MosaicPaywallDocument document,
) sync* {
  for (final asset in document.assets) {
    yield asset.placeholder;
  }
  for (final product in document.products) {
    yield product.label;
    if (product.badge case final badge?) {
      yield badge;
    }
  }
  for (final node in document.nodes) {
    switch (node) {
      case MosaicTextComponent():
        yield node.value;
        if (node.accessibility.label case final label?) {
          yield label;
        }
      case MosaicImageComponent():
        if (node.accessibility.label case final label?) {
          yield label;
        }
      case MosaicFeatureListComponent():
        for (final item in node.items) {
          yield item.text;
        }
        yield node.accessibility.label;
        if (node.accessibility.hint case final hint?) {
          yield hint;
        }
      case MosaicProductSelectorComponent():
        yield node.unavailableFallback.message;
        yield node.accessibility.label;
        if (node.accessibility.hint case final hint?) {
          yield hint;
        }
      case MosaicPurchaseButtonComponent():
        yield node.label;
        yield node.inProgressLabel;
        yield node.accessibility.label;
        if (node.accessibility.hint case final hint?) {
          yield hint;
        }
      case MosaicRestoreButtonComponent():
        yield node.label;
        yield node.inProgressLabel;
        yield node.accessibility.label;
        if (node.accessibility.hint case final hint?) {
          yield hint;
        }
      case MosaicCloseButtonComponent():
        yield node.label;
        yield node.accessibility.label;
        if (node.accessibility.hint case final hint?) {
          yield hint;
        }
      case MosaicLegalTextComponent():
        yield node.value;
        if (node.accessibility.label case final label?) {
          yield label;
        }
      case MosaicCarouselComponent():
        yield node.accessibility.label;
        if (node.accessibility.hint case final hint?) {
          yield hint;
        }
        for (final page in node.pages) {
          yield page.accessibilityLabel;
        }
      case MosaicSwitchComponent():
        yield node.label;
        yield node.accessibility.label;
        if (node.accessibility.hint case final hint?) {
          yield hint;
        }
      case MosaicCountdownComponent():
        yield node.completedText;
        if (node.accessibility.label case final label?) {
          yield label;
        }
      case MosaicScrollContainer() ||
            MosaicVerticalStack() ||
            MosaicStackComponent():
        break;
    }
  }
}

void _validateCapabilities(
  MosaicPaywallDocument document,
  List<MosaicNode> nodes,
) {
  if (document.schemaVersion == mosaicProtocolV02Version) {
    _validateV02Capabilities(document, nodes);
    return;
  }
  final expected = <String>{'localization.catalogs'};
  if (document.localization.locales.values.any(
    (catalog) => catalog.direction == MosaicLocaleDirection.rtl,
  )) {
    expected.add('localization.rtl');
  }
  if (document.products.isNotEmpty) {
    expected.add('product.references');
  }
  if (document.assets.isNotEmpty) {
    expected
      ..add('asset.bundledImage')
      ..add('fallback.asset');
  }

  for (final node in nodes) {
    expected.add(switch (node.type) {
      'scrollContainer' => 'layout.scrollContainer',
      'verticalStack' => 'layout.verticalStack',
      _ => 'component.${node.type}',
    });
    if (node is MosaicComponent) {
      expected.add('accessibility.metadata');
    }
    if (node is MosaicProductSelectorComponent) {
      expected
        ..add('fallback.product')
        ..add('outcome.normalized');
    }
    switch (node) {
      case MosaicPurchaseButtonComponent():
        expected
          ..add('action.purchase')
          ..add('outcome.normalized');
      case MosaicRestoreButtonComponent():
        expected
          ..add('action.restore')
          ..add('outcome.normalized');
      case MosaicCloseButtonComponent():
        expected
          ..add('action.close')
          ..add('outcome.normalized');
      default:
        break;
    }
  }

  final declared = document.compatibility.requiredCapabilities
      .map((capability) => capability.name)
      .toSet();
  final missing = expected.difference(declared);
  final unused = declared.difference(expected);
  if (missing.isNotEmpty || unused.isNotEmpty) {
    throw MosaicProtocolException(
      'Capability declarations do not match document content. Missing: '
      '${missing.join(', ')}; unused: ${unused.join(', ')}.',
    );
  }
}

void _validateV02Capabilities(
  MosaicPaywallDocument document,
  List<MosaicNode> nodes,
) {
  final expected = <String>{'localization.catalogs'};
  if (document.localization.locales.values.any(
    (catalog) => catalog.direction == MosaicLocaleDirection.rtl,
  )) {
    expected.add('localization.rtl');
  }
  if (document.products.isNotEmpty) expected.add('product.references');
  if (document.assets.isNotEmpty) {
    expected
      ..add('asset.bundledImage')
      ..add('fallback.asset');
  }
  if (document.layout.background != null) {
    expected
      ..add('style.colors')
      ..add('style.box');
  }
  for (final node in nodes) {
    expected.add(switch (node) {
      MosaicScrollContainer() => 'layout.scrollContainer',
      MosaicStackComponent() => 'layout.stack',
      MosaicVerticalStack() => throw const MosaicProtocolException(
          'Protocol 0.2 cannot contain verticalStack.',
        ),
      _ => 'component.${node.type}',
    });
    if (node is MosaicComponent || node is MosaicCarouselComponent) {
      expected.add('accessibility.metadata');
    }
    if (_nodeTypography(node) != null) expected.add('style.typography');
    final appearance = _nodeAppearance(node);
    if (appearance != null ||
        node is MosaicStackComponent && node.padding != _zeroInsets ||
        node is MosaicProductSelectorComponent && node.cardStyles != null) {
      expected.add('style.box');
    }
    if (_nodeSizing(node) != null || node is MosaicImageComponent) {
      expected.add('layout.sizing');
    }
    if (_nodeOuterInsets(node) != null) expected.add('layout.outerInsets');
    if (appearance?.clipContent != null) expected.add('style.clipping');
    final visibility = _nodeVisibility(node);
    if (visibility is MosaicSwitchVisibility) {
      expected.add('condition.switchVisibility');
    } else if (visibility is! MosaicAlwaysVisible ||
        _nodeHasExplicitAlwaysVisibility(node)) {
      expected.add('visibility.static');
    }
    if (_nodeUsesColor(node)) expected.add('style.colors');
    if (node is MosaicProductSelectorComponent) {
      expected
        ..add('fallback.product')
        ..add('outcome.normalized')
        ..add('style.productCardStates');
    }
    switch (node) {
      case MosaicPurchaseButtonComponent():
        expected
          ..add('action.purchase')
          ..add('outcome.normalized');
      case MosaicRestoreButtonComponent():
        expected
          ..add('action.restore')
          ..add('outcome.normalized');
      case MosaicCloseButtonComponent():
        expected
          ..add('action.close')
          ..add('outcome.normalized');
      default:
        break;
    }
  }

  final declared = document.compatibility.requiredCapabilities
      .map((capability) => capability.name)
      .toSet();
  final missing = expected.difference(declared);
  final unused = declared.difference(expected);
  if (missing.isNotEmpty || unused.isNotEmpty) {
    throw MosaicProtocolException(
      'Capability declarations do not match Protocol 0.2 document content. '
      'Missing: ${missing.join(', ')}; unused: ${unused.join(', ')}.',
    );
  }
}

const MosaicEdgeInsets _zeroInsets = MosaicEdgeInsets(
  top: 0,
  start: 0,
  bottom: 0,
  end: 0,
);

MosaicVisibility _nodeVisibility(MosaicNode node) => switch (node) {
      MosaicStackComponent() => node.visibility,
      MosaicTextComponent() => node.visibility,
      MosaicImageComponent() => node.visibility,
      MosaicFeatureListComponent() => node.visibility,
      MosaicProductSelectorComponent() => node.visibility,
      MosaicPurchaseButtonComponent() => node.visibility,
      MosaicRestoreButtonComponent() => node.visibility,
      MosaicCloseButtonComponent() => node.visibility,
      MosaicLegalTextComponent() => node.visibility,
      MosaicCarouselComponent() => node.visibility,
      MosaicSwitchComponent() => node.visibility,
      MosaicCountdownComponent() => node.visibility,
      _ => const MosaicAlwaysVisible(),
    };

MosaicTypography? _nodeTypography(MosaicNode node) => switch (node) {
      MosaicTextComponent() => node.typography,
      MosaicFeatureListComponent() => node.typography,
      MosaicPurchaseButtonComponent() => node.typography,
      MosaicRestoreButtonComponent() => node.typography,
      MosaicCloseButtonComponent() => node.typography,
      MosaicLegalTextComponent() => node.typography,
      MosaicSwitchComponent() => node.typography,
      MosaicCountdownComponent() => node.typography,
      _ => null,
    };

MosaicBoxAppearance? _nodeAppearance(MosaicNode node) => switch (node) {
      MosaicStackComponent() => node.appearance,
      MosaicTextComponent() => node.appearance,
      MosaicImageComponent() => node.appearance,
      MosaicFeatureListComponent() => node.appearance,
      MosaicProductSelectorComponent() => node.appearance,
      MosaicPurchaseButtonComponent() => node.appearance,
      MosaicRestoreButtonComponent() => node.appearance,
      MosaicCloseButtonComponent() => node.appearance,
      MosaicLegalTextComponent() => node.appearance,
      MosaicCarouselComponent() => node.appearance,
      MosaicSwitchComponent() => node.appearance,
      MosaicCountdownComponent() => node.appearance,
      _ => null,
    };

MosaicSizing? _nodeSizing(MosaicNode node) => switch (node) {
      MosaicStackComponent() => node.sizing,
      MosaicTextComponent() => node.sizing,
      MosaicFeatureListComponent() => node.sizing,
      MosaicProductSelectorComponent() => node.sizing,
      MosaicPurchaseButtonComponent() => node.sizing,
      MosaicRestoreButtonComponent() => node.sizing,
      MosaicCloseButtonComponent() => node.sizing,
      MosaicLegalTextComponent() => node.sizing,
      MosaicCarouselComponent() => node.sizing,
      MosaicCountdownComponent() => node.sizing,
      _ => null,
    };

MosaicEdgeInsets? _nodeOuterInsets(MosaicNode node) => switch (node) {
      MosaicStackComponent() => node.outerInsets,
      MosaicTextComponent() => node.outerInsets,
      MosaicImageComponent() => node.outerInsets,
      MosaicFeatureListComponent() => node.outerInsets,
      MosaicProductSelectorComponent() => node.outerInsets,
      MosaicPurchaseButtonComponent() => node.outerInsets,
      MosaicRestoreButtonComponent() => node.outerInsets,
      MosaicCloseButtonComponent() => node.outerInsets,
      MosaicLegalTextComponent() => node.outerInsets,
      MosaicCarouselComponent() => node.outerInsets,
      MosaicSwitchComponent() => node.outerInsets,
      MosaicCountdownComponent() => node.outerInsets,
      _ => null,
    };

bool _nodeUsesColor(MosaicNode node) =>
    _nodeTypography(node) != null ||
    _nodeAppearance(node) != null ||
    node is MosaicFeatureListComponent && node.markerColor != null ||
    node is MosaicProductSelectorComponent && node.cardStyles != null ||
    node is MosaicSwitchComponent;

// Explicit `always` is semantically different from absence for capability
// derivation, but the typed model intentionally normalizes both. Canonical
// fixtures currently do not author explicit `always`; retain this hook for a
// future presence-aware generated model without weakening validation.
bool _nodeHasExplicitAlwaysVisibility(MosaicNode node) => false;

void _requireUnique(Iterable<String> values, String label) {
  final seen = <String>{};
  for (final value in values) {
    if (!seen.add(value)) {
      throw MosaicProtocolException('Duplicate $label "$value".');
    }
  }
}

final RegExp _identifierPattern = RegExp(r'^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$');
final RegExp _localizationKeyPattern =
    RegExp(r'^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$');
final RegExp _localeTagPattern =
    RegExp(r'^[a-z]{2,3}(?:-(?:[A-Z]{2}|[0-9]{3}))?$');
final RegExp _productIdPattern = RegExp(r'^[A-Za-z0-9][A-Za-z0-9._:-]*$');
final RegExp _assetKeyPattern = RegExp(r'^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$');

Map<String, Object?> _object(Object? value, String path) {
  if (value is! Map<String, Object?>) {
    throw MosaicProtocolException('Expected an object at $path.');
  }
  return value;
}

List<Object?> _list(Object? value, String path) {
  if (value is! List<Object?>) {
    throw MosaicProtocolException('Expected an array at $path.');
  }
  return value;
}

List<Object?> _nonEmptyList(Object? value, String path) {
  final list = _list(value, path);
  if (list.isEmpty) {
    throw MosaicProtocolException('Expected a non-empty array at $path.');
  }
  return list;
}

String _string(Object? value, String path) {
  if (value is! String) {
    throw MosaicProtocolException('Expected a string at $path.');
  }
  return value;
}

String _boundedNonEmptyString(
  Object? value,
  String path, {
  required int maximumLength,
}) {
  final string = _string(value, path);
  final codePointLength = string.runes.length;
  if (codePointLength == 0 || codePointLength > maximumLength) {
    throw MosaicProtocolException(
      'Expected a string of 1 through $maximumLength characters at $path.',
    );
  }
  return string;
}

String _identifier(Object? value, String path) {
  final string = _boundedNonEmptyString(
    value,
    path,
    maximumLength: 128,
  );
  if (!_identifierPattern.hasMatch(string)) {
    throw MosaicProtocolException('Invalid identifier "$string" at $path.');
  }
  return string;
}

String _localizationKey(Object? value, String path) {
  final string = _string(value, path);
  if (string.runes.length > 256 || !_localizationKeyPattern.hasMatch(string)) {
    throw MosaicProtocolException(
      'Invalid localization key "$string" at $path.',
    );
  }
  return string;
}

String _localeTag(Object? value, String path) {
  final string = _string(value, path);
  if (!_localeTagPattern.hasMatch(string)) {
    throw MosaicProtocolException('Invalid locale tag "$string" at $path.');
  }
  return string;
}

String _productId(Object? value, String path) {
  final string = _boundedNonEmptyString(
    value,
    path,
    maximumLength: 256,
  );
  if (!_productIdPattern.hasMatch(string)) {
    throw MosaicProtocolException('Invalid product ID "$string" at $path.');
  }
  return string;
}

String _assetKey(Object? value, String path) {
  final string = _boundedNonEmptyString(
    value,
    path,
    maximumLength: 256,
  );
  if (!_assetKeyPattern.hasMatch(string)) {
    throw MosaicProtocolException('Invalid asset key "$string" at $path.');
  }
  return string;
}

bool _boolean(Object? value, String path) {
  if (value is! bool) {
    throw MosaicProtocolException('Expected a boolean at $path.');
  }
  return value;
}

const int _maximumProtocolRevision = 2147483647;

int _positiveInteger(Object? value, String path) => _integerInRange(
      value,
      path,
      minimum: 1,
      maximum: _maximumProtocolRevision,
    );

int _integerInRange(
  Object? value,
  String path, {
  required int minimum,
  required int maximum,
}) {
  if (value is! num ||
      !value.isFinite ||
      value < minimum ||
      value > maximum ||
      value != value.truncate()) {
    throw MosaicProtocolException(
      'Expected an integer from $minimum through $maximum at $path.',
    );
  }
  return value.toInt();
}

double _logicalSize(Object? value, String path) => _boundedNumber(
      value,
      path,
      minimum: 0,
      maximum: 4096,
    );

double _boundedNumber(
  Object? value,
  String path, {
  double? minimum,
  double? minimumExclusive,
  required double maximum,
}) {
  if (value is! num || !value.isFinite) {
    throw MosaicProtocolException('Expected a finite number at $path.');
  }
  final number = value.toDouble();
  if ((minimum != null && number < minimum) ||
      (minimumExclusive != null && number <= minimumExclusive) ||
      number > maximum) {
    throw MosaicProtocolException(
        'Number is outside the allowed range at $path.');
  }
  return number;
}

String _enumValue(Object? value, Set<String> values, String path) {
  final string = _string(value, path);
  if (!values.contains(string)) {
    throw MosaicProtocolException(
      'Expected one of ${values.join(', ')} at $path.',
    );
  }
  return string;
}

void _expectConst(Object? value, String expected, String path) {
  if (value != expected) {
    throw MosaicProtocolException('Expected "$expected" at $path.');
  }
}

MosaicStackHorizontalAlignment _stackAlignment(
  Object? value,
  String path,
) {
  final alignment = _enumValue(
    value,
    const <String>{'start', 'center', 'end', 'stretch'},
    path,
  );
  return switch (alignment) {
    'start' => MosaicStackHorizontalAlignment.start,
    'center' => MosaicStackHorizontalAlignment.center,
    'end' => MosaicStackHorizontalAlignment.end,
    _ => MosaicStackHorizontalAlignment.stretch,
  };
}

MosaicTextAlignment _textAlignment(Object? value, String path) {
  final alignment = _enumValue(
    value,
    const <String>{'start', 'center', 'end'},
    path,
  );
  return switch (alignment) {
    'start' => MosaicTextAlignment.start,
    'center' => MosaicTextAlignment.center,
    _ => MosaicTextAlignment.end,
  };
}

MosaicTextStyle _textStyle(Object? value, String path) {
  final style = _enumValue(
    value,
    const <String>{'title', 'body', 'caption'},
    path,
  );
  return switch (style) {
    'title' => MosaicTextStyle.title,
    'body' => MosaicTextStyle.body,
    _ => MosaicTextStyle.caption,
  };
}

void _expectKeys(
  Map<String, Object?> object,
  Set<String> required,
  String path, {
  Set<String> optional = const <String>{},
}) {
  final actual = object.keys.toSet();
  final missing = required.difference(actual);
  final unexpected = actual.difference(required.union(optional));
  if (missing.isNotEmpty) {
    throw MosaicProtocolException(
      'Missing properties ${missing.join(', ')} at $path.',
    );
  }
  if (unexpected.isNotEmpty) {
    throw MosaicProtocolException(
      'Unknown properties ${unexpected.join(', ')} at $path.',
    );
  }
}

final class MosaicProtocolException implements Exception {
  const MosaicProtocolException(this.message);

  final String message;

  @override
  String toString() => 'MosaicProtocolException: $message';
}
