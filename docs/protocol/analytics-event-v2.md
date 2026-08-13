# Analytics Event Contract v2

Analytics Event Contract `2` is the only Analytics Event contract. Ingestion
accepts exactly this batch version and permanently rejects any other.

Canonical artifacts are under `protocol/schema/analytics-event/v2/`,
`protocol/compatibility/analytics-event/v2.json`, and
`protocol/fixtures/analytics-event/v2/`.

## Experiment events

Internal canonical names are:

- `experiment_assigned`: diagnostic assignment only;
- `experiment_exposed`: the statistical exposure denominator;
- `experiment_fallback_presented`: successful normal-Placement fallback;
- `experiment_assignment_failed`: safe diagnostics.

These canonical names are the wire names. They are what SDKs emit, what
ingestion accepts, what the schemas enumerate, and what Mosaic's own NDJSON and
CSV exports write. There is no prefixed variant anywhere in Mosaic.

`mosaic_*` is a *recommended convention for third-party downstream
destinations* — a warehouse or product-analytics tool where Mosaic events share
a namespace with events from other sources. Applying it is the operator's
choice, made in their own pipeline. Provider-native events retain their
provider namespace (`rc_*`, `af_*`). See
[Analytics export names](analytics-export-names.md) for the complete mapping.

Experiment attribution is the all-or-none tuple `experimentId`,
`experimentVersionId`, `experimentVariantId`, and
`experimentAllocationVersion`. It is required on Experiment events and may
also appear on `product_selected` and purchase lifecycle events. It is invalid
on unrelated event families. This tuple is occurrence-time immutable and is
never inferred from current releases, timestamps, aliases, prices, or provider
SKU similarity.

## Exposure boundary

`experiment_exposed` requires Placement request and Paywall presentation
correlation, exact assigned Paywall identity, Product readiness `ready`,
provider capability `accepted`, and successful native presentation. Assignment
without presentation, compatibility rejection, Product failure, render failure,
or disposal before readiness emits no Variant exposure. QA presentations are
excluded and must not emit statistical exposure.

When normal Placement fallback presents successfully,
`experiment_fallback_presented` keeps the assigned Experiment tuple in
attribution and the actually presented Paywall identity in its typed payload.
It never emits or implies original-Variant exposure. Analytics delivery remains
nonblocking.

Event objects are closed, tenant scope is authentication-derived, and the
size, authority, idempotency, timestamp, partial-batch, privacy, and
occurrence-time identity policies apply to every event.
