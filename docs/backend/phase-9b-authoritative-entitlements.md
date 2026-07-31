# Phase 9B: Authoritative Entitlements and Access Surfaces (Backend)

Phase 9A proved a provider transaction was authentic and refused to decide anything about
access. Phase 9B is where Mosaic starts deciding: validated Transaction Facts are projected
into subscription state and Customer Entitlement Snapshots, and three surfaces read those
snapshots — the SDK entitlement sync endpoint, the trusted-server entitlement APIs, and (per
owner decision OD-1(b)) an application webhook slice.

The public contracts are the Authoritative Entitlement Contract v1, the Customer Access Token
Contract v1, and the Billing State Webhook Contract v1, all born `draft` (OD-15). Webhook
signing and destination policy are recorded in ADR-0024.

## Terminology

| Term | Meaning |
| --- | --- |
| Billing Customer | Project-scoped identity a purchase attaches to. Created lazily, never by SDK init. |
| Purchase Lineage | Environment-scoped provider purchase chain, keyed on its **root**. |
| Subscription Snapshot | Immutable projected state of one Subscription Instance at one projection version. |
| Customer Entitlement Snapshot | Immutable authoritative state of every Entitlement one customer holds, per Environment. |
| Snapshot Version | Monotonic integer per (customer, Environment). The sole cache-monotonicity key. |
| Entity Tag | Opaque HTTP validator. Equality only; it carries no ordering. |
| Entitlement Source | One reason a customer holds an Entitlement. Identity is (purchase lineage, Mosaic Product, grant version). |
| Customer Access Token | Opaque bearer credential scoping an SDK read to one customer. |

## Two axes that are never merged

Mosaic Environment and Store Environment stay separate, exactly as in 9A. Phase 9B adds a
second pair that is equally never merged:

- **`accessState`** is what the customer may do. It is `active`, `inactive`, `unknown`, or
  `unavailable`.
- **`unavailable` is a statement about Mosaic**, not about the customer. Billing disabled, a
  projection that has not run, storage that cannot be read — all of these are `unavailable` or
  `unknown`, and never `inactive`. Reporting them as `inactive` tells a paying customer they
  lost access because Mosaic had a bad minute.

Every non-definite state carries an `uncertainty` object naming why, and every uncertainty
other than `none` carries the instant it began.

## Server authentication

Two credentials exist on these surfaces, and they answer different questions.

| Credential | Header | Answers |
| --- | --- | --- |
| Secret server key | `Authorization: Bearer sk_…` | Which tenant is calling, and may it act on a named customer? |
| Public SDK key | `Mosaic-SDK-Key` | Which Environment and Application is this client? |
| Customer Access Token | `Authorization: Bearer mcat_…` | **Which customer** is being read? |

The public SDK key alone can never select a customer. That is the whole reason the sync surface
requires a token as well: a public key ships inside an application binary, and a surface that
let it name a customer would let anyone read anyone's entitlements.

Trusted APIs derive their Project and Environment entirely from the secret key. No request body
on these surfaces carries a Project or an Environment, so a careless or compromised caller
cannot address a tenant it does not own.

## Customer Access Tokens

Per OD-14(a) the token is **opaque**: `mcat_` followed by 43 base64url characters, which is 256
bits of randomness. It has no claims, no header, no signature, and nothing may be inferred from
it. Mosaic stores only its SHA-256 digest alongside the columns that scope it — Project,
Environment, Billing Customer, audience, scopes — so authorization is a row read rather than a
claims validation, and revocation is one `UPDATE`.

```
POST /v1/billing/server/customer-tokens
Authorization: Bearer <secret server key>

{
  "customerAccessTokenContractVersion": "1",
  "recordType": "customerAccessTokenIssuanceRequest",
  "payload": {
    "billingCustomerId": "bcu_…",
    "audience": "sdk_sync",
    "scopes": ["entitlements.read"],
    "requestedTtlSeconds": 3600,
    "correlationId": "…"
  }
}
```

- **Lifetime**: one hour by default, twenty-four hours maximum. A caller may shorten it and can
  never lengthen it past the maximum; the schema enforces the same ceiling independently, so a
  service bug cannot mint a long-lived credential.
- **Audience**: only `sdk_sync` is issued in Phase 9B. `server_check` is declared by the
  contract so adding it later costs no contract version, and refusing to mint it now means no
  credential exists for a surface that has not been built.
- **Revocation**: `POST /v1/billing/server/customer-tokens/{tokenId}/revoke` with a closed
  `revocationReason`. It takes effect on the next presentation regardless of remaining life.
- **Audit**: issuance and revocation are written in the same transaction as the token row.
- **The value appears exactly once**, in the issuance response. It is never logged, never
  stored, never returned again, and no branch of the issuing path can reach a logger with it.
  The `tokenId` is a public handle and is what appears in logs, spans, and audit events.

## SDK entitlement sync

```
GET  /v1/sdk/billing/entitlements
POST /v1/sdk/billing/entitlements
Authorization: Bearer mcat_…
Mosaic-SDK-Key: <public SDK key>
```

`POST` carries the contract's `entitlementSyncRequest` so a caller can negotiate contract
versions, state the version it already holds, and narrow the response to specific Entitlement
keys. `GET` is the unconditional form.

The response is an Access Decision Snapshot: the contract's `customerEntitlementSnapshot`
record, carrying `issuedAt`, `asOf`, `refreshAfter`, `validUntil`, `staleGraceSeconds`, the
Entitlement entries, the source summaries that explain them (each with `isTestSource`), the
projection status, and a correlation id.

The **response body is the contract's canonical serialization**. An SDK recomputes
`contentDigest` over exactly the bytes it received; producing the body and the digested bytes
by two different code paths would surface a serialization bug to users as cache corruption.
Go's agreement with the other four implementations is pinned by
`packages/test-fixtures/src/entitlement-snapshot-digest-vectors.json`.

### Conditional requests and freshness

A snapshot is reported unchanged only when **both** the caller's stated snapshot version and its
entity tag match. The entity tag is an opaque equality token with no ordering; confirming on it
alone would confirm a cache whose monotonicity nobody checked. The version is stated in the
`entitlementSyncRequest` body, so only the POST form can state one.

**The negotiated POST form always answers `200` with the canonical `snapshotUnchanged` record —
never a bare `304`.** This is the ratified
cross-SDK flow, and the reason is the contract rather than HTTP: a 304 carries no body, so the
freshness window would have to travel in `Mosaic-…` headers that **no frozen schema defines**.
Three SDKs each reading freshness out of undocumented header names is freshness the
Authoritative Entitlement Contract cannot guarantee, and the first platform to mistype one
silently expires a paying customer's cache while the device is demonstrably in contact with the
server. The `snapshotUnchanged` record carries `refreshAfter`, `validUntil`, and
`staleGraceSeconds` inside the schema every SDK already validates:

