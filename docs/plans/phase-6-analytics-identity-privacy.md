# Phase 6 Plan: Analytics, Identity, and Privacy

## Status

**Accepted implementation contract — 2026-07-26**

Phase 5 is accepted with tracked nonblocking follow-ups. Phase 6 preflight and
both read-only inspection stages completed on 2026-07-26. This plan freezes the
technical boundaries supported by the repository evidence. The owner approved
the complete policy bundle in **Owner-approved policy** on 2026-07-26, which
authorizes Stage 2 implementation under the ownership and review gates below.

Phase 7 Experiments are not authorized by this plan.

## Baseline and preflight

- Base commit: `019984ae468e6d0a15001ccd753cd00ed083f40a`
- Branch: `phase/6-analytics-identity-privacy`
- Accepted prior reviews: `docs/reviews/phase-4.md` and
  `docs/reviews/phase-5.md`
- PostgreSQL 17 remains the runtime system of record.
- Goose migrations `00001` through `00011` apply successfully.
- The API runtime uses pgx PostgreSQL repositories and has no production
  in-memory fallback.
- Hosted Paywalls, immutable Configuration Releases, Placement Decision v1,
  Configuration Delivery v2, offline evaluation, stable Mosaic Product IDs,
  and native Flutter, SwiftUI, and Compose rendering are accepted in Phase 5.
- RevenueCat, custom, StoreKit 2, and Google Play remain optional adapters.
- Customer Entitlement state remains provider-owned.
- No Experiment system or production analytics store exists.
- No dedicated Public Alpha feedback document or measured event-volume study
  was found. PostgreSQL partitioning and a second analytics system are not
  justified.

Preflight checks passed:

- `go run ./cmd/migrate up`
- `go run ./cmd/migrate status`
- `go test ./...`
- `go vet ./...`
- protocol validation and 90 existing contract tests during inspection
- dashboard format, lint, type checks, 452 Vitest tests, and 7 relay tests

## Product promise

Mosaic will explain the complete monetization journey without making analytics
a dependency of that journey:

```text
Placement requested
-> Placement decision
-> Paywall presented
-> Product selected
-> purchase started
-> purchase completed, pending, deferred, cancelled, or failed
-> restore completed, empty, cancelled, or failed
```

Analytics enqueueing, persistence, batching, retry, and delivery must never
change the result of Placement evaluation, rendering, Product loading,
purchase, or restore.

## Explicit exclusions

Phase 6 does not add:

- Experiments, Variants, significance, or winner selection;
- MRR, ARR, LTV, reconciliation, accounting, tax, or forecasting;
- cohorts, predictive analytics, AI insights, or autonomous optimization;
- arbitrary custom events or unrestricted nested properties;
- a customer-profile product or authoritative subscription state;
- Apple or Google server transaction validation;
- Kafka, ClickHouse, BigQuery, partitioning, or a second analytics database;
- a general-purpose job framework, query engine, or consent platform.

## Analytics Event Contract v1

Analytics is a separate versioned contract. It does not modify Paywall
Protocol 0.2, Placement Decision v1, Configuration Delivery v1/v2, or Commerce
Provider v1/v2.

Canonical paths:

```text
protocol/schema/analytics-event/v1/
├── event.schema.json
├── batch.schema.json
├── ingestion-response.schema.json
└── compatibility-manifest.schema.json

protocol/fixtures/analytics-event/v1/
```

Use:

- `analyticsEventContractVersion: "1"` for batch and response framing;
- `eventSchemaVersion: "1"` for an event-name/payload pair;
- Mosaic's existing opaque identifier shape;
- UTC RFC 3339 timestamps with exact millisecond precision;
- closed schemas with `additionalProperties: false`;
- a typed payload variant for every event name;
- no custom metadata in v1.

### Batch envelope

The envelope contains `analyticsEventContractVersion`, `batchId`, `sentAt`,
and 1 to 100 events. Event IDs must be unique inside a batch. Organization,
Project, and Environment IDs are forbidden in public SDK payloads; the public
SDK key derives trusted tenant scope.

### Event envelope

