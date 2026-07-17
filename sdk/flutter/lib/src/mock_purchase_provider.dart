import 'commerce.dart';

enum MockMosaicPurchaseScenario {
  automatic,
  success,
  cancellation,
  failure,
  alreadyEntitled,
  productUnavailable,
}

enum MockMosaicRestoreScenario {
  automatic,
  success,
  alreadyEntitled,
  noPurchases,
  failure,
}

/// Deterministic provider for examples and tests; it never talks to a store.
final class MockMosaicPurchaseProvider implements MosaicPurchaseProvider {
  MockMosaicPurchaseProvider({
    Iterable<MosaicProduct> products = const <MosaicProduct>[],
    Iterable<MosaicEntitlement> activeEntitlements =
        const <MosaicEntitlement>[],
    Iterable<MosaicEntitlement> restoredEntitlements =
        const <MosaicEntitlement>[],
    this.purchaseScenario = MockMosaicPurchaseScenario.automatic,
    this.restoreScenario = MockMosaicRestoreScenario.automatic,
  })  : _products = {for (final product in products) product.id: product},
        _entitlements = activeEntitlements.toSet(),
        _restoredEntitlements = restoredEntitlements.toSet();

  final Map<String, MosaicProduct> _products;
  final Set<MosaicEntitlement> _entitlements;
  final Set<MosaicEntitlement> _restoredEntitlements;
  final MockMosaicPurchaseScenario purchaseScenario;
  final MockMosaicRestoreScenario restoreScenario;

  @override
  Future<MosaicProductLoadResult> loadProducts(
    Iterable<String> productIds,
  ) async {
    final requested = productIds.toList(growable: false);
    final missing = requested
        .where((productId) => !_products.containsKey(productId))
        .toList(growable: false);
    final available = requested
        .where((productId) => _products.containsKey(productId))
        .map((productId) => _products[productId]!)
        .toList(growable: false);
    if (available.isEmpty && missing.isNotEmpty) {
      return MosaicProductsUnavailable(
        missing,
        message: 'One or more mock products are unavailable.',
      );
    }
    return MosaicProductsLoaded(
      available,
      unavailableProductIds: missing,
    );
  }

  @override
  Future<MosaicPurchaseResult> purchase(String productId) async {
    if (!_products.containsKey(productId)) {
      return MosaicPurchaseProductUnavailable(productId: productId);
    }
    final entitlement = MosaicEntitlement(id: productId);
    switch (purchaseScenario) {
      case MockMosaicPurchaseScenario.cancellation:
        return MosaicPurchaseCancelled(productId: productId);
      case MockMosaicPurchaseScenario.failure:
        return MosaicPurchaseFailed(
          productId: productId,
          message: 'The deterministic mock purchase failed.',
        );
      case MockMosaicPurchaseScenario.productUnavailable:
        return MosaicPurchaseProductUnavailable(productId: productId);
      case MockMosaicPurchaseScenario.alreadyEntitled:
        _entitlements.add(entitlement);
        return MosaicAlreadyEntitled(productId: productId);
      case MockMosaicPurchaseScenario.automatic:
        if (_entitlements.contains(entitlement)) {
          return MosaicAlreadyEntitled(productId: productId);
        }
        break;
      case MockMosaicPurchaseScenario.success:
        break;
    }
    _entitlements.add(entitlement);
    return MosaicPurchased(
      productId: productId,
      transactionId: 'mock-$productId',
    );
  }

  @override
  Future<MosaicRestoreResult> restore() async {
    switch (restoreScenario) {
      case MockMosaicRestoreScenario.failure:
        return const MosaicRestoreFailed(
          message: 'The deterministic mock restore failed.',
        );
      case MockMosaicRestoreScenario.noPurchases:
        return const MosaicNothingToRestore();
      case MockMosaicRestoreScenario.success:
        _seedRestorableEntitlements();
        if (_entitlements.isEmpty) {
          return const MosaicNothingToRestore();
        }
        return MosaicRestored(_entitlements);
      case MockMosaicRestoreScenario.alreadyEntitled:
        _seedRestorableEntitlements();
        if (_entitlements.isEmpty) {
          return const MosaicNothingToRestore();
        }
        return MosaicRestoreAlreadyEntitled(_entitlements);
      case MockMosaicRestoreScenario.automatic:
        if (_entitlements.isEmpty) {
          return const MosaicNothingToRestore();
        }
        return MosaicRestored(_entitlements);
    }
  }

  void _seedRestorableEntitlements() {
    if (_restoredEntitlements.isNotEmpty) {
      _entitlements.addAll(_restoredEntitlements);
      return;
    }
    if (_entitlements.isEmpty && _products.isNotEmpty) {
      _entitlements.add(MosaicEntitlement(id: _products.keys.first));
    }
  }

  @override
  Future<MosaicActiveEntitlementsResult> activeEntitlements() async {
    return MosaicActiveEntitlements(_entitlements);
  }
}
