import 'dart:convert';

const String mosaicProtocolVersion = '0.2';
const String mosaicProtocolV02Version = mosaicProtocolVersion;
const String mosaicFlutterSdkVersion = '0.2.0-dev.5';

/// Every Protocol 0.2 capability implemented by this Flutter SDK.
const Set<String> mosaicProtocolV02Capabilities = <String>{
  'layout.scrollContainer',
  'layout.stack',
  'layout.sizing',
  'layout.heightSizing',
  'layout.outerInsets',
  'navigation.screens',
  'navigation.sheets',
  'component.text',
  'component.image',
  'component.icon',
  'component.featureList',
  'component.productSelector',
  'component.productCard',
  'component.productBadge',
  'component.button',
  'component.carousel',
  'component.switch',
  'component.countdown',
  'localization.catalogs',
  'localization.rtl',
  'localization.productTemplate',
  'product.references',
  'asset.bundledImage',
  'asset.remoteImage',
  'asset.bundledVideo',
  'asset.remoteVideo',
  'action.purchase',
  'action.restore',
  'action.close',
  'action.navigateTo',
  'action.navigateBack',
  'action.openExternalUrl',
  'accessibility.metadata',
  'fallback.asset',
  'fallback.product',
  'outcome.normalized',
  'style.colors',
  'style.designTokens',
  'style.gradientBackground',
  'style.mediaBackground',
  'style.shadow',
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
  supportedSchemaVersions: const <String>{mosaicProtocolVersion},
  supportedCapabilities: <String, String>{
    for (final capability in mosaicProtocolV02Capabilities)
      capability: mosaicProtocolVersion,
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

enum MosaicProductBadgeAnchor { topStart, topEnd, bottomStart, bottomEnd }

enum MosaicFontWeight { regular, medium, semibold, bold }

enum MosaicTextOverflow { clip, ellipsis }

enum MosaicCountdownUnit { day, hour, minute, second }

enum MosaicSizingMode { fit, fill, fixed }

enum MosaicIconName {
  checkmark,
  close,
  lock,
  restore,
  externalLink,
  arrowBackward,
  arrowForward,
  chevronBackward,
  chevronForward,
}

/// A frozen Protocol 0.2 semantic token or canonical literal sRGB color.
final class MosaicColorValue {
  const MosaicColorValue._(this.value, this.isLiteral, this.isToken);

  factory MosaicColorValue.parse(String value) {
    if (_semanticColors.contains(value)) {
      return MosaicColorValue._(value, false, false);
    }
    if (RegExp(r'^#[0-9A-F]{8}$').hasMatch(value)) {
      return MosaicColorValue._(value, true, false);
    }
    throw MosaicProtocolException(
      'Expected a semantic color or uppercase #RRGGBBAA literal.',
    );
  }

  final String value;
  final bool isLiteral;
  final bool isToken;

  const MosaicColorValue.token(String id) : this._(id, false, true);
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

  const MosaicSizingValue.fit() : this._(MosaicSizingMode.fit, null);

  const MosaicSizingValue.fill() : this._(MosaicSizingMode.fill, null);

  const MosaicSizingValue.fixed(double value)
      : this._(MosaicSizingMode.fixed, value);

  final MosaicSizingMode mode;
  final double? value;
}

final class MosaicSizing {
  const MosaicSizing({required this.width, required this.height});

  final MosaicSizingValue width;
  final MosaicSizingValue height;
}

sealed class MosaicBackground {
  const MosaicBackground();

  /// Compatibility view for solid backgrounds.
  String get value => switch (this) {
        MosaicColorBackground(:final color) => color.value,
        _ => '',
      };
}

final class MosaicColorBackground extends MosaicBackground {
  const MosaicColorBackground(this.color);

  final MosaicColorValue color;
}

final class MosaicGradientStop {
  const MosaicGradientStop({required this.position, required this.color});

  final double position;
  final MosaicColorValue color;
}

final class MosaicLinearGradientBackground extends MosaicBackground {
  MosaicLinearGradientBackground(
      {required this.angle, required Iterable<MosaicGradientStop> stops})
      : stops = List.unmodifiable(stops);

  final double angle;
  final List<MosaicGradientStop> stops;
}

final class MosaicRadialGradientBackground extends MosaicBackground {
  MosaicRadialGradientBackground({
    required this.centerX,
    required this.centerY,
    required this.radius,
    required Iterable<MosaicGradientStop> stops,
  }) : stops = List.unmodifiable(stops);

  final double centerX;
  final double centerY;
  final double radius;
  final List<MosaicGradientStop> stops;
}

final class MosaicImageBackground extends MosaicBackground {
  const MosaicImageBackground({
    required this.assetId,
    required this.contentMode,
    required this.fallbackColor,
  });

  final String assetId;
  final MosaicImageContentMode contentMode;
  final MosaicColorValue fallbackColor;
}

final class MosaicVideoBackground extends MosaicBackground {
  const MosaicVideoBackground({
    required this.assetId,
    required this.contentMode,
    required this.fallbackColor,
    this.posterAssetId,
  });

  final String assetId;
  final String? posterAssetId;
  final MosaicImageContentMode contentMode;
  final MosaicColorValue fallbackColor;
}

final class MosaicBackgroundTokenReference extends MosaicBackground {
  const MosaicBackgroundTokenReference(this.id);

  final String id;
}

sealed class MosaicShadow {
  const MosaicShadow();
}

final class MosaicInlineShadow extends MosaicShadow {
  const MosaicInlineShadow({
    required this.color,
    required this.offsetX,
    required this.offsetY,
    required this.blurRadius,
  });

  final MosaicColorValue color;
  final double offsetX;
  final double offsetY;
  final double blurRadius;
}

final class MosaicShadowTokenReference extends MosaicShadow {
  const MosaicShadowTokenReference(this.id);

  final String id;
}

final class MosaicDesignToken<T> {
  const MosaicDesignToken(
      {required this.id, required this.name, required this.value});

  final String id;
  final String name;
  final T value;
}

final class MosaicDesignSystem {
  MosaicDesignSystem({
    required Iterable<MosaicDesignToken<MosaicColorValue>> colors,
    required Iterable<MosaicDesignToken<MosaicBackground>> backgrounds,
    required Iterable<MosaicDesignToken<MosaicShadow>> shadows,
  })  : colors = List.unmodifiable(colors),
        backgrounds = List.unmodifiable(backgrounds),
        shadows = List.unmodifiable(shadows);

  final List<MosaicDesignToken<MosaicColorValue>> colors;
  final List<MosaicDesignToken<MosaicBackground>> backgrounds;
  final List<MosaicDesignToken<MosaicShadow>> shadows;
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
    this.shadow,
  });

  final MosaicBackground? background;
  final MosaicBorderStyle? border;
  final double? cornerRadius;
  final double? opacity;
  final MosaicEdgeInsets? padding;
  final bool? clipContent;
  final MosaicShadow? shadow;
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
    required Iterable<MosaicAsset> assets,
    required Iterable<MosaicProductReference> products,
    required this.layout,
    this.designSystem,
    this.initialScreenId,
    Iterable<MosaicPaywallScreen> screens = const <MosaicPaywallScreen>[],
  })  : assets = List.unmodifiable(assets),
        products = List.unmodifiable(products),
        screens = List.unmodifiable(screens);

  final String schemaVersion;
  final String id;
  final int revision;
  final MosaicDocumentCompatibility compatibility;
  final MosaicLocalization localization;
  final MosaicDesignSystem? designSystem;
  final List<MosaicAsset> assets;
  final List<MosaicProductReference> products;

  /// Projection of the initial screen root. Prefer [screens] when traversing
  /// the document.
  final MosaicScrollContainer layout;
  final String? initialScreenId;
  final List<MosaicPaywallScreen> screens;

  MosaicPaywallScreen? get initialScreen =>
      initialScreenId == null ? null : screen(initialScreenId!);

  Iterable<MosaicNode> get nodes sync* {
    if (screens.isEmpty) {
      yield layout;
      yield* _walkStack(layout.content);
      return;
    }
    for (final screen in screens) {
      yield screen.layout;
      yield* _walkStack(screen.layout.content);
    }
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
      } else if (child is MosaicButtonComponent) {
        yield* _walkButtonChildren(child.children);
        if (child.inProgressChildren case final inProgress?) {
          yield* _walkButtonChildren(inProgress);
        }
      } else if (child is MosaicProductSelectorComponent) {
        yield* _walkProductCards(child.cards);
      }
    }
  }

  static Iterable<MosaicNode> _walkProductCards(
    Iterable<MosaicProductCardComponent> cards,
  ) sync* {
    for (final card in cards) {
      yield card;
      for (final child in card.children) {
        yield child;
        if (child is MosaicProductBadgeComponent) {
          yield* _walkPassiveChildren(child.children);
        } else if (child is MosaicStackNode) {
          yield* _walkPassiveChildren(<MosaicNode>[child]).skip(1);
        }
      }
    }
  }

  static Iterable<MosaicNode> _walkPassiveChildren(
    Iterable<MosaicNode> children,
  ) sync* {
    for (final child in children) {
      yield child;
      if (child is MosaicStackNode) {
        yield* _walkPassiveChildren(child.children);
      }
    }
  }

  static Iterable<MosaicNode> _walkButtonChildren(
    Iterable<MosaicNode> children,
  ) sync* {
    for (final child in children) {
      yield child;
      if (child is MosaicStackNode) {
        yield* _walkStack(child).skip(1);
      } else if (child is MosaicButtonComponent) {
        yield* _walkButtonChildren(child.children);
        if (child.inProgressChildren case final inProgress?) {
          yield* _walkButtonChildren(inProgress);
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
      if (asset is MosaicImageAsset && asset.id == id) {
        return asset;
      }
    }
    return null;
  }

  MosaicVideoAsset? videoAsset(String id) {
    for (final asset in assets) {
      if (asset is MosaicVideoAsset && asset.id == id) return asset;
    }
    return null;
  }

  MosaicColorValue resolveColor(MosaicColorValue color) {
    var current = color;
    final visited = <String>{};
    while (current.isToken) {
      if (!visited.add(current.value)) {
        throw const MosaicProtocolException('Cyclic color token reference.');
      }
      final token = designSystem?.colors
          .where((candidate) => candidate.id == current.value)
          .firstOrNull;
      if (token == null) {
        throw MosaicProtocolException('Unknown color token ${current.value}.');
      }
      current = token.value;
    }
    return current;
  }

  MosaicBackground resolveBackground(MosaicBackground background) {
    var current = background;
    final visited = <String>{};
    while (current is MosaicBackgroundTokenReference) {
      final id = current.id;
      if (!visited.add(id)) {
        throw const MosaicProtocolException(
          'Cyclic background token reference.',
        );
      }
      final token = designSystem?.backgrounds
          .where((candidate) => candidate.id == id)
          .firstOrNull;
      if (token == null) {
        throw MosaicProtocolException('Unknown background token $id.');
      }
      current = token.value;
    }
    return current;
  }

  MosaicInlineShadow resolveShadow(MosaicShadow shadow) {
    var current = shadow;
    final visited = <String>{};
    while (current is MosaicShadowTokenReference) {
      final id = current.id;
      if (!visited.add(id)) {
        throw const MosaicProtocolException('Cyclic shadow token reference.');
      }
      final token = designSystem?.shadows
          .where((candidate) => candidate.id == id)
          .firstOrNull;
      if (token == null) {
        throw MosaicProtocolException('Unknown shadow token $id.');
      }
      current = token.value;
    }
    return current as MosaicInlineShadow;
  }

  MosaicPaywallScreen? screen(String id) {
    for (final screen in screens) {
      if (screen.id == id) return screen;
    }
    return null;
  }
}

final class MosaicPaywallScreen {
  const MosaicPaywallScreen({
    required this.id,
    required this.layout,
    this.presentation = MosaicScreenPresentation.screen,
    this.accessibilityLabel,
  });

  final String id;
  final MosaicLocalizedText? accessibilityLabel;
  final MosaicScreenPresentation presentation;
  final MosaicScrollContainer layout;
}

enum MosaicScreenPresentation { screen, sheet }

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

sealed class MosaicAsset {
  const MosaicAsset({required this.id, required this.source});

  final String id;
  final MosaicAssetSource source;

  String? get sourceKey => switch (source) {
        MosaicBundledAssetSource(:final key) => key,
        MosaicRemoteAssetSource() => null,
      };
}

sealed class MosaicAssetSource {
  const MosaicAssetSource();
}

final class MosaicBundledAssetSource extends MosaicAssetSource {
  const MosaicBundledAssetSource(this.key);

  final String key;
}

final class MosaicRemoteAssetSource extends MosaicAssetSource {
  const MosaicRemoteAssetSource(this.url);

  final Uri url;
}

final class MosaicImageAsset extends MosaicAsset {
  const MosaicImageAsset({
    required super.id,
    required MosaicAssetSource source,
    required this.placeholder,
  }) : super(source: source);

  final MosaicLocalizedText placeholder;
}

final class MosaicVideoAsset extends MosaicAsset {
  const MosaicVideoAsset({required super.id, required super.source});
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
    final schemaVersion = _string(root['schemaVersion'], r'$.schemaVersion');
    if (schemaVersion != mosaicProtocolVersion) {
      throw MosaicProtocolException(
        'Unsupported schemaVersion "$schemaVersion" at \$.schemaVersion.',
      );
    }
    return _decodeV02(root);
  }

  MosaicPaywallDocument _decodeV02(Map<String, Object?> root) {
    _expectKeys(
      root,
      const <String>{
        'schemaVersion',
        'id',
        'revision',
        'compatibility',
        'localization',
        'designSystem',
        'assets',
        'products',
        'initialScreenId',
        'screens',
      },
      r'$',
    );
    final screenValues = _list(root['screens'], r'$.screens');
    if (screenValues.isEmpty || screenValues.length > 10) {
      throw const MosaicProtocolException(
        'Protocol 0.2 screens must contain between 1 and 10 entries.',
      );
    }
    final screens = <MosaicPaywallScreen>[
      for (var index = 0; index < screenValues.length; index += 1)
        _v02Screen(screenValues[index], '\$.screens[$index]'),
    ];
    if (screens.length > 1 &&
        screens.any((screen) => screen.accessibilityLabel == null)) {
      throw const MosaicProtocolException(
        'Every Protocol 0.2 Paywall Screen must have an accessibilityLabel '
        'when the document contains multiple screens.',
      );
    }
    final initialScreenId =
        _identifier(root['initialScreenId'], r'$.initialScreenId');
    final initialScreen =
        screens.where((screen) => screen.id == initialScreenId);
    if (initialScreen.length != 1) {
      throw MosaicProtocolException(
        'initialScreenId "$initialScreenId" must resolve exactly once.',
      );
    }
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
      designSystem: _v02DesignSystem(root['designSystem']),
      assets: _v02Assets(root['assets']),
      products: _v02Products(root['products']),
      layout: initialScreen.single.layout,
      initialScreenId: initialScreenId,
      screens: screens,
    );
    _validateDocumentSemantics(document);
    return document;
  }

  MosaicPaywallScreen _v02Screen(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{'id', 'presentation', 'layout'},
      path,
      optional: const <String>{'accessibilityLabel'},
    );
    return MosaicPaywallScreen(
      id: _identifier(object['id'], '$path.id'),
      accessibilityLabel: object.containsKey('accessibilityLabel')
          ? _localizedText(
              object['accessibilityLabel'],
              '$path.accessibilityLabel',
            )
          : null,
      presentation: _v02ScreenPresentation(
        object['presentation'],
        '$path.presentation',
      ),
      layout: _v02ScrollContainer(object['layout'], '$path.layout'),
    );
  }

  MosaicScreenPresentation _v02ScreenPresentation(
    Object? value,
    String path,
  ) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'type'}, path);
    return _enumValue(
              object['type'],
              const <String>{'screen', 'sheet'},
              '$path.type',
            ) ==
            'sheet'
        ? MosaicScreenPresentation.sheet
        : MosaicScreenPresentation.screen;
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
          ? _v02Background(object['background'], '$path.background')
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
      sizing: _v02OptionalSizing(object, path),
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
      'button' => _v02Button(object, path),
      'icon' => _v02Icon(object, path),
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
        'contentMode',
        'accessibility',
      },
      optional: const <String>{
        'aspectRatio',
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
    );
    return MosaicImageComponent(
      id: _identifier(object['id'], '$path.id'),
      assetId: _identifier(object['assetId'], '$path.assetId'),
      aspectRatio: object.containsKey('aspectRatio')
          ? _boundedNumber(
              object['aspectRatio'],
              '$path.aspectRatio',
              minimumExclusive: 0,
              maximum: 10,
            )
          : null,
      sizing: _v02OptionalSizing(object, path),
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
        'direction',
        'gap',
        'crossAxisAlignment',
        'initialProductCardId',
        'cards',
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
    final cardValues = _nonEmptyList(object['cards'], '$path.cards');
    if (cardValues.length > 20) {
      throw MosaicProtocolException(
        'Product Selector cards must contain at most 20 entries at '
        '$path.cards.',
      );
    }
    final direction = _enumValue(
      object['direction'],
      const <String>{'vertical', 'horizontal'},
      '$path.direction',
    );
    return MosaicProductSelectorComponent(
      id: _identifier(object['id'], '$path.id'),
      cards: <MosaicProductCardComponent>[
        for (var index = 0; index < cardValues.length; index += 1)
          _v02ProductCard(cardValues[index], '$path.cards[$index]'),
      ],
      initialProductCardId: _identifier(
        object['initialProductCardId'],
        '$path.initialProductCardId',
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
      crossAxisAlignment: _stackAlignment(
        object['crossAxisAlignment'],
        '$path.crossAxisAlignment',
      ),
      appearance: _v02OptionalAppearance(object, path),
      sizing: _v02OptionalSizing(object, path),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  MosaicProductCardComponent _v02ProductCard(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{
        'type',
        'id',
        'productReferenceId',
        'direction',
        'gap',
        'mainAxisDistribution',
        'crossAxisAlignment',
        'children',
        'styles',
      },
      path,
      optional: const <String>{'clipContent', 'accessibility', 'sizing'},
    );
    _expectConst(object['type'], 'productCard', '$path.type');
    if (object.containsKey('clipContent') &&
        _boolean(object['clipContent'], '$path.clipContent')) {
      throw MosaicProtocolException(
        'Product Card clipContent must be false at $path.clipContent.',
      );
    }
    final children = _nonEmptyList(object['children'], '$path.children');
    return MosaicProductCardComponent(
      id: _identifier(object['id'], '$path.id'),
      productReferenceId: _identifier(
        object['productReferenceId'],
        '$path.productReferenceId',
      ),
      direction: _v02StackDirection(object['direction'], '$path.direction'),
      gap: _logicalSize(object['gap'], '$path.gap'),
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
          _v02ProductCardChild(children[index], '$path.children[$index]'),
      ],
      styles: _v02ProductCardStyles(object['styles'], '$path.styles'),
      accessibilityLabel: object.containsKey('accessibility')
          ? _v02ProductCardAccessibility(
              object['accessibility'],
              '$path.accessibility',
            )
          : null,
      sizing: _v02OptionalSizing(object, path),
    );
  }

  MosaicLocalizedText _v02ProductCardAccessibility(
    Object? value,
    String path,
  ) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'label'}, path);
    return _localizedText(object['label'], '$path.label');
  }

  MosaicNode _v02ProductCardChild(Object? value, String path) {
    final object = _object(value, path);
    if (object['type'] == 'productBadge') {
      return _v02ProductBadge(object, path);
    }
    return _v02ProductCardPassiveNode(object, path);
  }

  MosaicProductBadgeComponent _v02ProductBadge(
    Map<String, Object?> object,
    String path,
  ) {
    _expectKeys(
      object,
      const <String>{
        'type',
        'id',
        'placement',
        'direction',
        'gap',
        'mainAxisDistribution',
        'crossAxisAlignment',
        'children',
        'styles',
      },
      path,
      optional: const <String>{'sizing'},
    );
    _expectConst(object['type'], 'productBadge', '$path.type');
    final children = _nonEmptyList(object['children'], '$path.children');
    if (children.length > 10) {
      throw MosaicProtocolException(
        'Product Badge children must contain at most 10 entries at '
        '$path.children.',
      );
    }
    return MosaicProductBadgeComponent(
      id: _identifier(object['id'], '$path.id'),
      placement: _v02ProductBadgePlacement(
        object['placement'],
        '$path.placement',
      ),
      direction: _v02StackDirection(object['direction'], '$path.direction'),
      gap: _logicalSize(object['gap'], '$path.gap'),
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
          _v02ProductCardPassiveNode(
            children[index],
            '$path.children[$index]',
          ),
      ],
      styles: _v02ProductCardStyles(object['styles'], '$path.styles'),
      sizing: _v02OptionalSizing(object, path),
    );
  }

  MosaicProductBadgePlacement _v02ProductBadgePlacement(
    Object? value,
    String path,
  ) {
    final object = _object(value, path);
    final mode = _enumValue(
      object['mode'],
      const <String>{'nested', 'overlay'},
      '$path.mode',
    );
    if (mode == 'nested') {
      _expectKeys(object, const <String>{'mode'}, path);
      return const MosaicNestedProductBadgePlacement();
    }
    _expectKeys(object, const <String>{'mode', 'anchor', 'inset'}, path);
    final anchor = _enumValue(
      object['anchor'],
      const <String>{'topStart', 'topEnd', 'bottomStart', 'bottomEnd'},
      '$path.anchor',
    );
    return MosaicOverlayProductBadgePlacement(
      anchor: MosaicProductBadgeAnchor.values.byName(anchor),
      inset: _boundedNumber(
        object['inset'],
        '$path.inset',
        minimum: 0,
        maximum: 64,
      ),
    );
  }

  MosaicNode _v02ProductCardPassiveNode(Object? value, String path) {
    final object = _object(value, path);
    final type = _string(object['type'], '$path.type');
    return switch (type) {
      'stack' => _v02ProductCardPassiveStack(object, path),
      'text' => _v02Text(object, path),
      'image' => _v02Image(object, path),
      'icon' => _v02Icon(object, path),
      'featureList' => _v02FeatureList(object, path),
      'countdown' => _v02Countdown(object, path),
      _ => throw MosaicProtocolException(
          'Product Card content must be passive; found "$type" at '
          '$path.type.',
        ),
    };
  }

  MosaicStackComponent _v02ProductCardPassiveStack(
    Map<String, Object?> object,
    String path,
  ) {
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
      direction: _v02StackDirection(object['direction'], '$path.direction'),
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
          _v02ProductCardPassiveNode(
            children[index],
            '$path.children[$index]',
          ),
      ],
      appearance: _v02OptionalAppearance(object, path, container: true),
      sizing: _v02OptionalSizing(object, path),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  MosaicStackDirection _v02StackDirection(Object? value, String path) =>
      _enumValue(value, const <String>{'vertical', 'horizontal'}, path) ==
              'vertical'
          ? MosaicStackDirection.vertical
          : MosaicStackDirection.horizontal;

  MosaicButtonComponent _v02Button(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV02ComponentKeys(
      object,
      path,
      required: const <String>{
        'type',
        'id',
        'direction',
        'gap',
        'mainAxisDistribution',
        'crossAxisAlignment',
        'children',
        'action',
        'accessibility',
      },
      optional: const <String>{
        'inProgressChildren',
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
    );
    final children = _nonEmptyList(object['children'], '$path.children');
    final inProgress = object.containsKey('inProgressChildren')
        ? _nonEmptyList(
            object['inProgressChildren'],
            '$path.inProgressChildren',
          )
        : null;
    final action = _v02ButtonAction(object['action'], '$path.action');
    if (inProgress != null &&
        action is! MosaicPurchaseAction &&
        action is! MosaicRestoreAction) {
      throw MosaicProtocolException(
        'inProgressChildren is valid only for purchase and restore Buttons '
        'at $path.',
      );
    }
    return MosaicButtonComponent(
      id: _identifier(object['id'], '$path.id'),
      direction: _enumValue(
                object['direction'],
                const <String>{'vertical', 'horizontal'},
                '$path.direction',
              ) ==
              'vertical'
          ? MosaicStackDirection.vertical
          : MosaicStackDirection.horizontal,
      gap: _logicalSize(object['gap'], '$path.gap'),
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
      inProgressChildren: inProgress == null
          ? null
          : <MosaicNode>[
              for (var index = 0; index < inProgress.length; index += 1)
                _v02Node(
                  inProgress[index],
                  '$path.inProgressChildren[$index]',
                ),
            ],
      action: action,
      accessibility: _controlAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
      appearance: _v02OptionalAppearance(object, path),
      sizing: _v02OptionalSizing(object, path),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  MosaicIconComponent _v02Icon(
    Map<String, Object?> object,
    String path,
  ) {
    _expectV02ComponentKeys(
      object,
      path,
      required: const <String>{
        'type',
        'id',
        'name',
        'size',
        'color',
        'accessibility',
      },
      optional: const <String>{
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
    );
    final iconName = _enumValue(
      object['name'],
      const <String>{
        'checkmark',
        'close',
        'lock',
        'restore',
        'externalLink',
        'arrowBackward',
        'arrowForward',
        'chevronBackward',
        'chevronForward',
      },
      '$path.name',
    );
    return MosaicIconComponent(
      id: _identifier(object['id'], '$path.id'),
      name: MosaicIconName.values.byName(iconName),
      size: _boundedNumber(
        object['size'],
        '$path.size',
        minimumExclusive: 0,
        maximum: 4096,
      ),
      color: _v02Color(object['color'], '$path.color'),
      accessibility: _imageAccessibility(
        object['accessibility'],
        '$path.accessibility',
      ),
      appearance: _v02OptionalAppearance(object, path),
      sizing: _v02OptionalSizing(object, path),
      outerInsets: _v02OptionalInsets(object, path, 'outerInsets'),
      visibility: _v02OptionalVisibility(object, path),
    );
  }

  MosaicAction _v02ButtonAction(Object? value, String path) {
    final object = _object(value, path);
    final type = _string(object['type'], '$path.type');
    return switch (type) {
      'purchase' => _purchaseAction(object, path),
      'restore' => _restoreAction(object, path),
      'close' => _closeAction(object, path),
      'navigateTo' => () {
          _expectKeys(object, const <String>{'type', 'screenId'}, path);
          return MosaicNavigateToAction(
            screenId: _identifier(object['screenId'], '$path.screenId'),
          );
        }(),
      'navigateBack' => () {
          _expectKeys(object, const <String>{'type'}, path);
          return const MosaicNavigateBackAction();
        }(),
      'openExternalUrl' => () {
          _expectKeys(object, const <String>{'type', 'url'}, path);
          return MosaicOpenExternalUrlAction(
            url: _v02ExternalUrl(object['url'], '$path.url'),
          );
        }(),
      _ => throw MosaicProtocolException(
          'Unsupported Button action "$type" at $path.type.',
        ),
    };
  }

  Uri _v02ExternalUrl(Object? value, String path) {
    final source = _string(value, path);
    final uri = Uri.tryParse(source);
    final match = RegExp(
      r'^https://([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::([0-9]{1,5}))?(?:[/?#][^\s\\\u0000-\u001F\u007F]*)?$',
      unicode: true,
    ).firstMatch(source);
    final rawHost = match?.group(1);
    final rawPort = int.tryParse(match?.group(2) ?? '');
    if (source.runes.length > 2048 ||
        match == null ||
        uri == null ||
        uri.scheme != 'https' ||
        !uri.hasAuthority ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        rawHost == null ||
        rawHost.contains('..') ||
        rawHost.toLowerCase() != uri.host.toLowerCase() ||
        (rawPort != null && rawPort > 65535)) {
      throw MosaicProtocolException(
        'External URL must be an absolute HTTPS URL without credentials at '
        '$path.',
      );
    }
    return uri;
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
      optional: const <String>{
        'appearance',
        'sizing',
        'outerInsets',
        'visibility',
      },
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
      sizing: _v02OptionalSizing(object, path),
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

  void _expectV02ComponentKeys(
    Map<String, Object?> object,
    String path, {
    required Set<String> required,
    required Set<String> optional,
  }) {
    _expectKeys(object, required, path, optional: optional);
  }

  MosaicColorValue _v02Color(Object? value, String path) {
    if (value is Map<String, Object?>) {
      _expectKeys(value, const <String>{'type', 'id'}, path);
      _expectConst(value['type'], 'colorToken', '$path.type');
      return MosaicColorValue.token(_identifier(value['id'], '$path.id'));
    }
    final source = _string(value, path);
    try {
      return MosaicColorValue.parse(source);
    } on MosaicProtocolException {
      throw MosaicProtocolException('Invalid color "$source" at $path.');
    }
  }

  MosaicBackground _v02Background(Object? value, String path) {
    final object = _object(value, path);
    final type = _string(object['type'], '$path.type');
    switch (type) {
      case 'color':
        _expectKeys(object, const <String>{'type', 'value'}, path);
        return MosaicColorBackground(_v02Color(object['value'], '$path.value'));
      case 'linearGradient':
        _expectKeys(object, const <String>{'type', 'angle', 'stops'}, path);
        return MosaicLinearGradientBackground(
          angle: _boundedNumber(
            object['angle'],
            '$path.angle',
            minimum: 0,
            maximum: 360,
          ),
          stops: _v02GradientStops(object['stops'], '$path.stops'),
        );
      case 'radialGradient':
        _expectKeys(
          object,
          const <String>{'type', 'center', 'radius', 'stops'},
          path,
        );
        final center = _object(object['center'], '$path.center');
        _expectKeys(center, const <String>{'x', 'y'}, '$path.center');
        return MosaicRadialGradientBackground(
          centerX: _boundedNumber(
            center['x'],
            '$path.center.x',
            minimum: 0,
            maximum: 1,
          ),
          centerY: _boundedNumber(
            center['y'],
            '$path.center.y',
            minimum: 0,
            maximum: 1,
          ),
          radius: _boundedNumber(
            object['radius'],
            '$path.radius',
            minimumExclusive: 0,
            maximum: 2,
          ),
          stops: _v02GradientStops(object['stops'], '$path.stops'),
        );
      case 'image':
      case 'video':
        _expectKeys(
          object,
          const <String>{'type', 'assetId', 'contentMode', 'fallbackColor'},
          path,
          optional: type == 'video'
              ? const <String>{'posterAssetId'}
              : const <String>{},
        );
        final mode = _enumValue(
          object['contentMode'],
          const <String>{'fit', 'fill'},
          '$path.contentMode',
        );
        final contentMode = mode == 'fit'
            ? MosaicImageContentMode.fit
            : MosaicImageContentMode.fill;
        final fallback = _v02Color(
          object['fallbackColor'],
          '$path.fallbackColor',
        );
        if (type == 'image') {
          return MosaicImageBackground(
            assetId: _identifier(object['assetId'], '$path.assetId'),
            contentMode: contentMode,
            fallbackColor: fallback,
          );
        }
        return MosaicVideoBackground(
          assetId: _identifier(object['assetId'], '$path.assetId'),
          posterAssetId: object.containsKey('posterAssetId')
              ? _identifier(object['posterAssetId'], '$path.posterAssetId')
              : null,
          contentMode: contentMode,
          fallbackColor: fallback,
        );
      case 'backgroundToken':
        _expectKeys(object, const <String>{'type', 'id'}, path);
        return MosaicBackgroundTokenReference(
          _identifier(object['id'], '$path.id'),
        );
      default:
        throw MosaicProtocolException('Unsupported background at $path.type.');
    }
  }

  List<MosaicGradientStop> _v02GradientStops(Object? value, String path) {
    final values = _list(value, path);
    if (values.length < 2 || values.length > 8) {
      throw MosaicProtocolException(
        'Gradient stops must contain 2 through 8 entries at $path.',
      );
    }
    final stops = <MosaicGradientStop>[];
    var previous = -1.0;
    for (var index = 0; index < values.length; index += 1) {
      final stopPath = '$path[$index]';
      final object = _object(values[index], stopPath);
      _expectKeys(object, const <String>{'position', 'color'}, stopPath);
      final position = _boundedNumber(
        object['position'],
        '$stopPath.position',
        minimum: 0,
        maximum: 1,
      );
      if (position <= previous) {
        throw MosaicProtocolException(
          'Gradient stop positions must be strictly increasing at $path.',
        );
      }
      previous = position;
      stops.add(
        MosaicGradientStop(
          position: position,
          color: _v02Color(object['color'], '$stopPath.color'),
        ),
      );
    }
    return stops;
  }

  MosaicShadow _v02Shadow(Object? value, String path) {
    final object = _object(value, path);
    final type = _string(object['type'], '$path.type');
    if (type == 'shadowToken') {
      _expectKeys(object, const <String>{'type', 'id'}, path);
      return MosaicShadowTokenReference(_identifier(object['id'], '$path.id'));
    }
    _expectKeys(
      object,
      const <String>{'type', 'color', 'offsetX', 'offsetY', 'blurRadius'},
      path,
    );
    _expectConst(type, 'shadow', '$path.type');
    return MosaicInlineShadow(
      color: _v02Color(object['color'], '$path.color'),
      offsetX: _boundedNumber(
        object['offsetX'],
        '$path.offsetX',
        minimum: -4096,
        maximum: 4096,
      ),
      offsetY: _boundedNumber(
        object['offsetY'],
        '$path.offsetY',
        minimum: -4096,
        maximum: 4096,
      ),
      blurRadius: _logicalSize(object['blurRadius'], '$path.blurRadius'),
    );
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
      'shadow',
    };
    if (object.isEmpty) {
      throw MosaicProtocolException(
        'Expected at least one appearance property at $path.',
      );
    }
    _expectKeys(object, const <String>{}, path, optional: allowed);
    return MosaicBoxAppearance(
      background: object.containsKey('background')
          ? _v02Background(object['background'], '$path.background')
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
      shadow: object.containsKey('shadow')
          ? _v02Shadow(object['shadow'], '$path.shadow')
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
    String parentPath,
  ) {
    if (!parent.containsKey('sizing')) return null;
    final path = '$parentPath.sizing';
    final object = _object(parent['sizing'], path);
    _expectKeys(object, const <String>{'width', 'height'}, path);
    return MosaicSizing(
      width: _v02SizingValue(object['width'], '$path.width'),
      height: _v02SizingValue(object['height'], '$path.height'),
    );
  }

  MosaicSizingValue _v02SizingValue(Object? value, String path) {
    if (value is String) {
      final mode = _enumValue(value, const <String>{'fit', 'fill'}, path);
      return mode == 'fill'
          ? const MosaicSizingValue.fill()
          : const MosaicSizingValue.fit();
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
        'opacity',
      },
      path,
      optional: const <String>{'shadow'},
    );
    return MosaicProductCardStyle(
      background: _v02Background(object['background'], '$path.background'),
      border: _v02Border(object['border'], '$path.border'),
      cornerRadius: _logicalSize(
        object['cornerRadius'],
        '$path.cornerRadius',
      ),
      padding: _edgeInsets(object['padding'], '$path.padding'),
      opacity: _boundedNumber(
        object['opacity'],
        '$path.opacity',
        minimum: 0,
        maximum: 1,
      ),
      shadow: object.containsKey('shadow')
          ? _v02Shadow(object['shadow'], '$path.shadow')
          : null,
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
        'opacity',
        'shadow',
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
          ? _v02Background(object['background'], '$path.background')
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
      opacity: object.containsKey('opacity')
          ? _boundedNumber(
              object['opacity'],
              '$path.opacity',
              minimum: 0,
              maximum: 1,
            )
          : null,
      shadow: object.containsKey('shadow')
          ? _v02Shadow(object['shadow'], '$path.shadow')
          : null,
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

  MosaicDesignSystem _v02DesignSystem(Object? value) {
    const path = r'$.designSystem';
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{'colors', 'backgrounds', 'shadows'},
      path,
    );
    List<MosaicDesignToken<T>> decode<T>(
      String key,
      T Function(Object? value, String path) decodeValue,
    ) {
      final tokenPath = '$path.$key';
      final values = _list(object[key], tokenPath);
      if (values.length > 256) {
        throw MosaicProtocolException(
          'Design-system $key must contain at most 256 entries.',
        );
      }
      return <MosaicDesignToken<T>>[
        for (var index = 0; index < values.length; index += 1)
          () {
            final entryPath = '$tokenPath[$index]';
            final entry = _object(values[index], entryPath);
            _expectKeys(
              entry,
              const <String>{'id', 'name', 'value'},
              entryPath,
            );
            return MosaicDesignToken<T>(
              id: _identifier(entry['id'], '$entryPath.id'),
              name: _boundedNonEmptyString(
                entry['name'],
                '$entryPath.name',
                maximumLength: 80,
              ),
              value: decodeValue(entry['value'], '$entryPath.value'),
            );
          }(),
      ];
    }

    return MosaicDesignSystem(
      colors: decode<MosaicColorValue>('colors', _v02Color),
      backgrounds: decode<MosaicBackground>('backgrounds', _v02Background),
      shadows: decode<MosaicShadow>('shadows', _v02Shadow),
    );
  }

  List<MosaicAsset> _v02Assets(Object? value) {
    const path = r'$.assets';
    final values = _list(value, path);
    return <MosaicAsset>[
      for (var index = 0; index < values.length; index += 1)
        _v02Asset(values[index], '$path[$index]'),
    ];
  }

  MosaicAsset _v02Asset(Object? value, String path) {
    final object = _object(value, path);
    final type = _enumValue(
      object['type'],
      const <String>{'image', 'video'},
      '$path.type',
    );
    _expectKeys(
      object,
      type == 'image'
          ? const <String>{'type', 'id', 'source', 'fallback'}
          : const <String>{'type', 'id', 'source'},
      path,
    );
    final source = _v02AssetSource(object['source'], '$path.source');
    final id = _identifier(object['id'], '$path.id');
    if (type == 'video') return MosaicVideoAsset(id: id, source: source);
    final fallback = _object(object['fallback'], '$path.fallback');
    _expectKeys(
      fallback,
      const <String>{'type', 'value'},
      '$path.fallback',
    );
    _expectConst(fallback['type'], 'placeholder', '$path.fallback.type');
    return MosaicImageAsset(
      id: id,
      source: source,
      placeholder: _localizedText(
        fallback['value'],
        '$path.fallback.value',
      ),
    );
  }

  MosaicAssetSource _v02AssetSource(Object? value, String path) {
    final object = _object(value, path);
    final type = _enumValue(
      object['type'],
      const <String>{'bundled', 'remote'},
      '$path.type',
    );
    if (type == 'bundled') {
      _expectKeys(object, const <String>{'type', 'key'}, path);
      return MosaicBundledAssetSource(_assetKey(object['key'], '$path.key'));
    }
    _expectKeys(object, const <String>{'type', 'url'}, path);
    return MosaicRemoteAssetSource(_v02ExternalUrl(object['url'], '$path.url'));
  }

  List<MosaicProductReference> _v02Products(Object? value) {
    const path = r'$.products';
    final values = _list(value, path);
    return <MosaicProductReference>[
      for (var index = 0; index < values.length; index += 1)
        _v02ProductReference(values[index], '$path[$index]'),
    ];
  }

  MosaicProductReference _v02ProductReference(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{'id', 'productId', 'label'},
      path,
    );
    return MosaicProductReference(
      id: _identifier(object['id'], '$path.id'),
      productId: _productId(object['productId'], '$path.productId'),
      label: _localizedText(object['label'], '$path.label'),
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

  MosaicFeatureListItem _featureListItem(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'id', 'text'}, path);
    return MosaicFeatureListItem(
      id: _identifier(object['id'], '$path.id'),
      text: _localizedText(object['text'], '$path.text'),
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
    if (document.designSystem == null) {
      throw const MosaicProtocolException(
        'Protocol 0.2 requires a document design system.',
      );
    }
    _requireUnique(
      document.screens.map((screen) => screen.id),
      'Paywall Screen identifier',
    );
    if (document.initialScreen?.presentation !=
        MosaicScreenPresentation.screen) {
      throw const MosaicProtocolException(
        'Protocol 0.2 initial screen must use Screen presentation.',
      );
    }
    _validateV02DesignSystem(document);
    for (final screen in document.screens) {
      if (screen.layout.content is! MosaicStackComponent ||
          (screen.layout.content as MosaicStackComponent).direction !=
              MosaicStackDirection.vertical) {
        throw MosaicProtocolException(
          'Protocol 0.2 screen ${screen.id} root scroll content must be a '
          'vertical Stack.',
        );
      }
      if (screen.layout.content.children.isEmpty) {
        throw MosaicProtocolException(
          'Protocol 0.2 screen ${screen.id} root Stack must contain at least '
          'one child.',
        );
      }
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

  final assetsById = <String, MosaicAsset>{
    for (final asset in document.assets) asset.id: asset,
  };
  final referencedAssets = <String>{};
  for (final image in nodes.whereType<MosaicImageComponent>()) {
    if (assetsById[image.assetId] is! MosaicImageAsset) {
      throw MosaicProtocolException(
        'Image ${image.id} must reference an image asset ${image.assetId}.',
      );
    }
    referencedAssets.add(image.assetId);
  }
  if (document.schemaVersion == mosaicProtocolV02Version) {
    for (final background in _allV02Backgrounds(document)) {
      final resolved = document.resolveBackground(background);
      switch (resolved) {
        case MosaicImageBackground():
          if (assetsById[resolved.assetId] is! MosaicImageAsset) {
            throw MosaicProtocolException(
              'Image background must reference image asset ${resolved.assetId}.',
            );
          }
          referencedAssets.add(resolved.assetId);
        case MosaicVideoBackground():
          if (assetsById[resolved.assetId] is! MosaicVideoAsset) {
            throw MosaicProtocolException(
              'Video background must reference video asset ${resolved.assetId}.',
            );
          }
          referencedAssets.add(resolved.assetId);
          if (resolved.posterAssetId case final poster?) {
            if (assetsById[poster] is! MosaicImageAsset) {
              throw MosaicProtocolException(
                'Video poster must reference image asset $poster.',
              );
            }
            referencedAssets.add(poster);
          }
        default:
          break;
      }
    }
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
    final referenceIds = selector.cards.isEmpty
        ? selector.productReferenceIds
        : selector.cards
            .map((card) => card.productReferenceId)
            .toList(growable: false);
    if (selector.cards.isNotEmpty &&
        referenceIds.toSet().length != referenceIds.length) {
      throw MosaicProtocolException(
        'Product selector ${selector.id} contains duplicate product '
        'reference bindings.',
      );
    }
    for (final referenceId in referenceIds) {
      if (!productsById.containsKey(referenceId)) {
        throw MosaicProtocolException(
          'Product selector ${selector.id} references unknown product '
          '$referenceId.',
        );
      }
      referencedProducts.add(referenceId);
    }
    if (selector.cards.isEmpty) {
      if (!selector.productReferenceIds
          .contains(selector.initiallySelectedProductReferenceId)) {
        throw MosaicProtocolException(
          'Product selector ${selector.id} initially selects an undeclared '
          'product.',
        );
      }
    } else {
      if (!selector.cards
          .any((card) => card.id == selector.initialProductCardId)) {
        throw MosaicProtocolException(
          'Product selector ${selector.id} initially selects an undeclared '
          'Product Card.',
        );
      }
      for (final card in selector.cards) {
        _validateProductCardStructure(card);
      }
    }
  }

  final selectorsWithPurchaseActions = <String>{};
  final purchaseActions = <({String buttonId, MosaicPurchaseAction action})>[
    for (final button in nodes.whereType<MosaicPurchaseButtonComponent>())
      (buttonId: button.id, action: button.action),
    for (final button in nodes.whereType<MosaicButtonComponent>())
      if (button.action case final MosaicPurchaseAction action)
        (buttonId: button.id, action: action),
  ];
  final screenByNodeId = document.schemaVersion == mosaicProtocolV02Version
      ? _v02ScreenByNodeId(document)
      : const <String, String>{};
  for (final entry in purchaseActions) {
    final selectorId = entry.action.productSelectorId;
    if (!selectors.containsKey(selectorId)) {
      throw MosaicProtocolException(
        'Purchase button ${entry.buttonId} references unknown product selector '
        '$selectorId.',
      );
    }
    if (document.schemaVersion == mosaicProtocolV02Version &&
        screenByNodeId[entry.buttonId] != screenByNodeId[selectorId]) {
      throw MosaicProtocolException(
        'Purchase Button ${entry.buttonId} must reference a Product Selector '
        'in the same Paywall Screen.',
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

void _validateProductCardStructure(MosaicProductCardComponent card) {
  final directBadges = card.children.whereType<MosaicProductBadgeComponent>();
  if (directBadges.length > 1) {
    throw MosaicProtocolException(
      'Product Card ${card.id} may contain at most one direct Product Badge.',
    );
  }

  var descendantCount = 0;
  var maximumStackDepth = 0;
  void visit(MosaicNode node, int stackDepth) {
    descendantCount += 1;
    final nextDepth = node is MosaicStackNode ? stackDepth + 1 : stackDepth;
    if (nextDepth > maximumStackDepth) maximumStackDepth = nextDepth;
    final children = switch (node) {
      MosaicStackNode() => node.children,
      MosaicProductBadgeComponent() => node.children,
      _ => const <MosaicNode>[],
    };
    for (final child in children) {
      visit(child, nextDepth);
    }
  }

  for (final child in card.children) {
    visit(child, 0);
  }
  if (descendantCount > 20) {
    throw MosaicProtocolException(
      'Product Card ${card.id} exceeds 20 passive descendants.',
    );
  }
  if (maximumStackDepth > 4) {
    throw MosaicProtocolException(
      'Product Card ${card.id} exceeds nested Stack depth 4.',
    );
  }
}

void _validateV02DesignSystem(MosaicPaywallDocument document) {
  final designSystem = document.designSystem!;
  for (final category in <Iterable<({String id, String name})>>[
    designSystem.colors.map((token) => (id: token.id, name: token.name)),
    designSystem.backgrounds.map((token) => (id: token.id, name: token.name)),
    designSystem.shadows.map((token) => (id: token.id, name: token.name)),
  ]) {
    _requireUnique(
        category.map((token) => token.id), 'design token identifier');
    _requireUnique(category.map((token) => token.name), 'design token name');
  }

  for (final color in _allV02Colors(document)) {
    document.resolveColor(color);
  }
  for (final background in _allV02Backgrounds(document)) {
    final resolved = document.resolveBackground(background);
    for (final color in _backgroundColors(resolved)) {
      document.resolveColor(color);
    }
  }
  for (final shadow in _allV02Shadows(document)) {
    final resolved = document.resolveShadow(shadow);
    document.resolveColor(resolved.color);
  }
}

Iterable<MosaicBackground> _allV02Backgrounds(
  MosaicPaywallDocument document,
) sync* {
  yield* document.designSystem!.backgrounds.map((token) => token.value);
  for (final screen in document.screens) {
    if (screen.layout.background case final background?) yield background;
  }
  for (final node in document.nodes) {
    if (_nodeAppearance(node)?.background case final background?) {
      yield background;
    }
    if (node is MosaicProductCardComponent) {
      yield node.styles.defaultStyle.background;
      if (node.styles.selectedOverride.background case final background?) {
        yield background;
      }
    } else if (node is MosaicProductBadgeComponent) {
      yield node.styles.defaultStyle.background;
      if (node.styles.selectedOverride.background case final background?) {
        yield background;
      }
    }
  }
}

Iterable<MosaicShadow> _allV02Shadows(MosaicPaywallDocument document) sync* {
  yield* document.designSystem!.shadows.map((token) => token.value);
  for (final node in document.nodes) {
    if (_nodeAppearance(node)?.shadow case final shadow?) yield shadow;
    if (node is MosaicProductCardComponent) {
      if (node.styles.defaultStyle.shadow case final shadow?) yield shadow;
      if (node.styles.selectedOverride.shadow case final shadow?) yield shadow;
    } else if (node is MosaicProductBadgeComponent) {
      if (node.styles.defaultStyle.shadow case final shadow?) yield shadow;
      if (node.styles.selectedOverride.shadow case final shadow?) yield shadow;
    }
  }
}

Iterable<MosaicColorValue> _backgroundColors(
    MosaicBackground background) sync* {
  switch (background) {
    case MosaicColorBackground():
      yield background.color;
    case MosaicLinearGradientBackground():
      yield* background.stops.map((stop) => stop.color);
    case MosaicRadialGradientBackground():
      yield* background.stops.map((stop) => stop.color);
    case MosaicImageBackground():
      yield background.fallbackColor;
    case MosaicVideoBackground():
      yield background.fallbackColor;
    case MosaicBackgroundTokenReference():
      break;
  }
}

Iterable<MosaicColorValue> _allV02Colors(MosaicPaywallDocument document) sync* {
  yield* document.designSystem!.colors.map((token) => token.value);
  for (final background in _allV02Backgrounds(document)) {
    yield* _backgroundColors(document.resolveBackground(background));
  }
  for (final node in document.nodes) {
    final appearance = _nodeAppearance(node);
    if (appearance?.border?.color case final color?) yield color;
    if (_nodeTypography(node)?.color case final color?) yield color;
    switch (node) {
      case MosaicFeatureListComponent():
        if (node.markerColor case final color?) yield color;
      case MosaicIconComponent():
        yield node.color;
      case MosaicSwitchComponent():
        yield node.offTrackColor;
        yield node.onTrackColor;
        yield node.thumbColor;
      case MosaicProductCardComponent():
        yield node.styles.defaultStyle.border.color;
        if (node.styles.selectedOverride.borderColor case final color?) {
          yield color;
        }
      case MosaicProductBadgeComponent():
        yield node.styles.defaultStyle.border.color;
        if (node.styles.selectedOverride.borderColor case final color?) {
          yield color;
        }
      default:
        break;
    }
  }
}

void _validateV02RuntimeSemantics(MosaicPaywallDocument document) {
  final screenByNodeId = _v02ScreenByNodeId(document);
  final switches = <String, MosaicSwitchComponent>{
    for (final node in document.nodes.whereType<MosaicSwitchComponent>())
      node.id: node,
  };

  void validateButtonChildren(
    MosaicButtonComponent button,
    Iterable<MosaicNode> children,
  ) {
    void visitChild(MosaicNode child) {
      if (child is MosaicButtonComponent ||
          child is MosaicProductSelectorComponent ||
          child is MosaicSwitchComponent ||
          child is MosaicCarouselComponent) {
        throw MosaicProtocolException(
          'Button ${button.id} cannot contain interactive descendant '
          '${child.type} ${child.id}.',
        );
      }
      if (child is MosaicStackNode) {
        for (final descendant in child.children) {
          visitChild(descendant);
        }
      }
    }

    for (final child in children) {
      visitChild(child);
    }
  }

  for (final button in document.nodes.whereType<MosaicButtonComponent>()) {
    validateButtonChildren(button, button.children);
    if (button.inProgressChildren case final inProgress?) {
      validateButtonChildren(button, inProgress);
    }
  }

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
      if (screenByNodeId[visibility.switchId] != screenByNodeId[node.id]) {
        throw MosaicProtocolException(
          '${node.type} ${node.id} visibility must reference a Switch in the '
          'same Paywall Screen.',
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
      case MosaicButtonComponent():
        for (final child in node.children) {
          visit(child, insideCarousel: insideCarousel);
        }
        if (node.inProgressChildren case final inProgress?) {
          for (final child in inProgress) {
            visit(child, insideCarousel: insideCarousel);
          }
        }
      case MosaicProductSelectorComponent():
        for (final card in node.cards) {
          visit(card, insideCarousel: insideCarousel);
        }
      case MosaicProductCardComponent():
        for (final child in node.children) {
          visit(child, insideCarousel: insideCarousel);
        }
      case MosaicProductBadgeComponent():
        for (final child in node.children) {
          visit(child, insideCarousel: insideCarousel);
        }
      default:
        break;
    }
  }

  for (final screen in document.screens) {
    visit(screen.layout.content, insideCarousel: false);
  }

  final screenIds = document.screens.map((screen) => screen.id).toSet();
  final forwardEdges = <String, Set<String>>{
    for (final screen in document.screens) screen.id: <String>{},
  };
  for (final button in document.nodes.whereType<MosaicButtonComponent>()) {
    if (button.action case final MosaicNavigateToAction action) {
      final sourceScreen = screenByNodeId[button.id]!;
      if (!screenIds.contains(action.screenId)) {
        throw MosaicProtocolException(
          'Button ${button.id} navigateTo references unknown Paywall Screen '
          '${action.screenId}.',
        );
      }
      if (sourceScreen == action.screenId) {
        throw MosaicProtocolException(
          'Button ${button.id} cannot navigateTo its own Paywall Screen.',
        );
      }
      forwardEdges[sourceScreen]!.add(action.screenId);
    }
  }

  final visited = <String>{};
  final active = <String>{};
  void visitGraph(String screenId) {
    if (!active.add(screenId)) {
      throw const MosaicProtocolException(
        'Protocol 0.2 navigateTo graph must be acyclic.',
      );
    }
    if (visited.add(screenId)) {
      for (final target in forwardEdges[screenId]!) {
        visitGraph(target);
      }
    }
    active.remove(screenId);
  }

  visitGraph(document.initialScreenId!);
  final unreachable = screenIds.difference(visited);
  if (unreachable.isNotEmpty) {
    throw MosaicProtocolException(
      'Protocol 0.2 contains unreachable Paywall Screens: '
      '${unreachable.join(', ')}.',
    );
  }
}

Map<String, String> _v02ScreenByNodeId(MosaicPaywallDocument document) {
  final result = <String, String>{};
  for (final screen in document.screens) {
    result[screen.layout.id] = screen.id;
    for (final node
        in MosaicPaywallDocument._walkStack(screen.layout.content)) {
      result[node.id] = screen.id;
    }
  }
  return result;
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

  if (document.schemaVersion == mosaicProtocolV02Version) {
    _validateV02ProductTemplates(document);
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

final RegExp _productTemplatePattern =
    RegExp(r'\{\{\s*product\.(name|price)\s*\}\}');

void _validateV02ProductTemplates(MosaicPaywallDocument document) {
  final allowed = Set<MosaicLocalizedText>.identity();
  void visitCardNode(MosaicNode node) {
    if (node case final MosaicTextComponent text) {
      allowed.add(text.value);
    }
    final children = switch (node) {
      MosaicStackNode() => node.children,
      MosaicProductBadgeComponent() => node.children,
      _ => const <MosaicNode>[],
    };
    for (final child in children) {
      visitCardNode(child);
    }
  }

  for (final selector
      in document.nodes.whereType<MosaicProductSelectorComponent>()) {
    for (final card in selector.cards) {
      if (card.accessibilityLabel case final label?) allowed.add(label);
      for (final child in card.children) {
        visitCardNode(child);
      }
    }
  }

  for (final text in _localizedTexts(document)) {
    final values = <String>[text.defaultValue];
    for (final catalog in document.localization.locales.values) {
      if (catalog.strings[text.localizationKey] case final value?) {
        values.add(value);
      }
    }
    for (final value in values) {
      final remainder = value.replaceAll(_productTemplatePattern, '');
      final malformed = remainder.contains('{{') || remainder.contains('}}');
      if (malformed) {
        throw MosaicProtocolException(
          'Localized text ${text.localizationKey} contains a malformed '
          'product template expression.',
        );
      }
      if (_productTemplatePattern.hasMatch(value) && !allowed.contains(text)) {
        throw MosaicProtocolException(
          'Localized text ${text.localizationKey} uses a product template '
          'outside Product Card content.',
        );
      }
    }
  }
}

Iterable<MosaicLocalizedText> _localizedTexts(
  MosaicPaywallDocument document,
) sync* {
  for (final screen in document.screens) {
    if (screen.accessibilityLabel case final label?) {
      yield label;
    }
  }
  for (final asset in document.assets.whereType<MosaicImageAsset>()) {
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
      case MosaicProductCardComponent():
        if (node.accessibilityLabel case final label?) {
          yield label;
        }
      case MosaicProductBadgeComponent():
        break;
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
      case MosaicButtonComponent():
        yield node.accessibility.label;
        if (node.accessibility.hint case final hint?) {
          yield hint;
        }
      case MosaicIconComponent():
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
  final expected = <String>{
    'localization.catalogs',
    'navigation.screens',
  };
  if (document.screens.any(
    (screen) => screen.presentation == MosaicScreenPresentation.sheet,
  )) {
    expected.add('navigation.sheets');
  }
  if (_documentUsesProductTemplates(document)) {
    expected.add('localization.productTemplate');
  }
  if (document.localization.locales.values.any(
    (catalog) => catalog.direction == MosaicLocaleDirection.rtl,
  )) {
    expected.add('localization.rtl');
  }
  if (document.products.isNotEmpty) expected.add('product.references');
  final designSystem = document.designSystem!;
  if (designSystem.colors.isNotEmpty ||
      designSystem.backgrounds.isNotEmpty ||
      designSystem.shadows.isNotEmpty) {
    expected.add('style.designTokens');
  }
  if (_allV02Backgrounds(document).map(document.resolveBackground).any(
        (background) =>
            background is MosaicLinearGradientBackground ||
            background is MosaicRadialGradientBackground,
      )) {
    expected.add('style.gradientBackground');
  }
  if (_allV02Backgrounds(document).map(document.resolveBackground).any(
        (background) =>
            background is MosaicImageBackground ||
            background is MosaicVideoBackground,
      )) {
    expected.add('style.mediaBackground');
  }
  if (_allV02Shadows(document).isNotEmpty) expected.add('style.shadow');
  if (_allV02Colors(document).isNotEmpty) expected.add('style.colors');
  for (final asset in document.assets) {
    final remote = asset.source is MosaicRemoteAssetSource;
    if (asset is MosaicImageAsset) {
      expected
        ..add(remote ? 'asset.remoteImage' : 'asset.bundledImage')
        ..add('fallback.asset');
    } else {
      expected.add(remote ? 'asset.remoteVideo' : 'asset.bundledVideo');
    }
  }
  if (document.screens.any((screen) => screen.layout.background != null)) {
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
        node is MosaicProductCardComponent ||
        node is MosaicProductBadgeComponent) {
      expected.add('style.box');
    }
    if (_nodeSizing(node) != null) {
      expected.add('layout.sizing');
      if (_nodeSizing(node) != null) expected.add('layout.heightSizing');
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
    if (node is MosaicProductCardComponent ||
        node is MosaicProductBadgeComponent) {
      expected.add('style.productCardStates');
    }
    switch (node) {
      case MosaicButtonComponent():
        final actionCapability = switch (node.action) {
          MosaicPurchaseAction() => 'action.purchase',
          MosaicRestoreAction() => 'action.restore',
          MosaicCloseAction() => 'action.close',
          MosaicNavigateToAction() => 'action.navigateTo',
          MosaicNavigateBackAction() => 'action.navigateBack',
          MosaicOpenExternalUrlAction() => 'action.openExternalUrl',
        };
        expected.add(actionCapability);
        if (node.action is MosaicPurchaseAction ||
            node.action is MosaicRestoreAction ||
            node.action is MosaicCloseAction) {
          expected.add('outcome.normalized');
        }
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
      MosaicButtonComponent() => node.visibility,
      MosaicIconComponent() => node.visibility,
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
      MosaicButtonComponent() || MosaicIconComponent() => null,
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
      MosaicButtonComponent() => node.appearance,
      MosaicIconComponent() => node.appearance,
      _ => null,
    };

MosaicSizing? _nodeSizing(MosaicNode node) => switch (node) {
      MosaicStackComponent() => node.sizing,
      MosaicTextComponent() => node.sizing,
      MosaicImageComponent() => node.sizing,
      MosaicFeatureListComponent() => node.sizing,
      MosaicProductSelectorComponent() => node.sizing,
      MosaicProductCardComponent() => node.sizing,
      MosaicProductBadgeComponent() => node.sizing,
      MosaicPurchaseButtonComponent() => node.sizing,
      MosaicRestoreButtonComponent() => node.sizing,
      MosaicCloseButtonComponent() => node.sizing,
      MosaicLegalTextComponent() => node.sizing,
      MosaicCarouselComponent() => node.sizing,
      MosaicSwitchComponent() => node.sizing,
      MosaicCountdownComponent() => node.sizing,
      MosaicButtonComponent() => node.sizing,
      MosaicIconComponent() => node.sizing,
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
      MosaicButtonComponent() => node.outerInsets,
      MosaicIconComponent() => node.outerInsets,
      _ => null,
    };

bool _nodeUsesColor(MosaicNode node) =>
    _nodeTypography(node) != null ||
    _nodeAppearance(node) != null ||
    node is MosaicFeatureListComponent && node.markerColor != null ||
    node is MosaicProductCardComponent ||
    node is MosaicProductBadgeComponent ||
    node is MosaicSwitchComponent ||
    node is MosaicIconComponent;

bool _documentUsesProductTemplates(MosaicPaywallDocument document) {
  for (final selector
      in document.nodes.whereType<MosaicProductSelectorComponent>()) {
    for (final card in selector.cards) {
      if (card.accessibilityLabel case final label?) {
        if (_localizedTextUsesProductTemplate(document, label)) return true;
      }
      for (final node in _cardDescendants(card)) {
        if (node is MosaicTextComponent &&
            _localizedTextUsesProductTemplate(document, node.value)) {
          return true;
        }
      }
    }
  }
  return false;
}

Iterable<MosaicNode> _cardDescendants(MosaicProductCardComponent card) sync* {
  Iterable<MosaicNode> visit(MosaicNode node) sync* {
    yield node;
    final children = switch (node) {
      MosaicStackNode() => node.children,
      MosaicProductBadgeComponent() => node.children,
      _ => const <MosaicNode>[],
    };
    for (final child in children) {
      yield* visit(child);
    }
  }

  for (final child in card.children) {
    yield* visit(child);
  }
}

bool _localizedTextUsesProductTemplate(
  MosaicPaywallDocument document,
  MosaicLocalizedText text,
) {
  if (_productTemplatePattern.hasMatch(text.defaultValue)) return true;
  for (final catalog in document.localization.locales.values) {
    final value = catalog.strings[text.localizationKey];
    if (value != null && _productTemplatePattern.hasMatch(value)) return true;
  }
  return false;
}

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

extension<T> on Iterable<T> {
  T? get firstOrNull {
    final iterator = this.iterator;
    return iterator.moveNext() ? iterator.current : null;
  }
}
