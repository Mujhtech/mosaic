# Phase 4A Review: RevenueCat and Custom Providers

## Status

**Accepted with tracked follow-ups**

The Phase 4A implementation is complete at the code and contract level. The
production-shaped RevenueCat sandbox demonstration remains unavailable because
this workspace has no RevenueCat test Project credentials or platform store
test accounts. That limitation is recorded as an unavailable environmental
check, not as a passing demonstration.

## Baseline

- Base commit: `d488bfc2f0b30359209597964057976dc72842fa`
- Branch: `codex/phase-4a-integration`
- Working directory: `/Users/muhideenmujeeb/Projects/mosaic`
- Worktree: the owner explicitly directed Phase 4A to continue in the current
  project directory and current branch; no separate worktree is used.
- Accepted Phase 3 review: `docs/reviews/phase-3.md` records the product owner's
  explicit 2026-07-23 acceptance of the Phase 3 baseline while preserving the
  original Phase 3A and Phase 3B review findings as historical evidence.
- RevenueCat REST API: v2 at `https://api.revenuecat.com/v2`.
- RevenueCat SDKs: Flutter `purchases_flutter 10.4.3`, Apple
  `purchases-ios 5.81.2`, and Android `purchases-android 10.15.0`.
- Official documentation consulted:
  - <https://www.revenuecat.com/docs/api-v2>
  - <https://www.revenuecat.com/docs/projects/authentication>
  - <https://www.revenuecat.com/docs/getting-started/configuring-sdk>
- Credential encryption: ADR-0019, versioned AES-256-GCM envelopes with an
  operator-supplied keyring. The product owner approved direct least-privilege
  RevenueCat v2 secret keys for Phase 4A; OAuth remains deferred.

## Completed Deliverables

### Commerce Provider Contract

- Added the separate, versioned Commerce Provider Contract v1 and Commerce
  Configuration v1 schemas, fixtures, browser declarations, validators, and
  compatibility tests.
- Kept Paywall Protocol `0.1` and `0.2` provider-independent. Published
  Paywalls continue to reference stable Mosaic Product IDs only.
- Defined explicit provider identity, conditional capabilities, resolved
  metadata, freshness, safe diagnostics, purchase and restore outcomes, and
  provider-owned access lookup states.

### Provider Connections

- Added Project-scoped RevenueCat and SDK-only custom Provider Connections with
  explicit sandbox or production mode, Application and Environment scopes,
  lifecycle state, health, testing, rotation, reconnection, and revocation.
- Added REST resources, audit records, safe error responses, and dashboard
  connection management.
- Kept RevenueCat Packages and Offerings as advanced adapter metadata rather
  than top-level Mosaic navigation concepts.

### Secret management

- Encrypts recoverable RevenueCat credentials before PostgreSQL persistence
  using versioned AES-256-GCM envelopes.
- Accepts credentials only during create, rotate, and reconnect; list and detail
  responses never return them.
- Separates server secrets from client-safe RevenueCat public SDK keys.
- Redacts provider bodies and authentication material from errors, logs,
  diagnostics, SDK configuration, and published Commerce sidecars.

### Active-provider selection

- Persists one explicit active Provider Connection for each accepted Project,
  Environment, Application, and platform scope.
- Enforces connection health, lifecycle, mode, tenant, and scope compatibility.
- Shows the authoritative assignment in Catalog and Studio.
- Requires an impact review before replacement or clearing and explains hidden
  unhealthy or incompatible connections with a recovery link.

### RevenueCat adapter

- Added a bounded official RevenueCat REST API v2 catalog adapter for Products,
  Offerings, Packages, and Entitlements.
- Uses one operation deadline, a shared 200-page budget, a shared 20-retry
  budget, bounded `Retry-After`, caller cancellation, and safe provider errors.
- Supports subscription and explicit non-consumable one-time Products. It
  excludes consumables and fails closed when the official
  `one_time.is_consumable` discriminator is missing or malformed.
- Reports trial and introductory-offer support as conditional because the
  provider and platform determine availability.

### Product import

- Supports preview, filtering, per-Product creation or mapping, per-Product
  Access grants, partial results, and safe replay.
