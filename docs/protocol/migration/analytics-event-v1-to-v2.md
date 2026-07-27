# Analytics Event 1 → 2

Both versions are approved and current. Ingestion accepts v1 and v2 as separate
exact batch versions. v2 is a **superset**: all 27 v1 events carry over
unchanged, with identical names, payloads, correlation, and attribution.

## Why v2 exists

v2 adds immutable Experiment attribution. It exists so a monetization outcome can
be attributed to the exact Experiment, Experiment Version, Variant, and allocation
version in effect **when the event occurred** — never re-derived later from current
configuration, timestamps, aliases, prices, or SKU similarity.

## Schema delta

Discriminator: `analyticsEventContractVersion` `"1"` → `"2"` on the batch;
`eventSchemaVersion` `"1"` → `"2"` on each event. The two must agree: a v2 batch
carries only v2 events. Versions are never mixed inside one batch.

**Four events added** (v2 only, 27 → 31):

| Event | Meaning |
| --- | --- |
| `experiment_assigned` | Diagnostic assignment only. **Not** a statistical exposure. |
| `experiment_exposed` | The statistical exposure denominator. Requires successful native presentation. |
| `experiment_fallback_presented` | Normal-Placement fallback was presented instead of the assigned Variant. |
| `experiment_assignment_failed` | Safe diagnostics. |

**Attribution gains the Experiment tuple:** `experimentId`,
`experimentVersionId`, `experimentVariantId`, `experimentAllocationVersion`.
All-or-none, enforced by `dependentRequired` in the canonical schema.

Where the tuple is permitted:

| Events | Tuple |
| --- | --- |
| The four `experiment_*` events | **required** |
| `product_selected`, `purchase_started`, `purchase_completed_client`, `purchase_completed_provider`, `purchase_pending`, `purchase_deferred`, `purchase_cancelled`, `purchase_failed` | **permitted** (schema-optional — but see below) |
| All other events | **forbidden** |

`experiment_fallback_presented` must **not** carry `paywallId` or
`paywallVersionId` in attribution. The Paywall actually presented belongs in the
payload as `presentedPaywallId` / `presentedPaywallVersionId`. Attribution
identifies the *assigned* Variant; conflating the two would attribute a fallback
to the Variant that was never shown.

`experiment_exposed` with `payload.qaOverride: true` must not emit statistical
exposure.

No v1 event's payload, correlation, or attribution changed. A v1 event is a valid
v2 event once `eventSchemaVersion` is `"2"`.

## Which events MUST move to v2, and when

**If you do not run Experiments:** none. Emit the full taxonomy on v1
indefinitely. v1 is approved and current.

**If you run Experiments:** the four `experiment_*` events *and* every conversion
event must be on v2. This is not optional, and the schema will not enforce it.

Required on v2 for a presentation attributed to an Experiment Variant:

| Event | Required on v2 with tuple | Why |
| --- | --- | --- |
| `experiment_exposed` | yes | Exposure denominator. Ingestion rejects `experiment_*` on v1 outright. |
| `experiment_assigned`, `experiment_fallback_presented`, `experiment_assignment_failed` | yes | Same. |
| `purchase_completed_client` | **yes** | Numerator of `presentation_client_purchase`. |
| `product_selected` | **yes** | Numerator of `presentation_product_selection` **and denominator of** `product_selection_purchase_start`. |
| `purchase_started` | **yes** | Numerator of `product_selection_purchase_start`. |
| `purchase_completed_provider` and other purchase lifecycle events | yes, where metrics use them | Same mechanism. |

### Why the schema does not enforce this

Conversion attribution is done by **equality on the Experiment columns of the
conversion event itself**, plus the assignment unit derived from identity and the
attribution window. `RunAggregation` in
`apps/api/internal/platform/analyticspostgres/jobs.go` matches a conversion to an
exposure with `c.experiment_version_id = e.experiment_version_id AND
c.experiment_variant_id = e.experiment_variant_id`. There is **no** join through
`placementRequestId` or `paywallPresentationId`, and no assignment or exposure
table to join against.

This is the designed mechanism, so that "correlation never depends on current
configuration or timestamp proximity" (`docs/plans/phase-7-experiments.md`).

The tuple is schema-optional on conversion events because a conversion outside any
Experiment legitimately has no tuple. But the tuple may only appear on a v2 event —
ingestion rejects experiment attribution on a v1 event
(`apps/api/internal/analytics/validation.go`).

**Consequence.** An SDK emitting exposures on v2 and conversions on v1 produces
exposures with NULL Experiment columns on the conversion side. Every
`c.experiment_version_id = e.experiment_version_id` comparison is NULL, so nothing
converts. Every metric reports **zero conversions**. Ingestion accepts every event,
returns success, and reports no error. Experiment results are silently and
completely wrong.

There is no partially-correct mode. Emit the tuple on conversions, or do not run
Experiments.

## Migration steps

1. Keep emitting v1 until the SDK can emit the complete v2 set. A correct v1
   pipeline is strictly better than a half-migrated v2 pipeline.
2. Send `analyticsEventContractVersion: "2"` with `eventSchemaVersion: "2"` on
   every event in that batch. Never mix.
3. Emit the four `experiment_*` events with the complete tuple.
4. **Stamp the complete tuple onto `product_selected` and every purchase
   lifecycle event** for any presentation attributed to an Experiment Variant.
5. Never synthesize a partial tuple. `dependentRequired` rejects it, and a
   rejected event is better than a mis-attributed one.
6. Keep `experiment_exposed` gated on successful native presentation. An exposure
   without a presentation inflates the denominator and biases every result.
7. Verify end to end that a seeded Experiment reports non-zero conversions before
   declaring the migration complete. Zero conversions with non-zero exposures is
   the signature of this defect.

## Export names unchanged

Canonical event names are unprefixed and identical between v1 and v2 for the 27
shared events. Downstream destinations distinguish contract versions by
`eventSchemaVersion`, never by name — renaming per version would break
longitudinal analysis across the upgrade. See
[Analytics export names](../analytics-export-names.md).

## Verification

- `protocol/fixtures/analytics-event/v2/` — the four Experiment events plus
  `product-selection-attributed.json` and `purchase-started-attributed.json`,
  which show the **correct** attributed forms of the conversion events.
- `protocol/fixtures/analytics-event/v2/invalid/` — partial tuple, and
  correlation/attribution allow-list violations. All schema-layer rejections.
- `protocol/fixtures/analytics-event/v2/batches/experiment-journey.json` — a
  complete exposure-to-conversion journey.

## Related documents

- [Analytics Event Contract v1](../analytics-event-v1.md)
- [Analytics Event Contract v2](../analytics-event-v2.md)
- [Compatibility policy](../compatibility-policy.md#experiment-conversion-attribution-requires-v2-emission)
- [Configuration Delivery v2 → v3](delivery-v2-to-v3.md)
