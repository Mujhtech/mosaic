# Changelog

## Unreleased (Phase 9C: migration authority awareness)

- Normalize the device locale once, in `MosaicDeviceLocale`, for both the analytics event context
  and the Placement decision context. Android reports regional preferences as Unicode extensions
  (`en-US-u-rg-gbzzzz`), which fits the locale pattern but is neither the canonical tag nor always
  inside the 35-byte analytics bound: `application.locale` `equals`/`in` rules missed on
  region-override devices and multi-preference tags made events unencodable. The tag is truncated
  at the first singleton subtag, matching the iOS SDK, so both report `en-US` for one device state
  and both preserve `zh-Hans-CN`.
- Adopt the presence and unusable-value rulings. `context.country` follows the uniform presence
  rule: an unrecognized country is present with unknown comparisons rather than absent, so a Rule
  targeting "no country reported" can no longer fire on a device that reported one. A value outside
  a closed vocabulary — an out-of-set `device.platform` such as `windows` from a future or
  misconfigured host — now compares unknown rather than false, which is what stops
  `not (platform equals "ios")` from matching a platform the Rule was never written for.
- Adopt the second-round locale rulings. The canonical form now cuts the value at the first `@`,
  `.`, or `#`, so the ICU identifiers hosts actually report — `en_US@rg=gbzzzz`, `en_US.UTF-8`, and
  Java `Locale.toString`'s `en_US_#u-rg-gbzzzz` — all denote `en-US`. A host-supplied locale that
  cannot be normalized is now **present** rather than absent: `exists` is true and every comparison
  against it is unknown, so it can never be silently read as a non-match. An authored
  `locale_matches` range that cannot be normalized is unknown rather than false, which is what stops
  a malformed range from matching every user once negated. `equals`/`in` normalize the authored
  operand too, so both sides of a locale comparison are canonical.
- Catalog lookup recovers the leading language subtag when a tag cannot be canonicalized
  (`en-US-verylongsubtag` reaches `en`); Placement targeting deliberately does not, because
  recovering there would change which users match a Rule. The analytics event context keeps its own
  35-byte degradation (`currentForEventContext`), which no longer reaches targeting.
- Adopt the first-round locale rulings. One canonical form — underscores to hyphens, empty subtags
  dropped, truncation at the first singleton subtag, lowercase language, title-case script,
  uppercase alpha-2 or numeric-3 region — is now shared by `application.locale` targeting, the
  analytics and decision contexts, and localization catalog lookup, matching
  `protocol/tools/locale-resolution-v0.2.mjs`. Catalog matching is therefore case-insensitive
  (`PT_br` reaches the authored `pt-BR`), and a raw `en-US-u-rg-gbzzzz` or `en_US` no longer falls
  past the catalog it always denoted to the document default, taking layout direction with it.
- The localization candidate chain is the single Protocol 0.2 order in every case — canonical
  requested tag, base language, `fallbackLocale`, `defaultLocale`. A request that canonicalizes to
  nothing previously tried `defaultLocale` before `fallbackLocale`; it now follows the same order
  as every other request. Documents whose two declared locales are equal are unaffected.
- **Behaviour change:** `analyticsCollectionEnabled` now defaults to `true`. Hosts opt **out** with
  `analyticsCollectionEnabled = false`; the runtime `setAnalyticsCollectionEnabled(false)` override
  is unchanged, the Environment-level analytics setting still gates ingestion server-side, and
  hosts remain responsible for end-user consent requirements in their jurisdictions.
  `transactionObservationEnabled` and `customerAccessTokenProvider` remain opt-in.

- Add strict Authoritative Entitlement v2 wrapper decoding, scoped monotonic authority epochs, a
  replaying `customerAuthority` flow, authority-bound backup-excluded cache records, and safe
  `authority_unknown` handling for legacy v1 cache entries.
- Authority epoch is evaluated before snapshot version. Foreground recovery refreshes authority
  before normal configuration, and Customer Access Token generations remain opaque, memory-only,
  and bound to the accepted epoch.
