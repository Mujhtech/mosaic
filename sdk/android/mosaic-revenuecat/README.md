# Mosaic RevenueCat adapter

This optional Android module connects Mosaic's provider-neutral commerce API
to RevenueCat Purchases Android 10.15.0. The core `:mosaic` module does not
depend on RevenueCat.

The adapter reports Provider ID `revenuecat` and Mosaic adapter version
`1.0.0`. That adapter version identifies Mosaic's provider contract
implementation; `10.15.0` is the independent RevenueCat Purchases Android
dependency version.

## Artifact coordinates

Mosaic does not publish this module to any registry. Its **development
coordinate**, produced by a local publication you run yourself, is:

```text
dev.mosaic.sdk:mosaic-revenuecat:0.1.0-dev.7
```

```bash
cd sdk/android
./gradlew :mosaic-revenuecat:publishReleasePublicationToMavenLocal
```

The module shares one artifact version with `:mosaic` and
`:mosaic-google-play`. See the installation section of `sdk/android/README.md`
for the two supported pre-1.0 install paths.

The host owns RevenueCat configuration and customer identity. Configure
RevenueCat exactly once using its documented Android setup, then pass the
existing `Purchases` instance:

```kotlin
val adapter = MosaicRevenueCatAdapter(Purchases.sharedInstance) {
    currentActivity
}
val purchaseProvider = MosaicConfiguredPurchaseProvider(adapter)
```

Do not put RevenueCat API keys or customer data in Mosaic Commerce
Configuration. The adapter accepts only verified provider product,
Offering/Package, and Entitlement identifiers. It does not initialize
RevenueCat, cache purchase tokens or customer information, or include those
values in diagnostics.

The adapter reports RevenueCat identity and Android-specific capabilities
through the custom-provider boundary. Its bounded diagnostics include a stable
Mosaic code, safe message, retryability, correlation ID, safe provider code,
and recovery action; provider failures return the same diagnostic object.

Direct-product mappings use the exact configured store product identifier.
Package mappings select the exact Offering identifier and exact Package
identifier; they never silently fall back to the current Offering or another
Package. Accepting a changed Commerce Configuration atomically invalidates
loaded RevenueCat Product and Package handles. An older concurrent load cannot
repopulate those handles, and purchase remains unavailable until the new exact
mappings are loaded.
