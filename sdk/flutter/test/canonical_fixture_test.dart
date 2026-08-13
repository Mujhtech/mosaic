import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';

void main() {
  test('decodes the repository canonical Protocol 0.4 fixture', () {
    final document = decodeCanonicalFixture();

    expect(document.schemaVersion, mosaicProtocolVersion);
    expect(document.id, 'phase1-complete-paywall');
    expect(document.revision, 1);
    expect(document.layout.id, 'paywall-scroll');
    expect(document.layout.showsIndicators, isTrue);
    expect(document.layout.content.id, 'paywall-content');
    expect(document.layout.content.gap, 20);
    expect(document.layout.content.padding.start, 24);
    expect(
      document.compatibility.requiredCapabilities.map((item) => item.name),
      unorderedEquals(mosaicProtocolCapabilities),
    );
    expect(document.nodes.map((node) => node.type).toSet(), isNotEmpty);
    expect(document.assets.map((asset) => asset.id), contains('hero-image'));
    expect(document.products.map((product) => product.id), <String>[
      'monthly-plan',
      'yearly-plan',
      'lifetime-plan',
    ]);
    expect(document.products.map((product) => product.productId), <String>[
      'mosaic_pro_monthly',
      'mosaic_pro_yearly',
      'mosaic_pro_lifetime',
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
      '"gap": 12',
      '"gap": 1e400',
    );
    expect(
      () => const MosaicProtocolDecoder().decode(nonFinite),
      throwsA(isA<MosaicProtocolException>()),
    );
  });

  test('capability report is exact and has no custom capabilities', () {
    expect(mosaicFlutterCapabilityReport.sdkVersion, mosaicFlutterSdkVersion);
    expect(mosaicFlutterCapabilityReport.schemaVersion, '0.4');
    expect(
      mosaicFlutterCapabilityReport.capabilities,
      unorderedEquals(mosaicProtocolCapabilities),
    );
    expect(
      mosaicFlutterCapabilityReport.capabilitiesFor('0.4'),
      isNotEmpty,
    );
    // Version identifiers are exact. A version this SDK does not implement
    // reports nothing rather than falling back to a neighbouring version's
    // answer, and that holds for the predecessor as much as for a successor.
    expect(mosaicFlutterCapabilityReport.capabilitiesFor('0.3'), isEmpty);
    expect(mosaicFlutterCapabilityReport.capabilitiesFor('0.5'), isEmpty);
  });

  test('canonical source remains direct JSON rather than an SDK copy', () {
    final value = jsonDecode(canonicalFixtureSource()) as Map<String, Object?>;
    expect(value['id'], 'phase1-complete-paywall');
    expect(canonicalFixtureFile().path, contains('/protocol/fixtures/v0.4/'));
  });
}
