# Phase 3B Hosted Publishing and Configuration Delivery

**Status:** Final review complete; Gate 3B rejected pending fixes  
**Date:** 2026-07-22  
**Branch:** `phase/3b-hosted-publishing`  
**Base commit:** `9882e7689b817a2441e9c2b1db6b6ddd8bfb2ef0`

## Purpose

Phase 3B proves Mosaic's hosted configuration promise:

> Change a paywall, click Publish, and update native applications without releasing a new app version.

The private alpha covers hosted Drafts, immutable Paywall Versions, basic Placements, immutable
Configuration Releases, rollback, SDK delivery, caching, and bundled fallback. Commerce remains
mock-only. Provider synchronization, authoritative customer Entitlement state, targeting,
analytics, and experiments remain later phases.

This document began as the Stage 1 integration plan and now records the implemented Phase 3B
candidate. The product owner explicitly directed work to proceed despite the failed preflight.
Implementation has addressed the technical blockers found during the first Gate 3B review; formal
acceptance of inherited Phase 2.5 and Gate 3A evidence remains an owner review dependency.

## Baseline and decision gates

The following are tracked baseline and governance debt:

- the consolidated Phase 2.5 review is absent;
- the historical Gate 3A report remains rejected, although Phase 3B now implements opaque
  PostgreSQL-backed browser sessions and an authenticated hosted workflow;
- Phase 2.5 and Gate 3A have not been accepted on one revalidated baseline;
- the worktree contains pre-existing tracked and untracked changes;
- Protocol `0.1` runtime support remains retired by ADR-0016; stale test references were removed;
  and
- the repository-wide Phase 3B validation and final quality review provide the current executable
  evidence.

Gate 3B must not be declared accepted until the final review report records the remaining owner
decisions and executable evidence accurately.

The following decisions block affected Stage 2 work packages:

| Decision | Recommendation | Blocked work |
| --- | --- | --- |
| Paywall Protocol authority | Uphold accepted ADR-0016 and make Phase 3B `0.2`-only. Restoring `0.1` requires an ADR superseding ADR-0016 and full cross-platform restoration. | Delivery fixtures, SDK compatibility claims |
| Browser authentication/session | Approve a hosted identity and session adapter while retaining the existing `Principal` service boundary. | Authenticated hosted Studio demo |
| Object-storage client | Approve `github.com/minio/minio-go/v7` behind a Mosaic-owned port and MinIO for local Compose. | Asset implementation |
| Worker packaging | Keep publishing synchronous; add a worker command in the API Go module only for retryable asset cleanup if needed. | Cleanup worker only |
| Hosted conflict recovery storage | Permit an encrypted/opaque bounded local recovery record with logout clearing and documented TTL, or require explicit export only. | Reload-safe conflict recovery |

Until the Protocol decision is approved, this plan describes the repository-consistent `0.2`-only
path and labels it a recommendation rather than an accepted contract.

## Scope

### Included

- account-free local Studio preservation;
- optional Project-connected hosted mode;
- hosted Paywalls and environment-scoped Drafts;
- optimistic Draft concurrency and revision recovery;
- immutable Paywall Versions;
- project-scoped Assets through approved S3-compatible storage;
- project-scoped Placements with one environment binding;
- atomic, idempotent publishing;
- immutable Configuration Releases and release history;
- rollback by creating a new Release;
- public environment SDK-key delivery;
- Configuration Delivery Contract v1;
- ETag, conditional requests, and standard gzip compression;
- Flutter, iOS, and Android remote refresh, atomic cache, Placement resolution, and fallback;
- environment isolation, authorization, audit, and observability.

### Explicit exclusions

- RevenueCat, StoreKit 2, Google Play Billing, or provider synchronization;
- receipt validation or authoritative subscription/Entitlement state;
- live Product readiness claims;
- targeting, percentages, countries, locales, app versions, user attributes, or rules;
- analytics ingestion, experiments, AI, collaboration, Protocol `0.3`, or new components;
- custom CDN integrations or public-alpha self-hosting hardening.

## Terminology and domain model

- **Paywall:** stable Project-scoped logical identity.
- **Draft:** mutable, Environment-scoped hosted working copy with a monotonic server revision.
- **Paywall Version:** immutable snapshot created from one valid Draft revision.
- **Placement:** stable Project-scoped application intent name.
- **Placement binding:** mutable authoring intent from one Placement and Environment to one Paywall.
- **Configuration Release:** immutable, complete Environment snapshot delivered to SDKs.
- **Current Release:** the single atomic pointer for an Environment.
- **Asset:** Project-scoped stored media with stable Mosaic identity and immutable published bytes.

