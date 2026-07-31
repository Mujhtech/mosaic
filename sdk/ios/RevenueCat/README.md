# Mosaic RevenueCat adapter

`MosaicRevenueCat` is an optional Swift package pinned to RevenueCat
purchases-ios 5.81.2. Its Mosaic adapter identity is independently versioned
as `revenuecat` adapter `1.0.0`; the purchases-ios dependency version must not
be placed in Commerce Configuration's `adapterVersion`. Importing the
dependency-free `MosaicSDK` product does not download or link RevenueCat.

For repository development, add `sdk/ios/RevenueCat` as a local Swift package
and link `MosaicRevenueCat` to the host target. Configure RevenueCat before
creating the adapter:

```swift
import MosaicRevenueCat
import RevenueCat

Purchases.configure(withAPIKey: revenueCatPublicSDKKey)
let provider = try MosaicRevenueCatProvider()
```

The host owns `Purchases.configure`, App User ID choice, public SDK key
storage, proxy settings, and RevenueCat lifecycle. Mosaic does not read those
values, configure the singleton, or put them in remote configuration.

Install the adapter through the core router after the exact Commerce
Configuration sidecar is accepted:

```swift
if case .available(let configuration, _, _) = await commerce.status() {
  try await router.install(configuration: configuration, provider: provider)
}
```

`directProduct` loads by exact Product reference. `revenueCatPackage` loads the
exact Offering and Package and verifies its Store Product identifier. Purchase
reuses that native `StoreProduct` or `Package`; it never guesses from display
metadata. Installing a replacement Commerce Configuration invalidates every
loaded native handle. An in-flight older load is discarded, and purchase
remains unavailable until the adapter reloads the replacement's exact
mappings.

Cancellation, payment-pending, already-purchased, Product-unavailable,
provider-unavailable, restore, and active Entitlement results are normalized.
An existing Entitlement found during restore is `.restored`. Active
Entitlement lookup returns `.available`, `.unknown`, `.providerUnavailable`,
or `.failed`; lookup failure never reports an inactive customer.
RevenueCat 5.81.2 does not expose one reliable ordinary deferred result, so the
adapter reports that capability as unsupported and does not invent one. The
adapter reports its complete runtime capability profile, and the router checks
the sidecar-declared subset before accepting mappings. Diagnostics contain
stable safe values only, are correlated per failed operation, and include the
safe RevenueCat error code plus Product and recovery context where applicable.

Run:

```bash
swift test --package-path sdk/ios/RevenueCat
```
