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

## Degradation diagnostics

Every recovery the renderer performs is observable through
`MosaicPaywallModel.diagnostics`. Each code is recorded once per subject, so a
malformed value diagnoses once rather than once per frame.

| Code | Recovery |
| --- | --- |
| `style_color_token_unresolved` | Content colours recover to the primary content colour so text stays legible; decoration stays transparent. |
| `style_color_literal_malformed` | Same recovery as an unresolved token. |
| `style_background_token_unresolved` | The background is omitted; the parent surface shows through. |
| `style_gradient_stop_unresolved` | The gradient renders with the stops that resolved instead of the whole background being erased. |
| `style_shadow_token_unresolved` | The shadow is omitted. |
| `countdown_ends_at_invalid` | An `endsAt` that is not in the canonical protocol form renders nothing. It is never presented as the localized completed text, which would state an expiry the document never authored. The semantic validator rejects such a document outright; this is the renderer's defence for documents that reach it anyway. |
| `media_image_unavailable`, `media_image_asset_missing`, `media_image_fallback_text_missing` | The declared asset fallback is shown, matching the media-background paths. |
| `product_selection_default_substituted` | The authored default product was unavailable and the first available option was selected. The `product_selected` payload still reports `source: "default"` because that field's protocol enum admits only `default` and `user`. |
| `placement_analytics_metadata_unavailable` | The paywall renders, but no presentation, purchase, or conversion event carries attribution. |
| `localization_direction_unresolved` | No locale in the requested, fallback, or default chain declares a direction, so layout defaults to left to right. |

Hosts rendering `MosaicPaywall` directly can seed presentation-level codes with
the `presentationDiagnostics:` initializer parameter.

`MosaicPlacementPaywall` shows a placeholder when a Placement resolves to no
safe configuration. The SDK has no access to host localization catalogs, so the
copy defaults to English and is overridable:

```swift
MosaicPlacementPaywall(
  mosaic: mosaic,
  placement: "export_pdf",
  unavailableCopy: MosaicPlacementUnavailableCopy(
    title: NSLocalizedString("paywall.unavailable.title", comment: ""),
    message: NSLocalizedString("paywall.unavailable.message", comment: ""),
    diagnosticHintPrefix: NSLocalizedString("paywall.unavailable.hint", comment: "")
  ),
  onResult: { _ in }
)
```

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

The StoreKit and RevenueCat adapters classify provider errors the same way.
Cancellation, pending payment, an unavailable product, and a transport or
system outage each map to their own normalized result, and only transport and
system outages are marked retryable. An error neither adapter can classify
stays a non-retryable failure rather than being optimistically retried.

Both adapters omit a subscription period whose unit they cannot name, and
record `commerce.unsupportedSubscriptionPeriod`. The product stays purchasable
and only the period text is dropped, because presenting an unknown renewal
cadence as daily would misstate the commercial terms. RevenueCat additionally
records `commerce.unsupportedIntroductoryOffer` when it reports an offer type
Mosaic cannot classify, instead of silently stripping the trial.

`MosaicStoreKitFileAcceptanceStore.defaultStore()` stores its duplicate-delivery
set in Application Support, excluded from backup. It throws
`MosaicStoreKitAcceptanceStoreError.durableStorageUnavailable` when that
directory is unavailable rather than falling back to the temporary directory,
which the system may purge and which would cause accepted transactions to be
delivered to the host a second time. `MosaicStoreKitProvider.init` propagates
that error.

The Placement decision context reports provider capabilities from
`mosaicExperimentCapabilities` on the installed provider. The default protocol
extension declares the full set, so adapters that do not override it are
unchanged; an adapter that declares a subset is no longer reported as capable
of what it does not implement.

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

The submitted document is the canonical Billing Ingestion Contract 1
`clientTransactionObservation` record: contract version `1`, the record type,
and a payload of `observationId`, the deterministic `submissionId`,
`providerId`, `storePlatform`, a `transactionReference` of
`app_store_transaction_id` plus the raw decimal `Transaction.id` as a string,
`observedAt`, `sourceAuthority: client_observation`, SDK `context`, and
`correlation` when a purchase-attempt handle exists.

