# MosaicStoreKit

`MosaicStoreKit` is Mosaic's optional first-party StoreKit 2 commerce adapter.
It depends only on `MosaicSDK` and the operating-system StoreKit framework, and
keeps every StoreKit Product and Transaction value private to the module.

Add both local packages to an Xcode target, then install the StoreKit provider
only after Mosaic accepts a Commerce Configuration v2 sidecar:

```swift
import MosaicSDK
import MosaicStoreKit

actor UpdateAcceptor: MosaicCommerceUpdateAcceptor {
  func accept(
    _ update: MosaicCommerceUpdate
  ) async throws -> MosaicCommerceUpdateAcceptanceDisposition {
    // Persist update.id idempotently before authorizing finalization.
    .accepted
  }
}

let provider = try MosaicStoreKitProvider(acceptor: UpdateAcceptor())
let router = MosaicCommerceProviderRouter()
try await router.install(configuration: configuration, provider: provider)
```

For a local CocoaPods checkout, declare both sibling pods:

```ruby
pod "MosaicSDK", :path => "../mosaic/sdk/ios"
pod "MosaicStoreKit", :path => "../mosaic/sdk/ios/StoreKit"
```

Published releases use the same version for both pods. `MosaicStoreKit`
depends on that exact `MosaicSDK` version and includes only its own adapter
sources; StoreKit remains an operating-system framework.

The router installs exact StoreKit Product mappings and immutable
Product-to-Entitlement grants before loading. Verified transactions cross the
host acceptor and the adapter's atomic acceptance store before
`Transaction.finish()`. Unverified or unmapped transactions remain unfinished.
Purchase-return, `Transaction.updates`, and `Transaction.unfinished` paths share
the same transaction-ID deduplication.

`restore()` is the only path that invokes `AppStore.sync()`. Normal foreground
refreshes use `Transaction.currentEntitlements` and never show the system sync
prompt.

## Testing

Run the focused deterministic adapter suite:

```bash
cd sdk/ios/StoreKit
swift test
```

The native example includes `MosaicExample.storekit`. Select its shared
`MosaicExample` scheme, set `MOSAIC_COMMERCE_PROVIDER=storekit`, and use the
StoreKit transaction manager to exercise success, cancellation, Ask to Buy,
interrupted delivery, current Entitlements, and user-initiated synchronization.
Real Sandbox testing still requires an App Store Connect application, matching
Product identifiers, agreements, signing, and a Sandbox Apple Account.
