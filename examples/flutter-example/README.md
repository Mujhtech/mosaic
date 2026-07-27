# Mosaic Flutter local preview and hosted delivery

This native Flutter example has separate Local preview and Hosted tabs. Local
preview connects to the account-free Studio relay. Hosted mode loads a valid
cached or bundled Configuration Delivery v1/v2 release immediately and refreshes
the configured environment only when the refresh action is pressed.
reports its Protocol 0.2 and Local Preview 0.2 capabilities, and rerenders an
accepted draft without rebuilding the app. When Studio is disconnected or a
revision fails, the last accepted document remains visible; before the first
accepted revision, the generated canonical bundle is the safe fallback.

## Prerequisites

Flutter 3.22 / Dart 3.4 or newer, matching the SDK's supported floor.

The bundled fallback asset under `assets/generated/` is generated and
Git-ignored. Run the sync command before every build, run, or test — without it
the example has no bundled release to fall back to:

```bash
cd examples/flutter-example
dart run tool/sync_fixture.dart
flutter pub get
```

The status panel visibly distinguishes:

- connected, reconnecting, and disconnected transport states;
- the live local revision;
- locale, RTL through the selected locale, and accessibility text scale;
- active mock purchase and entitlement state;
- invalid documents, unsupported components, and render failures; and
- the latest safe interaction or connection diagnostic.

The generated RC4 fallback demonstrates a native Screen→Sheet flow, unified
Text/Icon Buttons, forward/back history, purchase/restore busy content, and an
external HTTPS action plus three structurally different authored Product
Cards, nested/overlay Product Badges, localized product templates, logical RTL
anchors, design tokens, gradients, media fallbacks, shadows, and two-axis
sizing. External links leave the native paywall presented and open through the
platform browser rather than an embedded WebView.

## Run with local Studio

From the repository root, generate the example's ignored bundled fallback:

```bash
cd examples/flutter-example
dart run tool/sync_fixture.dart
flutter pub get
```

In another terminal, start the dashboard relay:

```bash
cd apps/dashboard
npm run preview:relay
```

The shared development defaults are:

```text
endpoint:  ws://127.0.0.1:4317/preview
session:   session_local_01
client:    client_flutter_example
```

Run the example on an iOS simulator or desktop-accessible Flutter target:

```bash
cd examples/flutter-example
flutter run
```

The endpoint and session are configured independently. Override either one at
launch when Studio uses different local settings:

```bash
flutter run \
  --dart-define=MOSAIC_PREVIEW_ENDPOINT=ws://127.0.0.1:4317/preview \
  --dart-define=MOSAIC_PREVIEW_SESSION_ID=session_local_01 \
  --dart-define=MOSAIC_PREVIEW_CLIENT_ID=client_flutter_example
```

For an Android emulator, use its host-loopback alias when required:

```bash
flutter run \
  --dart-define=MOSAIC_PREVIEW_ENDPOINT=ws://10.0.2.2:4317/preview \
  --dart-define=MOSAIC_PREVIEW_SESSION_ID=session_local_01
```

The relay remains loopback-only. This is local development configuration, not
a hosted endpoint or authentication mechanism.

## Run hosted configuration

Start Mosaic's API with an environment containing the example public SDK key,
then launch with explicit hosted settings:

```bash
flutter run \
  --dart-define=MOSAIC_HOSTED_BASE_URL=http://127.0.0.1:8080 \
  --dart-define=MOSAIC_PUBLIC_SDK_KEY=public_example_key
```

Open the Hosted tab and use the cloud refresh action. Stop the API and restart
the app to verify the last-known-valid cache; clear app data to demonstrate the
generated bundled release. Network or validation failures retain the current
complete release and surface a safe diagnostic instead of a partial paywall.

To use the canonical Phase 5 Delivery v2 snapshot, sync fixtures and enable the
advanced `export_pdf` Placement. The SDK evaluates it locally and can return a
deliberate `noPaywall`, an immutable Paywall, or its named Product fallback
without fetching during presentation:

```bash
dart run tool/sync_fixture.dart
flutter run --dart-define=MOSAIC_PHASE5_DEMO=true
```

## Phase 6 analytics demonstration

Collection remains disabled unless the Environment owner has enabled it. Once
enabled server-side, opt the example in explicitly:

```bash
flutter run \
  --dart-define=MOSAIC_HOSTED_BASE_URL=http://127.0.0.1:8080 \
  --dart-define=MOSAIC_PUBLIC_SDK_KEY=public_example_key \
  --dart-define=MOSAIC_ANALYTICS_ENABLED=true
```

