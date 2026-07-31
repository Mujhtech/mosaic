# Phase 7 Plan: Experiments

## Status

**Owner-approved implementation contract — 2026-07-26**

The Phase 7 preflight and both prescribed read-only inspection stages completed
on 2026-07-26. The product owner explicitly authorized Phase 7 to proceed from
the tagged Phase 6 baseline despite `docs/reviews/phase-6.md` recording a
rejected ingestion-boundary defect. That defect remains a tracked acceptance
risk and must not be silently repaired or described as resolved by Phase 7.

This plan freezes every owner-sensitive decision required to implement Mosaic
Experiments. Phase 8 is excluded.

## Baseline

- Base commit: `59923f2962f79eb2f81dd84d4ad69bdf59c9ca89`.
- Branch: `phase/7-experiments`.
- Phase 5 is accepted with tracked follow-ups.
- Phase 6 implementation evidence covers identity, durable analytics queues,
  idempotent ingestion, attribution, metric definitions, retention, export,
  and deletion, but its review remains rejected for the documented semantic
  ingestion-minimization gap.
- PostgreSQL 17 is the runtime system of record.
- Goose migrations through version 16 apply successfully.
- Production API wiring uses pgx repositories and has no in-memory fallback.
- Placement Decision Contract `1`, Configuration Delivery `2`, Analytics Event
  Contract `1`, and Paywall Protocol `0.2` remain immutable.
- Placement bucketing uses `sha256_length_prefixed_v1` and is deterministic
  across Go, Dart, Swift, and Kotlin.
- No Experiment domain, persistence, contract, dashboard, or SDK assignment
  implementation exists on the baseline.

## Product promise

Teams can test immutable native Paywall and Product-presentation Variants
without changing application code. Assignment remains deterministic and
offline, exposure begins only after successful presentation, attribution stays
bound to immutable history, and results communicate uncertainty without an
automatic winner.

Applications outside an Experiment continue through the existing Placement
API and behave exactly as before.

## Frozen terminology

- **Experiment**: one Environment-scoped test attached to one Placement.
- **Experiment Draft**: editable, optimistic-concurrency authoring state.
- **Experiment Version**: immutable published scientific definition.
- **Variant**: immutable Control or Treatment definition referencing an exact
  immutable Paywall Version.
- **Assignment**: deterministic Variant selection. It is diagnostic, not an
  exposure or result denominator.
- **Exposure**: successful presentation of the assigned Variant Paywall after
  compatibility, Product readiness, availability, and provider capability
  checks succeed.
- **Fallback exposure**: successful presentation of the normal Placement
  fallback instead of the assigned Variant. It is never original-Variant
  exposure.
- **Assignment unit**: the unique installation or application user selected by
  the immutable assignment-key policy for one Experiment Version.
- **Allocation Version**: immutable weighted bucket layout captured by an
  Experiment Version.

Dashboard copy may say “Traffic split,” but contracts and APIs use allocation.
Client-observed and provider-confirmed outcomes are always named separately.

## Smallest complete v1 workflow

```text
Choose Placement
→ select exact Control Paywall Version
→ select exact Treatment Paywall Version
→ allocate 50/50
→ choose assignment identity
→ select primary metric and guardrails
→ validate Product/provider safety
→ publish immutable Experiment Version and Configuration Release
→ assign locally and offline
→ record exposure only after presentation
→ report unique-unit conversion with uncertainty, freshness, SRM, and guardrails
→ emergency-stop the Experiment through normal Placement fallback
→ preserve and export history
```

## Experiment model

An Experiment contains a stable ID, Project, Environment, Placement, internal
name, optional hypothesis, lifecycle state, current Draft, active Version,
optional mutual-exclusion group, and creation/update/archive metadata.

It is Environment-scoped and cannot move between Projects, Environments, or
Placements. Historical Experiments with Versions, assignments, exposures, or
state transitions cannot be deleted.

## Lifecycle state machine

Management states are:

```text
Draft
Scheduled
Running
Paused
Stopped
Completed
Archived
```

