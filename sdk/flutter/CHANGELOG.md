# Changelog

## Unreleased

- **Read Paywall Protocol 0.4 "Motion" alongside 0.3.** The decoder dispatches
  on `schemaVersion`; versions stay exact identifiers, so a 0.3 document is
  still read as 0.3 and gains no motion vocabulary. `0.4` adds the
  `designSystem.motions` catalog, `motionToken`/inline motion references, and
  per-node `motion` blocks, and applies the two cleanups `0.3` named for it:
  `style.productCardStates` is gone from the capability vocabulary, and Feature
  List and Timeline share one `dot`/`ordinal`/`icon` marker union with an
  optional per-item override, so a list can finally express a negated item.
- Add the three motion primitives, rendered with native Flutter widgets.
  **appear** fades or fade-rises a node once when it enters a screen, travelling
  *to* its laid-out position; **selection** interpolates the closed field list
  between a selectable box's Default and Selected styles, switching semantic
  colours, background kind, and padding discretely at the half-way point; and
  **loop** pulses one Button per screen a bounded 1–5 cycles, then rests
  permanently. Every animation's terminal frame is the static rendering, which
  a golden asserts by comparing the finished frame against the motion-disabled
  capture of the same document. A Button carrying both `appear` and `loop`
  starts both clocks at node entry, in one `initState` pass — the pulse does not
  wait for the entrance — and the two compose on the node's own values as
  `opacity = static × appearProgress × loopOpacityMultiplier`, `scale =
  loopScale`.
- Add `MosaicMotionDriver`, an injectable enabled flag plus a per-animation
  elapsed-time source, alongside the existing `MosaicClock`. Tests pin frames
  with `tester.pump(duration)` and static goldens are captured with
  `MosaicMotionDriver.disabled()`.
- **The Countdown tick no longer rebuilds the whole document.** It moves onto
  the motion driver as a scoped `Listenable`, so one second advancing one line
  of text rebuilds the Countdown — and the Product Card labels that quote one —
  rather than every node on the screen.
- Add an injectable reduced-motion signal defaulting to
  `MediaQuery.disableAnimationsOf`, read once per frame at the renderer
  boundary. Under reduced motion `appear` becomes opacity-only with no
  transform at any instant, `selection` applies instantly, `loop` is fully
  disabled at rest, and — the 0.4 ruling — a video background does not play at
  all: the declared poster is rendered, and its fallback colour when there is
  none.
- Report capabilities per schema version. `MosaicCapabilityReport` now exposes
  `capabilitiesBySchemaVersion` and `capabilitiesFor(version)` in place of a
  single flattened `supportedCapabilities` map, which could only have named one
  version for a capability that exists at both. Configuration Delivery and
  Local Preview negotiation stay pinned to `0.3`: Local Preview `0.3` `$ref`s
  the `0.3` paywall schema directly and Delivery v3 carries exactly one paywall
  protocol, so advertising `0.4` there would claim a contract neither has been
  bumped to.

- **Adopt Paywall Protocol 0.3, which replaces 0.2 outright.** There is no
  migration path, no dual-version code, and no compatibility shim: a 0.2
  document is an unknown version to this reader and is rejected atomically,
  resolving through last accepted, then bundled fallback, then configuration
  unavailable. Every `0.2` artifact, symbol, fixture path, test, and golden has
  been deleted or renamed rather than deprecated alongside 0.3. The Local
  Preview contract and its WebSocket subprotocol move to `0.3` /
  `mosaic.local-preview.v0.3` in the same step.
- Add four components. **Tabs** presents two through eight labelled panels with
  exactly one visible; the initially selected tab is always authored through
  `initialTabId`, so reordering the array cannot change which panel opens, and
  `selectedLabelColor` is required so a deliberate unchanged colour and an
  unauthored one cannot share an encoding. **Timeline** draws two through
  twelve ordered vertical entries over one continuous connector with a closed
  `dot`/`ordinal`/`icon` marker union; an absent marker means no glyph and an
  unbroken connector, and marker and description styling is required exactly
  when an entry consumes it and forbidden when none does. **Award** and
  **Social Proof** are passive, with closed emblem and rating shapes.
