# Phase 7 Review: Experiments

## Status

**Accepted with owner note (2026-07-27)** — original review verdict below was
"Rejected pending fixes"; the product owner subsequently accepted Phase 7 with
the following note.

### Owner Acceptance Note (2026-07-27)

The product owner accepts Phase 7 and classifies Mosaic as v1 feature complete
for the purpose of starting Phase 8, with these explicit conditions:

1. The outstanding post-fix runtime evidence listed under "Required Path to
   Re-review" (migration 17/18 down/up cycle, complete Flutter and Android
   suite reruns, the post-fix end-to-end Experiment demonstration, and the
   dashboard relay/browser path) is tracked as mandatory Phase 8 verification
   work. It must be completed and evidenced during Phase 8 before GA; it may
   not be silently dropped.
2. The open Phase 6 ingestion-boundary defect (event-specific correlation,
   attribution, and rollout-minimization rules enforced by the protocol tool
   but not by the canonical schema or API ingestion path) is authorized as
   in-scope Phase 8 data-integrity/security work and is classified as a GA
   release blocker until fixed and verified.
3. The `v1.0.0-rc.1` tag at commit `2c4f272` is confirmed by the owner as the
   accepted v1 release-candidate baseline for Phase 8.
4. No new feature scope is authorized by this acceptance.

**Rejected pending fixes** (original verdict, retained for the record)

Phase 7 implements the planned Experiment protocol, backend, dashboard, and
native SDK surfaces, and the available source-level validation is green. Two
bounded fix rounds also closed the concrete contract, persistence, SDK, and UX
defects found by the prescribed Product, UX, Protocol, and Quality reviews.

The phase cannot be accepted yet because the required post-fix integrated
demonstration and several runtime checks could not be completed after the
execution environment exhausted its approval allowance. In particular, the
strengthened PostgreSQL migrations were not rerun, the final Flutter and
Android fixes were not rerun in their native toolchains, and the complete
publish-to-assignment-to-exposure-to-results-to-stop-to-export path was not
demonstrated after the final backend fixes. These are acceptance checks, not
optional follow-ups, so Mosaic cannot yet claim v1 feature completeness.

The owner-authorized Phase 6 exception is also still open. Phase 7 does not
silently repair or reclassify the rejected Phase 6 ingestion-boundary defect.

## Baseline

- Base commit: `59923f2962f79eb2f81dd84d4ad69bdf59c9ca89`.
- Branch: `phase/7-experiments`.
- Worktree: `/Users/muhideenmujeeb/Projects/mosaic`.
- Prior review: `docs/reviews/phase-6.md` is **Rejected pending fixes**. The
  product owner explicitly approved starting Phase 7 from that baseline; this
  was an exception, not an acceptance of Phase 6.
- Experiment Assignment Contract: version `1`.
- Configuration Delivery Contract: version `3`, with safe v2/v1 projection and
  negotiation fallback.
- Analytics Event Contract: version `2`, while v1 remains accepted and closed.
- Bucketing algorithm: `experiment_sha256_length_prefixed_v1`, using canonical
  length-prefixed UTF-8 input, SHA-256, the first unsigned big-endian 64 bits,
  and modulo 10,000.
- Statistical method: fixed-horizon descriptive reporting using Wilson 95%
  intervals per Variant and Newcombe 95% intervals for absolute lift.
- Assignment policies: `installation`, `identified_user`, and
  `identified_user_or_installation`.
- Product mapping policy: active Experiment meaning is immutable. Product,
  mapping, provider-capability, or Entitlement changes that would alter a
  Scheduled, Running, or Paused Experiment are blocked; recovery requires a
  lifecycle stop/completion and a new Experiment.

The complete owner-approved implementation contract is recorded in
`docs/plans/phase-7-experiments.md`.

## Completed Deliverables

### Experiment model, Drafts, Versions, and Variants

- Added Environment-scoped Experiment roots, optimistic-concurrency Drafts,
  immutable Draft revisions, immutable published Experiment Versions, Variant
  rows, allocation rows, metric snapshots, lifecycle history, QA overrides,
  and mutual-exclusion resources.
- Whole-document Draft updates require an expected revision and reject stale
  writes without last-write-wins behavior.
- Publication locks the source Draft. A published scientific definition cannot
  be edited in place.
- Versions contain exactly one Control and one to three Treatments. Variants
  reference exact immutable Paywall Versions rather than Paywall Drafts or
  provider-native identifiers.