The authoring binding targets a logical Paywall. During publication it resolves to the newly
created or latest eligible Paywall Version. The SDK delivery snapshot is always:

```text
Placement key -> Paywall Version ID
```

This permits binding before the first publication while avoiding a future SDK API migration.

## Database model and migration sequence

Add one versioned Goose SQL migration after the accepted Phase 3A migrations. Split it only if a
safe online backfill or later constraint genuinely requires a second migration.

### Tables

- `paywalls`: `id`, `project_id`, scoped `key`, name, lifecycle, archive and audit timestamps.
- `paywall_drafts`: Paywall, Environment, current revision, source Version, current protocol,
  validation summary, actors, timestamps; unique active Draft policy defined explicitly.
- `paywall_draft_revisions`: immutable `(draft_id, revision)` document snapshot, document hash,
  validation summary, actor, client mutation ID, timestamp.
- `paywall_versions`: immutable Paywall/Environment/version snapshot, source Draft/revision,
  protocol, document, document hash, validation metadata, creator, timestamp.
- `paywall_version_products`: normalized same-Project Product references.
- `paywall_version_assets`: normalized same-Project Asset references.
- `placements`: stable Project-scoped key, name, description, lifecycle.
- `environment_placement_bindings`: one `(environment_id, placement_id)` row targeting one Paywall.
- `configuration_releases`: Environment release number, contract version, canonical payload,
  content hash, source and rollback provenance, actor, publication timestamp.
- `configuration_release_placements`: immutable Placement-to-Version snapshot.
- `configuration_release_products` and `configuration_release_assets`: included immutable references.
- `environment_release_state`: one Environment row with current Release and last release number.
- `publication_requests`: Environment, operation, idempotency-key hash, request hash, result Release.
- `assets`: Project, immutable storage key, original filename, media type, length, SHA-256,
  lifecycle, creator/archive timestamps.

### Constraints and indexes

- Paywall and Placement keys are unique within Project.
- release numbers are unique and monotonic within Environment;
- Draft revisions are unique and monotonic within Draft;
- all Environment resources use composite same-Project foreign keys;
- version/release reference tables use restrictive deletion;
- published Versions and Releases have no update path;
- one current-release state row exists per Environment;
- idempotency keys are unique by Environment and operation;
- indexes follow list/detail, Draft revision, Environment history, binding, usage, and key-auth access
  paths only.

The migration must apply to an empty database and the accepted Gate 3A schema. Normal API startup
must not run migrations.

## REST resources

Dashboard resources remain under `/v1` and use Mosaic success/error envelopes:

```text
GET|POST /v1/projects/{projectId}/paywalls
GET|PATCH /v1/projects/{projectId}/paywalls/{paywallId}
POST /v1/projects/{projectId}/paywalls/{paywallId}/drafts
GET|PUT /v1/projects/{projectId}/paywalls/{paywallId}/drafts/{draftId}
POST /v1/projects/{projectId}/paywalls/{paywallId}/drafts/{draftId}/validate
GET /v1/projects/{projectId}/paywalls/{paywallId}/versions
GET /v1/projects/{projectId}/paywalls/{paywallId}/versions/{versionId}
POST /v1/projects/{projectId}/paywalls/{paywallId}/versions/{versionId}/drafts
GET|POST /v1/projects/{projectId}/assets
GET|DELETE /v1/projects/{projectId}/assets/{assetId}
GET /v1/projects/{projectId}/assets/{assetId}/usage
GET|POST /v1/projects/{projectId}/placements
GET|PATCH /v1/projects/{projectId}/placements/{placementId}
PUT /v1/projects/{projectId}/environments/{environmentId}/placements/{placementId}/binding
POST /v1/projects/{projectId}/environments/{environmentId}/publish
GET /v1/projects/{projectId}/environments/{environmentId}/releases
POST /v1/projects/{projectId}/environments/{environmentId}/releases/{releaseId}/rollback
```

The public SDK resource is:

```text
GET /v1/sdk/configuration
```

The Environment is derived only from the verified public SDK key. It is never accepted from a path,
query, or client-supplied Environment header.

