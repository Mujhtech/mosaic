import 'dart:convert';

part 'protocol_models_layout.dart';
part 'protocol_models_components.dart';
part 'protocol_motion.dart';
part 'protocol_decoder_core.dart';
part 'protocol_decoder_components.dart';
part 'protocol_decoder_values.dart';
part 'protocol_validation.dart';
part 'protocol_validation_support.dart';

/// The release-candidate Paywall Protocol version.
///
/// Everything that negotiates on the wire — Configuration Delivery and Local
/// Preview — stays pinned to this version. Local Preview `0.3` `$ref`s the
/// `0.3` paywall schema directly, and Configuration Delivery `v3` carries
/// exactly one paywall protocol, so advertising `0.4` there would claim a
/// contract neither of them has been bumped to.
const String mosaicProtocolVersion = '0.3';

/// The draft Paywall Protocol version this SDK can additionally read.
///
/// `0.4` is a pure superset of `0.3` apart from two removals `0.3` itself named
/// for it, plus the three motion primitives. It carries no compatibility
/// guarantee; nothing produces it in production yet.
const String mosaicProtocolVersionV04 = '0.4';

/// Every paywall schema version [MosaicProtocolDecoder] accepts.
const Set<String> mosaicSupportedProtocolVersions = <String>{
  mosaicProtocolVersion,
  mosaicProtocolVersionV04,
};

const String mosaicFlutterSdkVersion = '0.3.0-dev.1';

/// Localization keys the protocol itself consumes.
///
/// Unlike every other key, these are not referenced by a component: the
/// renderer reads them to announce something the document has no field for. A
/// reserved key must be declared exactly when the document contains the
/// construct that announces it.
const Map<String, List<String>> mosaicReservedAccessibilityKeys =
    <String, List<String>>{
  /// Announced for a Social Proof rating. The placeholders receive the rating
  /// in points, never in steps.
  'mosaic.a11y.rating': <String>[
    '{{ rating.value }}',
    '{{ rating.maximum }}',
  ],

  /// Announced while a Button is showing its in-progress content.
  'mosaic.a11y.in_progress': <String>[],
};

/// Every Protocol 0.3 capability implemented by this Flutter SDK.
const Set<String> mosaicProtocolV03Capabilities = <String>{
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
  'component.tabs',
  'component.timeline',
  'component.award',
  'component.socialProof',
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
  'accessibility.reservedStrings',
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
  'condition.tabVisibility',
};

/// Every Protocol 0.4 capability implemented by this Flutter SDK.
///
/// `0.4` is `0.3` plus the three motion primitives, minus
/// `style.productCardStates`. That capability was derived exactly when
/// `component.productSelector`, `component.productCard`, or
/// `component.productBadge` was derived — `styles` is required on all three —
/// so it could never vary independently and carried no information. `0.3`
/// named it for removal here and `0.4` removes it: a `0.4` document that
/// declares it is rejected as an unknown capability.
final Set<String> mosaicProtocolV04Capabilities = Set<String>.unmodifiable(
  <String>{
    ...mosaicProtocolV03Capabilities,
    ...mosaicMotionCapabilities,
  }..remove('style.productCardStates'),
);

/// The three enhancement-tier capabilities `0.4` introduces.
///
/// Granularity is three rather than one by the `0.3` distinguishability test: a
/// renderer that can cross-fade a selection but has no per-node entrance driver
/// is a real renderer, and one capability could not say so.
const Set<String> mosaicMotionCapabilities = <String>{
  'motion.appear',
  'motion.selection',
  'motion.loop',
};

/// Machine-readable compatibility information for host diagnostics and Studio.
final class MosaicCapabilityReport {
  MosaicCapabilityReport({
    required this.sdkVersion,
    required Map<String, Set<String>> capabilitiesBySchemaVersion,
  }) : capabilitiesBySchemaVersion = Map.unmodifiable(<String, Set<String>>{
          for (final entry in capabilitiesBySchemaVersion.entries)
            entry.key: Set<String>.unmodifiable(entry.value),
        });

  final String sdkVersion;

  /// Schema version to the capabilities this SDK implements at that version.
  ///
  /// Keyed by version rather than flattened to one capability-to-version map
  /// because most capabilities exist at both versions, and a flattened map
  /// would have to pick one and silently under-report the other.
  final Map<String, Set<String>> capabilitiesBySchemaVersion;

