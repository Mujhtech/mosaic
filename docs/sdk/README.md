# Mosaic SDK Foundations

Phase 0 establishes one platform-neutral decoding boundary and three idiomatic
first-party SDK package foundations:

| Platform        | Package       | Async provider model      | Included target                                     |
| --------------- | ------------- | ------------------------- | --------------------------------------------------- |
| Flutter         | `sdk/flutter` | Dart `Future`             | Flutter configuration example and tests             |
| SwiftUI         | `sdk/ios`     | Swift concurrency `async` | XCTest and SwiftUI consumer compilation target      |
| Jetpack Compose | `sdk/android` | Kotlin `suspend`          | Compose-enabled Android library and JVM test target |

These packages do not yet include remote fetching, caching, bundled fallback,
placements, rendering, analytics, or real billing adapters. Those capabilities
belong to later roadmap phases.

## Canonical protocol contract

Every conformance test reads the same repository file directly:

```text
protocol/fixtures/v0.1/minimal-paywall.json
```

No SDK contains a copied fixture or a platform-specific schema. The fixture is
decoded into native Dart, Swift, and Kotlin models and covers:

- vertical layout
- close button
- text
- feature list
- product selector
- purchase button
- restore button
- legal text
- protocol compatibility capabilities

Each decoder supports only schema version `0.1` and rejects unknown schema
versions, capabilities, components, and properties in line with the protocol
compatibility manifest. It also verifies that declared capabilities exactly
match the document content and that product-selector IDs are unique with a
declared initial selection.

## Shared configuration concept

Each package exposes an isolated `Mosaic.configure` entry point containing:

- a required public API key
- an optional HTTP(S) endpoint override
- a required purchase provider

Phase 0 does not choose a hosted production endpoint. This keeps a product and
deployment decision out of the SDK foundation while allowing local-development
and self-hosted endpoints.

## Shared purchase-provider concept

Every provider contract supports:

- loading products
- purchasing a product
- restoring purchases
- reading active entitlements

The public APIs use explicit result variants instead of booleans. The common
outcomes include loaded or unavailable products; purchased, already entitled,
cancelled, product unavailable, or failed purchases; restored, empty, or failed
restores; and active or unavailable entitlement lookup.

The mock providers are deterministic in-memory test doubles. They are not store
simulators or production billing adapters.

## Build and test

### Flutter

Requirements: Flutter 3.19+, Dart 3.3+.

```bash
cd sdk/flutter
flutter pub get
dart format --output=none --set-exit-if-changed lib test example/lib
flutter analyze
flutter test
cd example
flutter build bundle
```

### SwiftUI

Requirements: Swift 6+, Xcode 16+, iOS 15+ for consumers, and a macOS development
host for package tests. No desktop SDK support is declared.

```bash
swift format lint --strict --recursive sdk/ios/Package.swift sdk/ios/Sources sdk/ios/Tests
swift build --package-path sdk/ios
swift test --package-path sdk/ios
```

### Jetpack Compose

Requirements: JDK 17 and Android SDK 36. The package includes a checksum-pinned
Gradle 9.3.1 wrapper and uses Android Gradle Plugin 9.1.1.

```bash
cd sdk/android
./gradlew :mosaic:assembleDebug
./gradlew :mosaic:testDebugUnitTest
./gradlew :mosaic:lintDebug
```

All fixture tests must run from within a Mosaic checkout because the protocol
agent owns the canonical fixture.

## Phase 0 review items

The current minimums—Flutter 3.19/Dart 3.3, iOS 15/Swift 6, and Android API 24—
are conservative working baselines, not approved long-term support policy. The
product owner should confirm them at the Phase 0 review gate before public SDK
versioning begins.

The review should also confirm the eventual hosted endpoint and API-key naming.
Neither decision is embedded into the current SDK behavior.
