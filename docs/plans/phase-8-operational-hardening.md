# Phase 8 Plan: Operational Hardening and v1 General Availability

Status: Accepted (owner-approved orchestration plan, 2026-07-27). Sections marked
`[pending Stage 1B]` are completed after the protocol and SDK audits reconcile.

## Baseline

- Base commit: `2c4f272` (`v1.0.0-rc.1`), owner-confirmed as the accepted v1
  release-candidate baseline.
- Branch: `phase/8-operational-hardening`.
- Phase 7: accepted with owner note (see `docs/reviews/phase-7.md`); its missing
  runtime evidence is mandatory Phase 8 verification work.
- Phase 6 ingestion-boundary defect: owner-classified GA release blocker,
  in-scope for Phase 8.

## Feature-Freeze Policy

Phase 8 accepts only: release-blocking defect fixes; security, authorization,
data-integrity, migration, backup/restore, reliability, performance,
accessibility, and compatibility fixes; observability, deployment, operational
tooling, documentation, installation, upgrade, and troubleshooting
improvements.

Phase 8 rejects: new Paywall components, Studio capabilities, commerce
providers, Product types, targeting operators, analytics products, Experiment
capabilities, Mosaic Billing, AI assistance, workflow automation, and new
infrastructure categories without an accepted ADR. Specifically refused even if
argued as hardening: `mosaic dev` CLI, Prometheus endpoint beyond existing OTLP
export, release channels, Analytics Event v3 rename, Redis introduction,
resumable multipart export uploads.

Every change must answer: what GA risk it reduces, what realistic failure it
prevents, why it is required before v1, and why it cannot be deferred.

Boundary rulings (orchestrator, recorded): the non-functional organization
switcher, missing sign-out, and missing route guards are shipped-broken
release-blocking defects, not new features. One CI workflow is release
engineering, explicitly in Phase 8 scope.

## Release-Blocker Policy

A defect blocks GA if it falls into any category below. Blockers cannot ship
documented; they must be fixed and verified before a GA tag.

1. Cross-tenant data access (Organization/Project/Environment boundary).
2. Secret or credential exposure (responses, logs, traces, diagnostics,
   exports, audit events, delivered configuration).
3. Critical authentication or authorization bypass.
4. Unrecoverable data loss in a documented supported operation.
5. Migration corruption or a schema left unusable with no documented recovery.
6. Failed backup restoration.
7. Corrupted Configuration Releases (in-place mutation, accepted digest
   mismatch, cross-SDK decode divergence).
8. Incorrect commerce Product resolution.
9. Purchase-result corruption.
10. Incorrect customer Entitlement interpretation (including unknown provider
    state silently rendered as inactive).
11. Broken deterministic Placement or Experiment assignment.
12. Experiment exposure corruption (exposure without successful presentation,
    wrong-Variant attribution, fallback counted as original exposure).
13. Analytics duplication that materially corrupts metrics.
14. Privacy export or deletion crossing tenant boundaries.
15. SDK crash in a supported critical path; analytics failure must never block
    purchasing.
16. Installation or upgrade failure in the supported deployment profile.
17. Protocol contract divergence — canonical schema, semantic validator, and
    API runtime path disagreeing about validity (the Phase 6 defect class).
18. GA claim without evidence — documentation asserting an undemonstrated
    capability.

A blocker is never silently downgraded; reclassification requires an explicit
owner decision recorded in the Phase 8 review.

## Known-Limitation Policy

A defect may ship documented only if it is outside every blocker category, has
a reachable workaround or safe visible failure, cannot cause data loss, money
loss, or a wrong monetization decision, is recorded in release notes and
`docs/known-limitations.md` (surface, platforms, symptom, workaround, planned
resolution, GA-safety statement), and is explicitly owner-accepted at the
Phase 8 gate. Environmental verification gaps ship labelled "not demonstrated",
never implied as working. Owner-accepted limitations at planning time:

