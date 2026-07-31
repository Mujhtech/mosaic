# Phase 3A Cloud Workspace and Catalog Contract

Status: Rejected pending fixes

## Authority and gate boundary

The owner-provided Phase 3A orchestration brief authorizes this isolated work while Phase 2.5 remains
in progress. It is a narrow exception to the checked-in roadmap statement that Phase 3 follows
Phase 2.5 acceptance. The exception does not authorize a merge to `main`, Gate 3B, or describing
Phase 3 as complete.

Implementation uses branch `phase/3a-cloud-workspace` in
`/Users/muhideenmujeeb/Projects/mosaic-phase-3a`, based on clean checkpoint
`a1b32557e8c26b676b0f9a4cbe859cd172dffaf4`. Before Gate 3B, it must be rebased or merged onto the
accepted Phase 2.5 baseline and fully revalidated.

The account-free `/studio` route, Studio workspace, protocol, SDKs, native examples, design-system
packages, and Phase 2.5 review documents are excluded from this phase.

## Product boundary

Phase 3A establishes an optional hosted workspace and a provider-neutral Catalog. Local Studio
continues to work without an account or hosted service.

Phase 3A owns:

- Organizations and memberships;
- Projects, Applications, and Environments;
- environment-scoped SDK and server API-key records;
- Plans, Products, Entitlement definitions, grants, memberships, and provider-mapping placeholders;
- reversible Product and Project lifecycle operations, usage inspection, audit records, and stable
  REST contracts;
- non-Studio dashboard information architecture and workflows.

Phase 3A does not own:

- hosted drafts, publishing, versions, releases, rollback, CDN or configuration delivery (Gate 3B);
- provider connection, import, validation, metadata synchronization, or purchasing (Phase 4);
- Placements or advanced targeting (Phase 5);
- customer subscription state, receipt validation, or authoritative customer Entitlements (Phase 9);
- protocol, SDK, example-app, Studio, design-system, or design-token changes.

## Owner decisions preserved

### Authentication and session mechanism

No accepted decision selects a hosted identity vendor, credential scheme, or browser session
mechanism. Phase 3A therefore defines auth-neutral ports and authorization behavior but does not
silently choose OIDC, passwords, magic links, bearer refresh tokens, or cookie sessions.

The transport boundary yields a `Principal` containing an actor ID and authentication metadata.
Application services accept the actor explicitly. Domain packages do not read HTTP context.
Dashboard sessions, public SDK keys, and secret server keys are distinct authenticators.

Choosing an identity provider, cookie versus token sessions, verification/recovery, session TTL,
rotation/revocation, CSRF, and credentialed CORS requires owner approval. Until then, hosted auth
screens may remain honest scaffolding and hosted routes must not make `/studio` account-dependent.

### PostgreSQL access and migrations

ADR-0013 accepts PostgreSQL, `pgx/v5` with `pgxpool`, explicit SQL, Goose migrations, and
application-owned transactions. The production API requires PostgreSQL and has no in-memory
fallback. In-memory persistence remains test-only. The API never auto-migrates; deployment or the
explicit migration command owns schema changes. The API/worker sharing boundary remains deferred
until a runnable worker needs it.

## Terminology and information architecture

`Organization` is the tenant and membership boundary. `Project` groups one product's registered
applications and project-wide Catalog. `Application` is a concrete iOS or Android app identity.
`Environment` isolates runtime credentials and later hosted configuration.

Catalog navigation is:

```text
Catalog
├── Plans
├── Products
└── Entitlements
```

The UI may explain Entitlements as “access your Products unlock,” but REST/domain names remain
`Entitlement`. Provider Packages and Offerings are never top-level Mosaic concepts.

Organization and Project selection are persistent hosted-workspace context. Environment selection
is shown only on environment-scoped surfaces. Applications and Catalog are project-wide and must
not appear filtered by a hidden Environment.

## Domain model

### Identity and authorization

