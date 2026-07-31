# Mosaic Android SDK — Protocol 0.2 native rendering

The Android SDK strictly decodes Mosaic Protocol 0.2 and renders it with
Jetpack Compose primitives. Local Preview uses the exact 0.2 contract.
It uses provider-neutral commerce, a generated bundled fallback, and Hosted
Configuration Delivery v1, v2, and v3. RevenueCat support is isolated in the optional
`:mosaic-revenuecat` module; the core `:mosaic` AAR has no RevenueCat or Play
Billing dependency. Native Google Play support is isolated in the optional
`:mosaic-google-play` module and consumes Commerce Configuration v2.

## Installation

The Mosaic Android SDK is pre-1.0 and is **not published to Maven Central, Google
Maven, or any other registry**. There is nothing to resolve from a remote
repository, and no coordinate below can be fetched over the network.

Install it by source, using either supported path:

**Composite/local-path build.** Include the modules directly, as
`examples/android-example` does:

```kotlin
// settings.gradle.kts
include(":app", ":mosaic", ":mosaic-google-play", ":mosaic-revenuecat")
project(":mosaic").projectDir = file("path/to/mosaic/sdk/android/mosaic")
project(":mosaic-google-play").projectDir = file("path/to/mosaic/sdk/android/mosaic-google-play")
project(":mosaic-revenuecat").projectDir = file("path/to/mosaic/sdk/android/mosaic-revenuecat")
```

```kotlin
// app/build.gradle.kts
implementation(project(":mosaic"))
implementation(project(":mosaic-google-play")) // optional
implementation(project(":mosaic-revenuecat"))  // optional
```

**Git pin plus local publication.** Pin the Mosaic repository at an exact commit
or tag, then publish to your own Maven repository or to `mavenLocal()`:

```bash
cd sdk/android
./gradlew \
  :mosaic:publishReleasePublicationToMavenLocal \
  :mosaic-google-play:publishReleasePublicationToMavenLocal \
  :mosaic-revenuecat:publishReleasePublicationToMavenLocal
```

The **development Maven coordinates** produced by that local publication — they
describe artifacts you built yourself, not artifacts Mosaic distributes — are:

```text
dev.mosaic.sdk:mosaic:0.1.0-dev.7
dev.mosaic.sdk:mosaic-google-play:0.1.0-dev.7
dev.mosaic.sdk:mosaic-revenuecat:0.1.0-dev.7
```

All three modules share one artifact version. That version is independent of the
commerce-adapter identities reported through the Commerce Provider contract,
which are both `1.0.0`.

`MOSAIC_ANDROID_SDK_VERSION` equals the artifact version exactly and is sent as
`Mosaic-SDK-Version` on every hosted request. It must be changed together with
the three module versions in the same commit; nothing derives one from the other
automatically.

## Minification and R8

The Mosaic Android SDK **requires no consumer ProGuard/R8 keep rules**, and its
`consumer-rules.pro` files are intentionally empty of rules.

That holds because Mosaic never uses reflective object binding. Every persisted
and transmitted document — protocol documents, the analytics queue, the
configuration cache record, Experiment assignment records, and the Google Play
local-delivery markers — is read and written by an explicit codec that names
each field literally. Gson is used only for its JSON tree and string-escaping
APIs, never for `fromJson(json, Model::class.java)`. R8 may therefore rename,
repackage, and shrink Mosaic classes and fields freely without changing any
persisted or wire shape.

This design is load-bearing rather than cosmetic. In a minified build R8 renames
the fields of Mosaic's persisted models — verifiably, in
`examples/android-example/app/build/outputs/mapping/release/mapping.txt`:

```text
dev.mosaic.sdk.MosaicCachedConfiguration -> ak1:
    java.lang.String etag -> a
    java.lang.String payload -> b
    ...
```

Reflective binding would have written `{"a":…,"b":…}` and would have failed to
read any record written by a build with different R8 output, silently discarding
the last-known-valid Configuration Release. The explicit codecs keep the literal
names, and a record with unknown, missing, or wrongly typed fields is rejected
outright rather than partially decoded.

Verification is permanent, not a one-off audit: the example application enables
`isMinifyEnabled` in its `release` build type, so R8 runs on the full Mosaic
dependency graph on every release build.

```bash
cd examples/android-example
../../sdk/android/gradlew -p . :app:assembleRelease
```

A Mosaic change that ever began to need keep rules would fail that task with an
R8 missing-class or missing-rule error. The two codec round-trip tests
(`ConfigurationDeliveryTest`, `ExperimentContractTest`) protect the data shape
itself, so a passing R8 build alone is never treated as sufficient evidence.

