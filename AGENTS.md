# Mosaic Agent Instructions

Mosaic is an open-source, cross-platform app monetization platform focused initially on native paywalls, remote configuration, placements, publishing, analytics, and experimentation.

Mosaic supports:

- Flutter
- SwiftUI
- Jetpack Compose

The core architectural principle is:

> One platform-neutral protocol, three native renderers, and one Studio.

## Read Before Making Changes

Before making substantial changes, read:

- `docs/product/mosaic-agentic-plan.md`
- `docs/product/vision.md`
- `docs/product/roadmap.md`
- `docs/architecture/overview.md`
- the relevant file under `docs/architecture/conventions/`
- relevant ADRs under `docs/architecture/decisions/`

When working inside a directory that contains another `AGENTS.md`, follow both the root instructions and the more specific nested instructions.

The nearest `AGENTS.md` takes precedence for directory-specific conventions.

## Product Direction

Mosaic initially owns:

- paywall creation
- native paywall rendering
- remote configuration
- placements
- targeting
- versioning
- publishing
- rollback
- essential analytics
- experimentation
- billing-provider integration

Mosaic does not initially own:

- receipt validation infrastructure
- cross-platform subscription state
- complete entitlement infrastructure
- financial reporting
- predictive lifetime-value analytics
- AI paywall generation
- marketplace functionality

Do not expand the first release into a complete RevenueCat replacement unless the roadmap is explicitly updated.

## Non-Negotiable Architecture Decisions

### Platform

- Use one versioned, platform-neutral Mosaic protocol.
- Render natively on every supported platform.
- Flutter uses Flutter widgets.
- iOS uses SwiftUI.
- Android uses Jetpack Compose.
- Do not use a shared WebView as the primary renderer.
- Do not place executable code inside remote paywall configuration.

### Backend

- Use Go.
- Use a modular monolith initially.
- Use PostgreSQL as the primary database.
- Use REST APIs throughout.
- Use WebSockets only where real-time preview requires them.
- Use Docker Compose for local development and initial self-hosting.
- Do not introduce microservices, gRPC, Kafka, Kubernetes, or database sharding without an approved ADR.

### Backend HTTP stack

Use:

- `github.com/go-chi/chi/v5` for routing.
- `github.com/go-chi/chi/v5/middleware` for standard middleware.
- `github.com/go-chi/cors` for CORS.
- `github.com/go-chi/render` behind Mosaic-owned response helpers.
- `github.com/go-ozzo/ozzo-validation/v4` for transport-level request validation.
- `github.com/riandyrn/otelchi` for HTTP instrumentation.
- OpenTelemetry for traces, metrics, and observability context.
- `github.com/rs/zerolog` for structured logging.

Do not introduce an alternative router, logger, validation library, or response framework without an approved ADR.

### Dashboard

Use:

- TanStack Start
- React
- TypeScript
- Tailwind CSS
- shadcn/ui built on Base UI
- TanStack Router
- TanStack Query
- TanStack Form

Do not use Radix UI.

### Dashboard Templates and Icons

Initialize the dashboard and authentication experience using:

```bash
npx shadcn@latest add sidebar-07
npx shadcn@latest add login-05
npx shadcn@latest add signup-05
```

Use:

* `sidebar-07` as the dashboard-shell foundation
* `login-05` as the login-page foundation
* `signup-05` as the registration-page foundation

Treat generated templates as starting points.

Refactor generated files into Mosaic’s feature-oriented directory structure.

Use:

```text
@phosphor-icons/react
```

for dashboard icons.

Do not use `lucide-react` in Mosaic application code.

Replace Lucide imports introduced by shadcn templates and remove the package when it is no longer required.

Authentication templates provide only visual scaffolding.

The frontend agent must still implement:

* validation
* TanStack Form integration
* REST mutations
* loading states
* API error handling
* session handling
* redirects
* accessibility
* permission-aware behaviour


### Protocol

- Use JSON Schema as the canonical protocol definition initially.
- Keep protocol definitions independent of Flutter, SwiftUI, and Compose.
- Published protocol fixtures must decode successfully on all supported SDKs.
- Protocol changes require compatibility consideration and fixture updates.

## Repository Structure

The expected top-level structure is:

```text
mosaic/
├── AGENTS.md
├── apps/
│   ├── dashboard/
│   ├── api/
│   ├── worker/
│   └── docs/
├── protocol/
├── sdk/
│   ├── flutter/
│   ├── ios/
│   └── android/
├── packages/
├── examples/
├── deploy/
├── docs/
└── scripts/
```

Do not create unrelated top-level directories without documenting the reason.

## General Engineering Rules

### Prefer vertical slices

Prefer implementing a complete user journey:

```text
Create draft
→ validate
→ publish
→ fetch
→ render
→ interact
→ emit event
```

Avoid building large disconnected infrastructure layers without a working product path.

### Keep business logic out of transports

HTTP handlers must:

1. Decode input.
2. Validate transport-level input.
3. Call an application service.
4. Map the result to an HTTP response.

Handlers must not contain core business rules.

### Preserve platform neutrality

Do not modify the protocol solely to make one SDK implementation easier.

Platform-specific capabilities require:

- an explicit capability declaration
- a defined fallback
- compatibility handling
- protocol review

### Published versions are immutable

Published paywall versions and configuration releases must never be edited in place.

Changes create a new draft, version, or release.

Rollback creates a new release referencing an earlier valid configuration.

### Safe failure is mandatory

SDKs must:

- use cached configuration when remote configuration is unavailable
- support a bundled fallback
- fail without crashing the host app
- expose useful diagnostics
- avoid blocking purchasing because analytics delivery failed

### Tests are part of the feature