- Report Android application/SDK versions and migration capabilities. Placement targeting uses
  only Mosaic access after Mosaic authority, never a union with provider-observed entitlements;
  purchase providers remain unchanged.
- Enforce v2 minimum-support metadata before accepting authority, keep targeting unknown until a
  source or Mosaic epoch is accepted, and validate sliding unchanged records against the retained
  evaluation, projection, and freshness state.
- Publish authority snapshots and unchanged freshness only after durable cache commit. Failed
  initial, replacement-epoch, or sliding writes preserve the prior observable/durable state, and
  direct entitlement checks remain unknown under source or rollback authority.
- Persist compatible `snapshotUnchanged` minimum-support metadata in the retained v2 wrapper so
  restart/bootstrap enforcement uses the latest server requirements without rewriting snapshot or
  authority digest inputs.
- Send the optional `knownSnapshotAuthorityDigest` only with the complete retained
  customer/scope/epoch/version verification tuple. Stale or mismatched cache bindings request a full
  snapshot. Decode `policy_unavailable` without placeholder support metadata and fail closed for
  malformed policy-unavailable records so retained Mosaic access is never republished as active.
- Persist valid or exactly recognizable forbidden-support `policy_unavailable` as an atomic cache
  tombstone before publishing unavailable. Restarts cannot replay the displaced active snapshot; a
  failed tombstone stays pending in memory, emits a cache-write diagnostic, and is retried before
  later synchronization. Unrelated malformed v2 records retain the ordinary preserve-cache policy.

## Unreleased (Phase 9B: subscription state and authoritative entitlements)

- Add authoritative entitlements behind
  `MosaicConfiguration.customerAccessTokenProvider`, which is `null` by default
  and leaves the whole feature inert: no request, no file, and every
  authoritative surface reporting `unavailable`. The change is purely additive —
  the provider-observed commerce API, `MosaicEntitlement`, and Placement
  targeting are untouched, and no existing symbol was renamed or deprecated.
- Mosaic Billing requires an application backend. Access is read with an opaque
  Customer Access Token that only the host's authenticated server can mint; a
  public SDK key can never select a Billing Customer. Tokens are held in memory
  only, never persisted, never logged, and never parsed, and
  `MosaicCustomerAccessToken.toString()` redacts itself.
- New API: `customerEntitlements` (a `StateFlow` with explicit `Loading`,
  `SignedOut`, `Available`, and `Unavailable` states), `checkCustomerEntitlement`,
  `refreshCustomerEntitlements`, `identifyCustomer`, `signOutCustomer`,
  `restoreAndSyncCustomerEntitlements`, and `customerEntitlementDiagnostics`.
  There is no boolean convenience API anywhere: `unknown` and `unavailable` are
  real answers a `Boolean` cannot carry.
- Sync is a `POST` carrying an `entitlementSyncRequest` record; conditional
  revalidation travels in that body and the unchanged answer is a `200`
  `snapshotUnchanged` record carrying its own refreshed window. The request never
  asserts a `billingCustomerId` — the Customer Access Token is the sole customer
  selector — and a bare `304` preserves the cache without sliding freshness.
- `inactive` is produced only from an accepted snapshot that carries an entry
  saying so; an Entitlement key the snapshot does not carry reads `unknown`. Every
  failure path — transport, token, digest mismatch, unsupported contract version,
  rejected record, expired cache, unreliable device clock — produces `unknown`
  and preserves the cache, except a customer/Project/Environment binding
  mismatch, which clears it and raises a high-severity diagnostic.
- Snapshots are cached under `noBackupFilesDir` in a per-customer directory named
  by a digest of the Billing Customer identifier, written atomically, and
  verified by an integrity digest that detects truncation and tampering. Sign-out
  deletes them; an identity change removes every other customer's directory.
