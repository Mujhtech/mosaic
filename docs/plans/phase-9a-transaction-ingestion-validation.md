# Phase 9A Plan: Transaction Ingestion and Validation

Date: 2026-07-27
Status: Accepted for implementation (Stage 2)
Entry: `docs/reviews/phase-9-entry.md` ("Start Mosaic Billing", Gate 9A only)
Branch: `phase/9a-transaction-ingestion-validation` (base `dbf2113`)

This plan is the Stage 1 integration contract reconciling the eight Stage 1A/1B
inspection reports (product, protocol, backend, quality, dashboard, Flutter,
iOS, Android). All owner decisions below were resolved with the owner on
2026-07-27 before implementation began.

## 1. Phase promise and boundary

Mosaic can prove a provider transaction is authentic, associate it with the
correct Mosaic Product, and preserve an auditable history — without deciding
customer access.

Phase 9A performs **no access update at all**, from any event, validated or
not. (This deliberately strengthens the wording at `docs/product/roadmap.md`
line 3825, which could be misread as licensing access updates from validated
events.) No customer entitlement, subscription-state, access-grant, or
customer table is created; no application access webhook is emitted; no
RevenueCat migration occurs; no financial accounting exists.

Forbidden vocabulary in all new 9A code, contract, and UI surfaces:
**Customer, Subscriber, Subscription, Entitlement State, Access Grant.**
(The ban applies to new billing surfaces only; accepted Phase 4 copy is
unaffected.)

## 2. Canonical terminology

| Term | Meaning |
| --- | --- |
| Store Notification | Inbound Apple ASSN V2 or Google RTDN message. Never "webhook" (reserved for 9C outbound). |
| Store Server Credential | Encrypted Apple App Store Connect API key (.p8 + key ID + issuer ID) or Google service-account key held server-side. |
| Transaction Observation | Untrusted client (or trusted app-backend) report of a purchase reference. A trigger, never proof. |
| Raw Billing Input | Immutable record of an original received input. |
| Validation Attempt | One append-only record of one validation try. |
| Validated Transaction / Transaction Fact | Provider-independent normalized fact produced by successful validation. Never labelled a subscription. |
| Product Resolution / Resolution Snapshot | Deterministic mapping of a provider Product to a Mosaic Product via mapping history; the snapshot records the exact mapping version used, so replay is reproducible. |
| Quarantine Record | Input or fact that cannot safely proceed. |
| Billing Ledger Entry | Append-only operational event in the Billing Event Ledger. |
| Store Environment | Sandbox/production classification from verified provider metadata — distinct from Mosaic Environment. |
| Billing Event vs Analytics Event | Never bare "Event"; Phase 6 owns Analytics Events. |
| Ledger Replay vs Revalidation | Replay re-runs accepted inputs deterministically; revalidation is an authorized operator retry. |

## 3. Owner decisions (resolved 2026-07-27)

1. **Raw payload retention**: operator-configurable, deployment-level,
   **90-day default** (midpoint of Apple's 180d/30d notification-history
   windows). Normalized facts retained indefinitely. Post-expiry replay runs
   from normalized facts and is labelled as such.
2. **Token/payload protection**: full Google purchase tokens and Apple signed
   payloads **encrypted at rest** under the accepted keyring with a new
   envelope AAD domain (v2), plus a separate SHA-256 digest column for
   idempotency and RTDN attribution join. Raw bodies are encrypted after
   tenant resolution; unresolvable inputs are quarantined by metadata only
   (no plaintext body persisted). Recorded in the new 9A ADR, which
   explicitly reverses the Phase 4B "no receipts/tokens persisted" claim.
3. **Google RTDN transport**: **Pub/Sub pull in the worker** using
   service-account credentials. No public Google inbound endpoint. (Apple
   ASSN still requires a public HTTPS endpoint; that is Apple-only.)
4. **Privacy deletion boundary**: billing records are **exempt** from Phase 6
   analytics deletion. 9A facts carry no customer identity. The boundary is
   documented in the data inventory and privacy guide.
5. **Trusted server observation endpoint**: **included**, app-backend-only,
   authenticated by a Mosaic secret key; may carry a full Google purchase
   token server-to-server (encrypted at rest on receipt); still subject to
   full provider validation; minimal acknowledgement response.