OpenAPI remains authored in `docs/backend/openapi.yaml`; generated dashboard code is regenerated,
never edited manually.

## Draft concurrency and conflict semantics

- Draft responses include a strong revision validator such as `"draft-<id>-r<revision>"`.
- Updates require `If-Match`; omission returns `428 precondition_required`.
- A stale validator returns `412 draft_revision_conflict`.
- The safe error `details` contains current revision, ETag, updated time, and actor ID when allowed.
- The response never echoes either complete document.
- A client mutation/idempotency key makes a retried identical update return its original result.
- Reusing a key with another request hash returns `409 idempotency_conflict`.

Within one transaction the service locks the Draft, replays idempotency where applicable, verifies
the expected revision, appends the immutable revision, advances the current pointer, and audits.
No last-write-wins path exists.

## Publishing and idempotency

`Idempotency-Key` is mandatory for publish and rollback. The key is stored only as a digest with a
request hash. An identical retry returns the original Release; reuse for another request is a
conflict.

One PostgreSQL transaction must:

1. authorize the actor;
2. claim or replay the idempotency record;
3. lock the Environment release state and Draft;
4. verify the expected Draft revision;
5. validate the accepted Paywall schema and capabilities;
6. validate same-Project active Products and ready Assets;
7. block missing/cross-Project/archived Products and warn about missing provider mappings;
8. validate Placement authoring bindings;
9. create the immutable Paywall Version and normalized references;
10. construct and validate a complete Configuration Delivery v1 payload;
11. canonically serialize and hash it;
12. allocate the next Environment release number;
13. insert the immutable Release and reference snapshots;
14. atomically update the current Release pointer;
15. write audit events and complete idempotency; and
16. commit.

Publishing performs no object-store mutation. Only previously verified `ready` Assets may publish.

## Rollback transaction

Rollback authorizes, claims idempotency, locks the Environment release state, verifies the selected
historical Release belongs to the Environment, copies its complete snapshot into a new Release with
a new number, records current-source and rollback-source IDs, updates the current pointer, audits,
and commits. It never mutates or reactivates history.

## Product validation

Products remain Project-scoped in Phase 3A. Unless an Environment-specific Catalog decision is
approved later, Phase 3B Environment validity means:

- the Product belongs to the Environment's Project;
- it is not archived; and
- its stable Mosaic ID matches the document reference.

Absent live provider mappings are nonblocking warnings. Publishing with mock metadata requires an
explicit private-alpha acknowledgement and must never claim live purchasing readiness.

## Asset storage and lifecycle

Asset implementation is paused pending the storage-client decision. The proposed design is:

- Mosaic-owned `ObjectStore` port;
- MinIO Go v7 adapter for any S3-compatible service;
- private bucket and durable MinIO volume in local Compose;
- content-addressed immutable keys such as
  `projects/<project>/assets/<asset>/<sha256>`;
- bounded streaming upload, media sniffing, size validation, and SHA-256 hashing;
- lifecycle `pending -> ready|failed -> archived -> deletion_pending|deleted`;
- hard deletion only when no Draft/Version/Release reference exists;
- archived published bytes retained indefinitely unless every historical reference is removed by an
  explicitly approved retention policy.

Protocol `0.2` remains unchanged. Studio binds a stable Mosaic Asset ID and stores usage metadata
outside the document. The document's existing remote URL points to a Mosaic immutable asset URL
containing the Asset ID and content digest, never a bucket key or expiring signed URL. Published
Versions preserve that immutable URL. Bundled assets remain bundled and require no hosted record.

Initially the API proxies immutable Asset responses from the private bucket. Responses use
`public, max-age=31536000, immutable`. A future CDN may front the same stable URL without changing
the delivery contract.

## Configuration Delivery Contract v1

Define a strict JSON Schema 2020-12 contract under a separate delivery namespace. It wraps accepted
Paywall documents without altering them.

Required envelope fields:

```text
configurationDeliveryVersion = "1"
release.id
release.number
release.environment.id
release.environment.key
release.publishedAt
release.contentDigest
release.compatibility.paywallProtocols[]
release.compatibility.acceptance = "atomic"
release.placements[]
release.paywallVersions[]
release.productReferences[]
release.assetReferences[]
```