```json
{ "authoritativeEntitlementContractVersion": "1",
  "recordType": "snapshotUnchanged",
  "payload": { "snapshotVersion": 7, "entityTag": "ces.…",
               "refreshAfter": "…", "validUntil": "…", "staleGraceSeconds": 86400,
               "projectionStatus": { "state": "current", … } } }
```

Those three values are recomputed from the instant the request was answered, not echoed back
from whatever the caller last held. That is what "confirming slides freshness" means: a device
that keeps confirming the same version never expires while it is in contact with the server.

**The `GET` form is not conditional.** It is a plain full-snapshot read: it carries no way to
state a snapshot version, and version equality is a precondition of an unchanged answer, so it
returns `200` and the whole snapshot however the caller frames the request. It accepts no
`If-None-Match` parameter and never answers `304`.

The freshness window is also set as headers on every response, so an intermediary or an operator
can read it without parsing the body:

| Header | Meaning |
| --- | --- |
| `ETag` | Strong validator for this representation. |
| `Mosaic-Refresh-After` | After this instant a reader should refresh. The snapshot stays fully valid. |
| `Mosaic-Valid-Until` | Hard end of authoritative validity. |
| `Mosaic-Stale-Grace-Seconds` | Bounded window past `validUntil` in which previously active Entitlements may still be served, clearly marked stale. |

> **Resolved (defect D-5).** The `GET` form previously advertised a conditional `304` that the
> version precondition made unreachable on every request that could have taken it. The dead
> branch, the `If-None-Match` parameter, and the `304` response are removed from the handler and
> from the OpenAPI document. `knownSnapshotVersion` in the POST body is the one conditional
> mechanism this surface has, and it is the one all three SDKs already use. Making the `GET`
> conditional instead would have meant either dropping the monotonicity precondition for one
> verb or inventing an unratified query parameter; neither is taken unilaterally.
>
> `docs/protocol/authoritative-entitlement-v1.md` still describes conditional `GET` as a
> server-side option. That file is protocol-owned and is flagged for a one-line correction.

Defaults are one hour to refresh, seven days of validity, and twenty-four hours of bounded
grace (OD-5), configurable per deployment. **The combined horizon — validity plus grace — is
capped at thirty days**, in code as well as in the contract. Past the grace window a reader
reports `unknown`, never `inactive`.

### States a reader must handle

| Condition | Answer |
| --- | --- |
| Customer never projected in this Environment | A valid snapshot with no entries, `snapshotId: pending.<customerId>`, `snapshotVersion: 0`, and `projectionStatus.state: pending`. Not an error, not `inactive`. Version 0 is the sentinel for "nothing committed"; committed snapshots start at 1, so the first real projection is always strictly newer than the placeholder a device cached. |
| Billing disabled for the Project | `unavailable` with `uncertainty.reason: provider_unavailable` and explanation `billing_disabled`. |
| Identity conflict open (OD-10) | Entitlements report `unknown` with `identity_unresolved`; neither candidate customer is granted anything. |
| Product mapping missing | `unknown` with `product_unresolved`. |
| Token expired, revoked, or unknown | `401`, indistinguishably. Telling a caller which half of a guess was right is how a credential gets brute-forced. |
| Token presented with another Environment's SDK key | `403`, and an operator warning line. |

## Trusted-server entitlement APIs

All are authenticated by the secret server key and scoped to its Environment.

| Operation | Route |
| --- | --- |
| Read a customer | `GET /v1/billing/server/customers/{customerId}` |
| Read the current snapshot | `GET /v1/billing/server/customers/{customerId}/entitlements` |
| Multi-key access check | `POST /v1/billing/server/customers/{customerId}/entitlement-checks` |
| List projected subscriptions | `GET /v1/billing/server/customers/{customerId}/subscriptions` |
| Read one subscription snapshot | `GET /v1/billing/server/subscriptions/{instanceId}` |
| Read a subscription timeline | `GET /v1/billing/server/subscriptions/{instanceId}/timeline` |
| Issue / list / revoke tokens | `…/customer-tokens` |

The check endpoint **never answers with a bare boolean**. Every requested key comes back with a
state, a primary explanation, whether the end is known, the contributing source count, and — at
the result level — the snapshot version, rule version, and `asOf` instant the answer was derived
from. A caller that acts on the answer can say afterwards exactly which committed state it acted
on, which a boolean makes impossible.

Snapshot reads through this surface are audited: an operator credential reading a named
customer's entitlement state is exactly the access a later investigation needs to reconstruct.

List endpoints page by keyset. The cursor is opaque and carries one value — the last id of the
previous page — so callers cannot come to depend on its shape.

## Product-to-Entitlement Grant Versions (WP9)

What a Product grants is versioned, and the projection engine selects the version in force at the
**purchase's own effective time**, never at "now". Selecting by current time would silently rewrite
historical access meaning every time an operator edits their catalog, which is the failure
versioning exists to prevent. Three routes, mounted on the Project-scoped dashboard-authenticated
subtree:

| Operation | Route | Who |
| --- | --- | --- |
| Read a Product's grant history | `GET /v1/projects/{projectId}/billing/grant-versions?productId=…` | any organization member |
| Preview the impact of a change | `POST …/billing/grant-versions/impact-preview` | owner or admin |
| Publish a new version | `POST …/billing/grant-versions` | owner or admin |
| Edit a published version | `PATCH`/`PUT`/`DELETE …/billing/grant-versions/{id}` | always `409` |

**Publishing is the separate, explicit act.** Previewing changes nothing — not even the audit
trail, because an operator comparing three candidate policies before choosing one has not made
three changes. Publishing requires an actor, a `reason`, and an admin role, and writes the version,
the audit event, and the reprojection work in one transaction.

**Prospective by default, retroactive only as an additive superset (OD-8).** `effectiveStart` must
be now or later unless the caller sets `retroactive: true`, and a retroactive version is then held
to the widen-only rule — it may add Entitlements or widen policy, never remove or narrow either.
The comparison is `billingprojection.ValidateAdditiveSuperset`, the same function access is derived
under, rather than a second copy in the management package that could drift from it.

**Replacement, not edit.** Publishing closes the current version at exactly the new version's
start, so the two intervals abut: never a gap (purchases made inside it would strand with no
applicable grant and project as `unknown`) and never an overlap (which version applies would become
a function of row order). A proposal reaching into an interval that has already closed is refused
with `grant_interval_overlap`; a retroactive correction is confined to the currently open interval,
because a closed interval is what a historical purchase already selected.

