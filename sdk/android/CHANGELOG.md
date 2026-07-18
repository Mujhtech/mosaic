# Changelog

## 0.1.0-dev.4

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
