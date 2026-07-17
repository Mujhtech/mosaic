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
    final legal = document.nodes.whereType<MosaicLegalTextComponent>().single;
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