- Offline access follows the shipped bounded-grace policy with a 60-second
  clock-skew tolerance. A device clock earlier than issuance is treated as
  unreliable and forces expired-equivalent behaviour rather than becoming a fifth
  cache state.
- Conformance is asserted against the canonical fixtures in
  `protocol/fixtures/authoritative-entitlement/v1/` and the shared cache-decision,
  freshness, and snapshot-digest reference vectors, so Kotlin cannot drift from
  the other implementations.
- Transaction Observation submissions now carry the current Customer Access Token
  in a `Mosaic-Customer-Token` header when one is available, so a validated
  purchase can be bound to an identified Billing Customer instead of anchoring
  anonymously. The token is read at send time rather than enqueue time, is read
  from the already-held token only and never mints one, is never persisted with
  the queue, and is never logged; when it is absent the header is omitted and the
  anonymous submission stays valid. Billing Ingestion Contract 1 observation
  records are unchanged.
- No new Gradle dependency.

## Unreleased (Phase 9A: transaction ingestion and validation)

- Add the optional Transaction Observation handoff, off by default behind
  `MosaicConfiguration.transactionObservationEnabled`. When a host opts in, a
  completed Google Play purchase is reported to Mosaic as a bounded provider
  reference so server-side validation can start without waiting for a store
  notification. An observation is a trigger, never proof: the SDK never learns a
  validation outcome, `serverConfirmedTransactions` remains `unsupported`, and no
  `MosaicPurchaseResult` changes.
- Both the submitted observation and the submission answer are Billing Ingestion
  Contract 1 records, asserted against the canonical fixtures: the request is a
  `clientTransactionObservation` envelope carrying a stable `observationId`
  beside the deterministic `submissionId`, and only an
  `observationSubmissionResult` record is decoded. No Store Environment is ever
  sent — classification is server-side, from verified provider metadata.
- The raw purchase token never leaves the device. The wire carries the existing
  SHA-256/UTF-8/lowercase-hex token digest plus, when Google supplies one, the
  order identifier verbatim. `getOriginalJson()`, `getSignature()`, obfuscated
  account and profile identifiers, and every other subject value are never read
  into a payload, a log, or a diagnostic. The digest derivation is now a
  documented cross-SDK contract asserted against shared reference vectors.
- Add `orderId` to the normalized Google purchase and
  `MosaicCommerceUpdate.providerOrderReference` (optional, bounded to the
  provider-code charset so a token or receipt cannot be carried there). Existing
  call sites are source compatible.
- Emit the purchased commerce update after the transaction is finalized rather
  than before acknowledgement, so no subscriber can report a purchase that Google
  Play has not yet acknowledged. Acknowledgement itself is unchanged: it stays
  client-side and is never gated on Mosaic.
- Add an app-private, backup-excluded, duplicate-safe observation queue that
  survives process restart (64 observations / 64 KiB, seven-day expiry, ten
  attempts, full-jitter backoff, `Retry-After` respected) with best-effort
  delivery on a scope the purchase path never waits on, plus
  `flushTransactionObservations()` and `transactionObservationDiagnostics()`.

## 0.1.0-dev.7 — 2026-07-27 (Phase 8: operational hardening)

Release-blocking fixes:

- Replace reflective Gson binding with explicit tree codecs for the cached
  Configuration Release record and for Experiment assignment records. R8 renames
  the fields of both models in a minified release build (`etag -> a`,
  `payload -> b`, …), so reflective binding silently discarded the
  last-known-valid configuration and could resurface an already-counted
  Experiment exposure. Both codecs now read and write literal wire names and
  reject unknown, missing, or wrongly typed fields instead of partially decoding.
- Move Google Play local-delivery persistence off the main thread. The store no
  longer calls `SharedPreferences.commit()` from the caller's dispatcher; reads
  and writes are suspending and dispatched to an injected I/O dispatcher.
