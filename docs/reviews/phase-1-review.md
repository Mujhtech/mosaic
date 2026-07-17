# Phase 1 Review Report

**Date:** 2026-07-17

**Gate:** Review Gate 1 — Cross-Platform Local Renderer

**Status:** **Accepted with tracked follow-ups**

**Product-owner decision:** **Accepted on 2026-07-17**

**Decision:** **Proceed to Phase 2; the dashboard foundation follow-up was resolved on 2026-07-17**

## Executive Summary

One platform-neutral Mosaic Protocol `0.1` RC1 document now decodes and renders
as a functional native paywall in Flutter, SwiftUI, and Jetpack Compose. The
same canonical fixture exercises the explicitly authorized ten component types,
English, long German copy, Arabic right-to-left layout, mock product selection,
all required purchase outcomes, restore, close, accessibility metadata, image
fallback, product fallback, and bundled-document fallback.

The protocol validator and every available platform build and test suite pass.
The three example applications use native UI surfaces and mock commerce only.
No remote configuration, REST fetching, Studio editing, analytics ingestion,
placement evaluation, experiment infrastructure, or real billing provider was
introduced.

The product owner accepted Phase 1 with tracked follow-ups on 2026-07-17. The
unchanged Protocol `0.1` RC1 bytes are now the approved immutable baseline.
The separately identified dashboard foundation follow-up was repaired and
validated on the same date: the required `sidebar-07`, `login-05`, and
`signup-05` foundations now use Base UI and Phosphor icons, and the dashboard
format, lint, type, test, and production-build checks pass without Radix UI or
Lucide application imports. Phase 2 is authorized.

## Review Inputs

Before implementation and integration, the orchestrator reviewed the root
agent instructions, the agentic implementation plan, the Phase 0 acceptance
report, the product vision and roadmap, the architecture overview, protocol,
SDK, and testing conventions, and the applicable architecture decisions.

Phase 0 was already classified as **Accepted with tracked follow-ups**. Phase 1
therefore began from an accepted foundation.

## Agent Coordination and Ownership

Exactly four requested subagents were used. No fifth implementation or review
agent was created.

| Agent | Owned paths | Delivered | Cross-owned platform implementation edits |
| --- | --- | --- | --- |
| `mosaic_protocol` | `protocol/**`, canonical fixture, protocol documentation | Protocol `0.1` RC1, schemas, compatibility manifest, validation, canonical fixture, protocol tests | None |
| `mosaic_flutter` | `sdk/flutter/**`, `examples/flutter-example/**`, Flutter documentation | Dart decoder, Flutter renderer, mock commerce, fallback, explicit results, tests, example | None |
| `mosaic_ios` | `sdk/ios/**`, `examples/ios-example/**`, iOS documentation | Swift decoder, SwiftUI renderer, mock commerce, fallback, explicit results, tests, example | None |
| `mosaic_android` | `sdk/android/**`, `examples/android-example/**`, Android documentation | Kotlin decoder, Compose renderer, mock commerce, fallback, explicit results, tests, example | None |

The canonical contract was frozen before platform integration. No RC1 schema or
fixture change occurred after that freeze, so a platform renotification cycle
was not required. Integration fixes changed SDK behavior only and preserved the
frozen protocol contract.

The orchestrator performed the final quality review because the task required
exactly the four named subagents. That review included diff inspection,
cross-platform outcome comparison, native runtime checks, accessibility and
large-text checks, fallback review, and repository-wide validation.

## Canonical Contract

The sole source fixture is:

```text
protocol/fixtures/v0.1/complete-paywall.json
```

The JSON Schema remains the canonical protocol definition. No SDK contains a
forked schema:

- Flutter conformance tests read the repository fixture; the full example
  generates an ignored, byte-identical asset for host bundling.
- SwiftPM and the iOS example use repository-relative symlinks to the canonical
  fixture.
- Android generates an ignored build asset from the canonical fixture before
  packaging the library fallback.

All three decoders reject unsupported protocol versions and capabilities,
unknown properties or components, invalid references, duplicate identifiers,
localization inconsistencies, and declared-capability/content drift atomically.

## Component Conformance Matrix