- SDKs remain pre-1.0 (`0.x-dev`), installed by git pin or local path (D6).
- Commerce adapters are implemented and contract-tested but not live-verified
  against RevenueCat sandbox, Apple sandbox, or Google Play test track (D10).
- Self-hosted signup is ungated; restricting `/v1/auth/signup` is a documented
  operator responsibility (D9).
- Down migrations are not a rollback strategy; irreversible migrations refuse
  on affected data and rollback is restore-from-backup (R2 policy).
- Statistical scope: no peeking correction, no multiple-comparison correction,
  no winner declaration (deliberate design, documented as scope).

## Owner Decisions (resolved 2026-07-27)

- D1 License: Apache-2.0 confirmed; add README section and manifest `license`
  fields.
- D2 Protocol approval: all v1 contracts flip `releaseCandidate` to `approved`
  at GA keeping identifiers; widen the two analytics manifest schemas that
  hard-code the RC const first.
- D3 Analytics namespace: export-only `mosaic_*` mapping documentation;
  canonical event names unchanged; closes before D2 flips.
- D4 Deployment profile: single-host Docker Compose, plus a documented
  external-managed-services variant (managed PostgreSQL, S3, external TLS).
- D5 Dashboard packaging: dashboard Dockerfile and Compose service are added so
  `docker compose up` yields a complete installation.
- D6 SDK distribution: SDKs stay at 0.x-dev; no registry publishing; honest
  git-pin/local-path installation docs; recorded as a known limitation.
- D7 Browser matrix: Chrome/Edge 111+, Safari 16.4+, Firefox 128+ (floor set by
  Tailwind v4); HTTPS or localhost required; Studio desktop-only (≥768 px).
- D8 Performance targets: publish onboarding targets only at GA (10 minutes to
  first paywall, 2 minutes to publish); measure latency in Phase 8 and record
  results as evidence; one hard reliability target — a Mosaic outage never
  prevents cached or bundled rendering. Latency numbers publish post-GA.
- D9 Signup gating: documented operator responsibility, no gate flag.
- D10 Commerce verification: documented as not live-verified; Drill 13 runs
  mock/custom-provider flows.
- D11 GA bar: "Ready for General Availability" requires every blocker closed
  and the complete demo passing; "Ready with documented limitations" only for
  honestly labelled environmental gaps; source-level-only evidence is not
  acceptance.
- R1 fix shape: protocol schemas are embedded into the API binary via
  `go:embed`, eliminating the image-packaging drift class.
- R2 rollback policy: refuse-and-restore for irreversible down migrations.
- Load tool: stdlib-only `apps/api/cmd/loadgen` approved (smallest viable
  addition, no new dependency).
- Worker topology: single worker process at GA; un-gated in Compose, restart
  policy, fair scheduling, health listener; multi-instance is post-GA.
- Dashboard runtime config: SSR-injected `window.__MOSAIC_CONFIG__` read once
  at startup (replaces compile-time `VITE_API_BASE_URL` dependence).
- Client error reporting: none by design at GA (privacy-aligned); documented
  policy plus correlation-ID surfacing.
- Hosted workspace responsive floor: desktop-first, documented like Studio.

## Supported v1 Matrix

- PostgreSQL: 17 (the tested version); 16 expected-compatible but unsupported.
- Redis: not used; not part of v1.
- Object storage: S3-compatible; MinIO `RELEASE.2025-07-23T15-54-02Z` is the
  tested implementation (ADR 0018).
- Docker: Engine 24+ with Compose v2 plugin.
- CPU architectures: amd64 and arm64 (Go cross-compiled, distroless base).
- Dashboard browsers: per D7 above.
- Go toolchain (build-from-source): 1.26.x.
- Flutter/Dart minimums: Flutter 3.19 / Dart 3.3 floor `[confirm in Stage 1B]`.
- iOS minimum, Swift, Xcode: `[pending Stage 1B]`.
- Android minimum API, Kotlin, Gradle, AGP: `[pending Stage 1B]`.
- Protocol contracts at GA (all `approved`, exact-match readers): Paywall 0.2;
  Configuration Delivery 1, 2, 3; Commerce Provider 1, 2; Commerce
  Configuration 1, 2; Placement Decision 1; Analytics Event 1, 2; Experiment
  Assignment 1.
