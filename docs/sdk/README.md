# Mosaic Native SDKs

Mosaic renders paywalls natively on three platforms from one platform-neutral
protocol. There is no shared WebView renderer and no executable code inside
delivered configuration.

| Platform | Native surface                 | Package                                                        |
| -------- | ------------------------------ | -------------------------------------------------------------- |
| Flutter  | Flutter and Material widgets   | `sdk/flutter` (`mosaic_sdk`)                                   |
| iOS      | SwiftUI                        | `sdk/ios` (`MosaicSDK`)                                        |
| Android  | Jetpack Compose and Material 3 | `sdk/android` (`:mosaic`)                                      |

Optional commerce adapters are separate packages on every platform, so an
application that does not use a provider never links it:

| Provider           | Flutter                | iOS                    | Android                |
| ------------------ | ---------------------- | ---------------------- | ---------------------- |
| RevenueCat         | `mosaic_revenuecat`    | `MosaicRevenueCat`     | `:mosaic-revenuecat`   |
| StoreKit 2         | `mosaic_native_store`  | `MosaicStoreKit`       | not applicable         |
| Google Play Billing| `mosaic_native_store`  | not applicable         | `:mosaic-google-play`  |

## Capabilities at v1

All three SDKs provide the same conceptual capabilities:

- SDK configuration with an Environment-scoped public SDK key and a hosted or
  self-hosted base URL;
- strict Mosaic Protocol 0.2 decoding and native rendering;
- hosted Configuration Delivery with negotiation across contract versions 1, 2,
  and 3;
- crash-safe last-known-valid caching, bundled fallback configuration, and an
  explicit unavailable result, applied in that order;
- Placement resolution and local deterministic Placement Decision v1 evaluation
  with targeting, rollout, and QA overrides;
- Experiment Assignment v1: local deterministic SHA-256 bucketing, mutual
  exclusion, schedules, emergency stop, and conservative fallback;
- Product loading, selection, purchasing, restoration, and Entitlement
  observation through a provider abstraction, with mock and custom providers;
- Commerce Configuration v1/v2 sidecars bound to the accepted release;
- Analytics Event Contract v1 (and v2 for Experiment events) with a bounded,
  app-private, persistent queue and best-effort delivery;
- identity: installation identity, optional application user identity, typed
  attributes, and resets;
- normalized sealed result types for purchased, restored, already entitled,
  dismissed, cancelled, product unavailable, configuration unavailable, purchase
  failed, and rendering failed;
- safe structured diagnostics that never contain credentials;
- Local Preview 0.2 over a loopback-only WebSocket relay; and
- capability reporting to the backend.

Analytics delivery never blocks rendering or purchasing, and a Mosaic outage
never prevents cached or bundled rendering.

## Supported versions

| Item                        | Supported                                              |
| --------------------------- | ------------------------------------------------------ |
| Flutter / Dart              | Flutter 3.22 / Dart 3.4 minimum (the tested floor)     |
| iOS deployment target       | iOS 15.0 minimum; Swift 6.0 language mode; Xcode 16.0+ |
| Android                     | minSdk 24; compile/target SDK 36; Kotlin 2.2.10; JDK 17 |
| Protocol document           | Paywall 0.2                                            |
| Configuration Delivery      | 1, 2, 3 (exact-match readers, highest mutual wins)     |
| Commerce Provider Contract  | 1, 2                                                   |
| Commerce Configuration      | 1, 2                                                   |
| Placement Decision          | 1                                                      |
| Analytics Event Contract    | 1, 2                                                   |
| Experiment Assignment       | 1                                                      |
| Local Preview               | 0.2                                                    |

Unsupported contract versions fail safely: the SDK rejects the document and
retains its last-known-valid configuration.

## Distribution and installation

All three SDKs are **pre-1.0 (`0.x-dev`) and are not published to any package
registry** at v1 (owner decision D6). There is no pub.dev, CocoaPods trunk, or
Maven Central artifact to resolve. Installation is by Git pin at an exact tag or
commit, or by local path, on every platform. This is recorded in
`docs/known-limitations.md`.

