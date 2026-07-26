# Gate 4B native-store demonstration evidence

## Evidence record

- Recorded: 2026-07-24T13:59:27+01:00
- Operator: Codex Gate 4B orchestrator
- Branch: `phase/4b-native-store-providers`
- Accepted baseline commit: `51269f5d452c09ee0d351aabd336438632b47624`
- Worktree: integrated, uncommitted Gate 4B implementation
- iOS application/build: `MosaicExample`, local debug build
- Android application/build: `dev.mosaic.example`, local debug build
- Flutter application/build: `mosaic_flutter_example`, source integrated; platform builds unavailable
- Apple toolchain: Xcode 26.5 (17F42), Swift 6.3.2, iOS 26.5 and 27 Simulator runs
- Google toolchain: Java 17, compile SDK 36, minimum API 24, Google Play Billing 9.1.0
- Mosaic Environment: deterministic local/example configuration only
- Store contexts:
  - Apple: Xcode StoreKit configuration linked to the example; no signed App Store Sandbox session
  - Google: injected BillingClient test doubles and debug-only response overrides; no Play-distributed license-test session
- Adapter identities:
  - `app_store` / StoreKit / `1.0.0`
  - `google_play` / Google Play Billing / `1.0.0`
- Commerce contract/configuration: v2 canonical StoreKit and Google fixtures; runtime configuration ID, release ID, and digest were not issued by a live hosted Environment
- Stable Mosaic Product IDs:
  - `mosaic_pro_monthly`
  - `mosaic_pro_yearly`
  - `mosaic_pro_lifetime`
- Provider mapping IDs: canonical fixture/example mappings only; no live hosted mapping IDs
- Canonical Paywall: `protocol/fixtures/v0.2/complete-paywall.json`
- Paywall SHA-256 before and after Gate 4B:
  `f892cf7ee650f135a4a9c4f3d3d5a5863909a01bce702f9a5d2cfec6b0a59fcf`
- Paywall source diff: none

## Apple evidence

Status: deterministic lifecycle evidence passed; real sandbox demonstration unavailable.

Available evidence:

- The iOS example built and launched with `MosaicStoreKit` and
  `MosaicExample.storekit` linked on iOS 26.5 and iOS 27 Simulators.
- The StoreKit package suite passed 4 tests covering:
  - verified local acceptance and durable recording before `finish()`;
  - pending, cancellation, verification failure, and purchase failure;
  - unfinished-transaction replay and duplicate suppression;
  - entitlement verification failure remaining unknown/failed rather than
    becoming inactive.
- Core iOS passed 98 tests with 1 skip and no failures, plus 8 focused v2
  commerce tests.
- The example StoreKit configuration declares localized subscription and
  non-consumable metadata for exact App Store Product identifiers.
- Automatic recovery uses transaction updates and unfinished transactions;
  user-initiated restore is the only path that invokes store synchronization.
- Diagnostics use stable Mosaic codes and safe provider codes; no transaction
  payload, receipt, credential, or StoreKit object crosses the public boundary.

Unavailable evidence:

- No signed physical device or signed sandbox-capable application.
- No App Store Connect application/Product configuration.
- No Sandbox Apple Account.
- No real localized App Store Product response.
- No real purchase, cancellation, Ask to Buy, delayed completion, interrupted
  relaunch, synchronization, or current-entitlement run.
- No screenshot or signed-device log excerpt.

Because those dependencies are absent, Apple success, cancellation, pending,
relaunch recovery, synchronization, observed Entitlements, and real
finish-ordering are **unavailable**, not passing.

## Google evidence

Status: deterministic module evidence passed after the final recovery and
atomic-configuration changes; real Play demonstration remains unavailable.

Available evidence:

- The focused Android core and Google Play unit suites passed after the final
  atomic configuration and recovery changes.
- The Android example debug APK assembled before that hook.
- Focused Google tests covered:
  - exact Product/base-plan/optional-offer selection with no silent fallback;
  - runtime-only offer tokens;
  - durable local acceptance before acknowledgement;
  - pending purchase behavior without grants or acknowledgement;
  - SUBS and INAPP active-purchase recovery;
  - partial provider failure remaining failed/unknown rather than authoritative
    empty access.
- Raw purchase tokens are retained privately and exposed only as SHA-256
  internal references.
- Debug-only response overrides are confined to the example/debug surface.

Unavailable evidence:

- No package-matching Play Console application or distributed test-track build.
- No license tester, current Play Store test device, or Play Billing Lab run.
- No real localized `ProductDetails`/pricing-phase response.
- No real purchase, cancellation, pending/slow approval, delayed completion,
  acknowledgement, already-owned response, interrupted relaunch, active
  purchase recovery, or provider-observed Entitlement run.
- No screenshot or Play-device log excerpt.

Those real Google paths and the post-hook matrix are **unavailable**, not
passing.

## Flutter evidence

Status: static and dynamic integration evidence passed; real-store Flutter
demonstration remains unavailable.

Available evidence:

- The optional `mosaic_native_store` package contains a closed codec, Dart
  provider surface, Swift wrapper, Kotlin wrapper, CocoaPods/SwiftPM metadata,
  and Maven/sibling-project integration.
- Swift bridge syntax parsed successfully.
- All three involved podspecs and all pubspec YAML files parsed successfully.
- Static inspection confirmed no duplicated StoreKit/Billing business logic and
  no third-party purchase plugin.
- The example installs RevenueCat, StoreKit, and Google factories while keeping
  the same Mosaic Product and Paywall identifiers.

Unavailable evidence:

- Flutter core analysis passed and its complete suite passed 142 tests with one
  documented skip.
- The optional native-store package analysis and all three focused tests passed.
- The Flutter bridge reused the verified Swift and Kotlin adapters; the iOS
  core suite passed 98 tests with one skip, and the focused Android core and
  Google Play suites passed.
- No signed App Store sandbox or Play-distributed application was available, so
  a Flutter-hosted real purchase and recovery run remains unavailable.

## Cross-provider equality proof

Status: source-level equality passed; live provider-switch demonstration
unavailable.

- The canonical Paywall file and digest are unchanged.
- Paywall Protocol schemas and fixtures are unchanged.
- The same stable Mosaic Product IDs are used by the examples.
- Native provider identifiers and store Product selectors exist only in
  Commerce configuration/mappings and adapter packages.
- Switching factories/providers does not mutate the Paywall document.
- No live hosted Configuration Release, Placement, StoreKit sandbox purchase,
  or Play test purchase was available to demonstrate the complete runtime switch.

## Stage 4 decision

Apple and Google real-store purchase paths are required Gate 4B objectives.
Both are unavailable. Under the approved Gate 4B plan, Stage 4 therefore
requires **Rejected pending demonstration** even though deterministic evidence
is retained for engineering review.
