# Mosaic

Mosaic is an open-source, cross-platform app monetization platform built around
one platform-neutral protocol, three native SDKs, and one Studio.

Phase 0 and Phase 1 are accepted. Phase 2 adds an account-free, local-first
Studio, the Local Preview `0.1` WebSocket contract, and live preview clients for
Flutter, SwiftUI, and Jetpack Compose. The workflow remains local-only: no
hosted projects, publishing, analytics, experiments, or real billing provider
is required.

## Repository map

```text
apps/api/         Go API foundation
apps/dashboard/   TanStack Start dashboard and local Studio
apps/worker/      deferred worker-boundary documentation
protocol/         Protocol 0.1 RC1 plus the Local Preview 0.1 contract and fixtures
sdk/flutter/      Flutter native renderer, fallback, mock commerce, and preview client
sdk/ios/          SwiftUI native renderer, fallback, mock commerce, and preview client
sdk/android/      Compose native renderer, fallback, mock commerce, and preview client
examples/         Flutter, iOS, and Android local-renderer and preview applications
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

Run the API with `go run ./cmd/api` from `apps/api`. To start the account-free
Studio and its loopback preview relay together, run:

```bash
cd apps/dashboard
npm run dev:studio
```

Open `http://localhost:3000/studio`. Preview clients connect to
`ws://127.0.0.1:4317/preview` using the local session documented by each example
application. `npm run dev` remains available when only the dashboard is needed.

## Documentation

- [Product roadmap](docs/product/roadmap.md)
- [Architecture overview](docs/architecture/overview.md)
- [Protocol 0.1](docs/protocol/v0.1.md)
- [Backend foundation](docs/backend/api-foundation.md)
- [Dashboard foundation](docs/dashboard/foundation.md)
- [Phase 1 SDK renderers](docs/sdk/README.md)
- [Phase 1 review](docs/reviews/phase-1-review.md)
- [Phase 2 review](docs/reviews/phase-2.md)

There is intentionally no root package-manager workspace or shared Go module
yet. Phase 2 remains local-only and does not add remote configuration,
publishing, analytics, placements, experiments, accounts, or real billing
providers. The roadmap's `mosaic dev` convenience command is deferred; Phase 2
uses `npm run dev:studio` directly.
