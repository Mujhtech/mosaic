# Mosaic Native SDKs

Mosaic Protocol `0.1` RC1 drives three idiomatic native paywall renderers from
one repository-owned fixture. Local Preview `0.1` adds a shared, local-only
WebSocket contract so each renderer can apply Studio revisions without an app
rebuild:

| Platform | Native surface | Local fallback | Phase 2 verification |
| --- | --- | --- | --- |
| Flutter | Flutter and Material widgets | Host bundle loader | Analyzer, 82 tests, widget coverage, real-relay example proof |
| iOS | SwiftUI | SwiftPM packaged canonical resource | Swift build, 59 package tests, 6 simulator tests, real-relay example proof |
| Android | Jetpack Compose and Material 3 | Generated AAR asset | Assemble/lint, 52 JVM tests, 7 emulator tests, real-relay example proof |

Phase 2 remains deliberately local-only. None of these packages fetch hosted
configuration, publish content, authenticate users, ingest analytics, evaluate
placements, or call a real billing provider.

## Canonical protocol contract

The sole source fixture is:

```text
protocol/fixtures/v0.1/complete-paywall.json
```

It covers the RC1 scroll container, recursive vertical stacks, text, bundled
image with a same-geometry placeholder, feature list, product selector,
purchase, restore, close, and legal text. Its catalogs exercise English, long
German copy, and Arabic right-to-left layout.

SDKs do not own schema forks. Flutter conformance tests read the repository
fixture and its example generates an ignored byte-identical asset. SwiftPM and
the iOS example package repository-relative symlinks. Android generates an
ignored build asset from the canonical source before packaging.

Every decoder rejects an unsupported version or capability, unknown property
or component, invalid reference, duplicate ID, localization inconsistency, and
capability/content drift atomically.

## Equivalent renderer behaviour

All three SDKs:

- resolve locale by exact tag, base language, fallback locale, default locale,
  then inline default;
- derive direction independently from the first declared locale candidate;
- resolve store price and period data only through injected commerce;
- omit unavailable products, preserve the configured selection when possible,
  otherwise select the first available reference, and show the declared
  fallback when none are available;
- treat initial product unavailability as an interaction-only notification and
  return terminal `productUnavailable` only for a purchase attempt/provider
  result;
- map purchase, restore, close, configuration, and rendering outcomes to the
  exact RC1 normalized names;
- try the bundled fallback after a rejected local candidate and report
  `configurationUnavailable` only when neither document can be used;
- preserve image geometry when a logical bundled image is missing or invalid;
- expose native accessibility labels, hints/state, headings, selected product
  state, large-text layout, and RTL ordering; and
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
restore/already-entitled results; Android may retain mock entitlement and
transaction metadata; SwiftUI keeps those presentation payloads minimal.
Diagnostics likewise use platform-native types while exposing only safe codes.

## Local preview behaviour

All three SDKs negotiate `mosaic.local-preview.v0.1`, identify the preview
client, and report supported schema, renderer, and preview capabilities before
receiving a draft. They independently order document and mock-commerce
revisions, reject stale or conflicting updates, acknowledge only after the
native view applies a revision, reconnect with bounded backoff, and keep the
last accepted document or bundled fallback on failure.

Local endpoints are credential-free and restricted to loopback, emulator-host,
private, link-local, or local-development hosts. Unsupported components,
invalid documents, missing products/assets, and render failures produce safe,
structured diagnostics rather than crashing the host app.

Start Studio and its relay with `npm run dev:studio` from `apps/dashboard`.
Each example README documents its simulator or emulator endpoint.

## Build and test

### Flutter

```bash
cd sdk/flutter
dart format --output=none --set-exit-if-changed lib test example/lib
flutter analyze --no-pub
flutter test --no-pub
cd example
flutter build bundle --no-pub
```

The full scenario app is under `examples/flutter-example`; run
`dart run tool/sync_fixture.dart` before its build or launch.

With the relay running, enable the real WebSocket slice with:

```bash
flutter test --no-pub --dart-define=MOSAIC_RUN_RELAY_INTEGRATION=true \
  test/preview_relay_integration_test.dart
```

### SwiftUI

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

The concrete-simulator golden command is documented in
`examples/ios-example/README.md`.

Set `MOSAIC_PREVIEW_RELAY_TEST=1` to include the package's real-relay vertical
slice while the local relay is running.

### Jetpack Compose

```bash
cd sdk/android
./gradlew --no-daemon :mosaic:assembleDebug :mosaic:testDebugUnitTest \
  :mosaic:lintDebug :mosaic:assembleDebugAndroidTest
./gradlew --no-daemon :mosaic:connectedDebugAndroidTest
```

The runnable Compose app is under `examples/android-example`.

## Gate status

Phase 1 is accepted. See `docs/reviews/phase-2.md` for the Phase 2 compatibility
matrix, live three-platform evidence, unavailable environmental checks, and
tracked follow-ups. Phase 2.5 and later work remain outside these SDK changes.