- Includes the connection in the idempotency hash and serializes scoped
  creation. Stale `in_progress` imports expire to replayable partial results
  without duplicating completed Product creation.
- Provides post-import links to Products, Plans, and active-provider setup.

### Product synchronization

- Added durable PostgreSQL synchronization jobs, snapshots, run diagnostics,
  manual retry, and a worker command.
- Uses two-minute leases and verifies job ID, worker ID, attempt fencing token,
  and unexpired lease before any completion or failure mutation.
- Preserves Mosaic-owned Product data and immutable published history.
- Separates synchronized provider-owned metadata from editable Mosaic metadata
  and exposes freshness and stale state.

### Provider Product Mappings

- Maps stable Mosaic Product IDs to exact provider identifiers without display
  name, price, billing-period, or similarity guessing.
- Enforces active mapping integrity per connection and rejects ambiguous
  mappings.
- Scopes provider Entitlement identifiers to the exact connection so a
  connection can be replaced without corrupting the prior mapping history.
- Adds dashboard inspect, replacement, archive, usage-impact, and recovery
  workflows.

### Product readiness

- Checks Product lifecycle, active-provider selection, connection health and
  scope, exact Product mappings, platform coverage, metadata freshness, and
  every Product Access grant's provider Entitlement mapping.
- Separates blockers from warnings and presents human-readable recovery actions
  linked to the relevant Products, Access definitions, mappings, or provider
  connection.

### Custom provider interface

- Added provider-independent interfaces on Flutter, iOS, and Android for
  identity, capabilities, Product loading, localized metadata, purchase,
  restore, active Access lookup, and bounded safe diagnostics.
- Requires the installed adapter's provider ID, Mosaic adapter version, and
  complete capability tuples to match the verified sidecar before activating
  mappings. The RevenueCat adapter version is `1.0.0`; RevenueCat dependency
  versions are not used as adapter versions.
- SDK-only custom providers require neither RevenueCat nor a server credential
  and consume the same immutable Commerce Configuration sidecar.

### Flutter

- Added the optional `mosaic_revenuecat` package using host-owned RevenueCat
  initialization.
- Loads exact mapped Products, normalizes purchase/cancel/pending/restore/access
  outcomes, and attaches correlated safe diagnostics to failures.
- Treats an empty active-entitlement result during already-purchased recovery as
  `nothingToRestore`, not successful restoration.
- Updated the example to select RevenueCat when host configuration is supplied
  and otherwise use an app-owned custom provider without changing the Paywall.

### iOS

- Added the optional `MosaicRevenueCat` Swift package with host-owned
  `Purchases` initialization.
- Loads the release-associated Commerce sidecar, installs exact mappings, and
  normalizes localized Products, purchases, cancellation, restore, and active
  Entitlements.
- Updated the example Xcode project to resolve the optional adapter and fall
  back to its custom provider when no public SDK key is supplied.

### Android

- Added the optional `:mosaic-revenuecat` module with host-owned RevenueCat
  initialization.
- The core custom-provider boundary now exposes identity, truthful
  capabilities, bounded diagnostics, exact mapped Product loading, purchase,
  restore, and Access lookup.
- Updated the example to configure RevenueCat from host-supplied public
  configuration or use the custom provider with the same Paywall document.

### Studio integration

- Keeps local-only Studio usable without authentication, a Provider Connection,
  or RevenueCat.
- Shows authoritative active-provider context, exact scoped mappings,
  synchronized provider-owned metadata and freshness, runtime localized-metadata
  behavior, fallback mock metadata, readiness, and diagnostic links.
- Does not place RevenueCat identifiers in the Paywall document.

### Publishing validation

- Extends Phase 3 publishing readiness with active-provider, connection,
  Product-mapping, platform, metadata-freshness, and exact all-grant Access
  coverage.
- Produces an immutable, credential-free Commerce Configuration v1 sidecar
  associated with the accepted Configuration Release.
- Rejects publication and sidecar construction when any Product grant lacks an
  unambiguous mapping for the exact active connection.

### Migrations

- Added Goose migration `00007_provider_operations.sql` for Provider
  Connections, encrypted credentials, explicit assignments, catalog snapshots,
  Product and Access mappings, imports, synchronization jobs, runs, and
  associated isolation and uniqueness constraints.
