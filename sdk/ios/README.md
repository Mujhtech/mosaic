# Mosaic Apple SDK — Protocol 0.2 native rendering

The SDK strictly decodes Mosaic Protocol 0.2 and renders it with native
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

## Protocol 0.2 RC4 rendering

Protocol 0.2 RC4 uses one to ten named screens.
The renderer starts at `initialScreenId`, keeps a presentation-local history,
pushes Screen destinations, presents Sheet destinations with SwiftUI's native
modal surface over the most recent Screen, and safely pops or dismisses with
`navigateBack`. Navigating does not reset
product selection, Switch values, or Carousel pages; accepting a new preview
revision creates a fresh renderer model and resets all runtime state.

RC4 resolves document-scoped colour, background, and shadow tokens within
their own category. Native surfaces support solid colour, physical clockwise
linear gradients, radial gradients, decorative images, decorative muted
looping video, and one shadow. Bundled media stays behind host resolvers;
remote media is limited to validated HTTPS assets. Video failure uses its
poster and then fallback colour, while every media failure remains nonfatal
and emits a safe rendering diagnostic.

Eligible components share two-axis Fit, Fill, and Fixed sizing. Fixed content
clips visual overflow without replacing its accessibility value. Fill on the
vertically unbounded Scroll Container axis resolves to Fit and records
`layout.unboundedFill` instead of producing infinite SwiftUI layout.

Protocol 0.2 also replaces the specialized action components with one native
SwiftUI `Button` whose vertical or horizontal label may contain noninteractive
protocol content. Purchase and restore buttons may supply
`inProgressChildren`; while the provider is running, the button swaps content
and rejects duplicate activation. Descendant semantics are merged into the
button's one localized accessibility target.

RC3 makes Product Selector cards authored protocol content. Each `productCard`
binds one product reference, renders passive children in its authored vertical
or horizontal layout, and applies recursive Default/Selected box-style
overrides. A direct `productBadge` may participate in the card layout or use a
logical start/end overlay anchor, which mirrors under RTL. The whole card is
one native selectable accessibility target; passive descendant labels are
merged in source order.

Selection state is keyed by selector ID and Product Card ID, then mapped back
through the card's product reference for provider loading and purchase. Missing
products remove their cards; an empty localized price removes only a card whose
Text descendants or accessibility label resolve to `product.price` in the active
locale. If the authored initial or current card is unavailable, selection falls
back to the first authored available card; when none remain, the declared
message is shown and purchase is disabled. Product Card text and its optional
accessibility label interpolate
only `product.name` and `product.price` after locale resolution, using the
localized product-reference label when the provider supplies no name.

`icon` maps the frozen semantic icon vocabulary to SF Symbols. Backward and
forward symbols use direction-relative system names and mirror with the
resolved RTL layout. Decorative icons are hidden from VoiceOver; informative
icons retain their localized label. `openExternalUrl` accepts only safe,
absolute HTTPS URLs and delegates to SwiftUI's system `openURL` action. The
paywall and navigation history stay mounted, and an unsuccessful handoff adds
the safe `external_url_open_failed` rendering diagnostic.

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
`session_local_01`, and the client uses `mosaic.local-preview.v0.2`. A custom endpoint must remain local: localhost,
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

The client reports the exact capabilities for the negotiated Protocol version
without adding SwiftUI concepts to the platform-neutral contract. Tests consume
the canonical Local Preview 0.2 flow directly from the repository.

## Mock commerce

`MosaicPreviewPurchaseProvider` translates Studio mock-product references into
the provider product IDs declared by the active validated document. It
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
  videoResolver: .missing,
  onInteraction: { interaction in
    print(interaction.name.rawValue)
  },
  onResult: { result in
    print(result.name.rawValue)
  }
)
```

`MosaicPaywall` reports terminal outcomes but never dismisses its host
container. Protocol Sheet destinations are presented and dismissed internally
through their navigation history. The host still owns the outer paywall sheet
or full-screen cover. Bundled images and videos remain host-resolved through
`MosaicImageResolver` and `MosaicVideoResolver`; unavailable media follows its
declared placeholder, poster, or colour fallback.

The packaged resource is a byte-identical checked-in copy of the current
`protocol/fixtures/v0.2/complete-paywall.json`. SwiftPM copies symbolic links
without rebasing their targets, so using a repository-relative symlink would
produce a broken fallback in a built package. A package test prevents the copy
from drifting; it is not an SDK-owned schema or fixture fork.

## Platform-specific rendering notes

- Text metrics, Dynamic Type wrapping, control chrome, focus behavior, and
  scrolling use SwiftUI's native behavior and need not be pixel-identical to
  Flutter or Compose.
- Protocol start/end alignment maps to SwiftUI leading/trailing and follows the
  resolved locale direction.
- Linear-gradient geometry uses physical coordinates: 0° is left-to-right,
  90° is top-to-bottom, angles increase clockwise, and RTL does not mirror it.
- Each multi-screen root exposes its localized screen label as a containing
  VoiceOver group while preserving the source-order focus of its descendants.
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