Migration `00047` is what makes this expressible. `00033` gave the table a blanket append-only
trigger *and* a partial unique index permitting one open-ended version per pair, which together
made replacement impossible — closing requires an UPDATE the trigger refused, and a second
open-ended row the index refused. `00047` replaces the blanket trigger with one that permits
exactly one change: setting `effective_end` once, from NULL, to a later instant, with every other
column byte-identical. Reopening, re-closing at a different instant, rewriting a policy, and DELETE
are all still refused by the database, so no future repository method or migration bypasses the
guarantee either.

**The change is applied, not merely recorded.** The publish transaction enqueues a projection job
for every Billing Customer whose current snapshot cites the Product, coalescing on the existing
scope-key uniqueness. A grant version that is recorded but never applied is worse than one never
published: every surface would report the new meaning while every customer kept the old access, and
nothing in the system would ever retry.

Two policy flags are special. `grantsInPaused` is accepted only so it can be refused with a
sentence — Google's pause never grants access and the policy is not overridable. `grantsInBillingRetry`
contradicts both providers' documentation, so it is closed by default and settable only by an
organization **owner**, not by an admin.

The impact preview counts from *current* committed state only — the snapshot each customer's
pointer names. `impactedCustomers` is who would be recomputed; `impactedActiveSources` is how many
of those citations are currently granting, which is the number that answers "how many people could
lose access if I get this wrong?"; `impactedLineages` includes purchases with no customer resolved
yet, which the customer count cannot see. `impactedEntitlements` and `impactedProducts` count
everything a reprojection of the affected customers re-derives, not only the pair being changed,
because that is the real blast radius of the confirmation being given.

## Test transactions: the Apple/Google asymmetry (OD-17)

The two providers are structurally different here, and the difference is a fraud control rather
than an inconvenience.

- **Apple sandbox transactions cannot reach a production-mode Environment at all.** The
  environment-alignment CHECK from migration 00024 and the store-environment guard in the
  validator quarantine them. Apple sandbox accounts are free and self-service, so relaxing this
  would make production entitlement self-service too. TestFlight purchases are sandbox
  purchases; TestFlight testers get access by pointing TestFlight builds at a **staging
  Environment**, not by weakening the guard.
- **Google Play has no sandbox.** License-tester purchases (allowlisted by an operator in Play
  Console) arrive as production transactions, distinguishable only by a flag. They are admitted,
  and every surface that reports access reports `isTestSource: true` for the sources they
  produce, so a test-derived grant is never mistaken for a paid one.

Consequently `isTestSource` appears on source summaries, on check results, and on webhook
payloads — but never on an Entitlement entry, because an Entitlement can be held for several
reasons at once and only the reasons can be test-derived.

## Ratified access-semantics decisions

Two decisions are restated here because both are places where a reasonable reader would expect
the opposite behaviour, and both are deliberate.

**A partial refund never invalidates ownership; only a full one does.** Apple states a partial
refund as `REFUND_PRORATED`, Google as `quantity_partial` on a voided purchase. Neither is the
provider saying the customer stopped owning what they bought — a partial money-back on a
multi-quantity order, or a goodwill refund of part of a period, leaves the purchase standing. This
holds identically for subscriptions (the remaining period is preserved, per OD-18(a)) and for
one-time purchases (ownership is preserved). It is a single rule stated twice rather than two
rules, because the same provider statement must not mean "keep it" on one purchase type and "you
no longer own it" on another; the one-time engine tested only for Apple's `prorated` until this
was corrected. A genuine full void still arrives as a `full`/unspecified refund or as a
`revocation` fact, and both revoke.

Ownership is the harder half. A subscription wrongly terminated by a partial refund recovers at
the next renewal; a lifetime purchase wrongly revoked has no expiry to recover from and no later
fact to restore it, so the wrong answer is permanent.

**Replaying under an unimplemented rule version answers `422` by design.** It is not a gap to be
filled by falling back to the active engine. See "Projection replay and rule versions" below for
why: a checksum produced by the wrong engine is indistinguishable from a genuine determinism
result, which is the one thing a replay exists to prove.

## From a validated fact to an owned Purchase Lineage (the 9A→9B seam)

Phase 9A ends with a validated Transaction Fact in an append-only ledger. Phase 9B begins with
a Purchase Lineage that a Billing Customer owns. This is the step between them, and it is where
every entitlement in the system actually originates.

### The two halves, and why they are in different places

**The structural half runs inside the fact's own transaction.** `CompleteAttempt` writes the
attempt, the Resolution Snapshot, the fact, the ledger entries — and now the Purchase Lineage
and the Subscription or One-Time Purchase Instance it owns, plus the projection trigger. All of
it lands or none of it does. The lineage is a deterministic function of the fact's own chain
digest and decides nothing, so it belongs beside the fact; and the projection trigger written
next to it is only as durable as the row it points at.

Three rules are load-bearing in that write:

- **The lineage is keyed on the chain root, not on the fact's own digest.** A Google plan change
  hands the subscription a new purchase token and names the old one as `linkedPurchaseToken`, so
  the successor's fact carries a different `purchase_chain_digest`. Keying on it would mint a
  fresh lineage per plan change and fragment one subscription's history — and the projection
  loader would not put it back together, because it walks supersession edges *forward from the
  root*. The root is resolved by walking those edges backwards, bounded and cycle-safe.
- **The digest domain is the fact's own** (`billing.AppleTransactionKey`, `billing.TokenDigest`).
  Every fact-to-lineage join in the codebase compares `purchase_chain_digest` to
  `lineage_key_digest`, so any other domain produces a lineage that can never join to the facts
  it exists for.
- **Neither write disturbs an existing row.** `ON CONFLICT DO NOTHING` on both: a lineage's
  customer association and an instance's projection state have other writers, and a fact
  arriving is not new information about either.

**The identity half runs after the commit**, through `billing.LineageBinder`. Deciding *who owns*
a lineage reads alias resolutions and prior evidence and can open an operator conflict; that is
application logic, and holding the ledger's hot-path transaction open across it would put
ingestion behind the identity module. It is idempotent — locating the lineage re-reads the row
the transaction created, and an association already naming the same customer is a no-op — which
is what makes it safe to run after the fact is already durable.

The residue is deliberate and observable: if the process dies between the commit and the
binding, the fact and its lineage exist and the lineage is unassociated, which is exactly what
`unresolvedLineages` counts on the projection-health surface. The next fact on the same chain
retries the decision.

### The evidence ladder (OD-2)

The resolver — not the seam — decides which rung wins; the seam only assembles the observations.
Authority order is `billingcustomer.authorityRank`.

