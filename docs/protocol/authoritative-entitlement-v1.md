# Authoritative Entitlement Contract v1

Authoritative Entitlement Contract `1` is Mosaic's closed, platform-neutral
contract for **what access a Billing Customer has, and why**. It is a **draft**:
it is not part of the approved v1 GA set and reaches `approved` only through an
explicit product-owner decision, alongside Billing Ingestion `1`, once
live-sandbox evidence exists.

Billing Ingestion `1` records what a provider confirmed. This contract records
what that means for a person. The two are deliberately separate: a fact is
immutable and provider-shaped, an entitlement is derived and Mosaic-shaped, and
a contract that mixed them would make every projection-rule change a fact
migration.

Canonical artifacts:

- `protocol/schema/authoritative-entitlement/v1/snapshot.schema.json`
- `protocol/schema/authoritative-entitlement/v1/sync-request.schema.json`
- `protocol/schema/authoritative-entitlement/v1/check.schema.json`
- `protocol/schema/authoritative-entitlement/v1/subscription.schema.json`
- `protocol/schema/authoritative-entitlement/v1/restore.schema.json`
- `protocol/schema/authoritative-entitlement/v1/compatibility-manifest.schema.json`
- `protocol/compatibility/authoritative-entitlement/v1.json`
- `protocol/fixtures/authoritative-entitlement/v1/`
- `protocol/authoritative-entitlement/CHANGELOG.md`

No platform type name appears anywhere in the contract. There is no StoreKit,
Play Billing, SwiftUI, Compose, or Flutter vocabulary, and **no provider status
string is admissible**: a provider concept enters only as a member of a closed
Mosaic enumeration. Nothing in the contract is executable.

## The one rule that matters most

> **Any rejection yields `accessState: unknown` and preserves the cache. Never
> `inactive`.**

This is normative, it applies to every reader, and it is pinned in the manifest
as `readerPolicy.rejectedRecord: "reportUnknownPreserveCache"` and
`readerPolicy.inactiveInference: "forbidden"`.

`inactive` is a claim about a person: it means Mosaic looked, found no
qualifying source, and is confident. It may only ever be the result of a
snapshot Mosaic issued and the reader fully accepted. It is never inferred from
a network failure, a timeout, an expired cache, an unknown field, an unknown
enumeration member, a digest mismatch, an unsupported version, or a rejected
document. Every one of those is `unknown`.

The distinction is not stylistic. A reader that collapses "I could not find out"
into "you do not have it" turns every Mosaic outage into a mass revocation
experienced by paying customers, and does so most reliably at exactly the moment
Mosaic is least able to notice. The validator enforces the rule against the
contract itself: `validateFailClosedVocabulary` fails if any reader policy value
resolves to `inactive`, and fails if the persisted-state enumeration ever gains
`unavailable`.

## Envelope and record types

Every document is an envelope:

```json
{
  "authoritativeEntitlementContractVersion": "1",
  "recordType": "customerEntitlementSnapshot",
  "payload": {}
}
```

`additionalProperties` is `false` at every level. The record-type set is closed
at seven members and is pinned by the manifest as well as by the schemas:

| Record type | Schema | Meaning |
| --- | --- | --- |
| `entitlementSyncRequest` | sync-request | What an SDK asks for |
| `customerEntitlementSnapshot` | snapshot | The immutable authoritative view of one customer's access |
| `snapshotUnchanged` | snapshot | The conditional-request answer confirming a cached snapshot |
| `entitlementCheckRequest` | check | A focused multi-key access question |
| `entitlementCheckResult` | check | Its answer, never a bare boolean |
| `subscriptionSnapshot` | subscription | The projected state of one Subscription Instance |
| `restoreResult` | restore | The outcome of a restore, on two independent axes |

Five schemas rather than one follows the Billing Ingestion precedent. Each is a
self-describing envelope pinning its own `recordType` subset, so a reader
dispatches on the envelope alone and a document matches exactly one schema.

## Four state axes, not one flat enum

A provider lifecycle does not collapse into a single value without lying. A
subscription can be cancelled and still grant access; it can be in a grace
period, which grants access, or in billing retry, which does not, and both are
"payment failed". So state is four independent axes plus an explanation.

