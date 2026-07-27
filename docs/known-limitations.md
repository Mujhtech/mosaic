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

### A few fixtures remain unconsumed, and invalid-fixture coverage is uneven across SDKs

- Surface: `protocol/fixtures/configuration-delivery/v3/legacy-v2-projection.json`,
  `protocol/fixtures/configuration-delivery/v1/capability-request.json`,
  `protocol/fixtures/configuration-delivery/v3/capability-request.json`, and the
  invalid fixtures under `protocol/fixtures/configuration-delivery/v3/invalid/`
  and `protocol/fixtures/experiment-assignment/v1/invalid/`.
- Platforms: Flutter, iOS, Android.
- Symptom: three valid fixtures are validated by
  `npm --prefix protocol run validate` but read by no SDK conformance suite. Only
  the Delivery v2 capability request is consumed (by the Android
  `PlacementDecisionTest`); the v1 and v3 capability requests and the v3
  legacy-v2 projection are tool-verified only. Separately, the Delivery v3 and
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

### Some export routes may sit in a broader rate-limit family than planned

- Surface: per-surface HTTP rate limiting (`auth`, `delivery`, `ingestion`,
  `api`, `decision` families); analytics export routes.
- Platforms: server (operators).
- Symptom: rate-limit families are narrower than originally planned for some
  export routes, which may share the general `api` family's budget rather than
  having their own. (Verify at integration — this entry is reconciled against
  the backend fix report for this round.)
- Workaround: tune the affected family's `MOSAIC_*_REQUESTS_PER_MINUTE` /
  `_BURST` variables; rejections are observable as
  `mosaic.http.rate_limit.rejections` by surface and carry `Retry-After`.
- Planned resolution: dedicated family assignment post-GA if confirmed.
- GA safety: limits fail closed with `429` and `Retry-After`; the only effect
  is coarser-grained throttling, never unthrottled traffic.

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