Valid transitions are:

```text
Draft → Scheduled
Draft → Running
Scheduled → Running
Scheduled → Stopped
Running → Paused
Paused → Running
Running → Stopped
Paused → Stopped
Running → Completed
Paused → Completed
Stopped → Archived
Completed → Archived
```

Completed, Stopped, and Archived Experiments never return to Running. Active
Variants, allocation, assignment policy, metrics, group membership, and
schedule are not mutated. Pause, resume, stop, complete, and emergency stop
change the Experiment root state, append a transition, audit the actor/reason,
and publish a new immutable Configuration Release snapshot. They never mutate
the active Experiment Version.

Every blocked transition returns a stable code and recovery action.

## Drafts and optimistic concurrency

Each Experiment has at most one current Draft and immutable Draft revisions.
Whole-document updates require the expected revision and idempotency key. A
stale revision returns conflict and preserves both the server revision and the
client's unsaved input. Last-write-wins is prohibited.

Drafts may add, duplicate, reorder, or remove Treatment Variants; choose exact
Paywall Versions; configure assignment, allocation, metrics, guardrails,
schedule, group membership, and QA policy; and collect validation state.

## Immutable Experiment Versions

Publishing a valid Draft creates an immutable Experiment Version containing:

- Experiment and Version IDs and version number;
- source Draft revision and canonical digest;
- Project, Environment, and Placement identity;
- immutable Variants and allocation Version;
- assignment-key policy and bucketing-algorithm version;
- captured primary and guardrail metric definition versions;
- UTC schedule;
- mutual-exclusion group Version where applicable;
- fallback, compatibility, and creation metadata.

Once an Experiment has run or produced an exposure, a changed scientific
definition requires a new Experiment. A scheduled Version may be replaced only
before any assignment or exposure history exists.

Database immutability triggers protect Versions, Variants, allocations, metric
snapshots, group Versions, and release references.

## Variant model

Each Version contains exactly one Control and one to three Treatments. Each
Variant contains a stable ID, role, safe name, exact Paywall ID and immutable
Paywall Version ID, allocation range, and compatibility metadata.

Variants never reference Paywall Drafts and never embed Apple Product IDs,
Google Product IDs, RevenueCat Offerings or Packages, provider-native SDK
objects, prices, credentials, or other provider details. Stable Mosaic Product
references continue through the referenced Paywall Version and immutable
release Product-reference set.

## Placement eligibility and ordering

The existing Placement Decision evaluates first. An Experiment extends only an
eligible `paywall` result whose exact immutable Paywall Version equals the
Experiment Control. It never overrides `no_paywall`, an unrelated fallback,
unavailable, or evaluation failure.

If eligibility fails, the SDK returns the existing normal Placement outcome.
The stable public presentation API is unchanged.

## Assignment-key policies and identity changes

Supported immutable policies are:

- `installation`;
- `identified_user`;
- `identified_user_or_installation`.

Missing user identity under `identified_user` makes the Experiment ineligible;
the SDK uses the normal Placement result. The fallback policy explicitly uses
installation identity only when configured.

Identity behavior:

- anonymous to identified selects the user-key assignment for future decisions
  when the policy calls for it; anonymous history is not migrated;
- logout returns to installation only for the explicit fallback policy;
- a different signed-in user receives that user's deterministic assignment;
- user reset clears user-bound active assignment and override state while
  retaining installation identity and installation-bound state;
- installation reset rotates installation identity and clears installation-
  bound active assignment state;
- queued events retain occurrence-time identity and attribution;
- aliases never rewrite historical exposures;
- the same identified user hashes identically across supported devices.

## Deterministic bucketing

Experiment assignment uses `experiment_sha256_length_prefixed_v1`, distinct
from Placement rollout.

Canonical UTF-8 bytes are:

