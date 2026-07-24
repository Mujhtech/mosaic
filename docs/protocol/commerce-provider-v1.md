# Mosaic Commerce Provider Contract v1

## Status and authority

Commerce Provider Contract `1` is the release-candidate, platform-neutral
contract between Mosaic Core and commerce-provider adapters.

It is independent of:

- Paywall Protocol `0.2`;
- Local Preview `0.2`;
- Configuration Delivery `1`;
- Flutter, SwiftUI, and Jetpack Compose APIs; and
- RevenueCat, StoreKit, Google Play Billing, or custom-provider native types.

Canonical artifacts:

- `protocol/schema/commerce-provider/v1/contract.schema.json`
- `protocol/schema/commerce-provider/v1/compatibility-manifest.schema.json`
- `protocol/compatibility/commerce-provider/v1.json`
- `protocol/fixtures/commerce-provider/v1/`

The exact version discriminator is:

```text
commerceProviderContractVersion = "1"
```

Versions are exact identifiers, not numeric ranges. Unknown versions, record
types, outcomes, and properties reject the complete record.

## Boundary with Paywall and Configuration Delivery

Paywall documents continue storing only stable Mosaic Product IDs. They never
store provider identity, credentials, Product mappings, Package or Offering
metadata, capabilities, diagnostics, prices, trials, offers, or customer
Entitlement state.

Configuration Delivery `1` remains unchanged. Its immutable Product records
continue carrying stable Product identity, type, and fallback display name,
and continue excluding Provider Product Mappings and provider configuration.

The separate Commerce Configuration `1` resource selects one provider and
supplies verified mappings for an Environment, Application, store platform,
and accepted Configuration Release. Commerce Provider Contract `1` defines the
adapter records consumed after that sidecar has been accepted. The sidecar is
defined independently in `docs/protocol/commerce-configuration-v1.md`.

## Record envelope

Every record is a closed envelope:

```json
{
  "commerceProviderContractVersion": "1",
  "recordType": "purchaseRequest",
  "payload": {}
}
```

The closed record kinds are:

- `providerProfile`
- `productLoadRequest`
- `productLoadResult`
- `purchaseRequest`
- `purchaseOutcome`
- `restoreOutcome`
- `activeEntitlementOutcome`
- `providerDiagnostics`

The schema defines data semantics. SDKs expose idiomatic methods and result
types rather than requiring applications to pass JSON records directly.

## Provider identity and capabilities

A Provider identity contains:

- a stable, non-secret Provider ID;
- a safe display name; and
- the Mosaic adapter version.

Provider IDs are opaque. An SDK must not branch on an unverified display name.

Capabilities use a closed name and one of:

- `supported`
- `unsupported`
- `conditional`

`unsupported` and `conditional` require a stable reason code. A missing
capability is not a provider failure and must not be inferred as supported.

The v1 capability catalog is:

- `productLoading`
- `subscriptions`
- `oneTimeNonConsumables`
- `trials`
- `introductoryOffers`
- `promotionalOffers`
- `restore`
- `activeEntitlementLookup`
- `pendingPurchases`
- `deferredPurchases`
- `serverConfirmedTransactions`
- `productSynchronization`
- `providerDiagnostics`

Capabilities describe the selected adapter and accepted runtime scope. They do
not change the Paywall document.

## Mosaic Product and provider binding

A `MosaicProduct` contains:

- `mosaicProductId`: stable Project-scoped Product identity;
- `key`: stable Mosaic Product key;
- `type`: `subscription` or `one_time_non_consumable`; and
- `entitlementKeys`: Mosaic Entitlement definitions granted by the Product.

The explicit `mosaicProductId` name prevents it from being confused with a
provider Product identifier.

A Provider binding is separate and contains:

- stable Mosaic Mapping ID; and
- one opaque, verified provider Product reference.

The reference may be interpreted only by the selected provider adapter. It is
never chosen through display-name, price, period, or string-similarity
matching. Provider-native Product objects remain private adapter handles.

## Product loading and availability

A Product-load request contains one or more Mosaic Product and verified binding
pairs. Mosaic Product IDs and Mapping IDs are unique within the request.

A Product-load result returns one resolved entry per requested Mosaic Product.
Resolved entries preserve the Mosaic Product identity and declare:

- `available`, `unavailable`, or `unknown` availability;
- optional provider-resolved metadata;
- metadata freshness; and
- safe diagnostics.

An available Product requires resolved localized display name and price.
An available subscription also requires a structured billing period.

Availability reasons are closed:

- `mappingMissing`
- `mappingInvalid`
- `productNotFound`
- `temporarilyUnavailable`
- `providerUnavailable`
- `unsupportedProductType`
- `metadataUnavailable`

An unavailable or unknown Product is not removed or silently substituted. The
renderer applies the existing Paywall Product fallback and disables an
unresolvable purchase target safely.

## Resolved Product metadata

Provider-resolved metadata contains:

- localized display name;
- localized price;
- optional locale;
- optional ISO 4217 currency code;
- structured billing period;
- optional trial;
- optional introductory offer.

Periods use a positive value and one of `day`, `week`, `month`, or `year`.

A trial contains a period and optional `eligible`, `ineligible`, or `unknown`
eligibility. An absent eligibility does not claim that the customer qualifies.

An introductory offer contains:

- localized price;
- period;
- number of cycles;
- `payAsYouGo` or `payUpFront` payment mode; and
- optional eligibility.

One-time non-consumables cannot contain a billing period, trial, or
introductory offer.

Promotional offers are represented as a provider capability in v1, not as
normalized Product metadata. Their provider-specific purchase configuration
remains inside the adapter.

## Metadata freshness

Freshness declares:

- source: `liveProvider`, `providerCache`, `mosaicSynchronization`, or
  `simulated`;
- status: `fresh`, `stale`, or `unknown`;
- observation time; and
- optional expiry time.

Expiry cannot precede observation.

Freshness is descriptive, not proof of purchase availability. Runtime SDKs
prefer current live provider metadata. Studio labels synchronized, stale, and
simulated metadata explicitly. A purchase outcome remains authoritative for
that purchase attempt.

## Diagnostics and retryability

Every diagnostic is bounded and contains:

- stable Mosaic code;
- safe message;
- severity;
- retryability;
- correlation ID;
- optional retry-after seconds;
- optional safe provider code;
- optional affected Mosaic Product ID; and
- optional closed recovery action.

Retry-after is valid only when `retryable` is true.

For purchase diagnostics, retryable means the application may offer an
explicit user-initiated retry. It never authorizes automatic purchase retries.

Diagnostics must not contain:

- credentials or API keys;
- authorization headers;
- raw provider requests or responses;
- raw provider errors or messages;
- stack traces;
- receipts or transaction payloads; or
- app-user identifiers.

## Purchase

A purchase request uses only:

- operation ID;
- selected Provider ID; and
- stable Mosaic Product ID.

The adapter purchases the exact private handle obtained from the verified
Product load. The request never accepts an arbitrary provider Product string.

Purchase outcomes are:

- `purchased`
- `pending`
- `deferred`
- `cancelled`
- `alreadyEntitled`
- `productUnavailable`
- `providerUnavailable`
- `failed`

`purchased` and `alreadyEntitled` include the currently active Mosaic
Entitlement keys. Pending, deferred, cancelled, unavailable, and failed
outcomes do not claim active Entitlements. A safe transaction reference may be
included where the provider supplies one.

`pending` and `deferred` are neither success nor failure. An adapter must not
invent `deferred` when its provider does not expose a distinct typed state.
Cancellation is never normalized to failure.

## Restore

Restore outcomes are:

- `restored`
- `nothingToRestore`
- `cancelled`
- `providerUnavailable`
- `failed`

`restored` contains at least one active Mosaic Entitlement key. Other restore
outcomes cannot carry an active-key set. Existing provider-specific
"already entitled" restore behavior normalizes to `restored` when active access
is returned, rather than adding another v1 outcome.

A restore failure is never represented as `nothingToRestore`.

## Active Entitlements

Active Entitlement outcomes are:

- `available`
- `unknown`
- `providerUnavailable`
- `failed`

Only `available` contains `activeEntitlementKeys` and freshness. Its set may be
empty, which means the provider authoritatively reported no active Mosaic
Entitlements at that observation.

`unknown`, `providerUnavailable`, and `failed` cannot contain an active-key
set or freshness. They must never be converted to an available empty set or an
inactive customer state.

The provider remains authoritative for active customer Entitlements through
Phase 4.

## Compatibility and fallback

Readers validate the complete closed record before use:

1. require exact contract version `1`;
2. reject unknown record types, outcomes, and fields;
3. apply JSON Schema validation;
4. apply semantic uniqueness and outcome invariants;
5. expose unsupported capabilities explicitly;
6. apply the existing Paywall Product fallback for unavailable Products; and
7. never infer inactive access from an unsuccessful Entitlement lookup.

The contract contains no executable code and cannot load a remote provider
implementation.

## Fixtures

The fixture set is intentionally small:

- one complete Provider capability profile;
- one three-Product load request;
- one available load result covering trial, introductory offer, and one-time
  non-consumable metadata;
- one unavailable stale Product;
- one purchase request;
- cancelled and pending purchase outcomes;
- one restored outcome; and
- one provider-unavailable Entitlement lookup; and
- one degraded Provider diagnostic result.

These protect the cross-platform contract without recreating provider SDK test
suites.

## Generate and validate

From the repository root:

```bash
npm --prefix protocol ci
npm --prefix protocol run generate
npm --prefix protocol run validate
npm --prefix protocol test
```

Generation refreshes browser-safe TypeScript declarations from the canonical
schema. Validation checks JSON Schema, semantic invariants, manifest coverage,
canonical JSON formatting, fixtures, and generated declaration drift.
