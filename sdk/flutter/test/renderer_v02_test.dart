import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' show CheckedState, Tristate;

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
    MosaicProduct(
      id: 'mosaic_pro_lifetime',
      title: 'Lifetime Access',
      localizedPrice: r'$199.99',
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

  testWidgets('paints token gradients and native shadows', (tester) async {
    await _pump(tester, fixture('complete-paywall.json'), products: products);

    final decorations = tester
        .widgetList<DecoratedBox>(find.byType(DecoratedBox))
        .map((widget) => widget.decoration)
        .whereType<BoxDecoration>();
    expect(
      decorations.any((decoration) => decoration.gradient is LinearGradient),
      isTrue,
    );
    expect(
      decorations.any((decoration) => decoration.gradient is RadialGradient),
      isTrue,
    );
    expect(
      decorations
          .any((decoration) => decoration.boxShadow?.isNotEmpty ?? false),
      isTrue,
    );
  });

  testWidgets('uses physical clockwise gradient angles without RTL mirroring',
      (tester) async {
    final source = jsonDecode(
      File('${root.path}/protocol/fixtures/v0.2/complete-paywall.json')
          .readAsStringSync(),
    )! as Map<String, Object?>;
    final designSystem = source['designSystem']! as Map<String, Object?>;
    final backgrounds = designSystem['backgrounds']! as List<Object?>;
    final offerGradient = backgrounds
        .whereType<Map<String, Object?>>()
        .singleWhere((token) => token['id'] == 'offer-gradient');
    final gradient = offerGradient['value']! as Map<String, Object?>;

    Future<LinearGradient> renderAt(double angle) async {
      gradient['angle'] = angle;
      final document = const MosaicProtocolDecoder().decode(jsonEncode(source));
      await _pump(
        tester,
        document,
        products: products,
        requestedLocale: 'ar',
      );
      return tester
          .widgetList<DecoratedBox>(find.byType(DecoratedBox))
          .map((widget) => widget.decoration)
          .whereType<BoxDecoration>()
          .map((decoration) => decoration.gradient)
          .whereType<LinearGradient>()
          .first;
    }

    var painted = await renderAt(0);
    expect((painted.begin as Alignment).x, closeTo(-1, 0.0001));
    expect((painted.begin as Alignment).y, closeTo(0, 0.0001));
    expect((painted.end as Alignment).x, closeTo(1, 0.0001));
    expect((painted.end as Alignment).y, closeTo(0, 0.0001));

    painted = await renderAt(90);
    expect((painted.begin as Alignment).x, closeTo(0, 0.0001));
    expect((painted.begin as Alignment).y, closeTo(-1, 0.0001));
    expect((painted.end as Alignment).x, closeTo(0, 0.0001));
    expect((painted.end as Alignment).y, closeTo(1, 0.0001));

    painted = await renderAt(360);
    expect((painted.begin as Alignment).x, closeTo(-1, 0.0001));
    expect((painted.begin as Alignment).y, closeTo(0, 0.0001));
    expect((painted.end as Alignment).x, closeTo(1, 0.0001));
    expect((painted.end as Alignment).y, closeTo(0, 0.0001));
  });

  testWidgets('unbounded Fill falls back to Fit with full semantics',
      (tester) async {
    final source = jsonDecode(
      File('${root.path}/protocol/fixtures/v0.2/complete-paywall.json')
          .readAsStringSync(),
    )! as Map<String, Object?>;
    (_jsonNode(source, 'headline')['sizing']!
        as Map<String, Object?>)['height'] = 'fill';
    final document = const MosaicProtocolDecoder().decode(jsonEncode(source));
    final diagnostics = <MosaicDiagnostic>[];
    final semantics = tester.ensureSemantics();

    await _pump(
      tester,
      document,
      products: products,
      onDiagnostic: diagnostics.add,
    );

    expect(find.text('Unlock every Mosaic Pro feature'), findsOneWidget);
    expect(
      tester
          .getSemantics(
            find.byKey(const ValueKey<String>('mosaic-headline')),
          )
          .label,
      'Unlock every Mosaic Pro feature',
    );
    expect(
      diagnostics.map((diagnostic) => diagnostic.code),
      contains('layout.unboundedFill'),
    );
    semantics.dispose();
  });

  testWidgets('fixed height clips visuals without truncating semantics',
      (tester) async {
    final source = jsonDecode(
      File('${root.path}/protocol/fixtures/v0.2/complete-paywall.json')
          .readAsStringSync(),
    )! as Map<String, Object?>;
    (_jsonNode(source, 'headline')['sizing']!
        as Map<String, Object?>)['height'] = <String, Object?>{
      'mode': 'fixed',
      'value': 8
    };
    final document = const MosaicProtocolDecoder().decode(jsonEncode(source));
    final semantics = tester.ensureSemantics();

    await _pump(tester, document, products: products);

    expect(
      tester
          .getSize(
            find.byKey(const ValueKey<String>('mosaic-visibility-headline')),
          )
          .height,
      8,
    );
    expect(
      tester
          .getSemantics(
            find.byKey(const ValueKey<String>('mosaic-headline')),
          )
          .label,
      'Unlock every Mosaic Pro feature',
    );
    semantics.dispose();
  });

  testWidgets('lays out a horizontal Product Selector side by side',
      (tester) async {
    final document = fixture('complete-paywall.json');
    final selector =
        document.nodes.whereType<MosaicProductSelectorComponent>().single;
    expect(selector.direction, MosaicProductSelectorDirection.horizontal);

    await _pump(tester, document, products: products);

    final monthly = tester.getRect(
      find.byKey(
        const ValueKey<String>('mosaic-plans-monthly-plan-card'),
      ),
    );
    final yearly = tester.getRect(
      find.byKey(
        const ValueKey<String>('mosaic-plans-yearly-plan-card'),
      ),
    );
    expect(monthly.top, closeTo(yearly.top, 0.01));
    expect(monthly.left, lessThan(yearly.left));
    expect(monthly.right, lessThanOrEqualTo(yearly.left));
    expect(monthly.width, closeTo(yearly.width, 0.01));
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

    final purchase = tester.widget<InkWell>(
      find.descendant(
        of: find.byKey(const ValueKey<String>('mosaic-purchase')),
        matching: find.byType(InkWell),
      ),
    );
    expect(purchase.onTap, isNull);
    expect(
      diagnostics.map((diagnostic) => diagnostic.code),
      contains('purchase.hiddenProductSelector'),
    );
  });

  testWidgets(
      'navigates forward/back, preserves runtime state, and opens HTTPS externally',
      (tester) async {
    final opened = <Uri>[];
    final diagnostics = <MosaicDiagnostic>[];
    final document = fixture('complete-paywall.json');
    await _pump(
      tester,
      document,
      products: products,
      externalUrlOpener: (url) async {
        opened.add(url);
        return true;
      },
      onDiagnostic: diagnostics.add,
    );

    await tester.tap(find.byType(Switch).first);
    await tester.pump();
    expect(tester.widget<Switch>(find.byType(Switch).first).value, isFalse);

    await tester.ensureVisible(
      find.byKey(const ValueKey<String>('mosaic-view-details')),
    );
    final offerOffset = tester
        .widget<SingleChildScrollView>(find.byType(SingleChildScrollView))
        .controller!
        .offset;
    await tester.tap(find.byKey(const ValueKey<String>('mosaic-view-details')));
    await tester.pumpAndSettle();
    expect(find.byType(BottomSheet), findsOneWidget);
    expect(find.text('Purchase and policy details'), findsOneWidget);
    expect(
      find.byKey(const ValueKey<String>('mosaic-screen-details')),
      findsOneWidget,
    );

    await tester.tap(
      find.byKey(const ValueKey<String>('mosaic-privacy-policy')),
    );
    await tester.pumpAndSettle();
    expect(opened, <Uri>[Uri.parse('https://example.com/privacy')]);
    expect(
      diagnostics.map((diagnostic) => diagnostic.code),
      contains('background.videoUnavailable'),
    );
    expect(find.text('Purchase and policy details'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey<String>('mosaic-details-back')));
    await tester.pumpAndSettle();
    expect(find.text('Unlock every Mosaic Pro feature'), findsOneWidget);
    expect(tester.widget<Switch>(find.byType(Switch).first).value, isFalse);
    expect(
      tester
          .widget<SingleChildScrollView>(find.byType(SingleChildScrollView))
          .controller!
          .offset,
      closeTo(offerOffset, 0.01),
    );
  });

  testWidgets('Sheet back restores the previous Sheet and coherent history',
      (tester) async {
    final source = jsonDecode(
      File('${root.path}/protocol/fixtures/v0.2/complete-paywall.json')
          .readAsStringSync(),
    )! as Map<String, Object?>;
    final screens = source['screens']! as List<Object?>;
    final details = screens
        .whereType<Map<String, Object?>>()
        .singleWhere((screen) => screen['id'] == 'details');
    final detailsB = jsonDecode(jsonEncode(details))! as Map<String, Object?>;
    _suffixFixtureIds(detailsB, '-b');
    screens.add(detailsB);
    final privacyAction =
        _jsonNode(source, 'privacy-policy')['action']! as Map<String, Object?>;
    privacyAction
      ..clear()
      ..addAll(<String, Object?>{
        'type': 'navigateTo',
        'screenId': 'details-b',
      });
    final document = const MosaicProtocolDecoder().decode(jsonEncode(source));

    await _pump(tester, document, products: products);

    Future<void> openSheetB() async {
      await tester.ensureVisible(
        find.byKey(const ValueKey<String>('mosaic-privacy-policy')),
      );
      await tester.tap(
        find.byKey(const ValueKey<String>('mosaic-privacy-policy')),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey<String>('mosaic-screen-details-b')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey<String>('mosaic-screen-details')),
        findsNothing,
      );
      expect(find.byType(BottomSheet), findsOneWidget);
    }

    await tester.ensureVisible(
      find.byKey(const ValueKey<String>('mosaic-view-details')),
    );
    await tester.tap(find.byKey(const ValueKey<String>('mosaic-view-details')));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey<String>('mosaic-screen-details')),
      findsOneWidget,
    );

    await openSheetB();
    await tester.tap(
      find.byKey(const ValueKey<String>('mosaic-details-back-b')),
    );
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey<String>('mosaic-screen-details')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey<String>('mosaic-screen-details-b')),
      findsNothing,
    );
    expect(find.byType(BottomSheet), findsOneWidget);

    await openSheetB();
    expect(await tester.binding.handlePopRoute(), isTrue);
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey<String>('mosaic-screen-details')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey<String>('mosaic-screen-details-b')),
      findsNothing,
    );
    expect(find.byType(BottomSheet), findsOneWidget);

    expect(await tester.binding.handlePopRoute(), isTrue);
    await tester.pumpAndSettle();
    expect(find.byType(BottomSheet), findsNothing);
    expect(find.text('Unlock every Mosaic Pro feature'), findsOneWidget);
  });

  testWidgets('navigateBack at the initial screen is a diagnostic no-op',
      (tester) async {
    final source = jsonDecode(
      File('${root.path}/protocol/fixtures/v0.2/complete-paywall.json')
          .readAsStringSync(),
    )! as Map<String, Object?>;
    (_jsonNode(source, 'close')['action']! as Map<String, Object?>)
      ..clear()
      ..addAll(<String, Object?>{'type': 'navigateBack'});
    final required = (source['compatibility']!
        as Map<String, Object?>)['requiredCapabilities']! as List<Object?>;
    required.removeWhere(
      (entry) => (entry! as Map<String, Object?>)['name'] == 'action.close',
    );
    final document = const MosaicProtocolDecoder().decode(jsonEncode(source));
    final diagnostics = <MosaicDiagnostic>[];
    final results = <MosaicPresentationResult>[];
    await _pump(
      tester,
      document,
      products: products,
      onDiagnostic: diagnostics.add,
      onResult: results.add,
    );

    await tester.tap(find.byKey(const ValueKey<String>('mosaic-close')));
    await tester.pump();
    expect(find.text('Unlock every Mosaic Pro feature'), findsOneWidget);
    expect(results, isEmpty);
    expect(
      diagnostics.map((diagnostic) => diagnostic.code),
      contains('navigation.noBackTarget'),
    );
  });

  testWidgets('external URL failure is diagnostic and keeps presentation',
      (tester) async {
    final diagnostics = <MosaicDiagnostic>[];
    await _pump(
      tester,
      fixture('complete-paywall.json'),
      products: products,
      externalUrlOpener: (_) async => false,
      onDiagnostic: diagnostics.add,
    );
    await tester.ensureVisible(
      find.byKey(const ValueKey<String>('mosaic-view-details')),
    );
    await tester.tap(find.byKey(const ValueKey<String>('mosaic-view-details')));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey<String>('mosaic-privacy-policy')),
    );
    await tester.pumpAndSettle();

    expect(find.text('Purchase and policy details'), findsOneWidget);
    expect(
      diagnostics.map((diagnostic) => diagnostic.code),
      contains('externalUrl.openFailed'),
    );
  });

  testWidgets('Button descendants merge into one semantics control',
      (tester) async {
    final semantics = tester.ensureSemantics();
    await _pump(tester, fixture('complete-paywall.json'), products: products);
    await tester.ensureVisible(
      find.byKey(const ValueKey<String>('mosaic-view-details')),
    );

    final button = tester.getSemantics(
      find.byKey(const ValueKey<String>('mosaic-view-details')),
    );
    expect(button.flagsCollection.isButton, isTrue);
    expect(button.label, 'Review purchase details');
    expect(
      find.bySemanticsLabel('Review purchase details'),
      findsOneWidget,
    );
    semantics.dispose();
  });

  testWidgets('Button keeps a 48 point target with narrow authored sizing',
      (tester) async {
    final source = jsonDecode(
      File('${root.path}/protocol/fixtures/v0.2/complete-paywall.json')
          .readAsStringSync(),
    )! as Map<String, Object?>;
    _jsonNode(source, 'close')['sizing'] = <String, Object?>{
      'width': <String, Object?>{'mode': 'fixed', 'value': 12},
      'height': 'fit',
    };
    final document = const MosaicProtocolDecoder().decode(jsonEncode(source));
    await _pump(tester, document, products: products);

    final target = tester.getSize(
      find.byKey(const ValueKey<String>('mosaic-close')),
    );
    expect(target.width, greaterThanOrEqualTo(48));
    expect(target.height, greaterThanOrEqualTo(48));
  });

  testWidgets('purchase Button swaps busy content and rejects duplicate taps',
      (tester) async {
    final provider = _PendingPurchaseProvider(products);
    final results = <MosaicPresentationResult>[];
    await _pump(
      tester,
      fixture('complete-paywall.json'),
      purchaseProvider: provider,
      onResult: results.add,
    );
    await tester.ensureVisible(
      find.byKey(const ValueKey<String>('mosaic-purchase')),
    );
    await tester.tap(find.byKey(const ValueKey<String>('mosaic-purchase')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey<String>('mosaic-purchase')));
    await tester.pump();

    expect(provider.purchaseCalls, 1);
    expect(find.text('Processing purchase…'), findsOneWidget);
    expect(find.text('Continue'), findsNothing);

    provider.completePurchase();
    await tester.pumpAndSettle();
    expect(find.text('Continue'), findsOneWidget);
    expect(results, hasLength(1));
    expect(results.single.outcome, MosaicPresentationOutcome.purchased);
  });

  testWidgets('accepted revision resets Switch and Carousel runtime state',
      (tester) async {
    final semantics = tester.ensureSemantics();
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

    await tester.tap(
      find.byKey(
        const ValueKey<String>('mosaic-plans-monthly-plan-card'),
      ),
    );
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

    await tester.ensureVisible(
      find.byKey(const ValueKey<String>('mosaic-view-details')),
    );
    await tester.tap(find.byKey(const ValueKey<String>('mosaic-view-details')));
    await tester.pumpAndSettle();
    expect(find.text('Purchase and policy details'), findsOneWidget);

    rebuild(() {
      document = const MosaicProtocolDecoder().decode(source);
    });
    await tester.pump();
    await tester.pump();

    expect(tester.widget<Switch>(find.byType(Switch).first).value, isTrue);
    expect(find.text('Unlock every Mosaic Pro feature'), findsOneWidget);
    expect(find.byType(PageView), findsOneWidget);
    expect(tester.widget<PageView>(find.byType(PageView)).controller!.page, 1);
    final yearly = tester.getSemantics(
      find.byKey(
        const ValueKey<String>('mosaic-plans-yearly-plan-card'),
      ),
    );
    expect(yearly.flagsCollection.isSelected, Tristate.isTrue);
    expect(
      (expected['switches']! as Map<String, Object?>)['show-offer-details'],
      isTrue,
    );
    expect(
      (expected['carousels']! as Map<String, Object?>)['offer-highlights'],
      1,
    );
    expect(
      (expected['navigation']! as Map<String, Object?>)['currentScreenId'],
      'offer',
    );
    semantics.dispose();
  });

  test('Selected Product Card recursively inherits absent Default leaves', () {
    final selector = fixture('complete-paywall.json')
        .nodes
        .whereType<MosaicProductSelectorComponent>()
        .single;
    final card = selector.cards.singleWhere(
      (card) => card.id == 'plans-yearly-plan-card',
    );
    final styles = card.styles;
    final selected = styles.resolve(selected: true);

    expect(selected.cornerRadius, styles.defaultStyle.cornerRadius);
    expect(selected.padding.top, styles.defaultStyle.padding.top);
    expect(selected.padding.start, 18);
    expect(selected.opacity, styles.defaultStyle.opacity);

    final badge = card.badge!;
    final selectedBadge = badge.styles.resolve(selected: true);
    expect(selectedBadge.background.value, 'action.primary');
    expect(
      selectedBadge.cornerRadius,
      badge.styles.defaultStyle.cornerRadius,
    );
  });

  testWidgets(
      'authored cards interpolate provider data and select by Product Card ID',
      (tester) async {
    final interactions = <MosaicInteraction>[];
    final semantics = tester.ensureSemantics();
    await _pump(
      tester,
      fixture('complete-paywall.json'),
      products: products,
      onInteraction: interactions.add,
    );

    expect(find.text('Monthly'), findsOneWidget);
    expect(find.text('Yearly'), findsOneWidget);
    expect(find.text('Lifetime Access'), findsOneWidget);
    expect(find.text(r'$199.99'), findsOneWidget);
    expect(find.text('Best value'), findsOneWidget);
    expect(find.text('Own it forever'), findsOneWidget);

    final yearly = tester.getSemantics(
      find.byKey(
        const ValueKey<String>('mosaic-plans-yearly-plan-card'),
      ),
    );
    expect(yearly.flagsCollection.isSelected, Tristate.isTrue);
    expect(yearly.flagsCollection.isChecked, CheckedState.isTrue);
    expect(yearly.flagsCollection.isInMutuallyExclusiveGroup, isTrue);
    expect(yearly.label, r'Yearly, $79.99, Best value');
    expect(find.bySemanticsLabel('Best value'), findsNothing);

    await tester.tap(
      find.byKey(
        const ValueKey<String>('mosaic-plans-monthly-plan-card'),
      ),
    );
    await tester.pump();
    final monthly = tester.getSemantics(
      find.byKey(
        const ValueKey<String>('mosaic-plans-monthly-plan-card'),
      ),
    );
    expect(monthly.flagsCollection.isSelected, Tristate.isTrue);
    expect(interactions.last.productReferenceId, 'monthly-plan');
    semantics.dispose();
  });

  testWidgets(
      'fallback card semantics merge visible passive labels in source order',
      (tester) async {
    final source = jsonDecode(
      File('${root.path}/protocol/fixtures/v0.2/complete-paywall.json')
          .readAsStringSync(),
    )! as Map<String, Object?>;
    final extraText = _jsonNodeCopy(source, 'offer-page-one-title')
      ..['id'] = 'plans-yearly-semantic-extra';
    final informativeImage = _jsonNodeCopy(source, 'hero')
      ..['id'] = 'plans-yearly-semantic-image'
      ..['sizing'] = <String, Object?>{
        'width': <String, Object?>{'mode': 'fixed', 'value': 1},
        'height': <String, Object?>{'mode': 'fixed', 'value': 1},
      }
      ..remove('aspectRatio');
    final informativeIcon = _jsonNodeCopy(source, 'view-details-icon')
      ..['id'] = 'plans-yearly-semantic-icon'
      ..['accessibility'] = <String, Object?>{
        'hidden': false,
        'label': <String, Object?>{
          'default': 'Restore previous purchases',
          'localizationKey': 'paywall.restore.accessibility',
        },
      };
    final hiddenText = _jsonNodeCopy(source, 'offer-page-two-title')
      ..['id'] = 'plans-yearly-hidden-semantic-text';
    final hiddenStack = <String, Object?>{
      'type': 'stack',
      'id': 'plans-yearly-hidden-semantic-stack',
      'direction': 'vertical',
      'gap': 0,
      'padding': <String, Object?>{
        'top': 0,
        'start': 0,
        'bottom': 0,
        'end': 0,
      },
      'mainAxisDistribution': 'start',
      'crossAxisAlignment': 'stretch',
      'children': <Object?>[hiddenText],
      'visibility': <String, Object?>{'mode': 'hidden'},
    };
    final semanticStack = <String, Object?>{
      'type': 'stack',
      'id': 'plans-yearly-semantic-stack',
      'direction': 'vertical',
      'gap': 0,
      'padding': <String, Object?>{
        'top': 0,
        'start': 0,
        'bottom': 0,
        'end': 0,
      },
      'mainAxisDistribution': 'start',
      'crossAxisAlignment': 'stretch',
      'children': <Object?>[
        extraText,
        informativeImage,
        informativeIcon,
        hiddenStack,
      ],
    };
    final yearly = _jsonNode(source, 'plans-yearly-plan-card');
    (yearly['children']! as List<Object?>).insert(2, semanticStack);
    final document = const MosaicProtocolDecoder().decode(jsonEncode(source));
    final semantics = tester.ensureSemantics();

    await _pump(
      tester,
      document,
      products: products,
      requestedLocale: 'ar',
    );

    const label = r'Yearly, $79.99, '
        'جدار دفع واحد وثلاثة عارضات أصلية, '
        'فسيفساء من شاشات الدفع الأصلية على الهاتف, '
        'استعادة المشتريات السابقة, أفضل قيمة';
    final yearlyFinder = find.byKey(
      const ValueKey<String>('mosaic-plans-yearly-plan-card'),
    );
    final yearlySemantics = tester.getSemantics(yearlyFinder);
    expect(yearlySemantics.label, label);
    expect(yearlySemantics.flagsCollection.isChecked, CheckedState.isTrue);
    expect(find.bySemanticsLabel(label), findsOneWidget);
    expect(
      find.descendant(
        of: yearlyFinder,
        matching:
            find.bySemanticsLabel('فسيفساء من شاشات الدفع الأصلية على الهاتف'),
      ),
      findsNothing,
    );
    expect(
      find.descendant(
        of: yearlyFinder,
        matching: find.bySemanticsLabel('استعادة المشتريات السابقة'),
      ),
      findsNothing,
    );
    expect(
      find.descendant(
        of: yearlyFinder,
        matching: find.bySemanticsLabel('حدّث من دون إصدار جديد للتطبيق'),
      ),
      findsNothing,
    );
    expect(
      find.descendant(
        of: yearlyFinder,
        matching: find.bySemanticsLabel('أفضل قيمة'),
      ),
      findsNothing,
    );
    expect(
      tester
          .widget<Directionality>(find.byType(Directionality).last)
          .textDirection,
      TextDirection.rtl,
    );
    semantics.dispose();
  });

  testWidgets(
      'missing localized price removes its card and falls back in authored order',
      (tester) async {
    const missingInitialPrice = <MosaicProduct>[
      MosaicProduct(
        id: 'mosaic_pro_monthly',
        title: 'Provider Monthly',
        localizedPrice: r'$9.99',
      ),
      MosaicProduct(
        id: 'mosaic_pro_yearly',
        title: 'Provider Yearly',
        localizedPrice: null,
      ),
      MosaicProduct(
        id: 'mosaic_pro_lifetime',
        title: '',
        localizedPrice: r'$199.99',
      ),
    ];
    final semantics = tester.ensureSemantics();
    await _pump(
      tester,
      fixture('complete-paywall.json'),
      products: missingInitialPrice,
    );

    expect(
      find.byKey(
        const ValueKey<String>('mosaic-plans-yearly-plan-card'),
      ),
      findsNothing,
    );
    final monthly = tester.getSemantics(
      find.byKey(
        const ValueKey<String>('mosaic-plans-monthly-plan-card'),
      ),
    );
    expect(monthly.flagsCollection.isSelected, Tristate.isTrue);
    expect(find.text('Provider Monthly'), findsOneWidget);
    expect(find.text('Lifetime'), findsOneWidget,
        reason: 'An empty provider title falls back to the reference label.');
    semantics.dispose();
  });

  testWidgets('whitespace-only price removes a price-dependent card',
      (tester) async {
    const whitespacePrice = <MosaicProduct>[
      MosaicProduct(
        id: 'mosaic_pro_monthly',
        title: 'Provider Monthly',
        localizedPrice: ' \n\t ',
      ),
      MosaicProduct(
        id: 'mosaic_pro_yearly',
        title: 'Provider Yearly',
        localizedPrice: r'$79.99',
      ),
      MosaicProduct(
        id: 'mosaic_pro_lifetime',
        title: 'Provider Lifetime',
        localizedPrice: r'$199.99',
      ),
    ];
    final semantics = tester.ensureSemantics();
    await _pump(
      tester,
      fixture('complete-paywall.json'),
      products: whitespacePrice,
    );

    expect(
      find.byKey(
        const ValueKey<String>('mosaic-plans-monthly-plan-card'),
      ),
      findsNothing,
    );
    final yearly = tester.getSemantics(
      find.byKey(
        const ValueKey<String>('mosaic-plans-yearly-plan-card'),
      ),
    );
    expect(yearly.flagsCollection.isSelected, Tristate.isTrue);
    semantics.dispose();
  });

  testWidgets('locale changes reconcile an unavailable current card',
      (tester) async {
    final source = jsonDecode(
      File('${root.path}/protocol/fixtures/v0.2/complete-paywall.json')
          .readAsStringSync(),
    )! as Map<String, Object?>;
    final monthlyPrice = _jsonNode(
      source,
      'plans-monthly-plan-card-price',
    );
    (monthlyPrice['value']! as Map<String, Object?>)['default'] =
        'Monthly details';
    final localization = source['localization']! as Map<String, Object?>;
    final locales = localization['locales']! as Map<String, Object?>;
    final english = locales['en']! as Map<String, Object?>;
    final englishStrings = english['strings']! as Map<String, Object?>;
    englishStrings['mosaic.migration.product_card_2.price'] = 'Monthly details';
    final document = const MosaicProtocolDecoder().decode(jsonEncode(source));
    const localeProducts = <MosaicProduct>[
      MosaicProduct(
        id: 'mosaic_pro_monthly',
        title: 'Provider Monthly',
        localizedPrice: null,
      ),
      MosaicProduct(
        id: 'mosaic_pro_yearly',
        title: 'Provider Yearly',
        localizedPrice: r'$79.99',
      ),
      MosaicProduct(
        id: 'mosaic_pro_lifetime',
        title: 'Provider Lifetime',
        localizedPrice: r'$199.99',
      ),
    ];
    final purchaseProvider =
        MockMosaicPurchaseProvider(products: localeProducts);
    var requestedLocale = 'en';
    late StateSetter rebuild;
    final semantics = tester.ensureSemantics();
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
              purchaseProvider: purchaseProvider,
              requestedLocale: requestedLocale,
              onResult: (_) {},
            );
          },
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
    await tester.tap(
      find.byKey(
        const ValueKey<String>('mosaic-plans-monthly-plan-card'),
      ),
    );
    await tester.pump();

    rebuild(() => requestedLocale = 'ar');
    await tester.pump();

    expect(
      find.byKey(
        const ValueKey<String>('mosaic-plans-monthly-plan-card'),
      ),
      findsNothing,
    );
    final yearly = tester.getSemantics(
      find.byKey(
        const ValueKey<String>('mosaic-plans-yearly-plan-card'),
      ),
    );
    expect(yearly.flagsCollection.isSelected, Tristate.isTrue);
    final purchase = tester.widget<InkWell>(
      find.descendant(
        of: find.byKey(const ValueKey<String>('mosaic-purchase')),
        matching: find.byType(InkWell),
      ),
    );
    expect(purchase.onTap, isNotNull);
    semantics.dispose();
  });

  testWidgets('no available authored card shows fallback and disables Purchase',
      (tester) async {
    final diagnostics = <MosaicDiagnostic>[];
    await _pump(
      tester,
      fixture('complete-paywall.json'),
      products: const <MosaicProduct>[
        MosaicProduct(
          id: 'mosaic_pro_monthly',
          title: 'Monthly',
          localizedPrice: null,
        ),
        MosaicProduct(
          id: 'mosaic_pro_yearly',
          title: 'Yearly',
          localizedPrice: null,
        ),
        MosaicProduct(
          id: 'mosaic_pro_lifetime',
          title: 'Lifetime',
          localizedPrice: null,
        ),
      ],
      onDiagnostic: diagnostics.add,
    );

    expect(find.text('Plans are temporarily unavailable.'), findsOneWidget);
    final purchase = tester.widget<InkWell>(
      find.descendant(
        of: find.byKey(const ValueKey<String>('mosaic-purchase')),
        matching: find.byType(InkWell),
      ),
    );
    expect(purchase.onTap, isNull);
    expect(
      diagnostics.map((diagnostic) => diagnostic.code),
      contains('product.unavailable'),
    );
  });

  testWidgets('a current unavailable card falls back to first authored card',
      (tester) async {
    final document = fixture('complete-paywall.json');
    MosaicPurchaseProvider provider = MockMosaicPurchaseProvider(
      products: products,
    );
    late StateSetter rebuild;
    final semantics = tester.ensureSemantics();
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
              purchaseProvider: provider,
              onResult: (_) {},
            );
          },
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
    await tester.tap(
      find.byKey(
        const ValueKey<String>('mosaic-plans-lifetime-plan-card'),
      ),
    );
    await tester.pump();

    rebuild(() {
      provider = MockMosaicPurchaseProvider(products: products.take(2));
    });
    await tester.pump();
    await tester.pump();

    expect(
      find.byKey(
        const ValueKey<String>('mosaic-plans-lifetime-plan-card'),
      ),
      findsNothing,
    );
    final monthly = tester.getSemantics(
      find.byKey(
        const ValueKey<String>('mosaic-plans-monthly-plan-card'),
      ),
    );
    expect(monthly.flagsCollection.isSelected, Tristate.isTrue);
    semantics.dispose();
  });

  testWidgets('vertical selector follows source order and stretches cards',
      (tester) async {
    final source = jsonDecode(
      File('${root.path}/protocol/fixtures/v0.2/complete-paywall.json')
          .readAsStringSync(),
    )! as Map<String, Object?>;
    _jsonNode(source, 'plans')['direction'] = 'vertical';
    final document = const MosaicProtocolDecoder().decode(jsonEncode(source));
    await _pump(tester, document, products: products);

    final monthly = tester.getRect(
      find.byKey(
        const ValueKey<String>('mosaic-plans-monthly-plan-card'),
      ),
    );
    final yearly = tester.getRect(
      find.byKey(
        const ValueKey<String>('mosaic-plans-yearly-plan-card'),
      ),
    );
    final lifetime = tester.getRect(
      find.byKey(
        const ValueKey<String>('mosaic-plans-lifetime-plan-card'),
      ),
    );
    expect(monthly.bottom, lessThanOrEqualTo(yearly.top));
    expect(yearly.bottom, lessThanOrEqualTo(lifetime.top));
    expect(monthly.width, closeTo(yearly.width, 0.01));
    expect(yearly.width, closeTo(lifetime.width, 0.01));
  });

  testWidgets('logical topEnd badge anchor mirrors in RTL', (tester) async {
    final document = fixture('complete-paywall.json');
    await _pump(tester, document, products: products);
    final ltrCard = tester.getRect(
      find.byKey(
        const ValueKey<String>('mosaic-plans-lifetime-plan-card'),
      ),
    );
    final ltrBadge = tester.getRect(
      find.byKey(
        const ValueKey<String>('mosaic-plans-lifetime-plan-card-badge'),
      ),
    );
    expect(ltrBadge.center.dx, greaterThan(ltrCard.center.dx));

    await _pump(
      tester,
      document,
      products: products,
      requestedLocale: 'ar',
    );
    final rtlCard = tester.getRect(
      find.byKey(
        const ValueKey<String>('mosaic-plans-lifetime-plan-card'),
      ),
    );
    final rtlBadge = tester.getRect(
      find.byKey(
        const ValueKey<String>('mosaic-plans-lifetime-plan-card-badge'),
      ),
    );
    expect(rtlBadge.center.dx, lessThan(rtlCard.center.dx));
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

    await tester.ensureVisible(
      find.byKey(const ValueKey<String>('mosaic-view-details-icon')),
    );
    final transforms = tester.widgetList<Transform>(
      find.descendant(
        of: find.byKey(
          const ValueKey<String>('mosaic-view-details-icon'),
        ),
        matching: find.byType(Transform),
      ),
    );
    expect(
      transforms
          .where((transform) => transform.transform.entry(0, 0) == -1)
          .length,
      1,
      reason:
          "Material's directional IconData must mirror exactly once in RTL.",
    );
    semantics.dispose();
  });
}

