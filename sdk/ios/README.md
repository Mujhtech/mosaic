# Mosaic Apple SDK (Phase 2)

The Phase 2 SDK decodes and renders Mosaic Protocol 0.1 RC1 with native
SwiftUI, and can receive validated draft and mock-commerce revisions from a
local Mosaic Studio session over WebSockets. It preserves the Phase 1 bundled
fallback and provider-neutral commerce APIs; no account, hosted service,
remote publishing, analytics, StoreKit, or RevenueCat integration is involved.

## Requirements

- Swift 6.0 or newer
- Xcode 16 or newer
- iOS 15 or newer for host applications
- macOS with Xcode to run Swift Package tests

The package declares macOS 14 only so its SwiftUI surface can compile in the
development-host test process. Mosaic does not expose a macOS renderer in this
phase.

## Connect a native preview

Create one stable identity for the running application process, configure a
local endpoint, and retain the client with SwiftUI state ownership:

```swift
import MosaicSDK
import SwiftUI

struct PaywallPreview: View {
  @StateObject private var client: MosaicLocalPreviewClient
  let fallbackDocument: MosaicPaywallDocument

  init(fallbackDocument: MosaicPaywallDocument) throws {
    let identity = MosaicPreviewClientIdentity(
      clientId: "client_ios_example",
      displayName: "iOS local preview",
      renderer: .init(id: "mosaic.ios", version: "0.2.0"),
      application: .init(
        id: "dev.example.app",
        displayName: "Example",
        version: "1.0"
      ),
      device: .init(
        displayName: "Development simulator",
        systemName: "iOS",
        systemVersion: "18.0"
      )
    )
    let configuration = try MosaicPreviewClientConfiguration(identity: identity)
    _client = StateObject(
      wrappedValue: MosaicLocalPreviewClient(configuration: configuration)
    )
    self.fallbackDocument = fallbackDocument
  }

  var body: some View {
    MosaicLocalPreviewScreen(
      client: client,
      fallbackDocument: fallbackDocument,
      fallbackPurchaseProvider: MockMosaicPurchaseProvider(
        products: MosaicProduct.phase1MockProducts
      )
    )
  }
}
```

The default endpoint is `ws://127.0.0.1:4317/preview`, the default session is
`session_local_01`, and the negotiated WebSocket subprotocol is
`mosaic.local-preview.v0.1`. A custom endpoint must remain local: localhost,
loopback, private LAN, `.local`, IPv6 ULA, and IPv6 link-local hosts are
accepted; public remote hosts are rejected.

`MosaicLocalPreviewScreen` starts and stops the client with the SwiftUI view
lifecycle. It shows connection state, the active revision, locale and layout
direction, text scale, mock purchase and entitlement state, safe diagnostics,
and a reconnect action. It applies locale, RTL, long copy, and Dynamic Type
preview overrides without rebuilding the application.

## Revision and failure behavior

- The client sends `previewClientConnected` and `capabilityReport` after the
  WebSocket subprotocol is negotiated.
- Document and commerce streams have independent monotonic revision tracking.
- Stale revisions are rejected or ignored; a sequence reused by a different
  revision ID is treated as a conflict.
- A draft is acknowledged only after the SwiftUI renderer mounts it.
- Invalid or unsupported drafts keep the last accepted document visible and
  return safe, component-addressed diagnostics with recovery actions.
- Unsupported required components use `keepLastAcceptedDraft`; unavailable
  products use the document's declared selector fallback.
- Reconnect uses bounded exponential backoff from 250 milliseconds to five
  seconds, with heartbeat timeout detection and a manual reconnect action after
  attempts are exhausted.
- Frames are bounded at 2 MiB and documents at 1 MiB.

The client reports Protocol 0.1 capabilities without adding SwiftUI concepts
to the platform-neutral contract. It consumes the repository canonical
preview flow directly from
`protocol/fixtures/local-preview/v0.1/session-flow.messages.json` in tests.

## Mock commerce

`MosaicPreviewPurchaseProvider` translates Studio mock-product references into
the provider product IDs declared by the active Protocol 0.1 document. It
supports explicit purchase, restore, unavailable-product, and active-
entitlement outcomes. It never opens StoreKit, handles receipts, or contacts a
billing provider.

## Bundled fallback and direct rendering

The preview screen takes a valid bundled `MosaicPaywallDocument` and an
independent fallback purchase provider. Until a valid local draft arrives—or
when a newer draft fails—the native fallback remains usable.

Outside Studio preview, a host can still render directly:

```swift
MosaicPaywall(
  document: document,
  requestedLocale: "en",
  purchaseProvider: MockMosaicPurchaseProvider(
    products: MosaicProduct.phase1MockProducts
  ),
  imageResolver: .missing,
  onInteraction: { interaction in
    print(interaction.name.rawValue)
  },
  onResult: { result in
    print(result.name.rawValue)
  }
)
```

`MosaicPaywall` reports terminal outcomes but never dismisses its container.
The host owns `sheet` or `fullScreenCover` dismissal. Images remain host-
resolved through `MosaicImageResolver`; an unavailable image follows the
protocol's localized, same-geometry placeholder behavior.

The packaged resource is a repository-relative symlink to
`protocol/fixtures/v0.1/complete-paywall.json`. It is not an SDK-owned schema or
fixture fork.

## Platform-specific rendering notes

- Text metrics, Dynamic Type wrapping, control chrome, focus behavior, and
  scrolling use SwiftUI's native behavior and need not be pixel-identical to
  Flutter or Compose.
- Protocol start/end alignment maps to SwiftUI leading/trailing and follows the
  resolved locale direction.
- Protocol heading levels are preserved in the accessibility projection. On
  iOS 15, SwiftUI exposes the native header trait but not a public per-level
  heading API.
- The feature-list checkmark is a decorative SF Symbol; spoken labels remain
  the protocol text.

## Validation

From the repository root:

```bash
swift format lint --strict --recursive sdk/ios/Package.swift sdk/ios/Sources sdk/ios/Tests
swift build --package-path sdk/ios
swift test --package-path sdk/ios
xcodebuild -project examples/ios-example/MosaicExample.xcodeproj \
  -scheme MosaicExample \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath examples/ios-example/.build/DerivedData \
  CODE_SIGNING_ALLOWED=NO build
```

The package test suite uses an in-memory WebSocket to cover the full local
preview flow. To run the opt-in transport smoke test against a live local
Studio relay:

```bash
MOSAIC_PREVIEW_RELAY_TEST=1 swift test --package-path sdk/ios \
  --filter LocalPreviewClientTests/testOptInRealRelayVerticalSlice
```

UIKit-backed golden, accessibility-size, and preview-status tests run through
the example test host on a concrete iOS Simulator. See
`examples/ios-example/README.md` for the command.