- `Actor`: stable authenticated subject independent of identity provider.
- `Principal`: transport result identifying an Actor.
- `Membership`: Actor-to-Organization relationship with `owner`, `admin`, or `member` role.
- `Invitation`: deferred unless authentication delivery/acceptance is approved; no email delivery
  is implemented in Phase 3A.

### Workspace

- `Organization`: ID, name, created/updated timestamps.
- `Project`: ID, Organization ID, key, name, active/archived status, archive metadata, timestamps.
- `Application`: ID, Project ID, name, platform (`ios` or `android`), bundle identifier or package
  identifier, timestamps. Framework is intentionally absent.
- `Environment`: ID, Project ID, key and name. Every Project starts with `development`, `staging`,
  and `production`; keys are immutable and unique per Project.

### API keys

- `APIKey`: ID, Environment ID, kind (`public_sdk` or `secret_server`), prefix, irreversible secret
  digest where appropriate, created/rotated/revoked/last-used metadata, and creator Actor ID.
- Raw secret material exists only in the create/rotate result and is never persisted, logged, or
  returned by list/detail operations.

### Catalog

- `Plan`: ID, Project ID, unique key, name, optional description, timestamps.
- `Product`: stable Mosaic ID, Project ID, unique key, internal name, optional description, type
  (`subscription` or `one_time_non_consumable`), status (`draft`, `connected`,
  `attention_required`, `archived`), metadata source (`mock` or `provider`), archive metadata,
  optional replacement Product ID, timestamps.
- `Entitlement`: definition only—ID, Project ID, unique key, name, optional description, timestamps.
- `PlanProduct`: Plan-to-Product membership unique within a Project.
- `ProductEntitlementGrant`: Product-to-Entitlement definition grant unique within a Project.
- `ProviderProductMapping`: placeholder containing Product ID, Application ID, provider kind,
  provider Product identifier, status `placeholder`, and timestamps. It performs no network work
  and never asserts provider validity.
- `ProductUsage`: read model listing Plan memberships, Entitlement grants, placeholder mappings,
  and historical references known to the current persistence boundary.
- `AuditEvent`: actor, Organization/Project/Environment/resource context, stable action, timestamp,
  and non-secret metadata.

## Database model and invariants

The PostgreSQL schema uses opaque stable IDs, UTC timestamps, foreign keys, scoped unique
constraints, monotonic API-key revocation, and application-visible Product replacement history.

Required constraints:

- Membership unique by Organization and Actor; every Organization retains at least one owner.
- Project key unique within Organization.
- Application identifier unique by Project and platform.
- Environment key unique within Project; default environment keys cannot be renamed.
- API key prefix unique; revocation is monotonic; raw secrets are not stored.
- Plan, Product, and Entitlement keys unique within Project.
- Membership and grant joins cannot cross Project boundaries.
- A Product cannot replace itself; replacement must be active, in the same Project, and compatible
  with future-selection semantics.
- Archive and restore preserve the same Product ID and all historical references.
- Destructive Product deletion is unavailable once referenced; archive/replacement are the recovery
  paths.
- Provider mappings remain placeholders and are unique for their Product/Application/provider tuple.

## REST resources

All endpoints use Mosaic response envelopes, stable errors, request IDs, pagination, and filters.
Handlers decode, validate with Ozzo, call services, and map results; authorization lives in services.

```text
/v1/organizations
/v1/organizations/{organizationId}
/v1/organizations/{organizationId}/members
/v1/projects
/v1/projects/{projectId}
/v1/projects/{projectId}/archive
/v1/projects/{projectId}/restore
/v1/projects/{projectId}/applications
/v1/projects/{projectId}/environments
/v1/environments/{environmentId}/api-keys
/v1/api-keys/{apiKeyId}/rotate
/v1/api-keys/{apiKeyId}/revoke
/v1/projects/{projectId}/plans
/v1/plans/{planId}
/v1/plans/{planId}/products
/v1/projects/{projectId}/products
/v1/products/{productId}
/v1/products/{productId}/archive
/v1/products/{productId}/restore
/v1/products/{productId}/replacement
/v1/products/{productId}/usage
/v1/products/{productId}/provider-mappings
/v1/projects/{projectId}/entitlements
/v1/entitlements/{entitlementId}
/v1/products/{productId}/entitlements
```

