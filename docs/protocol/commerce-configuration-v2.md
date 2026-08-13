# Mosaic Commerce Configuration v2

## Purpose and compatibility

Commerce Configuration `2` is the immutable release-associated sidecar for
native-store providers and their adapters. It is the only Commerce
Configuration version.

The exact discriminator is:

```text
commerceConfigurationVersion = "2"
```

Release association, canonical digest, atomic cache association,
closed-reader, credential exclusion, and ambiguity rejection rules all apply.
The sidecar does not modify Paywall Protocol or Configuration Delivery.

## Activation and recovery

V2 retains `providerConnection` and `sdkLocal` and adds:

```json
{
  "source": "nativeStore"
}
```

`nativeStore` contains no connection or credential identifier. It is valid
only for:

- `app_store` with an iOS Application and
  `storeSynchronization`; or
- `google_play` with an Android Application and
  `activePurchaseRecovery`.

Provider replacement is explicit. Runtime resolution never falls back to
another configured provider.

## Product mappings and grants

Every v2 Product mapping contains:

- stable Mosaic Product and Mapping IDs;
- Product type;
- immutable Mosaic `entitlementKeys`;
- one opaque provider Product reference; and
- one closed adapter mapping detail.

`entitlementKeys` is non-empty. A Product that grants no Entitlement cannot be
published in a native v2 sidecar.

The mapping variants are:

- `directProduct`;
- `revenueCatPackage`;
- `storeKitProduct`; and
- `googlePlayProduct`.

`storeKitProduct` uses the provider Product reference as the exact StoreKit
Product ID and forbids Google selector fields.

`googlePlayProduct` uses the provider Product reference as the exact Google
Product ID. A subscription requires `basePlanId` and may contain one explicit
`offerId`. Absence of `offerId` explicitly selects the regular base plan.
One-time non-consumables forbid both fields.

Within one native sidecar, a provider Product identifier may occur only once,
even when adapter mapping detail differs. A StoreKit Product ID or Google
Product ID cannot map to multiple Mosaic Products. This prevents transaction
misattribution and duplicate-key installation failures. In particular, Google
client purchase recovery exposes an owned Product ID but not an authoritative
base-plan identity, so distinct base plans under one Google Product cannot be
used to distinguish Mosaic Products in this client-only release. That broader
mapping shape requires a future approved contract with an authoritative
recovery mechanism.

The Google adapter resolves the current offer token from the current private
`ProductDetails` handle. The sidecar cannot contain `offerToken`; unknown
fields reject it. Missing, ineligible, or ambiguous base-plan/offer selection
fails without falling back to another offer or the base plan.

Native active access resolves as:

```text
verified Store Product or owned purchase
→ exact Product mapping
→ Mosaic Product
→ immutable entitlementKeys
```

`entitlementMappings` may therefore be empty for native stores. They remain
available for providers that expose genuine provider Entitlement identifiers.

## Native freshness and observation

Provider-connected and SDK-local freshness shapes are representable.
Native activation uses `nativeStoreConfiguration`:

- `configured` records structural configuration only;
- `fresh` or `stale` requires a bounded observation;
- observation environment is `test`, `production`, or `unknown`; and
- observation and optional expiry timestamps are explicit.

Configured is never presented as provider-observed or verified-in-test.
Observation context contains no receipt, purchase token, transaction,
customer identity, raw provider response, or credential.

## Negotiation and fallback

Clients advertise exact supported Commerce Configuration versions. The server
serves the sidecar only to a client that declares `2`. An unsupported,
malformed, mismatched, ambiguous, or digest-invalid sidecar is rejected
atomically.

Rejection preserves the last accepted sidecar associated with its exact
Configuration Release. If none exists, the SDK uses a compatible bundled
fallback; otherwise it reports configuration unavailable. Readers never
partially reinterpret a sidecar or combine mappings from different versions.

Commerce Provider v2 `configurationRevision` is exactly this sidecar's
`configuration.contentDigest`, including the `sha256:` prefix. Update routing
compares the full digest and rejects stale or mismatched revisions.

## Validation

```bash
npm --prefix protocol run generate
npm --prefix protocol run validate
npm --prefix protocol test
```