```text
mosaic-experiment-assignment\n
1\n
<byte-length>:<project-id>\n
<byte-length>:<environment-id>\n
<byte-length>:<experiment-id>\n
<byte-length>:<experiment-version-id>\n
<byte-length>:<assignment-key-type>\n
<byte-length>:<assignment-key-value>\n
```

Compute SHA-256, interpret the first eight bytes as unsigned big-endian, and
take modulo 10,000. Runtime randomness, native hash functions, and timestamps
are prohibited.

Mutual exclusion uses the same primitive with a separate
`mosaic-experiment-group` domain separator and immutable group Version input.
Canonical fixtures freeze input bytes, digest, first eight bytes, bucket, group
selection, and Variant result across Go, Dart, Swift, and Kotlin.

## Allocation and persistent assignment

Bucket space is `[0,10000)`. Variant ranges are half-open, non-overlapping,
gap-free, unique, and cover all 10,000 buckets. Allocation is immutable for the
Experiment Version. Phase 7 v1 has no traffic ramp, automatic reallocation, or
in-place allocation change.

Deterministic calculation is authoritative. Every SDK also persists a bounded,
atomic, backup-excluded diagnostics/replay record keyed by Project,
Environment, Experiment Version, assignment-key type, and a one-way subject
digest. Raw assignment values, user IDs, installation IDs, QA tokens, and
attributes are never stored.

Records include safe Experiment/Version/Variant IDs, allocation Version,
bucket, algorithm, assignment source/time, group membership, and exposure
state. They are retained for at most 180 days after Experiment completion or
until a bounded maximum of 256 records, whichever removes them first.
Persistence never overrides a changed identity, new Version, stopped/expired
release, or emergency-stop refresh. There is no backend assignment table and
no server request per assignment.

## Mutual-exclusion groups and overlap

A group has a stable ID, immutable group Version, Project, Environment,
assignment policy, algorithm version, participating Experiment ranges, and
optional normal-Placement holdout. Group ranges cover `[0,10000)` explicitly
and are independent of Variant allocation. Group assignment occurs before
Variant assignment and is independent of delivery array or request order.

Group Version memberships reference stable Experiment IDs, not Experiment
Version IDs. This deliberately breaks the publication cycle: teams create the
Experiment roots and Drafts, create an immutable Group Version over those
stable IDs, select that Group Version in each Draft, and then publish the
immutable Experiment Versions. Publication validates membership and the
Configuration Release pins the exact Group Version together with the exact
included Experiment Versions. Historical releases therefore retain complete
meaning without requiring a Group Version to reference resources that do not
yet exist.

One identity may enter at most one Experiment in an active group Version.
Failure of its selected Experiment does not select another group member; it
uses normal Placement fallback.

Simultaneous active or scheduled Experiments on the same Environment and
Placement are blocked unless they participate in one valid mutual-exclusion
group. Shared Paywall/Product presentation produces a high warning. Shared
primary metric on different surfaces produces an informational warning.

## Scheduling and trusted time

Schedules use UTC millisecond timestamps, inclusive start, and exclusive end.
Configuration transport captures validated server time when a release is
accepted. SDK caches persist server time, local receipt time, release identity,
and a monotonic anchor where the platform permits it.

Within a process lifetime, monotonic elapsed time advances the trusted anchor.
After restart, a device-wall-time deviation greater than five minutes from the
persisted expectation marks time unreliable. An anchor older than seven days
is stale. Future-scheduled, expired, paused, stopped, completed, or time-
unreliable Experiments use normal Placement behavior with safe diagnostics.

Manual and emergency stops take effect only after a device accepts the new
release. The dashboard must not claim that every offline device has refreshed.
Worker jobs reconcile server lifecycle/audit state but do not control local
assignment correctness.

## QA Variant overrides

QA overrides are limited to development and staging, expire within 24 hours,
and contain explicit Environment, identity type, Experiment Version, Variant,
safe label, selector digest, and visibility metadata. Raw tokens and creator
identity are not delivered.

