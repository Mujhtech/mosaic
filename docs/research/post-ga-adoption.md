# Post-GA Adoption and Mosaic Billing Demand

Date: 2026-07-27
Author: Owner (Muhideen Mujeeb Adeoye)
Status: Accepted as Phase 9 entry evidence

## Purpose

The Phase 9 conditional entry gate in `docs/product/roadmap.md` requires
post-v1 evidence of meaningful demand for replacing RevenueCat or
equivalent subscription infrastructure before any Mosaic Billing work
begins. This document records that evidence and its provenance honestly:
it distinguishes what is verifiable inside this repository from what is
attested directly by the project owner.

## Baseline context

- Mosaic v1.0.0 was released at tag `v1.0.0` (commit `f83ba26`), with
  Phase 8 reviewed as "Ready with documented limitations" in
  `docs/reviews/phase-8.md`.
- At GA, Mosaic ships with four operational commerce paths: RevenueCat,
  custom providers (Phase 4A), and first-party StoreKit 2 and Google
  Play Billing adapters (Phase 4B). All remain provider-owned for
  customer access: "RevenueCat or the app-owned custom provider remains
  authoritative for active customer Access. Mosaic stores mappings, not
  authoritative customer state" (`docs/reviews/phase-4a.md`).
- `docs/releases/v1.0.0-notes.md` explicitly lists Mosaic Billing
  (Phase 9) as not included at GA.

## Demand signals

### Owner-attested demand (primary)

The following demand signals are attested by the project owner as of
2026-07-27. They are not independently verifiable from repository
artifacts and are recorded here as the owner's accepted entry evidence,
per the roadmap's allowance for design-partner and user demand reported
through the owner:

- **Self-hosting requirements.** Mosaic's v1 deployment model is
  self-hosted (single-host Compose, Profile A). Self-hosting adopters
  report that depending on a third-party hosted billing backend
  (RevenueCat) undermines the reason they chose a self-hosted paywall
  platform: their transaction and subscriber data still leaves their
  infrastructure.
- **Provider-cost concerns.** Adopters evaluating Mosaic against
  RevenueCat cite RevenueCat's revenue-percentage pricing as a
  motivation to consolidate on Mosaic if it can validate transactions
  and (eventually) own entitlement state.
- **Need for authoritative cross-platform Entitlements.** Teams
  shipping the same product on iOS and Android through the native
  store adapters ask for a single server-side source of validated
  transaction truth, which the native adapters intentionally do not
  provide (`docs/reviews/phase-4b.md`: "Native stores report observed
  access; Mosaic does not become an authoritative subscription
  backend").
- **Migration intent.** At least part of the design-partner cohort has
  expressed intent to migrate off RevenueCat if Mosaic Billing reaches
  parity for validation, entitlements, and migration tooling
  (Phases 9A–9C).

### Repository-verifiable signals (supporting)

- The roadmap has carried Phase 9 (Mosaic Billing) as the planned
  answer to authoritative validation and entitlements since Phase 4,
  with repeated explicit deferrals in accepted reviews
  (`docs/reviews/phase-4.md`, `phase-4a.md`, `phase-4b.md`,
  `phase-8.md`), indicating sustained, scoped intent rather than
  speculative expansion.
- The Phase 4B design deliberately deferred server receipt validation
  ("without deferred server receipt validation",
  `docs/reviews/phase-4b.md`), leaving known validation gaps (e.g.
  authoritative base-plan distinction on Android) that only
  server-side validation closes. These gaps are concrete product
  limitations that Phase 9A resolves.

## Limitations of this evidence

- No external issue tracker links, partner names, or adoption metrics
  are recorded in this repository. The owner-attested signals above
  should be re-validated during the Phase 9A product review
  (Stage 1A) and again at the Phase 9B entry decision.
- Demand is strongest for validation and auditability (9A) and
  cross-platform entitlements (9B). No demand signal recorded here
  justifies financial reporting, which remains excluded from Phase 9.

## Conclusion

The owner accepts this evidence as satisfying the Phase 9 conditional
entry gate for **Gate 9A only**. Entry into 9B and 9C requires their
own gate reviews. The corresponding entry decision is recorded in
`docs/reviews/phase-9-entry.md`.
