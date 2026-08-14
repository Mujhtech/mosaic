# Mosaic protocol compatibility policy

The authoritative index of what Mosaic promises about its contracts. Every
statement here is enforced by `protocol/compatibility/**` manifests and the
validators in `protocol/tools/`, not only by prose.

## Contract set

**Every contract carries exactly one version.** Mosaic is pre-GA, so a contract
change replaces its version rather than adding one beside it, and the replaced
version is deleted outright along with every reference, dispatch arm,
projection, and version fallback that named it. See
[ADR-0028](../architecture/decisions/0028-single-version-contracts.md) and
[versioning.md](versioning.md#one-version-per-contract). Parallel versions begin
at GA, and the deprecation policy governs from that point.

| Contract | Version | Status | Manifest |
| --- | --- | --- | --- |
| Placement Decision | `1` | approved | `protocol/compatibility/placement-decision/v1.json` |
| Experiment Assignment | `1` | approved | `protocol/compatibility/experiment-assignment/v1.json` |
| Analytics Event | `2` | approved | `protocol/compatibility/analytics-event/v2.json` |
| Commerce Provider Contract | `2` | approved | `protocol/compatibility/commerce-provider/v2.json` |
| Commerce Configuration | `2` | approved | `protocol/compatibility/commerce-configuration/v2.json` |

Every version identifier is independent: Delivery `3` does not imply Paywall
`3`, and a contract's number carries no compatibility meaning relative to any
other contract.

### Draft contracts

Pre-GA, lifecycle statuses are **provisional**: a contract's `status` cannot be
stronger than that of a contract it structurally depends on. Configuration
Delivery `3` is a draft because it embeds Paywall Protocol `0.4`, which is one.
Statuses harden at GA.

| Contract | Version | Status | Manifest |
| --- | --- | --- | --- |
| Paywall Protocol | `0.4` | `draft` | `protocol/compatibility/v0.4.json` |
| Configuration Delivery | `3` | `draft` | `protocol/compatibility/configuration-delivery/v3.json` |
| Local Preview (development-only) | `0.4` | `draft` | `protocol/compatibility/local-preview/v0.4.json` |
| Billing Ingestion | `1` | `draft` | `protocol/compatibility/billing-ingestion/v1.json` |
| Customer Access Token | `1` | `draft` | `protocol/compatibility/customer-access-token/v1.json` |
| Authoritative Entitlement | `2` | `draft` | `protocol/compatibility/authoritative-entitlement/v2.json` |
| Billing State Webhook | `2` | `draft` | `protocol/compatibility/billing-state-webhook/v2.json` |
| Billing Migration Operations | `1` | `draft` | `protocol/compatibility/billing-migration-operations/v1.json` |

A draft contract carries **no compatibility guarantee**: it may change or
disappear without a version bump, and nothing in the approved set depends on it.
Billing Ingestion `1` reaches `approved` only through an explicit product-owner
decision recorded in the Phase 9A review. It is optional, adds no required
reference to any approved contract, and is not generated into the browser
contract. See [Billing Ingestion Contract v1](billing-ingestion-v1.md).

The entitlement, token, and webhook contracts are born `draft` for the same
reason and are promoted alongside Billing Ingestion `1` once live-sandbox
evidence exists. None of them `$ref`s another draft: a draft that referenced
another draft would inherit its lifecycle, so shared shapes such as the
safe-diagnostic object are **copied** into each contract rather than referenced.
See [Authoritative Entitlement Contract v2](authoritative-entitlement-v2.md),
[Customer Access Token Contract v1](customer-access-token-v1.md), and
[Billing State Webhook Contract v2](billing-state-webhook-v2.md).

### Unknown access is never inactive

**Normative, and the strongest reader obligation Mosaic states.** Wherever a
reader of Authoritative Entitlement `1` rejects a document — unknown version,
unknown field, unknown enumeration member, content-digest mismatch, version
regression, expired cache, network failure — the resulting access state is
`unknown` and the previously accepted cache is preserved. It is **never**
`inactive`.

`inactive` is a claim about a person: Mosaic looked, found no qualifying source,
and is confident. It may only be the result of a snapshot Mosaic issued and the
reader fully accepted. A reader that collapses "I could not find out" into "you
do not have it" converts every Mosaic outage into a mass revocation experienced
by paying customers, at exactly the moment Mosaic is least able to observe it.

The one exception to *preserving* the cache is a customer, Project, or
Environment binding mismatch, which **clears** it: continuing to serve the
previous customer's access after an identity change is the leak that rule exists
to prevent. The resulting state is still `unknown`.

This is enforced, not merely documented.
`protocol/tools/authoritative-entitlement-validation-v1.mjs` fails if any reader
policy value in the manifest resolves to `inactive`, and fails if the persisted
snapshot-entry state vocabulary ever gains `unavailable`.

### Webhook consumer tolerance is a documented exception

**Owner-approved (Phase 9B OD-16).** Every other contract in this repository
fails closed on both sides. Billing State Webhook `1` is asymmetric on purpose:

| | Producer (Mosaic) | Consumer (application backend) |
| --- | --- | --- |
| Unknown field | `rejectRecord` | **ignore** |
| Unknown event type | `rejectRecord` | **ignore** |
| Unknown enumeration member | `rejectRecord` | **ignore** |
| Authoritative state | — | **re-read the snapshot** |
| Ordering | — | ignore older `snapshotVersion` |
| Duplicate delivery | — | deduplicate by `eventId` |
| Signature | — | **verify before parsing** |

The justification is that a webhook event is not authoritative — the Customer
Entitlement Snapshot is. A consumer that rejected an event carrying a field it
had not seen would stop reacting to real state changes in order to protect itself
from information it was free to ignore. Ignoring the unknown and re-reading the
snapshot reaches the same fail-safe outcome by the opposite route, which is why
this exception is safe here and would not be safe for a delivery contract that
readers act on directly.

Signature verification is the one place a consumer must not be tolerant, and it
happens before the body is parsed at all.

Both halves are pinned as separate manifest blocks (`producerPolicy` and
`consumerTolerance`) so the exception stays machine-checked and cannot spread by
imitation.

## Exact-match reading

Readers match versions **exactly**. A reader declaring Paywall `0.4` accepts
only `0.4`. Numeric ordering never implies support: a `0.3` document is as
unreadable to a `0.4` reader as a `9.9` document, and a `1` reader must not
accept a `2` document because 2 is "newer".

This rule is independent of the single-version policy and outlives it. Today it
is what makes a document at a deleted version fail closed rather than be read
leniently; after GA it is what keeps parallel versions apart.

Contracts that commit to bytes — every `contentDigest` and the signed webhook
body — additionally require the
[canonical number form](versioning.md#canonical-json-and-the-canonical-number-form).
Two implementations that serialize one value differently do not disagree
cosmetically; one of them rejects a genuine document.

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

### Every Release carries a representation for every approved Delivery version

**Normative.** Negotiation can only select from what the Release actually
stores. Mosaic therefore guarantees that **every** Configuration Release carries
a stored representation for **every** approved Configuration Delivery version —
`1`, `2`, and `3` — whichever contract the publish originated from. A publish
must never remove a version from an Environment's negotiable set, because doing
so turns an already-shipped SDK's exact-match declaration into a permanent `406`.

A v1-only client always receives a *usable* v1 document, not merely a
schema-valid one: its `placements` array is populated. `placements` is v1-only
vocabulary — v2 replaces it with `placementDecisions` — so a v1 view derived
naively from a v2 envelope arrives empty and is worthless to the reader that
asked for it.

On Experiment publish the v1 view is produced by **carry-forward**: the
preceding Release's v1 representation is carried forward with its identity
restamped to the new Release. Publishing an Experiment does not change Placement
bindings, so the preceding view remains exactly correct. Projection from the v2
envelope is used **only** when no predecessor v1 representation exists.

Verified in
[`docs/reviews/phase-8-drill-evidence.md`](../reviews/phase-8-drill-evidence.md)
("A v1-only SDK is served again after an Experiment publishes"), which records
the empty-`placements` projection defect the drill caught before it shipped, and
the re-verification against a Release carrying an active Experiment: advertising
`1` returns `200` with `version=1` and both Placements delivered, while `2` and
`3,2,1` still negotiate to `2` and `3`. See
[Configuration Delivery v3](configuration-delivery-v3.md#every-release-carries-a-representation-for-every-approved-delivery-version).

### Negotiation refusals name the failing term (`406`)

A negotiation refusal returns `406` with code `unsupported_capability`. A bare
refusal is undiagnosable — an integrator has no path from the response to the
header they must send or the SDK they must ship — so every refusal carries
structured `details`.

This is a **REST transport concern, not a protocol contract**. The vocabulary
below carries no contract version and is additive: new `requirement` values may
appear without a protocol version change. The closed `reason` set is the part
clients may branch on.

| Field | Present | Meaning |
| --- | --- | --- |
| `requirement` | always | The negotiation term that failed, in the vocabulary of the request headers and the contracts: `sdkPlatform`, `sdkVersion`, `applicationVersion`, `acceptMediaType`, `paywallProtocolVersion`, `paywallCapability`, `configurationDeliveryVersion`, `placementDecisionContractVersion`, `decisionFeature`, `bucketingAlgorithm`, `experimentAssignmentContractVersion`, `experimentFeature`, `experimentBucketingAlgorithm`, `experimentSchedulePolicy`, `experimentCapabilityHeader`, `commerceConfigurationVersion`. |
| `capability` | when named | The capability, feature, algorithm, or policy identifier. Omitted when the requirement is itself version-shaped. |
| `version` | when applicable | The contract or capability version involved. |
| `reason` | always | One of the closed set below. |
| `detail` | always | A human-readable sentence composed from the other four. For logs and integrator-facing messages; do not parse it. |

The `reason` set is closed. An SDK receiving an unrecognized value must treat it
as unrecoverable and fall back, not retry.

| `reason` | What happened | What the client should do |
| --- | --- | --- |
| `missing` | The Release requires the named term; the SDK did not advertise it. | Advertise it if the SDK genuinely supports it; otherwise upgrade the SDK. Retrying the same request cannot succeed. |
| `unknown` | The SDK advertised a term Mosaic does not define. | Client-side defect — a typo or an invented capability name. Fix the advertised set. Note the `product_load` / `product_loading` hazard below. |
| `unsupported` | The value is defined but this Mosaic installation does not accept it. | Server-side capability gap. Not retryable by the client; escalate to the operator. |
| `duplicate` | The same term was advertised more than once. | Client-side header-construction defect. De-duplicate the advertised set. |
| `malformed` | The advertised value was missing, empty, unparseable, or exceeded the allowed count. | Client-side header-construction defect. Fix the header. |
| `unavailable` | The Release has no representation the SDK can read. | Not a client defect and not fixable by re-advertising. Fall back per the chain below. Given the guarantee above, a `configurationDeliveryVersion` / `unavailable` in production is a server-side bug worth reporting. |

Every reason is terminal for that request: the SDK falls back rather than
retrying. `missing`, `unknown`, `duplicate`, and `malformed` indicate the client
must change what it advertises; `unsupported` and `unavailable` indicate it
cannot.

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
Variant. Omitting the tuple is not a degraded mode; it silently zeroes
Experiment results.

`product_selection_purchase_start` uses `product_selected` as its *denominator*,
so omitting the tuple there empties that metric as well.

Analytics Event `2` is the only event contract, so there is no older
representation on which these events could be emitted without the tuple.

### Conversions on a fallback presentation MUST omit the tuple

**Normative.** When the assigned Variant cannot be presented and normal Placement
behaviour is shown instead — `experiment_fallback_presented` is emitted — the
conversion events produced by that presentation (`product_selected`,
`purchase_started`, `purchase_completed_client`, and the rest of the purchase
lifecycle) **MUST NOT carry the Experiment tuple.**

`experiment_fallback_presented` itself still requires the tuple: it identifies
*which* assignment fell back. The rule applies to the conversion events, whose
outcome is attributable to the normal Paywall, not to the Variant.

Carrying the tuple on those conversions is **not** harmless, despite there being
no `experiment_exposed` row for the presentation. Two of the seeded metrics do
not use `experiment_exposed` as their denominator:

- `product_selection_purchase_start` has denominator `product_selected`. A
  fallback `product_selected` carrying the tuple is picked up by
  `denominator_candidates` and becomes a `unique_exposures` row — a normal-Paywall
  presentation counted as a Variant presentation. Because `first_units` selects
  `DISTINCT ON (… assignment_unit_id) ORDER BY occurred_at`, a fallback occurring
  earlier in the bucket **displaces** the Variant's own `product_selected` as that
  unit's denominator row.
- Within one daily bucket, a unit that was genuinely exposed *and* later fell back
  has the fallback's conversions matched against the real exposure, attributing a
  normal-Paywall outcome to the Variant.

This is the "fallback counted as original exposure" corruption named in the
release-blocker policy. Fallbacks are already measured separately by the
`fallback_exposure` guardrail metric (denominator `experiment_assigned`, numerator
`experiment_fallback_presented`), so tagging them as Variant outcomes double-counts
them.

The rule also follows the contract's existing separation of assigned from
presented identity: `experiment_fallback_presented` is forbidden from carrying
`paywallId` / `paywallVersionId` in attribution, and reports the Paywall actually
shown in `payload.presentedPaywallId`. Attribution names the assigned Variant;
the payload names what was presented.

Mosaic's Experiment analysis is exposure-based, not intent-to-treat —
`experiment_exposed` requires successful native presentation. A per-protocol rule
for conversions is the consistent choice.

**This is not schema-enforceable.** A conversion event carries no field stating
whether its presentation was a fallback, so neither the canonical schema nor the
API can detect the violation. It is an SDK obligation, verified by inspection and
by end-to-end Experiment results.

### Guardrail metrics with diagnostic numerators cannot currently converge

Three seeded guardrail metrics have numerator events that the contract's
attribution allow-lists **forbid** from carrying the Experiment tuple, so their
numerator can never match:

| Metric | Numerator | Tuple permitted on numerator? |
| --- | --- | --- |
| `product_unavailable` | `product_unavailable` | no |
| `provider_unavailable` | `product_unavailable` | no |
| `paywall_render_failure` | `paywall_render_failed` | no |

The aggregation matches a numerator by equality on the event's own
`experiment_version_id` and `experiment_variant_id`. Those columns are always NULL
for these events, so these three guardrails always report zero conversions. The
eight remaining seeded metrics are satisfiable.

This is a contract/backend disagreement, not an SDK defect: no SDK can satisfy
these metrics without violating the allow-lists. Widening the allow-lists is a
behaviour change to an approved contract and therefore requires a new Analytics
Event version (see [breaking-change process](breaking-change-process.md)).

**Owner-accepted as a documented known limitation at v1 GA**, tracked for
Analytics Event `3` post-GA. The affected metrics are guardrails rather than
primary metrics, and they fail closed at zero rather than reporting a wrong
value. Full entry, including the workaround, in
[`docs/known-limitations.md`](../known-limitations.md) under "Protocol".

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
