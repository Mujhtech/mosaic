# Mosaic Apple SDK — native rendering and local Placement decisions

The SDK strictly decodes Mosaic Protocol 0.2 and renders it with native
SwiftUI, and can receive validated draft and mock-commerce revisions from a
local Mosaic Studio session over WebSockets. It preserves the Phase 1 bundled
fallback and adds hosted Configuration Delivery v1–v3 plus the provider-neutral
Commerce Configuration v1/v2 boundary. The core package remains free of StoreKit
and RevenueCat dependencies; the optional RevenueCat adapter is a separate
package under `RevenueCat/`.

## Experiments and Analytics Event v2

Configuration Delivery v3 atomically carries Experiment Assignment v1. The
SDK strictly validates compatibility, schedules, allocation ranges,
control/variant references, mutual-exclusion groups, and QA overrides before a
release can replace the last-known-valid cache. Assignment and group bucketing
use the canonical SHA-256 length-prefixed algorithms. A normal Placement
decision is always evaluated first; an eligible treatment may replace only its
exact control Paywall and falls back to that normal result when Products or
provider capabilities are unavailable.

Assignments use trusted server time and fail closed when a schedule cannot be
evaluated safely. Backup-excluded replay records contain only one-way subject
digests and bounded safe identifiers. They are capped at 256 records and expire
within 180 days of completion. Identity resets clear only the corresponding
user- or installation-bound records.

```swift
let capabilities = MosaicExperimentCapabilityReport.current
let diagnostics = await mosaic.experimentDiagnostics()
print(capabilities.assignmentContractVersions, diagnostics.activeAssignmentCount)
```

`MosaicPlacementPaywall` reauthorizes a selected experiment against the current
release, identity generation, schedule, and group immediately before the view
is acknowledged as presented. It refreshes on foreground activation, records a
statistical exposure only after the selected Paywall is on screen, and never
counts QA override presentations as statistical exposure.

Hosted clients write Analytics Event v2 for experiment-aware releases while
continuing to read persisted v1 queue entries. Experiment attribution is an
all-or-none immutable tuple and is attached only to experiment lifecycle,
Product selection, and purchase lifecycle events—not ordinary Placement or
Paywall lifecycle events.

## Analytics identity and privacy

Hosted clients implement the closed Analytics Event v1/v2 contracts with immutable
event-time identity, session, correlation, and attribution. Collection starts
disabled. The Environment setting and host override must both permit it:

```swift
await mosaic.setAnalyticsCollection(environmentEnabled: true, hostEnabled: true)
let diagnostics = await mosaic.analyticsDiagnostics()
let result = await mosaic.flushAnalytics()
```

Turning either setting off cancels delivery and atomically clears unsent
events. Re-enabling starts a new session and does not reconstruct missed
observations. Sessions persist across reconstruction within 30 minutes.
`resetIdentity()` retains installation identity; `resetInstallationIdentity()`
rotates it and clears user state. Queued historical events are never rewritten.

The backup-excluded Application Support queue is scoped by endpoint and SDK
key and bounded to 1,000 events/2 MiB, 32 KiB per event, 50 events/512 KiB per
send, seven-day expiry, and ten attempts. It uses full-jitter exponential retry
from one second through five minutes. Overflow evicts expired and lower-value
events before purchase/restore outcomes while always honoring hard bounds.
Accepted, duplicate, and permanent partial results are removed; retryable
events remain. A malformed acknowledgement retains the complete sent batch.

Foreground/background flush is coalesced and best effort;
`flushAnalytics()` is deterministic. Analytics never changes Placement,
rendering, Product, purchase, or restore outcomes. The SDK never originates
`purchase_completed_provider`; its codec decodes that trusted-source fixture
only for conformance. Local Preview and bundled/unhosted paywalls do not emit.