- SDK compatibility window: current SDKs with current backend; legacy delivery
  negotiation to v2/v1 preserved; unsupported contracts fail safely retaining
  last-known-valid configuration.

## Deployment Profiles

Profile A (supported): single-host Docker Compose running postgres, minio,
migrate (one-shot), api, worker (un-gated), dashboard, and a TLS edge (Caddy
example). Profile B (documented variant): externally managed PostgreSQL and
S3-compatible storage with operator-provided TLS; Compose runs api, worker,
dashboard only. Everything else is documented as unsupported. Kubernetes,
Helm, and Terraform are explicitly out of scope.

## Configuration Model

All configuration via environment variables, documented exhaustively in
`.env.example` and the environment reference. Startup performs strict
validation: missing required production configuration fails startup with
structured, secret-free errors; production mode rejects unsafe defaults
(wildcard or `http://` CORS origins, default MinIO credentials, disabled
object-storage TLS, plaintext `DATABASE_URL` without sslmode, absent session
or keyring secrets). Development and production requirements are distinguished
by `MOSAIC_ENVIRONMENT`. Secrets are never generated silently at startup and
never printed.

## Secret-Management Model

Provider credentials: AES-256-GCM envelopes with scope-bound AAD under a
multi-key keyring (ADR 0019), with a new `keyring` command providing validate,
inspect (envelope count per key ID), and rotate (re-encrypt under active key).
Sessions: opaque tokens, SHA-256 stored (ADR 0017). API keys: hashed at rest,
rotation documented. Key material never enters logs, telemetry, or backups;
the keyring is backed up separately from PostgreSQL, and its loss consequences
(permanent credential undecryptability) are documented with recovery steps.

## Startup and Shutdown Model

API startup: validate configuration, verify PostgreSQL connectivity (bounded),
verify migration compatibility (fail closed if pending; never auto-migrate),
verify object storage, register telemetry, listen. Shutdown: on signal,
readiness flips to draining, HTTP drains within budget, background work stops,
telemetry flushes, pools close; bounded end-to-end. Worker: jobs run on a
background context with a completion budget so failure records commit even
during shutdown; lease-safe termination; a minimal health listener.

## Health and Readiness Model

`GET /health/live`: process up, version/build identity. `GET /health/ready`:
PostgreSQL ping, object-storage check, migration compatibility, required
encryption configuration; per-check safe diagnostic codes, no credentials or
topology; 503 while draining. No expensive full-system operations.

## Migration, Upgrade, and Recovery Policy

- Migrations apply only via the `migrate` command or the Compose migrate step;
  API startup never mutates schema.
- `migrate` gains: per-migration (not global) generous configurable timeout,
  goose session/advisory lock, `up-to`/`down-to`, `status` with pending list,
  `preflight` (current vs expected version, pending list, dirty detection,
  compatibility verdict), and an explicit confirmation flag for `down`.
- Migration 00018 is reshaped: `NOT VALID` + `VALIDATE CONSTRAINT` for the
  analytics FKs and a concurrent index path, so upgrades do not block
  ingestion on populated databases.
- Irreversible down migrations (00018, 00010, 00006) detect affected rows and
  refuse with a clear error naming the restore path (R2 policy). Fake
  reversibility is never created.
- Supported upgrade: verify version → verify backup → install target → preflight
  → apply migrations → start → verify readiness → smoke checks. Previous
  supported release for upgrade testing: `v1.0.0-rc.1`.
- Failed-migration recovery and failed-start recovery are documented runbooks
  and demonstrated in Drills 2–3.

## Backup, Restore, and Consistency Policy

- PostgreSQL: `scripts/backup-postgres.sh` / `restore-postgres.sh` (pg_dump
  custom format, checksum, metadata; no credentials inside artifacts);
  restore into an isolated instance with integrity verification; retention and
  encryption guidance; PITR pointers for operators who run WAL archiving.
