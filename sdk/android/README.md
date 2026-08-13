# Mosaic Android SDK — Paywall Protocol 0.4 native rendering

The Android SDK strictly decodes Mosaic Paywall Protocol `0.4` "Motion" and
renders it with Jetpack Compose primitives. Under
[ADR-0028](../../docs/architecture/decisions/0028-single-version-contracts.md)
every contract carries exactly one version until GA, so there is no version
dispatch: version identifiers are exact, and a document declaring anything other
than `0.4` is rejected atomically before any structure is read. `0.4` carries
authored motion — an entrance, a selection cross-fade, and a bounded
call-to-action pulse — and one marker vocabulary shared by Feature List and
Timeline. Local Preview is version-locked to the same contract and negotiates
`mosaic.local-preview.v0.4` only.
It uses provider-neutral commerce, a generated bundled fallback, and Hosted
Configuration Delivery v3. RevenueCat support is isolated in the optional
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

Analytics Event Contracts v1 and v2 are available only for hosted clients.
Collection is **enabled by default**; hosts opt out by passing
`analyticsCollectionEnabled = false`. A host consent override may also disable
collection at runtime with `setAnalyticsCollectionEnabled(false)`; disabling
stops new collection and atomically clears the unsent queue. Neither switch can
make a server-disabled Environment accept events: the Environment-level
analytics setting in Mosaic settings remains the authoritative kill switch and
gates ingestion regardless of what a shipped build passes. Hosts remain
responsible for the end-user consent requirements of the jurisdictions they ship
in, and should pass `false` until any required consent is granted.

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
    // Omit this argument to keep collection on. Pass false to opt out entirely.
    analyticsCollectionEnabled = true,
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

## Transaction Observations (optional, off by default)

A Transaction Observation tells Mosaic that a Google Play purchase may exist so
server-side validation can begin sooner than a store notification would allow.
It is a **trigger, never proof**. The SDK never learns, reports, or acts on the
result of a validation, `serverConfirmedTransactions` stays `unsupported`, and a
`MosaicPurchaseResult` is never re-labelled by a submission answer.

It is disabled unless the host opts in:

```kotlin
val mosaic = Mosaic.configure(
    apiKey = publicSdkKey,
    purchaseProvider = purchaseProvider,
    applicationId = "application_android",
    transactionObservationEnabled = true, // false is the default
)
val hosted = mosaic.hostedConfiguration(applicationContext)
val diagnostics = hosted.transactionObservationDiagnostics()
```

The request and the response are both **Billing Ingestion Contract 1 records**
(`protocol/schema/billing-ingestion/v1/`), asserted against the canonical
fixtures. The submitted record is
`{ billingIngestionContractVersion: "1", recordType: "clientTransactionObservation", payload }`,
and the payload is exactly:

| Field | Value |
| --- | --- |
| `observationId` | Record identity, generated once and persisted; stable across every retry. |
| `submissionId` | The adapter's deterministic update identity; the deduplication key. |
| `providerId` | The provider adapter's identity. |
| `storePlatform` | `google_play`. |
| `transactionReference` | `{ google_play_token_digest, SHA-256 over the UTF-8 bytes of the purchase token, lowercase hex, unprefixed }`. |
| `providerOrderReference` | `{ google_play_order_id, Purchase.getOrderId() verbatim }`, when Google supplies a usable one. |
| `observedAt` | UTC timestamp of the observation. |
| `sourceAuthority` | Always `client_observation`; emitted by the codec, not settable. |
| `context` | `platform`/`sdkFamily` `android`, SDK version, and optional application and OS versions. |
| `correlation` | Existing opaque analytics handles only; omitted when empty. |
| `claimedMosaicProductId` | A claim only — the server resolves the Mosaic Product itself. |

**No Store Environment is ever sent.** Classification is a server-side decision
made from verified provider metadata, and the contract rejects a client
observation that asserts one.

**The raw purchase token never leaves the device.** The digest is one-way, and
the purchase token, `getOriginalJson()`, `getSignature()`, obfuscated account and
profile identifiers, prices, and subject data are never read into an observation,
a log, a diagnostic, or an exception message. The digest derivation is a
documented cross-SDK contract, asserted against the shared reference vectors in
`packages/test-fixtures/src/billing-reference-vectors.json`.

Behaviour:

- Observed on a completed purchase only, strictly after the transaction is
  finalized. **Acknowledgement is unchanged** — it stays client-side and always
  happens before any report, so Mosaic availability can never affect Google's
  refund window.
