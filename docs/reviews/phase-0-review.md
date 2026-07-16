# Phase 0 Acceptance Report

**Date:** 2026-07-16  
**Gate:** Phase 0 — Foundation  
**Decision:** **Accepted with tracked follow-ups**

## Executive Summary

The Phase 0 foundation satisfies the current roadmap exit criteria after correcting the confirmed
review defects. The repository has a documented foundation, the Go API exposes a working health
endpoint, the TanStack Start dashboard shell builds and runs, and the single canonical protocol
fixture validates and decodes in Flutter, Swift, and Kotlin.

The review found and resolved cross-platform numeric divergence, an unsafe backend serialization
fallback, incomplete dashboard request correlation, stale editor launch configuration, and an icon
dependency/configuration mismatch with ADR-0012. Regression coverage was added for the behavioral
defects. Repository-wide validation is green in the available environment.

No Phase 1 feature was implemented. This report closes only the Phase 0 review gate.

## Acceptance Basis

The current roadmap's Phase 0 exit criteria are met:

| Exit criterion                                          | Evidence                                                                                | Result |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------ |
| Repository setup is documented                          | Root, API, dashboard, protocol, and SDK setup documentation is present and was reviewed | Pass   |
| Backend health endpoint works                           | `GET /health` returned HTTP 200, a JSON success envelope, and `X-Request-ID`            | Pass   |
| Dashboard shell runs                                    | Production build completed and the built shell returned HTTP 200                        | Pass   |
| One protocol fixture decodes in Dart, Swift, and Kotlin | Each SDK's tests load the one fixture under `protocol/fixtures/v0.1/`                   | Pass   |
| Major technology decisions are recorded                 | Architecture overview, conventions, and accepted ADRs cover the Phase 0 stack           | Pass   |

## Review Findings and Resolutions

### Resolved defects

1. **Cross-platform numeric contract divergence**

   - JSON Schema now constrains `revision` to `1...2147483647` inclusive.
   - Mathematically integral JSON spellings such as `1.0` are accepted consistently.
   - `2147483648` is rejected consistently.
   - Non-finite runtime results, including Dart's decoded representation of `1e400`, are rejected
     for numeric layout values.
   - Equivalent protocol and SDK regression tests cover the boundary cases.

2. **Unsafe backend response serialization failure**

   - Responses are rendered into a buffer before any status or body is committed.
   - Serialization failures return HTTP 500 using Mosaic's stable JSON `internal_error` envelope.
   - The request ID remains available for correlation.
   - Logs record only the intended status and payload type; payload contents and encoder error text
     are not exposed.

3. **Dashboard request correlation fallback**

   - The REST client continues to prefer `X-Request-ID`.
   - When that header is unavailable, an error body's documented `requestId` is preserved.
   - Regression coverage verifies the fallback and precedence behavior.

4. **Stale generated launch configuration**

   - `.vscode/launch.json`, which referenced a nonexistent Swift executable target, was removed.
   - The generated TanStack route tree was regenerated during the dashboard build and remained
     byte-for-byte unchanged from the reviewed Phase 0 input.

5. **ADR-0012 icon-system mismatch**

   - The unused `lucide-react` dependency was replaced by `@phosphor-icons/react`.
   - shadcn/ui's `iconLibrary` setting now uses `phosphor`.
   - The lockfile and dashboard changelog were updated.
   - The final dependency tree contains Phosphor and no Lucide or Radix packages.

### Architecture and quality conclusions

- No Phase 1 product domain, renderer, editor, publishing, analytics, or experimentation feature
  was introduced.
- The protocol remains platform-neutral and contains no executable or platform-specific behavior.
- There is one canonical fixture; SDK tests do not maintain divergent fixture copies.
- Chi is the only backend router.
- `render.JSON` is confined to Mosaic's response package and is not called by handlers.
- API error envelopes are stable and machine-readable, including the serialization-failure path.
- Logs and error bodies do not expose payloads, authorization data, stack traces, or internal
  encoder errors.
- HTTP tracing and request correlation are wired through OpenTelemetry and Zerolog.
- The dashboard uses TanStack Query for server-state ownership and Base UI-backed shadcn/ui
  configuration.
- No Radix UI dependency is present.
- Generated route and protocol artifacts were not manually edited. The canonical fixture and
  generated route-tree hashes were unchanged by the review.

## Review-Gate Changes

### Protocol

- `protocol/schema/v0.1/paywall.schema.json`
- `protocol/tools/validation.test.mjs`
- `protocol/CHANGELOG.md`
- `docs/protocol/v0.1.md`

### Backend

- `apps/api/internal/platform/httpserver/response/response.go`
- `apps/api/internal/platform/httpserver/response/response_test.go`

### Dashboard and local setup

- `apps/dashboard/src/lib/api/client.ts`
- `apps/dashboard/src/lib/api/client.test.ts`
- `apps/dashboard/components.json`
- `apps/dashboard/package.json`
- `apps/dashboard/package-lock.json`
- `docs/dashboard/CHANGELOG.md`
- Removed `.vscode/launch.json`

### SDKs

- `sdk/flutter/lib/src/protocol.dart`
- `sdk/flutter/test/canonical_fixture_test.dart`
- `sdk/flutter/CHANGELOG.md`
- `sdk/ios/Sources/MosaicSDK/ProtocolDecoder.swift`
- `sdk/ios/Tests/MosaicSDKTests/CanonicalFixtureTests.swift`
- `sdk/ios/CHANGELOG.md`
- `sdk/android/mosaic/src/test/kotlin/dev/mosaic/sdk/CanonicalFixtureTest.kt`
- `sdk/android/CHANGELOG.md`

