# Phase 9B Review: Subscription State and Authoritative Entitlements

Date: 2026-07-29
Owner: Muhideen Mujeeb Adeoye
Decision authority: Owner

## Status

**Accepted with tracked follow-ups.** Phase 9B implementation and Stage 5 review are complete.
Phase 9C may proceed only after owner direction. This review does not merge, tag, promote any
draft contract, or start Phase 9C work.

## Baseline

- Base commit: `ecfe845`, after the accepted Phase 9A head `1867605`.
- Branch: `phase/9b-subscription-state-entitlements`; reviewed head: `13eec83570f62545f6a7ba36639bf5a72105a15d` with the Phase 9B worktree uncommitted.
- Worktree: intentionally dirty with the reviewed Phase 9B implementation. Required untracked files are listed under Decision and must be included in the integration commit.
- GA tag: `v1.0.0` at `f83ba26`.
- Accepted Phase 9A review: `docs/reviews/phase-9a.md`, accepted with tracked follow-ups.
- Contracts: Authoritative Entitlement v1 draft, Customer Access Token v1 draft, Billing State Webhook v1 draft; Billing Ingestion v1 remains draft.
- Projection rule: version 1, provider-independent deterministic ordering and replay.
- Product grant policy: immutable prospective versions; Product replacement; retroactive correction only as a validated additive superset with impact preview and confirmation.
- Offline access: bounded grace; refresh after 1 hour, valid until 7 days by default, hard combined horizon of 30 days; expiry resolves to `unknown`, never `inactive`.
- Store policy: verified grace may grant; billing retry/account hold and effective pause do not; cancellation changes renewal intent but preserves access through the paid period.
- Customer association: Project-scoped Billing Customer, Environment-scoped purchase and snapshot state; lazy purchase anchoring; protected correlator evidence; public SDK-key evidence cannot move or freeze an attached lineage; trusted or operator evidence controls reassignment.
- Locking: transaction-scoped advisory locks by customer or lineage, CAS on projection version, and partial uniqueness on queued scope; no database lock spans network I/O.
- Webhook signing: HMAC-SHA256 over version, timestamp, event ID, and exact body; stable event IDs, rotating active keys, HTTPS-only pinned destinations, no redirects.
- Official documentation used, accessed 2026-07-28: Apple App Store Server API transaction/renewal payloads, subscription status and history; App Store Server Notifications V2; StoreKit `currentEntitlements`, `RenewalState`, Family Sharing, and `AppStore.sync`; Google Play Developer API v3 subscriptions v2, revoke, voided purchases, and products; Play Billing lifecycle, RTDN, test guidance, and `ReplacementMode`.

## Completed Deliverables

- Billing Customers, aliases, append-only association evidence, conflicts, lazy purchase anchors, protected adoption, and `absorbed` anchor history.
- Environment-scoped purchase lineages, subscription instances, non-consumable one-time instances, supersession, and no consumable entitlement model.
- Provider-independent multi-axis subscription state machine, canonical ordering, immutable snapshots and timeline, checkpoints, projection jobs/attempts, and projection-rule version 1.
- Immutable Product Grant Versions, Entitlement Sources identified by `(lineage, Mosaic Product, grant version)`, and monotonic Customer Entitlement Snapshots.
- Trusted server reads, SDK sync, opaque revocable Customer Access Tokens, restore jobs, deterministic replay/checksum comparison, and projection health.
- Minimal `customer.entitlements.changed` webhook slice with destination management APIs, encryption, signing, delivery history, retry, replay, audit, and SSRF controls. Full webhook dashboard management remains deferred by OD-1.
- Billing dashboard customer search/detail, subscription timeline, explanations, conflicts, restores, replay, projection health, recovery links, paging, Environment route scope, and generated OpenAPI client.
- Flutter, iOS, and Android authoritative entitlement sync, strict decoding, atomic monotonic caches, bounded-offline decisions, token refresh, restore, listeners, identity clearing, and canonical version-0 never-projected placeholder support.
- Goose migrations through `00050`, OpenAPI, operational documentation, structured diagnostics, audit, metrics/spans, protocol fixtures/vectors, unit and PostgreSQL integration tests.

