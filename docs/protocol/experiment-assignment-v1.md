# Experiment Assignment Contract v1

Experiment Assignment `1` is the immutable, platform-neutral definition used
to select one Variant locally. It extends an already eligible normal Placement
decision; it does not replace the Placement API or change Paywall Protocol
`0.2`.

Canonical artifacts:

- `protocol/schema/experiment-assignment/v1/assignment.schema.json`
- `protocol/schema/experiment-assignment/v1/compatibility-manifest.schema.json`
- `protocol/compatibility/experiment-assignment/v1.json`
- `protocol/fixtures/experiment-assignment/v1/`

## Published shape

The envelope discriminator is `experimentAssignmentVersion = "1"`. Its
`assignment` contains exact Project, Environment, Experiment, Experiment
Version, Placement, Control Paywall Version, and allocation Version identity.
It contains exactly one Control and one to three Treatments. Each Variant pins
an immutable Paywall ID/Version and a half-open allocation range.

Ranges are ordered, unique, non-overlapping, gap-free, and cover `[0,10000)`.
Changing Variants, allocation, assignment policy, metrics, or schedule requires
a new immutable scientific definition; active material is never edited.

Supported assignment policies are `installation`, `identified_user`, and
`identified_user_or_installation`. Missing identity under `identified_user`
uses normal Placement. The fallback policy uses installation only when it is
explicitly selected. Identity changes never rewrite historical events.

## Deterministic encoding

Variant assignment uses this exact UTF-8 material:

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

Compute SHA-256, interpret the first eight digest bytes as unsigned big-endian,
and reduce modulo 10,000. Ranges are half-open. Mutual exclusion uses the same
procedure with domain `mosaic-experiment-group` and values Project,
Environment, group ID, immutable group Version, key type, and key value. The
canonical fixture freezes UTF-8 bytes, digest, first eight bytes, bucket, group
selection, and Variant.

## Scheduling, groups, QA, and fallback

`startsAt` is required and inclusive. For immediate start, publication compiles
the authoritative publication/start time into this field. `endsAt` is optional;
when present it must be strictly after `startsAt` and is exclusive. Omission
means there is no scheduled expiry: eligibility continues until a later
immutable lifecycle release pauses, stops, or completes the Experiment.

The only schedule policy is `trusted_server_time_v1`; unreliable or stale time
uses `normal_placement`. Acceptance retains the existing trusted-time behavior:
the SDK captures validated server time, local receipt time, release identity,
and a monotonic anchor where available. Paused, stopped, completed, pre-start,
expired, group-excluded, missing-identity, or incompatible assignments also use
normal Placement.

An optional immutable Group Version snapshot is evaluated before Variant
allocation. Its `members` carry stable `experimentId` values and half-open
ranges; they never reference Experiment Version IDs. Member ranges plus an
optional `normalPlacementRange` are unique, non-overlapping, gap-free, and
cover `[0,10000)`. The enclosing Assignment's stable Experiment ID must be a
member. The Assignment separately pins the exact immutable Experiment Version
delivered by the release.

A failed selected Experiment does not choose another group member. QA overrides
carry only a selector digest and safe metadata, include an exact start/expiry,
are limited by publication to development/staging and 24 hours, never bypass Product/provider/render safety,
and are excluded from result denominators.

The contract excludes Drafts, metric results, event history, raw identities,
raw QA tokens, customer attributes, provider identifiers or secrets, audit
records, mutable resources, and executable code.

## Compatibility

Features, algorithms, and schedule policies are exact derivations of embedded
semantics. Under- or over-declaration rejects the candidate. Unknown fields,
versions, features, algorithms, malformed allocation, or partial evaluation
fail closed. A valid but inactive/ineligible Experiment uses normal Placement.
