import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';

void main() {
  MosaicLocalizedText headline(MosaicPaywallDocument document) => document.nodes
      .whereType<MosaicTextComponent>()
      .firstWhere((component) => component.id == 'headline')
      .value;

  test('resolves exact requested locale before its base language', () {
    final source = canonicalFixtureObject();
    final localization = source['localization']! as Map<String, Object?>;
    final locales = localization['locales']! as Map<String, Object?>;
    locales['de-DE'] = <String, Object?>{
      'direction': 'ltr',
      'strings': <String, Object?>{
        'paywall.headline': 'Regionale deutsche Überschrift',
      },
    };
    final document = const MosaicProtocolDecoder().decode(jsonEncode(source));

    final resolved = const MosaicLocaleResolver().resolve(
      document,
      requestedLocale: 'de-DE',
    );
    final text = resolved.resolve(headline(document));

    expect(resolved.candidates, <String>['de-DE', 'de', 'en']);
    expect(text.value, 'Regionale deutsche Überschrift');
    expect(text.locale, 'de-DE');
    expect(resolved.textDirection, TextDirection.ltr);
  });

  test('resolves requested base language and Arabic RTL direction', () {
    final document = decodeCanonicalFixture();
    final resolved = const MosaicLocaleResolver().resolve(
      document,
      requestedLocale: 'ar-EG',
    );

    expect(resolved.candidates, <String>['ar', 'en']);
    expect(resolved.resolve(headline(document)).locale, 'ar');
    expect(resolved.textDirection, TextDirection.rtl);
  });

  test('falls back requested locale to fallback then default locale', () {
    final document = decodeCanonicalFixture();
    final resolved = const MosaicLocaleResolver().resolve(
      document,
      requestedLocale: 'fr-FR',
    );

    expect(resolved.candidates, <String>['en']);
    expect(
      resolved.text(headline(document)),
      'Unlock every Mosaic Pro feature',
    );
  });

  test('keeps direction from first declared candidate when text falls back',
      () {
    final source = canonicalFixtureObject();
    final localization = source['localization']! as Map<String, Object?>;
    final locales = localization['locales']! as Map<String, Object?>;
    final arabic = locales['ar']! as Map<String, Object?>;
    (arabic['strings']! as Map<String, Object?>).remove('paywall.legal');
    final document = const MosaicProtocolDecoder().decode(jsonEncode(source));
    final legal = document.nodes
        .whereType<MosaicTextComponent>()
        .firstWhere((component) => component.id == 'legal');
    final resolved = const MosaicLocaleResolver().resolve(
      document,
      requestedLocale: 'ar',
    );
    final text = resolved.resolve(legal.value);

    expect(text.locale, 'en');
    expect(text.direction, MosaicLocaleDirection.rtl);
    expect(resolved.textDirection, TextDirection.rtl);
  });

  test('German path contains deliberately long localized content', () {
    final document = decodeCanonicalFixture();
    final resolved = const MosaicLocaleResolver().resolve(
      document,
      requestedLocale: 'de',
    );
    final subtitle = document.nodes
        .whereType<MosaicTextComponent>()
        .firstWhere((component) => component.id == 'subtitle');

    expect(resolved.text(subtitle.value).length, greaterThanOrEqualTo(120));
    expect(resolved.textDirection, TextDirection.ltr);
  });

  // The cross-SDK corpus for the 2026-08-05 Paywall Protocol 0.2 ruling that
  // requested-locale matching is case-insensitive. It is bound here rather than
  // restated: the failure it guards is a renderer quietly disagreeing with the
  // other SDKs about which catalog a device's own locale denotes.
  test('matches the canonical Protocol 0.2 locale-resolution corpus', () {
    final corpus = jsonDecode(
      repositoryFile('protocol/fixtures/v0.2/locale-resolution.json')
          .readAsStringSync(),
    )! as Map<String, Object?>;
    final localization =
        (corpus['localization']! as Map).cast<String, Object?>();
    final declared = (localization['locales']! as List).cast<String>();
    final decoded = decodeCanonicalFixture();
    final document = MosaicPaywallDocument(
      schemaVersion: decoded.schemaVersion,
      id: decoded.id,
      revision: decoded.revision,
      compatibility: decoded.compatibility,
      localization: MosaicLocalization(
        defaultLocale: localization['defaultLocale']! as String,
        fallbackLocale: localization['fallbackLocale']! as String,
        locales: <String, MosaicLocaleCatalog>{
          for (final locale in declared)
            locale: MosaicLocaleCatalog(
              direction: MosaicLocaleDirection.ltr,
              strings: <String, String>{'paywall.headline': locale},
            ),
        },
      ),
      assets: decoded.assets,
      products: decoded.products,
      layout: decoded.layout,
    );

    for (final raw in corpus['cases']! as List<Object?>) {
      final testCase = (raw! as Map).cast<String, Object?>();
      final name = testCase['name']! as String;
      final resolved = const MosaicLocaleResolver().resolve(
        document,
        requestedLocale: testCase['requested'] as String?,
      );
      // The corpus lists every candidate, including keys no catalog declares.
      // Per its own `normativeScope`, the order is normative and the public
      // shape is not: this binding reports the declared subset, in that order.
      expect(
        resolved.candidates,
        (testCase['expectedCandidates']! as List)
            .cast<String>()
            .where(declared.contains),
        reason: name,
      );
      expect(
        resolved.resolve(headline(document)).locale,
        testCase['expectedCatalog'],
        reason: name,
      );
    }
  });

  test('uses inline default only after every declared catalog candidate', () {
    final decoded = decodeCanonicalFixture();
    final emptyCatalog = MosaicLocaleCatalog(
      direction: MosaicLocaleDirection.ltr,
      strings: const <String, String>{'some.other': 'Other'},
    );
    final document = MosaicPaywallDocument(
      schemaVersion: decoded.schemaVersion,
      id: decoded.id,
      revision: decoded.revision,
      compatibility: decoded.compatibility,
      localization: MosaicLocalization(
        defaultLocale: 'en',
        fallbackLocale: 'en',
        locales: <String, MosaicLocaleCatalog>{'en': emptyCatalog},
      ),
      assets: decoded.assets,
      products: decoded.products,
      layout: decoded.layout,
    );
    final resolved = const MosaicLocaleResolver().resolve(document);

    expect(resolved.resolve(headline(document)).locale, isNull);
    expect(
      resolved.text(headline(document)),
      'Unlock every Mosaic Pro feature',
    );
  });
}