Exercise a hosted Placement, Product selection, purchase/cancellation, and
restore, then use the analytics toolbar action to flush and display aggregate
safe diagnostics. Stop the API, repeat actions, restart the app, restore the
same Environment namespace, restart the API, and flush to demonstrate
persistent offline delivery. Local Preview never emits hosted analytics.

The deterministic non-production reconstruction and canonical partial-batch
proof runs without a server:

```bash
cd sdk/flutter
flutter test test/analytics_test.dart \
  --plain-name 'reconstructs offline queue and applies exact partial acknowledgement'
```

That test queues while offline, reconstructs the runtime from the same
persistent storage, applies accepted/permanently-rejected/retryable results,
advances through the canonical retry delay, and proves the retained event is
later accepted.

## Run optional RevenueCat commerce

The example includes the optional `mosaic_revenuecat` package but does not
configure it unless the host supplies a RevenueCat public SDK key. The example
itself owns `Purchases.configure`; Mosaic never configures RevenueCat or owns
customer login/logout.

Supply the registered Mosaic Application ID. Core fetches the immutable
release-associated sidecar from the frozen hosted SDK route:

```bash
flutter run \
  --dart-define=MOSAIC_HOSTED_BASE_URL=http://127.0.0.1:8080 \
  --dart-define=MOSAIC_PUBLIC_SDK_KEY=public_example_key \
  --dart-define=MOSAIC_APPLICATION_ID=application_ios \
  --dart-define=MOSAIC_COMMERCE_ENABLED=true \
  --dart-define=REVENUECAT_PUBLIC_SDK_KEY=appl_public_key
```

Use the platform-specific RevenueCat public key for the selected iOS or
Android application. Never use a RevenueCat secret key here. If initialization,
sidecar transport, validation, or adapter activation fails, the example keeps
the deterministic local Provider and safe Product fallback available without
printing the key or raw provider error.

## Run native StoreKit or Google Play commerce

The same Hosted screen also installs the optional StoreKit and Google Play
factories. The accepted Commerce Configuration v2 sidecar selects the matching
platform adapter; no Dart switch changes the Paywall or its Mosaic Product
IDs.

For iOS, use the example's StoreKit Configuration or an App Store sandbox
application whose exact Product identifiers match the selected v2 sidecar.
For Android, use a package-matching Play test build and exact Product,
base-plan, and optional offer mapping. Launch with:

```bash
flutter run \
  --dart-define=MOSAIC_HOSTED_BASE_URL=http://127.0.0.1:8080 \
  --dart-define=MOSAIC_PUBLIC_SDK_KEY=public_example_key \
  --dart-define=MOSAIC_APPLICATION_ID=application_ios \
  --dart-define=MOSAIC_COMMERCE_ENABLED=true
```

Use `application_android` on Android. StoreKit restore performs an explicit
user-requested store synchronization. Google restore recovers currently active
purchases; it is not labeled as Apple-style synchronization. Missing plugin,
unavailable Activity/store service, invalid mapping, pending purchase,
cancellation, and access lookup failure remain distinct safe outcomes. The
mock provider remains the deterministic fallback for local Product/Paywall
work.

## Verify

```bash
dart run tool/sync_fixture.dart
dart format --output=none --set-exit-if-changed lib test tool
flutter analyze --no-pub
flutter test --no-pub
flutter build bundle --release --no-pub
```

The sync command copies
`protocol/fixtures/v0.2/complete-paywall.json` and the canonical valid Delivery
v1 and advanced Delivery v2 releases byte-for-byte into ignored
`assets/generated/` output. None is a second canonical
fixture. The current fallback therefore exercises the same Screens, Button
children, Icons, navigation, external URL handoff, horizontal Product Selector,
authored Product Cards/Product Badges, safe product templates, and Protocol 0.2
components as Studio. Local Preview contract tests consume the repository
fixtures directly from `protocol/fixtures/local-preview/v0.2/`. The playground
deliberately leaves bundled image/video resolvers empty so their declared
native fallback and safe diagnostics remain visible; a host app maps those
logical keys to its own `AssetImage` and Flutter asset path.

`MosaicPreviewPaywall` reports terminal results but does not dismiss host UI.
This playground intentionally keeps the native renderer visible so Studio
updates, mock commerce, error recovery, long German copy, Arabic RTL, and text
scaling remain easy to inspect.
