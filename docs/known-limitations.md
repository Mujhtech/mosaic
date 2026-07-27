# Known Limitations

This register records defects and gaps that ship documented for v1 General
Availability. Each entry states its surface, affected platforms, symptom,
workaround, planned resolution, and why it is GA-safe.

An entry may appear here only if it falls outside every release-blocker
category, cannot cause data loss, money loss, or a wrong monetization decision,
and is explicitly owner-accepted at the Phase 8 review gate. Environmental
verification gaps are labelled "not demonstrated" and are never implied as
working.

## Android SDK

Each entry is owner-accepted for v1 General Availability. None falls into a
release-blocker category: none can cause data loss, money loss, or a wrong
monetization decision, and each has a stated workaround or a safe visible
failure.

### The Android SDK is pre-1.0 and is not published to any registry

- Surface: `sdk/android` (`:mosaic`, `:mosaic-google-play`, `:mosaic-revenuecat`).
- Platforms: Android (API 24+).
- Symptom: the modules are versioned `0.1.0-dev.7`, and no coordinate under
  `dev.mosaic.sdk` resolves from Maven Central, Google Maven, or any other
  remote repository. A host that adds the coordinate without publishing it first
  fails dependency resolution.
- Workaround: install by composite/local-path build or by pinning the Mosaic
  repository at an exact commit and publishing to your own Maven repository or
  `mavenLocal()`. Both paths are documented in `sdk/android/README.md`.
- Planned resolution: registry publication after 1.0.
- GA safety: this is a distribution limitation only. The SDK's runtime behaviour,
  failure handling, and protocol conformance are unaffected. Owner decision D6.

### Android dependency versions are frozen for GA

- Surface: `sdk/android` Gradle dependencies and toolchain.
- Platforms: Android.
- Symptom: Android lint reports `NewerVersionAvailable` and `GradleDependency`
  warnings for OkHttp 4.12.0, Gson 2.11.0, Coil 2.4.0, Media3 1.8.0,
  kotlinx-coroutines 1.10.2, the AndroidX test artifacts, and Gradle 9.3.1.
  These warnings are expected and are not defects.
- Workaround: none required. Hosts may override transitive versions in their own
  build if they need a newer one; Mosaic's public API does not depend on the
  newer releases.
- Planned resolution: dependency refresh in the first post-GA maintenance
  release, outside the Phase 8 feature freeze.
- GA safety: the frozen versions are the tested versions. Bumping them during a
  release freeze would invalidate the validation evidence, which is the larger
  risk.

### The Android instrumentation suite requires a device or emulator

- Surface: `sdk/android/mosaic` `androidTest` source set — Compose UI,
  accessibility, RTL, sheet-navigation, and pixel-baseline checks.
- Platforms: Android.
- Symptom: `:mosaic:connectedDebugAndroidTest` cannot run headless. In an
  environment with no connected device and no running emulator it does not
  execute, so that layer of evidence is labelled "not demonstrated" rather than
  passing.
- Workaround: run it against a device or emulator; the recorded pixel baseline
  was captured on `Pixel_3a_API_34`. The JVM unit suite, Android lint, the
  library `assemble` tasks, and the minified example release build all run
  headless and cover protocol decoding, persistence codecs, commerce adapters,
  fallback behaviour, and R8 compatibility.
- Planned resolution: an emulator job in CI post-GA.
- GA safety: it is an environmental verification gap, never implied as working.
  No Mosaic-owned behaviour depends on the instrumentation suite to be correct;
  the accessibility and rendering contracts it checks are also constrained by
  the headless decoding and state tests.

## Flutter SDK

Each entry is owner-accepted for v1 General Availability. None falls into a
release-blocker category: none can cause data loss, money loss, or a wrong
monetization decision, and each has a stated workaround or a safe visible
failure.

### The Flutter SDK is pre-1.0 and is not published to pub.dev