- Add tab selection as runtime state and as a `visibility` condition. Runtime
  state gains a `tabs` map reset from `initialTabId` on every accepted
  revision, and `{"mode": "tab", "tabsId", "equals"}` removes a node from
  layout, the accessibility tree, and focus order exactly as a false Switch
  condition does. A condition naming an unknown tab, a Tabs component on
  another screen, or the Tabs component the node belongs to rejects the
  document.
- **Visibility evaluation now takes `{switches, tabs}` and throws
  `MosaicVisibilityStateException` when a condition names a controller the
  supplied state does not carry.** Resolving it instead would read back as
  `false`, which is a component silently disappearing rather than a caller
  being told it has a bug. There is deliberately no fallback.
- Rename the two-state box styles to the protocol's neutral names —
  `MosaicSelectionStyles`, `MosaicSelectionStateStyle`, and
  `MosaicSelectionStateStyleOverride` — because Tabs now shares the Product
  Card overlay contract.
- **Compose no accessibility announcement.** Each announced segment is its own
  element inside a labelled container, in protocol order, and the platform
  supplies whatever pause or punctuation its locale and screen reader use.
  Joining segments with `". "` is renderer-invented punctuation exactly as a
  hardcoded "out of" is a renderer-invented word, and it is wrong outside Latin
  script (`。`, `،`, `।`, or no mark at all). An absent optional segment —
  a Social Proof rating, an Award subtitle, a Timeline description — produces
  no element, never an empty one. Social Proof avatars, Award emblems, and all
  Timeline markers and connectors are decorative: drawn, never announced, never
  focusable. `mosaicAccessibilityAnnouncement` is the pure contract the
  renderer and the conformance corpus both consume, so the two cannot drift.
- **A Button is one accessibility element.** Its authored name does not change
  when it becomes busy — a name that changes mid-operation is disorienting and
  breaks UI automation — so the resolved `mosaic.a11y.in_progress` is carried
  as the control's value. Neither idle `children` nor `inProgressChildren` are
  announced, so both states are consistent.
- Implement the reserved accessibility strings. `mosaic.a11y.rating` and
  `mosaic.a11y.in_progress` are declared in the default catalog exactly when
  the document contains something that announces them, each placeholder
  appears exactly once per translation, and no other template expression is
  interpreted. A Social Proof rating counts steps against a points maximum, so
  the renderer substitutes the rating **in points** rather than announcing
  `value` against `maximum` — which would say "9 out of 5". Word order and all
  wording travel with the catalog: the renderer composes no connective of its
  own. Numerals are ASCII by contract — `.` separator, no grouping, one
  fraction digit for a half step — so that three renderers produce identical
  bytes; `package:intl` is deliberately not a dependency, and locale-aware
  numerals are a deferred protocol change. Timeline ordinal markers follow the
  same rule.
- Consume both cross-SDK conformance corpora byte for byte, each with a
  case-count floor so a truncated corpus fails rather than passing over
  nothing: `rating-announcement.json` (10 cases) and
  `accessibility-announcement.json` (11 cases).
- Add capabilities `component.tabs`, `component.timeline`, `component.award`,
  `component.socialProof`, `condition.tabVisibility`, and
  `accessibility.reservedStrings`, each derived only when the corresponding
  feature occurs.
- **Remove the node types earlier protocol versions defined.** `verticalStack`,
  `purchaseButton`, `restoreButton`, `closeButton`, and `legalText` are absent
  from the 0.3 capability set and from the 0.3 node union, so no accepted
  document could contain one; the model types, their renderer builders, their
  validation arms, and the `_AvailableProductOption` legacy shape they fed have
  all been deleted. The named rejection survives as raw-string matching in the
  decoder rather than as a model type — a type that exists only to be rejected
  is still a type a caller can construct, and the sealed union would then have
  to carry arms for shapes the contract forbids.
- Remove the legacy Product Selector shape. `cards` decodes through a
  non-empty-list check, so `cards.isEmpty` was unreachable and
  `productReferenceIds`, `initiallySelectedProductReferenceId`, and the legacy
  option renderer were dead; `_AvailableProductOption.card` is now
  non-nullable. `MosaicProductReference.badge` and the `MosaicStackNode.spacing`
  alias were likewise never set by any 0.3 decoder and are gone.