Every client event contains:

- stable client-generated `eventId`;
- `eventSchemaVersion` and closed `eventName`;
- immutable `occurredAt` and `queuedAt`;
- `client_observed` authority assertion, verified and replaced by server-derived
  authority before storage;
- installation identity, optional application user identity, and identity
  generation;
- session ID;
- bounded platform, SDK, operating-system, application-version, and locale
  context;
- event-specific correlation and immutable attribution;
- one typed payload.

The public SDK never sends tenant IDs, advertising identifiers, identity
attribute values, QA tokens, full traces, Paywall text, external URLs, provider
objects, receipts, purchase tokens, credentials, or arbitrary screen content.

Analytics-capable public SDK keys are bound server-side to exactly one
Application as well as their Environment. Ingestion derives Organization,
Project, Environment, and Application from that binding. Legacy unbound public
SDK keys remain valid for existing configuration delivery but cannot ingest
analytics until replaced with an Application-bound key. Application is never
inferred from platform and an event cannot select it.

### Correlation identifiers

Use stable opaque identifiers for:

- Placement request;
- Paywall presentation;
- Product-load attempt;
- purchase attempt;
- restore attempt;
- provider operation/update only when supplied exactly by the provider
  contract.

Funnel relationships use these identifiers. They are never reconstructed from
display names, prices, provider SKUs, or timestamp proximity.

### Immutable attribution

Include where the originating contract supplies it exactly:

- Configuration Release ID;
- Placement ID;
- Placement Rule Set ID and immutable version;
- winning Rule ID;
- Paywall ID and Paywall Version ID;
- stable Mosaic Product ID;
- Mosaic Plan ID only after an accepted contract supplies it;
- provider and safe Provider Product Mapping ID;
- assignment-key type, bucketing algorithm, and rollout bucket without the
  assignment value.

Bundled fallback and Delivery v1 events omit unavailable immutable attribution
instead of inventing it. Google Play base-plan IDs are not Mosaic Plan IDs.

## Event taxonomy

Placement:

- `placement_requested`
- `placement_paywall_selected`
- `placement_no_paywall`
- `placement_fallback_used`
- `placement_unavailable`
- `placement_evaluation_failed`

Paywall:

- `paywall_presented`
- `paywall_dismissed`
- `paywall_action_selected`
- `paywall_render_failed`

Product:

- `product_load_started`
- `product_load_completed`
- `product_load_failed`
- `product_unavailable`
- `product_selected`

Purchase:

- `purchase_started`
- `purchase_completed_client`
- `purchase_completed_provider`
- `purchase_pending`
- `purchase_deferred`
- `purchase_cancelled`
- `purchase_failed`

Restore:

- `restore_started`
- `restore_completed`
- `restore_nothing_found`
- `restore_cancelled`
- `restore_failed`

`purchase_completed_client` has a closed outcome of `purchased` or
`already_entitled`. `already_entitled` is displayed separately and is excluded
from the new-purchase completion numerator. A provider failure is never mapped
to `restore_nothing_found`.

## Source authority

Authority is derived from authentication and accepted integration type:

- public SDK key: `client_observed`;
- accepted secret server endpoint: `trusted_server`;
- accepted provider integration: `provider_confirmed`.

A public SDK submission of `purchase_completed_provider` is permanently
rejected. The current RevenueCat synchronization, RevenueCat client result,
StoreKit verification, and Google Play client result do not constitute a
trusted server confirmation source. Provider-confirmed dashboard metrics are
therefore **unavailable**, not zero, until a later accepted trusted source is
wired without changing this authority rule.

## Event-specific payload contract

Every payload is closed. Optional diagnostics are stable safe codes, never
native messages.

