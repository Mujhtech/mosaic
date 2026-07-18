# Mosaic iOS Phase 2.5 Example

This native SwiftUI application connects to local Mosaic Studio and renders
Protocol 0.2 revisions immediately with the local `MosaicSDK` package. It
needs no account, hosted project, cloud storage, remote publishing, analytics,
or real billing provider.

Open `MosaicExample.xcodeproj`, select the `MosaicExample` scheme, and run on an
iOS 15-or-newer simulator. With Studio running at the default local endpoint,
the app:

- connects using `mosaic.local-preview.v0.2`
- reports its renderer, application, device, protocol, and preview capabilities
- rerenders valid document revisions without rebuilding the app
- shows connected, reconnecting, and disconnected states
- shows invalid-document, unsupported-component, and render diagnostics with a
  recovery instruction
- applies Studio locale, RTL, long-copy, text-scale, mock-product, purchase,
  restore, and entitlement states
- demonstrates Protocol 0.2 RC4 native Screen/Sheet navigation, unified
  content buttons, direction-relative icons, document design tokens,
  gradient/media backgrounds, shadows, two-axis sizing, a system-browser HTTPS
  action, and authored Product Cards with nested and overlay Product Badges
- keeps the last accepted paywall visible when a later revision is unsafe

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

The canonical fixture at `protocol/fixtures/v0.2/complete-paywall.json` remains
the repository contract example. Local Preview does not render it when Studio
is unavailable; the example shows a clear loading or connection state instead.

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

The reviewed 390-by-844 goldens cover the current Protocol 0.2 path
and the Protocol 0.2 RC4 renderer. The Simulator suite also verifies native
Sheet presentation, deterministic video fallback diagnostics, and horizontal
Product Card placement. The current baselines use iOS 26.5 native
control rendering; run golden comparisons on that Simulator runtime. Set
`MOSAIC_RECORD_SNAPSHOTS=1` in the scheme only after visual review, and limit
recording to the intended `SwiftUISnapshotTests` golden method.
