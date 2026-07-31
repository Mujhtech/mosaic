# Phase 4B Review: Native Store Providers

## Status

**Accepted with tracked follow-ups**

The integrated implementation is accepted by the final engineering quality
review and the complete available automated matrix passes. On 2026-07-26, the
product owner explicitly accepted Gate 4B and authorized Phase 5 to begin with
the unavailable real Apple sandbox and Google Play test-track demonstrations
retained as tracked environmental follow-ups. The missing signed applications,
store-console Products, sandbox/license-test accounts, and physical/test-store
devices still leave real purchase, cancellation, pending, relaunch recovery,
restore/synchronize, acknowledgement, and cross-provider proof unverified. A
skip remains documented as unavailable rather than passing.

## Baseline

- Base commit: `51269f5d452c09ee0d351aabd336438632b47624`.
- Branch: `phase/4b-native-store-providers`.
- Working directory: `/Users/muhideenmujeeb/Projects/mosaic`; no separate
  worktree was used.
- Current committed integration point: `b5c22dc2d5cb2a3e8e82057348c20371d6082869`,
  with the final review fixes still present in the working tree for owner review.
- Gate 4A: `docs/reviews/phase-4a.md` records **Accepted with tracked
  follow-ups**.
- Apple targets: StoreKit 2, iOS 15 minimum, Xcode 26.5 (17F42); the package
  also compiles on macOS 14 for deterministic tests.
- Google targets: Play Billing `9.1.0`, compile SDK 36, minimum API 24.
- Flutter: optional `mosaic_native_store` package with CocoaPods/SwiftPM and
  Gradle sibling-package bridges; native store code remains in the Swift and
  Kotlin adapters.
- Official API references used during planning and review: Apple StoreKit
  `Product`, `Transaction`, unfinished/current Entitlements and
  `AppStore.sync`; Google Play Billing integration, `ProductDetails`, purchase
  processing, pending purchases, acknowledgement, and active purchase query
  guidance.
- `git diff --check` passes. `git status --short` is intentionally non-empty
  because the integrated Gate changes and final review fixes have not been
  committed by this review.

## Completed deliverables

### Commerce v2 and v1 compatibility

- Frozen Commerce Provider and Commerce Configuration v2 schemas, compatibility
  manifests, fixtures, browser declarations, safe diagnostics, explicit local
  update dispositions, structured recovery outcomes, and exact content-digest
  configuration revisions.
- Complete 19-capability native profiles and strict semantic validation.
- Commerce v1 remains supported and independently validated.

### Native adapters and Flutter integration

- Optional StoreKit adapter with verified transactions, durable host acceptance
  before finish, pending/cancelled/failure separation, unfinished replay,
  synchronization, current-Entitlement recovery, and safe diagnostics.
- Optional Google Play adapter with exact Product/base-plan/offer selection,
  runtime-only offer tokens, durable acceptance before acknowledgement,
  pending purchase handling, SUBS/INAPP recovery, and atomic configuration
  generations.
- Provider-neutral Flutter API and thin Swift/Kotlin bridges reuse those native
  adapters. Explicit host acceptance and structured recovery cross the channel.
- RevenueCat and custom provider dependencies remain optional and isolated.

### Mappings, activation, readiness, and Studio

- Environment/Application-scoped native mappings, immutable replacement
  lineage, active-provider selection, bounded immutable observations, readiness
  and publishing diagnostics, PostgreSQL migration/repositories, and REST APIs.
- Google base plan is required for subscriptions; offer selection is explicit
  and never falls back. One Google Product ID may map to one current Mosaic
  Product per Environment/Application because client-only recovery cannot
  authoritatively distinguish base plans without deferred server receipt
  infrastructure.
- Studio supports native mapping/replacement, platform coverage, readiness and
  recovery actions, provider selection, permission-aware states, and the same
  mock-commerce flow used by the provider-neutral Paywall editor.
- Documentation and iOS, Android, and Flutter examples cover configuration,
  safe failure, recovery differences, and distribution boundaries.