- Surface: `sdk/flutter` (`mosaic_sdk`) and the optional
  `mosaic_revenuecat` and `mosaic_native_store` packages.
- Platforms: Flutter (iOS and Android hosts), Flutter 3.22 / Dart 3.4 minimum.
- Symptom: the packages declare `publish_to: none` and are versioned
  `0.2.0-dev.11` / `0.1.0-dev.1`. `flutter pub add mosaic_sdk` cannot resolve
  them, because no version exists on pub.dev.
- Workaround: install by Git pin (repository URL plus `path:` and an exact tag
  or commit `ref:`) or by local path dependency. Both forms are documented in
  `sdk/flutter/README.md` and the path form is exercised by
  `examples/flutter-example`.
- Planned resolution: pub.dev publication after 1.0.
- GA safety: this is a distribution limitation only. Runtime behaviour, failure
  handling, and protocol conformance are unaffected. Owner decision D6.

### Analytics runtime state is shared through a static process-wide map

- Surface: `MosaicAnalyticsRuntime.acquire` / `release` in
  `sdk/flutter/lib/src/analytics.dart`.
- Platforms: Flutter.
- Symptom: analytics runtimes are cached in a static map keyed by the
  base-URL/public-key namespace and reference-counted. Two `Mosaic` clients
  configured against the same Environment therefore share one queue and one
  lifecycle observer, and the map is never cleared by a hot restart in tests
  that do not dispose their client. Disposing one client while another is still
  configured is handled by the reference count, but the shared state is not
  injectable and cannot be isolated per client.
- Workaround: configure a single `Mosaic` client per Environment for the
  process lifetime (the documented and intended usage), and always call
  `Mosaic.dispose()`. Tests that need isolation pass distinct public SDK keys
  or an injected `MosaicAnalyticsStorage`.
- Planned resolution: replace the static map with an explicitly owned runtime
  registry after GA. Deliberately deferred: the redesign changes a public
  construction path and is not a defect fix.
- GA safety: the sharing is deterministic and reference-counted, the queue
  remains bounded and app-private, and no event is attributed to the wrong
  Environment because the namespace is derived from base URL and public key.

### Each configuration decode starts a new isolate

- Surface: `_decode` and `_decodeCommerce` in
  `sdk/flutter/lib/src/configuration_client.dart`.
- Platforms: Flutter.
- Symptom: every Configuration Delivery and Commerce Configuration decode runs
  through `Isolate.run`, which spawns and tears down an isolate per call. This
  keeps large-document decoding off the UI thread and prevents jank, at the cost
  of isolate startup on each cache load and each refresh.
- Workaround: none required. Decodes happen on load and on explicit refresh,
  not per frame and not during presentation.
- Planned resolution: measure and, if justified, move to a long-lived worker
  isolate after GA.
- GA safety: it is a performance cost, not a correctness problem. Presentation
  never blocks on a decode because it reads the already-accepted snapshot.

### Analytics queue-size accounting is quadratic on the overflow path

- Surface: `_queueBytes` and `_makeRoom` in
  `sdk/flutter/lib/src/analytics.dart`.
- Platforms: Flutter.
- Symptom: the queue's byte total is recomputed by folding over every queued
  event, and the overflow-eviction loop consults it on each iteration. Evicting
  many events at once is therefore O(n²) in queue length. The queue is bounded
  to 1,000 events and 2 MiB, so the worst case is a bounded one-off cost on a
  device that has been offline long enough to fill the queue.
- Workaround: none required; the bounds cap the cost.
- Planned resolution: maintain a running byte total after GA.
- GA safety: bounded work on a background code path. No event is lost or
  duplicated, and analytics never blocks rendering or purchasing.

### The commerce router's update stream is not closed by `Mosaic.dispose()`

- Surface: `MosaicCommerceProviderRouter` in `sdk/flutter/lib/src/commerce.dart`
  and `Mosaic.dispose()` in `sdk/flutter/lib/src/configuration.dart`.
