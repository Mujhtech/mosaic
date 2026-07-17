import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

void main() {
  test('mock provider exposes explicit purchase and entitlement results',
      () async {
    final provider = MockMosaicPurchaseProvider(
      products: const <MosaicProduct>[
        MosaicProduct(
          id: 'mosaic_pro_yearly',
          title: 'Mosaic Pro Yearly',
          localizedPrice: r'$49.99',
          localizedPeriod: 'year',
        ),
      ],
    );

    final load = await provider.loadProducts(<String>['mosaic_pro_yearly']);
    expect(load, isA<MosaicProductsLoaded>());

    final purchase = await provider.purchase('mosaic_pro_yearly');
    expect(purchase, isA<MosaicPurchased>());

    final repeatPurchase = await provider.purchase('mosaic_pro_yearly');
    expect(repeatPurchase, isA<MosaicAlreadyEntitled>());

    final restore = await provider.restore();
    expect(restore, isA<MosaicRestored>());

    final entitlements = await provider.activeEntitlements();
    expect(entitlements, isA<MosaicActiveEntitlements>());
  });

  test('mock provider reports unavailable products without booleans', () async {
    final provider = MockMosaicPurchaseProvider();

    expect(
      await provider.loadProducts(<String>['missing']),
      isA<MosaicProductsUnavailable>(),
    );
    expect(
      await provider.purchase('missing'),
      isA<MosaicPurchaseProductUnavailable>(),
    );
    expect(await provider.restore(), isA<MosaicNothingToRestore>());
  });

  test('mock provider preserves partial availability in source order',
      () async {
    final provider = MockMosaicPurchaseProvider(
      products: const <MosaicProduct>[
        MosaicProduct(
          id: 'available',
          title: 'Available',
          localizedPrice: r'$1.99',
          localizedPeriod: 'month',
        ),
      ],
    );

    final result = await provider.loadProducts(<String>[
      'missing',
      'available',
    ]);

    expect(result, isA<MosaicProductsLoaded>());
    final loaded = result as MosaicProductsLoaded;
    expect(loaded.products.map((product) => product.id), <String>['available']);
    expect(loaded.unavailableProductIds, <String>['missing']);
    expect(loaded.products.single.localizedPeriod, 'month');
  });

  test('mock provider deterministically exposes every purchase scenario',
      () async {
    const product = MosaicProduct(
      id: 'product',
      title: 'Product',
      localizedPrice: r'$1.99',
    );
    final expectations = <MockMosaicPurchaseScenario, Type>{
      MockMosaicPurchaseScenario.success: MosaicPurchased,
      MockMosaicPurchaseScenario.cancellation: MosaicPurchaseCancelled,
      MockMosaicPurchaseScenario.failure: MosaicPurchaseFailed,
      MockMosaicPurchaseScenario.alreadyEntitled: MosaicAlreadyEntitled,
      MockMosaicPurchaseScenario.productUnavailable:
          MosaicPurchaseProductUnavailable,
    };

    for (final entry in expectations.entries) {
      final provider = MockMosaicPurchaseProvider(
        products: const <MosaicProduct>[product],
        purchaseScenario: entry.key,
      );
      expect((await provider.purchase('product')).runtimeType, entry.value);
    }
  });

  test('mock provider deterministically exposes every restore scenario',
      () async {
    const product = MosaicProduct(
      id: 'product',
      title: 'Product',
      localizedPrice: r'$1.99',
    );
    final expectations = <MockMosaicRestoreScenario, Type>{
      MockMosaicRestoreScenario.success: MosaicRestored,
      MockMosaicRestoreScenario.alreadyEntitled: MosaicRestoreAlreadyEntitled,
      MockMosaicRestoreScenario.noPurchases: MosaicNothingToRestore,
      MockMosaicRestoreScenario.failure: MosaicRestoreFailed,
    };

    for (final entry in expectations.entries) {
      final provider = MockMosaicPurchaseProvider(
        products: const <MosaicProduct>[product],
        restoreScenario: entry.key,
      );
      expect((await provider.restore()).runtimeType, entry.value);
    }
  });
}
