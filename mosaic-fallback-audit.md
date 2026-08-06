# Mosaic Fallback Audit — full-codebase scan (2026-08-02)

> **Remediation status (2026-08-06, corrected):** all six layers remediated in the working tree.
> Protocol/packages 9 fixed + 1 documented-not-dead; iOS all items (example-app xcodebuild unverified);
> Android all items (Compose instrumentation lane not run); Flutter all assigned items except preview
> negotiation (needs protocol design); Dashboard all 12 items; Backend all items + 3 new migrations
> (00062–00064).
>
> **Correction:** an earlier version of this header claimed Flutter was remediated for every item.
> It was not: T4 (`renderer_actions.dart:106-108`, silent product substitution) was never in the
> Flutter task list and remained live until a self-audit on 2026-08-06 caught the over-claim. Treat
> per-layer "all items" claims as covering only what each remediation task actually enumerated.
>
> **Self-audit of the remediation itself (2026-08-06):** an adversarial review of the branch's own
> diff found the defect class had been reintroduced in new code — Android fabricated `"en"` into
> Placement targeting and the analytics wire, the protocol reference repeated the `?? {}`
> vacuous-check it had originally flagged, every conformance corpus passed over zero cases, the
> dashboard rendered a failed Environments read as perpetual loading, and the scalar and series
> metric paths disagreed on zero-denominator rates. Fixing this class once is not sufficient;
> new code needs the same audit. Suites green: protocol 209, Android 239 + lint + R8, Flutter 392+5+7+1,
> iOS 234+10+4, dashboard 663 + typecheck, Go build/vet/test + integration on fresh Postgres.
> Open protocol-contract decisions (need owner): `product_selected.source` closed enum can't express
> substitution; `placementFallbackPayload.trigger` lacks an honest `unknown`; authoritative-entitlement
> `sourceSummary.start` required with no null form (backend still substitutes `asOf`); local-preview
> negotiation-completion sequence undefined; Android capability-vocabulary translation + proposed
> `accessibility.inProgress` reserved localization key.
> Residual engineering follow-ups: customer-create/attach-alias needs one transaction; unknown Apple
> notification types still fall through to transactionReason; operator query allow-lists still drop
> unrecognized values silently; audit-write failures log at error level but have no metric.

Scope: `protocol/` + `packages/`, `sdk/ios`, `sdk/android`, `sdk/flutter`, `apps/dashboard`, `apps/api` (+ worker, migrations, `scripts/`). Six parallel exhaustive scans; this document consolidates the cross-cutting themes and the ranked findings per layer. Severity: 🔴 fix-worthy (silent failure, wrong commercial/entitlement data, compliance), 🟡 review, ✅ good pattern worth preserving.

---

## Cross-cutting themes (the same bug shipped N times)

### T1 — Unresolved color/token → invisible UI, on every renderer 🔴
- iOS: `PaywallRendererAppearance.swift:459,461,468`, `PaywallRendererControls.swift:630-635,676` — malformed literal or unresolved token → `Color.clear`, no diagnostic. One bad gradient stop erases the whole background (`ProtocolModels.swift:669-675`).
- Android: `MosaicPaywallPresentation.kt:460-473` — unparseable color → `Color.Transparent`, silently.
- Flutter: `renderer_appearance.dart:378` — unknown semantic color token → `Colors.transparent`.
- Contrast: the media-background paths on all three platforms DO emit diagnostics. Adopt that pattern uniformly.

### T2 — Unknown billing enums default to wrong commercial terms 🔴
- iOS: `StoreKitClient.swift:246` and `MosaicRevenueCatProvider.swift:582` — `@unknown default` period unit → `.day`. `MosaicRevenueCatProvider.swift:556-561` — unknown offer type silently strips the trial.
- Flutter: `native_store_provider.dart:579` — unknown period unit → **year**; `:566` — unknown payment mode → payUpFront.
- Backend: `billing/service_worker.go:1147-1168, 448-455` — unknown Google subscription state / Apple transactionReason → `KindInitialPurchase`, i.e. **grants access**.

### T3 — Fail-open entitlement/grant defaults 🔴
- `billingprojection/grant.go:91-102` — empty `SupportedPurchaseTypes` matches everything; `migrations/00033:31-39` — `grants_in_* DEFAULT true`. Under-specified grant row over-grants.
- `billingaccess/model.go:106-110` — unknown token status → `TokenActive`.
- Flutter: `native_store_provider.dart:293-300` — entitlements synthesized from local commerce config when the native payload omits them.
- Dashboard: `publish-grant-version-wizard.tsx:384-396` — blast-radius counts default to 0 in the publish confirmation.
- (The protocol contract itself is exemplary here: `neverInactive` everywhere; the implementations drift.)

