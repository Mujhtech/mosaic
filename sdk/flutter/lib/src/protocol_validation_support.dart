part of 'protocol.dart';

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

  _validateV03ProductTemplates(document);

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

  _validateReservedAccessibilityKeys(document, defaultCatalog);

  final unusedKeys = defaultCatalog.strings.keys
      .toSet()
      // Reserved keys are consumed by the protocol rather than referenced by a
      // component, so the unused sweep would flag every one of them.
      .difference(mosaicReservedAccessibilityKeys.keys.toSet())
      .difference(referencedKeys);
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

/// Enforces the reserved-key contract in both directions.
///
/// Missing where it is announced leaves the renderer inventing copy; declared
/// where nothing announces it is a string nobody reads, which is how a stale
/// translation survives a redesign.
void _validateReservedAccessibilityKeys(
  MosaicPaywallDocument document,
  MosaicLocaleCatalog defaultCatalog,
) {
  final nodes = document.nodes.toList(growable: false);
  final consumers = <String, bool>{
    'mosaic.a11y.rating': nodes
        .whereType<MosaicSocialProofComponent>()
        .any((node) => node.rating != null),
    'mosaic.a11y.in_progress': nodes
        .whereType<MosaicButtonComponent>()
        .any((node) => node.inProgressChildren != null),
  };
  for (final entry in mosaicReservedAccessibilityKeys.entries) {
    final key = entry.key;
    final consumed = consumers[key];
    if (consumed == null) {
      // A reserved key with no consumer rule would silently never be required.
      throw MosaicProtocolException(
        'Reserved localization key $key has no declared consumer in this SDK.',
      );
    }
    final declared = defaultCatalog.strings.containsKey(key);
    if (consumed && !declared) {
      throw MosaicProtocolException(
        'Default localization catalog must declare reserved key $key.',
      );
    }
    if (!consumed && declared) {
      throw MosaicProtocolException(
        'Default localization catalog declares reserved key $key but the '
        'document contains nothing that announces it.',
      );
    }
    if (!declared) continue;
    for (final catalogEntry in document.localization.locales.entries) {
      final value = catalogEntry.value.strings[key];
      if (value == null) continue;
      for (final placeholder in entry.value) {
        if (value.split(placeholder).length - 1 != 1) {
          throw MosaicProtocolException(
            'Localization catalog ${catalogEntry.key} key $key must contain '
            '$placeholder exactly once.',
          );
        }
      }
      final residue = entry.value.fold(
        value,
        (text, placeholder) => text.replaceAll(placeholder, ''),
      );
      if (residue.contains('{{') || residue.contains('}}')) {
        throw MosaicProtocolException(
          'Localization catalog ${catalogEntry.key} key $key contains an '
          'unsupported template expression.',
        );
      }
    }
  }
}

final RegExp _productTemplatePattern =
    RegExp(r'\{\{\s*product\.(name|price)\s*\}\}');

void _validateV03ProductTemplates(MosaicPaywallDocument document) {
  final allowed = Set<MosaicLocalizedText>.identity();
  void visitCardNode(MosaicNode node) {
    if (node case final MosaicTextComponent text) {
      allowed.add(text.value);
    }
    for (final child in _productCardChildren(node)) {
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
      case MosaicTabsComponent():
        yield node.accessibility.label;
        if (node.accessibility.hint case final hint?) {
          yield hint;
        }
        for (final tab in node.tabs) {
          yield tab.label;
        }
      case MosaicTimelineComponent():
        yield node.accessibility.label;
        if (node.accessibility.hint case final hint?) {
          yield hint;
        }
        for (final entry in node.entries) {
          yield entry.title;
          if (entry.description case final description?) {
            yield description;
          }
        }
      case MosaicAwardComponent():
        yield node.accessibility.label;
        if (node.accessibility.hint case final hint?) {
          yield hint;
        }
        yield node.title;
        if (node.subtitle case final subtitle?) {
          yield subtitle;
        }
      case MosaicSocialProofComponent():
        yield node.accessibility.label;
        if (node.accessibility.hint case final hint?) {
          yield hint;
        }
        yield node.quote;
        yield node.attribution;
      case MosaicScrollContainer() || MosaicStackComponent():
        break;
    }
  }
}