| Rung | Evidence | Where it comes from |
| --- | --- | --- |
| 1 | `trusted_server_observation` | The application backend submitted under its secret server key while naming a customer with a Customer Access Token. |
| 2 | `app_account_token` / `obfuscated_external_account_id` | Provider correlators, matched against alias digests a backend already attached. |
| 3 | `prior_lineage_association` | An association already accepted for this lineage. |
| 3a | `token_bound_submission` | A public-SDK-key observation carried a Customer Access Token. It may attach an unowned lineage, but cannot move or freeze an attached one. |
| 4 | `purchase_anchor` | Nothing identified the purchase, so a customer was created to hold it. |

**Submission context is what can attach a first purchase to an identified customer.** A store
notification arrives out of band and names nobody, and the observation contract carries no
customer member. So the submission carries a Customer Access Token in the
`Mosaic-Customer-Token` header — a header rather than a body member because it is a credential,
and the observation body is a ratified record Mosaic seals and can replay. A credential must
never be a thing that gets stored and replayed. The credential authenticating the **submission**
determines its authority. A public SDK key plus token records `token_bound_submission`; it may
establish a first association, but a device that once held a token can retain it, so that evidence
can never move or freeze an attached lineage. A request authenticated by the application's secret
server key records `trusted_server_observation`. Both observation endpoints document the optional
header in OpenAPI.

The evidence is keyed on the **transaction reference**, not on a lineage, because at submission
time no lineage exists — the purchase has not been validated yet. `EvidenceForReference` reads it
back when the fact commits. More than one reference digest is searched: a client observation
cannot state a Store Environment (a device can be made to say anything), so it is recorded under
`unclassified` while the notification for the same purchase is recorded under the environment the
store confirmed.

**Rung 2 correlators never touch a fact.** Apple's `appAccountToken` and Google's
`obfuscatedExternalAccountId` are read from the provider's *authoritative response* — the App
Store Server API transaction, the Play purchase resource — rather than from the notification,
because the response is the authority and the notification is only the trigger. They are hashed
at the point they are parsed, inside the validator. No Transaction Fact column holds one, no log
line, span attribute, or audit record ever sees the value or the digest, and Phase 9A's
fact-shape exclusion is unchanged. The digest's home is `billing_association_evidence`.

**Rung 4 is plan §5a rules 1 and 2.** An anonymous purchase must still reach a customer: the
store confirmed a real transaction, and Mosaic has to answer for it on every surface whether or
not anyone has said who bought it. The customer is anchored to the **lineage**, never to the
device — the chain key survives reinstall, clear-data, and device change, so a reinstalling
customer who restores resolves back to the same customer rather than accumulating one per
install. That is the duplicate-customer trap §5a exists to avoid, and the reason an installation
identifier is evidence and never an anchor.

`purchase_anchor` is its own vocabulary entry (migration `00049`) rather than being folded into
`prior_lineage_association`, because the two say different things: one is evidence *found*, the
other records that none was and a customer was created. The dashboard's "identified" versus
"purchase-anchored, not yet identified" distinction is exactly this row. It carries no correlator
digest — the whole meaning is the absence of one — and the resolver is never offered it, so it
can never become a route by which a guessable value reaches someone else's entitlements.

When the person signs in later, an identified customer may adopt the anchor's lineage only with
ownership proof: possession of Google's bearer-grade purchase token, a provider correlator that
already resolves to the identified customer, or a secret-server-key submission. Possession of an
Apple transaction reference is explicitly not proof; it is a short decimal identifier rather
than a store-issued secret. The lineage moves, both customer aggregates are reprojected, and the
empty anchor row becomes `absorbed`. It is retained because snapshots, evidence, and audit history
already cite it. `absorbed` means “historical purchase anchor, no longer holding a lineage,” not a
deleted or merged identity, and it is available on the operator status filter.

### Conflicts and supersession

Two equally authoritative claims on one lineage — two backends each presenting their own
customer's token for the same transaction — conflict rather than one being picked: the lineage
freezes, neither customer is granted anything, and an operator resolves it (OD-10(a)). A lineage
already attached whose new evidence names someone else is a *reassignment*, which is never
automatic, and is downgraded to a conflict before any evidence is written.

A lineage-level supersession edge is recorded only when the fact's own chain digest already had
a lineage of its own that is not the root — a link observed late, where the successor token
arrived first and was materialized before anything said it superseded an earlier chain. A token
handover inside one chain is not a lineage replacement and records no edge. Nothing is ever
deleted: a superseded lineage stops granting access and stays fully visible in history.

An association that establishes an owner enqueues a **customer-scoped** projection. Any job
already queued for that lineage is lineage-scoped — it was queued when the lineage had no
customer — and a lineage-scoped command deliberately mints no customer snapshot.

Pointer moves and conflict freezes are retry-safe across queue failures. Before a pointer changes,
the service persists prior-lineage evidence naming the old customer. If enqueueing either affected
aggregate fails, an identical association request reads that evidence and re-enqueues both the old
and current owner. Conflict resolution is likewise idempotent when the action and reason match the
committed decision, so a retry can finish both projections without rewriting operator intent.

## Billing identity APIs and the conflict workflow

The identity surface mounts under `/v1/billing/identity` rather than under `/billing/server`, so
the identity and access modules own disjoint route trees and neither can shadow the other. Every
route is authenticated by a secret server key.

| Operation | Route |
| --- | --- |
| Create-or-get a Billing Customer | `POST /v1/billing/identity/customers` |
| List a customer's aliases | `GET /v1/billing/identity/customers/{customerId}/aliases` |
| Attach an application-user alias | `POST /v1/billing/identity/customers/{customerId}/aliases` |
| Revoke an alias | `POST /v1/billing/identity/aliases/{aliasId}/revoke` |
| Request a projection for one customer | `POST /v1/billing/identity/customers/{customerId}/sync-requests` |
| List identity conflicts | `GET /v1/billing/identity/conflicts` |
| Read one conflict | `GET /v1/billing/identity/conflicts/{conflictId}` |

There is deliberately **no public-SDK-key path and no route anywhere that accepts an installation
identifier**. The application-user alias is assertable only by the customer's own backend, and a
client-generated installation id must never be able to create or select a customer (plan §5a,
OD-4(a)). Both properties are enforced by the absence of a surface rather than by a check a later
edit could remove. The installation alias is recorded as association evidence with outcome
`unsupported`, which is what gives purchase→install attribution at zero proliferation cost while
never letting the identifier resolve anything.

No response on this surface carries an alias value or an alias digest. A digest is still a stable
per-person identifier, and nothing an operator or an application backend does needs one.

### When identity is disputed (OD-10, review finding I-10)

