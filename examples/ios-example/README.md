# Mosaic iOS local preview and hosted delivery example

This native SwiftUI application has separate Local Studio and Hosted modes.
Local Studio renders Protocol 0.2 revisions immediately without an account.
Hosted mode prefers Configuration Delivery v3 (with Delivery v2/v1 compatibility)
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
- evaluates scheduled A/B assignments and mutual-exclusion groups with stable
  install/user bucketing, then falls back to the normal Placement when a selected
  variant cannot load its exact Products or provider capabilities
- exposes safe experiment diagnostics from the hosted Analytics menu without
  exposing identity material or QA selector tokens
- refreshes and reauthorizes a selection when the app returns to the foreground
  so an emergency-stop release suppresses stale exposure
- terminates intentional `no_paywall` without an error surface

The footer shows the latest normalized paywall interaction or terminal result.
The example uses `MosaicImageResolver.missing` intentionally so the fixture's
declared same-geometry image placeholder demonstrates asset fallback.

## Authoritative customer entitlements (Phase 9C)

The hosted tab has an **Authoritative entitlements** panel that exercises the
customer-access surface without needing a real backend. With a Phase 9C backend,
the panel also shows the replayed server authority epoch, authority kind,
transition state, and minimum supported app version. `authority unknown` is an
explicit unavailable state, never an inactive Entitlement.

The customer picker drives a mock token provider (`ExampleCustomerTokenProvider`)
with four states, chosen to cover the cases that are easy to get wrong:

| Selection | What the SDK sees | What to look for |
| --- | --- | --- |
| Signed out | `.signedOut` from the provider | `signedOut`, not "no access" |
| Customer A / B | a fake token per customer | switching clears the previous customer's cache before any read |
| Backend failing | `.unavailable` from the provider | `unavailable · tokenProviderFailed` — **never** `inactive` |

The readout shows the accepted snapshot version, the cache state (including
`STALE within grace`, which a real UI must surface), and the `pro` entry state.
**Restore & sync** lists each stage so the two axes of a restore are visible:
what StoreKit did, and whether an accepted snapshot actually reflects it.

Authority changes do not uninstall or replace the selected commerce provider.
Once Mosaic is authoritative, hosted Placement targeting reads Mosaic access
only; provider-observed Entitlements remain available for diagnostics and are
not unioned into targeting. A pending or stabilizing authority transition gets
one urgent, coalesced sync before normal hosted Configuration refresh. The
example does not register background tasks or retry a purchase automatically.

In a real app the token provider calls your own authenticated backend, which
mints a Customer Access Token with your Mosaic `secret_server` key. Mosaic
Billing has no anonymous mode.

Simulator note: StoreKit Testing in Xcode produces transactions with no App
Store record, so the SDK deliberately never observes them. Restore stages will
show the provider result and then `validation pending` against a local API,
which is the correct behaviour rather than a failure.

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
last-known-valid cache without a presentation-time request. Use Identify,
Reset, and **Analytics → Experiment diagnostics** to inspect assignment-policy
changes and safe replay counts. Clearing app data rotates the
app-install identity and demonstrates the bundled Delivery v1 fallback.

To exercise a QA override in a development or staging Environment, pass its
short-lived selector token through the host-owned `MosaicDecisionContext`
`qaOverrideTokens` field. The SDK hashes it before comparison and never persists
or reports the token. Production releases reject QA overrides atomically.

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

## Transaction observations

Off by default. Add to the Xcode scheme to opt in:

```text
MOSAIC_TRANSACTION_OBSERVATIONS=1
```

The example then passes `transactionObservations: .enabled` to
`Mosaic.configure` and attaches `mosaic.transactionObservationSink()` to the
StoreKit provider after configuration. Without the variable the sink is `nil`,
no queue is created, and nothing is sent.

Use the **Observations** menu for queue diagnostics and an immediate flush. A
Transaction Observation is a trigger for server-side validation, never proof:
the status line never reports a transaction as validated, and the purchase
result is identical whether observations are on or off.

Xcode StoreKit testing produces transactions with no App Store record, so the
SDK deliberately enqueues nothing for them. **Observations → Queue development
sample** therefore queues one synthetic observation carrying the canonical
fixture reference so the queue, restart survival, and flush behaviour can be
demonstrated in the Simulator. Real sandbox and production purchases are
observed automatically with no host code.

The deterministic SDK equivalents are:

```bash
cd sdk/ios
swift test --filter TransactionObservationTests
cd StoreKit && swift test --filter MosaicStoreKitProviderTests
```

## Analytics offline/restart demonstration

