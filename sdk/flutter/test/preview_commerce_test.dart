import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';

void main() {
  test('maps mock product references to provider product identifiers',
      () async {
    final provider = _provider();

    final result = await provider.loadProducts(<String>[
      'mosaic_pro_monthly',
      'mosaic_pro_yearly',
    ]);

    expect(result, isA<MosaicProductsLoaded>());
    final products = (result as MosaicProductsLoaded).products;
    expect(products.map((product) => product.id), <String>[
      'mosaic_pro_monthly',
      'mosaic_pro_yearly',
    ]);
    expect(products.first.localizedPrice, r'$9.99');
    expect(products.first.localizedPeriod, 'month');
    expect(products.last.localizedPeriod, 'year');
  });

  test('uses deterministic purchase, restore, and entitlement states',
      () async {
    final provider = _provider();

    final purchase = await provider.purchase('mosaic_pro_yearly');
    expect(purchase, isA<MosaicPurchased>());
    expect(
      (purchase as MosaicPurchased).transactionId,
      'preview-yearly-plan',
    );

    final entitlements = await provider.activeEntitlements();
    expect(
      (entitlements as MosaicActiveEntitlements)
          .entitlements
          .map((item) => item.id),
      <String>{'mosaic_pro_yearly'},
    );

    final restore = await provider.restore();
    expect(restore, isA<MosaicRestored>());
  });

  test('reports unavailable products without using real store data', () async {
    final state = _commerceState();
    final provider = MosaicPreviewPurchaseProvider(
      document: decodeCanonicalFixture(),
      state: MosaicPreviewMockCommerceState(
        products: <MosaicPreviewMockProduct>[
          const MosaicPreviewUnavailableProduct(
            productReferenceId: 'monthly-plan',
            reason: MosaicPreviewUnavailableReason.temporarilyUnavailable,
          ),
          state.products.last,
        ],
        purchaseOutcome: state.purchaseOutcome,
        restoreOutcome: state.restoreOutcome,
        entitlement: state.entitlement,
      ),
    );

    final load = await provider.loadProducts(<String>[
      'mosaic_pro_monthly',
      'mosaic_pro_yearly',
    ]);
    expect(load, isA<MosaicProductsLoaded>());
    expect(
      (load as MosaicProductsLoaded).unavailableProductIds,
      <String>['mosaic_pro_monthly'],
    );
    expect(
      await provider.purchase('mosaic_pro_monthly'),
      isA<MosaicPurchaseProductUnavailable>(),
    );
  });
}

MosaicPreviewPurchaseProvider _provider() => MosaicPreviewPurchaseProvider(
      document: decodeCanonicalFixture(),
      state: _commerceState(),
    );

MosaicPreviewMockCommerceState _commerceState() {
  final flow = jsonDecode(
    repositoryFile(
      'protocol/fixtures/local-preview/v0.1/session-flow.messages.json',
    ).readAsStringSync(),
  ) as List<Object?>;
  final message = flow[2]! as Map<String, Object?>;
  final decoded = const MosaicPreviewMessageCodec().decode(
    jsonEncode(message),
    expectedSessionId: 'session_phase2_demo',
  );
  return (decoded.message as MosaicPreviewCommerceStateChanged).state;
}