- Fail the example's fixture sync loudly on a missing or empty canonical
  source instead of succeeding over it. A sync that silently passed would
  leave the previous version — or nothing — bundled as the fallback while
  every command reported success.

- Canonicalize every host-supplied locale identifier through
  `mosaicNormalizeLocaleTag` before it reaches the analytics event context, the
  `application.locale` decision attribute, or catalog resolution, implementing
  the 2026-08-05 locale-semantics rulings. Empty subtags are dropped, the tag
  is truncated at the first singleton subtag, and case is canonicalized, so
  POSIX (`en_US`, `en_US.UTF-8`), ICU region-override (`en_US@rg=gbzzzz`),
  extension (`en-US-u-ca-buddhist`), and mixed-case (`PT_br` → `pt-BR`) shapes
  all reach the catalog and the rule they always denoted. Locale comparison is
  symmetric: the authored operand is read in the same canonical form as the
  runtime value. Previously such an identifier failed the closed locale codec,
  which threw out of every analytics `record` and left locale targeting with no
  attribute at all. The candidate chain is now uniformly requested → base
  language → `fallbackLocale` → `defaultLocale`; an unusable requested locale
  contributes no candidate instead of promoting `defaultLocale` ahead of
  `fallbackLocale`. Values are cut at the first `@`, `.`, or `#`, so Java
  `Locale.toString`'s `en_US_#u-rg-gbzzzz` also denotes `en-US`.
- Apply the uniform Placement Decision `1` presence rule to every source: a
  value the host reported `exists` even when Mosaic cannot use it, and
  comparisons against it are unknown rather than false. `context.country` no
  longer disappears when it is not an alpha-2 code, and an out-of-set
  `device.platform` compares unknown instead of false. An authored
  `application.locale` operand with no canonical form makes `equals`,
  `not_equals`, `in`, and `not_in` unknown, and one unusable member makes a
  whole `in`/`not_in` list unknown even when another member matches. Each of
  these previously answered "no", which a negated condition read as a positive
  match.
- Catalog lookup recovers the leading language subtag when a requested tag has
  no canonical form (`en-US-verylongsubtag` reaches the `en` catalog) through
  the new `mosaicRecoverLocaleLanguage`. Placement targeting deliberately does
  not recover: an unnormalizable host locale is present-but-unknown there, so
  `exists` is true, every comparison is unknown rather than false, and an
  authored range with no canonical form makes `locale_matches` unknown so a
  negated condition cannot read it as a match.
- Report `product_selection_default_substituted` once per Product Selector when
  an unavailable authored default — or an unavailable current selection — is
  replaced by the first available option. The substitution itself is unchanged
  and Protocol-sanctioned (`unavailableFallback.selection: firstAvailable`); it
  was previously silent, and the `product_selected` payload's `source` enum
  admits only `default` and `user`, so no wire value can distinguish a
  substituted selection from an authored one. The code matches the Swift SDK.
- Report `analytics.platform.substituted` once at configure time when the
  running Flutter target is neither iOS nor Android. The analytics event
  contract's `context.platform` is a required, closed `ios | android` enum, so
  such events are filed under `android`; with collection now on by default the
  substitution is continuous and must not be silent.
- Require `applicationId` and `platform` on
  `mosaicCustomerEntitlementCacheNamespace`. They scope the authority, and a
  default would let a caller omit the scope and collide with another install's
  cached access.
- A Placement Decision source this SDK cannot read now compares unknown for
  every operator, including `exists` and `does_not_exist`. Reporting it as
  absent made `does_not_exist` a positive Rule match asserting the host
  reported nothing, when the truth is that Mosaic could not read what it
  reported.
- **Breaking default:** analytics collection is now on by default.
  `Mosaic.configure` defaults `analyticsEnvironmentSettings` to
  `collectionEnabled: true`, so a client configured with a base URL (or an
  explicit analytics transport) wires the analytics runtime and queues events
  without further opt-in. Hosts opt *out* through
  `analyticsEnvironmentSettings`, `analyticsHostEnabled`, or
  `setAnalyticsCollection`, and remain responsible for their own end-user
  consent. The Environment's server-side collection setting still gates
  ingestion. Transaction observation is unchanged and stays opt-in.