## Product Review

Demand is validated by Mosaic's native billing and paywall scope: customers need one authoritative,
explainable access decision across store lifecycle events and multiple purchase sources. Mosaic
Billing stays optional and does not replace provider-observed SDK commerce APIs. The shipped
subscription state and Entitlement aggregate make cancellation, grace, retry, pause, refund,
revocation, upgrades, permanent purchases, and offline access explicit without exposing provider
vocabulary as the public state model.

The Product grant and bounded-offline policies match the approved plan. All OD-1 through OD-19
owner decisions were implemented as approved, including opaque revocable tokens (OD-14), the
minimal webhook slice (OD-1), deferred shadow diff engine until a second rule exists (OD-11), and
the blocking pre-production live-store verification follow-up (OD-12). RevenueCat migration,
manual grants, financial reporting, cutover, and bulk reassociation remain Phase 9C or later.

## UX Review

Operators can search customers, inspect subscription state axes and append-only Timeline events,
trace every Entitlement to its sources and explanations, and distinguish cancellation, grace,
billing retry, pause, refund, revocation, unknown, and unavailable. Multiple sources do not hide
one another. Conflict, restore, replay, and projection-health surfaces expose status and direct
recovery paths without offering unsafe direct Entitlement mutation. Environment-scoped Billing
routes now retain their scope. Exact provider transaction-reference lookup remains a support-tool
enhancement rather than a Phase 9B correctness dependency.

## Engineering Review

PostgreSQL is the system of record and migrations are explicit. Facts, published grants,
snapshots, timeline entries, evidence, webhook events, and attempts preserve history. Projection
is serialized and transactional, ordered independently of arrival, checkpoint-independent under
replay, checksum-deterministic, and retry-safe after partial identity/adoption enqueue failures.
Both affected customer aggregates are reprojected on legitimate reassignment or adoption.

Token scope, cache monotonicity, restore polling, worker leases/retries, webhook idempotency, and
failure recovery are covered at the lowest useful layers. The full Go suite, serial PostgreSQL
suite, migration drill, dashboard gate, protocol suite, three SDK suites, and both demonstrations
passed. No unavailable code checks remain; only live provider behavior is unavailable locally.

## Protocol Review

All three Phase 9B contracts are versioned drafts with closed producer schemas and compatibility
manifests. State semantics are provider-independent; `unknown` is persisted uncertainty while
`unavailable` is a read-time service result. Snapshot monotonicity and customer/Project/Environment
binding are explicit. Malformed, older, wrong-customer, or corrupt snapshots fail safely.

The canonical version-0 record is strictly the pending, empty, never-projected placeholder; it is
accepted by all SDKs, may be sent as `knownSnapshotVersion: 0`, and is replaced by ordinary version
1. Conditional sync is `POST` with a `200 snapshotUnchanged` body; `GET` is unconditional and never
returns 304. Existing contracts remain compatible, fixtures contain no provider secret, and source
identity is the ratified lineage/Product/grant-version tuple.

## Security Review

Aliases are domain-separated digests and customer tokens are random opaque values stored only as
digests. Project and Environment boundaries are schema- and service-enforced. A public SDK key
cannot select an arbitrary customer or use token-bound submission evidence to move/freeze an
attached purchase. Apple transaction-reference possession is not accepted as ownership proof.

Webhook secrets are encrypted, signatures pass shared vectors, destination delivery enforces the
documented SSRF policy, cross-tenant access tests pass, sensitive identifiers are excluded from
logs and responses, and high-risk identity, token, replay, conflict, grant, and webhook operations
are audited. There is no direct Entitlement mutation endpoint.

## State-Machine Review

The five state axes cover active, trial, grace period, billing retry, paused, expired, revoked,
refunded, unknown, renewal intent, billing condition, lifecycle, and uncertainty without collapsing
provider-specific events into the public contract. Transition tables cover cancellation, period
expiration, grace/recovery, retry, effective pause/resume, refund, revocation/reversal, upgrade,
downgrade, one-time ownership, late facts, unsupported states, and unknown evidence. Ordering and
projection-rule version 1 are recorded on derived state.

