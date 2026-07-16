# ADR-0007: Use Chi for HTTP Routing

## Status

Accepted

## Date

2026-07-16

## Context

Mosaic needs an idiomatic Go router that works with `net/http`, supports middleware composition, route grouping, subrouters, and straightforward testing.

## Decision

Use:

- `github.com/go-chi/chi/v5`
- `github.com/go-chi/chi/v5/middleware`
- `github.com/go-chi/cors`

All backend HTTP routing will use Chi.

## Consequences

### Benefits

- idiomatic `net/http`
- lightweight abstraction
- composable middleware
- simple tests
- mature ecosystem

### Trade-offs

- fewer built-in framework conveniences
- Mosaic must define its own response and request conventions

## Alternatives Considered

- Gin
- Echo
- Fiber
- Gorilla Mux

---
