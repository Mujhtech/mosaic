import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';

void main() {
  void expectRejected(Map<String, Object?> source) {
    expect(
      () => const MosaicProtocolDecoder().decode(jsonEncode(source)),
      throwsA(isA<MosaicProtocolException>()),
    );
  }

  test('rejects unknown root, nested, component, and action properties', () {
    final root = canonicalFixtureObject()..['platform'] = 'flutter';
    expectRejected(root);

    final nested = canonicalFixtureObject();
    findNode(nested, 'text')['fontFamily'] = 'platform-specific';
    expectRejected(nested);

    final component = canonicalFixtureObject();
    findNode(component, 'legalText')['type'] = 'webView';
    expectRejected(component);

    final action = canonicalFixtureObject();
    final purchase = findNode(action, 'purchaseButton');
    (purchase['action']! as Map<String, Object?>)['script'] = 'run()';
    expectRejected(action);
  });

  test('rejects unsupported versions and capability mismatches', () {
    final version = canonicalFixtureObject()..['schemaVersion'] = '0.2';
    expectRejected(version);

    final capabilityVersion = canonicalFixtureObject();
    final required = ((capabilityVersion['compatibility']!
            as Map<String, Object?>)['requiredCapabilities']! as List<Object?>)
        .cast<Map<String, Object?>>();
    required.first['version'] = '0.2';
    expectRejected(capabilityVersion);

    final missing = canonicalFixtureObject();
    final missingCapabilities = ((missing['compatibility']!
            as Map<String, Object?>)['requiredCapabilities']! as List<Object?>)
        .cast<Map<String, Object?>>();
    missingCapabilities.removeWhere(
      (capability) => capability['name'] == 'component.legalText',
    );
    expectRejected(missing);

    final duplicate = canonicalFixtureObject();
    final duplicateCapabilities = ((duplicate['compatibility']!
        as Map<String, Object?>)['requiredCapabilities']! as List<Object?>);
    duplicateCapabilities.add(
      Map<String, Object?>.from(
        duplicateCapabilities.first! as Map<String, Object?>,
      ),
    );
    expectRejected(duplicate);
  });

  test('rejects duplicate IDs and broken asset references', () {
    final duplicateNode = canonicalFixtureObject();
    findNode(duplicateNode, 'text')['id'] = 'hero';
    expectRejected(duplicateNode);

    final duplicateFeature = canonicalFixtureObject();
    final featureItems =
        findNode(duplicateFeature, 'featureList')['items']! as List<Object?>;
    (featureItems[1]! as Map<String, Object?>)['id'] =
        (featureItems.first! as Map<String, Object?>)['id'];
    expectRejected(duplicateFeature);

    final asset = canonicalFixtureObject();
    findNode(asset, 'image')['assetId'] = 'missing-image';
    expectRejected(asset);

    final invalidImageAccessibility = canonicalFixtureObject();
    final accessibility = findNode(
      invalidImageAccessibility,
      'image',
    )['accessibility']! as Map<String, Object?>;
    accessibility['hidden'] = true;
    expectRejected(invalidImageAccessibility);
  });

  test('rejects broken product selectors and purchase actions', () {
    final unknownProduct = canonicalFixtureObject();
    final selector = findNode(unknownProduct, 'productSelector');
    (selector['productReferenceIds']! as List<Object?>)[0] = 'missing-plan';
    expectRejected(unknownProduct);

    final invalidSelection = canonicalFixtureObject();
    findNode(invalidSelection, 'productSelector')[
        'initiallySelectedProductReferenceId'] = 'missing-plan';
    expectRejected(invalidSelection);

    final invalidAction = canonicalFixtureObject();
    final purchase = findNode(invalidAction, 'purchaseButton');
    (purchase['action']! as Map<String, Object?>)['productSelectorId'] =
        'missing-selector';
    expectRejected(invalidAction);

    final duplicateProviderId = canonicalFixtureObject();
    final products = duplicateProviderId['products']! as List<Object?>;
    (products[1]! as Map<String, Object?>)['productId'] =
        (products.first! as Map<String, Object?>)['productId'];
    expectRejected(duplicateProviderId);
  });

  test('rejects inconsistent localization catalogs and inline defaults', () {
    final missingDefaultLocale = canonicalFixtureObject();
    (missingDefaultLocale['localization']!
        as Map<String, Object?>)['defaultLocale'] = 'fr';
    expectRejected(missingDefaultLocale);

    final mismatchedInline = canonicalFixtureObject();
    final label = findNode(mismatchedInline, 'purchaseButton')['label']!
        as Map<String, Object?>;
    label['default'] = 'Buy now';
    expectRejected(mismatchedInline);

    final unusedDefault = canonicalFixtureObject();
    final locales = (unusedDefault['localization']!
        as Map<String, Object?>)['locales']! as Map<String, Object?>;
    final english = locales['en']! as Map<String, Object?>;
    (english['strings']! as Map<String, Object?>)['paywall.unused'] = 'Unused';
    expectRejected(unusedDefault);

    final unknownTranslation = canonicalFixtureObject();
    final translatedLocales = (unknownTranslation['localization']!
        as Map<String, Object?>)['locales']! as Map<String, Object?>;
    final german = translatedLocales['de']! as Map<String, Object?>;
    (german['strings']! as Map<String, Object?>)['paywall.unknown'] =
        'Unbekannt';
    expectRejected(unknownTranslation);
  });

  test('rejects invalid RC1 layout and image bounds atomically', () {
    final negativePadding = canonicalFixtureObject();
    final layout = negativePadding['layout']! as Map<String, Object?>;
    final content = layout['content']! as Map<String, Object?>;
    (content['padding']! as Map<String, Object?>)['start'] = -1;
    expectRejected(negativePadding);

    final aspect = canonicalFixtureObject();
    findNode(aspect, 'image')['aspectRatio'] = 11;
    expectRejected(aspect);

    final scroll = canonicalFixtureObject();
    (scroll['layout']! as Map<String, Object?>)['safeArea'] = 'ignore';
    expectRejected(scroll);
  });

  test('counts localized text limits in Unicode code points', () {
    Map<String, Object?> withPurchaseLabel(String value) {
      final source = canonicalFixtureObject();
      final label =
          findNode(source, 'purchaseButton')['label']! as Map<String, Object?>;
      label['default'] = value;
      final localization = source['localization']! as Map<String, Object?>;
      final locales = localization['locales']! as Map<String, Object?>;
      final english = locales['en']! as Map<String, Object?>;
      (english['strings']! as Map<String, Object?>)['paywall.purchase'] = value;
      return source;
    }

    final maximum = String.fromCharCodes(List<int>.filled(5000, 0x1f600));
    expect(
      const MosaicProtocolDecoder()
          .decode(jsonEncode(withPurchaseLabel(maximum))),
      isA<MosaicPaywallDocument>(),
    );

    final over = String.fromCharCodes(List<int>.filled(5001, 0x1f600));
    expectRejected(withPurchaseLabel(over));
  });
}