- Include the verified cached `knownSnapshotAuthorityDigest` in authoritative
  entitlement v2 sync requests. Stale customer, scope, epoch, or digest
  bindings are discarded and request a full snapshot. Decode
  `policy_unavailable` without fabricated minimum-support requirements and
  expose it as safe `unavailable`, never `inactive`; invalidate the retained
  authority snapshot with an atomic durable tombstone first so it cannot be
  replayed after restart. Recognizable malformed policy-unavailable responses
  fail closed through the same path, and storage failure reports
  `entitlements.authority.policy_invalidation_persistence_failed` while
  blocking cache bootstrap until tombstone persistence succeeds.
- Add authoritative entitlements (Authoritative Entitlement Contract v1 and
  Customer Access Token Contract v1) under a purely additive `MosaicCustomer…`
  namespace. No provider-observed symbol changed, and Placement targeting
  continues to read provider-observed entitlements. `Mosaic.configure` gains
  `customerTokenProvider`, `customerEntitlementCache`,
  `customerEntitlementTransport`, `customerEntitlementSettings`, and `clock`.
  The sync request is a `POST` carrying the canonical `entitlementSyncRequest`
  record, which is where contract negotiation lives. It never carries a
  `billingCustomerId`: the Customer Access Token is the sole customer selector,
  so a hint could only narrow the answer or fail the request.
- Mosaic Billing **requires an application backend**. There is no anonymous
  mode: your server mints the Customer Access Token, and a client-generated
  installation identifier can never create or select a Billing Customer.
  Without a token provider the subsystem is never constructed and every
  authoritative read reports `unavailable`, never `inactive`.
- Reading is closed and whole-document. Any unknown contract version, record
  type, field, or enumeration member rejects the entire record; the one
  exception is an unrecognized `entitlementKey`, which is Project data and is
  carried. Every rejection yields `unknown` and preserves the cache, except a
  customer, Project, or Environment binding mismatch, which clears it and emits
  a high-severity diagnostic.
- Cache acceptance follows the normative order — contract version, customer
  binding, content digest, snapshot-version monotonicity, `asOf` regression —
  and is atomic: a reader never keeps the entries it understood from a document
  it rejected. The cache-decision, freshness, and snapshot-digest reference
  vectors in `packages/test-fixtures` are executed as conformance tables so
  Dart cannot drift from Go, Swift, and Kotlin.
- Bounded grace is the shipped offline policy, driven by the server-issued
  `refreshAfter`, `validUntil`, and `staleGraceSeconds` (strict is the same
  fields with a zero grace window). The canonical `snapshotUnchanged` record is
  the only thing that slides the freshness window; a bodyless `304` preserves
  the cache and re-anchors trusted time but does not move the window, because
  nothing in a bodyless response is a contract-pinned carrier of refreshed
  windows. Clock-skew tolerance is 60 seconds and a backwards device clock
  forces expired-equivalent behaviour.
- Customer Access Tokens are held in memory only, never persisted, never parsed,
  and never present in a log or diagnostic — diagnostics carry `tokenId`. A
  `401` forces exactly one refresh and one retry per token generation; a token
  provider failure enters a 30-second cooldown and reports `unavailable`.
- The snapshot cache lives in the application **cache** directory, never the
  support directory, so it cannot travel in a device backup. It is keyed per
  customer in the path, written atomically, checksummed, decoded with strict
  closed keys, and degrades to memory with an
  `entitlements.cache_unavailable` diagnostic when no cache directory exists.
  An identity change deletes sibling records.
- Transaction Observation submissions now carry the current Customer Access
  Token in a `Mosaic-Customer-Token` header when one is held. This is the
  evidence rung that binds an identified user's purchase to their Billing
  Customer server-side; without it a validated purchase can only anchor to a
  purchase-anchored customer. It is transport-level only — the Billing
  Ingestion v1 observation record is unchanged. The token is read at send time
  rather than enqueue time, so a token minted after the purchase still binds a
  retry, it is never persisted with the queue, and it never appears in a
  diagnostic. Reading it never mints: observation delivery is fire-and-forget,
  so an absent or expired token simply omits the header, which is a valid
  anonymous submission.
