# Phase 6 Review: Analytics, Identity, and Privacy

## Status

**Rejected pending fixes**

Phase 6 delivers the intended analytics, identity, privacy, dashboard, and
cross-platform SDK workflow, and the integrated demonstration succeeds for
canonical SDK-produced events. The final quality gate nevertheless found one
remaining contract-boundary defect after the two permitted review/fix rounds:
event-specific correlation, attribution, and rollout-minimization rules are
enforced by the protocol validation tool but not by the canonical JSON Schema
or the API ingestion path. A malformed or hostile public client can therefore
submit schema-valid over-broad attribution data that the API may persist.

The orchestration contract requires rejection when a blocking issue remains
after two fix rounds. Phase 7 is not authorized.

## Baseline

- Base commit: `019984ae468e6d0a15001ccd753cd00ed083f40a`.
- Branch: `phase/6-analytics-identity-privacy`.
- Worktree: `/Users/muhideenmujeeb/Projects/mosaic`.
- Accepted prior review: `docs/reviews/phase-5.md` (**Accepted with tracked
  follow-ups**).
- Analytics Event Contract: version `1`.
- Metric definitions: Metric Dictionary v1, event-count basis, UTC by default,
  exact correlation within a 24-hour attribution window.
- Identity policy: stable opaque installation identity; optional opaque
  application-user identity; deterministic Project-scoped aliases; no
  heuristic merges; user reset retains installation identity; installation
  reset rotates it.
- Session policy: 30 minutes of inactivity; foreground continuity within the
  threshold; restart resumes only a still-valid session; identity changes start
  a new session.
- Collection policy: disabled until explicitly enabled for an Environment; a
  host runtime override may disable collection; disabling clears the SDK queue.
- Retention policy: raw events default to 180 days, configurable from 30 to 730
  days; aggregates and privacy audit metadata retain for 24 months; export
  artifacts expire after seven days.
- Deletion policy: hard-delete matching raw analytics data and recompute the
  exact affected aggregate buckets.

## Completed Deliverables

### Event contract and taxonomy

- Added a separate Analytics Event Contract v1 with batch, event, ingestion
  response, compatibility, documentation, fixtures, and changelog artifacts.
- Added 27 closed typed event payloads for Placement, Paywall, Product,
  purchase, restore, and provider-confirmed outcomes.
- Defined stable client event IDs, UTC millisecond timestamps, typed identity,
  session, context, correlation, attribution, authority, and partial-batch
  response semantics.
- Added a shared edge-case corpus covering rollout no-Paywall, fallback,
  evaluation/render failures, and unmapped Product/purchase/restore outcomes.
- Did not modify Paywall Protocol 0.1/0.2, Placement Decision, Configuration
  Delivery, or Commerce Provider semantics.

### Correlation identifiers

- Implemented Placement request, Paywall presentation, Product-load attempt,
  purchase-attempt, restore-attempt, and provider-operation identifiers.
- Funnel queries use exact identifiers rather than Product display names,
  prices, or timestamp proximity alone.

### Ingestion and raw event storage

- Added SDK-key-authenticated Environment-scoped batch ingestion with tenant
  scope derived server-side.
- Added event and batch bounds, rate limiting, timestamp rules, stable partial
  results, authority enforcement, and idempotency on Environment plus event ID.
- Added append-only PostgreSQL raw events with immutable attribution,
  event-time identity, source authority, and retention metadata.
- Public SDK requests cannot claim provider-confirmed authority.

### Identity and sessions

- Added Project-scoped installation identities, application-user aliases,
  subjects, identity history, sessions, and privacy audit records.
- Identification affects future events without rewriting historical events.
- Different application-user IDs remain separate and are never merged by
  email, device, IP, provider data, or another heuristic.
- Canonical opaque 1–256 character application-user IDs are accepted while
  sensitive-shaped values receive a stable permanent rejection.

### SDK queues

- Flutter, iOS, and Android implement persistent bounded at-least-once queues,
  atomic restoration, 50-event/512 KiB sending bounds, event expiry, bounded
  retry, exponential backoff with jitter, partial acknowledgements, collection
  controls, lifecycle flush, manual flush, and safe diagnostics.