| RC1 component | Flutter native mapping | SwiftUI native mapping | Compose native mapping | Result |
| --- | --- | --- | --- | --- |
| Scroll container | `SingleChildScrollView` with optional `Scrollbar` | vertical `ScrollView` | `Column` with `verticalScroll` and optional direction-relative indicator | Pass on all three |
| Vertical stack | `Column`, directional padding and spacing | `VStack`, directional padding and alignment | `Column`, directional padding and spaced arrangement | Pass on all three |
| Text | Flutter `Text` and theme typography | SwiftUI `Text` and native fonts | Compose `Text` and Material typography | Pass on all three |
| Image | Flutter `Image` or same-ratio placeholder | host-resolved SwiftUI `Image` or same-ratio placeholder | host-resolved Compose `Image` or same-ratio placeholder | Pass on all three |
| Feature list | native rows, text, decorative Material check icons | native rows, text, decorative SF Symbol checks | native rows, text, decorative check glyphs | Pass on all three |
| Product selector | semantic native tappable options with selected state | native `Button` options with selected state | native selectable/radio semantics | Pass on all three |
| Purchase button | Material `FilledButton` with progress state | SwiftUI `Button` with progress state | Material 3 `Button` with progress state | Pass on all three |
| Restore button | native text button | native SwiftUI button | Material 3 text button | Pass on all three |
| Close button | native icon button | native SwiftUI button | native Compose icon button | Pass on all three |
| Legal text | native wrapping text | native wrapping SwiftUI text | native wrapping Compose text | Pass on all three |

The renderers preserve document source order, recursive vertical stacks,
direction-relative start/end alignment, declared spacing and padding, safe-area
behavior, native font scaling, and native vertical scrolling.

## Behavioral Conformance Matrix

| Behavior | Flutter | SwiftUI | Compose | Evidence/result |
| --- | --- | --- | --- | --- |
| Canonical fixture decode | Pass | Pass | Pass | Strict decoder and canonical-fixture tests |
| Mock product loading | Pass | Pass | Pass | Runtime product values supply price and period |
| Initial/default selection | Pass | Pass | Pass | Declared selection retained when available |
| Product reselection | Pass | Pass | Pass | Native selectable control updates document-local reference |
| Purchase success | Pass | Pass | Pass | Terminal `purchased` |
| Purchase cancellation | Pass | Pass | Pass | Terminal `cancelled` |
| Purchase failure | Pass | Pass | Pass | Terminal `purchaseFailed` with safe diagnostic code |
| Already entitled | Pass | Pass | Pass | Terminal `alreadyEntitled` |
| Product unavailable | Pass | Pass | Pass | Initial notice is interaction-only; attempted unavailable purchase is terminal |
| Restore success | Pass | Pass | Pass | Terminal `restored` |
| Restore with no purchases | Pass | Pass | Pass | Interaction-only `restoreNoPurchases`; paywall remains usable |
| Restore failure | Pass | Pass | Pass | Interaction-only `restoreFailed`; paywall remains usable |
| Close | Pass | Pass | Pass | Terminal `dismissed`; host owns actual dismissal |
| Invalid local candidate | Pass | Pass | Pass | Candidate rejected atomically, bundled fallback attempted |
| Missing bundled fallback | Pass | Pass | Pass | Terminal `configurationUnavailable`, no host crash |
| Missing/invalid image | Pass | Pass | Pass | Localized same-geometry placeholder and safe diagnostic |
| Missing configured product | Pass | Pass | Pass | First available reference in source order selected |
| No products | Pass | Pass | Pass | Fallback message, purchase disabled, interaction-only notification |
| Unknown/unsupported content | Pass | Pass | Pass | Strict decode rejection and safe fallback |
| English locale | Pass | Pass | Pass | Canonical fixture/runtime tests |
| Long German locale | Pass | Pass | Pass | Scroll and reachability checks at large accessibility text/font scale |
| Arabic RTL locale | Pass | Pass | Pass | Direction resolution and native layout tests |
| Accessibility metadata | Pass | Pass | Pass | Labels, hints/state, headings, selection, image semantics, actions |
| Golden/snapshot regression | Pass | Pass | Pass | Flutter pixel golden, iOS committed snapshot, Android pixel checksum |

## Normalized Outcomes

Every SDK exposes explicit presentation result types rather than booleans. The
terminal union is exactly:

```text
purchased
restored
alreadyEntitled
dismissed
cancelled
productUnavailable
configurationUnavailable
purchaseFailed
renderingFailed
```

The nonterminal interaction stream also reports product selection and the
recoverable `restoreNoPurchases` and `restoreFailed` outcomes. Initial product
unavailability is interaction-only so hosts do not receive a terminal result
before the user attempts a purchase. Purchase and presentation payloads retain
the document-local product reference ID; provider product IDs remain an opaque
commerce boundary.

## Accessibility and Localization Review

Automated review verified:

- protocol accessibility labels, hints or state, heading roles, selected
  product state, image decoration/information, and actionable controls;
- the localized “Best value” badge in each selected-product spoken value;
- controls remaining reachable with long German copy at accessibility text
  size on iOS and 2x font scale on Android;
- Flutter large-text scrolling and semantic coverage;
- Arabic right-to-left direction and direction-relative padding/alignment; and
- missing-image placeholders retaining the declared geometry.

The iOS application was built, installed, and launched on an iPhone 17 Pro
simulator running iOS 26.5. Its runtime accessibility snapshot exposed the
expected scroll container, locale/scenario controls, Monthly and Yearly
options, the localized badge, purchase, restore, and close controls. The native
screen and committed snapshot were also visually inspected.

The Android Compose suite ran on a Pixel 3a API 34 emulator, including the
large-font long-German reachability test. The Flutter golden was visually
inspected and both Flutter example bundles compiled.

## Intentional Platform Differences

These differences are documented rather than hidden:

- Native typography metrics, control chrome, glyphs, focus visuals, safe-area
  sizes, scroll physics, and line wrapping remain platform-owned.
- SwiftUI and Flutter expose a native heading/header trait but not RC1's numeric
  level. Compose exposes the native heading flag and retains the level in a
  testable Mosaic semantics key.
- Compose's stable semantics API has no separate public TalkBack hint property,
  so the localized label and hint are joined in protocol order.
- Flutter uses its native `Scrollbar`; SwiftUI uses native scroll indicators.
  Stable Compose scrolling has no equivalent public visibility switch, so a
  small direction-relative Compose indicator is overlaid only when requested.
- Image resolution uses idiomatic platform callbacks/types. All three use the
  same protocol fallback semantics when resolution fails.
- Presentation payload wrappers are idiomatic. Optional entitlement or mock
  transaction metadata can differ, while normalized outcome names and required
  document-local identifiers remain equivalent.
- The SDK reports `dismissed`; the host application owns sheet, route, or
  full-screen presentation dismissal on every platform.

## Integration Review Findings and Resolutions

1. **Provider-load failure parity.** Flutter originally converted a product
   provider exception into terminal `renderingFailed` and hid the paywall. It
   now records a safe diagnostic, keeps the paywall visible, and enters the
   declared product-unavailable fallback state.
2. **Initial no-product parity.** Flutter and Android originally emitted a
   terminal `productUnavailable` during initialization while SwiftUI emitted an
   interaction only. All three now use the recoverable interaction until an
   unavailable purchase is actually attempted.
3. **Restore reachability.** Flutter restore no longer depends on successful
   product resolution, matching the independent protocol action semantics.
4. **Spoken badge parity.** SwiftUI product accessibility now includes the
   localized product badge, matching Flutter and Compose.
5. **Large-text proof.** iOS and Android gained explicit long-German
   accessibility-size/font-scale reachability tests.
6. **iOS API cleanup.** The example uses current SwiftUI foreground styling and
   a committed reviewed simulator baseline.

No finding required a protocol RC1 change.

## Validation Results

### Protocol

| Command/check | Result |
| --- | --- |
| `npm --prefix protocol run check` | Pass; canonical fixture valid, 63/63 tests |

### Flutter

| Command/check | Result |
| --- | --- |
| Dart format check | Pass |
| `flutter analyze --no-pub` | Pass; no issues |
| `flutter test --no-pub` | Pass; 57/57 tests |
| Package example `flutter build bundle --no-pub` | Pass |
| Full example fixture sync | Pass; generated asset byte-identical to canonical fixture |
| Full example `flutter analyze --no-pub` | Pass |
| Full example `flutter build bundle --no-pub` | Pass |

### Swift and iOS

| Command/check | Result |
| --- | --- |
| Strict Swift format lint | Pass |
| `swift build --package-path sdk/ios` | Pass |
| `swift test --package-path sdk/ios --disable-sandbox` | Pass; 36/36 tests |
| Simulator example build/install/launch | Pass on iPhone 17 Pro, iOS 26.5 |
| Simulator accessibility/runtime snapshot | Pass; expected native controls and semantics |
| Simulator snapshot suite | Pass; 2/2 tests, including committed golden and accessibility-size layout |

### Kotlin and Android

| Command/check | Result |
| --- | --- |
| `:mosaic:assembleDebug` | Pass |
| `:mosaic:testDebugUnitTest` | Pass; 31/31 tests |
| `:mosaic:lintDebug` | Pass |
| `:mosaic:assembleDebugAndroidTest` | Pass |
| Example `:app:assembleDebug` and `:app:lintDebug` | Pass |
| `:mosaic:connectedDebugAndroidTest` | Pass; 6/6 tests on Pixel 3a API 34 emulator |