- Platforms: Flutter, hosts that install a commerce provider factory.
- Symptom: `Mosaic.dispose()` calls the router's `deactivate()`, which cancels
  the provider subscription and disposes an asynchronous provider but does not
  close the router's broadcast `StreamController`. The router's own `dispose()`
  does close it. A host that disposes and reconfigures Mosaic repeatedly leaks
  one broadcast controller per disposed client.
- Workaround: configure Mosaic once per process, the documented usage. A host
  that must reconfigure can hold its own router reference and call its
  `dispose()`.
- Planned resolution: have `Mosaic.dispose()` await the router's `dispose()`
  after GA. Deferred because `dispose()` is synchronous in `ChangeNotifier` and
  the change alters disposal ordering for asynchronous providers.
- GA safety: a bounded memory leak in a non-repeating lifecycle path. No
  purchase, restore, or entitlement result is affected, and no listener receives
  events from a disposed client because the router is deactivated.

### Analytics Event v2 is emitted only for Experiment events

- Surface: `mosaicDecodeExperimentAnalyticsEvent` in
  `sdk/flutter/lib/src/experiment_analytics.dart`.
- Platforms: Flutter.
- Symptom: the Flutter SDK's v2 codec accepts only the four Experiment event
  names. The canonical v2 fixtures
  `product-selection-attributed.json` and `purchase-started-attributed.json`
  describe standard monetization events that carry Experiment attribution on the
  v2 schema; Flutter emits those events on the v1 schema instead, so it neither
  produces nor decodes their v2 form.
- Workaround: none required for Experiment analysis. Experiment exposure,
  assignment, and fallback events are emitted on v2 and carry the complete
  immutable attribution tuple, which is what variant attribution is computed
  from.
- Planned resolution: after GA, decide cross-SDK whether monetization events
  should move to v2 when an Experiment is active, then implement uniformly.
- GA safety: no event is lost or misattributed; the affected events are
  delivered on v1 with their Experiment attribution recorded by the exposure
  event. Verified by the canonical v2 fixture scan in
  `sdk/flutter/test/analytics_test.dart`.

## iOS SDK

Each entry is owner-accepted for v1 General Availability. None falls into a
release-blocker category: none can cause data loss, money loss, or a wrong
monetization decision, and each has a stated workaround or a safe visible
failure.

### The Apple SDK is pre-1.0 and is not published to any registry

- Surface: `sdk/ios` (`MosaicSDK`, `MosaicStoreKit`, `MosaicRevenueCat`).
- Platforms: iOS 15+.
- Symptom: the packages are versioned `0.1.0-dev.6`. Swift Package Manager
  integration works by Git revision, tag, or local path, but CocoaPods is
  local-path-only: no `MosaicSDK` or `MosaicStoreKit` pod resolves by version
  from the CocoaPods trunk or any release artifact. `spec.source` names an
  `ios-v<version>` tag that exists only once a release is published, so it is
  present for `pod lib lint` and not for installation.
- Workaround: use SwiftPM, or add the pods with `:path =>` against a checkout.
  Both paths are documented in `sdk/ios/README.md`.
- Planned resolution: podspec publication and release artifacts after 1.0.
- GA safety: this is a distribution limitation only. Runtime behaviour, failure
  handling, and protocol conformance are unaffected. Owner decision D6.

### The iOS 15 floor is compile-verified, not runtime-verified

- Surface: the whole `MosaicSDK` renderer and client surface.
- Platforms: iOS 15.0–15.x.
- Symptom: Mosaic declares an iOS 15 minimum and guarantees it by typechecking
  every core source against `arm64-apple-ios15.0-simulator` (the command is in
  `sdk/ios/README.md`). The Simulator golden, accessibility, and interaction
  suites run on iOS 26.5 only, and the SwiftPM package tests build for the
  macOS development host. iOS 15 *rendering and runtime behaviour* is therefore
  not demonstrated.
