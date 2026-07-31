# Phase 3A Gate Review: Cloud Workspace and Catalog Foundation

## Status

**Rejected pending fixes**

The isolated Phase 3A foundation is substantial and its confirmed implementation blockers were
addressed within the allowed two bounded fix rounds. Gate 3A cannot be accepted because the
repository has no
owner-approved hosted authentication/session implementation or PostgreSQL access and migration
tooling. The running API therefore uses an anonymous principal resolver and deterministic in-memory
storage: hosted routes correctly reject unauthenticated requests, but data is not durable and the
required authenticated, restart-safe demo cannot be performed.

Phase 3B has not started.

## Git Isolation

- Base commit: `a1b32557e8c26b676b0f9a4cbe859cd172dffaf4`
- Worktree: `/Users/muhideenmujeeb/Projects/mosaic-phase-3a`
- Branch: `phase/3a-cloud-workspace`
- The active Phase 2.5/user worktree at `/Users/muhideenmujeeb/Projects/mosaic` was not used for
  implementation and its existing uncommitted changes were preserved.
- Intentionally excluded: Phase 2.5 review and implementation paths; the paywall editor and Studio
  workspace, canvas, Layers, inspector, preview controls, and Studio layout; design-system and
  design-token packages; `protocol/**`; all SDKs; and native example applications.
- No commit, tag, push, merge to `main`, or Phase 3B work was performed by this orchestration.
- After Phase 2.5 acceptance, this branch must be rebased or merged against the accepted Phase 2.5
  baseline, conflicts resolved without overwriting either phase, and the full repository validation
  and Gate 3A demo rerun before Gate 3B.

## Completed Deliverables

### Accounts and sessions

- Added an identity-provider-neutral `Principal` boundary and authentication middleware.
- Distinguished expected unauthenticated requests from resolver infrastructure failures; unexpected
  failures return a safe internal error and are logged without credentials.
- Defined the browser-session, SDK-key, and server-key boundaries in the frozen Phase 3A contract.
- Did not choose an identity vendor, credential flow, cookie/token design, or recovery mechanism.
  Login and registration remain honest scaffolding rather than a simulated hosted session.

### Organizations and members

- Added Organization creation, listing, details, membership, owner/admin/member roles, removal,
  last-owner protection, audit events, authorization, pagination, filtering, REST handlers, and
  dashboard workflows.
- Authorization is enforced in application services, including tenant isolation, independently of
  dashboard controls.
- Invitation delivery was not added because it depends on the authentication decision.

### Projects and applications

- Added Projects with archive/restore, scoped keys, audit history, and active/archived dashboard
  filtering so archived Projects remain recoverable.
- Added iOS and Android Application registration using bundle/package identifiers without encoding a
  Flutter, SwiftUI, or Compose framework assumption.
- Added nested Organization/Project/resource scope validation and safe mismatch recovery in hosted
  dashboard details.

### Environments

- Added Development, Staging, and Production Environments with project isolation and immutable
  scoped keys.
- Added environment management and URL-owned environment selection on environment-scoped API-key
  screens. The misleading hard-coded global Development selector was removed.

### API keys

- Added environment-scoped public SDK and secret server keys, cryptographic generation, one-time
  reveal, SHA-256 digest-only storage, rotation, revocation, last-used metadata, authorization, audit
  events, and REST/dashboard workflows.
- Raw secrets are not persisted or logged and are not returned from list/detail operations.
- Dashboard mutation results transfer secrets to ephemeral reveal state and immediately remove them
  from TanStack Query's mutation cache. Dismissal, replacement, and environment switching clear the
  reveal and cached secret results.
- Rotation and revocation now require explicit confirmation naming the affected Environment.

### Plans

- Added project-scoped Plans and Plan-to-Product memberships with uniqueness and same-Project
  enforcement.
- Empty Plans retain an Add Product action; memberships can be added and removed.

### Products

- Added stable Mosaic Product IDs, project-scoped keys, Mosaic-owned metadata, subscription and
  one-time non-consumable types, lifecycle/readiness state, mock/provider metadata distinction, and
  placeholder provider mappings.
- Provider Packages and Offerings were not introduced as Mosaic navigation or domain resources.

### Entitlements

- Added Entitlement definitions separately from Products and reversible Product-to-Entitlement
  grants.
- Entitlements describe Catalog access only. Mosaic does not claim authoritative customer
  subscription or entitlement state.

### Lifecycle and usage

- Added Product usage inspection, archive, restore, replacement, destructive-delete protection,
  historical reference preservation, and readiness reasons.
- Replacement graphs are cycle-safe; replacement targets cannot be archived or changed to an
  incompatible type while referenced. Invalid dependencies cannot report ready.
- Dashboard replacement selection remains local until confirmation, Cancel performs no mutation,
  existing replacements are recognized, and an absent candidate offers Create Replacement Product.
