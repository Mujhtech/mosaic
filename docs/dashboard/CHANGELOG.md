# Dashboard Changelog

## 0.1.0 - 2026-07-16

- Added the TanStack Start, React, TypeScript, and Tailwind CSS application foundation.
- Configured shadcn/ui for Base UI and added the first Base UI-backed button primitive.
- Added the route shell, query providers, REST client boundary, and accessible feedback states.
- Added local format, lint, type-check, test, build, development, and production commands.
- Aligned the REST client with the backend `X-Request-ID`, success-envelope, and field-error
  contracts.
- Added the documented error-body `requestId` fallback when a response header is unavailable.
- Aligned the scaffolded icon dependency and shadcn/ui generator configuration with ADR-0012's
  Phosphor icon decision.
- Confined relative REST paths to the configured API origin and path prefix before attaching bearer
  credentials.