6. **SDK client handoff (Stage 3)**: **implemented in 9A** — opt-in, off by
   default, fire-and-forget, persistent queue, never claims "validated".
7. **Contract shape**: `subjectReference` and `monetaryAmount` are defined as
   **optional schema fields but never populated or persisted in 9A**; enums
   are deliberately over-provisioned because readers reject unknown members.
8. **Credential model**: new **Store Server Credential** entity (not an
   overload of Provider Connection); two connections per store per
   Environment mode (sandbox/production), one Apple connection per Apple
   team scoped to multiple Applications (`bid` selected per request).

Adopted technical decisions (agent recommendations, recorded as accepted):
transaction types limited to auto-renewable subscriptions and non-consumables
(consumables quarantine as `unsupported_transaction_type`); Mosaic Billing is
per-Project opt-in, off by default; Google OAuth hand-rolled (matching the
RevenueCat client posture; the Apple ES256 signer must be written anyway);
single worker process with a dedicated billing poll interval
(`MOSAIC_BILLING_WORKER_POLL_INTERVAL`); Mosaic does **not** acknowledge
Google purchases (acknowledgement stays with the app/adapter — server-side
acknowledgement would couple the customer's 3-day refund window to Mosaic
availability; documented as an operator-visible limitation); no analytics
event is emitted from validated facts (`authority='provider_confirmed'`
stays reserved for 9B/9C); four schema files per the analytics precedent; no
browser-contract generation in 9A (dashboard consumes OpenAPI-generated
types); quarantine recovery (mapping repair + re-run resolution + retry
validation) **is** 9A scope per the orchestration mandate — broader repair
tooling remains 9C.

## 4. Official provider documentation

Recorded by the Stage 1A backend inspection from current official sources
(Apple docs read via the machine-readable
`developer.apple.com/tutorials/data/...json` forms; nothing recalled from
memory):

- **Apple App Store Server API 1.13** — production
  `https://api.storekit.apple.com`, sandbox
  `https://api.storekit-sandbox.apple.com` (not the legacy
  `.itunes.apple.com` hosts). JWT auth: ES256-signed with the In-App
  Purchase key (.p8), `iss` = issuer ID, `bid` per request. Endpoints used:
  Get Transaction Info (`GET /inApps/v1/transactions/{transactionId}`),
  Get Transaction History (v2), Get Notification History.
- **App Store Server Notifications V2** — JWS payloads; verification chains
  the `x5c` header to the Apple Root CA (pinned via `go:embed`); retries a
  failed notification only **5 times** (1/12/24/48/72 h) and **never in
  sandbox**; notification history retained 180 d production / 30 d sandbox.
- **Apple traps**: `Retry-After` on 429 is an **absolute UNIX timestamp in
  milliseconds** (not delta-seconds — the existing `revenuecat.parseRetryAfter`
  must not be reused for Apple); sandbox rate limits are 10% of production;
  Apple documents a production→sandbox probe fallback for transaction lookup.
- **Google Play Developer API v3** — `purchases.subscriptionsv2.get`,
  `purchases.products.get`, and the **`orders.get`/`orders.batchGet`**
  resource, which returns the full `purchaseToken` for an `orderId` (this is
  what makes a client observation carrying only the order ID
  server-actionable). Service-account auth (JSON key), hand-rolled OAuth.
- **Google RTDN 1.0** via Cloud Pub/Sub; notifications are triggers only —
  the payload is never treated as transaction state; the authoritative state
  comes from the Play Developer API. Pull subscription consumed by the
  worker. Unacknowledged purchases auto-refund in 3 days (3 minutes for
  license testers) — Mosaic never acknowledges.

Validator version starts at `1` and is recorded on every Validation Attempt
and Transaction Fact.

## 5. Persistence model (PostgreSQL, goose)

New migrations (append to `apps/api/migrations`, following the `55000`
append-only trigger precedent from `analytics_privacy_audit_events` and the
`reject_*_mutation` pattern):

- `store_server_credentials` — Project/Application/Environment-mode scoped;
  encrypted envelope (AAD domain v2); status, rotation and audit metadata;
  never exposes secret material on read.
