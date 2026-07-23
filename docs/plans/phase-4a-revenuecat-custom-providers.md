# Phase 4A Plan: RevenueCat and Custom Providers

## Status

**Stage 1 accepted for implementation; RevenueCat credential authorization remains an owner gate.**

The product owner explicitly authorized Phase 4A inspection and planning on 2026-07-23 despite the
inherited Phase 2.5 and Phase 3 review records. This authorization does not silently repair or
reclassify the known Phase 3 defects. Cross-platform canonical JSON digest equivalence, committed
Draft-create/clone idempotency replay, and the missing Phase 3 demonstrations remain outside this
work package.

The product owner approved the recommended encryption design on 2026-07-23. ADR-0019 freezes the
versioned AES-256-GCM envelope, operator keyring, rotation, and failure behavior. Provider
credentials may not be persisted until the separate RevenueCat OAuth-versus-v2-secret-key decision
is approved.

## Baseline and isolation

- Base commit: `8fd78c9f58a46343b743c64b4abade58dea8cd12`
- Branch: `phase/4a-revenuecat-custom-providers`
- Worktree: `/Users/muhideenmujeeb/Projects/mosaic-phase-4a`
- Phase 3 runtime: PostgreSQL through `pgxpool`; explicit Goose migrations; no production
  in-memory repository
- Paywall authority: Protocol `0.2` RC4 only, per ADR-0016
- Configuration authority: Configuration Delivery Contract v1
- Phase 3 Provider Product Mappings: placeholder-only and not production commerce mappings

The original Phase 3 worktree's uncommitted review edit was not copied into this worktree.

## Official RevenueCat sources and candidate versions

Implementation must continue using official RevenueCat documentation and repositories only:

- [API v2](https://www.revenuecat.com/docs/api-v2)
- [API keys and authentication](https://www.revenuecat.com/docs/projects/authentication)
- [SDK configuration](https://www.revenuecat.com/docs/getting-started/configuring-sdk)
- [Displaying Products](https://www.revenuecat.com/docs/getting-started/displaying-products)
- [Making purchases](https://www.revenuecat.com/docs/getting-started/making-purchases)
- [Restoring purchases](https://www.revenuecat.com/docs/getting-started/restoring-purchases)
- [CustomerInfo](https://www.revenuecat.com/docs/customers/customer-info)
- [Flutter installation](https://www.revenuecat.com/docs/getting-started/installation/flutter)
- [Apple installation](https://www.revenuecat.com/docs/getting-started/installation/ios)
- [Android installation](https://www.revenuecat.com/docs/getting-started/installation/android)

Versions verified on 2026-07-23:

- Flutter adapter candidate: `purchases_flutter 10.4.2`
- Apple adapter candidate: `purchases-ios 5.81.2`
- Android adapter candidate: `purchases-android 10.14.1`
- RevenueCat REST API: v2, `https://api.revenuecat.com/v2`

The adapter packages pin these candidates independently of Mosaic Core. Versions must be rechecked
before dependency resolution and recorded in the Gate review.

## Product and authority boundaries

```text
Plan
└── Mosaic Products
    ├── Provider Product Mappings
    └── Entitlement Grants

Paywall
└── stable Mosaic Product IDs

Placement
└── Paywall

Purchase
└── Mosaic Product resolved through one explicit provider mapping

Active customer Entitlements
└── provider-owned until Mosaic Billing
```

- A Mosaic Product is a stable, Project-scoped sellable identity.
- A Plan is optional Mosaic-owned grouping and is not sent to a provider.
- An Entitlement is a Mosaic-owned access definition and grant target.
- RevenueCat or an app-owned custom provider remains authoritative for active customer access.
- A provider lookup failure produces `unknown`, `providerUnavailable`, or `failed`; it never becomes
  an authoritative inactive result.
- Packages and Offerings are optional RevenueCat adapter metadata, not top-level Mosaic navigation.
- Paywall documents remain provider-independent and continue storing stable Mosaic Product IDs.
- Local-only Studio continues to work without authentication, a backend, RevenueCat, or a Provider
  Connection.

## Terminology

| Term | Meaning |
|---|---|
| Commerce provider | A runtime implementation that loads and purchases Products |
| Provider Connection | Server-side relationship used to inspect or synchronize a provider |
| Provider Product Mapping | Scoped verified link from a Mosaic Product to a provider object |
| Active Provider | Explicit connection/provider selected for Environment × Application × platform |
| Provider snapshot | Stored, read-only provider metadata with freshness |
| Access | User-facing name for Mosaic Entitlement definitions |
| Active Entitlement result | Provider-owned runtime lookup normalized by Mosaic |
| Simulated preview | Local/mock commerce state, never presented as synchronized or live |

## Provider capabilities

Commerce Provider Contract v1 defines closed capabilities with
`supported | unsupported | conditional` states:

- Product loading
- subscriptions
- one-time non-consumables
- trials
- introductory offers
- promotional offers
- restore
- active Entitlement lookup
- pending purchases
- deferred purchases
- server-confirmed transactions
- Product synchronization
- provider diagnostics

Unsupported behavior is not a generic failure. RevenueCat's current Flutter, Apple, and Android
purchase APIs do not provide one reliable, distinct deferred outcome for ordinary purchases.
Adapters therefore advertise pending support and deferred as unsupported unless a future typed SDK
surface proves otherwise.

## Commerce Provider Contract v1

Create a separate canonical JSON Schema contract under
`protocol/schema/commerce-provider/v1/`. It is not Paywall Protocol `0.3` and does not modify
Paywall Protocol `0.2`.

The exact contract version is:

```text
commerceProviderContractVersion = "1"
```

It defines:

- provider identity and adapter version
- capabilities
- stable Mosaic Product identity and Product type
- Entitlement keys granted by the Product
- provider binding identity
- resolved localized metadata
- `available | unavailable | unknown` Product availability
- structured billing period
- trial and introductory-offer metadata
- metadata source and `fresh | stale | unknown` freshness
- safe diagnostics, retryability, optional retry-after, and correlation ID
- Product-load requests and results
- purchase requests and outcomes
- restore outcomes
- active Entitlement outcomes

Purchase outcomes:

- `purchased`
- `pending`
- `deferred`
- `cancelled`
- `alreadyEntitled`
- `productUnavailable`
- `providerUnavailable`
- `failed`

Restore outcomes:

- `restored`
- `nothingToRestore`
- `cancelled`
- `providerUnavailable`
- `failed`

Active Entitlement states:

- `available`
- `unknown`
- `providerUnavailable`
- `failed`

Only `available` may contain the active Entitlement key set. An empty set then means the provider
authoritatively reported no active Entitlements. Unsuccessful states cannot contain an empty set
that could be mistaken for inactive access.

Diagnostics never contain raw provider payloads, raw provider messages, stack traces, credentials,
authorization headers, API keys, or app-user identifiers.

## Runtime commerce configuration

Configuration Delivery v1 remains unchanged and continues excluding provider mappings and
credentials.

Add a separate immutable Commerce Configuration v1 SDK resource:

```text
Environment + Application + store platform + Configuration Release
→ active provider identity
→ verified Provider Product Mappings
→ provider capability declaration
→ Entitlement identifier mappings
```

The SDK accepts a Commerce Configuration only when its Environment ID, Application ID, store
platform, Configuration Release ID, and release digest match the accepted Paywall Configuration
Release. A mismatched or ambiguous sidecar fails safely. It is cached atomically with its release
association.

The resource contains no server secret. Host-owned RevenueCat initialization is the default, so
RevenueCat public SDK keys also remain in host application configuration rather than Configuration
Delivery.

SDK-only custom providers may supply the same verified mapping snapshot locally without a backend
Provider Connection.

## Provider Connection model

Provider Connections are Project-scoped and contain:

- stable ID, provider kind, unique name, and lifecycle state
- `sandbox | production` provider mode
- external provider Project/account identifier
- explicit Environment scopes
- explicit Application scopes
- health and capability state
- last successful test and synchronization
- credential metadata only: class, fingerprint, key/envelope version, rotation/revocation time
- safe diagnostics and audit history

Credential values are write-only. They are absent from list/detail responses, logs, diagnostics,
audit metadata, exports, Paywall documents, Commerce Configuration, and SDK configuration.

Custom provider modes:

- `sdkOnly`: no backend secret or Provider Connection required
- `serverConnected`: uses the same credential and isolation boundary as RevenueCat

Gate 4A implements RevenueCat and SDK-only custom providers. A generic server-connected custom
provider system is deferred until a concrete integration requires it.

## Credential classification and encryption decision

RevenueCat values are classified separately:

- `serverSecret`: v2 `sk_` key or OAuth token; server-only and recoverable for outbound calls
- `clientSDKKey`: application-specific public SDK key; usable only in host application setup
- `identifier`: Project, Application, Product, Package, Offering, and Entitlement identifiers

Digest-only storage used for Mosaic API keys and browser sessions cannot support provider calls.
The repository has no accepted reversible secret-encryption design.

### Option A — versioned AES-256-GCM envelope (recommended for Gate 4A)

- An operator-supplied keyring encrypts credentials in the API process.
- Every value uses a random nonce, explicit key ID/version, and authenticated context binding it to
  organization, Project, and Provider Connection.
- PostgreSQL stores ciphertext, nonce, key ID, algorithm version, and credential fingerprint.
- Rotation writes a newly encrypted credential only after provider validation succeeds.
- Old keys remain decrypt-only until all envelopes are rotated.
- Production startup fails when required key material is absent or invalid.
- There is no plaintext development fallback in production code.

Operational consequences:

- self-hosters must back up the keyring separately from PostgreSQL;
- loss of all referenced keys makes provider credentials unrecoverable and requires reconnection;
- multi-instance deployments must receive the same active/decrypt keyring;
- hosted Mosaic may later place the same envelope boundary behind KMS without changing domain data.

The exact keyring serialization and environment-variable contract must be approved in the ADR; it
must not be invented during implementation.

### Option B — KMS/Vault envelope encryption

- Strong centralized rotation and audit controls.
- Adds a cloud-vendor or Vault operational dependency and complicates local/self-hosted setup.
- Rejected as the initial mandatory implementation unless the owner chooses it.

### Option C — external secret-manager references

- PostgreSQL stores only opaque secret references.
- Avoids recoverable credentials in Mosaic's database.
- Requires every deployment to operate a compatible external secret manager and lifecycle API.
- Rejected as the initial mandatory implementation unless the owner chooses it.

### RevenueCat authorization

The smallest design-partner path uses a least-privilege RevenueCat v2 secret key limited to the
required read operations. OAuth is the preferred future hosted third-party authorization path but
adds consent, refresh-token, revocation, and self-hosting complexity not required for the first
alpha.

Option A is accepted in ADR-0019. Owner approval is still required for the direct least-privilege
v2 credential path before RevenueCat credential persistence is implemented.

## Active-provider resolution

`active_provider_assignments` references one specific Provider Connection for each:

```text
Project + Environment + Application + store platform
```

- Application already owns one platform identity; the stored store platform must agree with it.
- The database enforces one assignment per accepted scope.
- Revoked or incompatible connections cannot be assigned.
- A production Environment cannot use a sandbox connection.
- Development and staging may use sandbox; using production credentials outside production
  requires an explicit owner action and warning.
- The runtime never guesses, string-matches, price-matches, or silently falls back.
- Replacing an assignment is an audited migration with an impact preview.

Environment mode becomes explicit data (`development | staging | production`); names and keys are
never interpreted heuristically.

## Provider Product Mappings

Upgrade Phase 3 placeholders additively. A verified mapping includes:

- Mosaic Product ID
- Provider Connection ID
- Environment, Application, and store platform
- opaque provider Product identifier
- optional Package and Offering identifiers
- optional expected store Product identifier
- mapping lifecycle and replacement reference
- availability and synchronization state
- current provider snapshot reference
- safe diagnostics

Mappings cannot cross Projects. The accepted scope has at most one active unambiguous mapping.
Archived Products cannot gain mappings. Replacement preserves immutable Paywall Version and
Configuration Release history; updating active Drafts is explicit.

## RevenueCat import and synchronization

Backend provider ports live in an application-owned module; RevenueCat HTTP code lives behind a
dedicated adapter, never in Chi handlers.

Import:

1. validate the connection;
2. preview paginated provider Products without writes;
3. select Products;
4. map to existing or create stable Mosaic Products;
5. optionally add Plan membership;
6. add explicit Mosaic/RevenueCat Entitlement identifier mappings and grants;
7. commit using `Idempotency-Key` plus request hash;
8. return per-item results and retry only failed items.

Repeated identical imports return the original identities. Reusing the idempotency key with changed
input returns `idempotency_conflict`.

Synchronization updates only provider-owned mappings, snapshots, availability, freshness, and safe
diagnostics. It never overwrites Mosaic Product name/key/description, Plan membership, Entitlement
grants, Paywall documents, immutable Versions, or Configuration Releases.

Use a PostgreSQL-backed job/run model with leases, attempt count, `available_at`, and bounded
concurrency. The worker is `apps/api/cmd/worker` inside the existing Go module and is deployed as a
separate process. Retries reschedule work rather than sleeping while holding a lease.

## Metadata freshness

Every snapshot records provider observation time, synchronization time, source, content digest, and
expiry/stale time.

Initial policy:

- runtime SDKs prefer current live RevenueCat metadata;
- Studio labels synchronized snapshots and never calls them live;
- never-synchronized or unavailable metadata blocks production publication;
- stale metadata warns in development/staging;
- stale metadata blocks production only when the Product cannot be revalidated as available;
- a healthy connection does not imply fresh Product metadata.

The backend remains the authority for freshness state and recovery actions.

## Product readiness and publication

Readiness is calculated for Environment × Application × platform:

- `draft`
- `mockOnly`
- `connected`
- `attentionRequired`
- `unavailable`
- `archived`

It considers Product lifecycle, Entitlement grants, active assignment, connection health and mode,
one unambiguous mapping, application/platform scope, provider availability, and freshness.

The response contains state, blockers, warnings, affected scopes, stable recovery codes, resource
IDs, and recovery actions.

Production publishing validates every targeted Application/platform and blocks:

- missing/archived/cross-Project Product
- missing Entitlement grant
- no active provider
- revoked/unhealthy or mode-incompatible connection
- missing or ambiguous mapping
- unavailable Product
- never-synchronized provider metadata
- mapping/release scope mismatch

Warnings and blockers remain separate. Missing provider readiness is configuration unavailable, not
an authoritative transaction failure.

## SDK architecture

Each core SDK owns only provider-neutral commerce interfaces, custom-provider support, mocks,
Commerce Configuration decoding/caching, and renderer integration.

RevenueCat remains optional:

```text
Mosaic Core
├── Custom Provider Interface
└── optional RevenueCat adapter package/module
```

- Flutter: nested `mosaic_revenuecat` package using `purchases_flutter 10.4.2`; adapter-only
  Dart/Flutter floors may be higher than core.
- iOS: separate nested Swift package `MosaicRevenueCat` using `purchases-ios 5.81.2`.
- Android: separate `:mosaic-revenuecat` module using `purchases-android 10.14.1`.

Host-owned RevenueCat initialization is the default on all platforms. The host supplies only its
platform-specific public key directly to RevenueCat and owns app-user identity/login/logout.
Adapters attach to the already configured instance and never configure a conflicting second
instance.

Product loading resolves:

```text
stable Mosaic Product ID
→ accepted Commerce Configuration mapping
→ exact provider Product or exact Offering/Package
→ localized runtime metadata
```

Provider-native objects remain private adapter handles. Purchase uses the exact loaded handle.
Cancellation is not failure. Purchases are never automatically retried. Restore is user-initiated.
Provider lookup failure never becomes inactive Entitlements.

Android passes a short-lived Activity through a platform purchase context and never retains it.
Flutter and Android rethrow coroutine/cancellation signals. Swift adapters use actors and Swift
concurrency.

## Dashboard information architecture

Extend the existing Catalog; do not create a second Catalog or Studio shell.

```text
Catalog
├── Products
│   ├── Import Products
│   └── Product detail/readiness/mappings/snapshots/usage
├── Plans
├── Access
└── Commerce providers
    ├── Connections
    ├── active-provider matrix
    └── synchronization status
```

The guided workflow is:

```text
Connect and test RevenueCat
→ choose Environment and registered Application
→ set active provider
→ preview/import Products
→ map/create Mosaic Products
→ optionally group into a Plan
→ create/map Entitlements and grants
→ inspect readiness
→ bind stable Product IDs in Studio
→ publish
```

Accepted secrets disappear from the form, DOM, mutation observer, and mutation cache after
submission and are never redisplayed. Provider fields are visibly read-only. Sandbox/production,
scope, synchronization time, stale/simulated/unavailable state, and recovery actions remain
visible.

Every blocked operation provides a specific next action. Usage is shown before Product/mapping
replacement, archive, active-provider replacement, or connection revocation.

## Studio integration

- Only Product-binding and commerce-preview surfaces change.
- Paywall documents continue storing stable Mosaic Product IDs.
- Connected preview metadata is fetched as server state through TanStack Query.
- Snapshot, stale, simulated, unavailable, and runtime-live concepts are visually distinct.
- Local-only Studio keeps simulated commerce and does not require authentication.
- Recovery navigation preserves or visibly saves the current Draft.

## Error taxonomy, timeouts, and retries

Stable categories:

- `credentialInvalid`, `credentialExpired`, `permissionDenied`
- `connectionRevoked`, `scopeMismatch`, `modeMismatch`
- `rateLimited`, `timeout`, `providerUnavailable`, `invalidResponse`
- `productNotFound`, `productUnavailable`, `mappingMissing`, `mappingAmbiguous`
- `syncInProgress`, `syncPartial`, `syncFailed`, `metadataStale`
- `idempotencyConflict`

Outbound HTTP uses bounded connect/request timeouts, bounded response bodies, and capped exponential
jitter. Retry transport failures, `429` with `Retry-After`, selected `5xx`, and only errors the
provider marks retryable. Do not retry normal authentication, authorization, not-found, conflict,
or validation errors. Never automatically retry a purchase.

## Audit and observability

Audit:

- connection create/test/credential replacement/reconnect/revoke
- active-provider assignment and replacement
- import commit
- mapping create/replace/archive
- synchronization requested/completed/partially failed
- readiness-driven publishing failure

OpenTelemetry spans and metrics cover RevenueCat calls, rate limits, timeouts, import, job queue
age/depth, synchronization, freshness, readiness, and publishing validation.

Safe log fields include organization, Project, Environment, Application, connection, Product,
mapping, run, request, and trace IDs. Secrets, authorization headers, provider payloads, raw errors,
and app-user IDs are forbidden.

## Migration sequence

1. `00006_provider_connections.sql`
   - explicit Environment mode
   - Provider Connections and scopes
   - approved encrypted credential envelopes
   - active-provider assignments
2. `00007_provider_mapping_upgrade.sql`
   - additive verified mapping fields, lifecycle, scope, and uniqueness
3. `00008_provider_sync.sql`
   - import idempotency, jobs, runs/items, snapshots, and diagnostics
4. `00009_commerce_configuration.sql`
   - immutable release-associated Commerce Configuration snapshots

All migrations include composite same-Project foreign keys, explicit deletion behavior, useful
checks, and indexes justified by actual lookup/lease paths.

## Minimum sufficient tests

Protocol:

- minimum canonical Commerce Provider v1 fixtures for available subscription, non-consumable,
  unavailable Product, trial/intro offer, cancelled/pending purchase, restored purchase, and
  unavailable Entitlement lookup

Backend:

- encryption/redaction/wrong-context/key-rotation boundary
- cross-Project scopes and authorization
- active-assignment uniqueness and revoked/mode mismatch
- import idempotency and changed-request conflict
- synchronization ownership, partial failure, and immutable-history preservation
- ambiguous mappings and readiness/publish blocking
- job leasing/retry/`Retry-After`
- RevenueCat response normalization through `httptest`

Dashboard:

- credential removal from browser-visible and query/mutation state
- partial import retry without duplicating successful rows
- provider-owned read-only fields and visible stale state
- explicit active-provider scope and replacement impact
- connected preview changes without Paywall provider fields
- exact publishing recovery routing
- mapping replacement retains usage context

SDKs:

- core builds without RevenueCat
- custom provider works without RevenueCat
- stable Mosaic ID resolves only through exact mapping
- missing/ambiguous mapping fails safely
- cancellation/pending/provider failure normalization
- restore failure never becomes empty success
- Entitlement failure never becomes inactive
- host-owned initialization is not duplicated
- localized metadata reaches the renderer
- diagnostics contain no secret

Provider SDK internals and store infrastructure are not re-tested.

## Explicit exclusions

- direct StoreKit 2 or Google Play Billing adapters
- Mosaic receipt/transaction validation
- Mosaic-owned authoritative customer Entitlement state
- RevenueCat webhooks as billing authority
- server-side purchase reconciliation
- consumables, credits, quantities, metering
- Stripe, Paddle, Lemon Squeezy
- advanced targeting, analytics, experiments, AI
- remote executable provider plugins
- Protocol `0.3`
- a second Catalog or Studio redesign

## Design-partner demonstration

```text
Open local Studio without an account
→ connect and test RevenueCat in Staging
→ select RevenueCat for each target Application/platform
→ import Monthly and Yearly
→ map/create stable Mosaic Products
→ group them in Pro
→ grant/map the Pro Entitlement
→ inspect readiness
→ bind stable Product IDs to a Paywall
→ publish to Staging
→ load localized metadata in Flutter, SwiftUI, and Compose
→ purchase, cancel, restore, and read provider-owned Entitlements
→ invalidate the connection and recover through Reconnect
→ switch one example to an SDK-only custom provider
→ verify the Paywall document did not change
```

Environmental limits, provider Test Store/sandbox accounts, devices, and unavailable store flows
must be documented rather than simulated as passing.

## Stage order and ownership

1. Owner approves credential encryption/authorization decision.
2. Protocol implements and freezes Commerce Provider Contract v1.
3. Backend implements migrations, secure connections, mappings, synchronization, Commerce
   Configuration, readiness, OpenAPI, and publishing validation.
4. Dashboard consumes the generated client and adds the connected Catalog/Studio workflows.
5. Flutter, iOS, and Android implement provider-neutral core changes and optional RevenueCat
   adapters against the frozen contract.
6. Run the integrated sandbox demonstration.
7. Product, UX, and Quality perform the required read-only review; confirmed findings receive at
   most two fix rounds.

No agent modifies another owner's files concurrently. Gate 4B does not begin.

## Decisions requiring owner approval

Accepted:

1. Versioned AES-256-GCM envelopes with an operator-supplied keyring, frozen by ADR-0019.

Blocking:

1. Approve least-privilege RevenueCat v2 secret keys for the first alpha; defer OAuth.

Recorded defaults unless the owner objects:

- host-owned RevenueCat SDK initialization only;
- active provider references one specific connection per Environment × Application × platform;
- Production cannot use sandbox connections;
- missing Entitlement grants block production publishing;
- Configuration Delivery v1 remains unchanged and commerce uses an immutable release-associated
  sidecar;
- Packages and direct Products are explicit discriminated mapping variants;
- RevenueCat pending maps to `pending`; adapters do not invent `deferred`;
- server-connected generic custom providers are deferred;
- RevenueCat Android scope is Google Play only for Gate 4A.