- **Flutter**: a `git` dependency with `path: sdk/flutter` and an exact `ref`,
  or a `path:` dependency. See `sdk/flutter/README.md`.
- **iOS**: SwiftPM against the repository at an exact tag or revision, or a
  local package reference. The bundled podspec is not published to CocoaPods
  trunk. See `sdk/ios/README.md`.
- **Android**: a Gradle composite build (`includeBuild`) or a local path, or
  publish the modules to `mavenLocal()` or your own Maven repository from a
  pinned checkout. No `dev.mosaic.sdk` coordinate resolves from a remote
  repository. See `sdk/android/README.md`.

Because every SDK is pre-1.0, treat each version bump as potentially breaking,
read the SDK's `CHANGELOG.md` before upgrading, and pin exactly.

Each SDK reports its own artifact version to the backend in the
`Mosaic-SDK-Version` header, in the analytics context, and in its capability
report. On every platform that value is a single constant that equals the
package manifest version: `mosaicFlutterSdkVersion` (pubspec `version`),
`mosaicSDKVersion` (podspec `version`), and the Android wire constant (module
`version`). The authoritative number is always the manifest in the SDK
directory, not this document.

## Canonical protocol contract

The canonical fixture is:

```text
protocol/fixtures/v0.2/complete-paywall.json
```

No SDK owns a schema fork, and no SDK renames protocol fields without a decoding
boundary. Each platform binds to the canonical files differently because of how
its build system packages resources:

- **Flutter** conformance tests read the repository fixtures directly by walking
  up to the checkout root; `examples/flutter-example` generates an ignored
  byte-identical asset with `dart run tool/sync_fixture.dart`.
- **iOS** packages a byte-identical **checked-in copy** of the fixture. It is
  not a repository-relative symlink: SwiftPM copies symbolic links without
  rebasing their targets, which would produce a broken fallback in a built
  package. A package test prevents the copy from drifting.
- **Android** generates an ignored build asset from the canonical source before
  packaging.

Every decoder atomically rejects an unsupported version or capability, an
unknown property or component, an invalid reference, a duplicate identifier, a
localization inconsistency, and capability/content drift. Unknown optional
components follow the protocol's fallback rules rather than failing the
document.

## Equivalent renderer behaviour

All three SDKs:

- resolve locale by exact tag, base language, fallback locale, default locale,
  then inline default;
- derive direction independently from the first declared locale candidate;
- resolve store price and period data only through the injected commerce
  provider, never from configuration;
- omit unavailable products, preserve the configured selection when possible,
  otherwise select the first available reference, and show the declared fallback
  when none are available;
- treat initial product unavailability as an interaction-only notification and
  return terminal `productUnavailable` only for a purchase attempt or provider
  result;
- map purchase, restore, close, configuration, and rendering outcomes to the
  same normalized names;
- try the bundled fallback after a rejected candidate and report
  `configurationUnavailable` only when no document can be used;
- preserve image geometry when a logical bundled image is missing or invalid;
- expose native accessibility labels, hints and state, headings, selected
  product state, large-text layout, and RTL ordering;
- keep persistence failures safe: a failed cache, identity, or analytics write
  degrades to a diagnostic code and never crashes the host app; and
- report results without dismissing host-owned navigation or presentation UI.

## Intentional platform differences

Native typography, control chrome, focus visuals, scroll physics, safe-area
measurements, and glyphs remain platform-owned. SwiftUI and Flutter expose a
header trait but not the protocol's numeric heading level; Compose also retains
the level in a testable custom semantic key. Compose joins label and hint for
TalkBack because its stable semantics API has no separate hint property.

Presentation result payloads are idiomatic wrappers around the same normalized
outcome. Required product identity is always the document-local product
reference ID. Flutter may additionally return sets of local references for
restore and already-entitled results; Android may retain mock entitlement and
transaction metadata; SwiftUI keeps those payloads minimal. Diagnostics use
platform-native types while exposing only safe codes.