- Relocate Google Play local-delivery markers to the app-private no-backup
  directory. Android auto-backup could previously restore finalized markers onto
  another device or install, letting a purchase short-circuit host delivery and
  grant Entitlements that were never delivered there. The legacy
  `mosaic-google-play-delivery-v1` preferences are deleted, never migrated,
  because their contents cannot be trusted; losing a genuine marker is safe
  because re-delivery is idempotent.
- Bound the Google Play local-delivery record to 256 digests, evicting the least
  recently written first, so a long-lived install cannot grow it without limit.
- Reconcile a changed `analyticsCollectionEnabled` Environment flag on an
  existing analytics runtime namespace. A later `Mosaic.configure` carrying the
  owner-approved setting was previously ignored, so collection stayed disabled
  (dropping every event) or stayed enabled after an owner disabled it.
- Acknowledge Analytics Event Contract v2 batches correctly. The decoded
  ingestion response now retains the echoed `analyticsEventContractVersion`, and
  a batch's results are applied only when the response echoes both the exact
  batch ID and the exact submitted contract version. A mismatched version means
  the server did not acknowledge what was sent, so events are retried rather
  than removed on an unrelated acknowledgement.
- Omit the Experiment tuple from conversion events produced by a fallback or
  QA-override presentation. A fallback presents the normal Paywall, so its
  conversions are not Variant outcomes; because
  `product_selection_purchase_start` uses `product_selected` as its *denominator*
  (not `experiment_exposed`), a tuple-carrying fallback conversion was counted as
  a Variant presentation and, being earlier, could displace the Variant's own
  first unit for that bucket — attributing normal-Paywall outcomes to the Variant.
  The tuple now attaches only to a statistically exposed original-Variant
  presentation, the same condition under which `experiment_exposed` is emitted.
  `experiment_fallback_presented` still carries the tuple, since it identifies the
  assignment that fell back.
- Pin the mandatory bundled-fallback chain with an executable regression test: an
  unreachable transport plus an empty cache renders the packaged canonical
  document, and the packaged asset path and bytes are asserted against the
  canonical fixture. Android decodes the bundled document as a raw Paywall
  document and never re-wraps it in a synthesized delivery release, so the two
  iOS fallback defects do not apply here; nothing was previously testing it.
- Pin Experiment conversion attribution to the `analytics-event-v1-to-v2` MUST
  table with regression tests. Conversion attribution joins solely on the
  Experiment tuple carried by the conversion event itself, and the tuple is legal
  only on a v2 event, so emitting `product_selected` or any purchase lifecycle
  event on v1 during an active Experiment reports zero conversions with no ingest
  rejection and no diagnostic. Android already emitted these events on v2 with the
  complete tuple; the behaviour depended on three separate untested mechanisms and
  is now locked by emitter and codec tests plus the canonical attributed fixtures.
- Apply per-event correlation and attribution ownership allow-lists to every
  schema version. Attribution ownership was previously checked only for v2, and
  correlation ownership was not checked at all, so a v1 event could carry an
  unrelated `providerUpdateId` or `planId` and an `experiment_exposed` event
  could carry an unrelated `purchaseAttemptId`/`providerOperationId`. Unrelated
  identifiers silently join an event to a different journey during ingestion and
  corrupt funnel and Experiment attribution. The six canonical invalid analytics
  fixtures are now consumed directly by name as conformance evidence.
- Derive the Placement rollout tuple (`assignmentKeyType`, `bucketingAlgorithm`,
  `rolloutBucket`) atomically from a single decision-trace step, so a partial
  tuple is structurally impossible rather than emitted and then silently dropped
  by the codec.
- Fix a full-paywall-tree recomposition on every scrolled pixel. The scroll
  indicator now reads scroll offset in the draw phase and derives its visibility,
  so scrolling invalidates only the indicator.

Packaging, versioning, and documentation:

- Give `:mosaic-revenuecat` publication parity with the other two modules
  (`group`, `version`, `maven-publish`, `singleVariant("release")` with sources),
  so the documented `dev.mosaic.sdk:mosaic-revenuecat` artifact can actually be
  produced.
