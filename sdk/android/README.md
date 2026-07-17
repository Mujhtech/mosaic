# Mosaic Android SDK — Phase 2 local preview

The Android SDK strictly decodes Mosaic Protocol 0.1 RC1 and renders its sole
canonical fixture with Jetpack Compose primitives. Phase 2 adds a native,
local-development preview client for the frozen Local Preview 0.1 contract.
It uses injected mock commerce and a generated bundled fallback. It has no
accounts, hosted configuration, remote publishing, analytics, experiments,
cloud storage, RevenueCat, or Play Billing.

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

Local Preview 0.1 remains owned by `protocol/schema/local-preview/v0.1/` and
`docs/protocol/local-preview-v0.1.md`. Android keeps no schema or fixture fork.
Its codec reads the canonical message fixture during JVM conformance tests,
while received draft documents still pass through the canonical Protocol 0.1
decoder before rendering.

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

## Local Studio preview

`MosaicLocalPreviewClient` owns the WebSocket lifecycle and protocol state.
`MosaicLocalPreviewPaywall` starts and stops that client with the Compose
lifecycle, renders its current `StateFlow`, and acknowledges a revision only
after Compose has adopted it. `MosaicLocalPreviewScreen` adds the development
status panel used by the example application.

```kotlin
val fallback = MosaicLocalPaywallLoader(
    MosaicCanonicalBundleSource(applicationContext),
).load(primaryDocumentJson = null)

val client = MosaicLocalPreviewClient(
    configuration = MosaicLocalPreviewConfiguration(
        endpoint = MosaicLocalPreviewConfiguration.ANDROID_EMULATOR_ENDPOINT,
        sessionId = MosaicLocalPreviewConfiguration.DEFAULT_SESSION_ID,
        client = MosaicAndroidPreviewIdentity.create(
            context = applicationContext,
            clientId = "client_android_example",
            displayName = "Android example preview",
        ),
    ),
    fallback = fallback,
)

MosaicLocalPreviewScreen(
    client = client,
    onInteraction = { outcome -> /* update development UI */ },
    onResult = { result -> /* host still owns navigation */ },
)
```

The emulator default is `ws://10.0.2.2:4317/preview`; a host process can use
`ws://127.0.0.1:4317/preview`. Configuration accepts only credential-free
local `ws://` or `wss://` endpoints: loopback, private-network, link-local, and
`.local` hosts. Query strings, fragments, user information, and public hosts
are rejected. Cleartext traffic is enabled only by the example application for
its local development socket, not by the library.

The client sends `previewClientConnected` followed by `capabilityReport`,
including the Protocol schema version, all supported Protocol capabilities,
the five Android preview capabilities, and its document-size limit. It
consumes draft identity and revision, raw Protocol document, locale and text
scale; independently ordered mock products, purchase/restore outcomes and
entitlement; targeted heartbeats; and safe disconnect diagnostics.

Drafts are rejected when they are stale, conflicting, oversized, invalid, or
require an unsupported schema, capability, or component. Diagnostics identify
the affected component, property, and JSON path where the contract supplies
them. A rejected draft or render failure preserves the last accepted draft;
before one exists, the bundled fallback remains visible. Unsupported required
components therefore never disappear silently.

Mock commerce state is isolated behind `MosaicPurchaseProvider`. A commerce
revision can update products, selection availability, purchase behavior,
restore behavior, and entitlement without changing the Protocol document or
requiring a real billing provider.

Connection state is visibly reported as connected, reconnecting, or
disconnected. Reconnect delay starts at 250 milliseconds and is capped at five
seconds. Heartbeats are sent every five seconds, and a connection with no valid
message for 15 seconds is safely re-established.

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
real `captureToImage` SHA-256 baseline recorded for `Pixel_3a_API_34`. Phase 2
adds preview status, locale/RTL/text-scale, commerce, invalid-document, and
unsupported-component UI checks. JVM tests consume both canonical Protocol and
Local Preview flow fixtures and cover the codec, revision state machine,
transport handshake, heartbeat routing, reconnect behavior, and fallback.

The runnable app is in `examples/android-example`.