- `billing_raw_inputs` — append-only; provider, source type, provider event
  ID, transaction-reference digest, received/provider timestamps, content
  hash, encrypted payload (post-resolution), authentication result, store
  environment, ingestion status, correlation ID. Immutability trigger.
- `billing_validation_attempts` — append-only; attempt number, timestamps,
  result, retryability, safe provider code, normalized diagnostic code,
  validator version, failure category. Immutability trigger.
- `billing_transaction_facts` — provider-independent; identity
  `UNIQUE (environment_id, fact_digest)` (makes replay a structural no-op);
  provider transaction ID, original-transaction/purchase-chain reference,
  token digest, provider Product identifier, resolved Mosaic Product ID +
  mapping version (Resolution Snapshot), transaction type, purchase/expiry
  timestamps, revocation/refund/renewal facts, store environment, validator
  version, fact version, source raw input ID. `resolution_state` may be
  `unresolved` — unresolved inputs still produce ledger completeness, never
  silent drops. No price, currency, or subject columns.
- `billing_ledger_entries` — append-only operational ledger (input received,
  authenticated, validation started/succeeded/failed, product
  resolved/quarantined, duplicate detected, reconciliation discovery, replay
  started/completed, revalidation completed). No update endpoint exists.
- `billing_product_resolutions` — resolution records with mapping version,
  status, diagnostic reason; reproducible historically.
- `billing_quarantine_records` — reason, severity, scopes, first/last
  attempt, status, recovery audit history.
- `billing_reconciliation_runs` + cursors — bounded range/cursor, progress,
  counts, restart safety.
- `billing_replay_jobs` — actor, validator version, comparison result.
- Hardening of existing tables where required: `CHECK (replaces_mapping_id
  <> id)` on `provider_product_mappings` (self-reference guard) and an index
  supporting mapping-history lookups in the resolution direction.

Constraints throughout: tenant (project) and Environment isolation columns
with composite FKs matching existing patterns; provider event ID unique in
provider+environment scope; sandbox/production cannot mix (mode alignment
checks); Product resolution cannot cross Projects; quarantined inputs cannot
be marked valid without a successful revalidation (enforced by state-machine
checks, no `Mark as Valid` path anywhere).

Forbidden tables (not created): entitlement, subscription-state,
access-grant, customer, RevenueCat-migration, financial ledger.

## 6. Ingestion pipeline

**Intake never validates inline.** Both providers punish slow/failing
endpoints (Apple: 5 retries total, none in sandbox; Pub/Sub: aggressive
redelivery). The intake contract is: verify authenticity → persist Raw
Billing Input → enqueue validation → return 2xx. No outbound provider call
on the request path. Notification endpoints are excluded from 429-returning
rate-limiter families (a 429 to Apple is unrecoverable data loss); they are
protected instead by size limits, the two-factor identity below, and
observable anomaly telemetry.

**Apple intake endpoint** (public HTTPS): two-factor —
an unguessable per-connection intake token in the URL path (stored SHA-256
only, API-key posture) **plus** JWS x5c-chain verification against the
pinned Apple Root CA. Tenant identity comes from the intake token, never
from payload content (bundle IDs are not globally unique across tenants);
the verified `bid` is then matched against the resolved Application and
mismatches quarantine. Request-size limits enforced; body never logged.

**Google intake** (worker pull): the worker consumes the Pub/Sub
subscription with the connection's service-account credentials, validates
the envelope, classifies Project/Application/Environment from the connection
scope plus verified `packageName` match, persists the Raw Billing Input, and
enqueues authoritative Play API lookup. Purchase tokens are never logged;
they are encrypted on persistence with the digest computed for idempotency.

**Client observation endpoint** (public, SDK key): untrusted; validates
shape (all references bounded by `safeProviderCode`, structurally excluding
JWS/raw tokens), classifies source authority, rate-limits (this endpoint MAY
429 — SDKs queue and retry), deduplicates by deterministic submission ID,
persists, enqueues. Responses: `accepted_for_validation` / `duplicate` /
`permanently_rejected` / `retryable_failure` — no `validated` member exists
in the enum.

**Trusted server endpoint** (secret key): same pipeline, source authority
`trusted_server_observation`; may carry a full Google purchase token
(encrypted on receipt); still requires provider validation.

