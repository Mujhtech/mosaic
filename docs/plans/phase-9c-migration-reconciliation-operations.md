# Phase 9C Plan: Migration, Reconciliation, and Operations

Status: **Stage 1 inspections complete; all recommendations in §2 approved by the owner on
2026-07-29 ("approve all phase 9c recommendation"). Stage 2A protocol contracts and the corrected
Stage 2B backend foundation, Stage 2C dashboard foundation, Stage 2D cross-platform SDK authority
behavior, and Stage 2E schema/preparation core are frozen after independent quality/UX review.
Stage 2E serving and transition execution work is in progress.**

Branch: `phase/9c-migration-reconciliation-operations`

Accepted Phase 9B baseline:
`0aefd7dcf4af873ad065c7eb36560bb1436e6e44` (`fix(billing): close phase 9b
remediation blockers`). No Phase 9C production implementation predates this baseline.

This plan reconciles the Stage 1 product, protocol, backend, quality, dashboard, Flutter, iOS,
and Android inspections. It is the integration contract for Phase 9C. The owner approved every
recommendation in §2; each recommendation is now accepted Phase 9C policy.

---

## 1. Stage 1 conclusions

1. Phase 9B is a sound migration substrate after the remediation in the recorded baseline:
   authenticated provider notifications, durable identity binding, replayable projections,
   opaque Customer Access Tokens, atomic SDK caches, and signed application webhooks are present.
2. Migration is a new modular-monolith domain. It may reference Phase 9A/9B evidence, but must not
   rewrite raw inputs, facts, historical mappings, subscription snapshots, or Entitlement snapshots.
3. A source export is evidence about the source system. It is not a Mosaic Transaction Fact and is
   not sufficient by itself to preserve current paid access unless an explicit exception is approved.
4. RevenueCat is the only first-class source adapter in the initial vertical slice. Apple and Google
   are authoritative revalidation and known-reference discovery sources through accepted Phase 9A
   seams. A custom adapter requires a concrete approved contract and is not invented speculatively.
5. Existing RevenueCat commerce/catalog credentials must not be silently broadened. Migration uses
   a separately consented credential with least-privilege capabilities and independent revocation.
6. The strict Authoritative Entitlement v1 contract cannot safely accept authority fields. Phase 9C
   adds Authoritative Entitlement v2 and Billing State Webhook v2. Billing Migration Operations v1 is
   a new operator contract. Customer Access Token v1 remains opaque and unchanged.
7. Authority epoch outranks snapshot version. An SDK must reject a snapshot from an older authority
   epoch even if its snapshot version is numerically higher. Cache integrity binds the epoch and scope.
8. Purchase provider and access authority are independent. RevenueCat may continue to perform
   purchases after Mosaic becomes access authority. SDKs must never union provider-observed and
   Mosaic-authoritative access silently.
9. All three SDKs can add authority awareness without changing their stable customer-access result
   APIs. Each needs a replaying current-authority stream/listener and an urgent post-transition sync.
10. Customer Access Tokens remain memory-only on Flutter, iOS, and Android. The orchestration
    prompt's protected-storage wording is superseded by the approved Phase 9B security policy.
11. The current SDK entitlement surface is Project/Environment scoped. Supporting a narrower
    application/platform cutover requires an explicit v2 scope rather than inferred SDK state.
12. The dashboard needs command-specific capabilities. Existing owner/admin `canManage` checks are
    too coarse for credentials, mapping freeze, cutover, rollback, repair, and evidence deletion.
13. Live Apple and Google sandbox verification remains mandatory before production cutover and
    draft-contract promotion. It is not a blocker to Stage 2 implementation behind non-production
    authority.

## 2. Owner decisions (approved)

The owner approved the complete recommendation package on 2026-07-29. The recommendation column
is therefore normative for Phase 9C implementation.

