# Phase 3B Review — Hosted Publishing and Configuration Delivery

## Status

**Rejected pending fixes**

The final remediation candidate passes the repository's automated protocol, Go/PostgreSQL/MinIO,
dashboard, Flutter, iOS, Android, build, lint, and diff checks. The earlier authentication, Asset
storage, Draft-update replay, rollback snapshot, Origin enforcement, hosted Studio, and SDK
cache/ETag blockers are materially remediated.

Gate 3B is not accepted because configuration-delivery digests do not use one cross-platform RFC
8785 implementation; Draft creation and cloning do not replay a committed identical idempotent
request; the required authenticated Asset-backed full and one-minute demos were not executed; and
the Phase 2.5 and Gate 3A review dependencies remain unresolved.

Do not begin Phase 4, merge, or tag from this review.

## Baseline

- Base commit: `9882e7689b817a2441e9c2b1db6b6ddd8bfb2ef0`
- Branch: `phase/3b-hosted-publishing`
- Worktree: `/Users/muhideenmujeeb/Projects/mosaic`
- Phase 2.5 review: the required consolidated accepted review is absent.
- Gate 3A review: `docs/reviews/phase-3a.md` contains contradictory accepted/rejected conclusions
  and is not a reliable accepted prerequisite.
- PostgreSQL remediation: pgxpool runtime persistence, explicit Goose migrations, startup failure
  without PostgreSQL, and destructive-schema integration checks are implemented and green.
- Protocol authority: ADR-0016 retires Protocol 0.1 and makes Protocol 0.2 the sole current
  pre-release contract. Phase 3B follows that ADR; the orchestration prompt's dual-version
  prerequisite remains an owner-level contradiction.
- The owner explicitly authorized Phase 3B implementation despite the failed preflight. That
  authorization did not accept the inherited review gates.

## Completed Deliverables

### Hosted Paywalls, Drafts, and optimistic concurrency

- Hosted Paywall creation, local-document import, active-Draft discovery, immutable Draft
  revisions, validation, and edit-published-as-new-Draft are implemented.
- Draft updates require `If-Match`; stale writes cannot overwrite newer revisions.
- Update idempotency replays the original document, revision, validation state, timestamp, and ETag,
  even after a later writer advances the Draft.
- Hosted Studio conflict recovery preserves local work and describes whole-document replacement
  accurately.
- Create/clone Draft idempotency remains incomplete when a commit succeeds but its response is
  lost.

### Immutable Paywall Versions, publishing, Releases, and rollback

- Publication validates canonical Protocol 0.2 schema and semantic rules, stable Product IDs,
  ready hosted Assets, Placement bindings, and exact SDK compatibility.
- Publishing creates an immutable Paywall Version and complete immutable Configuration Release in
  one PostgreSQL transaction and advances one Environment current-release pointer atomically.
- Publish and rollback operations are idempotent and allocate monotonically increasing release
  numbers.
- Rollback clones the selected Release's stored immutable payload and reference snapshots rather
  than rebuilding from mutable current Products or Assets.
- Release history remains intact; editing published content creates a new Draft.

### Assets

- An S3-compatible `ObjectStore` port and MinIO adapter provide bounded, media-validated uploads.
- Metadata is stored in PostgreSQL and bytes in a private S3-compatible bucket.
- Immutable URLs contain Asset ID and digest and require HTTPS. Local Compose uses Caddy at
  `https://localhost:8443` for the Asset edge.
- Published Asset bytes remain retrievable after archive, and referenced Assets cannot be removed
  from release history.
- Upload reconciliation after storage succeeds but a later database transition fails remains an
  operational follow-up.

### Products and basic Placements

- Hosted Studio binds Catalog Products by stable Mosaic Product ID while mock price, availability,
  and purchase outcomes remain preview-only state.
- Missing, cross-Project, and archived Products block publication. Missing provider mappings remain
  explicit Phase 4 warnings rather than live-commerce claims.
- One stable Placement key binds to one Paywall per Environment. Publish readiness now requires a
  binding to the current Paywall. Advanced targeting was not introduced.

### SDK delivery, Flutter, iOS, and Android

- Delivery v1 is fetched with Environment-scoped public SDK keys and exact platform, SDK, delivery,
  Paywall Protocol, and `name@version` capability metadata.
