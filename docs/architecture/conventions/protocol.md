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

---
