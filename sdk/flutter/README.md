# Mosaic Flutter SDK — Configuration Delivery v1

This package provides a strict reader for Mosaic Protocol 0.2
and renders it with native Flutter widgets. It includes hosted Configuration
Delivery v1, persistent cache and bundled-release fallback, Placements,
localization and RTL,
bundled fallback loading, mock commerce, normalized results, diagnostics,
accessibility semantics, native rendering, Local Preview 0.2 support, and the
provider-neutral Commerce Configuration v1/custom-provider boundary.

Protocol 0.2 RC4 adds document design-system tokens, solid/linear/radial/media
backgrounds, native shadows, uniform width and height Fit/Fill/Fixed sizing,
remote and bundled image/video assets, and native Screen/Sheet presentation.
It retains RC3's generalized Buttons and Stacks, authored Product Cards and
Badges, safe product templates, navigation, Carousel, Switch, Countdown, and
conditional visibility. The SDK never migrates a document implicitly.

Analytics and experiments remain outside this package. Real billing adapters
remain optional sibling packages so applications that do not use RevenueCat
do not resolve or embed it.

## Requirements

- Flutter 3.19 or newer
- Dart 3.3 or newer

## Public boundary

Configure the provider-neutral client with an environment-scoped public SDK
key and hosted/self-hosted base URL. Loading reads cache then the bundled
Delivery v1 release without networking; refresh is an explicit host action:

```dart
final mosaic = Mosaic.configure(
  publicSdkKey: 'public_sdk_key',
  baseUrl: Uri.parse('https://mosaic.example.com'),
  bundledFallbackLoader: () => rootBundle.loadString(
    'assets/configuration-release.json',
  ),
  purchaseProvider: MockMosaicPurchaseProvider(
    products: const [
      MosaicProduct(
        id: 'mosaic_pro_monthly',
        title: 'Mosaic Pro Monthly',
        localizedPrice: r'$5.99',
        localizedPeriod: 'month',
      ),
    ],
  ),
);

await mosaic.loadConfiguration();
await mosaic.refreshConfiguration();

MosaicPlacementHost(
  mosaic: mosaic,
  placementKey: 'onboarding_complete',
  requestedLocale: 'ar',
  imageResolver: (key) => switch (key) {
    'mosaic.paywall.hero' => const AssetImage('assets/hero.png'),
    _ => null,
  },
  videoResolver: (key) => switch (key) {
    'mosaic.paywall.offer_video' => 'assets/offer.mp4',
    _ => null,
  },
  onResult: (result) {
    // The host owns terminal paywall dismissal.
  },
)
```

An accepted release is strict and atomic: every embedded Protocol 0.2 paywall,
digest, Placement reference, product reference, asset binding, and capability
set must validate before the SDK replaces memory or its cache. Requests send
Flutter SDK capability metadata, use a short timeout, and revalidate strong
ETags with `If-None-Match`; `304` preserves the current release only when the
response repeats the exact retained ETag and Configuration Release ID.
Concurrent manual refreshes coalesce. Presentation never fetches.

## Commerce Configuration and custom Providers

Commerce Configuration v1 is an optional immutable sidecar. When configured,
the SDK requires its Environment, Application, store platform, Configuration
Release ID, release digest, Product set, and canonical content digest to match
the accepted Delivery v1 release. Unknown fields, mappings, versions,
credentials, ambiguous mappings, and mismatches reject the complete pair. The
release and sidecar bytes share one crash-safe cache record.

When `applicationId` and `storePlatform` are provided, Mosaic uses the frozen
hosted route automatically:

`GET /v1/sdk/commerce-configuration?applicationId=<registered-application-id>`

The request reuses the public SDK key and sends the Flutter SDK, Commerce
Configuration v1, and Provider Contract v1 capability headers. Tests, local
Studio integrations, and self-hosted deployments may replace this narrow
transport with `commerceConfigurationLoader`. Hosted responses are revalidated
with `If-None-Match` only after the exact sidecar ETag, canonical content
digest, and associated Delivery release have been retained together.