| ID | Decision | Recommendation |
|---|---|---|
| OD-9C-1 | Evidence allowed to preserve current access | Require provider-signed or provider-validated evidence. RevenueCat export/API data may seed history and shadow state, but does not independently become a Transaction Fact. |
| OD-9C-2 | Source-only access exception | Permit only a scoped, expiring exception when provider revalidation is impossible; require two-person production approval, an attached reason, affected-customer count, rollback treatment, and zero identity ambiguity. Never allow an unbounded project-wide exception. |
| OD-9C-3 | Identity matching | Exact explicit identifiers and audited aliases only. No email matching, fuzzy matching, device inference, or automatic merge. Conflicts become blocking reconciliation cases. |
| OD-9C-4 | Authority scope | Version the scope as `(project, environment, application, platform)`. A program may select a whole environment by explicitly enumerating its applications/platforms; no implicit wildcard at cutover. |
| OD-9C-5 | Readiness policy | Require 100% mapping for current-access records, 100% provider validation or approved exception for current-access records, zero unresolved Critical or Blocking divergences, a completed final delta, and fresh source/provider watermarks. Warning thresholds are program policy frozen before the first production dry run. |
| OD-9C-6 | Stabilization and rollback | Default stabilization and rollback window: 7 days. Keep the source integration read-only and delta-capable throughout. Completion is blocked while the window is open or rollback prerequisites are unhealthy. |
| OD-9C-7 | Production approvals | Require two distinct humans for production cutover and production rollback: proposer and approver. Development/sandbox programs require one authorized operator. An approval expires when the manifest, mappings, policy, scope, or readiness digest changes. |
| OD-9C-8 | Existing application versions | Block production cutover unless every version inside the declared supported-version window understands Entitlement v2 authority metadata. Traffic outside that window must be measured and explicitly accepted; it receives `authority_unknown`, never inferred Mosaic authority. |
| OD-9C-9 | Emergency authority override | Exclude an unrestricted override. Allow only the normal audited rollback command within its checkpoint/window. Any break-glass mechanism requires a separate ADR and owner approval. |
| OD-9C-10 | Migration credential and file protection | Add migration credentials as a distinct encrypted subject kind using the accepted AES-GCM envelope/keyring. Encrypt source objects before S3-compatible storage, use private short-lived access, checksum every object, redact all secrets, and audit reads/deletes. |
| OD-9C-11 | Retention | Raw source files: delete 30 days after program completion unless legal hold. Credentials: operator-removable after final import and mandatory removal after rollback window. Normalized manifests, evidence digests, checkpoints, cases, repairs, and audit history: retain under billing-record policy. |
| OD-9C-12 | Initial adapter scope | Ship RevenueCat as the first-class migration adapter plus Apple/Google reconciliation. Defer generic custom-source adapter implementation until a concrete customer contract is approved. |
| OD-9C-13 | SDK targeting after cutover | Placement targeting uses Mosaic-authoritative access only when the current authority epoch says Mosaic. Before cutover it continues using the configured provider. Never union the two sources. |
| OD-9C-14 | Contract set | Add Billing Migration Operations v1, Authoritative Entitlement v2, and Billing State Webhook v2. Keep Customer Access Token v1, Delivery v3, Commerce Provider, and Billing Ingestion v1 unchanged. |
| OD-9C-15 | RevenueCat restore/transfer semantics | Import RevenueCat customer IDs, original IDs, aliases, subscription ownership, and transfer history as source evidence. Never reproduce RevenueCat transfer behavior as a heuristic Mosaic identity merge. |

## 3. Official provider documentation consulted

Accessed 2026-07-29. These sources constrain implementation; fixtures and adapters must record the
provider/API version they were built against.