void _validateCapabilities(
  MosaicPaywallDocument document,
  List<MosaicNode> nodes,
) {
  final isV04 = document.schemaVersion == mosaicProtocolVersionV04;
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
  if (document
      .localization.locales[document.localization.defaultLocale]!.strings.keys
      .any(mosaicReservedAccessibilityKeys.containsKey)) {
    expected.add('accessibility.reservedStrings');
  }
  if (document.localization.locales.values.any(
    (catalog) => catalog.direction == MosaicLocaleDirection.rtl,
  )) {
    expected.add('localization.rtl');
  }
  if (document.products.isNotEmpty) expected.add('product.references');
  final designSystem = document.designSystem!;
  // Deliberately blind to `motions`. 0.4 inherits this derivation from 0.3
  // unchanged, and a motion catalog already derives its own capabilities at the
  // reference site — `motion.appear`, `motion.selection`, `motion.loop` — while
  // the unused-token rule guarantees the catalog is non-empty only when a node
  // reaches it. Adding `motions` here would make a motion-only document declare
  // a style capability the protocol never derives for it, and reject a valid
  // canonical fixture as configuration-unavailable.
  if (designSystem.colors.isNotEmpty ||
      designSystem.backgrounds.isNotEmpty ||
      designSystem.shadows.isNotEmpty) {
    expected.add('style.designTokens');
  }
  if (_allV03Backgrounds(document).map(document.resolveBackground).any(
        (background) =>
            background is MosaicLinearGradientBackground ||
            background is MosaicRadialGradientBackground,
      )) {
    expected.add('style.gradientBackground');
  }
  if (_allV03Backgrounds(document).map(document.resolveBackground).any(
        (background) =>
            background is MosaicImageBackground ||
            background is MosaicVideoBackground,
      )) {
    expected.add('style.mediaBackground');
  }
  if (_allV03Shadows(document).isNotEmpty) expected.add('style.shadow');
  if (_allV03Colors(document).isNotEmpty) expected.add('style.colors');
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
      _ => 'component.${node.type}',
    });
    if (node is MosaicComponent || node is MosaicCarouselComponent) {
      expected.add('accessibility.metadata');
    }
    if (_nodeTypographies(node).isNotEmpty) expected.add('style.typography');
    final appearance = _nodeAppearance(node);
    if (appearance != null ||
        node is MosaicStackComponent && node.padding != _zeroInsets ||
        node is MosaicProductCardComponent ||
        node is MosaicProductBadgeComponent ||
        node is MosaicTabsComponent) {
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
    } else if (visibility is MosaicTabVisibility) {
      expected.add('condition.tabVisibility');
    } else if (visibility is! MosaicAlwaysVisible ||
        _nodeHasExplicitAlwaysVisibility(node)) {
      expected.add('visibility.static');
    }
    if (_nodeUsesColor(node)) expected.add('style.colors');
    if (node is MosaicProductSelectorComponent) {
      expected
        ..add('fallback.product')
        ..add('outcome.normalized');
    }
    // `style.productCardStates` was derived exactly when one of the three
    // components that require `styles` was derived, so it could never vary
    // independently and carried no information. 0.3 named it for removal and
    // 0.4 removes it; deriving it there would demand a capability the 0.4
    // vocabulary no longer contains.
    if (!isV04 &&
        (node is MosaicProductSelectorComponent ||
            node is MosaicProductCardComponent ||
            node is MosaicProductBadgeComponent ||
            node is MosaicTabsComponent)) {
      expected.add('style.productCardStates');
    }
    // A motion capability is derived exactly when that motion is authored. The
    // unused-capability check below then actively protects the enhancement
    // tier: a document that claims motion it does not author is rejected.
    if (node.motion case final motion?) {
      if (motion.appear != null) expected.add('motion.appear');
      if (motion.selection != null) expected.add('motion.selection');
      if (motion.loop != null) expected.add('motion.loop');
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
      'Capability declarations do not match Protocol '
      '${document.schemaVersion} document content. '
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
      MosaicCarouselComponent() => node.visibility,
      MosaicSwitchComponent() => node.visibility,
      MosaicCountdownComponent() => node.visibility,
      MosaicButtonComponent() => node.visibility,
      MosaicIconComponent() => node.visibility,
      MosaicTabsComponent() => node.visibility,
      MosaicTimelineComponent() => node.visibility,
      MosaicAwardComponent() => node.visibility,
      MosaicSocialProofComponent() => node.visibility,
      _ => const MosaicAlwaysVisible(),
    };

/// Every authored typography a node carries.
///
/// Components with more than one authored text role contribute each of them, so
/// a colour or a capability derived from typography cannot go missing because
/// only the first role was inspected.
Iterable<MosaicTypography> _nodeTypographies(MosaicNode node) sync* {
  switch (node) {
    case MosaicTextComponent():
      if (node.typography case final typography?) yield typography;
    case MosaicFeatureListComponent():
      yield node.typography;
    case MosaicSwitchComponent():
      yield node.typography;
    case MosaicCountdownComponent():
      yield node.typography;
    case MosaicTabsComponent():
      yield node.labelTypography;
    case MosaicTimelineComponent():
      yield node.titleTypography;
      if (node.descriptionTypography case final typography?) yield typography;
    case MosaicAwardComponent():
      yield node.titleTypography;
      if (node.subtitleTypography case final typography?) yield typography;
    case MosaicSocialProofComponent():
      yield node.quoteTypography;
      yield node.attributionTypography;
    case MosaicButtonComponent():
    case MosaicIconComponent():
    case MosaicImageComponent():
    case MosaicProductSelectorComponent():
    case MosaicProductCardComponent():
    case MosaicProductBadgeComponent():
    case MosaicCarouselComponent():
    case MosaicScrollContainer():
    case MosaicStackComponent():
      break;
  }
}

