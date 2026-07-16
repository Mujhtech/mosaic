import 'commerce.dart';

/// Deterministic provider for examples and tests; it never talks to a store.
final class MockMosaicPurchaseProvider implements MosaicPurchaseProvider {
  MockMosaicPurchaseProvider({
    Iterable<MosaicProduct> products = const <MosaicProduct>[],
    Iterable<MosaicEntitlement> activeEntitlements =
        const <MosaicEntitlement>[],
  })  : _products = {for (final product in products) product.id: product},
        _entitlements = activeEntitlements.toSet();

  final Map<String, MosaicProduct> _products;
  final Set<MosaicEntitlement> _entitlements;

  @override
  Future<MosaicProductLoadResult> loadProducts(
    Iterable<String> productIds,
  ) async {
    final requested = productIds.toList(growable: false);
    final missing = requested
        .where((productId) => !_products.containsKey(productId))
        .toList(growable: false);
    if (missing.isNotEmpty) {
      return MosaicProductsUnavailable(
        missing,
        message: 'One or more mock products are unavailable.',
      );
    }
    return MosaicProductsLoaded(requested.map((id) => _products[id]!));
  }

  @override
  Future<MosaicPurchaseResult> purchase(String productId) async {
    if (!_products.containsKey(productId)) {
      return MosaicPurchaseProductUnavailable(productId: productId);
    }
    final entitlement = MosaicEntitlement(id: productId);
    if (_entitlements.contains(entitlement)) {
      return MosaicAlreadyEntitled(productId: productId);
    }
    _entitlements.add(entitlement);
    return MosaicPurchased(
      productId: productId,
      transactionId: 'mock-$productId',
    );
  }

  @override
  Future<MosaicRestoreResult> restore() async {
    if (_entitlements.isEmpty) {
      return const MosaicNothingToRestore();
    }
    return MosaicRestored(_entitlements);
  }

  @override
  Future<MosaicActiveEntitlementsResult> activeEntitlements() async {
    return MosaicActiveEntitlements(_entitlements);
  }
}
