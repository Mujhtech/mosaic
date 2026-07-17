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

Protocol `0.1` is `approved` with provenance `RC1`. The product owner approved
the unchanged RC1 bytes on 2026-07-17 after the Protocol and cross-platform
prototype gates. The lifecycle status changed without redesigning the schema,
fixture, capabilities, fallback rules, or renderer semantics.

Approval occurs only after the Protocol and cross-platform prototype gates.
The approved RC1 bytes are now the immutable Protocol `0.1` baseline.

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

Protocol `0.1` RC1 passed product-owner review and is immutable. Local Preview
`0.1` is a separate frozen Phase 2 integration contract whose Phase 2 review is
still pending. Approval or revision of the preview transport does not reopen or
mutate the Paywall Protocol `0.1` component and rendering semantics.
