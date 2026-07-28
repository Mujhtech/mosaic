import 'dart:async';
import 'dart:convert';
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
        'pending',
        'deferred',
        'productUnavailable',
        'placementUnavailable',
        'configurationUnavailable',
        'purchaseFailed',
        'renderingFailed',
        'noPaywall',
      ],
    );
  });

  testWidgets('renders the Protocol 0.2 controls with native Flutter widgets',
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
    expect(find.byType(InkWell), findsWidgets);
    expect(find.text('Premium illustration unavailable'), findsOneWidget);
    expect(find.text(r'$49.99'), findsOneWidget);
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

    await _tap(tester, 'mosaic-plans-monthly-plan-card');
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

  testWidgets('conversion events carry the Experiment tuple on v2',
      (tester) async {
    final storage = MosaicMemoryAnalyticsStorage();
    final identity = MosaicIdentityController(
      storage: MosaicMemoryIdentityStorage(),
      namespace: 'e' * 64,
    );
    final runtime = MosaicAnalyticsRuntime(
      namespace: 'f' * 64,
      identityController: identity,
      context: const MosaicAnalyticsContext(
        platform: 'ios',
        sdkVersion: mosaicFlutterSdkVersion,
      ),
      transport: _UnavailableAnalyticsTransport(),
      storage: storage,
    );
    await runtime.setCollection(
      environment:
          const MosaicAnalyticsEnvironmentSettings(collectionEnabled: true),
    );
    const context = MosaicAnalyticsPresentationContext(
      placementRequestId: 'placement_request_1',
      paywallPresentationId: 'presentation_1',
      attribution: MosaicAnalyticsAttribution(
        configurationReleaseId: 'release_1',
        placementId: 'placement_1',
        paywallId: 'paywall_1',
        paywallVersionId: 'paywall_version_1',
      ),
      providerId: 'app_store',
      experiment: MosaicExperimentAttribution(
        experimentId: 'experiment_checkout',
        experimentVersionId: 'experiment_version_checkout_1',
        experimentVariantId: 'variant_treatment',
        experimentAllocationVersion: 'allocation_checkout_1',
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(useMaterial3: true),
        home: Scaffold(
          body: MosaicPaywall(
            document: decodeCanonicalFixture(),
            purchaseProvider: MockMosaicPurchaseProvider(products: _products),
            onResult: (_) {},
            analyticsRuntime: runtime,
            analyticsContext: context,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await _tap(tester, 'mosaic-plans-monthly-plan-card');
    await _tap(tester, 'mosaic-purchase');

    final queued = (jsonDecode(storage.source!) as Map)['events'] as List;
    final events = queued
        .map((item) => ((item as Map)['event']! as Map).cast<String, Object?>())
        .toList();
    for (final name in <String>[
      'product_selected',
      'purchase_completed_client'
    ]) {
      final event = events.singleWhere((item) => item['eventName'] == name);
      expect(event['eventSchemaVersion'], '2', reason: name);
      expect(
        (event['attribution']! as Map)['experimentVariantId'],
        'variant_treatment',
        reason: name,
      );
    }
    // Presentation events are not conversion events and stay on v1 without the
    // tuple: carrying it there would be a minimization violation.
    final presented =
        events.singleWhere((item) => item['eventName'] == 'paywall_presented');
    expect(presented['eventSchemaVersion'], '1');
    expect(
      (presented['attribution']! as Map).containsKey('experimentId'),
      isFalse,
    );
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
      find.byKey(const ValueKey<String>('mosaic-plans-yearly-plan-card')),
      findsNothing,
    );
    final monthly = tester.getSemantics(
      find.byKey(const ValueKey<String>('mosaic-plans-monthly-plan-card')),
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
      find.byKey(const ValueKey<String>('mosaic-plans-monthly-plan-card')),
      findsNothing,
    );
    final yearly = tester.getSemantics(
      find.byKey(const ValueKey<String>('mosaic-plans-yearly-plan-card')),
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
    (MockMosaicRestoreScenario.alreadyEntitled, 'restored'),
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
        expect(results.single, isA<MosaicRestoredPresentationResult>());
      } else {
        expect(results, isEmpty);
      }
    });
  }

  // Purpose: the highest-risk regression of the billing handoff is a purchase
  // stalling or changing outcome because an observation was awaited. The risk
  // lives in the renderer's await ordering, so it is asserted at the widget
  // layer with a sink that never completes and a sink that throws.
  for (final sink in <(String, MosaicTransactionObservationSink)>[
    ('never completes', _StallingObservationSink()),
    ('throws', _ThrowingObservationSink()),
  ]) {
    testWidgets(
        'purchase completes unchanged when the observation sink '
        '${sink.$1}', (tester) async {
      final results = <MosaicPresentationResult>[];
      final interactions = <MosaicInteraction>[];
      await _pumpPaywall(
        tester,
        MockMosaicPurchaseProvider(products: _products),
        results: results,
        interactions: interactions,
        transactionObservations: sink.$2,
      );

      await _tap(tester, 'mosaic-plans-monthly-plan-card');
      await _tap(tester, 'mosaic-purchase');

      expect(results.single, isA<MosaicPurchasedPresentationResult>());
      expect(
        (results.single as MosaicPurchasedPresentationResult)
            .productReferenceId,
        'monthly-plan',
      );
      expect(interactions.last.outcome, MosaicInteractionOutcome.purchased);
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
  MosaicTransactionObservationSink? transactionObservations,
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
          transactionObservations: transactionObservations,
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

/// A sink whose work never finishes. The renderer must not be able to wait on
/// it, so the purchase result must arrive within the normal pump.
final class _StallingObservationSink
    implements MosaicTransactionObservationSink {
  @override
  void observePurchaseResult({
    required String? transactionReference,
    String? providerOrderReference,
  }) {
    unawaited(Completer<void>().future);
  }
}

final class _ThrowingObservationSink
    implements MosaicTransactionObservationSink {
  @override
  void observePurchaseResult({
    required String? transactionReference,
    String? providerOrderReference,
  }) {
    throw StateError('billing handoff failure');
  }
}

/// Delivery is irrelevant to this suite; the queue is inspected directly.
final class _UnavailableAnalyticsTransport implements MosaicAnalyticsTransport {
  @override
  Future<MosaicAnalyticsIngestionResponse> send(MosaicAnalyticsBatch batch) =>
      throw const FormatException('Analytics delivery is unavailable.');
}
