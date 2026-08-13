# Protocol Conventions

## Purpose

The Mosaic protocol defines a platform-neutral representation of monetization interfaces.

## Rules

- Do not reference Flutter widget names.
- Do not reference SwiftUI view types.
- Do not reference Compose-specific modifiers.
- Use logical layout semantics.
- Use semantic design tokens.
- Use explicit versioning.
- Do not include executable code.
- Unknown components must fail safely.
- Components must define fallback behaviour where required.

## Compatibility

Every SDK declares:

- SDK version
- supported schema versions
- supported component versions
- custom component capabilities

Studio must use this information when validating publication.

## Fixtures

Every meaningful protocol feature requires fixtures.

Fixtures must cover:

- standard rendering
- invalid values
- long text
- RTL
- accessibility scaling
- missing assets
- unavailable products
- unsupported components
- offline fallback

## Changes

Protocol changes require:

- schema update
- fixture update
- documentation
- compatibility review
- implementation or fallback across all supported SDKs

## One version per contract, until GA

Mosaic is pre-GA, so every contract carries exactly one version: the latest. A
contract change **replaces** its version rather than adding one beside it, and
the replaced version is deleted outright — schemas, fixtures, compatibility
manifest, tools, contract document, and every reference, version-dispatch arm,
projection, migration path, and version fallback that named it.

Do not add a second version of a contract, a reader that accepts two versions, a
projection between versions, or a migration path. Parallel versions begin at GA,
when the deprecation policy takes over.

Version identifiers stay **exact** regardless: a reader declaring `0.4` accepts
only `0.4` and never infers support from numeric ordering.

See
[ADR-0028](../decisions/0028-single-version-contracts.md) and
[`docs/protocol/versioning.md`](../../protocol/versioning.md).
