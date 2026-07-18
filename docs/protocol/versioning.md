# Mosaic Protocol Versioning

## Current pre-release rule

Protocol `0.2` RC4 and Local Preview `0.2` are the only supported contracts
while Mosaic is iterating before its first stable release. Earlier experimental
contracts have been retired rather than carried as compatibility readers.

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