## Analytics, identity, and privacy

Analytics Event Contracts v1 and v2 are available only for hosted clients. Collection
defaults to disabled and begins only when `analyticsCollectionEnabled = true`
mirrors an owner-enabled Environment. A host consent override may disable
collection with `setAnalyticsCollectionEnabled(false)`; disabling stops new
collection and atomically clears the unsent queue. It cannot make a
server-disabled Environment accept events.

Events snapshot installation identity, optional application user identity,
session, correlations, and immutable release/Placement/Paywall/Product
attribution at occurrence time. Public Android SDK events always assert
`client_observed`; the SDK cannot enqueue `purchase_completed_provider`.

The app-private, backup-excluded queue survives process restart and is bounded
to 1,000 events or 2 MiB. Events are capped at 32 KiB, expire after seven days,
and send in batches of at most 50 and 512 KiB. Retry is capped at ten attempts
with full-jitter exponential backoff from one second to five minutes. Partial
responses remove accepted, duplicate, and permanently rejected events while
retaining only retryable events. Overflow discards expired and older low-value
events before purchase/restore outcomes while always enforcing the hard bound.

Sessions use a 30-minute inactivity threshold and survive ordinary SDK
reconstruction. Effective user changes, user clearing, installation reset, and
collection re-enable start a new session. `resetIdentity()` retains the
installation ID; `resetInstallationIdentity()` rotates it and clears user state.

```kotlin
val mosaic = Mosaic.configure(
    apiKey = publicSdkKey,
    purchaseProvider = purchaseProvider,
    applicationId = "application_android",
    analyticsCollectionEnabled = environmentAnalyticsEnabled,
)
val hosted = mosaic.hostedConfiguration(applicationContext)
hosted.setAnalyticsCollectionEnabled(hostConsentGranted)
val diagnostics = hosted.flushAnalytics()
```

Foreground and background transitions request a best-effort flush. Foreground
entry also coalesces a configuration refresh so emergency-stop releases can
take effect without a request for every presentation. Android may
terminate a background process immediately, so background delivery is not
guaranteed; the persistent queue resumes on the next foreground. Mosaic does
not use WorkManager for Phase 6. Local Preview and unhosted bundled paywalls do
not emit hosted analytics.

The deterministic offline reconstruction and canonical partial-response demo is:

```bash
./gradlew :mosaic:testDebugUnitTest \
  --tests 'dev.mosaic.sdk.AnalyticsQueueTest.offlineQueueSurvivesReconstructionThenAppliesCanonicalPartialBatch'
```

## Supported version matrix

This is a support policy, not a compatibility guess. "Tested" means Phase 8
validation ran on it. Anything absent from this table is unsupported: it may
work, but Mosaic does not verify it and will not treat a failure there as a
release blocker.

### Toolchain used to build the SDK (tested)

| Component | Version |
| --- | --- |
| JDK | 17 |
| Gradle | 9.3.1 (pinned wrapper in `sdk/android`) |
| Android Gradle Plugin | 9.1.1 |
| Kotlin / Compose compiler plugin | 2.2.10 |
| `compileSdk` / `targetSdk` | 36 |
| `minSdk` | 24 |

### Floor required to consume the AAR (enforced)

| Requirement | Value | How it is enforced |
| --- | --- | --- |
| Host `compileSdk` | 36 or later | `minCompileSdk=36` in the AAR metadata; AGP fails the consuming build below it |
| Host Kotlin | 2.2.0 or later | Class files carry Kotlin metadata `mv=[2,2,0]`; earlier compilers reject it |
| Host AGP | any AGP that supports `compileSdk = 36` | AGP rejects `minCompileSdk=36` otherwise; AGP 9.1.1 is the only tested version |
| Host JDK | 17 or later | Library bytecode targets Java 17 |
| Device / emulator API | 24 or later | `minSdk` |

Both floors above were read from the built artifact
(`META-INF/com/android/build/gradle/aar-metadata.properties` and the Kotlin
`@Metadata` annotation), not estimated. Only AGP 9.1.1 with Kotlin 2.2.10 is
tested. An exact minimum AGP version is deliberately not claimed: Mosaic has not
verified one, and the practical floor is whichever AGP release your host uses to
compile against API 36.

Hosts that render Mosaic paywalls compose Mosaic's `@Composable` functions and
therefore need the Compose compiler plugin enabled in their own build. Mosaic's
Compose runtime requirement comes from Compose BOM `2026.02.00` and is resolved
by Gradle as an ordinary dependency constraint.

