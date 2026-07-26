# Phase 5 Review: Advanced Placement Decisions and Targeting

## Status

**Accepted with tracked follow-ups**

Phase 5 satisfies the approved product, protocol, persistence, dashboard, SDK,
offline-evaluation, and cross-platform conformance requirements. Two bounded
review/fix cycles closed all identified correctness, lifecycle, compatibility,
and tenant-isolation blockers. The remaining follow-ups are environmental
verification gaps and do not weaken the accepted contract.

## Baseline

- Base commit: `d5a8198d76d1fb889721a475557dc5eedee22588`
  (`docs: accept phase 4 baseline`).
- Branch: `phase/5-advanced-placement-targeting`.
- Worktree: `/Users/muhideenmujeeb/Projects/mosaic`.
- Accepted prior review: `docs/reviews/phase-4.md`.
- Placement Decision Contract: version `1`.
- Configuration Delivery: version `2`, with a safe exact Delivery v1
  projection when every advanced default is representable.
- Bucketing algorithm: `sha256_length_prefixed_v1`.
- Default assignment policy: stable anonymous installation identity.
- Optional assignment policy: identified user identity.
- User reset removes user identity while retaining installation identity;
  installation reset explicitly rotates installation identity.

## Completed Deliverables

### Placement Rule Sets

- Environment-scoped Rule Sets, optimistic Draft revisions, immutable published
  Versions, cloning, validation, publication, simulation, and archival.
- Explicit priorities and deterministic first-match evaluation.
- Bounded `all`, `any`, and `not` condition trees.
- Bounded nonblocking warnings for duplicate leaves and exact-condition
  shadowing without introducing a general implication solver.

### Rule Builder

- Overview, Rules, Simulator, and Test Overrides workflows in Mosaic Studio.
- New Rules are disabled and unavailable by default; authoring cannot silently
  introduce a broad enabled `no_paywall` Rule.
- Operators are filtered by source and attribute allow-list.
- Validation and simulator findings switch to Rules, scroll, and focus the
  relevant Rule.
- Warning-only validation remains publishable and visibly distinct from errors.

### Conditions, outcomes, and fallback

- Platform, OS version, application version, locale, explicit country,
  Environment, identity presence, typed user attribute, Product availability,
  Product readiness, Entitlement state, provider capability, and rollout
  conditions.
- Explicit Paywall, `no_paywall`, named fallback, and unavailable outcomes.
- Closed source/operator semantics, strong three-state evaluation, safe unknown
  handling, bounded fallback traversal, missing-target rejection, and cycle
  detection including Paywall-unavailable fallback edges.

### User attributes and identity

- Project allow-listed typed attribute definitions with operator, count, and
  payload limits.
- Standard simulator attributes are ephemeral; sensitive simulator input is
  deferred, excluded, and redacted.
- Stable installation identity, optional user identity, documented reset
  semantics, and explicit assignment-key policy.
- No advertising identifier is used.

### Product and Entitlement conditions

- Product readiness and runtime availability remain distinct.
- Unavailable Products use the authored fallback; Mosaic never substitutes a
  different Product automatically.
- Active, inactive, unknown, provider unavailable, and failed Entitlement
  states remain distinct. Unknown is never converted to inactive.
- Provider capability state can drive an explicit safe fallback.

### Percentage rollout

- Deterministic basis-point rollout uses exact UTF-8 byte length prefixes and
  SHA-256.
- Shared vectors include Unicode and threshold boundaries.
- Go, Dart, Swift, and Kotlin produce the same buckets.

### QA overrides

- Owner/admin-only, nonproduction, maximum 24-hour overrides.
- Selector material is represented by a digest and never published as raw
  identity input.
- Override outcomes and references are validated before persistence.
- Revocation is atomically scoped to Project, Environment, Placement, override
  ID, and active status; cross-tenant guessed IDs return not found and create
  no audit event.

### Simulator and decision traces

- Server-side simulator uses the same evaluator contract as SDKs.
- Bounded, diagnostics-safe traces explain condition results, winning Rule,
  rollout bucket, fallback traversal, and final outcome.