- Object storage: `scripts/backup-objects.sh` / `restore-objects.sh`
  (mc mirror), object inventory, missing-object detection, checksum
  verification, orphan detection, post-restore validation.
- Consistency: a Mosaic backup is PostgreSQL + object storage + keyring
  material (stored separately); documented ordering (DB snapshot first, then
  bucket mirror; assets are immutable and digest-addressed so the bucket may
  only be a superset). A database-only backup is not a complete backup.
- A backup procedure is accepted only after a demonstrated restore (Drills 4–5).

## Data-Integrity Checks

Post-restore verification covers Organizations, Projects, Products,
Entitlements, Paywalls, Configuration Releases (byte-identical by digest),
Placements, analytics aggregates, Experiments, audit history, and asset
digest resolution through the SDK path.

## Worker-Recovery Strategy

Fix `experiment_scheduling_jobs`: reclaim expired leases in `LeaseSchedule`,
requeue with backoff until `attempt_count >= max_attempts`, then surface as
failed with diagnostics. Preserve the correct `FOR UPDATE SKIP LOCKED`
patterns elsewhere. Fair round-robin between provider sync and analytics job
families; queue-depth and oldest-age metrics; per-job structured logging with
job/tenant/trace IDs; restart-safe and duplicate-protected by leases.

## Rate-Limiting and Abuse-Protection Policy

- Trusted-proxy boundary: `RealIP` honoured only when the peer is within a
  configured trusted CIDR set (default: none), fixing spoofable limiter keys
  and forgeable `remote_ip` logs.
- Per-surface limits (tenant-aware where authenticated): auth endpoints
  (strict), configuration delivery, analytics ingestion, asset upload,
  provider-connection testing, export/deletion requests, simulator and
  Experiment export endpoints, plus a baseline limit for authenticated
  dashboard APIs. Not one identical limit everywhere.
- Safe retry metadata (`Retry-After`), bounded request bodies everywhere,
  upload limits honouring `MOSAIC_ASSET_MAX_UPLOAD_BYTES`, batch limits,
  bounded query windows, observable rejections (metrics + logs).

## Security-Review Checklist

Authentication flows; authorization and IDOR sweep (every lookup tenant-scoped
server-side); session cookies (Secure, HttpOnly, SameSite; CSRF posture);
CORS; security headers (add HSTS and Permissions-Policy); trusted proxies;
request/upload limits and content validation; path and redirect handling;
provider-secret encryption; API-key storage and rotation; secret redaction in
logs/traces/errors; SQL parameterization; SSRF in provider/asset egress;
audit logs; error responses (no internals). Dependency scanning
(`govulncheck`, `npm audit`), secret scanning, and SBOM generation run in CI.
The Phase 6 ingestion fix (per-event correlation/attribution allow-lists,
rollout-tuple atomicity, RuleSet pairing in `analytics/validation.go`) is part
of this checklist and verified by the three canonical invalid fixtures.

## Observability Signals and Alert Policy

Signals: HTTP latency/error metrics (otelchi), pgxpool gauges, migration
compatibility status, configuration-delivery latency and 304/ETag hit rate,
publish success/failure and duration, object-storage operation latency and
failures, provider synchronization outcomes, analytics ingestion accepted/
rejected counters, worker queue depth/oldest age/retries/dead-letters,
retention/export/deletion job outcomes, Placement evaluation failures,
Experiment aggregation failures, emergency stops, rate-limit rejections.
Version/build attributes on the OTel resource. No personal attributes or
secrets in telemetry. Telemetry export failure never stops Mosaic.

Vendor-neutral alert definitions (documented, not wired to a vendor):
readiness failing > 2m; migration incompatibility; worker oldest-job age >
15m; job dead-letter occurrence; ingestion rejection rate spike; publish
failure; object-storage failure rate; pool exhaustion (EmptyAcquireCount
rising); rate-limit rejection spike on auth endpoints.

