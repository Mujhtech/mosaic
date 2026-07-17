# Mosaic Android SDK — Phase 1 RC1

The Android SDK strictly decodes Mosaic Protocol 0.1 RC1 and renders its sole
canonical fixture with Jetpack Compose primitives. Phase 1 is local only: it
uses injected mock commerce and a generated bundled fallback. It has no REST
fetching, remote configuration, cache, Studio, analytics, or Play Billing.

## Requirements

- JDK 17
- Android SDK 36
- Gradle 9.3.1
- Android Gradle Plugin 9.1.1
- Kotlin/Compose compiler plugin 2.2.10
- minimum host Android API 24

## Canonical protocol ownership

`protocol/fixtures/v0.1/complete-paywall.json` is the only RC1 fixture. The
library build copies it into an ignored
`mosaic/build/generated/mosaic/canonical-assets/` directory and packages that
generated output into the AAR. Android source contains neither a fixture fork
nor a JSON Schema copy. JVM conformance tests read the repository file
directly.

The decoder rejects unknown versions, fields, components, capabilities,
invalid references, duplicate IDs, invalid catalogs, mismatched inline
defaults, unused declarations, unsupported accessibility payloads, and
capability/content drift before any rendering starts.

## Local loading and rendering

```kotlin
val loadResult = MosaicLocalPaywallLoader(
    bundledFallback = MosaicCanonicalBundleSource(applicationContext),
).load(primaryDocumentJson = localCandidateOrNull)

MosaicPaywall(
    loadResult = loadResult,
    purchaseProvider = MockMosaicPurchaseProvider(
        products = MockMosaicPurchaseProvider.phase1Products(),
    ),
    requestedLocale = "ar",
    imageResolver = MosaicBundledImageResolver { logicalKey ->
        // Return a decoded ImageBitmap for "mosaic.paywall.hero", or null.
        null
    },
    onInteraction = { interaction -> /* includes restore-only outcomes */ },
    onResult = { result -> /* host decides whether to dismiss */ },
)
```

`MosaicPaywall` is embeddable. It reports terminal presentation results but
does not finish an Activity, dismiss a Dialog, or mutate host navigation.
`restoreNoPurchases` and `restoreFailed` are interaction-only and leave the
paywall usable.

The exact presentation union is `purchased`, `restored`, `alreadyEntitled`,
`dismissed`, `cancelled`, `productUnavailable`, `configurationUnavailable`,
`purchaseFailed`, and `renderingFailed`.

## Native behaviour

- `Column`, native vertical scrolling, `Text`, `Image`, Material buttons, and
  radio-button selection semantics render the protocol tree in source order.
- `WindowInsets.safeDrawing`, font scaling, direction-relative padding and
  alignment, and `LayoutDirection.Rtl` are honored.
- Store price and subscription-period strings come only from runtime
  `MosaicProduct` values. The provider receives the opaque `productId`; host
  outcomes carry the document-local product reference ID.
- Missing or undecodable logical images use the localized placeholder inside
  the same aspect-ratio frame.
- A missing configured product selection falls back to the first available
  reference in source order. No products shows the configured message,
  disables purchase, and reports a recoverable interaction.
  `productUnavailable` becomes a terminal presentation result only when a
  purchase attempt or provider response is unavailable.

Documented Android differences:

- Compose exposes a native heading flag but no public heading-level semantic.
  Mosaic sets the native heading flag and preserves the RC1 level in
  `MosaicHeadingLevelKey` for inspection.
- Compose has no separate public TalkBack hint property. Control label and hint
  are joined in the native content description in protocol order.
- Stable Compose vertical scrolling has no public system-scrollbar visibility
  switch. Mosaic overlays a small direction-relative Compose indicator only
  when `showsIndicators` is true; scrolling and overscroll remain native.
- Typography metrics, Material control chrome, checkmark glyphs, focus visuals,
  safe-area inset sizes, and scroll physics remain Android-native, as RC1
  permits.

## Validation commands

From `sdk/android`:

```bash
./gradlew :mosaic:assembleDebug
./gradlew :mosaic:testDebugUnitTest
./gradlew :mosaic:lintDebug
./gradlew :mosaic:assembleDebugAndroidTest
./gradlew :mosaic:connectedDebugAndroidTest
```

The instrumentation suite checks accessibility semantics, selection,
unavailable and busy states, RTL, placeholder geometry, host outcomes, and a
real `captureToImage` SHA-256 baseline recorded for `Pixel_3a_API_34`.

The runnable app is in `examples/android-example`.
