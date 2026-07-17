# Mosaic

Mosaic is an open-source, cross-platform app monetization platform built around
one platform-neutral protocol, three native SDKs, and one Studio.

Phase 0 is accepted. Phase 1 now has a review candidate: Mosaic Protocol `0.1`
RC1, one canonical complete paywall fixture, native Flutter/SwiftUI/Jetpack
Compose renderers, deterministic mock commerce, bundled fallback handling,
accessibility and visual tests, and three example applications. Phase 2 has not
started.

## Repository map

```text
apps/api/         Go API foundation
apps/dashboard/   TanStack Start dashboard foundation
apps/worker/      deferred worker-boundary documentation
protocol/         Protocol 0.1 RC1 schema, compatibility manifest, and canonical fixture
sdk/flutter/      Flutter decoder, native renderer, fallback loader, and mock commerce
sdk/ios/          Swift package decoder, SwiftUI renderer, fallback loader, and mock commerce
sdk/android/      Android decoder, Compose renderer, fallback loader, and mock commerce
examples/         Flutter, iOS, and Android Phase 1 scenario applications
docs/             architecture and foundation documentation
```

## Requirements

- Node.js 22.12+ and npm 10+
- Go 1.26.2+
- Flutter 3.19+ and Dart 3.3+
- Swift 6+ and Xcode 16+
- JDK 17 and Android SDK 36

The SDK platform minimums remain working baselines pending stable public SDK
versioning.

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
cd example
flutter build bundle --no-pub
```

Swift SDK:

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

Android SDK:

```bash
cd sdk/android
./gradlew --no-daemon :mosaic:assembleDebug :mosaic:testDebugUnitTest \
  :mosaic:lintDebug :mosaic:assembleDebugAndroidTest
```

Run the API with `go run ./cmd/api` from `apps/api`, and run the dashboard with
`npm run dev` from `apps/dashboard`.

## Documentation

- [Product roadmap](docs/product/roadmap.md)
- [Architecture overview](docs/architecture/overview.md)
- [Protocol 0.1](docs/protocol/v0.1.md)
- [Backend foundation](docs/backend/api-foundation.md)
- [Dashboard foundation](docs/dashboard/foundation.md)
- [Phase 1 SDK renderers](docs/sdk/README.md)
- [Phase 1 review candidate](docs/reviews/phase-1-review.md)

There is intentionally no root package-manager workspace or shared Go module
yet. Phase 1 remains local-only and does not add remote configuration,
publishing, Studio editing, analytics, placements, or real billing providers.