  Set<String> get supportedSchemaVersions =>
      Set<String>.unmodifiable(capabilitiesBySchemaVersion.keys);

  /// The capabilities implemented at [schemaVersion], or an empty set when this
  /// SDK does not implement that version at all.
  Set<String> capabilitiesFor(String schemaVersion) =>
      capabilitiesBySchemaVersion[schemaVersion] ?? const <String>{};
}

final MosaicCapabilityReport mosaicFlutterCapabilityReport =
    MosaicCapabilityReport(
  sdkVersion: mosaicFlutterSdkVersion,
  capabilitiesBySchemaVersion: <String, Set<String>>{
    mosaicProtocolVersion: mosaicProtocolV03Capabilities,
    mosaicProtocolVersionV04: mosaicProtocolV04Capabilities,
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

/// A frozen Protocol 0.3 semantic token or canonical literal sRGB color.
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
    Iterable<MosaicDesignToken<MosaicMotion>> motions =
        const <MosaicDesignToken<MosaicMotion>>[],
  })  : colors = List.unmodifiable(colors),
        backgrounds = List.unmodifiable(backgrounds),
        shadows = List.unmodifiable(shadows),
        motions = List.unmodifiable(motions);

  final List<MosaicDesignToken<MosaicColorValue>> colors;
  final List<MosaicDesignToken<MosaicBackground>> backgrounds;
  final List<MosaicDesignToken<MosaicShadow>> shadows;

  /// The fourth catalog, added by Protocol 0.4. Required and possibly empty
  /// there; always empty for a 0.3 document, which has no motion vocabulary.
  final List<MosaicDesignToken<MosaicMotion>> motions;
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

/// Visible only while the named Tabs component's runtime selection equals
/// [equals]. A false condition removes the node from layout, the accessibility
/// tree, and focus order, exactly as a false Switch condition does.
final class MosaicTabVisibility extends MosaicVisibility {
  const MosaicTabVisibility({required this.tabsId, required this.equals});

  final String tabsId;
  final String equals;
}

/// The runtime selection a conditional-visibility decision depends on.
final class MosaicSelectionState {
  MosaicSelectionState({
    Map<String, bool> switches = const <String, bool>{},
    Map<String, String> tabs = const <String, String>{},
  })  : switches = Map.unmodifiable(switches),
        tabs = Map.unmodifiable(tabs);

  /// Every Switch and Tabs controller the document declares, at its authored
  /// initial value. This is the state an accepted revision resets to.
  factory MosaicSelectionState.initialFor(MosaicPaywallDocument document) {
    final switches = <String, bool>{};
    final tabs = <String, String>{};
    for (final node in document.nodes) {
      if (node is MosaicSwitchComponent) {
        switches[node.id] = node.initialValue;
      } else if (node is MosaicTabsComponent) {
        tabs[node.id] = node.initialTabId;
      }
    }
    return MosaicSelectionState(switches: switches, tabs: tabs);
  }

  final Map<String, bool> switches;
  final Map<String, String> tabs;
}

/// A visibility condition named a controller the supplied state does not carry.
///
/// This is a caller bug, not a document defect, so it surfaces where it is
/// rather than as a component that quietly vanishes.
final class MosaicVisibilityStateException implements Exception {
  const MosaicVisibilityStateException(this.message);

  final String message;

  @override
  String toString() => 'MosaicVisibilityStateException: $message';
}

/// Resolves [visibility] against [state].
///
/// Throws [MosaicVisibilityStateException] when the condition names a Switch or
/// Tabs component [state] does not carry. Resolving it instead would read back
/// as `false`, which is a component silently disappearing rather than a caller
/// being told it has a bug — so there is deliberately no fallback here.
bool evaluateMosaicVisibility(
  MosaicVisibility visibility,
  MosaicSelectionState state,
) =>
    switch (visibility) {
      MosaicAlwaysVisible() => true,
      MosaicStaticallyHidden() => false,
      MosaicSwitchVisibility(:final switchId, :final equals) =>
        state.switches.containsKey(switchId)
            ? state.switches[switchId] == equals
            : throw MosaicVisibilityStateException(
                'Visibility depends on Switch $switchId, which the supplied '
                'runtime state does not carry.',
              ),
      MosaicTabVisibility(:final tabsId, :final equals) =>
        state.tabs.containsKey(tabsId)
            ? state.tabs[tabsId] == equals
            : throw MosaicVisibilityStateException(
                'Visibility depends on Tabs $tabsId, which the supplied '
                'runtime state does not carry.',
              ),
    };