- Variant publication validates the exact Paywall, Product, asset,
  Entitlement, mapping, provider-readiness, and release-association closure.

### Allocation, assignment, and identity

- Allocation covers `[0,10000)` with gap-free, non-overlapping half-open ranges
  and is immutable for the Experiment Version.
- Added canonical assignment and mutual-exclusion vectors consumed by Go,
  Dart, Swift, and Kotlin.
- SDK assignment is local and deterministic; no backend assignment table or
  request-per-assignment path was introduced.
- Anonymous installation and identified-user policies are explicit. Identity
  changes affect future decisions and never rewrite historical attribution.
- Bounded SDK persistence stores only safe IDs, a one-way subject digest, the
  algorithm, bucket, source, and exposure state; it does not store raw
  assignment keys.

### Mutual exclusion, overlap, scheduling, and QA

- Added immutable mutual-exclusion group Versions with stable Experiment
  memberships, explicit ranges, optional terminal holdout, and group bucketing
  independent of candidate order.
- Same-Placement overlap is blocked unless the active Experiments share a
  valid group Version. Shared Paywall/Product and metric relationships produce
  structured warnings.
- Schedules use inclusive UTC starts and exclusive optional ends. SDKs use a
  validated server-time anchor, bounded wall-clock tolerance, and safe normal
  Placement behavior when time is unreliable.
- Pause, stop, completion, and expiration stop future Experiment assignment.
- QA overrides are non-production, visible, bounded to 24 hours, excluded from
  results, and unable to bypass compatibility or Product/provider safety.

### Lifecycle and emergency stop

- Added the approved Draft, Scheduled, Running, Paused, Stopped, Completed, and
  Archived transition graph with stable rejection codes and audit history.
- Lifecycle transitions append history and publish immutable Configuration
  Release snapshots rather than mutating the active Version.
- Emergency stop applies to the whole Experiment, restores normal Placement
  delivery, preserves historical Versions and results, and does not claim that
  offline devices have refreshed.
- Stopped and completed candidates replace previously running last-known-good
  Experiment state in all three SDKs; malformed candidates continue to retain
  the last valid release.

### Delivery and protocol compatibility

- Added Experiment Assignment v1 JSON Schema, manifests, fixtures,
  compatibility metadata, semantic validation, generators, changelogs, and
  documentation.
- Added Configuration Delivery v3 as an atomic extension of the closed v2
  snapshot and Analytics Event v2 as a backward-compatible extension of v1.
- ADR 0021 records the versioning and compatibility decision.
- The hosted endpoint selects the highest representation both supported by the
  SDK and available for the current release. A client advertising `3,2,1`
  therefore receives v2 when only v2 exists rather than an unsupported error.
- A valid v3 release may contain zero Experiment Assignments. Malformed or
  unsupported candidates reject atomically and preserve last-known-valid
  configuration.
- Delivery content digests are recomputed from the exact normative bytes, and
  JSON and digest byte parameters are separately typed for PostgreSQL.

### Exposure and analytics attribution

- Added `experiment_assigned`, `experiment_exposed`,
  `experiment_fallback_presented`, and `experiment_assignment_failed`.
- Assignment is diagnostic only. Original-Variant exposure occurs only after
  exact resolution, Product/provider readiness, native presentation success,
  and an exactly-once presentation acknowledgement.
- Normal Placement fallback is distinct from original-Variant exposure and
  retains both assigned and actually presented identities.
- Product selection and purchase events carry an immutable all-or-none tuple of
  Experiment, Experiment Version, Variant, and allocation Version.
- Analytics ingestion atomically requires every event's schema version to
  match the enclosing batch contract version.
- Privacy deletion marks all affected Experiment exposure buckets dirty,
  including buckets earlier than later correlated outcomes.

### Metrics, guardrails, and statistical reporting

- Added immutable, versioned primary and guardrail metric definitions with
  explicit numerator, denominator, authority, unit, attribution window,
  freshness, and eligibility.
- Client-observed and provider-confirmed outcomes remain separate;
  provider-confirmed purchase remains unavailable without a trusted source.
- Results use first qualifying exposure per assignment unit and at most one
  qualifying conversion in the captured window.
- Added observed counts and rates, Wilson intervals, Newcombe absolute-lift
  intervals, descriptive relative lift, freshness, result-window maturity,
  typed guardrail counts/rates/status, and interpretation suppression.
