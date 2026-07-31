# Phase 8 Review: Operational Hardening and v1 General Availability

## Status

**Ready with documented limitations** — confirmed by the targeted final
quality verification, which re-ran the cross-surface suites (all green),
verified every fix-round finding closed with executable evidence, and swept
all eighteen release-blocker categories with no remaining known instance.
Its four residual findings (CI toolchain directive, CI MinIO pinning, two
stale documentation lines, one missing test case) were closed before this
review was finalized.

## Baseline

- Base commit: `2c4f272` (`v1.0.0-rc.1`), owner-confirmed as the accepted v1
  release-candidate baseline (see the Owner Acceptance Note in
  `docs/reviews/phase-7.md`).
- Branch: `phase/8-operational-hardening`.
- Worktree: `/Users/muhideenmujeeb/Projects/mosaic`.
- Release-candidate tag: `v1.0.0-rc.1`.
- Supported v1 matrix: PostgreSQL 17 (16 expected-compatible, unsupported);
  S3-compatible object storage (MinIO tested); Docker 24+/Compose v2; amd64
  and arm64; browsers Chrome/Edge 111+, Safari 16.4+, Firefox 128+ (HTTPS or
  localhost required; Studio and hosted workspace desktop-first); Go 1.26
  (release image built on 1.26.5); Flutter 3.22/Dart 3.4; iOS 15+/Swift 6.0
  language mode/Xcode 16+ (GA-verified on Xcode 26.5); Android API 24+,
  Kotlin 2.2.10, Gradle 9.3.1, AGP 9.1.1, JDK 17.
- Supported deployment profile: single-host Docker Compose (Profile A);
  externally-managed PostgreSQL/S3 documented as a variant (Profile B, not
  drill-validated).
- Supported SDK versions: pre-1.0 by owner decision D6 — Flutter
  `0.2.0-dev.11`, iOS `0.1.0-dev.6`, Android `0.1.0-dev.7`; installed by git
  pin or local path; wire `Mosaic-SDK-Version` equals the artifact version on
  every platform.
- Supported protocol contracts (all `status: approved`, exact-match readers):
  Paywall 0.2; Local Preview 0.2 (development-only); Configuration Delivery
  1, 2, 3; Placement Decision 1; Experiment Assignment 1; Analytics Event 1,
  2; Commerce Provider 1, 2; Commerce Configuration 1, 2.

## Feature Freeze

No unapproved product feature entered Phase 8. The final product review
audited all commits since the baseline and confirmed: no new Paywall
components, Studio capabilities, commerce providers, Product types, targeting
operators, analytics products, or Experiment capabilities; no Mosaic Billing;
no AI; no new API paths in OpenAPI. The refused-by-name items (`mosaic dev`,
Prometheus endpoint, release channels, Analytics Event v3, Redis, resumable
uploads) are all absent.

Authorized exceptions, each recorded with its rationale in
`docs/plans/phase-8-operational-hardening.md`: shipped-broken defect fixes
(organization switcher, sign-out, route guards); release-blocking conformance
fixes (Experiment conversion attribution, v1 delivery negotiation after
Experiment publish); the read-only `/diagnostics` page (correlation-ID
surfacing per the recorded error-reporting decision); one CI workflow
(release engineering, explicitly in scope). Every change maps to an
operational, security, reliability, accessibility, compatibility,
performance, or documentation risk.

## Completed Deliverables

**Configuration.** Strict startup validation with structured multi-error
output that never prints values; production-mode rejection of unsafe defaults
(wildcard/plaintext CORS, default MinIO credentials, plaintext object
storage, sslmode-less `DATABASE_URL`, insecure cookies); `.env.example`
documents every variable the binaries read; Compose passes the full operator
environment (a drill found 59 documented variables previously had no effect).

**Deployment.** Complete Compose installation: postgres, minio, one-shot
migrate, api, un-gated worker, dashboard (new Dockerfile, non-root, runtime
config injected server-side), TLS edge example with a pinned trusted-proxy
address; restart policies and healthchecks; no default host publication of
postgres/minio (debug profile); `.dockerignore`; version/commit-stamped
images via `go:embed`-packaged protocol schemas with a byte-equality drift
test (the unstartable-image class is structurally closed).

