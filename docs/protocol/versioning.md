# Mosaic Protocol Versioning

## Exact versions

`schemaVersion` and every capability version are exact identifiers, not numeric
compatibility ranges. A reader declaring `0.1` accepts only `0.1` and only the
capability names and `0.1` versions it explicitly supports. It must not infer
forward or backward support from numeric ordering.

This conservative rule remains in force through the Protocol review gate. A
future range, migration, or compatibility policy is a public-contract decision
and cannot be introduced by one SDK.

## Artifact lifecycle

The compatibility manifest status is one of:

- `draft`: actively being designed and not ready for cross-platform review;
- `releaseCandidate`: coherent candidate implemented for the review gate;
- `approved`: product-owner-approved and immutable;
- `deprecated`: still readable where supported but discouraged for new work.

Protocol `0.1` is currently `releaseCandidate` with provenance `RC1`. RC1 is not
approval. If review changes the contract before approval, all three SDK owners
must receive the revised contract explicitly, the candidate identifier must
advance, and every conformance check must be rerun.

Approval occurs only after the Protocol and cross-platform prototype gates.
When the approved bytes match RC1, approval changes the manifest lifecycle
status and changelog status; it does not silently redesign the schema.

After approval, schema, manifest contract, and canonical fixtures must not be
edited in place. A correction that changes decoding, validation, rendering,
fallback, accessibility, action, or outcome behavior creates a new protocol
version and migration note. Deprecation does not make approved artifacts
mutable.

## Change requirements

Every pre-approval candidate change and every future version requires:

1. schema and manifest review;
2. canonical fixture update when the contract is exercised differently;
3. valid and invalid validation coverage;
4. compatibility, accessibility, and fallback review;
5. documentation and changelog updates;
6. implementation or defined atomic rejection in Flutter, SwiftUI, and
   Jetpack Compose; and
7. explicit notification to every platform owner when a shared candidate
   changes.

The protocol stays platform-neutral. Framework convenience, native resource
names, billing-provider models, and platform-only UI behavior are not valid
reasons to fork or weaken the shared contract.

## Reader sequence

A reader must:

1. check the exact schema version;
2. compare every required capability and exact version;
3. validate the closed document plus semantic references;
4. render only after complete validation succeeds;
5. attempt its bundled fallback when the primary document is rejected; and
6. return `configurationUnavailable` when the bundled fallback also fails.

No version policy permits best-effort partial rendering of unknown content.

## Current review gate

Protocol `0.1` RC1 remains pending product-owner review of its component and
layout semantics, localization/direction resolution, product and asset model,
actions, accessibility, strict fallback policy, capability set, normalized
outcomes, and documented native differences. Do not mark it `approved` as part
of Phase 1 implementation or begin Phase 2 before that review.
