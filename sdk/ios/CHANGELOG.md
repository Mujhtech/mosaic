# Changelog

## 0.1.0-dev.4

- Add strict Protocol 0.2 decoding while preserving the approved Protocol 0.1
  path without implicit migration.
- Render Stack, Carousel, Switch, Countdown, expanded styling and visibility,
  and inherited Product Card Default/Selected states with native SwiftUI.
- Conform to Protocol 0.2 RC2 multi-screen navigation, semantic Icon, unified
  container Button, async progress content, and safe external HTTPS actions;
  retain the separate approved Protocol 0.1 reader and renderer behavior.
- Conform to Protocol 0.2 RC3 authored Product Cards and Product Badges,
  card-identity selection, localized safe product templates, unavailable-card
  fallback, recursive selected styles, RTL overlay anchors, and merged native
  selectable accessibility semantics.
- Conform to Protocol 0.2 RC4 document design tokens, colour/gradient/media
  backgrounds, one box shadow, bundled and HTTPS image/video assets, uniform
  two-axis sizing, and explicit Screen/Sheet presentation.
- Render decorative video with muted autoplaying `AVPlayerLooper`, native
  poster/colour fallback and diagnostics; present Sheet destinations with
  SwiftUI while retaining the most recent Screen and shared navigation state.
- Add exact RC4 capability reporting, atomic invalid-token/media rejection,
  unbounded-Fill fallback, fixed clipping, physical gradient geometry, and
  Simulator coverage for native sheets and horizontal Product Cards.
- Preserve component runtime state across forward/back navigation, reset the
  navigation history for accepted revisions, merge button descendants into one
  accessible target, and diagnose root-back no-ops and failed external opens.
- Add Local Preview 0.2 negotiation, capability reporting, draft gating, mock
  commerce, runtime-state reset, and structured last-accepted-draft recovery.
- Add Protocol 0.2 fixture, interaction, accessibility, RTL, large-text,
  SwiftUI consumer, and simulator golden coverage.
- Package the current Protocol 0.2 fallback so disconnected previews exercise
  horizontal Product Selector layout and the Phase 2.5 component set.

## 0.1.0-dev.3

- Add the platform-neutral Local Preview 0.1 WebSocket codec, SwiftUI client,
  capability report, heartbeat, and bounded reconnect behavior.
- Apply document and mock-commerce revisions independently with stale and
  conflict protection; acknowledge drafts only after native rendering begins.
- Add safe validation, compatibility, asset, product-fallback, and render
  diagnostics while preserving the last accepted or bundled paywall.
- Add Studio-driven mock products, purchase and restore outcomes,
  entitlements, locale, RTL, and accessibility text scaling.
- Add a connected Phase 2 example and canonical local-preview fixture,
  transport, state, commerce, SwiftUI, and accessibility tests.

## 0.1.0-dev.2

- Decode and semantically validate all Mosaic Protocol 0.1 RC1 components.
- Render the canonical complete paywall with native SwiftUI.
- Add locale fallback, long-copy wrapping, right-to-left layout, and protocol
  accessibility projection.
- Add deterministic mock product loading, selection, purchase, restore, close,
  and explicit normalized outcomes.
- Add safe local candidate and bundled canonical fallback resolution.
- Add conformance, state, accessibility, fallback, SwiftUI consumer, and iOS
  Simulator golden tests.
- Add a native example application covering the Phase 1 mock-commerce states.

## 0.1.0-dev.1

- Add the Phase 0 configuration API.
- Add strict protocol 0.1 models and canonical-fixture decoding tests.
- Enforce schema scalar constraints, capability/content matching, and product-selector relationships.
- Enforce the canonical revision ceiling and reject non-finite layout values consistently with the
  other first-party readers.
- Add provider-neutral commerce result types and an actor-based mock provider.
- Add a SwiftUI consumer compilation test; native paywall rendering remains out
  of scope until Phase 1.