- Add `restorePurchasesAndSync()`, which reports the native provider outcome and
  Mosaic's authoritative outcome separately. `restored` requires an accepted
  snapshot at a higher version; otherwise it is `validationPending` within a
  bound of 3 attempts over roughly 6 seconds. Purchase and restore paths are
  never blocked: the authoritative refresh they trigger is unawaited and never
  alters a presentation result.

- Add the opt-in Transaction Observation handoff (Billing Ingestion Contract
  v1). The SDK submits and persists the canonical `clientTransactionObservation`
  record — envelope, `sourceAuthority: client_observation`, typed
  `transactionReference`/`providerOrderReference`, `context`, and `correlation` —
  and reads the canonical `observationSubmissionResult` record. Both are
  asserted against the canonical fixtures. A response in any other shape,
  contract version, or record type is retried, never guessed at. A client
  observation never asserts a Store Environment. It is off by default: without
  `Mosaic.configure(transactionObservation: ...)` the subsystem is never
  constructed, and nothing is observed, queued, persisted, or submitted.
- An observation is a trigger for server-side validation, never proof. The
  sealed submission result has exactly four members —
  `MosaicTransactionObservationAcceptedForValidation`, `...Duplicate`,
  `...PermanentlyRejected`, `...RetryableFailure` — and none of them means
  validated, verified, confirmed, or entitled. No purchase result, presentation
  result, or interaction outcome is re-labelled by it.
- The handoff can never block or alter a purchase: the renderer's sink returns
  `void`, is never awaited, and a sink that throws is contained rather than
  becoming a failed purchase.
- References are sanitized structurally at construction. An Apple JWS
  representation, a device-verification value, a raw Google Play purchase
  token, and `mock-*`/`preview-*` placeholders cannot be submitted. The iOS
  adapter's local `storekit_` prefix is stripped at this one decoding boundary
  so the wire value is the raw decimal App Store transaction identifier,
  carried as a string so `UInt64` values survive.
- Add a dedicated durable queue in app-private application-support storage,
  following the `MosaicExperimentAssignmentStore` convention with its own
  storage interface, memory and file implementations, and SHA-256 namespace. It
  is deliberately not the analytics queue: the contracts, retention policies,
  and consent decisions are separate. Bounded to 128 observations/64 KiB,
  14-day retention, 10 attempts with full-jitter exponential backoff honouring
  `Retry-After`, and a persisted 256-entry acknowledged-key ring.
- The submission identifier is deterministic and derived only from the
  reference kind and value, so the renderer path and the provider-update path
  submit one purchase once, and a retry after an ambiguous timeout is answered
  `duplicate` instead of creating a second record.
- Add `Mosaic.transactionObservations`, `setTransactionObservation`,
  `flushTransactionObservations`, and `transactionObservationDiagnostics`.
  Disabling collection clears the queue and deletes the persisted document.
- Add the optional `MosaicCommerceUpdate.providerOrderReference` join handle
  and accept it as an optional key in the native-store channel decoder. The
  codec version is unchanged and an adapter that omits it is unaffected.
- No new dependency, no background-execution machinery, and no server
  credential of any kind. Store Notifications remain the authoritative and
  timely ingestion path; this handoff is a latency and attribution
  optimization.
- Dismiss a presented Sheet when a new document is accepted. Navigation reset
  rebuilt the history from the new document but left the superseded
  revision's modal route standing, so the reset paywall sat behind a barrier
  that reported no accessible content at all — the reset selection, Switch,
  and Carousel state were unreachable to a screen reader even though they had
  been applied. iOS and Compose derive the sheet from navigation state and
  were never affected.

## 0.2.0-dev.11

- Raise the supported floor to Flutter 3.22 / Dart 3.4, the tested minimum.
  This matches the floor `mosaic_revenuecat` already required.
- Reconcile the package version, the `mosaicFlutterSdkVersion` wire constant,
  and this changelog, so the `Mosaic-SDK-Version` header, the analytics context
  `sdkVersion`, and the capability report all report the exact package version.
