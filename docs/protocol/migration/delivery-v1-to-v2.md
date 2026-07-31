# Configuration Delivery 1 → 2

Both versions are approved and current. v2 does not supersede v1: v1 remains a
valid negotiated representation and is still delivered to readers that declare
only v1 support. Migrate when the reader needs targeting.

## Why v2 exists

v1 binds a Placement key directly to a Paywall Version — one Placement, one
Paywall, unconditionally. v2 replaces that binding with a **Placement Decision
`1` Rule Set**, so which Paywall a Placement resolves to can depend on evaluated
conditions, and can resolve to no Paywall at all.

## Schema delta

Discriminator: `configurationDeliveryVersion` `"1"` → `"2"`. A reader never
interprets one as the other.

`release` object:

| Field | v1 | v2 |
| --- | --- | --- |
| `id`, `number`, `environment`, `publishedAt`, `contentDigest`, `compatibility` | required | required |
| `projectId` | — | **added, required** |
| `placements` | required — direct Placement→Paywall bindings | **removed** |
| `placementDecisions` | — | **added, required** — Placement Decision `1` Rule Sets |
| `paywallVersions` | required | required, unchanged |
| `productReferences` | required | required |
| `entitlementReferences` | — | **added, required** |
| `assetReferences` | required | required |

Embedded Paywall Protocol `0.2` documents are **byte-identical in shape**. v2
changes how a Paywall is selected, not what a Paywall is.

`compatibility` gains Placement Decision declarations: contract version, required
decision features, and bucketing algorithms.

## Capability request delta

Three fields added and **required**:

- `supportedPlacementDecisionContracts`
- `supportedDecisionFeatures`
- `supportedBucketingAlgorithms`

An SDK requesting v2 without declaring exact support for every decision feature
and bucketing algorithm the release uses is withheld v2 and negotiated down to
v1.

## Reader changes required

1. Declare `"2"` in `supportedConfigurationDeliveryVersions` and populate the
   three new capability arrays with **exact** values you implement. Declaring a
   feature you do not implement is worse than omitting it: the release will be
   delivered and mis-evaluated.
2. Read `placementDecisions` instead of `placements`, and evaluate the Rule Set
   locally. Evaluation is three-state; conditions that cannot be evaluated are
   *unknown*, not false.
3. Handle the `no_paywall` outcome. A Placement legitimately resolving to no
   Paywall is new in v2 — v1 could not express it. This is not an error state and
   must not fall back to presenting some other Paywall.
4. Handle `entitlementReferences`.
5. Reject the whole candidate on any unsupported or malformed decision semantics.
   Never skip an unsupported Rule and evaluate the rest — a skipped Rule silently
   changes targeting.

## Server-side projection

A server may build a v1 projection from a v2 release **only** from an explicit
default Paywall outcome. It never projects `no_paywall` or a conditional Rule as
an unconditional v1 binding. A v1 reader must receive either correct
unconditional behaviour or nothing.

## Verification

- `protocol/fixtures/configuration-delivery/v2/` — valid releases and capability
  requests.
- `protocol/fixtures/configuration-delivery/v2/invalid/` — 13 atomic rejection
  cases with
  [rejection-layer metadata](../fixture-lifecycle.md#rejection-layer-metadata).
  Ten are semantic-layer rejections, so a reader validating only against the
  schema will wrongly accept them.
- `protocol/fixtures/placement-decision/v1/evaluator-conformance.json` — the
  shared evaluator conformance vector. Any reader implementing Rule evaluation
  must reproduce it exactly.

## Related documents

- [Configuration Delivery v1](../configuration-delivery-v1.md)
- [Configuration Delivery v2](../configuration-delivery-v2.md)
- [Placement Decision v1](../placement-decision-v1.md)
- [Compatibility policy](../compatibility-policy.md)