Each Placement binds to one Paywall Version. Each Version contains its immutable document,
protocol version, document digest, exact Product IDs, and document-Asset-to-hosted-Asset bindings.
Product records contain only stable Mosaic ID, type, and fallback display metadata. Asset records
contain stable ID, kind, media type, byte length, digest, and immutable HTTPS URL.

The envelope excludes secrets, provider credentials/IDs, audit actors, Draft data, validation
internals, targeting, analytics, and authoritative customer Entitlement state.

Unknown fields, unknown delivery versions, unsupported Paywall protocols/capabilities, duplicate or
dangling IDs, malformed digests, inconsistent documents, missing referenced Products/Assets, or any
invalid included Paywall reject the entire candidate. Partial acceptance is forbidden.

## SDK capability request metadata

The semantic request contains:

- platform: `flutter`, `ios`, or `android`;
- SDK version;
- supported Configuration Delivery versions;
- supported Paywall Protocol versions and exact capability pairs; and
- optional application version.

Freeze bounded HTTP header names in OpenAPI before SDK implementation. Public SDK-key auth remains
transport-only and never enters the cached envelope or diagnostics.

## SDK delivery HTTP behavior

- authenticate only an active `public_sdk` key using prefix lookup, SHA-256 digest, and constant-time
  comparison;
- never return Drafts, unpublished Versions, storage keys, or credentials;
- persist canonical Release bytes/hash at publish time rather than rebuilding on every request;
- return `304` when `If-None-Match` matches the selected representation;
- use `private, max-age=60, stale-if-error=86400` for configuration;
- use standard gzip above a documented threshold;
- use representation-specific strong ETags for identity and gzip bytes;
- include the required `Vary` headers;
- apply bounded per-key/IP rate limits and document the single-instance private-alpha limitation;
- record key last-used time without placing it on the response critical path where possible.

## SDK refresh and cache state machine

All SDKs implement:

```text
valid 200 candidate
  -> decode complete delivery envelope
  -> decode every included Paywall
  -> validate all references and capabilities
  -> atomically persist bytes + ETag as one record
  -> swap current in-memory Release

304 -> preserve accepted Release and cache
failure or unsupported candidate -> preserve accepted Release
no accepted Release -> bundled Delivery v1 fallback
no valid bundle -> explicit configuration unavailable
```

Configuration is cache-first. Refresh is manual or freshness-gated and concurrent refreshes
coalesce. Presentation never fetches. Cache namespaces include normalized endpoint and a safe digest
of the public key; raw keys never become filenames. Cache reads revalidate the complete record.

- Flutter uses asynchronous file I/O and moves large decode work off the UI isolate.
- iOS uses actors, Swift concurrency, URLSession, and atomic same-directory replacement.
- Android uses coroutines, OkHttp, application-private storage, same-directory atomic replacement,
  and no network/disk work on the main thread.

Local Preview remains a separate development transport and state machine.

## Hosted Studio workflow

Studio has two explicit modes using one editor architecture:

- **Local draft:** saved on this device, no account required, local mock Products/bundled Assets,
  Import/Export, no Publish.
- **Project draft:** named Project and Environment, hosted autosave, Catalog/Asset/Placement binding,
  Publish and history.

Import copies a local document into a new hosted Draft and never deletes or converts the local
source. Workspace preferences and mock outcomes never enter the hosted document.

Hosted autosave states are `unsaved`, `saving`, `saved`, `offline`, `failed`, and `conflict`.
TanStack Query owns the server Draft/revision; the editor store owns the actively edited document,
selection, and undo history. A stale save pauses autosave and preserves local work. Recovery offers
inspect latest, export/copy local, intentionally retry under the accepted policy, reload after
preserving a copy, or continue offline.

The Publish sheet shows fixed Environment, Draft revision, protocol, validation, Products, Assets,
Placements, compatibility, blockers, warnings, and direct recovery actions. Editing a published
Version creates a new Draft and opens it. Publish History is Environment-scoped. Rollback copy says
explicitly that it creates a new Release.

Hosted navigation adds Paywalls, Placements, Assets, and Publish History while retaining Catalog and
Settings. Environment remains URL-owned, not a global store. Named scope switchers must replace raw
IDs before production publishing is enabled.

## Security boundaries

- service-layer authorization remains authoritative;
- public SDK keys are Environment-scoped and cannot access dashboard resources;
- browser sessions, public keys, and secret server keys remain separate principals;
- no credential, raw authorization, document body, provider credential, object key, or internal
  error is logged;