- Workaround: hosts targeting iOS 15 should verify their own paywall
  presentation on an iOS 15 Simulator. The known iOS 15 behavioural difference
  is already documented: SwiftUI exposes the native header trait but no public
  per-level heading API.
- Planned resolution: add an iOS 15 Simulator runtime to the verification
  matrix post-GA.
- GA safety: labelled "not demonstrated" rather than implied as working. The
  compile guarantee prevents the concrete regression that motivated this entry
  (an iOS 16-only `ContinuousClock` reaching a declared iOS 15 target).

### `refresh()` is not cancellable

- Surface: `Mosaic.refresh()`, `Mosaic.refreshIfNeeded()` in
  `sdk/ios/Sources/MosaicSDK/ConfigurationClient.swift`.
- Platforms: iOS.
- Symptom: concurrent callers join a single in-flight refresh, and cancelling
  the calling Swift `Task` does not abort the underlying request. The request
  ends only when the configured `requestTimeout` (1–30 seconds) elapses. A
  screen dismissed mid-refresh therefore keeps one request alive briefly.
- Workaround: keep `requestTimeout` at or below the default 5 seconds. Refresh
  never blocks rendering, purchasing, or a Placement decision, so an
  outstanding request has no user-visible effect.
- Planned resolution: adopt cooperative cancellation in the delivery client
  post-GA, together with the shared in-flight coalescing contract.
- GA safety: bounded by `requestTimeout`, cannot leak unboundedly, and cannot
  change a Placement, Paywall, or purchase outcome.

### Background analytics delivery is best effort

- Surface: `MosaicAnalyticsRuntime` foreground/background flush in
  `sdk/ios/Sources/MosaicSDK/AnalyticsLifecycle.swift`.
- Platforms: iOS.
- Symptom: the SDK flushes on `didEnterBackground` and
  `willEnterForeground` without requesting a background task assertion. iOS may
  suspend the app before the batch completes, so a background flush is not
  guaranteed to deliver. Events remain queued and are retried on a later
  launch, but the seven-day queue expiry can discard events for an app that is
  not reopened.
- Workaround: call `flushAnalytics()` for a deterministic result at a moment the
  host controls.
- Planned resolution: evaluate a bounded background task assertion post-GA,
  weighed against host battery and launch-time cost.
- GA safety: analytics delivery never gates rendering or purchasing, per the
  mandatory safe-failure rule. Loss is limited to non-financial observability
  for apps that are never reopened within seven days.

### Lifecycle observers and shared registries are retained for the process

- Surface: `MosaicAnalyticsLifecycleRegistry`,
  `MosaicAnalyticsRuntimeRegistry`, `MosaicExperimentAssignmentStoreRegistry`.
- Platforms: iOS.
- Symptom: the analytics lifecycle observer and the per-endpoint runtime and
  assignment stores are installed once per endpoint/key namespace and are never
  removed. Reconfiguring the SDK against a new key adds a namespace rather than
  replacing one, so an app that reconfigures many times over one process
  lifetime accumulates a small number of retained actors and
  `NotificationCenter` observers.
- Workaround: configure Mosaic once per process, which is the documented usage.
- Planned resolution: registry eviction keyed to handle lifetime, tracked
  post-GA (audit finding P3).
- GA safety: growth is bounded by the number of distinct endpoint/key pairs a
  host configures, which is one in normal use. No unbounded growth per
  presentation, refresh, or purchase.

### Unreachable local persistence silently degrades to memory

- Surface: `Mosaic.configure(publicSDKKey:baseURL:…)`.
- Platforms: iOS.
- Symptom: when the Application Support directory cannot be resolved,
  `configure` no longer throws. It degrades to process-lifetime storage for the
  configuration cache, installation identity, assignment replay records, and
  the analytics queue, keeps the bundled fallback reachable, and records the
  safe diagnostic `delivery_persistence_unavailable`. In that state the
  installation identifier rotates on every launch, so install-bucketed
  Experiment assignments are not stable across launches for the affected host.
