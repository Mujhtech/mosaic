import 'dart:async';
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
  MosaicProduct(
    id: 'mosaic_pro_lifetime',
    title: 'Mosaic Pro Lifetime',
    localizedPrice: r'$199.99',
  ),
];

/// Rendering, interaction, and accessibility for the four components Protocol
/// 0.3 adds, driven by the canonical fixture rather than a local document.
void main() {
  testWidgets('Tabs opens its authored initial panel, not the first one',
      (tester) async {
    final semantics = tester.ensureSemantics();
    await _pump(tester);

    final annual =
        _semantics(tester, 'mosaic-billing-tabs-billing-tabs-annual');
    expect(annual.label, 'Annual');
    expect(annual.flagsCollection.isSelected, Tristate.isTrue);
    expect(annual.flagsCollection.isInMutuallyExclusiveGroup, isTrue);

    final monthly =
        _semantics(tester, 'mosaic-billing-tabs-billing-tabs-monthly');
    expect(monthly.flagsCollection.isSelected, Tristate.isFalse);

    // Exactly one panel is in the tree, and it is the authored initial tab.
    expect(
      find.text('Billed once a year at a lower effective rate.'),
      findsOneWidget,
    );
    expect(
      find.text('Billed every month. Cancel whenever you like.'),
      findsNothing,
    );
    // The panel is named by the same authored label as its control, so the two
    // cannot drift apart.
    expect(
      _semantics(tester, 'mosaic-billing-tabs-panel').label,
      'Annual',
    );
    semantics.dispose();
  });

  testWidgets('selecting a tab swaps the panel and its dependent node',
      (tester) async {
    final semantics = tester.ensureSemantics();
    await _pump(tester);

    // `annual-note` is authored with visibility {mode: tab, equals: annual}.
    expect(find.text('Annual billing includes two extra editor seats.'),
        findsOneWidget);

    final monthlyTab = find.byKey(
      const ValueKey<String>('mosaic-billing-tabs-billing-tabs-monthly'),
    );
    await tester.ensureVisible(monthlyTab);
    await tester.pumpAndSettle();
    await tester.tap(monthlyTab);
    await tester.pumpAndSettle();

    expect(
      find.text('Billed every month. Cancel whenever you like.'),
      findsOneWidget,
    );
    expect(
      find.text('Billed once a year at a lower effective rate.'),
      findsNothing,
    );
    // A false tab condition removes the node from layout and from the
    // accessibility tree, exactly as a false Switch condition does.
    expect(find.text('Annual billing includes two extra editor seats.'),
        findsNothing);
    expect(
      _semantics(tester, 'mosaic-billing-tabs-billing-tabs-monthly')
          .flagsCollection
          .isSelected,
      Tristate.isTrue,
    );
    semantics.dispose();
  });

  testWidgets('Timeline is a labelled list of separately announced entries',
      (tester) async {
    final semantics = tester.ensureSemantics();
    await _pump(tester);

    expect(
      _semantics(tester, 'mosaic-trial-timeline').label,
      'How your free trial works',
    );
    // Each segment is its own element. Nothing is joined, so no renderer-
    // invented punctuation reaches a screen reader.
    expect(
      _elementLabels(tester, 'mosaic-trial-timeline-trial-today'),
      <String>[
        'Today',
        'Full access starts immediately and nothing is charged.',
      ],
    );
    // An entry with no description produces no second element — never an empty
    // one — and reserves no space for one.
    expect(
      _elementLabels(tester, 'mosaic-trial-timeline-trial-charge'),
      <String>['Day 7'],
    );
    expect(find.text('Day 7'), findsOneWidget);
    // Markers and the connector are decorative: drawn, never announced.
    expect(find.text('2'), findsOneWidget);
    expect(
      _elementLabels(tester, 'mosaic-trial-timeline-trial-reminder'),
      isNot(contains('2')),
    );
    semantics.dispose();
  });

  testWidgets('Award is a labelled group of separately announced segments',
      (tester) async {
    final semantics = tester.ensureSemantics();
    await _pump(tester);

    expect(
      _semantics(tester, 'mosaic-editor-award').label,
      'Editorial recognition',
    );
    expect(
      _elementLabels(tester, 'mosaic-editor-award'),
      <String>['App of the Day', 'Selected by the editorial team'],
    );
    // An award with no subtitle produces no subtitle element at all.
    expect(_semantics(tester, 'mosaic-press-award').label, 'Press recognition');
    expect(
      _elementLabels(tester, 'mosaic-press-award'),
      <String>["Editor's Choice"],
    );
    // The emblem is decorative in both arms of the union.
    expect(find.text('App of the Day'), findsOneWidget);
    semantics.dispose();
  });

  testWidgets('Social Proof announces rating, quote, then attribution',
      (tester) async {
    final semantics = tester.ensureSemantics();
    await _pump(tester);

    expect(_semantics(tester, 'mosaic-rated-review').label, 'Customer review');
    expect(
      _elementLabels(tester, 'mosaic-rated-review'),
      <String>[
        '4.5 out of 5 stars',
        'Mosaic replaced three internal tools and a month of paywall work.',
        'Priya N., mobile lead',
      ],
    );
    // An absent rating produces no element: it is neither a zero rating nor an
    // unknown one. The avatar is decorative and adds none either.
    expect(_semantics(tester, 'mosaic-analyst-note').label, 'Analyst note');
    expect(
      _elementLabels(tester, 'mosaic-analyst-note'),
      <String>[
        'The clearest cross-platform paywall contract we have reviewed.',
        'Subscription Economy Review',
      ],
    );
    semantics.dispose();
  });

  testWidgets('a busy Button keeps its name and carries the state as value',
      (tester) async {
    final semantics = tester.ensureSemantics();
    final provider = _PendingPurchaseProvider();
    await _pump(tester, purchaseProvider: provider);

    final idle = _semantics(tester, 'mosaic-purchase');
    expect(idle.label, 'Continue with the selected plan');
    expect(idle.value, '');
    // Idle content is not announced, so the Button is one element.
    expect(_elementLabels(tester, 'mosaic-purchase'), isEmpty);

    await tester.tap(find.byKey(const ValueKey<String>('mosaic-purchase')));
    await tester.pump();

    final busy = _semantics(tester, 'mosaic-purchase');
    // The authored name does not change mid-operation; the reserved string is
    // the control's value, and in-progress content is not announced either.
    expect(busy.label, 'Continue with the selected plan');
    expect(busy.value, 'In progress');
    expect(_elementLabels(tester, 'mosaic-purchase'), isEmpty);
    expect(find.text('Processing purchase…'), findsOneWidget);
    semantics.dispose();
  });

  testWidgets('tab controls meet the minimum touch target and survive RTL',
      (tester) async {
    await _pump(tester, requestedLocale: 'ar');

    for (final id in <String>[
      'billing-tabs-monthly',
      'billing-tabs-annual',
      'billing-tabs-lifetime',
    ]) {
      final size = tester.getSize(
        find.byKey(ValueKey<String>('mosaic-billing-tabs-$id')),
      );
      expect(size.width, greaterThanOrEqualTo(48));
      expect(size.height, greaterThanOrEqualTo(48));
    }
    // The renderer installs the resolved direction below itself, so it is read
    // from inside the tab bar: the first authored tab must sit to the right.
    expect(
      Directionality.of(
        tester.element(
          find.byKey(
            const ValueKey<String>('mosaic-billing-tabs-billing-tabs-monthly'),
          ),
        ),
      ),
      TextDirection.rtl,
    );
    final first = tester.getTopLeft(
      find.byKey(
        const ValueKey<String>('mosaic-billing-tabs-billing-tabs-monthly'),
      ),
    );
    final last = tester.getTopLeft(
      find.byKey(
        const ValueKey<String>('mosaic-billing-tabs-billing-tabs-lifetime'),
      ),
    );
    expect(first.dx, greaterThan(last.dx));
  });

  testWidgets('the four components survive 200 percent text scaling',
      (tester) async {
    await _pump(tester, textScaler: const TextScaler.linear(2));

    // Rendering at double scale must not overflow or throw; every component
    // still contributes its authored copy.
    expect(tester.takeException(), isNull);
    expect(find.text('App of the Day'), findsOneWidget);
    expect(find.text('Today'), findsOneWidget);
    expect(find.text('Annual'), findsOneWidget);
    expect(find.text('Priya N., mobile lead'), findsOneWidget);
  });
}

