# Phase 9C billing migration foundation

Stage 2B adds a PostgreSQL-backed `billingmigration` module to the existing API modular monolith.
It is an evidence and control-plane boundary only: source records cannot be written to
`billing_transaction_facts`, change current Entitlement pointers, issue Customer Access Tokens, or
emit customer-access webhooks.

## Operator API

- `POST /v1/projects/{projectId}/billing/migration-programs`
- `GET /v1/projects/{projectId}/billing/migration-programs`
- `GET /v1/projects/{projectId}/billing/migration-programs/{programId}`
- `GET /v1/projects/{projectId}/billing/migration-programs/{programId}/manifests`
- `GET|POST /v1/projects/{projectId}/billing/migration-programs/{programId}/mapping-sets`
- `POST /v1/projects/{projectId}/billing/migration-programs/{programId}/mapping-sets/{mappingSetId}/freeze`
- `GET|POST /v1/projects/{projectId}/billing/migration-programs/{programId}/import-batches`
- `GET /v1/projects/{projectId}/billing/migration-programs/{programId}/import-batches/{batchId}`
- `POST /v1/projects/{projectId}/billing/migration-programs/{programId}/dry-runs`
- `POST /v1/projects/{projectId}/billing/migration-programs/{programId}/shadow-runs`
- `GET /v1/projects/{projectId}/billing/migration-programs/{programId}/runs/{runJobId}`
- `GET /v1/projects/{projectId}/billing/migration-programs/{programId}/divergences`
- `POST /v1/projects/{projectId}/billing/migration-programs/{programId}/readiness-assessments`
- `GET /v1/projects/{projectId}/billing/migration-programs/{programId}/readiness-assessments/latest`

Creation requires an `Idempotency-Key`, owner membership, one Environment, and an explicit
non-empty list of Application/platform scopes. Members may view programs but cannot create them.
The source adapter is RevenueCat v2 only.

Manifest append is deliberately internal in Stage 2B. There is no REST command accepting an
operator-supplied storage key: the future ingestion worker must verify a server-issued object
reference, Project/program ownership, private visibility, encryption metadata, size, and checksum
before calling the repository append operation. This prevents arbitrary or foreign objects from
being recorded as trusted migration evidence.

Authorization is command-specific: all Project members may view; owners manage source credentials;
owners and admins manage mappings and run imports; owners create readiness assessments. Unknown
capabilities fail closed.

Mapping creation/freeze requires mapping-management capability. Import and run commands require
run-import capability and an `Idempotency-Key`; identical replays return the original batch/job,
while changed payloads conflict. Import batches are capped at 1,000 records. Dry-run and shadow-run
commands only create durable pending jobs in Stage 2B; worker execution and immutable results arrive
in a later stage. Readiness POST is an owner-only write command. Its metrics are derived from stored
evidence, never accepted from the caller, and Stage 2B keeps final-delta, watermark-freshness, and
supported-version gates false until those later controls exist. Members may read evidence and the
latest assessment but cannot create an assessment.

Stage 2B advances a program through these compare-and-swap gates:

```text
create + bounded capability assessment -> mapping (stateVersion 1)
freeze mapping                      -> importing (+1)
first dry-run command               -> dry_run (+1)
first shadow-run command            -> shadowing (+1)
readiness assessment                -> allowed only in shadowing
```

Additional import batches are accepted only in `importing`; mapping writes only in `mapping`.
Additional dry-run or shadow-run jobs may be queued within their corresponding state without a
state transition. Every command still requires the caller's expected state version. Later stages own
the transition from `shadowing` to `ready` and beyond.

The RevenueCat migration API key is assessed with a bounded read-only customer-list request before
the database transaction begins. It is sealed with the configured AES-256-GCM keyring under the
distinct `billing_migration_credential` subject kind and is never returned. A catalog/commerce
credential is not reused or broadened implicitly.

## Persistence boundaries

Migration 00052 adds:

- programs, explicit scopes, separately encrypted credentials, and append-only capability assessments;
- immutable source manifests and normalized source-record revisions;
- draft-to-frozen versioned mapping sets and immutable mapping entries;
- bounded resumable import batches with cursor, lease, idempotency, and count constraints;
- durable dry-run/shadow job commands, immutable completed records and divergences, and computed
  readiness assessments.

