# Mosaic Flutter Phase 1 example

This native Flutter playground renders the sole Protocol 0.1 RC1 fixture with
Flutter widgets and deterministic mock commerce. It exposes controls for
English, long German, Arabic RTL, product availability, every purchase result,
and every restore result.

The app intentionally leaves `mosaic.paywall.hero` unresolved so the fixture's
localized, same-geometry placeholder is visible. Replace `imageResolver` in
`lib/main.dart` with an `AssetImage` mapping to exercise a host image.

## Run

From this directory:

```bash
dart run tool/sync_fixture.dart
flutter pub get
flutter run
```

The sync command copies the repository-owned canonical fixture byte-for-byte
into ignored `assets/generated/` output. The derived JSON is never committed or
maintained as a second fixture. Run the sync command again after an explicitly
coordinated RC change.

For a platform-neutral build check that does not require a simulator:

```bash
dart run tool/sync_fixture.dart
flutter build bundle
```

`MosaicPaywallHost` reports terminal results but does not dismiss host UI. This
playground keeps the renderer visible to make scenarios easy to compare; a real
app should dismiss its own route, sheet, or dialog after handling a terminal
result.