Two situations open a conflict rather than resolving:

1. **Reassignment.** A Purchase Lineage already attached to customer A produces evidence that
   resolves to customer B. Before this was fixed, the lineage moved silently: customer A kept a
   committed snapshot granting access to a subscription that was no longer theirs, and nothing
   recorded that it had happened. Now the resolution is downgraded to `conflicting` *before* any
   evidence row is written — so the persisted evidence records a conflict rather than a
   resolution that never took effect — a lineage-scoped conflict is opened with the incumbent
   first and the challenger second, the lineage is frozen, and **the previous customer is
   scheduled for reprojection** so the stale grant is recomputed.
2. **An alias that already resolves elsewhere.** Attaching an application-user alias whose digest
   already has a live resolution to another customer answers `409 identity_conflict` — distinct
   from `409 conflict`, which invites a retry — opens an alias-scoped conflict, and freezes the
   customer named in the request. Only that customer: freezing the counterparty would let one
   careless backend take a paying customer's identity offline.

A frozen lineage keeps its last committed state. It is not projected and it does not advance a
checkpoint, but it still names the Entitlements in question and they are emitted as `unknown`
sources — because an absent entry reads to every consumer as "this customer never had it", which
is exactly the definite answer the uncertainty vocabulary exists to avoid asserting.

Resolution is an operator action with three outcomes — `assigned_first`, `assigned_second`,
`detached_both` — and it requires a stated reason, after which the disputed subject is unfrozen and
**both** candidate customers are reprojected, not only the winner: the loser is the one holding the
stale snapshot. There is no automatic-merge path. Automatic merge stays an ADR checkpoint rather
than something a heuristic reaches on its own.

Resolution is reachable only from the dashboard operator surface
(`POST /v1/projects/{projectId}/billing/identity-conflicts/{conflictId}/resolution`), never from a
secret server key. Deciding which of two people owns a purchase is a human judgement about
evidence, and an application backend holding a long-lived key is not the party that should be able
to make it unattended. See *The operator surface (dashboard)*.

## Restore and sync

A restore is not one action, it is a chain: the SDK submits provider transaction references as
observations, those become Raw Billing Inputs, validation turns them into facts, and only then
does a projection produce a snapshot that reflects them. The `billing_restore_sync` job family
follows the whole chain, and the outcome reported to the caller is derived from where the chain
actually got to — never from the fact that the native restore returned.

| Operation | Route | Auth |
| --- | --- | --- |
| Request a restore (SDK) | `POST /v1/sdk/billing/restores` | Public SDK key in `Mosaic-SDK-Key` |
| Poll a restore (SDK) | `GET /v1/sdk/billing/restores/{restoreId}` | Public SDK key |
| Request a restore (backend) | `POST /v1/billing/server/restores` | Secret server key |
| Poll a restore (backend) | `GET /v1/billing/server/restores/{restoreId}` | Secret server key |

**Two axes that are never merged**, matching the contract: Mosaic's `outcome` and the native
`providerOutcome`. A native restore that succeeded while Mosaic is still validating is
`providerOutcome: completed` with `outcome: validation_pending`. That is the honest answer, and
being able to say it is the reason the second axis exists.

`outcome` is one of `restored`, `no_additional_purchases`, `validation_pending`,
`identity_unresolved`, `product_unresolved`, `provider_unavailable`, `failed`. Every non-definite
one names an uncertainty reason on the same vocabulary every other entitlement surface uses.

**The invariant the whole subsystem exists for: `restored` is only ever reported together with
the accepted snapshot version that demonstrates it.** The job records a `baseline_snapshot_version`
when it starts, and `restored` requires the customer's pointer to have moved past it. It is
enforced three times over — a constructor that will not produce the outcome without the evidence,
a service-level validation, and a `CHECK` constraint — because reporting restored access that no
snapshot has yet granted is precisely the lie the contract's two-axis result was designed to
prevent.

Two deliberate choices worth stating:

- **The SDK surface takes the public SDK key, not a Customer Access Token.** A token is
  customer-bound, and `identity_unresolved` is a first-class restore outcome: a restore is exactly
  the flow where the customer may not be known yet, so requiring a customer-bound credential
  would make the most important case unrepresentable. Safety comes from §5a instead — the request
  names no customer, a public key cannot select one, and identity resolves server-side from
  validated store lineage.
- **The body carries observation submission ids, not provider transaction references.** A Google
  purchase-token digest is computable by anyone holding the token, so accepting caller-supplied
  digests would let a caller attach someone else's input to its own restore.
  `observedTransactionCount` reports what was actually linked, never what the caller claimed.

## Application webhooks (OD-1(b))

Phase 9B ships the minimal slice: one event type, `customer.entitlements.changed`, with
at-least-once delivery, attempt history, and API-managed destinations. There is no dashboard UI.
The remaining nine event types the contract declares are reserved names; emitting one before it is
specified would be a defect.

### The event is created inside the projection transaction

An access-change webhook may only exist for state that was committed, so the complete Billing
State Webhook Contract v1 envelope is written into `webhook_events.payload` in the same
transaction as the snapshot it announces. Delivery happens strictly outside it. A destination
that is down produces retries and eventually an exhausted delivery; it never rolls back an
entitlement change and never blocks a projection, and no lock is held across the HTTP call.

The whole envelope is stored rather than a partial payload the worker finishes assembling. That
makes the delivered body byte-identical across every attempt and every manual replay, which is
what makes the signature reproducible.

**A no-change projection emits nothing.** The projection plans an event only when the customer's
committed entitlement state actually moved, so a replay that re-derives identical state delivers
no webhook — which is what stops a Project-wide replay from teaching every receiver to ignore the
channel.

### Verifying a signature

Every delivery carries:

```http
Mosaic-Signature: t=1785243603, v1=e0af000fe574596fad9a154a3d74357a986a4896ceb188dcef6c486759257905
```

The signed string is:

```text
"v1" + "." + t + "." + eventId + "." + rawBody
```

hashed with HMAC-SHA256 under the destination's signing secret, taken as UTF-8 bytes verbatim —
not hex- or base64-decoded first — and rendered as 64 lowercase hexadecimal characters.

> ADR-0024 originally wrote this prefix as a bare `1`. That does not reproduce any of the
> published vectors; the contract and `packages/test-fixtures/src/webhook-signature-vectors.json`
> both use `v1`, and the ADR has been corrected to agree with them.

A worked example, taken verbatim from the shared vector `canonical-event-primary-key` so any
implementation can check itself against the same bytes the Go, Dart, Swift, and Kotlin
implementations are checked against:

| Input | Value |
| --- | --- |
| secret | `whsec_fixture_primary_0000000000000000` |
| `t` | `1785243603` |
| `eventId` | `fixture-event-0001` |
| body | the exact bytes of `protocol/fixtures/billing-state-webhook/v1/events/entitlement-activated.json` |
| signature | `e0af000fe574596fad9a154a3d74357a986a4896ceb188dcef6c486759257905` |

The vector set is eight entries and every one of them earns its place:
`canonical-event-rotation-key` proves the same event under a second key; the three
`must-not-verify` vectors prove the body, the event id, and the timestamp are each genuinely
inside the signed string rather than merely carried beside it; `minimal-body` bootstraps an
implementation before it can produce a real event; `non-ascii-body` catches a UTF-16 or
platform-default body encoding, which agrees on every ASCII vector and disagrees only here; and
`non-ascii-secret` catches a key that was hex- or base64-decoded before use.

Receiver rules, in order:

1. Reject a delivery whose `t` is more than **300 seconds** from your own clock, *before*
   comparing signatures.
2. Hash the raw body exactly as received. Parsing and re-serializing changes whitespace, member
   order, and Unicode escaping, and every genuine delivery then fails.
3. **During rotation the header carries one `v1` parameter per honoured secret. Accept if any of
   them verifies.** A verifier that reads only the first parameter drops every delivery signed
   with the new key.
4. Compare in constant time.
5. Only then parse the body — and treat it as a notification that state changed, never as the
   authority on what the state now is. Re-read the Customer Entitlement Snapshot.

Consumers are documented as **tolerant** — ignore unknown fields and unknown event types — while
the producer stays strict. That is a deliberate, recorded departure from Mosaic's fail-closed
posture (OD-16), because a consumer that rejects an unrecognized field breaks on every additive
change Mosaic makes.

### Rotation

A destination may hold more than one secret that is still permitted to sign. Rotation mints a new
secret, returns it once, and sets `previousSecretHonoredUntil` on the superseded one; until that
instant both sign and both appear in the header. The window lives on the secret row rather than
on the destination, because a second rotation started before the first overlap lapsed leaves two
superseded secrets and a single destination-level deadline would retire one of them early —
exactly the failure the overlap exists to prevent.

Retirement is explicit and audited, and is the response to a suspected compromise. Retiring the
last secret that can still sign is refused: a destination with no signing secret would send
unsigned deliveries, and an unsigned entitlement webhook is an unauthenticated instruction to
grant access.

### Destinations and SSRF

A destination URL is operator-supplied and Mosaic makes outbound requests to it, which is a
server-side request forgery primitive unless it is bounded. Per ADR-0024: HTTPS only; no
redirects (a redirect is a second destination the operator never approved); RFC1918, loopback,
link-local including the cloud metadata address, CGNAT, IPv6 unique-local, IPv4-mapped, and the
unspecified address all refused **against the resolved address**; the hostname resolved once and
the connection pinned to the address that was checked; and bounded connect, total, and
response-body limits.

The resolve-and-pin step is not a nicety. Checking the hostname and then letting the HTTP client
resolve again is the classic DNS-rebinding hole: the second resolution can return an address the
first check would have refused. The screen therefore runs **on every delivery attempt**, not only
at registration.

`MOSAIC_BILLING_WEBHOOK_ALLOW_PRIVATE_DESTINATIONS` is the self-hosted exception, for operators
running Mosaic and their application backend on one private network. It is deployment-level on
purpose. A per-destination toggle would let anyone with destination-write permission reach the
internal network, which is the whole attack the policy prevents.

### Delivery

One `webhook_deliveries` row per (event, destination); attempts hang off it as append-only
history with `attempt_number` unique per delivery. Retries use exponential backoff with jitter,
so a destination outage does not produce a synchronized retry burst. Exhaustion is terminal and
means the attempts actually ran out — a delivery marked exhausted after two of eight looks, in
every operator view, exactly like one that was tried properly, so the schema refuses it.

A manual replay reuses the same delivery row and the same event id, appending a further attempt.
A retry is a new delivery attempt, never a new logical event, so a receiver deduplicating on
event id sees each change once.

A destination whose deliveries keep exhausting is misconfigured or gone, not having an incident,
so a bounded run of consecutive exhausted deliveries disables it automatically and audibly. The
counter counts exhausted *deliveries*, not failed attempts — a single delivery already burns its
whole budget against one provider outage — and any success resets it, so an outage that recovers
never trips the policy.

Attempt history keeps a bounded, control-character-free excerpt of the destination's response so
an integrator can see why their own endpoint refused. It is never parsed and never influences
Mosaic state.

## Projection replay and rule versions

`POST /v1/projects/{projectId}/environments/{environmentId}/billing/projection-replays` recomputes
committed state from the immutable facts and reports what moved. It reuses the ordinary projection
command, so replayed state goes through the same advisory lock, compare-and-swap, and atomic
commit as live projection — there is no second write path that could diverge — and prior snapshots
are never deleted.

**Bounded by construction.** One subscription instance, one customer, or a fact window. There is
no "replay everything" member: an unbounded replay is a migration, and bulk migration tooling is
out of Phase 9B (plan §18). The window bounds on *facts* — a scope is in scope when it holds a
fact whose effective or recorded time falls inside it — not on lineage creation. Bounding on when
a lineage was first seen selected the lineages created in the window and silently skipped every
long-lived lineage that merely *received* a fact in it, which is exactly the population a "replay
last Tuesday" is asking about.

**Materialization is changes-only and has no switch.** The projection command mints a customer
snapshot only when the recomputed checksum differs from the committed one, and a replay reuses
that command. A `changesOnly` parameter previously existed and was never read; it has been removed
rather than left as a parameter that lies about being adjustable.

**Rule versions are selectable, and an unimplemented one is refused.** `projectionRuleVersion`
selects the semantics; zero means the active version. A version this build does not derive under
answers `422` rather than being recomputed under the active engine and labelled with the requested
number — a checksum produced by the wrong engine is indistinguishable from a genuine determinism
result, which is the one thing a replay exists to prove. Only version 1 exists today; the shadow
diff engine is deferred per OD-11(a), so replay plus checksum comparison is how a future rule
change will be evaluated.

**Provider asymmetry, stated rather than hidden.** Apple replay is input-sourced: a stored Apple
payload re-validates to the same transaction. Google replay is fact-sourced, because Google
validation re-queries live provider state and a re-query today does not reproduce what the
provider said last month. A Google replay therefore replays the facts Mosaic recorded, not the
provider's current answer.

Every replay is audited with the rule version, the number of scopes replayed, and the number that
changed. The response is seen once by the operator who ran it; the audit entry is what an
investigation reads months later, and "a replay ran and changed nothing" versus "a replay ran and
rewrote four hundred customers" is the question such an investigation is actually asking.