| Event | Required context | Typed payload |
| --- | --- | --- |
| `placement_requested` | request, release, Placement | decision-contract version |
| `placement_paywall_selected` | request, Placement, exact Paywall Version | final outcome; optional assignment-key type, algorithm, and bucket |
| `placement_no_paywall` | request, Placement | final outcome and decision-contract version |
| `placement_fallback_used` | request, Placement | closed trigger, fallback key, final outcome, optional safe code |
| `placement_unavailable` | request, Placement | closed reason and optional safe code |
| `placement_evaluation_failed` | request, Placement | safe code and retryability |
| `paywall_presented` | presentation, exact Paywall Version | empty payload |
| `paywall_dismissed` | presentation | closed dismissal reason |
| `paywall_action_selected` | presentation | closed action and optional component ID; never text or URL |
| `paywall_render_failed` | presentation where available | safe code and retryability |
| `product_load_started` | load attempt, presentation | bounded requested Product count |
| `product_load_completed` | load attempt | available/unavailable counts and duration |
| `product_load_failed` | load attempt | requested count, duration, safe code, retryability |
| `product_unavailable` | load attempt, Mosaic Product | closed reason and optional safe code |
| `product_selected` | presentation, Mosaic Product | `default` or `user` source |
| `purchase_started` | purchase attempt, Mosaic Product | provider and optional safe mapping attribution |
| `purchase_completed_client` | purchase attempt, Mosaic Product | `purchased` or `already_entitled`, duration, bounded observed Entitlement keys, optional safe code |
| `purchase_completed_provider` | exact trusted correlation where available | confirmation source, bounded Entitlement keys, optional linked client event ID |
| `purchase_pending` | purchase attempt, Mosaic Product | duration and optional safe code |
| `purchase_deferred` | purchase attempt, Mosaic Product | duration and optional safe code |
| `purchase_cancelled` | purchase attempt, Mosaic Product | duration and optional safe code |
| `purchase_failed` | purchase attempt, Mosaic Product | duration, safe code, retryability |
| `restore_started` | restore attempt | provider |
| `restore_completed` | restore attempt | duration, exact restored Product IDs when supplied, observed Entitlement keys |
| `restore_nothing_found` | restore attempt | duration and optional safe code |
| `restore_cancelled` | restore attempt | duration and optional safe code |
| `restore_failed` | restore attempt | duration, safe code, retryability |

Dismissal reasons are `user`, `system`, `purchase_completed`,
`host_application`, and `unknown`. Paywall actions are `purchase`, `restore`,
`close`, `navigate_to`, `navigate_back`, and `open_external_url`.
Product-unavailable reasons are `mapping_missing`, `mapping_invalid`,
`product_not_found`, `temporarily_unavailable`, `provider_unavailable`,
`unsupported_product_type`, and `metadata_unavailable`. Lists contain at most
64 stable identifiers, codes at most 96 characters, and durations range from
0 through 86,400,000 milliseconds.

## Timestamp and late-event semantics

- Preserve `occurredAt`; never replace it with `receivedAt`.
- `receivedAt` is server-generated.
- Metric windows use `occurredAt`; freshness and operations use `receivedAt`.
- A timestamp more than the accepted future-skew bound ahead is permanently
  rejected.
- An event older than the accepted event expiry is permanently rejected.
- Accepted late events mark their occurrence-time UTC aggregate buckets dirty.
- Aggregation transactionally rebuilds dirty buckets.
- Dashboard responses expose latest received time, latest aggregated time,
  and the late-event policy.

The accepted numeric bounds are in **Owner-approved policy**.

## Partial-batch and retry semantics

A syntactically valid outer batch returns one result per event:

- `accepted`;
- `duplicate`;
- `permanently_rejected` with a safe code;
- `retryable` with an optional bounded retry delay.

Uniqueness is `(Environment ID, event ID)`. The same ID and canonical digest is
a duplicate. The same ID with different canonical content is permanently
rejected as `event_id_conflict`.

Events are schema-validated independently. All otherwise valid candidates are
persisted in one transaction. A transient persistence failure rolls back that
candidate subset and marks it retryable without changing already identified
permanent failures.

SDKs remove accepted, duplicate, and permanently rejected events. They retain
only retryable events. A malformed acknowledgement retains the complete sent
batch. An invalid outer envelope, unsupported batch version, oversized body,
or unusable event-ID set is a batch-level rejection.

