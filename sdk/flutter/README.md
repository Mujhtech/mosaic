# Mosaic Flutter SDK — Configuration Delivery v1/v2/v3

## Experiments

Delivery v3 and Experiment Assignment v1 extend an eligible Control decision
locally using deterministic cross-platform SHA-256 assignment. Existing
Placement APIs are unchanged. Candidates that are inactive, unsupported,
time-unreliable, group-excluded, or unready do not replace the normal Placement
result.

Same-Placement Experiment candidates are evaluated by stable Experiment ID;
mutual-exclusion admission may continue to the admitted candidate, while a
selected candidate's Product or provider failure never selects another member.

Hosted clients enqueue Analytics Event v2 assignment,
presentation-confirmed exposure, and explicit fallback events through the
default durable analytics queue and transport. A custom
`MosaicExperimentAnalyticsSink` remains available for tests. QA overrides never
emit statistical exposure.

Conversion events are emitted on Analytics Event v2 carrying the same immutable
Experiment tuple whenever the presented Paywall is a successfully exposed
original Variant: `product_selected`, `purchase_started`,
`purchase_completed_client`, and the rest of the purchase lifecycle. Experiment
results join a conversion to an exposure solely on that tuple, so a conversion
emitted on v1 would silently count as zero. Conversions from a fallback
presentation or a QA override are emitted without the tuple, because neither is
an exposed Variant presentation and attributing them to the Variant would count
a normal-Paywall outcome as a Variant outcome. Presentation, Placement, restore,
and Product-availability events never carry the tuple.

The default assignment store persists only one-way
subject digests, is backup-excluded, and is atomically bounded to 256 records
and 180 days. Trusted server and local receipt anchors are cached with Delivery
v3 so valid schedules remain evaluable across restart.

This package provides a strict reader for Mosaic Protocol 0.3
and renders it with native Flutter widgets. It includes hosted Configuration
Delivery v1/v2/v3, persistent cache and bundled-release fallback, Placements,
localization and RTL,
bundled fallback loading, mock commerce, normalized results, diagnostics,
accessibility semantics, native rendering, Local Preview 0.3 support, and the
provider-neutral Commerce Configuration v1/v2 custom-provider boundary, and
Analytics Event Contract v1/v2 collection with a persistent bounded queue.

Protocol 0.3 replaces 0.2 outright. There is no migration path and no dual
version support: a 0.2 document is an unknown version to this reader and is
rejected atomically, resolving through last-accepted, then bundled fallback,
then configuration unavailable.

Over its predecessor, 0.3 adds four components — Tabs, Timeline, Award, and
Social Proof — tab selection as runtime state and as a `visibility` condition,
and the reserved accessibility strings `mosaic.a11y.rating` and
`mosaic.a11y.in_progress`. It carries forward document design-system tokens,
solid/linear/radial/media backgrounds, native shadows, uniform width and height
Fit/Fill/Fixed sizing, remote and bundled image/video assets, native
Screen/Sheet presentation, generalized Buttons and Stacks, authored Product
Cards and Badges, safe product templates, navigation, Carousel, Switch,
Countdown, and conditional visibility.

Tabs presents two through eight labelled panels with exactly one visible. The
initially selected tab is always authored through `initialTabId`, so reordering
the array cannot change which panel opens, and `selectedLabelColor` is required
so that "the label colour deliberately does not change" and "the label colour
was never authored" cannot share an encoding. A `{"mode": "tab"}` visibility
condition removes a node from layout, the accessibility tree, and focus order
exactly as a false Switch condition does.

Timeline draws two through twelve ordered vertical entries over one continuous
connector, with a closed `dot`/`ordinal`/`icon` marker union. An absent marker
means no glyph and an unbroken connector, never a substitute glyph; marker and
description styling is required exactly when an entry consumes it and forbidden
when none does.

Award and Social Proof are passive. A Social Proof rating counts steps against
a points maximum in integers only, and is announced by substituting the
resolved `mosaic.a11y.rating` catalog string — the renderer composes no
connective of its own, and the numerals are ASCII by contract so that three
renderers produce the same bytes.

Accessibility announcements are never joined. Each segment is its own element
inside a labelled container, in protocol order, and the platform supplies
whatever pause or punctuation its locale and screen reader use; joining with
`". "` would be renderer-invented punctuation exactly as a hardcoded "out of"
is a renderer-invented word. An absent optional segment produces no element,
never an empty one, and avatars, emblems, markers, and connectors are
decorative — drawn, never announced, never focusable. A Button is a single
element whose authored name is unchanged while busy; the resolved
`mosaic.a11y.in_progress` is its value, and its content is not announced in
either state.

The SDK never migrates a document implicitly.

Real billing adapters remain optional sibling packages, so core applications do
not resolve or embed RevenueCat, StoreKit, or Google Play Billing.

## Advanced Placement decisions

