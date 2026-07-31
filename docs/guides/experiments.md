# Experiments

Experiments compare immutable Paywall Versions on live traffic with
deterministic assignment and honest, descriptive statistics. Mosaic
deliberately does not declare winners, apply peeking or multiple-comparison
corrections, or take automatic actions on results — you interpret the numbers
and decide.

## Prerequisites

Two things must exist before an Experiment can publish:

- **A published Placement rule set in the Environment.** The Environment's
  current Configuration Release must already carry a Placement Decision
  representation, i.e. a Placement rule set has been published there. Without
  one, publishing the Experiment fails with
  `409 experiment_placement_decision_required`, whose message names the
  action: publish a Placement rule set in the Environment first.
- **A distinct immutable Paywall Version per Variant.** Versions are minted
  only by publishing a Paywall through a Placement binding. For a treatment
  Paywall that should not touch live traffic yet, use the staging-Placement
  pattern: bind it to a throwaway Placement (typically in a staging
  Environment) and publish there to mint the Version — see the
  [known-limitations register](../known-limitations.md#a-second-variant-paywall-version-requires-a-throwaway-staging-placement).

## Creating an Experiment

Dashboard, per Environment:
`/organizations/{organizationId}/projects/{projectId}/monetization/{environmentId}/experiments`
(list, `new`, and a detail workspace). API:
`/v1/projects/{projectId}/environments/{environmentId}/experiments`.

An Experiment has exactly one Control and one to three Treatments. Each
Variant pins a distinct **immutable Paywall Version** — not a draft, not
"latest" — so what each Variant showed is reproducible forever. Drafts are
edited with revision-checked saves, validated, and published as an immutable
Experiment Version snapshotting allocation, metrics, Paywall Versions,
assignment policy, and schedule.

## Allocation and assignment

Traffic is split in basis points; Variant ranges must be non-overlapping,
gap-free, and cover the whole space (the UI edits percentages that must total
100). Assignment policies: `installation`, `identified_user`, or
`identified_user_or_installation`.

Assignment is a pure function — SHA-256 over a domain-separated,
length-prefixed key material (project, environment, experiment, experiment
version, assignment key), reduced to a bucket in [0, 10000). There is no
stored assignment table: the same key always maps to the same Variant, on
every platform, verified by canonical assignment-vector fixtures bound into
all three SDK test suites.

## Mutual exclusion

Experiments can join a mutual-exclusion group: an immutable, versioned
allocation map that assigns each unit to at most one member Experiment (plus
an optional holdout that always gets normal Placement). Group selection runs
before Variant allocation, and a failed selected Experiment never falls
through to another member. Groups are managed from the Experiments pages.

## Exposure after presentation

`experiment_exposed` — the statistical denominator — is emitted only after
the assigned Paywall Version actually presented successfully with ready
Products and an accepted provider. Assignment alone, a render failure, a
compatibility rejection, or a QA override never counts as exposure. When an
assigned Paywall cannot present and the SDK falls back to normal Placement,
that is recorded as `experiment_fallback_presented`, never as exposure of the
assigned Variant.

## Conversion attribution requires v2 events with the tuple

Conversions attribute to a Variant only when the conversion event is an
Analytics Event 2 event carrying the complete attribution tuple:
`experimentId`, `experimentVersionId`, `experimentVariantId`, and
`experimentAllocationVersion` (all-or-none; partial tuples are rejected at
ingest). The tuple is permitted on the purchase-funnel events
(`product_selected`, `purchase_started`, the `purchase_completed_*` family,
`purchase_pending`, `purchase_deferred`, `purchase_cancelled`,
`purchase_failed`) and captured at occurrence time — never inferred later.
Conversions from a fallback presentation must not carry the tuple. If an app
keeps sending v1 events, every Experiment metric silently reports zero
conversions; see
[docs/protocol/migration/analytics-event-v1-to-v2.md](../protocol/migration/analytics-event-v1-to-v2.md).

## Reading results

`GET .../experiments/{id}/results` and the results panel report, per Variant:
unique exposures, unique conversions, the conversion estimate with a 95%
Wilson interval, and lift versus Control with a 95% Newcombe interval.
These are descriptive only. There is no winner field, no significance badge,
and no automatic action — by design, documented scope. Guardrail metrics show
descriptive status (`insufficient_data`, `stale`, `healthy`, `warning`); a
warning never stops traffic automatically. Note the three always-zero
guardrail metrics limitation in the [analytics guide](analytics.md).

**SRM warnings**: `GET .../experiments/{id}/srm` runs a descriptive
chi-square sample-ratio-mismatch check. A mismatch means observed traffic
shares diverge from the configured allocation — treat results as suspect and
follow the listed investigation steps before drawing conclusions.

## Lifecycle and emergency stop

Experiments move through schedule → start → (pause/resume) → stop or
complete → archive. Every transition publishes a new immutable Configuration
Release and an audit record. **Emergency stop**
(`POST .../experiments/{id}/emergency-stop`, or the workspace button with a
required reason) immediately publishes a Release that ends the Experiment.
The assignment **remains in the delivered payload** with lifecycle `stopped`
and fallback `normal_placement` — SDKs that see it restore normal Placement
delivery for affected units. Subsequent Releases carry the same explicit
stopped state rather than silently omitting the assignment. QA overrides let you pin a Variant in
development/staging for up to 24 hours without polluting results.

## Verification status

Assignment determinism, allocation invariants, exposure rules, tuple
validation, SRM, and lifecycle immutability are covered by protocol fixtures,
backend integration suites, and the GA drills. References:
[docs/backend/phase-7-experiments.md](../backend/phase-7-experiments.md),
[docs/protocol/experiment-assignment-v1.md](../protocol/experiment-assignment-v1.md).