- Fire and forget. The purchase flow never waits for a submission, and a hung or
  unreachable endpoint cannot stall a paywall.
- App-private, backup-excluded, duplicate-safe queue that survives process
  restart, bounded to 64 observations or 64 KiB, expiring after seven days, with
  at most ten attempts using full-jitter exponential backoff and `Retry-After`.
- Retries only on foreground entry. Phase 9A adds no WorkManager or
  JobScheduler: store notifications and server-side reconciliation are the
  reliable path, so a late or lost observation costs correlation latency and
  never a purchase.
- Submission outcomes are `AcceptedForValidation`, `Duplicate`,
  `PermanentlyRejected`, and `RetryableFailure`, decoded only from the
  contract's `observationSubmissionResult` record. There is deliberately no
  member meaning validated; `AcceptedForValidation` means only that Mosaic
  queued the observation. An unknown record type, contract version, or status is
  never decoded — it retries rather than discarding the handoff. A
  `retryAfterSeconds` inside the record takes precedence over a `Retry-After`
  header.
- No store credential exists in any Mosaic SDK.
- When a Customer Access Token is available, a submission carries it in a
  `Mosaic-Customer-Token` header so Mosaic can bind the purchase to the Billing
  Customer the host already authenticated. Without it the purchase still
  validates but anchors only to its store lineage. The token is read when the
  request is built, never when the observation is queued — an observation can sit
  in the durable queue across a sign-in — and it is never written beside the
  queued record. The submission path reads an **already-held** token only and
  never mints one, so a background flush initiates no work against the host's
  backend. The 9A observation record itself is unchanged: this is a transport
  header, not a contract field, and a missing token simply omits it.

## Authoritative entitlements (optional, off by default)

Phase 9C responses use Authoritative Entitlement Contract v2. The v1 snapshot is wrapped in a
server-owned `(Project, Environment, Application, android)` authority scope and monotonic authority
epoch. Observe `client.customerAuthority` for the replaying authority state. An epoch is evaluated
before snapshot version, rollback creates a newer epoch, and an old v1 cache is reported as
`authority_unknown` rather than silently relabelled. When Mosaic is authoritative, Placement
targeting reads only Mosaic's accepted snapshot; it never unions provider-observed access.
Before accepting authority, Android enforces the server's minimum contract and SDK versions,
application-version window, and required capabilities. Unsupported builds expose unavailable
authority and targeting remains unknown rather than falling back to provider observations.
Direct authoritative entitlement checks answer from the Mosaic snapshot only while authority kind
is `mosaic`; `source` and `source_rollback` keep those checks unknown while provider targeting
remains available. Authority and sliding freshness are published only after the atomic cache commit
succeeds.
An accepted `snapshotUnchanged` also replaces the cached wrapper's outer `minimumSupport`, so the
latest compatible bootstrap requirements are reported and enforced after process restart without
changing the embedded v1 snapshot or its authority digest.
Android sends `knownSnapshotAuthorityDigest` only when its atomically retained v2 record still
matches the current Customer Access Token binding, Application/platform scope, authority epoch, and
snapshot version. An absent, corrupt, or mismatched tuple requests a full snapshot. If the server
cannot load the frozen support policy, `policy_unavailable` carries no fabricated minimum support;
the SDK atomically replaces retained Mosaic access with a durable invalidation marker and reports
authority unavailable, never inactive. The marker survives process restart and is replaced by a
later valid full snapshot. If the marker cannot be committed, access still fails closed in memory,
the SDK attempts to remove the old durable snapshot, the failure is diagnosed, and synchronization
remains gated until the marker retry succeeds. If storage rejects both marker and removal, Mosaic
does not claim durability; the severe diagnostic and in-process gate remain while storage is
unavailable.

The purchase provider remains independent. RevenueCat, Google Play Billing, or a custom provider
may continue purchases and restore while Mosaic controls access. Foreground recovery refreshes
authority before ordinary Configuration Delivery. No WorkManager dependency or guaranteed
background execution is introduced.

Two different questions have two different answers, and Mosaic keeps them apart:

- **Provider-observed** — what the store told *this device* a moment ago.
  `MosaicPurchaseProvider.activeEntitlements()`, `MosaicEntitlement`, and
  Placement targeting. Nothing about it changed, and no symbol was renamed or
  deprecated.
- **Authoritative** — what Mosaic has validated server-side and projected into a
  Customer Entitlement Snapshot. The `MosaicCustomer…` namespace. This is the
  answer that survives a refund, a revocation, a reinstall, and a second device.