Delivery v2 adds strict Placement Decision v1 decoding and local deterministic
evaluation while preserving Delivery v1 and `MosaicPlacementHost`. A candidate
is accepted only after all Rules, immutable Paywalls, exact Product and
Entitlement references, exact embedded/release compatibility unions,
Paywall-unavailable fallback paths, and digests validate. Delivery v2 also
requires an explicit development, staging, or production Environment mode;
QA overrides are accepted only in development or staging and for at most 24
hours. Rejected candidates leave the complete last-known-valid release intact.

The SDK persists a random app-install identity separately from configuration.
Host user identity, typed attributes, and country are explicit:

```dart
await mosaic.loadIdentity();
await mosaic.identify('account_123');
await mosaic.setUserAttributes({
  'student': const MosaicBooleanAttribute(true),
});

final decision = await mosaic.decidePlacement(
  'export_pdf',
  inputs: const MosaicPlacementDecisionInputs(
    applicationLocale: 'en-US',
    country: 'DE', // Never inferred from locale.
  ),
);

await mosaic.resetUserIdentity(); // retains installation identity
await mosaic.resetInstallationIdentity(); // rotates install and clears user state
```

Results distinguish `MosaicPlacementDecisionPaywall`,
`MosaicPlacementNoPaywall`, and `MosaicPlacementUnavailable`. They carry a
bounded privacy-safe trace, matched Rule ID, assignment-key type, rollout
bucket, and fallback path without raw identity or attribute values. Product and
Entitlement observations remain provider-owned and preserve unknown,
provider-unavailable, and failed states. Presentation performs no
configuration request and evaluates cached or bundled snapshots offline.

## Analytics, identity, and privacy

Analytics is enabled by default: a client configured with a base URL wires the
analytics runtime and begins queueing Mosaic's own product events. Hosts opt
*out* through `analyticsEnvironmentSettings` or `analyticsHostEnabled`, or later
through `setAnalyticsCollection`; a host override may disable but can never
override a disabled Environment. The host application is responsible for
obtaining whatever end-user consent its jurisdiction and app-store policies
require before leaving collection enabled. The Environment's server-side
collection setting still gates ingestion, so events are only accepted once
Mosaic is configured to collect them.

```dart
final mosaic = Mosaic.configure(
  publicSdkKey: 'public_sdk_key',
  baseUrl: Uri.parse('https://mosaic.example.com'),
  applicationId: 'app_ios',
  applicationVersion: '4.2.0',
  purchaseProvider: provider,
  // Opt out explicitly; omit both arguments to keep the enabled default.
  analyticsEnvironmentSettings: const MosaicAnalyticsEnvironmentSettings(
    collectionEnabled: false,
  ),
  analyticsHostEnabled: consentAllowsCollection,
);

await mosaic.setAnalyticsCollection(
  environmentEnabled: environmentSetting.collectionEnabled,
  hostEnabled: consentAllowsCollection,
);
final result = await mosaic.flushAnalytics();
final diagnostics = await mosaic.analyticsDiagnostics();
```

Disabling collection atomically clears unsent events. Re-enabling begins a new
30-minute-inactivity session and does not reconstruct missed events. Events
snapshot installation, optional application user, generation, session,
correlation, and immutable attribution at occurrence time; identity changes
never rewrite queued history. `resetIdentity()` clears user-bound state while
retaining installation identity. `resetInstallationIdentity()` rotates the
installation and clears user-bound state.

The app-private queue is atomically persisted, expires events after seven
days, and is bounded to 1,000 events/2 MiB. Events are limited to 32 KiB,
sends to 50 events/512 KiB, and retries to 10 attempts with full-jitter
exponential backoff from one second to five minutes. Accepted, duplicate, and
permanently rejected partial-batch results are removed; only retryable results
remain. A malformed acknowledgement retains the complete sent batch.
Analytics delivery is always best effort and never changes Placement,
rendering, purchase, or restore results. Local Preview, lower-level local
`MosaicPaywall`, and bundled/unhosted paywalls do not emit hosted analytics.

## Transaction observation handoff

Off by default. When a host opts in, Mosaic reports the *reference* of a
completed purchase so the server can begin validating it. It is a trigger, not
proof.

```dart
final mosaic = Mosaic.configure(
  publicSdkKey: 'public_sdk_key',
  baseUrl: Uri.parse('https://mosaic.example.com'),
  applicationId: 'application_ios',
  storePlatform: MosaicStorePlatform.ios,
  purchaseProvider: provider,
  transactionObservation: const MosaicTransactionObservationSettings(),
);

await mosaic.setTransactionObservation(hostEnabled: consentAllowsHandoff);
final result = await mosaic.flushTransactionObservations();
final diagnostics = await mosaic.transactionObservationDiagnostics();
```

What it never does:

- It never claims a transaction is validated, verified, confirmed, or
  entitled. The submission result has four members and none of them means
  that. `serverConfirmedTransactions` remains unsupported.
- It never blocks, delays, or changes a purchase. The renderer's sink returns
  `void`, is never awaited, and a sink that throws cannot become a failed
  purchase.