Concurrent Phase 0 documentation updates to the root instructions, frontend convention, and
dashboard-agent guidance were preserved and inspected. They consistently reinforce ADR-0012's
Phosphor decision and were not authored as review-gate fixes.

## Validation Results

### Repository formatting

| Check                              | Result                                       |
| ---------------------------------- | -------------------------------------------- |
| Go `gofmt` and final `gofmt -l`    | Pass; no unformatted files                   |
| Dashboard Prettier write and check | Pass                                         |
| Flutter/Dart format check          | Pass; no changes required                    |
| Swift format write and strict lint | Pass                                         |
| Kotlin formatting                  | Unavailable; no formatter task is configured |

### Protocol

| Command         | Result                                                   |
| --------------- | -------------------------------------------------------- |
| `npm ci`        | Pass                                                     |
| `npm run check` | Pass; canonical fixture validated and 11/11 tests passed |

### Go API

| Command or check      | Result                                                        |
| --------------------- | ------------------------------------------------------------- |
| `go mod verify`       | Pass                                                          |
| `go test ./...`       | Pass                                                          |
| `go test -race ./...` | Pass                                                          |
| `go vet ./...`        | Pass                                                          |
| Runtime `GET /health` | Pass; HTTP 200, JSON envelope, request ID, traced request log |

### Dashboard

| Command or check          | Result                                              |
| ------------------------- | --------------------------------------------------- |
| `npm ci`                  | Pass; clean dependency install                      |
| Prettier                  | Pass                                                |
| ESLint with zero warnings | Pass                                                |
| TypeScript `tsc --noEmit` | Pass                                                |
| Vitest                    | Pass; 14/14 tests                                   |
| Production build          | Pass                                                |
| Production server smoke   | Pass; HTTP 200                                      |
| Dependency audit          | Pass; Phosphor present, Lucide absent, Radix absent |

### Flutter

| Command or check                                  | Result            |
| ------------------------------------------------- | ----------------- |
| `flutter pub get`                                 | Pass              |
| `dart format --output=none --set-exit-if-changed` | Pass              |
| `flutter analyze --no-pub`                        | Pass; no issues   |
| `flutter test --no-pub`                           | Pass; 11/11 tests |
| Example `flutter build bundle`                    | Pass              |

### Swift and iOS

| Command or check                   | Result                                            |
| ---------------------------------- | ------------------------------------------------- |
| Strict Swift format lint           | Pass                                              |
| `swift build`                      | Pass                                              |
| `swift test --disable-sandbox`     | Pass; 13/13 tests                                 |
| Generic iOS Simulator `xcodebuild` | Pass for arm64 and x86_64 simulator architectures |

The Swift test bundle had a slow dynamic-loader startup in this environment but completed without
failures.

### Kotlin and Android

| Command or check            | Result            |
| --------------------------- | ----------------- |
| `:mosaic:assembleDebug`     | Pass              |
| `:mosaic:testDebugUnitTest` | Pass; 11/11 tests |
| `:mosaic:lintDebug`         | Pass              |

The final Android invocation used `--rerun-tasks`; all 42 actionable Gradle tasks executed.

## Checks Unavailable or Not Applicable

- No Kotlin formatter task is configured, so repository-wide Kotlin formatting could not be run as
  a separate gate. Kotlin compilation and Android lint passed.
- Android device/emulator instrumentation, Compose UI, and screenshot tests are not configured in
  Phase 0. There is no Phase 0 Android renderer or example application to exercise.
- iOS UI/snapshot tests are not configured in Phase 0. The Swift package was nevertheless compiled
  for the iOS Simulator.
- Flutter golden or renderer widget tests are not configured because the renderer is outside the
  Phase 0 scope.
- No dashboard browser E2E or automated accessibility suite is configured. Component tests,
  production build, and production-server smoke checks passed.
- Database, Redis, migration, worker, and Docker Compose integration checks are not applicable to
  the implemented Phase 0 health-only backend; those runtime integrations are not present yet.

## Tracked Follow-ups

These items do not invalidate the current Phase 0 foundation, but they require explicit ownership
before the affected work begins:

1. **Reconcile Phase 0 scope sources.** The agentic plan lists example applications, template
   concepts, a landing page, and a waitlist in Phase 0, while the current roadmap defines a narrower
   foundation exit. The product owner should declare which document is authoritative and move or
   approve the unmatched deliverables before authorizing Phase 1.
2. **Complete the metrics path when metrics become meaningful.** HTTP tracing is present, but no
   OpenTelemetry `MeterProvider` or metric exporter is configured. Add and validate it before the
   first metric-bearing backend slice.
3. **Choose repository-wide command and Go sharing boundaries.** Define the root aggregate command
   structure and the API/worker shared-Go boundary before product code needs to cross them.
4. **Confirm provisional public SDK contracts.** Confirm platform minimums, hosted endpoint naming,
   and public API-key naming before stable SDK versioning.
5. **Add open-source governance artifacts.** Add `LICENSE` and `CONTRIBUTING.md` before the first
   public release.
6. **Define broader internal-error diagnostics.** Preserve the current safe client envelope while
   documenting how future application errors are logged with useful correlation and without
   leaking sensitive data.
7. **Add checks as surfaces appear.** Add Kotlin formatting, platform UI/instrumentation tests, and
   dashboard browser accessibility coverage when those Phase 1 surfaces are introduced.

## Final Classification

**Accepted with tracked follow-ups.**

All confirmed Phase 0 implementation defects are resolved, the available validation matrix is
green, and the current roadmap exit criteria are satisfied. The follow-ups above are governance,
future-boundary, or future-surface work rather than unresolved defects in the implemented Phase 0
foundation.

**Stop condition:** Phase 1 has not started and is not authorized by this report.
