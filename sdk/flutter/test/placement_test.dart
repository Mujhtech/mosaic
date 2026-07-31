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
