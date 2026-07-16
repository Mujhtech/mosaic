import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

void main() {
  test('decodes the repository canonical protocol 0.1 fixture', () {
    final fixture = _canonicalFixture();
    final document = const MosaicProtocolDecoder().decode(
      fixture.readAsStringSync(),
    );

    expect(document.schemaVersion, '0.1');
    expect(document.id, 'minimal-paywall');
    expect(document.revision, 1);
    expect(document.layout.id, 'root-layout');
    expect(document.layout.gap, 16);
    expect(document.layout.padding, 24);
    expect(
      document.compatibility.requiredCapabilities.map((item) => item.name),
      unorderedEquals(mosaicProtocolV01Capabilities),
    );
    expect(
      document.layout.children.map((component) => component.type).toList(),
      <String>[
        'closeButton',
        'text',
        'featureList',
        'productSelector',
        'purchaseButton',
        'restoreButton',
        'legalText',
      ],
    );

    final close = document.layout.children[0] as MosaicCloseButtonComponent;
    expect(close.label.defaultValue, 'Close');
    final text = document.layout.children[1] as MosaicTextComponent;
    expect(text.value.localizationKey, 'paywall.headline');
    final features = document.layout.children[2] as MosaicFeatureListComponent;
    expect(features.items.map((item) => item.id), <String>[
      'unlimited-projects',
      'priority-support',
    ]);
    final selector =
        document.layout.children[3] as MosaicProductSelectorComponent;
    expect(selector.initiallySelectedProductId, 'mosaic_pro_yearly');
    expect(selector.products.map((product) => product.productId), <String>[
      'mosaic_pro_monthly',
      'mosaic_pro_yearly',
    ]);
    expect(document.layout.children[4], isA<MosaicPurchaseButtonComponent>());
    expect(document.layout.children[5], isA<MosaicRestoreButtonComponent>());
    expect(document.layout.children[6], isA<MosaicLegalTextComponent>());
  });

  test('rejects fields outside the frozen protocol schema', () {
    final source = _fixtureObject();
    source['platform'] = 'flutter';

    expect(
      () => const MosaicProtocolDecoder().decode(jsonEncode(source)),
      throwsA(isA<MosaicProtocolException>()),
    );
  });

  test('rejects capability declarations that do not match document content',
      () {
    final source = _fixtureObject();
    final compatibility = source['compatibility']! as Map<String, Object?>;
    final capabilities =
        compatibility['requiredCapabilities']! as List<Object?>;
    capabilities.removeWhere(
      (value) =>
          (value! as Map<String, Object?>)['name'] == 'component.legalText',
    );

    expect(
      () => const MosaicProtocolDecoder().decode(jsonEncode(source)),
      throwsA(isA<MosaicProtocolException>()),
    );
  });

  test('rejects invalid product-selector relationships', () {
    final missingSelection = _fixtureObject();
    _productSelector(missingSelection)['initiallySelectedProductId'] =
        'not_declared';
    expect(
      () => const MosaicProtocolDecoder().decode(jsonEncode(missingSelection)),
      throwsA(isA<MosaicProtocolException>()),
    );

    final duplicateProduct = _fixtureObject();
    final selector = _productSelector(duplicateProduct);
    final products = selector['products']! as List<Object?>;
    products.add(Map<String, Object?>.from(
      products.first! as Map<String, Object?>,
    ));
    expect(
      () => const MosaicProtocolDecoder().decode(jsonEncode(duplicateProduct)),
      throwsA(isA<MosaicProtocolException>()),
    );
  });

  test('accepts integral revision spellings within the 32-bit range', () {
    final integral = _canonicalFixtureReplacing(
      '"revision": 1',
      '"revision": 1.0',
    );
    expect(const MosaicProtocolDecoder().decode(integral).revision, 1);

    final maximum = _canonicalFixtureReplacing(
      '"revision": 1',
      '"revision": 2147483647',
    );
    expect(
      const MosaicProtocolDecoder().decode(maximum).revision,
      2147483647,
    );
  });

  test('rejects revisions above the 32-bit range', () {
    final source = _canonicalFixtureReplacing(
      '"revision": 1',
      '"revision": 2147483648',
    );

    expect(
      () => const MosaicProtocolDecoder().decode(source),
      throwsA(isA<MosaicProtocolException>()),
    );
  });

  test('rejects non-finite layout numbers', () {
    final source = _canonicalFixtureReplacing(
      '"gap": 16',
      '"gap": 1e400',
    );

    expect(
      () => const MosaicProtocolDecoder().decode(source),
      throwsA(isA<MosaicProtocolException>()),
    );
  });
}

Map<String, Object?> _fixtureObject() =>
    jsonDecode(_canonicalFixture().readAsStringSync()) as Map<String, Object?>;

String _canonicalFixtureReplacing(String original, String replacement) {
  final source = _canonicalFixture().readAsStringSync();
  if (!source.contains(original)) {
    fail('Canonical fixture does not contain $original.');
  }
  return source.replaceFirst(original, replacement);
}

Map<String, Object?> _productSelector(Map<String, Object?> source) {
  final layout = source['layout']! as Map<String, Object?>;
  final children = layout['children']! as List<Object?>;
  return children
      .cast<Map<String, Object?>>()
      .firstWhere((component) => component['type'] == 'productSelector');
}

File _canonicalFixture() {
  var directory = Directory.current.absolute;
  while (true) {
    final candidate = File(
      '${directory.path}/protocol/fixtures/v0.1/minimal-paywall.json',
    );
    if (candidate.existsSync()) {
      return candidate;
    }
    final parent = directory.parent;
    if (parent.path == directory.path) {
      fail(
        'Cannot locate protocol/fixtures/v0.1/minimal-paywall.json from '
        '${Directory.current.path}. Run tests from the Mosaic repository.',
      );
    }
    directory = parent;
  }
}