/// Whether a Button is showing its idle or its in-progress content.
enum MosaicButtonAnnouncementState { idle, inProgress }

/// One announced accessibility element.
///
/// Elements are never joined. Each is its own node inside the labelled
/// container, in order, and the platform supplies whatever pause or
/// punctuation its locale and screen reader use.
final class MosaicAnnouncementElement {
  const MosaicAnnouncementElement({
    required this.segment,
    required this.text,
    this.item,
  });

  /// The Timeline entry this element belongs to, when the component has items.
  final String? item;
  final String segment;
  final String text;
}

/// The announced container a component's elements live inside.
final class MosaicAnnouncementContainer {
  const MosaicAnnouncementContainer({
    required this.role,
    required this.label,
    this.value,
    this.hint,
  });

  /// `group`, `list`, or `button`.
  final String role;
  final String label;
  final String? value;
  final String? hint;
}

/// The accessibility announcement contract for one component.
///
/// [separator] is always `null` and is modelled explicitly so that "no joining
/// happens" is a value a conformance vector can assert rather than an absence a
/// reader has to infer. A renderer that concatenated segments with `". "` would
/// have invented script-specific punctuation exactly the way a hardcoded "out
/// of" invents a word — it merely looks innocuous because it is punctuation.
final class MosaicAccessibilityAnnouncement {
  MosaicAccessibilityAnnouncement({
    required this.composition,
    required this.container,
    required Iterable<MosaicAnnouncementElement> elements,
    required Iterable<String> decorative,
  })  : elements = List.unmodifiable(elements),
        decorative = List.unmodifiable(decorative);

  /// `singleElement` for a Button, `separateElements` otherwise.
  final String composition;

  /// Always `null`: renderers do not join segments.
  Null get separator => null;
  final MosaicAnnouncementContainer container;
  final List<MosaicAnnouncementElement> elements;

  /// Ids of parts that must never be announced or focusable.
  final List<String> decorative;
}

/// Resolves one localized string from an explicit catalog.
///
/// Throws rather than falling back to the inline `default`. Validation
/// guarantees every referenced key exists in the default catalog, and the
/// default catalog is always a declared candidate, so a miss here means a
/// document was accepted that should not have been.
String _catalogString(Map<String, String> strings, String key) {
  final value = strings[key];
  if (value == null) {
    throw MosaicProtocolException(
      'The resolved catalog does not declare $key.',
    );
  }
  return value;
}

