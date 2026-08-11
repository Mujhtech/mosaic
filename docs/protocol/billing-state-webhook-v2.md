# Billing State Webhook Contract v2

Billing State Webhook `2` adds explicit authority scope, epoch, kind,
transition state, cutover time, and snapshot-authority digest to billing-state
notifications. It retains v1 HMAC-SHA256 signing, at-least-once delivery,
stable event IDs across retries, and tolerant-consumer behavior.

V2 declares entitlement-change plus cutover-pending, cutover-completed,
rollback-completed, and stabilization-completed events. Authority-transition
events do not claim an entitlement delta. An event remains a notification: a
consumer re-reads Authoritative Entitlement `2` for current state.

Authority transition names are structurally bound to one exact state:

| Event | Authority kind | Transition state |
| --- | --- | --- |
| `authority.cutover.pending` | `source` | `cutover_pending` |
| `authority.cutover.completed` | `mosaic` | `stabilizing` |
| `authority.rollback.completed` | `source_rollback` | `rolled_back` |
| `authority.stabilization.completed` | `mosaic` | `stable` |

A mismatched kind or transition state is a producer-invalid document, not a
consumer hint.

Producer documents are strict. Consumers ignore unknown fields and event types
after verifying the signature, deduplicate by `eventId`, and re-read the
snapshot. Signing continues to cover the exact raw request body with the v1
HMAC signing string; contract version `2` does not mean signing version `2`.

## Conformance requirements for a consumer implementation

V2 inherits v1's consumer contract unchanged, with the snapshot re-read pointed
at Authoritative Entitlement `2`. The requirements are normative and pinned by
`consumerPolicyErrors` in `protocol/tools/phase9c-contract-validation.mjs`, which
fails validation if `consumerPolicy.authoritativeState` is dropped or reworded
from `reReadAuthoritativeEntitlementV2`.

A conforming consumer **MUST** verify the signature before parsing, **MUST**
re-read the authoritative snapshot before acting, and **MUST NOT** project,
cache, or persist entitlement state from a webhook payload — including
`changedEntitlements`, `stateSummary`, and every authority field the event
carries. `authorityEpoch`, `transitionState`, and `snapshotAuthorityDigest` are
notifications that the authority moved, not a licence to change which authority
the consumer believes is current; that too comes from the snapshot read. See
[v1 conformance requirements](billing-state-webhook-v1.md#conformance-requirements-for-a-consumer-implementation)
for the full list and the failure it prevents.

Destinations configured for Webhook `1` remain supported and receive only v1
events. They cannot satisfy the authority-aware production-readiness gate.
Redelivery retries an existing signed logical event with the same event ID; it
does not create a new state transition.
