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
  default 7 d, `staleGraceSeconds` default 24 h, all configured deployment-wide
  server-side in Phase 9B (per-Environment configuration is a tracked follow-up,
  not a shipped capability), with a 60-second clock skew tolerance evaluated in the direction
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

### Known consumer limitations, for the Stage 5 review

- **`restoreResult.outcome: "product_unresolved"` is currently unreachable from a
  client.** Reported by the Flutter agent on 2026-07-29 and applicable to all
  three SDKs: an SDK observing a restore has no signal that distinguishes "the
  provider transaction validated but its Product could not be resolved" from
  "validation has not finished yet", so a client-side restore reports
  `validation_pending` in both cases. The outcome remains reachable and correct
  on the **server** surface, where the projection knows which it is, and it stays
  in the enumeration for that reason — removing it would be a breaking change and
  would leave the server unable to state a condition it can actually detect.

  No action in Phase 9B. The fix is a signal, not a contract change: either the
  restore poll surfaces the quarantine reason for the observed transactions, or
  the sync response carries the pending-fact disposition. Raised here so the
  Stage 5 review decides deliberately rather than discovering it as a gap.

### Documentation pins, 2026-07-29

Orchestrator-ratified, documentation only, no schema change:

- The **SDK-conformant sync form is `POST /v1/sdk/billing/entitlements`** with the
  `entitlementSyncRequest` envelope, answered by a `200` carrying either
  `customerEntitlementSnapshot` or `snapshotUnchanged`. Negotiation and the
  conditional `knownSnapshotVersion` / `entityTag` live in the body, so an SDK
  never relies on a bare HTTP `304` or on freshness headers — no header name for
  freshness exists in the frozen schemas, and a `304` has no body to carry the
  refreshed window in. `GET` is an unconditional full-snapshot read for non-SDK
  callers; it ignores `If-None-Match` and always answers `200`. The Customer
  Access Token wire-form example was corrected from `GET` to `POST` to match.
- **An `entitlementKey` absent from a snapshot reads as `unknown`, never
  `inactive`**, whether or not `requestedEntitlementKeys` narrowed the response.
  Absence is not a statement: a key can be missing because it was narrowed away,
  never defined, or not evaluable, and the document gives a reader no way to tell
  those apart. An `inactive` entry is the opposite — Mosaic stating it looked and
  is confident — and is present in the document with an explanation and a source
  count. Documented with the narrowed-request example against the existing
  `sync/sync-request-requested-keys.json` fixture.
- The canonical spelling of the cross-customer cache state is
  **`differentCustomer`**, alongside `fresh`, `refreshRecommended`,
  `staleWithinGrace`, `expired`, `missing`, and `invalid`.

### Stage 4 documentation corrections, 2026-07-29

- **There is no conditional `GET` on the sync surface.** The branch was removed
  during the Stage 4 defect fixes (D-5). The `GET` read, which exists for non-SDK
  callers, is unconditional and always answers `200` with the full
  `customerEntitlementSnapshot`; `POST` with `entitlementSyncRequest` is the only
  conditional mechanism, and `snapshotUnchanged` the only unchanged response. A
  `304` could confirm a snapshot without being able to state how long the
  confirmation held, since it has no body and no freshness header exists in the
  frozen schemas — so it earned nothing over `snapshotUnchanged` and was a second
  place for freshness semantics to drift.
- **The Customer Access Token now travels on observation submission** as the
  optional `Mosaic-Customer-Token` transport header, so the server can record
  submission-context association evidence. Documented in the Billing Ingestion
  transport section under the established transport-is-not-contract rule: no
  Billing Ingestion record schema changes, the frozen draft stays frozen, and the
  credential never enters an observation body because those bodies are persisted,
  replayed, and digested into fact identity.

### Stage 5 placeholder completion, 2026-07-29

- A `customerEntitlementSnapshot` at `snapshotVersion: 0` is the cacheable answer
  for a Billing Customer whose first projection has not committed. It must carry
  no entries or sources and a pending projection status. Issued snapshots still
  start at 1, so every SDK replaces the placeholder through the ordinary
  monotonic comparison. Sync requests may state `knownSnapshotVersion: 0`, but
  the server reissues the placeholder rather than returning `snapshotUnchanged`.

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