MosaicTypography? _nodeTypography(MosaicNode node) =>
    _nodeTypographies(node).firstOrNull;

MosaicBoxAppearance? _nodeAppearance(MosaicNode node) => switch (node) {
      MosaicStackComponent() => node.appearance,
      MosaicTextComponent() => node.appearance,
      MosaicImageComponent() => node.appearance,
      MosaicFeatureListComponent() => node.appearance,
      MosaicProductSelectorComponent() => node.appearance,
      MosaicCarouselComponent() => node.appearance,
      MosaicSwitchComponent() => node.appearance,
      MosaicCountdownComponent() => node.appearance,
      MosaicButtonComponent() => node.appearance,
      MosaicIconComponent() => node.appearance,
      MosaicTabsComponent() => node.appearance,
      MosaicTimelineComponent() => node.appearance,
      MosaicAwardComponent() => node.appearance,
      MosaicSocialProofComponent() => node.appearance,
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
      MosaicCarouselComponent() => node.sizing,
      MosaicSwitchComponent() => node.sizing,
      MosaicCountdownComponent() => node.sizing,
      MosaicButtonComponent() => node.sizing,
      MosaicIconComponent() => node.sizing,
      MosaicTabsComponent() => node.sizing,
      MosaicTimelineComponent() => node.sizing,
      MosaicAwardComponent() => node.sizing,
      MosaicSocialProofComponent() => node.sizing,
      _ => null,
    };

MosaicEdgeInsets? _nodeOuterInsets(MosaicNode node) => switch (node) {
      MosaicStackComponent() => node.outerInsets,
      MosaicTextComponent() => node.outerInsets,
      MosaicImageComponent() => node.outerInsets,
      MosaicFeatureListComponent() => node.outerInsets,
      MosaicProductSelectorComponent() => node.outerInsets,
      MosaicCarouselComponent() => node.outerInsets,
      MosaicSwitchComponent() => node.outerInsets,
      MosaicCountdownComponent() => node.outerInsets,
      MosaicButtonComponent() => node.outerInsets,
      MosaicIconComponent() => node.outerInsets,
      MosaicTabsComponent() => node.outerInsets,
      MosaicTimelineComponent() => node.outerInsets,
      MosaicAwardComponent() => node.outerInsets,
      MosaicSocialProofComponent() => node.outerInsets,
      _ => null,
    };

bool _nodeUsesColor(MosaicNode node) =>
    _nodeTypography(node) != null ||
    _nodeAppearance(node) != null ||
    node is MosaicFeatureListComponent && node.markerColor != null ||
    node is MosaicProductCardComponent ||
    node is MosaicProductBadgeComponent ||
    node is MosaicSwitchComponent ||
    node is MosaicIconComponent ||
    node is MosaicTabsComponent ||
    node is MosaicTimelineComponent ||
    node is MosaicAwardComponent && node.emblem is MosaicAwardIconEmblem ||
    node is MosaicSocialProofComponent && node.rating != null;

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

/// Children of one Product Card descendant.
///
/// Product Card content is restricted to passive nodes at decode time, so every
/// shape that can legitimately appear here is enumerated. An unenumerated node
/// means the decoder accepted something this traversal would silently skip —
/// letting a whole subtree escape validation — so it fails loudly instead.
List<MosaicNode> _productCardChildren(MosaicNode node) => switch (node) {
      MosaicStackNode() => node.children,
      MosaicProductBadgeComponent() => node.children,
      MosaicTextComponent() ||
      MosaicImageComponent() ||
      MosaicIconComponent() ||
      MosaicFeatureListComponent() ||
      MosaicCountdownComponent() =>
        const <MosaicNode>[],
      _ => throw MosaicProtocolException(
          'Product Card content contains an unsupported ${node.type} node '
          '${node.id}.',
        ),
    };

Iterable<MosaicNode> _cardDescendants(MosaicProductCardComponent card) sync* {
  Iterable<MosaicNode> visit(MosaicNode node) sync* {
    yield node;
    for (final child in _productCardChildren(node)) {
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
    'stretch' => MosaicStackHorizontalAlignment.stretch,
    final unreachable =>
      throw StateError('Unhandled stack alignment "$unreachable".'),
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
    'end' => MosaicTextAlignment.end,
    final unreachable =>
      throw StateError('Unhandled text alignment "$unreachable".'),
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
