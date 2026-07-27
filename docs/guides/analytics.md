# Analytics

Mosaic collects a closed set of monetization events from the SDKs and turns
them into per-Environment reports. Collection is off by default and analytics
delivery never blocks rendering or purchasing.

## Enabling collection

Collection is disabled for every Environment until an owner or admin turns it
on. Dashboard:
`/organizations/{organizationId}/projects/{projectId}/analytics/{environmentId}/data-privacy`.
API: `PUT /v1/projects/{projectId}/environments/{environmentId}/analytics/settings`
with `collectionEnabled` and `rawRetentionDays` (30–730 days, default 180).
While collection is disabled, ingestion for that Environment is refused.

## Event contracts

SDKs send events in batches to `POST /v1/sdk/events/batch` (public SDK key;
batches up to 100 events and 512 KiB, per-event outcomes, idempotent event
IDs). Two contract versions exist:

- **Analytics Event 1** — the closed v1 catalog (27 events): paywall
  presentation, interaction, product, purchase, and session events. No custom
  metadata; unknown event names or fields are rejected.
- **Analytics Event 2** — a backward-compatible superset adding four
  Experiment events (`experiment_assigned`, `experiment_exposed`,
  `experiment_fallback_presented`, `experiment_assignment_failed`) and the
  Experiment attribution tuple on purchase-funnel events. Experiment
  conversion attribution requires v2 — see the
  [experiments guide](experiments.md).

A batch is exactly one version; v1 and v2 events are never mixed. Canonical
event names are unprefixed and identical across versions; the `mosaic_*`
prefix is only a recommended convention when forwarding exports to external
tools ([docs/protocol/analytics-export-names.md](../protocol/analytics-export-names.md)).
Contract references:
[analytics-event-v1.md](../protocol/analytics-event-v1.md),
[analytics-event-v2.md](../protocol/analytics-event-v2.md).

The ingestion boundary also enforces minimization: values shaped like email
addresses, phone numbers, tokens, or payment identifiers are permanently
rejected (`sensitive_value_rejected`).

## Reports

Per Environment under
`.../analytics/{environmentId}/...`, the dashboard provides these surfaces:
`overview`, `placements`, `paywalls`, `products`, `purchases`, and
`data-privacy`. The monetization surfaces are funnels (placement decision →
paywall presentation → product selection → purchase), with paywall-version
comparison, provider-error and product-availability views, and breakdowns by
platform and locale. Aggregates are UTC daily buckets computed by the worker;
a freshness indicator shows aggregation lag. There is no cohort-retention
report in v1 ("retention" in the dashboard refers to data retention).

Raw events can be exported per Environment
(`POST .../analytics/exports`, NDJSON or CSV); export artifacts are private
and expire after seven days.

## Known limitation: three guardrail metrics always read zero

The Experiment guardrail metrics `product_unavailable`,
`provider_unavailable`, and `paywall_render_failure` always report zero
conversions: their numerator events are forbidden by the approved Analytics
Event 2 contract from carrying the Experiment attribution tuple, so
aggregation can never match them to a Variant. The underlying events are still
ingested and visible in environment-wide analytics — they are just not
attributable to a Variant. Owner-accepted for v1; the fix requires a
post-GA Analytics Event 3. Full entry:
[docs/known-limitations.md](../known-limitations.md#three-experiment-guardrail-metrics-always-report-zero).

## Verification status

Ingestion validation (including the canonical invalid fixtures), aggregation,
funnels, exports, and the collection gate are covered by the backend
integration suites and the GA drills. Backend detail:
[docs/backend/phase-6-analytics-identity-privacy.md](../backend/phase-6-analytics-identity-privacy.md).
