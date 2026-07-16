# ADR-0003: Use JSON Schema for the Mosaic Protocol

## Status

Accepted

## Date

2026-07-16

## Context

Mosaic requires a platform-neutral, inspectable, versioned format for paywalls and configuration.

The format must work in Go, TypeScript, Dart, Swift, and Kotlin.

## Decision

Use JSON Schema as the canonical initial protocol definition.

Maintain:

- schema versions
- fixtures
- compatibility rules
- generated or validated language models

## Consequences

### Benefits

- human-readable configuration
- strong validation
- broad tooling support
- easy storage and delivery
- easy debugging

### Trade-offs

- generated models vary in quality by language
- compatibility requires discipline
- JSON payloads may be larger than binary formats

## Alternatives Considered

- Protocol Buffers
- custom DSL
- YAML
- platform-specific models

---