- Added Pearson chi-square sample-ratio mismatch reporting over unique exposed
  units, with `insufficient_sample` below 100 total exposures or an expected
  cell below five, warning at `p < 0.001`, and critical at `p < 0.000001`.
- Added minimum-sample, conversion-count, expected-cell, duration, freshness,
  maturity, and guardrail warnings. No Winner, significance badge, automatic
  stop, or traffic optimization output exists.

### Dashboard

- Added Environment-scoped Experiment list, creation, and workspace routes
  with Overview, Variants, Metrics, Schedule, Results, History, QA, lifecycle,
  emergency-stop, and export workflows.
- The builder selects immutable Paywall Versions and keeps Control/Treatment
  roles and basis-point allocation visible.
- Published definitions are shown as immutable rather than exposing hidden or
  editable setup.
- Local schedule inputs round-trip safely through UTC and preview the exact
  instant that will be published.
- Mutual-exclusion group management is available in context, and stale Draft
  conflicts preserve unsaved input with an in-place reload/retry path.
- Result copy uses “Observed estimate” and “Descriptive lift,” exposes exact
  uncertainty, freshness, SRM, guardrails, fallback, and recovery guidance, and
  suppresses conclusions with “Do not interpret yet” when required.

### Flutter, iOS, and Android

- All three SDKs add strict Delivery v3 decoding, Experiment assignment,
  mutual-exclusion selection, trusted scheduling, bounded persistence,
  Product-readiness handling, exposure/fallback instrumentation, and safe
  diagnostics while preserving existing Placement APIs.
- Candidate evaluation is ordered by stable Experiment ID rather than delivery
  array order. A group exclusion does not incorrectly suppress an unrelated
  same-Placement candidate.
- Control anchors and exact Product-reference sets are enforced consistently.
- iOS example and platform documentation demonstrate identity, assignment,
  exposure, fallback, and stop behavior. Flutter and Android documentation
  describe the corresponding native integration paths.

### Migrations, OpenAPI, documentation, and tests

- Migration `00017_phase_7_experiments.sql` adds Experiment persistence,
  composite tenant constraints, immutable history, deferred allocation
  invariants, and terminal mutual-exclusion holdouts with
  `holdoutEnd = 10000`.
- Migration `00018_phase_7_experiment_delivery_analytics.sql` adds Delivery v3
  representations, release associations, analytics attribution, aggregate
  state, export filtering, and privacy rebuild scope.
- OpenAPI documents Experiment management, validation, publication, lifecycle,
  results, groups, QA, emergency stop, export, and delivery negotiation. The
  dashboard client is regenerated from it.
- Protocol, backend, dashboard, and SDK documentation describe public behavior,
  safety boundaries, compatibility, interpretation, and known limitations.
- Tests protect contract closure, deterministic assignment, allocation,
  lifecycle, concurrency, immutability, digest integrity, capability fallback,
  Product closure, exposure semantics, attribution, guardrails, statistics,
  privacy rebuilds, and critical dashboard interactions.

## Product Review

- Verdict before fixes: **Approve with changes**.
- Phase fit is correct: Mosaic owns A/B Paywall experiments, deterministic
  assignment, exposure, essential analysis, and safe lifecycle controls without
  expanding into automated optimization, financial analytics, or entitlement
  infrastructure.
- The Experiment value proposition is coherent: teams can compare immutable
  native Paywall/Product presentations without an application release.
- Immutable Versions, Variants, allocations, mappings, attribution, and
  lifecycle history protect scientific meaning.
- Initial review found guardrail reporting incomplete and provider/Product
  publication gates too shallow. The first fix round added typed guardrail
  results and exact Product/provider/release closure validation.
- Dashboard copy was tightened to prevent maturity warnings, percentages, or
  descriptive lift from being read as a winner declaration.
- Owner decisions for contracts, identity, scheduling, allocation, overlap,
  fallback, emergency stop, metrics, statistics, and exclusions are frozen in
  the plan.
- V1 feature-complete readiness is not credible until the blocked runtime
  verification and complete demo succeed.
- Phase 8 operational hardening remains deferred and is not authorized.

## UX Review

- Verdict before fixes: **Approve with changes**.
- Experiment creation exposes Placement, Control, Treatments, allocation,
  assignment identity, metrics, schedule, and validation in a guided workflow.
