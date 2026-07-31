import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/configuration_delivery_fixture.dart';

void main() {
  testWidgets('Placement host renders from bundle without fetching',
      (tester) async {
    final transport = _NoFetchTransport();
    final mosaic = Mosaic.configure(
      publicSdkKey: 'mos_public_sdk_test.secret',
      baseUrl: Uri.parse('https://mosaic.example'),
      purchaseProvider: MockMosaicPurchaseProvider(),
      transport: transport,
      cache: _EmptyCache(),
      bundledFallbackLoader: () async => deliveryFixtureSource(),
    );
    await tester.runAsync(mosaic.loadConfiguration);
    await tester.pumpWidget(
      MaterialApp(
        home: MosaicPlacementHost(
          mosaic: mosaic,
          placementKey: 'onboarding_complete',
          onResult: (_) {},
          externalUrlOpener: (_) async => true,
        ),
      ),
    );
    await tester.pump();

    expect(find.byKey(const ValueKey<String>('mosaic-view-details')),
        findsOneWidget);
    expect(transport.fetches, 0);
  });

  testWidgets('unknown Placement returns an explicit terminal result',
      (tester) async {
    MosaicPresentationResult? result;
    final mosaic = Mosaic.configure(
      publicSdkKey: 'mos_public_sdk_test.secret',
      baseUrl: Uri.parse('https://mosaic.example'),
      purchaseProvider: MockMosaicPurchaseProvider(),
      transport: _NoFetchTransport(),
      cache: _EmptyCache(),
      bundledFallbackLoader: () async => deliveryFixtureSource(),
    );
    await tester.runAsync(mosaic.loadConfiguration);
    await tester.pumpWidget(
      MaterialApp(
        home: MosaicPlacementHost(
          mosaic: mosaic,
          placementKey: 'missing_placement',
          onResult: (value) => result = value,
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
    expect(result, isA<MosaicPlacementUnavailablePresentationResult>());
  });

  testWidgets('fallback emits fallback use before the final paywall selection',
      (tester) async {
    final analyticsStorage = MosaicMemoryAnalyticsStorage();
    final mosaic = Mosaic.configure(
      publicSdkKey: 'public_fallback_sequence',
      baseUrl: Uri.parse('https://mosaic.example'),
      applicationVersion: '2.3.0',
      purchaseProvider: _UnavailableProductProvider(),
      transport: _NoFetchTransport(),
      cache: _EmptyCache(),
      identityStorage: MosaicMemoryIdentityStorage(),
      analyticsStorage: analyticsStorage,
      analyticsTransport: _AcceptAnalyticsTransport(),
      analyticsEnvironmentSettings:
          const MosaicAnalyticsEnvironmentSettings(collectionEnabled: true),
      bundledFallbackLoader: () async => _advancedDeliverySource(),
    );
    await tester.runAsync(mosaic.loadConfiguration);

    await tester.pumpWidget(MaterialApp(
      home: MosaicPlacementHost(
        mosaic: mosaic,
        placementKey: 'export_pdf',
        onResult: (_) {},
      ),
    ));
    await tester.pump();
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));
    await tester.pump();
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));

    final names = _queuedEventNames(analyticsStorage);
    expect(
      names.where((name) => name.startsWith('placement_')).toList(),
      <String>[
        'placement_requested',
        'placement_fallback_used',
        'placement_paywall_selected',
      ],
    );
    mosaic.dispose();
  });

  testWidgets('rollout no-paywall records the canonical assignment tuple',
      (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    var index = 0;
    String installationId;
    do {
      installationId = 'installation_rollout_${index++}';
    } while (mosaicRolloutBucket(
          projectId: 'project_alpha',
          environmentId: 'environment_production',
          placementId: 'placement_export_pdf',
          ruleId: 'rule_ios_rollout',
          assignmentKeyType: 'installation',
          assignmentKeyValue: installationId,
        ) <
        7000);
    final identityStorage = MosaicMemoryIdentityStorage()
      ..source = jsonEncode(<String, Object?>{
        'version': 1,
        'installationId': installationId,
        'userId': null,
        'generation': 1,
        'attributes': <String, Object?>{},
      });
    final analyticsStorage = MosaicMemoryAnalyticsStorage();
    final mosaic = Mosaic.configure(
      publicSdkKey: 'public_rollout_no_paywall',
      baseUrl: Uri.parse('https://mosaic.example'),
      applicationVersion: '2.3.0',
      purchaseProvider: MockMosaicPurchaseProvider(products: const [
        MosaicProduct(
          id: 'product_export_pro',
          title: 'Export Pro',
          localizedPrice: r'$9.99',
        ),
      ]),
      transport: _NoFetchTransport(),
      cache: _EmptyCache(),
      identityStorage: identityStorage,
      analyticsStorage: analyticsStorage,
      analyticsTransport: _AcceptAnalyticsTransport(),
      analyticsEnvironmentSettings:
          const MosaicAnalyticsEnvironmentSettings(collectionEnabled: true),
      bundledFallbackLoader: () async => _advancedDeliverySource(),
    );
    await tester.runAsync(mosaic.loadConfiguration);
    final decision = await tester.runAsync(() => mosaic.decidePlacement(
          'export_pdf',
          inputs: const MosaicPlacementDecisionInputs(
            platform: 'ios',
            applicationLocale: 'en-GB',
          ),
        ));
    expect(decision, isA<MosaicPlacementNoPaywall>());
    expect(
      (decision! as MosaicPlacementNoPaywall).decision.rolloutBucket,
      greaterThanOrEqualTo(7000),
    );
    await tester.pumpWidget(MaterialApp(
      home: MosaicPlacementHost(
        mosaic: mosaic,
        placementKey: 'export_pdf',
        requestedLocale: 'en-GB',
        onResult: (_) {},
      ),
    ));
    await tester.pump();
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));
    await tester.pump();
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));

    final saved =
        (jsonDecode(analyticsStorage.source!) as Map)['events'] as List;
    final event = saved
        .map((item) => ((item as Map)['event'] as Map))
        .singleWhere((item) => item['eventName'] == 'placement_no_paywall');
    expect(event['payload'], containsPair('assignmentKeyType', 'installation'));
    expect(event['payload'],
        containsPair('bucketingAlgorithm', 'sha256_length_prefixed_v1'));
    expect(
        (event['payload'] as Map)['rolloutBucket'], greaterThanOrEqualTo(7000));
    debugDefaultTargetPlatformOverride = null;
    mosaic.dispose();
  });
}