Nothing else is submitted. The following are never read from StoreKit and can
never reach a Mosaic payload: `jwsRepresentation`, `deviceVerification`,
`deviceVerificationNonce`, `appAccountToken`, `appTransactionID`,
`originalID`, price, and store product identity.

A client never asserts a **Store Environment**. Sandbox and production
classification is derived server-side from verified provider metadata during
validation, so no environment field appears on the wire.

Behaviour worth knowing before enabling it:

- **Only a trigger is claimed.** `sourceAuthority` is always
  `client_observation`, which the contract defines as the lowest authority: a
  client observation can trigger validation but can never author a fact.
- **The purchase result never changes.** `MosaicPurchaseResult` and
  `MosaicCommerceUpdate` are byte-identical regardless of submission outcome,
  and `serverConfirmedTransactions` stays `unsupported`. Nothing in the
  submission response can re-label a locally verified purchase as
  server-validated; the outcome vocabulary has no such member.
- **Purchase never blocks on it.** Observation handoff is synchronous and
  returns immediately; delivery happens on a detached task.
- **The reference is a string end to end.** App Store transaction identifiers
  exceed IEEE-754 double precision and `Int64`; never parse one.
- **Xcode StoreKit testing is suppressed.** `Transaction.environment` is read
  on iOS 16 and later for exactly one purpose: those transactions have no App
  Store record, so no observation is enqueued for them. The value is never
  submitted. Sandbox and production transactions are observed normally.
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

When a `customerTokenProvider` is configured, a submission also carries the
current Customer Access Token in a `Mosaic-Customer-Token` header, which binds
the purchase to that Billing Customer server-side. The token is read at **send**
time, not enqueue time, so a purchase queued before sign-in is still bound
correctly once the user signs in. It is never written to the queue and never
logged. Without a token the submission still succeeds — it just anchors
anonymously and has to be associated later by other evidence.

## Authoritative customer entitlements

Purchase observation and access authority remain separate. The server-directed
authority epoch decides which access snapshot is used; the configured purchase
provider continues loading products, purchasing, and restoring across cutover.

| | Provider-observed | Authoritative |
| --- | --- | --- |
| Asks | what this device's store account shows | what Mosaic has validated for this Billing Customer |
| Source | StoreKit / RevenueCat on device | Server-selected source or Mosaic projection, bound to an authority epoch |
| API | `activeEntitlements()` for provider diagnostics | `checkCustomerEntitlement(_:)` and friends |
| Spans devices and platforms | no | yes |
| Needs an app backend | no | **yes** |

StoreKit and RevenueCat remain installed when authority changes. Their observed
Entitlements are never unioned with authoritative access. After the server says
Mosaic is authoritative, Placement targeting reads only the accepted Mosaic
snapshot; provider access remains diagnostic and commerce remains usable.
Before any authority epoch is accepted, targeting reports requested
Entitlements as unknown. Provider-observed targeting starts only after an
accepted `source` or `source_rollback` authority epoch.
Direct `checkCustomerEntitlement(_:)` calls answer from a snapshot only under
accepted `mosaic` authority. Under `source` or `source_rollback`, they return an
explicit unavailable result; provider delegation remains specific to Placement
targeting.

### Mosaic Billing requires an application backend

A public SDK key identifies an *application*; it can never select a *customer*.
An application user ID is guessable, so it cannot either. Reading someone's
billing state therefore needs a **Customer Access Token**, which only your
backend can mint:

```text
your app → your backend (authenticates your user)
         → Mosaic, with your secret_server key
         → token, returned once
         → back to the app
         → SDK attaches it to every entitlement sync
```

There is no anonymous mode. Allowing a client-generated installation identifier
to select a Billing Customer would let anyone read someone else's entitlements
by guess or replay.