Configuration Delivery v2 adds Placement Decision v1 without changing the
existing Delivery v1 `resolve(placement:)` API. The new
`decision(placement:context:)` evaluates the accepted release locally and
returns an explicit selected Paywall, `noPaywall`, unavailable,
unsupported-contract, or evaluation-failed result. It never refreshes during a
Placement decision.

## Advanced Placement decisions

The hosted client advertises Delivery `3,2,1`, Placement Decision `1`,
Experiment Assignment `1`, exact experiment and decision features, both
canonical experiment bucketing algorithms, and the frozen schedule policy. A
v2 candidate is accepted
only when its digest, authoritative `development`/`staging`/`production`
Environment mode, closed shape, exact derived compatibility, decision semantics,
Paywall documents, and Product/Entitlement references all validate. Delivery v1
metadata keeps `environmentMode` nil because that immutable contract does not
carry a mode. Rejection preserves the last accepted release, so cached evaluation
continues offline.

```swift
let mosaic = try await Mosaic.configure(
  publicSDKKey: publicSDKKey,
  baseURL: baseURL,
  applicationVersion: "2.10.0",
  purchaseProvider: provider
)

try await mosaic.identify(userID: "app_user_123")
try await mosaic.setUserAttributes(["student": .boolean(true)])

switch await mosaic.decision(placement: "export_pdf") {
case .paywallSelected(_, let versionID, let ruleID, let fallbackPath, _, _, let trace):
  print(versionID, ruleID as Any, fallbackPath, trace.steps.count)
case .noPaywall:
  break // Successful terminal decision; do not present a sheet.
case .placementUnavailable, .configurationUnavailable,
     .unsupportedDecisionContract, .evaluationFailed:
  break
}
```

`MosaicPlacementPaywall` performs the same local decision internally. It renders
the selected document and renders nothing for `no_paywall`. The established
commerce presentation-result enum remains unchanged.

The SDK persists a random app-install identifier in Application Support through
an actor-isolated store. It is not derived from IDFA, IDFV, account, locale, or
device metadata. `resetIdentity()` clears user ID and typed attributes while
retaining installation assignment. `resetInstallationIdentity()` explicitly
rotates the installation ID and clears user-bound state. Attribute updates are
atomic and validated against accepted release definitions.

Host-owned country is always explicit and never inferred:

```swift
let result = await mosaic.decision(
  placement: "export_pdf",
  context: MosaicDecisionContext(
    platform: "ios",
    applicationVersion: "2.10.0",
    applicationLocale: "en-NG",
    country: "NG",
    entitlements: ["pro": .unknown],
    products: ["product_export_pro": .available]
  )
)
```

Without an explicit context, iOS supplies platform, OS/app version and locale,
then observes required Products and Entitlements through the provider. Unknown,
provider-unavailable, and failed states remain distinct. Traces are capped at
256 safe steps and expose IDs, safe labels, three-state results, assignment
type, rollout bucket, and fallback path—never identity or attribute values,
provider payloads, or QA tokens.

The optional first-party StoreKit 2 adapter is a sibling package under
`StoreKit/`. Core advertises Commerce Configuration and Provider Contract
versions `2,1`, prefers a compatible v2 sidecar, and preserves an exact accepted
v1 cache or bundled fallback when a v2 candidate is unavailable or invalid.
RevenueCat and app-owned v1 providers continue to use the unchanged provider
interface.

## Installation

The SDK is pre-1.0 (`0.1.0-dev.6`). Public API may still change between
`0.x-dev` versions.

Swift Package Manager is the supported integration. Depend on it by Git
revision or tag:

```swift
.package(url: "https://github.com/Mujhtech/mosaic.git", from: "ios-v0.1.0-dev.6")
```

or, while developing against a checkout, by local path:

```swift
.package(path: "../mosaic/sdk/ios")
```

Add the `MosaicSDK` product, and when native StoreKit commerce is required add
`sdk/ios/StoreKit` for `MosaicStoreKit`. The optional RevenueCat adapter is
`sdk/ios/RevenueCat`.

