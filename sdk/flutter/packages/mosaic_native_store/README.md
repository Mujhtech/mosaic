# Mosaic native-store bridge for Flutter

`mosaic_native_store` is the optional thin Flutter bridge to Mosaic's reusable
`MosaicStoreKit` and `mosaic-google-play` modules. It does not contain
StoreKit, BillingClient, receipt, token, validation, or entitlement business
logic, and it does not depend on a third-party purchase plugin.

The public Dart surface remains provider-neutral:

```dart
final mosaic = Mosaic.configure(
  // Hosted Delivery and sidecar settings omitted.
  purchaseProvider: localFallbackProvider,
  commerceProviderFactories: [
    MosaicStoreKitProviderFactory(),
    MosaicGooglePlayProviderFactory(),
  ],
);
```

Commerce Configuration v2 selects exactly one matching factory. The same
published Paywall and stable Mosaic Product IDs work on both platforms; exact
StoreKit Product IDs and Google Product/base-plan/offer selectors remain in
the immutable commerce sidecar.

## Native dependencies

- iOS 15 or newer: `MosaicStoreKit` `0.1.0-dev.5`, which depends exactly on
  `MosaicSDK` `0.1.0-dev.5`.
  The plugin has both `ios/Package.swift` and a CocoaPods podspec. SwiftPM uses
  the sibling package in this repository. CocoaPods resolves the versioned
  `MosaicSDK` and `MosaicStoreKit` pods.
- Android API 24 or newer: Maven artifact
  `dev.mosaic.sdk:mosaic-google-play:0.1.0-dev.6`. Monorepo applications may include
  the sibling `:mosaic` and `:mosaic-google-play` projects; the plugin detects
  the project and uses it instead of Maven.

Core `mosaic_sdk` has no dependency on this plugin. Applications that omit it
retain mock, custom-provider, and optional RevenueCat behavior.

## Lifecycle and safety

The closed channel codec version is `1`. It transports only Mosaic DTOs for
activation, exact mappings, Product metadata, normalized purchase/recovery/
access outcomes, diagnostics, invalidation, close, and asynchronous commerce
updates. Native objects, offer tokens, receipts, purchase tokens, signatures,
raw provider payloads, credentials, and customer identifiers never cross it.

Configuration replacement clears loaded native handles before installing the
new configuration digest as its revision. Dart and native routing both reject
stale revisions and deduplicate update IDs. A native transaction is accepted
only after Dart has idempotently admitted its matching update; the reusable
native module then owns StoreKit finish or Google acknowledgement.

Missing plugin registration, an unsupported platform, engine/Activity
unavailability, a detached engine, and malformed channel data normalize to a
safe Provider-unavailable or failed result. Entitlement failure is never
reported as an authoritative empty set.

## Checks

From this directory:

```bash
dart format --output=none --set-exit-if-changed .
flutter analyze
flutter test
```

Native StoreKit and Google Play behavior is tested in their owning modules.
This package's focused tests protect the bridge contract, missing-plugin
failure, exact mapping transport, metadata/outcome decoding, revision
filtering, and update deduplication.
