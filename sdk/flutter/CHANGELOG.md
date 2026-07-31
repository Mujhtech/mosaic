# Changelog

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
