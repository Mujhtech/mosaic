# Mosaic Flutter Phase 2 local preview

This native Flutter example connects to the account-free local Studio relay,
reports its Protocol 0.1 and Local Preview 0.1 capabilities, and rerenders an
accepted draft without rebuilding the app. When Studio is disconnected or a
revision fails, the last accepted document remains visible; before the first
accepted revision, the generated canonical bundle is the safe fallback.

The status panel visibly distinguishes:

- connected, reconnecting, and disconnected transport states;
- the live local revision;
- locale, RTL through the selected locale, and accessibility text scale;
- active mock purchase and entitlement state;
- invalid documents, unsupported components, and render failures; and
- the latest safe interaction or connection diagnostic.

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

## Verify

```bash
dart run tool/sync_fixture.dart
dart format --output=none --set-exit-if-changed lib test tool
flutter analyze --no-pub
flutter test --no-pub
flutter build bundle --no-pub
```

The sync command copies
`protocol/fixtures/v0.1/complete-paywall.json` byte-for-byte into ignored
`assets/generated/` output. It is never maintained as a second canonical
fixture. Local Preview contract tests consume the repository fixtures directly
from `protocol/fixtures/local-preview/v0.1/`.

`MosaicPreviewPaywall` reports terminal results but does not dismiss host UI.
This playground intentionally keeps the native renderer visible so Studio
updates, mock commerce, error recovery, long German copy, Arabic RTL, and text
scaling remain easy to inspect.
