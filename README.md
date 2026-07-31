# Mosaic

Mosaic is an open-source, cross-platform app monetization platform built around
one platform-neutral protocol, three native SDKs, and one Studio.

The repository includes the account-free local Studio and Local Preview `0.2`
workflow plus the Phase 3B hosted configuration-delivery private alpha. Hosted
mode adds Projects and Environments, browser sessions, Drafts, Assets,
Placements, immutable Paywall Versions, publishing, rollback, and Delivery v1
clients for Flutter, SwiftUI, and Jetpack Compose. Commerce remains mock-only;
provider billing, analytics, experiments, targeting, and authoritative
Entitlement state are deliberately deferred.

## Repository map

```text
apps/api/         Go API foundation
apps/dashboard/   TanStack Start dashboard and local Studio
apps/worker/      deferred worker-boundary documentation
protocol/         Protocol 0.2 plus its Local Preview contract and fixtures
sdk/flutter/      Flutter renderer, hosted delivery/cache, fallback, and preview client
sdk/ios/          SwiftUI renderer, hosted delivery/cache, fallback, and preview client
sdk/android/      Compose renderer, hosted delivery/cache, fallback, and preview client
examples/         Flutter, iOS, and Android local-renderer and preview applications
docs/             architecture and foundation documentation
```

## Requirements

- Node.js 22.12+ and npm 10+
- Go 1.26.2+
- Flutter 3.19+ and Dart 3.3+
- Swift 6+ and Xcode 16+
- JDK 17 and Android SDK 36
- Docker with Compose for the durable local PostgreSQL workflow

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

Start the durable API stack with `cp .env.example .env && docker compose up --build`.
The database uses the named `mosaic_postgres_data` volume. For a host-run API,
start PostgreSQL, run `go run ./cmd/migrate up`, then `go run ./cmd/api` from
`apps/api`; both commands load `apps/api/.env`, with existing process variables
taking precedence. To start the account-free
Studio and its loopback preview relay together, run:

```bash
cd apps/dashboard
npm run dev:studio
```

Open `http://localhost:3000/studio`. Preview clients connect to
`ws://127.0.0.1:4317/preview` using the local session documented by each example
application. `npm run dev` remains available when only the dashboard is needed.

Hosted Studio routes use the browser session APIs and remain separate from the
account-free `/studio` route. The local stack includes PostgreSQL, MinIO, and a
development HTTPS edge for immutable hosted Asset URLs. Trust the generated
local development certificate only on test devices that must load those Asset
URLs; production deployments must configure an externally reachable HTTPS
`MOSAIC_PUBLIC_ASSET_BASE_URL`.

## Documentation

- [Product roadmap](docs/product/roadmap.md)
- [Architecture overview](docs/architecture/overview.md)
- [Protocol 0.2](docs/protocol/v0.2.md)
- [Backend foundation](docs/backend/api-foundation.md)
- [Dashboard foundation](docs/dashboard/foundation.md)
- [Phase 1 SDK renderers](docs/sdk/README.md)
- [Phase 1 review](docs/reviews/phase-1-review.md)
- [Phase 2 review](docs/reviews/phase-2.md)
- [Phase 3B hosted publishing](docs/backend/phase-3b-hosted-publishing.md)
- [Configuration Delivery v1](docs/protocol/configuration-delivery-v1.md)
- [Phase 3B review](docs/reviews/phase-3b.md)

There is intentionally no root package-manager workspace or shared Go module
yet. Hosted configuration is additive: `/studio` remains local-first and does
not require an account or reachable backend. The roadmap's `mosaic dev`
convenience command is deferred; local preview uses `npm run dev:studio`
directly.