**CocoaPods is local-path-only.** Mosaic does not yet publish CocoaPods
release artifacts, so the podspecs cannot be resolved by version from a
podspec repository or a release URL:

```ruby
pod "MosaicSDK", :path => "../mosaic/sdk/ios"
pod "MosaicStoreKit", :path => "../mosaic/sdk/ios/StoreKit"
```

Both local pods must be present in the Podfile because CocoaPods does not permit
a podspec dependency to declare another pod's local path. `spec.source` in each
podspec names the repository and an `ios-v<version>` tag so `pod lib lint` can
run; that tag does not exist until a release is published, and version-based
installation is unsupported until then. When distribution begins,
`MosaicSDK.podspec` and `StoreKit/MosaicStoreKit.podspec` must publish at the
same version — the StoreKit pod has an exact same-version dependency on the
core pod and does not duplicate core sources.

## Requirements

Minimums are what the SDK declares and compiles against. Verified means Mosaic
actually exercises them.

| | Minimum | Verified |
| --- | --- | --- |
| iOS | 15.0 | 15.0 typechecked; runtime/UI verified on iOS 26.5 Simulator |
| Swift language mode | 6.0 | 6.3.2 compiler |
| Xcode | 16.0 | 26.5 |

The iOS 15 floor is a compile-only guarantee enforced by the typecheck command
in [Validation](#validation). Mosaic does not run its Simulator suite on an iOS
15 runtime, so iOS 15 rendering and behaviour are not empirically verified.
Report iOS 15 runtime issues rather than assuming they are covered.

Running the Swift Package tests additionally requires macOS with Xcode. The
package declares macOS 14 only so its SwiftUI surface can compile in the
development-host test process. Mosaic does not expose a macOS renderer.

### Behaviour the SDK does not guarantee

- **Background analytics delivery is not guaranteed.** Foreground and
  background flushes are coalesced and best effort. iOS may suspend the app
  before a batch completes; queued events are retried on a later launch, and
  events can expire after seven days. Use `flushAnalytics()` when a
  deterministic result is required.
- **`refresh()` is not cancellable.** Concurrent callers join one in-flight
  refresh, and cancelling the calling `Task` does not abort the network
  request. The request ends on its own when `requestTimeout` elapses.
- If Application Support is unreachable, `configure` degrades to
  process-lifetime storage plus the bundled fallback instead of throwing. The
  configuration cache, installation identity, assignment replay records, and
  the analytics queue then do not survive relaunch, and
  `configurationStatus()` reports `delivery_persistence_unavailable`.

## Protocol 0.2 RC4 rendering

Protocol 0.2 RC4 uses one to ten named screens.
The renderer starts at `initialScreenId`, keeps a presentation-local history,
pushes Screen destinations, presents Sheet destinations with SwiftUI's native
modal surface over the most recent Screen, and safely pops or dismisses with
`navigateBack`. Navigating does not reset
product selection, Switch values, or Carousel pages; accepting a new preview
revision creates a fresh renderer model and resets all runtime state.

RC4 resolves document-scoped colour, background, and shadow tokens within
their own category. Native surfaces support solid colour, physical clockwise
linear gradients, radial gradients, decorative images, decorative muted
looping video, and one shadow. Bundled media stays behind host resolvers;
remote media is limited to validated HTTPS assets. Video failure uses its
poster and then fallback colour, while every media failure remains nonfatal
and emits a safe rendering diagnostic.

Eligible components share two-axis Fit, Fill, and Fixed sizing. Fixed content
clips visual overflow without replacing its accessibility value. Fill on the
vertically unbounded Scroll Container axis resolves to Fit and records
`layout.unboundedFill` instead of producing infinite SwiftUI layout.

Protocol 0.2 also replaces the specialized action components with one native
SwiftUI `Button` whose vertical or horizontal label may contain noninteractive
protocol content. Purchase and restore buttons may supply
`inProgressChildren`; while the provider is running, the button swaps content
and rejects duplicate activation. Descendant semantics are merged into the
button's one localized accessibility target.

RC3 makes Product Selector cards authored protocol content. Each `productCard`
binds one product reference, renders passive children in its authored vertical
or horizontal layout, and applies recursive Default/Selected box-style
overrides. A direct `productBadge` may participate in the card layout or use a
logical start/end overlay anchor, which mirrors under RTL. The whole card is
one native selectable accessibility target; passive descendant labels are
merged in source order.

Selection state is keyed by selector ID and Product Card ID, then mapped back
through the card's product reference for provider loading and purchase. Missing
products remove their cards; an empty localized price removes only a card whose
Text descendants or accessibility label resolve to `product.price` in the active
locale. If the authored initial or current card is unavailable, selection falls
back to the first authored available card; when none remain, the declared
message is shown and purchase is disabled. Product Card text and its optional
accessibility label interpolate
only `product.name` and `product.price` after locale resolution, using the
localized product-reference label when the provider supplies no name.

`icon` maps the frozen semantic icon vocabulary to SF Symbols. Backward and
forward symbols use direction-relative system names and mirror with the
resolved RTL layout. Decorative icons are hidden from VoiceOver; informative
icons retain their localized label. `openExternalUrl` accepts only safe,
absolute HTTPS URLs and delegates to SwiftUI's system `openURL` action. The
paywall and navigation history stay mounted, and an unsuccessful handoff adds
the safe `external_url_open_failed` rendering diagnostic.

## Connect a native preview

Create one stable identity for the running application process, configure a
local endpoint, and retain the client with SwiftUI state ownership:

```swift
import MosaicSDK
import SwiftUI

struct PaywallPreview: View {
  @StateObject private var client: MosaicLocalPreviewClient
  let fallbackDocument: MosaicPaywallDocument

  init(fallbackDocument: MosaicPaywallDocument) throws {
    let identity = MosaicPreviewClientIdentity(
      clientId: "client_ios_example",
      displayName: "iOS local preview",
      renderer: .init(id: "mosaic.ios", version: "0.2.0"),
      application: .init(
        id: "dev.example.app",
        displayName: "Example",
        version: "1.0"
      ),
      device: .init(
        displayName: "Development simulator",
        systemName: "iOS",
        systemVersion: "18.0"
      )
    )
    let configuration = try MosaicPreviewClientConfiguration(identity: identity)
    _client = StateObject(
      wrappedValue: MosaicLocalPreviewClient(configuration: configuration)
    )
    self.fallbackDocument = fallbackDocument
  }

  var body: some View {
    MosaicLocalPreviewScreen(
      client: client,
      fallbackDocument: fallbackDocument,
      fallbackPurchaseProvider: MockMosaicPurchaseProvider(
        products: MosaicProduct.phase1MockProducts
      )
    )
  }
}
```

The default endpoint is `ws://127.0.0.1:4317/preview`, the default session is
`session_local_01`, and the client uses `mosaic.local-preview.v0.2`. A custom endpoint must remain local: localhost,
loopback, private LAN, `.local`, IPv6 ULA, and IPv6 link-local hosts are
accepted; public remote hosts are rejected.

`MosaicLocalPreviewScreen` starts and stops the client with the SwiftUI view
lifecycle. It shows connection state, the active revision, locale and layout
direction, text scale, mock purchase and entitlement state, safe diagnostics,
and a reconnect action. It applies locale, RTL, long copy, and Dynamic Type
preview overrides without rebuilding the application.

## Revision and failure behavior

- The client sends `previewClientConnected` and `capabilityReport` after the
  WebSocket subprotocol is negotiated.
- Document and commerce streams have independent monotonic revision tracking.
- Stale revisions are rejected or ignored; a sequence reused by a different
  revision ID is treated as a conflict.
- A draft is acknowledged only after the SwiftUI renderer mounts it.
- Invalid or unsupported drafts keep the last accepted document visible and
  return safe, component-addressed diagnostics with recovery actions.
- Unsupported required components use `keepLastAcceptedDraft`; unavailable
  products use the document's declared selector fallback.
- Reconnect uses bounded exponential backoff from 250 milliseconds to five
  seconds, with heartbeat timeout detection and a manual reconnect action after
  attempts are exhausted.
- Frames are bounded at 2 MiB and documents at 1 MiB.

The client reports the exact capabilities for the negotiated Protocol version
without adding SwiftUI concepts to the platform-neutral contract. Tests consume
the canonical Local Preview 0.2 flow directly from the repository.

## Mock commerce

`MosaicPreviewPurchaseProvider` translates Studio mock-product references into
the provider product IDs declared by the active validated document. It
supports explicit purchase, restore, unavailable-product, and active-
entitlement outcomes. It never opens StoreKit, handles receipts, or contacts a
billing provider.

## Hosted, SDK-local, and native-store commerce providers

`MosaicCommerceConfigurationManager` strictly decodes canonical Commerce
Configuration v1 and v2 sidecars and accepts one only when Environment, Application,
store platform, Configuration Release ID, release digest, Product IDs, and the
sidecar's own canonical digest all match. Resolution is valid hosted or
SDK-local candidate, exact-association cache, exact-association bundled
fallback, then explicit unavailable.

Hosted refresh calls
`GET /v1/sdk/commerce-configuration?applicationId=<Mosaic Application ID>`
with the public SDK key as Bearer authorization, the frozen iOS/version
capability headers, strong digest ETags, and
`Mosaic-Configuration-Release-Id`. Unsafe response metadata, association
drift, or cache-write failure cannot activate a candidate.

Pass `MosaicCommerceProviderRouter` to `Mosaic.configure` while delivery
starts, derive the exact sidecar association, then install a provider only
after the sidecar is accepted:

```swift
let router = MosaicCommerceProviderRouter()
let mosaic = try await Mosaic.configure(
  publicSDKKey: publicSDKKey,
  baseURL: baseURL,
  purchaseProvider: router
)
guard let association = await mosaic.commerceConfigurationAssociation(
  applicationID: applicationID
) else { return }

let commerce = try MosaicCommerceConfigurationManager(
  cacheIdentifier: "\(baseURL.absoluteString):\(applicationID)"
)
_ = await commerce.bootstrap(
  association: association,
  bundledFallbackData: bundledCommerceConfiguration
)
_ = await commerce.refresh(
  publicSDKKey: publicSDKKey,
  baseURL: baseURL,
  association: association
)
if case .available(let configuration, _, _) = await commerce.status() {
  try await router.install(configuration: configuration, provider: appProvider)
}
```

For a v2 `nativeStore` activation, install `MosaicStoreKitProvider` from the
optional `StoreKit/` package. The v2 mapping contains only the exact StoreKit
Product identifier, stable Mosaic Product ID, Product type, and immutable
Entitlement grants. StoreKit handles, receipts, verification material, and
transactions never enter core configuration or diagnostics.

App-owned providers implement `MosaicCommerceProvider` and report the identity,
Mosaic adapter version, and runtime capabilities their installed adapter
actually implements. Before accepting mappings, the router requires the
provider ID and adapter version to match and requires every sidecar-declared
capability to have the same support and reason code in the installed adapter.
Adapter capabilities not present in the sidecar do not implicitly activate
features.

Raw provider errors, credentials, receipts, and customer identifiers are never
part of the public contract or safe diagnostics. Purchase, restore, and active
Entitlement provider-failure results carry a complete bounded diagnostic with
a stable code, safe message, retryability, correlation ID, safe provider code,
recovery action, and Product context where applicable. The configured boundary
repairs invalid custom-provider diagnostic values. SwiftUI interaction and
presentation results deliberately retain only the sanitized stable code.

Installing or replacing a configuration clears the router while
`invalidateLoadedProducts()` removes provider-native handles. Purchase remains
unavailable until products are loaded again from the new exact mappings.
Provider implementations must use actor-isolated generation tracking so an
older in-flight load cannot restore stale handles.

Restore normalizes an existing entitlement to `.restored`; it does not expose
a separate already-entitled restore result. Active Entitlement lookup returns
exactly `.available`, `.unknown`, `.providerUnavailable`, or `.failed`.
Provider failures never imply an empty or inactive Entitlement set.

## Transaction observations (optional)

A Transaction Observation is an untrusted report that a provider transaction
may exist. It is a trigger for server-side validation and never proof. The
handoff is **off by default** and changes nothing when it is off: no
observation is built, queued, persisted, or sent.

```swift
let provider = try MosaicStoreKitProvider(acceptor: acceptor)
let mosaic = try await Mosaic.configure(
  publicSDKKey: key,
  baseURL: baseURL,
  transactionObservations: .enabled,
  purchaseProvider: router)
// The provider is constructed before `configure`, so the sink is attached
// afterwards rather than passed through the initializer.
await provider.attachTransactionObservationSink(mosaic.transactionObservationSink())
```

What is submitted, and nothing else: the deterministic `submissionId`, the
reference kind `app_store_transaction_id`, the raw decimal
`Transaction.id` as a string, the Store Environment where StoreKit can report
it, and `observedAt`. The following are never read from StoreKit and can never
reach a Mosaic payload: `jwsRepresentation`, `deviceVerification`,
`deviceVerificationNonce`, `appAccountToken`, `appTransactionID`,
`originalID`, price, and store product identity.

Behaviour worth knowing before enabling it:

- **The purchase result never changes.** `MosaicPurchaseResult` and
  `MosaicCommerceUpdate` are byte-identical regardless of submission outcome,
  and `serverConfirmedTransactions` stays `unsupported`. Nothing in the
  submission response can re-label a locally verified purchase as
  server-validated; the outcome vocabulary has no such member.
- **Purchase never blocks on it.** Observation handoff is synchronous and
  returns immediately; delivery happens on a detached task.
- **The reference is a string end to end.** App Store transaction identifiers
  exceed IEEE-754 double precision and `Int64`; never parse one.
- **Xcode StoreKit testing is suppressed.** Those transactions have no App
  Store record, so no observation is enqueued for them. Sandbox and production
  transactions are observed normally.
- **The queue is persistent and duplicate-safe.** It lives in Application
  Support beside the analytics queue, is excluded from backup, survives
  relaunch, and de-duplicates on the deterministic submission identifier.
  Retention is 30 days, with the same capped exponential backoff and
  `Retry-After` handling as the analytics queue.
- **No background execution.** Delivery is attempted on enqueue, on foreground
  and background transitions, and on the next `configure`. There is no
  background `URLSession` or `BGTaskScheduler` usage, because both require host
  entitlements, Info.plist keys, and `AppDelegate` wiring a Swift package
  cannot install. Store Notifications remain the reliable server-side path;
  this handoff is a latency and attribution optimization.
- **No server credentials.** Authorization is the same public SDK key bearer
  token used by analytics.

`transactionObservationDiagnostics()` reports the mode, queued count, and the
accepted, duplicate, permanently rejected, retry, and dropped counters plus the
last safe code. `flushTransactionObservations()` attempts delivery now.

## Bundled fallback and direct rendering

The preview screen takes a valid bundled `MosaicPaywallDocument` and an
independent fallback purchase provider. Until a valid local draft arrives—or
when a newer draft fails—the native fallback remains usable.

Outside Studio preview, a host can still render directly:

```swift
MosaicPaywall(
  document: document,
  requestedLocale: "en",
  purchaseProvider: MockMosaicPurchaseProvider(
    products: MosaicProduct.phase1MockProducts
  ),
  imageResolver: .missing,
  videoResolver: .missing,
  onInteraction: { interaction in
    print(interaction.name.rawValue)
  },
  onResult: { result in
    print(result.name.rawValue)
  }
)
```

`MosaicPaywall` reports terminal outcomes but never dismisses its host
container. Protocol Sheet destinations are presented and dismissed internally
through their navigation history. The host still owns the outer paywall sheet
or full-screen cover. Bundled images and videos remain host-resolved through
`MosaicImageResolver` and `MosaicVideoResolver`; unavailable media follows its
declared placeholder, poster, or colour fallback.

The packaged resource is a byte-identical checked-in copy of the current
`protocol/fixtures/v0.2/complete-paywall.json`. SwiftPM copies symbolic links
without rebasing their targets, so using a repository-relative symlink would
produce a broken fallback in a built package. A package test prevents the copy
from drifting; it is not an SDK-owned schema or fixture fork.

## Platform-specific rendering notes

- Text metrics, Dynamic Type wrapping, control chrome, focus behavior, and
  scrolling use SwiftUI's native behavior and need not be pixel-identical to
  Flutter or Compose.
- Protocol start/end alignment maps to SwiftUI leading/trailing and follows the
  resolved locale direction.
- Linear-gradient geometry uses physical coordinates: 0° is left-to-right,
  90° is top-to-bottom, angles increase clockwise, and RTL does not mirror it.
- Each multi-screen root exposes its localized screen label as a containing
  VoiceOver group while preserving the source-order focus of its descendants.
- Protocol heading levels are preserved in the accessibility projection. On
  iOS 15, SwiftUI exposes the native header trait but not a public per-level
  heading API.
- The feature-list checkmark is a decorative SF Symbol; spoken labels remain
  the protocol text.

## Validation

From the repository root. Formatting uses the pinned repository-root
`.swift-format` configuration:

```bash
swift format lint --strict --recursive \
  sdk/ios/Package.swift sdk/ios/Sources sdk/ios/Tests \
  sdk/ios/StoreKit/Package.swift sdk/ios/StoreKit/Sources sdk/ios/StoreKit/Tests \
  sdk/ios/RevenueCat/Package.swift sdk/ios/RevenueCat/Sources sdk/ios/RevenueCat/Tests
swift build --package-path sdk/ios
swift build --package-path sdk/ios -c release
swift test --package-path sdk/ios
swift build --package-path sdk/ios/StoreKit
swift test --package-path sdk/ios/RevenueCat
```

The declared iOS 15 floor is compile-verified separately, because the package
tests build for the macOS development host and would not catch an
iOS 16-only API:

```bash
cd sdk/ios
xcrun swiftc -typecheck -swift-version 6 \
  -target arm64-apple-ios15.0-simulator \
  -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" \
  Sources/MosaicSDK/*.swift
```

Then the example application:

```bash
set -o pipefail
xcodebuild -project examples/ios-example/MosaicExample.xcodeproj \
  -scheme MosaicExample \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath examples/ios-example/.build/DerivedData \
  CODE_SIGNING_ALLOWED=NO build
```

Always run `set -o pipefail` before piping `xcodebuild` into `tail`, `grep`,
or `xcpretty`. Without it the shell reports the pipeline's exit status and a
failed build is silently reported as success. This masked a real regression in
a previous phase.

`examples/ios-example/README.md` documents the package-cache seeding needed to
keep the example build from spending minutes on dependency resolution.

The package test suite uses an in-memory WebSocket to cover the full local
preview flow. To run the opt-in transport smoke test against a live local
Studio relay:

```bash
MOSAIC_PREVIEW_RELAY_TEST=1 swift test --package-path sdk/ios \
  --filter LocalPreviewClientTests/testOptInRealRelayVerticalSlice
```

UIKit-backed golden, accessibility-size, and preview-status tests run through
the example test host on a concrete iOS Simulator. See
`examples/ios-example/README.md` for the command.