**Health and readiness.** `/health/live` (version identity) and
`/health/ready` (PostgreSQL, object storage, migration compatibility,
encryption configuration; safe per-check codes; dependency-aware so an
outage reports its true cause); worker health listener on :8081.

**Startup and shutdown.** Bounded startup that fails closed on pending
migrations; SIGTERM drives readiness to `503 draining` for a configurable
window (default 5 s, drill-observed 4.9 s) before drain and staged shutdown
budgets; worker jobs run on a non-cancelled context so failure records commit
during shutdown.

**Migrations.** `migrate` gained preflight (distinct exit codes), status,
up-to/down-to/redo, `--confirm`, per-step timeouts, and a session advisory
lock; migrations 00019–00021 (concurrent index, schedule-job reliability
columns, Experiment-version/Environment integrity); irreversible downs
(00006/00010/00018) refuse on affected data with a HINT naming the restore
path. Fake reversibility was never created.

**Upgrades.** Documented and drilled: rc.1-schema database seeded, preflight
reported pending 00019–00021, applied, data byte-identical, delivery digest
unchanged (Drill 2). Failed-migration recovery drilled (Drill 3).

**PostgreSQL backup and restore.** Scripts with checksums and
credential-free metadata; drilled end to end — restore into isolation, 22/22
workflow checks, identical delivery digest (Drill 4).

**Object-storage backup and restore.** Mirror-based scripts, inventory,
missing-object detection (exit 1 verified on a deleted object), restore with
resolvable assets (Drill 5).

**Encryption-key recovery.** `keyring` command (validate/inspect/rotate)
with transactional re-sealing; rotation drilled (envelope re-sealed A→B);
loss consequences and separate backup documented.

**Worker reliability.** Experiment schedule leases reclaim after crashes and
requeue with backoff to a dead-letter terminal state (previously: silent
permanent loss); fair round-robin; queue depth/age metrics; per-job
structured logging; kill -9 recovery drilled (Drill 6).

**Rate limiting and abuse protection.** Trusted-proxy middleware (forwarded
headers honoured only from configured CIDRs, chain walked right-to-left past
trusted hops — forged-prefix tested); per-surface limiter families including
new upload and export limits; Retry-After metadata; observable rejections;
bounded bodies everywhere.

**Security.** Phase 6 ingestion-boundary defect closed at all three layers
(canonical schemas via generator-enforced allow-lists, protocol tool,
runtime validator) — the divergence class is now structurally impossible;
HSTS and Permissions-Policy; secret redaction verified (drill log scan
clean); 5xx causes logged with request correlation without leaking to
responses; email validation no longer performs live MX lookups; release
image on Go 1.26.5 with binary-mode govulncheck clean; gitleaks, govulncheck,
npm audit, and SBOM generation wired into CI; cross-tenant drill 33/33
refusals (Drill 10).

**Observability.** service.version/commit resource attributes; HTTP
metrics; pgxpool gauges; object-storage spans; queue metrics; delivery 304
ratio; publish and ingestion counters; OTel errors through zerolog;
vendor-neutral alert definitions documented.

**Performance.** stdlib loadgen harness; recorded measurements (delivery
2,279 req/s p99 8.6 ms; 304 path 2,377 req/s at 1.0000 ratio; ingest ~5,500
events/s; zero errors; small dataset, conditions recorded). Per owner
decision D8, no latency targets are published at GA; the unmeasured
onboarding-time targets are recorded as a deliberate non-publication.

**Release engineering.** Single CI workflow (backend integration tests
against postgres/minio services, writer/schema drift sweep, govulncheck, Go
and npm SBOM artifacts, protocol test/validate/generation-drift and audit,
dashboard full check including relay, Flutter, Android with the minified-
example R8 gate, iOS with the iOS 15 deployment-target typecheck, compose
readiness smoke, secret scan). Honestly stated: the workflow is authored and
YAML-validated but unexercised until the repository is pushed to GitHub.