- It never carries a credential. The reference is structurally bounded to the
  contract's shape for the Store Platform: a raw decimal App Store transaction
  identifier, or the SHA-256 digest of a Google Play purchase token in
  lowercase hexadecimal. An Apple JWS representation, a device-verification
  value, a raw purchase token, and a `mock-*`/`preview-*` placeholder all fail
  that check and are dropped and counted. No App Store key, Google
  service-account key, or shared secret can be configured into the SDK.
- It never emits an entitlement, price, subject, tenant identity, or Store
  Environment assertion, and it never rides on the analytics queue or the
  analytics consent decision. `sourceAuthority` is always `client_observation`:
  an observation can trigger validation, never author a fact.
- It never guesses. The response must be a Billing Ingestion Contract 1
  `observationSubmissionResult` record; any other shape, contract version,
  record type, or status is retried under the bounded attempt limit rather
  than being read as acceptance or rejection.

How it behaves:

- Two sources feed it: the purchase result the renderer received, and
  asynchronous Commerce Provider updates whose outcome is `purchased`, which
  also cover store-replayed renewals and out-of-band purchases. Both produce
  the same deterministic submission identifier, so one purchase is submitted
  once.
- The queue lives in app-private application-support storage, is written
  atomically after every mutation, and survives an app restart with the same
  submission identifier, so a retry after an ambiguous timeout is answered
  `duplicate` rather than creating a second record. It is bounded to 128
  observations/64 KiB, expires after 14 days, and retries at most 10 times with
  full-jitter exponential backoff honouring an explicit `Retry-After`.
- Disabling collection clears the queue and deletes the persisted document.
- A `MosaicStorePlatform` is required, because it determines the contract's
  reference kind and store platform. Without one the handoff stays disabled
  rather than guessing. A Commerce Provider identity is also required on each
  record; an observation that has none is dropped and counted as `incomplete`
  rather than sent malformed.
- There is no background-execution machinery. An observation queued just
  before the app is killed is delivered on the next launch. Store
  Notifications, not this handoff, are the authoritative and timely ingestion
  path.
- Every storage and network failure degrades to a stable safe code and never
  throws into the host application.
- When authoritative entitlements are configured and a Customer Access Token is
  held, the submission carries it in a `Mosaic-Customer-Token` header so the
  purchase binds to the identified Billing Customer rather than only to a
  purchase-anchored one. The contract record is unchanged; this is transport
  only. The token is read at send time, never stored with the queue, and never
  logged, and reading it never mints one — a signed-out submission simply omits
  the header.

## Authoritative entitlements (Mosaic Billing)

Off by default, and **it requires an application backend**. Mosaic Billing has
no anonymous mode: a Customer Access Token is minted by your own server, and a
client-generated installation identifier can never create or select a Billing
Customer. Without a `customerTokenProvider` the subsystem is never constructed
and every authoritative read reports `unavailable`.

```dart
final mosaic = Mosaic.configure(
  publicSdkKey: 'public_sdk_key',
  baseUrl: Uri.parse('https://mosaic.example.com'),
  purchaseProvider: provider,
  customerTokenProvider: (request) async {
    // Your backend mints the token. Return null when nobody is signed in.
    final minted = await yourBackend.mintMosaicToken(
      userId: request.userId,
      forceRefresh: request.forceRefresh,
    );
    if (minted == null) return null;
    return MosaicCustomerToken(
      value: minted.token,
      tokenId: minted.tokenId,
      expiresAt: minted.expiresAt,
    );
  },
);

await mosaic.identify('user_1042');
await mosaic.refreshCustomerEntitlements();

final pro = mosaic.checkCustomerEntitlement('pro');
switch (pro.state) {
  case MosaicCustomerAccessState.active:   // grant, and show pro.isStale
  case MosaicCustomerAccessState.inactive: // Mosaic looked and found nothing
  case MosaicCustomerAccessState.unknown:  // Mosaic could not find out
  case MosaicCustomerAccessState.unavailable: // Mosaic could not answer
}
```

### Authoritative versus provider-observed

The two coexist and answer different questions. The accepted v2 authority epoch
chooses exactly one source for placement targeting; grants are never unioned.
Before the first authority sync, targeting remains `unknown` rather than
guessing a source.

| | Provider-observed (`MosaicEntitlement`, `activeEntitlements()`) | Authoritative (`MosaicCustomer…`) |
| --- | --- | --- |
| Answers | What did the store just tell this device? | What has Mosaic validated, and why? |
| Source | StoreKit, Play Billing, or RevenueCat, on this device | Mosaic's projection of validated provider facts |
| Survives reinstall | Only after a native restore | Yes, it is server state |
| Placement targeting | Used for `source` and `source_rollback` authority | Used only for `mosaic` authority |
| Result vocabulary | `MosaicEntitlement` set | Four access states plus an explanation |

Observe `mosaic.customerAuthority` or the replaying
`mosaic.customerAuthorityUpdates` stream to inspect the accepted epoch, scope,
transition state, and `source`, `mosaic`, or `source_rollback` kind. Call
`refreshCustomerAuthorityUrgently()` when the host needs to await the same
single-flight sync explicitly. On application resume, Mosaic completes this
authority sync before refreshing hosted configuration.

