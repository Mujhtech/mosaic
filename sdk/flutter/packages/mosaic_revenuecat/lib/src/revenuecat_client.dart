import 'package:purchases_flutter/purchases_flutter.dart' as revenuecat;

/// Narrow injectable boundary over the official RevenueCat Flutter SDK.
///
/// There is deliberately no configure, login, logout, key, or app-user API.
/// The host application owns RevenueCat initialization and customer identity.
abstract interface class MosaicRevenueCatClient {
  Future<List<revenuecat.StoreProduct>> getProducts(
    List<String> productIdentifiers, {
    required revenuecat.ProductCategory productCategory,
  });

  Future<revenuecat.Offerings> getOfferings();

  Future<revenuecat.PurchaseResult> purchase(
    revenuecat.PurchaseParams parameters,
  );

  Future<revenuecat.CustomerInfo> restorePurchases();

  Future<revenuecat.CustomerInfo> getCustomerInfo();
}

final class DefaultMosaicRevenueCatClient implements MosaicRevenueCatClient {
  const DefaultMosaicRevenueCatClient();

  @override
  Future<List<revenuecat.StoreProduct>> getProducts(
    List<String> productIdentifiers, {
    required revenuecat.ProductCategory productCategory,
  }) =>
      revenuecat.Purchases.getProducts(
        productIdentifiers,
        productCategory: productCategory,
      );

  @override
  Future<revenuecat.Offerings> getOfferings() =>
      revenuecat.Purchases.getOfferings();

  @override
  Future<revenuecat.PurchaseResult> purchase(
    revenuecat.PurchaseParams parameters,
  ) =>
      revenuecat.Purchases.purchase(parameters);

  @override
  Future<revenuecat.CustomerInfo> restorePurchases() =>
      revenuecat.Purchases.restorePurchases();

  @override
  Future<revenuecat.CustomerInfo> getCustomerInfo() =>
      revenuecat.Purchases.getCustomerInfo();
}
