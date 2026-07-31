# SDK Quickstarts

Mosaic ships three native SDKs — Flutter, iOS (SwiftUI), and Android (Jetpack
Compose) — that render the same platform-neutral protocol. Each SDK README is
the authoritative quickstart; this page tells you where to start and states
the installation reality.

## Installation reality (pre-1.0)

All three SDKs are pre-1.0 (`0.x-dev`) and are **not published to any package
registry** (owner decision D6; see
[docs/known-limitations.md](../known-limitations.md)). You install them by
pinning this repository at an exact tag or commit, or by local path:

- **Flutter** (`mosaic_sdk`, `0.2.0-dev.x`): git dependency with
  `path: sdk/flutter` and an exact `ref`, or a local `path:` dependency.
  Not resolvable from pub.dev.
- **iOS** (`MosaicSDK`, `0.1.0-dev.x`): Swift Package Manager by tag,
  revision, or local path. CocoaPods works local-path-only.
- **Android** (`dev.mosaic.sdk:mosaic`, `0.1.0-dev.x`): composite/local-path
  Gradle build, or publish to `mavenLocal()`/your own Maven repository from a
  pinned checkout. Not resolvable from Maven Central or Google Maven.

Pin an exact commit or tag, never a branch.

## Where to go

| Platform | Install + quickstart | Requirements |
| --- | --- | --- |
| Flutter | [sdk/flutter/README.md](../../sdk/flutter/README.md) — "Installation" | Flutter 3.22+ / Dart 3.4+ |
| iOS | [sdk/ios/README.md](../../sdk/ios/README.md) — "Installation" | iOS 15+, Swift 6 language mode, Xcode 16+ |
| Android | [sdk/android/README.md](../../sdk/android/README.md) — "Installation" | Android API 24+, JDK 17 |

The cross-platform overview — capabilities, equivalent renderer behavior,
intentional platform differences, and the shared protocol contract — is
[docs/sdk/README.md](../sdk/README.md).

## The common shape

Every SDK follows the same conceptual flow:

1. Configure with a public SDK key and base URL (plus an optional bundled
   fallback configuration).
2. The SDK fetches and caches the current Configuration Release; when the
   backend is unreachable it renders from cache or the bundled fallback and
   never crashes the host app.
3. Decide a Placement locally and present the resulting paywall natively.
4. Purchases go through the configured commerce provider adapter (see the
   [providers guide](providers.md)); results are explicit typed outcomes,
   never booleans.
5. Analytics batch in the background and never block purchasing.

Working host apps for all three platforms live under `examples/`.
