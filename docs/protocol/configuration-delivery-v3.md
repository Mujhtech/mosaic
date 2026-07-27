# Configuration Delivery Contract v3

Configuration Delivery `3` retains the complete immutable Delivery `2`
snapshot and atomically adds Experiment Assignment Contract `1` definitions.
Delivery `1`/`2`, Placement Decision `1`, and Paywall Protocol `0.2` remain
unchanged.

Canonical artifacts are under
`protocol/schema/configuration-delivery/v3/`,
`protocol/compatibility/configuration-delivery/v3.json`, and
`protocol/fixtures/configuration-delivery/v3/`.

## Atomic release

The v3 release retains every v2 field and adds:

- `release.experimentAssignments`, containing immutable Assignment v1 roots;
- `release.compatibility.experimentAssignmentContracts`, containing the exact
  union of required Assignment features, bucketing algorithms, and schedule
  policies.

Each Assignment must match release Project/Environment, reference one included
Placement, and reference only included immutable Paywall Versions. Experiment
and Experiment Version IDs are unique. When an Assignment selects a mutual-
exclusion Group Version, its stable Experiment ID must appear in that Group
Version's complete `members` snapshot. Group members never point at Experiment
Version IDs; the enclosing delivered Assignments pin those exact immutable
Versions. Repeated snapshots of the same Group Version must match exactly. QA
material rejects in production.

Every Assignment has an inclusive `schedule.startsAt`; an immediate start uses
the authoritative publication/start time. `schedule.endsAt` is optional and,
when absent, manual lifecycle releases control completion. Trusted server-time
capture and unreliable-time fallback remain unchanged.
`release.contentDigest` covers all v2 and Experiment material except the digest
field itself.

Unsupported contract/features/algorithms/schedule policy, malformed allocation,
invalid references, non-exact compatibility, or a bad digest rejects the whole
candidate. The reader retains its last accepted release, then tries a bundled
release, then reports configuration unavailable. It never accepts new v2
material with old Experiment material or vice versa.

## Capability negotiation

The capability request retains v2 fields and adds:

- `supportedExperimentAssignmentContracts`;
- `supportedExperimentFeatures`;
- `supportedExperimentBucketingAlgorithms`;
- `supportedExperimentSchedulePolicies`.

The server withholds v3 when any required capability is absent. A legacy or
non-Experiment SDK receives a separately stored Delivery v2 projection with
the exact unchanged normal Placement snapshot and no Experiment assignment.
Projection never turns a Variant into an unconditional Placement binding.

### Every Release carries a representation for every approved Delivery version

**Normative.** A Configuration Release is not publishable-complete until it
carries a stored representation for **every approved Delivery version** — `1`,
`2`, and `3` — regardless of which contract the publish originated from. A
v1-only SDK must always be able to fetch a usable v1 document. Publishing an
Experiment must not remove a version from the Environment's negotiable set.

"Usable" is a stronger requirement than "schema-valid". `placements` is v1-only
vocabulary; v2 replaces it with `placementDecisions`. A v1 document whose
`placements` array is empty passes the v1 schema and is worthless to the reader
that asked for it, so an empty `placements` on a Release whose predecessor bound
Placements is a defect, not a degraded mode.

The v1 representation is therefore produced by **carry-forward, not
projection**: on Experiment publish the preceding Release's v1 representation is
carried forward and its identity restamped to the new Release. An Experiment
publish does not change Placement bindings, so the preceding v1 view remains
exactly correct. Projection from the v2 envelope is the fallback used **only**
when no predecessor v1 representation exists.

Verified in
[`docs/reviews/phase-8-drill-evidence.md`](../reviews/phase-8-drill-evidence.md)
("A v1-only SDK is served again after an Experiment publishes"), which records
both the empty-`placements` projection defect and the re-verification against a
Release carrying an active Experiment: an SDK advertising `1` receives `200`
with `version=1` and the Placements populated, while `2` and `3,2,1` continue to
negotiate to `2` and `3` respectively.

Delivery contains definitions and stable references only. Results, customer
values, raw identity, event history, provider secrets, Drafts, audit state, and
executable code are excluded.
