# Mosaic Google Play Billing

Optional first-party Google Play Billing provider for Mosaic Android.

## Requirements

- Android API 24+
- Java 17
- Google Play Billing Library 9.1.0
- exact Play Product, subscription base-plan, and optional offer mappings in Commerce Configuration v2

The module is optional. `:mosaic` has no Play Billing dependency, and existing v1 RevenueCat/custom configurations remain supported.

## Artifact coordinates

The Gate 4B development artifacts are:

```text
dev.mosaic.sdk:mosaic:0.1.0-dev.6
dev.mosaic.sdk:mosaic-google-play:0.1.0-dev.6
```

The Google Play POM declares the matching `mosaic` core dependency. These
artifact versions are intentionally independent from the Google Play adapter
identity `1.0.0` reported through the Commerce Provider contract.

Repository sibling builds continue to use `project(":mosaic")` and
`project(":mosaic-google-play")`. To inspect local publication metadata without
publishing externally:

```bash
./gradlew \
  :mosaic:generatePomFileForReleasePublication \
  :mosaic-google-play:generatePomFileForReleasePublication
```

For local consumer testing only:

```bash
./gradlew \
  :mosaic:publishReleasePublicationToMavenLocal \
  :mosaic-google-play:publishReleasePublicationToMavenLocal
```

## Integration

```kotlin
val adapter = MosaicGooglePlayAdapter.create(
    application,
    MosaicCommerceUpdateAcceptance { update ->
        localCommerceSink.acceptIdempotently(update)
        // Return ACCEPTED, ALREADY_ACCEPTED, REJECTED_STALE_CONFIGURATION,
        // or DELIVERY_FAILED.
    },
)
val provider = MosaicConfiguredPurchaseProvider(adapter)
```

Pass `provider` to `Mosaic.configure` and close `adapter` when its application/process scope ends. The adapter never retains an Activity; it tracks only the currently resumed Activity for purchase presentation.

The acceptance callback is the host-visible local-delivery boundary and must be idempotent by `update.updateId`. Mosaic persists digest-based recovery state before acceptance and acknowledges only after acceptance. Purchase tokens, signatures, original JSON, raw debug messages, customer identity, and offer tokens are never exposed. Offer tokens are resolved from the current `ProductDetails` load and discarded on invalidation.

## Test purchases

Use Play Console license testers, a Play-distributed test build, and Play Billing Lab. The Android example enables Billing response overrides only in its debug manifest. Launch hosted mode with:

```bash
adb shell am start \
  -n dev.mosaic.example/.MainActivity \
  --es mosaic.sdk.key SDK_KEY \
  --es mosaic.application.id APPLICATION_ID \
  --ez mosaic.google.play true
```

Subscriptions require an exact base plan. Selecting an offer never falls back to another offer or to the regular base plan. Pending, cancellation, Product unavailability, provider unavailability, and failure remain distinct.