## Entitlement Review

Grant versions are immutable and selected by effective-time policy. Every contributing source is
preserved; a permanent source has no false expiry; source end and uncertainty remain explicit.
Effective dates and explanation codes are stable public data. Snapshot versions advance only on
material change, webhook changes derive from committed snapshots, and replay produces the same
checksum without rewriting history.

## SDK Review

All SDKs use an application-provided Customer Access Token, synchronize the same versioned
snapshot, treat ETag only as opaque equality, write caches atomically, reject regressions and
identity mismatches, and apply the same bounded-offline state machine. Tokens remain memory-only;
one forced refresh retry is bounded. Logout and identity change cancel inflight work and clear
customer state before another read. Restore results are explicit, listeners do not leak old grants,
and cross-platform fixtures cover snapshot, unchanged, placeholder, cache, freshness, and digest
behavior. Live StoreKit/Google Play device checks remain unavailable.

## Webhook Review

The shipped event vocabulary is limited to committed customer Entitlement changes. Event IDs and
bodies remain stable across retries; signatures bind timestamp, event ID, version, and exact body;
attempts are append-only; delivery ordering is defined per destination; replay is audited; retry
exhaustion is visible; and destination creation/delivery is protected by encryption and SSRF
controls. Delivery failure never rolls back access state. Full destination-management UI is not in
the approved OD-1 slice.

## Phase Boundary Review

No RevenueCat migration, historical customer import, dual-run cutover, bulk repair migration tool,
financial reporting, manual paid-access grant, or other Phase 9C implementation was introduced.

## Demo Review

The integrated driver passes initial purchase, renewal, cancellation with retained access,
expiration, multi-source aggregation, refund/revocation, grace/recovery, out-of-order replay,
Product transition, restore/cross-device sync, offline wire policy, conflict/no-double-grant,
stable-ID webhook retry, and deterministic replay. Per OD-11, the unimplemented rule version is
refused and replay/checksum comparison leaves state unchanged; no full shadow diff engine is
claimed. The one-minute purchase-to-webhook demonstration also passes. Exact evidence is in
`docs/reviews/phase-9b-demo-evidence.md`.

## Decision

**Phase 9B accepted with tracked follow-ups; proceed to Phase 9C only on owner direction.**

Tracked follow-ups:

1. Before production use or promotion of any Billing contract from draft, verify Apple and Google
   sandbox/test transitions for purchase, renewal, grace, billing retry/account hold, pause,
   refund, revocation, restore, and provider notification ordering.
2. Before integration, include every required untracked artifact. In particular, `git add -u` is
   insufficient: migration `00050`, both version-0 protocol fixtures, the dashboard list-heading
   module, and this review document are new files.
3. Treat exact provider transaction-reference lookup and full webhook destination UI as later
   operator-product work, not as direct Entitlement mutation or a reason to weaken access controls.

Final Stage 5 product, UX, protocol, and quality reviews were completed. The targeted quality
rereview found no blocking defect and accepted closure with the live-provider and integration
follow-ups above.

## Post-Acceptance Remediation — 2026-07-29

The Phase 9C entry inspection found and remediation closed two earlier-phase defects before any
Phase 9C implementation began:

- Billing webhook management now enforces PostgreSQL-backed owner/admin membership for every
  destination, signing-secret, delivery-history, and replay operation. Project and Environment
  mismatches return a non-enumerating not-found response; authenticated members without the
  required role are forbidden. Focused HTTP/PostgreSQL tests cover all route families.
- Migration `00051` makes fact-to-identity binding durable. A fact-producing Validation Attempt
  and its digest-only binding job commit atomically; binding retries never repeat provider
  validation or create another Transaction Fact. Attempt-keyed jobs preserve new evidence on a
  deduplicated revalidation, serialize work per lineage, reclaim expired leases, and terminalize
  exhausted leases without blocking later evidence.

The fresh-database migration apply/down/up drill, migration preflight, full serial Go suite,
`go vet ./...`, and independent quality/security rereview passed. No Phase 9C feature was included
in this remediation. The live Apple/Google verification follow-up remains open.