- Catalog mutations centrally invalidate affected lists, details, usage, readiness, relationships,
  mappings, and replacement targets so archive decisions cannot rely on known-stale usage.

### REST and OpenAPI

- Added `/v1` Organization, membership, Project, Application, Environment, API-key, Plan, Product,
  Entitlement, relationship, mapping, usage, and lifecycle resources.
- Handlers use Chi, Ozzo Validation, Mosaic response helpers, stable machine-readable errors,
  request correlation, Zerolog, and OpenTelemetry. Business authorization and lifecycle rules remain
  outside transports.
- Added bounded cursor pagination and filtering. Malformed or stale cursors return
  `422 validation_failed` instead of replaying page one.
- Expanded the OpenAPI source and regenerated the typed dashboard client from it.

### Dashboard

- Added a hosted route tree and feature-owned Organizations, Members, Projects, Environments,
  API Keys, Plans, Products, and Entitlements features while leaving `/studio` account-free.
- TanStack Query owns server state; URL/search parameters own navigational scope. No hosted server
  state was copied to a global store.
- Used the existing Tailwind/shadcn Base UI system and Phosphor icons. No Radix or Lucide application
  dependency was added.
- Added loading, empty, error, permission, scope-mismatch, and recovery states for the implemented
  workflows. The generated route tree was updated by the established tooling.

### Tests

- Backend tests protect tenant/project/environment isolation, roles, last-owner behavior, API-key
  disclosure/rotation/revocation, Catalog relationships, lifecycle, replacement graph invariants,
  usage, audit/telemetry, validation/error mapping, cursors, and authentication middleware behavior.
- Dashboard tests protect one-time reveal behavior and mutation-cache hygiene, Catalog-impact query
  invalidation, lifecycle decisions, hosted query states, workspace navigation, and nested scope.
- No migration test was added because no migration system or database adapter was authorized.

## Product Review

### Phase fit

The implementation stays within the isolated Phase 3A boundary. Local Studio remains separate and
account-free. Hosted publishing/configuration delivery (3B), provider synchronization (Phase 4),
Placements/advanced targeting (Phase 5), and authoritative customer subscription state (Phase 9)
were not introduced.

### Product and Entitlement boundary

Products are stable sellable Catalog references. Entitlements are reusable access definitions
granted by Products. Plans group Products. These remain separate concepts in the domain, REST API,
and dashboard.

### Provider-state boundary

Provider Product Mappings are explicitly non-operative placeholders. Mock metadata is labeled and
does not masquerade as fetched or validated provider state.

### Deferred work

- Hosted authentication/session implementation and invitation delivery.
- PostgreSQL adapter, schema migrations, restart durability, and production transaction behavior.
- Hosted publishing, versions, releases, rollback, CDN/configuration delivery, and SDK networking.
- Live provider connection, import, validation, synchronization, purchasing, and authoritative
  customer entitlement state.
- Dashboard cursor consumption, complete capability-aware control hiding, broad inline field-error
  mapping, named scope switchers, mobile hosted navigation, and secondary-section error boundaries.

### Owner decisions

1. Select the hosted identity/session design: provider or self-hosted mechanism, browser cookie or
   token boundary, verification/recovery, TTL/rotation/revocation, CSRF, and credentialed CORS.
2. Select PostgreSQL tooling and the backend sharing boundary: driver, SQL/query approach, migration
   runner, ID generation, and application transaction API. The plan recommends a shared Go module,
   `pgx`, explicit SQL or `sqlc`, and application-owned transactions, but does not treat that
   recommendation as approval.

Until both decisions are made and implemented, the Product review is **Owner decision required** and
Gate 3A remains rejected.

## UX Review

### Information architecture and terminology

The hosted hierarchy is Organization → Project → Application/Environment/Catalog, with Catalog
containing Plans, Products, and Entitlements. Provider Packages and Offerings are absent. Applications
use platform identities, while provider mappings are described as placeholders rather than live
connections.

### Dead ends and recovery actions

The fix round restored first-Product creation for empty Plans, relationship removal, archived-Project
discovery, scope-mismatch return paths, permission return paths, local replacement review/cancel,
replacement creation recovery, and API-key destructive-action confirmations. Usage appears before
Product lifecycle actions.

### Remaining task-completion findings

- Organization and Project context still needs polished named switchers instead of relying on
  navigation and route IDs.
- Member capability data is not yet exposed to drive all read-only controls; backend `403` remains
  the final authority and some members can reach an action before being denied.
- Dashboard lists do not yet consume `nextCursor`, so records after the first server page are not
  reachable in the UI.
- Several forms still rely on server validation and a global error instead of complete client and
  field-level recovery. Some independently loaded detail sections need their own error recovery.
- Mobile hosted navigation, clipboard-failure messaging, localized timestamps, and replacement of
  temporary implementation terminology remain tracked UX work.