## Runbook List

API will not start; readiness failing; migration failed; PostgreSQL
unavailable; object storage unavailable; worker backlog; publishing failure;
Configuration Release delivery failure; analytics ingestion failure;
aggregation backlog; provider connection failure; compromised public SDK key;
compromised secret API key; compromised provider credential; failed backup;
failed restore; failed data export; failed data deletion; Experiment emergency
stop; rollback after bad release; keyring loss/rotation. Each: symptoms,
impact, diagnosis, safe commands, recovery, verification, escalation,
prevention. (Redis runbook omitted: Redis is not part of v1.)

## Performance Targets and Load-Test Plan

Per D8, Phase 8 measures and records; it does not publish latency SLOs.
Measured paths (loadgen + OTel + EXPLAIN ANALYZE, recorded with environment,
dataset, concurrency, duration, median/p95/p99, error rate, resource use):
configuration delivery (cold/warm/304 ratio), publish, analytics ingestion
(100-event batches), Placement evaluation, Experiment result queries and v3
payload cost, critical dashboard APIs, worker backlog drain (seeded 10k jobs),
pool behaviour under load (acquire wait, EmptyAcquireCount). Hard target
verified by test: outage never prevents cached/bundled rendering. Only
measured release-blocking issues are fixed; no speculative optimization.

## Versioning, Compatibility, and Deprecation Policies

- REST: path-versioned `/v1`; additive changes allowed; breaking changes
  require `/v2` plus migration guidance; no silent removals.
- Server/dashboard: one SemVer unit (`v1.0.0` at GA).
- SDKs: independent SemVer, pre-1.0 at GA per D6; each declares exact
  supported contract versions; public API breaks require release-blocking
  justification, compatibility analysis, migration guidance, owner approval.
- Protocol: contracts approved and immutable at GA; behaviour changes require
  a new contract version; exact-match readers; negotiation selects the highest
  mutually supported representation; unknown versions rejected safely with
  last-known-valid retention.
- Deprecation: deprecated surface removed no earlier than two minor releases
  and six months, migration guide at deprecation time; minimum SDK support
  window 12 months / two minors; skip-version upgrades supported across one
  minor. Final wording `[pending Stage 1B protocol report]`.

## Release-Artifact Policy and CI Gates

Artifacts: versioned API, worker (same image), and dashboard images; immutable
tags; source-commit metadata and `ARG VERSION` ldflags stamping; checksums;
SBOM (syft or `go version -m` + npm equivalents); root CHANGELOG; release,
upgrade, and migration notes. Nothing publishes automatically during
implementation; RCs precede GA.

CI (single workflow, owner-approved): gofmt/vet/build/test with
`DATABASE_TEST_URL` and object-store vars set (integration suites must not
silently skip), goose up/down cycle against seeded data, protocol `npm test`,
dashboard `npm run check` (format, lint, typecheck, test, relay, build),
Flutter analyze/test, Android test/lint/assemble, iOS build/test where runners
permit (documented honestly otherwise), Docker image build + compose smoke
(`curl /health/ready`), `govulncheck`, `npm audit`, secret scan, SBOM.

## Documentation Inventory

Root: README rewrite (v1), LICENSE section, SECURITY.md, CONTRIBUTING.md,
CODE_OF_CONDUCT.md, CHANGELOG.md, release notes, known-limitations register;
TEST.md deleted (credential rotated first — owner action flagged).
User guides: installation, Docker Compose, environment-variable reference,
local development, administrator bootstrap, Flutter/iOS/Android quickstarts
(honest 0.x install paths), RevenueCat, custom provider, StoreKit 2, Google
Play Billing (all labelled not live-verified), Catalog, Product/Entitlement,
Studio, publishing, Placement, targeting, analytics, privacy, Experiments,
backup and restore, upgrade, security, troubleshooting.
Operator runbooks: the list above. Every documented command is validated
against the repository before the Phase 8 review signs off.

## Minimum Sufficient Tests