Map<String, Object?> _jsonNode(Map<String, Object?> document, String id) {
  Map<String, Object?>? result;
  void visit(Object? value) {
    if (result != null) return;
    if (value is List<Object?>) {
      for (final item in value) {
        visit(item);
      }
      return;
    }
    if (value is! Map<String, Object?>) return;
    if (value['id'] == id && value.containsKey('type')) {
      result = value;
      return;
    }
    for (final item in value.values) {
      visit(item);
    }
  }

  visit(document['screens']);
  return result ?? (throw StateError('Missing fixture node $id'));
}

Map<String, Object?> _jsonNodeCopy(
  Map<String, Object?> document,
  String id,
) =>
    jsonDecode(jsonEncode(_jsonNode(document, id)))! as Map<String, Object?>;

void _suffixFixtureIds(Object? value, String suffix) {
  if (value is List<Object?>) {
    for (final child in value) {
      _suffixFixtureIds(child, suffix);
    }
    return;
  }
  if (value is! Map<String, Object?>) return;
  final type = value['type'];
  final isTokenReference = type == 'colorToken' ||
      type == 'backgroundToken' ||
      type == 'shadowToken';
  if (!isTokenReference && value['id'] is String) {
    final id = value['id']! as String;
    value['id'] = '$id$suffix';
  }
  for (final child in value.values.toList(growable: false)) {
    _suffixFixtureIds(child, suffix);
  }
}