An accepted v2 snapshot stores its authority, snapshot, and
`snapshotAuthorityDigest` atomically. Later sync requests include that digest
only while the retained customer, scope, and authority epoch still verify;
missing or mismatched cache evidence requests a full snapshot. If the server
reports `policy_unavailable`, Mosaic exposes safe `unavailable` without
inventing minimum-support values or converting the result to `inactive`. It
also invalidates the retained authority snapshot before reporting that result,
so a restart cannot replay access under a support policy the server could not
verify. The invalidation is an atomic durable tombstone, not a best-effort
delete, and the next valid full response atomically replaces it. If storage
cannot persist that tombstone, Mosaic clears current in-memory access, reports
`entitlements.authority.policy_invalidation_persistence_failed`, and retries
the tombstone before any later cache bootstrap or authority sync. It also
attempts to delete the old durable snapshot through the cache abstraction so a
cold restart remains fail-closed. If storage rejects both operations, the
severe diagnostic and in-process request gate remain; the SDK does not claim
durability while storage is unavailable.

### The rule that matters most

**Any rejection yields `unknown` and preserves the cache. Never `inactive`.**

`inactive` means Mosaic looked, found no qualifying source, and is confident. It
is never inferred from a network failure, a timeout, an expired cache, an
unknown field, a digest mismatch, or a signed-out customer. Every one of those
is `unknown` or `unavailable`. A reader that collapsed them into "you do not
have it" would turn every outage into a mass revocation experienced by paying
customers.

### Offline behaviour

Bounded grace is the shipped policy, driven entirely by the server-issued
`refreshAfter`, `validUntil`, and `staleGraceSeconds`:

| Window | `cacheState` | Behaviour |
| --- | --- | --- |
| before `refreshAfter` | `fresh` | Serve; do not refresh. |
| to `validUntil` | `refreshRecommended` | Fully valid; refresh opportunistically. |
| to `validUntil + staleGraceSeconds` | `staleWithinGrace` | Previously active Entitlements stay active and `isStale` is `true` — **surface it**. |
| after that | `expired` | Report `unknown`. Never `inactive`. |

The window moves only when the server sends the canonical `snapshotUnchanged`
record, which carries the refreshed bounds. A bodyless `304` preserves the cache
and re-anchors trusted time but does not extend it.

Clock-skew tolerance is 60 seconds and is applied in the direction that favours
the user. A device clock earlier than issuance by more than the tolerance is
unreliable, which forces expired-equivalent behaviour rather than becoming a
fifth state.

### Tokens

- Held in **memory only**. Never written to disk, preferences, or a keychain,
  and never present in a log, diagnostic, crash report, or telemetry —
  diagnostics carry `tokenId`.
- Never parsed. The token is opaque.
- Refreshed proactively 60 seconds before expiry, once per generation on a
  `401`, and behind a single-flight so concurrent callers make one request.
- Invalidated when the accepted authority epoch changes. The next mint request
  carries only that epoch; it never carries Project, Environment, or customer
  identifiers supplied by the client.
- A provider failure enters a 30-second cooldown and reports `unavailable`. A
  backend that cannot mint a token has not revoked anyone's subscription.
- Signing out discards the token **and** clears the entitlement cache.

### Restore

```dart
final result = await mosaic.restorePurchasesAndSync();
```

It reports two independent axes. `MosaicCustomerEntitlementsRestored` exists
only once an accepted snapshot at a higher version reflects the restore; a
successful native restore Mosaic has not yet validated is
`MosaicCustomerRestoreValidationPending`, within a bound of 3 attempts over
roughly 6 seconds. The purchase and restore paths are never blocked by any of
this: authoritative refreshes triggered by a completed purchase are unawaited
and never alter a presentation result.

### What it is not

- **Not a bearer credential.** A snapshot is a read model. Possessing it
  authorizes nothing, and your backend must never accept one presented by a
  client as proof of access.
- **Not a replacement for server authorization.** The cache supports UI
  continuity and feature gating; protected resources are authorized by your own
  server.
- **Not placement targeting input.** Targeting continues to read
  provider-observed state, unchanged.

## Requirements

- Flutter 3.22 or newer (the tested minimum)
- Dart 3.4 or newer
- iOS 13 or newer, Android API 21 or newer, as inherited from Flutter

## Installation

This package is **not published to pub.dev**. Mosaic SDKs stay pre-1.0
(`0.x-dev`) at v1, so they are installed by Git pin or local path. Both forms
are supported and tested; the version below is the current package version.

Pin an immutable commit or tag from the Mosaic repository:

```yaml
dependencies:
  mosaic_sdk:
    git:
      url: https://github.com/<your-org>/mosaic.git
      path: sdk/flutter
      ref: v1.0.0-rc.1 # A tag or full commit SHA. Never a branch name.
```

The optional adapters live inside the same repository and are pinned the same
way, with their own `path`:

```yaml
dependencies:
  mosaic_revenuecat:
    git:
      url: https://github.com/<your-org>/mosaic.git
      path: sdk/flutter/packages/mosaic_revenuecat
      ref: v1.0.0-rc.1
  mosaic_native_store:
    git:
      url: https://github.com/<your-org>/mosaic.git
      path: sdk/flutter/packages/mosaic_native_store
      ref: v1.0.0-rc.1
```

For a vendored checkout or a monorepo that already contains Mosaic, use path
dependencies instead — this is what `examples/flutter-example` does:

```yaml
dependencies:
  mosaic_sdk:
    path: ../../sdk/flutter
  mosaic_revenuecat:
    path: ../../sdk/flutter/packages/mosaic_revenuecat
```

Because the package is pre-1.0, treat every version bump as potentially
breaking, read `CHANGELOG.md` before upgrading, and pin exactly. The package
version is reported to the backend in the `Mosaic-SDK-Version` header, in the
analytics context, and in `mosaicFlutterCapabilityReport`; all three read the
single `mosaicFlutterSdkVersion` constant.

## Public boundary

Configure the provider-neutral client with an environment-scoped public SDK
key and hosted/self-hosted base URL. Loading reads cache then the bundled
Delivery v1/v2 release without networking; refresh is an explicit host action:

```dart
final mosaic = Mosaic.configure(
  publicSdkKey: 'public_sdk_key',
  baseUrl: Uri.parse('https://mosaic.example.com'),
  bundledFallbackLoader: () => rootBundle.loadString(
    'assets/configuration-release.json',
  ),
  purchaseProvider: MockMosaicPurchaseProvider(
    products: const [
      MosaicProduct(
        id: 'mosaic_pro_monthly',
        title: 'Mosaic Pro Monthly',
        localizedPrice: r'$5.99',
        localizedPeriod: 'month',
      ),
    ],
  ),
);

await mosaic.loadConfiguration();
await mosaic.refreshConfiguration();

MosaicPlacementHost(
  mosaic: mosaic,
  placementKey: 'onboarding_complete',
  requestedLocale: 'ar',
  imageResolver: (key) => switch (key) {
    'mosaic.paywall.hero' => const AssetImage('assets/hero.png'),
    _ => null,
  },
  videoResolver: (key) => switch (key) {
    'mosaic.paywall.offer_video' => 'assets/offer.mp4',
    _ => null,
  },
  onResult: (result) {
    // The host owns terminal paywall dismissal.
  },
)
```

An accepted release is strict and atomic: every embedded Protocol 0.3 paywall,
digest, Placement reference, product reference, asset binding, and capability
set must validate before the SDK replaces memory or its cache. Requests send
Flutter SDK capability metadata, use a short timeout, and revalidate strong
ETags with `If-None-Match`; `304` preserves the current release only when the
response repeats the exact retained ETag and Configuration Release ID.
Concurrent manual refreshes coalesce. Presentation never fetches.

## Commerce Configuration and custom Providers

Commerce Configuration v1 and v2 are optional immutable sidecars. v1 remains
the closed RevenueCat/custom-provider contract. v2 adds credential-free native
Store activation, exact StoreKit/Google mapping snapshots, immutable Product
grants, explicit recovery modes, and delayed commerce-update acceptance. When configured,
the SDK requires its Environment, Application, store platform, Configuration
Release ID, release digest, Product set, and canonical content digest to match
the accepted Delivery v1 release. Unknown fields, mappings, versions,
credentials, ambiguous mappings, and mismatches reject the complete pair. The
release and sidecar bytes share one crash-safe cache record.

When `applicationId` and `storePlatform` are provided, Mosaic uses the frozen
hosted route automatically:

`GET /v1/sdk/commerce-configuration?applicationId=<registered-application-id>`

The request reuses the public SDK key and advertises Commerce Configuration
and Provider Contract versions `2,1`, preferring v2 while retaining v1 fallback. Tests, local
Studio integrations, and self-hosted deployments may replace this narrow
transport with `commerceConfigurationLoader`. Hosted responses are revalidated
with `If-None-Match` only after the exact sidecar ETag, canonical content
digest, and associated Delivery release have been retained together.

```dart
final mosaic = Mosaic.configure(
  publicSdkKey: 'public_sdk_key',
  baseUrl: Uri.parse('https://mosaic.example.com'),
  applicationId: 'application_ios',
  storePlatform: MosaicStorePlatform.ios,
  purchaseProvider: localFallbackProvider,
  commerceProviderFactories: [MyCommerceProviderFactory()],
);
```

An app-owned custom integration implements `MosaicCommerceProviderFactory` and
`MosaicCommerceProvider`. The factory receives only a validated
`MosaicCommerceConfiguration` and its exact `MosaicConfigurationRelease`.
Products must resolve stable Mosaic Product IDs through `mappingForProduct`;
the renderer never receives a provider SKU. Custom Providers report identity,
explicit capabilities, normalized purchase/restore/Entitlement results, and
bounded safe diagnostics.
Provider-failure results attach the same diagnostic record, including its
stable code, safe message, retryability, correlation ID, optional safe provider
code, and recovery action.

