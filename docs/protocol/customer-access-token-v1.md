# Customer Access Token Contract v1

Customer Access Token Contract `1` defines how an SDK proves it may read one
Billing Customer's authoritative Entitlements. It is a **draft** and reaches
`approved` only through an explicit product-owner decision.

A public SDK key identifies an application. It can never select a Billing
Customer, and an application user ID is guessable, so neither is sufficient to
read someone's access. The Customer Access Token is what closes that gap.

Canonical artifacts:

- `protocol/schema/customer-access-token/v1/token.schema.json`
- `protocol/schema/customer-access-token/v1/compatibility-manifest.schema.json`
- `protocol/compatibility/customer-access-token/v1.json`
- `protocol/fixtures/customer-access-token/v1/`
- `protocol/customer-access-token/CHANGELOG.md`

## The token is opaque, not signed

**Owner-approved deviation (OD-14).** The orchestration prompt's token
requirement list says "signed". Mosaic v1 tokens are **opaque random bytes**
instead. This is recorded here as an explicit deviation rather than a quiet
substitution, and it is pinned in the manifest
(`tokenModel.signed: false`) so it cannot drift back without a visible contract
change. A validator guard fails the build if the contract ever grows a signing
vocabulary — `alg`, `kid`, `jwk`, `jws`, `signature`, a key identifier — or a
property whose name suggests the token carries access state.

The token is:

```text
mcat_<43 base64url characters>        # 256 bits of randomness, 48 characters
```

Mosaic stores **only the SHA-256 digest** of the token, alongside columns for
Project, Environment, Billing Customer, audience, scopes, and expiry. There is
no header, no claim set, no signature, and nothing parseable. The token is
returned exactly once, at issuance, and Mosaic can never reproduce it.

Why opaque beats signed here, against the prompt's own requirement list:

| Requirement | Opaque | Signed JWS |
| --- | --- | --- |
| short lived | expiry column | `exp` claim |
| scoped to Project and Environment | composite-FK columns, enforced by the same authorization path as every other Mosaic resource | claims, validated by a second, parallel code path |
| scoped to one Billing Customer | column | claim |
| audience restricted | column | `aud` claim |
| **revocable where practical** | **one `UPDATE`, effective immediately and everywhere** | not revocable without a revocation list, which is a second lookup that reintroduces the database read a signed token existed to avoid |
| free of provider secrets | nothing inside to leak | nothing inside to leak |
| minimal in claims | no claims at all | minimal claims |
| safe to refresh through the host backend | yes | yes |

A signed token satisfies "revocable where practical" only by adding the
server-side lookup that is a signed token's entire advantage. It would also
require a signing-key ADR, a JWKS surface, key rotation, and clock validation on
devices — four new failure modes, none of which buys anything Mosaic needs.
ADR-0017's posture (secrets stored as digests, never recoverable) already covers
opaque credentials.

## Envelope and record types

```json
{
  "customerAccessTokenContractVersion": "1",
  "recordType": "customerAccessTokenMetadata",
  "payload": {}
}
```

`additionalProperties` is `false` at every level. Every record is server-side
metadata **about** a token; none of it is content **inside** one.

| Record type | Meaning |
| --- | --- |
| `customerAccessTokenIssuanceRequest` | The host backend asks for a token for a user it has authenticated |
| `customerAccessTokenIssuanceResult` | The only record that ever carries the token value |
| `customerAccessTokenMetadata` | Everything Mosaic knows about a token |
| `customerAccessTokenRevocation` | An immediate, audited revocation |

## Issuance

```text
Host application backend
→ authenticates its own user
→ POSTs an issuance request with its Mosaic secret_server key
→ receives the token exactly once
→ returns it to the app
→ SDK attaches it to every entitlement sync
```

The issuance request carries `billingCustomerId`, `audience`, `scopes`, an
optional `requestedTtlSeconds`, and a `correlationId`. It carries **no
`projectId` and no `environmentId`**: tenant scope is derived from the
authenticated secret server key, exactly as Billing Ingestion derives it. A
request that could name a Project would let a careless or compromised caller mint
a token into a tenant it does not own. A test asserts those two properties stay
absent from the request shape.

`requestedTtlSeconds` is a request, not an instruction. Mosaic clamps it: a
caller may shorten a token's life but never lengthen it past the maximum.

## Audience, scopes, and binding

- **Audience** is `sdk_sync` in Phase 9B. The enumeration is closed, so it is
  over-provisioned: `server_check` is declared now, reserved for a future
  server-facing audience and **not issued in 9B**, because adding an audience to
  a closed enumeration later would cost a contract version. A token minted for
  one audience is refused by every other surface.
- **Scopes** are `entitlements.read`, `entitlements.sync`, and
  `restore.request`. A token carries the least it can; `restore.request` is
  granted only to a client that may trigger a restore.
- **Binding** is one Project, one Environment, and one Billing Customer, all
  required. A request that asserts a different customer is refused
  (`readerPolicy.customerMismatch: "refuseRequest"`); the assertion never selects
  the customer.

Scope and binding are evaluated against stored columns, not against claims
presented by the caller. There is no claims-validation step because there are no
claims.

## Lifetime and clock skew

| | |
| --- | --- |
| Default | 3600 s (1 hour) |
| Maximum | 86400 s (24 hours) |
| Minimum | 60 s |
| Clock skew tolerance | ±60 s |
| Evaluated by | **the server** |

A short life is the only thing limiting the damage of a leaked opaque token, so
the maximum is enforced by the semantic validator as well as pinned in the
manifest. The **server** evaluates expiry: a device clock is attacker-controlled
and never decides whether a token is still valid.

## Revocation