**Dashboard hardening.** Organization switcher rebuilt (navigation, current
org, error-not-empty); route guards with sanitized returnTo; session-expiry
banner; sign-out; degraded/offline/error distinguished with retry
everywhere; root and route error boundaries; pending states; app-wide field
accessibility associations; focus management on publish/rollback and
dialog-based destructive confirms; skip links; live announcer; runtime
config via SSR-injected `window.__MOSAIC_CONFIG__`; `/diagnostics` (build +
API identity, session, liveness, correlation-ID copy) outside the auth
guard; an error-code→copy+recovery mapping so the backend's named error
vocabulary reaches users ("Bind a Placement" instead of "Reload and try
again").

**Protocol compatibility.** Lifecycle widened (retired status, optional
deprecation metadata) before the one-way RC→approved flip of all 13
contracts; Delivery v3 readerPolicy fallback keys; Local Preview manifest
created and wired into validation; policy set (compatibility, deprecation
with the 6+12-month runway, breaking-change process, fixture lifecycle,
release approval) and five migration guides; per-contract changelog status
alignment; the every-Release-carries-every-approved-version production
guarantee and the 406 details vocabulary documented; rejection-layer
metadata generated for every invalid fixture directory.

**Flutter.** Storage failures can no longer escape public APIs (dispose,
lifecycle flush, identity persistence with the permanent-poisoning fix);
`decidePlacement` degrades to its sealed result; v2 acknowledgements
accepted (silent exposure-loss fix); Experiment conversion attribution
emitted on v2 with the tuple only for exposed original-variant
presentations (fallback and QA-override tuple-free); floor raised to
3.22/3.4 and stated as tested; version reconciliation; honest installation
docs; Drill 11 executed live (PASS).

**iOS.** iOS 15 compile floor restored (monotonic clock) with a dedicated
deployment-target typecheck; privacy manifest (SystemBootTime 35F9.1,
collected data, tracking false); configure degrades to in-memory + bundled
fallback instead of throwing; the packaged bundled fallback made loadable
(two latent bugs); trap paths converted to safe errors; acknowledgement
version pairing; conversion tuple tied to the exact exposure condition
(fallback and QA-override leaks fixed, biconditional-tested); goldens
re-recorded with documented visual review; simulator suite 12/12
deterministic; pinned repo `.swift-format`.

**Android.** R8-safe explicit tree codecs for the configuration cache and
exposure ledger (mapping-file proof of the defect; minified example build as
a permanent gate); Google Play delivery store off-main, bounded, no-backup;
correlation/attribution ownership enforced for every schema version;
acknowledgement version pairing; conversion tuple gated on statistical
exposure; bundled fallback pinned with byte-equality packaging tests;
version reconciliation; honest install and R8 docs.

**Documentation.** README rewritten for v1; SECURITY.md, CONTRIBUTING.md,
CODE_OF_CONDUCT.md, CHANGELOG.md, draft release notes, support policy;
14 user guides; 21 operator runbooks; known-limitations register with
Android/Flutter/iOS/Protocol/Server/Dashboard sections in a six-field
format; TEST.md (which contained a plaintext credential) deleted —
credential rotation remains an owner action.

**Tests.** Minimum-sufficient additions across every surface, each mapped
to a named risk (the final quality review spot-checked the plan's list and
found no inflation). Final counts: apps/api 295 pass (with PostgreSQL), 1
S3-only skip; protocol 115; dashboard 500 + 7 relay; Flutter 178 (+2
opt-in-skipped live harnesses); Android 156; iOS 123 + 12 simulator.

**GA drills.** All fourteen drills executed and recorded in
`docs/reviews/phase-8-drill-evidence.md`, with the cross-surface suite
record in `docs/reviews/phase-8-verification-record.md`.

## Product Review

Verdict after the fix round: the freeze held; the drill evidence is honest
(failures recorded before fixes; NOT RUN stated); supported and unsupported
environments are explicit; release claims map to evidence. The initial "Not
ready" was driven by four gaps, all closed in the fix round: Drill 11
executed live (Flutter), the SDK/dashboard suite runs recorded in-repo, the
CI workflow created, the known-limitations register completed and three
documentation overstatements corrected. The Phase 7 owner-note conditions
are all evidenced: migration 17/18 cycle (integration tests + Drill 3), the
end-to-end Experiment demonstration with non-zero conversions (Drill 14 —
which also root-caused the Phase 7 symptom: two SQL defects meant no
Experiment could ever publish against PostgreSQL, so no prior Phase 7
runtime claim involving a published Experiment was trustworthy), complete
SDK suite reruns (verification record), and the dashboard relay path (7/7).
Phase 9 remains conditional; no Billing or AI work entered.

## UX Review

Initial verdict "reject for the gate — approve with changes"; all six
blocking findings closed in the fix round: the dashboard now maps error
codes to Mosaic-owned copy with recovery links; `/diagnostics` is reachable
unauthenticated; the Studio back control targets `/workspace`; the
installation guide configures the dashboard and describes the real first
screen; the troubleshooting guide reflects post-fix behavior; the
undocumented-knowledge instances (Experiment prerequisites, publish traps,
Placement key charset, staging-Placement pattern) are now in the topic
guides. Strengths retained: runbook loop closure, degraded-state design,
the Plans→Products→Access vocabulary. Deferred without dispute: project
switcher, onboarding checklist, bind-in-place drawer (post-GA, tracked as
opportunities, not defects).

## Engineering Review

PostgreSQL remains the only runtime store (link-time guard passing).
Migrations 00001–00021 contiguous; preflight/status/locking demonstrated;
upgrade and failed-migration recovery drilled with evidence. Backup and
restore demonstrated for both stores with checksums and integrity checks;
restored Assets resolvable. Worker recovery drilled including kill -9.
Configuration delivery recovery: 304/ETag behavior byte-stable across
restart and upgrade; SDK cache survival demonstrated live on Flutter
(Drill 11) — iOS and Android cache survival is suite-verified only, recorded
as not demonstrated live. Analytics and Experiment recovery drilled;
conversion attribution verified non-zero through the real pipeline with
fallback exclusion. Performance recorded without invented targets. Known
defects remaining are all in the register; the drill evidence file had two
false rows which were corrected with inline validator output at Stage 6.

## Security Review

Threat surfaces reviewed: authentication (bcrypt, opaque sessions per ADR
0017, format-only email validation), authorization (33/33 cross-tenant
refusals; every lookup tenant-scoped server-side), sessions (Secure,
HttpOnly, SameSite), API keys (hashed, rotation drilled), provider secrets
(AES-256-GCM envelopes per ADR 0019, rotation tooling, keyring recovery
documented), CORS (production guards), trusted proxies (right-to-left chain
walk, /32 edge trust default), security headers (CSP, HSTS,
Permissions-Policy, nosniff, frame denial), uploads (bounded, distinct
limiter), SSRF posture unchanged from ADR-conformant baseline, rate
limiting per-surface, dependency scanning (govulncheck clean on the 1.26.5
image; npm production trees audit-clean; chi's RealIP advisories confirmed
not-called since Mosaic ships its own), secret scanning and SBOM in CI,
vulnerability reporting via SECURITY.md. Unresolved: none known at blocker
severity; chi v5.3.0 upgrade deferred as hygiene.

## Compatibility Review

REST: path-versioned `/v1`; the only surface change in Phase 8 was
additive (health envelope fields, 406 details). Contracts: all approved;
schema deltas since the RC audited line-by-line — metadata, additive-
optional, and pre-approval narrowing only. Old-SDK behavior: v1-only
clients receive a usable carried-forward v1 representation after Experiment
publish (drill-verified; the production guarantee now documented);
unsupported requests get a named 406. SDK conformance: canonical fixtures
consumed from the real tree on all platforms; assignment vectors bound on
all three; the journey fixture exercises the exposure→conversion join.
Deprecation policy (6+12-month runway) and five migration guides published.
Known gaps recorded: commerce-provider fixtures tool-verified only; three
delivery fixtures unconsumed; uneven negative-fixture coverage (iOS-only
for two families); browser-contract generation deferred.

## Operational Drill Results

Recorded in full in `docs/reviews/phase-8-drill-evidence.md` (times,
commands, output, defects, recovery): D1 clean install PASS (2 defects
fixed), D2 upgrade PASS, D3 failed-migration recovery PASS, D4 PostgreSQL
backup/restore PASS, D5 object-storage backup/restore PASS, D6 process
recovery PASS (drain initially FAIL, fixed, re-verified), D7 dependency
failure PASS, D8 delivery recovery PASS, D9 credential rotation PASS, D10
cross-tenant 33/33 PASS, D11 SDK cache survival PASS (Flutter, Stage 6),
D12 privacy operations PASS, D13 commerce smoke PASS (custom provider;
store adapters not live-verified per D10), D14 Placement/Experiment
conformance PASS including non-zero conversions, fallback exclusion,
emergency stop, and export. The drill program found and fixed seventeen
defects that source review had missed, including two that made Experiment
publishing impossible against PostgreSQL.

## Documentation Review

Every guide command was validated against the repository; the drill-
grounded guides label non-validated steps explicitly (Profile B, direct-URL
backup mode, PITR, Caddy signup restriction). Stage 6 corrected the
installation guide against a live bootstrap run (Idempotency-Key,
capability header, ETag semantics). The documentation inventory from the
plan is delivered, with two recorded substitutions (environment reference
lives in `.env.example`; local development lives in CONTRIBUTING.md).

## Known Limitations

All entries live in `docs/known-limitations.md` with impact, affected
users, workaround, planned resolution, and GA-safety statements. Owner-
accepted highlights: SDKs pre-1.0 installed by git pin (D6); commerce
adapters implemented and contract-tested but not live-verified (D10);
signup gating is an operator responsibility (D9); irreversible migrations
refuse-and-restore (R2); three Experiment guardrail metrics always report
zero (fail closed; Analytics Event 3 tracked); descriptive-only statistics
by design; iOS/Android live cache-survival not demonstrated (suite-verified);
Android instrumentation requires a device; throwaway staging Placement
needed for treatment Paywall Versions (design item, post-GA); SSR cookie
caveat; desktop-first dashboard; no client error reporting by design; the
CI workflow unexercised until pushed. None affects GA safety.

## Demo Review

- Clean installation succeeds (Drill 1, re-walked at Stage 6 during the
  Drill 11 bootstrap).
- Upgrade succeeds (Drill 2, real rc.1-schema upgrade).
- Backup succeeds and restore succeeds, both stores (Drills 4–5).
- Downtime recovery succeeds: API-side (Drills 6–8) and SDK cache survival
  live on Flutter (Drill 11).
- Credential rotation succeeds (Drill 9).
- Cross-tenant checks succeed 33/33 (Drill 10).
- SDK compatibility succeeds (negotiation matrix drilled; v1-only client
  served after Experiment publish).
- The one-minute GA narrative (install → publish native Paywall → upgrade →
  survive API downtime via SDK cache → restore from backup → product still
  works) is fully evidenced across Drills 1, 2, 4, 5, 11, and 14.

## Decision

**Ready with documented limitations.**

All eighteen release-blocker categories were swept in the final targeted
verification with no known remaining instance. What separates this from an
unqualified "Ready for General Availability" is exactly the honestly-
labelled environmental set in the register: live store purchases (owner
D10), live cache-survival on two of three SDK platforms, Android
instrumentation, and a CI workflow that cannot run until the repository is
pushed. Every one is recorded, none is GA-unsafe, and none was silently
dropped.

Per the orchestration contract: no merge was performed, no `v1.0.0` tag was
created, and Phase 9 is not begun. Owner actions outstanding: rotate the
credential formerly in TEST.md and the R2 keys in `apps/api/.env`; push the
branch so CI executes; cut `v1.0.0` when satisfied.
