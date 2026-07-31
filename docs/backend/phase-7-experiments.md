# Phase 7 experiments

Mosaic now manages placement-scoped paywall experiments as immutable published
versions. An Experiment owns one mutable Draft, while publication snapshots its
allocation, metrics, paywall versions, assignment policy, schedule, compatibility
requirements, and optional mutual-exclusion group into an immutable Experiment
Version. Draft writes use `If-Match` and idempotency keys so concurrent Studio
sessions cannot silently overwrite one another.
Once publication succeeds, the Draft becomes read-only: later update attempts
return a conflict while the immutable scientific definition remains available
through the Experiment and Version read APIs.

Schedules require an inclusive UTC `startsAt`; `endsAt` is optional and
exclusive. When the requested start is immediate, publication replaces it with
the authoritative publication time before compiling Delivery v3.

## Lifecycle and delivery

The supported lifecycle is draft, scheduled, running, paused, stopped,
completed, and archived. Start, resume, pause, stop, complete, archive, and
emergency-stop operations publish a new immutable configuration release and add
an audit-history record. The worker claims scheduled transitions with PostgreSQL
leases and retries them safely.

Configuration Delivery v3 carries canonical Experiment Assignment v1 payloads.
Assignment is deterministic over a length-prefixed SHA-256 input, uses immutable
allocation-version identifiers, and falls back to the normal placement when the
visitor is ineligible, a group holdout applies, or configuration cannot be used.
Delivery v2 remains available through capability negotiation; clients that do
not support the required experiment features receive the established safe
compatibility response instead of a partially understood assignment.
Negotiation selects the highest representation that is both SDK-supported and
actually stored for the current immutable Release, so an SDK advertising
`3,2,1` receives v2 or safe v1 when the current Release predates v3. A valid v3
Release may contain zero Experiment Assignments; its compatibility declaration
is still validated atomically.
Every lifecycle release independently recomputes the normative
`release.contentDigest` for its v2 and v3 representations. Delivery v3 contains
the exact paywall, Product, Entitlement, and Asset closure for every active
Variant in addition to the normal-placement fallback. A stop or completion
publishes one final immutable Assignment with the terminal lifecycle; subsequent
releases omit that inactive Experiment.

SDKs requesting Delivery v3 send four comma-separated capability headers:
`Mosaic-Experiment-Assignment-Versions`, `Mosaic-Experiment-Features`,
`Mosaic-Experiment-Bucketing-Algorithms`, and
`Mosaic-Experiment-Schedule-Policies`. Values must be unique canonical v1
tokens and cover the selected release. Missing or unsupported declarations fail
with `unsupported_capability`. Configuration responses include all four names
in `Vary`, preventing a shared representation cache from crossing capability
sets.

Mutual-exclusion groups are immutable, versioned allocation maps whose members
reference stable Experiment root IDs. Drafts may therefore select a Group
Version before publication; publication validates root membership and Delivery
v3 separately pins the exact active Experiment Version. Every delivered group
object includes the complete immutable member-range snapshot and optional
normal-Placement holdout range so assignment is independent of array order.
QA overrides
are environment-scoped, expire within 24 hours, store only selector digests, and
return the bearer token only when created. Tokens and raw selectors are never
returned by list operations.

## Analytics and interpretation

The ingestion endpoint accepts both Analytics Event v1 and v2. Experiment v2
events carry the complete immutable attribution tuple: experiment, Experiment
Version, variant, and allocation version. The service validates that tuple
against published repository state before accepting it and rejects partial or
mismatched attribution.
The enclosing batch contract version must exactly match every Event schema
version. Mixed v1/v2 batches reject as invalid batches before authentication or
persistence.
Privacy deletion dirties both the deleted identity's event-date buckets and any
earlier exposure buckets affected by later conversions inside a selected
metric's attribution window before aggregate recomputation completes.

Results count unique assignment units, not raw event totals. They report Wilson
intervals for variant rates, Newcombe intervals for absolute lift, descriptive
Pearson chi-square sample-ratio-mismatch diagnostics, fallback exposure counts,
freshness, exclusions, and warnings. Results intentionally never declare a
winner. Raw experiment exports use the existing private object-storage job
boundary and role checks.

Every guardrail selected by the immutable Experiment Version is returned as a
typed result with per-Variant and total denominator/numerator counts, rate,
aggregate freshness, minimum-Variant sample maturity, and attribution-window
closure. A mature Treatment rate above Control is a descriptive `warning`;
stale and insufficient data remain visible, and no guardrail status causes an
automatic stop or traffic change.

Every metric uses the Experiment Version's assignment-key policy as its
analysis unit: installation, identified user, or identified user with
installation fallback. Client-completed and provider-confirmed purchases remain
separate canonical events. The provider-confirmed primary metric is advertised
as `trusted_source_unavailable` until Mosaic has a trusted ingestion source;
publication cannot select unavailable metrics. Provider-unavailability uses the
typed `product_unavailable` event filtered to its canonical
`provider_unavailable` reason.

## Persistence and operations

Migrations `00017_phase_7_experiments.sql` and
`00018_phase_7_experiment_delivery_analytics.sql` add experiment state,
immutable versions, groups, QA overrides, schedules, release references,
attribution, aggregates, and rebuild scope. Database constraints and triggers
protect allocation coverage, published immutability, and referenced paywall
versions and commerce mappings. Publication requires connected, ready Products,
an Entitlement grant, and a current available mapping for every stored active
Environment/Application provider assignment; connected providers must also be
active and healthy. Composite foreign keys bind release and analytics
Experiment tuples to the same Project and Environment.

The API and worker require PostgreSQL and do not migrate schema automatically.
Apply migrations explicitly with `go run ./cmd/migrate up`. The additional
runtime setting is:

- `MOSAIC_ANALYTICS_EVENT_V2_SCHEMA_PATH`, defaulting to the canonical
  `protocol/schema/analytics-event/v2/event.schema.json` file.

The management and SDK contracts, permission requirements, response envelopes,
and stable error codes are documented in `docs/backend/openapi.yaml`.
