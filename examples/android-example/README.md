# Mosaic Android Phase 1 example

This native Android app renders the sole Protocol 0.1 RC1 fixture with Jetpack
Compose and mock commerce. It offers controls for purchase success,
cancellation, failure, unavailable products, already-entitled, restore success,
empty restore, restore failure, English, long German, and Arabic RTL.

The app includes the SDK module from `sdk/android`. During every build that
module generates `build/generated/mosaic/canonical-assets/mosaic/complete-paywall.json`
from `protocol/fixtures/v0.1/complete-paywall.json`; there is no committed
Android fixture copy. Android's resource merger then packages that generated
asset into the example APK.

The hero resolver is deliberately `None`, so the app visibly demonstrates the
localized, same-aspect-ratio placeholder required for lookup or decode failure.
The result callback updates status but does not close the screen: the host owns
Activity, Dialog, and navigation dismissal.

From this directory, reuse the SDK's pinned Gradle wrapper:

```bash
../../sdk/android/gradlew -p . :app:assembleDebug
../../sdk/android/gradlew -p . :app:installDebug
```

No network configuration, remote fetching, cache, analytics, Studio preview,
or real billing provider is part of this Phase 1 example.