These issues are important follow-ups, but the authentication and persistence decisions are the
current Gate blockers.

The targeted quality recheck after the first fix round found three additional dashboard blockers:
secret data surviving in the active TanStack mutation observer, incomplete scope guards on
project-scoped list routes, and failure to invalidate the prior Product replacement target. The
second and final bounded fix round reset both observer and cache state, applied fail-closed scope
validation to Applications, Environments, API Keys, Plans, Products, and Entitlements, and
invalidated source, old-target, and new-target caches. Root-level focused tests, lint, type checking,
and production builds passed after those changes.

## Engineering Review

### Migrations and persistence

No migrations, PostgreSQL adapter, ORM, query generator, or migration framework were introduced.
This avoided silently choosing an architectural dependency, but means migration acceptance criteria
and restart durability are unavailable. The in-memory repository provides deterministic behavior and
an application transaction boundary only; it is not production persistence.

### Authorization and secret handling

Mandatory service-layer authorization and nested-scope checks passed focused tests. API-key secrets
use cryptographic generation and digest-only persistence, are never logged or re-listed, and are
removed from the browser query cache after one-time transfer.

### API conformance and telemetry

REST handlers follow the approved Chi/Ozzo/response-helper stack and the generated dashboard client
matches the OpenAPI source. Stable errors cover authorization, validation, lifecycle, replacement,
and cursor failures. Meaningful mutations, including relationship removal, emit spans, scoped logs,
and audit events without secret material.

### Checks run

- `go test ./...` — passed.
- `go vet ./...` — passed.
- `go test -race ./internal/cloudworkspace ./internal/platform/authn ./internal/transport/cloudworkspace`
  — passed.
- `npm run generate:api` — passed.
- `npm run format:check` — passed.
- `npm run lint` — passed with zero warnings.
- `npm run typecheck` — passed.
- Initial focused Phase 3A Vitest suite — seven files, 11/11 tests passed.
- Final security/scope/cache/lifecycle regression suite — five files, 11/11 tests passed.
- `npm run build` — client and SSR production builds passed; only pre-existing large-chunk warnings
  were emitted.
- `git diff --check` — passed.
- Excluded-path scan — no Phase 2.5 review, Protocol, SDK, example, Studio/paywall-editor, design-system,
  or design-token change found.
- Radix/Lucide scan — clean.

### Unavailable checks and known defects

- Migration and persistent restart checks are unavailable until PostgreSQL tooling is approved and
  implemented.
- The authenticated Gate demo is unavailable until the hosted identity/session decision is approved
  and implemented. With the current anonymous resolver, hosted endpoints intentionally return 401.
- The full dashboard Vitest suite remains red in unchanged, excluded paywall-editor/preview files:
  the isolated Phase 3A run observed 26 failures and the clean checkpoint worktree observed 27 in the
  same area. Focused Phase 3A tests are green, so this comparison does not indicate a Phase 3A
  regression; the full suite must still be green on the accepted Phase 2.5 integration baseline.
- Dashboard pagination, capability-aware controls, complete field-level form errors, and some
  secondary-query recovery states remain known follow-ups.
- Product replacement followed by archive remains two explicit server writes. A successful
  replacement can remain if the later archive request fails; the UI should make that partial state
  more explicit or a future approved API should make the operation atomic.
- Replacement choices are filtered by Product type, while graph-cycle rejection remains a backend
  invariant surfaced as a stable recoverable error.

## Parallel Integration Review

- Stage 1 used product, UX, backend, and dashboard agents for read-only inspection. Their findings
  were reconciled into `docs/plans/phase-3a-cloud-workspace.md` before production edits.
- Stage 2 allowed only the backend and dashboard agents to write, with non-overlapping ownership.
- Stage 3 used product, UX, and quality agents for read-only review. The first bounded
  backend/dashboard fix round addressed confirmed lifecycle, secret-cache, invalidation,
  nested-scope, and recovery blockers. The required targeted quality recheck found three remaining
  dashboard issues; the second and final bounded dashboard round fixed them, followed by independent
  root validation.
- No Phase 2.5 implementation or review file was overwritten.
- No Protocol, SDK, native example, Studio/paywall-editor, design-system, or design-token file changed.
- Gate 3A is not merged to `main` while Phase 2.5 remains unaccepted.
- Rebase or merge onto the accepted Phase 2.5 baseline and complete revalidation remain mandatory.

## Decision

**Gate 3A rejected pending fixes.**

Obtain the hosted authentication/session and PostgreSQL/migration decisions, implement and validate
those adapters and migrations, perform the authenticated persistent Gate 3A demo, integrate against
the accepted Phase 2.5 baseline, and rerun the complete repository suite. Do not begin Gate 3B before
a new Gate 3A review accepts that integrated result.