A valid override may bypass schedule, allocation, and mutual exclusion for QA,
but never compatibility, Product readiness, provider capability, or safety.
It is ephemeral, does not mutate normal persistent assignment/group history,
is visibly indicated, and is excluded from Experiment result denominators.
Production overrides reject the complete candidate release.

## Product and provider safety

Validation blocks publication when:

- a Variant does not reference an immutable same-Project Paywall Version;
- a referenced Product is missing, archived, inactive, or lacks required
  Environment/Application/platform mapping;
- a mapping is ambiguous;
- an Entitlement grant is missing;
- a required provider capability is unavailable;
- Product availability is materially incomparable across Variants;
- SDK compatibility is insufficient.

Provider capability snapshots must reflect the actual adapter and accepted
commerce configuration; provider presence alone is not proof that every
capability is available. SDKs assign first and load only the selected Variant's
exact Products plus the approved normal fallback path. Product substitution is
prohibited.

Archive, replacement, or semantic mutation of a Provider Product Mapping used
by a Scheduled, Running, or Paused Experiment is blocked transactionally.
Recovery is to stop/complete the Experiment, change the mapping, then create a
new Experiment. The same protection applies to Product archival/replacement
and Entitlement-grant removal where they alter active Variant meaning.

## Fallback and emergency stop

The only Experiment fallback in v1 is `normal_placement`. Variant failure never
selects another Variant or similar Product.

Emergency stop applies to the whole Experiment. Variant-only reallocation is
excluded because it changes allocation and scientific meaning. An owner/admin
supplies a safe reason; the service stops future assignment, appends state and
audit history, and atomically publishes a new Configuration Release using the
normal Placement outcome. Versions, assignments, exposures, results, and
history remain immutable. Propagation reports the stop release and observed
refresh state without claiming universal delivery.

## Experiment Assignment Contract v1

Create a separate platform-neutral contract containing:

- Project and Environment identity;
- Experiment and immutable Version identity;
- Placement association and exact Control anchor;
- Variants and explicit allocation ranges;
- assignment-key policy and algorithm;
- lifecycle and schedule;
- mutual-exclusion group Version;
- QA override metadata;
- normal-Placement fallback;
- exact compatibility requirements;
- diagnostics-safe metadata only.

Drafts, results, event history, customer values, provider secrets, mutable
resources, and audit data are excluded.

## Configuration Delivery v3

Configuration Delivery v2 is closed. Delivery v3 retains the complete v2
snapshot and atomically adds Experiment Assignment v1. Define an ADR and exact
capability negotiation for supported Experiment contracts, features,
algorithms, and schedule policy.

Unsupported or malformed v3 candidates reject atomically and preserve the
last accepted release. Legacy/non-Experiment SDKs receive a safe Delivery v2
projection containing unchanged normal Placement behavior. Delivery v1/v2
bytes and semantics remain unchanged.

## Analytics Event Contract v2 and exposure semantics

Analytics Event v1 is closed and remains unchanged. Add backward-compatible
Analytics Event Contract v2 while ingestion continues accepting v1.

Canonical Experiment events are:

- `experiment_assigned` — diagnostics only;
- `experiment_exposed` — statistical exposure denominator;
- `experiment_fallback_presented` — fallback diagnostics/guardrail;
- `experiment_assignment_failed` — safe diagnostics.

Public/export mapping prefixes Mosaic-owned events as `mosaic_*`; canonical
internal names remain unprefixed. Provider-native exports retain their native
namespaces.

Experiment attribution is an all-or-none tuple of Experiment ID, Experiment
Version ID, Variant ID, and allocation Version. Product-selection and purchase
lifecycle events in v2 carry the same immutable tuple so correlation never
depends on current configuration or timestamp proximity.

Exposure is emitted exactly once for one presentation request only after:

1. Variant assignment;
2. exact Variant Paywall resolution;
3. required Product readiness and availability;
4. provider capability acceptance;
5. successful native presentation acknowledgement.

Assignment without presentation, `no_paywall`, unsupported configuration,
render failure, Product failure, or disposal before readiness emits no original
Variant exposure. Successful fallback emits only
`experiment_fallback_presented`, retaining assigned and actually presented
identities. Analytics failure remains nonblocking.