Permanent rejection codes include `event_schema_invalid`,
`unsupported_event_schema`, `unsupported_event_name`, `unknown_field`,
`invalid_identifier`, `invalid_timestamp`, `occurred_at_too_far_future`,
`event_expired`, `event_too_large`, `batch_event_limit_exceeded`,
`duplicate_event_id_in_batch`, `authority_not_allowed`,
`tenant_field_forbidden`, `attribution_not_found`,
`attribution_scope_mismatch`, `event_id_conflict`, and
`sensitive_value_rejected`.

Retryable codes are `rate_limited`, `storage_temporarily_unavailable`,
`service_temporarily_unavailable`, and `ingestion_timeout`. Unknown result
codes or missing event results make the complete sent batch retryable.

## Identity and alias model

- Installation identity is opaque, random, app-install scoped, persistent,
  non-advertising, and contains no personal information.
- Application user identity is optional, host-supplied, opaque, and must not be
  an email, phone number, name, access token, or payment identifier.
- Events snapshot installation ID, optional user ID, and session at occurrence
  time. Queued historical events are never rewritten.
- `identify` changes only future events and opens an effective-dated,
  auditable installation-to-user relationship.
- Clearing identity closes the active relationship and starts a new session.
- One installation may be associated with users A and B at different times,
  but A and B remain separate subjects and are never merged.
- No relationship is inferred from email, display name, device, IP address,
  provider data, or other heuristics.
- Raw events remain historically accurate. Queries and recomputed aggregates
  use event-time subjects for v1.

Proposed cross-platform reset semantics:

- `resetIdentity`: clear application user identity, typed attributes, alias
  metadata, and QA tokens; retain installation ID; begin a new session only
  when state changed.
- `resetInstallationIdentity`: rotate installation ID, clear user-bound state,
  and begin a new session.
- Identifying with the same user and attribute-only changes do not begin a new
  analytics session.

This aligns iOS and Android with the accepted Phase 5 plan. Flutter currently
preserves user state when rotating installation identity; changing it requires
the owner approval recorded below and must be documented as public behavior.

## Session model

Sessions are cross-platform and lifecycle-aware:

- start lazily on the first collected foreground event;
- persist session ID and last foreground/activity time;
- survive SDK reconstruction and application restart inside the inactivity
  threshold;
- start after the threshold, an effective application-user change/clear,
  installation reset, or collection re-enable;
- do not split on brief background transitions, attribute changes, redundant
  identify/clear, or ordinary SDK reconstruction;
- treat background flush as best effort on Flutter, iOS, and Android.

Multiple iOS scenes and repeated Android/Flutter client construction must not
create parallel sessions or duplicate lifecycle observers for one Environment
namespace.

## SDK queue and delivery design

Each SDK owns one persistent analytics runtime per Environment namespace:

- app-private, backup-excluded storage where supported;
- atomic writes and serialized queue mutation;
- immutable encoded event-time records;
- bounded event count and encoded bytes;
- bounded batch size, expiry, attempts, and exponential backoff with jitter;
- one coalesced in-flight flush;
- startup/foreground restoration and flush;
- queue-threshold flush, best-effort background flush, and manual flush;
- safe cancellation and teardown;
- aggregate diagnostics for drops, expiry, permanent rejection, retry, queue
  depth, and last safe code without identity/event payloads.

Overflow removes expired events first, then oldest low-value request/load or
navigation events, then selection/decision events, then presentations, and
purchase/restore outcomes last. The hard bound is never exceeded even if only
high-priority events remain.

Analytics settings use a separate settings/ingestion boundary. Configuration
Delivery v1/v2 are not modified to transport collection policy.

Local Preview and unhosted local Paywalls do not emit hosted analytics.
Provider-neutral instrumentation occurs at Mosaic-owned semantic flow
boundaries, above optional adapters, so the same action is not emitted twice.

## PostgreSQL model and migrations

Accepted migration sequence:

1. `00012_phase_6_analytics_ingestion.sql`
   - optional trusted Application binding for existing API-key rows and
     required Application binding for newly issued analytics-capable public
     SDK keys;
   - collection settings;
   - subjects, installations, application users, effective-dated aliases, and
     sessions;
   - ingestion batches and append-only raw events;
   - tenant constraints, authority constraints, minimal indexes, and
     immutability protections.
