# Mosaic Android local-preview and hosted-delivery example

Hosted mode can use the optional first-party Google Play provider without
changing the Paywall document or its Mosaic Product references:

```bash
adb shell am start \
  -n dev.mosaic.example/.MainActivity \
  --es mosaic.sdk.key SDK_KEY \
  --es mosaic.application.id APPLICATION_ID \
  --ez mosaic.google.play true
```

Install the debug build through a Play test track for real test Products. Its
debug-only manifest enables Play Billing response overrides for Play Billing
Lab and cleartext traffic for Local Preview; release builds include neither.

This native Android app connects a Jetpack Compose renderer to a running local
Mosaic Studio preview session. Studio draft revisions rerender immediately,
without rebuilding or restarting the app. The status panel visibly reports
connected, reconnecting, disconnected, invalid document, unsupported
component, locale/RTL/text scale, live revision, mock purchase outcome, and
active entitlement states.

The app includes the SDK module from `sdk/android`. During every build that
module generates `build/generated/mosaic/canonical-assets/mosaic/complete-paywall.json`
from `protocol/fixtures/v0.2/complete-paywall.json`; there is no committed
Android fixture copy. Android's resource merger then packages that generated
asset into the example APK.

Until the first valid live revision arrives, the canonical Protocol 0.2
fixture is the bundled fallback, including its three structurally authored
Product Cards, nested and logical-overlay Product Badges, and horizontal
Product Selector. It also demonstrates native design-system gradients and
shadows, fixed/fit/fill sizing, and a button-driven Material 3 details sheet.
Bundled video intentionally has no example resolver, so its declared fallback
is visible and the recoverable media diagnostic can be inspected. A stale,
invalid, unsupported, or failed live
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

## Validation commands

```bash
../../sdk/android/gradlew -p . :app:assembleRelease :app:assembleDebug :app:lint
```

The `release` build type enables `isMinifyEnabled`, so `:app:assembleRelease` is
the permanent R8 regression guard for the whole Mosaic dependency graph: if a
Mosaic change ever began to require consumer keep rules, that task fails. The
resulting rename map is written to
`app/build/outputs/mapping/release/mapping.txt` and shows Mosaic's persisted
model fields being renamed, which is exactly why the SDK persists every record
through explicit codecs rather than reflective binding. See the R8 section of
`sdk/android/README.md`.

The Android SDK's own JVM suite, lint, and library artifacts are validated from
`sdk/android` with `./gradlew test lint assemble`. Instrumentation tests
(`:mosaic:connectedDebugAndroidTest`) need a connected device or a running
emulator; there is no headless path.

To select a different local relay or session, pass Activity string extras:

```bash
adb shell am start -n dev.mosaic.example/.MainActivity \
  --es mosaic.preview.endpoint ws://10.0.2.2:4317/preview \
  --es mosaic.preview.session session_local_01
```

The SDK accepts only credential-free local `ws://` or `wss://` endpoints, and the
Mosaic library itself never requests cleartext traffic. This example declares
`android:usesCleartextTraffic="true"` **only in `app/src/debug/AndroidManifest.xml`**,
solely so Local Preview can reach the Studio relay over `ws://`. The release
build does not request cleartext traffic at all, so a host copying this example
does not inherit an app-wide cleartext permission.

For the hosted path, pass an environment-scoped public SDK key. The
app fetches Configuration Delivery v1, v2, or v3, resolves the requested Placement,
caches the last valid release, and renders with the same native Compose
renderer. It uses deterministic app-owned commerce unless a RevenueCat public
SDK key and Mosaic Application ID are also supplied:

```bash
adb shell am start -n dev.mosaic.example/.MainActivity \
  --es mosaic.sdk.key mosaic_sdk_example \
  --es mosaic.sdk.endpoint http://10.0.2.2:8080 \
  --es mosaic.application.id application_android \
  --es revenuecat.public.sdk.key goog_example_public_key \
  --es mosaic.placement onboarding_complete
```

Omit `mosaic.sdk.endpoint` to use Mosaic's hosted API. A Delivery v3 release can
assign and present an Experiment through the same `mosaic.placement` extra; no
Experiment-specific application code or Paywall ID is required. Google Play remains optional.
Hosted analytics is enabled by default, matching the SDK default; pass
`--ez mosaic.analytics.enabled false` to demonstrate the opt-out path. The
Environment-level analytics setting in Mosaic settings still gates ingestion
server-side whatever the build passes, and hosts remain responsible for the
end-user consent requirements of the jurisdictions they ship in. The on-screen
status reports persistent queue depth. The
optional Transaction Observation handoff is likewise off unless
`--ez mosaic.observations.enabled true` is passed.

When the entitlement endpoint returns Contract v2, the example also shows the current source or
Mosaic authority, authority epoch, and transition state. An unavailable or legacy authority is
labelled explicitly and is never rendered as inactive access. Switching authority does not replace
the configured RevenueCat or Google Play purchase provider.

The example includes the optional `:mosaic-revenuecat` module, initializes it
only when the host supplies that public key, and lets hosted refresh atomically
accept the exact Commerce Configuration sidecar. Omit
`revenuecat.public.sdk.key` to switch back to the app-owned provider without
changing the Paywall document. The example never embeds a RevenueCat key or
customer identity.