### A consequence of FactDigest v2 worth knowing (review finding I-13)

Revalidating a Phase 9A input under validator version 2 recomputes a different fact digest and
inserts a **second** fact row for the same provider transaction. This is absorbed for access —
entitlement-source identity is `(purchase lineage, Mosaic Product, grant version)`, never a fact id, so the
duplicate cannot double-grant and the checksum is unchanged. It is **not** absorbed for
`subscription_timeline_entries` (one entry per fact id, so the same purchase can render twice) or
for `subscription_snapshot_facts` (both facts are cited as evidence). The full statement is in the
header of migration `00029_billing_fact_shape_v2.sql`.

## The operator surface (dashboard)

Every surface described above authenticates a *machine*. The identity, access, and restore APIs
take their tenant entirely from a secret server key, which is exactly right for an application
backend and is something a browser must never hold. The consequence is structural: none of that
state was reachable from a dashboard session at all, and Mosaic Studio could not show a Billing
Customer.

The operator surface is the second door. It serves the same state, read through the same
repositories, behind a different lock.

| Question | Route |
| --- | --- |
| Which customers exist here? | `GET /v1/projects/{projectId}/environments/{environmentId}/billing/customers` |
| Who holds this identifier? | `POST …/billing/customer-lookups` |
| Everything about one customer | `GET …/billing/customers/{customerId}` |
| Their current entitlements | `GET …/billing/customers/{customerId}/entitlements` |
| Their subscriptions | `GET …/billing/customers/{customerId}/subscriptions` |
| Recompute their state | `POST …/billing/customers/{customerId}/sync-requests` |
| One subscription | `GET …/billing/subscriptions/{instanceId}` |
| Why it changed | `GET …/billing/subscriptions/{instanceId}/timeline` |
| Restore and sync jobs | `GET …/billing/restore-jobs`, `GET …/billing/restore-jobs/{restoreId}` |
| Disputed identities | `GET /v1/projects/{projectId}/billing/identity-conflicts` (+ `/{conflictId}`) |
| Settle a dispute | `POST /v1/projects/{projectId}/billing/identity-conflicts/{conflictId}/resolution` |

Projection health and bounded projection replay already live on this surface and use the same
authorization; they are documented under *Projection health* and *Projection replay and rule
versions*.

### Who can see what, and why the server decides it

Authentication is the opaque browser session (ADR-0017); authorization is the actor's
**organization role, resolved in SQL against `organization_members` alongside every query**. Owner
and admin reach this surface; every other role is refused. That is the same bar the Phase 9A
ledger, quarantine, and reconciliation pages use, and it is a deliberate step above plain project
membership: this is the most sensitive read Mosaic offers, because it names who bought what.

Three properties are worth stating explicitly, because each one is a decision rather than a
default.

- **The dashboard is not trusted to hide anything.** No route relies on a client not asking. A
  session that is authenticated but not owner or admin receives `403` with the standard error
  envelope, and a session belonging to another organization receives `404` — because telling a
  caller that a Project exists but is not theirs is an existence oracle over other tenants.
- **The Environment on the route is checked for containment.** Pairing a Project you can read with
  an Environment you cannot would otherwise pass the role check while every subsequent query,
  which filters on `environment_id`, answered about someone else's Environment. A Subscription
  Instance belonging to another Environment is likewise reported as absent rather than forbidden.
- **Enablement is checked after authorization.** "Billing is not enabled for this Project" is
  itself information about a Project, and a caller who may not read the Project must not learn it.

The secret-server surfaces are untouched by any of this. They are the application-backend
contract, and adding a browser-reachable route to them would have handed a public front end the
credential that names a customer.

### The lookup is read-only by construction

`POST …/billing/customer-lookups` takes a typed identifier — `billing_customer_id`,
`application_user_id`, or `installation_id` — and answers with at most one customer summary.

It is not the trusted identify endpoint. That one is create-or-get, and using it as a search would
mint one Billing Customer per mistyped support query, which is precisely the duplicate-customer
trap plan §5a exists to avoid. The read model behind the operator surface declares **no writer at
all**, so this is a property of the code rather than a promise about it.

The submitted value is digested server-side under the same domain separation the alias table uses,
and is never stored, never logged, and never echoed — which is also why the operation is a POST
with a body rather than a GET with a query string that would be written to access logs, proxy
logs, browser history, and referrer headers. It is rate limited in the export-class bucket,
because it is the one operator surface that accepts an attacker-chosen identifier and reports
whether it matched.

`application_user_id` resolves through the active alias resolution. `installation_id` resolves
through **association evidence**, because an installation identifier is evidence and never an
anchor (plan §5a rule 2a) and therefore has no alias resolution to read. Reading recorded evidence
backwards for an authorized operator is a different act from letting a client-asserted identifier
select a customer at request time, and the two stay different because this path exists only behind
the authorization above.

A miss answers `200` with `found: false` rather than `404`: "no customer holds this identifier" is
a true and useful answer to a support question.

### What a customer detail actually shows

One read returns the lifecycle, the Environment's current snapshot version and as-of instant,
aliases, purchase lineages, subscriptions, one-time purchases, identity conflicts on either side,
the current entitlement entries with their sources, and projection status. It is one call rather
than eight so the page describes one instant — an operator comparing a snapshot version against a
projection status assembled from eight requests would be comparing eight different moments.

`currentSnapshot` is **absent**, not empty, when the customer has never been projected in this
Environment. "No answer yet" and "no entitlements" are different states and the surface keeps them
different.

Aliases appear as protected representations: `aliasId`, `aliasType`, authority, verification
status, and validity dates. There is no value field and no digest field anywhere in the response
shape. The alias id is random and identifies the row for a revocation; an alias digest is still a
stable per-person identifier and would let one tenant's export be joined against another's, so it
never leaves the persistence layer.

The list distinguishes `identified` from `purchaseAnchored` as two independent booleans rather
than one state, because the interesting customers are the ones where they disagree: a
purchase-anchored customer who never identified is real revenue with no person attached, and an
identified customer with no purchase is a person with no revenue.

The Environment filter admits a customer holding a pointer or a lineage in this Environment, and
additionally a customer holding a lineage in no Environment at all — a customer created by a
trusted identify and not yet party to any purchase belongs to the Project and to no Environment,
and hiding it everywhere would make a just-created customer invisible.

### Resolving a conflict from the dashboard

Identity conflicts are Project-scoped and the route says so. A conflict is a dispute about who a
person is, and identity in Mosaic belongs to the Project (OD-3(b)); filing the page under an
Environment would imply it could be resolved differently in staging than in production.

