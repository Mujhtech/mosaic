# Changelog

All notable changes to the Mosaic server and dashboard, which version together
as one SemVer unit. SDKs version independently and keep their own changelogs
under `sdk/*/CHANGELOG.md`.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Protocol schemas are embedded in the API binary (`go:embed`), so a released
  image can no longer be built without them. Filesystem overrides still work for
  operators pinning a schema; a drift test fails the build if an embedded copy
  diverges from `protocol/schema/**`.
- Release identity: `ARG VERSION`/`COMMIT` ldflags stamping, reported by
  `GET /health/live` and as OpenTelemetry resource attributes.
- `GET /health/ready` now checks PostgreSQL, object storage, migration
  compatibility, and required encryption configuration, reporting safe per-check
  codes and 503 while draining.
- The worker serves its own liveness and readiness endpoints
  (`MOSAIC_WORKER_HEALTH_ADDRESS`, default `:8081`).
- `migrate preflight`, `migrate up-to`, `migrate down-to`, `migrate redo`, and a
  richer `migrate status`. `down`, `down-to`, and `redo` require `--confirm`.
- Migration advisory locking and a generous configurable per-step timeout
  (`--timeout` / `MOSAIC_MIGRATION_TIMEOUT`).
- `keyring` command: `validate`, `inspect` (envelope count per key ID), and
  `rotate` (re-encrypt every envelope under the active key in transactional
  batches).
- `loadgen` command: standard-library latency harness for configuration delivery
  (including the 304 path) and analytics ingestion.
- `healthcheck` probe binary, so the distroless image can answer container
  healthchecks.
- Trusted-proxy middleware: `X-Forwarded-For`/`X-Real-IP` are honoured only from
  a peer inside `MOSAIC_TRUSTED_PROXY_CIDRS` (default: none).
- Baseline rate limits for authenticated dashboard APIs and for Placement and
  Experiment decision routes, with `Retry-After` metadata and observable
  rejections.
- `Strict-Transport-Security` (production only) and `Permissions-Policy` response
  headers.
- Observability: otelchi HTTP metrics, pgxpool gauges, worker queue depth /
  oldest-age / dead-letter gauges, delivery 304 ratio counter, object-storage
  spans and per-operation timeouts.
- Operations documentation: backup and restore, upgrade, key rotation,
  observability, performance measurement.
- Operational scripts: `backup-postgres.sh`, `restore-postgres.sh`,
  `backup-objects.sh`, `restore-objects.sh`, `upgrade.sh`, `seed-perf-data.sql`.
- Dashboard Compose service, so `docker compose up` yields a complete
  installation.
- Root `.dockerignore` and this changelog.

### Changed

- **Compose**: `provider-worker` is now `worker` and runs by default; the
  `providers` profile gate is gone because analytics and Experiment jobs are part
  of every installation. `api`, `worker`, `postgres`, `minio`, and `dashboard`
  restart unless stopped, and `api` and `worker` have healthchecks. PostgreSQL and
  MinIO ports are no longer published to the host by default; use
  `--profile debug`.
- Startup configuration validation reports every problem in one structured,
  secret-free error instead of failing one variable at a time. Production now
  rejects wildcard and plaintext CORS origins, a `DATABASE_URL` without a
  verifying `sslmode`, and plaintext object storage, each with a documented escape
  hatch.
- Asset upload honours `MOSAIC_ASSET_MAX_UPLOAD_BYTES` instead of a hardcoded
  11 MiB ceiling; asset upload and event batch ingestion have per-route timeouts
  so the global handler budget does not bound them.
- Connection pool tuning (`MAX_CONN_LIFETIME`, `MAX_CONN_IDLE_TIME`,
  `HEALTH_CHECK_PERIOD`) and session `statement_timeout` / `lock_timeout`
  defaults.
- Shutdown uses separate budgets for HTTP drain, telemetry flush, and pool close,
  and flips readiness to draining first.
- Worker jobs run on a background context with a completion budget so a failure
  record still commits during SIGTERM, and job families are polled round-robin.
- `.env.example` documents every variable the API and worker read, grouped and
  commented.

### Fixed

- **Analytics ingestion boundary (Phase 6 release blocker).** The API now enforces
  the per-event correlation and attribution allow-lists, rollout-tuple
  all-or-none atomicity, and Rule Set pairing rules that the canonical semantic
  validators define, for both v1 and v2 events, with stable machine-readable
  permanent-rejection codes. Previously the canonical validator rejected documents
  the runtime accepted.
- **Experiment scheduling job loss.** `LeaseSchedule` now reclaims expired leases
  and `FinishSchedule` requeues with backoff until the retry budget is spent, then
  records a terminal failure with a diagnostic code. Previously an expired lease
  stranded the job forever and a transient failure was permanent, so a scheduled
  Experiment start or completion could be lost silently.
- **Rate-limit bypass.** Limiter buckets and `remote_ip` log fields were derived
  from an unconditionally trusted `X-Forwarded-For`, so any client could evade
  every limit by rotating the header.
- **Unstartable release image.** The runtime image copied protocol schemas from a
  build context that excluded some of them, and the API failed at startup.
- **Irreversible down migrations.** `00006`, `00010`, and `00018` deleted
  provider mappings, rewrote immutable Configuration Releases, and destroyed
  Experiment attribution on rollback. They now detect affected rows and refuse
  with the restore-from-backup path. Immutability triggers are never disabled.
- Migration `00018` adds the analytics foreign keys `NOT VALID` and validates
  separately, and migration `00019` builds the analysis index `CONCURRENTLY`, so
  upgrading a populated database no longer blocks ingestion.
- `ListOrganizations` scanned every Organization in the installation and filtered
  in the service; it is now a membership-joined query.
- The migrate command no longer wraps the entire run in a fixed 10-second
  context, which aborted any real migration mid-flight.

## [1.0.0-rc.1] - 2026-07-27

First release candidate. Phases 1 through 7 complete: cloud workspace, hosted
publishing, Studio, commerce providers, native store providers, Placement
decisions and targeting, analytics with identity and privacy operations, and
Experiments.

- **Phase 1-2** — Protocol 0.2, Go modular-monolith API foundation, response and
  error helpers, telemetry, PostgreSQL persistence with versioned migrations.
- **Phase 3** — Organizations, Projects, Applications, Environments, API keys,
  Products, Plans, Entitlements; hosted publishing with immutable Paywall
  versions, Configuration Releases, rollback, and digest-addressed Assets.
- **Phase 4** — Commerce Provider and Commerce Configuration contracts,
  RevenueCat adapter, native StoreKit 2 and Google Play Billing providers,
  AES-256-GCM credential envelopes under a multi-key keyring.
- **Phase 5** — Placement decisions, targeting Rule Sets, deterministic rollout
  bucketing, QA overrides, Configuration Delivery v2.
- **Phase 6** — Analytics Event contract v1, ingestion boundary with
  minimization, identity model, aggregation, retention, privacy export and
  deletion.
- **Phase 7** — Experiments: variants, allocation, deterministic assignment,
  exposure semantics, scheduling, metric snapshots, analysis, emergency stop,
  Analytics Event v2, Configuration Delivery v3.

Known limitations at this candidate are recorded in `docs/known-limitations.md`.