- The endpoint serves only persisted immutable current Releases with strong ETags, conditional
  `304`, deterministic gzip, cache headers, and per-IP/per-key rate limiting.
- Flutter, SwiftUI, and Compose validate complete candidates, persist atomically, preserve the
  last-known-valid Release, use bundled fallback when needed, resolve Placements without fetching
  during presentation, and expose safe diagnostics.
- Flutter permits a hosted Environment to replace a synthetic bundled Environment but rejects a
  later cross-Environment candidate.
- iOS rejects cross-Environment and decreasing-release candidates.
- Android namespaces cache files by endpoint and public-key digest, requires strong ETags, and
  persists successfully before swapping in-memory state.
- Cross-platform release digest calculation is not yet proven RFC 8785-equivalent for exponent
  threshold numbers and remains blocking.

### Dashboard

- Local Studio remains account-free and can preserve local work before explicitly connecting to
  hosted mode.
- The Environment-scoped Monetization workspace exposes Paywalls, Drafts, Assets, Placements,
  publish review/history, rollback, and edit-published workflows.
- Compound Paywall/Draft and Placement/binding failures are retryable without duplicating the parent
  resource.
- Browser signup/login/session/logout, safe internal `returnTo`, 12-character password validation,
  permission recovery, Asset return navigation, conflict recovery, and publish recovery are
  implemented.
- A generic hosted-query `401` path can still omit the current `returnTo`; this is tracked.

### Migrations, OpenAPI, security, and observability

- Migrations `00001` through `00005` cover the Phase 3A baseline, key revocation, hosted publishing,
  browser sessions, and hosted Assets.
- PostgreSQL remains the runtime system of record. No production in-memory fallback is wired.
- OpenAPI and the regenerated dashboard client describe browser auth, hosted publishing, Assets,
  Placements, Releases, rollback, and SDK delivery.
- Opaque browser sessions store only token digests; password hashes use bcrypt; cookies are
  HttpOnly, SameSite=Lax, and Secure outside development/test.
- Trusted-Origin checks cover every unsafe `/v1` browser mutation, including multipart uploads.
- Authentication and SDK delivery have bounded in-process rate limits. Missing-account login paths
  perform bcrypt padding and safe bodies avoid account detail disclosure.
- Spans, structured logs, and audit events cover publishing, rollback, delivery, storage, and Draft
  operations without raw credentials or protected document bodies.

## Product Review

- Hosted configuration delivery, immutable publication, rollback, cache, and basic Placements fit
  Phase 3.
- Local-first Studio remains additive and usable without authentication or a hosted backend.
- Commerce remains mock-only. No RevenueCat, StoreKit 2, Play Billing, receipt validation,
  authoritative customer Entitlement state, analytics, experiments, or targeting was introduced.
- Private-alpha readiness cannot be claimed until the required real three-app demo succeeds and the
  prerequisite owner reviews are reconciled.

Owner decisions still required:

1. Accept or supersede ADR-0016's Protocol 0.2-only authority relative to the stale dual-version
   orchestration prerequisite.
2. Produce and accept the consolidated Phase 2.5 review.
3. Reconcile Gate 3A's contradictory review status on the integrated baseline.
4. Approve private-alpha readiness only after the complete Asset-backed demonstration.

## UX Review

- Hosted Product selection uses user-facing names and stable IDs while keeping mock preview state
  separate.
- Conflict recovery preserves work and no longer implies field-level merging.
- Publish blockers navigate to Product, Asset, and Placement recovery; success leads to current
  Release/history actions.
- Rollback states that it creates a new Configuration Release, and edit-published creates a Draft.
- Local Studio offers an explicit hosted connection without making authentication mandatory.
- Raw phase/gate terminology was removed from user-facing hosted flows.
- Automated component and workflow tests pass, but browser automation and manual visual proof were
  unavailable in the final run.

## Engineering Review

### Blocking findings

1. The documented RFC 8785 canonical JSON digest is implemented independently in Go, JavaScript,
   Dart, Swift, and Kotlin. Android normalizes numbers to plain decimal form while Go and JavaScript
   may emit exponent notation. A legal number such as `1e-7` can therefore produce a different
   SHA-256 digest and cause Android to reject a valid published Release. Adopt one equivalent
   canonicalization algorithm and add a shared exponent-threshold Delivery fixture verified by the
   publisher and all three SDKs.