```dart
final mosaic = Mosaic.configure(
  publicSdkKey: 'public_sdk_key',
  baseUrl: Uri.parse('https://mosaic.example.com'),
  applicationId: 'application_ios',
  storePlatform: MosaicStorePlatform.ios,
  purchaseProvider: localFallbackProvider,
  commerceProviderFactories: [MyCommerceProviderFactory()],
);
```

An app-owned custom integration implements `MosaicCommerceProviderFactory` and
`MosaicCommerceProvider`. The factory receives only a validated
`MosaicCommerceConfiguration` and its exact `MosaicConfigurationRelease`.
Products must resolve stable Mosaic Product IDs through `mappingForProduct`;
the renderer never receives a provider SKU. Custom Providers report identity,
explicit capabilities, normalized purchase/restore/Entitlement results, and
bounded safe diagnostics.
Provider-failure results attach the same diagnostic record, including its
stable code, safe message, retryability, correlation ID, optional safe provider
code, and recovery action.

The optional RevenueCat adapter is at `packages/mosaic_revenuecat`. It pins
`purchases_flutter 10.4.3` and requires Flutter 3.22/Dart 3.4 without raising
Mosaic Core's Flutter 3.19/Dart 3.3 floor. The host configures RevenueCat and
owns login/logout/customer identity:

```dart
await Purchases.configure(PurchasesConfiguration(revenueCatPublicSdkKey));

final mosaic = Mosaic.configure(
  // Delivery and sidecar settings omitted.
  purchaseProvider: localFallbackProvider,
  commerceProviderFactories: const [
    MosaicRevenueCatProviderFactory(),
  ],
);
```

Never put a RevenueCat public SDK key, server key, app-user identifier,
authorization header, or customer payload in the sidecar or diagnostics.

`MosaicPaywall` is the lower-level widget for an already decoded and validated
`MosaicPaywallDocument`. Mosaic presents protocol-internal Sheet destinations
with Flutter's native modal bottom sheet and maintains their Screen history.
The host still owns terminal paywall presentation and dismissal.

## Local Studio preview

Create one explicit local endpoint/session configuration and keep the client
alive for the running application process:

```dart
final preview = MosaicPreviewClient(
  configuration: MosaicPreviewClientConfiguration(
    endpoint: Uri.parse('ws://127.0.0.1:4317/preview'),
    sessionId: 'session_local_01',
    identity: MosaicPreviewClientIdentity(
      clientId: 'client_flutter_example',
      displayName: 'Flutter example preview',
      renderer: MosaicPreviewSoftwareIdentity(
        id: 'mosaic.flutter',
        version: mosaicFlutterSdkVersion,
      ),
      application: MosaicPreviewApplicationIdentity(
        id: 'example.app',
        displayName: 'Example App',
        version: '1.0.0',
      ),
      device: MosaicPreviewDeviceIdentity(
        displayName: 'Local simulator',
        systemName: 'iOS',
        systemVersion: '26.0',
      ),
    ),
  ),
);

await preview.connect();
```

Render the latest safe revision with `MosaicPreviewPaywall`. Supply the
existing provider for mock commerce. Before the first revision it shows an
explicit loading or connection-failure state. The widget applies the message's locale and text scale, rerenders
without rebuilding the app, and sends `draftAccepted` only after the revision
completes a Flutter frame.

The client:

- advertises and uses `mosaic.local-preview.v0.2` for the full connection;
- sends `previewClientConnected` then `capabilityReport`;
- reports exact schema, renderer, and preview capability versions for the
  negotiated protocol;
- orders local document and mock-commerce revisions independently;
- repeats prior acknowledgements for idempotent revision duplicates;
- rejects stale/conflicting/invalid/unsupported revisions atomically;
- preserves the last accepted draft after rejection or render failure;
- reconnects from 250 ms up to 5 seconds with a bounded attempt count; and
- sends five-second heartbeats and safe diagnostics without raw exceptions,
  documents, credentials, or local paths.

Endpoint and `sessionId` are independent and both required. A session is local
routing metadata, never a user identity or credential. Keep `clientId` stable
only for the running process; do not derive it from advertising or hardware
identifiers.

Canonical local project files can be loaded atomically with their embedded
document and mock-commerce state:

```dart
final project = const MosaicPreviewMessageCodec().decodeLocalProject(
  projectJson,
  expectedFileFormatVersion: mosaicLocalPreviewV02ProtocolVersion,
);
```

Studio-side integrations can use `negotiateMosaicLocalPreviewVersion` and
`decideMosaicPreviewDraftDelivery` to choose the highest mutual exact version
and withhold incompatible or oversized compact UTF-8 drafts before sending.

## Protocol and fallback guarantees

- `MosaicProtocolDecoder` rejects unknown fields, components, versions,
  capabilities, invalid bounds, and inconsistent references atomically.
- Semantic validation traverses every Screen, Carousel page, Stack, Button
  child, Button in-progress child, Product Card, Product Badge, and passive
  authored descendant. It covers unique IDs, exact capability derivation,
  localization catalogs and safe product templates, multi-Screen accessibility
  labels, safe HTTPS actions, reachable acyclic navigation, same-Screen
  purchase/Switch references, passive content bounds, Carousel nesting, and
  Countdown ordering.
- The package contains no JSON Schema or fixture copy. Conformance tests read
  the canonical Protocol and Local Preview 0.2 fixtures directly.
- Configuration resolves last-known-valid cache → bundled Delivery v1 release
  → `configurationUnavailable`; explicit refresh may replace it with a fully
  validated remote release.
- A missing component image uses its declared placeholder. Decorative media
  backgrounds fall back safely: video → poster → colour and image → colour,
  with one diagnostic per failed asset.
- Unavailable or price-dependent products without a non-blank localized price
  remove their Product Card. The configured/current Product Card ID is retained
  when available, otherwise source order selects the first available card,
  including after locale changes. No card shows the declared message, disables
  Purchase, and reports `productUnavailable`.

Locale resolution is exact requested locale → requested base language →
`fallbackLocale` → `defaultLocale` → inline default. Direction comes from the
first declared locale candidate, independently of the string that resolves.

## Results

The sealed presentation union maps one-to-one to RC1:

- `MosaicPurchasedPresentationResult`
- `MosaicRestoredPresentationResult`
- `MosaicAlreadyEntitledPresentationResult`
- `MosaicDismissedPresentationResult`
- `MosaicCancelledPresentationResult`
- `MosaicPendingPresentationResult`
- `MosaicDeferredPresentationResult`
- `MosaicProductUnavailablePresentationResult`
- `MosaicConfigurationUnavailablePresentationResult`
- `MosaicPurchaseFailedPresentationResult`
- `MosaicRenderingFailedPresentationResult`

`restoreNoPurchases` and `restoreFailed` are emitted only through
`onInteraction`; the paywall remains usable for retry, purchase, or close.
Safe `MosaicDiagnostic` values expose stable SDK codes without raw provider
errors or credentials.

## Flutter-native conformance notes

- One protocol logical unit maps to one Flutter logical pixel.
- `start`/`end` use `EdgeInsetsDirectional`, `TextAlign.start/end`, and native
  `Directionality`.
- Linear-gradient angles are physical and never mirror in RTL: 0° points
  left-to-right, 90° top-to-bottom, and angles increase clockwise.
- Colour, background, and shadow tokens resolve before painting. Linear and
  radial gradients use Flutter gradients; a supported shadow maps to one
  native `BoxShadow`.
- Width and height independently support Fit, Fill, and Fixed. Unbounded Fill
  falls back to Fit with `layout.unboundedFill`; Fixed clips visuals to the
  authored box while preserving the component's complete semantics.
- Remote assets use validated HTTPS URLs. Bundled image/video logical keys are
  resolved only by the host, so protocol documents never contain host paths.
- Decorative video uses `video_player` without controls, muted, autoplaying,
  looping, and excluded from semantics. Loading failures never block content.
- The renderer uses `SafeArea`, `SingleChildScrollView`, Material buttons,
  native text scaling, and Flutter semantics. It does not use a WebView.
- Carousel uses native `PageView`, measures its pages to a stable maximum
  height, and announces user-driven page changes. Switch uses native `Switch`.
