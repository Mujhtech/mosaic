# Phase 9B Entry Review: Subscription State and Authoritative Entitlements

Date: 2026-07-28
Owner: Muhideen Mujeeb Adeoye
Decision authority: Owner

## Decision

**Open Gate 9B (Subscription State and Authoritative Entitlements).**

The Phase 9B preflight gate was run on 2026-07-28 against branch
`phase/9a-transaction-ingestion-validation` head `1867605`. Every
structural prerequisite passed (see "Preflight result" below). Three
items were reported as blockers; the owner reviewed the blocker report
and explicitly approved proceeding, with the dispositions recorded
here. Gate 9C remains closed.

## Preflight result

Passed: Phase 8 accepted for GA (`v1.0.0` = `f83ba26`); Phase 9A
accepted with tracked follow-ups (`docs/reviews/phase-9a.md`, head
`1867605`); Apple and Google server-side validation implemented and
test-verified; notifications authenticated and ingested; Raw Billing
Inputs, Validation Attempts, and the Billing Event Ledger append-only
with DB triggers; Normalized Transaction Facts immutable and
provider-independent; product resolution via mapping history with
quarantine; idempotent duplicate handling; history-preserving replay
and revalidation; reconciliation; schema-enforced sandbox/production
isolation; PostgreSQL system of record with clean Goose migrations;
encrypted and redacted provider credentials; Products and Entitlements
separate; entitlement state still provider-owned; no partial 9B engine
present (confirmed by the 9A full-diff boundary sweep); no unresolved
critical security, tenant-isolation, migration, backup, or
data-integrity defect.

## Owner dispositions on reported blockers

1. **Live Apple/Google sandbox verification** (9A follow-up #1, named
   in `docs/reviews/phase-9a.md` as a hard 9B entry precondition):
   **waived for 9B entry and carried as a tracked 9B follow-up.** No
   live Apple sandbox or Google Play test environment is reachable
   from this workspace; all 9A provider flows were demonstrated with
   synthetic signed vectors and local API stubs. Consequence accepted
   by the owner: Phase 9B builds on provider behaviour verified
   against recorded official documentation and synthetic conformance
   vectors, not live store traffic. Live verification remains required
   before production use of Mosaic Billing and before the Billing
   Ingestion Contract leaves `draft`.
2. **Billing Ingestion Contract v1 remains `draft`:** unchanged. The
   standing owner decision from 9A holds — the contract is not
   promoted to approved without live-sandbox evidence. Phase 9B builds
   against the draft contract as frozen at 9A acceptance; any 9B
   amendment to it follows the contract's own draft-amendment process.
3. **Phase 9B entry review absent:** resolved by this document.
4. **Unrelated uncommitted changes:** the two modified
   `.claude/agents/*.md` files were committed separately
   (`ecfe845`) before branching.

## Baseline

- Base: `ecfe845` on `phase/9a-transaction-ingestion-validation`
  (one chore commit after the accepted 9A review head `1867605`).
- Branch: `phase/9b-subscription-state-entitlements`.
- GA tag: `v1.0.0` (`f83ba26`).
- 9A review: `docs/reviews/phase-9a.md` — Accepted with tracked
  follow-ups; follow-ups #2–#8 remain the nonblocking backlog.

## Standing constraints carried into 9B

- Do not begin Phase 9C (migration, bulk import, cutover, financial
  reporting, manual grants).
- No merge to `main`, no tags, without owner action.
- Phase 9A history is immutable; 9B must not silently repair 9A
  defects — any discovered 9A defect is classified and surfaced.
- Live-sandbox verification (disposition 1) gates production use and
  contract promotion, and must appear in the Phase 9B review's
  tracked follow-ups if still outstanding at 9B acceptance.
