# Mosaic Android Phase 2 local-preview example

This native Android app connects a Jetpack Compose renderer to a running local
Mosaic Studio preview session. Studio draft revisions rerender immediately,
without rebuilding or restarting the app. The status panel visibly reports
connected, reconnecting, disconnected, invalid document, unsupported
component, locale/RTL/text scale, live revision, mock purchase outcome, and
active entitlement states.

The app includes the SDK module from `sdk/android`. During every build that
module generates `build/generated/mosaic/canonical-assets/mosaic/complete-paywall.json`
from `protocol/fixtures/v0.1/complete-paywall.json`; there is no committed
Android fixture copy. Android's resource merger then packages that generated
asset into the example APK.

Until the first valid live revision arrives, the sole canonical Protocol 0.1
fixture is the bundled fallback. A stale, invalid, unsupported, or failed live
revision leaves the last accepted draft (or that fallback) visible. The hero
resolver is deliberately `None`, so the app also demonstrates the localized,
same-aspect-ratio asset fallback and reports it to Studio. Result callbacks
update status but do not close the screen: the host still owns Activity,
Dialog, and navigation dismissal.

The default Android emulator endpoint is
`ws://10.0.2.2:4317/preview`, which reaches the Studio relay on the development
host. The default session is `session_local_01`. Start local Studio and its
preview relay before launching the app, then build and install it from this
directory using the SDK's pinned Gradle wrapper:


```bash
../../sdk/android/gradlew -p . :app:assembleDebug
../../sdk/android/gradlew -p . :app:installDebug
adb shell am start -n dev.mosaic.example/.MainActivity
```

To select a different local relay or session, pass Activity string extras:

```bash
adb shell am start -n dev.mosaic.example/.MainActivity \
  --es mosaic.preview.endpoint ws://10.0.2.2:4317/preview \
  --es mosaic.preview.session session_local_01
```

The SDK accepts only credential-free local `ws://` or `wss://` endpoints. The
example enables Android cleartext traffic solely for this local development
connection. It does not add accounts, hosted fetching, remote publishing,
cloud storage, analytics, experiments, RevenueCat, or Google Play Billing.