### T4 — Silent product substitution / selection 🔴
- iOS: `PaywallState.swift:179` — unavailable authored default silently selects the first available plan.
- Flutter: `renderer_actions.dart:106-108` — same silent re-point.
- Dashboard: `placements-page.tsx:74` — unbound placement pre-selects the first paywall in the bind form.

### T5 — Discarded errors on audit/persistence writes (Go `_ =`, Dart `catchError((_){})`, TS `catch {}`) 🔴
- Backend: audit writes suppressed across `billingcustomer/service.go` (×7), `billingaccess/sync.go:296`, `billing/service_credentials.go` (×4), `billingpostgres/queries.go:464`; `json.Marshal` errors discarded into DB writes (`placementdecisionpostgres/repository.go:302-351`, `experimentpostgres`, migration metadata); legal-hold read failure defaults `hold=false` (`billingmigrationpostgres/completion.go:353`).
- Dashboard: `migration-queries.ts:108` `.catch(() => undefined)` on billing-migration completion.
- Android/Flutter: corrupt persisted queues silently reset to empty (`AnalyticsQueue.kt:52`, `TransactionObservationQueue.kt:55`, `ExperimentPersistence.kt:189`; Flutter analytics `:770` clears the whole queue).

### T6 — Missing-data rendered as healthy/zero 🔴
- Dashboard billing surfaces: `?? 0` on health counters drives *positive* tone styling (`projection-health-page.tsx:162-264`); reconciliation narratives state "Examined 0 records" for absent fields; `format-analytics-metric.ts:8` renders available-but-null as 0.0%.
- Backend: projection-status reads guarded by `err == nil` (`billingaccess/authority.go:186`, `sync.go:260,293`, `billingoperator/service.go:221,249`) — degraded projection reported as healthy.
- `experimentpostgres/repository.go:1270,1288` — `COALESCE(sum,0)`: absent data looks like zero data.

### T7 — Identity/versioning silently re-minted or zeroed 🟡→🔴
- Flutter `placement_identity.dart:186-196` and Android `PlacementDecision.kt:225` — unreadable identity file mints a new installation id (re-buckets experiments, no diagnostic).
- Android `HostedConfiguration.kt:857` — literal `"installation_unavailable"` identity; `Mosaic.kt:70-73` — app version falls back to `"0"` and feeds targeting + authority minimum-support.
- Dashboard `editor-shell.tsx:138` / `hosted-publish-panel.tsx:40` — missing session → `expectedRevision = 0`; `migration-program-detail-page.tsx:753,801` — `expectedStateVersion ?? 0` on destructive cutover/rollback commands.

### T8 — Classification by exception-message string matching 🟡
- Flutter `preview_client_runtime.dart:366-395`, Android `LocalPreviewEngine.kt:524-541` — `message.contains("Unsupported …")` decides diagnostic codes. A reworded exception silently reclassifies.

### T9 — RTL silently becomes LTR 🔴
- iOS `Localization.swift:42`, Flutter `localization.dart:64-65` — unknown/missing locale catalog → LTR direction.

---

## Per-layer top findings

### Protocol + packages
1. 🔴 `migrate-v0.2-rc2-to-rc3.mjs:211-221` **and** its twin `browser/index.js:1338` — unmatched `initiallySelectedProductReferenceId` emits `initialProductCardId: undefined`, dropped by `JSON.stringify` → schema-invalid document with `diagnostics: []`. Fix in both copies.
2. 🔴 `authoritative-entitlement-validation-v1.mjs:574` — `readerPolicy ?? {}` lets the "no policy may resolve to inactive" invariant pass vacuously if the key is absent/renamed.
3. 🔴 `billing-state-webhook/v1.json:80-82` (+v2) — the only `ignore` policy for unknown fields/types/enums in the protocol; mitigation (`reReadSnapshot`) is a policy string no validator enforces.
4. 🟡 `placement-decision-validation-v1.mjs:336` — missing `context.now` → Unix epoch → all QA overrides silently inactive; `:330` unguarded `fallbackByKey.get(...).outcome` crashes on unvalidated docs.
5. 🟡 `browser/index.js:882` — unparsable countdown `endsAt` → `completed:false` with `NaN`, inconsistent with the throwing invalid-clock branch.
6. 🟡 `contract-types.d.ts:713` — `nativeApproximation` fallback mode exists only in generated types; likely dead/under-specified.
7. 🟡 `design-tokens/theme.css` — `.dark` never overrides `--destructive`; design-system `STATUS_BEHAVIOR[tone]` lookup unguarded.
✅ Zero JSON-Schema `default`s; `partialAcceptance: forbidden` everywhere; fail-to-`unknown` posture; `rejection-layers.json` pins which layer rejects each invalid fixture.