Per `docs/architecture/conventions/testing.md`; drills and integration
evidence over test-count growth. New tests (each protecting a named risk):

1. Seeded 18→17→up migration cycle (v2 events + Experiment rows) — false-pass
   rollback, unrecoverable upgrade.
2. Container smoke: compose up → `/health/ready` 200 — unstartable image (B1).
3. Experiment schedule lease recovery + transient-failure requeue — silent job
   loss (B3).
4. Three canonical invalid minimization fixtures rejected by the API's own
   validator path — Phase 6 blocker.
5. Spoofed `X-Forwarded-For` from an untrusted peer shares the limiter bucket
   — rate-limit bypass (B9).
6. Keyring rotation: envelope written under key A decrypts after rotation to
   key B — silent credential loss.
7. Readiness 503 when object storage fails while PostgreSQL is healthy.
8. Cancelled run-context still commits the job-failure record.
9. Config-validation table tests for each new production guard.
10. Dashboard: org-switcher navigation and error-not-empty rendering; hosted
    `beforeLoad` redirect with `returnTo` sanitization; `hosted-query-state`
    network/degraded classification; `field.tsx` aria association; focus
    retention on publish/rollback success; runtime-config fallback safety.
11. Flutter: `Mosaic.dispose()` never throws on storage failure (B17) plus
    equivalents found in Stage 1B for other SDK crash paths.
12. Experiment PostgreSQL integration suite (composite tenant keys,
    immutability triggers, allocation invariants) — currently untested SQL.

Explicitly not created: tests for Docker/PostgreSQL/pgx/goose/framework
internals, browser engines, OS lifecycle; no per-file test mirroring; no new
test frameworks beyond the approved CI workflow and stdlib loadgen.

## Explicit Exclusions

Kubernetes, Helm, Terraform, cloud-specific stacks, microservices, Kafka,
ClickHouse, other databases, other queues, gRPC, GraphQL, Mosaic Billing, AI,
new product features, automatic schema creation, automatic production
migrations at API startup, Redis, `mosaic dev`, release channels, Analytics
Event v3, registry SDK publishing (per D6), live store purchases (per D10).

## GA Demonstration

Full demonstration: clean environment → configure → migration preflight →
apply migrations → start API/worker/dashboard/PostgreSQL/object storage →
liveness+readiness → create administrator → Project → Products/Entitlements →
connect provider (mock/custom) → create and publish Paywall → configure
Placement → run Experiment → test purchase (custom provider) → inspect
analytics → verified backup → upgrade → verify migration and data → stop API →
SDK renders from cache → restart API → rotate SDK key → rotate provider
credential → restore backup into isolated environment → verify Products,
Paywalls, Assets, analytics, Experiments → cross-tenant access checks →
operational health. One-minute demo: install → publish native Paywall →
upgrade → survive API downtime via SDK cache → restore from backup → confirm
the product still works.

## Stage Plan and Ownership

- Stage 2 (write): mosaic-backend (apps/api, apps/worker, migrations, compose,
  deploy, scripts, backend docs/tests) ordered WP14 → WP4 → WP9 → WP11 → WP10
  → WP12 → WP2/WP3 → WP1 → WP6/WP7/WP8 → WP5 → WP13; mosaic-dashboard
  (apps/dashboard, frontend docs/tests) WP1–WP7. Non-overlapping paths;
  neither touches SDKs or canonical protocol files.
- Stage 3 (write): mosaic-protocol (approval flip, policies, fixtures,
  changelogs), mosaic-flutter, mosaic-ios, mosaic-android (hardening per
  Stage 1B findings; suites rerun green — Phase 7 owner condition).
  `[work lists pending Stage 1B]`
- Stage 4: GA Drills 1–14 in an isolated Compose environment, evidence
  recorded.
- Stage 5: documentation inventory above via owning agents.
- Stage 6: product/UX/protocol/quality read-only reviews; classified fix pass
  (max two rounds); `docs/reviews/phase-8.md`; no merge; no `v1.0.0` tag.
