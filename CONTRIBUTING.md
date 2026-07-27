# Contributing to Mosaic

Thanks for contributing. This page covers setup, layout, conventions, and
what a good pull request looks like. The authoritative engineering rules live
in [AGENTS.md](AGENTS.md) and `docs/architecture/conventions/` — read the
relevant one before substantial changes.

## Development setup

Toolchains, per area (install only what you work on):

- **Backend**: Go 1.26.x.
- **Protocol and dashboard**: Node.js 22.12+ and npm 10+.
- **Flutter SDK**: Flutter 3.22+ / Dart 3.4+.
- **iOS SDK**: Xcode 16+, Swift 6 language mode.
- **Android SDK**: JDK 17, Android SDK 36.
- **Dependencies**: Docker Engine 24+ with Compose v2. `cp .env.example .env
  && docker compose up --build` starts the full stack (PostgreSQL, MinIO,
  migrations, API, worker, dashboard, TLS edge); use
  `docker compose --profile debug up` to expose PostgreSQL and the MinIO
  console.

For a host-run API: start PostgreSQL, then from `apps/api` run
`go run ./cmd/migrate up` and `go run ./cmd/api`. For local Studio with the
device-preview relay: `npm run dev:studio` from `apps/dashboard`, then open
`http://localhost:3000/studio`.

There is intentionally no root package-manager workspace or shared Go module.

## Repository layout

```text
apps/api/         Go API, worker, and CLI commands (migrate, keyring, loadgen)
apps/dashboard/   TanStack Start dashboard and Studio
apps/worker/      worker-boundary documentation (binary lives in apps/api)
protocol/         canonical JSON Schemas, semantic validators, fixtures
sdk/flutter/      Flutter SDK          sdk/ios/  Swift SDK   sdk/android/  Kotlin SDK
packages/         design tokens and design system consumed by the dashboard
examples/         Flutter, iOS, and Android example host apps
deploy/           deployment profiles (local Caddy edge)
docs/             product, architecture, protocol, backend, and user docs
scripts/          backup/restore/upgrade operational scripts
```

## Conventions

- [AGENTS.md](AGENTS.md) — the non-negotiable architecture decisions and
  engineering rules.
- `docs/architecture/conventions/` — `backend.md`, `frontend.md`,
  `protocol.md`, `sdk.md`, `testing.md`.
- Architecture changes that replace approved technology, add an
  infrastructure category, or change a public contract require an ADR under
  `docs/architecture/decisions/`.

## Validation commands

Run the checks for every area you touched, from the repository root unless a
directory is shown:

```bash
# Backend (from apps/api)
gofmt -l .
go vet ./...
go test ./...

# Protocol
npm --prefix protocol ci
npm --prefix protocol run check

# Dashboard (format, lint, typecheck, test, build)
npm --prefix apps/dashboard ci
npm --prefix apps/dashboard run check

# Flutter SDK (from sdk/flutter)
dart format --output=none --set-exit-if-changed lib test example/lib
flutter analyze
flutter test

# iOS SDK
swift format lint --strict --recursive sdk/ios/Package.swift sdk/ios/Sources sdk/ios/Tests
swift test --package-path sdk/ios

# Android SDK (from sdk/android)
./gradlew --no-daemon :mosaic:testDebugUnitTest :mosaic:lintDebug :mosaic:assembleDebug
```

Each SDK README's validation section lists the fuller per-platform matrix
(example builds, simulator suites, the iOS 15 typecheck, the Android R8
guard). Backend integration tests require `DATABASE_TEST_URL` pointing at a
PostgreSQL instance.

## Testing policy: minimum sufficient coverage

Tests are risk controls, not deliverables measured by quantity. Before adding
a test, be able to name the behavior it protects, the realistic failure it
would catch, and why no existing test covers it. Prefer the smallest test at
the lowest useful layer, and do not add tests for coverage percentages,
framework behavior, or one-file-per-source symmetry. The full policy is in
[AGENTS.md](AGENTS.md) ("Testing Policy") and
`docs/architecture/conventions/testing.md`.

## Pull request expectations

- **Small vertical slices**: prefer a complete working journey over a large
  disconnected layer.
- **Tests are part of the feature**: a change without its justified tests and
  fixture updates is incomplete.
- **Docs updated**: public APIs, protocol schemas, environment variables,
  conventions, deployment steps, and SDK behavior changes all require
  documentation updates in the same PR.
- **Published resources stay immutable**; failure paths are handled; errors
  are machine-readable and never leak internals or secrets.
- **No new infrastructure without an ADR**: routers, databases, queues, test
  frameworks, and similar categories need an accepted ADR first.
- Do not edit generated files (API clients, route trees, protocol bundles);
  change the source and regenerate.

The full checklist is in [AGENTS.md](AGENTS.md) ("Pull Request Checklist").

## Code of conduct and security

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
Report vulnerabilities privately per [SECURITY.md](SECURITY.md) — never in a
public issue.
