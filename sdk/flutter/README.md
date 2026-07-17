# Mosaic Flutter SDK — Phase 1 RC1

This package decodes Mosaic Protocol 0.1 RC1 and renders its sole canonical
paywall with native Flutter widgets. Phase 1 is local-only: it includes strict
decoding, localization and RTL, bundled fallback loading, mock commerce,
normalized results, diagnostics, accessibility semantics, and native rendering.

It does not include remote configuration, REST fetching, caching, placements,
Studio preview, analytics, real billing adapters, or any Phase 2 behavior.

## Requirements

- Flutter 3.19 or newer
- Dart 3.3 or newer

## Public boundary

Configure the existing provider-neutral client, then give `MosaicPaywallHost`
a local candidate and a host-owned bundled fallback loader:

```dart
final mosaic = Mosaic.configure(
  apiKey: 'public_key',
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

MosaicPaywallHost(
  mosaic: mosaic,
  candidateDocument: localCandidate,
  bundledFallbackLoader: () => rootBundle.loadString(
    'assets/generated/complete-paywall.json',
  ),
  requestedLocale: 'ar',
  imageResolver: (key) => switch (key) {
    'mosaic.paywall.hero' => const AssetImage('assets/hero.png'),
    _ => null,
  },
  onResult: (result) {
    // The host owns route, sheet, or dialog dismissal.
  },
)
```

`MosaicPaywall` is the lower-level widget for an already decoded and validated
`MosaicPaywallDocument`. Neither widget owns modal presentation or dismissal.

## Protocol and fallback guarantees

- `MosaicProtocolDecoder` rejects unknown fields, components, versions,
  capabilities, invalid bounds, and inconsistent references atomically.
- Semantic validation covers unique IDs, asset/product/action references,
  exact capability derivation, and localization catalog consistency.
- The package contains no JSON Schema or fixture copy. Conformance tests read
  `protocol/fixtures/v0.1/complete-paywall.json` directly.
- `MosaicPaywallLoader` resolves only local candidate → bundled fallback →
  `configurationUnavailable` in Phase 1.
- A missing or undecodable bundled image uses the document's localized
  same-aspect placeholder.
- Unavailable products are omitted. The configured selection is retained when
  possible, otherwise the first available product is selected. No available
  product shows the declared message, disables purchase, and reports
  `productUnavailable`.

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
- The renderer uses `SafeArea`, `SingleChildScrollView`, Material buttons,
  native text scaling, and Flutter semantics. It does not use a WebView.
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
cd example
flutter build bundle --no-pub
```

The committed golden under `test/goldens/` is a true Flutter pixel baseline.
Update it only after an intentional renderer review, then rerun without
`--update-goldens`.

The full scenario and locale playground is at
`examples/flutter-example/README.md`. It generates its ignored bundled fixture
byte-for-byte from the canonical repository file before build or run.
