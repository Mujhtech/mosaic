# Mosaic protocol compatibility policy

The authoritative index of what Mosaic promises about its contracts. Every
statement here is enforced by `protocol/compatibility/**` manifests and the
validators in `protocol/tools/`, not only by prose.

## Approved contract set at v1 GA

| Contract | Approved versions | Manifest |
| --- | --- | --- |
| Paywall Protocol | `0.2` | `protocol/compatibility/v0.2.json` |
| Local Preview (development-only) | `0.2` | `protocol/compatibility/local-preview/v0.2.json` |
| Configuration Delivery | `1`, `2`, `3` | `protocol/compatibility/configuration-delivery/` |
| Placement Decision | `1` | `protocol/compatibility/placement-decision/v1.json` |
| Experiment Assignment | `1` | `protocol/compatibility/experiment-assignment/v1.json` |
| Analytics Event | `1`, `2` | `protocol/compatibility/analytics-event/` |
| Commerce Provider Contract | `1`, `2` | `protocol/compatibility/commerce-provider/` |
| Commerce Configuration | `1`, `2` | `protocol/compatibility/commerce-configuration/` |

All 13 manifests are `status: "approved"`. Every version identifier is
independent: Delivery `3` does not imply Paywall `3`, and a contract's number
carries no compatibility meaning relative to any other contract.

## Exact-match reading

Readers match versions **exactly**. A reader declaring Paywall `0.2` accepts
only `0.2`. Numeric ordering never implies support: a `0.3` document is as
unreadable to a `0.2` reader as a `9.9` document, and a `1` reader must not
accept a `2` document because 2 is "newer".

Unknown versions, unknown fields, unknown enumeration members, and unknown
capabilities all fail closed. A reader never partially applies a document it
does not fully understand, and never strips the parts it cannot read.

## Capability negotiation

An SDK advertises the exact contract versions and capabilities it supports. The
server **selects the highest representation supported by both the SDK's
advertised set and the release**. For Configuration Delivery the preference
ladder is `3 → 2 → 1`, implemented by `PreferredDeliveryVersion` in
`apps/api/internal/hostedpublishing/capability_request.go`.

Version selection is necessary but not sufficient. After selecting a version the
server still requires exact support for every capability the release actually
uses — Paywall protocol capabilities, Placement Decision features and bucketing
algorithms, Experiment features, bucketing algorithms, and schedule policies. A
single missing capability withholds the release rather than downgrading it or
stripping the unsupported material.

When no mutually supported representation exists the SDK receives nothing new
and follows the fallback chain below. Negotiation failure is never silent data
loss: the SDK keeps serving something it fully understands.

## Fallback chain

Every delivery contract declares the same ordered chain in its manifest
`readerPolicy`:

1. **Retain the last accepted release.** A rejected candidate never replaces
   accepted state (`candidateRejected: "keepLastAcceptedRelease"`).
2. **Load the bundled release.** With no accepted release, use the host
   application's bundled fallback (`noAcceptedRelease: "loadBundledRelease"`).
3. **Report configuration unavailable.** With no bundled release either, report
   `configurationUnavailable` (`bundledReleaseRejected:
   "configurationUnavailable"`).

Acceptance is atomic. `partialAcceptance` is `forbidden` in every delivery
contract: a release is accepted whole or rejected whole. New Paywall material is
never combined with stale Placement or Experiment material.

A Mosaic outage therefore never prevents cached or bundled rendering.

## Analytics minimization

Analytics events carry only the correlation and attribution identifiers their own
semantics justify. The allow-lists are **per event name**, encoded in the
canonical schemas (`$defs/{correlation,attribution}Scope*` with
`unevaluatedProperties: false`) and generated from the semantic validators' own
tables by `npm run generate:analytics-minimization`. `npm run validate`
reconciles the two, so the canonical schema and the runtime validator cannot
disagree about validity.

Identifier tuples are atomic, enforced by `dependentRequired`:

- Rule Set identity: `placementRuleSetId` and `placementRuleSetVersion` appear
  together; `winningRuleId` requires both.
- Experiment attribution (v2): `experimentId`, `experimentVersionId`,
  `experimentVariantId`, and `experimentAllocationVersion` are all-or-none.