- Queue limits are 1,000 events or 2 MiB with a 32 KiB event maximum and ten
  attempts; higher-value purchase and restore outcomes are preserved first.
- Unknown acknowledgement statuses or codes retain and retry the whole sent
  batch on all three SDKs.
- Analytics enqueueing and delivery are not success conditions for Placement,
  rendering, Product loading, purchase, or restore.

### Flutter

- Added Dart Analytics Event v1 models, codec, transport, persistence,
  identity/session integration, full hosted-funnel instrumentation, lifecycle
  handling, example controls, diagnostics, and documentation.
- Fallback and final Placement outcomes emit separately and in order.
- The shared edge-case corpus and malformed-ack retry behavior are covered.

### iOS

- Added Swift Analytics Event v1 models, strict codec, persistent queue,
  transport, Swift-concurrency runtime, lifecycle-aware best-effort flush,
  identity/session integration, full hosted-funnel instrumentation, example,
  diagnostics, and documentation.
- Validation covers UTF-8 limits, safe codes, event-specific fields, rollout
  atomicity, batch uniqueness, and the shared edge-case corpus.

### Android

- Added Kotlin Analytics Event v1 models, strict codec, persistent queue,
  coroutine transport/runtime, lifecycle integration, identity/session
  handling, full hosted-funnel instrumentation, example, diagnostics, and
  documentation.
- Fallback plus final outcomes, render failures, acknowledgement fail-closed
  behavior, semantic byte bounds, and the shared edge-case corpus are covered.

### Aggregation and analytics APIs

- Added idempotent PostgreSQL dirty-bucket aggregation with late-event rebuilds
  and daily event-count rollups.
- Added overview, Placement, Paywall, Product, purchase, Paywall Version
  comparison, provider-error, Product-availability, platform, locale,
  freshness, event-export, settings, identity-preview, identity-export,
  deletion, and job APIs.
- Corrected same-day and partial-day `[from,to)` queries to use exact raw edge
  ranges and aggregates only for complete UTC days.
- Paywall Version comparison reports presentations and correlated
  client-completed conversion per immutable Version.
- Provider and Product issues include safe diagnostic/reason, platform, and
  provider/Product dimensions.
- Provider-confirmed values are unavailable, not zero, until a trusted source
  exists.

### Dashboard

- Added Analytics Overview, Placements, Paywalls, Products, Purchases, and Data
  and Privacy routes while preserving Project and Environment context.
- Added date/timezone/platform/locale/application-version filters, exact metric
  metadata, freshness, low-data warnings, funnels, platform/locale breakdowns,
  immutable Paywall Version comparison, failure reporting, and event export.
- Added collection/retention settings and owner-only identity preview, export,
  deletion, confirmation, status, and download workflows.
- Count metrics are not rendered as rates. Provider-confirmed unavailable
  funnel steps display `Unavailable` without a false drop-off or volume bar.
- Identity input remains in POST bodies and is excluded from URLs, query keys,
  browser storage, filenames, and logs.

### Retention, export, and deletion

- Added configurable Environment retention and restart-safe retention work.
- Identity exports and deletions are owner-only; ordinary event exports remain
  owner/admin. Job lookup tenant-gates before exposing kind or existence.
- Exports spool through private temporary files to bound process memory and use
  deterministic retry-safe object keys.
- Deletions record the exact affected aggregate buckets, hard-delete matching
  data, wait only for those recomputations, and persist explicit progress so a
  zero-event deletion can complete.

### Migrations, OpenAPI, and observability

- Goose migrations `00012` through `00016` add ingestion, aggregates, privacy
  jobs, deletion rebuild scope, and deletion progress.
- Secret-server API keys keep both application binding columns null; public SDK
  analytics keys remain bound to an Application.
- OpenAPI and regenerated dashboard clients cover ingestion, analytics filters,
  settings, export, deletion, job status, and role semantics.
- OpenTelemetry and structured logs cover ingestion and background work without
  placing analytics payloads or sensitive identity values in logs.

### Tests

- Protocol validation and 101 contract tests pass.
- `go test ./...` and `go vet ./...` pass, including PostgreSQL analytics and
  persistence integration coverage.
- Dashboard formatting, lint, type checks, 468 Vitest tests, seven relay tests,
  and the production client/SSR build pass.