The protocol vocabulary is deliberately not unified across contracts:
`product_load` (Experiment Assignment) and `product_loading` (Placement
Decision) are distinct terms in distinct contracts, and no SDK renames either.

## Local preview behaviour

All three SDKs use `mosaic.local-preview.v0.2`. They identify the preview
client and report supported schema, renderer, and preview capabilities before
receiving a draft. They independently order document and mock-commerce
revisions, reject stale or conflicting updates, acknowledge only after the
native view applies a revision, reconnect with bounded backoff, and keep the
last accepted document on failure.

Local endpoints are credential-free and restricted to loopback, emulator-host,
private, link-local, or local-development hosts. Unsupported components,
invalid documents, missing products or assets, and render failures produce safe
structured diagnostics rather than crashing the host app.

Start Studio and its relay with `npm run dev:studio` from `apps/dashboard`.
Each example README documents its simulator or emulator endpoint.

## Build and test

### Flutter

```bash
cd sdk/flutter
dart format --output=none --set-exit-if-changed lib test example/lib
flutter analyze
flutter test
cd example && flutter build bundle --release --no-pub
```

The adapter packages are separate Flutter packages with their own suites:

```bash
cd sdk/flutter/packages/mosaic_revenuecat && flutter analyze && flutter test
cd sdk/flutter/packages/mosaic_native_store && flutter analyze && flutter test
```

The full scenario app is `examples/flutter-example`. Run
`dart run tool/sync_fixture.dart` before every build or launch: the bundled
fallback asset is generated and Git-ignored, so the build fails or falls back
without it.

```bash
cd examples/flutter-example
dart run tool/sync_fixture.dart
dart format --output=none --set-exit-if-changed lib test tool
flutter analyze --no-pub
flutter test --no-pub
flutter build bundle --release --no-pub
```

With the relay running, enable the real WebSocket slice:

```bash
cd sdk/flutter
flutter test --no-pub --dart-define=MOSAIC_RUN_RELAY_INTEGRATION=true \
  test/preview_relay_integration_test.dart
```

### iOS

```bash
swift format lint --strict --recursive sdk/ios/Package.swift sdk/ios/Sources sdk/ios/Tests
swift build --package-path sdk/ios
swift test --package-path sdk/ios --disable-sandbox
xcodebuild -project examples/ios-example/MosaicExample.xcodeproj \
  -scheme MosaicExample \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath examples/ios-example/.build/DerivedData \
  CODE_SIGNING_ALLOWED=NO build
```

The package suite is 118 tests. The concrete-simulator golden command and the
iOS 15 deployment-target compile check are documented in `sdk/ios/README.md` and
`examples/ios-example/README.md`. Set `MOSAIC_PREVIEW_RELAY_TEST=1` to include
the package's real-relay vertical slice while the local relay is running.

### Android

```bash
cd sdk/android
./gradlew --no-daemon :mosaic:assembleDebug :mosaic:testDebugUnitTest \
  :mosaic:lintDebug :mosaic:assembleDebugAndroidTest
./gradlew --no-daemon :mosaic:connectedDebugAndroidTest
```

The instrumentation task requires a connected device or emulator; without one it
cannot run, and that gap is recorded in `docs/known-limitations.md` rather than
implied as passing. The runnable Compose app is `examples/android-example`.

## Known limitations

Per-platform pre-GA limitations, including the pre-1.0 distribution model and
the checks that are environment-dependent, are recorded in
`docs/known-limitations.md`. Commerce adapters are contract-tested but **not
live-verified** against a RevenueCat sandbox, an Apple sandbox, or a Google Play
test track (owner decision D10).

## Gate status

See `docs/reviews/` for the accepted phase reviews and their evidence, including
the cross-platform compatibility matrix and tracked follow-ups.