Collection is on by default, matching the SDK default, so no environment
variable is needed to demonstrate it. Set `MOSAIC_ANALYTICS_ENABLED=0` to
demonstrate a host that explicitly opts out. Ingestion is still gated
server-side by the Environment's collection setting, and a real host
application is responsible for whatever end-user consent it owes. Local Studio
and bundled fallback paywalls never emit hosted analytics.

For a reproducible non-production queue demonstration:

1. Run the local API with an Application-bound development public SDK key and
   enable Analytics for that Environment.
2. Launch Hosted mode, stop the API, and use
   **Analytics → Queue demo events**. The status reports persistent queue depth.
3. Terminate and relaunch without deleting app data. The queue is restored from
   backup-excluded Application Support storage.
4. Restart the API and use **Analytics → Flush now**. Accepted, duplicate, and
   permanently rejected entries are removed; only retryable entries remain.

The deterministic SDK equivalent, including reconstruction and a mixed
partial acknowledgement, is:

```bash
cd sdk/ios
swift test --filter AnalyticsTests/testPersistentQueueReconstructionAndExactPartialAcknowledgement
```

## Canonical fixture ownership

The canonical fixture at `protocol/fixtures/v0.2/complete-paywall.json` remains
the repository contract example. Local Preview does not render it when Studio
is unavailable; the example shows a clear loading or connection state instead.

## Build

The example depends on the optional RevenueCat adapter, which depends on
`purchases-ios` from GitHub. **A cold build needs network access**, and
`xcodebuild`'s own package resolution is slow enough to exceed ten minutes on a
cold cache. Seed the cache with SwiftPM first, then point `xcodebuild` at it.

From the repository root:

```bash
set -o pipefail

# 1. Resolve once with SwiftPM, which is far faster than xcodebuild's resolver.
swift package --package-path sdk/ios/RevenueCat resolve

# 2. Build the example against the seeded clone directory.
xcodebuild -project examples/ios-example/MosaicExample.xcodeproj \
  -scheme MosaicExample \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath examples/ios-example/.build/DerivedData \
  -clonedSourcePackagesDirPath sdk/ios/RevenueCat/.build/checkouts \
  CODE_SIGNING_ALLOWED=NO build
```

`set -o pipefail` is required whenever this command is piped into `tail`,
`grep`, or a formatter. Without it a failed build reports success.

Omitting `-clonedSourcePackagesDirPath` still works; it is only an
accelerator. If resolution appears to hang, it is almost always downloading
`purchases-ios`, not stuck.

## Simulator tests

Choose an available simulator ID from `xcrun simctl list devices available`,
then run the native golden, accessibility-size, and preview-status tests:

```bash
set -o pipefail
xcodebuild -project examples/ios-example/MosaicExample.xcodeproj \
  -scheme MosaicExample \
  -destination 'platform=iOS Simulator,id=<SIMULATOR_ID>' \
  -derivedDataPath examples/ios-example/.build/DerivedData \
  -clonedSourcePackagesDirPath sdk/ios/RevenueCat/.build/checkouts \
  test
```

One reviewed 390-by-844 golden covers the canonical Protocol 0.2 RC4 paywall.
The Simulator suite also verifies native Sheet presentation, deterministic
video fallback diagnostics, horizontal Product Card placement, RTL at
accessibility text sizes, and preview status.

Baselines are recorded at scale 1 into a fixed frame, so they do not depend on
the Simulator device, but they do depend on the runtime's native control
rendering. The current baseline was recorded on **Xcode 26.5 with the iOS 26.5
Simulator runtime**; run golden comparisons on that runtime. Re-record only
after visually reviewing the rendered output:

```bash
set -o pipefail
TEST_RUNNER_MOSAIC_RECORD_SNAPSHOTS=1 xcodebuild \
  -project examples/ios-example/MosaicExample.xcodeproj \
  -scheme MosaicExample \
  -destination 'platform=iOS Simulator,id=<SIMULATOR_ID>' \
  -derivedDataPath examples/ios-example/.build/DerivedData \
  -clonedSourcePackagesDirPath sdk/ios/RevenueCat/.build/checkouts \
  -only-testing:MosaicExampleTests/SwiftUISnapshotTests/testProtocolV02CompleteFixtureMatchesDeterministicSwiftUIGolden \
  test
```

The `TEST_RUNNER_` prefix is required: `xcodebuild` forwards only prefixed
variables into the test runner process. Setting `MOSAIC_RECORD_SNAPSHOTS=1` in
the shell alone has no effect. Always limit recording with `-only-testing:` to
the intended golden method.
