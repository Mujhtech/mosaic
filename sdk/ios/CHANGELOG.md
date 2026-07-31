# Changelog

## 0.1.0-dev.6 — 2026-07-27

Operational hardening. The SDK remains pre-1.0; see
`docs/known-limitations.md`.

- Restore the declared iOS 15 floor. Trusted-time evaluation now reads
  `CLOCK_MONOTONIC_RAW` directly instead of the iOS 16-only
  `ContinuousClock`, with no change to schedule or anchor semantics. A
  dedicated iOS 15 typecheck command guards the regression.
- Add `PrivacyInfo.xcprivacy` declaring the `SystemBootTime` API reason
  `35F9.1`, the host-supplied user ID, installation ID, user attributes, and
  Product/purchase interaction data types, `NSPrivacyTracking` false, and no
  tracking domains. It ships through both SwiftPM resources and the podspec
  resource bundle.
- `Mosaic.configure` no longer fails the host application's launch when
  Application Support is unreachable. Configuration cache, identity,
  assignment replay, and the analytics queue degrade to process-lifetime
  storage, the bundled fallback stays reachable, and the safe
  `delivery_persistence_unavailable` diagnostic is reported.
- Fix the packaged bundled fallback, which could never be accepted: its
  synthesized release digested an Asset URL as top-level JSON and was tagged
  with the advertised Configuration Delivery version rather than the v1 shape
  it actually builds.
- Replace three host-reachable trap paths with safe failures.
  `MosaicPreviewMessageCodec(protocolVersion:)` is now failable, unsupported
  Local Preview fallback versions are dropped instead of trapping, an
  unresolved background token rejects the document, and an unsupported
  RevenueCat product handle raises a sanitized purchase failure.
- Require an analytics acknowledgement to echo the contract version of the
  batch it acknowledges. A 200 response carrying a different version is now
  retried instead of applying one contract's result semantics to another's
  batch. The response codec still reads both versions.
- Report the exact artifact version. `mosaicSDKVersion` and the analytics
  context `sdkVersion` both equal the published podspec version, so the
  `Mosaic-SDK-Version` header no longer drifts from the artifact.
- Relax the optional RevenueCat adapter's `purchases-ios` dependency from
  `exact: "5.81.2"` to `.upToNextMajor(from: "5.81.2")`; `Package.resolved`
  still records the verified version.
- Document CocoaPods as local-path-only until release artifacts are
  published, and state that background analytics delivery is best effort and
  `refresh()` is not cancellable.
- Bind bucketing tests to the canonical assignment-vector fixture and pin a
  repository-root `.swift-format` configuration.
- Attach the Experiment attribution tuple to conversion events only when the
  presentation actually records a statistical exposure. Fallback presentations
  and QA-override presentations emit no exposure, so their tuple-carrying
  `product_selected` could displace the Variant's legitimate denominator row in
  `product_selection_purchase_start`. Tuple attachment and exposure emission
  now share one predicate so they cannot drift apart. Only the tuple is
  removed; the events remain on Event Schema v2, and
  `experiment_fallback_presented` still carries the tuple as a diagnostic.
- Add conformance coverage proving the closed codec rejects all six canonical
  negative analytics fixtures across v1 and v2, and proving conversion events
  are emitted on Event Schema v2 with the complete immutable Experiment tuple
  whenever a presentation exposes an assigned Variant.
- Consolidate the two full-paywall SwiftUI goldens into one. Both rendered the
  same canonical Protocol 0.2 document and produced byte-identical output; the
  removed baseline was a stale Protocol 0.1-era recording. The remaining
  baseline was re-recorded after visual review on Xcode 26.5 / iOS 26.5.
- Add strict Configuration Delivery v3 and Experiment Assignment v1 decoding,
  exact compatibility derivation, trusted schedule evaluation, stable
  assignment/group bucketing, mutual exclusion, and non-production QA override
  handling while retaining Delivery v2/v1 readers.
- Add bounded backup-excluded assignment replay diagnostics, identity-aware
  clearing, completion retention, pre-presentation reauthorization, foreground
  refresh, selected-variant commerce capability checks, and safe normal-Placement
  fallback.
- Add Analytics Event v2 experiment assignment, exposure, and fallback events
  with immutable all-or-none experiment attribution on eligible Product and
  purchase lifecycle events, while preserving queued v1 decoding.
- Add strict Configuration Delivery v2 and Placement Decision v1 acceptance.
- Add offline deterministic targeting, exact rollout bucketing, explicit
  no-Paywall/fallback decision results, and privacy-safe bounded traces.
- Add actor-isolated app-install identity persistence, identify/reset APIs, and
  atomic typed user attributes.
- Add provider-neutral Commerce Configuration v2 decoding, `2,1`
  negotiation, exact native-store mappings, Product-to-Entitlement grants,
  recovery modes, and asynchronous local-delivery types while retaining v1.
- Add the optional `MosaicStoreKit` package with exact Product loading,
  verified purchase/restore/current-Entitlement handling, durable idempotent
  acceptance before finish, transaction update recovery, and safe diagnostics.

## 0.1.0-dev.5

- Add version-matched CocoaPods specifications for `MosaicSDK` and the optional
  `MosaicStoreKit` adapter, including CocoaPods-compatible fallback resources.
- Add strict Commerce Configuration v1 decoding, canonical digest validation,
  exact Configuration Release association, atomic last-known-valid caching,
  bundled fallback, safe diagnostics, and the frozen hosted sidecar wire
  contract.
- Add the core `MosaicCommerceProvider` boundary, installable provider router,
  direct and Offering/Package mappings, mapped Entitlements, and explicit
  pending, deferred, provider-unavailable, and restore-cancelled outcomes.
- Add an optional `MosaicRevenueCat` package pinned to purchases-ios 5.81.2.
  The host owns `Purchases.configure`; the adapter resolves exact native
  purchase handles and sanitizes typed purchase, restore, and lookup failures.
- Add canonical sidecar, hosted request, cache recovery, app-owned provider,
  RevenueCat mapping, result, and failure tests.
- Invalidate provider-native purchase handles whenever Commerce Configuration
  is installed or replaced, reject stale in-flight RevenueCat loads, and
  require an exact-mapping product reload before purchase.
- Align Commerce Provider v1 restore and active-Entitlement results: restore
  existing access as `restored`, and distinguish available, unknown,
  provider-unavailable, and failed lookup outcomes without treating failures
  as inactive.
- Require installed commerce adapters to report their runtime capabilities,
  reject identity, Mosaic adapter-version, or declared-capability drift before
  accepting mappings, and keep RevenueCat's Mosaic adapter version `1.0.0`
  separate from the pinned purchases-ios version.
- Carry one complete bounded diagnostic on every purchase, restore, and active
  Entitlement provider failure. The configured boundary repairs unsafe custom
  values while renderer outcomes continue exposing only stable safe codes.

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