### iOS SDK
1. 🔴 T1 token→clear cluster; plus `swiftUI(in: nil)` + `mosaicDocument=nil` environment default means legacy product cards can't resolve tokens at all (`PaywallRendererControls.swift:30-91`).
2. 🔴 `PaywallRendererControls.swift:524` — malformed countdown `endsAt` renders as "offer expired".
3. 🔴 `PaywallRendererControls.swift:464` — unguarded macOS carousel subscript (crash).
4. 🔴 `MosaicStoreKitAcceptanceStore.swift:30` — acceptance records fall back to `temporaryDirectory` (OS may purge purchase-acceptance state).
5. 🔴 `MosaicStoreKitProvider.swift:278-287` — all purchase errors flattened to one generic non-retryable code (RevenueCat adapter at 210-221 classifies properly — adapters inconsistent).
6. 🔴 `PlacementPaywall.swift:184-190` — missing analytics metadata renders the paywall fully untracked; `:92-106` hardcoded English "Paywall unavailable" ships to production.
7. 🟡 `?? .always` visibility across ~10 decode sites; `ProtocolModels.swift:145` — dangling `initialScreenId` silently renders screen[0]; `Configuration.swift:424-427` — provider capabilities hardcoded `.available`.
✅ `PaywallLoader` chain, `preserveOrUnavailable`, fail-closed `EntitlementSyncClient`, `StoreKitClient:130` throwing `@unknown default`, LocalPreview "Bundled fallback" badge.

### Android SDK
1. 🔴 Crash-instead-of-degrade cluster: `MosaicPaywallComponents.kt:187` (asset `first{}`), `:309/:754` (`getValue` on selector state), `PaywallState.kt:80/:263`, `HostedConfiguration.kt:895/:1057` — non-conforming documents throw inside composition.
2. 🔴 `MosaicPaywall.kt:711-713/:732-734` + `PaywallState.kt:725-727` — ProductCard/ProductBadge outside a selector: invisible, un-styled, always-visible, no diagnostic.
3. 🔴 `Mosaic.kt:70-73` — `"0"` app-version fallback (targeting + authority checks); `HostedConfiguration.kt:857` — `"installation_unavailable"` synthetic identity.
4. 🔴 `MosaicPaywallPresentation.kt:694` — hardcoded English "In progress" a11y string.
5. 🟡 `MosaicDiagnosticSink.None` default silently discards every diagnostic unless the host wires a sink; corrupt queue resets (T5); inconsistent `clipContent` null semantics and three different default corner radii (0.0/9.0/10.0); provider capabilities assumed AVAILABLE (`HostedConfiguration.kt:918-923`).
✅ Three-valued decision logic, strict enum rejection in codecs, retain-or-unavailable delivery chain, `LAYOUT_UNBOUNDED_FILL` once-per-node diagnostics.

### Flutter SDK
1. 🔴 T1/T2/T3 clusters above (`renderer_appearance.dart:378`, `native_store_provider.dart:566/579/293-300`).
2. 🔴 `renderer_layout.dart:109-112/:245` — ProductCard/Badge/ScrollContainer render as `SizedBox.shrink()`; undecorated unknown nodes drop authored appearance/visibility; `protocol_validation*.dart` — unknown node subtrees escape validation entirely.
3. 🔴 `configuration_client.dart:393,416` — missing `serverTime` substituted with release `publishedAt` as *trusted* time; `commerce_configuration_v2.dart:599-601` — missing freshness timestamps make stale data look fresh.
4. 🔴 `customer_entitlement_cache.dart:325-326` — `'authority-unknown'` sentinel in the cache namespace (scope collision); `configuration.dart:268-294,357-370,513` — auto-wired transports silently resolve to null (analytics/commerce/observation disabled); absent config skips attribute allow-list validation.
5. 🔴 `transaction_observation.dart:947` — `providerId ?? ''` submitted on the wire; `placement.dart:1067` — unattributable fallback reason emitted as `'unsafe_rendering'`.
6. 🟡 `renderer_appearance.dart:359-374` — null theme text style drops all authored typography; `preview_client.dart:201` — negotiation resets to local default each connect.
✅ Strict enum throws in decoders, three-valued logic, diagnosed bundled-fallback chain, `resolveColor` throwing on unknown token (`protocol.dart:520`).

