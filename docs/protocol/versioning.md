# Mosaic Protocol Versioning

## One version per contract

**Mosaic is pre-GA, and every contract carries exactly one version: the latest.**
A contract change *replaces* its version rather than adding one beside it, and
the replaced version is deleted outright — schemas, fixtures, compatibility
manifest, validation tools, contract document, migration guide, and every
reference, version-dispatch arm, projection, and version fallback that named it.
Parallel versions begin at GA. The policy, its rationale, and the condition that
ends it are in
[ADR-0028](../architecture/decisions/0028-single-version-contracts.md).

The complete contract set is therefore one row per contract:

| Contract | Version | Status |
| --- | --- | --- |
| Paywall Protocol | `0.4` | draft |
| Local Preview (development-only) | `0.4` | draft |
| Configuration Delivery | `3` | draft |
| Placement Decision | `1` | approved |
| Experiment Assignment | `1` | approved |
| Analytics Event | `2` | approved |
| Commerce Provider Contract | `2` | approved |
| Commerce Configuration | `2` | approved |
| Billing Ingestion | `1` | draft |
| Customer Access Token | `1` | draft |
| Authoritative Entitlement | `2` | draft |
| Billing State Webhook | `2` | draft |
| Billing Migration Operations | `1` | draft |

These are independent versioned contracts. Their version values do not imply
compatibility with one another and do not change the Paywall `schemaVersion`.

`schemaVersion`, Local Preview versions, and capability versions remain **exact
identifiers**. A reader declaring `0.4` accepts only `0.4`; it must not infer
forward or backward support from numeric ordering. That rule is unaffected by
the single-version policy and outlives it — it is what will keep parallel
versions apart once GA creates them.

Pre-GA, lifecycle statuses are **provisional**. A contract's `status` cannot be
stronger than that of a contract it structurally depends on, and with one
version per contract those dependencies are structural rather than negotiated.
Configuration Delivery `3` is `draft` because it embeds Paywall Protocol `0.4`,
which is a draft. Statuses harden at GA, after which a status only moves forward.

Version suffixes on artifact names are **not** debt either. A module holding
rules the contract carries at every version is unsuffixed
(`paywall-document-rules.mjs`, `locale-resolution.mjs`); a module or type that
defines one specific version keeps it (`validation-v0.4.mjs`,
`delivery-validation-v3.mjs`, `MosaicPaywallV04Document`). See
[ADR-0028](../architecture/decisions/0028-single-version-contracts.md).

Two mechanisms are **not** version debt and are unaffected:

- **Capability negotiation**, which is how one contract version serves readers
  of differing ability. See [Capability negotiation](#capability-negotiation).
- **The `renderWithoutMotion` enhancement tier**, which is a property of motion
  rather than of versioning. See
  [Paywall Protocol 0.4 versioning](#paywall-protocol-04-versioning).

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

Paywall Protocol `0.4` and Local Preview `0.4` are **drafts** (`status:
"draft"`, no `releaseCandidate` label). They cannot be marked approved until the
checklist in the
[release approval process](release-approval-process.md#approval-checklist)
clears.

`0.4` replaced approved Paywall Protocol `0.3` outright — `0.3` was deleted, not
deprecated, per ADR-0026 and then ADR-0028. That is a deliberate exception to
the forward-only lifecycle above, available only because Mosaic is pre-release;
it is not a precedent for any contract with external readers.

Because approved contracts are immutable, a correction to an approved contract's
*behaviour* requires replacing its version. Corrections that do not change
behaviour — documentation, a diagnostic message, a comment — update the
canonical schemas, fixtures, generated browser contract, Studio, and all three
native renderers together.

## Paywall Protocol 0.4 versioning

Paywall Protocol `0.4` is born `status: "draft"` per the owner decision recorded
in ADR-0027. It carries no compatibility guarantee and may change without a
version bump. Its manifest deliberately carries no `releaseCandidate` label; a
draft has not reached the state that label describes.

`0.4` is everything `0.3` carried, minus the two removals `0.3` itself named for
it — the co-derived `style.productCardStates` capability and the single-constant
Feature List marker — plus a `designSystem.motions` catalog and three
trigger-constrained motion primitives.

There is no projection to an earlier representation and no projectability rule:
both existed to let one authored document serve two reader generations, and
there is one reader generation. The wider Feature List marker vocabulary is
therefore unrestricted at authoring time.

`0.4` introduces the **first enhancement-fallback tier** in any Mosaic contract.
Three capabilities — `motion.appear`, `motion.selection`, `motion.loop` — carry
`fallback: "renderWithoutMotion"`; every other capability in every contract
remains `rejectDocument`, and a validator asserts that partition. Reader policy
splits into `unsupportedRequiredCapability: rejectDocument` and
`unsupportedEnhancementCapability: renderStaticDocument`. The tier is lossless
because every animation's terminal state is byte-identical to the static
rendering. This is a motion-specific exception and not a precedent:
server-side stripping of material a reader cannot understand remains
doctrine-forbidden.

## Local Preview 0.4 versioning

Local Preview `0.4` is a draft, born alongside the paywall contract it
accompanies. Local Preview is version-locked to the paywall contract — its
message schema `$ref`s the paywall schema URN directly — so a paywall
replacement is a Local Preview replacement. Local Preview `0.3` was deleted with
Paywall `0.3`.

`0.4` adds exactly one behavioural rule over what `0.3` specified: an accepted
revision does not replay appear motion for a screen already listed in the
runtime state's new `motion.playedAppearScreens` member. It is the only runtime
member an acceptance carries forward rather than resets, because it is the only
one the document does not author. See
[Local Preview 0.4](local-preview-v0.4.md#the-entrance-replay-suppression-rule).

## Canonical JSON, and the canonical number form

Several contracts commit to bytes rather than to a parsed value: Configuration
Delivery `3` and Commerce Configuration `2` cover their material with a
`contentDigest`, Authoritative Entitlement `2` digests its snapshot body, and
Billing State Webhook `2` signs the raw delivered body. Every one of those is a
byte comparison, so two implementations that serialize the same value
differently do not merely disagree cosmetically — one of them rejects a
genuine document.

**Normative.** The canonical number form is the shortest round-tripping decimal
form specified by ECMAScript `Number::toString` — exactly what ECMAScript
`JSON.stringify` emits. **Go's `encoding/json` and JavaScript's `JSON.stringify`
are the reference implementations**, and they agree byte-for-byte at every
boundary below. A third implementation conforms by matching them, not by
matching its own language's default float formatter.

The rule that catches implementations out is *when exponent notation appears*.
It is not a matter of magnitude alone, and the thresholds are asymmetric:

| Value | Canonical form | Note |
| --- | --- | --- |
| `1e-7` | `1e-7` | exponent form begins below `1e-6` |
| `1e-6` | `0.000001` | still fixed-point |
| `1e16` | `10000000000000000` | fixed-point, **not** `1e+16` |
| `1e20` | `100000000000000000000` | still fixed-point |
| `1e21` | `1e+21` | exponent form begins at `1e21` |
| `-1e-7` | `-1e-7` | the sign is outside the form |
| `1.5e300` | `1.5e+300` | note the `+` in a positive exponent |
| `1e-323` | `1e-323` | subnormals carry no `+` |

So: exponent notation below `1e-6` and at or above `1e21`, fixed-point
everywhere between, a `+` on a positive exponent and none on a negative one, and
no leading zeros in the exponent. `1e16` is the case an implementation is most
likely to get wrong, because several languages switch to scientific notation
well before it — a 2026-08 review found a Swift implementation diverging on
exactly that boundary, outside the range any fixture exercised.

Mosaic contracts carry plenty of non-integer numbers today — opacities, motion
amplitudes, line-height multipliers, rating values — and they sit inside digest
coverage; a 2026-08 iOS fix records `0.04` rendered as
`0.040000000000000001` breaking a release's own content digest on Apple
platforms. What every one of those values shares is that it falls inside the
fixed-point range, which is why the *exponent boundaries* above went
unexercised until reviewed. That is a property of the current contracts rather
than a guarantee, and it is exactly why the full rule — including the
boundaries — is written down before a contract crosses one.

The rest of canonical JSON is unchanged and is stated per contract: no
insignificant whitespace, object members ordered ascending by UTF-16 code unit
at every depth, array order preserved exactly, absent members omitted rather
than emitted as `null`, minimal string escaping with non-ASCII left unescaped,
and the excluded digest member removed before serializing.

## Capability negotiation

An SDK advertises the exact contract versions and capabilities it supports. The
server serves the release only to an SDK that advertises the contract version it
carries, and withholds anything the SDK cannot read. Each contract offers one
version, so version selection has one candidate rather than a ladder; it is
still a check, and an SDK advertising only a deleted version is served nothing.

**Capability negotiation is where the real work happens, and the single-version
policy does not touch it.** Selecting a version is not the same as satisfying
it. After version selection the server still requires exact support for every capability the release
actually needs — Paywall protocol capabilities, Placement Decision features and
bucketing algorithms, Experiment features, bucketing algorithms, and schedule
policies. Any missing capability withholds the release at that version rather
than downgrading it silently or stripping the unsupported material.

When no mutually supported representation exists, the SDK receives nothing new
and retains its last accepted configuration, then its bundled fallback, then
reports configuration unavailable. An outage or a negotiation failure never
degrades into rendering a partially understood release.

## Reader sequence

A reader must:

1. require exact version `0.4`;
2. compare every required capability at exact version `0.4`;
3. validate the complete closed document and semantic references;
4. render only after validation succeeds;
5. retain the last accepted production configuration or use the host's bundled
   fallback according to the production SDK policy; and
6. return `configurationUnavailable` when no valid production document exists.

Local Preview example apps intentionally do not display a bundled paywall while
waiting for Studio. They show connecting, waiting, or connection-failure state
so a demo cannot be mistaken for a synchronized design.

## Local Preview negotiation

Local Preview offers exactly one exact WebSocket subprotocol:

```text
mosaic.local-preview.v0.4
```

A peer that speaks anything else is refused with `preview.noMutualVersion` and
Studio keeps its last accepted draft. It is never served a version it did not
offer, and there is no translation: the selected subprotocol fixes the paywall
generation for the connection.

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

Configuration Delivery `3` is the only delivery contract. It carries atomic
Placement Decision `1` Rule Sets, exact Product and Entitlement references,
exact Experiment Assignment `1` definitions, and embedded **Paywall Protocol
`0.4`** documents: `paywallVersion.protocolVersion` and
`protocolCompatibility.version` are `const "0.4"`, the embedded document `$ref`s
`urn:mosaic:protocol:schema:v0.4:paywall`, and the capability request negotiates
`0.4` on both sides. This re-pin is what makes a `0.4` document deliverable.

There are no projections. The v2→v1 and v3→v2 projection machinery was deleted
with the versions it targeted. A release is accepted whole or rejected whole;
nothing is ever compiled down to a narrower representation.

## Experiment and Analytics versioning

Experiment Assignment readers require exact contract, feature, Variant and
group bucketing-algorithm, and trusted-time schedule-policy support. Unknown,
malformed, underdeclared, or overdeclared semantics reject the complete v3
candidate and preserve last accepted state.

Analytics Event `2` is the only event contract. Batches and events use exact
discriminator `"2"`; ingestion accepts no other. Experiment attribution is
all-or-none and occurrence-time immutable.

## Commerce Provider versioning

Commerce Provider records require exact
`commerceProviderContractVersion: "2"`. Readers reject unknown versions,
record types, outcomes, and properties. Provider identities are opaque values,
but capability names and normalized state machines are closed. `2` carries
native-store recovery, delayed updates, and local acceptance.

An additive field, capability, record type, or outcome requires a reviewed
compatibility decision and, pre-GA, replaces the Commerce Provider contract
version. Changing the Commerce Provider contract does not authorize a Paywall
Protocol or Configuration Delivery change.

## Commerce Configuration versioning

Commerce Configuration sidecars require exact
`commerceConfigurationVersion: "2"`. Readers reject unknown versions, fields,
activation sources, and mapping variants. `2` carries native-store activation,
exact native selectors, Product grants, recovery mode, and native observation
context.

The sidecar is immutable and associated with one exact Environment,
Application, platform, Configuration Release ID, and Configuration Release
digest. Its own canonical content digest excludes only the digest member
itself. A reader rejects any digest or association mismatch and replaces the
sidecar atomically with its Configuration Delivery release.

Changing activation, mapping, freshness, or association semantics requires a
reviewed compatibility decision and, pre-GA, replaces the Commerce Configuration
version. It does not authorize changes to Paywall Protocol `0.4`,
Configuration Delivery `3`, or the Commerce Provider Contract.

An unsupported candidate is rejected atomically while retaining the last
accepted release-associated sidecar. If none exists, the SDK uses a compatible
bundled fallback or reports configuration unavailable. It never falls back to
another provider.

Commerce Provider operation and update references use the exact accepted
Commerce Configuration content digest as `configurationRevision`. A
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
Protocol `0.4`, Configuration Delivery `3`, Placement Decision `1`,
Experiment Assignment `1`, Analytics Event `2`, Commerce Provider `2`,
or Commerce Configuration `2`. Billing-to-analytics correlation uses only
the existing opaque `purchaseAttemptId`, `providerOperationId`, and
`providerUpdateId` handles.

Billing records are server-only in Phase 9A and are deliberately not generated
into the browser contract. Adding browser generation later is additive and does
not require a contract version. See
[Billing Ingestion Contract v1](billing-ingestion-v1.md) and ADR-0022.

## Entitlement, token, and webhook versioning

Authoritative Entitlement `2`, Customer Access Token `1`, and Billing State
Webhook `2` are `status: "draft"` per Phase 9B owner decision OD-15 and are
promoted alongside Billing Ingestion `1` once live-sandbox evidence exists.

Readers require the exact discriminators
`authoritativeEntitlementContractVersion: "2"`,
`customerAccessTokenContractVersion: "1"`, and
`billingStateWebhookContractVersion: "2"`. Every enumeration in all three is
closed and deliberately over-provisioned, so adding a record type, state,
uncertainty reason, explanation code, change reason, source type, scope,
revocation reason, or event type is a breaking change that, pre-GA, replaces the
contract version.

Three rules distinguish these contracts from the rest of the set:

- **A rejection yields `unknown`, never `inactive`.** Authoritative Entitlement
  fails closed to an explicitly uncertain state rather than to a negative
  one, and preserves the reader's cache. See
  [compatibility policy](compatibility-policy.md#unknown-access-is-never-inactive).
- **An unknown `entitlementKey` is accepted.** Keys are Project data rather than
  contract vocabulary. This is the single exception to closed-vocabulary reading
  in Authoritative Entitlement; rejecting an unknown key would make defining
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

See [Authoritative Entitlement Contract v2](authoritative-entitlement-v2.md),
[Customer Access Token Contract v1](customer-access-token-v1.md), and
[Billing State Webhook Contract v2](billing-state-webhook-v2.md).

## Related policy documents

- [ADR-0028](../architecture/decisions/0028-single-version-contracts.md) — the
  single-version policy and the condition that ends it.
- [Compatibility policy](compatibility-policy.md) — consolidating index of the
  contract set, negotiation, and reader obligations.
- [Deprecation policy](deprecation-policy.md) — runway requirements for the
  `approved → deprecated → retired` transitions.
- [Breaking-change process](breaking-change-process.md) — what counts as
  breaking, and who approves it.
- [Fixture lifecycle](fixture-lifecycle.md) — adding, freezing, and retiring
  fixtures; rejection-layer metadata.
- [Release approval process](release-approval-process.md) — how a contract
  reaches `approved`.