- Set `MOSAIC_ANDROID_SDK_VERSION` to the exact artifact version. It previously
  reported `0.2.0-dev.1` while the artifacts were `0.1.0-dev.6`, making the
  `Mosaic-SDK-Version` header untrue.
- Bump all three modules to `0.1.0-dev.7`.
- Correct `consumer-rules.pro`, which claimed a Phase 0 state; the SDK now
  genuinely contains no reflection-based models.
- Enable `isMinifyEnabled` in the example application's `release` build type so
  R8 runs permanently over the Mosaic dependency graph and a change that began
  to require keep rules would fail `:app:assembleRelease`.
- Scope the example application's cleartext-traffic permission to its debug
  manifest; the release build no longer requests it.
- Document R8/minification behaviour, honest pre-1.0 installation paths, and the
  supported version matrix including the enforced AAR consumption floor
  (`compileSdk` 36, Kotlin 2.2.0, JDK 17) read from the built artifact.
- Bind Experiment bucketing assertions to
  `protocol/fixtures/experiment-assignment/v1/assignment-vectors.json` instead of
  hard-coded bucket values.

## 0.1.0-dev.6

Phases 5, 6, and 7 were all developed and validated against this single artifact
version; it was never re-published between them. The subsections below record
what each phase added, newest first.

### Phase 7: Experiments

- Add strict Experiment Assignment v1 and Configuration Delivery v3 decoding
  without changing the public Placement API. Normal Placement must first select
  the exact Control Paywall Version.
- Add local, offline, deterministic Experiment assignment and mutual exclusion
  using the canonical length-prefixed SHA-256 algorithms, retaining the ordered
  candidate list so mutually exclusive Experiments may share a Placement.
- Add validated server-time scheduling: inclusive start, exclusive end, anchors
  stale after seven days, and conservative normal Placement when wall-clock
  deviation exceeds five minutes.
- Present a Variant only when its exact Product set is ready and the installed
  provider truthfully declares every required capability; otherwise present the
  normal Placement Paywall and emit `experiment_fallback_presented`.
- Emit statistical `experiment_exposed` exactly once after native presentation;
  assignment alone is diagnostic and QA presentations never emit exposure.
- Add bounded (256 records / 180 days) atomic assignment diagnostics in the
  no-backup directory storing only one-way subject digests and safe IDs, exposed
  through `hosted.experimentDiagnostics()`.
- Add Analytics Event Contract v2 encoding for the Experiment attribution tuple.

### Phase 6: analytics, identity, and privacy

- Add Analytics Event Contract v1 decoding, encoding, and canonical-fixture
  conformance for hosted clients only.
- Add a persistent app-private, backup-excluded event queue bounded to 1,000
  events or 2 MiB, with 32 KiB per-event caps, seven-day expiry, batches of at
  most 50 events or 512 KiB, and priority-aware overflow that discards expired
  and older low-value events before purchase and restore outcomes.
- Add partial-batch acknowledgement handling that removes accepted, duplicate,
  and permanently rejected events while retaining only retryable ones, with
  retry capped at ten attempts using full-jitter exponential backoff from one
  second to five minutes.
- Default collection to disabled; enable it only when `analyticsCollectionEnabled`
  mirrors an owner-enabled Environment. A host consent override may disable
  collection and atomically clear the unsent queue but can never enable a
  server-disabled Environment.
- Add 30-minute inactivity sessions that survive ordinary SDK reconstruction and
  restart on effective user change, user clearing, installation reset, and
  collection re-enable.
- Add app-private no-backup identity persistence, `identify`,
  `setUserAttributes`, `resetIdentity`, and `resetInstallationIdentity`, with
  suspendable serialized APIs and no main-thread file access.
- Add lifecycle-driven best-effort flushing and a coalesced foreground
  configuration refresh so emergency-stop releases apply without a per-
  presentation request. Analytics delivery never blocks rendering or purchasing.