- Make persistence failure safe on every public path: analytics queue writes,
  cache clears, lifecycle and queue-threshold delivery, `Mosaic.dispose()`, and
  identity writes now degrade to a safe diagnostic code instead of throwing or
  escaping as an uncaught error. A failed identity write no longer poisons
  later identity resolution.
- `decidePlacement` returns `MosaicPlacementDecisionUnavailable` with
  `identity.unavailable` when identity cannot be resolved, instead of throwing.
- Add `MosaicIdentityController.lastSafeCode` and the
  `mosaicAnalyticsStorageUnavailableCode` /
  `mosaicIdentityStorageUnavailableCode` diagnostic codes.
- Emit Analytics Event v2 conversion events for an Experiment presentation.
  `product_selected` and the purchase lifecycle events now carry the immutable
  all-or-none Experiment tuple whenever the presented Paywall is a successfully
  exposed original Variant. Experiment conversion attribution joins solely on
  that tuple, so emitting exposures on v2 while emitting conversions on v1
  reported zero conversions for every Experiment, silently.
- Conversions from a fallback presentation, and from a QA override, are emitted
  without the tuple: neither is an exposed Variant presentation, and a
  tuple-carrying fallback conversion can displace the Variant's own row in the
  conversion denominator.
- Accept and exactly re-encode the canonical attributed v2 conversion fixtures;
  reject a partial tuple, a tuple on a non-conversion event, a v1 event carrying
  a tuple, and a v2 event without one.
- Deliver v2 events in a v2 batch and read the acknowledgement as v2. Previously
  every Experiment batch was read as a delivery failure, retried, and dropped.
- Accept `configurationDeliveryVersion: "3"` in the analytics context of a v2
  event, matching the canonical schema.
- Reject an incomplete rollout attribution tuple, and never emit one. A
  `placement_paywall_selected` or `placement_no_paywall` event carrying an
  assignment key type without its bucket and algorithm was permanently rejected
  by ingestion.
- Document honest installation (git pin or local path; not published to
  pub.dev) and record the known limitations register.

## 0.2.0-dev.10

- Add exact Experiment Assignment Contract v1 decoding with canonical
  assignment hash vectors, deterministic bucketing, and stable Experiment
  ordering within a Placement.
- Accept Configuration Delivery v3 atomically, including delivered Experiment
  assignments, mutual-exclusion groups, and emergency-stop handling.
- Add the bounded, digest-only Experiment assignment store, so no raw
  installation or user identifier is ever persisted.
- Evaluate Experiments conservatively: unreliable time, missing identity,
  unready required Products, and unsupported Variants fall back to normal
  Placement with a recorded reason.
- Emit Analytics Event v2 Experiment exposure, assignment-failure, and
  fallback-presented events only after a successful presentation.

## 0.2.0-dev.9

- Add the exact Analytics Event Contract v1 event, batch, and partial-response
  codec with direct canonical fixture conformance.
- Add disabled-by-default Environment/host collection gates, immutable
  event-time identity and 30-minute sessions, app-private backup-excluded
  bounded persistence, priority overflow, expiry, coalesced delivery, and
  jittered partial-batch retry.
- Instrument hosted Placement, Paywall, Product, purchase, and restore flows
  without changing provider outcomes; Local Preview and unhosted/bundled
  Paywalls remain analytics-free.
- Align identity resets across platforms: user reset retains installation,
  while installation reset rotates installation and clears user-bound state.

## 0.2.0-dev.8

- Accept frozen Commerce Configuration and Provider Contract v2 while
  preserving strict v1 RevenueCat/custom-provider decoding and fallback.
- Add native-store activation, exact StoreKit/Google mappings, immutable
  Product grant snapshots, explicit recovery modes, complete runtime offer
  metadata, and provider-neutral asynchronous commerce updates.
- Add the optional `mosaic_native_store` thin bridge with StoreKit/Google
  factories, closed channel DTOs, revision filtering, update deduplication,
  invalidation/disposal, and safe missing-plugin outcomes.
- Prefer hosted v2 sidecars while advertising `2,1`; retained v1 sidecars
  remain valid.

## 0.2.0-dev.7

- Enforce exact adapter-owned provider identity and capability declarations
  before activating mappings; the RevenueCat adapter version is `1.0.0`
  independently of `purchases_flutter 10.4.3`.