- Workaround: inspect `configurationStatus()` diagnostics during development.
  The condition requires a genuinely unusable container and does not occur on a
  healthy device.
- Planned resolution: none planned; failing the host application's launch is
  the worse behaviour.
- GA safety: this is the mandated safe-failure path. It is preferred over a
  throwing `configure`, and the degradation is observable through diagnostics
  rather than silent to the developer.

## Protocol

Each entry is owner-accepted for v1 General Availability. Neither falls into a
release-blocker category: neither can cause data loss, money loss, or a wrong
monetization decision, and each has a stated workaround or a safe visible
failure.

### Browser-contract generation is not extended to the Phase 5-7 contracts

- Surface: `protocol/browser/`, generated by
  `protocol/tools/generate-browser-contract.mjs`.
- Platforms: Studio and any browser-side validation (Chrome/Edge 111+, Safari
  16.4+, Firefox 128+).
- Symptom: the generated browser contract covers Paywall Protocol `0.2`,
  Local Preview `0.2`, Configuration Delivery `1`, Placement Decision `1`, and
  Commerce Provider/Configuration `1`/`2`. It has **not** been extended to
  Configuration Delivery `3`, Experiment Assignment `1`, or Analytics Event
  `1`/`2`. Browser-side code therefore has no generated declarations for those
  three contracts and cannot dispatch or validate them client-side.
- Workaround: those contracts are validated server-side on every path that
  accepts them — `apps/api/internal/analytics/validation.go` for analytics
  ingestion, and the Configuration Delivery v3 and Experiment Assignment
  validators for publication. Studio never needs to validate an Experiment
  Assignment or an analytics event in the browser: it authors Experiments through
  the API, which validates them. The canonical schemas and semantic validators in
  `protocol/tools/` cover all three contracts under
  `npm --prefix protocol run validate`.
- Planned resolution: deferred to post-GA. Extending generation is additive
  tooling work with no contract change; it was deliberately excluded from the
  Phase 8 feature freeze because no GA path requires it.
- GA safety: no validation is missing, only a second client-side copy of it.
  Every document of these contracts passes through a server-side validator before
  it is stored or delivered, and unknown or malformed material fails closed and
  retains last-known-valid configuration. There is no path on which a browser
  accepts material the server would reject.

### Commerce Provider fixtures are tool-verified but not SDK-consumed

- Surface: `protocol/fixtures/commerce-provider/v1/` and
  `protocol/fixtures/commerce-provider/v2/`.
- Platforms: Flutter, iOS, Android.
- Symptom: these fixtures are validated by
  `protocol/tools/commerce-provider-validation-v1.mjs` and its v2 counterpart
  under `npm --prefix protocol run validate`, but no SDK conformance suite reads
  them. The SDKs' commerce adapters are tested against their own test doubles
  instead. A divergence between an SDK's provider-record decoder and the
  canonical contract would therefore not be caught by the shared fixtures — only
  by the SDK's own tests, which were written from the same documentation rather
  than from the canonical bytes.
- Workaround: the contract is enforced at the boundary that matters for
  correctness. Provider records are produced by Mosaic's own adapters, not by
  untrusted input, and every adapter is contract-tested. The canonical fixtures
  remain the authoritative reference for anyone implementing a new adapter.
- Planned resolution: bind the fixtures into the three SDK conformance suites
  post-GA, as was done for the assignment-vector fixtures. Not done in Phase 8:
  it requires coordinated changes in all three SDKs during a feature freeze, and
  the risk it addresses is a divergence that no evidence suggests exists.
- GA safety: commerce adapters are already documented as not live-verified
  against RevenueCat, Apple, or Google Play sandboxes (owner decision D10). This
  entry narrows that same gap rather than adding a new one. No incorrect Product
  resolution or purchase-result corruption is possible from a fixture not being
  read by a test; the adapters' own contract tests cover the decode paths.