- Simulator request fields, country bounds, and the 8 KiB attribute limit are
  transport-validated without logging raw inputs.

### Configuration Release compilation

- Delivery v2 includes authoritative Environment mode and exact compatibility
  metadata derived from embedded final semantics.
- Server-injected attributes and active QA overrides are canonicalized,
  compatibility-derived, and revalidated before immutable Version persistence.
- Delivery v1 projection is rebuilt from each advanced default Paywall and is
  withheld when the default cannot be represented safely.
- Rollback preserves the stored exact Delivery v1 representation.

### Flutter

- Strict Delivery v2 and Placement Decision v1 decoding, offline evaluator,
  identity persistence, LKG retention, safe fallback, and separate advanced
  result API while preserving stable Delivery v1 behavior.

### iOS

- Strict Swift decoding and offline evaluation with authoritative Environment
  mode, exact compatibility, LKG retention, stable identity, and bounded
  fallback traversal while preserving Delivery v1 behavior.

### Android

- Strict Kotlin decoding and offline evaluation with the same contract,
  compatibility, identity, LKG, and fallback behavior.
- Locale normalization and malformed semantic-version behavior match the Go,
  Dart, and Swift reference semantics.

### Migrations, OpenAPI, documentation, and tests

- Goose migrations `00009` through `00011` add Placement decisions, Delivery
  v2 persistence, and QA overrides using PostgreSQL constraints and indexes.
- PostgreSQL repositories are the runtime implementation; no production
  in-memory fallback was introduced.
- REST endpoints and generated dashboard client cover attributes, Rule Sets,
  validation, publishing, simulation, overrides, archive recovery, and usage.
- ADR-0020, protocol, backend, dashboard, SDK, plan, and demo evidence are
  documented.
- Canonical schemas, compatibility manifests, valid/invalid fixtures, rollout
  vectors, and eleven shared evaluator cases are consumed across platforms.

## Product Review

- Phase fit: accepted. The work implements Phase 5 targeting and stops before
  analytics and Experiments.
- API compatibility: stable Placement keys and basic Placement presentation
  remain compatible. Aliases and explicit archive/migration paths protect host
  applications.
- Offline decisions: accepted. SDKs evaluate retained or bundled configuration
  locally and do not require a request for each Placement call.
- Privacy: accepted. Releases contain definitions and digests, not customer
  attribute values or raw override selectors.
- Public Alpha readiness: credible for the documented native Placement scope.
- Analytics: deferred to Phase 6; no ingestion or analytics resource was added.
- Experiments: deferred; deterministic rollout is not modeled as an Experiment
  or statistical test.
- Owner decisions: Delivery v2 plus Decision v1, exact safe v1 projection,
  installation assignment by default, explicit reset semantics, nonproduction
  owner/admin QA overrides capped at 24 hours, typed attributes, strong
  three-state logic, exact SHA-256 length-prefix bucketing, static/runtime
  Product separation, and five Entitlement states are accepted.

## UX Review

- Rule Builder: accepted after safe disabled Rule creation and source-aware
  operators.
- Priority and condition groups: explicit and bounded.
- Terminology: primary workflow copy favors Placement changes and publishing
  language; unavoidable version/release terms remain documented.
- `no_paywall`: intentional, explicit, and visually distinguishable.
- Fallback: named and explainable, with Product-unavailable authoring support.
- Simulator and trace: readable without raw JSON; recovery actions reach and
  focus the relevant Rule.
- Dead ends: Rule Set archive preserves immutable history and unlocks Placement
  archive. Usage and copy reflect active Rule Sets.
- Task completion: the critical create, validate, publish, simulate, inspect,
  override, and archive paths are complete. A larger combined publish-flow
  redesign was correctly left outside the acceptance fix.

## Engineering Review

- Migrations and PostgreSQL persistence: accepted; fresh-database migration and
  archive/revocation integration tests pass through migration 00011.
- Rule Set immutability: published Versions are never edited in place.
- Concurrency: Draft mutation uses optimistic revision/ETag semantics.
- Validation: structural errors block; bounded analysis warnings do not.
- Publication: final server-mutated bytes are revalidated and compatibility is
  recomputed before storage.
