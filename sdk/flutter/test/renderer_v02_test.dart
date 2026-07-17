import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

void main() {
  final root = Directory.current.parent.parent;

  MosaicPaywallDocument fixture(String name) =>
      const MosaicProtocolDecoder().decode(
        File('${root.path}/protocol/fixtures/v0.2/$name').readAsStringSync(),
      );

  const products = <MosaicProduct>[
    MosaicProduct(
      id: 'mosaic_pro_monthly',
      title: 'Monthly',
      localizedPrice: r'$9.99',
      localizedPeriod: 'month',
    ),
    MosaicProduct(
      id: 'mosaic_pro_yearly',
      title: 'Yearly',
      localizedPrice: r'$79.99',
      localizedPeriod: 'year',
    ),
  ];

  testWidgets('renders the complete 0.2 fixture with native runtime controls',
      (tester) async {
    final document = fixture('complete-paywall.json');
    await _pump(
      tester,
      document,
      clock: () => DateTime.utc(2030, 12, 30, 23, 59, 59),
      products: products,
    );

    expect(find.byType(SingleChildScrollView), findsOneWidget);
    expect(find.byType(Switch), findsNWidgets(2));
    expect(find.byType(PageView), findsOneWidget);
    expect(find.text('Yearly'), findsOneWidget);

    await tester.tap(find.byType(Switch).first);
    await tester.pump();
    expect(find.byType(PageView), findsNothing);
    expect(find.text('1d 0h 0m 0s'), findsOneWidget);
  });

  testWidgets('expired Countdown shows completed text without a live region',
      (tester) async {
    final document = fixture('expired-countdown.json');
    final semantics = tester.ensureSemantics();
    await _pump(
      tester,
      document,
      clock: () => DateTime.utc(2031),
      products: products,
    );

    expect(find.text('Complete'), findsOneWidget);
    final node = tester.getSemantics(
      find.byKey(const ValueKey<String>('mosaic-expired-offer-countdown')),
    );
    expect(node.flagsCollection.isLiveRegion, isFalse);
    semantics.dispose();
  });

  testWidgets('hidden Product Selector safely disables purchase and diagnoses',
      (tester) async {
    final diagnostics = <MosaicDiagnostic>[];
    final document = fixture('hidden-purchase-target.json');
    await _pump(
      tester,
      document,
      products: products,
      onDiagnostic: diagnostics.add,
    );

    final purchase = tester.widget<TextButton>(
      find.descendant(
        of: find.byKey(const ValueKey<String>('mosaic-purchase')),
        matching: find.byType(TextButton),
      ),
    );
    expect(purchase.onPressed, isNull);
    expect(
      diagnostics.map((diagnostic) => diagnostic.code),
      contains('purchase.hiddenProductSelector'),
    );
  });

  testWidgets('accepted revision resets Switch and Carousel runtime state',
      (tester) async {
    final resetFixture = jsonDecode(
      File(
        '${root.path}/protocol/fixtures/local-preview/v0.2/'
        'accepted-revision-runtime-reset.json',
      ).readAsStringSync(),
    )! as Map<String, Object?>;
    final expected =
        resetFixture['expectedRuntimeAfterAcceptance']! as Map<String, Object?>;
    final source = File(
      '${root.path}/protocol/fixtures/v0.2/complete-paywall.json',
    ).readAsStringSync();
    var document = const MosaicProtocolDecoder().decode(source);
    late StateSetter rebuild;
    tester.view.physicalSize = const Size(900, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: StatefulBuilder(
          builder: (context, setState) {
            rebuild = setState;
            return MosaicPaywall(
              document: document,
              purchaseProvider: MockMosaicPurchaseProvider(products: products),
              clock: () => DateTime.utc(2030, 12, 30),
              onResult: (_) {},
            );
          },
        ),
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(tester.widget<PageView>(find.byType(PageView)).controller!.page, 1);
    await tester.drag(find.byType(PageView), const Offset(700, 0));
    await tester.pumpAndSettle(const Duration(milliseconds: 100));
    expect(tester.widget<PageView>(find.byType(PageView)).controller!.page, 0);
    await tester.tap(find.byType(Switch).first);
    await tester.pump();
    expect(tester.widget<Switch>(find.byType(Switch).first).value, isFalse);
    expect(find.byType(PageView), findsNothing);
    await tester.tap(find.byType(Switch).first);
    await tester.pump();
    expect(tester.widget<PageView>(find.byType(PageView)).controller!.page, 0);
    await tester.tap(find.byType(Switch).first);
    await tester.pump();
    expect(find.byType(PageView), findsNothing);

    rebuild(() {
      document = const MosaicProtocolDecoder().decode(source);
    });
    await tester.pump();
    await tester.pump();

    expect(tester.widget<Switch>(find.byType(Switch).first).value, isTrue);
    expect(find.byType(PageView), findsOneWidget);
    expect(tester.widget<PageView>(find.byType(PageView)).controller!.page, 1);
    expect(
      (expected['switches']! as Map<String, Object?>)['show-offer-details'],
      isTrue,
    );
    expect(
      (expected['carousels']! as Map<String, Object?>)['offer-highlights'],
      1,
    );
  });

  test('Selected Product Card recursively inherits absent Default leaves', () {
    final selector = fixture('complete-paywall.json')
        .nodes
        .whereType<MosaicProductSelectorComponent>()
        .single;
    final styles = selector.cardStyles!;
    final selected = styles.resolve(selected: true);

    expect(selected.contentGap, 12);
    expect(selected.cornerRadius, styles.defaultStyle.cornerRadius);
    expect(selected.padding.top, styles.defaultStyle.padding.top);
    expect(selected.padding.start, 18);
    expect(
      selected.badge.cornerRadius,
      styles.defaultStyle.badge.cornerRadius,
    );
  });

  testWidgets('Arabic RTL and 200 percent text preserve full semantics',
      (tester) async {
    final document = fixture('complete-paywall.json');
    final resolved = const MosaicLocaleResolver().resolve(
      document,
      requestedLocale: 'ar',
    );
    final subtitle = document.nodes
        .whereType<MosaicTextComponent>()
        .firstWhere((component) => component.id == 'subtitle');
    final fullSubtitle = resolved.text(subtitle.value);
    final semantics = tester.ensureSemantics();
    tester.view.physicalSize = const Size(900, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(
            size: Size(900, 1600),
            textScaler: TextScaler.linear(2),
          ),
          child: MosaicPaywall(
            document: document,
            purchaseProvider: MockMosaicPurchaseProvider(products: products),
            requestedLocale: 'ar',
            clock: () => DateTime.utc(2030, 12, 30),
            onResult: (_) {},
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(
      tester
          .widget<Directionality>(find.byType(Directionality).last)
          .textDirection,
      TextDirection.rtl,
    );
    final subtitleSemantics = tester.getSemantics(
      find.byKey(const ValueKey<String>('mosaic-subtitle')),
    );
    expect(subtitleSemantics.label, fullSubtitle);
    expect(tester.takeException(), isNull);
    semantics.dispose();
  });
}

Future<void> _pump(
  WidgetTester tester,
  MosaicPaywallDocument document, {
  List<MosaicProduct> products = const <MosaicProduct>[],
  MosaicClock? clock,
  MosaicDiagnosticCallback? onDiagnostic,
}) async {
  tester.view.physicalSize = const Size(900, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: MosaicPaywall(
          document: document,
          purchaseProvider: MockMosaicPurchaseProvider(products: products),
          clock: clock ?? DateTime.now,
          onResult: (_) {},
          onDiagnostic: onDiagnostic,
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
}
