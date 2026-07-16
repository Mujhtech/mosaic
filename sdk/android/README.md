# Mosaic Android SDK (Phase 0)

This Android library establishes Mosaic configuration, strict protocol 0.1
decoding, provider-neutral suspend commerce contracts, and a deterministic mock
provider. The module enables Jetpack Compose and compiles against the Compose
BOM, but does not include a paywall composable or renderer yet.

The JVM test target reads the repository-owned fixture directly from
`protocol/fixtures/v0.1/minimal-paywall.json`; no SDK-local copy exists.

## Requirements

- JDK 17
- Android SDK 36
- Gradle 9.3.1
- Android Gradle Plugin 9.1.1
- Kotlin/Compose compiler plugin 2.2.10 (aligned with AGP built-in Kotlin)
- Minimum host Android API 24

## Commands

From `sdk/android` using the checked-in, checksum-pinned Gradle wrapper:

```bash
./gradlew :mosaic:assembleDebug
./gradlew :mosaic:testDebugUnitTest
./gradlew :mosaic:lintDebug
```

The package intentionally does not check in a second protocol fixture. Tests
must run inside a Mosaic checkout so the canonical repository fixture is
available.

## Configuration

```kotlin
val mosaic = Mosaic.configure(
    apiKey = "public_key",
    endpoint = URI("http://localhost:8080"), // Optional override.
    purchaseProvider = MockMosaicPurchaseProvider(),
)
```

No hosted endpoint is selected in Phase 0. Omitting `endpoint` preserves that
unresolved product decision while still allowing local or self-hosted overrides.
