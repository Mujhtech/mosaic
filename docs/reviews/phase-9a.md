# Phase 9A Review: Transaction Ingestion and Validation

## Status

**Accepted with tracked follow-ups.**

All Stage 5 blocking findings (5 quality, 7 UX, 2 product) and the one
additional blocker surfaced by the targeted final verification (billing
list pagination) were fixed within the two-round fix pass and verified
with executable evidence. Residual items are minor, named below, and
none affects the phase's security or boundary guarantees. The single
structural caveat: provider flows were demonstrated against synthetic
signed vectors and local API stubs, because no live Apple sandbox or
Google Play test environment is reachable from this workspace. Live
sandbox verification is a named Phase 9B entry precondition.

## Baseline

- Base commit: `dbf2113` on `phase/8-operational-hardening` (contains
  the Phase 9 entry docs; one commit after `de031ee`, which is one
  docs-only commit after the GA product baseline `f83ba26` = `v1.0.0`).
- Branch: `phase/9a-transaction-ingestion-validation`, head `6b28de4`.
- Worktree: `/Users/muhideenmujeeb/Projects/mosaic`.
- GA tag: `v1.0.0`.
- Phase 9 entry review: `docs/reviews/phase-9-entry.md`
  ("Start Mosaic Billing", Gate 9A only, owner-attested demand with
  provenance caveat re-examined and upheld by the Stage 5 product
  review).
- Apple: App Store Server API 1.13
  (`api.storekit.apple.com` / `api.storekit-sandbox.apple.com`),
  App Store Server Notifications V2 (JWS, x5c chain to the embedded
  Apple Root CA - G3, verified genuine), Get Transaction Info,
  Get Notification History; retry behaviour (5 retries production,
  none in sandbox) and the absolute-millisecond `Retry-After` semantics
  recorded from official documentation in the Stage 1 plan.
- Google: Play Developer API v3 (`purchases.subscriptionsv2`,
  `purchases.products`, `orders.get`/`orders.batchGet`), RTDN 1.0 via
  Cloud Pub/Sub **pull** (owner decision — no public Google inbound
  endpoint), hand-rolled service-account OAuth (RS256 JWT bearer).
- Validator version: 1, recorded on every Validation Attempt and
  Transaction Fact.
- Credential-encryption policy: AES-256-GCM envelopes under the
  accepted keyring with a new v2 AAD domain scoped
  `(subjectKind, subjectID)`; v1/v2 cross-open structurally impossible
  (tested); `keyring rotate`/`inspect` covers all envelope tables, with
  a schema-driven test that fails if a future envelope table is missing
  from the rotation set.
- Raw-payload retention policy: operator-configurable, 90-day default;
  normalized facts retained indefinitely; post-expiry replay runs from
  normalized facts; billing records exempt from Phase 6 analytics
  deletion (owner decision, documented in `docs/guides/privacy.md`).

## Completed Deliverables

- **Billing Ingestion Contract v1** (`protocol/schema/billing-ingestion/v1/`,
  status **draft**): 7 record types, 3 reference kinds, 15 const-pinned
  reader policies (no submission status named `validated`;
  `entitlementInference: forbidden`; unresolved products quarantine),
  ~28 valid + 25 invalid fixtures, validator with 132 passing tests,
  ADR 0022. Draft amendment: optional `purchaseToken` on
  `serverTransactionObservation`, gated to trusted-server authority AND
  `google_play`, with a server-enforced token-digests-to-reference rule.
  REST↔contract quarantine vocabulary projection documented.
- **Shared reference vectors** (`packages/test-fixtures`): Google
  token→digest vectors (incl. non-ASCII UTF-8 proof) and Apple decimal
  boundary vectors (uint64-max, 2^53+1), drift-checked against the
  canonical fixtures by the protocol suite and consumed by all three
  SDK test suites.
- **Apple credentials / notification intake**: Store Server Credential
  entity (migration 00022), one-time entry, rotation, revocation
  (a CHECK bug blocking Apple revocation was found by test and fixed),
  connection test; public intake endpoint with two-factor identity
  (SHA-256-stored unguessable intake token + x5c chain verification to
  the pinned root), post-verification `bid` match, size limits, no
  inline validation, never 429, hourly bucketing against flood.
- **Google credentials / notification intake**: service-account
  credential (encrypted), RTDN Pub/Sub pull consumer in the worker,
  envelope validation, `packageName` scope match, tokens encrypted with
  digest join keys, never logged.
- **Apple validation worker**: ES256 JWT client, JWS verification
  rejecting alg confusion and foreign roots, environment and
  application validation, Get Transaction Info lookup, per-Application
  `bid`, explicit team-vs-input credential scope.
