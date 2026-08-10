# Mosaic Protocol Versioning

## Approved contract set

Every Mosaic contract is `approved` at v1 GA. The approved set is: Paywall
Protocol `0.3`; Local Preview `0.3` (development-only); Configuration Delivery
`1`/`2`/`3`; Placement Decision `1`; Experiment Assignment `1`; Analytics Event
`1`/`2`; Commerce Provider Contracts `1`/`2`; Commerce Configurations `1`/`2`.
Earlier experimental contracts were retired before approval rather than carried
as compatibility readers.

Seven contract versions exist but are **not** in the approved set. Each is born
`status: "draft"` and carries no compatibility guarantee until an explicit
product-owner decision approves it: Billing Ingestion `1` (see
[Billing Ingestion versioning](#billing-ingestion-versioning)) and the three
Phase 9B contracts — Authoritative Entitlement `1`, Customer Access Token `1`,
and Billing State Webhook `1` (see
[Phase 9B contract versioning](#phase-9b-contract-versioning)).

Phase 9C adds Billing Migration Operations `1`, Authoritative Entitlement `2`,
and Billing State Webhook `2` as exact, parallel drafts. V1 entitlement and
webhook readers never interpret v2 documents.

Paywall Protocol `0.4` is an eighth draft. See
[Paywall Protocol 0.4 versioning](#paywall-protocol-04-versioning).

These are independent versioned contracts. Their exact version values do not
imply compatibility with one another and do not change the Paywall
`schemaVersion`.

`schemaVersion`, Local Preview versions, and capability versions are exact
identifiers. A reader declaring `0.3` accepts only `0.3`; it must not infer
forward or backward support from numeric ordering.

## Artifact lifecycle

Compatibility manifest `status` is one of:

- `draft`: under active design; no compatibility guarantee; may change or
  disappear without a version bump.
- `releaseCandidate`: coherent and implemented, presented for a review gate.
  Narrowing corrections are still permitted (see
  [breaking-change process](breaking-change-process.md)).
- `approved`: product-owner-approved and **immutable**. Behaviour changes
  require a new contract version. This is the state every contract is in at v1
  GA.
- `deprecated`: still fully readable and still supported, but superseded. New
  work targets the successor. A deprecated manifest carries a `deprecation`
  block stating `deprecatedAt`, `retiresAt`, and — when a successor exists —
  `supersededBy` and `migrationGuide`.
- `retired`: no longer produced by Mosaic and no longer required of readers. The
  schemas, fixtures, and documentation **remain in the repository permanently**,
  so a historical document can always be interpreted. Retirement removes an
  obligation; it never deletes a definition.

Transitions are forward-only: `draft → releaseCandidate → approved →
deprecated → retired`. A contract never returns to an earlier state. Timing
requirements for the last two transitions are in the
[deprecation policy](deprecation-policy.md).

Paywall Protocol `0.3` is a **release candidate** (`status:
"releaseCandidate"`, `releaseCandidate: "RC1"`), and so is Local Preview `0.3`,
which is version-locked to it. `0.3` replaced approved Paywall Protocol `0.2`
outright rather than succeeding it — `0.2` was deleted, not deprecated, per
ADR-0026. That is a deliberate exception to the forward-only lifecycle above,
available only because Mosaic is pre-release; it is not a precedent for any
contract with external readers.

`0.3` cannot be marked approved until the checklist in the
[release approval process](release-approval-process.md#approval-checklist)
clears, and its outstanding items are listed in
[the contract document](v0.3.md#what-must-pass-before-03-can-be-marked-approved).
The blocking category is cross-platform implementability: the three native
renderers and Studio do not yet implement `tabs`, `timeline`, `award`,
`socialProof`, or tab-selection runtime state.

Because approved contracts are immutable, a correction to an approved contract's
*behaviour* requires a new contract version. Corrections that do not change
behaviour — documentation, a diagnostic message, a comment — update the
canonical schemas, fixtures, generated browser contract, Studio, and all three
native renderers together.

## Paywall Protocol 0.4 versioning

Paywall Protocol `0.4` is born `status: "draft"` per the owner decision
recorded in ADR-0027. It carries no compatibility guarantee, nothing produces
or consumes it in production, and it may change without a version bump. Its
manifest deliberately carries no `releaseCandidate` label; a draft has not
reached the state that label describes.

`0.4` is a pure superset of `0.3` apart from two removals `0.3` itself named
for it — the co-derived `style.productCardStates` capability and the
single-constant Feature List marker. It adds a `designSystem.motions` catalog
and three trigger-constrained motion primitives. The migration is mechanical
and documented in [Protocol 0.4](v0.4.md#migration-from-03).

Versions remain exact. A reader declaring `0.4` accepts only `0.4`, and a `0.3`
reader never interprets a `0.4` document. When `0.4` becomes deliverable,
publishing emits a `0.3` representation by projection at publish time — the
established Configuration Delivery pattern — so one authored document serves
both reader generations.

`0.4` introduces the **first enhancement-fallback tier** in any Mosaic
contract. Three capabilities — `motion.appear`, `motion.selection`,
`motion.loop` — carry `fallback: "renderWithoutMotion"`; every other capability
in every contract remains `rejectDocument`, and a validator asserts that
partition. Reader policy splits into `unsupportedRequiredCapability:
rejectDocument` and `unsupportedEnhancementCapability: renderStaticDocument`.
The tier is lossless because every animation's terminal state is
byte-identical to the static rendering. This is a motion-specific exception and
not a precedent: server-side stripping of material a reader cannot understand
remains doctrine-forbidden.

Local Preview is **not** bumped by this slice and remains version-locked to
`0.3`. What a Local Preview `0.4` needs is enumerated in
[Protocol 0.4](v0.4.md#local-preview-is-the-named-next-chunk).

## Capability negotiation

An SDK advertises the exact contract versions and capabilities it supports. The
server selects **the highest representation supported by both the SDK's
advertised set and the release**, then withholds anything the SDK cannot read.
For Configuration Delivery the preference ladder is `3 → 2 → 1`
(`PreferredDeliveryVersion` in
`apps/api/internal/hostedpublishing/capability_request.go`).

Selecting a version is not the same as satisfying it. After version selection
the server still requires exact support for every capability the release
actually needs — Paywall protocol capabilities, Placement Decision features and
bucketing algorithms, Experiment features, bucketing algorithms, and schedule
policies. Any missing capability withholds the release at that version rather
than downgrading it silently or stripping the unsupported material.

When no mutually supported representation exists, the SDK receives nothing new
and retains its last accepted configuration, then its bundled fallback, then
reports configuration unavailable. An outage or a negotiation failure never
degrades into rendering a partially understood release.

This documents behaviour that already exists; Phase 8 did not change it.

## Reader sequence

A reader must:

1. require exact version `0.3`;
2. compare every required capability at exact version `0.3`;
3. validate the complete closed document and semantic references;
4. render only after validation succeeds;
5. retain the last accepted production configuration or use the host's bundled
   fallback according to the production SDK policy; and
6. return `configurationUnavailable` when no valid production document exists.

Local Preview example apps intentionally do not display a bundled paywall while
waiting for Studio. They show connecting, waiting, or connection-failure state
so a demo cannot be mistaken for a synchronized design.

## Local Preview negotiation

Local Preview uses one exact WebSocket subprotocol:

```text
mosaic.local-preview.v0.3
```

The selected connection still does not imply support for every capability, so
Studio checks the client's capability report before sending a draft.

The protocol remains platform-neutral. Framework convenience, native resource
names, billing-provider models, and platform-only view behavior are not reasons
to fork the shared schema.

## Placement Decision and Delivery versioning

Placement Decision readers require exact `placementDecisionVersion: "1"` and
exact support for every declared feature and bucketing algorithm. Unknown or
malformed decision semantics reject the whole candidate Configuration Delivery
release; readers never skip an unsupported Rule.

Configuration Delivery `2` is parallel to immutable Delivery `1`. It adds
atomic Placement Decision `1` Rule Sets and exact Product/Entitlement
references without changing embedded Paywall Protocol `0.3` documents. A
reader never interprets v2 as v1. A server may construct a v1 projection only
from an explicit default Paywall outcome; it never projects `no_paywall` or an
advanced Rule as an unconditional binding.

Configuration Delivery `3` retains the complete v2 snapshot and atomically
adds exact Experiment Assignment `1` definitions. A reader never interprets v3
as v2. A non-Experiment SDK may receive a separately compiled v2 projection
only when it preserves the unchanged normal Placement behavior; Experiment
Variants are never projected as unconditional bindings.

## Experiment and Analytics versioning

Experiment Assignment readers require exact contract, feature, Variant and
group bucketing-algorithm, and trusted-time schedule-policy support. Unknown,
malformed, underdeclared, or overdeclared semantics reject the complete v3
candidate and preserve last accepted state.

Analytics Event `2` is parallel to closed Event `1`. V2 batches and events use
exact discriminator `"2"`; ingestion may accept exact v1 and v2 batches beside
one another but never mixes event schema versions inside one batch. Experiment
attribution in v2 is all-or-none and occurrence-time immutable.

## Commerce Provider versioning

Commerce Provider records require exact
`commerceProviderContractVersion: "1"`. Readers reject unknown versions,
record types, outcomes, and properties. Provider identities are opaque values,
but capability names and normalized state machines are closed.

An additive field, capability, record type, or outcome requires a reviewed
compatibility decision and normally a later Commerce Provider contract version.
Changing the Commerce Provider contract does not authorize a Paywall Protocol
or Configuration Delivery change.

Commerce Provider Contract `2` is a parallel exact reader for native-store
recovery, delayed updates, and local acceptance. V1 remains valid. Records from
different versions are never combined. A client receives v2 only after
declaring exact v2 support.

## Commerce Configuration versioning

Commerce Configuration sidecars require exact
`commerceConfigurationVersion: "1"`. Readers reject unknown versions, fields,
activation sources, and mapping variants.

The sidecar is immutable and associated with one exact Environment,
Application, platform, Configuration Release ID, and Configuration Release
digest. Its own canonical content digest excludes only the digest member
itself. A reader rejects any digest or association mismatch and replaces the
sidecar atomically with its Configuration Delivery release.

Changing activation, mapping, freshness, or association semantics requires a
reviewed compatibility decision and normally a later Commerce Configuration
version. It does not authorize changes to Paywall Protocol `0.3`,
Configuration Delivery `1`, or Commerce Provider Contract `1`.

Commerce Configuration `2` is parallel to v1 and adds native-store activation,
exact native selectors, Product grants, recovery mode, and native observation
context. An unsupported v2 candidate is rejected atomically while retaining
the last accepted release-associated sidecar. If none exists, the SDK uses a
compatible bundled fallback or reports configuration unavailable. It never
interprets v2 as v1 or falls back to another provider.

Commerce Provider v2 operation and update references use the exact accepted
Commerce Configuration v2 content digest as `configurationRevision`. A
different digest is a different immutable revision; readers do not compare
numeric ordering or accept aliases.

## Billing Ingestion versioning

Billing Ingestion records require exact `billingIngestionContractVersion: "1"`.
Readers reject unknown versions, record types, fields, outcomes, resolutions,
quarantine reasons, source authorities, transaction types, and reference kinds
by rejecting the **whole record** — never by stripping the part they cannot
read.

Every enumeration in the contract is closed. Adding a record type, outcome,
quarantine reason, transaction type, source authority, resolution, or reference
kind is therefore a breaking change requiring Billing Ingestion `2`. The v1
vocabularies are deliberately over-provisioned for that reason.

The manifest is born `status: "draft"`, becomes `releaseCandidate` for the
Phase 9A review gate, and reaches `approved` only by an explicit product-owner
decision. While it is a draft or a release candidate, narrowing corrections
remain permitted under the
[breaking-change process](breaking-change-process.md).

Billing Ingestion is optional and independent. No other contract gains a
required reference to it, an SDK that never submits an observation loses no
capability, and changing Billing Ingestion never authorizes a change to Paywall
Protocol `0.3`, Configuration Delivery `1`/`2`/`3`, Placement Decision `1`,
Experiment Assignment `1`, Analytics Event `1`/`2`, Commerce Provider `1`/`2`,
or Commerce Configuration `1`/`2`. Billing-to-analytics correlation uses only
the existing opaque `purchaseAttemptId`, `providerOperationId`, and
`providerUpdateId` handles.

Billing records are server-only in Phase 9A and are deliberately not generated
into the browser contract. Adding browser generation later is additive and does
not require a contract version. See
[Billing Ingestion Contract v1](billing-ingestion-v1.md) and ADR-0022.

## Phase 9B contract versioning

Authoritative Entitlement `1`, Customer Access Token `1`, and Billing State
Webhook `1` are born `status: "draft"` per Phase 9B owner decision OD-15 and are
promoted alongside Billing Ingestion `1` once live-sandbox evidence exists.

Readers require the exact discriminators
`authoritativeEntitlementContractVersion: "1"`,
`customerAccessTokenContractVersion: "1"`, and
`billingStateWebhookContractVersion: "1"`. Every enumeration in all three is
closed and deliberately over-provisioned, so adding a record type, state,
uncertainty reason, explanation code, change reason, source type, scope,
revocation reason, or event type is a breaking change requiring version `2`.

Three rules distinguish these contracts from the rest of the set:

- **A rejection yields `unknown`, never `inactive`.** Authoritative Entitlement
  `1` fails closed to an explicitly uncertain state rather than to a negative
  one, and preserves the reader's cache. See
  [compatibility policy](compatibility-policy.md#unknown-access-is-never-inactive).
- **An unknown `entitlementKey` is accepted.** Keys are Project data rather than
  contract vocabulary. This is the single exception to closed-vocabulary reading
  in Authoritative Entitlement `1`; rejecting an unknown key would make defining
  a new Entitlement a breaking change for every already-shipped SDK.
- **Webhook consumers are documented as tolerant.** Producers stay strict. See
  [compatibility policy](compatibility-policy.md#webhook-consumer-tolerance-is-a-documented-exception).

Contract negotiation for Authoritative Entitlement lives in the **sync request
body** (`supportedAuthoritativeEntitlementContracts`). The Configuration Delivery
capability request is untouched, and no approved contract gains a required
reference to any of these three. None of them `$ref`s Billing Ingestion `1` or
each other: shared shapes are copied so a draft never inherits another draft's
lifecycle.

Like Billing Ingestion, these contracts are server- and SDK-facing and are
deliberately **not** generated into the browser contract. Adding browser
generation later is additive and does not require a contract version.

See [Authoritative Entitlement Contract v1](authoritative-entitlement-v1.md),
[Customer Access Token Contract v1](customer-access-token-v1.md), and
[Billing State Webhook Contract v1](billing-state-webhook-v1.md).

## Related policy documents

- [Compatibility policy](compatibility-policy.md) — consolidating index of the
  approved contract set, negotiation, and reader obligations.
- [Deprecation policy](deprecation-policy.md) — runway requirements for the
  `approved → deprecated → retired` transitions.
- [Breaking-change process](breaking-change-process.md) — what counts as
  breaking, and who approves it.
- [Fixture lifecycle](fixture-lifecycle.md) — adding, freezing, and retiring
  fixtures; rejection-layer metadata.
- [Release approval process](release-approval-process.md) — how a contract
  reaches `approved`.
- [Migration guides](migration/) — per-version upgrade guides.
