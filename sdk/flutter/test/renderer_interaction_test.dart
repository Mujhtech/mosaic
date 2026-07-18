import 'dart:async';
import 'dart:ui' show Tristate;

import 'package:flutter/material.dart';
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
  test('normalized presentation outcome spellings are exact', () {
    expect(
      MosaicPresentationOutcome.values.map((outcome) => outcome.wireValue),
      <String>[
        'purchased',
        'restored',
        'alreadyEntitled',
        'dismissed',
        'cancelled',
        'productUnavailable',
        'configurationUnavailable',
        'purchaseFailed',
        'renderingFailed',
      ],
    );
  });

  testWidgets('renders every RC1 component with native Flutter widgets',
      (tester) async {
    await _pumpPaywall(tester, MockMosaicPurchaseProvider(products: _products));

    for (final id in <String>[
      'close',
      'hero',
      'headline',
      'subtitle',
      'features',
      'plans',
      'purchase',
      'restore',
      'legal',
    ]) {
      expect(find.byKey(ValueKey<String>('mosaic-$id')), findsOneWidget);
    }
    expect(find.byType(SingleChildScrollView), findsOneWidget);
    expect(find.byType(FilledButton), findsOneWidget);
    expect(find.byType(OutlinedButton), findsOneWidget);
    expect(find.byType(TextButton), findsOneWidget);
    expect(find.text('Premium illustration unavailable'), findsOneWidget);
    expect(find.text(r'$49.99'), findsOneWidget);
    expect(find.text('year'), findsOneWidget);
  });

  testWidgets('selects a product and purchases using document-local identity',
      (tester) async {
    final results = <MosaicPresentationResult>[];
    final interactions = <MosaicInteraction>[];
    await _pumpPaywall(
      tester,
      MockMosaicPurchaseProvider(products: _products),
      results: results,
      interactions: interactions,
    );

    await _tap(tester, 'mosaic-plans-monthly-plan');
    expect(
        interactions.single.outcome, MosaicInteractionOutcome.productSelected);
    expect(interactions.single.productReferenceId, 'monthly-plan');

    await _tap(tester, 'mosaic-purchase');
    expect(results.single, isA<MosaicPurchasedPresentationResult>());
    expect(
      (results.single as MosaicPurchasedPresentationResult).productReferenceId,
      'monthly-plan',
    );
    expect(interactions.last.outcome, MosaicInteractionOutcome.purchased);
  });

  for (final entry
      in <(MockMosaicPurchaseScenario, Type, MosaicInteractionOutcome)>[
    (
      MockMosaicPurchaseScenario.success,
      MosaicPurchasedPresentationResult,
      MosaicInteractionOutcome.purchased,
    ),
    (
      MockMosaicPurchaseScenario.cancellation,
      MosaicCancelledPresentationResult,
      MosaicInteractionOutcome.cancelled,
    ),
    (
      MockMosaicPurchaseScenario.failure,
      MosaicPurchaseFailedPresentationResult,
      MosaicInteractionOutcome.purchaseFailed,
    ),
    (
      MockMosaicPurchaseScenario.alreadyEntitled,
      MosaicAlreadyEntitledPresentationResult,
      MosaicInteractionOutcome.alreadyEntitled,
    ),
    (
      MockMosaicPurchaseScenario.productUnavailable,
      MosaicProductUnavailablePresentationResult,
      MosaicInteractionOutcome.productUnavailable,
    ),
  ]) {
    testWidgets('maps purchase ${entry.$1.name} to ${entry.$3.wireValue}',
        (tester) async {
      final results = <MosaicPresentationResult>[];
      final interactions = <MosaicInteraction>[];
      await _pumpPaywall(
        tester,
        MockMosaicPurchaseProvider(
          products: _products,
          purchaseScenario: entry.$1,
        ),
        results: results,
        interactions: interactions,
      );

      await _tap(tester, 'mosaic-purchase');

      expect(results.single.runtimeType, entry.$2);
      expect(interactions.single.outcome, entry.$3);
      expect(interactions.single.productReferenceId, 'yearly-plan');
    });
  }

  testWidgets('omits unavailable options and selects first available product',
      (tester) async {
    final interactions = <MosaicInteraction>[];
    await _pumpPaywall(
      tester,
      MockMosaicPurchaseProvider(products: _products.take(1)),
      interactions: interactions,
    );

    expect(
      find.byKey(const ValueKey<String>('mosaic-plans-yearly-plan')),
      findsNothing,
    );
    final monthly = tester.getSemantics(
      find.byKey(const ValueKey<String>('mosaic-plans-monthly-plan')),
    );
    expect(monthly.flagsCollection.isSelected, Tristate.isTrue);
    expect(interactions, isEmpty);
  });

  testWidgets('legacy selector treats whitespace-only prices as unavailable',
      (tester) async {
    await _pumpPaywall(
      tester,
      MockMosaicPurchaseProvider(
        products: const <MosaicProduct>[
          MosaicProduct(
            id: 'mosaic_pro_monthly',
            title: 'Mosaic Pro Monthly',
            localizedPrice: ' \n\t ',
          ),
          MosaicProduct(
            id: 'mosaic_pro_yearly',
            title: 'Mosaic Pro Yearly',
            localizedPrice: r'$49.99',
          ),
        ],
      ),
    );

    expect(
      find.byKey(const ValueKey<String>('mosaic-plans-monthly-plan')),
      findsNothing,
    );
    final yearly = tester.getSemantics(
      find.byKey(const ValueKey<String>('mosaic-plans-yearly-plan')),
    );
    expect(yearly.flagsCollection.isSelected, Tristate.isTrue);
  });

  testWidgets('none available shows message, disables purchase, and notifies',
      (tester) async {
    final results = <MosaicPresentationResult>[];
    final interactions = <MosaicInteraction>[];
    await _pumpPaywall(
      tester,
      MockMosaicPurchaseProvider(),
      results: results,
      interactions: interactions,
    );

    expect(find.text('Plans are temporarily unavailable.'), findsOneWidget);
    final purchase = tester.getSemantics(
      find.byKey(const ValueKey<String>('mosaic-purchase')),
    );
    expect(purchase.flagsCollection.isEnabled, Tristate.isFalse);
    expect(results, isEmpty);
    expect(interactions.single.outcome,
        MosaicInteractionOutcome.productUnavailable);
    expect(interactions.single.productSelectorId, 'plans');
    expect(interactions.single.productReferenceId, 'yearly-plan');
  });

  for (final entry in <(MockMosaicRestoreScenario, String)>[
    (MockMosaicRestoreScenario.success, 'restored'),
    (MockMosaicRestoreScenario.alreadyEntitled, 'alreadyEntitled'),
    (MockMosaicRestoreScenario.noPurchases, 'restoreNoPurchases'),
    (MockMosaicRestoreScenario.failure, 'restoreFailed'),
  ]) {
    testWidgets('maps restore ${entry.$1.name} to ${entry.$2}', (tester) async {
      final results = <MosaicPresentationResult>[];
      final interactions = <MosaicInteraction>[];
      await _pumpPaywall(
        tester,
        MockMosaicPurchaseProvider(
          products: _products,
          restoreScenario: entry.$1,
        ),
        results: results,
        interactions: interactions,
      );

      await _tap(tester, 'mosaic-restore');

      expect(interactions.single.outcome.wireValue, entry.$2);
      if (entry.$1 == MockMosaicRestoreScenario.success) {
        expect(results.single, isA<MosaicRestoredPresentationResult>());
      } else if (entry.$1 == MockMosaicRestoreScenario.alreadyEntitled) {
        expect(results.single, isA<MosaicAlreadyEntitledPresentationResult>());
      } else {
        expect(results, isEmpty);
      }
    });
  }

  testWidgets('close reports dismissed without owning modal dismissal',
      (tester) async {
    final results = <MosaicPresentationResult>[];
    await _pumpPaywall(
      tester,
      MockMosaicPurchaseProvider(products: _products),
      results: results,
    );

    await _tap(tester, 'mosaic-close');

    expect(results.single, isA<MosaicDismissedPresentationResult>());
    expect(find.byType(MosaicPaywall), findsOneWidget);
  });

  testWidgets('purchase and restore expose localized busy state',
      (tester) async {
    final provider = _CompletingProvider();
    await _pumpPaywall(tester, provider);

    await _tapWithoutSettling(tester, 'mosaic-purchase');
    expect(find.text('Processing purchase…'), findsOneWidget);
    final purchase = tester.getSemantics(
      find.byKey(const ValueKey<String>('mosaic-purchase')),
    );
    expect(purchase.flagsCollection.isEnabled, Tristate.isFalse);
    expect(purchase.flagsCollection.isLiveRegion, isTrue);
    provider.purchaseCompleter.complete(
      const MosaicPurchased(
        productId: 'mosaic_pro_yearly',
        transactionId: 'mock',
      ),
    );
    await tester.pumpAndSettle();

    await _tapWithoutSettling(tester, 'mosaic-restore');
    expect(find.text('Restoring purchases…'), findsOneWidget);
    provider.restoreCompleter.complete(
      MosaicRestored(
        const <MosaicEntitlement>[
          MosaicEntitlement(id: 'mosaic_pro_yearly'),
        ],
      ),
    );
    await tester.pumpAndSettle();
  });

  testWidgets('provider exceptions become safe normalized diagnostics',
      (tester) async {
    final results = <MosaicPresentationResult>[];
    final diagnostics = <MosaicDiagnostic>[];
    await _pumpPaywall(
      tester,
      _ThrowingPurchaseProvider(),
      results: results,
      diagnostics: diagnostics,
    );

    await _tap(tester, 'mosaic-purchase');

    expect(results.single, isA<MosaicPurchaseFailedPresentationResult>());
    expect(diagnostics.single.code, 'purchase_provider_exception');
    expect(
        diagnostics.single.message, isNot(contains('private provider detail')));
  });

  testWidgets('product-load exception uses the safe unavailable fallback',
      (tester) async {
    final results = <MosaicPresentationResult>[];
    final interactions = <MosaicInteraction>[];
    final diagnostics = <MosaicDiagnostic>[];
    await _pumpPaywall(
      tester,
      _ThrowingLoadProvider(),
      results: results,
      interactions: interactions,
      diagnostics: diagnostics,
    );

    expect(results, isEmpty);
    expect(interactions.single.outcome,
        MosaicInteractionOutcome.productUnavailable);
    expect(interactions.single.productReferenceId, 'yearly-plan');
    expect(
      diagnostics.map((diagnostic) => diagnostic.code),
      containsAll(<String>[
        'product_provider_load_failed',
        'product.unavailable',
      ]),
    );
    expect(find.text('Plans are temporarily unavailable.'), findsOneWidget);
    expect(find.byType(MosaicPaywall), findsOneWidget);
  });

  testWidgets('host reports configurationUnavailable after both documents fail',
      (tester) async {
    final results = <MosaicPresentationResult>[];
    final mosaic = Mosaic.configure(
      apiKey: 'public_test',
      purchaseProvider: MockMosaicPurchaseProvider(products: _products),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: MosaicPaywallHost(
          mosaic: mosaic,
          candidateDocument: 'bad primary',
          bundledFallbackLoader: () async => 'bad fallback',
          onResult: results.add,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      results.single,
      isA<MosaicConfigurationUnavailablePresentationResult>(),
    );
    expect(find.byType(MosaicPaywall), findsNothing);
  });

  testWidgets('host renders canonical bundle after primary rejection',
      (tester) async {
    final diagnostics = <MosaicDiagnostic>[];
    final mosaic = Mosaic.configure(
      apiKey: 'public_test',
      purchaseProvider: MockMosaicPurchaseProvider(products: _products),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: MosaicPaywallHost(
            mosaic: mosaic,
            candidateDocument: 'bad primary',
            bundledFallbackLoader: () async => canonicalFixtureSource(),
            onResult: (_) {},
            onDiagnostic: diagnostics.add,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(MosaicPaywall), findsOneWidget);
    expect(diagnostics.single.code, 'primary_document_rejected');
  });
}

Future<void> _pumpPaywall(
  WidgetTester tester,
  MosaicPurchaseProvider provider, {
  List<MosaicPresentationResult>? results,
  List<MosaicInteraction>? interactions,
  List<MosaicDiagnostic>? diagnostics,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: ThemeData(useMaterial3: true),
      home: Scaffold(
        body: MosaicPaywall(
          document: decodeCanonicalFixture(),
          purchaseProvider: provider,
          onResult: results?.add ?? (_) {},
          onInteraction: interactions?.add,
          onDiagnostic: diagnostics?.add,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _tap(WidgetTester tester, String key) async {
  final finder = find.byKey(ValueKey<String>(key));
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Future<void> _tapWithoutSettling(WidgetTester tester, String key) async {
  final finder = find.byKey(ValueKey<String>(key));
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pump();
}

final class _CompletingProvider implements MosaicPurchaseProvider {
  final Completer<MosaicPurchaseResult> purchaseCompleter =
      Completer<MosaicPurchaseResult>();
  final Completer<MosaicRestoreResult> restoreCompleter =
      Completer<MosaicRestoreResult>();

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
      purchaseCompleter.future;

  @override
  Future<MosaicRestoreResult> restore() => restoreCompleter.future;
}

final class _ThrowingPurchaseProvider implements MosaicPurchaseProvider {
  @override
  Future<MosaicActiveEntitlementsResult> activeEntitlements() async =>
      MosaicActiveEntitlements(const <MosaicEntitlement>[]);

  @override
  Future<MosaicProductLoadResult> loadProducts(
    Iterable<String> productIds,
  ) async =>
      MosaicProductsLoaded(_products);

  @override
  Future<MosaicPurchaseResult> purchase(String productId) async =>
      throw StateError('private provider detail');

  @override
  Future<MosaicRestoreResult> restore() async => const MosaicNothingToRestore();
}

final class _ThrowingLoadProvider implements MosaicPurchaseProvider {
  @override
  Future<MosaicActiveEntitlementsResult> activeEntitlements() async =>
      MosaicActiveEntitlements(const <MosaicEntitlement>[]);

  @override
  Future<MosaicProductLoadResult> loadProducts(
    Iterable<String> productIds,
  ) async =>
      throw StateError('private provider detail');

  @override
  Future<MosaicPurchaseResult> purchase(String productId) async =>
      MosaicPurchaseProductUnavailable(productId: productId);

  @override
  Future<MosaicRestoreResult> restore() async => const MosaicNothingToRestore();
}
