# Phase 9C candidate evaluation

Phase 9C evaluates RevenueCat current-access evidence against Mosaic's accepted
Phase 9B projection rules before cutover. The evaluator is deliberately not a
second billing engine: it selects only ordinary Phase 9A facts produced by a
terminal migration-validation binding, then calls the same pure projection
engine used for live billing.

## Frozen inputs

Every evaluation is bound to one program state version, source manifest,
frozen mapping set, readiness policy, validation-evidence digest, and authority
epoch. Every program scope must still be source-authoritative at that epoch.
A wrong job lease, scope, state version, digest, or epoch fails closed.

The provider-reference link is exact. The evaluator recomputes Phase 9A's
provider-specific reference digest and requires the Package E binding's
Application, provider Product identifier, and Mosaic Product to match the
current-manifest import row. Pending, quarantined, missing, unresolved, or
mismatched evidence is excluded from projection and recorded as a blocking
divergence.

## Candidate isolation

Candidates are append-only `customer_entitlement_snapshots` so the existing
prepared-pointer and checkpoint foreign keys can name them. Evaluation never
updates `customer_entitlement_pointers`, scoped current pointers, CAT, or an
authority row. `billing_migration_candidate_evaluations` and
`billing_migration_candidate_snapshots` bind each candidate to its frozen
inputs and immutable source-versus-Mosaic comparison evidence.

Because candidate and live snapshots share the per-customer version namespace,
each distinct evaluation intentionally consumes snapshot versions. Live
projection allocates after the maximum immutable snapshot version rather than
after only the live pointer version, so candidate creation cannot cause a later
live projection to collide. This is allocation only: live/prior reads remain
addressed through `customer_entitlement_pointers`, and never select the newest
snapshot by version.

Dry runs persist evidence and candidates but return no prepared pointers or
shadow snapshots. Shadow and final-delta evaluation return one prepared row for
every exact current-access customer × program scope. Final-delta cohort,
watermark, candidate, comparison, and result digests use sorted stable inputs;
replaying the same job returns the same identifiers and digests. Comparisons are
bidirectional: source access that Mosaic denies and Mosaic access that the
source denies are both critical divergences. Inactive source evidence remains
in the immutable comparison cohort so one customer cannot borrow another
customer's validated fact or disappear from a revocation comparison.
