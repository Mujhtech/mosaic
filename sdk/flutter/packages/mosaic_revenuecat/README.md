# Mosaic RevenueCat adapter for Flutter

`mosaic_revenuecat` is the optional RevenueCat implementation of Mosaic's
provider-neutral Flutter commerce interface. Mosaic Core does not depend on
RevenueCat.

## Requirements

- Dart 3.4 or newer
- Flutter 3.22 or newer
- `purchases_flutter 10.4.3` (pinned)

## Host-owned initialization

The host application must configure RevenueCat exactly once with its
platform-specific public SDK key and must own app-user identity, login, and
logout:

```dart
await Purchases.configure(PurchasesConfiguration(revenueCatPublicSdkKey));

final mosaic = Mosaic.configure(
  publicSdkKey: mosaicPublicSdkKey,
  baseUrl: Uri.parse('https://mosaic.example.com'),
  applicationId: 'application_ios',
  storePlatform: MosaicStorePlatform.ios,
  purchaseProvider: localFallbackProvider,
  commerceConfigurationLoader: fetchReleaseSidecar,
  commerceProviderFactories: const [
    MosaicRevenueCatProviderFactory(),
  ],
);
```

The adapter deliberately exposes no RevenueCat configure, key, login, logout,
or app-user API. Do not put RevenueCat public/server keys or customer identity
in Commerce Configuration.

## Mapping behavior

- `directProduct` calls RevenueCat `getProducts` with the Product's exact
  accepted identifier and correct subscription/non-subscription category.
- `revenueCatPackage` resolves the exact Offering and Package, then verifies
  that the Package's Store Product equals the accepted provider Product
  reference.
- Purchase always uses the private `StoreProduct` or `Package` handle returned
  by that load. Display name, price, and period are never used for matching.
- Restore and active Entitlement lookup translate only explicit accepted
  RevenueCat Entitlement identifier mappings back to Mosaic Entitlement keys.

Cancellation, payment pending, already purchased, Product unavailable,
Provider unavailable, and failure are distinct results. RevenueCat Flutter
does not expose a reliable ordinary-purchase deferred result, so the adapter
does not invent one. Purchases are never retried automatically. Diagnostics
contain stable safe codes only; raw RevenueCat messages and customer data are
not retained or emitted.
