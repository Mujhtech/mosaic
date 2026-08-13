# Billing State Webhook Contract v2

Billing State Webhook `2` is the single version of this contract. It carries
explicit authority scope, epoch, kind, transition state, cutover time, and
snapshot-authority digest on billing-state notifications, together with the
full Contract 1 surface: the ten-member reserved event vocabulary, the
four-axis `stateSummary`, `sourceReason`, diagnostics, and the operator-facing
delivery-attempt record, all in one envelope schema
(`schema/billing-state-webhook/v2/contract.schema.json`). Signing is
HMAC-SHA256 over the exact raw request body, delivery is at-least-once with
stable event IDs across retries, and consumers are tolerant readers.

The event-type set is closed at fourteen members: `customer.entitlements.changed`
plus the nine reserved Contract 1 names (`subscription.state.changed`,
`subscription.period.changed`, `subscription.renewal_intent.changed`,
`subscription.expired`, `subscription.revoked`, `subscription.refunded`,
`customer.billing_identity.conflict`, `customer.projection.failed`,
`customer.projection.recovered`) plus the four authority transitions. Reserved
names have defined meanings, and a producer that emits one before it is
specified is a defect. No member names a provider. Authority-transition events
do not claim an entitlement delta. An event remains a notification: a consumer
re-reads Authoritative Entitlement `2` for current state.

Authority transition names are structurally bound to one exact state:

| Event | Authority kind | Transition state |
| --- | --- | --- |
| `authority.cutover.pending` | `source` | `cutover_pending` |
| `authority.cutover.completed` | `mosaic` | `stabilizing` |
| `authority.rollback.completed` | `source_rollback` | `rolled_back` |
| `authority.stabilization.completed` | `mosaic` | `stable` |

A mismatched kind or transition state is a producer-invalid document, not a
consumer hint.

## Event semantics

`occurredAt` never follows `createdAt`. `changedEntitlements` ascend and are
unique by `entitlementKey`. Within one authority epoch, `snapshotVersion`
advances past `previousSnapshotVersion`; a rollback opens a new epoch whose
versions restart, and the reader orders by `authorityEpoch` before
`snapshotVersion`. An event with entries but no state change is a producer
defect unless `sourceReason` is `subscription_period_changed`,
`renewal_intent_changed`, or `grant_version_changed` — a period extension and
a cancellation are real changes even though nothing gained or lost access.
`stateSummary.accessState` is never `unavailable`: an event is not a read, so
Mosaic's ability to answer is not one of its states. No provider secret,
purchase token, or raw provider payload crosses this contract.

The delivery-attempt record is dashboard- and API-facing only: it is never
sent to a destination, and it carries no destination URL and no signing
secret. `attempt` never exceeds `maxAttempts`, `exhausted` means the attempts
actually ran out, and a response status must agree with the recorded outcome.

## Conformance requirements for a consumer implementation

The requirements are normative and pinned by `consumerPolicyErrors` in
`protocol/tools/phase9c-contract-validation.mjs`, which fails validation if
any of `consumerPolicy.authoritativeState`, `signatureVerification`,
`duplicateEvent`, or `ordering` is dropped or reworded.

A conforming consumer **MUST** verify the signature before parsing, **MUST**
deduplicate by `eventId`, **MUST** ignore an event carrying an older snapshot
version, **MUST** re-read the authoritative snapshot before acting, and
**MUST NOT** project, cache, or persist entitlement state from a webhook
payload — including `changedEntitlements`, `stateSummary`, and every authority
field the event carries. `authorityEpoch`, `transitionState`, and
`snapshotAuthorityDigest` are notifications that the authority moved, not a
licence to change which authority the consumer believes is current; that too
comes from the snapshot read. The tolerant `ignore` arms for unknown fields,
event types, and enumeration members are safe only alongside these
obligations.

Redelivery retries an existing signed logical event with the same event ID; it
does not create a new state transition.