- Variant roles and immutable Paywall Version identities remain visible before
  and after publication.
- Allocation is accessible as percentages and exact basis points.
- Metric selection distinguishes primary, guardrail, client-observed, and
  provider-confirmed definitions.
- Scheduling now previews the exact UTC value and avoids treating a local
  `datetime-local` value as UTC.
- Lifecycle actions explain their consequences; emergency stop is separated
  from ordinary completion and preserves history.
- Results show counts, estimates, uncertainty, freshness, maturity, SRM,
  guardrails, fallback, and actionable warnings without a Winner field.
- Raw export remains available from historical states with permission-aware
  behavior.
- Initial dead ends around hidden published setup, mutual-exclusion context,
  stale Draft recovery, generic warnings, and over-interpretive result copy
  were addressed in the first fix round.
- Browser task completion was not rerun against a live post-fix API, so the
  integrated UX remains unverified at this gate.

## Engineering Review

- PostgreSQL remains the only non-test backend store; no runtime in-memory
  Experiment repository or alternate database system was introduced.
- Composite tenant keys, immutability triggers, deferred allocation checks,
  and exact release associations protect persistence boundaries.
- Publication and lifecycle changes are transactional and compile immutable
  releases. Draft concurrency and post-publication locks prevent semantic
  mutation.
- Deterministic assignment, identity changes, mutual exclusion, trusted time,
  QA exclusion, exposure acknowledgement, and fallback semantics are
  represented in all SDKs.
- Product safety validates exact Variant closure and blocks semantic mapping or
  Entitlement changes while an Experiment is active.
- The first quality review rejected digest-invalid releases, incomplete
  Variant closure, emergency-stop last-known-good behavior, mutable published
  Drafts, weak provider gates, deletion rebuild gaps, and incomplete tests.
  The first fix round addressed these findings.
- The targeted final quality review then rejected four narrower issues:
  delivery `3,2,1` fallback, valid v3 releases with zero assignments,
  analytics batch/event version mismatch, and a nonterminal group holdout.
  The second and final fix round addressed each issue with regression coverage.
- No further review/fix round was started, honoring the orchestration limit.

### Checks passed

- `go test ./...`.
- `go vet ./...`.
- Protocol `npm test`: 115 tests passed.
- Dashboard API client generation and generated-source consistency.
- Dashboard TypeScript typecheck.
- Dashboard Vitest: 83 files and 478 tests passed.
- Dashboard ESLint with zero warnings.
- Dashboard production client/SSR build.
- OpenAPI YAML parsing.
- `git diff --check`.
- Before the final SDK corrections, Android unit tests, lint, and assemble
  passed; iOS ran 118 tests with one existing opt-in skip and no failures;
  Flutter ran 167 tests with one existing opt-in skip and analysis passed.

### Unavailable checks and known defects

- The PostgreSQL down/up runtime check for the strengthened migrations was not
  rerun after the final changes because local database access required an
  approval that the environment could no longer grant.
- The API could not be restarted after the final publication and negotiation
  fixes for the same environment-approval limitation.
- Flutter and Android native suites were not rerun after their final assignment
  and stopped-release corrections. Their source and tests changed after the
  last successful platform runs.
- The iOS example dependency check remained unavailable; the Swift package
  suite itself had passed before the final backend-only round.
- Dashboard relay tests could not bind `127.0.0.1` in the sandbox and failed
  with `EPERM`; this was an environment failure, not a test assertion failure.
- The Phase 6 event-specific ingestion-minimization defect remains open under
  its original rejected review.

## Protocol Review

- Initial verdict: **Reject**.
- Experiment Assignment is a separate versioned v1 contract, Delivery v3 pins
  it atomically, and Analytics Event v2 adds explicit immutable Experiment
  attribution and exposure/fallback events.
- Cross-platform semantics freeze canonical bytes, hashing, group selection,
  allocation, identity policy, schedule boundaries, Control anchoring, and
  fallback behavior in shared fixtures.
- Exposure is explicitly presentation-success based; assignment is diagnostic
  and fallback presentation is a separate event.
- Existing Paywall Protocol 0.2, Placement Decision v1, Delivery v1/v2, and
  Analytics Event v1 remain closed and compatible.
- Unsupported or malformed contracts fail safely and retain last-known-valid
  state. Legacy clients can receive an unchanged v2/v1 projection.