**Validation workers** (existing lease/attempt/available_at queue model,
dedicated billing poll interval):
- Apple: verify signed transaction (and renewal info where present) — full
  x5c chain + ES256, reject `alg:none`/RS256 confusion; `bid` and store
  environment validation; Get Transaction Info lookup where the input is a
  bare reference; normalize to a Transaction Fact; resolve Product; ledger
  events; telemetry.
- Google: resolve the token (direct, or via `orders.get` when only an order
  ID was observed), call `purchases.subscriptionsv2.get` /
  `purchases.products.get`; validate package and environment; normalize;
  resolve; ledger; telemetry. Read-only against provider APIs — no
  acknowledge/consume/refund calls.

**Retry policy**: retryable categories (provider timeout, 429, 5xx,
transient network/auth-service failure) retry with exponential backoff +
jitter, max 8 attempts, honoring Apple's absolute-millisecond `Retry-After`;
permanent categories (invalid signature, malformed reference, application
mismatch, environment mismatch, unsupported type, revoked credentials) go
straight to quarantine/dead-letter. Every retry is a new Validation Attempt;
earlier attempts are never overwritten. Bounded provider timeouts on every
request; provider API budgets respect Apple sandbox limits (10% of prod).

**Idempotency keys**: Apple notifications — `notificationUUID`; Apple
transactions — `(environment, transactionId)`; Google notifications —
Pub/Sub `messageId` + notification content hash; Google purchases — token
digest (+ `orderId`); client observations — deterministic
`submissionId` (`storekit_transaction_<id>` / Android digest-based);
facts — `fact_digest` in environment scope. Never by timestamp, product,
customer, amount, or display name. Duplicate delivery never duplicates
facts; provider event timestamps and receive timestamps are stored
separately; older events are never discarded because newer ones arrived
first (ordering semantics belong to 9B).

## 7. Product resolution

`Provider + Application + Environment + provider Product identifier +
effective mapping history → Mosaic Product`. Resolution matches active
mappings, then archived mappings live at the transaction's `occurred_at`,
then walks the linear `replaces_mapping_id` chain (UNIQUE + self-reference
check ⇒ terminating). The Resolution Snapshot records the exact mapping ID
and version used. Outcomes: `resolved`, `unknown`, `ambiguous`,
`cross_environment_mismatch`, `unsupported_product_type` — unknown and
ambiguous quarantine; nothing resolves by display name, price, billing
period, or approximate match. Historical resolution is reproducible; a
Product replacement never erases prior meaning. The Phase 4B
single-Mosaic-Product-per-Google-Product constraint is not relaxed.

## 8. Reconciliation and replay

**Reconciliation** (scheduled + authorized manual, per provider/Application/
Environment, bounded range or cursor): Apple via Get Notification History /
Get Transaction History; Google via subscription re-query of known tokens.
Detects missed notifications, failed retries, incomplete chains, facts no
longer verifiable, unknown Products, stale credentials, environment
mismatches. Restart-safe, idempotent (discovered items enter the same
dedup pipeline), progress-reporting, auditable. No financial settlement; no
entitlement recomputation.

**Replay/revalidation**: select Raw Billing Input(s) and validator version;
new Validation Attempts are appended; prior attempts and facts preserved;
normalized output compared; conflicts quarantine with a warning; facts are
never duplicated (`fact_digest` identity) and never silently rewritten; no
customer access can change (structurally: no access state exists).

## 9. Billing Ingestion Contract v1

New versioned contract, born `status: draft` (approval only via the 9A
review): `protocol/schema/billing-ingestion/v1/` (four schema files),
`protocol/compatibility/billing-ingestion/v1.json`,
`protocol/fixtures/billing-ingestion/v1/{,responses,validation,invalid}/`,
`protocol/billing/CHANGELOG.md`,
`protocol/tools/billing-ingestion-validation-v1.mjs`,
`docs/protocol/billing-ingestion-v1.md`, plus mandatory registrations in
`validate.mjs` and `generate-rejection-layers.mjs` (browser-contract
generation deliberately untouched). ADR 0022 records the new public
contract; the separate 9A backend ADR (next free number) records the
Phase 4B reversal, ledger, and credential decisions.