The Phase 6 v1 semantic ingestion defect remains separately tracked; v2 must
enforce event-specific closed correlation/attribution at schema and runtime
boundaries from its first implementation.

## Metrics and analysis unit

Metric definitions are immutable, selectable, versioned resources containing
stable ID/version, name, numerator, denominator, assignment-unit basis,
authority, attribution window, freshness, definition, and primary/guardrail
eligibility.

Approved primary metrics are:

- presentation-to-Product-selection rate;
- Product-selection-to-purchase-start rate;
- presentation-to-purchase-start rate;
- presentation-to-client-completed-purchase rate;
- presentation-to-provider-confirmed-purchase rate, unavailable until a
  trusted source exists.

Approved guardrails include purchase failure, cancellation, Product
unavailability/load failure, Paywall render failure, provider unavailability,
and fallback exposure rate.

Client-observed and provider-confirmed bases never combine. Statistical
analysis uses the first qualifying exposure per assignment unit and Experiment
Version and at most one qualifying conversion in the captured attribution
window. Raw exposure-event and repeated-presentation counts remain separately
visible for diagnostics.

## Statistical method and uncertainty

Phase 7 uses fixed-horizon frequentist descriptive reporting:

- Variant estimate: `x / n` unique exposed assignment units;
- per-Variant uncertainty: 95% Wilson score interval;
- treatment-versus-Control absolute lift: 95% Newcombe interval derived from
  the two Wilson intervals;
- relative lift is descriptive and omitted when the Control estimate is zero;
- no repeated-look p-value, significance badge, Winner field, automatic stop,
  or automatic traffic action;
- multiple Treatments receive separate descriptive intervals with no family-
  wise hypothesis claim;
- running results are explicitly interim;
- final interpretation requires completion plus the captured attribution
  window and accepted late-event window;
- late events rebuild affected immutable-Version buckets idempotently;
- event-time identity determines the assignment unit; aliases do not merge
  historical anonymous observations;
- SRM, stale data, immature windows, or guardrail failures suppress strong
  interpretation but never hide raw data.

## Sample-ratio mismatch

Use Pearson chi-square goodness-of-fit against immutable expected Variant
allocation, based on first qualifying successful exposures per assignment unit.
Exclude assignments without presentation, normal-Placement holdout, QA
overrides, and fallback presentations from original-Variant observed counts.

Do not evaluate until total unique exposures are at least 100 and every expected
cell is at least five. Return `insufficient_sample` otherwise. Warning threshold
is `p < 0.001`; critical threshold is `p < 0.000001`. Return observed/expected
counts and shares, statistic, degrees of freedom, p-value, exclusions,
severity, explanation, and investigation steps. SRM never auto-stops an
Experiment.

## Minimum-sample and freshness warnings

Show warnings when any Variant has fewer than 100 unique exposures, total
conversions are fewer than 20, expected successes or failures are below five,
observation duration is under 24 hours, aggregates are older than 15 minutes,
or the result window is not mature through attribution/late-event policy. Raw
data remains visible and no conclusion language is shown.

## Aggregation, retention, privacy, and export

Experiment aggregates extend the existing dirty-bucket model, rebuild
transactionally for late events, remain duplicate-safe and Environment-
isolated, and recompute exact affected buckets after privacy deletion.
Historical identity is never rewritten.

Ordinary raw Experiment export is available to owner/admin and extends the
accepted asynchronous Phase 6 job, bounded-file, private-object, audit, retry,
and seven-day expiry model. An export containing identity-scoped material is
owner-only. Inputs never appear in URLs, query keys, browser storage,
filenames, or logs.

## PostgreSQL migrations

Planned sequence:

1. `00017_phase_7_experiments.sql`: immutable metric definitions; Experiment
   roots; Drafts/revisions; Versions; Variants; allocations; metric snapshots;
   mutual-exclusion groups/Versions/memberships; lifecycle history; QA
   overrides; scheduling jobs; composite tenant keys; constraints; indexes;
   deferred invariant and immutability triggers.
