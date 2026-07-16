# ADR-0005: Use TanStack Start for the Dashboard

## Status

Accepted

## Date

2026-07-16

## Context

Mosaic Studio requires routing, server rendering where useful, data loading, forms, and a scalable React architecture.

## Decision

Use TanStack Start with:

- TanStack Router
- TanStack Query
- TanStack Form
- TypeScript

## Consequences

### Benefits

- cohesive TanStack ecosystem
- typed routing
- strong server-state management
- flexible full-stack React architecture

### Trade-offs

- smaller ecosystem than some alternatives
- framework conventions may evolve
- contributors may require onboarding

## Alternatives Considered

- Next.js
- Remix
- Vite SPA
- custom React server

---
