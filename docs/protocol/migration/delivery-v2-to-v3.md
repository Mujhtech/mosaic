# Configuration Delivery 2 → 3

Both versions are approved and current. v3 adds Experiments; v2 remains a valid
negotiated representation and is still delivered to non-Experiment readers.
Migrate only if the reader will run Experiments.

## Why v3 exists

v3 is **v2 plus Experiment Assignment `1` definitions, delivered atomically**.
Everything a v2 reader understands is present unchanged; the addition is
`experimentAssignments`.

Atomicity is the point. Experiment allocation must be consistent with the exact
Paywall Versions it allocates between, so Experiment material and Placement
material are accepted or rejected together. A reader never combines new
Experiment definitions with an older Placement snapshot, or the reverse.

## Schema delta

Discriminator: `configurationDeliveryVersion` `"2"` → `"3"`. A reader never
interprets v3 as v2.

`release` object: **one field added, required.**

| Field | v2 | v3 |
| --- | --- | --- |
| `id`, `number`, `projectId`, `environment`, `publishedAt`, `contentDigest`, `compatibility`, `placementDecisions`, `paywallVersions`, `productReferences`, `entitlementReferences`, `assetReferences` | required | required, unchanged |
| `experimentAssignments` | — | **added, required** — exact Experiment Assignment `1` definitions |

`compatibility` gains `experimentAssignmentContracts`, each declaring a contract
version, required features, bucketing algorithms, and schedule policies.

`release.contentDigest` covers all v2 material **and** the Experiment material,
excluding only the digest field itself. A v2-era digest computation applied to a
v3 release produces a mismatch and correctly rejects the release.

## Capability request delta

Four fields added and **required**:

- `supportedExperimentAssignmentContracts`
- `supportedExperimentFeatures`
- `supportedExperimentBucketingAlgorithms`
- `supportedExperimentSchedulePolicies`

The server withholds v3 when any required capability is absent, and delivers a
separately stored v2 projection instead.

## Reader changes required

1. Declare `"3"` and all four Experiment capability arrays with exact implemented
   values.
2. Read and evaluate `experimentAssignments`: immutable allocation ranges,
   identity policy, trusted-server-time scheduling, mutual exclusion, and QA
   overrides.
3. Recompute `contentDigest` over the v3 content.
4. Reject the whole candidate on any unsupported contract, feature, algorithm, or
   schedule policy, or malformed allocation, and retain last accepted state.
5. Implement normal-Placement fallback. When an Experiment Variant cannot be
   presented, the reader falls back to normal Placement behaviour and reports it
   as a fallback presentation — **never** as an Experiment exposure.

## Analytics consequence — required, easy to miss

Running Experiments changes your analytics obligations, and the schema will not
tell you.

Experiment conversion attribution depends entirely on the Experiment tuple
carried **on each conversion event**. There is no server-side join through
correlation identifiers. An SDK that emits `experiment_exposed` on Analytics Event
`2` while emitting `product_selected` and the purchase lifecycle on Analytics
Event `1` produces exposures with **zero matching conversions**, with no ingest
rejection and no diagnostic.

Adopting Delivery v3 therefore requires adopting Analytics Event `2` for the
conversion events as well. See
[Analytics Event v1 → v2](analytics-event-v1-to-v2.md) and
[the compatibility policy](../compatibility-policy.md#experiment-conversion-attribution-requires-v2-emission).

## Server-side projection

A non-Experiment or legacy SDK receives a separately stored Delivery v2
projection containing the **exact unchanged** normal Placement snapshot and no
Experiment assignments. Experiment Variants are never projected as unconditional
bindings — that would present a Variant to a reader that cannot report exposure,
corrupting the Experiment.

## Verification

- `protocol/fixtures/configuration-delivery/v3/` — valid v3 release and the v2
  legacy projection.
- `protocol/fixtures/configuration-delivery/v3/invalid/` —
  `malformed-allocation.json` (semantic layer) and
  `unsupported-experiment-contract.json` (schema layer); see
  [rejection-layer metadata](../fixture-lifecycle.md#rejection-layer-metadata).
- `protocol/fixtures/experiment-assignment/v1/` — assignment and group hash
  vectors. A reader's bucketing must reproduce them exactly; divergence
  reallocates users mid-Experiment.

## Related documents

- [Configuration Delivery v2](../configuration-delivery-v2.md)
- [Configuration Delivery v3](../configuration-delivery-v3.md)
- [Experiment Assignment v1](../experiment-assignment-v1.md)
- [Analytics Event v1 → v2](analytics-event-v1-to-v2.md)