2. `00013_phase_6_analytics_aggregates.sql`
   - dirty UTC buckets, aggregate watermarks, typed daily event/funnel
     aggregates, and aggregation jobs.
3. `00014_phase_6_privacy_operations.sql`
   - event/user export jobs, deletion jobs, retention-run state, private export
     object metadata, and append-only privacy audit events.

Key invariants:

- unique `(environment_id, event_id)`;
- tenant-derived application and attribution references;
- append-only raw events outside accepted retention/deletion operations;
- application-user IDs never merge through a shared installation;
- public SDK keys cannot persist provider-confirmed authority;
- export, deletion, retention, and aggregates remain tenant-scoped.

Initial indexes support Environment/time/event queries, retention scans,
identity export/deletion, and exact presentation/purchase correlation. No
speculative index-per-field or partitioning is authorized.

## Jobs and aggregation

Add explicit PostgreSQL-backed analytics job types rather than a generic job
framework. Reuse the existing worker lease pattern:

- queued, leased, completed, and failed states;
- `FOR UPDATE SKIP LOCKED`;
- lease owner/expiry, bounded attempts, and fencing;
- restart-safe cursors;
- idempotent result writes;
- bounded rows and execution time.

Aggregation replaces complete dirty UTC buckets transactionally, is safe for
duplicates and late arrivals, and exposes watermarks and failures. The first
dashboard uses exact event-count and correlation aggregates; approximate
unique-user infrastructure is deferred.

## REST resources and authorization

SDK:

- `POST /v1/sdk/events/batch`

Environment-scoped analytics:

- overview and metric dictionary;
- Placement, Paywall, Product, and purchase funnels;
- Paywall Version comparison;
- Product/provider/platform/locale breakdowns;
- provider errors and Product availability failures;
- freshness;
- asynchronous event export.

Data and privacy:

- collection and retention settings;
- identity search and affected-data preview using POST bodies, never URLs;
- asynchronous user-data export/status/download;
- deletion preview, separately authorized confirmation, status, and audit
  summary.

Every query requires Project, Environment, time range, timezone, and explicit
metric basis. Responses include metric ID, value, numerator, denominator,
basis, attribution window, authority, warnings, and freshness.

Services enforce tenant ownership independently of routes and UI. Permissions
are frozen in **Owner-approved policy**.

Exports are server-generated NDJSON or CSV, optionally compressed, stored as
private expiring objects in the existing S3-compatible store, and downloaded
through authenticated endpoints. Identity values do not enter URL search,
TanStack Query keys, browser storage, logs, filenames, or public Asset URLs.

## Rate limits and operational bounds

The initial single-process limiter uses two bounded layers:

- before authentication: 30 ingestion requests per minute per source IP with
  a burst of 10;
- after authentication: 60 batches and 6,000 submitted events per minute per
  public SDK key, with bursts of 10 batches and 1,000 events.

These are self-host configuration defaults and may be made stricter per
deployment. HTTP 429 and safe `rate_limited` results are retryable and include
a bounded `Retry-After`. The API rejects compressed v1 ingestion bodies until
decompressed-size enforcement exists. Configuration cannot raise the
contract's 100-event or 512 KiB hard limits.

No Public Beta scale claim is made without capacity evidence. Before final
acceptance, run a bounded PostgreSQL ingestion/aggregation smoke load and
record batch latency, row growth, aggregate lag, and rejection behavior.

## Observability

Product analytics and operational telemetry remain separate. Add one
`events.ingest` span per batch and one span per leased worker job, never one
span per product-analytics event.

Bounded OpenTelemetry measurements cover:

- accepted, duplicate, permanent-rejection, retryable, expired, and dropped
  event counts;
- batch event count, uncompressed bytes, ingestion latency, and transaction
  duration;
- queue-to-receive delay, late-event count, dirty-bucket age, aggregate lag,
  and last aggregate completion;