- The initial critical findings—digest mismatch, incomplete Variant closure,
  cross-SDK candidate ordering/group divergence, and stopped-release
  last-known-good behavior—were addressed in the first fix round.
- The final delivery fallback, zero-assignment v3, analytics version binding,
  and holdout-closure findings were addressed in the second fix round.
- Cross-platform conformance is supported by shared fixtures and platform test
  sources, but final post-fix execution was incomplete and therefore cannot be
  confirmed by this review.

## Statistical Review

- Selected method: fixed-horizon frequentist descriptive reporting.
- Variant conversion is `x / n` over unique exposed assignment units for the
  immutable Experiment Version.
- Each Variant uses a 95% Wilson score interval. Treatment-versus-Control
  absolute lift uses a 95% Newcombe interval derived from the two Wilson
  intervals. Relative lift is descriptive and omitted when Control is zero.
- Results assume the first qualifying exposure and at most one qualifying
  conversion per assignment unit within the versioned attribution window.
  Client and provider-confirmed authority are not combined.
- SRM uses Pearson chi-square against immutable expected allocation. It excludes
  non-presented assignments, QA, group/Placement holdout, and fallback from
  original-Variant counts.
- Minimum interpretation requires at least 100 total unique exposures, every
  expected SRM cell at least five, at least 100 exposures per Variant, at least
  20 conversions, viable success/failure cells, 24 hours of observation,
  aggregates no older than 15 minutes, and a mature attribution/late-event
  window as applicable.
- Repeated peeking is not corrected and no repeated-look p-value is shown.
  Multiple Treatments receive separate descriptive intervals without a
  family-wise hypothesis claim.
- SRM, stale data, immature windows, or guardrail failures suppress conclusion
  language but do not hide raw data or automatically stop an Experiment.
- Known interpretation risks include early stopping, multiple comparisons,
  low Control rates, identity churn, provider-confirmation unavailability, and
  operational differences between Variants. The UI labels results accordingly.

## Demo Review

The integrated demonstration was started against a local PostgreSQL-backed API
with explicit local object-storage settings. It created the prerequisite
Project, Environment, Placement, immutable Control and Treatment Paywall
Versions, and an Experiment Draft.

The first publication attempt exposed two real defects: one PostgreSQL
parameter was reused for JSON and digest bytes, and migration 18 rejected
Delivery v3. Both were fixed, and the migration was successfully cycled before
later review-driven strengthening. Subsequent review found and fixed further
digest, closure, lifecycle, privacy, negotiation, analytics-version, and
holdout issues. The environment approval allowance was exhausted before the
API and database could be rerun after those final fixes.

Consequently:

- Deterministic assignment: implemented and covered by canonical fixtures, but
  the final complete live path was not demonstrated.
- Cross-platform conformance: pre-fix platform suites and shared vectors passed;
  final Flutter and Android corrections were not rerun.
- Exposure semantics: implemented and source-tested; not completed in the
  post-fix live demo.
- Result reporting: implemented and dashboard-tested; not populated through a
  complete post-fix live event path.
- Sample-ratio warning: implemented and unit-tested; not triggered in the live
  demo.
- Emergency stop: implemented and source-tested; not completed in the live
  demo.
- Raw Experiment export: implemented; not completed in the live demo.
- One-minute demo: not completed after the final fixes.
- V1 feature-complete readiness: not yet credible at this review gate.

## Required Path to Re-review

No new feature scope is authorized. A future verification pass should:

1. Apply migrations 17 and 18 down/up against PostgreSQL and rerun persistence
   integration checks.
2. Rerun the complete Flutter and Android suites after the final fixes, plus
   the existing iOS suite and cross-language canonical vectors.
3. Start the post-fix API and complete the required end-to-end demonstration:
   publish, deterministic assignment, no exposure on assignment alone,
   successful exposure, outcomes, uncertainty, minimum-sample and SRM warnings,
   overlap and mutual exclusion, Product-unavailable fallback, emergency stop,
   preserved history, and raw export.
4. Rerun the dashboard relay/browser task path in an environment that permits
   localhost binding.
5. Reconfirm that the Phase 6 rejection is either independently resolved and
   accepted or remains an explicit release blocker.

## Decision

**Phase 7 rejected pending fixes.**

The implementation is materially complete and the two permitted fix rounds
were used, but the required post-fix runtime evidence is incomplete. Mosaic is
not declared v1 feature complete and may not proceed to Phase 8 from this
review. No merge or tag was performed.
