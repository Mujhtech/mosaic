# Billing Migration Operations Contract v1

Billing Migration Operations `1` is the strict, server-facing operator contract
for the Phase 9C RevenueCat migration vertical slice. It is born `draft` and is
not generated into the browser contract. Canonical artifacts live under the
matching schema, compatibility, and fixture directories in `protocol/`.

The closed record set covers the migration program and explicit scope,
capability assessment, source manifest, frozen mapping set, import batch,
dry-run result, divergence, readiness assessment, checkpoint, approval,
cutover/rollback command, reconciliation case, allowlisted repair, completion
report, and webhook redelivery command. It also includes durable source-pull
jobs and server-returned operator capabilities.

## Durable source pulls

`sourcePullJob` is both the strict `sourcePull` request envelope and the
server-returned durable job state. Every job binds one intent
(`snapshot`, `delta`, or `final_delta`) to an idempotency key and exact expected
program state version. Delta intents must carry the exact opaque starting
cursor, watermark, and watermark digest; snapshots must not carry a starting
position.

Job status is closed to `pending`, `running`, `completed`, or `failed`.
Pending and running jobs cannot claim results. Failed jobs carry only their
failure timing and code. Completed jobs carry digest-bound references for the
encrypted source object, source manifest, and provider-validation import. A
completed `final_delta` carries its final-delta evaluation reference once the
referenced provider-validation import reaches `completed`. Before that import
settles, the evaluation reference is absent. The server queues the evaluation
automatically; there is no separate public final-delta command.

## Operator capabilities

`operatorCapabilities` is a closed, server-returned set of command-specific UI
affordances for one actor, program, and state version. The vocabulary is:

`view`, `manage-source`, `manage-mappings`, `run-import`, `assess-readiness`,
`propose-cutover`, `approve-cutover`, `execute-cutover`, `execute-rollback`,
`execute-repair`, `remove-credential`, `manage-legal-hold`,
`complete-migration`, `redeliver-webhook`, and `delete-source`.

Capabilities help an operator surface explain which actions are currently
available. They are evidence for affordances only. The backend must authorize
every command again and remains authoritative even when a returned capability
contains the corresponding string.

## Frozen safety rules

- Scope is an explicit list of `(applicationId, platform)` pairs inside one
  Project and Environment. Wildcards and inferred whole-environment scope are
  invalid.
- RevenueCat is the only v1 source adapter. A source record never becomes a
  Transaction Fact. Provider revalidation independently emits an ordinary fact
  through Billing Ingestion; the source record remains immutable evidence.
- Source identifiers are distinct from Mosaic internal IDs. They are bounded
  opaque strings preserved byte-for-byte and admit RevenueCat identifiers such
  as `$RCAnonymousID:...`; Mosaic IDs retain their stricter pattern. No source
  identifier is trimmed, case-folded, parsed as email, or normalized into a
  heuristic identity.
- Identity matching is exact identifiers or audited aliases only. Email,
  fuzzy, device, and transfer-heuristic matching are unrepresentable.
- When provider revalidation is impossible, a source-access exception is
  restricted to one explicit Application/platform scope, expires, records a
  reason, affected-customer count, rollback treatment, zero identity ambiguity,
  and two distinct approvers. It never creates a Transaction Fact.
- A production-ready assessment requires 100% current-access mapping and
  evidence coverage, zero unresolved Critical or Blocking divergences, a final
  delta, fresh watermarks, and authority-aware supported app versions.
- Stabilization and rollback default to seven days. Each program records a
  bounded value frozen by its policy; seven is not the only valid duration.
- Approval output always records both proposer and approver identities, but it
  intentionally does not repeat the program Environment. The server derives
  Environment from the referenced program: production cutover and rollback
  require two distinct humans, while development and sandbox permit one
  authorized operator to propose and approve. Portable record validation must
  therefore accept equal identities; server authorization and program lookup
  enforce the environment-specific rule.
- Source-access exceptions are stricter than migration approvals: their
  proposer and approver must always be distinct in the portable contract,
  regardless of Environment.
- Cutover and rollback carry an idempotency key, expected state version,
  expected digests, checkpoint, approval, reason, explicit scope, and expected
  authority epoch. A precondition mismatch rejects without changing authority.
- Source pulls are durable idempotent jobs. A delta cannot begin without its
  exact cursor/watermark binding, and result references are present only for a
  completed job with the intent-specific final-delta requirement enforced.
- Cutover freezes exactly the scope, manifest, mapping, policy, evidence,
  readiness, final-watermark, application-version, and approval digests.
  Rollback freezes exactly the checkpoint, current-authority,
  rollback-prerequisites, and approval digests. Missing or extra keys are
  malformed; stale state/digests and an expired approval reject at execution.
- Repair is allowlisted. There is no arbitrary row edit, fact or snapshot
  mutation, `mark active`, or permanent-grant command.
- Every repair execution records a bounded typed scope (at most 100 exact
  references), actor, linked case, idempotency key, reason, pre-state digest,
  and a closed execution status. `executionStatus` is exactly `pending` or
  `completed`. A completed execution has a closed result of exactly
  `succeeded`, `failed`, or `no_change` and requires the after-state digest.
- `pending` is the only non-terminal execution status. It means provider
  validation was accepted but the durable execution reservation remains
  unsettled. A pending action must not carry `afterDigest`; retrying the same
  idempotent execution keeps its execution identity until it reaches one of the
  three terminal statuses.

Completion is representable only after stabilization and rollback windows end.
The migration credential must be removed at or after the rollback-window end.
Without legal hold, raw source deletion is scheduled exactly 30 days after
completion; legal hold suppresses that deletion schedule while retaining the
hold explicitly.

Authority epochs only increase: source epoch N, Mosaic epoch N+1, and source
rollback epoch N+2. Rollback restores checkpointed authority and pointers; it
does not erase Mosaic history.

Readers require the exact discriminator
`billingMigrationOperationsContractVersion: "1"`. Adding a record type,
command, repair kind, adapter, or divergence vocabulary member is breaking once
this draft is approved.

The REST execution endpoint should map a newly pending repair to `202 Accepted`,
not `201 Created`. Its operation body reports the stable execution identifier,
  `executionStatus: "pending"`, and the pre-state digest while omitting terminal
`afterDigest` and `resultDigest` fields. A replay that is still pending remains
`202`; a settled idempotent replay is `200`, and a newly settled execution is
`201`. OpenAPI and generated clients must preserve the same closed status and
conditional terminal fields.
