# Mosaic Commerce Configuration v1

## Purpose and authority

Commerce Configuration `1` is the immutable sidecar that binds one accepted
Configuration Delivery release to one commerce-provider mapping snapshot.
It is the only runtime resource that selects a provider and translates stable
Mosaic Product and Entitlement identities into verified provider identifiers.

It is independent of, and does not change:

- Paywall Protocol `0.3`;
- Local Preview `0.3`;
- Configuration Delivery `1`; or
- Commerce Provider Contract `1`.

Canonical artifacts:

- `protocol/schema/commerce-configuration/v1/configuration.schema.json`
- `protocol/schema/commerce-configuration/v1/compatibility-manifest.schema.json`
- `protocol/compatibility/commerce-configuration/v1.json`
- `protocol/fixtures/commerce-configuration/v1/`

The exact version discriminator is:

```text
commerceConfigurationVersion = "1"
```

Unknown versions, fields, and mapping variants reject the complete sidecar.

## Release and application association

Every sidecar binds exactly:

- Environment ID;
- Application ID;
- store platform: `ios` or `android`;
- Configuration Release ID; and
- Configuration Release content digest.

An SDK accepts the sidecar only when all five values match the already accepted
Configuration Delivery release and current Application scope. A mismatch
rejects the sidecar without partially accepting mappings.

The sidecar's Mosaic Product mapping IDs must also equal the complete Product
reference set of the accepted release. Missing and unexpected Product mappings
reject the sidecar; readers do not silently combine mappings from another
snapshot.

The sidecar and Configuration Delivery release are cached and replaced
atomically. A cached sidecar must never be reused with another release,
Environment, Application, or platform.

## Canonical sidecar digest

`configuration.contentDigest` is SHA-256 over the canonical JSON
representation of the complete `configuration` object with only its own
`contentDigest` member omitted.

Canonicalization recursively orders object keys and preserves array order,
using the same deterministic JSON serialization as Configuration Delivery `1`.
The digest therefore covers:

- release and application association;
- selected provider identity, activation, and capabilities;
- all Product and Entitlement mappings;
- freshness;
- safe diagnostics; and
- sidecar identity.

Changing any covered value creates a different immutable sidecar.

## One active provider

`activeProvider` contains one provider identity from Commerce Provider Contract
`1`, its declared capabilities, and one closed activation:

- `providerConnection` with a Project-scoped Provider Connection ID; or
- `sdkLocal` with a host-supplied local snapshot ID.

Capabilities retain the provider contract's `supported`, `unsupported`, and
`conditional` semantics. Capability names are unique. Unsupported and
conditional capabilities require a stable reason code.

The sidecar does not initialize a provider SDK. Host applications continue
owning provider SDK initialization and customer identity.

## Product mappings

Each Product mapping contains exactly:

- stable Mosaic Product ID;
- stable Mosaic Mapping ID;
- one opaque provider Product reference; and
- one adapter mapping detail.

Mosaic Product IDs and Mapping IDs are unique within the snapshot. A provider
target, including its adapter mapping detail, cannot appear ambiguously more
than once.

Adapter mapping detail is deliberately narrow:

- `directProduct` purchases the verified provider Product directly; or
- `revenueCatPackage` adds an opaque RevenueCat Offering identifier and
  Package identifier while retaining the verified underlying Product
  reference.

`revenueCatPackage` is valid only for the `revenuecat` provider identity.
Packages and Offerings remain adapter detail. They do not enter Paywall
documents, Mosaic's primary Product model, or Commerce Provider Contract `1`.

No runtime performs matching by display name, localized price, period, or
string similarity.

## Entitlement mappings

Each Entitlement mapping binds one stable Mosaic Entitlement key to one opaque
provider Entitlement identifier. Both sides are unique in the snapshot.

Customer Entitlement state is not included. The selected runtime provider
remains authoritative through Commerce Provider Contract `1` active
Entitlement outcomes.

## SDK-local custom-provider snapshots

An SDK-only custom provider may supply the same complete mapping snapshot
without a backend Provider Connection. It uses:

- `activation.source: "sdkLocal"`;
- a stable host-owned local snapshot ID;
- the same capability declarations;
- the same Product and Entitlement mapping structure;
- `freshness.source: "sdkLocalSnapshot"`; and
- the same canonical digest and release-association validation.

Local origin does not weaken verification or permit an incomplete, ambiguous,
or release-mismatched snapshot.

## Freshness and diagnostics

Freshness records:

- provider observation time;
- synchronization or local verification time;
- the time at which the snapshot becomes stale;
- optional expiry time;
- `fresh` or `stale` status; and
- `providerSynchronization` or `sdkLocalSnapshot` source.

Times are monotonic: observation cannot follow synchronization,
synchronization cannot follow staleness, and expiry cannot precede staleness.
The freshness source must agree with the activation source.

Diagnostics reuse the bounded, safe Commerce Provider Contract `1` diagnostic
shape. Retry-after is allowed only for retryable diagnostics.

## Security exclusions

The closed sidecar contains no:

- server secret or Authorization material;
- RevenueCat or other public SDK key;
- receipt, transaction, or raw provider payload;
- customer or app-user identity;
- provider-native object;
- raw provider error or stack trace; or
- executable code.

Secrets remain in the backend Provider Connection boundary. Public SDK keys
and provider customer identity remain in host application configuration.

## Fixtures and validation

The minimum fixture set contains:

- one server-connected RevenueCat snapshot demonstrating direct Product and
  Package/Offering mapping detail; and
- one SDK-local custom-provider snapshot demonstrating equivalent local
  verification.

Validation covers exact and closed schema decoding, canonical digest,
release-scope matching, unique capabilities and mappings, adapter
discrimination, activation/freshness agreement, safe diagnostics, manifest
coverage, canonical JSON formatting, and generated browser declaration drift.

From the repository root:

```bash
npm --prefix protocol run generate
npm --prefix protocol run validate
npm --prefix protocol test
```