Dependency versions are frozen for GA (see `docs/known-limitations.md`), so
Android lint's `NewerVersionAvailable` warnings are expected and are not
actionable in this release.

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

## Hosted configuration

An environment-scoped public SDK key selects a Configuration Delivery release.
Presentation is cache-first; networking occurs when the host explicitly calls
`refresh()` and once per foreground transition. The returned sealed result distinguishes an
update, `304` revalidation, retained last-known-valid state, and unavailable
state.

```kotlin
val diagnostics = MosaicDiagnosticSink { diagnostic ->
    Log.w("Mosaic", "${diagnostic.code.wireName}: ${diagnostic.message}")
}
val hosted = Mosaic.configure(
    apiKey = publicSdkKey,
    purchaseProvider = purchaseProvider,
    applicationId = "application_android",
).hostedConfiguration(
    context = applicationContext,
    diagnostics = diagnostics,
)

when (val refresh = hosted.refresh()) {
    is MosaicConfigurationRefreshResult.Updated -> Unit
    is MosaicConfigurationRefreshResult.NotModified -> Unit
    is MosaicConfigurationRefreshResult.Retained -> {
        // refresh.configuration remains safe to present
    }
    is MosaicConfigurationRefreshResult.Unavailable -> {
        // paywall() may still resolve the bundled fallback
    }
}
val placement = hosted.paywall("onboarding_complete")
```

A remote `200` is accepted only after its strong ETag, complete release,
Environment identity, and non-decreasing release number validate and the
release is durably committed to the app-private cache. Failed writes and
rejected candidates preserve the prior in-memory and persistent release. Cache
files are isolated by a SHA-256 namespace derived from the delivery endpoint
and public SDK key; neither value is written into the cache path or record.
Each request advertises the full sorted Protocol 0.2 capability catalog as
exact `name@version` pairs for backend compatibility validation.
Diagnostics contain stable codes and safe messages, never SDK keys, response
documents, or transport internals.

### Advanced Placement decisions

Delivery v2 is accepted atomically and evaluated locally. A rejected refresh
keeps the last accepted v1, v2, or v3 release, so `paywall()` and `MosaicPlacement`
remain offline-capable and do not request configuration per presentation.
Existing v1 calls remain source compatible:

```kotlin
when (val decision = hosted.decidePlacement("export_pdf", country = explicitCountry)) {
    is MosaicPlacementDecisionResult.Available -> Unit
    is MosaicPlacementDecisionResult.NoPaywall -> Unit
    is MosaicPlacementDecisionResult.PlacementUnavailable -> Unit
    is MosaicPlacementDecisionResult.EvaluationFailed -> inspect(decision.diagnosticCode, decision.trace)
    MosaicPlacementDecisionResult.ConfigurationUnavailable -> Unit
}
```

`country` is optional trusted host input and is never inferred from locale,
timezone, currency, IP address, or device region. Evaluation uses exact
priority, three-state conditions, semantic versions, RFC 4647 basic locale
matching, named fallbacks, and `sha256_length_prefixed_v1`. Safe traces include
rule/source metadata and buckets but never identity or attribute values,
assignment keys, provider payloads, or override tokens.

Identity is stored in the application's private no-backup directory. Its APIs
are suspendable and serialized; no main-thread file access or global coroutine
scope is used:

```kotlin
hosted.identify(
    userId = applicationUserId,
    attributes = mapOf("student" to MosaicTypedValue.BooleanValue(true)),
)
hosted.resetIdentity()             // retains installation ID
hosted.resetInstallationIdentity() // explicitly rotates installation ID
```

Attribute updates are atomic, bounded, typed, and restricted to definitions in
the accepted release. Identity reset also clears in-memory QA tokens, which are
never persisted. `MosaicPlacement` evaluates before composing the existing
native renderer and reuses the decision's Product-load snapshot.

### Experiments

Delivery v3 adds strict Experiment Assignment v1 without changing the public
Placement API. Normal Placement must first select the exact Control Paywall
Version. Assignment and mutual exclusion then use the canonical length-prefixed
SHA-256 algorithms locally and offline. The SDK retains the ordered Assignment
candidate list, so mutually exclusive Experiments may share a Placement and
evaluation continues to the group-admitted candidate. Identity changes affect
future decisions without rewriting queued history.

Schedules use validated server time: start is inclusive, an optional end is
exclusive, anchors become stale after seven days, and wall-clock deviation over
five minutes conservatively uses normal Placement. Assignment diagnostics store
only one-way subject digests and safe IDs in the no-backup directory, with
atomic replacement and bounds of 256 records/180 days. Hosts can inspect them
with `hosted.experimentDiagnostics()`.