String _advancedDeliverySource() => File(
      '../../protocol/fixtures/configuration-delivery/v2/advanced-release.json',
    ).readAsStringSync();

List<String> _queuedEventNames(MosaicMemoryAnalyticsStorage storage) {
  final events = (jsonDecode(storage.source!) as Map)['events'] as List;
  return events
      .map((item) => (((item as Map)['event'] as Map)['eventName'] as String))
      .toList(growable: false);
}

final class _EmptyCache implements MosaicConfigurationCache {
  @override
  Future<MosaicConfigurationCacheEntry?> read(String namespace) async => null;

  @override
  Future<void> write(
    String namespace,
    MosaicConfigurationCacheEntry entry,
  ) async {}
}

final class _NoFetchTransport implements MosaicConfigurationTransport {
  var fetches = 0;

  @override
  Future<MosaicConfigurationResponse> fetch(
    MosaicConfigurationRequest request,
  ) async {
    fetches += 1;
    return const MosaicConfigurationFailedResponse(
      diagnosticCode: 'unexpected',
    );
  }
}

final class _AcceptAnalyticsTransport implements MosaicAnalyticsTransport {
  @override
  Future<MosaicAnalyticsIngestionResponse> send(
          MosaicAnalyticsBatch batch) async =>
      MosaicAnalyticsIngestionResponse(
        batchId: batch.batchId,
        receivedAt: batch.sentAt,
        results: batch.events
            .map((event) => MosaicAnalyticsIngestionResult(
                  eventId: event.eventId,
                  status: MosaicAnalyticsIngestionStatus.accepted,
                ))
            .toList(growable: false),
      );
}

final class _UnavailableProductProvider implements MosaicPurchaseProvider {
  @override
  Future<MosaicActiveEntitlementsResult> activeEntitlements() async =>
      MosaicActiveEntitlements(const <MosaicEntitlement>[]);

  @override
  Future<MosaicProductLoadResult> loadProducts(
          Iterable<String> productIds) async =>
      MosaicProductsLoaded(
        const <MosaicProduct>[],
        unavailableProductIds: productIds,
      );

  @override
  Future<MosaicPurchaseResult> purchase(String productId) async =>
      MosaicPurchaseProductUnavailable(productId: productId);

  @override
  Future<MosaicRestoreResult> restore() async => const MosaicNothingToRestore();
}