### Dashboard
1. 🔴 `migration-queries.ts:108` — `.catch(() => undefined)` discards every error class on billing-migration completion.
2. 🔴 `publish-grant-version-wizard.tsx:384-396` — impact counts default to 0 in publish confirmation.
3. 🔴 `projection-health-page.tsx:162-264` — missing counters render 0 and drive "positive" tone.
4. 🔴 `migration-program-detail-page.tsx:753,801` — `expectedStateVersion ?? 0` on cutover/rollback commands.
5. 🔴 `config/environment.ts:79-87` — production misconfig silently falls back to `http://localhost:8080`.
6. 🔴 404→null adapters render errors as empty states: `generated-placement-decisions-adapter.ts:491-500` (synthesizes an empty rule set), `provider-connection-queries.ts:216-221` (drops paywalls from impact analysis), `generated-hosted-publishing-adapter.ts:288,364`.
7. 🟡 `_hosted.tsx:29-41` — non-401 session failures swallowed; `client.ts:179-193` — malformed error body swallowed; `format-analytics-metric.ts:8`; `placements-page.tsx:74`; autosave-recovery writes fail silently (`hosted-draft-recovery.ts:74-83`).
✅ `HostedResourceState` machine with exhaustive-`never`; `billingEnabled: boolean|null` tri-state; degraded-vs-error transport split; `DEFAULT_ENVIRONMENT_ALIAS="dev"`; connectivity/staleness banners.

### Backend (Go)
1. 🔴 `billing/service_worker.go:1147-1168, 448-455` — unknown provider states → `KindInitialPurchase` (grants access).
2. 🔴 `billingprojection/grant.go:91-102` + `migrations/00033` — empty purchase-type list + `grants_in_* DEFAULT true` over-grant.
3. 🔴 `billingmigrationpostgres/completion.go:353` — discarded legal-hold read → retention deletion proceeds.
4. 🔴 `ratelimit/limiter.go:37-51` — nil limiter fails open; eviction under pressure resets budgets.
5. 🔴 `billingaccess/wire.go:191-198` — unknown provider reported to clients as `google_play`; `:317-321` — unknown source start reported as "now" (fabricated).
6. 🔴 `billingpostgres/queries.go:812-816` — replay inputs silently dropped while cursor advances.
7. 🔴 Audit-write suppression across billing surfaces (T5); `billingcustomer/service.go:136-141` — transient alias-read error creates a duplicate customer (entitlement split).
8. 🔴 `googleplay/client.go:465-473` — `_ = json.Unmarshal`: truncated Play response returns success with zero-valued record.
9. 🔴 `scripts/upgrade.sh:118` — failed stop ignored, migrations run against live old binary; `backup-objects.sh:95-96` — empty backup recorded as successful; `restore-postgres.sh:127` — failed existence probe reads "does not exist".
10. 🟡 `transport/billing/handler.go:524,909,920-925,1135-1140` — invalid from/to/limit silently ignored, widening operator queries; `billing/retry.go:92-127` — unknown provider status → permanent failure/quarantine; `config.go:507-528` — malformed keyring skips overlap check; `cmd/migrate/main.go:192-198` — unparseable timeout silently defaulted; `placementdecision` transport/repo marshal errors (T5).
✅ Fail-closed `billingEnabled`/`requireEnabled`; three-valued placement evaluator; honest-unknown projection states; trusted-proxy defaults; SSRF policy defaults; `neverInactive` respected in sync paths.

---

## Suggested remediation order

1. **Entitlement/commercial correctness** (T2, T3, backend #1–3, Flutter native store): unknown-enum arms should reject/quarantine, never grant or misstate terms.
2. **The two protocol-layer landmines**: migrator `initialProductCardId` drop (both copies) and `readerPolicy ?? {}` vacuous invariant.
3. **Silent-invisible UI** (T1): route all token/color failures through the existing media-background diagnostic pattern per platform.
4. **Discarded writes** (T5): audits, legal hold, marshal-into-DB. Mechanical `errcheck`-style sweep for `_ =` on the billing surface.
5. **Dashboard "missing = healthy"** (T6): tri-state the counters (the `billingEnabled: boolean|null` pattern already in the codebase is the template).
6. **Crash-instead-of-degrade** (Android cluster, iOS carousel): replace `first`/`getValue`/subscript with guarded lookups + diagnostics.
7. **Ops scripts**: upgrade.sh stop check, backup manifest verification, restore existence probe.