Database foreign keys enforce Project, Environment, Application, and platform containment. Immutable
evidence has update/delete rejection triggers. Mapping sets permit only the one-way `draft` to
`frozen` transition. Import batches are the only Stage 2B evidence records designed for progress
updates; they are capped at 1,000 records and have a lease-shape constraint.

Normalized source-record rows contain only bounded source identifiers/revisions, digests, cursors,
timestamps, access classification, and a closed evidence kind. They have no JSON/provider-payload,
purchase-token, receipt, or credential column. Raw provider material may remain only in the
separately encrypted, private source object verified by the internal ingestion boundary and named by
the immutable manifest.

All API digests use the frozen `sha256:<64 lowercase hex>` representation. Source identifiers are
opaque and preserved byte-for-byte, but ASCII control characters are rejected by service validation
and PostgreSQL constraints. Readiness evidence coverage counts only `provider_signed` and
`provider_validated` records; source exports and ordinary provider API reads remain historical or
shadow evidence and cannot independently satisfy the current-access evidence gate.

Mapping coverage is domain-bound rather than identifier-only: customer records require
`customer_id`/`original_customer_id`, aliases require `audited_alias`, subscriptions require
`product`/`entitlement`, transactions require `product`, and transfers require an explicitly
`audited_alias` mapping. An equal identifier under another mapping kind does not count as coverage.

## Stage 2E cutover preparation boundary

Migration 00053 reserves the Stage 2E control-plane persistence for validation/import attempts,
shadow and scope-specific entitlement pointers, authority scopes and transitions, frozen readiness
policies and application-version observations, final deltas, proposals, approvals, checkpoints,
case and repair evidence, completion/retention evidence, and a bounded transition outbox. This stage
does not execute cutover or rollback, perform provider calls, mutate the legacy Environment-level v1
entitlement pointer, or push state directly to SDKs.

Authority is exact and monotonic per `(project, environment, application, platform)`: the initial
row is `source` at epoch N, cutover will create `mosaic` at N+1, and rollback will create the distinct
`source_rollback` authority at N+2. Re-cutover from `source_rollback` is deliberately deferred. A
program checkpoint can be created only when every enumerated scope has the same current scalar
epoch and prepared activation pointers cover every customer across every scope. Each checkpoint
freezes separate prepared-activation and rollback-baseline roles, including an explicit absent-current
marker. Pointer maps reference immutable snapshots using composite
Project, Environment, and billing-customer foreign keys, preventing cross-customer or
cross-Environment pointer substitution.

Readiness promotion is a serializable compare-and-swap from `shadowing` to `ready`. Its digest binds
100% current-access mapping and trusted evidence, unresolved divergence counts and warning policy,
a completed fresh final delta, a fresh source capability assessment, and application-version traffic
that observed Entitlement v2 with the four frozen authority capabilities. Every measured application
version requires a matching qualifying v2 observation. Old clients or observations
without those capabilities fail closed unless the scope's frozen policy explicitly accepts traffic
outside its declared window.

Cutover preparation uses a non-circular freeze order:

```text
proposal binds command + scope/program/state + 8 pre-approval digests
approval binds the proposal, proposer, approver, expiry, and the same 8 digests
checkpoint re-verifies drift and binds all 9 digests, including approvalDigest
```

Production approval requires a human distinct from the proposer in both the service transaction and
a PostgreSQL trigger. Nonproduction may self-approve, while the frozen approval record always names
both roles. Approval expiry or digest drift returns a conflict; drift invalidates the proposal before
checkpoint creation. Later authority execution must require the exact checkpoint and approval IDs
and digests. It will append bounded outbox work after the atomic transition so workers can record a
durable next-sync marker; it will not send an SDK push from the command transaction.

Approved source-access exceptions count only through immutable exact source-record/customer subjects.
Readiness rechecks approval time, expiry, application/platform scope, zero identity ambiguity, and
that distinct subject customers exactly match the affected-customer count; aggregate scope/count
metadata alone never covers evidence.

Credentials may be cryptographically removed only by nulling nonce/ciphertext while retaining the
nonsecret fingerprint and recording actor, timestamp, and removal digest. The schema also reserves
the frozen case, scoped source-access exception, repair preview/execution, completion, retention, and
object-deletion records. Their execution services and external I/O remain later Stage 2E packages.

