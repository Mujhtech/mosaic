import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' show Tristate;

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';

const _products = <MosaicProduct>[
  MosaicProduct(
    id: 'mosaic_pro_monthly',
    title: 'Mosaic Pro Monthly',
    localizedPrice: r'$5.99',
    localizedPeriod: 'month',
  ),
  MosaicProduct(
    id: 'mosaic_pro_yearly',
    title: 'Mosaic Pro Yearly',
    localizedPrice: r'$49.99',
    localizedPeriod: 'year',
  ),
];

void main() {
  testWidgets('exposes headings, images, groups, controls, and selected state',
      (tester) async {
    final semantics = tester.ensureSemantics();
    await _pump(tester);

    final headline = _semantics(tester, 'mosaic-headline');
    expect(headline.flagsCollection.isHeader, isTrue);
    expect(headline.label, 'Unlock every Mosaic Pro feature');

    final image = _semantics(tester, 'mosaic-hero');
    expect(image.flagsCollection.isImage, isTrue);
    expect(image.label, 'A mosaic of native mobile paywall screens');

    final features = _semantics(tester, 'mosaic-features');
    expect(features.label, 'Included with Mosaic Pro');
    expect(find.text('Create unlimited paywall projects'), findsOneWidget);

    final yearly = _semantics(tester, 'mosaic-plans-yearly-plan');
    expect(yearly.flagsCollection.isButton, isTrue);
    expect(yearly.flagsCollection.isSelected, Tristate.isTrue);
    expect(yearly.flagsCollection.isEnabled, Tristate.isTrue);
    expect(yearly.label, contains('Yearly'));
    expect(yearly.label, contains(r'$49.99'));

    final monthly = _semantics(tester, 'mosaic-plans-monthly-plan');
    expect(monthly.flagsCollection.isSelected, Tristate.isFalse);

    final purchase = _semantics(tester, 'mosaic-purchase');
    expect(purchase.flagsCollection.isButton, isTrue);
    expect(purchase.flagsCollection.isEnabled, Tristate.isTrue);
    expect(purchase.label, 'Continue with the selected plan');
    expect(
      purchase.hint,
      'Starts the purchase for the selected subscription plan',
    );

    final restore = _semantics(tester, 'mosaic-restore');
    expect(restore.flagsCollection.isButton, isTrue);
    expect(restore.label, 'Restore previous purchases');

    final close = _semantics(tester, 'mosaic-close');
    expect(close.flagsCollection.isButton, isTrue);
    expect(close.label, 'Close');
    semantics.dispose();
  });

  testWidgets('native controls meet minimum target size', (tester) async {
    await _pump(tester);

    for (final key in <String>[
      'mosaic-close',
      'mosaic-plans-monthly-plan',
      'mosaic-plans-yearly-plan',
      'mosaic-purchase',
      'mosaic-restore',
    ]) {
      final finder = find.byKey(ValueKey<String>(key));
      await tester.ensureVisible(finder);
      await tester.pumpAndSettle();
      final size = tester.getSize(finder);
      expect(size.width, greaterThanOrEqualTo(48), reason: key);
      expect(size.height, greaterThanOrEqualTo(48), reason: key);
    }
  });

  testWidgets('preserves source order, safe area, and image aspect geometry',
      (tester) async {
    await _pump(
      tester,
      mediaQueryData: const MediaQueryData(
        size: Size(800, 600),
        padding: EdgeInsets.only(top: 32, bottom: 16),
      ),
    );

    final closeTop = tester
        .getTopLeft(
          find.byKey(const ValueKey<String>('mosaic-close')),
        )
        .dy;
    final heroTop = tester
        .getTopLeft(
          find.byKey(const ValueKey<String>('mosaic-hero')),
        )
        .dy;
    final headlineTop = tester
        .getTopLeft(
          find.byKey(const ValueKey<String>('mosaic-headline')),
        )
        .dy;
    expect(closeTop, greaterThanOrEqualTo(48));
    expect(closeTop, lessThan(heroTop));
    expect(heroTop, lessThan(headlineTop));

    final imageSize = tester.getSize(
      find.byKey(const ValueKey<String>('mosaic-hero')),
    );
    expect(imageSize.width / imageSize.height, closeTo(16 / 9, 0.001));
  });

  testWidgets('long German and large text remain scrollable without clipping',
      (tester) async {
    await _pump(
      tester,
      requestedLocale: 'de',
      textScaler: const TextScaler.linear(2),
    );

    expect(
      find.textContaining('Erstelle, überprüfe und verbessere'),
      findsOneWidget,
    );
    expect(find.byType(SingleChildScrollView), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Arabic uses RTL and direction-relative end alignment',
      (tester) async {
    await _pump(tester, requestedLocale: 'ar');

    final directionality = tester.widget<Directionality>(
      find
          .descendant(
            of: find.byType(MosaicPaywall),
            matching: find.byType(Directionality),
          )
          .first,
    );
    expect(directionality.textDirection, TextDirection.rtl);
    expect(find.text('افتح جميع مزايا Mosaic Pro'), findsOneWidget);

    final closeLeft = tester
        .getTopLeft(
          find.byKey(const ValueKey<String>('mosaic-close')),
        )
        .dx;
    expect(closeLeft, lessThan(400));
  });

  testWidgets('missing image lookup uses localized same-frame placeholder',
      (tester) async {
    await _pump(tester, requestedLocale: 'ar');

    expect(find.text('الرسم التوضيحي المميز غير متاح'), findsOneWidget);
    final size = tester.getSize(
      find.byKey(const ValueKey<String>('mosaic-hero')),
    );
    expect(size.width / size.height, closeTo(16 / 9, 0.001));
  });

  testWidgets('valid and undecodable host images resolve without layout change',
      (tester) async {
    final png = Uint8List.fromList(
      base64Decode(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk'
        'YAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      ),
    );
    await _pump(tester, imageResolver: (_) => MemoryImage(png));

    expect(find.text('Premium illustration unavailable'), findsNothing);
    final image = tester.widget<Image>(find.byType(Image));
    expect(image.fit, BoxFit.cover);
    final validSize = tester.getSize(
      find.byKey(const ValueKey<String>('mosaic-hero')),
    );

    await _pump(
      tester,
      imageResolver: (_) => MemoryImage(Uint8List.fromList(<int>[0, 1, 2])),
    );
    await tester.pumpAndSettle();

    expect(find.text('Premium illustration unavailable'), findsOneWidget);
    final invalidSize = tester.getSize(
      find.byKey(const ValueKey<String>('mosaic-hero')),
    );
    expect(invalidSize, validSize);
  });
}

SemanticsNode _semantics(WidgetTester tester, String key) =>
    tester.getSemantics(
      find.byKey(ValueKey<String>(key)),
    );

Future<void> _pump(
  WidgetTester tester, {
  String? requestedLocale,
  TextScaler textScaler = TextScaler.noScaling,
  MediaQueryData mediaQueryData = const MediaQueryData(size: Size(800, 600)),
  MosaicBundledImageResolver? imageResolver,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: ThemeData(useMaterial3: true),
      home: MediaQuery(
        data: mediaQueryData.copyWith(textScaler: textScaler),
        child: Scaffold(
          body: MosaicPaywall(
            document: decodeCanonicalFixture(),
            purchaseProvider: MockMosaicPurchaseProvider(products: _products),
            requestedLocale: requestedLocale,
            imageResolver: imageResolver,
            onResult: (_) {},
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}
