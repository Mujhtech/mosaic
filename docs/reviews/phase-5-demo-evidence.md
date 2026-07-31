# Phase 5 advanced Placement demonstration evidence

## Evidence record

- Recorded: 2026-07-26
- Operator: Codex Phase 5 orchestrator
- Branch: `phase/5-advanced-placement-targeting`
- Base commit: `d5a8198c` (`docs: accept phase 4 baseline`)
- Runtime: local Go API backed by PostgreSQL 17 and Goose migrations 00001–00011
- Project: `project_000002`
- Environment: `env_000004` (`development`)
- Placement: `placement_000001` / `export_pdf`
- Rule Set: `ruleset_000001`
- Immutable Rule Set Version: `ruleset_version_000001`
- Rule Set document hash: `0c9553b8f66cab34cacb846a6ba31856f4cc285e8f0426bfb2684e506c838a50`
- Configuration Release: `release_000005`, release number 5
- Configuration Delivery: v2
- Placement Decision Contract: v1
- Bucketing algorithm: `sha256_length_prefixed_v1`
- Published Delivery v2 content digest:
  `sha256:fbf6ea92d9649606d94f10c96e41c3efa6c1a7feec80251140d203f55e1f0254`
- Reproducible authored Rule Set:
  `docs/reviews/phase-5-demo-rule-set.json`

The recorded release above is the original end-to-end Stage 4 publication.
Stage 5 review subsequently tightened Delivery v2 by requiring authoritative
`environment.mode`, exact compatibility derivation, and final-byte validation.
Release 5 is retained as historical live-workflow evidence; it is not used as
the finalized contract fixture. The corrected acceptance evidence is recorded
below under **Post-review correction verification**.

The public SDK key and browser session used for this local run are deliberately
not recorded in repository documentation.

## Published resources

The demo created four active Paywalls from the canonical hostable Protocol 0.2
navigation fixture and published immutable versions:

| Purpose | Paywall | Version |
| --- | --- | --- |
| Basic default | `paywall_000001` | `version_000001` |
| iOS / targeted A | `paywall_000002` | `version_000002` |
| Android B | `paywall_000003` | `version_000003` |
| Product-unavailable fallback | `paywall_000004` | `version_000004` |

Publishing release 5 created a new immutable version of the default document as
`version_000005`. Delivery v2 contains one Placement Decision, five Paywall
Versions, one Product reference, and one Entitlement reference. The compatible
Delivery v1 projection resolves `export_pdf` to `version_000005`, preserving the
safe simple binding for older SDKs.

The development release reported two nonblocking readiness warnings for the
mock Product metadata/provider scope. These are expected in a local development
Environment and were not hidden or treated as production readiness.

## Authored decision workflow

The PostgreSQL-backed workflow completed:

1. Created `export_pdf` and assigned its default Paywall.
2. Created the allow-listed Boolean `student` attribute.
3. Created the stable Mosaic Product `product_000002` (`export_pro`).
4. Created the provider-observed Entitlement definition `pro`.
5. Added explicit-priority rules for active Pro, Product availability, explicit
   country, typed student status, semantic application version, iOS, Android,
   and a deterministic 20 percent rollout.
6. Added intentional `no_paywall` and named Product-unavailability fallback
   outcomes.
7. Validated and published immutable Rule Set Version 1.
8. Compiled and published Configuration Delivery v2 release 5.
9. Fetched release 5 through the real public-SDK endpoint using explicit
   capability negotiation.

No analytics or Experiment resources were created.

## Go simulator results

| Context | Winning Rule | Bucket | Final outcome |
| --- | --- | ---: | --- |
| iOS 3.0, inactive Pro, Product available | `rule_ios` | — | `version_000002` |
| Android 3.0, inactive Pro, Product available | `rule_android` | — | `version_000003` |
| Active Pro | `rule_active_pro` | — | `no_paywall` |
| Unknown Pro, Product unavailable | `rule_product_unavailable` | — | fallback → `version_000004` |
| Explicit country `DE` | `rule_country_de` | — | `version_000002` |
| Typed `student=true` | `rule_student` | — | `version_000002` |
| Application version `10.0.0` | `rule_minimum_app_version` | — | `version_000002` |
| Identified context, installation `rollout_3` | `rule_rollout_20_percent` | 1324 | `version_000002` |

The Product-unavailability trace contained six bounded, diagnostics-safe steps:
inactive/unknown Pro condition, Product availability condition, winning Rule,
named fallback, and final Paywall outcome. It contained no raw identity or user
attribute value.

During the first integrated run, every simulator request returned 500 before
evaluation. The cause was transport validation against fields from a copied
context rather than fields owned by the request. The fix validates request-owned
fields and adds a focused regression test for a valid request, explicit-country
bounds, and the 8 KiB attribute payload bound.

## Cross-platform conformance

Go, Dart, Swift, and Kotlin consumed the same canonical repository fixtures
without platform copies. All four agreed on every evaluator case and rollout
vector, including:

- explicit priority and first-match semantics;
- platform and locale targeting;
- explicit country without locale inference;
- semantic application-version comparison;
- typed user attributes;
- active and unknown Entitlement states;
- Product available and unavailable states;
- intentional `no_paywall`;
- named fallback;
- exact default on no match;
- rollout bucket 863 for the shared iOS vector;
- Unicode length-prefix rollout vectors;
- atomic rejection of unsupported and malformed candidates.

Evidence commands passed:

- Go evaluator conformance and invalid-candidate tests.
- Flutter Phase 5 focused suite: 6 tests passed.
- Swift selected offline/LKG and evaluator suite: 2 tests passed.
- Android `PlacementDecisionTest`: build and all class tests passed.

The full platform suites had already passed during Stage 3: Flutter 148 tests
with one existing skip, Swift 104 tests with one opt-in relay skip, and Android
unit tests/lint/assemble across all SDK modules.

## Post-review correction verification

The first independent Stage 5 review rejected acceptance until the following
gaps were closed:

- final server-injected Rule Set bytes were revalidated with freshly derived,
  exact compatibility metadata;
- Delivery v1 was rebuilt from each advanced default Paywall rather than
  reusing a potentially mismatched basic binding;
- Delivery v2 carried authoritative Environment mode;
- every SDK enforced the same closed source/operator, QA override, exact
  compatibility, and unavailable-Paywall fallback semantics;
- bounded duplicate-condition and obvious-shadow warnings were added;
- Rule Set archive provided a real recovery path before Placement archive;
- new dashboard Rules became disabled and safe by default, with reliable
  warning-to-Rule navigation.

The corrected canonical corpus contains three valid Delivery v2 releases,
thirteen invalid/adversarial Delivery v2 releases, and nine invalid standalone
Placement Decision documents. Go, Dart, Swift, and Kotlin consume the same
repository files. Every invalid remote candidate is rejected atomically while
the last-known-good release remains available for offline decisions.

The final evaluator corpus contains eleven shared cases. It also proves that
runtime locale separators are normalized consistently for equality and
membership, and that malformed semantic-version source values remain unknown
through equality, inequality, ordering, and negation. QA override revocation is
scope-atomic across Project, Environment, and Placement; a guessed ID from a
different authorized tenant path returns not found and cannot create an audit.

Post-review verification passed:

- protocol validation and tests: 90/90;
- backend full tests and `go vet`;
- PostgreSQL Rule Set archive integration against a fresh database migrated
  from 00001 through 00011;
- dashboard formatting, lint, type checking, 452 component/unit tests, 7 relay
  tests, and production build;
- Flutter analysis and 149 tests with one opt-in relay skip;
- Swift 106 tests with one opt-in relay skip;
- Android unit tests, lint, SDK assembly, and example assembly.

Backend compiler tests prove that the corrected Delivery v1 projection selects
the exact advanced default Paywall, and that rollback preserves that exact
projection. Delivery v2 compiler tests prove that `environment.mode` and the
derived compatibility union are present. These tests protect the corrected
publication boundary without treating the historical release 5 bytes as a
current valid Delivery v2 fixture.

## Offline demonstration

After fetching and retaining Delivery v2 release 5, the local API process was
stopped. A health probe returned connection failure and HTTP code `000`, proving
the network endpoint was unavailable.

With the endpoint disconnected:

- Go evaluated the canonical decision corpus locally.
- Flutter passed atomic LKG retention, offline no-fetch `no_paywall`, evaluator,
  rollout, and identity-reset cases.
- Swift passed sequential unsupported/malformed refresh retention followed by
  an offline decision.
- Kotlin passed its full decision test class, including invalid-refresh LKG
  retention and offline decision.

No SDK test required a decision-server request per Placement call.

## One-minute demonstration

The original live workflow plus the corrected compiler, canonical fixture, and
offline SDK evidence prove the one-minute path:

```text
Call export_pdf
→ iOS selects Paywall A
→ Android selects Paywall B
→ active Pro returns no_paywall
→ unavailable Product follows the named fallback
→ stop the API
→ all SDK decision engines continue locally from accepted configuration
```

## Unavailable checks

- Interactive browser verification of the dashboard Rule Builder and simulator
  was unavailable because the in-app browser backend exposed no browser.
- Android instrumentation compilation remains blocked by the pre-existing
  Phase 4 test reference to removed `MOSAIC_PROTOCOL_VERSION_V02`; no emulator
  or device was attached. Unit, lint, assemble, example build, and JVM identity
  logic checks passed.
- The iOS example build stalled while resolving the existing RevenueCat SwiftPM
  dependency. The Flutter example Android build encountered a malformed local
  NDK installation, and its iOS build could not resolve the existing
  `PurchasesHybridCommon` CocoaPods version from local specs. Core SDK suites
  and the standalone Android example build passed; no machine-wide dependency
  repair was performed.
- No physical-device UI was required to prove Phase 5 decision semantics; the
  Phase 4 real-store demonstration follow-ups remain separately tracked.
