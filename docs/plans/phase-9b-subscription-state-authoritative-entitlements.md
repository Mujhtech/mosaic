# Phase 9B Plan: Subscription State and Authoritative Entitlements

Status: **Stage 1 complete — awaiting owner decisions (§2) before Stage 2.**
Branch: `phase/9b-subscription-state-entitlements` (base `ecfe845`, one chore
commit after accepted 9A review head `1867605`). Entry review:
`docs/reviews/phase-9b-entry.md`.

This plan reconciles the eight Stage 1 inspection reports (product,
protocol, backend, quality; dashboard, Flutter, iOS, Android). Where the
reports disagreed, the resolution and its reasoning are recorded here.
Sections marked **[OD-n]** are gated on the owner decisions in §2 and
record the recommended option; implementation must not begin against a
gated section until the owner has decided.

---

## 1. Stage 1 findings that reshape the phase

1. **Phase 9A persists no customer identity anywhere.** Apple
   `appAccountToken` is structurally never parsed
   (`internal/platform/appstorejws/payloads.go` omits the field); Google
   `obfuscatedExternalAccountId` is likewise never persisted; facts have
   no subject column; `docs/guides/privacy.md` documents this as a
   guarantee. Every 9B association path must be built new [OD-2].
2. **Two accepted-9A defects must be fixed before projection is safe**
   (classified per the no-silent-repair rule; both are exactly the class
   of defect live-sandbox testing would have caught):
   - **B1**: `service_worker.go:581-586` overwrites `fact_kind` with
     `purchase_superseded` whenever Google's persistent
     `linkedPurchaseToken` attribute is present — the successor
     subscription's expiration/cancellation/grace facts never appear by
     kind → indefinite entitlement after any Google plan change.
   - **B2**: a voided/refunded Google one-time purchase records **no
     fact** (`purchaseState != 0` → `recorded_no_fact`) → refunded
     non-consumables stay entitled forever.
   - Also **B7**: `occurred_at` wall-clock fallback participates in
     `FactDigest`, defeating replay idempotency; quarantine instead.
   [OD-13]
3. **No webhook or token-signing infrastructure exists** anywhere in the
   repository. The prompt's "reuse the accepted webhook-signing system"
   has no referent; webhooks are also placed in Gate 9C by the roadmap.
   [OD-1, OD-14]
4. **`product_entitlement_grants` is unversioned and hard-deletable** —
   a one-DELETE mass-revocation path. Versioning with backfill is
   required scope, not optional. [OD-8]
5. **Google ordering/replay caveats**: all facts in a Google lineage
   share `occurred_at = startTime`; Google validation re-queries live
   provider state, so replay is fact-sourced for Google, input-sourced
   for Apple (§8, §12).
6. **Provider semantics are now documentation-verified** (backend
   report, Part 3; sources with URLs and access date 2026-07-28): grace
   grants access on both providers; billing retry / account hold does
   not; Google pause does not; cancellation is renewal-intent-only until
   period end; Google `linkedPurchaseToken` is the supersession edge;
   Apple `REFUND_REVERSED` requires reversible revocation; Google
   voided-purchases lookback is 30 days, so void events must be
   persisted on receipt.
7. **iOS restore gap**: the StoreKit adapter never emits observations
   from `Transaction.currentEntitlements`, so a fresh-device restore
   submits nothing; restore-path emission (idempotent through both
   existing dedup layers) is required 9B SDK work.
8. **Backup-exclusion inconsistencies** on iOS (four stores, including
   the StoreKit acceptance store — a correctness issue) and Flutter (no
   store is backup-excluded). All 9B entitlement caches are
   backup-excluded from day one. [OD-19 for remediation of existing
   stores]

## 2. Owner decisions required (with recommendations)

Implementation of gated sections must not begin until each is decided.

