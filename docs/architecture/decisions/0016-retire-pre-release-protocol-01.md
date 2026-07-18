# ADR 0016: Retire the pre-release Protocol 0.1 contract

- Status: accepted
- Date: 2026-07-18

## Context

Mosaic is still iterating before its first stable protocol release. Maintaining
two complete readers, Local Preview transports, fixtures, migrations, and
renderer branches was slowing changes and obscuring which behavior Studio was
actually authoring.

## Decision

Protocol `0.2` RC4 and Local Preview `0.2` become the single pre-release
contracts. Protocol `0.1` schemas, fixtures, migrations, transport negotiation,
and SDK reader paths are retired. Studio and first-party examples connect only
with `mosaic.local-preview.v0.2`.

Production SDK bundled fallback remains a safe-failure capability. Local
Preview examples do not display it before the first Studio revision; they show
loading, waiting, or connection-failure state instead.

## Consequences

- Pre-release projects must use Protocol `0.2`.
- All three native renderers and Studio evolve against one contract.
- No downgrade or migration path is promised for the retired experiment.
- A future approved public contract will follow the normal immutable-version
  policy and require an explicit compatibility decision for its successor.