### Unchanged Repository Surfaces

| Command/check | Result |
| --- | --- |
| `gofmt -l .` | Pass; no files listed |
| `go test ./...` | Pass |
| `go vet ./...` | Pass |
| Dashboard formatting, ESLint, TypeScript, tests, production build | Pass; Vitest 14/14 |

## Unsupported Checks and Environmental Limitations

- No physical-device run or manual VoiceOver/TalkBack session was performed.
  Automated simulator/emulator semantics, actions, scroll reachability, RTL,
  and large-text checks passed.
- The iOS runtime proof used iOS 26.5, not every supported version down to the
  package's iOS 15 minimum. Swift compilation covers the declared APIs, but a
  minimum-version simulator matrix remains a release follow-up.
- The Android runtime proof used API 34, not every version down to minSdk 24.
- No Kotlin formatter task is configured. Kotlin compilation and Android lint
  passed.
- The optional Flutter debug APK build produced no Gradle progress in this
  environment and was stopped after 197.4 seconds. Both portable Flutter bundle
  builds, analysis, and all package tests passed; this is recorded as an
  environmental limitation rather than a renderer failure.
- Android's deterministic golden is stored as a pixel checksum rather than a
  reviewable image artifact. The checksum test passed; a committed rendered
  image could improve later visual review tooling.
- Real StoreKit, Google Play Billing, RevenueCat, receipt validation, and live
  entitlement behavior are deliberately untested because Phase 1 uses mock
  commerce only.
- Remote configuration, caching, placements, publishing, Studio, analytics,
  experiments, and backend delivery are outside this phase and were not tested.

## Scope Reconciliation

The explicit Phase 1 brief authorized these ten types: vertical stack, scroll
container, text, image, feature list, product selector, purchase button,
restore button, close button, and legal text. Protocol RC1 and all three SDKs
conform to that exact list.

The product owner reconciled the roadmap to the explicitly approved ten-type
RC1 scope on 2026-07-17. Horizontal stack, arbitrary container, and spacer are
deferred to a future protocol version and compatibility review. They are not
Phase 2 deliverables. Adding them to the approved contract would require a new
protocol version and explicit notification to all platform owners.

## Product, Engineering, UX, and Demo Review

### Product

- The intended proof is complete: one neutral document drives three native,
  functional paywalls.
- Mock commerce keeps the slice demonstrable without prematurely choosing real
  billing-provider contracts.
- All explicit Phase 1 exclusions were respected.
- No Phase 2 editor or preview infrastructure was introduced.

### Engineering

- One strict, versioned JSON contract remains authoritative.
- Failures are safe, recoverable where specified, diagnostic, and do not crash
  the host application.
- Platform result semantics and document-local identifiers are equivalent.
- Available protocol, SDK, runtime, golden, accessibility, and unchanged-surface
  validation is green.

### UX

- Product options expose price, period, badge, and selected state through
  native controls.
- Purchase, restore, close, progress, failure, unavailable-product, long-copy,
  and RTL states have a usable native path on every example application.
- The examples expose deterministic scenario and locale controls for review.
- Host-owned dismissal is explicit, preventing SDK navigation side effects.

### One-Minute Demo

1. Launch each native example with the canonical fixture.
2. Switch between English, long German, and Arabic RTL.
3. Select Monthly or Yearly and observe native selected-state semantics.
4. Run purchase success, cancellation, and failure scenarios.
5. Run restore and close.
6. Remove products or reject the candidate document and observe safe product or
   bundled-document fallback without a host crash.

## Tracked Follow-ups

1. Add physical-device manual VoiceOver and TalkBack review before a public SDK
   release.
2. Add iOS-minimum and Android-minimum runtime jobs to the future CI matrix.
3. Configure a Kotlin formatter and a reviewable Android golden artifact when
   repository-wide mobile CI is established.
4. Re-run a Flutter debug APK build in an environment with observable Android
   Gradle progress; the portable application bundles already pass.

## Final Classification

**Accepted with tracked follow-ups.**

The explicitly authorized Phase 1 renderer proof and all available validation
are complete. Remaining items are environmental and release-matrix follow-ups,
not known cross-platform behavior defects. Product-owner acceptance was
recorded on 2026-07-17, the dashboard foundation follow-up is resolved, and
Phase 2 is authorized.