| Axis | Members | Answers |
| --- | --- | --- |
| `accessState` | `active`, `inactive`, `unknown`, `unavailable` | Does this grant access right now? |
| `lifecycleState` | `trialing`, `active`, `grace_period`, `billing_retry`, `paused`, `expired`, `revoked`, `refunded`, `superseded`, `unknown` | What is the provider doing? |
| `renewalIntent` | `auto_renew_enabled`, `auto_renew_disabled`, `provider_managed`, `paused`, `unknown` | Will it renew? |
| `billingState` | `current`, `retrying`, `grace`, `failed`, `refunded`, `revoked`, `unknown` | What is happening to the money? |

Every axis is closed and deliberately over-provisioned: adding a member is a
breaking change requiring Authoritative Entitlement `2`, so the members that
might be needed are declared now.

**`unavailable` is not customer state.** It says the authoritative service could
not answer — billing disabled for the Environment, a projection failure, an
outage. It is therefore admissible only on a read-time response
(`entitlementCheckResult`, and a subscription snapshot's `accessState`) and is
structurally impossible inside a `customerEntitlementSnapshot` entry, whose
state vocabulary is the separate three-member `persistedEntitlementState`. An
immutable record of a service failure would be a service failure remembered
forever as customer state.

### Uncertainty

Unknown and unavailable must remain explainable, so both carry an `uncertainty`:

```json
{
  "reason": "identity_unresolved",
  "since": "2026-07-28T10:30:00.000Z",
  "expectedResolution": "operator_action",
  "diagnosticCode": "entitlement.identity.conflict_open"
}
```

`reason` is closed: `none`, `provider_unavailable`, `missing_fact`,
`identity_unresolved`, `product_unresolved`, `conflicting_facts`,
`projection_failed`, `stale_validation`, `unsupported_provider_state`. A
definite state carries `reason: "none"` and no `since`; a non-definite state
requires both. The schema enforces the pairing in both directions.

### Schema-level invariants

Three invariants are `if`/`then` rules in the canonical schema rather than
prose, so a third-party validator with no Mosaic code enforces them:

- `lifecycleState: "revoked"` requires `accessState: "inactive"` **and**
  `revocationEffectiveAt`. Revocation is the one transition that is never
  policy-dependent.
- `lifecycleState: "grace_period"` requires `gracePeriodEnd`. Grace grants access
  on both providers, so a grace state without an end is an unbounded grant.
- `accessState` of `unknown` or `unavailable` requires an `uncertainty.reason`
  other than `none`.

The subscription schema adds the same treatment for `billing_retry`
(`billingRetryStart`), `paused` (`pauseEffectiveAt`, **and `storePlatform:
"google_play"`** — pause does not exist on Apple, so an Apple snapshot claiming
it is a normalization defect), `expired`, `refunded`, and `superseded`, plus
`lifecycleState: "unknown"` implying a non-definite `accessState`.

## Entries and sources

An **entry** is one Entitlement's state for one customer. A **source summary**
is one reason the customer holds it.

Mosaic Product identity and Subscription Instance identity live **on source
summaries only** and are deliberately absent from entries. This is a considered
deviation from the orchestration prompt's entry field list: when several sources
grant one Entitlement — a monthly subscription, a lifetime purchase, and a
family-shared source — duplicating Product identity onto the entry creates two
places that can disagree, and the entry is the one a reader trusts. Entries
carry `sourceIds`; sources carry the identity.

Source identity is `(purchase lineage, Product, grant version)` and never a
transaction fact identifier, so a second fact for one purchase — a mapping
correction, a validator-version bump — cannot double-grant.

### Effective end

`endKnown` and `effectiveEnd` together express three different things, and the
difference matters to a paying customer:

| `endKnown` | `effectiveEnd` | Meaning |
| --- | --- | --- |
| `true` | present | The Entitlement ends then. Safe to display. |
| `true` | **absent** | The Entitlement is **permanent**. A permanent source contributes. |
| `false` | forbidden by schema | The end is genuinely uncertain. Display no expiry at all. |

Reporting the subscription's end date when a lifetime purchase also contributes
would tell a lifetime purchaser their access expires next month.
`snapshots/permanent-source-no-finite-expiry.json` pins the behaviour.

### The entry-to-source graph

Semantic rules the schema cannot express, all enforced by the validator:

- `sourceCount` equals `sourceIds.length`.
- Every `sourceId` resolves to a source the snapshot carries, and every source is
  accounted for by at least one entry.
- An `active` entry has at least one contributing source with
  `sourceState: "granting"`. An active Entitlement always has a reason.
- An `inactive` entry has no contributing source that is `granting` **or**
  `unknown`. Unresolved evidence yields `unknown`, never `inactive` — the top
  rule, applied inside the projection rather than only at the reader.
- Entries ascend by `entitlementKey` and sources ascend by `sourceId`.

### Test sources

Every source carries `isTestSource`. The Apple and Google situations are
structurally different and both are reported the same way:

- **Apple** sandbox transactions — including every TestFlight purchase — cannot
  reach a production-mode Environment at all. Phase 9A quarantines them at
  ingestion. This is a fraud control: Apple sandbox accounts are free and
  self-service. TestFlight testers get access by pointing TestFlight builds at a
  staging Environment.
- **Google** has no sandbox. License-tester purchases, allowlisted by an operator
  in Play Console, arrive as ordinary production transactions and are
  distinguishable *only* by this flag.

So `isTestSource` is not decoration: on Google it is the only thing separating a
test grant from a paid one, and it appears on the server API, the SDK result,
and the webhook payload.

## Entitlement keys are project data

`entitlementKey` reuses the Commerce Configuration key pattern unchanged
(`^[a-z][a-z0-9_.-]*$`, ≤64), so one vocabulary spans catalogue and access; a
test asserts the two patterns stay identical.

Unlike every enumeration in this contract, **an unrecognized key is accepted**
(`readerPolicy.unknownEntitlementKey: "acceptAsProjectData"`). Keys are Project
data, not contract vocabulary. Rejecting an unknown key would make *defining a
new Entitlement* a breaking change for every already-shipped SDK — an
operator-facing action silently breaking readers is the opposite of what
fail-closed reading is for.

## Canonical serialization and `contentDigest`

`contentDigest` is SHA-256 over the canonical serialization of the snapshot
payload with `contentDigest` removed. `subscriptionSnapshot.checksum` is the same
derivation over its own payload.

It is **corruption and binding detection, not authentication**. It covers
`billingCustomerId`, `projectId`, `environmentId`, and `snapshotVersion`, so a
snapshot cannot be accepted into another customer's, Project's, or Environment's
cache even if a field were altered in transit. It proves nothing about origin:
anyone can compute it.

The canonical form is pinned in the manifest's `canonicalSerialization` block
because five implementations must produce byte-identical input:

- Minified JSON: no whitespace.
- Object members ascending by UTF-16 code unit, **at every depth**.
- **Array order preserved.** Array order is normative in this contract, so a
  serializer must never sort an array — doing so would silently repair a
  document the semantic validator exists to reject.
- Absent members omitted. **`null` is never emitted**; absent and null are
  different bytes and therefore different digests.
- Timestamps with exactly three fractional digits and a literal `Z`. The
  precision is fixed in the schema for this reason: the same instant written
  with different precision would digest differently.
- Integers in shortest decimal form, no exponent. The contract contains no
  non-integer numbers.
- Minimal JSON string escaping; non-ASCII is never escaped into `\u` sequences.

Reference vectors:
[`packages/test-fixtures/src/entitlement-snapshot-digest-vectors.json`](../../packages/test-fixtures/src/entitlement-snapshot-digest-vectors.json).

## Freshness, caching, and bounded grace

A snapshot carries `issuedAt`, `asOf`, `refreshAfter`, `validUntil`, and an
optional `staleGraceSeconds`.

| Window | Cache state | Behaviour |
| --- | --- | --- |
| before `refreshAfter` | `fresh` | Serve; do not refresh. |
| `refreshAfter` → `validUntil` | `refresh_recommended` | Fully valid; refresh opportunistically. |
| `validUntil` → `validUntil + staleGraceSeconds` | `stale_within_grace` | Previously active Entitlements stay active and **must be surfaced as stale**. |
| after that | `expired` | Report `unknown`. Never `inactive`. |

`staleGraceSeconds` defaults to 24 hours, so the fourth row is a real band in the
shipped configuration rather than a theoretical one.

Per OD-5, **bounded grace is the shipped policy**, and the defaults are
`refreshAfter` = issuance + 1 h, `validUntil` = issuance + 7 d, and
`staleGraceSeconds` = 86400 (24 h). All three are per-Environment configurable
server-side. A zero grace default would have shipped the strict policy under a
bounded-grace decision, so the default is stated rather than left to fall out of
an absent field.

`staleGraceSeconds` absent means zero, so a producer that intends bounded grace
states it explicitly. Zero **is** the strict policy, expressed through the same
fields rather than as a separate mode; the server-only policy is guidance for
irreversible actions rather than a contract state.

**The 30-day hard maximum is on the combined horizon.** `maxValidUntilSeconds`
and `maxStaleGraceSeconds` bound each field individually, but only
`maxCacheHorizonSeconds` stops them composing: `(validUntil - issuedAt) +
staleGraceSeconds` may never exceed 2592000 seconds, or a 30-day validity and a
30-day grace window would together license 60 days during which a device serves
access Mosaic never confirmed. The semantic validator enforces it, on
`snapshotUnchanged` as well as on a snapshot — otherwise the bound could be
evaded by confirming a snapshot rather than reissuing it.

Clock skew tolerance is 60 seconds, applied in the direction that favours the
user. A device clock earlier than `issuedAt` by more than the tolerance is
*unreliable*, and an unreliable clock is not a fifth cache state: it forces
expired-equivalent behaviour. A naive implementation computes a negative cache
age, concludes "fresh", and hands unlimited offline access to anyone willing to
change their device time.

Reference vectors:
[`entitlement-freshness-vectors.json`](../../packages/test-fixtures/src/entitlement-freshness-vectors.json).

## Cache acceptance

`snapshotVersion` is a monotonic integer **per customer per Environment** and is
the sole cache-monotonicity key. `entityTag` is an opaque HTTP validator: compare
it for equality, never for magnitude.

Checks run in this order, and the order is normative:

1. `unsupportedContractVersion` → reject, preserve cache
2. `customerBindingMismatch` (customer, Project, or Environment) → reject,
   **clear** cache
3. `contentDigestMismatch` → reject, preserve cache
4. `snapshotVersionNotNewer` (older *or equal*) → reject, preserve cache
5. `asOfRegression` → reject, preserve cache
6. accept, replacing the cache atomically

Binding is checked before version for a specific reason. Snapshot versions are
monotonic *per Environment*, so a staging snapshot legitimately starts at `1`;
diagnosing that as a version regression would be wrong and would preserve a
production cache under a staging identity. A binding mismatch is also the one
rejection that clears rather than preserves, because continuing to serve the
previous customer's access after an identity change is precisely the leak the
rule exists to prevent.

Acceptance is atomic: `readerPolicy.partialAcceptance` is `forbidden`. A reader
never keeps the entries it understood from a document it rejected.

Reference vectors:
[`entitlement-cache-decision-vectors.json`](../../packages/test-fixtures/src/entitlement-cache-decision-vectors.json).

### `snapshotUnchanged`

A sync whose cached snapshot is still current is answered with a **`200`
carrying the `snapshotUnchanged` record**, which has no entries but does carry
refreshed `refreshAfter` and `validUntil` values. A confirmed-current snapshot
must not expire merely because it was confirmed instead of resent. A snapshot
whose version *equals* the cached version is not "newer" and is not accepted;
confirming it is what this record is for.

The refreshed window travels **in the record, not in headers**. No header name
for freshness exists anywhere in the frozen schemas, so an SDK that looked for
one would be reading a field this contract does not define.

### Cross-customer cache state

When a snapshot fails the customer, Project, or Environment binding check, the
SDK-facing cache state is spelled **`differentCustomer`** — that is the canonical
spelling across all three SDKs, alongside `fresh`, `refreshRecommended`,
`staleWithinGrace`, `expired`, `missing`, and `invalid`.

These are SDK API states in camelCase. The freshness reference vectors use
snake_case identifiers (`fresh`, `refresh_recommended`, `stale_within_grace`,
`expired`) for the four freshness bands because they are vector-file data rather
than a public API surface; the mapping is one-to-one and the extra states
(`missing`, `invalid`, `differentCustomer`) are decided by cache acceptance
rather than by freshness. Clock unreliability is a diagnostic that forces
expired-equivalent behaviour, not an eighth state.

## Sync and check

`entitlementSyncRequest` carries the contract negotiation
(`supportedAuthoritativeEntitlementContracts: ["1"]`) **in the body**. The
Configuration Delivery capability request is untouched.

### The SDK-conformant sync form

Negotiation lives in the body, so the sync surface is a `POST`. This is the
**only** conformant form for an SDK:

```http
POST /v1/sdk/billing/entitlements
Authorization: Bearer mcat_<43 base64url characters>
Mosaic-SDK-Key: <public SDK key>
Content-Type: application/json

{
  "authoritativeEntitlementContractVersion": "1",
  "recordType": "entitlementSyncRequest",
  "payload": {
    "knownSnapshotVersion": 4,
    "entityTag": "cs-0001-v4",
    "supportedAuthoritativeEntitlementContracts": ["1"],
    "correlationId": "fixture-correlation-0004"
  }
}
```

The response is one of exactly two records, both returned with `200`:

- `customerEntitlementSnapshot` — the full snapshot.
- `snapshotUnchanged` — when `knownSnapshotVersion` matches the server's current
  version, carrying the refreshed freshness windows.

**`POST` is the only conditional mechanism.** There is no conditional `GET` and
no `304` on this surface. The `GET` read exists for non-SDK callers and always
answers with a plain `200` carrying the full `customerEntitlementSnapshot`; it
is unconditional.

A conditional `GET` was considered and removed. A `304` carries no body, so it
cannot carry the refreshed `refreshAfter` and `validUntil`, and no freshness
header name exists anywhere in the frozen schemas to carry them instead — so the
`304` path could confirm a snapshot without being able to say how long the
confirmation was good for, which is the one thing the unchanged response exists
to communicate. It also had nowhere to put the contract negotiation. Both
problems are solved by `snapshotUnchanged`, which is a body, so the second
mechanism earned nothing and was a second place for freshness semantics to
drift.

`billingCustomerId` on the request is a **hint**. The server derives the customer
from the Customer Access Token and verifies the hint against it, refusing a
mismatch. A caller can never select a customer by asserting an identifier; see
[Customer Access Token Contract v1](customer-access-token-v1.md).

### An absent Entitlement key is `unknown`

**Normative.** An `entitlementKey` that does not appear in a snapshot's `entries`
array reads as state **`unknown`**. It is never read as `inactive`. This holds
whether or not `requestedEntitlementKeys` narrowed the response.

Absence is not a statement. A key can be missing because the Project never
defined it, because the projection could not evaluate it, because the request
narrowed it away, or because the reader is asking about a key that belongs to a
different Project entirely — and a snapshot gives a reader no way to tell those
apart. Treating the silence as a denial is the same mistake as treating a
rejected document as a denial, arrived at from the other direction.

An `inactive` entry is the opposite of absence: it is Mosaic stating that it
looked, found no qualifying source, and is confident. That statement is present
in the document, with a `primaryExplanation` — usually `no_qualifying_source` —
and a `sourceCount`.

The narrowed case makes the difference concrete. Given
`sync/sync-request-requested-keys.json`, which narrows to
`["pro", "pro_lifetime"]`:

| Reader asks about | Snapshot contains | Reads as |
| --- | --- | --- |
| `pro` | an entry with `state: "active"` | `active` |
| `pro_lifetime` | an entry with `state: "inactive"`, `sourceCount: 0` | `inactive` |
| `team_seats` | nothing — it was narrowed away | **`unknown`** |

A reader that concluded `inactive` for `team_seats` would have converted its own
request parameter into a revocation.

The same rule applies to `entitlementCheckResult`, from the other side: the
response contains one result per requested key, so a key the caller asked about
that is missing from `results` is `unknown` rather than `inactive`. A named
result carrying `state: "inactive"` is a real answer and is trusted as one; this
is why `checks/check-result-active.json` reports `pro_lifetime` as `inactive`
with `no_qualifying_source` rather than omitting it.

`entitlementCheckResult` returns per-key `state`, `primaryExplanation`,
`sourceCount`, `snapshotVersion`, and `asOf`. There is no bare boolean anywhere
in this contract. When no snapshot can be read at all, `snapshotVersion` is
absent and every result is `unavailable` — a rule the semantic validator
enforces, so "no version" and "definitely inactive" can never be confused.

## Restore

`restoreResult` reports two independent axes:

- `outcome`: Mosaic's authoritative answer — `restored`,
  `no_additional_purchases`, `validation_pending`, `identity_unresolved`,
  `product_unresolved`, `provider_unavailable`, `failed`.
- `providerOutcome`: what the native provider restore did — `completed`,
  `no_purchases_found`, `cancelled`, `failed`, `unsupported`, `not_attempted`.

`restored` requires `billingCustomerId`, `completedAt`, **and**
`snapshotVersion`: the accepted snapshot is the evidence that makes the outcome
authoritative rather than hopeful. A successful native restore whose facts have
not yet been validated is `validation_pending` with a `pendingValidationCount`,
not `restored`. The cross-platform poll bound is 3 attempts / ~6 s before
reporting `validation_pending`.

## Reader sequence

1. Require exact `authoritativeEntitlementContractVersion: "1"`.
2. Validate the complete closed document. Reject the whole record on any unknown
   version, record type, field, or enumeration member — except an unrecognized
   `entitlementKey`, which is accepted.
3. Verify `contentDigest` and the customer, Project, and Environment binding.
4. Apply the cache-acceptance order above.
5. Evaluate freshness against the device clock with 60 s tolerance.
6. On **any** rejection: report `accessState: unknown`, preserve the cache
   (except on a binding mismatch, which clears it and reports the cache state as
   `differentCustomer`), and emit a diagnostic.
7. For a key **absent** from an accepted snapshot's `entries`, report `unknown`.
8. Never report `inactive` except from an entry, or a check result, that says so
   in a document the reader fully accepted.

## What this contract is not

- **Not a bearer credential.** An Access Decision Snapshot is a read model;
  possessing it authorizes nothing, and a backend must never accept one
  presented by a client as proof of access
  (`readerPolicy.snapshotAsCredential: "forbidden"`).
- **Not a replacement for server authorization.** The SDK cache supports UI
  continuity and feature gating. Protected backend resources are authorized by
  the application's own server.
- **Not provider state.** No provider status string is admissible anywhere.
- **Not a source of truth for provider facts.** Those stay in Billing Ingestion
  `1`, which this contract does not `$ref` — both are drafts, and a draft that
  referenced another draft would inherit its lifecycle. The safe-diagnostic shape
  is copied rather than referenced for the same reason.

## Fixtures

`protocol/fixtures/authoritative-entitlement/v1/` — 37 canonical fixtures across
`snapshots/`, `sync/`, `checks/`, `subscriptions/`, `restores/`, and 27 in
`invalid/`.

The behavioural fixtures are the ones worth reading first:
`subscriptions/cancelled-access-still-active.json` (auto-renew off, access
active), `snapshots/multiple-active-sources.json`,
`snapshots/refund-of-one-source-other-remains-active.json`,
`snapshots/permanent-source-no-finite-expiry.json`, and
`checks/check-result-unavailable-billing-disabled.json`.

Two invalid fixtures are recorded in `invalid/rejection-layers.json` as
**semantic** rather than schema rejections, which is the honest classification:
`older-snapshot-version-rejected.json` (a version that regresses against its own
predecessor — cross-field arithmetic no JSON Schema can express) and
`different-customer-rejected.json` (a digest computed over a different
`billingCustomerId`, which is exactly the binding failure the digest exists to
catch). See [fixture lifecycle](fixture-lifecycle.md).

## Related documents

- [Customer Access Token Contract v1](customer-access-token-v1.md)
- [Billing State Webhook Contract v1](billing-state-webhook-v1.md)
- [Billing Ingestion Contract v1](billing-ingestion-v1.md)
- [Compatibility policy](compatibility-policy.md) · [Versioning](versioning.md)