A feature is incomplete without appropriate:

- unit tests
- integration tests
- compatibility tests
- fixture updates
- documentation updates

### Avoid premature abstraction

Do not introduce generic packages, factories, or plugin systems before at least two concrete use cases justify them.

Avoid vague package names such as:

- `utils`
- `helpers`
- `common`
- `misc`

Shared packages must have a clear responsibility.

## Backend Conventions

### Routing

Use Chi routers and subrouters.

Each substantial HTTP module may expose a route-registration function or subrouter.

Keep route setup separate from application logic.

### Responses

Handlers must not call `render.JSON` directly.

Use Mosaic response helpers such as:

- `response.OK`
- `response.Created`
- `response.Accepted`
- `response.NoContent`
- `response.Error`

All API errors must use a stable machine-readable structure.

Do not expose internal errors, SQL errors, stack traces, or secrets.

### Validation

Use Ozzo Validation for:

- required fields
- string lengths
- formats
- allowed values
- simple cross-field transport constraints

Use application or domain services for:

- uniqueness
- authorization
- ownership
- state transitions
- database-dependent validation
- publishing eligibility

### Logging

Use Zerolog through the request context.

Logs should include where available:

- service
- environment
- request ID
- trace ID
- actor ID
- project ID
- environment ID
- resource ID

Do not log:

- API secrets
- authorization headers
- payment credentials
- complete request bodies containing sensitive data
- unnecessary personal data

### Telemetry

Use OpenTelemetry for:

- inbound HTTP requests
- outbound HTTP requests
- database operations
- Redis operations
- background jobs
- publishing
- event ingestion
- asset processing
- webhook delivery

Add spans around meaningful application operations, not every trivial function.

## Frontend Conventions

### State ownership

Use:

- TanStack Query for server state
- route and search parameters for navigational state
- local React state for small UI interactions
- dedicated stores only for complex shared client state

Do not copy TanStack Query data into a global store without a documented reason.

### Hooks

Use `src/hooks/` only for reusable cross-feature hooks.

Examples:

- `use-debounce`
- `use-media-query`
- `use-mounted`
- `use-keyboard-shortcut`

Feature-specific hooks belong inside:

```text
features/<feature>/hooks/
```

Examples:

```text
features/paywall-editor/hooks/use-draft-autosave.ts
features/projects/hooks/use-current-project.ts
features/publishing/hooks/use-can-publish.ts
```

The global hooks directory must not become a dumping ground.

### Components

Use `components/ui/` only for generic design-system primitives.

Business components belong to their feature.

Preferred:

```text
features/paywalls/components/paywall-card.tsx
```

Avoid:

```text
components/paywall-card.tsx
```

### Base UI

All shadcn/ui components must use Base UI primitives or approved custom accessible primitives.

Do not add Radix UI dependencies.

### Generated files

Do not manually edit generated API, route-tree, or protocol files.

Update the source definition and regenerate them.

## SDK Rules

Each SDK should provide the same conceptual capabilities while remaining idiomatic to its language.

Each SDK must support:

- configuration
- local caching
- bundled fallback
- placement evaluation
- native rendering
- product loading
- purchasing
- restoration
- normalized result types
- analytics batching
- local development endpoints
- compatibility reporting

Do not return only booleans for purchase and presentation results.

Use explicit result types for:

- purchased
- restored
- already entitled
- dismissed
- cancelled
- product unavailable
- configuration unavailable
- purchase failed
- rendering failed

## Documentation Rules

Update documentation when changing:

- public APIs
- protocol schemas
- environment variables
- repository conventions
- deployment steps
- supported components
- SDK behaviour
- architecture decisions

Architecture changes require an ADR when they:

- replace an approved technology
- introduce a new infrastructure category
- change a public contract
- affect several modules
- introduce long-term operational cost

## Pull Request Checklist

Before considering work complete, verify:

- Does the change solve a documented product problem?
- Is the scope consistent with the current roadmap?
- Is the protocol still platform-neutral?
- Are published resources immutable?
- Are failure paths handled?
- Are errors machine-readable and safe?
- Are logs and telemetry useful without exposing secrets?
- Are tests included?
- Are fixtures updated where necessary?
- Is documentation updated?
- Has unnecessary infrastructure been avoided?
- Does the frontend avoid Radix UI?
- Does server state remain in TanStack Query?
- Are hooks located according to ownership?
- Are generated files untouched?

## When Unsure

Prefer:

- simpler architecture
- explicit code
- stable contracts
- small vertical slices
- native platform conventions
- reversible decisions

Document assumptions instead of silently inventing requirements.

## Multi-Agent Execution

For substantial roadmap work, the root Codex thread acts as the orchestrator.

Use no more than four concurrent subagents.

The orchestrator must:

1. Read the agentic plan and current roadmap phase.
2. Define one bounded deliverable for each subagent.
3. Assign non-overlapping owned paths.
4. State dependencies and files that must not be modified.
5. Wait for all requested agents before integration.
6. Inspect each agent's summary and diff.
7. Resolve contract conflicts centrally.
8. Run repository-wide validation after integration.
9. Request a quality review before declaring a milestone complete.
10. Stop at review gates that require product-owner approval.

Do not assign multiple write-enabled agents to the same files concurrently.

Use parallel work primarily where boundaries are clear. When one deliverable depends on another contract, complete the contract first or instruct the dependent agent to scaffold against an explicitly frozen draft.

The main thread must not delegate product decisions. It may ask subagents for evidence and recommendations, but unresolved product and architecture decisions must be surfaced for owner review.

Every subagent must return:

- summary
- changed files
- decisions made
- tests and commands run
- failures or unavailable checks
- unresolved questions
- suggested next step