2. `00018_phase_7_experiment_delivery_analytics.sql`: Delivery v3
   representation support; Release-to-Experiment Version references;
   all-or-none raw-event Experiment attribution; aggregate tables; export
   filters; indexes and deletion rebuild scope.

Important invariants include exactly one Control, one to three Treatments,
gap-free allocation, same-Project/Environment references, one active Version,
bounded QA expiry, immutable historical rows, and no deletion with history.

## REST resources, authorization, and auditing

Environment-scoped REST resources cover Experiment list/detail, Draft and
validation, publish, Versions/history, lifecycle actions, results, SRM,
metrics, mutual exclusion, QA overrides, emergency stop, and export.

Members may read Experiment setup and aggregate results. Owner/admin may create,
edit, publish, schedule, pause, resume, stop, complete, archive, configure QA,
emergency-stop, and request ordinary raw export. Identity-bearing export is
owner-only.

Every mutation records safe IDs, versions, actor, transition/reason, release,
counts, issue codes, and expiry. Logs and spans never contain assignment values,
customer identity, attributes, QA tokens, provider payloads, or event bodies.

## Configuration compilation and publication

Publishing locks the Experiment and Draft, enforces expected revision,
validates all ownership/reference/scientific/safety rules, creates immutable
Version children, captures metric definitions, appends history/audit, compiles
Delivery v3 plus safe v2 projection, publishes the Configuration Release, and
updates the Experiment root in one transaction. Partial publication is
prohibited.

Rollback and lifecycle releases copy exact immutable meaning rather than
recompiling mutable resources.

## SDK architecture

Each SDK adds a strict Delivery v3/Experiment decoder, pure assignment engine,
actor/coroutine/Future-safe bounded assignment store, trusted-time evaluator,
two-stage group/Variant bucketer, typed result and diagnostics, exact Product
readiness path, and presentation-success exposure acknowledgement.

Assignment is CPU-bounded and local. Persistence/network work does not block
the UI/main actor. Refresh is coalesced and foreground-aware so emergency stops
propagate without a request per presentation. Unsupported candidates preserve
last-known-valid/bundled fallback. Existing Placement APIs and non-Experiment
behavior remain unchanged.

## Dashboard information architecture

Add Environment-scoped Experiments under Monetization with list, new Draft,
and one Experiment workspace containing Overview, Variants, Metrics, Schedule,
Results, History, and QA Overrides.

The guided builder uses TanStack Form for unsaved input and TanStack Query for
server resources. It lists all eligible immutable Paywall Versions, never
Drafts. Control/Treatment roles remain visible everywhere. Allocation uses
percentages plus accessible basis-point detail. Results show semantic tables,
uncertainty, freshness, allocation, SRM, low sample, guardrails, fallback,
Product/provider issues, and history without a Winner badge.

Every warning states what happened, why it matters, whether the Experiment
continues, affected resources, investigation guidance, and direct recovery.
Stopped/completed/archived Experiments remain readable and exportable.

## Minimum sufficient tests

Tests protect only material risks:

- protocol schema/manifest/fixture coherence and exact feature derivation;
- shared cross-language assignment/group vectors;
- malformed allocation and atomic Delivery v3 rejection/LKG retention;
- Draft concurrency, lifecycle, immutable Versions/Variants, tenant isolation,
  and Product-mapping transaction protection;
- assignment persistence, identity changes, scheduling/clock uncertainty,
  mutual exclusion, and QA exclusion;
- assignment without exposure, exactly-once presentation exposure, explicit
  fallback exposure, render/Product failure suppression, immutable attribution,
  duplicate ingestion, late rebuilds, and deletion recomputation;
- approved Wilson/Newcombe vectors, unique-unit analysis, SRM thresholds,
  minimum-sample/freshness warnings, guardrails, and absence of Winner output;
