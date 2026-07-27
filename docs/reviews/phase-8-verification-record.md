# Phase 8 Stage 6 — Verification Record

Operator: mosaic-backend agent
Date: 2026-07-27
Branch: `phase/8-operational-hardening`
Host: darwin/arm64 (Darwin 25.5.0)

This is the in-repo evidence record the Phase 8 product review asked for. Every
command below was actually executed in this session. Where a check could not be
run, or where a result is provisional because another agent was editing the same
files concurrently, that is stated instead of a pass.

## Toolchain versions

| Tool | Version |
| --- | --- |
| Go (local) | `go1.26.2 darwin/arm64` |
| Go (release image) | `golang:1.26.5-alpine` (`apps/api/Dockerfile` build stage) |
| govulncheck | `govulncheck@v1.6.0`, built with `go1.26.2`, DB `https://vuln.go.dev` updated 2026-07-27 16:28:49 UTC |
| Docker Compose | v5.1.2 |
| Node | v22.22.3 |
| npm | 10.9.8 |
| Flutter | 3.38.5 (stable) |
| Dart | 3.10.4 (stable) |
| Swift | Apple Swift 6.3.2 (swiftlang-6.3.2.1.108), target `arm64-apple-macosx26.0` |
| Gradle | 9.3.1 |
| Kotlin | 2.2.21 |
| JDK | OpenJDK 17.0.18 LTS |
| PostgreSQL (integration) | `postgres:17-alpine` via `docker compose --profile debug` |

The Homebrew `govulncheck` on PATH is built against go1.25 and cannot load a
go1.26 module (`package requires newer Go version go1.26`). It was replaced for
this record with a `go install golang.org/x/vuln/cmd/govulncheck@latest` build
that reports `Go: go1.26.2`.

## apps/api — format, vet, build, test

```
$ cd apps/api
$ gofmt -l .                                   # no output
$ go vet ./...                                 # no output, exit 0
$ go build ./...                               # exit 0
$ DATABASE_TEST_URL=postgres://mosaic:…@127.0.0.1:5432/mosaic?sslmode=disable \
    go test -p 1 -count=1 ./...                # exit 0
```

Result: **PASS**. 31 packages `ok`, 16 packages with no test files, 0 `FAIL`.

Counting individual test functions and subtests from the same run with `-v`:

```
295 --- PASS
  1 --- SKIP
```

The single skip is `TestS3CompatibleAssetRoundTrip`, which requires a live
S3-compatible endpoint that was not started for this run. At the top level:
159 `PASS`, 1 `SKIP`, 0 `FAIL`.

The integration tests are included, not skipped: PostgreSQL was started for this
run (`docker compose up -d postgres` plus the `debug`-profile
`postgres-debug-ports` publisher) and `DATABASE_TEST_URL` was exported, so
`internal/platform/database`, `cloudworkspacepostgres`, `analyticspostgres`,
`experimentpostgres`, and `placementdecisionpostgres` executed against real
PostgreSQL 17.

## Migrations

```
$ DATABASE_URL=postgres://mosaic:…@127.0.0.1:5432/mosaic?sslmode=disable
$ go run ./cmd/migrate up          # no pending work to report
$ go run ./cmd/migrate status
  …
  21         applied      00021_experiment_version_environment_integrity.sql
  0 pending migration(s)
$ go run ./cmd/migrate preflight
  current version:  21
  expected version: 21
  pending:          []
  dirty:            false
  verdict:          compatible
```

Result: **PASS**. The schema reaches version 21 with nothing pending and the
compatibility verdict is `compatible`. `TestMigrationDownUpCycleOnAnEmptyDatabase`
and `TestMigration00018DownRefusesWhenAffectedDataExists` both passed in the run
above.

## govulncheck

### Source mode, local go1.26.2 toolchain

```
$ govulncheck ./...
Your code is affected by 8 vulnerabilities from the Go standard library.
This scan also found 6 vulnerabilities in packages you import and 3
vulnerabilities in modules you require, but your code doesn't appear to call
these vulnerabilities.
```

All eight *called* findings are standard library, none are Mosaic code, and all
are fixed by a newer patch release of Go:

