# Mosaic Protocol Versioning

## Current pre-release rule

Protocol `0.2` RC4 and Local Preview `0.2` are the only supported contracts
while Mosaic is iterating before its first stable release. Earlier experimental
contracts have been retired rather than carried as compatibility readers.

Configuration Delivery `1`, Commerce Provider Contracts `1`/`2`, and Commerce
Configurations `1`/`2` are independent versioned contracts. Their exact versions
values do not imply compatibility with one another and do not change the
Paywall `schemaVersion`.

`schemaVersion`, Local Preview versions, and capability versions are exact
identifiers. A reader declaring `0.2` accepts only `0.2`; it must not infer
forward or backward support from numeric ordering.

## Artifact lifecycle

Compatibility manifest status is one of:

- `draft`: under active design;
- `releaseCandidate`: coherent and implemented for a review gate;
- `approved`: product-owner-approved and immutable; or
- `deprecated`: still readable where explicitly supported.

Protocol `0.2` remains a release candidate. Corrections update its canonical
schemas, fixtures, generated browser contract, Studio, and all three native
renderers together. After the first contract is approved and published,
behavior-changing corrections require a new version and an explicit
compatibility policy.

## Reader sequence

A reader must:

1. require exact version `0.2`;
2. compare every required capability at exact version `0.2`;
3. validate the complete closed document and semantic references;
4. render only after validation succeeds;
5. retain the last accepted production configuration or use the host's bundled
   fallback according to the production SDK policy; and
6. return `configurationUnavailable` when no valid production document exists.

Local Preview example apps intentionally do not display a bundled paywall while
waiting for Studio. They show connecting, waiting, or connection-failure state
so a demo cannot be mistaken for a synchronized design.

## Local Preview negotiation

Local Preview uses one exact WebSocket subprotocol:

```text
mosaic.local-preview.v0.2
```

The selected connection still does not imply support for every capability, so
Studio checks the client's capability report before sending a draft.

The protocol remains platform-neutral. Framework convenience, native resource
names, billing-provider models, and platform-only view behavior are not reasons
to fork the shared schema.

## Commerce Provider versioning

Commerce Provider records require exact
`commerceProviderContractVersion: "1"`. Readers reject unknown versions,
record types, outcomes, and properties. Provider identities are opaque values,
but capability names and normalized state machines are closed.

An additive field, capability, record type, or outcome requires a reviewed
compatibility decision and normally a later Commerce Provider contract version.
Changing the Commerce Provider contract does not authorize a Paywall Protocol
or Configuration Delivery change.

Commerce Provider Contract `2` is a parallel exact reader for native-store
recovery, delayed updates, and local acceptance. V1 remains valid. Records from
different versions are never combined. A client receives v2 only after
declaring exact v2 support.

## Commerce Configuration versioning

Commerce Configuration sidecars require exact
`commerceConfigurationVersion: "1"`. Readers reject unknown versions, fields,
activation sources, and mapping variants.

The sidecar is immutable and associated with one exact Environment,
Application, platform, Configuration Release ID, and Configuration Release
digest. Its own canonical content digest excludes only the digest member
itself. A reader rejects any digest or association mismatch and replaces the
sidecar atomically with its Configuration Delivery release.

Changing activation, mapping, freshness, or association semantics requires a
reviewed compatibility decision and normally a later Commerce Configuration
version. It does not authorize changes to Paywall Protocol `0.2`,
Configuration Delivery `1`, or Commerce Provider Contract `1`.

Commerce Configuration `2` is parallel to v1 and adds native-store activation,
exact native selectors, Product grants, recovery mode, and native observation
context. An unsupported v2 candidate is rejected atomically while retaining
the last accepted release-associated sidecar. If none exists, the SDK uses a
compatible bundled fallback or reports configuration unavailable. It never
interprets v2 as v1 or falls back to another provider.

Commerce Provider v2 operation and update references use the exact accepted
Commerce Configuration v2 content digest as `configurationRevision`. A
different digest is a different immutable revision; readers do not compare
numeric ordering or accept aliases.