Future<void> _pump(
  WidgetTester tester,
  MosaicPaywallDocument document, {
  List<MosaicProduct> products = const <MosaicProduct>[],
  MosaicClock? clock,
  MosaicDiagnosticCallback? onDiagnostic,
  MosaicInteractionCallback? onInteraction,
  MosaicExternalUrlOpener? externalUrlOpener,
  MosaicPurchaseProvider? purchaseProvider,
  MosaicPresentationResultCallback? onResult,
  String? requestedLocale,
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
          purchaseProvider: purchaseProvider ??
              MockMosaicPurchaseProvider(products: products),
          clock: clock ?? DateTime.now,
          onResult: onResult ?? (_) {},
          requestedLocale: requestedLocale,
          onInteraction: onInteraction,
          onDiagnostic: onDiagnostic,
          externalUrlOpener: externalUrlOpener ?? (_) async => true,
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
}

final class _PendingPurchaseProvider implements MosaicPurchaseProvider {
  _PendingPurchaseProvider(this.products);

  final List<MosaicProduct> products;
  final Completer<MosaicPurchaseResult> _purchase = Completer();
  int purchaseCalls = 0;

  void completePurchase() {
    _purchase.complete(
      const MosaicPurchased(
        productId: 'mosaic_pro_yearly',
        transactionId: 'rc2-test',
      ),
    );
  }

  @override
  Future<MosaicActiveEntitlementsResult> activeEntitlements() async =>
      MosaicActiveEntitlements(const <MosaicEntitlement>[]);

  @override
  Future<MosaicProductLoadResult> loadProducts(
    Iterable<String> productIds,
  ) async =>
      MosaicProductsLoaded(products);

  @override
  Future<MosaicPurchaseResult> purchase(String productId) {
    purchaseCalls += 1;
    return _purchase.future;
  }

  @override
  Future<MosaicRestoreResult> restore() async => const MosaicNothingToRestore();
}