- Flutter analysis passes; 160 tests pass with one existing relay opt-in skip.
- Android `test`, `lint`, and `assemble` pass across 206 Gradle tasks.
- iOS runs 112 tests with one existing relay opt-in skip and zero failures.

### Tracked follow-ups

- Define the public/exported event namespace before exposing Mosaic events to
  customer analytics tools. Mosaic-owned exported events should use the
  unambiguous `mosaic_*` prefix, for example `mosaic_paywall_presented` and
  `mosaic_purchase_completed_client`. Provider-native events should retain
  source namespaces such as `rc_*` for RevenueCat and `af_*` for AppsFlyer.
- Decide whether `mosaic_*` is only an outbound/export mapping or becomes part
  of a revised canonical Analytics Event Contract. Do not silently rename the
  current v1 event names; any canonical rename requires compatibility rules,
  fixture updates, SDK updates, ingestion support, and explicit contract
  review.

## Product Review

- Phase fit: the implementation remains limited to essential analytics,
  deterministic identity, privacy controls, and Public Beta operation.
- Analytics value: the complete monetization journey is attributable to exact
  Placement, immutable Paywall Version, stable Mosaic Product, and provider.
- Metric scope: event counts and exact correlated rates are explicit; low data
  never declares a winner; provider-confirmed metrics remain unavailable when
  no trusted source exists.
- Identity boundary: Mosaic accepts opaque IDs, maintains event-time history,
  and does not become a customer-profile or entitlement system.
- Privacy scope: collection controls, minimization rules, retention, tenant
  authorization, export, hard deletion, aggregate recomputation, and audits are
  implemented. The remaining ingestion-boundary minimization defect prevents
  acceptance.
- Public Beta readiness: credible for canonical SDK clients, but not releasable
  until the API enforces the same per-event minimization rules.
- Experiments, statistical significance, automatic winners, MRR, ARR, LTV,
  reconciliation, cohorts, predictions, and financial reporting remain
  deferred.
- Owner decisions: collection defaults, identity resets, session timeout,
  timestamp tolerances, attribution window, queue bounds, metric basis,
  provider-confirmed availability, permissions, retention, export expiry, and
  hard-deletion/recomputation policies are frozen in the accepted plan.

## UX Review

- Analytics navigation and Environment context are consistent across the six
  Phase 6 surfaces.
- Funnels expose event definitions, accepted counts, correlation window,
  freshness, drop-off, low-data warnings, and unavailable states.
- The Metric Dictionary exposes value, numerator, denominator, basis,
  authority, timezone, attribution window, and backend definition.
- Paywall comparison uses immutable IDs and the same filters, basis, timezone,
  and correlation window.
- Provider errors and Product failures use safe diagnostics and recovery-safe
  dimensions without raw provider payloads.
- Retention states the 180-day default and 24-month aggregate/audit policy.
- Export and deletion are separated, preview affected data, require explicit
  deletion confirmation, and expose asynchronous status.
- Browser verification found and closed the misleading count-as-percentage,
  dropped-filter, incomplete retention-copy, hidden comparison, and
  provider-unavailable-as-zero defects.
- Nonblocking polish remains possible for Project Overview discovery,
  action-bearing empty states, and the `Opaque identity` label, but these do not
  supersede the blocking ingestion issue.

## Engineering Review

- Migrations apply through `00016`; PostgreSQL remains the only production
  system of record and no production in-memory fallback was introduced.
- Ingestion is tenant-derived, bounded, rate-limited, partially accepting, and
  idempotent. Raw accepted events are append-only.
- Source authority, duplicate results, partial acknowledgements, retry classes,
  and unknown-code fail-closed behavior are explicit.
- SDK queues survive reconstruction and preserve event-time identity; retry and
  overflow behavior are bounded and nonblocking.
- Identity aliases are deterministic and Project-scoped. Resets and sessions
  match the accepted cross-platform policy.
- Aggregation is idempotent, restart-safe, duplicate-safe, and late-event-safe.
  Exact edge ranges prevent same-day data loss.
- Retention, export, deletion, and aggregate recomputation are tenant-scoped and
  auditable.
- Known blocking defect: the API runtime does not enforce every per-event
  correlation/attribution allow-list and rollout atomicity rule implemented by
  the protocol semantic validation tool.