- all Project/Environment joins are protected by composite foreign keys and service checks;
- uploads are bounded and validated before becoming ready;
- safe immutable HTTPS URLs contain no embedded credentials;
- error/conflict metadata is explicitly allowlisted;
- configuration delivery is rate limited and cache-safe.

## Observability

Add spans for `draft.update`, `draft.validate`, `paywall.publish`, `configuration.build`,
`release.rollback`, `configuration.deliver`, `asset.upload`, and storage operations.

Use bounded metrics for Draft conflicts, validation failures, publish/rollback outcomes and latency,
delivery `200`/`304`/errors, payload sizes, storage failures, and cleanup backlog. Resource IDs belong
in traces/logs, not metric labels.

Structured logs and audit events include Organization, Project, Environment, Paywall, Draft
revision, Version, Release, Placement, Asset, actor, request, and trace IDs where applicable.

## Minimum sufficient tests

### Backend

- migration applies to Gate 3A and an empty database;
- stale Draft update cannot overwrite a newer revision;
- publish transaction and idempotent retry expose one complete Release;
- immutable Version/Release have no mutation path;
- rollback creates a new Release;
- Project/Environment/public-key isolation is enforced;
- unpublished data is never delivered;
- matching ETag returns `304`;
- referenced Asset bytes remain available;
- Product blockers and provider warnings differ correctly.

Use unit tests for isolated rules, PostgreSQL integration for constraints/transactions, and HTTP
tests for authentication/ETag. Do not duplicate each scenario at every layer.

### Dashboard

- local Studio remains account-free;
- stale hosted autosave preserves local work and pauses writes;
- publish blockers prevent submission and recovery links navigate correctly;
- Edit on a published Version creates a Draft;
- rollback copy and behavior create a new Release;
- Environment-scoped query keys cannot cross bindings/history;
- Asset selection persists stable identity only after the mapping contract is frozen.

### Each SDK

- accept a valid Delivery fixture and resolve its Placement;
- reject malformed/unsupported candidates atomically;
- `304` preserves cache;
- failed refresh preserves last-known-valid;
- bundled fallback works without cache;
- cache survives SDK reconstruction;
- concurrent refresh cannot corrupt or stale-overwrite state.

Reuse existing renderer, accessibility, localization, RTL, and interaction coverage. Delivery does
not justify new visual snapshot suites.

## Validation commands

After each owned package, run its established format, lint/static, type, test, generation, and build
checks. Full Gate validation includes Go format/vet/tests, real PostgreSQL migration/integration,
OpenAPI generation validation, dashboard format/lint/type/tests/build, protocol validation/checks,
Flutter analyze/tests, Swift tests/Xcode example build, Android unit/instrumented checks where
available, `git diff --check`, and the documented full/one-minute demo. Skips are evidence only when
their unavailable dependency and risk are recorded.

## Private-alpha demo

```text
Open local Studio without an account
-> create or import a Protocol 0.2 document
-> connect a Project and Environment
-> create hosted Draft
-> bind active Products
-> upload one approved Asset
-> create and bind one Placement
-> publish Release 1 to Staging
-> fetch/cache/render in Flutter, iOS, and Android
-> edit headline, creating a new Draft
-> publish Release 2
-> fetch again and then receive 304
-> stop API and render from cache
-> restore API and roll back, creating Release 3
-> Edit the published Paywall and observe a new Draft
```

Commerce is mock-only throughout.

## Stage ownership

- Protocol owns only delivery schemas, fixtures, compatibility documentation, and changelog.
- Backend owns API/worker, migrations, OpenAPI source, storage adapter/Compose, tests, and backend docs.
- Dashboard owns hosted management, hosted Studio integration, routes, queries/mutations, and tests.
- Each SDK owns only its SDK/example and consumes canonical delivery fixtures.
- Product, UX, and quality reviews remain read-only.

No agent may modify Paywall Protocol `0.2` semantics to simplify its implementation.

## Stage 1 inspection limitations

The required Android Stage 1B specialist could not be spawned during the initial inspection because
the collaboration thread limit was exhausted. Android implementation and remediation were later
completed by the Android specialist, including hosted refresh, endpoint-and-key namespaced cache,
strong ETag enforcement, validate/persist/swap ordering, Placement resolution, stale and
cross-Environment rejection, structured diagnostics, and exact capability request metadata.