The optional RevenueCat adapter is at `packages/mosaic_revenuecat`. It pins
`purchases_flutter 10.4.3` and requires Flutter 3.22/Dart 3.4, which is now the
core package's floor as well. The host configures RevenueCat and owns
login/logout/customer identity:

```dart
await Purchases.configure(PurchasesConfiguration(revenueCatPublicSdkKey));

final mosaic = Mosaic.configure(
  // Delivery and sidecar settings omitted.
  purchaseProvider: localFallbackProvider,
  commerceProviderFactories: const [
    MosaicRevenueCatProviderFactory(),
  ],
);
```

Never put a RevenueCat public SDK key, server key, app-user identifier,
authorization header, or customer payload in the sidecar or diagnostics.

The optional `packages/mosaic_native_store` plugin exposes
`MosaicStoreKitProviderFactory` and `MosaicGooglePlayProviderFactory`. It is a
closed, versioned channel bridge to Mosaic's reusable native modules, not an
independent purchase implementation. Core remains functional when the plugin
is absent. Native Product objects and Google offer tokens remain private.

`MosaicPaywall` is the lower-level widget for an already decoded and validated
`MosaicPaywallDocument`. Mosaic presents protocol-internal Sheet destinations
with Flutter's native modal bottom sheet and maintains their Screen history.
The host still owns terminal paywall presentation and dismissal.

## Local Studio preview

Create one explicit local endpoint/session configuration and keep the client
alive for the running application process:

```dart
final preview = MosaicPreviewClient(
  configuration: MosaicPreviewClientConfiguration(
    endpoint: Uri.parse('ws://127.0.0.1:4317/preview'),
    sessionId: 'session_local_01',
    identity: MosaicPreviewClientIdentity(
      clientId: 'client_flutter_example',
      displayName: 'Flutter example preview',
      renderer: MosaicPreviewSoftwareIdentity(
        id: 'mosaic.flutter',
        version: mosaicFlutterSdkVersion,
      ),
      application: MosaicPreviewApplicationIdentity(
        id: 'example.app',
        displayName: 'Example App',
        version: '1.0.0',
      ),
      device: MosaicPreviewDeviceIdentity(
        displayName: 'Local simulator',
        systemName: 'iOS',
        systemVersion: '26.0',
      ),
    ),
  ),
);

await preview.connect();
```

Render the latest safe revision with `MosaicPreviewPaywall`. Supply the
existing provider for mock commerce. Before the first revision it shows an
explicit loading or connection-failure state. The widget applies the message's locale and text scale, rerenders
without rebuilding the app, and sends `draftAccepted` only after the revision
completes a Flutter frame.

The client:

- advertises and uses `mosaic.local-preview.v0.3` for the full connection;
- sends `previewClientConnected` then `capabilityReport`;
- reports exact schema, renderer, and preview capability versions for the
  negotiated protocol;
- orders local document and mock-commerce revisions independently;
- repeats prior acknowledgements for idempotent revision duplicates;
- rejects stale/conflicting/invalid/unsupported revisions atomically;
- preserves the last accepted draft after rejection or render failure;
- reconnects from 250 ms up to 5 seconds with a bounded attempt count; and
- sends five-second heartbeats and safe diagnostics without raw exceptions,
  documents, credentials, or local paths.

Endpoint and `sessionId` are independent and both required. A session is local
routing metadata, never a user identity or credential. Keep `clientId` stable
only for the running process; do not derive it from advertising or hardware
identifiers.

Canonical local project files can be loaded atomically with their embedded
document and mock-commerce state:

```dart
final project = const MosaicPreviewMessageCodec().decodeLocalProject(
  projectJson,
  expectedFileFormatVersion: mosaicLocalPreviewProtocolVersion,
);
```

Studio-side integrations can use `negotiateMosaicLocalPreviewVersion` and
`decideMosaicPreviewDraftDelivery` to choose the highest mutual exact version
and withhold incompatible or oversized compact UTF-8 drafts before sending.

## Protocol and fallback guarantees

- `MosaicProtocolDecoder` rejects unknown fields, components, versions,
  capabilities, invalid bounds, and inconsistent references atomically.
- Semantic validation traverses every Screen, Carousel page, Stack, Button
  child, Button in-progress child, Product Card, Product Badge, and passive
  authored descendant. It covers unique IDs, exact capability derivation,
  localization catalogs and safe product templates, multi-Screen accessibility
  labels, safe HTTPS actions, reachable acyclic navigation, same-Screen
  purchase/Switch references, passive content bounds, Carousel nesting, and
  Countdown ordering.
- The package contains no JSON Schema or fixture copy. Conformance tests read
  the canonical Protocol and Local Preview 0.3 fixtures directly.
- Configuration resolves last-known-valid cache → bundled Delivery v1/v2 release
  → `configurationUnavailable`; explicit refresh may replace it with a fully
  validated remote release.