```swift
let mosaic = try await Mosaic.configure(
  publicSDKKey: key,
  baseURL: baseURL,
  // Optional: defaults to Bundle.main.bundleIdentifier.
  applicationID: "com.example.app",
  // Optional: defaults to CFBundleShortVersionString.
  applicationVersion: "4.2.0",
  purchaseProvider: provider,
  customerTokenProvider: MosaicClosureCustomerTokenProvider { forceRefresh in
    guard let user = await MyAuth.currentUser else { return .signedOut }
    do {
      return .token(MosaicCustomerAccessToken(try await MyBackend.mosaicToken(for: user)))
    } catch {
      // Never `.signedOut` for a backend failure: a backend that cannot mint a
      // token has not revoked anyone's subscription.
      return .unavailable
    }
  })
```

The sync surface is a `POST` to `/v1/sdk/billing/entitlements` carrying the
canonical Authoritative Entitlement v2 `entitlementSyncRequest`. It reports the
Application, platform, app/SDK versions, supported contract versions,
capabilities. A known authority epoch, snapshot version, and snapshot-authority
digest are sent together only for the exact retained
customer/scope/epoch snapshot. They are omitted when that binding is absent or
stale, forcing a full response. Customer, Project, and Environment binding are
derived and verified server-side from the opaque
Customer Access Token; they are not guessed into the request. A `200`
`snapshotUnchanged` response carries the v1 confirmation body and slides the
freshness window. The SDK does not use `If-None-Match` or bare `304` for v2.

Tokens are held **in memory only** — never the keychain, never a file — and are
never logged or parsed. On a refusal the SDK forces exactly one token refresh
per generation; a second refusal is a real failure, not something to retry. A
new server authority epoch rebinds the local token generation and schedules one
urgent, coalesced sync without retrying a purchase.

An authority or snapshot candidate is published only after its cache record is
saved atomically. If persistence fails, the SDK keeps the prior accepted state.
An unchanged response may slide freshness only when its complete retained
identity, authority digest, evaluation instant, and projection status match and
its timestamps do not regress or exceed the v1 freshness horizon.

### Authority transitions

Authority is server-directed and evaluated before snapshot version. A newer
epoch replaces an older epoch even when its snapshot version is lower; a late
older epoch is rejected even when its snapshot version is higher. Cache format
v2 atomically binds Billing Customer, Environment, Application, platform,
authority epoch, and snapshot authority digest. A legacy v1 cache has
`authority_unknown`, is cleared, and reports unavailable rather than inactive.
An `authorityUnavailable` response with `policy_unavailable` deliberately has
no minimum-support placeholder and also clears to unavailable, never inactive.
The SDK first atomically replaces any accepted cache with a durable invalidation
tombstone; restart cannot replay the previous active snapshot. A failed marker
write clears process-local access and gates bootstrap and sync behind retrying
that write. The SDK also tries to remove the old durable snapshot, making a
cold restart fail closed when deletion remains available. If storage rejects
both the marker and removal, Mosaic diagnoses the storage failure and keeps the
in-process gate; it does not fabricate a durable invalidation. A later valid
full snapshot atomically replaces the tombstone.

Observe authority metadata independently of access gating:

```swift
for await update in await mosaic.customerAccessAuthorityUpdates() {
  switch update {
  case .authority(let authority, let minimumSupport):
    print(authority.epoch, authority.kind, minimumSupport.minimumSDKVersion)
  case .unavailable(let reason, _):
    showMigrationDiagnostic(reason)
  case .signedOut, .cleared:
    break
  }
}
```

The stream is bounded and replays current state. `customerAccessAuthority()`
returns that state once, while `customerEntitlementDiagnostics()` includes the
safe authority, minimum-support, Application/version, cache digest, and urgent
refresh metadata. Neither surface exposes the Customer Access Token.

### Reading access

```swift
let check = await mosaic.checkCustomerEntitlement("pro")
switch check.state {
case .active:                 unlock(stale: check.isStale)
case .inactive:               showPaywall()
case .unknown(let reason):    // Mosaic could not determine this
case .unavailable(let reason): // Mosaic could not answer at all
}
```

