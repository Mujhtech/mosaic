# ADR-0008: Standardize HTTP Responses

## Status

Accepted

## Date

2026-07-16

## Context

Direct use of JSON rendering in every handler can produce inconsistent response envelopes, status handling, metadata, and error formats.

## Decision

Use `github.com/go-chi/render` behind a Mosaic-owned response package.

Handlers must use helpers such as:

- `response.OK`
- `response.Created`
- `response.Accepted`
- `response.NoContent`
- `response.Error`

Handlers must not call `render.JSON` directly.

## Consequences

### Benefits

- consistent API contracts
- centralized error translation
- simpler testing
- easier request-ID inclusion
- easier future API changes

### Trade-offs

- response helpers must remain small
- over-generalized envelopes could reduce clarity

## Alternatives Considered

- direct `encoding/json`
- direct `render.JSON`
- framework-specific response contexts

---
