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
}