The hosted example renders through `MosaicPlacement`; advanced rules,
deliberate `no_paywall`, named fallbacks, and offline last-known-valid decisions
keep the same Placement extra and do not expose Paywall IDs to application
code. Country remains an explicit trusted host input and is never inferred.

### Offline analytics queue demonstration

Use non-production data and an Application-bound public SDK key. First run once
against the real endpoint so the hosted release is cached. Then stop that same
local backend (or disconnect the emulator network), keeping every launch extra
and therefore the SDK cache namespace unchanged. Relaunch, generate
Placement/Paywall/commerce events, and stop the process:

```bash
adb shell am start -n dev.mosaic.example/.MainActivity \
  --es mosaic.sdk.key SDK_KEY \
  --es mosaic.sdk.endpoint http://10.0.2.2:8080 \
  --es mosaic.application.id APPLICATION_ID \
  --es mosaic.placement onboarding_complete \
  --ez mosaic.analytics.enabled true
adb shell am force-stop dev.mosaic.example
```

Restore that same backend/network and request a manual flush. The queue is restored
before accepted, duplicate, and permanent results are removed; retryable
results remain:

```bash
adb shell am start -n dev.mosaic.example/.MainActivity \
  --es mosaic.sdk.key SDK_KEY \
  --es mosaic.sdk.endpoint http://10.0.2.2:8080 \
  --es mosaic.application.id APPLICATION_ID \
  --es mosaic.placement onboarding_complete \
  --ez mosaic.analytics.enabled true \
  --ez mosaic.analytics.flush true
```

The reproducible JVM proof uses the frozen canonical mixed response:

```bash
../../sdk/android/gradlew -p ../../sdk/android :mosaic:testDebugUnitTest \
  --tests 'dev.mosaic.sdk.AnalyticsQueueTest.offlineQueueSurvivesReconstructionThenAppliesCanonicalPartialBatch'
```

### Transaction Observations

The optional handoff is off unless the launch adds
`--ez mosaic.observations.enabled true`, and it does something only when the
example runs against Google Play (`--ez mosaic.google.play true`) with a real
purchase. The second status line reports queue depth, how many observations
Mosaic accepted **for validation**, how many were dropped, and the last safe
code. Accepted never means validated: the example has no way to learn whether a
transaction was authentic, and it never changes what the paywall shows.

```bash
adb shell am start -n dev.mosaic.example/.MainActivity \
  --es mosaic.sdk.key SDK_KEY \
  --es mosaic.application.id APPLICATION_ID \
  --es mosaic.placement onboarding_complete \
  --ez mosaic.google.play true \
  --ez mosaic.observations.enabled true
```

Emulator note: a Google Play purchase needs a Play-enabled image and a licence
tester account, so the handoff cannot be exercised on a bare AVD. The
device-independent proofs run on the JVM:

```bash
../../sdk/android/gradlew -p ../../sdk/android :mosaic:testDebugUnitTest \
  --tests 'dev.mosaic.sdk.TransactionObservationQueueTest'
../../sdk/android/gradlew -p ../../sdk/android :mosaic-google-play:testDebugUnitTest \
  --tests 'dev.mosaic.sdk.googleplay.MosaicGooglePlayAdapterTest'
```

### Authoritative entitlements

Authoritative entitlements are inert unless a Customer Access Token is supplied.
The example takes one as a launch extra purely to stand in for the application
backend that a real app must run: a public SDK key can never select a Billing
Customer, so there is no client-only way to obtain one. Mint the token through
the trusted server API, then:

```bash
adb shell am start -n dev.mosaic.example/.MainActivity \
  --es mosaic.sdk.key SDK_KEY \
  --es mosaic.sdk.endpoint http://10.0.2.2:8080 \
  --es mosaic.application.id APPLICATION_ID \
  --es mosaic.placement onboarding_complete \
  --es mosaic.customer.token CUSTOMER_ACCESS_TOKEN \
  --es mosaic.customer.id BILLING_CUSTOMER_ID
```

The third status line reports the authoritative state of the `pro` Entitlement,
the accepted snapshot version, and the cache state (`fresh`,
`refresh_recommended`, `stale_within_grace`, `expired`, `missing`, `invalid`, or
`different_customer`). Two of those readings are worth understanding rather than
treating as failures: `unknown` and `unavailable` mean Mosaic could not answer,
never that the customer has no access, and the example deliberately does not
render them as a denial.

The **Restore and sync** button appears only when a token was supplied. It runs
the ordinary provider restore and then waits a bounded three attempts for Mosaic
to validate the result, so "recovered, Mosaic validation pending" is the expected
reading immediately after a fresh-device restore — not an error.

Omitting `mosaic.customer.token` shows the signed-out line and leaves every other
part of the example unchanged, which is what a host that has not adopted Mosaic
Billing sees.

Emulator note: a real restore needs a Play-enabled image, a licence tester
account, and `--ez mosaic.google.play true`; a bare AVD cannot exercise it. The
device-independent proofs run on the JVM:

```bash
../../sdk/android/gradlew -p ../../sdk/android :mosaic:testDebugUnitTest \
  --tests 'dev.mosaic.sdk.Customer*'
```