- queued-job count, oldest-job age, attempts, duration, and completion/failure
  for aggregation, export, deletion, and retention.

Allowed labels are event name, schema version, result, safe rejection code,
authority, platform, job type, and Environment mode. Logs, traces, and metrics
must not contain event bodies, authorization values, application-user,
installation, session, correlation, provider transaction, or raw diagnostic
values. Analytics ingestion never emits analytics events about itself.

## Dashboard information architecture

Add one Environment-scoped Analytics workspace with direct-linkable surfaces:

```text
Analytics
├── Overview
├── Placements
├── Paywalls
├── Products
├── Purchases
└── Data and Privacy
```

URL search owns bounded date, timezone, platform, locale, application-version,
and metric-basis filters. TanStack Query owns server state. No global analytics
store or charting dependency is required.

Every surface shows freshness and inline metric definitions. Funnels use
accessible semantic tables/bars, correlation IDs, explicit drop-off, and
missing-data warnings. Client-observed and provider-confirmed outcomes remain
separate. Low-data states show the sample size and never declare a winner.

`Data and Privacy` uses preview -> confirmation -> asynchronous status -> audit
for retention, export, and deletion. Recovery actions link provider errors to
Provider Connections, Product failures to Catalog, and Placement failures to
the relevant Rule.

## Metric dictionary v1

Primary metrics use accepted, deduplicated event counts and exact correlation:

- Placement requests, selected Paywall, no Paywall, fallback, unavailable;
- Paywall presentations;
- presentation-to-Product-selection rate;
- Product-selection-to-purchase-start rate;
- presentation-to-purchase-start rate;
- presentation-to-client-completed-purchase rate;
- presentation-to-provider-confirmed-purchase rate when a trusted source
  exists;
- purchase cancellation, pending, deferred, and failure rates;
- Product load/unavailable failure rate;
- restore completion, nothing-found, cancellation, and failure counts;
- provider error count/rate;
- immutable Paywall Version comparison on an identical metric basis;
- last aggregate completion and raw-ingestion lag.

For each metric the API and UI expose numerator, denominator, event basis,
attribution window, timezone, late-event and duplicate handling, identity
handling, pending/cancellation handling, authority basis, and freshness.
Provider-confirmed absence is unavailable, never zero.

## Privacy operations

Data inventory is limited to the fields required by the metric dictionary.
Sensitive values are rejected by closed contract validation and excluded from
logs, traces, operational metric labels, exports not explicitly authorized,
and audit metadata.

Proposed export/deletion identity scopes:

- application-user request: exact events carrying that application user and
  its alias history across the authorized Project; it does not remove anonymous
  or another user's events from a shared installation;
- installation request: all events and relationships for that exact
  installation across the authorized Project.

Historical raw events are not rewritten during identify/reset. Privacy
deletion is the only accepted destructive raw-event path besides retention.

## Owner-approved policy

The repository previously contained no accepted policy for the following
decisions. The owner approved this Public Beta bundle on 2026-07-26:

1. **Collection:** disabled until an owner/admin explicitly enables analytics
   for an Environment. A host runtime override may disable but never override
   a server-disabled Environment. Consent withdrawal/disable stops new events,
   cancels delivery, and atomically clears unsent events. Re-enable starts a
   new session and does not reconstruct missed events.
2. **Retention:** raw events default 180 days, configurable from 30 to 730 days;
   exact aggregates retain 24 months; privacy audit metadata retains 24 months;
   completed export objects expire after 7 days. Retention is Environment
   scoped and enforced from `receivedAt` in bounded audited jobs.
3. **Deletion:** hard-delete matching raw events, sessions, and identity links;
   mark affected aggregate buckets dirty and recompute them before reporting
   completion. Retain a privacy audit record containing scope/counts and a
   one-way request digest, but no raw identity. Application-user and
   installation scopes follow **Privacy operations**.
4. **Identity reset:** adopt the iOS/Android and accepted Phase 5 semantics in
   **Identity and alias model**, including updating Flutter's installation
   reset to clear user-bound state.
