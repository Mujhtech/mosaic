# Authoritative Entitlement Contract v2

Authoritative Entitlement `2` is the single version of this contract. It is
the authority-aware synchronization surface plus every record type the
Contract 1 draft carried: the strict snapshot body, the entitlement check
question and answer, the subscription snapshot, and the restore result, all
dispatched through one envelope schema
(`schema/authoritative-entitlement/v2/contract.schema.json`) with the exact
contract discriminator `"2"`.

The record set is `entitlementSyncRequest`, `customerEntitlementSnapshot`,
`snapshotUnchanged`, `authorityUnavailable`, `entitlementCheckRequest`,
`entitlementCheckResult`, `subscriptionSnapshot`, and `restoreResult`. The
snapshot payload is embedded under `payload.snapshot`; `payload.authority` and
`snapshotAuthorityDigest` bind it to an explicit authority epoch and
`(project, environment, application, platform)` scope. The check,
subscription, and restore payloads are carried forward unchanged and are not
authority-wrapped: they are read-time and operator-facing surfaces, not device
caches.

## Request negotiation

A sync request carries application identifier, `ios` or `android` platform,
app version, SDK version, supported entitlement-contract versions (`"2"` is
the only member), and explicit authority capabilities. A request must
advertise `authority_epoch`. It may carry `requestedEntitlementKeys` to narrow
the response; unrecognized keys are project data and are accepted.

The request may carry `knownSnapshotAuthorityDigest` in canonical
`sha256:<64 lowercase hex>` form. It identifies the exact retained
authority-bound snapshot only for verification. It is never a customer,
tenant, scope, or authority selector, and the server still derives those
bindings from authentication. If the digest is absent or differs from the
current snapshot, the server returns a full snapshot. `snapshotUnchanged` is
eligible only when the digest matches exactly and the authenticated current
scope, authority epoch, and snapshot version are all unchanged.

The request may also carry an optional `correlationId`: an opaque
client-generated identifier that correlates the request with its response and
with the client's own logs. It is **diagnostic only** and never selects, binds,
or infers customer, tenant, scope, or authority — which is why it is safe to
accept from a client at all, and why it is optional rather than required.

`correlationId` was **required** on the Contract `1` sync request and was not
restated when `2` reworked request negotiation around authority scope. That was
an oversight rather than a supersession: `2` still requires it on the
entitlement check and restore requests, so a `2` client could correlate every
request except the one it makes most often. It was restored on 2026-08-13 when
Contract `1` was deleted (see
[ADR-0028](../architecture/decisions/0028-single-version-contracts.md)), as
optional rather than required, so that no already-written `2` request becomes
invalid.
`protocol/fixtures/authoritative-entitlement/v2/sync-request-correlated.json`
exercises it; the other sync fixtures leave it absent, so both branches are
pinned.

Project, Environment, and Billing Customer IDs are deliberately absent and
forbidden in the request body. The server derives customer binding from the
opaque Customer Access Token and tenant/Application binding from SDK
authentication. Accepting client-authored copies would create a second,
spoofable source of authority. Flutter sends `ios` or `android` according to its
host platform; there is no `flutter` platform member.

Responses carry server-directed minimum contract and SDK versions, a supported
app-version window, and required capabilities. Traffic outside the supported
window receives `authorityUnavailable` with `result: "unavailable"`; Mosaic
authority is never inferred.

If the server cannot load and verify the exact frozen support policy, it emits
`authorityUnavailable` with `reason: "policy_unavailable"`. That reason omits
`minimumSupport` because fabricating placeholder requirements would be
misleading. It is the only unavailable reason for which `minimumSupport` is
omitted, and the field is forbidden on that branch. Every other unavailable
reason still requires the exact frozen policy. `policy_unavailable` is safe
unavailable, never inactive, and never permits authority inference.

## Snapshot, check, subscription, and restore semantics

The snapshot is an immutable read model, never a bearer credential. Its
`contentDigest` is SHA-256 over the canonical serialization pinned in the
compatibility manifest and binds customer, Project, Environment, and version.
Entries ascend by `entitlementKey`, sources ascend by `sourceId`, an active
entry always has a granting source, and unresolved evidence yields `unknown`,
never `inactive`. Snapshot version `0` is the never-projected placeholder; the
ordinary monotonic gate replaces it because issued versions start at `1`.

The check result is the only surface where `unavailable` is admissible for an
Entitlement: it says Mosaic could not answer, not that the customer lacks
access. A persisted snapshot entry can never carry it. The restore result
reports the native provider outcome and Mosaic's authoritative outcome on
separate axes; `restored` requires the accepted snapshot version that proves
it. The subscription snapshot pins the four state axes (`accessState`,
`lifecycleState`, `renewalIntent`, `billingState`) with a `checksum` over the
same canonical serialization.

The freshness window is ordered `issuedAt <= refreshAfter <= validUntil`, and
`(validUntil - issuedAt) + staleGraceSeconds` may never exceed 30 days.
Bounded grace (24 hours) is the shipped default; strict is a grace of zero.
Past the grace window a reader reports `unknown`, never `inactive`.

## Cache order and safe failure

Authority epoch is evaluated before snapshot version:

1. Reject an older authority epoch even when its snapshot version is higher.
2. Accept a newer authority epoch even when its snapshot version is lower.
3. Within one epoch, apply ordinary monotonic snapshot ordering.

A cache with no recorded authority has `authority_unknown`. Unknown authority
is unavailable, never inactive. A scope mismatch clears the mismatched cache
and reports unavailable. Cache integrity binds customer, Environment,
Application, platform, and epoch. An authority transition triggers urgent
entitlement sync before normal configuration refresh.

However a record is rejected — unknown version, unknown record type, unknown
field, unknown enumeration member, digest mismatch, regression — the reader
reports `unknown` and preserves its cache. `inactive` is only ever the result
of a snapshot Mosaic issued and the reader fully accepted. The compatibility
manifest pins this as `readerPolicy` and the validator rejects any policy
string that resolves to inactive.

Purchase provider and access authority remain independent. When the epoch says
Mosaic is authoritative, targeting uses only Mosaic-authoritative access; a
reader never unions provider-observed access.

The authority digest is SHA-256 over canonical sorted-key JSON of
`{ "authority": ..., "snapshot": ... }`, preventing replay into another epoch
or scope.

## Unchanged responses

`snapshotUnchanged` embeds the exact `snapshotUnchanged` payload under
`payload.unchanged`. It therefore carries customer, Project, Environment,
snapshot version, entity tag, issued/evaluation/refresh/validity times,
projection status, and correlation ID. Confirmation slides `refreshAfter` and
`validUntil`; it is not a reduced non-sliding acknowledgement.

The surrounding authority and `snapshotAuthorityDigest` must identify the
retained full snapshot exactly. A reader verifies equal authority scope,
customer, Project, Environment, snapshot version, entity tag, evaluation and
projection state, validates the freshness horizon, and rejects a regressing
freshness window. The canonical iOS and Android request/full/unchanged triples
exercise the same rules with exact platform and Application scope. A request
without the optional known digest remains valid but always receives a full
snapshot.