Seven record types under `billingIngestionContractVersion: "1"`: client
observation, trusted server observation, submission result, validation
result, transaction fact, product-resolution result, quarantine record —
with source authority, store environment, retryability, diagnostic codes,
validator version, and replay metadata. The reference format carries a
`referenceKind` discriminator (resolving the iOS-prefix/Android-digest
ambiguity): iOS submits the **raw decimal** StoreKit `Transaction.id` as
`app_store_transaction_id`; Android submits the token digest
(`google_play_token_digest`, algorithm promoted to a documented cross-SDK
contract: SHA-256 over the UTF-8 token, lowercase hex) plus optional
`providerOrderReference` (`google_play_order_id`). The manifest's
readerPolicy machine-checks the frozen rules (no member named `validated`;
`clientAuthoritativeFact: forbidden`; `entitlementInference: forbidden`;
unresolved products quarantine; unclassified environment never aggregates
with production). ~20 valid + ~20 invalid fixtures, all `fixture-`-prefixed
synthetic values, no real credentials/tokens ever. Existing contracts
(Paywall 0.2, Delivery 1/2/3, Placement 1, Experiment Assignment 1,
Analytics 1/2, Commerce Provider 1/2, Commerce Configuration 1/2) are
untouched; billing↔analytics correlation uses existing opaque handles only.

## 10. REST, authorization, observability

REST resources (all under OpenAPI, tenant-scoped, owner/admin only — no new
role is invented; raw-payload read is permission-controlled and audited):
store server credentials (create/rotate/revoke/test — write-only secrets;
the full notification endpoint URL is returned only on create/rotate),
transaction observations (public SDK + trusted server), transaction facts
(read API reusing the `transactionFact` record verbatim), validation
attempts, quarantine (list/detail/recovery actions), reconciliation runs,
replay jobs, billing health.

Sensitive operations (credential lifecycle, replay, revalidation,
quarantine recovery, manual reconciliation) write audit events. The
`response.Error` 5xx cause-logging path is guarded for billing routes so
JWS/token fragments can never reach operator logs (following the
`authn/principal.go` redaction precedent).

OpenTelemetry: intake volume/authenticity failures, validation latency and
backlog, provider API latency/429s, retry counts, duplicates, resolution
failures, quarantine volume, reconciliation lag, replay results, credential
health. Safe identifiers only. Worker queue metrics follow the Phase 8
jobtelemetry pattern (billing jobs get queue depth/age metrics from day
one).

## 11. Dashboard

Three features (`store-connections`, `billing-ledger`,
`billing-operations`) + nine thin routes under
`routes/_hosted/organizations/$organizationId/projects/$projectId/billing/...`
(connections project-scoped; ledger/quarantine/reconciliation/health
Environment-scoped). Reuses `resolveHostedQueryState`,
`HostedResourceBoundary`, `WorkspacePage`, `useValidatedProjectScope`,
`describeApiError`, `JobStatus`, and the write-only credential sheet
pattern; `OneTimeSecret` is promoted from `features/api-keys` to
`src/components/feedback/` (approved); the shadcn `table` primitive is
added (approved — markup-only, no data-grid dependency). Setup, ledger
(dual timestamps, dual environment badges — Mosaic Environment and Store
Environment are always two controls), validation attempts, quarantine
(recovery actions from a single pure module; no "Mark as Valid"
affordance), reconciliation, replay comparison (append-only two-column
view, conflict warning, no overwrite), billing health. Empty/loading/
permission/error/recovery states via the existing boundary machinery. No
entitlement-active badges; facts are never labelled active subscriptions;
explanatory copy states reconciliation validates provider facts and does
not calculate customer access.

## 12. SDK validation handoff (Stage 3)

Opt-in (off by default: `transactionObservationEnabled = false` /
`MosaicTransactionObservationSettings`), fire-and-forget, never blocks
purchase UI, never re-labels a local purchase result as server-validated
(`serverConfirmedTransactions` stays `unsupported` everywhere), no server
credentials in any SDK, persistent duplicate-safe queue surviving restart,
no background-execution machinery in 9A (notifications are the reliable
path; the handoff is a latency/attribution optimization).