Revocation is immediate and server-side: the digest row is marked, and the next
presentation fails regardless of how long the token had left to live. Reasons are
closed and over-provisioned: `customer_signed_out`, `identity_changed`,
`operator_revoked`, `customer_deleted`, `key_rotated`, `suspected_compromise`,
`superseded_by_new_token`.

Revocation state is all-or-nothing in the schema: `status: "revoked"` requires
both `revokedAt` and `revocationReason`, and an `active` or `expired` token may
carry neither.

## Wire form

**Contract-owned. These names are final and are pinned in the manifest**, so a
rename is a contract change rather than an implementation detail:

```http
POST /v1/sdk/billing/entitlements
Authorization: Bearer mcat_<43 base64url characters>
Mosaic-SDK-Key: <public SDK key>
Content-Type: application/json

{ "authoritativeEntitlementContractVersion": "1", "recordType": "entitlementSyncRequest", "payload": { ... } }
```

The sync surface is a `POST` because contract negotiation and the conditional
`knownSnapshotVersion` / `entityTag` live in the
[`entitlementSyncRequest`](authoritative-entitlement-v2.md#request-negotiation)
body rather than in headers. An SDK does not use conditional `GET`,
`If-None-Match`, or a bare `304`; the unchanged path is a `200` carrying the
`snapshotUnchanged` record.

Both headers are required. `wireForm.publicSdkKeyAloneSufficient` is `false`:
the public SDK key identifies the application, the customer token selects the
customer, and neither substitutes for the other.

`readerPolicy.tokenInQueryString` is `forbidden`. Query strings end up in access
logs, proxy logs, and browser history.

### Observation submission

The SDK also attaches the token, when it holds one, to Billing Ingestion
observation submissions, as the optional `Mosaic-Customer-Token` request header.
This lets the server record submission-context association evidence — that the
request submitting a provider transaction was authenticated as a known customer.

The header is transport only. No Billing Ingestion record gains a field, and the
token never enters an observation body, because observation bodies are persisted
as raw validation inputs, replayed, and digested into fact identity — all three
of which a credential must never be. See
[the customer token is transport, not a record field](billing-ingestion-v1.md#the-customer-token-is-transport-not-a-record-field).

## SDK obligations

Accepting a token means accepting these. They are conformance obligations,
verified by inspection and by the SDK cache tests, not by any schema.

| Obligation | Rule |
| --- | --- |
| Storage | **Memory only.** Never written to disk, keychain, or preferences. |
| Attachment | Attach to every sync request. |
| Parsing | **Forbidden.** The token is opaque; nothing may be inferred from it. |
| Refresh on 401 | Exactly **one** forced refresh per token generation. A second 401 on a freshly minted token is a real failure; retrying forever turns an outage into a request storm. |
| On logout | Discard the token **and** clear the entitlement cache. |
| On identity change | Bump the generation, cancel in-flight requests, clear the cache before any read. |
| On token-provider failure | Report `unavailable`. **Never `inactive`.** A host backend that cannot mint a token has not revoked anyone's subscription. |
| Logging | **Forbidden.** The token never appears in a log, a diagnostic, a crash report, or telemetry. |

A `null` token or a signed-out user yields `unavailable`, consistent with
[Authoritative Entitlement v2](authoritative-entitlement-v2.md)'s top rule.

## What a token never contains

- Entitlement state. `tokenModel.carriesEntitlementState` is `false`, and a
  validator guard rejects any property name suggesting otherwise. A token that
  carried entitlements would keep granting them after a refund, for as long as it
  lived — there is nothing to revoke inside a bearer claim.
- Provider secrets, receipts, purchase tokens, or signing keys.
- Personal data. `actorReference` on a revocation is an opaque handle, never a
  name or an email address.

## Anonymous mode

Not supported in v1 (OD-4). Mosaic Billing requires an application backend. An
installation identifier is client-generated and guessable, so allowing it to
select a Billing Customer would let anyone read someone else's entitlements by
replay or by guess. The installation alias exists only as association evidence,
a cache key, and a restore hint; it can never create or select a customer.

## Reader sequence

1. Require exact `customerAccessTokenContractVersion: "1"`.
2. Reject the whole record on any unknown version, record type, field, scope, or
   audience.
3. Present the token in `Authorization: Bearer` with the public SDK key in
   `Mosaic-SDK-Key`, on a `POST` carrying the `entitlementSyncRequest` envelope.
4. On `401`, force **one** token refresh through the host backend, then retry
   once.
5. On expiry, revocation, or an audience or customer mismatch: the request is
   refused and the SDK reports `unavailable` — never `inactive`.

## Fixtures

`protocol/fixtures/customer-access-token/v1/` — 6 canonical fixtures in
`tokens/` and 9 in `invalid/`, including `token-carries-entitlement-claims.json`,
`token-shaped-as-signed-payload.json`, `token-missing-customer-binding.json`, and
the semantic `token-lifetime-exceeds-maximum.json`.

The `mcat_` value in `tokens/issuance-result.json` is **fabricated** — typed to
satisfy the pattern, never issued by any deployment, and therefore useless
anywhere. It is there because the issuance result is the only record that carries
a token value at all and an SDK author needs to see its shape. No fixture,
example, or document may ever carry a token a deployment actually minted: a
fixture is copied, committed, and published, so a real credential in one is a
leaked credential. The rule is recorded as a `$comment` on `tokenValue` in the
canonical schema.

## Related documents

- [Authoritative Entitlement Contract v2](authoritative-entitlement-v2.md)
- [Billing State Webhook Contract v2](billing-state-webhook-v2.md)
- [Compatibility policy](compatibility-policy.md) · [Versioning](versioning.md)
