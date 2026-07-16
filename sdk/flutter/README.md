# Mosaic Flutter SDK (Phase 0)

This package establishes Mosaic configuration, strict protocol 0.1 decoding,
provider-neutral commerce contracts, and a deterministic mock provider. It does
not fetch, cache, evaluate, render, or emit analytics yet.

The conformance test reads the repository-owned fixture directly from
`protocol/fixtures/v0.1/minimal-paywall.json`; no SDK-local copy exists.

## Requirements

- Flutter 3.19 or newer
- Dart 3.3 or newer

## Commands

From `sdk/flutter`:

```bash
flutter pub get
dart format --output=none --set-exit-if-changed lib test example/lib
flutter analyze
flutter test
cd example
flutter build bundle
```

Tests must run inside a Mosaic checkout so they can locate the canonical fixture.

## Configuration

```dart
final mosaic = Mosaic.configure(
  apiKey: 'public_key',
  endpoint: Uri.parse('http://localhost:8080'), // Optional override.
  purchaseProvider: MockMosaicPurchaseProvider(),
);
```

No hosted endpoint is selected in Phase 0. Omitting `endpoint` preserves that
unresolved product decision while still allowing local or self-hosted overrides.
