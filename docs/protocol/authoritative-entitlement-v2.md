# Authoritative Entitlement Contract v2

Authoritative Entitlement `2` adds access-authority awareness without changing
the strict Authoritative Entitlement `1` snapshot body. The v1 snapshot payload
is embedded under `payload.snapshot`; `payload.authority` and
`snapshotAuthorityDigest` bind it to an explicit authority epoch and
`(project, environment, application, platform)` scope.

The v2 record set is `entitlementSyncRequest`,
`customerEntitlementSnapshot`, `snapshotUnchanged`, and
`authorityUnavailable`. All require the exact contract discriminator `"2"`.

## Request negotiation

A sync request carries application identifier, `ios` or `android` platform,
app version, SDK version, supported entitlement-contract versions, and explicit
authority capabilities. A v2 request must advertise `authority_epoch`.

The request may carry `knownSnapshotAuthorityDigest` in canonical
`sha256:<64 lowercase hex>` form. It identifies the exact retained
authority-bound snapshot only for verification. It is never a customer,
tenant, scope, or authority selector, and the server still derives those
bindings from authentication. If the digest is absent or differs from the
current snapshot, the server returns a full snapshot. `snapshotUnchanged` is
eligible only when the digest matches exactly and the authenticated current
scope, authority epoch, and snapshot version are all unchanged.

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

## Cache order and safe failure

Authority epoch is evaluated before snapshot version:

1. Reject an older authority epoch even when its snapshot version is higher.
2. Accept a newer authority epoch even when its snapshot version is lower.
3. Within one epoch, apply ordinary monotonic snapshot ordering.

Legacy v1 cache entries have `authority_unknown`. Unknown authority is
unavailable, never inactive. A scope mismatch clears the mismatched cache and
reports unavailable. Cache integrity binds customer, Environment, Application,
platform, and epoch. An authority transition triggers urgent entitlement sync
before normal configuration refresh.

Purchase provider and access authority remain independent. When the epoch says
Mosaic is authoritative, targeting uses only Mosaic-authoritative access; a
reader never unions provider-observed access.

The additional digest is SHA-256 over canonical sorted-key JSON of
`{ "authority": ..., "snapshot": ... }`, preventing replay into another epoch
or scope.

## Unchanged responses

`snapshotUnchanged` embeds the exact v1 `snapshotUnchanged` payload under
`payload.unchanged`. It therefore carries customer, Project, Environment,
snapshot version, entity tag, issued/evaluation/refresh/validity times,
projection status, and correlation ID. Confirmation slides `refreshAfter` and
`validUntil`; it is not a reduced non-sliding acknowledgement.

The surrounding authority and `snapshotAuthorityDigest` must identify the
retained full snapshot exactly. A reader verifies equal authority scope,
customer, Project, Environment, snapshot version, entity tag, evaluation and
projection state, validates the v1 freshness horizon, and rejects a regressing
freshness window. The canonical iOS and Android request/full/unchanged triples
exercise the same rules with exact platform and Application scope. A request
without the optional known digest remains valid for backward compatibility but
always receives a full snapshot.