- Require the hosted response to repeat the exact retained ETag and
  Configuration Release ID before accepting Commerce Configuration `304`.
- Attach the complete safe correlated provider diagnostic to Product-load,
  purchase, restore, and active-Access failures.
- Normalize RevenueCat's already-purchased restore recovery with no active
  Access to `nothingToRestore`.
- Add strict Commerce Configuration v1 decoding with canonical digest,
  release/scope/Product-set binding, credential rejection, and safe
  diagnostics.
- Cache accepted Commerce Configuration bytes atomically with their Delivery
  v1 release and retain the last valid pair after sidecar failure.
- Add an SDK-local custom commerce Provider/factory/router boundary and
  normalized pending, deferred, Provider-unavailable, and Entitlement failure
  outcomes.
- Add the optional nested `mosaic_revenuecat` adapter package pinned to the
  official `purchases_flutter 10.4.3` release.
- Bind hosted sidecar ETags to canonical content digests, safely revalidate
  only complete retained pairs, and align restore and active Entitlement
  outcomes with Commerce Provider Contract v1.

## 0.2.0-dev.6

- Add strict Configuration Delivery v1 validation for releases, embedded
  Protocol 0.2 paywalls, digests, capabilities, Placements, products, and
  remote asset bindings.
- Add public SDK key/base URL configuration, injectable HTTP transport,
  capability headers, bounded timeouts, strong ETag revalidation, and `304`
  handling.
- Add atomic persistent cache writes, cache/bundled fallback reconstruction,
  coalesced manual refresh, safe last-known-valid retention, and diagnostics.
- Add in-memory Placement resolution and native `MosaicPlacementHost`
  presentation that never performs a remote fetch.

## 0.2.0-dev.5

- Add strict frozen RC4 decoding for design-system colour/background/shadow tokens, gradient and decorative media backgrounds, remote/bundled image and video assets, two-axis Fit/Fill/Fixed sizing, and Screen/Sheet presentation.
- Render tokenized solid, linear, and radial backgrounds plus one native Flutter shadow while preserving the protocol's physical clockwise gradient angles in RTL.
- Resolve bundled media only through host callbacks, load HTTPS media natively, autoplay decorative video muted and looping without controls, and apply safe video → poster → colour or image → colour fallback diagnostics.
- Apply width and height sizing uniformly across eligible nodes, diagnose unbounded Fill before using Fit, and clip Fixed visuals without truncating semantics.
- Present protocol Sheet destinations with a full-height safe-area native modal bottom sheet and reconcile forward, back, replacement, and system dismissal with Screen history and scroll state.
- Add direct canonical RC4 decoding, visual behavior, sizing, RTL gradient, Sheet navigation, media fallback, interaction, accessibility, and reviewed golden coverage.

## 0.2.0-dev.4

- Update strict Protocol 0.2 support to frozen RC3 while preserving the immutable Protocol 0.1 reader and renderer.
- Decode authored Product Selector → Product Card → Product Badge structure, enforce passive descendants and unique bindings, and report exact card, badge, template, and state capabilities.
- Track selection by Product Card ID with configured/current availability fallback in authored order, reconcile active-locale availability changes, and expose a safe no-card Purchase-disabled state.
- Render each card as one native mutually exclusive selection target with independent Default/Selected card and badge styles, arbitrary passive child layout, visible/informative descendant-label merging, vertical/horizontal selector directions, and logical RTL overlay anchors.
- Resolve whitespace-tolerant `product.name` and `product.price` templates after localization, prefer the provider title with localized reference-label fallback, and remove price-dependent cards when localized price is null, empty, or whitespace-only.
- Add canonical RC3 decoding, invalid-fixture, interaction, semantics, missing-price, provider-title fallback, horizontal/vertical layout, RTL overlay, 200% text, and golden coverage.

## 0.2.0-dev.3

