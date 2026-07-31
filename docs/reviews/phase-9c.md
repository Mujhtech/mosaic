# Phase 9C Review — Migration, Reconciliation, and Operations

Date: 2026-07-29  
Branch: `phase/9c-migration-reconciliation-operations`  
Accepted Phase 9B baseline: `0aefd7dcf4af873ad065c7eb36560bb1436e6e44`

## Decision

**Not ready for Phase 9C acceptance.** The approved implementation recommendations are incorporated,
and the locally executable contract, backend, dashboard, SDK, and synthetic-driver checks are green.
The milestone remains at the owner review gate because the required PostgreSQL-backed lifecycle drills,
live provider/sandbox evidence, mixed-version SDK exercise, webhook receiver exercise, representative
scale run, and elapsed stabilization/retention windows have not been executed. No production authority
promotion is authorized by this review.

## Delivered scope

- Billing Migration Operations v1, Authoritative Entitlement v2, and Billing State Webhook v2 draft
  contracts, fixtures, compatibility manifests, and rejection cases.
- Immutable source evidence, encrypted source objects, RevenueCat v2 capability assessment and pulls,
  cursor/watermark chaining, validation, candidate evaluation, dry/shadow execution foundations, and
  durable worker composition.
- Scoped, monotonic authority readiness, proposal/approval/checkpoint, cutover, rollback, transition
  delivery, stabilization, rollback-readiness, completion, retention, legal-hold, and credential-removal
  persistence and services.
- Allowlisted repair previews/executions with durable reservation, pending/terminal lifecycle,
  idempotent replay, atomic mapping invalidation, and production adapters. The repair execution plane is
  enabled only when both Mosaic Billing and `MOSAIC_BILLING_MIGRATION_ENABLED` are enabled.
- Trusted, PII-free access-API stabilization evidence with fresh-window aggregation; missing evidence
  fails closed and one instance's success cannot mask another instance's error.
- Closed, tenant-scoped operational read resources and lower-camel runtime JSON aligned to OpenAPI and
  the regenerated dashboard client. Generic operational records were removed.
- Dashboard migration lifecycle surfaces gated solely by server-derived operator capabilities, with
  exact state/digest confirmation, two-person guidance, 403/409 refresh behavior, and no secret display.
- Authority-aware Flutter, iOS, and Android SDK behavior, cache tombstoning, fallback, and protocol
  conformance.

## Validation evidence

| Area | Result | Evidence |
| --- | --- | --- |
| Go repository | PASS | `GOCACHE=/private/tmp/mosaic-go-cache go test ./...` |
| Focused Go vet | PASS | Phase 9C domain, PostgreSQL, repair, transport, API, migration, and tagged demo packages |
| Protocol | PASS | `npm run validate`; `npm test` — 205/205 |
| Dashboard formatting/lint/types | PASS | Prettier, ESLint, and `tsc --noEmit` |
| Dashboard tests | PASS | 110 files, 608 tests; focused migration suite 16/16 after final client generation |
| Dashboard production build | PASS | Vite client and SSR builds |
| Flutter SDK | PASS | 390 tests; 2 documented existing skips |
| iOS SDK | PASS | 228 tests; 1 documented existing skip |
| Android SDK | PASS | Full SDK test task |
| Phase 9C demo compile/vet | PASS | `go test -tags billingdemo ./cmd/billingdemo`; tagged vet |
| Diff hygiene | PASS | `git diff --check` |

The dashboard local-preview relay suite is unavailable in the managed sandbox because binding
`127.0.0.1` returns `EPERM`; this is an environment limitation, not a Phase 9C test assertion failure.

## Operational drill status

The build-tagged `-phase 9c` driver uses synthetic, isolated inputs and labels its evidence boundaries.
It partially covers drills 1, 2, 6, 12, 16, and 18. Drills 3–5, 7–11, 13–15, 17, 19, and 20 remain
unexecuted. Partial evidence is not counted as drill acceptance.

A dedicated database named `mosaic_phase9c_drill_driver` was created but remains empty. Managed
approval limits prevented connecting the Go process to PostgreSQL at `127.0.0.1:55432`, so migrations
and the driver were not run against it. The same restriction deferred the final stabilization and
repair PostgreSQL integration gates.

## Required evidence before acceptance

1. Run migrations and all Phase 9C PostgreSQL integration suites serially on disposable databases.
2. Execute the complete RevenueCat snapshot/resume/delta/final-watermark vertical slice.
3. Execute ambiguity, divergence, stale-command, atomic cutover, rollback, outage, crash/resume,
   repair, redelivery, deletion/retention, and completion drills.
4. Exercise mixed supported/unsupported and offline Flutter, iOS, and Android clients through authority
   cutover and rollback.
5. Verify Apple and Google sandbox renewal, grace/retry, revoke/refund, restore, and reconciliation.
6. Run a real v2 webhook receiver with failure, retry, stable identity/signature, and operator
   redelivery.
7. Run a representative synthetic large dataset for memory, pagination, fairness, rate limiting,
   cancellation, resumability, progress, and completion reporting.
8. Observe the configured stabilization, rollback, retention, and deletion windows rather than
   substituting timestamps.
9. Obtain independent product, protocol, backend, dashboard, SDK, UX, and final quality acceptance
   with no unresolved critical issue.

## Safety statement

This branch must not switch production authority, promote draft contracts, merge automatically, tag a
release, or begin Phase 10. After the unavailable evidence is executed, update this review with exact
commands, timestamps, dataset sizes, evidence identifiers, failures, recovery, and reviewer decisions,
then return to the owner acceptance gate.