- Placement rollout: `assignmentKeyType`, `bucketingAlgorithm`, and
  `rolloutBucket` are all-or-none.

A half-populated tuple is rejected rather than stored, because a partial
identifier attributes a monetization outcome to the wrong thing.

## Experiment conversion attribution requires v2 emission

**Normative.** Experiment conversion attribution depends entirely on the
Experiment tuple carried **on the conversion event itself**. There is no
server-side join through correlation identifiers, and no assignment or exposure
table to join against.

`RunAggregation`
(`apps/api/internal/platform/analyticspostgres/jobs.go`) matches a conversion to
an exposure by equality on the event's own `experiment_version_id` and
`experiment_variant_id` columns, plus the assignment unit derived from identity
and the attribution time window. It does **not** use `placementRequestId` or
`paywallPresentationId`. This is the designed mechanism, not an implementation
shortcut — `docs/plans/phase-7-experiments.md` states that these events "carry
the same immutable tuple so correlation never depends on current configuration
or timestamp proximity."

Consequences for SDKs:

- The Experiment tuple is **schema-optional** on `product_selected` and the
  purchase lifecycle events. Both the canonical schema and the API accept those
  events without it.
- But the tuple may only appear on `eventSchemaVersion: "2"` events. Ingestion
  rejects experiment attribution on a v1 event
  (`apps/api/internal/analytics/validation.go`).
- Therefore an SDK that emits `experiment_exposed` on v2 while emitting
  `product_selected` / `purchase_*` on v1 produces exposures with no matching
  conversions. Every metric reports **zero conversions**, with no ingest
  rejection and no diagnostic.

**Requirement.** An SDK that participates in Experiments MUST emit
`product_selected`, `purchase_started`, `purchase_completed_client`,
`purchase_completed_provider`, `purchase_pending`, `purchase_deferred`,
`purchase_cancelled`, and `purchase_failed` on Analytics Event `2` with the
complete Experiment tuple, for any presentation attributed to an Experiment
Variant. Emitting these events on v1 during an active Experiment is not a
degraded mode; it silently zeroes Experiment results.

An SDK that does not participate in Experiments at all may emit the entire
taxonomy on v1. `product_selection_purchase_start` uses `product_selected` as its
*denominator*, so omitting the tuple there empties that metric as well.

See [Analytics Event v1 → v2 migration](migration/analytics-event-v1-to-v2.md)
for the per-event requirement table.

## Near-collision vocabulary: `product_load` vs `product_loading`

Two contracts use similar-looking capability tokens for genuinely different
things. They are **intentionally distinct** and must never be normalized,
aliased, or mapped onto each other.

| Token | Contract | Location | Meaning |
| --- | --- | --- | --- |
| `product_load` | Experiment Assignment `1` | `requiredProviderCapabilities` in `schema/experiment-assignment/v1/assignment.schema.json` | A provider capability an Experiment Variant *requires* before it may be presented |
| `product_loading` | Placement Decision `1` | `provider_capability` condition `capability` in `schema/placement-decision/v1/decision.schema.json` | A provider capability a targeting Rule *tests for* when evaluating a condition |

`productLoading` (camelCase) is a third, separate spelling: it is a Commerce
Provider Contract `capabilityName`.

The near-collision is a known readability hazard. Anyone editing either
enumeration must confirm which contract they are in: writing `product_loading`
into an Experiment Assignment document, or `product_load` into a Placement
Decision Rule, produces an unknown enumeration member and rejects the whole
candidate release. That failure is safe but the diagnostic is easy to
misread as a bug. No SDK change is required; this is a documentation-only
disambiguation.

## Changing a contract

Approved contracts are immutable. See:

- [Breaking-change process](breaking-change-process.md) — what counts as
  breaking, and who approves it.
- [Deprecation policy](deprecation-policy.md) — runway before a version may be
  deprecated or retired.
- [Release approval process](release-approval-process.md) — how a new version
  reaches `approved`.
- [Fixture lifecycle](fixture-lifecycle.md) — fixture obligations for any
  change.
- [Versioning](versioning.md) — per-contract reader rules.
- [Migration guides](migration/) — per-version upgrade guides.
