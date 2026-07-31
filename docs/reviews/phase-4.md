# Phase 4 Consolidated Review: Commerce Providers

## Status

**Accepted with tracked follow-ups**

The product owner explicitly accepted the consolidated Phase 4 baseline on
2026-07-26 and authorized Phase 5 to begin. Gate 4A and Gate 4B are accepted
with their unavailable live-provider demonstrations retained honestly as
tracked environmental follow-ups rather than reported as passing evidence.

## Baseline

- Integrated commit: `988cf8bfb2a4930c8c709fd7bae74d6a264e16ab`.
- Branch at acceptance: `phase/4b-native-store-providers`.
- Gate 4A review: `docs/reviews/phase-4a.md`, accepted with tracked follow-ups.
- Gate 4B review: `docs/reviews/phase-4b.md`, accepted with tracked follow-ups
  by the product owner on 2026-07-26.
- Gate 4B evidence: `docs/reviews/phase-4b-demo-evidence.md`.

## Gate 4A

Gate 4A delivered the versioned Commerce Provider Contract, optional
RevenueCat integration, provider-neutral custom-provider interfaces, encrypted
server credentials, Product import and synchronization, exact provider Product
mappings, provider-owned Entitlement observations, Product readiness,
publishing validation, Studio integration, and cross-platform SDK support.

The RevenueCat live sandbox demonstration remains unavailable because this
workspace has no test Project credentials or store test accounts. This is a
tracked environmental follow-up, not passing evidence.

## Gate 4B

Gate 4B delivered optional StoreKit 2 and Google Play Billing adapters, exact
native Product mappings, normalized purchase and recovery results, durable
acceptance-before-finalization, provider capability diagnostics, Product
readiness and publishing validation, Studio workflows, and Flutter bridges to
the native adapters.

The real Apple sandbox and Google Play test-track demonstrations remain
unavailable for the reasons recorded in the evidence document. The owner has
accepted that limitation for the Phase 5 baseline while preserving it as a
tracked follow-up.

## Consolidated Product Review

- Mosaic Product IDs remain stable and provider-independent.
- Plans group Products without becoming provider objects.
- Products and Entitlements remain separate concepts; Products grant Access to
  Entitlements through explicit mappings.
- RevenueCat Packages, Offerings, App Store identifiers, Google Product IDs,
  base plans, and offers remain provider-specific adapter details.
- RevenueCat and custom providers remain optional and functional.
- StoreKit 2 and Google Play Billing remain optional adapters.
- Active customer Entitlement state remains provider-owned.
- Published Product references and immutable Paywall history remain stable.
- The native Paywall renderers remain provider-independent.
- No Phase 5 targeting, Phase 6 analytics ingestion, or Phase 9 receipt and
  subscription infrastructure was introduced.

## Engineering and Security Review

- PostgreSQL remains the runtime system of record through pgx repositories and
  explicit Goose migrations; production has no in-memory persistence fallback.
- Provider credentials use the accepted versioned AES-256-GCM envelope design.
- Provider mappings enforce Project, Environment, Application, platform, and
  connection scope.
- Purchase, cancellation, pending, failure, restore, recovery, and observed
  Entitlement outcomes remain explicit.
- Unknown, unavailable, and failed provider state is not converted into
  inactive Entitlement state.
- Provider credentials, receipts, purchase tokens, and raw customer payloads
  are excluded from public diagnostics and logs.
- Available protocol, backend, dashboard, Flutter, Swift, Kotlin, and repository
  checks are recorded in the Gate reviews.

## Demo Review

- Deterministic provider integration and unchanged-Paywall evidence: passed.
- RevenueCat live sandbox demonstration: unavailable and tracked.
- Apple real-store sandbox demonstration: unavailable and tracked.
- Google Play test-track demonstration: unavailable and tracked.
- Cross-provider live purchase demonstration: unavailable and tracked.

## Tracked Follow-ups

1. Capture the RevenueCat sandbox workflow with production-shaped credentials.
2. Capture the signed Apple sandbox purchase, cancellation, pending, recovery,
   synchronization, and observed-Entitlement workflow.
3. Capture the Play-distributed license-test purchase, pending, recovery,
   acknowledgement, and observed-Entitlement workflow.
4. Re-run the unchanged-Paywall cross-provider demonstration using live hosted
   Configuration Releases and the recorded canonical Product identifiers.

## Decision

**Phase 4 accepted with tracked follow-ups; Phase 5 is authorized to begin.**

This decision does not classify unavailable demonstrations as passing, does not
merge automatically, and does not authorize Phase 6.
