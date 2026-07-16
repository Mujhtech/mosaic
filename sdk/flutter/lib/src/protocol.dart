import 'dart:convert';

const String mosaicProtocolVersion = '0.1';

const Set<String> mosaicProtocolV01Capabilities = <String>{
  'layout.vertical',
  'component.text',
  'component.featureList',
  'component.productSelector',
  'component.purchaseButton',
  'component.restoreButton',
  'component.closeButton',
  'component.legalText',
};

final class MosaicPaywallDocument {
  MosaicPaywallDocument({
    required this.schemaVersion,
    required this.id,
    required this.revision,
    required this.compatibility,
    required this.layout,
  });

  final String schemaVersion;
  final String id;
  final int revision;
  final MosaicDocumentCompatibility compatibility;
  final MosaicVerticalLayout layout;
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

final class MosaicVerticalLayout {
  MosaicVerticalLayout({
    required this.id,
    required this.gap,
    required this.padding,
    required Iterable<MosaicComponent> children,
  }) : children = List.unmodifiable(children);

  final String id;
  final double gap;
  final double padding;
  final List<MosaicComponent> children;
}

sealed class MosaicComponent {
  const MosaicComponent({required this.id});

  final String id;
  String get type;
}

final class MosaicTextComponent extends MosaicComponent {
  const MosaicTextComponent({required super.id, required this.value});

  final MosaicLocalizedText value;

  @override
  String get type => 'text';
}

final class MosaicFeatureListComponent extends MosaicComponent {
  MosaicFeatureListComponent({
    required super.id,
    required Iterable<MosaicFeatureListItem> items,
  }) : items = List.unmodifiable(items);

  final List<MosaicFeatureListItem> items;

  @override
  String get type => 'featureList';
}

final class MosaicProductSelectorComponent extends MosaicComponent {
  MosaicProductSelectorComponent({
    required super.id,
    required Iterable<MosaicProductReference> products,
    required this.initiallySelectedProductId,
  }) : products = List.unmodifiable(products);

  final List<MosaicProductReference> products;
  final String initiallySelectedProductId;

  @override
  String get type => 'productSelector';
}

final class MosaicPurchaseButtonComponent extends MosaicComponent {
  const MosaicPurchaseButtonComponent({
    required super.id,
    required this.label,
  });

  final MosaicLocalizedText label;

  @override
  String get type => 'purchaseButton';
}

final class MosaicRestoreButtonComponent extends MosaicComponent {
  const MosaicRestoreButtonComponent({
    required super.id,
    required this.label,
  });

  final MosaicLocalizedText label;

  @override
  String get type => 'restoreButton';
}

final class MosaicCloseButtonComponent extends MosaicComponent {
  const MosaicCloseButtonComponent({
    required super.id,
    required this.label,
  });

  final MosaicLocalizedText label;

  @override
  String get type => 'closeButton';
}

final class MosaicLegalTextComponent extends MosaicComponent {
  const MosaicLegalTextComponent({required super.id, required this.value});

  final MosaicLocalizedText value;

  @override
  String get type => 'legalText';
}

final class MosaicLocalizedText {
  const MosaicLocalizedText({
    required this.defaultValue,
    required this.localizationKey,
  });

  final String defaultValue;
  final String localizationKey;
}

final class MosaicFeatureListItem {
  const MosaicFeatureListItem({required this.id, required this.text});

  final String id;
  final MosaicLocalizedText text;
}

final class MosaicProductReference {
  const MosaicProductReference({required this.productId});