### Phase 5: targeting and Placement decisions

- Add strict atomic Configuration Delivery v2 and Placement Decision v1
  decoding, evaluated locally so `paywall()` and `MosaicPlacement` remain
  offline-capable; a rejected refresh keeps the last accepted release.
- Add deterministic local targeting with exact rule priority, three-state
  conditions, semantic versions, RFC 4647 basic locale matching, typed
  allow-listed attributes, and `sha256_length_prefixed_v1` bucketing.
- Add named fallbacks, explicit `no_paywall` results, and safe decision traces
  carrying rule/source metadata and buckets but never identity, attribute
  values, assignment keys, provider payloads, or override tokens.
- Add in-memory-only QA override tokens cleared by either identity reset.
- Keep `country` an explicit trusted host input, never inferred from locale,
  timezone, currency, IP address, or device region.
- Preserve every existing Delivery v1 call site as source compatible.

### Phase 4B: Google Play and Commerce Configuration v2

- Add local Maven publication metadata for
  `dev.mosaic.sdk:mosaic:0.1.0-dev.6` and
  `dev.mosaic.sdk:mosaic-google-play:0.1.0-dev.6`; the Google adapter POM
  retains its project dependency on the matching core artifact.
- Add optional `mosaic-google-play` adapter 1.0.0 using Google Play Billing
  9.1.0 on API 24+, with exact Product/base-plan/offer selection, runtime-only
  offer tokens, pending and delayed purchase handling, active-purchase
  recovery, safe diagnostics, and Product-to-Entitlement grants.
- Add strict Commerce Configuration v2 decoding and v2-first/v1 fallback
  negotiation while preserving Commerce Configuration v1 and RevenueCat.
- Persist idempotent local-delivery state before host acceptance and
  acknowledge Google purchases only after accepted delivery.

## 0.1.0-dev.5

- Report RevenueCat Provider ID `revenuecat` with Mosaic adapter version
  `1.0.0`, independently from the RevenueCat Purchases Android dependency
  version, and reject sidecars whose Provider identity, adapter version, or
  exact runtime capability tuples do not match the installed adapter.
- Require Commerce Configuration `304` responses to repeat both the exact
  retained sidecar digest ETag and Configuration Release ID; missing,
  malformed, weak, or mismatched headers now preserve the valid pair and fail
  revalidation safely.
- Require custom adapters to report provider identity, truthful capabilities,
  and bounded safe diagnostics; provider-failure outcomes can carry the
  complete correlated diagnostic.
- Invalidate provider-native purchase handles on Commerce Configuration swaps,
  including concurrent RevenueCat reloads, and require exact remapping before
  another purchase.
- Validate hosted Commerce response media type, digest ETag, release header,
  retained `304` pairs, and every canonical safe-diagnostic field.
- Align restore and active-Entitlement results with Commerce Provider v1:
  restore no longer exposes `AlreadyEntitled`, and provider unavailability is
  distinct from unknown and failed Entitlement lookup.
- Add strict Commerce Configuration v1 decoding, release/application/platform
  association, content-digest verification, atomic paired caching, and
  last-known-valid recovery.
- Add the SDK-local configurable provider boundary with stable Mosaic Product
  and Entitlement IDs and safe unavailable behavior before configuration.
- Add an optional `mosaic-revenuecat` module using RevenueCat Purchases Android
  10.15.0 for direct products and exact Offering/Package mappings without
  forcing RevenueCat into the core SDK or initializing it on the host's behalf.
- Normalize product, purchase, pending, cancellation, already-entitled,
  restore, entitlement, provider-unavailable, and failure results without
  retaining credentials, purchase tokens, or customer data.

## 0.1.0-dev.4

- Add Hosted Configuration Delivery v1 with endpoint/key-isolated persistent
  cache namespaces, mandatory strong ETags, durable persist-before-swap
  acceptance, explicit refresh outcomes, and safe hosted diagnostics.
