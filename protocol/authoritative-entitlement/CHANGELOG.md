# Authoritative Entitlement Contract changelog

## Version 1 - 2026-07-28

Status: draft

Born `draft` per Phase 9B owner decision OD-15. It carries **no compatibility
guarantee**: it may change or disappear without a version bump, and nothing in
the approved v1 GA set depends on it. It is promoted alongside Billing Ingestion
`1` once live-sandbox evidence exists.

While the contract is `draft`, narrowing and additive corrections are permitted
without a version bump, per
[the breaking-change process](../../docs/protocol/breaking-change-process.md).

### What version 1 introduces

Five canonical schemas plus a compatibility manifest, seven closed record types,
and the normative reader rule that gives the contract its purpose: **any
rejection yields `accessState: unknown` and preserves the cache, never
`inactive`**.

- **Four state axes** rather than one flat enumeration: `accessState`,
  `lifecycleState`, `renewalIntent`, `billingState`, plus an `uncertainty` object
  whose `reason` is closed at nine members. Every axis is closed and
  over-provisioned, so the members that might be needed are declared now.
- **`unavailable` is structurally impossible in a persisted snapshot entry.**
  Snapshot entries use a separate three-member `persistedEntitlementState`
  vocabulary. `unavailable` describes Mosaic's ability to answer, not customer
  access, so it is admissible only on read-time responses.
- **Schema-level `if`/`then` invariants**: revoked implies inactive and requires
  `revocationEffectiveAt`; grace requires `gracePeriodEnd`; unknown or
  unavailable requires a non-`none` uncertainty reason; paused requires
  `google_play`, because pause does not exist on Apple.
- **Canonical serialization** pinned in the manifest, with `contentDigest`
  (snapshots) and `checksum` (subscription snapshots) computed over it. The
  digest covers the customer, Project, Environment, and version binding, so a
  snapshot cannot be accepted into another customer's cache.
- **Bounded-grace freshness** per OD-5: `refreshAfter` default 1 h, `validUntil`
  default 7 d, `staleGraceSeconds` default 24 h, all per-Environment configurable
  server-side, with a 60-second clock skew tolerance evaluated in the direction
  that favours the user. The 30-day hard maximum applies to the **combined**
  horizon, `(validUntil - issuedAt) + staleGraceSeconds`, enforced by the
  semantic validator on snapshots and on unchanged responses alike.
- **Cache acceptance order** with binding checked before version, because
  snapshot versions are monotonic per Environment and a staging snapshot
  legitimately starts at 1.
- **Restore results on two axes**, `outcome` and `providerOutcome`, so a
  successful native restore that has not yet reached an accepted snapshot is
  `validation_pending` rather than `restored`.
- **`isTestSource` on every source** (OD-17). On Google Play, license-tester
  purchases arrive as ordinary production transactions and this flag is the only
  thing distinguishing a test grant from a paid one.

### Deliberate deviations, recorded

- **Product and Subscription Instance identity live on source summaries only**,
  not duplicated onto entries. This deviates from the orchestration prompt's
  entry field list. When several sources grant one Entitlement, duplication
  creates two places that can disagree, and the entry is the one a reader trusts.
- **`staleGraceSeconds` is an explicit member** rather than an implicit reading
  of the `refreshAfter`-to-`validUntil` interval. The orchestration prompt
  defines bounded grace as an interval *after* `valid_until`; OD-5 states
  defaults for `refresh_after` and `valid_until`. Making the grace window its own
  field expresses both without either interpretation being silently assumed, and
  makes the strict policy the same fields with a zero grace window rather than a
  separate mode. **Ratified by the orchestrator on 2026-07-28**, with the
  documented default set to 86400 rather than 0: bounded grace is the approved
  shipped policy, and a zero default would have shipped strict behaviour under a
  bounded-grace decision.
- **Billing disabled uses `uncertainty.reason: "provider_unavailable"`** with
  `explanationCode: "billing_disabled"`. The nine uncertainty reasons are fixed
  by the Stage 1 plan and none of them names a Mosaic-side service state; the
  explanation code carries the precision instead of widening a closed axis.

### Cross-contract discipline

Authoritative Entitlement `1` does **not** `$ref` Billing Ingestion `1`. Both are
drafts, and a draft that referenced another draft would inherit its lifecycle.
The safe-diagnostic shape is copied rather than referenced for the same reason.
No approved contract gains a required reference to this one.

### Fixtures

37 canonical fixtures and 27 invalid ones. Two invalid fixtures are recorded in
`rejection-layers.json` as **semantic** rejections rather than schema ones, which
is the honest classification: `older-snapshot-version-rejected.json` is
cross-field arithmetic no JSON Schema can express, and
`different-customer-rejected.json` is a digest computed over a different
`billingCustomerId` — the binding failure the digest exists to catch.

### Shared reference vectors

- `packages/test-fixtures/src/entitlement-snapshot-digest-vectors.json`
- `packages/test-fixtures/src/entitlement-cache-decision-vectors.json`
- `packages/test-fixtures/src/entitlement-freshness-vectors.json`

Built by `packages/test-fixtures/src/build-entitlement-reference-vectors.mjs`;
digests are computed, never hand-edited. Drift against the canonical fixtures and
against the manifest's pinned limits is checked by
`protocol/tools/authoritative-entitlement-validation-v1.test.mjs`.