Migration 00054 closes the execution prerequisites without executing an authority transition. App
and SDK versions are evaluated in Go with Mosaic semantic-version v1 precedence: one to three
numeric core components are padded, leading zeroes are rejected, prerelease identifiers follow
SemVer precedence, and build metadata is ignored for ordering. Each readiness-policy scope persists
a minimum SDK version and the required authority capabilities under a canonical SHA-256 serving
requirements digest; empty, zero-placeholder, malformed, or digest-mismatched requirements fail
readiness.

Readiness also freezes the exact customer cohort for the latest final delta. Current-access members
must come from the manifest and identity mapping digests bound by that delta; only compatible
customer/original-customer/audited-alias mappings qualify. Shadow members must have existed by the
delta completion time. Checkpoint creation uses this frozen cohort—not the number of prepared rows—as
its denominator, requires every cohort customer in every program scope, rejects extra customers, and
freezes complete activation and rollback-baseline pointer maps. The checkpoint transaction performs
the single `ready` to `cutover_pending` state/version compare-and-swap; idempotent replay returns that
original checkpoint without advancing state again.

Rollback uses a distinct proposal path. Its caller supplies only a checkpoint ID and expected
checkpoint, authority-set, and rollback-prerequisites digests; the cutover-only manifest, mapping,
policy, evidence, readiness, watermark, and application-version fields are derived from the
immutable checkpoint for mandatory storage compatibility. The recoverable binding includes the
cutover transition and epoch, transition time and computed deadline, credential state, latest source
capability assessment, latest successful source/provider validations, and exact scope. Proposals
require `stabilizing` state with Mosaic authority. Approval digests cover the immutable binding, and
checkpoint, authority, or prerequisite drift is rejected as a typed conflict.
Proposal and approval timestamps may equal, but never exceed, the computed rollback deadline. Both
operations re-read an active, unremoved credential with its encrypted envelope still present; a
caller-supplied digest cannot make an expired, revoked, removed, or envelope-less plan valid.

Migration 00054 refuses Down before any destructive statement when cohort membership or rollback
proposal bindings exist. Empty-evidence rollback remains supported; immutable execution-prerequisite
evidence must not be silently discarded.

## Stage 2E atomic authority execution

The internal `billingmigration` application service now exposes command-specific cutover and
rollback execution ports. They are intentionally not registered as HTTP routes yet. Both operations
require the Project owner capability, a bounded human reason, the exact BMO v1 command digest set,
an explicit canonically sorted scope, an expected program version, and an expected authority epoch.

Execution uses one serializable PostgreSQL transaction. Lock order is stable: command idempotency,
program, proposal/approval/checkpoint evidence, authority scopes ordered by Application/platform,
then current pointers ordered by Application/platform/customer. Provider I/O is forbidden from this
boundary. A cutover rechecks the latest authoritative readiness and final delta, freshness policy,
unresolved Critical/Blocking cases, immutable cohort and pointer-map coverage, snapshot tenant
ownership, source authority, and epoch. It activates prepared pointers, advances every scope to
Mosaic at N+1 with compare-and-swap, appends one immutable transition and one pending outbox row per
scope, writes one aggregate safe audit event, advances the program to `stabilizing`, and stores the
successful idempotency result in the same commit.

Rollback rechecks the distinct rollback proposal, approval and immutable binding, operation
deadline, active encrypted credential, and exact latest capability/source/provider health evidence.
It restores present rollback baselines, deletes absent baselines and any Mosaic-only pointer without
a checkpoint baseline, advances every scope from Mosaic N to `source_rollback` N+1, writes the
per-scope rollback transitions/outbox rows and aggregate audit, and advances the program to
`rolled_back`. Facts, snapshots, checkpoint maps, transitions, and other evidence remain immutable;
`rolled_back` is not eligible for re-cutover.

Transition, authority, execution, and outbox identifiers/digests are deterministic. Exact replay of
the same command key and request digest returns the original execution even after program state has
advanced. Reusing a key with a different command body is a typed conflict. Stale state/digest,
expired approval, epoch mismatch, pointer coverage, rollback-window/prerequisite, and concurrent
transition failures are also stable errors satisfying `errors.Is(err, ErrConflict)`. Audit, outbox,
CAS, or idempotency write failure aborts the entire transaction.
