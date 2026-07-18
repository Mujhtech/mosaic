# Mosaic Android SDK — Protocol 0.2 native rendering

The Android SDK strictly decodes Mosaic Protocol 0.2 and renders it with
Jetpack Compose primitives. Local Preview uses the exact 0.2 contract.
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

The canonical fixtures live under `protocol/fixtures/v0.2/`. The library build copies the current Protocol 0.2
fixture as its bundled fallback into an ignored
`mosaic/build/generated/mosaic/canonical-assets/` directory and packages that
generated output into the AAR. Android source contains neither a fixture fork
nor a JSON Schema copy. JVM conformance tests read the repository file
directly.

Local Preview 0.2 remains owned by `protocol/schema/local-preview/` and
`docs/protocol/`. Android keeps no schema or fixture fork. Its codec reads both
canonical message flows during JVM conformance tests, and every received draft
still passes through the matching strict protocol decoder before rendering.

The decoder rejects unknown versions, fields, components, capabilities,
invalid references, duplicate IDs, invalid catalogs, mismatched inline
defaults, unused declarations, unsafe product templates, invalid Product
Card/Product Badge ownership or passive-content bounds, unsupported
accessibility payloads, and capability/content drift before any rendering
starts.

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
    videoResolver = MosaicBundledVideoResolver { logicalKey ->
        // Return a content/file/resource Uri for authored bundled video, or null.
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
including both supported Protocol schema versions, exact Protocol capabilities,
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
- Protocol 0.2 design-system color, background, and shadow tokens are resolved
  strictly by category. Native Compose draws solid, linear-gradient, and
  radial-gradient backgrounds plus one authored shadow; invalid references or
  token cycles reject the whole candidate before it replaces a valid document.
- Bundled and HTTPS remote image/video backgrounds use the authored content
  mode and fallback color. Decorative video uses a muted, looping, autoplaying
  Media3 player without controls or accessibility focus; its poster remains
  visible while loading or after playback failure.
- Width and height independently honor `fit`, `fill`, and `fixed`. Fixed bounds
  clip visual overflow without removing descendant semantics. A `fill` axis in
  an unbounded parent degrades to `fit` and emits `layout_unbounded_fill`.
- A screen presented as `sheet` uses Material 3 `ModalBottomSheet` over the most
  recent full screen. Back, the authored `navigateBack` action, and native
  sheet dismissal all restore the previous navigation entry.
- Protocol 0.2 Product Cards and Product Badges render their authored passive
  child trees. Default and Selected box leaves resolve independently; logical
  badge overlay anchors mirror in RTL without absolute protocol coordinates.
- `WindowInsets.safeDrawing`, font scaling, direction-relative padding and
  alignment, and `LayoutDirection.Rtl` are honored.
- After locale resolution, Product Card Text may substitute only
  `product.name` and `product.price`. A nonblank provider title wins, with the
  localized Product Reference label as its fallback. Store prices come only
  from runtime `MosaicProduct` values.
- Missing or undecodable logical images use the localized placeholder inside
  the same aspect-ratio frame.
- Runtime selection is keyed by selector ID and Product Card ID. A missing
  initial/current card falls back to the first available authored card in
  source order. A blank localized price removes a card only when its Text or
  card accessibility resolves `product.price` for the active locale. No cards
  shows the configured message, disables purchase, and reports a recoverable interaction.
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
unavailable and busy states, RTL, placeholder geometry, native sheet
navigation, host outcomes, and a
real `captureToImage` SHA-256 baseline recorded for `Pixel_3a_API_34`. Phase 2
adds preview status, locale/RTL/text-scale, commerce, invalid-document, and
unsupported-component UI checks. JVM tests consume both canonical Protocol and
Local Preview flow fixtures and cover the codec, revision state machine,
transport handshake, heartbeat routing, reconnect behavior, and fallback.

The runnable app is in `examples/android-example`.
