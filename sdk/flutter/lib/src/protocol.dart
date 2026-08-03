import 'dart:convert';

part 'protocol_models_layout.dart';
part 'protocol_models_components.dart';
part 'protocol_decoder_core.dart';
part 'protocol_decoder_components.dart';
part 'protocol_decoder_values.dart';
part 'protocol_validation.dart';
part 'protocol_validation_support.dart';

const String mosaicProtocolVersion = '0.2';
const String mosaicProtocolV02Version = mosaicProtocolVersion;
const String mosaicFlutterSdkVersion = '0.2.0-dev.11';

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
      throw MosaicProtocolException.unsupportedSchemaVersion(
        'Unsupported schemaVersion "$schemaVersion" at \$.schemaVersion.',
      );
    }
    return _decodeV02(root);
  }
}

/// Why a document was rejected, independent of the message wording.
///
/// Callers classify on this rather than on message text: a reworded exception
/// must not silently change a diagnostic code or a recovery action.
enum MosaicProtocolRejection {
  /// The document declares a schema version this SDK does not implement.
  unsupportedSchemaVersion,

  /// The document requires a capability or component this SDK cannot render.
  unsupportedCapability,

  /// The document does not conform to the implemented schema version.
  invalidDocument,
}

final class MosaicProtocolException implements Exception {
  const MosaicProtocolException(
    this.message, {
    this.rejection = MosaicProtocolRejection.invalidDocument,
  });

  const MosaicProtocolException.unsupportedSchemaVersion(this.message)
      : rejection = MosaicProtocolRejection.unsupportedSchemaVersion;

  const MosaicProtocolException.unsupportedCapability(this.message)
      : rejection = MosaicProtocolRejection.unsupportedCapability;

  final String message;
  final MosaicProtocolRejection rejection;

  @override
  String toString() => 'MosaicProtocolException: $message';
}

extension<T> on Iterable<T> {
  T? get firstOrNull {
    final iterator = this.iterator;
    return iterator.moveNext() ? iterator.current : null;
  }
}