The resolution endpoint speaks the OD-10 vocabulary — `keep_existing`, `reassign_to_candidate`,
`operator_split` — mapped in exactly one place onto the schema's `assigned_first`,
`assigned_second`, `detached_both`. `reason` is **required**: every action moves committed access
for at least one paying customer, and the audit entry an investigation reads months later is worth
nothing without the why. The reason is written to the conflict's detail document and to the audit
event, so it survives a later resolution rewriting the row.

The endpoint delegates the whole operation to the identity service rather than issuing SQL of its
own. That service applies the assignment under a row lock, unfreezes the disputed subject, audits,
and reprojects **both** candidates — the loser included, because the loser is the one holding a
committed snapshot that still grants the purchase. Duplicating that sequence behind a second write
path is how two copies come to disagree, so there is only one.

### "Sync now" is not a restore

`POST …/customers/{customerId}/sync-requests` enqueues a recomputation of the customer's
entitlement aggregate and reaches the same enqueue the trusted surface does, so an operator's
button and a backend's call produce one job on one queue rather than two answers. It computes
nothing itself.

It is deliberately not a restore. A restore needs a device to ask its store for purchases, which
no operator can do on a customer's behalf, and a control that claimed to would report a native
outcome nobody produced. Restore visibility on this surface is read-only.

## Projection health

`GET /v1/projects/{projectId}/environments/{environmentId}/billing/projection-health` is a sibling
of the Phase 9A `billing/health` route, not a field on it. Billing health answers "can Mosaic still
turn store notifications into facts?"; projection health answers "is the authoritative answer
Mosaic gives about a customer's access still current?". An operator paged about one almost never
wants the other's numbers mixed in.

It reports the projection backlog and its oldest queued age, failed jobs and the failure rate over
the last hour, stale and never-projected customers, open identity conflicts, frozen and unresolved
lineages, the count of `unknown` entries on current snapshots, the restore backlog, the webhook
backlog and exhausted deliveries, and the active projection rule version. Everything is a count or
a timestamp; nothing on the surface can carry a customer value, an alias digest, or a secret.

Per-table row counts for all Phase 9B tables are published as
`mosaic.billing.table.rows{phase="9b",table=…}` from the worker. Plan §15 decided snapshot
retention with no drill baseline to extrapolate from — Phase 8 drills 4 and 5 were never run and
nothing is partitioned — so the trend has to start being recorded before it is needed. The counts
come from planner statistics rather than `count(*)`, because an exact count of the whole 9B schema
on every scrape is a self-inflicted load problem and the question being asked is a trend question.

### Operational note: a systematic intake failure is hard to read from quarantine alone

Phase 9A's quarantine surface records **one row per credential per reason per hour**, and the
notification identifiers behind it are not recoverable from that row. That is the deliberate
unbounded-growth control and it is the right trade — a store that starts rejecting every
notification would otherwise write a row per delivery — but it has a diagnostic cost worth
knowing before it is paid.

The Phase 9B demonstration hit exactly that case (`docs/reviews/phase-9b-demo-evidence.md`,
D-0): seven of eighteen notifications were accepted with `202`, produced no Raw Billing Input,
and collapsed into a single `signature_invalid`/`intake_attribution_failed` row. Nothing was
wrong with Mosaic — the payloads' signing chain had genuinely expired as of their `signedDate` —
but from the quarantine surface alone the operator can see only that *something* in that hour
failed signature verification, not which deliveries or how many.

When intake starts failing systematically, read the ledger and the raw-input counts alongside
quarantine rather than the quarantine surface on its own: the count of inputs accepted versus
facts recorded over the same window is what makes the size of the problem visible.

## Observability

Spans: `billing.token.issue`, `billing.token.revoke`, `billing.entitlement.sync`,
`billing.entitlement.check`, alongside the projection spans from the same phase.

Metrics:

| Metric | Meaning |
| --- | --- |
| `mosaic.billing.token.issued` | Tokens minted. |
| `mosaic.billing.token.rejected` | Rejected presentations, labelled by stage. The `tenant_mismatch` label is a security signal, not a client bug. |
| `mosaic.billing.sync.results` | Sync outcomes, labelled `snapshot` / `unchanged` / `unavailable` / `customer_mismatch`. The ratio of `unchanged` to `snapshot` is the ETag hit rate. |
| `mosaic.billing.sync.latency` | Sync latency in milliseconds. |

Sync is expected to be the highest-QPS authenticated surface Mosaic serves. It carries its own
rate-limit bucket rather than sharing the observation bucket, keyed on the presented SDK key's
prefix so one carrier NAT does not become one bucket. **The limiter is in-process**: with more
than one API instance the effective limit is the configured limit times the instance count.
That is a documented limitation, not an oversight.

## Logging and redaction

Never logged, on any path: the token value, any alias value, any provider purchase token, any
Authorization header. Logged instead: `billing_token_id`, `project_id`, `environment_id`,
`billing_customer_id`, and Mosaic's own stable diagnostic codes.

`response.Error` records the cause behind every 5xx to the operator log and never to the
response body; on these surfaces a cause can quote a credential, so no handler populates the
`Cause` field.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `MOSAIC_BILLING_ENTITLEMENT_SYNC_PER_MINUTE` | `1200` | Sync requests per bucket per minute. |
| `MOSAIC_BILLING_ENTITLEMENT_SYNC_BURST` | `240` | Sync burst allowance. |
| `MOSAIC_BILLING_ENTITLEMENT_REFRESH_AFTER` | `1h` | When a reader should refresh. |
| `MOSAIC_BILLING_ENTITLEMENT_VALID_FOR` | `168h` | Hard end of authoritative validity. |
| `MOSAIC_BILLING_ENTITLEMENT_STALE_GRACE_HOURS` | `24` | Bounded grace past validity. `0` is a strict policy. |
| `MOSAIC_BILLING_WEBHOOK_ALLOW_PRIVATE_DESTINATIONS` | `false` | The self-hosted SSRF exception. Deployment-level only; never a per-destination toggle. |

Billing remains off by default at both levels; these surfaces are not registered unless
`MOSAIC_BILLING_ENABLED` is set, and they answer `billing_not_enabled` for any Project that has
not opted in.

## Not yet in this document

Nothing from the Phase 9B backend scope remains undocumented here. What is deliberately absent is
deferred rather than missing: the shadow diff engine (OD-11(a) — replay plus checksum comparison
stands in for it until a second rule version exists), the nine reserved webhook event types, a
dashboard UI for webhooks (OD-1(b) is API-only), and everything in the plan's §18 Phase 9C
exclusion list. Quarantine still has structurally no mark-as-valid path.