5. **Sessions and time:** 30-minute inactivity threshold; five-minute future
   clock-skew tolerance; seven-day event expiry and late-event rebuild horizon;
   UTC metric buckets by default with an explicit requested reporting timezone;
   24-hour correlation attribution window.
6. **Queue/contract bounds:** 100 events per contract batch; SDKs send at most
   50; 32 KiB per event; 512 KiB uncompressed request; 1,000 queued events or
   2 MiB encoded queue; 10 attempts; exponential backoff from 1 second to 5
   minutes with full jitter; bounded `Retry-After`; no custom metadata in v1.
7. **Metrics and authority:** event-count basis in v1; unique-subject metrics
   deferred; low-data warning below 100 presentations; `already_entitled` is
   not a new purchase; no current provider is trusted for provider-confirmed
   events, so those metrics display unavailable.
8. **Permissions and scope:** member can read analytics; owner/admin can export
   events and change collection/retention; owner-only can search identities,
   export user data, or request deletion. Analytics queries are single-
   Environment. User privacy requests cover the authorized Project and report
   affected Environments in preview.

These eight decisions are frozen for Phase 6. Changing one requires explicit
owner approval and an update to this implementation contract before dependent
production code changes.

## Minimum sufficient tests

Contract and backend tests protect:

- closed typed payloads and fixture compatibility;
- mixed partial-batch classification and event-ID conflicts;
- SDK-key-derived tenant scope and cross-tenant rejection;
- public SDK rejection of provider-confirmed authority;
- append-only/idempotent PostgreSQL ingestion;
- identity transitions without historical rewrite or heuristic merge;
- late-event and dirty-bucket idempotency;
- tenant-scoped retention/export/deletion and aggregate recomputation;
- client versus provider-confirmed metric definitions.

Each SDK consumes shared fixtures and protects:

- persistent queue reconstruction and concurrent flush serialization;
- partial acknowledgement, retry, expiry, and priority overflow;
- event-time identity/session preservation;
- collection-disabled behavior;
- cross-platform reset/session semantics;
- exact Placement/Paywall/Product/purchase/restore correlations;
- analytics failures leaving monetization results unchanged;
- lifecycle flush coalescing and best-effort limitations.

Dashboard tests protect:

- URL-owned Environment/filter scope and query-key isolation;
- explicit client/provider metric separation and definitions;
- immutable-version comparison basis warnings;
- low-data, freshness, missing-data, and unavailable states;
- privacy permissions, affected-data preview, confirmation, job recovery, and
  keeping identity values out of URLs, caches, storage, and filenames.

No new test runner, browser harness, snapshot system, database, mock framework,
or chart-library test suite is authorized.

## Stage order and ownership

After the owner gate:

1. Stage 2: `mosaic_protocol`, `mosaic_backend`, and `mosaic_dashboard` own the
   non-overlapping paths defined in the orchestration prompt.
2. Validate contract fixtures, migrations, Go, OpenAPI generation, and
   dashboard checks.
3. Stage 3: `mosaic_flutter`, `mosaic_ios`, and `mosaic_android` own only their
   SDK/example/documentation paths and consume the frozen contract.
4. Run cross-platform fixture conformance and complete validation.
5. Run the PostgreSQL-backed integrated demonstration.
6. Stage 5 uses read-only Product, UX, Protocol, and Quality review.
7. Limit the fix/review loop to two rounds and stop at
   `docs/reviews/phase-6.md` without merging, tagging, or beginning Phase 7.

## Public Beta demonstration

```text
Publish one Placement and Paywall
-> launch a native example
-> request the Placement and present the exact Paywall Version
-> load and select a stable Mosaic Product
-> start and complete or cancel purchase
-> disconnect network and queue events
-> restart and prove queue restoration
-> reconnect and flush
-> resend one event and prove idempotency
-> inspect Placement, Paywall, Product, and purchase funnels
-> compare immutable Paywall Versions
-> show provider-confirmed metrics as unavailable unless trusted data exists
-> export one identity's data
-> preview and request deletion
-> inspect recomputation, completion, and privacy audit status
```

No production customer data is used.
