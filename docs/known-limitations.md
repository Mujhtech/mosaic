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