A Variant is presented only when its exact Product set is ready and the
installed provider truthfully declares every required capability. Otherwise
the existing normal Placement Paywall is presented. Statistical
`experiment_exposed` is emitted exactly once after native presentation;
successful fallback emits `experiment_fallback_presented`, assignment alone is
diagnostic, and QA presentations never emit statistical exposure. Analytics
delivery remains nonblocking.

## Commerce Configuration and providers

`MosaicConfiguredPurchaseProvider` keeps stable Mosaic Product and Entitlement
IDs independent of provider identifiers. It fails safely until an exact
Commerce Configuration v1 snapshot associated with the accepted release,
application, Android platform, and complete Product Reference set is verified.
The hosted client fetches that sidecar only when the host explicitly calls
`refreshCommerceConfiguration()`:

```kotlin
val configuredProvider = MosaicConfiguredPurchaseProvider(providerAdapter)
val hosted = Mosaic.configure(
    apiKey = publicSdkKey,
    purchaseProvider = configuredProvider,
    applicationId = "application_android",
).hostedConfiguration(applicationContext)

hosted.refresh()
hosted.refreshCommerceConfiguration()
```

The release and sidecar are committed as one cache record. Invalid, stale,
mismatched, or unavailable sidecars preserve the prior valid pair; accepting a
new release without a matching sidecar makes provider operations unavailable
until the matching sidecar arrives. A changed sidecar invalidates every
provider-native Product handle before it becomes current; purchases remain
unavailable until the exact new mappings finish loading. Custom integrations
implement the
SDK-local `MosaicCommerceProviderAdapter`, including stable `identity`, truthful
`capabilities`, and a bounded secret-free `diagnostics` list in addition to
load, purchase, restore, and active-Access operations. They can instead pass an equivalent
sidecar from their trusted delivery path to
`hosted.acceptCommerceConfiguration(payload)`.
Before any mapping becomes active, the configured provider requires the
sidecar Provider ID and Mosaic adapter version to equal the installed adapter
and requires exact equality of every `(name, support, reasonCode)` capability
tuple. The installed adapter is the authority for runtime capabilities;
sidecar claims cannot upgrade, omit, or otherwise replace them.

For RevenueCat, add the optional `:mosaic-revenuecat` module — published under
the development coordinate `dev.mosaic.sdk:mosaic-revenuecat:0.1.0-dev.7` by the
same local publication as the other two modules — and configure RevenueCat in
host code exactly once. Pass the already-configured instance to
Mosaic; the adapter intentionally has no API-key or app-user-ID parameter:

```kotlin
val configuredProvider = MosaicConfiguredPurchaseProvider(
    MosaicRevenueCatAdapter(Purchases.sharedInstance) { currentActivity },
)
```

Hosted Commerce Configuration `200` responses require the exact v1 media type,
a strong quoted ETag equal to the decoded body `contentDigest`, and the exact
`Mosaic-Configuration-Release-Id`. A `304` is accepted only when the SDK still
holds a fully validated release-sidecar pair and the response repeats both the
exact retained sidecar digest ETag and Configuration Release ID. Missing, weak,
malformed, or mismatched validation headers preserve the last valid pair and
fail revalidation safely.

Commerce Configuration supports exact direct product mappings and exact
Offering/Package mappings. The adapter normalizes purchase, pending,
cancelled, already-entitled, unavailable, and failed outcomes; restore and
active-entitlement results use the same stable Mosaic IDs. Restore exposes
`restored`, `nothingToRestore`, `cancelled`, `providerUnavailable`, or `failed`;
active Entitlement lookup exposes exactly `available`, `unknown`,
`providerUnavailable`, or `failed`. Mosaic never infers an inactive
Entitlement set from provider failure. Mosaic does not
cache provider credentials, purchase tokens, or customer data, and diagnostics
carry a stable code, safe message, retryability, correlation ID, optional safe
provider code, and recovery action. Provider-failure results reference that
complete diagnostic instead of exposing raw provider exceptions; secrets never
appear in either surface.

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
./gradlew test lint assemble
./gradlew :mosaic:assembleDebugAndroidTest
./gradlew :mosaic:connectedDebugAndroidTest
```

`connectedDebugAndroidTest` requires a connected device or a running emulator;
it cannot run headless.

The R8 regression guard lives in the example application:

```bash
cd ../../examples/android-example
../../sdk/android/gradlew -p . :app:assembleRelease :app:assembleDebug :app:lint
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