  final String productId;
}

/// Strict reader for the canonical protocol 0.1 document shape.
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
      layout: _layout(root['layout']),
    );
    _validateDocumentSemantics(document);
    return document;
  }

  MosaicDocumentCompatibility _compatibility(Object? value) {
    const path = r'$.compatibility';
    final object = _object(value, path);
    _expectKeys(object, const <String>{'requiredCapabilities'}, path);
    final values = _nonEmptyList(
      object['requiredCapabilities'],
      '$path.requiredCapabilities',
    );
    final capabilities = <MosaicRequiredCapability>[];
    final seen = <String>{};
    for (var index = 0; index < values.length; index += 1) {
      final capabilityPath = '$path.requiredCapabilities[$index]';
      final capability = _object(values[index], capabilityPath);
      _expectKeys(
          capability, const <String>{'name', 'version'}, capabilityPath);
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
      if (!seen.add('$name@$version')) {
        throw MosaicProtocolException(
          'Duplicate capability "$name@$version" at $capabilityPath.',
        );
      }
      capabilities.add(MosaicRequiredCapability(name: name, version: version));
    }
    return MosaicDocumentCompatibility(capabilities);
  }

  MosaicVerticalLayout _layout(Object? value) {
    const path = r'$.layout';
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{'type', 'id', 'gap', 'padding', 'children'},
      path,
    );
    final type = _string(object['type'], '$path.type');
    if (type != 'vertical') {
      throw MosaicProtocolException(
          'Unsupported layout "$type" at $path.type.');
    }
    final childValues = _nonEmptyList(object['children'], '$path.children');
    return MosaicVerticalLayout(
      id: _identifier(object['id'], '$path.id'),
      gap: _nonNegativeNumber(object['gap'], '$path.gap'),
      padding: _nonNegativeNumber(object['padding'], '$path.padding'),
      children: <MosaicComponent>[
        for (var index = 0; index < childValues.length; index += 1)
          _component(childValues[index], '$path.children[$index]'),
      ],
    );
  }

  MosaicComponent _component(Object? value, String path) {
    final object = _object(value, path);
    final type = _string(object['type'], '$path.type');
    switch (type) {
      case 'text':
        _expectKeys(object, const <String>{'type', 'id', 'value'}, path);
        return MosaicTextComponent(
          id: _identifier(object['id'], '$path.id'),
          value: _localizedText(object['value'], '$path.value'),
        );
      case 'featureList':
        _expectKeys(object, const <String>{'type', 'id', 'items'}, path);
        final values = _nonEmptyList(object['items'], '$path.items');
        return MosaicFeatureListComponent(
          id: _identifier(object['id'], '$path.id'),
          items: <MosaicFeatureListItem>[
            for (var index = 0; index < values.length; index += 1)
              _featureListItem(values[index], '$path.items[$index]'),
          ],
        );
      case 'productSelector':
        _expectKeys(
          object,
          const <String>{
            'type',
            'id',
            'products',
            'initiallySelectedProductId',
          },
          path,
        );
        final values = _nonEmptyList(object['products'], '$path.products');
        return MosaicProductSelectorComponent(
          id: _identifier(object['id'], '$path.id'),
          products: <MosaicProductReference>[
            for (var index = 0; index < values.length; index += 1)
              _productReference(values[index], '$path.products[$index]'),
          ],
          initiallySelectedProductId: _productId(
            object['initiallySelectedProductId'],
            '$path.initiallySelectedProductId',
          ),
        );
      case 'purchaseButton':
        _expectKeys(object, const <String>{'type', 'id', 'label'}, path);
        return MosaicPurchaseButtonComponent(
          id: _identifier(object['id'], '$path.id'),
          label: _localizedText(object['label'], '$path.label'),
        );
      case 'restoreButton':
        _expectKeys(object, const <String>{'type', 'id', 'label'}, path);
        return MosaicRestoreButtonComponent(
          id: _identifier(object['id'], '$path.id'),
          label: _localizedText(object['label'], '$path.label'),
        );
      case 'closeButton':
        _expectKeys(object, const <String>{'type', 'id', 'label'}, path);
        return MosaicCloseButtonComponent(
          id: _identifier(object['id'], '$path.id'),
          label: _localizedText(object['label'], '$path.label'),
        );
      case 'legalText':
        _expectKeys(object, const <String>{'type', 'id', 'value'}, path);
        return MosaicLegalTextComponent(
          id: _identifier(object['id'], '$path.id'),
          value: _localizedText(object['value'], '$path.value'),
        );
      default:
        throw MosaicProtocolException(
          'Unsupported component "$type" at $path.type.',
        );
    }
  }

  MosaicLocalizedText _localizedText(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'default', 'localizationKey'}, path);
    return MosaicLocalizedText(
      defaultValue: _nonEmptyString(object['default'], '$path.default'),
      localizationKey: _localizationKey(
        object['localizationKey'],
        '$path.localizationKey',
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

  MosaicProductReference _productReference(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'productId'}, path);
    return MosaicProductReference(
      productId: _productId(object['productId'], '$path.productId'),
    );
  }
}