- RevenueCat [REST API v2](https://www.revenuecat.com/docs/api-v2): v2 secret keys are distinct,
  permissioned, paginated, rate-limited, and expose customer/subscription records including
  `gives_access`, store subscription identifiers, environment, ownership, and status.
- RevenueCat [Scheduled Data Exports](https://www.revenuecat.com/docs/integrations/scheduled-data-exports):
  bulk export is an import channel, not proof that Mosaic independently validated a store purchase.
- RevenueCat [webhooks](https://www.revenuecat.com/docs/integrations/webhooks) and
  [restore behavior](https://www.revenuecat.com/docs/projects/restore-behavior): deltas and alias/transfer
  behavior must be captured without assuming ordered or exactly-once delivery.
- Apple [App Store Server API](https://developer.apple.com/documentation/appstoreserverapi/),
  including transaction history and documented rate-limit handling, is used only through accepted
  Phase 9A validation/reconciliation seams.
- Google Play Developer API
  [`purchases.subscriptionsv2`](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2),
  [`purchases.voidedpurchases`](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.voidedpurchases/list),
  [quotas](https://developers.google.com/android-publisher/quotas), and
  [RTDN](https://developer.android.com/google/play/billing/rtdn-reference) constrain bounded polling,
  token discovery, void detection, backoff, and idempotent delta processing.

## 4. Domain model and invariants

### 4.1 Migration Program

A `migration_program` is immutable in identity and scope after assessment begins. It records:

- Project, Environment, explicit Application/platform scope;
- source adapter/version and separately encrypted credential reference;
- lifecycle state and monotonic state version;
- manifest, mapping-set, policy, and evidence digests;
- source, provider, shadow, and cutover watermarks;
- authority epoch before/after cutover;
- proposer/approver identities and approval expiry;
- rollback deadline and completion/retention state.

Lifecycle:

```text
draft -> assessing -> mapping -> importing -> dry_run -> shadowing
      -> ready -> cutover_pending -> stabilizing -> completed
                                   \-> rolled_back
```

`failed` and `cancelled` are terminal before cutover. A post-cutover failure enters `stabilizing`
with an incident/case; it never silently changes authority. Every transition is a compare-and-swap
against `state_version` and is audited.

### 4.2 Immutable evidence

- `migration_source_snapshots`: immutable source object/checksum/size/encryption metadata.
- `migration_source_records`: normalized, append-only records linked to snapshot and source cursor.
- `migration_manifests`: immutable counts, date bounds, adapter/schema versions, and checksum tree.
- `migration_mapping_sets` and versioned identity/Product/Entitlement mapping entries.
- `migration_validation_attempts`: append-only provider revalidation outcomes.
- `migration_import_batches`/attempts: bounded, resumable, idempotency-keyed.
- `migration_shadow_snapshots`: derived source and Mosaic access views in isolated namespaces.
- `migration_divergences`: immutable observations; current classification/resolution is separate history.
- `migration_checkpoints`: immutable readiness/cutover/rollback material with watermarks and digests.
- `migration_cases`, actions, comments, attachments, and repair proposals/executions.

Source records never insert directly into `billing_event_facts`. Provider revalidation uses Phase 9A
ingestion/validation and produces ordinary append-only evidence. Import promotion references those
facts and the frozen historical mapping version.

### 4.3 Mapping

- Identity mappings accept exact source IDs/aliases to existing/new Mosaic Billing Customers.
- Product mappings target stable Mosaic Product IDs and record source product/store/application.
- Entitlement mappings target stable Mosaic Entitlement IDs and a frozen grant version.
- A frozen mapping set is immutable. Corrections create a new version and invalidate dry-run,
  readiness, and approval digests.
- Ambiguous, missing, cross-tenant, cross-environment, or scope-mismatched mappings quarantine the
  record and create a reconciliation case.

### 4.4 Shadow and divergence

Shadow projection has its own namespace and cannot update current Entitlement pointers, issue
Customer Access Tokens, emit customer webhooks, or affect SDK responses.

Divergence classes:

- `critical`: source grants current access while Mosaic denies/unknown, identity crosses customers,
  or authority/scope evidence conflicts;
- `blocking`: current-access record lacks mapping/revalidation, source delta/watermark is stale, or
  supported application version is not authority-aware;
- `warning`: historical/non-current mismatch, expected provider timing lag, or policy-visible change;
- `informational`: explainable ordering/normalization difference with identical access.

Classification rules are versioned. Manual resolution cannot reclassify a Critical mismatch without
recording the underlying repair or an approved exception.

### 4.5 Authority and cutover

Authority is a monotonic, server-owned state per explicit scope:

```text
source(epoch N) -> mosaic(epoch N+1) -> source_rollback(epoch N+2)
```

It never decrements and never has two writers. A database transaction must:

1. lock the scope and verify the readiness/checkpoint/approval digests;
2. verify final source/provider watermarks and rollback prerequisites;
3. persist the new authority epoch and cutover record;
4. activate the prepared Mosaic current-snapshot pointers;
5. enqueue SDK-refresh/application-webhook outbox records;
6. commit atomically.

No provider network call occurs while the transaction holds locks. A stale digest returns a stable
`409` and leaves authority unchanged. Rollback creates a new epoch and restores the checkpointed
source authority/pointers; it does not delete Mosaic history.

## 5. Protocol contracts

### Billing Migration Operations v1

Canonical JSON Schemas cover program, scope, capability assessment, manifest, mapping set, import
batch, dry-run result, divergence, readiness, checkpoint, approval, cutover/rollback command,
case, repair action, completion report, and webhook redelivery. Commands carry idempotency keys,
expected state version, expected digests, and a human reason where risk changes.

### Authoritative Entitlement v2

Adds strict, required authority metadata:

- `authorityEpoch`, `authorityKind`, and explicit authority scope;
- transition state and cutover timestamp where applicable;
- snapshot authority digest;
- server-directed minimum supported SDK/app contract metadata;
- request application identifier, platform, app version, and SDK version.

The snapshot body remains explicit and versioned. Unknown authority is a safe unavailable result,
not inactive access. Legacy v1 cache entries carry `authority_unknown`; SDKs never infer their epoch.

### Billing State Webhook v2

Adds authority scope/epoch and transition events while preserving HMAC signing, delivery attempts,
redelivery idempotency, and tolerant-consumer policy. V1 destinations remain supported and receive
only v1 events; they cannot satisfy the authority-aware readiness gate.

## 6. Backend and API boundary

Create a `billingmigration` domain/application module and PostgreSQL repositories in the existing Go
modular monolith. Reuse the existing worker/outbox infrastructure; add no queue system.

REST resources are Project-scoped and enforce Environment/Application membership on every query.
Handlers decode, validate with Ozzo, call services, and map through Mosaic response helpers. Required
capabilities are distinct: view, manage-source, manage-mappings, run-import, resolve-cases,
propose-cutover, approve-cutover, execute-cutover, execute-rollback, execute-repair, delete-source.

Migration jobs are bounded by batch size, lease duration, provider quota, and retry budget. All jobs
are resumable and idempotent. No job holds a database transaction during source/provider I/O.

Telemetry records program/scope/batch/case IDs, counts, duration, cursor age, divergence class,
authority epoch, and stable error category. It never records credentials, raw tokens, source payloads,
customer aliases, or complete provider responses.

## 7. Dashboard information architecture

Add Project-scoped **Billing > Migration Programs**. A program has:

- overview and immutable scope;
- source connection/capability assessment;
- manifest and mappings;
- import batches and provider validation;
- dry run and shadow comparison;
- divergence queue and cases;
- readiness, application-version coverage, and watermarks;
- cutover proposal/approval/execution;
- stabilization, rollback, and incident status;
- repair/redelivery tools;
- completion report, source retention/deletion, and audit history.

Every dangerous command has impact preview, explicit reason, capability check, stale-state handling,
and irreversible/rollback consequences. Secret inputs clear after submission and are never read back.
Polling backs off and stops on terminal state; filters/search remain route-owned.

## 8. SDK behavior

All SDKs implement the same conceptual state:

- current authority with replaying stream/listener;
- authority epoch monotonicity ahead of snapshot version;
- cache digest bound to customer, environment, application/platform scope, and authority epoch;
- urgent sync on authority transition, before normal configuration refresh;
- `authority_unknown` for legacy cache/unsupported contracts;
- stable access-result APIs and safe `unknown/unavailable` behavior;
- Mosaic-only placement targeting after Mosaic authority per OD-9C-13;
- provider-specific purchase/restore remains independent;
- Customer Access Token remains memory-only.

Platform work stays in the existing customer-entitlement runtime, transport, cache, configuration,
commerce adapters, examples, docs, and focused tests. Do not introduce WorkManager or another
background scheduler solely for Phase 9C; foreground recovery plus the existing persistence/refresh
mechanisms are sufficient unless evidence proves otherwise.

## 9. Repair policy

Repairs are allowlisted commands, never arbitrary row edits:

- re-fetch/revalidate a known provider reference;
- replay an existing immutable fact range through an accepted projection version;
- attach an explicitly proven alias under Phase 9B identity rules;
- replace a mapping by creating a new mapping-set version;
- retry a quarantined record after its cause is corrected;
- redeliver an existing signed webhook event.

Every repair has preview, bounded scope, idempotency key, reason, actor, before/after digest, result,
and linked case. There is no `mark active`, `grant forever`, refund, compensation, fact mutation, or
snapshot mutation command.

## 10. Work packages after owner approval

### Stage 2A — Contracts and frozen fixtures

Protocol owns Billing Migration Operations v1, Entitlement v2, Webhook v2, compatibility rules, and
cross-platform fixtures. Product/orchestrator ratifies the frozen scope and state machine before any
dependent implementation.

### Stage 2B — Backend migration foundation

Backend owns migrations, repositories, services, RevenueCat adapter, encrypted credentials/objects,
assessment, manifests, mappings, import, validation, dry run, and shadow projection. This establishes
the REST contract consumed by the dashboard and SDK coordination.

### Stage 2C — Dashboard operations

Dashboard implements the program journey against frozen APIs, command capabilities, safe previews,
case workflows, and operational views. It must not define migration semantics client-side.

### Stage 2D — SDK authority awareness

Flutter, iOS, and Android implement Entitlement v2, authority streams, epoch/cache rules, urgent sync,
targeting selection, version metadata, fixtures, examples, and documentation. Each renderer remains
native and each SDK retains provider purchase independence.

### Stage 2E — Cutover, rollback, repair, completion

Backend adds readiness, approvals, checkpoint/final delta, atomic authority transaction, stabilization,
rollback, repairs, webhook v2/redelivery, completion report, and retention jobs. Dashboard exposes them
only after backend invariants are tested.

### Stage 2E implementation refinements

The following technical refinements derive from the approved authority, readiness, rollback, and safe
failure policies. They close implementation ambiguities without expanding product scope:

- Authoritative Entitlement v2 sync requests may carry an optional known snapshot-authority digest.
  The server emits `snapshotUnchanged` only for an exact digest match; absence or mismatch produces a
  full snapshot. The value is verification input and never selects authority, scope, or customer.
- `policy_unavailable` is a safe unavailable response with no fabricated minimum-support policy. SDKs
  clear the retained accepted authority snapshot before publishing unavailable so a restart cannot
  replay stale active access; they never translate it to inactive or provider fallback.
- Minimum SDK version and required authority capabilities are frozen and persisted per explicit
  Application/platform readiness-policy scope. Application-version comparisons use Mosaic semantic
  version rules; SQL text ordering is forbidden.
- V2 sync observations are append-only, bounded, non-sensitive evidence. Serving must not fail when an
  observation write fails, and observations never contain Customer Access Tokens, customer IDs,
  aliases, or request bodies.
- Checkpoint creation proves prepared-pointer coverage against the complete frozen authoritative
  customer cohort, copies immutable activation and rollback-baseline maps, and advances `ready` to
  `cutover_pending` with compare-and-swap.
- Rollback proposals persist an immutable binding of checkpoint, authority, and rollback-prerequisite
  digests. The rollback-prerequisite digest canonically binds checkpoint ID/digest, cutover epoch/time
  and deadline, credential active/removal state, latest source capability evidence digest/time, latest
  source/provider health evidence digest/time, and the explicit scope digest.
- Scope reuse attaches an unowned existing authority scope to the new program atomically. An authority
  scope owned by another active program remains a conflict.
- Transition state is derived consistently: pre-cutover source is `stable` or `cutover_pending`, Mosaic
  during the stabilization window is `stabilizing`, completed Mosaic is `stable`, and source rollback
  is `rolled_back`.
- Cryptographically removed credential material is irrecoverable. Migration rollback must stop with a
  clear precondition error instead of fabricating ciphertext, deleting retained metadata, or failing
  later through an opaque nullability error.

### Stage 2E operations refinements

The owner's blanket approval of all Phase 9C recommendations also covers the following smallest-safe
operations choices identified during implementation review:

- RevenueCat REST API v2 pull is the required source channel. Scheduled Data Export may be ingested as
  source evidence, but never as provider validation. Mosaic streams source material through its API or
  worker into private encrypted object storage; it does not accept caller-chosen object keys or require
  presigned upload in v1.
- A source object's plaintext is capped at 100 MiB. Objects use a versioned, chunked authenticated
  encryption envelope so large inputs can be streamed without buffering them entirely in memory.
- RevenueCat cursors remain opaque. Export revisions bind export identity, row revision/version, and
  row digest. Duplicate and out-of-order evidence remains append-only and idempotent.
- Provider revalidation uses only accepted Phase 9A ingestion/validation seams. Source evidence cannot
  insert a Transaction Fact directly.
- Prepared snapshot building may write immutable candidate snapshots and prepared pointers only. It
  cannot advance live pointers, issue Customer Access Tokens, change SDK responses, or emit customer
  webhooks.
- Production migrations with active billing-webhook destinations require at least one healthy active
  v2 destination with an active signing secret. No configured destination does not block cutover, and
  v1 destinations never receive authority-transition events.
- Transition audience is the exact checkpoint scope multiplied by the frozen customer cohort,
  including customers with an absent rollback baseline. Absence removes the scoped current pointer;
  it never preserves Mosaic access.
- `replace_mapping_set` is pre-cutover only. It creates a new version, invalidates downstream evidence,
  approvals, and checkpoints, and rewinds to `mapping` or `importing` as appropriate. It is forbidden
  from `stabilizing`, `completed`, and `rolled_back`.
- Legal hold is owner-only, requires a reason and external legal/compliance reference, records actor and
  timestamp, and requires two distinct humans in production. Release resumes the deterministic
  retention schedule; Mosaic does not add a general legal-case management system.
- Early credential removal after final import requires explicit irreversible-impact confirmation and
  makes rollback prerequisites unhealthy until a new separately approved migration path exists.
- `cutover.completed` is emitted after atomic cutover. `stabilization.completed` is emitted only when
  the stabilization and rollback policy is satisfied and completion can be recorded; delivery failure
  never blocks authority or completion.
- RevenueCat extraction is an explicit durable BMO source-pull command with `snapshot`, `delta`, or
  `final_delta` intent. It is never performed synchronously during Program creation or a normal request.
  A completed `final_delta` pull automatically queues the lease-bound final-delta evaluation after its
  provider-validation import settles, so BMO does not expose a second command that could select a
  different source generation.
- RevenueCat v2 normalization follows the published resource graph rather than a synthetic expanded
  customer payload: paginate Projects' customers, then each customer's subscriptions and aliases, and
  bind subscription Product/Application/store metadata through the v2 Product resources. Exact response
  pages remain raw encrypted evidence. Store, environment, Application, Product, Entitlement, ownership,
  customer, alias, and subscription relationships required for mapping/evaluation remain normalized,
  append-only evidence. Unsupported stores quarantine; they are never guessed from identifier syntax.
- A v2 billing-webhook readiness proof is fresh for the same per-Program `watermark_max_age_seconds`
  frozen in its readiness policy. Promotion and atomic cutover both recheck the current destination
  configuration and this cutoff; there is no separate mutable global freshness setting.
- Operator command capabilities are returned by the server as a closed, command-specific set derived
  from the authenticated actor and current Program state. The dashboard may use them for affordances but
  the backend remains authoritative. Client-side Organization-role inference is not a security boundary.

## 11. Minimum sufficient test strategy

Tests protect the risky behavior, not file count:

- protocol compatibility: strict v1 rejection, v2 fixtures across Go/Flutter/iOS/Android, unknown enum
  handling per contract, epoch/scope binding;
- PostgreSQL integration: tenant/scope isolation, immutable evidence/mappings/checkpoints, resumable
  batches, leases/idempotency, unique authority, approval invalidation, atomic cutover/rollback;
- adapter fixtures: pagination, cursor resumption, 429/backoff, duplicate/out-of-order deltas, alias and
  transfer evidence, malformed/oversized files, checksum/encryption failure;
- shadow/readiness: no current-access mutation, deterministic replay, divergence classes, watermarks,
  zero-critical gate, exception expiry;
- security: credential redaction/encryption/AAD, private object access, command capabilities,
  proposer/approver separation, cross-tenant denial, audit completeness;
- SDKs: epoch beats snapshot version, legacy cache becomes unknown, scope mismatch rejection, atomic
  cache write, urgent transition refresh, offline behavior, targeting authority selection, CAT never
  persisted;
- dashboard: lifecycle gates, stale `409`, permissions, dry-run no access change, cutover/rollback
  confirmations, repair allowlist, secret clearing, bounded polling, and one integrated operator journey.

No new test framework is authorized. Extend existing Go, TypeScript, Flutter, Swift, and Android test
infrastructure at the lowest useful layer.

PostgreSQL integration packages currently share one disposable `DATABASE_TEST_URL` and may recreate
the public schema. Repository-wide database validation must therefore run with `go test -p 1`; parallel
package execution against the same database is unsupported and must not be presented as isolation.

## 12. Required drills and evidence

Before Phase 9C review:

1. RevenueCat fixture migration: full snapshot, interrupted/resumed batch, delta, final watermark.
2. Identity/Product/Entitlement ambiguity: quarantine, case, explicit repair, rerun.
3. Shadow mismatch: source grants/Mosaic denies; readiness blocks until evidence-backed resolution.
4. Atomic cutover: concurrent stale command loses with `409`; no split authority is observable.
5. Rollback: within-window source recovery creates a new epoch and preserves Mosaic history.
6. Provider lag/outage: bounded retry/backoff, stale watermark blocks cutover, existing access remains.
7. SDK mixed versions/offline: unsupported version blocks readiness; authority-aware caches switch safely.
8. Webhook redelivery: stable event identity/signature, duplicate delivery is auditable and idempotent.
9. Credential/object deletion: retention job removes raw material without deleting normalized audit proof.
10. Live Apple/Google sandbox verification for renewal, grace/retry, revoke/refund, restore, and provider
    reconciliation before production authority or contract promotion.

## 13. Exit criteria

Phase 9C is complete only when:

- the approved vertical slice migrates RevenueCat evidence through assessment, mapping, import,
  validation, dry run, shadow, readiness, cutover, stabilization, and completion;
- current customer access is preserved or every difference is explicit, explained, and approved;
- authority is singular, monotonic, atomic, scoped, SDK-visible, and reversible within policy;
- source/provider watermarks, application-version readiness, and zero-blocker divergence are enforced;
- repair and redelivery are allowlisted, bounded, idempotent, and audited;
- raw evidence and secrets meet encryption, redaction, access, retention, and deletion policies;
- repository-wide relevant validation and the required drills pass;
- independent product, protocol, backend, dashboard, SDK, UX, and quality reviews report no unresolved
  critical issue;
- `docs/reviews/phase-9c.md` and the consolidated Phase 9 review are accepted by the owner.

Do not begin Phase 10, merge automatically, tag automatically, promote draft contracts, or switch
production authority from an unaccepted branch.
