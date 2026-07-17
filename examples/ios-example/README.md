# Mosaic iOS Phase 1 Example

This native SwiftUI application renders the canonical Mosaic Protocol 0.1 RC1
paywall with the local `MosaicSDK` package. Open
`MosaicExample.xcodeproj`, select the `MosaicExample` scheme, and run on an iOS
15-or-newer simulator.

The top controls switch between English, long German copy, and Arabic
right-to-left layout, plus deterministic purchase and restore states:

- purchase success, cancellation, failure, unavailable, and already entitled
- no available products
- restore success, no purchases, and failure

The status label shows normalized interactions and terminal presentation
results. The example intentionally uses `MosaicImageResolver.missing` so the
fixture's localized same-geometry image placeholder is visible. The host logs
close as `dismissed`; a production host remains responsible for dismissing its
own sheet or full-screen cover.

## Canonical fixture ownership

`Resources/v0.1/complete-paywall.json` is a repository-relative symlink to
`protocol/fixtures/v0.1/complete-paywall.json`. There is no example-owned copy
or schema definition.

## Build

From the repository root:

```bash
xcodebuild -project examples/ios-example/MosaicExample.xcodeproj \
  -scheme MosaicExample \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath examples/ios-example/.build/DerivedData \
  CODE_SIGNING_ALLOWED=NO build
```

## SwiftUI golden test

Choose an available simulator ID from `xcrun simctl list devices available`.
The reviewed 390-by-844 baseline is committed. Set
`MOSAIC_RECORD_SNAPSHOTS=1` only when intentionally replacing that baseline:

```bash
MOSAIC_RECORD_SNAPSHOTS=1 xcodebuild \
  -project examples/ios-example/MosaicExample.xcodeproj \
  -scheme MosaicExample \
  -destination 'platform=iOS Simulator,id=<SIMULATOR_ID>' \
  -derivedDataPath examples/ios-example/.build/DerivedData \
  -only-testing:MosaicExampleTests/SwiftUISnapshotTests test
```

For normal validation, run the same command without
`MOSAIC_RECORD_SNAPSHOTS=1` to compare the native SwiftUI output with
`sdk/ios/Tests/MosaicSDKTests/Resources/complete-paywall.png`.