- PostgreSQL remains mandatory at runtime; no production in-memory repository
  was introduced.

### OpenAPI

- Documented all Provider Connection, assignment, catalog, import,
  synchronization, mapping, readiness, impact, and Commerce sidecar resources.
- Regenerated the accepted dashboard REST client from the OpenAPI source.

### Observability

- Added spans and safe structured context for connection operations, provider
  HTTP calls, rate limits, timeouts, import, synchronization, assignment,
  readiness, and publishing.
- Logs identifiers and correlation data without authorization headers,
  credentials, or raw provider payloads.

## Product Review

- Products remain stable Project-scoped purchase references. Access definitions
  and Product grants remain separate.
- RevenueCat or the app-owned custom provider remains authoritative for active
  customer Access. Mosaic stores mappings, not authoritative customer state.
- RevenueCat Product, Package, Offering, and Entitlement identifiers remain
  inside connection, mapping, and adapter boundaries.
- Direct StoreKit 2 and Google Play Billing remain Gate 4B.
- Receipt validation, transaction validation, reconciliation, and Mosaic-owned
  subscription state remain Phase 9 or later.
- The initial product review rejected the candidate because the iOS and Android
  examples were mock-only, capabilities were overstated, Android's custom
  provider surface was incomplete, diagnostics were not fully observable, and
  the Phase 3 owner decision was not consolidated. Each code or governance
  blocker was remediated in the final fix pass.
- Design-Partner Alpha is credible at the implementation level, but onboarding a
  partner must include the tracked live sandbox demonstration below.
- Owner decisions: use least-privilege RevenueCat v2 secret keys and ADR-0019
  encryption; continue on the current branch and directory; do not merge, tag,
  or begin Gate 4B automatically.

## UX Review

- Connection setup now explains the RevenueCat Project ID, least-privilege
  secret creation, required scope, one-time handling, and first-test recovery.
- Import assigns Access per Product and offers direct continuation to Products,
  Plans, and active-provider setup.
- Mapping replacement and archive are available with Product-usage review and
  immutable-history explanations.
- Readiness codes are translated into task language and link to specific
  recovery surfaces.
- Synchronization distinguishes live, synchronized, stale, simulated, and mock
  metadata and provides retry or connection recovery.
- Studio uses the authoritative active-provider assignment rather than inferring
  a provider from the first mapping.
- Revocation lists affected Products and warns about Paywalls, Placements, and
  active assignments before confirmation.
- Blocked actions have a next step; hidden incompatible connections are
  explained and linked to recovery.
- RevenueCat Package and Offering terms remain behind advanced mapping details.
- Tracked polish: continue replacing remaining user-facing “Entitlement” labels
  with “Access,” preserve more context in Product-replacement navigation, add
  permission-aware hiding rather than late authorization errors, and optionally
  add Plan membership directly to the import wizard.

## Engineering Review

- Persistence uses PostgreSQL, `pgxpool`, Goose, foreign keys, checks,
  connection-scoped uniqueness, and explicit transaction boundaries.
- AES-GCM credentials are never returned after acceptance, and all provider and
  SDK diagnostic surfaces are secret-free.
- Project, Environment, Application, platform, connection mode, and tenant
  isolation are enforced at the service and persistence boundaries.
- Imports are idempotent and safely recover stale work; synchronization is
  durable, bounded, and fenced against stale workers.
- Exact mappings and every Access grant are validated for readiness,
  publication, and Commerce sidecar generation.
- RevenueCat is optional on every SDK. Core SDKs and app-owned custom providers
  contain no RevenueCat dependency.
- Host applications own RevenueCat initialization and customer identity; Mosaic
  adapters do not create a conflicting instance.
- Purchase cancellation, pending/deferred where supplied, already-entitled,
  unavailable, and failure states remain distinct. Restore failure cannot become
  an empty success. Access lookup failure becomes unknown, unavailable, or
  failed, never inactive.
- All SDKs require exact adapter-owned runtime capability declarations. Flutter
  and Android reject a Commerce `304` unless it repeats the exact retained ETag
  and Configuration Release ID; iOS applies the same rule.