void _validateDocumentSemantics(MosaicPaywallDocument document) {
  final expectedCapabilities = <String>{
    'layout.vertical',
    for (final component in document.layout.children)
      'component.${component.type}',
  };
  final declaredCapabilities = document.compatibility.requiredCapabilities
      .map((capability) => capability.name)
      .toSet();
  final missing = expectedCapabilities.difference(declaredCapabilities);
  final unused = declaredCapabilities.difference(expectedCapabilities);
  if (missing.isNotEmpty || unused.isNotEmpty) {
    throw MosaicProtocolException(
      'Capability declarations do not match document content. '
      'Missing: ${missing.join(', ')}; unused: ${unused.join(', ')}.',
    );
  }

  for (final component in document.layout.children) {
    if (component is! MosaicProductSelectorComponent) {
      continue;
    }

    final productIds = component.products
        .map((product) => product.productId)
        .toList(growable: false);
    if (productIds.toSet().length != productIds.length) {
      throw MosaicProtocolException(
        'Product selector ${component.id} contains duplicate product IDs.',
      );
    }
    if (!productIds.contains(component.initiallySelectedProductId)) {
      throw MosaicProtocolException(
        'Product selector ${component.id} initially selects an undeclared product.',
      );
    }
  }
}

final RegExp _identifierPattern = RegExp(r'^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$');
final RegExp _localizationKeyPattern =
    RegExp(r'^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$');
final RegExp _productIdPattern = RegExp(r'^[A-Za-z0-9][A-Za-z0-9._:-]*$');

Map<String, Object?> _object(Object? value, String path) {
  if (value is! Map<String, Object?>) {
    throw MosaicProtocolException('Expected an object at $path.');
  }
  return value;
}

List<Object?> _nonEmptyList(Object? value, String path) {
  if (value is! List<Object?> || value.isEmpty) {
    throw MosaicProtocolException('Expected a non-empty array at $path.');
  }
  return value;
}

String _string(Object? value, String path) {
  if (value is! String) {
    throw MosaicProtocolException('Expected a string at $path.');
  }
  return value;
}

String _nonEmptyString(Object? value, String path) {
  final string = _string(value, path);
  if (string.isEmpty) {
    throw MosaicProtocolException('Expected a non-empty string at $path.');
  }
  return string;
}

String _identifier(Object? value, String path) {
  final string = _nonEmptyString(value, path);
  if (!_identifierPattern.hasMatch(string)) {
    throw MosaicProtocolException('Invalid identifier "$string" at $path.');
  }
  return string;
}

String _localizationKey(Object? value, String path) {
  final string = _string(value, path);
  if (!_localizationKeyPattern.hasMatch(string)) {
    throw MosaicProtocolException(
      'Invalid localization key "$string" at $path.',
    );
  }
  return string;
}

String _productId(Object? value, String path) {
  final string = _nonEmptyString(value, path);
  if (!_productIdPattern.hasMatch(string)) {
    throw MosaicProtocolException('Invalid product ID "$string" at $path.');
  }
  return string;
}

const int _maximumProtocolRevision = 2147483647;

int _positiveInteger(Object? value, String path) {
  if (value is! num ||
      !value.isFinite ||
      value < 1 ||
      value > _maximumProtocolRevision ||
      value != value.truncate()) {
    throw MosaicProtocolException(
      'Expected an integer from 1 through $_maximumProtocolRevision at $path.',
    );
  }
  return value.toInt();
}

double _nonNegativeNumber(Object? value, String path) {
  if (value is! num || !value.isFinite || value < 0) {
    throw MosaicProtocolException('Expected a non-negative number at $path.');
  }
  return value.toDouble();
}

void _expectKeys(
  Map<String, Object?> object,
  Set<String> expected,
  String path,
) {
  final missing = expected.difference(object.keys.toSet());
  final unexpected = object.keys.toSet().difference(expected);
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