Both exist because neither is sufficient alone: the provider answer is instant
but local and easily stale after a server-side change, and the authoritative
answer is durable but requires a network and an identified customer.

### Mosaic Billing requires an application backend

A public SDK key can never select a Billing Customer. Access is read with a
**Customer Access Token**, which only the host's own authenticated backend can
mint (through Mosaic's trusted server API). There is deliberately no client-only
path: one would have to accept a client-asserted identifier, which is the same
as letting any device read any customer's entitlements.

```kotlin
val mosaic = Mosaic.configure(
    apiKey = "mosaic_sdk_…",
    purchaseProvider = provider,
    // Null — the default — leaves the whole feature inert.
    customerAccessTokenProvider = { forceRefresh ->
        when (val token = myBackend.mosaicCustomerToken(forceRefresh)) {
            null -> MosaicCustomerAccessTokenResult.SignedOut
            else -> MosaicCustomerAccessTokenResult.Issued(MosaicCustomerAccessToken(token))
        }
    },
)
val client = mosaic.hostedConfiguration(context)
client.identifyCustomer("billing-customer-id")

when (val check = client.checkCustomerEntitlement("pro").state) {
    is MosaicCustomerEntitlementState.Active -> unlock(stale = check.isStale)
    is MosaicCustomerEntitlementState.Inactive -> showPaywall()
    // Mosaic could not answer. This is never "not entitled".
    is MosaicCustomerEntitlementState.Unknown,
    is MosaicCustomerEntitlementState.Unavailable -> keepCurrentAccess()
}
```

The token is held in memory only. It is never persisted, never logged, never
parsed — Mosaic's tokens are opaque — and `MosaicCustomerAccessToken.toString()`
redacts itself so an interpolated log line cannot leak it. The SDK calls the
provider on the IO dispatcher and never re-entrantly: concurrent readers collapse
onto one call, and a refused token triggers exactly one forced refresh and one
retry.

### There is no boolean API, and never `inactive` from a failure

`unknown` and `unavailable` are real answers and a `Boolean` has nowhere to put
them. `inactive` means Mosaic looked, found no qualifying source, and is
confident; it is produced only from an accepted snapshot that carries an entry
saying so. An Entitlement key the snapshot does not carry reads `unknown`, not
`inactive` — the sync may have been narrowed, the Entitlement may be newer than
the snapshot, or the key may simply be misspelled, and none of those is Mosaic
saying the customer lacks access. A network
failure, a timeout, an expired cache, a digest mismatch, an unsupported version,
a rejected document, and an unreadable device clock all produce `unknown`. A
reader that collapses "I could not find out" into "you do not have it" turns
every Mosaic outage into a mass revocation experienced by paying customers.

### The sync flow

Every sync is a `POST` carrying an `entitlementSyncRequest` record. Conditional
revalidation lives **in that body** — `knownSnapshotVersion` and `entityTag` —
rather than in `If-None-Match`, and the unchanged answer is a `200` carrying a
`snapshotUnchanged` record. One path decodes one document, and the refreshed
freshness window arrives inside the record the schema and content digest already
cover, so a proxy that rewrites or strips a header cannot change how long a
device believes its cache is valid.

The request never asserts a `billingCustomerId`. The Customer Access Token is the
sole customer selector, so there is no field through which a client could try to
read another customer's access.

A bare `304`, which only an intermediary can produce here, preserves the cache
and slides **nothing**: the cache runs out its own clock. Extending offline
validity requires an answer Mosaic actually produced.

### Caching, bounded grace, and the device clock

The accepted snapshot is written under `noBackupFilesDir`, in a directory named
by a digest of the Billing Customer identifier, through a four-step atomic write.
It is backup-excluded from day one so a snapshot cannot travel to another device
and grant one person's access on somebody else's phone.

Freshness follows the shipped bounded-grace policy, with a 60-second clock-skew
tolerance applied in the direction that favours the user:

| Window | Cache state | Behaviour |
| --- | --- | --- |
| before `refreshAfter` | `fresh` | Serve; do not refresh. |
| → `validUntil` | `refresh_recommended` | Fully valid; refresh opportunistically. |
| → `validUntil + staleGraceSeconds` | `stale_within_grace` | Previously active Entitlements stay active and are marked stale. |
| after that | `expired` | Report `unknown`. |

A device clock earlier than issuance by more than the tolerance is *unreliable*.
That is not a fifth state: it forces expired-equivalent behaviour and raises the
`customer.entitlements.clockUnreliable` diagnostic, because a cache whose age
cannot be measured cannot be trusted to be young. Without that rule, moving the
device clock backwards buys unlimited offline access.

### Identity changes

`identifyCustomer` and `signOutCustomer` bump an identity generation, orphan
anything in flight, publish `Loading` **before** reading anything, swap the
token, and isolate the on-device directory — in that order — so the previous
customer's grants are never observable for even one frame after a sign-in.
Sign-out deletes every stored snapshot. The Phase 6 installation identity is
untouched: a person signing in is not a new installation.

### Restore

`restoreAndSyncCustomerEntitlements()` runs the existing provider recovery
(unchanged, including Google Play acknowledgement), then waits a bounded three
attempts over roughly six seconds for Mosaic to validate it.
`AuthoritativeEntitlementsUpdated` is returned only when an accepted snapshot
actually advanced; otherwise the honest answer is `NativeRecoveryCompleted` with
`validationPending`. A purchase also triggers a debounced refresh that is never
awaited by the purchase path, so a hung entitlement endpoint costs a missed
refresh rather than a stalled purchase.

### Not a credential

A snapshot is a read model. Possessing it authorizes nothing, and a backend must
never accept one presented by a client as proof of access. The SDK cache supports
UI continuity and feature gating; protected backend resources are authorized by
the application's own server.

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

The canonical fixtures live under `protocol/fixtures/v0.4/`. The
library build copies the canonical fixture
as its bundled fallback into an ignored
`mosaic/build/generated/mosaic/canonical-assets/` directory and packages that
generated output into the AAR. Android source contains neither a fixture fork
nor a JSON Schema copy. JVM conformance tests read the repository file
directly.

Local Preview remains owned by `protocol/schema/local-preview/` and
`docs/protocol/`. Android keeps no schema or fixture fork. Its codec reads the
canonical message flow during JVM conformance tests, and every received draft
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
Each request advertises the full sorted capability catalog, as exact
`name@version` pairs, for backend compatibility validation. Capability
negotiation is orthogonal to version negotiation and survives the single-version
policy unchanged: a release requiring a capability this reader lacks is withheld
rather than downgraded or stripped.
Diagnostics contain stable codes and safe messages, never SDK keys, response
documents, or transport internals.

### Advanced Placement decisions

A release is accepted atomically and evaluated locally. A rejected refresh
keeps the last accepted release, so `paywall()` and `MosaicPlacement`
remain offline-capable and do not request configuration per presentation:

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
- Design-system color, background, and shadow tokens are resolved
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
- Tabs renders one control per entry and exactly one panel: the container is the
  tab list, each control carries the native `Tab` role, its selected state, and
  its authored label, and the visible panel carries the same label as its pane
  title. The initially visible panel is the authored `initialTabId`; reordering
  the `tabs` array never changes it. `selectedLabelColor` is authored on every
  Tabs component, so the selected label colour is never inferred from the
  Default state.
- A `visibility` of `{ "mode": "tab" }` removes the node from layout, the
  accessibility tree, and focus order while its condition is false, exactly as a
  false Switch condition does. Tab selection is runtime state keyed by the Tabs
  component ID and is reset from `initialTabId` whenever a new document is
  accepted. A condition naming a controller the runtime state does not carry
  throws `MosaicVisibilityStateException` rather than resolving to hidden.
- Timeline renders a labelled ordered list with native collection semantics.
  Each entry is one item contributing its title, then its description when
  declared; markers and connectors are decorative and never focusable. The connector is one
  continuous run drawn first in a leading gutter, with markers drawn over it, so
  an absent marker leaves it unbroken rather than being a special case. The
  gutter is `markerSize` wide when any entry declares a marker and
  `connector.width` wide when none does. Head and tail are decided
  independently: a terminal entry's marker centre when it declares one, that
  entry's content edge when it does not. An entry without a `description` draws
  no second line and reserves no space for one. `ordinal` markers use the
  resolved catalog locale's number format.
- Award renders its title, optional subtitle, and optional emblem as one
  labelled group. The emblem — image asset or icon — is always decorative. An
  absent emblem renders text alone; an absent subtitle renders nothing in its
  place and contributes no accessibility element.
- Social Proof announces the rating, then the quote, then the attribution; the
  avatar and the rating symbols are always decorative. `rating.value` counts steps, so it is announced
  in points against `maximum`, and the phrasing comes from the reserved
  `mosaic.a11y.rating` catalog string — the renderer composes no connective in
  any language. Numerals are ASCII by contract (`.` decimal separator, no
  grouping, one fraction digit only for a half step), so no platform number
  formatter is used. An absent rating draws no symbols and adds nothing to the
  announcement.
- **Group announcements are never joined.** Award, Social Proof, and Timeline
  put each announced segment in its own accessibility element inside an
  unmerged container whose name is the authored `accessibility.label`; the
  platform screen reader supplies the pause. No separator is composed, because
  any choice is wrong outside Latin script. An absent optional segment produces
  no element rather than an empty one.
- A Button is one accessibility element. Its name is the authored label and does
  not change between states; the busy state is the reserved
  `mosaic.a11y.in_progress` string in `stateDescription`. Neither `children` nor
  `inProgressChildren` are announced in either state.
- Reserved accessibility strings are read from the resolved catalog and never
  from a literal. `mosaic.a11y.rating` is required exactly when a Social Proof
  declares a `rating`, `mosaic.a11y.in_progress` exactly when a Button declares
  `inProgressChildren`; both directions are enforced, and a document declaring
  either requires `accessibility.reservedStrings`. A Button announces
  `mosaic.a11y.in_progress` as its accessible status while its in-progress
  content is shown.
- Product Cards and Product Badges render their authored passive
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
- Runtime selection is keyed by selector ID and Product Card ID. Every option is
  bound to an authored Product Card — `cards` is required with a minimum of one,
  so there is no card-less selector path. A missing initial/current card falls
  back to the first available authored card in source order. A blank localized price removes a card only when its Text or
  card accessibility resolves `product.price` for the active locale. No cards
  shows the configured message, disables purchase, and reports a recoverable interaction.
  `productUnavailable` becomes a terminal presentation result only when a
  purchase attempt or provider response is unavailable.

Documented Android differences:

- Compose exposes a native heading flag but no public heading-level semantic.
  Mosaic sets the native heading flag and preserves the RC1 level in
  `MosaicHeadingLevelKey` for inspection.
- Compose has no separate public TalkBack hint property. Control label and hint
  are joined in the native content description in protocol order. The contract
  keeps them apart, and so does `MosaicAccessibilityAnnouncement`, which the
  conformance vectors assert field by field; the join is a Compose mapping, not
  a modelled value. Every canonical group case carries a null hint, so no group
  announcement is affected.
- Compose has no `list` role. Timeline uses native collection semantics
  (`CollectionInfo`/`CollectionItemInfo`), which is what TalkBack announces as a
  list and its item positions.
- Stable Compose vertical scrolling has no public system-scrollbar visibility
  switch. Mosaic overlays a small direction-relative Compose indicator only
  when `showsIndicators` is true; scrolling and overscroll remain native.
- Typography metrics, Material control chrome, checkmark glyphs, focus visuals,
  safe-area inset sizes, and scroll physics remain Android-native, as RC1
  permits.
- Compose exposes a native `Tab` role and pane titles but no distinct
  `tabpanel` role. A panel is named by its tab's authored label through
  `paneTitle`; there is no second authored string to drift from the control's.

## Validation commands

From `sdk/android`:

```bash
./gradlew test lint assemble
./gradlew :mosaic:assembleDebugAndroidTest
./gradlew :mosaic:connectedDebugAndroidTest
```

The renderer pixel baselines in
`mosaic/src/androidTest/assets/mosaic-paywall-v04-golden.sha256` and
`mosaic-paywall-v04-golden.sha256` read `unrecorded` until they are captured on
a device. The screenshot tests skip with the digest to commit rather than passing
against a baseline recorded for a different document. **Every static golden is
captured with the motion driver disabled** — the digests are zero-tolerance, so
capturing one while anything is animating records a frame rather than a
rendering. Record them with:

```bash
./gradlew :mosaic:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.mosaic.recordRendererScreenshots=1
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
real `captureToImage` SHA-256 baseline recorded for `Pixel_3a_API_34`. The
Protocol 0.4 motion tests pin frames with `mainClock.autoAdvance = false` and
`advanceTimeBy` — never `waitForIdle` on content that is deliberately still
moving — and assert that the digest at `t = end` equals the digest captured with
the motion driver disabled, which is the terminal-state rule that makes the
`renderWithoutMotion` fallback lossless. Phase 2
adds preview status, locale/RTL/text-scale, commerce, invalid-document, and
unsupported-component UI checks. JVM tests consume both canonical Protocol and
Local Preview flow fixtures and cover the codec, revision state machine,
transport handshake, heartbeat routing, reconnect behavior, and fallback.

The runnable app is in `examples/android-example`.
