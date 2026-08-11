# Mosaic Commerce Provider Contract v2

## Status and boundary

Commerce Provider Contract `2` is the release-candidate, platform-neutral
contract for native-store adapters. It is parallel to, and does not replace,
Commerce Provider Contract `1`. RevenueCat and existing custom providers may
continue using v1.

The exact discriminator is:

```text
commerceProviderContractVersion = "2"
```

Readers reject unknown versions, record types, outcomes, and fields. The
contract contains no provider-native objects, offer tokens, receipts, purchase
tokens, signatures, customer identifiers, credentials, or executable code.
Paywall Protocol `0.3` and Configuration Delivery `1` remain unchanged.

Canonical artifacts are under:

- `protocol/schema/commerce-provider/v2/`;
- `protocol/compatibility/commerce-provider/v2.json`; and
- `protocol/fixtures/commerce-provider/v2/`.

## Provider profile and recovery

V2 retains the v1 provider identity and capability model and adds:

- `basePlans`;
- `explicitOffers`;
- `storeSynchronization`;
- `activePurchaseRecovery`;
- `asynchronousCommerceUpdates`; and
- `localDeliveryAcceptance`.

Every profile declares one recovery mode:

- `storeSynchronization` for StoreKit;
- `activePurchaseRecovery` for Google Play Billing; or
- `providerDefined` for an adapter whose established recovery behavior is not
  one of the native-store modes.

The matching native recovery capability must be explicitly supported.
StoreKit and Google native adapters report `deferredPurchases` as unsupported.
Ask to Buy and Google pending purchases are `pending`, never invented as
`deferred`.

Native profiles and native Commerce Configurations declare all 19 capability
names exactly once. The frozen support matrix is:

| Capability | StoreKit | Google Play Billing |
| --- | --- | --- |
| `productLoading` | supported | supported |
| `subscriptions` | supported | supported |
| `oneTimeNonConsumables` | supported | supported |
| `trials` | supported | conditional |
| `introductoryOffers` | supported | conditional |
| `promotionalOffers` | conditional | unsupported |
| `restore` | supported | supported |
| `activeEntitlementLookup` | supported | supported |
| `pendingPurchases` | supported | supported |
| `deferredPurchases` | unsupported | unsupported |
| `serverConfirmedTransactions` | unsupported | unsupported |
| `productSynchronization` | unsupported | unsupported |
| `providerDiagnostics` | supported | supported |
| `basePlans` | unsupported | supported |
| `explicitOffers` | unsupported | supported |
| `storeSynchronization` | supported | unsupported |
| `activePurchaseRecovery` | unsupported | supported |
| `asynchronousCommerceUpdates` | supported | supported |
| `localDeliveryAcceptance` | supported | supported |

Conditional and unsupported entries carry stable reason codes. A missing
entry is invalid for a native adapter.

## Operations and updates

V2 retains normalized Product loading, immediate purchase outcomes, restore
outcomes, active Entitlement outcomes, freshness, availability, and bounded
safe diagnostics.

A purchase request additionally identifies the exact accepted Commerce
Configuration by ID and revision. `configurationRevision` is normatively the
accepted Commerce Configuration `configuration.contentDigest` and has the
exact shape `sha256:` followed by 64 lowercase hexadecimal characters.
Provider identifiers, base-plan IDs, offer
IDs, and offer tokens never enter a purchase request.

An asynchronous `commerceUpdate` has a stable update ID, optional original
operation ID, Provider and Mosaic Product identities, the originating
configuration reference, occurrence time, outcome, optional safe transaction
reference, active Mosaic Entitlement keys where permitted, and diagnostics.
Update outcomes are:

- `purchased`;
- `pending`;
- `cancelled`;
- `providerUnavailable`;
- `failed`; and
- `entitlementsChanged`.

Only `purchased` and `entitlementsChanged` carry active Entitlement keys.
`purchased` carries at least one active key.
`entitlementsChanged` may carry an empty set after an authoritative refresh.

## Local acceptance and finalization

`commerceUpdateAcceptance` is the idempotent boundary between provider
observation and native finalization. Its dispositions are:

- `accepted`;
- `alreadyAccepted`;
- `rejectedStaleConfiguration`; and
- `deliveryFailed`.

The four dispositions have these exact meanings:

- `accepted`: this update was accepted idempotently for the first time and
  authorizes native finalization;
- `alreadyAccepted`: the same stable update ID was accepted previously and
  authorizes idempotent finalization or finalization recovery;
- `rejectedStaleConfiguration`: the update belongs to a configuration digest
  that is no longer accepted, does not authorize finalization, and requires an
  error diagnostic; and
- `deliveryFailed`: the local sink did not accept the update, does not
  authorize finalization, requires an error diagnostic, and retains
  restart-safe recovery.

The required order is:

```text
verified or owned native transaction
→ exact configuration, Product mapping, and grant resolution
→ deduplicated commerce update
→ host-visible idempotent local acceptance
→ native finish or acknowledgement
→ completed app-level result
```

Pending transactions carry no grants and are not finalized. Stale
configuration updates are rejected. Duplicate provider callbacks reuse their
stable update identity and may receive `alreadyAccepted`.

## Restore and active Entitlements

Restore results preserve the v1 normalized outcomes. Every v2 result
normatively contains `operationId`, `providerId`, `outcome`, `recoveryMode`,
`completedAt`, and `diagnostics`. `restored` contains at least one active
Mosaic Entitlement key. Partial or failed provider queries never become
`nothingToRestore`.

Active Entitlement outcomes remain `available`, `unknown`,
`providerUnavailable`, or `failed`. Only `available` contains freshness and
the active-key set. An empty set is authoritative only after every query
required by the adapter succeeds.

## Version negotiation and fallback

Gate 4B clients declare exact support for v1 and/or v2. V2 is served only to a
client that declares v2. An unsupported or invalid candidate is rejected
atomically; the client retains its last accepted associated sidecar, then uses
its bundled fallback, then returns configuration unavailable. It never
downgrades the candidate, mixes v1/v2 records, or falls back to another
provider.

## Validation

```bash
npm --prefix protocol run generate
npm --prefix protocol run validate
npm --prefix protocol test
```
