# Mosaic Apple SDK (Phase 0)

This Swift Package establishes Mosaic configuration, strict protocol 0.1
decoding, provider-neutral commerce contracts, and a deterministic actor-based
mock provider. Its Foundation-only library target is safe to consume from
SwiftUI applications, and the test target includes a SwiftUI consumer
compilation test. It is not a paywall renderer.

The conformance tests read the repository-owned fixture directly from
`protocol/fixtures/v0.1/minimal-paywall.json`; no SDK-local copy exists.

## Requirements

- Swift 6.0 or newer
- Xcode 16 or newer
- iOS 15 or newer for host applications
- macOS with Xcode to run the Swift Package tests

## Commands

From the repository root:

```bash
swift format lint --strict --recursive sdk/ios/Package.swift sdk/ios/Sources sdk/ios/Tests
swift build --package-path sdk/ios
swift test --package-path sdk/ios
```

Tests must run inside a Mosaic checkout so they can locate the canonical fixture.

## Configuration

```swift
let mosaic = try Mosaic.configure(
    apiKey: "public_key",
    endpoint: URL(string: "http://localhost:8080"), // Optional override.
    purchaseProvider: MockMosaicPurchaseProvider()
)
```

No hosted endpoint is selected in Phase 0. Omitting `endpoint` preserves that
unresolved product decision while still allowing local or self-hosted overrides.
