import 'dart:convert';

const String mosaicProtocolVersion = '0.1';
const String mosaicFlutterSdkVersion = '0.2.0-dev.1';

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
    for (final capability in mosaicProtocolV01Capabilities)
      capability: mosaicProtocolVersion,
  },
);

enum MosaicLocaleDirection { ltr, rtl }

enum MosaicStackHorizontalAlignment { start, center, end, stretch }

enum MosaicTextStyle { title, body, caption }

enum MosaicTextAlignment { start, center, end }

enum MosaicImageContentMode { fit, fill }

enum MosaicTextAccessibilityRole { text, heading }

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

  static Iterable<MosaicNode> _walkStack(MosaicVerticalStack stack) sync* {
    yield stack;
    for (final child in stack.children) {
      yield child;
      if (child is MosaicVerticalStack) {
        for (final descendant in _walkStack(child).skip(1)) {
          yield descendant;
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
  });

  final bool showsIndicators;
  final MosaicVerticalStack content;

  @override
  String get type => 'scrollContainer';
}

final class MosaicVerticalStack extends MosaicNode {
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

sealed class MosaicComponent extends MosaicNode {
  const MosaicComponent({required super.id});
}

final class MosaicTextAccessibility {
  const MosaicTextAccessibility({required this.role, this.level});

  final MosaicTextAccessibilityRole role;
  final int? level;
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
  });

  final MosaicLocalizedText value;
  final MosaicTextStyle style;
  final MosaicTextAlignment alignment;
  final MosaicTextAccessibility accessibility;

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
  });

  final String assetId;
  final double aspectRatio;
  final MosaicImageContentMode contentMode;
  final MosaicImageAccessibility accessibility;

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
  }) : items = List.unmodifiable(items);

  final double itemSpacing;
  final List<MosaicFeatureListItem> items;
  final MosaicControlAccessibility accessibility;

  @override
  String get type => 'featureList';
}

final class MosaicUnavailableProductFallback {
  const MosaicUnavailableProductFallback({required this.message});

  final MosaicLocalizedText message;
}

final class MosaicProductSelectorComponent extends MosaicComponent {
  MosaicProductSelectorComponent({
    required super.id,
    required Iterable<String> productReferenceIds,
    required this.initiallySelectedProductReferenceId,
    required this.itemSpacing,
    required this.unavailableFallback,
    required this.accessibility,
  }) : productReferenceIds = List.unmodifiable(productReferenceIds);

  final List<String> productReferenceIds;
  final String initiallySelectedProductReferenceId;
  final double itemSpacing;
  final MosaicUnavailableProductFallback unavailableFallback;
  final MosaicControlAccessibility accessibility;

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
  });

  final MosaicLocalizedText label;
  final MosaicLocalizedText inProgressLabel;
  final MosaicPurchaseAction action;
  final MosaicControlAccessibility accessibility;

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
  });

  final MosaicLocalizedText label;
  final MosaicLocalizedText inProgressLabel;
  final MosaicRestoreAction action;
  final MosaicControlAccessibility accessibility;

  @override
  String get type => 'restoreButton';
}

final class MosaicCloseButtonComponent extends MosaicComponent {
  const MosaicCloseButtonComponent({
    required super.id,
    required this.label,
    required this.action,
    required this.accessibility,
  });

  final MosaicLocalizedText label;
  final MosaicCloseAction action;
  final MosaicControlAccessibility accessibility;

  @override
  String get type => 'closeButton';
}

final class MosaicLegalTextComponent extends MosaicComponent {
  const MosaicLegalTextComponent({
    required super.id,
    required this.value,
    required this.alignment,
    required this.accessibility,
  });

  final MosaicLocalizedText value;
  final MosaicTextAlignment alignment;
  final MosaicTextAccessibility accessibility;

  @override
  String get type => 'legalText';
}

/// Strict native reader for the closed Protocol 0.1 RC1 document contract.
///
/// The JSON Schema remains canonical under `protocol/`; this reader implements
/// its decoding and semantic reader rules without packaging a schema copy.
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
      case MosaicScrollContainer() || MosaicVerticalStack():
        break;
    }
  }
}

void _validateCapabilities(
  MosaicPaywallDocument document,
  List<MosaicNode> nodes,
) {
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
