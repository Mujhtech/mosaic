# Changelog

## Unreleased

- Add Analytics Event Contract v1 decoding, persistent bounded delivery,
  partial-batch handling, privacy controls, sessions, lifecycle flushing, and
  provider-neutral monetization instrumentation.
- Add strict atomic Configuration Delivery v2 and Placement Decision v1 decoding.
- Add deterministic local targeting, typed attributes, safe traces, named fallbacks, and explicit `no_paywall` results.
- Add app-private no-backup identity persistence, reset APIs, and Compose Placement integration while preserving Delivery v1 calls.

## 0.1.0-dev.6

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
