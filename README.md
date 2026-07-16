# Mosaic

Mosaic is an open-source, cross-platform app monetization platform built around
one platform-neutral protocol, three native SDKs, and one Studio.

Phase 0 establishes the repository foundation only. Protocol `0.1`, the Go API
health shell, the TanStack Start dashboard shell, and Flutter, SwiftUI, and
Jetpack Compose SDK package foundations are implemented as review drafts. No
Phase 1 renderer or product domain is included.

## Repository map

```text
apps/api/         Go API foundation
apps/dashboard/   TanStack Start dashboard foundation
apps/worker/      deferred worker-boundary documentation
protocol/         canonical JSON Schema, compatibility manifest, and fixture
sdk/flutter/      Flutter configuration, decoding, and mock commerce boundary
sdk/ios/          Swift package configuration, decoding, and mock commerce boundary
sdk/android/      Compose-ready Android library with the same boundaries
docs/             architecture and foundation documentation
```

## Requirements

- Node.js 22.12+ and npm 10+
- Go 1.26.2+
- Flutter 3.19+ and Dart 3.3+
- Swift 6+ and Xcode 16+
- JDK 17 and Android SDK 36

The SDK platform minimums are provisional until the Phase 0 product-owner
review.

## Install and validate

Run these commands from the repository root unless a directory change is shown.

Protocol schema and conformance:

```bash
npm --prefix protocol ci
npm --prefix protocol run check
```

Backend formatting and tests:

```bash
cd apps/api
gofmt -l .
go test ./...
go vet ./...
```

Dashboard formatting, linting, type checks, tests, and production build:

```bash
npm --prefix apps/dashboard ci
npm --prefix apps/dashboard run check
```

Flutter SDK:

```bash
cd sdk/flutter
flutter pub get
dart format --output=none --set-exit-if-changed lib test example/lib
flutter analyze
flutter test
```

Swift SDK:

```bash
swift format lint --strict --recursive sdk/ios/Package.swift sdk/ios/Sources sdk/ios/Tests
swift build --package-path sdk/ios
swift test --package-path sdk/ios
```

Android SDK:

```bash
cd sdk/android
./gradlew --no-daemon :mosaic:assembleDebug :mosaic:testDebugUnitTest :mosaic:lintDebug
```

Run the API with `go run ./cmd/api` from `apps/api`, and run the dashboard with
`npm run dev` from `apps/dashboard`.

## Documentation

- [Product roadmap](docs/product/roadmap.md)
- [Architecture overview](docs/architecture/overview.md)
- [Protocol 0.1](docs/protocol/v0.1.md)
- [Backend foundation](docs/backend/api-foundation.md)
- [Dashboard foundation](docs/dashboard/foundation.md)
- [SDK foundations](docs/sdk/README.md)

There is intentionally no root package-manager workspace or shared Go module
yet. The Phase 0 review gate must choose the monorepo command structure and the
future API/worker shared-module boundary before product or worker code begins.
