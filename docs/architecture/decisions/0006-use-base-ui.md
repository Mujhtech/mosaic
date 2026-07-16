# ADR-0006: Use shadcn/ui with Base UI

## Status

Accepted

## Date

2026-07-16

## Context

Mosaic requires accessible, composable dashboard primitives while retaining control over styling and interaction.

## Decision

Use:

- Tailwind CSS
- shadcn/ui
- Base UI primitives

Do not use Radix UI.

## Consequences

### Benefits

- accessible primitives
- composable APIs
- ownership of component source
- consistency with the chosen dashboard stack

### Trade-offs

- some components may require custom implementation
- documentation and examples may be less abundant than Radix-based shadcn implementations

## Alternatives Considered

- Radix UI
- Headless UI
- custom primitives
- Material UI

---
