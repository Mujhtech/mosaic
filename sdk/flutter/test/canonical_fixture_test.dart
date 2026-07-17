import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';

void main() {
  test('decodes the sole repository canonical Protocol 0.1 RC1 fixture', () {
    final document = decodeCanonicalFixture();

    expect(document.schemaVersion, '0.1');
    expect(document.id, 'phase1-complete-paywall');
    expect(document.revision, 1);
    expect(document.layout.id, 'paywall-scroll');
    expect(document.layout.showsIndicators, isTrue);
    expect(document.layout.content.id, 'paywall-content');
    expect(document.layout.content.spacing, 20);
    expect(document.layout.content.padding.start, 24);
    expect(
      document.compatibility.requiredCapabilities.map((item) => item.name),
      unorderedEquals(mosaicProtocolV01Capabilities),
    );
    expect(
      document.nodes.map((node) => node.type).toSet(),
      containsAll(<String>{
        'scrollContainer',
        'verticalStack',
        'text',
        'image',
        'featureList',
        'productSelector',
        'purchaseButton',
        'restoreButton',
        'closeButton',
        'legalText',
      }),
    );
    expect(
      document.nodes.whereType<MosaicVerticalStack>().map((stack) => stack.id),
      containsAll(
          <String>['paywall-content', 'close-actions', 'commerce-actions']),
    );
    expect(document.assets.single.sourceKey, 'mosaic.paywall.hero');
    expect(document.products.map((product) => product.id), <String>[
      'monthly-plan',
      'yearly-plan',
    ]);
    expect(document.products.map((product) => product.productId), <String>[
      'mosaic_pro_monthly',
      'mosaic_pro_yearly',
    ]);
    expect(document.localization.locales['de']!.direction,
        MosaicLocaleDirection.ltr);
    expect(document.localization.locales['ar']!.direction,
        MosaicLocaleDirection.rtl);
  });

  test('accepts mathematical integer revision spellings in range', () {
    final integral = canonicalFixtureSource().replaceFirst(
      '"revision": 1',
      '"revision": 1.0',
    );
    expect(const MosaicProtocolDecoder().decode(integral).revision, 1);

    final maximum = canonicalFixtureSource().replaceFirst(
      '"revision": 1',
      '"revision": 2147483647',
    );
    expect(const MosaicProtocolDecoder().decode(maximum).revision, 2147483647);
  });

  test('rejects out-of-range revision and non-finite logical numbers', () {
    final revision = canonicalFixtureSource().replaceFirst(
      '"revision": 1',
      '"revision": 2147483648',
    );
    expect(
      () => const MosaicProtocolDecoder().decode(revision),
      throwsA(isA<MosaicProtocolException>()),
    );

    final nonFinite = canonicalFixtureSource().replaceFirst(
      '"spacing": 20',
      '"spacing": 1e400',
    );
    expect(
      () => const MosaicProtocolDecoder().decode(nonFinite),
      throwsA(isA<MosaicProtocolException>()),
    );
  });

  test('capability report is exact and has no custom capabilities', () {
    expect(mosaicFlutterCapabilityReport.sdkVersion, mosaicFlutterSdkVersion);
    expect(
      mosaicFlutterCapabilityReport.supportedSchemaVersions,
      <String>{'0.1', '0.2'},
    );
    expect(
      mosaicFlutterCapabilityReport.supportedCapabilities.keys,
      unorderedEquals(
        <String>{
          ...mosaicProtocolV01Capabilities,
          ...mosaicProtocolV02Capabilities,
        },
      ),
    );
    expect(mosaicFlutterCapabilityReport.supportedCapabilities, isNotEmpty);
  });

  test('canonical source remains direct JSON rather than an SDK copy', () {
    final value = jsonDecode(canonicalFixtureSource()) as Map<String, Object?>;
    expect(value['id'], 'phase1-complete-paywall');
    expect(canonicalFixtureFile().path, contains('/protocol/fixtures/v0.1/'));
  });
}
