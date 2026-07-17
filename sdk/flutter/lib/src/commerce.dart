/// Provider-neutral product details resolved at runtime.
final class MosaicProduct {
  const MosaicProduct({
    required this.id,
    required this.title,
    required this.localizedPrice,
    this.localizedPeriod,
  });

  /// Opaque provider product identifier requested by the protocol document.
  final String id;
  final String title;
  final String localizedPrice;

  /// Runtime-only localized period, such as "month" or "year".
  final String? localizedPeriod;
}

/// Provider-neutral entitlement returned by a purchase adapter.
final class MosaicEntitlement {
  const MosaicEntitlement({required this.id});

  final String id;

  @override
  bool operator ==(Object other) =>
      identical(this, other) || other is MosaicEntitlement && id == other.id;

  @override
  int get hashCode => id.hashCode;
}

sealed class MosaicProductLoadResult {
  const MosaicProductLoadResult();
}

final class MosaicProductsLoaded extends MosaicProductLoadResult {
  MosaicProductsLoaded(
    Iterable<MosaicProduct> products, {
    Iterable<String> unavailableProductIds = const <String>[],
  })  : products = List.unmodifiable(products),
        unavailableProductIds = List.unmodifiable(unavailableProductIds);

  final List<MosaicProduct> products;

  /// Requested provider identifiers omitted because they were unavailable.
  final List<String> unavailableProductIds;
}

final class MosaicProductsUnavailable extends MosaicProductLoadResult {
  MosaicProductsUnavailable(Iterable<String> productIds, {this.message})
      : productIds = List.unmodifiable(productIds);

  final List<String> productIds;
  final String? message;
}

sealed class MosaicPurchaseResult {
  const MosaicPurchaseResult();
}

final class MosaicPurchased extends MosaicPurchaseResult {
  const MosaicPurchased({required this.productId, required this.transactionId});

  final String productId;
  final String transactionId;
}

final class MosaicAlreadyEntitled extends MosaicPurchaseResult {
  const MosaicAlreadyEntitled({required this.productId});

  final String productId;
}

final class MosaicPurchaseCancelled extends MosaicPurchaseResult {
  const MosaicPurchaseCancelled({required this.productId});

  final String productId;
}

final class MosaicPurchaseProductUnavailable extends MosaicPurchaseResult {
  const MosaicPurchaseProductUnavailable({required this.productId});

  final String productId;
}

final class MosaicPurchaseFailed extends MosaicPurchaseResult {
  const MosaicPurchaseFailed({required this.productId, required this.message});

  final String productId;
  final String message;
}

sealed class MosaicRestoreResult {
  const MosaicRestoreResult();
}

final class MosaicRestored extends MosaicRestoreResult {
  MosaicRestored(Iterable<MosaicEntitlement> entitlements)
      : entitlements = Set.unmodifiable(entitlements);

  final Set<MosaicEntitlement> entitlements;
}

final class MosaicRestoreAlreadyEntitled extends MosaicRestoreResult {
  MosaicRestoreAlreadyEntitled(Iterable<MosaicEntitlement> entitlements)
      : entitlements = Set.unmodifiable(entitlements);

  final Set<MosaicEntitlement> entitlements;
}

final class MosaicNothingToRestore extends MosaicRestoreResult {
  const MosaicNothingToRestore();
}

final class MosaicRestoreFailed extends MosaicRestoreResult {
  const MosaicRestoreFailed({required this.message});

  final String message;
}

sealed class MosaicActiveEntitlementsResult {
  const MosaicActiveEntitlementsResult();
}

final class MosaicActiveEntitlements extends MosaicActiveEntitlementsResult {
  MosaicActiveEntitlements(Iterable<MosaicEntitlement> entitlements)
      : entitlements = Set.unmodifiable(entitlements);

  final Set<MosaicEntitlement> entitlements;
}

final class MosaicEntitlementsUnavailable
    extends MosaicActiveEntitlementsResult {
  const MosaicEntitlementsUnavailable({required this.message});

  final String message;
}

/// Contract implemented by RevenueCat, store-native, or app-owned adapters.
abstract interface class MosaicPurchaseProvider {
  Future<MosaicProductLoadResult> loadProducts(Iterable<String> productIds);

  Future<MosaicPurchaseResult> purchase(String productId);

  Future<MosaicRestoreResult> restore();

  Future<MosaicActiveEntitlementsResult> activeEntitlements();
}
