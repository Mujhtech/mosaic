# Commerce Configuration 1 → 2

Both versions are approved and current. v2 is **parallel** to v1, not a
replacement. A reader never interprets v2 as v1.

## Why v2 exists

v1 assumes a Mosaic Product is resolved either through a provider connection
(RevenueCat) or a local SDK snapshot. v2 adds **direct native-store activation**:
resolving Products straight from StoreKit or Google Play with no intermediary
provider, addressed by exact native selectors.

## Schema delta

Discriminator: `commerceConfigurationVersion` `"1"` → `"2"`. The sidecar envelope
and every `configuration` field are otherwise **unchanged** — same 11 required
fields (`id`, `environmentId`, `applicationId`, `storePlatform`,
`configurationRelease`, `contentDigest`, `activeProvider`, `productMappings`,
`entitlementMappings`, `freshness`, `diagnostics`).

The delta is entirely in two closed enumerations.

**Activation sources** (2 → 3):

| Source | v1 | v2 |
| --- | --- | --- |
| `providerConnection` | yes | yes |
| `sdkLocal` | yes | yes |
| `nativeStore` | — | **added** — no provider intermediary; requires no additional identifier |

**Adapter mapping kinds** (2 → 4):

| Kind | v1 | v2 | Required fields |
| --- | --- | --- | --- |
| `directProduct` | yes | yes | `kind` |
| `revenueCatPackage` | yes | yes | `kind`, `offeringIdentifier`, `packageIdentifier` |
| `storeKitProduct` | — | **added** | exact StoreKit selectors |
| `googlePlayProduct` | — | **added** | exact Google Play selectors, including base plan and offer where applicable |

v2 additionally supports Product grants, recovery mode, and native observation
context, consistent with the Commerce Provider Contract v2 capabilities.

## Immutability and association — unchanged

Both versions keep the same guarantees, and they are the load-bearing part of this
contract:

- The sidecar is **immutable** and associated with exactly one Environment,
  Application, store platform, Configuration Release ID, and Configuration Release
  digest.
- Its own `contentDigest` covers all content except the digest field itself.
- A reader **rejects any digest or association mismatch** and replaces the sidecar
  **atomically** with its Configuration Delivery release.

A sidecar is never partially applied and never paired with a different release.

## Reader changes required

1. Declare exact v2 support.
2. Handle the `nativeStore` activation source, including that it carries no
   additional identifier — v1's two sources each required one, so a reader that
   assumes an identifier is always present will fail on `nativeStore`.
3. Handle `storeKitProduct` and `googlePlayProduct` mappings with exact native
   selectors. Selectors are exact; no fuzzy matching, no SKU-similarity
   heuristics. A wrong match is an incorrect Product resolution, which is a
   release-blocker category.
4. Keep digest and association verification unchanged.

## Rejection behaviour

An unsupported v2 candidate is rejected **atomically** while retaining the last
accepted release-associated sidecar. If none exists, the SDK uses a compatible
bundled fallback, or reports configuration unavailable.

It never interprets v2 as v1, and **never falls back to another provider.**
Silently resolving Products through a different provider than the configuration
specifies would charge the customer through the wrong channel.

## Verification

- `protocol/fixtures/commerce-configuration/v2/` — canonical sidecars covering
  each activation source and mapping kind.

## Related documents

- [Commerce Configuration v1](../commerce-configuration-v1.md)
- [Commerce Configuration v2](../commerce-configuration-v2.md)
- [Commerce Provider Contract v1 → v2](commerce-provider-v1-to-v2.md)
