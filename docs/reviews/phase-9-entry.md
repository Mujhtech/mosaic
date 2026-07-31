# Phase 9 Entry Review: Mosaic Billing Program

Date: 2026-07-27
Owner: Muhideen Mujeeb Adeoye
Decision authority: Owner

## Decision

**Start Mosaic Billing.**

Entry is granted for **Gate 9A (Transaction Ingestion and Validation)
only**. Gates 9B and 9C remain closed and require their own entry
decisions after 9A is reviewed.

## Demand evidence

The conditional entry gate in `docs/product/roadmap.md` requires
post-v1 evidence of meaningful demand. That evidence is recorded in
`docs/research/post-ga-adoption.md` and accepted by the owner. In
summary:

- self-hosting adopters need transaction validation that does not
  route subscriber data through a third-party hosted backend
- provider-cost concerns motivate consolidation onto Mosaic
- cross-platform teams need one server-side source of validated
  transaction truth, which the native store adapters deliberately do
  not provide
- part of the design-partner cohort has expressed RevenueCat
  migration intent conditional on Phases 9A–9C

Provenance caveat: the primary demand signals are owner-attested, not
repository-verifiable. The Stage 1A product review must re-examine
this evidence and flag it if it no longer holds.

## Accepted GA baseline

- GA release: tag `v1.0.0`, commit `f83ba26`.
- Phase 8 review: `docs/reviews/phase-8.md`, status "Ready with
  documented limitations", with all residual findings closed and the
  final quality verification green.
- One post-GA commit exists on `phase/8-operational-hardening`
  (`de031ee`, agent-instruction documentation only; no product code).
  Phase 9A branches from `de031ee` so agent instructions are
  available; `v1.0.0` (`f83ba26`) remains the accepted GA product
  baseline.

## Preflight verification (2026-07-27)

- **PostgreSQL remains the runtime system of record.** No alternative
  runtime store exists; Compose profile provisions PostgreSQL as the
  only database.
- **Goose migrations apply successfully.** All 21 migrations
  (00001–00021) were applied via `cmd/migrate up --confirm` against a
  fresh PostgreSQL 17 instance on 2026-07-27 with zero errors.
- **No production in-memory persistence.** The only in-memory
  repository (`apps/api/internal/platform/cloudworkspacememory`) is
  Phase 3A deterministic test evidence, referenced exclusively from
  `_test.go` files.
- **Stable Mosaic Product IDs.** Products carry stable identifiers;
  `provider_product_mappings` references `(mosaic_product_id,
  project_id)` with `ON DELETE RESTRICT`.
- **Provider Product Mappings preserve historical identity.**
  Mappings support archive (`archived_at` with status check
  constraint) and replacement chains (`replaces_mapping_id` FK with
  `ON DELETE RESTRICT` and uniqueness), per migrations 00007/00008
  and the accepted Phase 4A/4B reviews.
- **Provider integrations operational.** RevenueCat, custom
  providers, StoreKit 2, and Google Play Billing integrations were
  re-verified green in the Phase 8 final quality verification.
- **Apple and Google environments separated.** Verified in the
  Phase 4B review and unchanged since.
- **Customer Entitlement state remains provider-owned.** No customer
  entitlement, subscription-state, or access-grant table exists in
  any migration; accepted reviews state Mosaic stores mappings, not
  authoritative customer state.
- **Branch hygiene.** Working tree clean at preflight time apart from
  this entry documentation.
- **No unresolved critical defects.** The Phase 8 review swept all
  eighteen release-blocker categories with no remaining known
  instance; security, migration, backup, and cross-tenant
  authorization defects found during Phase 8 were closed with
  executable evidence.

## Frozen entry constraints

- Phase 9A validates and records transaction facts only. No customer
  access is granted or revoked; no authoritative Entitlement state is
  computed; provider-owned entitlement authority is unchanged until a
  future 9B entry decision.
- Mosaic Billing remains optional. Studio, Products, Paywalls,
  Placements, analytics, and Experiments must not require it.
- RevenueCat migration remains Phase 9C.
- Financial accounting, MRR/ARR/LTV, tax, and invoicing remain
  excluded from Phase 9 entirely.
- The append-only billing ledger uses PostgreSQL unless measured
  evidence proves it insufficient.
- Branch: `phase/9a-transaction-ingestion-validation`, based on
  `de031ee`. No automatic merge; no automatic tag.

## Exit expectation

Phase 9A concludes with `docs/reviews/phase-9a.md` and a stop. 9B
entry requires that review to be accepted and this gate to be
revisited.