## Product review

- Stable Mosaic Product and Entitlement identities remain independent of store
  identifiers. The canonical Paywall SHA-256 remains
  `f892cf7ee650f135a4a9c4f3d3d5a5863909a01bce702f9a5d2cfec6b0a59fcf`.
- Native stores report observed access; Mosaic does not become an authoritative
  cross-platform Entitlement service.
- Receipt validation, customer subscription state, server transaction history,
  financial reporting, and Phase 5/9 expansion remain deferred.
- Design-Partner Alpha is code-complete for deterministic integration but not
  real-store approved until both demonstrations are supplied.

## UX review

- StoreKit and Google mapping workflows expose exact platform-specific fields,
  including explicit `No offer`, base-plan requirements, and the Google
  recovery-driven Product-ID uniqueness rule.
- Readiness actions navigate to relevant Application, mapping, provider, and
  publishing surfaces; permission failures and unavailable observations are
  distinct from configuration failures.
- Replacement is explicit and preserves immutable lineage. Test observations
  are never presented as live production verification.
- Restore language distinguishes StoreKit synchronization from Google active
  purchase recovery. Remaining dead end is external: real store setup is not
  available in this workspace.

## Engineering review

- Finalization ordering is fail-closed: verified native success must be durably
  accepted locally before StoreKit finish or Google acknowledgement.
- Pending, cancellation, stale configuration, duplicate delivery, partial
  recovery, configuration replacement, and provider failure retain explicit
  outcomes without granting authoritative empty or successful access.
- Mapping scope, platform, release association, digest, capabilities, grants,
  and native selector integrity are validated across protocol, backend, and
  SDKs.
- Final quality review found no remaining code or documentation blocker after
  the Google recovery identity rule was made explicit across the plan,
  protocol, backend documentation, and Studio.

Available checks passed:

- Protocol: 78/78 tests and all fixture/schema validation.
- Backend: `go test ./...` and `go vet ./...`.
- Dashboard: format, lint, typecheck, 439 Vitest tests, 7 relay tests, and
  client/server production builds.
- Android: `test lint assemble` across core, RevenueCat, and Google modules.
- iOS core: 98 tests passed, 1 existing documented skip; StoreKit: 4/4 tests.
- Flutter core: analysis plus 142 tests passed with 1 documented skip;
  `mosaic_native_store`: analysis plus 3/3 tests.
- Repository: `git diff --check`; generated SwiftPM `.build` artifacts were
  removed and ignored.

## Security review

- No Apple or Google server credentials, receipts, purchase tokens, or raw
  transaction/customer payloads are persisted or emitted in diagnostics.
- PostgreSQL remains mandatory for non-test API execution; the in-memory cloud
  workspace repository remains test-only and is not wired into `cmd/api`.
- Composite scope constraints and service authorization preserve Project,
  Environment, and Application isolation; observations use bounded typed safe
  metadata.
- Mosaic adds no server transaction validation and no authoritative customer
  Entitlement database in Gate 4B.
- No Radix or Lucide application imports, provider identifiers in Paywall
  fixtures, production in-memory fallback, or direct handler `render.JSON`
  usage were found. No Paywall Protocol schema/fixture changed.

## Demo review

- Apple real-store demo: **Unavailable** — no signed sandbox-capable app,
  App Store Connect Products, Sandbox Apple Account, or signed test device.
- Google real-store demo: **Unavailable** — no package-matching Play Console
  application/test-track artifact, Products, license tester, or Play test device.
- Cross-provider unchanged-Paywall demo: **Unavailable at the real-store
  boundary**; source/digest equality and deterministic adapter evidence pass.
- One-minute StoreKit-to-Google demo: **Unavailable** for the same external
  dependencies.

The retained deterministic and unavailable evidence is recorded in
`docs/reviews/phase-4b-demo-evidence.md`. The product owner accepted Gate 4B on
2026-07-26 with those demonstrations tracked for later capture against the same
commit and configuration digests.
