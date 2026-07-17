# Mosaic Apple SDK (Phase 1)

The Phase 1 SDK decodes Mosaic Protocol 0.1 RC1 and renders the canonical
paywall with native SwiftUI. It includes deterministic mock commerce,
localization and right-to-left layout, accessibility metadata, explicit
interaction and presentation outcomes, and safe bundled-fallback loading.

Phase 1 is intentionally local-only. The package contains no remote
configuration, REST fetching, cached releases, analytics ingestion, Studio
editing, or real billing provider.

## Requirements

- Swift 6.0 or newer
- Xcode 16 or newer
- iOS 15 or newer for host applications
- macOS with Xcode to run Swift Package tests

The package declares macOS 14 only so its SwiftUI surface can compile in the
development-host test process. Mosaic does not expose a macOS renderer in this
phase.

## Render the canonical fixture

```swift
import MosaicSDK
import SwiftUI

struct PaywallScreen: View {
  let document: MosaicPaywallDocument

  var body: some View {
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
  }
}
```

`MosaicPaywall` reports terminal outcomes but never dismisses its container.
The host application owns `sheet` or `fullScreenCover` dismissal. Images are
also host-resolved through `MosaicImageResolver`; an unavailable image follows
the protocol's localized, same-geometry placeholder behavior.

## Local loading and fallback

```swift
let result = MosaicPaywallLoader.load(candidateData: localData)
```

Resolution is deliberately `candidate -> packaged canonical fixture ->
configurationUnavailable`. Candidate and fallback documents are decoded
atomically, and diagnostics contain stable codes rather than raw documents or
provider errors.

The packaged resource is a repository-relative symlink to
`protocol/fixtures/v0.1/complete-paywall.json`. It is not an SDK-owned schema or
fixture fork.

## Explicit outcomes

Purchase and restore flows distinguish purchased, restored, already entitled,
dismissed, cancelled, product unavailable, configuration unavailable, purchase
failed, and rendering failed. Mock behavior can be selected with
`MockMosaicPurchaseProvider` for deterministic examples and tests.

## Platform-specific rendering notes

- Text metrics, Dynamic Type wrapping, control chrome, focus behavior, and
  scrolling use SwiftUI's native behavior and therefore need not be pixel
  identical to Flutter or Compose.
- Protocol start/end alignment is mapped to SwiftUI leading/trailing and follows
  the resolved locale direction.
- Protocol heading levels are preserved in the accessibility projection. On
  iOS 15, SwiftUI exposes the native header trait but not a public per-level
  heading API.
- The feature-list checkmark is an SF Symbol with a hidden decorative
  accessibility node; spoken labels remain the protocol text.
- Hosts resolve image keys to native `Image` values. The bundled example
  intentionally uses the declared placeholder so no remote asset path is
  introduced.

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

The UIKit-backed golden and accessibility-size layout tests run through the
example test host on a concrete iOS Simulator. A reviewed golden is committed;
see `examples/ios-example/README.md` for comparison and intentional update
commands.
