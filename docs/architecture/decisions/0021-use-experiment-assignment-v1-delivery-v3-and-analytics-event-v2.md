# ADR-0021: Use Experiment Assignment v1, Configuration Delivery v3, and Analytics Event v2

## Status

Accepted

## Date

2026-07-26

## Context

Phase 7 adds deterministic, offline Experiment assignment and explicit
presentation exposure. Configuration Delivery v2 is closed and contains no
Experiment definition. Analytics Event v1 is also closed and cannot carry the
immutable Experiment/Version/Variant/allocation attribution required for
trustworthy result reconstruction.

Extending either accepted contract in place would cause strict readers to
reject candidates or, worse, let a reader interpret only part of an
Experiment. Assignment must remain independent of Flutter, SwiftUI, Compose,
billing providers, and mutable result state.

## Decision

Define three separate platform-neutral contracts:

- Experiment Assignment Contract v1 contains only one immutable published
  assignment definition, exact Control anchor, Variants and ranges, identity
  policy, lifecycle/schedule, optional mutual-exclusion and QA metadata,
  normal-Placement fallback, and exact compatibility requirements.
- Configuration Delivery v3 retains the complete Delivery v2 snapshot and
  atomically adds zero or more Experiment Assignment v1 definitions. Capability
  negotiation declares Experiment contract versions, features, algorithms, and
  trusted-time schedule policies independently.
- Analytics Event v2 retains the typed v1 event taxonomy, adds four canonical
  Experiment events, and permits an all-or-none immutable Experiment tuple on
  Product selection and purchase lifecycle events. Ingestion continues to
  accept unchanged v1 batches beside v2.

Experiment bucketing uses the versioned
`experiment_sha256_length_prefixed_v1` algorithm. Mutual exclusion uses the
same length-prefixed SHA-256 primitive with the separate
`mosaic-experiment-group` domain and
`experiment_group_sha256_length_prefixed_v1` identifier. Allocation covers the
half-open bucket space `[0,10000)` exactly.

Mutual-exclusion Group Versions are created over stable Experiment IDs before
Experiment Versions are published. A Draft selects an immutable Group Version;
publication then creates the immutable Experiment Version. Delivered Group
Version members therefore contain `experimentId`, never
`experimentVersionId`, while each enclosing Assignment separately pins its
exact Experiment Version. This avoids a circular publication dependency and
preserves the exact group-and-Version combination in historical releases.

Every Assignment carries a required inclusive `startsAt`. Immediate start
compiles its authoritative publication/start time. `endsAt` is optional; when
omitted, the Experiment continues until an immutable pause, stop, or completion
release changes lifecycle state. A present end is exclusive and strictly after
start. This does not change trusted server-time anchoring or unreliable-time
normal-Placement fallback.

Delivery v3 candidates are accepted atomically. Unsupported, malformed,
underdeclared, overdeclared, incorrectly referenced, or digest-invalid
candidates preserve the last accepted release. SDKs without Experiment support
receive a Delivery v2 projection with unchanged normal Placement behavior.

Assignment is diagnostic and never an exposure denominator. An original
Variant exposure exists only as `experiment_exposed` after successful native
presentation acknowledgement and Product/provider readiness. Successful normal
Placement fallback is `experiment_fallback_presented` and never original
Variant exposure. QA presentations do not emit statistical exposure.

## Consequences

### Benefits

- Delivery v1/v2, Placement Decision v1, Paywall Protocol 0.2, and Analytics
  Event v1 remain unchanged.
- All SDKs can assign identically offline from one shared fixture corpus.
- Immutable attribution travels with occurrence-time events instead of being
  reconstructed from current configuration or timestamp proximity.
- Old SDKs retain unchanged Placement behavior.
- Unknown Experiment semantics fail closed without partially accepting a
  release.

### Trade-offs

- The backend stores and serves both Delivery v3 and a safe v2 projection.
- SDKs add strict v3 decoding, trusted-time evaluation, assignment persistence,
  and v2 analytics emission.
- Compatibility testing spans the backend plus Go, Dart, Swift, and Kotlin
  implementations.

## Alternatives considered

### Extend Delivery v2 and Analytics v1 in place

Rejected because both are closed contracts and strict readers cannot safely
ignore new semantics.

### Fetch Experiment assignment separately

Rejected because independent acceptance could combine Experiment and Placement
snapshots from different releases and break immutable attribution.

### Assign on the server for every presentation

Rejected because it breaks offline operation, adds latency and availability to
presentation, and changes the stable Placement API.

### Count assignment as exposure

Rejected because users who never see a Paywall would enter the denominator and
bias Experiment results.