- Preserve Environment identity, monotonic release ordering, and the prior
  last-known-valid release when validation, transport, or cache persistence
  fails.
- Advertise the complete sorted Protocol 0.2 exact-capability catalog on every
  hosted delivery request.
- Complete the Protocol 0.2 RC4 Android contract with strict design-system
  token resolution, gradients, media backgrounds, shadows, uniform two-axis
  sizing/clipping, exact capability reporting, and atomic rejection fallback.
- Present authored sheets with native Material 3 modal behavior while retaining
  the most recent screen underneath, and render decorative video with a muted,
  looping, control-free Media3 player plus poster/fallback handling.
- Add strict Protocol 0.2 decoding while preserving the approved Protocol 0.1 path without
  implicit migration.
- Render Stack, Carousel, Switch, Countdown, expanded styling and visibility, and Protocol 0.2
  RC3 authored Product Cards/Product Badges with inherited Default/Selected box states, safe
  name/price templates, logical RTL overlays, and native radio semantics in Jetpack Compose.
- Add Local Preview 0.2 negotiation, capability reporting, draft gating, mock commerce,
  runtime-state reset, and structured last-accepted-draft recovery.
- Package the current Protocol 0.2 fallback so disconnected previews retain the horizontal
  Product Selector layout used by Studio.
- Add Protocol 0.2 fixture, interaction, accessibility, RTL, large-text, Compose instrumentation,
  and pixel-baseline coverage.

## 0.1.0-dev.3

- Add a strict, platform-neutral Local Preview 0.1 message codec with canonical fixture
  conformance, closed payload validation, safe diagnostics, and the
  `mosaic.local-preview.v0.1` WebSocket subprotocol.
- Add a local-only OkHttp WebSocket preview client with client identity and capability reports,
  heartbeat handling, bounded reconnect backoff, message deduplication, and safe disconnect
  behavior.
- Add independent draft and mock-commerce revision ordering, stale and conflicting revision
  rejection, delayed acknowledgements after a Compose frame adopts a draft, and last-valid or
  bundled fallback rendering.
- Add live mock product, purchase, restore, and entitlement state, including immediate warnings
  when a commerce update makes an already-rendered draft unavailable.
- Add Compose preview entry points, a development status panel, locale/RTL/text-scale overrides,
  render and asset diagnostics, and the Phase 2 Android example integration.
- Add canonical flow, transport, ordering, fallback, mock commerce, configuration, status UI,
  reconnect, validation, and unsupported-component tests.

## 0.1.0-dev.2

- Implement strict Protocol 0.1 RC1 models, recursive semantic validation, exact capability
  reporting, locale fallback resolution, and Arabic RTL direction.
- Generate the sole canonical fixture into the AAR as the Phase 1 bundled fallback without a
  committed Android fixture or schema copy.
- Add a native Jetpack Compose renderer for the complete Phase 1 component set, safe insets,
  direction-relative layout, font scaling, accessibility semantics, image placeholders, and a
  direction-relative scroll indicator.
- Add deterministic partial product loading, product selection fallback, configurable mock
  purchase/restore scenarios, busy states, safe diagnostics, interaction outcomes, and the exact
  normalized presentation result union.
- Add direct-fixture decoding, semantic rejection, localization, fallback, commerce, state,
  accessibility, RTL, placeholder, interaction, and screenshot baseline coverage.
- Add the standalone `examples/android-example` Compose app with scenario and locale controls.

## 0.1.0-dev.1

- Add the Phase 0 configuration API.
- Add strict protocol 0.1 models and canonical-fixture decoding tests.
- Enforce capability/content matching and product-selector cross-field constraints while decoding.
- Add conformance coverage for integral revision spellings, the canonical revision ceiling, and
  non-finite layout values.
- Add provider-neutral commerce result types and a deterministic mock provider.
- Configure the Android library for Jetpack Compose consumption; native paywall
  rendering remains out of scope until Phase 1.
