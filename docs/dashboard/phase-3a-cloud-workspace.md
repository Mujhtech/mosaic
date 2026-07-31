# Phase 3A dashboard cloud workspace

The Phase 3A dashboard adds a hosted route subtree without changing the account-free Local Studio
at `/studio`.

## Ownership and state

- Route and search parameters own Organization, Project, Environment, Catalog filter, and selected
  resource identity.
- Feature-owned TanStack Query queries and mutations own REST server state. Hosted data is not
  copied into a global store.
- TanStack Form owns create and membership form state. React local state is limited to UI concerns
  such as the one-time API-key secret and Product lifecycle review.
- REST types and operations come from `docs/backend/openapi.yaml` through
  `npm run generate:api`. Files in `src/generated/api` and `src/routeTree.gen.ts` are generated and
  must not be edited manually.

## Hosted routes

The route subtree begins at `/workspace` and includes Organization creation/detail/members,
Project creation/detail, Applications, Environments, environment-scoped API keys, and Catalog
Plans, Products, and Entitlement definitions. Catalog and Applications are project-wide;
API-key selection is environment-scoped in the URL search parameters.

Each server-backed surface distinguishes loading, empty, general error, unauthenticated, and
permission states. General failures offer retry, Local Studio recovery, and request-ID copying when
the API supplies one. A `401` returns to the honest authentication-decision state; it does not
manufacture a local session.

## Catalog and credential safeguards

- Plans group Products; Products grant Entitlement definitions.
- Product detail shows usage before archive, replacement, and restore controls. Referenced Products
  require a valid replacement before archive confirmation; destructive deletion is not offered.
- Provider mappings are labeled non-operative placeholders and do not claim to synchronize provider
  data before Phase 4.
- Public SDK keys and secret server keys are visibly distinguished. A create/rotate response keeps
  the raw secret only in component state, warns that it is one-time, and removes it when dismissed.

## Deferred owner decisions

The repository has no approved hosted identity provider, credential exchange, or browser session
mechanism. Login and signup therefore provide validation and accurate blocking copy only. Hosted
API requests can surface the backend `401` decision state; Local Studio remains available without
an account. Production PostgreSQL tooling and adapters are separately deferred by the Phase 3A
plan.

## Deferred dashboard follow-ups

Phase 3A intentionally keeps cursor pagination and broader create/edit-form validation at the
generated-client boundary. The list endpoints expose `cursor` and `limit`, and API validation
errors render through the feature mutation states, but a shared pagination control and a complete
form-validation overhaul are deferred until a later bounded dashboard slice.