- Update strict Protocol 0.2 support to frozen RC2 while retaining Protocol 0.1 decoding and rendering behavior.
- Decode and validate 1–10 Paywall Screens, required labels for multi-Screen documents, reachable acyclic forward navigation, same-Screen purchase and Switch references, and accepted-revision navigation reset.
- Replace the superseded Protocol 0.2 specialized/Legal components with generalized Button, Text, and bounded Icon models; recursively reject interactive Button descendants.
- Render Button child and in-progress trees as one accessible native control, preserve idle content, prevent duplicate asynchronous actions, and retain existing normalized commerce outcomes.
- Add native forward/back Screen history with top-on-forward, scroll restoration on back, persistent component runtime state, and a safe root-back diagnostic no-op.
- Open absolute HTTPS actions in the external system browser through `url_launcher`, retaining presentation/history and diagnosing platform launch failures.
- Add canonical RC2 decoding, invalid-fixture, navigation, URL, merged-semantics, RTL Icon, busy-state, fallback, and accepted-revision coverage.

## 0.2.0-dev.2

- Add a separate strict Mosaic Protocol 0.2 reader while retaining the strict 0.1 reader without implicit migration.
- Render generalized stacks, contextual sizing, outer insets, colors, borders, clipping, opacity, typography, and complete product-card state styles with native Flutter widgets.
- Add native Carousel, Switch, and Countdown components with deterministic runtime reset, hidden-state preservation, controlled-clock testing, and accessible semantics.
- Enforce the canonical hidden-selector purchase dependency and emit the safe `purchase.hiddenProductSelector` diagnostic.
- Negotiate Local Preview 0.2 before 0.1 and encode every message with the negotiated envelope version.
- Add exact version-scoped capability reports, strict local-project loading, schema/version matching, and the atomic pre-send capability/compact-byte gate.
- Preserve the last accepted preview revision after invalid or incompatible 0.2 drafts.
- Keep horizontal Product Selector cards top-aligned and add equal-width, side-by-side geometry coverage.
- Add direct coverage for every canonical Protocol 0.2 fixture and Local Preview 0.2 message, migration, fallback, RTL at 200% text scale, native interactions, and a reviewed Flutter golden.

## 0.2.0-dev.1

- Add the Local Preview 0.1 WebSocket client with explicit endpoint, session, and renderer-neutral client identity.
- Report the complete Protocol 0.1 renderer capability set and all five Phase 2 preview capabilities.
- Apply document and mock-commerce revisions with per-document ordering, idempotent acknowledgement,
  stale-revision rejection, and conflict protection that survives reconnects.
- Keep the last accepted draft live after validation, compatibility, or render failure.
- Add bounded reconnect backoff, text-frame and byte limits, heartbeat ping/pong, and safe connection diagnostics.
- Add structured validation, compatibility, and render diagnostics correlated with terminal draft status.
- Adapt local mock product, purchase, restore, and entitlement state to the existing provider-neutral renderer.
- Add a native live-preview widget with locale, RTL, and accessibility text-scale overrides.
- Add canonical message-flow, transport, revision, commerce, reconnect, diagnostic, and widget coverage.
- Upgrade the top-level example into a visible local Studio preview client.

## 0.1.0-dev.2

- Implement the strict Protocol 0.1 RC1 decoder and recursive semantic/capability validation.
- Add exact localization fallback and document-declared RTL direction resolution.
- Add native scroll, stack, text, image, feature, product, purchase, restore, close, and legal renderers.
- Add host-supplied logical bundled-image resolution with localized same-frame placeholders.
- Add product availability fallback, selection, runtime price/period display, and busy/disabled states.
- Add the exact sealed terminal presentation outcomes and interaction-only restore outcomes.
- Add deterministic mock purchase and restore scenarios, safe diagnostics, and capability reporting.
- Add local candidate-to-bundled fallback loading without remote or cached configuration.
- Add direct canonical-fixture, validation, localization, interaction, accessibility, asset, fallback,
  and true Flutter golden coverage.
- Add a top-level native Flutter example with generated canonical fallback and scenario controls.

## 0.1.0-dev.1

- Add the Phase 0 configuration API.
- Add strict protocol 0.1 models and canonical-fixture decoding tests.
- Enforce capability/content matching and product-selector cross-field constraints while decoding.
- Align numeric decoding with the canonical contract by accepting integral JSON revision values in
  the supported range and rejecting non-finite layout values.
- Add provider-neutral commerce result types and a deterministic mock provider.
- Add a configuration-only Flutter example; native paywall rendering remains out
  of scope until Phase 1.
