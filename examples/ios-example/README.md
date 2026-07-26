# Mosaic iOS local preview and hosted delivery example

This native SwiftUI application has separate Local Studio and Hosted modes.
Local Studio renders Protocol 0.2 revisions immediately without an account.
Hosted mode prefers Configuration Delivery v2 (with Delivery v1 compatibility)
using an Environment-scoped public SDK key, evaluates a Placement locally,
caches the last valid release, and falls
back safely when delivery is unavailable. Local Studio remains deterministic.
Hosted mode uses mock commerce unless RevenueCat or StoreKit is selected. Both
optional adapters fetch the release-bound Commerce Configuration sidecar,
install exact Product mappings, and load native Products without changing the
Paywall document.

Open `MosaicExample.xcodeproj`, select the `MosaicExample` scheme, and run on an
iOS 15-or-newer simulator. With Studio running at the default local endpoint,
the app:

- connects using `mosaic.local-preview.v0.2`
- reports its renderer, application, device, protocol, and preview capabilities
- rerenders valid document revisions without rebuilding the app
- shows connected, reconnecting, and disconnected states
- shows invalid-document, unsupported-component, and render diagnostics with a
  recovery instruction
- applies Studio locale, RTL, long-copy, text-scale, mock-product, purchase,
  restore, and entitlement states
- demonstrates Protocol 0.2 RC4 native Screen/Sheet navigation, unified
  content buttons, direction-relative icons, document design tokens,
  gradient/media backgrounds, shadows, two-axis sizing, a system-browser HTTPS
  action, and authored Product Cards with nested and overlay Product Badges
- keeps the last accepted paywall visible when a later revision is unsafe
- validates complete hosted releases before atomically replacing the cache
- rejects stale or cross-Environment hosted releases
- shows the matched Rule or fallback in its safe status line
- demonstrates identify and user-identity reset while retaining installation assignment
- terminates intentional `no_paywall` without an error surface

The footer shows the latest normalized paywall interaction or terminal result.
The example uses `MosaicImageResolver.missing` intentionally so the fixture's
declared same-geometry image placeholder demonstrates asset fallback.

## Local endpoint configuration

The simulator defaults to:

```text
MOSAIC_PREVIEW_ENDPOINT=ws://127.0.0.1:4317/preview
MOSAIC_PREVIEW_SESSION_ID=session_local_01
```

These environment variables are optional. Add them to the Xcode scheme only
when Studio uses a different local session. The Phase 2 Studio relay binds to
loopback only, so the live Studio workflow is supported in the iOS Simulator.
A physical device can run the bundled fallback but cannot connect to the
current relay. The SDK rejects public hosts.

## Hosted configuration

Add these environment variables to the Xcode scheme, select Hosted in the
example, and use Refresh:

```text
MOSAIC_PUBLIC_SDK_KEY=<environment public SDK key>
MOSAIC_SDK_BASE_URL=http://127.0.0.1:8080
MOSAIC_PLACEMENT=export_pdf
MOSAIC_APPLICATION_ID=<Mosaic Application ID>
REVENUECAT_PUBLIC_SDK_KEY=<platform public SDK key>
```

The base URL is the configuration API origin. Releases containing hosted
Assets use the immutable HTTPS Asset origin configured by the API. Simulator
or device testing against the local Compose edge therefore requires trusting
its development certificate; production Asset URLs must use a publicly trusted
HTTPS origin. Stop the API and restart the app to verify the same Rule from the
last-known-valid cache without a presentation-time request. Use Identify and
Reset to inspect assignment-policy changes. Clearing app data rotates the
app-install identity and demonstrates the bundled Delivery v1 fallback.

To exercise StoreKit Configuration instead, omit the RevenueCat key and add:

```text
MOSAIC_COMMERCE_PROVIDER=storekit
```

The shared Xcode scheme selects `MosaicExample.storekit`, which contains the
exact `com.example.pro.monthly` subscription and
`com.example.pro.lifetime` non-consumable. The backend's active iOS assignment
and Product mappings must use those same identifiers. Use Xcode's StoreKit
transaction manager for deterministic success, cancellation, Ask to Buy,
interrupted transaction, current Entitlement, and restore testing.

Omit the provider selection and RevenueCat key to use the app-owned
deterministic provider without changing the Paywall document. RevenueCat
remains optional. Its public SDK key
is read only by the host app and passed directly to RevenueCat; Mosaic remote
configuration and diagnostics never contain it.

## Canonical fixture ownership

The canonical fixture at `protocol/fixtures/v0.2/complete-paywall.json` remains
the repository contract example. Local Preview does not render it when Studio
is unavailable; the example shows a clear loading or connection state instead.

## Build

From the repository root:

```bash
xcodebuild -project examples/ios-example/MosaicExample.xcodeproj \
  -scheme MosaicExample \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath examples/ios-example/.build/DerivedData \
  CODE_SIGNING_ALLOWED=NO build
```

## Simulator tests

Choose an available simulator ID from `xcrun simctl list devices available`,
then run the native golden, accessibility-size, and preview-status tests:

```bash
xcodebuild -project examples/ios-example/MosaicExample.xcodeproj \
  -scheme MosaicExample \
  -destination 'platform=iOS Simulator,id=<SIMULATOR_ID>' \
  -derivedDataPath examples/ios-example/.build/DerivedData \
  test
```

The reviewed 390-by-844 goldens cover the current Protocol 0.2 path
and the Protocol 0.2 RC4 renderer. The Simulator suite also verifies native
Sheet presentation, deterministic video fallback diagnostics, and horizontal
Product Card placement. The current baselines use iOS 26.5 native
control rendering; run golden comparisons on that Simulator runtime. Set
`MOSAIC_RECORD_SNAPSHOTS=1` in the scheme only after visual review, and limit
recording to the intended `SwiftUISnapshotTests` golden method.