2. `CreateDraft` and version-to-Draft cloning accept `Idempotency-Key`, but a retry after a committed
   response is lost encounters the existing active Draft rather than replaying the original Draft
   and ETag. Persist/replay the original identical request and reject changed reuse, protected by a
   PostgreSQL or HTTP integration test.
3. The authenticated Asset-backed full and one-minute demos across Studio, Flutter, SwiftUI, and
   Compose were not performed.
4. The consolidated Phase 2.5 and unambiguous Gate 3A acceptances remain unresolved.

### Tracked follow-ups

- Android serializes refreshes but does not coalesce callers into one transport request.
- Composite database constraints do not enforce every same-Project relationship independently of
  service authorization and transaction checks.
- Signup returns `201` versus `409` for existing accounts even though its response body is generic.
- Generic hosted-query `401` recovery can omit the current route from `returnTo`.
- Asset storage/database partial-failure reconciliation needs an operational cleanup path.
- Android emulator reachability and local Caddy trust need demonstrated instructions.

## Validation Evidence

Passed:

- Protocol: `npm run check`, 44/44 tests.
- Backend: `go test ./...` and `go vet ./...`.
- PostgreSQL lifecycle: migrations down to 0 and up through 5; Draft replay, two-Environment/two-key
  isolation, Asset upload/archive/content, immutable publish, rollback fidelity, delivery, ETag,
  gzip, and capability negotiation.
- Compose: PostgreSQL and MinIO healthy; API running; local Caddy TLS edge running.
- Dashboard: formatting, ESLint, TypeScript, 379/379 Vitest tests, 7/7 loopback relay tests, and
  client/SSR production build.
- Flutter: analyze, focused hosted-delivery tests, and full suite with 134 passes and one intentional
  opt-in relay skip.
- iOS: strict Swift formatting, SwiftPM build, focused hosted-delivery tests, and complete XCTest
  execution with 90 tests, one intentional relay skip, and zero failures.
- Android: full SDK unit tests, lint, and example debug assembly.
- Repository: `git diff --check`.

Unavailable or incomplete:

- Xcode intermittently hangs while saving the result bundle after XCTest reports all suites passed;
  this is recorded as a tooling finalizer failure, not a test failure.
- In-app browser automation and screenshots were unavailable; the dashboard server started and
  route/build checks passed.
- The required authenticated Asset-backed full and one-minute demos were not executed.

## Protocol Review

- Paywall Protocol 0.2 schema and semantics were not changed for hosted delivery.
- Paywall Protocol 0.1 remains retired by ADR-0016; the prompt's request to retain it is unresolved
  governance debt rather than restored runtime support.
- Configuration Delivery Contract v1 is separately versioned and rejects malformed, incomplete,
  unsupported, dangling, or partially valid Releases atomically.
- No SDK partially accepts a Release.
- Cross-platform RFC 8785 numeric canonicalization remains a blocking compatibility defect.

## Security Review

- Public SDK keys are digest-stored, Environment-scoped, and cannot authorize dashboard resources.
- Browser sessions, public keys, and server credentials remain separate principals.
- Service-layer authorization and Project/Environment isolation are enforced on hosted resources.
- Unsafe browser mutations require a trusted Origin; SDK delivery remains bearer-key based.
- Asset bucket keys and credentials are excluded from public URLs and Delivery payloads.
- Drafts, unpublished Versions, audit actors, provider credentials, API keys, and authoritative
  Entitlement state are excluded from SDK responses.
- Logs avoid authorization headers, password material, raw SDK keys, and protected document bodies.

## Demo Review

- Full demo: **not executed**.
- One-minute demo: **not executed**.
- Private-alpha readiness: **not yet credible as a reviewed end-to-end workflow**.

Automated tests establish substantial subsystem confidence but do not replace the required Studio
and three-native-app demonstration of update, `304`, outage cache, rollback, and edit-as-new-Draft.

## Decision

**Gate 3B rejected pending fixes. Phase 3 is not complete.**

The two permitted fix-and-review rounds are exhausted. Resolve the two implementation blockers,
execute the required demonstrations, and reconcile the prerequisite owner reviews in a future
explicitly authorized cycle. Do not begin Phase 4, merge, or tag from this report.