| # | Decision | Options | Recommendation |
|---|---|---|---|
| OD-1 | Webhooks in 9B or 9C (roadmap places them in 9C; prompt places full subsystem in 9B) | (a) defer entirely to 9C — backends poll the Access Decision API; (b) minimal slice: `customer.entitlements.changed` only, HMAC signing, at-least-once delivery, attempt history, API-only destinations, no UI; (c) full subsystem + roadmap amendment | **(b)** with roadmap amended to record the split |
| OD-2 | Customer-association evidence | (a) submission-context only (token-bound SDK / trusted-server observations); (b) (a) + forward-only protected capture (SHA-256 digests, never raw) of Apple `appAccountToken` and Google `obfuscatedExternalAccountId` parsed server-side from raw payloads into 9B-owned evidence tables — Billing Ingestion v1 stays frozen; privacy guide amended in the same change; pre-9B facts project `unknown` until an explicit restore/link | **(b)** |
| OD-3 | Billing Customer scoping | (a) Environment-scoped customer (isolation fully structural); (b) Project-scoped customer identity, with Environment-scoped lineages, instances, subscription snapshots, tokens, webhooks, **and Environment-scoped Customer Entitlement Snapshots + current pointers** (one pointer per (customer, environment)) | **(b)** — matches the prompt's "a Customer belongs to one Project" while keeping sandbox/production isolation schema-enforced everywhere state lives |
| OD-4 | Anonymous installation-scoped access | (a) identified-only in 9B — Mosaic Billing requires an application backend, documented prominently; the installation alias exists only as evidence/diagnostics/cache-key/restore-hint and can never create or select a customer; (b) installation-scoped customers (the prompt's line-1368 anonymous mode — this is structurally the RevenueCat duplicate-customer trap: eager creation anchored to a client-generated device-local ID) | **(a)**; decline (b). See §5a customer-creation model |
| OD-5 | Offline access policy (uniform across all three SDKs) | strict / bounded grace / server-only | **Bounded grace**: `refresh_after` 1h, `valid_until` 7d defaults, per-Environment configurable, hard max 30d; past grace → `unknown` (never `inactive`); server-only documented as guidance for irreversible actions |
| OD-6 | Authoritative vs provider-observed entitlements in SDKs and placement targeting | (a) purely additive `MosaicCustomer…` namespace; targeting keeps reading provider-observed; no existing symbol changes; (b) authoritative replaces targeting input; (c) configurable | **(a)** for 9B; (c) later behind its own decision |
| OD-7 | Customer deletion vs the published privacy claims | (a) split: billing facts/customers/snapshots exempt (financial evidence); aliases (the PII — the person-to-purchase link) erasable/redactable; `docs/guides/privacy.md` §"no customer table" claim rewritten in the same change; (b) full cascade deletion | **(a)**. Hard constraint (verified): the Phase 6 deletion job hard-DELETEs analytics identity rows (`analyticspostgres/jobs.go:346-380`), so billing aliases must be an independent table with **no FK into analytics identity tables** — RESTRICT would break accepted deletion behaviour, CASCADE would silently revoke entitlements |
| OD-8 | Grant-change policy + backfill | prospective-by-period-effective-time + Product replacement; retroactive only as validated **additive-superset** correction with impact preview + confirmation. Backfill: (i) v1 effective from beginning of time; (ii) v1 effective from `created_at`, with prior grant-then-remove cycles reconstructed as closed intervals from `audit_events` (verified reliable: grants are discrete audited INSERT/DELETE operations, never bulk-replaced), plus the deterministic rule that a purchase predating the earliest version selects the earliest version | **Prospective + replacement + additive-superset**; backfill option **(ii)** — exact for live pairs, best-effort-reconstructed for removed pairs, no stranded historical purchase |
| OD-9 | Family Sharing | (a) exclude; (b) Apple `FAMILY_SHARED` transactions are an independent-lineage source for the family member's customer under the same evidence rules, revoked immediately on `FAMILY_REVOKE`, ownership type recorded in explanations; no family graph; Google N/A | **(b)** |
| OD-10 | Identity conflict behaviour | (a) freeze projection for the disputed lineage, preserve last committed state, mark `identity_unresolved`, operator resolution; (b) drop to `unknown` immediately | **(a)** |
| OD-11 | Shadow projection in 9B | (a) defer the diff engine until a second rule version exists (rule versions recorded on every snapshot from day one; replay + checksum comparison ship in 9B); (b) build full shadow infra now per prompt | **(a)** — deviation from the prompt, needs explicit sign-off |
| OD-12 | Live-sandbox waiver hardening | (a) waiver stands through 9B acceptance; (b) live verification of grace, billing-retry, pause, refund, revocation transitions becomes a named **blocking pre-production follow-up** in the 9B review | **(b)** |
| OD-13 | 9A defect corrections (B1, B2, B7) | (a) fix within 9B as explicitly classified 9A corrections (first backend work package, own commits, reprojection consequence stated); (b) separate 9A fix branch first | **(a)** |
| OD-14 | Customer Access Token mechanism | (a) opaque random tokens stored as SHA-256 digests (ADR-0017 posture; revocation is one UPDATE; Project/Environment/customer scoping is composite-FK columns, not claims validation; no signing ADR); (b) signed JWS + new ADR. **Note: the orchestration prompt's token list says "signed" — (a) is an explicit deviation** that satisfies every other requirement on that list strictly better (especially "revocable where practical") and needs owner sign-off as a deviation, not a quiet substitution | **(a)**; SDKs hold tokens in memory only, never persisted |
| OD-15 | Contract status | all three 9B contracts born `draft`, promoted alongside Billing Ingestion v1 once live-sandbox evidence exists | **yes** |
| OD-16 | Webhook consumer tolerance | documented departure from repo-wide fail-closed: producers strict (`additionalProperties: false`), consumers documented tolerant (ignore unknown fields/event types, re-read the snapshot) | **accept** |
| OD-17 | Test transactions (`is_test_transaction`) | Verified structural asymmetry: Apple sandbox facts (incl. all TestFlight purchases) **cannot** reach a production-mode Environment — `storeEnvironmentMatchesMode` + the 00024 alignment CHECK quarantine them; this is a fraud control (Apple sandbox accounts are free and self-service) and must never be relaxed. TestFlight testers get access by pointing TestFlight builds at a staging Environment. Google has no sandbox: license-tester purchases (operator-allowlisted in Play Console) arrive as production transactions flagged `is_test_transaction`. Options: (a) per-Environment `test_transaction_entitlement_policy` ∈ {deny, grant}, default `grant`, every test-derived Entitlement carrying an `is_test_source` flag on server API, SDK result, and webhook payloads; (b) deny in production-mode Environments | **(a)** — and the Apple/Google asymmetry is documented in the 9B entitlement semantics |
| OD-18 | Apple prorated refund (`REFUND_PRORATED`) — provider docs do not state remaining-period effect | (a) does not revoke the remaining period unless provider status says revoked; (b) revokes | **(a)** |
| OD-19 | Backup-exclusion remediation of existing stores (iOS `Identity.swift`, `ConfigurationStore`, `CommerceConfigurationStore`, `MosaicStoreKitAcceptanceStore`; Flutter stores) | (a) fix the acceptance store + identity in 9B as classified corrections, file the rest; (b) fix all in 9B; (c) file all separately | **(a)** |

## 3. Orchestrator-ratified decisions (recorded, not owner-gated)

- **SDK naming**: `MosaicCustomer…` prefix on all three platforms
  (Flutter and Android proposals adopted; iOS renames its proposed
  `MosaicAuthoritative…` types accordingly). Provider-observed symbols
  are frozen; no renames, no deprecations.
- **Cache states** (identical on all platforms): `fresh`,
  `refreshRecommended`, `staleWithinGrace` (exists only under bounded
  grace), `expired`, `missing`, `invalid`, `differentCustomer`.
  Clock-unreliability is a diagnostic that forces expired-equivalent
  behaviour, not an extra enum member.
- **Cross-platform constants**: clock-skew tolerance 60 s; restore
  snapshot-poll bound 3 attempts / ~6 s before `validation_pending`.
- **Snapshot versioning**: `snapshotVersion` is a per-customer(-per-
  environment) monotonic integer and the sole cache-monotonicity key;
  ETag is an opaque HTTP validator only; a no-change projection does
  not advance the version (`lastProjectedAt` in projection status
  does). `304` responses carry refreshed `refresh_after`/`valid_until`
  as headers so a confirmed-current snapshot does not expire.
- **Entitlement entry shape**: `mosaicProductId` /
  `subscriptionInstanceId` live on source summaries, not duplicated on
  entries (deliberate deviation from the prompt's entry field list, to
  prevent two places disagreeing).
- **Serialization**: transaction-scoped advisory lock
  (`billing-projection:{customer_id}` / `…-lineage:{lineage_id}`) via
  the accepted `LockScope` pattern, plus CAS on
  `current_projection_version` as a belt, plus projection-job partial
  uniqueness on scope key. No lock held across network I/O.
- **Entitlement Source identity** is `(purchase lineage, product,
  grant version)` — never a fact ID — so multi-fact-per-purchase
  (mapping drift, validator bumps) cannot double-grant.
- **Association from raw payloads**: correlators are parsed
  server-side from ledger raw inputs into 9B-owned tables; Billing
  Ingestion Contract v1 is not amended and `subjectReference` stays
  unpopulated. Fact→authority resolution scans raw inputs by
  `transaction_reference_digest` (first-writer-wins fact provenance is
  not authoritative; quality B8).
- **Webhook signing** (if OD-1 ships any slice): HMAC-SHA256,
  `Mosaic-Signature: t=…, v1=hex(hmac(secret, version.t.eventId.body))`,
  multiple active keys during rotation, secrets sealed as a new v2 AAD
  `SubjectKind` — requires the "new webhook-signing system" ADR.
- **SSRF policy** for destinations: HTTPS-only, deny
  RFC1918/loopback/link-local/CGNAT/ULA/IPv4-mapped, resolve-and-pin
  per attempt, no redirects, bounded time/size, self-hosted allowlist
  env flag — recorded as policy in the ADR above.
- **Billing disabled** maps to `unavailable` on every entitlement
  surface, never `inactive`; tested.
- **Dashboard IA**: Customers under the existing Billing nav group
  (Environment-scoped routes for consistency; the customer header
  states Project scope); grant versions in Catalog; projection health
  as a sibling of billing health; the existing catalog grant/revoke
  mutation is retired in favour of versioned grants; 9A's
  `BILLING_BOUNDARY_NOTE` is revised. A direct `GET customer/{id}`
  endpoint is mandatory.
- **Customer token wire form**: the customer token travels in
  `Authorization: Bearer` on the SDK sync surface with the public SDK
  key in `Mosaic-SDK-Key` — final header naming is a Stage 2 protocol
  work-package decision, bound by contract fixtures.

## 4. Official provider documentation consulted

Recorded in full in the Stage 1A backend report (Part 3.5), incorporated
here by reference; access date 2026-07-28. Apple: App Store Server API
(transaction/renewal payloads, subscription statuses, transaction
history), App Store Server Notifications V2, StoreKit
(`currentEntitlements`, `RenewalState`, Family Sharing, `AppStore.sync`).
Google: Play Developer API v3 (`purchases.subscriptionsv2` + `revoke`,
`voidedpurchases`, `purchases.products`), Play Billing lifecycle/RTDN/
test docs, ReplacementMode. Key normalization decisions: §1.6 of this
plan and backend report Part 3.1–3.4. Neither provider guarantees
notification ordering; the canonical ordering tuple (§8) is Mosaic
policy.

## 5. Domain model

As specified in the backend Stage 1A report Part 2 (adopted with the
scoping amendment of OD-3(b)):

- `billing_customers` (Project-scoped identity; `status` incl.
  `frozen`/`anonymized`; diagnostics; audit).
- `billing_customer_aliases` (typed; SHA-256 digest values with
  domain separation, never raw; partial-unique one active resolution
  per `(project, type, digest)`; end-dated history).
- `billing_association_evidence` (append-only; evidence types:
  `app_account_token`, `obfuscated_external_account_id`,
  `trusted_server_observation`, `prior_lineage_association`,
  `restore_link`, `operator_repair`; outcomes resolved / unresolved /
  conflicting / unsupported; resolver versioned).
- `billing_identity_conflicts` (one open per lineage; freeze semantics
  per OD-10).
- `purchase_lineages` (Environment-scoped; unique
  `(environment_id, provider, lineage_key_digest)`; Apple key =
  `originalTransactionId` digest, Google key = purchase-token chain
  root walked through `linkedPurchaseToken`; explicit
  `superseded_by_lineage_id`; environment-mode alignment CHECK).
- `subscription_instances`, `one_time_purchase_instances` (1:1 with
  lineage; consumables excluded).
- `subscription_snapshots` (immutable; five state axes; effective
  timestamps incl. grace end, retry start, pause/resume, cancellation,
  expiration, revocation, refund; checksum; rule version; source-fact
  links via `subscription_snapshot_facts`).
- `subscription_timeline_entries` (append-only; closed entry-type set;
  safe detail via the ledger guard function).
- `projection_checkpoints` (derived, rebuildable; invalidated by
  out-of-order facts), `projection_rule_versions` (seed v1; one
  active), `projection_jobs`/`projection_attempts`.
- `product_entitlement_grant_versions` (immutable versions; no-overlap
  intervals; access-policy columns `grants_in_grace` etc. defaulted per
  OD-5/§7; backfill per OD-8), plus `entitlements` lifecycle columns.
- `entitlement_sources` (per customer-snapshot generation; identity
  `(lineage, product, grant version)`).
- `customer_entitlement_snapshots` + `…_entries` (immutable; monotonic
  per (customer, environment); `unavailable` never persisted — it is a
  read-time service state).
- `customer_access_tokens` (opaque digests per OD-14; ≤1h default,
  ≤24h max; audience/scopes; Environment-bound).
- Webhook tables per OD-1 scope; `restore_sync_jobs`,
  `projection_replay_jobs`; shadow tables deferred per OD-11.

## 5a. Customer creation model (avoiding customer proliferation)

The duplicate-customer failure mode of client-anchored systems (eager
creation at SDK launch, anchored to a device-local ID, reconciled later
by lossy merge) is avoided structurally by four rules:

1. **Lazy creation.** No Billing Customer exists until either the host
   backend identifies a user (trusted flow) or a validated purchase
   fact needs somewhere to attach. SDK init and installation
   registration create nothing.
2. **Anonymous purchases anchor to the purchase lineage, not the
   device.** 9A already persists store-account-derived anchors
   (`purchase_chain_digest` from Apple `originalTransactionId`;
   Google token digest chains + `supersedes_chain_digest`) that
   survive reinstall, clear-data, and device changes — so a
   reinstalling user who restores resolves to the *same*
   purchase-anchored customer.
2a. **Installation alias is evidence, never an anchor.** When the SDK
   supplies it, the installation alias is recorded as association
   evidence on the Billing Customer — giving purchase→install
   attribution (a real conversion funnel) at zero proliferation cost —
   but it never creates or selects a customer. Pre-purchase
   usage questions ("someone is using the app and might subscribe")
   are answered by Phase 6 analytics (`analytics_installations`,
   sessions, funnels), not by empty billing rows; the identified-user
   join happens at report time on the shared application-user ID value
   (deliberately no FK — see OD-7's deletion constraint). Honest
   residue: a purchase-anchored, never-identified customer whose
   installation evidence never arrived has correct revenue but no
   install attribution. Dashboard shows active installations (Phase 6)
   and Billing Customers (9B) side by side, never conflated.
3. **Login attaches, it does not merge.** Identifying a user appends
   an application-user alias to the existing lineage-anchored
   customer; merge is made rare by construction rather than made good.
4. **Real conflicts quarantine** (one app-user alias claiming two
   customers with real purchases): freeze, grant neither
   automatically, operator resolution, audit — per OD-10. Automatic
   merge stays an ADR checkpoint, not taken in 9B.

Security corollaries: the client-generated installation ID must
never, by itself, select an existing Billing Customer (replay/guess ⇒
reading someone else's entitlements); the application-user alias is
assertable only by the customer's backend (secret key or a token that
backend minted), never by a public-SDK-key client; restore resolves
customers through server-validated store lineage, never a
client-asserted identifier. Caveat: Apple `originalTransactionId` is
store-account-scoped, so Family Sharing / shared devices can put two
people on one lineage — persisting `inAppOwnershipType` (9A gap B10)
lands in the same fact-shape pass to keep lineage anchoring precise.
Dashboard consequence: the customer list distinguishes "identified"
from "purchase-anchored, not yet identified".

## 6. State model and canonical derivation

Axes exactly as the contract §3 of the protocol report: `accessState`
(active/inactive/unknown/unavailable), `lifecycleState` (trialing/
active/grace_period/billing_retry/paused/expired/revoked/refunded/
superseded/unknown), `renewalIntent`, `billingState`, `uncertainty`
(object with reason ∈ none/provider_unavailable/missing_fact/
identity_unresolved/product_unresolved/conflicting_facts/
projection_failed/stale_validation/unsupported_provider_state).

Derivation order (deterministic at snapshot `as_of`; half-open
intervals `[start, end)` per backend §3.4-8): effective revocation →
effective invalidating refund (per OD-18) → supersession → verified
current period → verified grace (`access active` per provider docs +
grant policy) → billing retry (`access inactive` by default) → pause
(Google only; `inactive`; scheduled pause keeps access until
effective) → period ended → `unknown`. Cancellation flips renewal
intent only. Schema-level `if/then` invariants encode
revoked⇒inactive, grace⇒grace-end-present,
unknown/unavailable⇒uncertainty≠none.

Provider-specific transition tables (Apple and Google separately, per
fact kind, with the driving timestamp for each transition) are
finalized in Stage 2 WP6/WP8 against the backend report's Part 3
normalization decisions; the prompt's transition-table rows are all
representable with the 9A `fact_kind` vocabulary once B1/B2 are fixed.

## 7. Access policies (versioned, policy version 1) **[OD-5, OD-17, OD-18]**

- Trial, active period: access active.
- Verified grace: active through provider grace end (`grants_in_grace`
  default true; per-grant opt-out allowed).
- Billing retry / account hold: inactive (default false; enabling
  requires explicit owner approval — contradicts provider docs).
- Pause (Google): inactive while effective; fixed, no override.
- Cancellation: renewal intent only; access until validated period end.
- Refund/revocation: effective at validated provider time; Apple
  `REFUND_REVERSED` reinstates; prorated per OD-18.
- Unknown evidence: `unknown`, never `inactive`; billing disabled or
  service failure: `unavailable`.
- Test transactions: per OD-17.

## 8. Ordering, effective time, supersession

Canonical tuple, ordering version 1, one component
(`internal/billingprojection/ordering.go`):
`(effective_at, fact_kind_precedence, provider_transaction_id,
occurred_at, recorded_at, fact_id)` — effective time per fact kind and
provider as documented in backend §2.5; `received/recorded` only as
late tie-breakers. Google's constant `occurred_at` is compensated by
recovering event time via join to `billing_raw_inputs.
provider_occurred_at` where the fact kind needs it; whether that
becomes an additive fact column (validator-version increment) is a
Stage 2 WP1/WP5 decision recorded before migration 00031 lands.
Supersession is explicit (`superseded_by_lineage_id`, lifecycle
`superseded`); nothing is deleted. Out-of-order facts invalidate the
checkpoint and reproject the lineage from zero.

## 9. Consistency, transaction boundary, idempotency

One atomic transaction per projection command (advisory lock →
re-read version → project → write snapshots, timeline, sources,
customer snapshot, both current pointers, checkpoint, webhook events,
audit → commit). External calls never inside. Idempotency key =
digest of `(scope, high-watermark position, rule version, grant
version set)`. No-change replay: checksum-equal ⇒ no snapshot, no
webhook, checkpoint advances, attempt recorded. Read-your-writes and
eventual-consistency disclosures per the contract's
`projectionStatus`; every surface exposes `as_of` and snapshot
version.

## 10. Contracts (Stage 2 protocol work packages)

Per the protocol Stage 1A report, adopted: three new contracts —
`authoritative-entitlement/v1`, `customer-access-token/v1` (claims doc
only; SDK treats tokens as opaque), `billing-state-webhook/v1` (scope
per OD-1) — all born `draft` [OD-15], house envelope shape, closed
over-provisioned enums, `additionalProperties: false`, with the one
normative reader rule: **any rejection yields `accessState: unknown` +
preserved cache, never `inactive`**. Fixture inventory as specified
(including the semantic-layer `older-snapshot-version-rejected`,
`different-customer-rejected`, and the behavioural
`cancelled-access-still-active`). Shared reference vectors in
`packages/test-fixtures`: snapshot digest vectors, cache-decision
vectors, freshness vectors, webhook signature vectors. Negotiation
lives in the sync request body; Configuration Delivery capability
request is untouched.

## 11. Server APIs, tokens, SDK sync

- Trusted (`secret_server` key): customer create-or-get, alias
  attach/revoke/list, token issuance, snapshot fetch, multi-key check
  (state + explanation + version, never bare boolean), subscription
  list/snapshot/timeline, conflicts, restore/sync jobs, replay,
  `GET customer/{id}` direct.
- SDK: `GET /v1/sdk/billing/entitlements` — customer token bearer,
  ETag/`If-None-Match`/304, Access Decision Snapshot response, rate
  limited. Public SDK key alone can never select a customer.
- Tokens per OD-14: opaque digests, ≤1h default, Environment- and
  customer-bound, revocable, issuance audited, second consumer of
  `secret_server` auth.

## 12. Replay and rule versioning

Replay: one instance / one customer / bounded project window;
selectable rule version; ignores checkpoints; checksum comparison;
`changes_only` materialization default; prior snapshots preserved;
audited. Apple replay is input-sourced; Google replay is fact-sourced
(live re-query is not deterministic) — stated as a documented
provider asymmetry. Rule versions: monotonic, recorded on every
snapshot, one active, promotion audited; shadow diff engine deferred
per OD-11.

## 13. SDKs (Stage 3)

Shared design per the three Stage 1B reports, reconciled:
- Token provider abstraction per platform idiom (`fun interface` +
  suspend / protocol / typedef); memory-only tokens; single-flight
  forced refresh; exactly one retry per 401 generation; cooldown on
  provider failure; `null`/signed-out ⇒ `unavailable`.
- Cache: per-customer namespace digest in the **path**; atomic
  four-step write; strict closed-key decode; integrity digest
  (documented as corruption detection, not security); backup-excluded
  from day one (iOS `isExcludedFromBackup` + file protection; Android
  `noBackupFilesDir`; Flutter `getApplicationCacheDirectory()` with
  memory-only degradation, never the support dir).
- Acceptance gate: contract version, customer binding (mismatch ⇒
  clear cache + high-severity diagnostic), monotonic version, `as_of`
  regression, checksum, required fields. Rejected snapshots never
  emit. 304 preserves cache and slides freshness.
- Observation: Flutter broadcast stream + `ChangeNotifier`; iOS
  `AsyncStream` fan-out with current-value replay; Android
  `StateFlow`. Explicit `Cleared`/`SignedOut`/`Loading` states so
  identity transitions are observable without emitting stale grants.
- Identity change/logout: generation bump → cancel in-flight → clear
  before any read → installation identity preserved (Phase 6).
- Restore: multi-stage sealed results; success (`…Updated`) only when
  an accepted snapshot reflects the restore; provider result carried
  separately; iOS adds the `currentEntitlements` observation emission
  (finding §1.7); Android composes over `queryPurchases` recovery;
  purchase-completion refresh is unawaited and never blocks purchase.
- No boolean convenience API anywhere.
- Cross-platform conformance driven by the shared fixtures and
  reference vectors (§10); Go/Dart/Swift/Kotlin must agree on the
  cache-decision and freshness vector tables.

## 14. Dashboard (Stage 2)

Per the Stage 1B dashboard report, adopted: `features/billing-customers`,
`features/entitlement-grants`, `features/billing-projection`
(+ `features/billing-webhooks` iff OD-1 ships UI — default per OD-1(b)
is API-only, so no webhook UI in 9B). New
`entitlement-vocabulary.ts` with four distinct access labels (unknown
and unavailable in "attention" tone with explanations, never
negative); five separate state pills; typed-identifier customer
search; conflict resolution as a multi-step confirmed form; grant
versions read-only once published with impact preview before publish;
`BILLING_BOUNDARY_NOTE` revised; `LedgerPaging` extracted for reuse.

## 15. Security, privacy, observability, performance

- Aliases digest-only; correlators sealed/digested; tokens digested;
  webhook secrets sealed (new SubjectKind); nothing sensitive in
  logs/telemetry/timeline (ledger-guard reuse).
- Authorization: every operator surface permission-checked
  server-side; SDK read surface selects customers by token only.
- Privacy: guide amended per OD-2/OD-7 in the same change that lands
  migration 00029; Phase 6 deletion exemption rationale rewritten
  (aliases erasable, facts/snapshots exempt).
- Observability: OTel spans/metrics for association, ordering,
  projection, commit, replay, token issuance, SDK sync, webhook
  create/deliver, lock wait, stale projections; new job families in
  the existing queue gauges; alerts for backlog, failure rate, stale
  state, conflict spikes, exhausted deliveries, cross-tenant auth
  failures.
- Performance: no invented SLOs; measure fact→projection latency,
  sync endpoint latency/QPS (highest-QPS authenticated surface to
  date — in-process rate limiter's multi-instance limitation
  documented), replay throughput; record in the 9B review.
- Snapshot retention (decided now — no drill baseline exists to
  extrapolate from; Phase 8 drills 4–5 were NOT RUN and nothing is
  partitioned): current snapshots and pointers retained indefinitely;
  **historical** snapshots and timeline entries get an explicit
  operator-configurable retention window, safe because they are
  rebuildable from facts + rule versions (Principle 2); webhook
  delivery **attempts** get a much shorter window than webhook
  **events** (the stable-ID contract); per-table row-count metrics
  added to billing observability from day one so the first post-9B
  drill has a trend.

## 16. Migrations

00029 customers/aliases/evidence/conflicts · 00030 lineages/instances ·
00031 subscription projection (+ jobs/attempts/rule versions) ·
00032 grant versions + entitlement lifecycle · 00033 entitlement
snapshots/sources/pointers (two-step circular FK) · 00034 tokens ·
00035 webhooks [OD-1] · 00036 restore/replay (+ shadow iff OD-11(b)).
All `ON DELETE RESTRICT`, composite Project/Environment FKs,
append-only triggers, up→down→up verified against clean 9A schema and
representative data.

## 17. Testing

Minimum-sufficient policy applies; the risk inventories in the eight
Stage 1 reports are adopted as the test charters: projection
determinism (same facts ⇒ same checksum; duplicate/out-of-order;
checkpoint = full replay; no-change ⇒ no webhook), state transitions
(cancellation keeps access; grace/retry/pause per policy; refund
scope), aggregation (multi-source; permanent-source no-false-expiry;
grant selection determinism), identity (token cannot cross
project/environment/customer; conflict ⇒ no double grant; logout/
identity-change leak tests on all SDKs), concurrency (advisory-lock
serialization; atomic pointer commit; idempotent retry), SDK cache
(older/malformed/wrong-customer rejection; 304; offline expiry;
backup-exclusion regression guards), webhooks (signature vectors;
stable event ID on retry; failure never rolls back state; SSRF), and
the four 9A-defect regression tests named in the quality report
(extend existing files; no new suites/runners anywhere).

## 18. Phase 9C exclusions (unchanged)

No RevenueCat migration, historical import, dual-run, cutover, bulk
repair/reassociation, financial reporting, consumables/credits/
metering, manual grants, operator state override, Stripe/Paddle/Lemon
Squeezy, AI billing decisions. Quarantine keeps structurally no
mark-as-valid path.

## 19. Integrated demonstration

The 14 scripted demonstrations from the orchestration prompt, driven
by a reusable driver following the 9A `billingdemo` pattern
(build-tagged), with webhook demos scoped per OD-1 and shadow demo
replaced by replay-checksum comparison per OD-11. One-minute demo:
validated purchase → authoritative Pro entitlement → cancellation
keeps access → expiration removes subscription source → lifetime
source keeps access → three SDKs converge on one snapshot version →
signed webhook (if OD-1(b)) reports the change.

## 20. Stage plan

- **Stage 2** (after owner decisions): protocol (3 contracts +
  fixtures + vectors), backend (WP order: 9A corrections [OD-13] →
  migrations → identity → lineage → ordering → projection engines →
  transaction → jobs → grants → tokens → sync/server APIs → restore →
  webhooks [OD-1] → replay → diagnostics → OpenAPI → observability),
  dashboard (WP1–8, 11; 9–10 iff webhook UI ships).
- **Stage 3**: Flutter, iOS, Android per §13 + cross-platform
  conformance.
- **Stage 4**: integrated demonstrations.
- **Stage 5**: product/UX/protocol/quality reviews; fix pass ≤2
  rounds; `docs/reviews/phase-9b.md`; stop. No merge, no tag, no 9C.