- A missing component image uses its declared placeholder. Decorative media
  backgrounds fall back safely: video → poster → colour and image → colour,
  with one diagnostic per failed asset.
- Unavailable or price-dependent products without a non-blank localized price
  remove their Product Card. The configured/current Product Card ID is retained
  when available, otherwise source order selects the first available card,
  including after locale changes. No card shows the declared message, disables
  Purchase, and reports `productUnavailable`.

Locale resolution is exact requested locale → requested base language →
`fallbackLocale` → `defaultLocale` → inline default. Direction comes from the
first declared locale candidate, independently of the string that resolves.

Requested-locale matching is case-insensitive, and catalog lookup is exact
against the canonical form. Every host-supplied locale identifier —
`requestedLocale`, the decision context's `applicationLocale`, and
`Mosaic.configure`'s `locale` — is canonicalized through
`mosaicNormalizeLocaleTag` before it is matched, targeted, or reported, so
Placement targeting and catalog lookup never disagree about what "the same
locale" is. Hand it whatever the platform produced: `Platform.localeName` POSIX
shapes (`en_US`, `en_US.UTF-8`), ICU region overrides (`en_US@rg=gbzzzz`), and
BCP-47 extensions (`en-US-u-ca-buddhist`), and Java `Locale.toString` extension
markers (`en_US_#u-rg-gbzzzz`) all resolve to `en-US`; `PT_br` resolves to
`pt-BR`; `zh-Hans-CN` is preserved. `0.3` defines no language+region reduction,
so `zh-Hans-CN` reduces to `zh`, never to `zh-CN`. Conformance is bound to
`protocol/fixtures/v0.3/locale-resolution.json`.

Catalog lookup — and only catalog lookup — recovers the leading language subtag
when a tag has no canonical form, so `en-US-verylongsubtag` still reaches the
`en` catalog. Placement targeting deliberately does not recover.

### Presence and unusable values in targeting

Targeting separates *what the host reported* from *what Mosaic can use*, because
answering "no" where the honest answer is "cannot decide" turns any `not`,
`not_equals`, `not_in`, or `does_not_exist` around it into a positive match.

- **Presence reports what the host supplied.** A reported value `exists` even
  when it is unusable — an unnormalizable `application.locale`, an alpha-3
  `context.country`, an out-of-set `device.platform`, a malformed version. Only
  a value the host never supplied is absent.
- **Comparisons against an unusable value are unknown**, never false.
- **An authored operand with no canonical form makes the condition unknown.**
  This covers `locale_matches` ranges and equally `equals`, `not_equals`, `in`,
  and `not_in` on `application.locale`. A single unusable member makes the whole
  `in`/`not_in` unknown even when another member would have matched: the list is
  one defective authored value, and evaluating the half that parsed would decide
  a Rule on half of what its author wrote.
- **There are no wildcard ranges.** `*` is not part of the authored grammar and
  the SDK carries no wildcard branch.

Conformance is bound to
`protocol/fixtures/placement-decision/v1/evaluator-conformance.json`.

## Results

The sealed presentation union maps one-to-one to the protocol:

- `MosaicPurchasedPresentationResult`
- `MosaicRestoredPresentationResult`
- `MosaicAlreadyEntitledPresentationResult`
- `MosaicDismissedPresentationResult`
- `MosaicCancelledPresentationResult`
- `MosaicPendingPresentationResult`
- `MosaicDeferredPresentationResult`
- `MosaicProductUnavailablePresentationResult`
- `MosaicConfigurationUnavailablePresentationResult`
- `MosaicPurchaseFailedPresentationResult`
- `MosaicRenderingFailedPresentationResult`
- `MosaicNoPaywallPresentationResult`

`restoreNoPurchases` and `restoreFailed` are emitted only through
`onInteraction`; the paywall remains usable for retry, purchase, or close.
Safe `MosaicDiagnostic` values expose stable SDK codes without raw provider
errors or credentials.

`product_selection_default_substituted` is reported once per Product Selector
when the authored default — or the customer's current choice — becomes
unavailable and the Selector's `unavailableFallback.selection: firstAvailable`
rule selects the first available option instead. The substitution is correct;
the diagnostic exists because the `product_selected` payload still reports
`source: "default"`, that field's protocol enum admitting only `default` and
`user` with no value for a substituted selection. The Swift SDK reports the
same code for the same situation.

## Flutter-native conformance notes

- One protocol logical unit maps to one Flutter logical pixel.
- `start`/`end` use `EdgeInsetsDirectional`, `TextAlign.start/end`, and native
  `Directionality`.
- Linear-gradient angles are physical and never mirror in RTL: 0° points
  left-to-right, 90° top-to-bottom, and angles increase clockwise.
- Colour, background, and shadow tokens resolve before painting. Linear and
  radial gradients use Flutter gradients; a supported shadow maps to one
  native `BoxShadow`.