- Operational follow-up requiring policy: define an explicit export artifact or
  row quota before adding resumable multipart uploads and lease heartbeats.
- Unavailable checks: no connected Android device; no final iOS example rebuild
  after codec-only changes because Xcode stalled fetching RevenueCat; no live
  trusted provider-confirmed source exists by policy. Earlier native example
  builds and all platform unit/conformance suites passed.

## Protocol Review

- Analytics Event Contract v1 is separate, documented, and versioned.
- Event payloads are typed and closed; no arbitrary custom properties bag was
  introduced.
- Authority, timestamps, identity, correlation, partial-batch, permanent
  rejection, retryable rejection, and unknown-acknowledgement behavior are
  explicit.
- Existing Paywall, Placement, Configuration Delivery, and Commerce contracts
  remain unchanged.
- Tracked naming decision: public/exported Mosaic-owned events should use a
  `mosaic_*` namespace, while provider-native events retain prefixes such as
  `rc_*` and `af_*`. Whether this is an export-only mapping or a canonical
  contract revision must be resolved explicitly before implementation.
- Blocking inconsistency: `protocol/tools/analytics-event-validation-v1.mjs`
  rejects unrelated per-event correlation/attribution and incomplete rollout
  tuples, but the canonical JSON Schema remains structurally permissive for
  globally known fields and the API ingestion path does not run equivalent
  semantic checks. The invalid minimization fixtures can therefore pass the
  schema used by runtime ingestion.

## Privacy Review

- Collection starts disabled and can be disabled by Environment or host runtime.
- Disabling collection stops new events and clears queued events.
- Data collection is typed and bounded; advertising identifiers, raw provider
  objects, credentials, contact data, payment data, exact location, and
  unrestricted metadata are not collected by default.
- Export, deletion, job status, and downloads are tenant-scoped; identity
  privacy operations are owner-only.
- Retention settings and jobs are Environment-scoped and audited.
- Identity relationships are deterministic; different user IDs are not merged
  heuristically and advertising identifiers are never used.
- The remaining ingestion allow-list gap weakens the promised data-minimization
  boundary and must be fixed before acceptance.

## Demo Review

- A synthetic Project, Environment, Application, Placement, Product, Paywall,
  two immutable Paywall Versions, and two Configuration Releases were created.
- Analytics was enabled and a canonical monetization journey was ingested.
- Fourteen events were accepted; replaying the same batch produced fourteen
  duplicate results without changing metrics.
- Placement, Paywall, Product, and purchase funnels reported the expected exact
  correlated counts.
- Client-completed purchases reported values; provider-confirmed count and rate
  were explicitly unavailable with provider-confirmed authority.
- Both immutable Paywall Versions reported one presentation and one correlated
  client-completed conversion with low-data/no-winner warnings.
- A safe Product-load provider failure reported provider, platform, and
  diagnostic-code dimensions.
- User-data export completed; deletion completed; a subsequent identity preview
  returned not found. Retained browser-demo identity data was also deleted.
- Browser inspection verified populated Overview metrics, platform/locale
  breakdowns, Paywall funnel and comparison, provider-unavailable rendering,
  collection/retention controls, and identity privacy controls.
- Deterministic Flutter, iOS, and Android reconstruction tests prove offline
  queue survival; native example builds were completed earlier, but live device
  interaction was unavailable for Android and the final iOS rebuild was blocked
  by dependency fetching.
- The one-minute canonical demo succeeds. Public Beta readiness is not accepted
  until malformed public clients cannot bypass event-specific minimization.

## Decision

**Phase 6 rejected pending fixes.**

Before another acceptance review, the canonical schema and/or API ingestion
semantic validator must reject unrelated per-event correlation/attribution
fields and incomplete rollout tuples. Add the smallest backend runtime-path
test proving the three canonical invalid minimization fixtures are rejected by
the same validation used by `POST /v1/sdk/events/batch`.

After that blocker is resolved, address the tracked event-namespace decision:
use `mosaic_*` for public/exported Mosaic events, preserve provider-native
namespaces such as `rc_*` and `af_*`, and decide through contract review whether
the prefix is an export mapping or a canonical-version change.

Do not proceed to Public Beta or Phase 7. Do not merge or tag this branch.