- **Google validation worker**: token resolution (direct, via
  `orders.get` from an order reference, or trusted-server-supplied),
  `subscriptionsv2`/`products` lookup, read-only (no acknowledgement —
  documented operator-visible limitation with the 3-day auto-refund
  consequence).
- **Client observations** (public SDK endpoint, untrusted) and
  **trusted server observations** (secret key, may carry the full
  Google purchase token): contract record envelopes both directions,
  four-outcome submission result, rate-limited, deduplicated.
- **Raw Billing Inputs / Validation Attempts / Billing Event Ledger**:
  append-only with DB triggers (narrow documented exceptions: retention
  DELETE, envelope-only re-seal UPDATE), immutability tested.
- **Normalized Transaction Facts**: provider-independent, identity
  `UNIQUE (environment_id, fact_digest)` making replay a structural
  no-op; no price, currency, or customer-identity columns (owner
  decision); fact rows are provider statements, not deduplicated
  purchases — documented with a projection rule preferring
  notification-sourced facts.
- **Product Resolution**: deterministic active → archived-at-time →
  replacement-chain walk with Resolution Snapshot provenance; outcomes
  resolved/unknown/ambiguous/cross-environment/unsupported; never by
  name, price, or period.
- **Quarantine**: 18 reason codes, recovery loop (repair mapping,
  re-run resolution, retry validation — ratified as 9A scope by owner
  decision), structurally no mark-as-valid path anywhere.
- **Reconciliation**: Apple notification-history strategy and Google
  token re-query with provider/source filters, keyset cursors,
  restart safety, conflict detection (contradiction quarantines and
  forces `partial`).
- **Replay/revalidation**: race-free job takeover (lease-expiry
  guard), appended attempts, preserved history, computed comparison,
  conflict quarantine, no fact duplication.
- **Dashboard**: setup home with billing enablement (409 credential
  rule surfaced), write-only credentials, one-time endpoint reveal,
  transaction ledger with dual environment badges and dual timestamps,
  input-scoped validation attempts, quarantine with repair round trip,
  reconciliation runs with conflict counts, replay job status,
  billing health with an explicit "what this cannot tell you" panel.
  533 tests.
- **SDKs** (all opt-in, off by default, fire-and-forget, no secrets,
  never claiming validation): iOS raw-decimal StoreKit id with `.xcode`
  suppression; Android token digest + order id with acknowledgement
  untouched; Flutter provider-independent bridge with durable queue.
  All three conform to the canonical fixtures by file-driven tests.
- **Migrations**: 00022–00028, applied up → down → up cleanly on
  fresh PostgreSQL 17.
- **OpenAPI**: 189 operations, self-consistent (walked as an object
  graph: no dangling refs, no orphans), generated dashboard client.
- **Observability**: OTel spans/metrics for intake, validation,
  provider latency, retries, duplicates, resolution failures,
  quarantine volume, reconciliation lag, replay; billing job families
  with queue depth/age metrics; runbooks and observability docs
  updated.
- **Demonstration**: reusable driver `apps/api/cmd/billingdemo`
  (build-tagged out of default builds so its test-root seam cannot
  ship), all stages passing in ~25s against a fresh stack;
  `docs/reviews/phase-9a-demo-evidence.md` with every synthetic element
  classified. The demonstration found five real defects across its runs
  that the test suite missed.

## Product Review

Verdict: Approve with changes — all changes landed. Demand evidence
re-examined (owner-attested, one repository-verifiable signal: the
Phase 4B Google base-plan gap, concretely closed by 9A). Phase
boundaries held structurally. Product resolution stable. Mosaic Billing
optional, per-Project opt-in, off by default, full ingestion gate with
credential rule (owner decision D1). Deferred 9B access state and 9C
migration confirmed absent. Owner decisions recorded: disable scope
(full gate + credential rule), fact semantics (evidence ledger,
confirmed), quarantine recovery ratified as 9A, contract stays draft
until live-sandbox verification.

## UX Review

Verdict: Approve with changes — all seven blockers fixed and verified
(enablement loop, input-scoped attempts, store-environment passthrough,
repair round trip, replay feedback, list paging, filtered-empty
paging). Terminology, dual-badge environment separation, write-only
secrets, and the one-time endpoint reveal assessed as excellent; the
boundary rule (no surface describes facts as customer access) verified
independently. Residual polish items are tracked follow-ups.

## Engineering Review