| Advisory | Package | Fixed in |
| --- | --- | --- |
| GO-2026-5856 | `crypto/tls` | go1.26.5 |
| GO-2026-5039 | `net/textproto` | go1.26.4 |
| GO-2026-5038 | `mime` | go1.26.4 |
| GO-2026-5037 | `crypto/x509` | go1.26.4 |
| GO-2026-4982 | `html/template` | go1.26.3 |
| GO-2026-4980 | `html/template` | go1.26.3 |
| GO-2026-4971 | `net` | go1.26.3 |
| GO-2026-4918 | `net/http` | go1.26.3 |

`crypto/tls` sets the floor at **go1.26.5**, which is exactly the version the
Dockerfile build stage was moved to in this pass (B-1). A developer machine on
1.26.2 still compiles and tests cleanly; a *release image* must not be built
from it.

### Binary mode, go1.26.5 (the shipped toolchain)

All six commands were rebuilt with `GOTOOLCHAIN=go1.26.5 CGO_ENABLED=0 go build
-trimpath` (matching the Dockerfile flags) and scanned:

| Binary | Result |
| --- | --- |
| `api` | 0 called vulnerabilities |
| `migrate` | No vulnerabilities found |
| `worker` | 0 called vulnerabilities |
| `keyring` | No vulnerabilities found |
| `loadgen` | No vulnerabilities found |
| `healthcheck` | No vulnerabilities found |

Result: **PASS** for the image toolchain. The bump closes every called finding.

`api` and `worker` still report 3 *uncalled* package findings and 1 uncalled
module finding:

- GO-2026-5774, GO-2026-5775, GO-2026-5777 — all three are IP-spoofing
  vulnerabilities in `github.com/go-chi/chi/v5@v5.2.5`'s
  `middleware.RealIP`, fixed in chi v5.3.0. govulncheck reports them as **not
  called** because Mosaic does not use chi's `RealIP`: it uses its own
  `internal/platform/httpserver/httpmiddleware.RealIP`, which honours forwarded
  headers only from a peer inside `MOSAIC_TRUSTED_PROXY_CIDRS`. This is
  independent confirmation that the Phase 8 decision to replace chi's middleware
  was the right one. Upgrading chi to v5.3.0 remains a sensible hygiene
  follow-up, but it is not a live exposure.
- GO-2026-5932 in `golang.org/x/crypto@v0.54.0`, uncalled, no fixed version
  published yet.

## protocol

```
$ cd protocol && npm test
# tests 115
# pass 115
# fail 0
# skipped 0

$ npm run validate
Validated fixtures/v0.2/complete-paywall.json against the Mosaic Protocol 0.2
schema and compatibility manifest; validated Local Preview 0.2 fixtures,
Configuration Delivery v1, Commerce Provider Contracts v1/v2, Commerce
Configurations v1/v2, Placement Decision v1, Configuration Delivery v2,
Analytics Event v1/v2, Experiment Assignment v1, Configuration Delivery v3, and
the browser contract.
```

Result: **PASS**.

## apps/dashboard

```
$ cd apps/dashboard
$ npm run typecheck        # tsc --noEmit, clean
$ npm run lint             # eslint . --max-warnings=0, clean
$ npx vitest run
 Test Files  88 passed (88)
      Tests  500 passed (500)
$ npm run test:relay
# tests 7
# pass 7
# fail 0
```

Result: **PASS** on all four.

**The relay evidence closes the Phase 7 owner condition**: `npm run test:relay`
(`scripts/local-preview-relay.test.mjs`) runs 7 tests, 7 pass, 0 fail, covering
the handshake ordering, message direction, connected identity, and reconnect
behaviour of the local preview relay.

Honesty note on the first attempt: a `vitest run` started at 21:27:29 reported
`1 failed | 499 passed (500)`, the failure being
`src/features/diagnostics/components/diagnostics-panel.test.tsx`. That file's
mtime was 21:27 — the dashboard owner was editing it during the run — and a
targeted re-run at 21:28:13 produced a *different* failure in the same file,
confirming it was mid-edit rather than genuinely broken. The clean 500/500 result
recorded above is the re-run at 21:35:31, after the dashboard owner's edits
landed. No dashboard file was modified by the backend agent.

## SDKs

```
$ cd sdk/flutter && flutter test
All tests passed!            # +178 passed, ~2 skipped

$ cd sdk/android && ./gradlew test --rerun-tasks
BUILD SUCCESSFUL in 25s      # 47 actionable tasks executed
# JUnit XML totals across 21 result files:
#   tests=156 failures=0 errors=0 skipped=0

$ cd sdk/ios && swift test
Test Suite 'All tests' passed
  Executed 123 tests, with 1 test skipped and 0 failures (0 unexpected)
```

