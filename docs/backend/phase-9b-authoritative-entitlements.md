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
| Entitlement Source | One reason a customer holds an Entitlement. Identity is (lineage, Entitlement, grant version). |
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
If-None-Match: "<entity tag>"
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

A `304 Not Modified` is returned only when **both** the caller's stated snapshot version and its
entity tag match. The entity tag is an opaque equality token with no ordering; confirming on it
alone would confirm a cache whose monotonicity nobody checked.

A 304 carries no body, so the freshness window travels as headers on every response:

| Header | Meaning |
| --- | --- |
| `ETag` | Strong validator for this representation. |
| `Mosaic-Refresh-After` | After this instant a reader should refresh. The snapshot stays fully valid. |
| `Mosaic-Valid-Until` | Hard end of authoritative validity. |
| `Mosaic-Stale-Grace-Seconds` | Bounded window past `validUntil` in which previously active Entitlements may still be served, clearly marked stale. |

This is what "304 slides freshness" means: a confirmed-current snapshot gets a fresh window, so
a device that keeps confirming the same version never expires while it is demonstrably in
contact with the server.

Defaults are one hour to refresh, seven days of validity, and twenty-four hours of bounded
grace (OD-5), configurable per deployment. **The combined horizon — validity plus grace — is
capped at thirty days**, in code as well as in the contract. Past the grace window a reader
reports `unknown`, never `inactive`.

### States a reader must handle

| Condition | Answer |
| --- | --- |
| Customer never projected in this Environment | A valid snapshot with no entries and `projectionStatus.state: pending`. Not an error, not `inactive`. |
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
`detached_both` — after which the disputed subject is unfrozen and **both** candidate customers
are reprojected, not only the winner: the loser is the one holding the stale snapshot. There is
no automatic-merge path. Automatic merge stays an ADR checkpoint rather than something a
heuristic reaches on its own.

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

Billing remains off by default at both levels; these surfaces are not registered unless
`MOSAIC_BILLING_ENABLED` is set, and they answer `billing_not_enabled` for any Project that has
not opted in.

## Not yet in this document

The webhook delivery worker and destination management API (OD-1(b)), restore and sync jobs,
and the projection diagnostics surface land in the following backend batch and are documented
with them. ADR-0024 is the contract they implement.