- Width and height independently support Fit, Fill, and Fixed. Unbounded Fill
  falls back to Fit with `layout.unboundedFill`; Fixed clips visuals to the
  authored box while preserving the component's complete semantics.
- Remote assets use validated HTTPS URLs. Bundled image/video logical keys are
  resolved only by the host, so protocol documents never contain host paths.
- Decorative video uses `video_player` without controls, muted, autoplaying,
  looping, and excluded from semantics. Loading failures never block content.
- The renderer uses `SafeArea`, `SingleChildScrollView`, Material buttons,
  native text scaling, and Flutter semantics. It does not use a WebView.
- Carousel uses native `PageView`, measures its pages to a stable maximum
  height, and announces user-driven page changes. Switch uses native `Switch`.
- Screen navigation starts at `initialScreenId`, retains Switch, Carousel,
  product-selection, scroll, and other presentation state while moving, opens
  forward destinations at the top, restores prior scroll on back, and resets
  to the initial Screen for an accepted revision. Back at the root is the safe
  diagnostic no-op `navigation.noBackTarget`; it never dismisses the paywall.
- A Sheet destination uses a full-height safe-area `showModalBottomSheet` with
  its own scroll controller. Protocol Back, navigation to another destination,
  and system swipe/back dismissal reconcile the same history deterministically.
- Protocol 0.3 Button descendants render as native Flutter content inside one
  48-point-minimum hit target and one merged semantics control. Purchase and
  restore swap to localized `inProgressChildren` and all asynchronous actions
  reject duplicate taps while busy.
- Icons map the exact Mosaic names to Material glyphs. Arrow and chevron names
  mirror in RTL; decorative Icons are excluded from semantics and informative
  Icons expose their required localized label.
- `openExternalUrl` delegates only prevalidated absolute HTTPS URLs to
  `url_launcher` with `LaunchMode.externalApplication`. Failure keeps the
  current Screen/history presented and reports `externalUrl.openFailed`.
- Hidden conditional content is absent from layout, hit testing, and semantics
  while retaining its runtime state; an accepted document revision resets all
  Switch and Carousel state deterministically.
- Countdown accepts an injected clock for deterministic hosts/tests, updates
  from a non-blocking timer, and intentionally avoids a per-second live region.
- A Product Selector renders authored Product Cards and Product Badges rather
  than generated pricing rows. Each whole card is one native mutually
  exclusive selection target; descendants remain passive and merge into that
  target. Without an explicit card accessibility label, visible informative
  Text, Image, Icon, Stack, Product Badge, Feature List, and Countdown labels
  merge in authored source order after localization and template resolution;
  hidden and decorative content stays excluded. Horizontal and vertical
  selectors preserve source order.
- Product Card and Product Badge Selected styling recursively inherits every
  omitted Default leaf rather than replacing the complete style object.
- Text below a Product Card resolves only whitespace-tolerant
  `{{ product.name }}` and `{{ product.price }}` after locale selection.
  Provider title wins, the localized Product Reference label is its fallback,
  and unresolved raw template tokens are never rendered.
- Overlay Product Badges use `PositionedDirectional`, so logical start/end
  anchors mirror in RTL without introducing absolute protocol coordinates.
- Heading roles map to `Semantics.header`; authored heading levels are validated,
  while the supported Flutter semantics API exposes the heading role rather
  than the numeric level.
- Busy controls expose a disabled native action plus localized live-region
  value because supported Flutter versions do not share a dedicated busy flag.
- Native typography, button chrome, checkmark/radio glyphs, scroll physics,
  focus visuals, and safe-area measurements intentionally remain Flutter-native.
  Source order, logical layout, locale resolution, action identity,
  accessibility state, fallbacks, and normalized outcomes do not vary.

## Validate

From `sdk/flutter`:

```bash
flutter pub get
dart format --output=none --set-exit-if-changed lib test example/lib
flutter analyze --no-pub
flutter test --no-pub
cd ../../examples/flutter-example
dart run tool/sync_fixture.dart
flutter analyze --no-pub
flutter test --no-pub
flutter build bundle --no-pub
```

For the real relay integration slice, start `npm run preview:relay` from
`apps/dashboard`, then run from `sdk/flutter`:

```bash
flutter test --no-pub \
  --dart-define=MOSAIC_RUN_RELAY_INTEGRATION=true \
  test/preview_relay_integration_test.dart
```

That opt-in test verifies the negotiated WebSocket subprotocol, identity and
capability relay, an edited Protocol 0.3 draft, and the returned
`draftAccepted` acknowledgement. The normal offline suite compiles and skips
it when no relay is running.

The committed golden under `test/goldens/` is a true Flutter pixel baseline.
Update it only after an intentional renderer review, then rerun without
`--update-goldens`.

The full scenario and locale playground is at
`examples/flutter-example/README.md`. It generates its ignored bundled fixture
byte-for-byte from the canonical repository file before build or run.

## Known limitations

Flutter-specific pre-GA limitations, including the pre-1.0 distribution model,
are recorded in `docs/known-limitations.md` at the repository root. Read it
before shipping this SDK in a production application.