Result: **PASS** on all three. The iOS toolchain was available from this session,
so `swift test` is a real result rather than a deferral.

`./gradlew test` was first run without `--rerun-tasks` and reported
`BUILD SUCCESSFUL` with every task `UP-TO-DATE`, i.e. it executed no tests. The
count above comes from the forced re-run, which actually executed the suites.
One pre-existing Kotlin warning is emitted by
`mosaic-google-play/src/test/kotlin/.../MosaicGooglePlayAdapterTest.kt:101`
(missing `@OptIn(ExperimentalCoroutinesApi::class)`); it does not fail the build.

## npm audit --omit=dev

The dashboard owner was fixing the `fast-uri` advisory concurrently, so this was
run twice.

| Workspace | 21:32 (pre-fix) | 21:36 (post-fix) |
| --- | --- | --- |
| `apps/dashboard` | 1 high — `fast-uri` 3.0.0–3.1.3, GHSA-v2hh-gcrm-f6hx | **found 0 vulnerabilities** |
| `protocol` | 1 high — `fast-uri` 3.0.0–3.1.3, GHSA-v2hh-gcrm-f6hx | **still 1 high — unfixed** |

Result: dashboard **PASS**; protocol **FAIL, open**. `protocol/` carries the same
transitive `fast-uri` high-severity advisory (host confusion via a literal
backslash authority delimiter) and `npm audit fix` is reported as available. That
workspace belongs to the protocol owner, not to mosaic-backend, and was
deliberately not modified here.

## Compose profile check

The Compose network change made in this pass (a pinned default-network subnet so
the edge proxy can hold a stable address) was verified end to end:

```
$ docker compose config                                     # valid, no errors
$ docker compose up -d postgres
  Network mosaic_default Created
$ docker network inspect mosaic_default --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
172.28.0.0/16
```

`docker compose config` also resolves
`MOSAIC_TRUSTED_PROXY_CIDRS: 172.28.0.10/32` for the `api` service and
`ipv4_address: 172.28.0.10` for `local-edge`.

## OpenAPI spec check

`docs/backend/openapi.yaml` parses cleanly after this pass's `HealthEnvelope`
widening: 128 paths, 266 component schemas. No Go or dashboard test reads the
file, so the spec is validated by parse plus manual comparison against
`apps/api/internal/transport/health/handler.go`. The generated dashboard client
was **not** regenerated here — that file is the dashboard owner's.

## Summary

| Check | Result |
| --- | --- |
| apps/api gofmt | PASS |
| apps/api go vet | PASS |
| apps/api go build | PASS |
| apps/api go test (unit + PostgreSQL integration) | PASS — 295 pass, 1 skip, 0 fail |
| apps/api migrations (up / status / preflight) | PASS — version 21, 0 pending, compatible |
| govulncheck source mode (go1.26.2) | 8 called stdlib findings, all fixed by go1.26.5 |
| govulncheck binary mode (go1.26.5) | PASS — 0 called findings across all 6 binaries |
| protocol npm test | PASS — 115/115 |
| protocol npm run validate | PASS |
| dashboard npm run typecheck | PASS |
| dashboard npm run lint | PASS |
| dashboard npx vitest run | PASS — 500/500 |
| dashboard npm run test:relay | PASS — 7/7 (closes the Phase 7 owner condition) |
| sdk/flutter flutter test | PASS |
| sdk/android ./gradlew test | PASS — 156 tests, 0 failures |
| sdk/ios swift test | PASS — 123 tests, 1 skipped, 0 failures |
| npm audit --omit=dev (dashboard) | PASS — 0 vulnerabilities |
| npm audit --omit=dev (protocol) | **OPEN** — 1 high (`fast-uri`), protocol owner |
| `docs/backend/openapi.yaml` parse | PASS — 128 paths, 266 schemas |
| `docker compose config` | PASS |

## Not run

- End-to-end GA drills (D1–D14). Those are recorded in
  `docs/reviews/phase-8-drill-evidence.md` and were not repeated here.
- `sdk/ios` example-app and `examples/` builds.
- `apps/dashboard` `npm run build`.
- MinIO-backed `TestS3CompatibleAssetRoundTrip`.

