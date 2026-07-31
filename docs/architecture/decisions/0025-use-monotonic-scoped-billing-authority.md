# ADR-0025: Use Monotonic Scoped Billing Authority and Immutable Migration Evidence

## Status

Accepted

## Date

2026-07-29

## Context

Phase 9B makes Mosaic capable of answering authoritative customer-access questions, but it does
not decide when a production application stops trusting an existing billing authority and starts
trusting Mosaic. Phase 9C must perform that transition without silently changing access, losing
historical evidence, creating permanent dual authority, or requiring an SDK to infer authority
from its configured purchase provider.

Migration crosses provider APIs, PostgreSQL projections, configuration, Customer Access Tokens,
application webhooks, three native SDKs, and operator workflows. Treating cutover as a mutable
boolean on any one of those resources would allow partial updates: one SDK could use Mosaic while
another still uses RevenueCat, or a rollback could make old cached state appear newer than the
state it replaces.

The owner approved the complete Phase 9C decision package in
`docs/plans/phase-9c-migration-reconciliation-operations.md` on 2026-07-29. This ADR records the
architectural part of that policy.

## Decision

### 1. Billing authority is explicit server-owned state

Authority is stored per explicit `(Project, Environment, Application, platform)` scope. A whole-
Environment migration enumerates its Application/platform scopes; it is not an implicit wildcard.

An SDK never infers authority from its purchase provider, a Customer Access Token, a cached
Entitlement snapshot, configuration age, or local time. Purchase provider and access authority
remain independent: RevenueCat, StoreKit 2, Google Play Billing, or a custom commerce adapter may
continue processing purchases after Mosaic becomes access authority.

### 2. Authority epochs are monotonic through cutover and rollback

Every accepted transition creates a strictly greater authority epoch:

```text
source (epoch N) -> Mosaic (epoch N+1) -> source rollback (epoch N+2)
```

Rollback is therefore a new transition, not deletion or version reversal. Authority epoch takes
precedence over Entitlement snapshot version. A response or cache from an older authority epoch is
stale even when its snapshot version is numerically higher.

The epoch, scope, and authority kind are integrity-bound into authoritative responses and SDK cache
records. Legacy cache records without authority metadata have unknown authority and cannot be
silently relabelled.

### 3. Cutover and rollback are atomic compare-and-swap operations

A cutover transaction verifies an immutable readiness checkpoint, final source/provider watermarks,
mapping/policy/evidence digests, application-version readiness, and unexpired human approval. It then
writes the new authority epoch, activates prepared current-snapshot pointers, records the transition,
and enqueues outbox work atomically.

No provider network call occurs while this transaction holds locks. A stale state version, digest,
watermark, or approval returns a conflict and leaves authority unchanged.

Rollback uses the same mechanism with a checkpoint captured before cutover. It creates a new epoch,
restores source authority and checkpointed pointers, and preserves every Mosaic fact, snapshot,
divergence, case, and audit record.

Production cutover and rollback require two distinct humans. The proposer cannot approve their own
command, and any change to scope, manifest, mappings, policy, or readiness digest expires approval.

### 4. Source material is evidence, not a Transaction Fact

Source snapshots, export rows, API responses, normalized source records, manifests, mappings,
validation attempts, dry runs, shadow projections, divergences, checkpoints, cases, and repairs are
immutable or append-only records in a dedicated migration domain.

A RevenueCat export or other trusted source record may seed history and shadow comparison, but it
does not become a Phase 9A Transaction Fact. Current paid access requires provider-signed or
provider-validated evidence unless a scoped, expiring, two-person-approved exception satisfies the
Phase 9C policy. Source records never update authoritative pointers directly.

Shadow projection writes only to migration-owned namespaces. It cannot issue Customer Access
Tokens, emit customer-access webhooks, change current Entitlement pointers, or affect SDK results.

### 5. Repair is an allowlisted command, never state editing

Operational repair is limited to named commands such as revalidation, replay, explicit alias
attachment under Phase 9B identity rules, mapping-version replacement, quarantine retry, and stable-
event webhook redelivery. Every command has bounded scope, impact preview, idempotency, actor/reason,
before/after digests, and a durable outcome.

There is no generic row patch, `mark active`, permanent grant, arbitrary identity merge, fact edit,
or historical snapshot edit.

### 6. Authority-aware wire behavior is a new contract version

The strict Authoritative Entitlement v1 and Billing State Webhook v1 records are immutable. Phase 9C
introduces Authoritative Entitlement v2, Billing State Webhook v2, and Billing Migration Operations
v1. Customer Access Token v1 remains opaque and memory-only, and Configuration Delivery v3,
Commerce Provider, and Billing Ingestion v1 remain unchanged.

Old application versions that cannot understand the authority contract block production cutover
inside the declared supported-version window. Unsupported clients receive unknown/unavailable
authority behavior, never a locally inferred authority and never inactive access.

## Consequences

- Migration requires a new PostgreSQL-backed module, versioned schemas, operator API, and bounded
  worker jobs, but it does not require a microservice, message broker, or alternate database.
- Cutover cannot be implemented as a sequence of calls to services that each own independent
  transactions; the migration domain needs a narrow shared transactional repository boundary.
- SDK cache formats change and must bind scope and authority epoch. Existing Phase 9B caches safely
  degrade to unknown authority until refreshed.
- A provider may remain installed for commerce and diagnostics without becoming a second access
  authority. Source and Mosaic access are never silently unioned.
- Source integrations remain read-only and delta-capable during the approved stabilization and
  seven-day rollback window.
- Raw source material and migration credentials expand the encrypted-data inventory. They use the
  accepted AES-GCM keyring with distinct subject kinds, bounded access, audit, and retention.
- Live Apple/Google sandbox evidence remains required before production cutover and promotion of
  the draft billing contracts.

## Alternatives Considered

**A mutable `mosaic_is_authoritative` flag.** Rejected because it cannot order rollback, bind cached
state, or atomically coordinate projections, SDKs, and webhooks.

**Infer authority from the configured commerce provider.** Rejected because purchase processing and
access decisions are independent; it would also make RevenueCat-to-Mosaic migration require replacing
an otherwise working purchase adapter.

**Permanent dual authority or unioned access.** Rejected because conflicts become unexplainable and a
source revocation can never reliably remove access.

**Import source rows directly into the Billing Event Ledger.** Rejected because source-system claims
are not store validation and would erase the evidence boundary established by ADR-0023.

**Rollback by deleting Mosaic history or decrementing a version.** Rejected because it destroys
auditability and lets stale caches/responses appear current.

**Generic operator patches.** Rejected because they bypass immutable facts, deterministic projection,
authorization, explanation, and replay.
