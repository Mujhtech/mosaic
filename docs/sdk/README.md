# Mosaic Phase 1 SDK Renderers

Mosaic Protocol `0.1` RC1 now drives three idiomatic native paywall renderers
from one repository-owned fixture:

| Platform | Native surface | Local fallback | Phase 1 verification |
| --- | --- | --- | --- |
| Flutter | Flutter and Material widgets | Host bundle loader | Analyzer, 57 widget/unit tests, pixel golden, two example bundles |
| iOS | SwiftUI | SwiftPM packaged canonical resource | Swift build, 36 package tests, simulator app, two simulator UI/snapshot tests |
| Android | Jetpack Compose and Material 3 | Generated AAR asset | Assemble/lint, 31 JVM tests, 6 emulator UI tests, pixel checksum |

Phase 1 is deliberately local-only. None of these packages fetch remote
configuration, publish content, integrate Studio, ingest analytics, evaluate
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

### Jetpack Compose

```bash
cd sdk/android
./gradlew --no-daemon :mosaic:assembleDebug :mosaic:testDebugUnitTest \
  :mosaic:lintDebug :mosaic:assembleDebugAndroidTest
./gradlew --no-daemon :mosaic:connectedDebugAndroidTest
```

The runnable Compose app is under `examples/android-example`.

## Gate status

The implementation is stopped at Review Gate 1. See
`docs/reviews/phase-1-review.md` for the conformance matrix, validation evidence,
scope variance, and unsupported environmental checks. Phase 2 is not
authorized by this SDK work.