SemanticsNode _semantics(WidgetTester tester, String key) =>
    tester.getSemantics(find.byKey(ValueKey<String>(key)));

/// Labels of the announced elements inside a container, in traversal order.
List<String> _elementLabels(WidgetTester tester, String key) {
  final labels = <String>[];
  void visit(SemanticsNode node) {
    node.visitChildren((child) {
      if (child.label.isNotEmpty) labels.add(child.label);
      visit(child);
      return true;
    });
  }

  visit(_semantics(tester, key));
  return labels;
}

Future<void> _pump(
  WidgetTester tester, {
  String? requestedLocale,
  TextScaler textScaler = TextScaler.noScaling,
  MosaicPurchaseProvider? purchaseProvider,
}) async {
  tester.view.physicalSize = const Size(1000, 4000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: ThemeData(useMaterial3: true),
      home: MediaQuery(
        data: MediaQueryData(textScaler: textScaler),
        child: Scaffold(
          body: MosaicPaywall(
            document: decodeCanonicalFixture(),
            purchaseProvider: purchaseProvider ??
                MockMosaicPurchaseProvider(products: _products),
            requestedLocale: requestedLocale,
            clock: () => DateTime.utc(2030, 12, 30, 23, 59, 59),
            onResult: (_) {},
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// A provider whose purchase never settles, so the Button stays in progress.
final class _PendingPurchaseProvider implements MosaicPurchaseProvider {
  @override
  Future<MosaicActiveEntitlementsResult> activeEntitlements() async =>
      MosaicActiveEntitlements(const <MosaicEntitlement>[]);

  @override
  Future<MosaicProductLoadResult> loadProducts(
    Iterable<String> productIds,
  ) async =>
      MosaicProductsLoaded(_products);

  @override
  Future<MosaicPurchaseResult> purchase(String productId) =>
      Completer<MosaicPurchaseResult>().future;

  @override
  Future<MosaicRestoreResult> restore() =>
      Completer<MosaicRestoreResult>().future;
}