List resources support cursor pagination and bounded `limit`; Products support status, type, and
search filters. Stable errors include `unauthenticated`, `forbidden`, `not_found`, `conflict`,
`validation_failed`, `last_owner`, `resource_archived`, `product_referenced`,
`replacement_invalid`, `key_revoked`, and `secret_unavailable`.

## Authorization matrix

Backend checks are mandatory even when controls are hidden.

| Action                                                                    | Owner | Admin                  | Member |
| ------------------------------------------------------------------------- | ----- | ---------------------- | ------ |
| Read Organization, membership, Project, Application, Environment, Catalog | Yes   | Yes                    | Yes    |
| Update Organization or manage members                                     | Yes   | Yes, except owner role | No     |
| Remove/transfer final owner                                               | No    | No                     | No     |
| Create/archive/restore Project                                            | Yes   | Yes                    | No     |
| Register Application or manage Environment metadata                       | Yes   | Yes                    | No     |
| Create/rotate/revoke public SDK key                                       | Yes   | Yes                    | No     |
| Create/rotate/revoke secret server key                                    | Yes   | Yes                    | No     |
| Mutate Plans, Products, Entitlements, mappings, lifecycle                 | Yes   | Yes                    | No     |
| Read usage and audit-safe metadata                                        | Yes   | Yes                    | Yes    |

All nested resource access proves Organization membership and same-Project/same-Environment
relationships. A mismatched parent identifier is never accepted merely because the resource ID
exists.

## Product lifecycle, readiness, and usage

Draft Products are editable Mosaic metadata with mock metadata. `connected` is reserved for a
future valid provider connection and cannot be produced by a Phase 3A placeholder.
`attention_required` indicates incomplete Mosaic-owned metadata, invalid placeholder relationships,
or an archived replacement dependency. `archived` removes a Product from new selections without
removing history.

Readiness reports machine-readable reasons and distinguishes Mosaic mock values from future
provider-owned values. A placeholder mapping never makes a Product connected.

Usage is visible before archive or replacement. Archive is reversible. Replacement links the old
Product to a valid active Product without rewriting Plan membership, Entitlement grants, paywall
history, or other historical references. Future authoring may offer the replacement while history
continues to resolve the original stable Mosaic Product ID.

## Dashboard routes and recovery

Hosted routes live in a separate non-Studio route subtree and never guard `/studio`:

```text
/workspace
/organizations/new
/organizations/$organizationId
/organizations/$organizationId/members
/organizations/$organizationId/projects/new
/organizations/$organizationId/projects/$projectId
/organizations/$organizationId/projects/$projectId/apps
/organizations/$organizationId/projects/$projectId/settings/environments
/organizations/$organizationId/projects/$projectId/settings/api-keys
/organizations/$organizationId/projects/$projectId/catalog/plans
/organizations/$organizationId/projects/$projectId/catalog/plans/$planId
/organizations/$organizationId/projects/$projectId/catalog/products
/organizations/$organizationId/projects/$projectId/catalog/products/$productId
/organizations/$organizationId/projects/$projectId/catalog/entitlements
/organizations/$organizationId/projects/$projectId/catalog/entitlements/$entitlementId
```

Server state stays in feature-owned TanStack Query queries/mutations. Organization, Project,
Environment, Catalog tab, filters, and selected resource remain in route/search parameters. Local
state is limited to dialogs, one-time secret reveal, copy feedback, and similar interactions.

Every route has loading, empty, error, and permission states. Errors preserve safe scope and offer
Retry, Return to Project, Continue locally, or Copy request ID as appropriate. Product details show
Usage before lifecycle actions. In-use archive/replacement flows offer View Usage and Create
Replacement. Placeholder mapping copy offers Continue with Mock Metadata and states that provider
connection arrives in Phase 4. Secret reveal warns that it cannot be shown again before dismissal.

## Feature ownership

