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
  `0.3.0-dev.1` / `0.1.0-dev.1`. `flutter pub add mosaic_sdk` cannot resolve
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

Each entry is owner-accepted for v1 General Availability. No entry falls into a
release-blocker category: none can cause data loss, money loss, or a wrong
monetization decision, and each has a stated workaround or a safe visible
failure.

### Billing webhook internals still stamp a Contract `1` envelope

- Surface: `apps/api/internal/billingwebhook/model.go` (`ContractVersion = "1"`)
  and the emission paths that read it.
- Platforms: server; any application backend consuming Mosaic billing webhooks.
- Symptom: Billing State Webhook `1` was deleted under the single-version policy
  ([ADR-0028](architecture/decisions/0028-single-version-contracts.md)) and `2`
  is the only contract, but the webhook emitter still stamps
  `billingStateWebhookContractVersion: "1"` on some envelopes. A strict `2`
  consumer reading the discriminator exactly would reject those deliveries.
- Workaround: none needed today. Nothing outside this repository consumes Mosaic
  billing webhooks, which is the same premise the single-version policy rests
  on, and the documented consumer posture for this contract is tolerant reading
  (see [compatibility policy](protocol/compatibility-policy.md#webhook-consumer-tolerance-is-a-documented-exception)).
- Planned resolution: the backend agent is adding code-site comments now; the
  re-stamp itself is deferred to a billing-domain design pass, because the
  emitter's version constant is entangled with the projection and delivery-retry
  records rather than being a single literal.
- GA safety: the protocol artifacts — schema, fixtures, manifest, signature
  vectors — are all `2` and self-consistent, so the contract Mosaic *publishes*
  is correct. The gap is that one producer has not been moved to it yet, and a
  producer stamping an old version fails closed at a strict consumer rather than
  delivering wrong billing state.

### The entrance-replay suppression rule has no SDK reader implementation

- Surface: `motion.playedAppearScreens` in Local Preview `0.4`; see
  [the rule](protocol/local-preview-v0.4.md#the-entrance-replay-suppression-rule).
- Platforms: Flutter, iOS, Android preview clients; Studio live preview.
- Symptom: the rule is **normative** and has a reference implementation
  (`runtimeStateForAcceptedV04Revision` in
  `protocol/tools/validation-v0.4.mjs`) pinned by
  `protocol/fixtures/local-preview/v0.4/accepted-revision-runtime-reset.json`,
  but no SDK preview reader implements it and the browser runtime's
  `runtimeStateForAcceptedRevision` does not emit the member. A preview client
  built today replays every entrance on every accepted revision — the exact
  strobing the rule exists to prevent.
- Workaround: none. Authors working on a document with appear motion see the
  entrance replay while editing.
- Planned resolution: the Studio live-preview wave, which is the first consumer
  that needs it. Deliberately not implemented ahead of that consumer: a runtime
  member no client reads would be an unexercised second implementation of a rule
  the validator already owns.
- GA safety: Local Preview is development-only (`audience:
  "developmentOnly"`) and never reaches an end user. The failure mode is a
  distracting authoring experience, not a wrong paywall.

### The entitlement corpus pins an SDK version floor no shipping SDK meets

- Surface: `minimumSupport.minimumSdkVersion: "2.0.0"` across
  `protocol/fixtures/authoritative-entitlement/v2/`.
- Platforms: Flutter, iOS, Android.
- Symptom: the canonical Authoritative Entitlement fixtures declare a minimum
  SDK version of `2.0.0`, while every shipping Mosaic SDK is `0.x`. A reader
  comparing its own version against the fixture's floor concludes it is
  unsupported and resolves to `authorityUnavailable`.
- Workaround: the fixtures are conformance material rather than served
  responses; a live server computes `minimumSupport` from its own frozen support
  policy, not from these values.
- Planned resolution: **needs an owner ruling** on what the floor means before
  any SDK implements the comparison. Two readings are open, and they behave
  differently at `0.x`: the floor is a *product* SDK version (in which case the
  fixture is simply wrong and should be `0.x`), or it is an entitlement-contract
  support generation that happens to be numbered independently (in which case
  the comparison is not against the SDK's published version at all). Nobody has
  chosen, and picking one silently in a fixture would decide it by accident.
- GA safety: the contract is a draft, nothing produces or consumes it in
  production, and the ambiguity is in unimplemented comparison semantics rather
  than in shipped behaviour.

### The capability report has a different shape in each SDK

- Surface: the Local Preview capability report; for example
  `MosaicPreviewSupportedCapability` list in
  `sdk/android/.../LocalPreviewModels.kt` against the map form in
  `.../ProtocolModels.kt`, with the Flutter and iOS clients differing again.
- Platforms: Flutter, iOS, Android.
- Symptom: the three SDKs model `supportedCapabilities` and
  `previewCapabilities` with different in-memory shapes (list of pairs versus
  map, and different treatment of the version field). Each serialises to a valid
  report, so the wire contract holds, but there is no shared rule about the
  internal shape and no cross-SDK test asserting the three produce the same
  report for the same capability set.
- Workaround: the protocol validator checks the serialised report against the
  message schema, which is the only form that crosses a boundary.
- Planned resolution: a cross-SDK rule fixing one shape, then a conformance
  vector all three read — the pattern already used for motion frames and locale
  resolution. Deferred until the Studio preview wave gives all three a reason to
  be compared.
- GA safety: divergence is confined to the in-memory representation; the
  serialised report is schema-validated on the relay before any draft is sent,
  and a malformed report withholds the draft atomically.

### iOS UIKit-gated tests run in no CI job

- Surface: `sdk/ios/Tests/MosaicSDKTests/SwiftUISnapshotTests.swift` and every
  `#if canImport(UIKit)` test — the pixel goldens and the terminal-state pixel
  proof of ADR-0027's rule among them.
- Platforms: iOS.
- Symptom: these tests compile and run only in the simulator-hosted
  `MosaicExampleTests` target, which CI does not build; macOS `swift test`
  skips them by construction. The target was silently unbuildable for a period
  without any signal, which is how a mis-recorded golden pair and a broken
  terminal-state test went unnoticed until 2026-08-14 (both since fixed: the
  goldens are re-recorded deterministically through the disabled motion
  driver, and the terminal-state test passes).
- Workaround: run the simulator suite manually before release-significant
  renderer changes.
- Planned resolution: wire a macOS/simulator CI job that builds and runs
  `MosaicExampleTests`; owner decision alongside the Android emulator-job
  question.
- GA safety: the structural and semantic iOS suites run in CI and stay green;
  only pixel-level regression detection is manual until the job exists.

### Eleven Analytics Event names have no canonical fixture

- Surface: `protocol/fixtures/analytics-event/v2/`; the floor is
  `ANALYTICS_EVENT_NAME_COVERAGE_FLOOR` in
  `protocol/tools/analytics-event-validation-v2.mjs`.
- Platforms: Flutter, iOS, Android; analytics ingestion.
- Symptom: the canonical corpus exercises 20 of the 31 declared event names.
  These 11 have never had a fixture at any contract version:
  `placement_unavailable`, `paywall_dismissed`, `paywall_action_selected`,
  `product_load_started`, `product_load_completed`, `product_load_failed`,
  `purchase_pending`, `purchase_deferred`, `restore_started`,
  `restore_cancelled`, `restore_failed`. Their correlation and attribution
  allow-lists are therefore pinned by the validator's tables alone, with no
  document any SDK can be reconciled against.
- Workaround: every event is schema-validated and semantically validated on
  ingestion regardless of whether a fixture exists for its name, so an SDK
  emitting one of these wrongly is rejected at the boundary rather than silently
  accepted.
- Planned resolution: author the missing fixtures from real emissions. This is
  pre-existing — the Contract `1` corpus did not cover them either — and the
  coverage floor now prevents the set shrinking further. Raise the floor as
  fixtures land; never lower it to make a check pass.
- GA safety: nothing is unvalidated, only unexemplified. The gap is in
  cross-SDK conformance material, not in the ingestion path.

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

- Surface: `protocol/fixtures/commerce-provider/v2/`.
- Platforms: Flutter, iOS, Android.
- Symptom: these fixtures are validated by
  `protocol/tools/commerce-provider-validation-v2.mjs`
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

### A few fixtures remain unconsumed, and invalid-fixture coverage is uneven across SDKs

- Surface: `protocol/fixtures/configuration-delivery/v3/capability-request.json`
  and the invalid fixtures under
  `protocol/fixtures/configuration-delivery/v3/invalid/` and
  `protocol/fixtures/experiment-assignment/v1/invalid/`.
- Platforms: Flutter, iOS, Android.
- Symptom: the Delivery v3 capability request is validated by
  `npm --prefix protocol run validate` but read by no SDK conformance suite. The
  entry previously also named the Delivery v1 capability request and the v3
  legacy-v2 projection; both were deleted with Delivery `1`/`2` under
  [ADR-0028](architecture/decisions/0028-single-version-contracts.md), so that
  part of the gap closed by removal rather than by binding. Separately, the
  Delivery v3 and
  Experiment Assignment negative fixtures are consumed by the iOS suite alone
  (`sdk/ios/Tests/MosaicSDKTests/ExperimentTests.swift`), so Flutter and Android
  have no shared-fixture proof that they reject a malformed allocation or an
  unsupported Experiment contract.
- Workaround: every one of these fixtures is validated against the canonical
  schemas and semantic validators under `npm --prefix protocol run validate`, so
  the fixtures themselves cannot drift from the contract. Rejection of malformed
  Delivery material is additionally enforced server-side before anything is
  stored or delivered, and each SDK has its own decode-failure tests written
  against the same rules.
- Planned resolution: bind the unconsumed fixtures and the two negative
  directories into all three SDK conformance suites post-GA, together with the
  Commerce Provider fixture binding described above.
- GA safety: the gap is missing *cross-SDK evidence*, not missing validation. A
  divergence would surface as an SDK rejecting a document it should accept, or
  accepting one the server never emits; both fail closed onto last-known-valid
  or bundled configuration rather than rendering wrong material.

### A locale with a script subtag resolves to its base language, never to language+region

- Surface: `localization.locales` keys in
  `protocol/schema/v0.4/paywall.schema.json` (`localeTag`), the candidate chain
  documented in [`docs/protocol/v0.4.md`](protocol/v0.4.md), and its reference
  implementation `protocol/tools/locale-resolution.mjs`. (The behaviour is
  unchanged since `0.2`; only the paths moved as versions were replaced.)
- Platforms: Flutter, iOS, Android.
- Symptom: catalog keys are `language[-REGION]`; the grammar admits no script
  subtag. A device reporting `zh-Hans-CN` or `zh-Hant-TW` therefore walks
  requested tag (never a key) → base language `zh` → `fallbackLocale` →
  `defaultLocale`. A `zh-CN` catalog declared in the same document is not a
  candidate and cannot be reached by a Simplified-Chinese device, and Simplified
  and Traditional readers collapse onto the same `zh` catalog.
- Workaround: author the base-language catalog (`zh`) as the one Chinese
  audiences receive, and use it for the variant with the larger audience.
  A region-specific catalog is still reachable by any device that reports
  `zh-CN` without a script subtag.
- Planned resolution: deferred to the next Paywall Protocol version, where it
  belongs with script-aware catalog keys rather than alone. Inserting a
  language+region reduction step (`zh-Hans-CN` → try `zh-CN` before `zh`) into
  `0.2` was considered and **rejected**: unlike the case-insensitivity and
  extension-truncation clarifications made alongside it, it changes a step the
  contract already defines, so a document declaring both `zh` and `zh-CN` would
  silently serve already-shipped devices a different catalog than before, with
  no negotiation handle and no way for an author to opt out. It also only proxies
  script through region, so it does not fix the Hans/Hant collapse that is the
  real defect. `0.2` is approved and immutable; this is a version-bump change.
- GA safety: resolution stays inside the author's own declared catalogs and can
  never fail to produce text — the chain always terminates at the default
  catalog and then the component's inline default. The consequence is a
  less-specific translation, not a wrong price, a wrong Product, or a render
  failure.

### Three Experiment guardrail metrics always report zero

- Surface: seeded `experiment_metric_definitions` (`product_unavailable`,
  `provider_unavailable`, `paywall_render_failure`), consumed by Experiment
  results; contract side is
  `protocol/schema/analytics-event/v2/event.schema.json` attribution
  allow-lists.
- Platforms: all (backend aggregation; no platform-specific behaviour).
- Symptom: these three guardrail metrics always report `unique_conversions = 0`,
  regardless of how many underlying failures occur. Their numerator events —
  `product_unavailable` and `paywall_render_failed` — are **forbidden** by the
  approved Analytics Event `2` attribution allow-lists from carrying the
  Experiment tuple. The aggregation matches a numerator by equality on the
  event's own `experiment_version_id` and `experiment_variant_id`
  (`apps/api/internal/platform/analyticspostgres/jobs.go`), and those columns are
  always NULL for these events, so no conversion ever matches. No SDK can satisfy
  these metrics without emitting attribution the contract rejects at ingest. The
  remaining eight seeded metrics are satisfiable and unaffected.
- Affected users: experimenters relying on these three guardrails to detect
  Product-availability, provider-availability, or Paywall render regressions
  during an Experiment. Primary metrics, exposure counts, fallback counts, and
  all conversion metrics are unaffected.
- Workaround: monitor the underlying events outside Experiment context. Both
  `product_unavailable` and `paywall_render_failed` are ingested, stored, and
  counted normally in environment-wide analytics; they are visible in the funnel
  and event counts, just not attributable to a Variant. Pair that with the
  Experiment's exposure and `fallback_exposure` counts, which do work, to detect
  a Variant-specific regression.
- Planned resolution: Analytics Event `3` post-GA. Widening an approved
  contract's attribution allow-lists is a behaviour change and therefore requires
  a new contract version — see `docs/protocol/breaking-change-process.md`. Tracked
  for that version rather than patched in place.
- GA safety: these metrics **fail closed at zero rather than reporting a wrong
  value.** A guardrail reading zero cannot cause a wrong monetization decision,
  cannot corrupt exposure or conversion attribution, and cannot cause data or
  money loss. It can only fail to surface a regression that remains visible in
  environment-wide analytics. This falls outside every release-blocker category:
  it is not exposure corruption (no exposure or conversion is mis-attributed), not
  analytics duplication, and not a wrong Entitlement or Product decision.
  Owner-accepted at the Phase 8 gate.

## Server and platform

Each entry is owner-accepted for v1 General Availability. None falls into a
release-blocker category: none can cause data loss, money loss, or a wrong
monetization decision, and each has a stated workaround or a safe visible
failure.

### Signup is deliberately ungated in the application

- Surface: `POST /v1/auth/signup`.
- Platforms: server (all installations).
- Symptom: anyone who can reach the endpoint can create an account. There is
  no invitation, allow-list, or toggle in the application itself.
- Workaround: restrict the endpoint at your reverse proxy or firewall after
  creating your administrator accounts. The
  [installation guide](guides/installation.md) shows a Caddy example; verify
  the block with `curl` against your edge after deploying it.
- Planned resolution: none planned in the application; edge restriction is the
  supported model. Owner decision D9.
- GA safety: an operator responsibility documented at the exact step where the
  first account is created. A rogue signup gains an empty workspace, not access
  to any existing Organization's data.

### Commerce adapters are not live-verified against store sandboxes

- Surface: RevenueCat, StoreKit 2, and Google Play Billing adapter paths across
  server and SDKs.
- Platforms: all.
- Symptom: the adapters are implemented and contract-tested, and the
  mock/custom commerce path passed the GA drill (D13), but no purchase has been
  executed against the RevenueCat sandbox, the Apple sandbox, or a Google Play
  test track. That evidence layer is "not demonstrated", never implied as
  working.
- Workaround: verify your own provider path in your store's sandbox before
  production rollout, as you would for any billing integration.
- Planned resolution: live sandbox verification post-GA. Owner decision D10.
- GA safety: an environmental verification gap, explicitly labelled. The
  four-state Entitlement contract fails safe: a provider failure is surfaced as
  a provider failure, never rendered as "not entitled".

### Irreversible down-migrations refuse; the rollback path is restore from backup

- Surface: `migrate down` / `down-to` over migrations `00006`, `00010`,
  `00018`.
- Platforms: server (operators).
- Symptom: with `--confirm`, these three migrations still refuse to roll back
  when affected data exists (provider Product mappings, Delivery v2/v3
  Releases, Analytics Event v2 rows, Release-to-Experiment links), naming the
  exact rows that would be destroyed. The refusal is final; there is no force
  flag.
- Workaround: the supported rollback is
  [restore from backup](backend/operations/backup-restore.md) — the refusal's
  HINT names that document. Take the documented backup (database + object
  storage + keyring) before every upgrade.
- Planned resolution: none planned; refusing is the design (R2). A forced
  destructive rollback is the worse behaviour.
- GA safety: the refusal fails closed and destroys nothing. Data loss is
  possible only by deliberately restoring an older backup, which is the
  operator's explicit, documented action.

### Experiment statistics are descriptive only

- Surface: Experiment results (`GET .../experiments/{id}/results` and the
  dashboard results panel).
- Platforms: all.
- Symptom: results report Wilson intervals, Newcombe lift intervals, and SRM
  warnings, but apply no peeking correction and no multiple-comparison
  correction, and never declare a winner or take an automatic action. Repeated
  looks at a running Experiment inflate the effective false-positive rate, and
  nothing in the product corrects for that.
- Workaround: decide your sample size and stopping rule before starting, treat
  intervals as descriptive, and heed SRM warnings before drawing conclusions.
- Planned resolution: none planned; this is deliberate documented scope, not a
  gap to be closed. Honest descriptive statistics were chosen over automated
  inference.
- GA safety: the product makes no claim it cannot support — there is no winner
  field or significance badge to be wrong. The interpretation risk is
  documented where the numbers are read.

### A second Variant Paywall Version requires a throwaway staging Placement

- Surface: Experiment Variant setup; hosted publishing.
- Platforms: all (dashboard/API workflow).
- Symptom: every Variant must pin a distinct immutable Paywall Version, and a
  Paywall Version is only minted by publishing the Paywall through a Placement
  binding. To produce a treatment Version without changing live traffic, you
  must bind the treatment Paywall to a throwaway Placement (typically in a
  staging Environment) and publish there.
- Workaround: create a staging Placement per treatment, bind, publish to mint
  the Version, then pin that Version in the Experiment. The Placement can be
  left unused afterwards.
- Planned resolution: a direct mint-a-Version path is a post-GA design item;
  changing publish semantics during the Phase 8 feature freeze was ruled out.
- GA safety: a workflow inconvenience only. The resulting Versions are
  immutable and correctly pinned; no delivery or attribution behaviour is
  affected.

### Experiment publish requires a published Placement rule set in the Environment

- Surface: `POST .../experiments/{id}/publish`.
- Platforms: all (server).
- Symptom: an Experiment can only publish into an Environment whose current
  Configuration Release already carries a Placement Decision representation
  (Delivery v2), i.e. a Placement rule set has been published there. Without
  one, publish fails with `409 experiment_placement_decision_required`, whose
  message names the required action.
- Workaround: publish a Placement rule set in the Environment first, then
  publish the Experiment.
- Planned resolution: auto-upgrading a v1 Release is a design decision tracked
  post-GA.
- GA safety: a named, actionable 409 that fails closed before anything is
  written. No Release is created and delivery is unchanged.

### Overview metrics carry no revenue, and its purchase tiles are client-observed

- Surface: `GET .../environments/{environmentId}/overview-metrics`.
- Platforms: all (API consumers, dashboard).
- Symptom: two gaps a reader will notice against a commercial analogue.
  1. There are no monetary metrics — no revenue, no MRR, no ARPU. Mosaic's
     Billing Transaction Facts record no price and no currency at all, so these
     are not derivable from anything Mosaic stores rather than merely unwired.
  2. `purchases` and `conversionRate` report client-observed purchase
     completions, marked `authority: "client_observed"`. Mosaic declares
     provider-confirmed purchase metrics but does not compute them yet, so
     reporting these tiles from provider-confirmed data would leave them
     permanently unavailable.
- Workaround: for provider-validated purchase volume use
  `subscriptions.newToday` / `newYesterday`, which are derived from validated
  Transaction Facts (`authority: "provider_validated"`). There is no workaround
  for revenue.
- Planned resolution: monetary metrics require capturing price and currency on
  the Fact, which is a Phase 9 schema decision. The response's `metrics` object
  is closed, so adding a `revenue` group later is additive and breaks no
  existing consumer.
- GA safety: nothing is fabricated. Every metric states its `authority`, and no
  monetary field is offered as an always-unavailable placeholder that would be
  indistinguishable from a broken one.

### Overview customer counts exclude customers with no projected purchase

- Surface: `GET .../environments/{environmentId}/overview-metrics`.
- Platforms: all (API consumers, dashboard).
- Symptom: `customers.total` and the `new*` counts include only Billing
  Customers holding a committed entitlement pointer in the Environment. A
  customer created by a trusted-server identify call whose purchase has never
  projected — or whose lineage is frozen by an open identity conflict — is not
  counted, so the overview can report fewer customers than the operator console
  lists for the Project.
- Workaround: use the operator customer list
  (`GET .../environments/{environmentId}/billing/customers`) for the full
  population; it is Project-scoped identity with per-Environment state.
- Planned resolution: a Billing Customer row is Project-scoped by design (a
  customer is one identity across sandbox and production), and the entitlement
  pointer is the only per-Environment record that a customer exists there.
  Reporting a Project-wide count on an Environment-scoped page would show the
  sandbox population on the production overview, which is the worse error.
- GA safety: an under-count with a stated definition, never an over-count, and
  never presented as a Project total.

### The overview series withdraws all four funnel lines when either read fails

- Surface: `GET .../environments/{environmentId}/overview-metrics/series`.
- Platforms: all (API consumers, dashboard).
- Symptom: the analytics half of the chart is composed from two reads — the
  completed days from the daily aggregates, today from raw events — and if
  either fails, all four analytics series report `available: false` with
  `metric_unavailable` rather than drawing the days that did answer. The billing
  series are unaffected, and vice versa.
- Workaround: retry, or read the same measures per window through
  `.../analytics/overview`, which is a separate query path.
- Planned resolution: none intended. A line drawn with its most recent day or an
  interior week missing reads as a collapse in the product, not as missing data,
  and a chart that lies is worse than a chart that is absent.
- GA safety: fails visibly and per series, with a code the dashboard already
  maps. Nothing is fabricated and no missing day is drawn as a zero.

### Overview series points can change after the fact for up to seven days

- Surface: `GET .../environments/{environmentId}/overview-metrics/series`.
- Platforms: all (API consumers, dashboard).
- Symptom: Mosaic accepts analytics events for seven days after they occur and
  rebuilds the UTC day they belong to, so a completed day's point can rise on a
  later read. Today's point additionally moves throughout the day; it is the
  only one marked `partial: true`. The billing series carry the same caveats the
  scalar overview does — no revenue, and `purchases`/`conversionRate` are
  client-observed rather than provider-confirmed.
- Workaround: read `analyticsFreshness` alongside the series; it publishes the
  same watermark and the late-event policy the analytics endpoints do.
- Planned resolution: none intended. Refusing late events would lose data from
  offline devices, which is the worse trade for a mobile SDK.
- GA safety: the restatement direction is upward and bounded to seven days, the
  in-progress day is labelled, and the freshness surface states the policy.

### Analytics query 422s do not name the missing parameter

- Surface: analytics query endpoints (`.../analytics/overview` and related).
- Platforms: all (API consumers).
- Symptom: these endpoints require `timezone` and `metricBasis`; omitting one
  returns `422 validation_failed` without a `fields` map naming the missing
  parameter, unlike other validation errors.
- Workaround: always send both parameters; consult the API reference for each
  endpoint's required query parameters.
- Planned resolution: add the `fields` detail post-GA, same class as the error
  details added during the drills.
- GA safety: a diagnosability gap on a read-only path. The request fails
  closed with the correct status; no data is returned or mutated.

### The entitlements-changed webhook pipeline still emits the deleted v1 wire format

- Surface: `webhook_events` written by the billing projection
  (`internal/platform/billingprojectionpostgres`), webhook destinations
  defaulting to contract 1 (`internal/billingwebhook`).
- Platforms: server (all installations).
- Symptom: ADR-0028 deleted Billing State Webhook v1 — it has no schema,
  fixtures, or validator anywhere in the repository — but
  `customer.entitlements.changed` events are still stored and delivered in the
  v1 wire format, and newly registered destinations default to contract 1 so
  they can receive them. Only authority-transition events
  (`billing_migration` cutover/rollback/stabilization) use the published v2
  contract.
- Workaround: consumers of `customer.entitlements.changed` validate against the
  delivered body's documented fields rather than a published schema; the body
  is stable, signed, and byte-identical across replays. Authority events can be
  validated against `protocol/schema/billing-state-webhook/v2/`.
- Planned resolution: a billing-domain design pass that emits v2
  entitlements-changed events. v2's `billingStateEvent` requires the authority
  block (`authorityEpoch`, `applicationId`+`platform` scope,
  `snapshotAuthorityDigest`), which means fanning one per-customer projection
  event out per authority scope — a change to event identity and idempotency,
  not a constant flip. Flipping the version without it would emit
  schema-invalid events or silently stop entitlements-changed delivery.
- GA safety: the format is internal-to-Mosaic on both ends of the signature and
  has not changed; deliveries keep working exactly as before ADR-0028. No data
  or money decision depends on the envelope's version marker.

## Dashboard

Each entry is owner-accepted for v1 General Availability. None falls into a
release-blocker category: none can cause data loss, money loss, or a wrong
monetization decision, and each has a stated workaround or a safe visible
failure.

### Server-rendered HTML is always the anonymous view (SSR cookie caveat)

- Surface: dashboard server rendering; the `_hosted` route guard.
- Platforms: all supported browsers.
- Symptom: the server render never sees the browser's session cookie, so
  server-rendered HTML is always the anonymous view; session-scoped data is
  not prefetched during SSR, and the hosted route guard runs on the client
  only. Hosted pages show a brief loading state before the authenticated view
  appears after hydration.
- Workaround: none required; the loading state is momentary.
- Planned resolution: none planned for v1; a server-side guard would redirect
  every authenticated operator to the sign-in page.
- GA safety: safe by construction — no tenant data can ever be rendered for
  the wrong session. The only cost is the brief loading state.

### The hosted workspace is desktop-first

- Surface: the hosted workspace (`/workspace` and its subtree).
- Platforms: all supported browsers; tablets and phones.
- Symptom: like Studio (which is desktop-only, ≥768 px, with a safe fallback
  screen), the hosted workspace is laid out for desktop widths. It remains
  usable on a tablet, but wide tables and the Studio-adjacent panels are not a
  supported phone experience.
- Workaround: use a desktop browser for operating Mosaic.
- Planned resolution: none planned for v1; operator tooling is desktop-first
  by design.
- GA safety: a layout limitation only. Nothing fails silently — narrow Studio
  viewports get an explicit fallback state, and no data-mutating flow is
  phone-only.

### No client-side error reporting, by design

- Surface: the whole dashboard.
- Platforms: all supported browsers.
- Symptom: the dashboard ships no Sentry, telemetry beacon, or automatic crash
  upload, so browser-side failures are not collected anywhere automatically.
- Workaround: every API failure surfaces an `X-Request-ID` correlation
  identifier in error boundaries and on `/diagnostics`, with a copy control;
  diagnose by searching the API logs for that identifier
  ([dashboard operations](dashboard/operations.md)).
- Planned resolution: none planned; a self-hosted operator's users must not
  have their browsing forwarded to a third party, and Mosaic has no service to
  forward it to.
- GA safety: a deliberate privacy decision with a documented diagnostic path;
  server-side causes remain fully logged and correlated.

### The sign-in and sign-up pages have a Separator rendering glitch

- Surface: the Separator component on the login and sign-up pages.
- Platforms: all supported browsers.
- Symptom: the visual divider between the form and its alternate action can
  render incorrectly (found in QA). Purely cosmetic; both pages remain fully
  functional and accessible.
- Workaround: none needed; sign-in and sign-up work normally.
- Planned resolution: cosmetic fix in the first post-GA maintenance release.
- GA safety: a visual defect on an authentication page with no functional,
  security, or data impact.

### Mosaic does not acknowledge Google Play purchases

- Surface: Mosaic Billing, Google Play validation.
- Platforms: Android.
- Symptom: Mosaic validates a Google purchase but never calls
  `acknowledge`. Google auto-refunds an unacknowledged purchase after three
  days (five minutes for license testers), so an application that relies on
  Mosaic to acknowledge will silently lose those purchases.
- Workaround: none needed for apps using the Mosaic Play Billing adapter, which
  acknowledges client-side as it always has. An app that acknowledges nowhere
  must add it.
- Planned resolution: none for 9A. Acknowledgement asserts that goods were
  delivered — an entitlement act — and Phase 9A grants nothing. Coupling a
  customer's three-day refund window to Mosaic's availability is not an
  acceptable trade for a phase whose promise is evidence, not access.
- GA safety: unchanged from before Mosaic Billing existed; acknowledgement has
  always been the application's responsibility, and this records it explicitly.

### A transaction may carry more than one Transaction Fact

- Surface: Mosaic Billing ledger, and any consumer reading
  `billing_transaction_facts`.
- Platforms: all.
- Symptom: one store transaction can produce several fact rows. Two routes
  reporting the same transaction (a store notification and a client
  observation) make two *statements* that differ in what they know — the
  notification carries renewal information the observation cannot — and both
  are recorded. A change in Product-mapping history produces another. **The
  count of facts is a count of distinct statements, not of purchases.**
- Workaround: consumers must select over facts grouped by
  `(environment, provider, provider_transaction_id)` and prefer the
  notification-sourced statement; they must never count facts as purchases.
- Planned resolution: none for 9A, deliberately. Duplicate *delivery* still
  produces exactly one fact and replay still produces none, so the ledger is
  not noisy — it is honest. Collapsing the two would mean discarding the more
  informative statement whenever the poorer one arrived first, which is a worse
  failure than a second row. Changing fact identity alters a `UNIQUE`
  constraint and the meaning of every existing row, so it belongs to 9B with a
  migration.
- GA safety: an append-only evidence ledger recording what each route said. No
  data is lost or overwritten; the risk is purely one of misreading, which the
  documented selection rule addresses.

### Apple transaction-history reconciliation is not implemented

- Surface: Mosaic Billing reconciliation.
- Platforms: iOS.
- Symptom: only `apple_notification_history` and `google_token_requery` run.
  `apple_transaction_history` exists in the stored enumeration for forward
  compatibility but has no worker loop.
- Workaround: `apple_notification_history` covers the gap that matters — Apple
  retries a failed notification five times and never in sandbox, so recovering
  missed notifications is the recovery path operators actually need.
- Planned resolution: the API rejects the value with a clear validation error
  and the dashboard does not offer it, so it is unreachable rather than
  silently broken. The loop is a follow-up.
- GA safety: no operator can reach a strategy that cannot succeed.

### Live store sandbox verification has not been performed

- Surface: Mosaic Billing, both providers.
- Platforms: iOS and Android.
- Symptom: no Apple sandbox purchase and no Google Play test purchase has been
  run end to end against Mosaic. The Apple JWS verifier has never seen a real
  Apple signature, and the Google OAuth exchange and Pub/Sub pull have never
  been executed against live Google.
- Workaround: verification uses synthetic signed vectors and constructed
  provider payloads throughout, including a generated certificate chain that
  exercises algorithm confusion, foreign roots, and tampered payloads.
- Planned resolution: an operator follow-up recorded in the Phase 9A review.
  Live store accounts, signing keys, and real notification delivery cannot be
  provisioned in CI.
- GA safety: the security boundary is tested against adversarial synthetic
  input; what is unverified is Apple's and Google's real-world payload shape,
  which is a first-run risk rather than a correctness one.

### Migration 00008 cannot roll back against seeded Product-mapping data

- Surface: schema rollback, `migrate down-to` past version 8.
- Platforms: all.
- Symptom: rolling back migration 00008 fails against a database containing
  connection-less Provider Product Mappings, because 00008's own
  `provider_product_mappings_scope_shape_check` rejects data 00008 itself
  permits. `migrate down-to 0 --confirm` succeeds on a clean database and
  `migrate preflight` reports `compatible`.
- Workaround: restore from a backup rather than rolling back past 8 on a
  populated database, as `docs/backend/operations/backup-restore.md` already
  directs for destructive rollbacks.
- Planned resolution: filed as its own item. It is pre-existing and predates
  Mosaic Billing; Phase 9A neither introduced it nor made it worse, and 00027's
  own down/up path was verified against live billing data.
- GA safety: forward migration and preflight are unaffected; the failure mode
  is a rollback that refuses rather than one that destroys data.