- Deterministic bucketing: accepted across all reference implementations.
- Identity and attributes: bounded, explicit, and safe under missing/unknown
  inputs.
- Offline evaluation and compatibility: accepted with atomic candidate
  rejection and LKG preservation.
- Tenant isolation: QA override revocation is scope-checked in the service and
  atomically constrained in SQL.

Verification passed:

- Protocol validation and tests: 90/90.
- Go full tests and `go vet`.
- Fresh PostgreSQL archive and tenant-isolation integration tests.
- Dashboard format, lint, typecheck, 452 component/unit tests, 7 relay tests,
  and production build.
- Flutter analysis and 149 tests with one opt-in relay skip; final Phase 5
  conformance suite 7/7.
- Swift 106 tests with one opt-in relay skip.
- Android unit tests, lint, SDK assembly, focused shared conformance, SemVer
  regression, and example assembly.
- `git diff --check`.

Unavailable checks and known defects:

- Interactive browser verification was unavailable because the in-app browser
  exposed no browser backend.
- Android instrumentation has no attached emulator/device and retains the
  pre-existing Phase 4 `MOSAIC_PROTOCOL_VERSION_V02` test compile defect.
- The iOS example build stalled resolving the existing RevenueCat dependency.
- Flutter example builds were blocked by a malformed local Android NDK and
  unavailable local CocoaPods metadata for the existing RevenueCat bridge.
- These are tracked environmental or pre-existing verification gaps. Core SDK,
  contract, persistence, and Android example checks pass.

## Protocol Review

- Placement Decision Contract v1 and Configuration Delivery v2 are explicitly
  versioned and closed.
- Paywall Protocol 0.2 semantics and artifacts remain unchanged; retired 0.1
  was not revived or modified.
- Go, Dart, Swift, and Kotlin consume the same canonical fixtures and agree on
  decisions, locale normalization, semantic-version unknown behavior, and
  rollout buckets.
- Unknown Entitlement, Product, provider, attribute, and malformed runtime
  states remain unknown or fail safely.
- Unsupported or over/under-declared semantics reject the entire candidate and
  preserve LKG.
- Older SDK behavior is explicit: exact default-Paywall Delivery v1 projection
  is served only when representable; otherwise the v1 candidate is withheld.

## Privacy Review

- Attributes are typed and allow-listed.
- Attribute values are not embedded in Configuration Releases.
- Simulator inputs are not retained by default.
- Sensitive values and raw selectors are absent from logs and public traces.
- QA overrides use short expiration, safe labels, selector digests, nonproduction
  authorization, and scope-atomic revocation.
- Advertising IDs are not used for assignment or targeting.

## Demo Review

- Complete demonstration: succeeds, with the original PostgreSQL-backed
  author/publish/simulate run and corrected post-review compiler/fixture
  verification recorded in `docs/reviews/phase-5-demo-evidence.md`.
- One-minute demonstration: succeeds for iOS Paywall A, Android Paywall B,
  active-Pro `no_paywall`, unavailable-Product fallback, and offline decisions.
- Offline evaluation: succeeds across Go, Flutter, Swift, and Kotlin.
- Cross-platform conformance: succeeds for eleven evaluator cases, rollout
  vectors, valid releases, invalid candidates, and LKG recovery.
- Public Alpha readiness: credible within the documented Phase 5 scope and
  tracked environmental limitations.

## Tracked Follow-ups

1. Capture interactive browser evidence for Rule authoring, simulator recovery,
   warning presentation, and Rule Set archive recovery.
2. Repair or replace the pre-existing Android instrumentation Protocol constant,
   attach an emulator/device, and run instrumentation.
3. Restore local RevenueCat SwiftPM/CocoaPods dependency resolution and the
   malformed Flutter-example Android NDK, then rerun the unavailable example
   builds.
4. Retain the Phase 4 real-store sandbox/test-track follow-ups without treating
   them as Phase 5 decision-engine blockers.

## Decision

**Phase 5 accepted with tracked follow-ups; proceed to Public Alpha and Phase
6.**

This review authorizes the next phase but does not begin Phase 6, merge the
branch, create a tag, push, or publish a release.