Backend owns `apps/api/**`, `apps/worker/**`, backend-specific docs, tests, OpenAPI source, and
versioned migrations. Dashboard owns only new `features/auth`, `organizations`, `members`,
`projects`, `environments`, `api-keys`, `catalog`, and new non-Studio routes/tests.

Forbidden paths include Studio/paywall-editor files and routes, `components/ui`, design packages,
protocol, every SDK, native examples, and Phase 2.5 review documents. Generated route/API/protocol
files are regenerated from sources and never manually edited.

## Migration sequence

The approved initial migration applies this dependency order:

1. actors, organizations, memberships, audit events;
2. projects, applications, environments;
3. API keys and rotation metadata;
4. Plans, Products, Entitlements;
5. Plan membership, Entitlement grants, provider mapping placeholders;
6. Product replacement and usage indexes;
7. backfill/default constraints followed by final foreign keys and scoped uniqueness checks.

Every migration must be forward-tested against PostgreSQL and its rollback/operational policy must
be documented before Gate 3A acceptance.

## Test strategy

Tests are selected as risk controls. Backend service tests protect tenant/environment isolation,
role enforcement, last-owner integrity, API-key non-disclosure/rotation/revocation, Catalog scoped
relationships, lifecycle history, destructive-delete prevention, stable validation/error mapping,
and audit emission. The acceptance workflow runs the focused persistence suite against a disposable
real PostgreSQL database with `DATABASE_TEST_URL`; an ordinary skipped test run is not DB evidence.

Dashboard behavior tests protect scope switching, server-state boundaries, loading/empty/error/
permission recovery, one-time secret handling, Product creation/usage/archive/replacement, Plan
membership, Entitlement grants, and absence of provider-specific top-level navigation. Existing
test infrastructure is extended; no new runner or redundant snapshot suite is introduced.

Repository validation includes Go format/test/vet, OpenAPI validation where available, dashboard
format/lint/typecheck/test/build, explicit PostgreSQL migration/persistence checks, forbidden-path/dependency
scans, `git diff --check`, and the Gate 3A demo where runtime dependencies permit it.

## Observable acceptance criteria

1. `/studio` remains usable without authentication and no excluded path changes.
2. Organization, Project, and Environment access is isolated and authorized in backend services.
3. Applications register iOS/Android identifiers without a framework field.
4. Public and secret keys are environment-scoped, one-time-reveal, rotatable, revocable, and never
   logged or re-displayed.
5. Plans, Products, and Entitlement definitions are distinct project-scoped resources.
6. Plans group Products and Products grant Entitlements without cross-Project links.
7. Product references use stable Mosaic Product IDs.
8. Provider mappings remain clearly labeled non-operative placeholders.
9. Product archive/restore/replacement preserve history; usage is inspectable; destructive delete
   is unavailable for referenced Products.
10. Mock metadata and provider-owned metadata are distinguishable; Mosaic claims no authoritative
    customer Entitlement state.
11. Dashboard workflows provide loading, empty, error, permission, and recovery states and never
    expose provider Packages/Offerings as top-level navigation.
12. Migrations, backend tests, dashboard checks, and the required demo pass, or unavailable checks
    and owner-decision blockers are recorded in the Gate report.

## Required demo

```text
Create an Organization
→ add a member where the approved auth/session boundary permits
→ create a Project
→ register iOS and Android Applications
→ switch between Development and Production
→ create a Pro Plan
→ create Monthly and Yearly Products
→ create the Pro Entitlement
→ grant Pro from both Products
→ inspect Product usage
→ attempt an invalid destructive delete
→ recover through archive or replacement
→ create and revoke an SDK key
```

## Stop conditions

Do not begin Gate 3B. Do not implement an auth vendor, session mechanism, provider synchronization,
hosted publishing, configuration delivery, protocol or SDK changes without the corresponding owner
decision. ADR-0013 already authorizes the implemented PostgreSQL/pgx/Goose boundary. Gate 3A cannot
be accepted while the required hosted session and authenticated demo evidence remain unavailable.
