# Phase 4B Plan: Native Store Providers

## Status

**Stage 1 complete; complete Gate 4B execution contract ready for one owner
approval.**

Gate 4B is authorized for inspection and planning by the owner-provided
orchestration brief. The read-only Product, UX, iOS, Android, Protocol,
Backend, Dashboard, and Flutter inspections are complete.

Implementation must not begin until the owner approves the complete execution
contract under [Single approval decision](#single-approval-decision).
The existing closed Commerce Provider Contract `1` and Commerce Configuration
`1` cannot safely express exact Google subscription selection, native
Product-to-Entitlement grants, delayed native transaction acceptance, or
credential-free backend-selected native activation.

This plan does not begin Phase 5 and does not authorize a merge or tag.

## Baseline and preflight

- Base commit: `51269f5d` (`feat: complete phase 4a revenuecat and custom providers`)
- Branch: `phase/4b-native-store-providers`
- Working directory: `/Users/muhideenmujeeb/Projects/mosaic`
- Gate 4A: `docs/reviews/phase-4a.md` is accepted with tracked nonblocking
  environmental follow-ups.
- Phase 3: `docs/reviews/phase-3.md` records explicit product-owner acceptance
  for the Phase 4 baseline.
- PostgreSQL remains the runtime system of record through `pgxpool`.
- Production API and worker wiring use PostgreSQL repositories and contain no
  in-memory fallback. The in-memory cloud-workspace adapter is test-only.
- Goose migrations `00001` through `00007` applied successfully on
  2026-07-24.
- Provider Connections, Provider Product Mappings, Products, Plans,
  Entitlements, grants, active assignments, and immutable Commerce sidecars use
  the accepted Gate 4A domain model.
- Commerce Provider Contract `1` and Commerce Configuration `1` remain the
  accepted RevenueCat/custom-provider contracts.
- RevenueCat remains optional and SDK-local custom providers work without it.
- Mosaic Products remain stable Project-scoped identities.
- Products and Entitlements remain separate.
- Customer Entitlement state remains provider-owned.
- Published Paywalls contain stable Mosaic Product IDs, never provider
  identifiers.
- The worktree was clean before Stage 1 and remained clean throughout both
  read-only inspection stages.
- No separate Gate 4A design-partner research document exists. The Gate 4A
  review is the only documented design-partner evidence and requires a live
  provider demonstration before supervised-alpha confidence is claimed.

## Product objective

Allow one published Mosaic Paywall, Plan, Product set, Entitlement grants, and
Placement to work with RevenueCat, StoreKit, Google Play Billing, or an
app-owned custom provider by changing only:

1. the explicit active provider for an Environment, Application, and platform;
2. the scoped Provider Product Mapping; and
3. runtime provider metadata and outcomes.

The Paywall document and its Mosaic Product references never change when the
provider changes.

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
└── Mosaic Product resolved through one exact active mapping

Active customer Entitlements
└── observed and owned by the selected provider until Mosaic Billing
```

A native store does not expose a RevenueCat-style Entitlement identifier.
Native access resolution is:

```text
verified StoreKit transaction or active Google purchase
→ exact Provider Product Mapping
→ stable Mosaic Product
→ immutable Product-to-Entitlement grants
→ provider-observed active Mosaic Entitlement keys
```

Mosaic does not persist authoritative customer access or create Apple/Google
Entitlement objects.

## Terminology

| Term | Meaning |
| --- | --- |
| Product | Stable Project-scoped Mosaic sellable identity |
| Product Reference | Stable Mosaic Product ID stored in a Paywall |
| Provider Product Mapping | Scoped exact link from a Mosaic Product to provider identifiers |
| Active Provider | Explicit provider selected for Environment × Application × platform |
| StoreKit | User-facing Apple native commerce adapter |
| Google Play Billing | User-facing Android native commerce adapter |
| Base plan | Google mapping detail, never a top-level Mosaic Product |
| Offer | Optional explicit Google mapping detail, never a top-level Mosaic Product |
| Offer token | Runtime-only Google value resolved from current `ProductDetails`; never persisted |
| Provider object | Private native adapter handle such as StoreKit `Product` or Google `ProductDetails` |
| Entitlement | Mosaic-owned access definition granted by Products |
| Active Entitlement result | Provider-observed runtime access normalized to Mosaic Entitlement keys |
| Restore | StoreKit user-initiated store synchronization and current-Entitlement refresh |
| Purchase recovery | Google query of currently owned/active purchases |
| Configured | Structurally complete mapping; not proof of store availability |
| Verified in test | Accepted observation from the exact test client and mapping scope |
| Live metadata | Metadata returned by the currently connected runtime provider call |
| Observed snapshot | Stored bounded test-client observation; never labeled live |

The existing persisted provider identifiers `app_store` and `google_play`
remain the backend/API compatibility values unless the owner explicitly
approves a breaking rename. User-facing labels are StoreKit and Google Play
Billing. SDK adapter identities and exact wire spellings must be frozen before
implementation.

## Required scope

- optional first-party StoreKit adapter;
- optional first-party Google Play Billing adapter;
- optional Mosaic-owned Flutter native-store bridge;
- exact Apple Product mapping;
- exact Google Product, base-plan, and optional offer mapping;
- explicit native-provider activation without credentials;
- localized runtime Product metadata;
- billing period, trial, and introductory-offer metadata;
- Product availability and safe partial load failures;
- native purchase presentation;
- pending outcomes and truthful deferred capability reporting;
- cancellation distinct from failure;
- StoreKit transaction verification, updates, finishing, and synchronization;
- Google purchase updates, foreground recovery, acknowledgement, and active
  purchase querying;
- idempotent delayed-result delivery;
- provider-observed active Entitlement results;
- provider capabilities and safe diagnostics;
- structural readiness, bounded test observations, and publishing recovery;
- mapping replacement with immutable historical references;
- example integrations and test/sandbox documentation;
- continued RevenueCat and SDK-local custom-provider compatibility.

## Explicit exclusions

- Apple or Google server credentials;
- Apple server-side transaction validation;
- Google server-side purchase validation;
- receipts, purchase tokens, or transaction persistence in Mosaic backend;
- App Store Server Notifications;
- Google Real-time Developer Notifications;
- reconciliation or subscription state;
- authoritative Mosaic-managed customer Entitlements;
- customer identity unification;
- consumables, credits, quantities, metering, prepaid plans, installment plans,
  subscription replacement, and multiple Google one-time purchase offers unless
  separately owner-approved;
- automatic store Product creation;
- Stripe, Paddle, Lemon Squeezy, or another provider;
- advanced Placement targeting;
- analytics ingestion;
- experiments;
- AI;
- Paywall Protocol `0.3`;
- changes to Paywall Protocol `0.1` or `0.2`;
- server-side Apple/Google catalog synchronization;
- top-level Base Plan or Offer navigation.

## Public commerce contract decision

### Current insufficiency

The existing contracts already normalize:

- Product loading and availability;
- localized price, billing period, trial, and introductory-offer metadata;
- metadata freshness;
- supported, unsupported, and conditional capabilities;
- purchased, pending, deferred, cancelled, unavailable, and failed outcomes;
- restore outcomes;
- available, unknown, provider-unavailable, and failed Entitlement results;
- bounded safe diagnostics.

They do not define:

1. exact Google Product + base plan + optional selected offer;
2. native Product-to-Entitlement grant snapshots;
3. delayed transaction/purchase updates and an idempotent delivery identity;
4. accepted local delivery before StoreKit finish or Google acknowledgement;
5. StoreKit synchronization versus Google active-purchase recovery;
6. backend-published credential-free native activation; or
7. configured native freshness when no provider synchronization exists.

Capabilities and diagnostics cannot represent these concepts because they are
durable routing data and ordered lifecycle rules, not support flags or errors.
Both v1 schemas are closed and reject unknown fields and variants, so an
in-place additive change is not wire-backward-compatible.

### Final proposed decision

Create parallel Commerce Provider Contract `2` and Commerce Configuration `2`.

- Retain full v1 validation and reading for RevenueCat and existing custom
  providers.
- Gate 4B SDKs accept v1 and v2.
- Serve v2 only to clients that declare support.
- Preserve the last accepted v1 sidecar or bundled fallback when a client
  cannot accept v2.
- Leave Configuration Delivery `1` and Paywall Protocol unchanged.
- Do not invent a Flutter-, Swift-, Kotlin-, StoreKit-, or Google-specific
  public schema.

Commerce Configuration `2` adds:

- a credential-free `nativeStore` activation variant;
- an exact StoreKit direct-Product mapping;
- an exact Google mapping with Product ID, required base-plan ID for a
  subscription, and optional explicitly selected offer ID;
- immutable Mosaic Entitlement grant keys on each Product mapping;
- provider Entitlement mappings only for providers that expose such
  identifiers;
- explicit native observation freshness/context;
- explicit recovery mode.

Commerce Provider Contract `2` adds:

- a normalized asynchronous commerce update;
- stable operation/update identity and safe transaction reference where
  supplied;
- occurred-at timestamp;
- current active Mosaic Entitlement keys on accepted success;
- explicit local-delivery acceptance semantics;
- lifecycle rule: verification/ownership → exact mapping → idempotent local
  acceptance → finish/acknowledge → completed app-level result;
- explicit recovery mode while preserving normalized restore result types.

No contract carries native objects, offer tokens, receipts, raw purchase
tokens, JWS, signatures, customer identifiers, or executable code.

## Normalized operation models

These shapes are conceptual cross-platform contracts. JSON Schema owns wire
spelling; Dart, Swift, and Kotlin expose idiomatic sealed or enum-backed types.

### Product-load result

One load operation contains:

- operation ID;
- provider ID and Mosaic adapter version;
- configuration ID/revision;
- requested-at and completed-at timestamps;
- one ordered result for every requested Mosaic Product;
- operation-level safe diagnostics.

Each Product result contains:

- stable Mosaic Product ID and mapping ID;
- `available`, `unavailable`, or `unknown`;
- stable availability reason when not available;
- normalized runtime Product metadata when available;
- metadata source/freshness;
- immutable Mosaic Entitlement grant keys;
- safe Product-scoped diagnostics.

Partial provider failure does not remove a Product or reorder results.

### Purchase request

A purchase request contains only:

- operation ID;
- selected provider ID;
- stable Mosaic Product ID;
- accepted configuration ID/revision.

The provider purchases the exact private native handle loaded for that Product
and revision. The request never accepts a provider Product identifier, base
plan, offer token, StoreKit `Product`, or Google `ProductDetails`.

### Immediate purchase result

Outcomes:

- `purchased`;
- `pending`;
- `deferred`;
- `cancelled`;
- `alreadyEntitled`;
- `productUnavailable`;
- `providerUnavailable`;
- `failed`.

Every result contains operation ID, provider ID, Mosaic Product ID, occurred-at
timestamp, and safe diagnostics. Where supplied safely, it may contain a
provider transaction reference that is not a receipt, token, signature, or
customer identifier.

Only `purchased` and `alreadyEntitled` may contain active Mosaic Entitlement
keys. StoreKit and Google native adapters advertise distinct deferred outcome
as unsupported and never emit it. `pending` is terminal for the immediate call
but may later produce a commerce update.

### Asynchronous commerce update

An update contains:

- stable update ID;
- original operation ID when known;
- provider ID;
- stable Mosaic Product ID;
- accepted configuration ID/revision;
- occurred-at timestamp;
- safe provider transaction reference where available;
- one update outcome:
  - `purchased`;
  - `pending`;
  - `cancelled`;
  - `providerUnavailable`;
  - `failed`;
  - `entitlementsChanged`;
- active Mosaic Entitlement keys only for accepted success/access change;
- safe diagnostics.

The adapter deduplicates native callbacks before emission. Core SDK routing
deduplicates update IDs again and rejects stale configuration revisions. An
update is acknowledged to the adapter only after the host-visible local
commerce stream or configured local delivery sink has accepted it
idempotently. Native finish/acknowledgement follows that acceptance.

### Restore or recovery request/result

One provider-neutral method remains available to renderers, while the active
provider declares its recovery mode:

- `storeSynchronization` for StoreKit;
- `activePurchaseRecovery` for Google Play;
- provider-defined existing v1 behavior for RevenueCat/custom.

Outcomes:

- `restored`;
- `nothingToRestore`;
- `cancelled`;
- `providerUnavailable`;
- `failed`.

Every result contains operation ID, provider ID, recovery mode, completed-at
timestamp, and safe diagnostics. `restored` contains at least one active
Mosaic Entitlement key. Failure or partial provider queries never normalize to
`nothingToRestore`.

### Active Entitlement result

Outcomes:

- `available`;
- `unknown`;
- `providerUnavailable`;
- `failed`.

Every result contains lookup ID, provider ID, observed-at timestamp, and safe
diagnostics. Only `available` contains freshness and the active Entitlement-key
set. An available empty set is authoritative only after all provider queries
required by that adapter succeed. Other outcomes cannot carry an empty set.

### Local delivery and native finalization

The local delivery boundary is:

```text
verified/owned native transaction
→ exact accepted mapping and configuration revision
→ deterministic Product and Entitlement grant resolution
→ durable-enough adapter recovery record or restart-safe provider state
→ host-visible normalized result/update accepted idempotently
→ native finish or acknowledgement
→ completion diagnostic/result
```

Gate 4B does not promise server delivery. The adapter must remain able to
recover an interrupted finalization from StoreKit current/unfinished
transactions or Google active purchases. A finalization failure is reported
and retried only through a bounded idempotent recovery path; it is never hidden
as completed success.

## Native activation and provider resolution

Evolve active assignment into a closed activation union:

```text
providerConnection
├── provider
└── connectionId

nativeStore
└── provider
```

Rules:

- `providerConnection` preserves RevenueCat/custom behavior and requires a
  compatible healthy scoped connection.
- `nativeStore` requires no connection and permits only:
  - `app_store` for an iOS Application;
  - `google_play` for an Android Application.
- `sdkLocal` remains reserved for host-supplied local custom snapshots.
- A production Environment cannot silently use test-only evidence or a
  different provider.
- The runtime never falls back to another provider.
- Replacement is explicit and audited.

The current active mapping uniqueness must become provider-specific so
RevenueCat and a native mapping can coexist for migration/testing. Readiness
uses only the explicitly selected provider.

## Provider Product Mapping model

Every native mapping is Project, Environment, Application, platform, Product,
and provider scoped.

StoreKit:

- stable Mosaic Product ID;
- mapping ID;
- Apple Application;
- Mosaic Environment;
- `app_store`;
- StoreKit Product ID;
- Product type;
- lifecycle;
- replacement mapping reference;
- optional bounded observed metadata and diagnostics.

Google Play:

- stable Mosaic Product ID;
- mapping ID;
- Android Application;
- Mosaic Environment;
- `google_play`;
- Google Product ID;
- Product type;
- required base-plan ID for subscriptions;
- optional explicit offer ID;
- lifecycle;
- replacement mapping reference;
- optional bounded observed metadata and diagnostics.

Validation:

- archived Products cannot gain mappings;
- mappings cannot cross Projects, Environments, Applications, or platforms;
- StoreKit forbids base-plan and offer fields;
- Google subscriptions require a base plan;
- Google non-consumables forbid base-plan and offer fields;
- selected offers never fall back to the base plan;
- `No offer` is explicit;
- no offer token is persisted;
- active mapping resolution is unambiguous for the selected provider;
- replacing a mapping creates a new row with `replaces_mapping_id`;
- immutable Releases and sidecars retain the old mapping;
- active Draft adoption is explicit.

## Runtime Product model

The provider-independent runtime Product contains:

- stable Mosaic Product ID and key;
- Product type;
- localized display name and price;
- optional locale and ISO currency;
- structured billing period;
- optional trial with eligibility state;
- optional introductory offer with payment mode, period, cycles, and eligibility;
- `available`, `unavailable`, or `unknown` availability with a stable reason;
- metadata source, freshness, observation time, and optional expiry;
- provider identity;
- Mosaic Entitlement grant keys;
- safe per-Product diagnostics.

Product load returns one result per requested Product in source order. Missing
or unavailable Products are never removed or substituted. Unsupported fields
are absent or explicitly unavailable.

## StoreKit adapter architecture

Add an optional sibling package:

```text
sdk/ios/StoreKit/
├── Package.swift
├── Sources/MosaicStoreKit/
└── Tests/MosaicStoreKitTests/
```

The package:

- depends on `MosaicSDK` and the OS StoreKit framework only;
- keeps StoreKit types private;
- uses Swift concurrency and actors;
- shares its module with the native iOS example and Flutter iOS bridge;
- retains iOS 15 as the minimum target;
- identifies as StoreKit adapter `1.0.0`;
- uses one application-lifetime transaction coordinator;
- separates loaded Product handles from transaction observation.

Suggested internal boundaries:

- provider actor;
- narrow StoreKit client;
- metadata mapper;
- transaction coordinator;
- Entitlement resolver;
- safe diagnostics mapper.

### StoreKit Product loading

1. Accept only exact direct-Product mappings.
2. Load exact identifiers with `Product.products(for:)`.
3. Treat omitted identifiers as `productNotFound`.
4. Accept auto-renewable subscriptions and non-consumables only.
5. Reject consumables and non-renewing subscriptions.
6. Retain StoreKit `Product` only under the Mosaic Product ID and current load
   generation.
7. Invalidate handles on configuration replacement.

Metadata uses `displayName`, `displayPrice`,
`priceFormatStyle.currencyCode`, subscription period, introductory offer, and
intro-offer eligibility without independently formatting price or guessing
locale.

### StoreKit transaction lifecycle

```text
exact loaded StoreKit Product
→ Product.purchase()
→ verified Transaction
→ exact mapping and Product grants
→ idempotent local commerce-update acceptance
→ observable Entitlement snapshot/update
→ Transaction.finish()
→ purchased result
```

- `.userCancelled` is cancelled.
- `.pending` is pending. Ask to Buy is not invented as deferred.
- unverified transactions fail and remain unfinished.
- start `Transaction.updates` at provider/application lifetime;
- sweep `Transaction.unfinished` after compatible mappings are installed;
- deduplicate by transaction identity across the purchase return, updates, and
  unfinished sweep;
- never finish an unmapped or unaccepted transaction;
- `Transaction.currentEntitlements` is the restart-safe observed-access source.

StoreKit capabilities mark deferred purchase outcome unsupported because the
current typed API does not expose a distinct deferred result.

### StoreKit restore

- `AppStore.sync()` is user initiated only;
- after synchronization, recompute verified current Entitlements;
- mapped active keys produce restored;
- authoritative empty produces nothing to restore;
- cancellation remains cancellation;
- verification or provider failure never becomes empty/inactive.

## Google Play Billing adapter architecture

Add optional `:mosaic-google-play`:

```text
api(project(":mosaic"))
implementation("com.android.billingclient:billing-ktx:9.1.0")
```

Baseline:

- provider ID compatible with backend `google_play`;
- adapter version `1.0.0`;
- min SDK 24;
- compile/target SDK 36 for the example;
- Java 17;
- Kotlin 2.2.10;
- coroutines 1.10.2.

The adapter:

- owns one application-context `BillingClient`;
- enables required pending purchases and automatic service reconnection;
- connects at application/foreground lifecycle;
- queries purchases after setup and on Activity resume;
- never retains an Activity;
- obtains a resumed Activity only for `launchBillingFlow`;
- serializes setup;
- propagates coroutine cancellation;
- closes and unregisters lifecycle callbacks;
- retries bounded idempotent operations only, never a purchase.

### Google Product loading

1. Query exact Product IDs and type through `ProductDetails`.
2. For subscriptions, match exact base-plan ID and optional offer ID.
3. `offerId == null` means the regular base plan.
4. Require exactly one eligible match.
5. Resolve the current offer token from current `ProductDetails`.
6. Never cache stale ProductDetails or persist the offer token.
7. Missing, ineligible, or ambiguous selection fails without fallback.
8. Preserve `unfetchedProductList` as per-Product unavailability diagnostics.

Use localized `ProductDetails.name`, formatted price, ISO currency, and exact
pricing phases. Zero-price phases normalize to trial, finite paid phases to
introductory offer, and infinite recurring phases to the base subscription.
Pricing structures that cannot be represented honestly fail safely.

### Google purchase lifecycle

```text
exact ProductDetails + runtime offer token
→ launchBillingFlow()
→ PurchasesUpdatedListener / foreground recovery
→ PURCHASED and exact mapping
→ idempotent local commerce-update acceptance
→ observable Entitlement snapshot/update
→ acknowledgePurchase() when required
→ purchased result
```

- `USER_CANCELED` is cancelled;
- `ITEM_UNAVAILABLE` is Product unavailable;
- `ITEM_ALREADY_OWNED` requires an authoritative active-purchase query before
  already entitled;
- service/network failure is provider unavailable;
- developer/configuration errors are non-retryable failed;
- `PENDING` remains pending with no grants or acknowledgement;
- unacknowledged or pending purchases never produce completed success;
- use the purchase token or a safe internal digest for deduplication, never
  order ID;
- never expose purchase token, signature, original JSON, raw debug message, or
  customer identity;
- acknowledgement is idempotent and occurs only after accepted local delivery.

### Google recovery

Play Billing Library 9 has no purchase-history API for this workflow. Query
currently owned/active `SUBS` and `INAPP` purchases with
`queryPurchasesAsync`.

- both queries must succeed before authoritative empty access is returned;
- partial failure is unknown/provider unavailable/failed;
- pending and suspended purchases are not active;
- cancelled-but-unexpired subscriptions remain active when Play returns them;
- foreground recovery and delayed pending completion use the same processor;
- diagnostics and UI call this purchase recovery, not Apple-style store sync.

## Flutter integration architecture

Use one optional Mosaic-owned multi-platform plugin:

```text
sdk/flutter/packages/mosaic_native_store
```

Choose the **thin bridge to reusable native modules** option.

- Do not use `in_app_purchase` or another third-party purchase plugin.
- Do not duplicate StoreKit or BillingClient business logic in Dart.
- Do not create a package-separated federated plugin for Gate 4B.
- Expose provider-independent StoreKit and Google Play provider factories.
- Reuse `MosaicStoreKit` on iOS and `mosaic-google-play` on Android.
- Keep RevenueCat in its separate optional package.
- Keep custom providers on the core Dart interface.

The bridge uses versioned, closed, provider-independent channel DTOs for
profile, activation, load, purchase, restore/recovery, access, diagnostics,
invalidation, close, and commerce updates. Native objects never cross the
channel.

The Dart contract adds:

- complete runtime Product metadata, availability, freshness, and grants;
- complete normalized purchase/restore/access results;
- asynchronous `MosaicCommerceUpdate` stream;
- asynchronous Product invalidation;
- provider disposal;
- serialized router activation/deactivation;
- safe malformed/missing-plugin outcomes.

On configuration replacement:

1. pause new purchases;
2. invalidate native handles;
3. install exact identity, capability, mapping, and grant snapshot;
4. reconcile buffered native updates;
5. expose ready;
6. reject stale callbacks by revision and operation identity.

The plugin detach stops channel delivery, not native transaction recovery.

Distribution must support:

- versioned SwiftPM and CocoaPods-compatible iOS artifacts if the optional
  plugin retains Flutter 3.19 compatibility;
- a versioned Maven artifact for Android;
- iOS 15 and Android API 24 minimums.

An alternative is to raise only the optional plugin to Flutter 3.44+ and use
SwiftPM-only distribution. That requires explicit owner approval and is not
the recommendation.

## Capability model

StoreKit:

- supported: loading, subscriptions, non-consumables, trials, introductory
  offers, pending, store synchronization, active Entitlement lookup,
  diagnostics;
- conditional: promotional offers requiring provider-signed configuration;
- unsupported: distinct deferred outcome, server-confirmed transactions,
  client-side Product synchronization.

Google Play Billing:

- supported: loading, subscriptions, non-consumables, base plans, explicit
  offers, pending, active-purchase recovery, active Entitlement lookup,
  diagnostics;
- conditional: trials and introductory offers;
- unsupported: distinct deferred purchase outcome, server-confirmed
  transactions, client-side Product synchronization.

Unsupported capabilities remain explicit. Google subscription-replacement
deferral is not normalized as a deferred purchase outcome.

## Application lifecycle and concurrency

### Shared rules

- Provider activation and deactivation are serialized.
- Configuration replacement pauses new purchases, invalidates private Product
  handles, installs the new exact mapping/grant snapshot, reconciles buffered
  updates, then becomes ready.
- Stale loads, purchases, and callbacks retain their originating revision and
  cannot repopulate or mutate current handles.
- Cancellation signals propagate through Swift tasks, Kotlin coroutines, Dart
  futures/streams, and channel calls.
- Analytics or diagnostic delivery never blocks Product loading, purchasing,
  restoration/recovery, or native finalization.
- Duplicate callbacks are normal provider behavior and are idempotent, not
  generic failures.

### iOS lifecycle

- Start one retained `Transaction.updates` observer at application/provider
  lifetime, before a purchase begins.
- Do not recreate it on every scene activation.
- After a compatible configuration is accepted, process
  `Transaction.unfinished` and reconcile current Entitlements.
- Scene activation may refresh Product/access presentation but must not call
  `AppStore.sync()` automatically.
- Provider close cancels the observer only when no host/native bridge consumer
  remains.
- Flutter multi-engine use shares/ref-counts the native transaction
  coordinator rather than starting conflicting observers.

### Android lifecycle

- Create one application-context BillingClient per adapter process scope.
- Connect during application start/foreground and use automatic reconnection.
- Register Activity lifecycle callbacks without retaining an Activity.
- Query active purchases after setup and when a resumed Activity becomes
  available.
- Activity detach pauses purchase presentation but not BillingClient update
  processing or recovery.
- Close unregisters callbacks, cancels owned coroutines, and ends the Billing
  connection.
- Flutter engine detach stops Dart channel delivery but buffers/reconciles
  normalized native updates; it does not discard recoverable purchases.

### Flutter lifecycle

- Plugin registration is per engine; native store coordination follows the
  shared process/module lifetime rules above.
- Event delivery resumes after engine reattachment and replays only
  unconsumed, revision-compatible normalized updates.
- Missing plugin, unsupported platform, engine detach, unavailable Activity,
  and malformed channel response fail safely with stable Mosaic outcomes.
- Core Mosaic remains fully functional with the plugin absent.

## Provider diagnostics contract

Diagnostics are bounded, structured, and safe:

- stable Mosaic code;
- severity;
- retryable flag;
- user-safe message;
- correlation ID;
- optional safe provider symbolic/numeric code;
- optional affected Product, mapping, Application, Environment, and platform;
- optional retry-after only when retryable;
- one closed recovery action.

Required diagnostic families:

- activation:
  - `commerce.provider.notConfigured`;
  - `commerce.provider.platformMismatch`;
  - `commerce.provider.versionMismatch`;
  - `commerce.provider.capabilityMismatch`;
- mapping:
  - `commerce.mapping.missing`;
  - `commerce.mapping.ambiguous`;
  - `commerce.mapping.archived`;
  - `commerce.mapping.basePlanMissing`;
  - `commerce.mapping.offerMissing`;
  - `commerce.mapping.offerIneligible`;
- Product:
  - `commerce.product.notFound`;
  - `commerce.product.unavailable`;
  - `commerce.product.unsupportedType`;
  - `commerce.product.metadataUnavailable`;
- lifecycle:
  - `commerce.purchase.pending`;
  - `commerce.purchase.cancelled`;
  - `commerce.transaction.unverified`;
  - `commerce.transaction.deliveryPending`;
  - `commerce.transaction.finalizationFailed`;
  - `commerce.transaction.duplicateIgnored`;
- recovery:
  - `commerce.recovery.cancelled`;
  - `commerce.recovery.partialFailure`;
  - `commerce.entitlements.unknown`;
  - `commerce.entitlements.providerUnavailable`;
- environment/evidence:
  - `commerce.environment.unknown`;
  - `commerce.environment.mismatch`;
  - `commerce.observation.missing`;
  - `commerce.observation.stale`.

Provider-specific subcodes may be recorded only when safe. Raw Apple errors,
Google debug messages, provider bodies, JWS, receipts, purchase tokens,
signatures, credentials, authorization headers, customer identifiers, and
stack traces are forbidden.

Retryable purchase diagnostics authorize an explicit user-initiated retry
only. They never authorize automatic purchase retry.

## Readiness and test observations

Readiness is evaluated for Product × Environment × Application × platform:

- `configured`;
- `verifiedInTest`;
- `attentionRequired`;
- `unavailable`;
- `archived`.

`configured` means structural validation passed. It is not live verification.
Unobserved native metadata is not automatically unavailable.

Add bounded immutable mapping observations containing:

- exact mapping and scope;
- provider and adapter version;
- explicit store context:
  - `storekitConfiguration`;
  - `appleSandbox`;
  - `googlePlayTest`;
  - `production`;
  - `unknown`;
- available, unavailable, or failed observation;
- safe diagnostic code and correlation ID;
- observed and received timestamps;
- optional bounded metadata snapshot.

Observations contain no transaction, receipt, token, customer/account identity,
or raw provider payload. They are submitted through an authenticated
developer/test-client workflow. They are evidence, not server-side store
verification.

Missing or stale test evidence is a production publishing warning under the
recommended policy. Structural defects and explicit unavailable/failed
evidence block. A stricter evidence-blocking policy requires owner approval.

Mosaic Environment and store test context are always separate.

## Publishing validation

For every targeted Application/platform and referenced Product, block:

- missing/cross-Project/archived Product;
- missing Entitlement grant;
- no active provider;
- provider/platform incompatibility;
- missing, archived, or ambiguous active mapping;
- missing StoreKit Product ID;
- missing Google Product ID;
- missing Google subscription base plan;
- invalid or ambiguous explicit offer selection;
- mapping/release scope mismatch;
- explicit unavailable/failed current observation;
- unsupported Product type.

Warn:

- mapping is configured but never observed in test;
- observation is stale;
- trial/offer eligibility is unknown;
- a capability is conditional.

Every issue includes Product, Environment, Application, platform, stable code,
and exact recovery action. Structural validation never claims that the store
will accept a purchase.

## Backend implementation

Likely owned changes:

- `apps/api/migrations/00008_native_store_providers.sql`;
- cloud-workspace models, repositories, services, transport, tests;
- PostgreSQL repository and integration tests;
- test-only in-memory repository interface parity;
- hosted-publishing readiness, sidecar compilation, tests, and PostgreSQL
  repository;
- OpenAPI source and generated dashboard client;
- backend documentation and audit events.

The migration must:

- add the activation union and check constraints;
- make native mappings credential-free;
- add Google base-plan/offer fields;
- replace global active-mapping uniqueness with provider-aware uniqueness;
- add replacement self-reference;
- add immutable test-observation storage and tenant isolation;
- preserve existing RevenueCat/custom rows;
- include explicit deletion behavior and justified indexes.

No transaction, receipt, purchase, customer-access, or Apple/Google credential
table is permitted.

Audit:

- native mapping create/replace/archive;
- native provider assignment change;
- accepted test observation;
- readiness-driven publish rejection using a separate safe audit transaction.

Computed readiness remains unpersisted.

## Dashboard workflows

Use the user-facing label **Purchase setup** while retaining the existing
`/catalog/providers` route.

```text
Catalog
├── Plans
├── Products
├── Access
└── Purchase setup
    ├── Active provider by Application
    └── Connections
```

- StoreKit and Google Play are direct platform-filtered choices with “Built in
  · no server credentials.”
- RevenueCat/custom connection management remains under Connections.
- Environment selection is mandatory; never default to staging or first.
- Studio requires explicit Application selection; never default to first.
- Product detail adds an additive cross-platform coverage panel.
- Mapping forms are pre-scoped TanStack Form sheets.
- Google offers require explicit `No offer` or `Use a specific offer`.
- Provider-owned runtime metadata is read-only with source/context/timestamp.
- Mapping replacement loads mapping-specific usage before confirmation.
- Publishing recovery preserves Draft, Environment, Application, Product, and a
  safe `returnTo` path; returning reopens and revalidates Publish.
- Studio shows active provider, mapping/readiness, capability warnings,
  observed/runtime metadata, and mock fallback without writing provider fields
  to the Paywall document.
- Apple UI says store sync/restore; Google UI says recover active purchases.

## Store and test workflows

### Apple

Deterministic local evidence:

- add StoreKit Configuration to the example;
- use StoreKit Testing/`SKTestSession`;
- load subscription/non-consumable metadata;
- purchase, cancel, Ask to Buy pending, delayed update, restart recovery,
  current Entitlements, and explicit synchronization.

Real sandbox evidence:

- exact App Store Connect Product IDs and metadata;
- active agreements;
- Sandbox Apple Account;
- development-signed device or TestFlight;
- verified transaction environment recorded as sandbox;
- localized pricing, intro metadata/eligibility, purchase, cancel, pending,
  outside-app completion, restart, current Entitlements, and restore.

### Google

- matching Play Console application/package;
- current Play Store and license tester;
- internal test track or licensed sideload;
- exact Product, base plan, and offer;
- success, cancellation, decline, slow approve/decline, pending completion,
  restart, active recovery, already owned, and acknowledgement;
- Play Billing Lab for country, trial repetition, lifecycle, and response
  simulation;
- response override metadata only in debug manifest with `NONPRODUCTION`
  protection.

### Cross-provider

Record the original Paywall digest and Mosaic Product IDs, run Apple and Google
flows with the same Paywall/Products/grants/Placement, and prove the digest and
references remain unchanged. Only assignment and mapping differ.

Unavailable device, account, or store checks are recorded as unavailable and
never reported as passing. Under the recommended evidence policy, both real
platform purchase demonstrations are required for Gate 4B acceptance.

## Minimum sufficient tests

Protocol:

- v1 remains valid and unchanged;
- v2 exact Google mapping and runtime-only offer-token exclusion;
- Product grant snapshot;
- native activation and recovery modes;
- delayed update/local acceptance lifecycle;
- v1/v2 negotiation and fallback.

Backend:

- native activation has no connection and enforces platform;
- RevenueCat/custom assignment remains unchanged;
- exact native mapping shapes and cross-tenant isolation;
- coexistence of prepared RevenueCat and native mappings;
- replacement history;
- configured versus verified-in-test readiness;
- publishing blockers/warnings and recovery codes;
- sidecar has exact selectors/grants and no secret/token;
- immutable observations and PostgreSQL constraints.

iOS:

- exact mapping and metadata normalization;
- verified success accepts before finish;
- unverified never succeeds or finishes;
- pending/cancel/failure remain distinct;
- updates/unfinished deduplicate and recover;
- Entitlement failure never becomes inactive;
- Paywall document remains unchanged.

Android:

- exact Product/base-plan/offer selection and no fallback;
- metadata/pricing-phase normalization;
- pending never completes or acknowledges;
- acceptance precedes acknowledgement;
- delayed update and duplicate-token idempotency;
- combined subscription/non-consumable recovery and partial failure;
- cancellation propagation and cleanup;
- Paywall document remains unchanged.

Flutter:

- native-store plugin remains optional;
- one provider-independent Dart API supports both platforms;
- complete metadata and outcome mapping;
- router replacement invalidates stale handles/updates;
- malformed or missing plugin fails safely;
- update replay/deduplication;
- RevenueCat/custom providers remain functional;
- diagnostics contain no sensitive data;
- Paywall document remains provider-independent.

Dashboard:

- native assignment cannot select the wrong platform or require a connection;
- Google mapping requires base plan and explicit offer/no-offer;
- replacement waits for usage;
- recovery preserves scope and revalidates;
- Studio never silently selects an Application;
- provider IDs never enter the Paywall document.

Do not add new test runners, large store mocks, duplicate provider-SDK tests, or
visual snapshots for adapter-only work.

## Official documentation and selected versions

Research date: 2026-07-24.

### Apple

- StoreKit is provided by the operating system; no package version is pinned.
- Xcode inspected: 26.5.
- iPhone Simulator SDK inspected: 26.5.
- StoreKit module inspected: 815.5.6.
- Minimum Mosaic StoreKit target: iOS 15.

Official sources:

- <https://developer.apple.com/documentation/storekit/product/products%28for%3A%29>
- <https://developer.apple.com/documentation/storekit/product/purchaseresult>
- <https://developer.apple.com/documentation/storekit/transaction>
- <https://developer.apple.com/documentation/storekit/transaction/updates>
- <https://developer.apple.com/documentation/storekit/transaction/currententitlements>
- <https://developer.apple.com/documentation/storekit/transaction/finish%28%29>
- <https://developer.apple.com/documentation/storekit/appstore/sync%28%29>
- <https://developer.apple.com/documentation/storekit/product/subscriptioninfo/introductoryoffer>
- <https://developer.apple.com/documentation/storekit/product/subscriptioninfo/iseligibleforintrooffer>
- <https://developer.apple.com/documentation/storekit/product/subscriptionperiod>
- <https://developer.apple.com/documentation/storekit/product/displayprice>
- <https://developer.apple.com/documentation/storekit/storekiterror>
- <https://developer.apple.com/documentation/storekit/testing-at-all-stages-of-development-with-xcode-and-the-sandbox>
- <https://developer.apple.com/documentation/storekit/testing-in-app-purchases-with-sandbox>
- <https://developer.apple.com/documentation/storekit/testing-purchases-made-outside-your-app>
- <https://developer.apple.com/documentation/storekittest>

### Google and Android

- Google Play Billing Library: `9.1.0` (release notes dated 2026-06-18).
- Android min SDK: 24.
- Android compile/target SDK for the example: 36.
- Kotlin: 2.2.10.
- Java: 17.
- Coroutines: 1.10.2.

Official sources:

- <https://developer.android.com/google/play/billing/release-notes>
- <https://developer.android.com/google/play/billing/integrate>
- <https://developer.android.com/google/play/billing/migrate-gpblv9>
- <https://developer.android.com/reference/com/android/billingclient/api/ProductDetails>
- <https://developer.android.com/reference/com/android/billingclient/api/ProductDetails.SubscriptionOfferDetails>
- <https://developer.android.com/reference/com/android/billingclient/api/ProductDetails.PricingPhase>
- <https://developer.android.com/reference/com/android/billingclient/api/BillingFlowParams.ProductDetailsParams.Builder>
- <https://developer.android.com/reference/com/android/billingclient/api/QueryProductDetailsResult>
- <https://developer.android.com/google/play/billing/subscriptions>
- <https://developer.android.com/google/play/billing/lifecycle/subscriptions>
- <https://developer.android.com/google/play/billing/security>
- <https://developer.android.com/google/play/billing/errors>
- <https://developer.android.com/google/play/billing/test>
- <https://developer.android.com/google/play/billing/test-response-codes>

### Flutter

- Core compatibility baseline: Dart 3.3 / Flutter 3.19.
- Current local Dart inspected: 3.10.4.
- Flutter documentation currently recommends plugin authors support SwiftPM and
  CocoaPods while SwiftPM adoption becomes the default in newer Flutter
  releases.

Official sources:

- <https://docs.flutter.dev/packages-and-plugins/developing-packages>
- <https://docs.flutter.dev/platform-integration/platform-channels>
- <https://docs.flutter.dev/packages-and-plugins/swift-package-manager/for-plugin-authors>

## Observable acceptance criteria

1. One unchanged published Paywall resolves exact StoreKit mappings on iOS and
   exact Google Product/base-plan/offer mappings on Android.
2. No adapter matches by name, title, price, period, trial, or similarity.
3. Missing, ambiguous, archived, cross-scope, or platform-incompatible mappings
   fail safely with exact recovery.
4. Store metadata is localized and truthfully represents availability,
   billing period, trial, introductory offer, source, and freshness.
5. StoreKit succeeds only after verification and accepted local delivery;
   unverified transactions remain unfinished and never succeed.
6. Google succeeds only for purchased state after accepted local delivery and
   required acknowledgement; pending/unacknowledged never complete.
7. Cancellation, pending, unavailable, provider unavailable, and failure remain
   distinct. Neither adapter invents deferred.
8. Delayed/duplicate native callbacks yield at most one accepted app-level
   update per transaction/purchase identity.
9. StoreKit synchronization and Google active-purchase recovery remain
   semantically distinct.
10. Entitlement lookup failure remains unknown/provider unavailable/failed,
    never authoritative empty/inactive.
11. RevenueCat and custom providers retain existing v1 behavior without native
    dependencies.
12. Native adapters and Flutter bridge are optional.
13. Mapping replacement preserves immutable Paywall Versions, Releases, and
    sidecars.
14. Publishing validates structural native readiness without claiming store
    purchase success.
15. Apple sandbox and Google Play test demonstrations record unchanged Paywall
    digest/Product references and honest environmental limitations.
16. No Paywall Protocol expansion, server transaction validation, Mosaic-owned
    customer Entitlement state, Phase 5 targeting, analytics, or experiments
    are introduced.

## Design-partner demonstration

```text
Record one published Paywall digest
→ use stable Monthly and Yearly Mosaic Products
→ grant both Products the same Pro Entitlement
→ select StoreKit for iOS
→ map exact Apple Product IDs
→ load localized Apple metadata
→ complete/cancel/pending an Apple sandbox purchase
→ synchronize and inspect provider-observed Pro access
→ select Google Play Billing for Android
→ map exact Google Product and base-plan IDs
→ explicitly select an offer or No offer
→ load localized Google metadata
→ complete/cancel/pending a Google Play test purchase
→ recover active purchases and inspect provider-observed Pro access
→ prove the Paywall digest, Product IDs, Plan, grants, and Placement are unchanged
```

The one-minute demonstration is:

```text
Same Paywall
→ StoreKit purchase on iOS
→ switch active provider for Android
→ Google Play purchase
→ unchanged Mosaic Product references
```

## Complete execution model

The owner-provided prompt defines five stages. Stage 1 inspection proved the
closed v1 commerce contracts insufficient and explicitly requires owner
approval before a contract update. To avoid a second approval round, approval
of this complete plan also authorizes the narrow **Stage 1 contract-freeze
amendment** below. It is part of Stage 1 integration, not Phase 5 or a new
product stage.

At most four agents run concurrently. The root thread remains orchestrator,
resolves shared contracts, inspects every report/diff, runs integration
validation, and never delegates unresolved product decisions after this plan
is approved.

Every implementation agent report must include:

- summary;
- changed files;
- decisions applied;
- tests added and the risk protected by each;
- existing tests modified;
- checks and commands run;
- unavailable checks and failures;
- unresolved questions;
- suggested next step.

No two write-enabled agents own the same files concurrently.

## Stage 1: Inspection, integration, and contract freeze

### Stage 1A — complete

Exactly these read-only agents completed inspection:

1. `mosaic_product`;
2. `mosaic_ux`;
3. `mosaic_ios`;
4. `mosaic_android`.

They confirmed the scope, UX workflows, current official StoreKit/Google APIs,
native lifecycle requirements, minimum targets, test environments, and the
contract blockers recorded in this plan.

### Stage 1B — complete

Exactly these read-only agents completed inspection:

1. `mosaic_protocol`;
2. `mosaic_backend`;
3. `mosaic_dashboard`;
4. `mosaic_flutter`.

They confirmed that v1 cannot be extended in place safely and froze the
recommended architecture, ownership, and compatibility direction recorded
here.

### Stage 1 contract-freeze amendment — authorized by the single approval

Use exactly one write-enabled `mosaic_protocol` agent. No other agent writes
concurrently.

Ownership:

- `protocol/schema/commerce-provider/v2/**`;
- `protocol/schema/commerce-configuration/v2/**`;
- v2 compatibility manifests;
- v2 fixtures;
- protocol validators/generators and generated browser declarations;
- `docs/protocol/commerce-provider-v2.md`;
- `docs/protocol/commerce-configuration-v2.md`;
- protocol changelog/versioning documentation.

Forbidden:

- Paywall Protocol `0.1` and `0.2`;
- Configuration Delivery `1`;
- SDK, backend, dashboard, examples, and deployment files;
- modification of v1 semantics or fixtures except adding explicit
  compatibility tests proving continued acceptance.

Deliverables:

1. closed Commerce Provider Contract `2`;
2. closed Commerce Configuration `2`;
3. exact native activation, mapping, grants, recovery modes, normalized
   updates, and local-acceptance lifecycle;
4. v1/v2 negotiation and fallback rules;
5. minimum fixtures for StoreKit, Google Play, delayed completion, recovery,
   unavailable Product, and failed Entitlement lookup;
6. generated browser declarations;
7. passing protocol validation and drift checks.

Gate:

- root inspects the schema/diff and runs protocol checks;
- no backend or SDK implementation begins until v2 is frozen;
- any newly discovered product decision stops implementation rather than being
  invented by the protocol agent.

## Stage 2: Backend and Dashboard implementation

Use exactly:

1. `mosaic_backend`;
2. `mosaic_dashboard`.

These are the only write-enabled agents during Stage 2. They run concurrently
only after v2 and the initial OpenAPI request/response shapes are frozen.

### Stage 2 dependency order

1. Backend implements migration/domain/service/OpenAPI source.
2. Backend generates and validates the dashboard REST client.
3. Dashboard consumes the generated client and implements UI.
4. Backend and Dashboard complete their focused tests.
5. Root runs combined Stage 2 validation and inspects for contract drift.

The Dashboard agent must not manually edit generated API files. If a generated
contract is wrong, Backend changes OpenAPI and regenerates it before Dashboard
continues.

### Backend ownership and work packages

Owned paths:

- `apps/api/**`;
- `apps/worker/**` only if an existing worker boundary needs documentation,
  never a new store worker;
- `docs/backend/openapi.yaml`;
- backend-specific documentation and tests;
- `apps/api/migrations/00008_native_store_providers.sql`.

Forbidden:

- every SDK;
- Paywall Protocol files;
- dashboard source other than generated-client output produced by the
  established generator;
- server store credentials, store HTTP clients, receipts, purchase tokens,
  transactions, or customer Entitlement state.

Work Package 1 — native provider types:

- retain `app_store` and `google_play` storage/API identifiers;
- add the credential-free activation union;
- preserve RevenueCat/custom connection activation;
- enforce platform compatibility and no fallback.

Work Package 2 — mappings:

- StoreKit Product mapping;
- Google Product/base-plan/optional offer mapping;
- provider-aware active uniqueness so prepared providers can coexist;
- explicit replacement self-reference;
- mapping-specific usage;
- tenant/application/environment/platform integrity.

Work Package 3 — observations and diagnostics:

- authenticated test-client observation ingestion;
- bounded immutable observations;
- exact store context and timestamps;
- safe metadata/diagnostic fields only;
- no transaction or customer data;
- mapping/assignment-scoped diagnostics.

The authenticated ingestion path is a browser-session/developer test relay
under the existing dashboard trust boundary. A public SDK key cannot assert
`verifiedInTest` in Gate 4B. This avoids spoofable production-readiness
evidence.

Work Package 4 — readiness:

- compute configured/verified-in-test/attention/unavailable/archived;
- distinguish structural readiness from observation evidence;
- leave readiness computed rather than persisted;
- preserve RevenueCat/custom readiness behavior.

Work Package 5 — publishing:

- validate every Product/Application/Environment/platform;
- emit exact blockers, warnings, affected resources, and recovery actions;
- compile immutable credential-free Commerce Configuration v2;
- include exact mappings and Product Entitlement grants;
- preserve v1 sidecars for RevenueCat/custom where appropriate;
- never claim store purchase success.

Work Package 6 — audit/OpenAPI/migration:

- audit assignment and mapping mutations, accepted observations, and safe
  publish rejection codes;
- add only the required Goose migration;
- add constraints, foreign keys, deletion behavior, and justified indexes;
- document every REST resource and regenerate the client.

Backend tests protect:

- activation union/platform compatibility;
- RevenueCat/custom regression;
- mapping shape and ambiguity;
- provider coexistence and exact active resolution;
- cross-tenant and cross-scope rejection;
- replacement/immutable history;
- observation immutability and authorization;
- readiness blocker/warning policy;
- v2 sidecar exact content and secret/token absence;
- PostgreSQL constraints/transactions;
- safe transport errors and audit events.

### Dashboard ownership and work packages

Owned paths:

- Catalog native mapping and Product coverage UI;
- Purchase setup and active-provider UI;
- readiness and test-evidence UI;
- publishing recovery;
- commerce-only Studio indicators;
- feature-specific tests and dashboard documentation.

Forbidden:

- backend/OpenAPI source;
- generated API files by hand;
- protocol and SDK files;
- Catalog or Studio redesign;
- new top-level Base Plan/Offer navigation;
- provider identifiers in Paywall documents;
- Radix UI or Lucide application imports.

Work Package 1 — Purchase setup:

- retain `/catalog/providers`;
- label it Purchase setup;
- require explicit Environment;
- show direct built-in StoreKit/Google choices by platform;
- keep RevenueCat/custom Connections as progressive detail;
- show affected Products/Paywalls and readiness before replacement.

Work Package 2 — Product coverage and mappings:

- cross-platform coverage matrix;
- pre-scoped StoreKit mapping form;
- pre-scoped Google Product/base-plan/offer form;
- explicit No offer;
- provider-owned metadata read-only;
- mapping usage/replacement/archive;
- environment/store-context/freshness labels.

Work Package 3 — readiness and diagnostics:

- render backend-authoritative states;
- show provider capabilities without false normalization;
- show exact affected platform and recovery;
- distinguish current live client metadata, observed snapshot, synchronized
  snapshot, and mock data.

Work Package 4 — publishing recovery:

- exact Product/Application/Environment/platform recovery route;
- safe `returnTo`;
- preserve Draft and Publish context;
- reopen, refetch, and revalidate after recovery;
- announce cleared or remaining blockers.

Work Package 5 — Studio:

- require explicit Application selection;
- show active provider, platform coverage, mapping state, capability warnings,
  and diagnostics links;
- retain mock fallback with a persistent non-verification label;
- never mutate the Paywall document with provider data.

Dashboard tests protect:

- explicit scope selection;
- native assignment without fictional connections;
- wrong-platform rejection;
- StoreKit/Google form invariants;
- usage-before-replacement;
- context-preserving publish recovery/revalidation;
- Studio explicit Application selection;
- provider-independent Paywall export.

### Stage 2 validation

Backend:

```bash
gofmt -w <changed-go-files>
go test ./...
go vet ./...
go run ./cmd/migrate up
go run ./cmd/migrate status
```

Run PostgreSQL integration tests with an explicit disposable
`DATABASE_TEST_URL`. Migration evidence must cover both an empty database and
the accepted `00007` baseline. API startup must still fail without PostgreSQL.

Dashboard:

```bash
npm run generate:api
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

OpenAPI/client drift:

```bash
npm run generate:api
git diff --exit-code -- apps/dashboard/src/generated/api
```

The first generation is expected to change generated output; the second
generation must be clean.

## Stage 3: Native SDK implementation

Use exactly:

1. `mosaic_ios`;
2. `mosaic_android`;
3. `mosaic_flutter`.

Each agent owns only its SDK, adapter modules, examples, tests, and platform
documentation. The frozen v2 schemas/fixtures are read-only inputs.

### Stage 3 dependency order

1. iOS and Android implement reusable native adapters concurrently.
2. Each freezes its native module API and produces a passing focused suite.
3. Flutter consumes those frozen modules and implements the thin bridge.
4. Native agents remain available for bounded bridge integration fixes only
   within their owned modules.
5. Root runs cross-SDK contract and optional-dependency validation.

### iOS ownership and deliverables

Owned:

- `sdk/ios/StoreKit/**`;
- required provider-neutral changes in `sdk/ios/**`;
- iOS example integration and StoreKit Configuration;
- iOS tests and documentation.

Forbidden:

- Android/Flutter/backend/dashboard/protocol files;
- server validation;
- StoreKit types in `MosaicSDK` public commerce API.

Deliver:

- optional `MosaicStoreKit`;
- exact Product loading and metadata;
- transaction observer/unfinished sweep;
- verification and local acceptance before finish;
- idempotent delayed updates;
- current Entitlements and user-initiated sync;
- capability profile and safe diagnostics;
- deterministic StoreKitTest evidence;
- example provider switching without Paywall changes.

Validation:

```bash
swift test
```

Use the configured Xcode project/scheme and Simulator through the established
XcodeBuild workflow for:

- package/example build;
- focused StoreKitTest tests;
- application launch and runtime diagnostics;
- unavailable signed-device/sandbox checks recorded honestly.

### Android ownership and deliverables

Owned:

- new `sdk/android/mosaic-google-play/**`;
- required provider-neutral changes in `sdk/android/mosaic/**`;
- Android example integration;
- Android tests and documentation.

Forbidden:

- iOS/Flutter/backend/dashboard/protocol files;
- server validation;
- Google Billing types in the public core API.

Deliver:

- optional `:mosaic-google-play`;
- BillingClient lifecycle;
- exact Product/base-plan/offer selection;
- runtime-only offer token;
- metadata/pricing-phase normalization;
- pending and delayed update processing;
- local acceptance before acknowledgement;
- active-purchase recovery and access observation;
- capability profile and safe diagnostics;
- debug-only Play response simulation configuration;
- example provider switching without Paywall changes.

Validation:

```bash
./gradlew :mosaic:test :mosaic:lint :mosaic:assemble
./gradlew :mosaic-google-play:test :mosaic-google-play:lint :mosaic-google-play:assemble
```

Run connected/instrumented checks only where a configured emulator/device and
Play environment exist; unavailable checks remain explicit.

### Flutter ownership and deliverables

Owned:

- provider-neutral Dart commerce changes in `sdk/flutter/**`;
- `sdk/flutter/packages/mosaic_native_store/**`;
- Flutter example integration;
- Flutter tests and documentation.

Forbidden:

- independent StoreKit/Billing business logic;
- third-party purchase plugin;
- provider-native public Dart objects;
- edits to native modules except via bounded follow-up assigned to their owner.

Deliver:

- optional thin-bridge plugin;
- StoreKit/Google provider factories;
- closed versioned channel codec;
- normalized method calls and commerce update stream;
- router invalidation/disposal;
- engine/activity lifecycle handling;
- safe plugin-missing/platform-unavailable behavior;
- dual SwiftPM/CocoaPods-compatible iOS integration;
- Maven Android integration;
- example using the same Paywall/Product IDs.

Validation for core and each optional package:

```bash
dart format --output=none --set-exit-if-changed .
flutter analyze
flutter test
```

Build the example for iOS Simulator and Android debug where toolchains are
available. Verify core tests/builds without `mosaic_native_store` or
RevenueCat installed.

### Stage 3 cross-SDK validation

- all three SDKs decode canonical v1 and v2 fixtures;
- RevenueCat/custom v1 behavior remains supported;
- native adapters are absent from core dependency graphs;
- adapter IDs/versions/capabilities exactly match v2 sidecars;
- cancellation and pending remain distinct;
- delayed updates deduplicate;
- Entitlement failure never becomes inactive;
- Paywall Protocol files and published documents remain unchanged;
- diagnostics contain no sensitive provider material.

## Stage 4: Sandbox and test demonstration

Stage 4 begins only after Stage 2 and Stage 3 deterministic checks pass.

### Evidence record format

Every run records:

- date/time and operator;
- commit and branch;
- application/build version;
- physical device or Simulator/emulator;
- OS and store client version;
- Mosaic Environment;
- explicit store test context;
- adapter ID/version and capabilities;
- Configuration Release/Commerce Configuration ID and digest;
- stable Mosaic Product IDs and mapping IDs;
- Paywall document digest before/after;
- localized Product metadata;
- immediate purchase result;
- delayed update result where exercised;
- native finalization state;
- restore/recovery result;
- provider-observed Entitlement result;
- safe diagnostics;
- screenshots/log excerpts containing no secrets;
- pass, fail, or unavailable with reason.

### Apple demonstration

1. Run StoreKit Configuration deterministic integration.
2. Configure exact App Store Connect Products.
3. Use a Sandbox Apple Account on an accepted signed environment.
4. Load localized subscription/non-consumable metadata.
5. Present the same published Paywall.
6. Complete a verified purchase.
7. Demonstrate cancellation.
8. Demonstrate Ask to Buy/pending and delayed update where available.
9. Interrupt/relaunch and prove recovery/deduplication.
10. Run user-initiated store synchronization.
11. Inspect current provider-observed Entitlements.
12. Prove finish occurred only after accepted local delivery.

### Google demonstration

1. Use a package-matching Play Console application and test track/licensed
   sideload.
2. Use a license tester and current Play Store.
3. Map exact Product/base-plan and explicit offer/No offer.
4. Load localized ProductDetails/pricing phases.
5. Present the same published Paywall.
6. Complete a purchase and required acknowledgement.
7. Demonstrate cancellation.
8. Demonstrate pending/slow approval and delayed completion where available.
9. Interrupt/relaunch and recover active purchases.
10. Inspect provider-observed Entitlements.
11. Prove acknowledgement occurred only after accepted local delivery.
12. Exercise already-owned and safe unavailable/decline diagnostics.

### Cross-provider demonstration

Use the same:

- Product IDs;
- Plan;
- Entitlement grants;
- Paywall document and digest;
- Placement;
- Configuration Release reference set.

Change only the active provider and Provider Product Mapping. Record the
before/after equality proof.

### Stage 4 decision

The real Apple and Google purchase paths are core Gate objectives. If either is
unavailable, Stage 4 records honest deterministic evidence but Gate 4B is
**Rejected pending demonstration**, not accepted with a passing claim.

## Stage 5: Product, UX, Protocol, and Quality review

Use exactly these read-only agents:

1. `mosaic_product`;
2. `mosaic_ux`;
3. `mosaic_protocol`;
4. `mosaic_quality`.

No production or documentation file is modified during the initial review.

### Product review

Confirm:

- scope stayed inside Gate 4B;
- stable Products/Paywalls remained provider-independent;
- provider objects remained adapter details;
- provider-owned customer Entitlement authority;
- no server billing engine, Phase 5 targeting, analytics, or experiments;
- Design-Partner Alpha credibility matches actual demonstration evidence.

Return Approve, Approve with changes, Reject, or Owner decision required.

### UX review

Review:

- Apple and Google mapping;
- base-plan/offer selection;
- explicit scope/provider selection;
- readiness and publishing recovery;
- sandbox/production distinction;
- replacement/usage;
- diagnostics and recovery terminology;
- Apple sync versus Google active recovery;
- permission states and dead ends.

Every blocked action must have a valid next step.

### Protocol review

Confirm:

- Paywall Protocol `0.1`/`0.2` unchanged;
- v1 preserved;
- v2 remains provider-independent;
- no native object/provider identifier leaked into Paywalls;
- result/update/recovery semantics are compatible and explicit;
- unsupported capabilities remain explicit.

### Quality review

Review current official APIs and exact code for:

- StoreKit verification/finish/update recovery;
- Google pending/acknowledgement/recovery;
- local delivery ordering;
- duplicate callback idempotency;
- exact mapping and offer selection;
- activation/platform validation;
- optional dependencies and Flutter reuse;
- main-thread/cancellation safety;
- diagnostics/security;
- PostgreSQL isolation and immutable history;
- test and real-environment evidence.

Return findings ordered by severity with exact paths/symbols.

## Final fix pass and review limit

The root classifies every finding as blocking, required nonblocking, or
speculative.

Assign:

- protocol-contract findings to `mosaic_protocol`;
- backend findings to `mosaic_backend`;
- dashboard findings to `mosaic_dashboard`;
- iOS findings to `mosaic_ios`;
- Android findings to `mosaic_android`;
- Flutter findings to `mosaic_flutter`.

Rules:

1. Agents retain original owned paths.
2. Do not run write-enabled agents on overlapping files.
3. Reject speculative nice-to-have work.
4. Rerun affected focused checks after every fix.
5. Rerun complete Gate validation after integration.
6. Request one targeted final `mosaic_quality` review.
7. Limit the fix/review cycle to two rounds.
8. If a blocking issue remains, classify Gate 4B as rejected pending fixes.

## Complete Gate validation matrix

Protocol:

```bash
npm --prefix protocol run generate
npm --prefix protocol run check
git diff --exit-code -- protocol/generated
```

Backend:

```bash
cd apps/api
go test ./...
go vet ./...
go run ./cmd/migrate status
```

Run migrations and PostgreSQL integration against empty and accepted-baseline
databases. Run `gofmt` on changed Go files.

Dashboard:

```bash
cd apps/dashboard
npm run generate:api
npm run check
```

Flutter core, RevenueCat adapter, and native-store plugin:

```bash
dart format --output=none --set-exit-if-changed .
flutter analyze
flutter test
```

iOS core, RevenueCat adapter, and StoreKit package:

```bash
swift test
```

Also build/test the example through the configured Xcode Simulator workflow.

Android core, RevenueCat adapter, and Google adapter:

```bash
./gradlew test lint assemble
```

Repository:

```bash
git diff --check
git status --short
```

Also verify:

- no Radix or Lucide application imports;
- no Paywall Protocol changes;
- no provider identifiers in Paywall fixtures/documents;
- no production in-memory persistence;
- no Apple/Google server credentials or transaction/customer tables;
- RevenueCat/custom optional dependency boundaries;
- complete Stage 4 evidence.

Unavailable checks must name the missing dependency/environment and affected
risk. A skip is never a pass.

## Gate 4B review document contract

After validation and reviews, the root creates:

```text
docs/reviews/phase-4b.md
```

Required sections:

### Status

Exactly one:

- Accepted;
- Accepted with tracked follow-ups;
- Rejected pending fixes.

Core Apple and Google demonstration absence requires Rejected pending fixes.

### Baseline

- full base commit;
- branch and worktree;
- Gate 4A review;
- StoreKit/Xcode/OS targets;
- Google Billing/Android targets;
- Flutter integration/distribution;
- official documentation consulted.

### Completed deliverables

Group by:

- commerce v2 and v1 compatibility;
- StoreKit adapter;
- Google Play Billing adapter;
- Flutter integration;
- mappings/base plans/offers;
- active-provider selection;
- readiness/observations/publishing;
- dashboard/Studio;
- documentation;
- tests.

### Product review

- Product stability;
- Entitlement authority;
- provider independence;
- Phase 5/9 deferrals;
- Design-Partner Alpha readiness.

### UX review

- mapping/provider workflows;
- base-plan/offer selection;
- readiness/recovery;
- environment distinction;
- diagnostics/replacement;
- restore differences;
- dead ends/terminology.

### Engineering review

- verification/finalization;
- pending/cancellation/recovery;
- mapping and activation integrity;
- capabilities and Flutter reuse;
- tests, unavailable checks, and defects.

### Security review

Confirm:

- no Apple/Google server credentials;
- no secrets in diagnostics;
- tenant isolation;
- no server transaction validation;
- no authoritative customer Entitlement database.

### Demo review

State separately whether Apple, Google, cross-provider, and one-minute demos
passed, failed, or were unavailable.

### Decision

Exactly one:

- Gate 4B accepted; create consolidated Phase 4 review;
- Gate 4B accepted with tracked follow-ups; create consolidated Phase 4 review;
- Gate 4B rejected pending fixes.

This Gate 4B execution stops after producing the review. It does not create the
consolidated Phase 4 review, begin Phase 5, merge, or tag.

## Final acceptance matrix

Gate 4B can be accepted only when every required criterion below has evidence:

- Gate 4A, RevenueCat, and custom providers remain functional;
- StoreKit and Google adapters are optional;
- exact stable Product mapping works;
- localized price, period, trial, intro/offer, and availability resolve;
- Apple sandbox and Google Play test purchases pass;
- cancellation/pending/failure remain distinct;
- no invented deferred outcome;
- Apple verification and finish ordering pass;
- Google purchase state and acknowledgement ordering pass;
- delayed/interrupted recovery and deduplication pass;
- Apple synchronization and Google active recovery pass;
- provider-observed Entitlement lookup passes;
- failed lookup never becomes inactive;
- Flutter exposes one provider-independent API;
- missing/ambiguous mappings and offers fail safely;
- mapping replacement preserves immutable history;
- readiness/publishing recovery is exact and truthful;
- capabilities and store differences remain visible;
- Paywall documents/digests and Mosaic Product IDs remain unchanged;
- v1 compatibility remains;
- Paywall Protocol remains unchanged;
- no server validation/customer Entitlement state/Phase 5/analytics/experiments;
- all available relevant checks pass;
- unavailable checks are documented without false success.

## Single approval decision

One owner approval of this document approves the complete Gate 4B execution
contract and authorizes every stage above, including the necessary Stage 1
contract-freeze amendment.

The approved decisions are:

1. parallel Commerce Provider/Configuration `2`, retaining v1;
2. credential-free `nativeStore` activation;
3. exact Google Product/base-plan/optional offer, runtime-only offer token, no
   guessed fallback;
4. native access derived through immutable Mosaic Product Entitlement grants;
5. provider-neutral asynchronous updates and local acceptance before
   finish/acknowledgement;
6. explicit StoreKit synchronization and Google active-purchase recovery modes;
7. configured/verified-in-test/attention/unavailable/archived readiness;
8. authenticated browser-session/developer relay for verification evidence;
9. missing/stale evidence warns, structural/explicit failure blocks, while both
   real demonstrations remain mandatory for Gate acceptance;
10. one optional Mosaic-owned Flutter thin bridge with dual
    SwiftPM/CocoaPods-compatible iOS and Maven Android distribution;
11. iOS 15, Android API 24, Google Billing 9.1.0, and the versions recorded in
    this plan;
12. prepaid/installment plans, subscription replacement, and ambiguous
    multi-offer one-time Products remain deferred;
13. Purchase setup user-facing information architecture with explicit
    Environment and Application;
14. at most two fix/review rounds;
15. stop after `docs/reviews/phase-4b.md`, with no automatic merge, tag,
    consolidated Phase 4 review, or Phase 5 work.

After this single approval, implementation proceeds through the complete plan
without another design approval checkpoint. The root may stop only for a new
material decision outside this approved contract, unavailable authority, or a
blocking external environment required by the acceptance criteria.