/// The composed accessibility announcement for [node].
///
/// [strings] is the resolved catalog, and [state] is required for a Button and
/// meaningless for anything else.
MosaicAccessibilityAnnouncement mosaicAccessibilityAnnouncement(
  MosaicNode node, {
  required Map<String, String> strings,
  MosaicButtonAnnouncementState? state,
}) {
  String text(MosaicLocalizedText value) =>
      _catalogString(strings, value.localizationKey);

  final elements = <MosaicAnnouncementElement>[];
  final decorative = <String>[];

  if (node is MosaicButtonComponent) {
    if (state == null) {
      throw const MosaicProtocolException(
        'A Button announcement requires an idle or inProgress state.',
      );
    }
    // A Button is one control. Its name is authored and does not change when it
    // becomes busy — a name that changes mid-operation is disorienting and
    // breaks UI automation — so busy-ness is carried as the control's value.
    // Neither idle nor in-progress content is announced, in both states alike.
    final shown = state == MosaicButtonAnnouncementState.inProgress
        ? (node.inProgressChildren ?? const <MosaicNode>[])
        : node.children;
    for (final child in shown) {
      decorative.add(child.id);
    }
    return MosaicAccessibilityAnnouncement(
      composition: 'singleElement',
      container: MosaicAnnouncementContainer(
        role: 'button',
        label: text(node.accessibility.label),
        value: state == MosaicButtonAnnouncementState.inProgress
            ? _catalogString(strings, 'mosaic.a11y.in_progress')
            : null,
        hint: node.accessibility.hint == null
            ? null
            : text(node.accessibility.hint!),
      ),
      elements: elements,
      decorative: decorative,
    );
  }

  final String role;
  final MosaicControlAccessibility accessibility;
  switch (node) {
    case MosaicSocialProofComponent():
      role = 'group';
      accessibility = node.accessibility;
      // An absent rating produces no element at all: it is neither a zero
      // rating nor an unknown one.
      if (node.rating case final rating?) {
        elements.add(
          MosaicAnnouncementElement(
            segment: 'rating',
            text: rating.announcement(
              _catalogString(strings, 'mosaic.a11y.rating'),
            ),
          ),
        );
      }
      elements.add(
        MosaicAnnouncementElement(segment: 'quote', text: text(node.quote)),
      );
      elements.add(
        MosaicAnnouncementElement(
          segment: 'attribution',
          text: text(node.attribution),
        ),
      );
      if (node.avatar != null) decorative.add('avatar');
    case MosaicAwardComponent():
      role = 'group';
      accessibility = node.accessibility;
      elements.add(
        MosaicAnnouncementElement(segment: 'title', text: text(node.title)),
      );
      if (node.subtitle case final subtitle?) {
        elements.add(
          MosaicAnnouncementElement(
            segment: 'subtitle',
            text: text(subtitle),
          ),
        );
      }
      if (node.emblem != null) decorative.add('emblem');
    case MosaicTimelineComponent():
      role = 'list';
      accessibility = node.accessibility;
      for (final entry in node.entries) {
        elements.add(
          MosaicAnnouncementElement(
            item: entry.id,
            segment: 'title',
            text: text(entry.title),
          ),
        );
        if (entry.description case final description?) {
          elements.add(
            MosaicAnnouncementElement(
              item: entry.id,
              segment: 'description',
              text: text(description),
            ),
          );
        }
        if (entry.marker != null) decorative.add('${entry.id}.marker');
      }
      decorative.add('connector');
    default:
      throw MosaicProtocolException(
        '${node.type} has no composed announcement contract in Protocol 0.3.',
      );
  }

  return MosaicAccessibilityAnnouncement(
    composition: 'separateElements',
    container: MosaicAnnouncementContainer(
      role: role,
      label: text(accessibility.label),
      hint: accessibility.hint == null ? null : text(accessibility.hint!),
    ),
    elements: elements,
    decorative: decorative,
  );
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
      } else if (child is MosaicTabsComponent) {
        for (final tab in child.tabs) {
          yield* _walkStack(tab.content);
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

  /// Resolves a `motionToken` chain to the inline motion it names.
  ///
  /// Token-to-token references are permitted, so this walks the chain the same
  /// way colours, backgrounds, and shadows do.
  MosaicInlineMotion resolveMotion(MosaicMotion motion) {
    var current = motion;
    final visited = <String>{};
    while (current is MosaicMotionTokenReference) {
      final id = current.id;
      if (!visited.add(id)) {
        throw const MosaicProtocolException('Cyclic motion token reference.');
      }
      final token = designSystem?.motions
          .where((candidate) => candidate.id == id)
          .firstOrNull;
      if (token == null) {
        throw MosaicProtocolException('Unknown motion token $id.');
      }
      current = token.value;
    }
    return current as MosaicInlineMotion;
  }

  /// [motion] with every curve resolved to an inline motion.
  ///
  /// The frame resolvers are pure and refuse an unresolved token, so the
  /// renderer resolves once at the boundary rather than per frame.
  MosaicNodeMotion resolveNodeMotion(MosaicNodeMotion motion) =>
      MosaicNodeMotion(
        appear: motion.appear?._withCurve(resolveMotion(motion.appear!.curve)),
        selection: motion.selection
            ?._withCurve(resolveMotion(motion.selection!.curve)),
        loop: motion.loop?._withCurve(resolveMotion(motion.loop!.curve)),
      );

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
    // Versions are exact identifiers, never ranges: a 0.4 reader accepts only
    // 0.4 and a 0.3 reader only 0.3. This SDK implements both, so it dispatches
    // on the declared version rather than widening either reader.
    if (!mosaicSupportedProtocolVersions.contains(schemaVersion)) {
      throw MosaicProtocolException.unsupportedSchemaVersion(
        'Unsupported schemaVersion "$schemaVersion" at \$.schemaVersion.',
      );
    }
    return _DocumentDecoder(schemaVersion)._decodeDocument(root);
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