- No direct StoreKit 2, Google Play Billing, receipt validation, Mosaic Billing,
  or authoritative customer Access store was added.
- The final targeted quality verification returned **Accept** after confirming
  cross-SDK adapter identity/capability parity, complete iOS failure
  diagnostics, and strict Flutter/Android `304` validation.

### Validation evidence

- Protocol: `npm run check` passed all 58 tests.
- Backend: focused provider, cloud-workspace, hosted-publishing, config,
  persistence, API, and worker tests passed; all-package compilation passed;
  `go vet ./...`, `docker compose config -q`, and `git diff --check` passed.
- The central full Go run passed every package reached, then the RevenueCat
  package could not start its `httptest` listener because this managed sandbox
  forbids local port binding. This is an environmental unavailability, not a
  test assertion failure.
- Dashboard: formatting, lint, type checking, 391 Vitest tests, relay smoke
  tests, and production build passed. The final context fix additionally passed
  its seven focused workflow tests, type checking, and lint.
- iOS: the optional RevenueCat example resolved `purchases-ios 5.81.2` and built
  successfully for a generic iOS Simulator after the final capability-parity
  remediation.
- Before the narrow final diagnostic remediations, Flutter core and adapter tests
  and Android core/adapter unit, assemble, and lint checks passed. Post-fix
  reruns were unavailable because Flutter and Gradle cache locks live outside
  the managed workspace and the session's escalation quota was exhausted.
- `staticcheck`, live PostgreSQL risk integration, and rebuilt Docker images were
  unavailable in the final environment. `go vet`, compile coverage, focused
  repository tests, Compose configuration, and the earlier PostgreSQL-backed
  Phase 4A suite provide the available evidence.

### Known defects

No confirmed code blocker remains after the final remediation pass. The
environmental demonstrations and reruns listed under tracked follow-ups remain
open evidence items.

## Security Review

- Provider credentials are encrypted at rest with authenticated AES-256-GCM.
- API responses, generated clients, logs, spans, audit metadata, diagnostics,
  and Commerce sidecars redact or omit credentials.
- Server-side RevenueCat secrets never reach Flutter, iOS, Android, or published
  configuration. Host applications supply only RevenueCat's platform public SDK
  key directly to the RevenueCat SDK.
- Sandbox and production connections and assignments cannot be mixed silently.
- Cross-tenant connection, import, mapping, synchronization, assignment, and
  publishing operations are rejected.
- Provider requests use bounded request and aggregate operation timeouts,
  bounded retries, pagination caps, `Retry-After` caps, and caller cancellation.
- Provider errors expose stable safe codes and correlation IDs, not raw response
  bodies or secret material.

## Demo Review

- Complete demonstration succeeds: **not executed; unavailable environmental
  check**. No RevenueCat test Project secret, Test Store accounts, or configured
  platform sandbox identities were available.
- One-minute demonstration succeeds: **not executed for the same environmental
  reason**.
- Deterministic evidence: all three examples now contain real optional
  RevenueCat wiring and a custom-provider fallback; iOS resolves and builds the
  adapter; contract, backend, dashboard, and adapter tests cover exact mapping,
  localized metadata transport, purchase cancellation, restore, provider-owned
  Access results, connection invalidation, and safe recovery.
- Design-Partner Alpha readiness: **credible for a supervised alpha after the
  live sandbox checklist is executed with partner credentials and test
  accounts**.

## Tracked Follow-ups

1. Execute and record the complete and one-minute RevenueCat sandbox
   demonstrations on Flutter, iOS, and Android, including purchase, cancel,
   restore, active Access, invalidation/reconnect, and switching to a custom
   provider without changing the Paywall document.
2. Rerun the final Flutter and Android suites in an environment with writable
   shared SDK caches.
3. Run the listener-based full Go suite, live PostgreSQL risk integration, and
   API/worker Docker image rebuild where local listeners and Docker access are
   available.
4. Complete the non-blocking UX terminology, permission-state, import-to-Plan,
   and context-preserving replacement polish.

## Decision

**Gate 4A accepted with tracked follow-ups; proceed to Gate 4B only after an
explicit owner instruction.**

This review stops at Gate 4A. It does not merge, tag, or begin Gate 4B.