- **iOS**: observe synchronously (non-isolated sink) inside
  `acceptAndFinish` after acceptance-store insert (covers purchase,
  `Transaction.updates`, `unfinished`); submit raw decimal `Transaction.id`
  + store environment (iOS 16+ `@available` gate; `.xcode` environment
  suppressed) + `observedAt` + deterministic `submissionId`. Never:
  `jwsRepresentation`, `deviceVerification`, `appAccountToken`,
  `appTransactionID`. New `TransactionObservation{,Runtime}.swift` cloned
  structurally from `AnalyticsRuntime`.
- **Android**: submit existing SHA-256 token digest +
  new optional `orderId` (added to `GooglePurchase`/`MosaicCommerceUpdate`),
  on `PURCHASED` only, strictly after `recordFinalized`; acknowledgement
  untouched (stays client-side); raw token never on the wire or in logs.
  New `TransactionObservation*.kt` modelled on the analytics queue.
- **Flutter**: bridges the native observations via the already-decoded
  `MosaicCommerceUpdate.transactionReference`/`transactionId` (no codec
  bump); dedicated durable queue following the
  `MosaicExperimentAssignmentStore` pattern in application-support storage;
  sealed four-case submission result; reference sanitized to
  `safeProviderCode` at construction.

## 13. Minimum sufficient tests (risk-mapped)

Per `docs/architecture/conventions/testing.md` — no tests merely because
files are new; no provider/library internals re-tested.

Backend (9 core risks): x5c chain verification rejects invalid/alg-confused
signatures; Google envelope authentication rejected when invalid;
wrong-application and wrong-environment inputs quarantine; duplicate
notifications/observations/reconciliation discoveries produce no duplicate
facts; resolution across active/archived/replaced mappings is reproducible
and never guesses; unknown/ambiguous Products quarantine;
cross-Project/cross-Environment resolution fails; retry classification
(temporary retries with backoff, permanent dead-letters, attempts
preserved); replay preserves inputs/attempts and duplicates nothing;
append-only triggers reject mutation; credentials/tokens absent from logs
and error bodies (redaction test); router middleware-order case pinning
empty-Origin provider POSTs; migration up/down on fresh DB.

Dashboard (5): transaction search-param validation; quarantine
recovery-action prohibition (no mark-valid); replay comparison/conflict
rendering; notification-endpoint one-time reveal (DOM-leak risk);
reconciliation bounded-range rule.

SDKs (5–6 each, per inspection reports): observation never exceeds
bounds/charset; no secret or raw token in payload or diagnostics; purchase
flow never blocks; queue restart survival + duplicate safety; opt-out
default; no path to a "validated" claim.

Unavailable checks (documented honestly): live Apple sandbox / Google Play
test purchases and real notification delivery cannot run in this
environment; Stage 4 uses recorded/synthetic provider payloads and signed
test vectors, with live sandbox verification listed as an operator
follow-up in the 9A review.

## 14. Explicit exclusions

Everything in the Phase 9A prompt's exclusion list, verbatim — notably: no
authoritative entitlement state, no subscription-state computation, no
access decisions or webhooks, no RevenueCat migration/import, no manual
access overrides, no financial reconciliation/MRR/ARR/LTV/tax/invoicing, no
consumable/credit/metered/quantity Products, no Stripe/Paddle/Lemon
Squeezy, no analytics features, no Experiments, no AI, no Kafka/ClickHouse/
new database/new queue/microservices/gRPC/GraphQL. Additionally excluded by
owner decision: price/currency persistence, subject identity persistence,
Google purchase acknowledgement, analytics emission from validated facts,
background upload machinery in SDKs.

## 15. Phase 9A demonstration

As specified by the orchestration prompt (Stage 4): Apple flow (credentials
→ sandbox purchase → observation → notification → verify → validate →
resolve → fact → duplicate → idempotent), Google flow (credentials → test
purchase → observation → RTDN pull → authenticate → Play API → validate →
resolve → fact → duplicate → idempotent), quarantine (unmapped Product →
quarantine → repair mapping → re-run → fact, original input preserved),
retry (simulated outage → retryable attempt → recovery → success, failed
attempt preserved), reconciliation (omitted notification → discovery →
idempotent ingest), replay (prior input → new attempt → comparison →
no access change). Where live store sandboxes are unavailable, the
demonstration uses the synthetic signed vectors and records the limitation.