- Screen navigation starts at `initialScreenId`, retains Switch, Carousel,
  product-selection, scroll, and other presentation state while moving, opens
  forward destinations at the top, restores prior scroll on back, and resets
  to the initial Screen for an accepted revision. Back at the root is the safe
  diagnostic no-op `navigation.noBackTarget`; it never dismisses the paywall.
- A Sheet destination uses a full-height safe-area `showModalBottomSheet` with
  its own scroll controller. Protocol Back, navigation to another destination,
  and system swipe/back dismissal reconcile the same history deterministically.
- Protocol 0.2 Button descendants render as native Flutter content inside one
  48-point-minimum hit target and one merged semantics control. Purchase and
  restore swap to localized `inProgressChildren` and all asynchronous actions
  reject duplicate taps while busy.
- Icons map the exact Mosaic names to Material glyphs. Arrow and chevron names
  mirror in RTL; decorative Icons are excluded from semantics and informative
  Icons expose their required localized label.
- `openExternalUrl` delegates only prevalidated absolute HTTPS URLs to
  `url_launcher` with `LaunchMode.externalApplication`. Failure keeps the
  current Screen/history presented and reports `externalUrl.openFailed`.
- Hidden conditional content is absent from layout, hit testing, and semantics
  while retaining its runtime state; an accepted document revision resets all
  Switch and Carousel state deterministically.
- Countdown accepts an injected clock for deterministic hosts/tests, updates
  from a non-blocking timer, and intentionally avoids a per-second live region.
- A Product Selector renders authored Product Cards and Product Badges rather
  than generated pricing rows. Each whole card is one native mutually
  exclusive selection target; descendants remain passive and merge into that
  target. Without an explicit card accessibility label, visible informative
  Text, Image, Icon, Stack, Product Badge, Feature List, and Countdown labels
  merge in authored source order after localization and template resolution;
  hidden and decorative content stays excluded. Horizontal and vertical
  selectors preserve source order.
- Product Card and Product Badge Selected styling recursively inherits every
  omitted Default leaf rather than replacing the complete style object.
- Text below a Product Card resolves only whitespace-tolerant
  `{{ product.name }}` and `{{ product.price }}` after locale selection.
  Provider title wins, the localized Product Reference label is its fallback,
  and unresolved raw template tokens are never rendered.
- Overlay Product Badges use `PositionedDirectional`, so logical start/end
  anchors mirror in RTL without introducing absolute protocol coordinates.
- Heading roles map to `Semantics.header`; RC1 heading levels are validated,
  while the supported Flutter semantics API exposes the heading role rather
  than the numeric level.
- Busy controls expose a disabled native action plus localized live-region
  value because supported Flutter versions do not share a dedicated busy flag.
- Native typography, button chrome, checkmark/radio glyphs, scroll physics,
  focus visuals, and safe-area measurements intentionally remain Flutter-native.
  Source order, logical layout, locale resolution, action identity,
  accessibility state, fallbacks, and normalized outcomes do not vary.

## Validate

From `sdk/flutter`:

```bash
flutter pub get
dart format --output=none --set-exit-if-changed lib test example/lib
flutter analyze --no-pub
flutter test --no-pub
cd ../../examples/flutter-example
dart run tool/sync_fixture.dart
flutter analyze --no-pub
flutter test --no-pub
flutter build bundle --no-pub
```

For the real relay integration slice, start `npm run preview:relay` from
`apps/dashboard`, then run from `sdk/flutter`:

```bash
flutter test --no-pub \
  --dart-define=MOSAIC_RUN_RELAY_INTEGRATION=true \
  test/preview_relay_integration_test.dart
```

That opt-in test verifies the negotiated WebSocket subprotocol, identity and
capability relay, an edited Protocol 0.2 draft, and the returned
`draftAccepted` acknowledgement. The normal offline suite compiles and skips
it when no relay is running.

The committed golden under `test/goldens/` is a true Flutter pixel baseline.
Update it only after an intentional renderer review, then rerun without
`--update-goldens`.

The full scenario and locale playground is at
`examples/flutter-example/README.md`. It generates its ignored bundled fixture
byte-for-byte from the canonical repository file before build or run.
