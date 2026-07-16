# Dashboard Foundation

## Phase 0 scope

The dashboard currently proves that the approved frontend stack can run as one coherent shell. It
does not implement authentication, organizations, projects, paywalls, the Studio editor, publishing,
analytics, or other later-phase product domains.

The only route is `/`. Its screen belongs to `features/foundation/`; this makes feature ownership
explicit without creating speculative empty feature trees.

## Structure

```text
apps/dashboard/src/
├── components/
│   ├── feedback/       # generic loading, error, empty, and route states
│   ├── layout/         # application chrome
│   └── ui/             # shadcn/ui-style generic primitives
├── config/             # runtime-safe public configuration
├── features/
│   └── foundation/     # the current route's owned UI
├── hooks/              # cross-feature hooks only
├── lib/
│   ├── api/            # REST client and normalized errors
│   └── query/          # TanStack Query policy
├── providers/          # narrow provider composition
├── routes/             # TanStack Router file routes
└── styles/             # Tailwind CSS entry point and design tokens
```

Feature hooks, queries, mutations, types, and components must remain inside the feature that owns
them. `src/hooks/` currently contains only `useMounted`, a framework-level hydration hook.

## Server state and SSR

`getRouter()` creates a new `QueryClient` for each server request. The official TanStack Router SSR
query integration handles dehydration and hydration; `AppProviders` supplies the corresponding
`QueryClientProvider`. Query data must not be copied into a context or client store.

The initial query policy retries only retryable failures, at most twice. Mutations do not retry by
default because their idempotency is domain-specific.

## REST boundary

`createApiClient` provides:

- relative URL resolution contained within one configured API origin and path prefix
- bearer-token injection through a caller-owned accessor
- JSON request and response handling
- request cancellation via `AbortSignal`
- `X-Request-ID` propagation and response metadata
- normalized `ApiError`, `ApiNetworkError`, and `ApiRequestAbortedError` values
- conservative retry metadata for TanStack Query

Successful responses unwrap Mosaic's `{ "data": ... }` envelope. The error parser consumes the
backend's nested `{ "error": { "code", "message", "fields", "requestId" } }` envelope while still
accepting a future generic `details` value at the client boundary. Authentication, generated API
types, and the final environment-context header remain deferred until an approved product route is
added. Request paths that are absolute, contain backslashes, traverse parent segments (including
encoded variants), or resolve outside the configured path prefix are rejected before `fetch`; bearer
credentials are therefore never sent to a path outside that boundary.

## Base UI proof

- `components.json` declares `style: "base-nova"`.
- `components/ui/button.tsx` wraps `@base-ui/react/button`.
- `package.json` contains `@base-ui/react` and contains no `@radix-ui/*` dependency.
- global CSS includes the root isolation and body positioning recommended for Base UI portals.

## Root integration

The repository had no root package-manager or workspace files when this foundation was created. The
dashboard therefore owns its npm lockfile and all commands run from `apps/dashboard`. A later root
integration should choose the monorepo package manager, wire aggregate scripts, and migrate this
package without changing the application-level contracts.