There is no boolean convenience API anywhere, deliberately. `unknown` and
`unavailable` are not `inactive`, and an API that collapsed them would make
that mistake easy to write and impossible to see.

An entitlement key the snapshot does not carry reads `unknown`, **not**
`inactive`. Absence is not a statement Mosaic made: the key may be undefined for
the Project, unresolved by the projection, or simply outside a narrowed request.
`inactive` requires an entry that says so.

> **The one rule.** A rejected response, a network failure, an expired cache, an
> unknown field, a digest mismatch, a token your backend could not mint — every
> one of those is `unknown` or `unavailable`. `inactive` is a claim about a
> person and only ever comes from a snapshot Mosaic issued and the SDK fully
> accepted. A reader that collapsed the two would turn every Mosaic outage into
> a mass revocation experienced by paying customers.

Observe changes with a stream that replays current state to each new subscriber:

```swift
for await update in await mosaic.customerEntitlementUpdates() {
  switch update {
  case .snapshot(let value): apply(value.snapshot, stale: value.cacheState.isStale)
  case .signedOut, .cleared: lockEverything()
  case .unavailable(let reason): keepCurrentUIAndRetry(reason)
  case .loading: break
  }
}
```

### Offline behaviour: bounded grace

The shipped policy is bounded grace, uniform across iOS, Android, and Flutter.
Windows are server-issued per Environment:

| Window | Cache state | Behaviour |
| --- | --- | --- |
| before `refreshAfter` (default 1 h) | `fresh` | serve; do not refresh |
| until `validUntil` (default 7 d) | `refreshRecommended` | fully valid |
| + `staleGraceSeconds` (default 24 h) | `staleWithinGrace` | previously active access continues and **must be shown as stale** |
| after that | `expired` | `unknown` — never `inactive` |

Clock skew tolerance is 60 seconds. A device clock set earlier than issuance is
treated as unreliable and takes the expired path, because a cache whose age
cannot be measured cannot be trusted to be young. A strict policy is the same
fields with a grace window of zero.

The cache is per-customer (the binding digest is in the file name), excluded
from backup, atomic, and checksummed for corruption detection. It supports UI
continuity and feature gating — **it is not a credential**, and your backend
must never accept one from a client as proof of access. Protected resources are
authorized by your own server.

### Restore

```swift
let result = await mosaic.restoreAndSyncCustomerEntitlements()
result.providerResult                      // what StoreKit did, verbatim
result.outcome                             // what Mosaic can say
result.authoritativeEntitlementsUpdated    // true only with an accepted snapshot
result.stages                              // render as progress
```

A restore is two operations, so the result reports two axes. A successful native
restore whose facts Mosaic has not yet validated is `validationPending`, not
`restored`: the accepted snapshot is the evidence that makes the outcome
authoritative rather than hopeful. The validation poll is bounded at 3 attempts
over roughly 6 seconds.

The StoreKit adapter now submits observations on the restore path as well as the
purchase path, so a fresh-device restore actually reaches Mosaic. Both
de-duplication layers make repeated restores idempotent.

### Refresh timing

Refreshes happen at `configure`, on foreground, and whenever you ask. Pending
or stabilizing transitions refresh urgently before normal Configuration
Delivery. **There is no background refresh**: no `BGTaskScheduler`, no silent push. A device that has
been offline for days is exactly what the grace window and the `expired` state
describe. After a purchase, call `customerEntitlementsDidChangeAfterPurchase()`;
it is fire-and-forget and never a suspension point on the purchase path.

### Identity

`identify(userID:)`, `resetIdentity()`, and `resetInstallationIdentity()` all
fan out to the entitlement client: the token generation is bumped, in-flight
requests are cancelled, and the cache is cleared **before any read can return
the previous person's grants**. Installation identity is preserved.
`clearCustomerState()` does the same on request.

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