Migrations enforce append-only, tenant and environment isolation via
composite FKs (sandbox/production separation is schema-enforced), and
fact-identity uniqueness. Idempotency keys per source; duplicates
collapse without duplicate facts (notification, observation,
reconciliation, and replay paths all tested). Retry policy: bounded
attempts with backoff+jitter, Apple absolute-millisecond `Retry-After`
parsed correctly, auth failures capped at 2 attempts, permanent
categories dead-letter. Timeouts bounded on all provider calls.
Mapping history reproducible incl. archived and replacement chains.
Worker recovery: lease reclaim, parked (not failed) work for disabled
projects, restart-safe cursors. Known defects at acceptance: none
blocking; tracked follow-ups listed below.

Unavailable checks, stated honestly: live Apple sandbox purchases and
notification delivery; live Google Play test purchases and Pub/Sub
delivery; provider retry behaviour observed from the real providers;
Apple root CA fingerprint cross-check against a second offline source.
All are named 9B entry preconditions or operator follow-ups.

## Security Review

- Credentials encrypted (AES-256-GCM, v2 AAD domain; cross-open with
  v1 envelopes rejected by test); rotation tooling covers all envelope
  tables with a forward-looking schema test.
- Secrets redacted: `writeError` never emits cause or payload
  fragments on billing routes (tested); tokens/JWS absent from logs,
  telemetry, and ledger entries (tested); purchase tokens encrypted at
  rest with digest-only join keys.
- SDKs contain no server credentials; the 128-char `safeProviderCode`
  bound structurally excludes JWS/raw tokens from client wires, and
  the contract schema forbids `purchaseToken` on client observations
  (invalid fixture pins it).
- Notification endpoints: two-factor Apple intake (unguessable token +
  signature), tenant identity never derived from payload content,
  request-size limits, flood bucketing; Google delivery authenticated
  by pull-subscription credentials.
- Cross-tenant access fails: resolution cannot cross Projects
  (composite FKs); intake token scopes tenant; tested.
- Sandbox and production isolated by schema constraint and displayed
  as a distinct Store Environment everywhere.
- Rate limits on observation endpoints; intake exempt from 429 by
  design with size limits and bucketing instead.
- Audit events for credential lifecycle, replay, manual
  reconciliation, quarantine recovery, and billing enablement.

## Phase Boundary Review

Confirmed by the final verification's full-diff sweep: production
billing code writes only `billing_*`, `store_server_credential*`, and
`audit_events`. No customer-access state, no authoritative Entitlement
state, no Entitlement activated or revoked, no application access
webhook, no RevenueCat migration, no 9B/9C work. The forbidden
vocabulary held on all new surfaces; the contract machine-rejects
entitlement-shaped fields at any depth.

## Demo Review

- Apple validation succeeds (synthetic chain via the build-tagged
  test-root seam; classified).
- Google validation succeeds (local API stub + real OAuth exchange
  shape; classified).
- Duplicate handling succeeds (both providers; no duplicate facts).
- Quarantine and mapping repair succeed (original input and attempt
  history preserved).
- Retry succeeds (real 26s backoff, earlier failed attempt preserved).
- Reconciliation succeeds (omitted notification discovered, ingested
  idempotently; conflict path exercised).
- Replay succeeds (new attempt appended, prior preserved, comparison
  computed, no fact duplicated).
- No customer-access state changes (forbidden-table queries return
  nothing).
- The one-minute demonstration path runs as a single scripted sequence
  in ~25 seconds.

## Tracked Follow-ups

1. Live Apple/Google sandbox verification end-to-end (9B entry
   precondition; also gates contract draft→approved).
2. Apple root CA fingerprint cross-check against a second source.
3. `apple_transaction_history` reconciliation strategy: wire or
   remove the internal enumeration.
4. Dashboard adoption of `GET billing/settings` (currently infers
   enablement via the health probe).
5. Minor items from the final verification §5: ledger key-pattern
   false positives, `pg_dump` CHECK-function hazard note, replay
   `examined_count` inflation, `ReplayInputs` dropped-row logging.
6. Protocol: fact-identity paragraph in the contract doc; dashboard
   ledger copy alignment with the statements-not-purchases semantics.
7. Migration 00008 down-path failure on connection-less mappings
   (pre-existing, filed separately).
8. UX polish: remaining non-blocking items from the Stage 5 UX report.

## Decision

**Phase 9A accepted with tracked follow-ups; proceed to Phase 9B** —
subject to the standing entry gate: Phase 9B requires its own entry
review, and the live-sandbox verification named above is a hard
precondition of that review.

Stopping here per the orchestration contract: no Phase 9B work, no
merge, no tag.
