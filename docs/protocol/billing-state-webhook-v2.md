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

Destinations configured for Webhook `1` remain supported and receive only v1
events. They cannot satisfy the authority-aware production-readiness gate.
Redelivery retries an existing signed logical event with the same event ID; it
does not create a new state transition.