- dashboard immutable-version selection, allocation/concurrency recovery,
  authority separation, lifecycle consequences, QA privacy, export permission,
  and Environment URL ownership;
- unchanged non-Experiment Placement behavior.

Extend existing runners and suites. Do not add chart tests, hashing-library
tests, framework tests, broad snapshots, or new test infrastructure.

## Required conformance fixtures

Use a small canonical corpus covering Control, Treatment, identified-user,
installation, group exclusion, QA, scheduled boundaries, paused, stopped,
fallback exposure, unsupported contract, malformed allocation, exact bucket,
and Variant selection. Go, Dart, Swift, and Kotlin must return identical
outcomes.

## Observable acceptance criteria

- A stale Draft update returns conflict without overwriting the current Draft.
- Publication creates immutable Version, Variant, allocation, and metric rows.
- Exactly one Control and one to three Treatments are enforced.
- All four implementations assign the same Variant for the same canonical
  input while offline.
- Identified assignment is cross-device deterministic; installation assignment
  remains installation-local.
- Group assignment admits at most one conflicting Experiment.
- Schedule, pause, stop, completion, and unreliable time use normal Placement.
- QA overrides expire, remain visible, and never enter results.
- Assignment alone never emits exposure.
- Successful presentation emits exactly one original Variant exposure.
- Fallback presentation is distinct and never original Variant exposure.
- Product/provider differences block or warn with recovery as specified.
- Mapping changes cannot silently alter active Experiment meaning.
- Results show counts, estimates, uncertainty, allocation, freshness, SRM,
  minimum-sample and guardrail status with no Winner field.
- Emergency stop publishes normal Placement fallback and preserves history.
- Raw data export is tenant- and permission-scoped.
- Existing non-Experiment applications behave exactly as before.

## Explicit exclusions

- automatic winner selection;
- automated traffic ramp or reallocation;
- autonomous optimization or publishing;
- AI recommendations or generation;
- predictive outcomes;
- automatic Paywall/Product/provider changes;
- MRR, ARR, LTV, reconciliation, or financial reporting;
- receipt validation or cross-platform entitlement infrastructure;
- Mosaic Billing;
- arbitrary code or a server request per assignment;
- Paywall Protocol `0.3`;
- Phase 8 operational hardening, Kubernetes, sharding, or warehouse work.

## V1 feature-complete demo

Create exact Control and Treatment Paywall Versions, attach them to one
Placement, allocate 50/50, choose identified-user assignment, select primary
and guardrail metrics, publish Delivery v3, prove matching Go/Dart/Swift/Kotlin
assignments offline, prove assignment alone emits no exposure, present and emit
exposure, ingest outcomes, display Wilson/Newcombe uncertainty and low-sample
warning, trigger SRM, detect overlap, configure mutual exclusion, force Product
fallback, emergency-stop the Experiment while preserving history, and export
raw Experiment data.

The one-minute path is:

```text
Create A/B Paywall Experiment
→ users receive deterministic offline Variants
→ exposure records only after presentation
→ dashboard shows conversion with uncertainty
→ emergency-stop safely without deleting history
```

## Stage order and ownership

- Stage 2 Protocol owns only canonical Experiment/Delivery/Analytics schemas,
  fixtures, docs, changelogs, ADR, and established generated contract artifacts.
- Stage 2 Backend owns `apps/api/**`, `apps/worker/**`, migrations, OpenAPI,
  analytics/statistics, backend tests, and backend documentation.
- Stage 2 Dashboard owns only Experiment routes/features/tests/documentation and
  generated clients produced from backend OpenAPI.
- Stage 3 Flutter, iOS, and Android agents own only their SDK, example, tests,
  and platform documentation and consume the frozen canonical fixtures.
- Stage 4 runs the integrated demo and full cross-platform conformance.
- Stage 5 is read-only Product, UX, Protocol, and Quality review followed by at
  most two bounded fix rounds and one targeted final quality review.

Stop after `docs/reviews/phase-7.md`. Do not merge, tag, or begin Phase 8.
