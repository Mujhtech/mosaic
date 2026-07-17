# Mosaic iOS Phase 2 Example

This native SwiftUI application connects to local Mosaic Studio and renders
Protocol 0.1 RC1 revisions immediately with the local `MosaicSDK` package. It
needs no account, hosted project, cloud storage, remote publishing, analytics,
or real billing provider.

Open `MosaicExample.xcodeproj`, select the `MosaicExample` scheme, and run on an
iOS 15-or-newer simulator. With Studio running at the default local endpoint,
the app:

- negotiates `mosaic.local-preview.v0.1`
- reports its renderer, application, device, protocol, and preview capabilities
- rerenders valid document revisions without rebuilding the app
- shows connected, reconnecting, and disconnected states
- shows invalid-document, unsupported-component, and render diagnostics with a
  recovery instruction
- applies Studio locale, RTL, long-copy, text-scale, mock-product, purchase,
  restore, and entitlement states
- keeps the last accepted paywall—or the canonical bundled paywall—visible
  when a later revision is unsafe

The footer shows the latest normalized paywall interaction or terminal result.
The example uses `MosaicImageResolver.missing` intentionally so the fixture's
declared same-geometry image placeholder demonstrates asset fallback.

## Local endpoint configuration

The simulator defaults to:

```text
MOSAIC_PREVIEW_ENDPOINT=ws://127.0.0.1:4317/preview
MOSAIC_PREVIEW_SESSION_ID=session_local_01
```

These environment variables are optional. Add them to the Xcode scheme only
when Studio uses a different local session. The Phase 2 Studio relay binds to
loopback only, so the live Studio workflow is supported in the iOS Simulator.
A physical device can run the bundled fallback but cannot connect to the
current relay. The SDK rejects public hosts.

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

## Simulator tests

Choose an available simulator ID from `xcrun simctl list devices available`,
then run the native golden, accessibility-size, and preview-status tests:

```bash
xcodebuild -project examples/ios-example/MosaicExample.xcodeproj \
  -scheme MosaicExample \
  -destination 'platform=iOS Simulator,id=<SIMULATOR_ID>' \
  -derivedDataPath examples/ios-example/.build/DerivedData \
  test
```

The reviewed 390-by-844 Phase 1 paywall golden remains valid because Phase 2
wraps the same native renderer rather than changing Protocol 0.1 semantics.
Set `MOSAIC_RECORD_SNAPSHOTS=1` only when intentionally replacing that
baseline, and limit the run to
`MosaicExampleTests/SwiftUISnapshotTests/testCanonicalPaywallMatchesDeterministicSwiftUIGolden`.
