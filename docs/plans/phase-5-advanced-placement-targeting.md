# Phase 5 Plan: Advanced Placement Decisions and Targeting

## Status

**Accepted implementation contract — 2026-07-26**

This plan reconciles the read-only Product, UX, Protocol, Backend, Dashboard,
Flutter, iOS, and Android inspections. It freezes the owner-sensitive defaults
needed to begin implementation. Phase 6 analytics and Phase 7 Experiments are
excluded.

## Baseline

- Base commit: `d5a8198`.
- Branch: `phase/5-advanced-placement-targeting`.
- Phase 4: accepted with tracked live-provider demonstration follow-ups.
- PostgreSQL is the runtime system of record; Goose migrations through version
  8 applied in the Phase 5 preflight.
- Configuration Delivery v1 and Paywall Protocol 0.2 remain immutable.
- Existing Placement keys and SDK presentation/resolution APIs remain valid.

## Product promise

Applications continue calling one stable Placement key. Mosaic selects a
published native Paywall, returns a deliberate `no_paywall`, follows an explicit
fallback, or returns unavailable without requiring a server request for every
presentation.

## Frozen decisions

1. Define Placement Decision Contract v1 and Configuration Delivery Contract
   v2. Do not mutate Delivery v1 or Paywall Protocol 0.2.
2. Serve a safe Delivery v1 projection to legacy SDKs only when the advanced
   Placement has an explicit default Paywall. Never project `no_paywall` or an
   advanced rule as an unconditional Paywall.
3. Default assignment policy is `installation`. Rule Sets may explicitly choose
   `identified_user` or `identified_user_or_installation`.
4. User identity reset clears user ID, user attributes, user-bound overrides,
   and any decision cache but retains the installation ID. Installation reset
   is a separate explicit operation that rotates it.
5. Installation identity is app-install scoped, random, local, non-advertising,
   and excluded from backup where the platform supports it.
6. QA overrides are allowed only in development and staging, owner/admin only,
   token-matched, audited, visible, revocable, and expire within 24 hours.
   Production overrides are invalid in Phase 5.
7. Simulator inputs and decision traces are ephemeral. Attribute values, raw
   user/installation IDs, assignment keys, provider payloads, and override
   tokens are never stored or logged.
8. Product readiness is a published static fact and publication guard. Runtime
   Product availability and provider capability are evaluated locally before
   presentation. No Product substitution is permitted.
9. Entitlement conditions preserve `active`, `inactive`, `unknown`,
   `provider_unavailable`, and `failed`. Only an authoritative available result
   may derive `inactive`.
10. User-facing dashboard copy uses “Access” where it describes what a customer
    has; the versioned contract retains the domain term Entitlement.

## Placement model

A Placement is a stable Project-scoped application intent:

- immutable stable ID;
- stable key matching `^[a-z][a-z0-9_]{0,63}$`;
- internal name and optional description;
- active or archived lifecycle;
- usage and audit metadata.

Keys are not edited in place after use. A rename creates a new canonical key and
retains the old key as an active Project-scoped alias. Canonical keys and aliases
share one collision-checked namespace. Historical aliases remain inspectable.

The default decision is Environment-owned in the Placement Rule Set, not
duplicated on the Project Placement. Existing `environment_placement_bindings`
compile as the default Paywall decision until an advanced Rule Set is published.

## Rule Set and Rule model

Each Placement and Environment has at most one Rule Set with:

- stable Rule Set ID and contract version;
- one active optimistic-concurrency Draft;
- immutable Draft revisions;
- immutable published versions;
- enabled state, assignment policy, default outcome, named fallbacks, Rules,
  compatibility metadata, and diagnostics-safe metadata.

Each Rule has a stable ID, enabled state, unique numeric priority from 0–9999,
condition tree, optional rollout gate, outcome, and validation state. Lowest
priority number evaluates first; the first enabled true Rule whose rollout gate
matches wins. Array or database row order has no semantics.

Dashboard reordering rewrites explicit priorities in one revision-checked
Draft update. Published versions are protected by immutable database triggers.

## Condition tree

Closed groups:

- `all`: 2–16 children;
- `any`: 2–16 children;
- `not`: exactly one child;
- `condition`: one approved source/operator/typed operand.

Limits:

- maximum depth 5;
- maximum 64 leaves per Rule;
- maximum 100 Rules per Rule Set;
- maximum canonical Rule Set document size 256 KiB;
- maximum trace length 256 steps.

Approved sources:

- `device.platform`: `ios` or `android`;
- `device.os_version`;
- `application.version`;
- `application.locale`;
- `context.country`;
- `environment.id` and `environment.key`;
- `identity.user_present`;
- `user_attribute` with an allow-listed key;
- `entitlement_state` with a stable Mosaic Entitlement key;
- `product_availability` with a stable Mosaic Product ID;
- `product_readiness` with a stable Mosaic Product ID;
- `provider_capability` with a contract-approved capability.

Rollout is a Rule field, not a user-supplied condition source.

Approved operators:

- `equals`, `not_equals`, `in`, `not_in`;
- `greater_than`, `greater_than_or_equal`, `less_than`,
  `less_than_or_equal`;
- `exists`, `does_not_exist`;
- `contains_any`, `contains_all` for string lists;
- `locale_matches` using RFC 4647 basic filtering.

The schema and semantic validator constrain operators to compatible sources and
types. Unknown operators or malformed Rules reject the complete candidate
release; SDKs never skip or partially interpret them.

## Three-state semantics

Every leaf returns true, false, or unknown.

- `all`: false if any false; otherwise unknown if any unknown; otherwise true.
- `any`: true if any true; otherwise unknown if any unknown; otherwise false.
- `not`: flips true/false and preserves unknown.
- `exists(missing)` is false; `does_not_exist(missing)` is true.
- Other comparisons against missing or invalid input are unknown.
- A false or unknown Rule does not win; evaluation continues to the next Rule.
- No matching Rule selects the exact default outcome.

## Typed values and attributes

Closed values: string, boolean, finite number, UTC timestamp, semantic version,
and bounded unique string list. Nested objects are prohibited.

Project attribute definitions contain key, type, internal description, allowed
operators, sensitivity (`standard` or `sensitive`), lifecycle, revision, and
audit metadata. Values are SDK-local and never stored by the backend.

Limits:

- 32 attributes per identity;
- key length 1–64 using `^[a-z][a-z0-9_]*$`;
- string length 256 UTF-8 bytes;
- list length 16, each item at most 128 UTF-8 bytes;
- serialized attribute payload at most 8 KiB;
- timestamps RFC 3339 UTC with millisecond precision;
- numbers finite IEEE-754 values with `-0` normalized to `0`.

Attribute mutations validate atomically against the accepted release allow-list.
Sensitive values are redacted from all diagnostics.

## Locale, country, and version semantics

Locale uses a bounded BCP 47 form. Normalize language lowercase, script title
case, region uppercase, and compare with RFC 4647 basic filtering. Invalid or
missing locale is unknown.

Country is only an explicitly supplied ISO 3166-1 alpha-2 value, normalized
uppercase. It is never inferred from locale, language, timezone, currency, IP,
or device region. Traces show `host_application` as its source.

`mosaic_semver_v1` accepts one to three numeric core components, pads omitted
components to three, rejects leading zeroes other than zero, supports SemVer
prerelease/build syntax, and ignores build metadata for precedence. Missing or
invalid values are unknown; versions are never compared lexically. OS versions
use the same normalization where the platform can supply a valid value.

## Identity and assignment

SDK state contains a stable random installation ID, optional host-supplied user
ID, typed attributes, and a monotonic local generation. It contains no email,
phone, display name, provider customer metadata, or device identifier.

- `installation`: always uses installation ID.
- `identified_user`: missing user ID makes rollout input unknown.
- `identified_user_or_installation`: user ID when present, installation ID
  otherwise.

Identifying may change a rollout when the selected policy uses user identity.
The assignment-key type and bucket are visible in traces; the value is not.
Anonymous-to-identified alias metadata is local-only, has no assignment effect,
and is not transmitted in Phase 5.

## Deterministic rollout

Algorithm: `sha256_length_prefixed_v1`.

Fixed fields are Project ID, Environment ID, Placement ID, Rule ID,
assignment-key type, and assignment-key value. Canonical UTF-8 bytes are:

```text
mosaic-placement-rollout\n
1\n
<byte-length>:<project-id>\n
<byte-length>:<environment-id>\n
<byte-length>:<placement-id>\n
<byte-length>:<rule-id>\n
<byte-length>:<assignment-key-type>\n
<byte-length>:<assignment-key-value>\n
```

Compute SHA-256, interpret the first eight bytes as an unsigned big-endian
integer, and take modulo 10,000. A rollout matches when
`bucket < threshold_basis_points`; 0 never matches and 10,000 always matches.
Go, Dart, Swift, and Kotlin consume the same canonical fixtures.

## Outcomes and fallback

Closed outcomes:

- `paywall` with an exact immutable Paywall Version ID and optional
  unavailable-fallback key;
- `no_paywall`, a successful terminal decision;
- `fallback` with a named key;
- `unavailable` with a stable safe reason code.

Authors select a logical active Paywall; Rule Set publication pins its current
immutable published version. Named fallbacks are Rule Set-owned, acyclic, and
limited to depth 8. Explicit triggers include incompatible/missing Paywall,
missing exact Product mapping, Product unavailable/unknown, provider capability
unavailable, Entitlement unknown when required, and unsafe rendering.

No fallback may select a similar Paywall, approximate a provider identifier, or
substitute a Product. `no_paywall` terminates without entering fallback.

## Entitlement and Product inputs

Entitlement state is derived from provider observations:

- present in an authoritative available set: active;
- absent from that available set: inactive;
- aggregate unknown: unknown;
- provider unavailable: provider_unavailable;
- provider failure: failed.

Static targeting runs first. For the candidate only, the SDK checks Paywall
compatibility, exact Product mappings, published readiness, provider capability,
and runtime availability. Provider observations occur at most once per decision
and are reused by rendering. Offline provider failure follows explicit fallback;
it never becomes inactive or available.

## QA overrides

Development/staging overrides use a server-created high-entropy opaque token,
not a raw user identifier or a digest of low-entropy personal data. They precede
normal Rules, expire after at most 24 hours, and carry override ID, Environment,
Placement, outcome, safe label, and expiry in published configuration. Creator
identity and selector material remain server-side. Cached overrides work offline
only until expiry. Revocation requires the next immutable release and remains in
the audit history. Identity reset clears matching local override tokens.

## Configuration Delivery compatibility

Delivery v2 atomically contains Project/Environment identity, immutable Paywall
Versions, Placement Decision v1 Rule Sets, exact Product/Entitlement references,
and compatibility metadata. It may contain zero Paywalls when every outcome is
`no_paywall`.

Capability requests add supported decision-contract versions, exact features,
and bucketing algorithms. Unsupported required semantics reject the entire
candidate and preserve the last accepted release.

The backend stores immutable release representations by Delivery version. A v1
projection is generated only for safe default Paywall outcomes. Otherwise a v1
SDK receives no compatible candidate and retains cache/bundle fallback.

## SDK architecture and public compatibility

Each SDK adds a strict v2 decoder, pure evaluator, actor/coroutine/Future-safe
identity store, context builder, deterministic bucketer, commerce snapshot,
bounded trace, and typed decision result. Existing simple binding APIs continue
to work. Advanced evaluation is asynchronous; existing host views/composables
perform it internally without a per-presentation configuration request.

Results distinguish selected Paywall, fallback-selected metadata,
`no_paywall`, Placement unavailable, configuration unavailable, unsupported
contract, and evaluation failure. Rendering remains Flutter widgets, SwiftUI,
and Compose; Paywall renderers do not interpret targeting Rules.

## Dashboard workflow

Placement detail is the command center: Overview, Rules, Simulator, and Test
Overrides. Default decision stays visible; advanced Rules use progressive
disclosure. Rules are ordered accessible cards with drag and move controls,
recursive bounded conditions, typed editors, outcome/fallback/rollout editors,
and field-level validation. Raw JSON is diagnostics-only.

The simulator is a non-cached mutation form. It never places identity or
attribute inputs in URLs, query keys, browser storage, or recovery state. Its
semantic trace links each step to the affected Rule and shows input provenance,
unknown states, assignment type/bucket, fallback path, Product readiness, and
final decision.

Members may read and simulate synthetic standard attributes. Sensitive
attribute simulation and every mutation require owner/admin. Publish blockers
link to the exact Rule, Product, Access definition, mapping, provider, or
attribute definition and retain return context.

## Persistence and migrations

Use relational ownership/reference/version tables with bounded canonical JSONB
for condition trees and contract unions.

Planned migrations:

1. `00009_phase_5_placement_decisions.sql`: Rule Sets, Drafts, immutable Draft
   revisions and versions, Rule/reference projections, aliases, attribute
   definitions, constraints, indexes, and immutability triggers.
2. `00010_configuration_delivery_v2.sql`: immutable release representations,
   release-to-Rule-Set references, and v1 backfill.
3. `00011_phase_5_qa_overrides.sql`: non-production expiring overrides only.

Enforce one active Draft, unique version and priority, Project/Environment
composite foreign keys, archived-Placement restrictions, alias collisions,
immutable published versions, and expiration-aware overrides. Do not create
analytics, customer profile, attribute value, trace, or authoritative
Entitlement tables.

## REST, authorization, audit, and observability

REST resources cover Placement detail/lifecycle/aliases/usage, Rule Set Draft,
validation/publication/history/clone, attribute definitions, simulator, QA
overrides, and generalized Environment release publication. Whole-document Draft
updates require `If-Match` plus idempotency key and return an explicit conflict
without overwriting local work.

Members read and run standard synthetic simulations. Owners/admins mutate and
publish. Overrides require owner/admin and non-production Environment.

Audit mutations and publication using safe IDs, versions, issue codes, counts,
and expiry only. OpenTelemetry spans cover validation, Rule Set publication,
simulation, override create/revoke, alias use, and decision compilation. Logs
exclude request bodies, attributes, identity selectors, and override tokens.

## Publication and rollback

Rule Set publication creates an immutable Rule Set Version. Configuration
publication explicitly names mutable Draft revisions being compiled and pins
immutable Paywall and Rule Set versions in one transaction. No partial release
is visible. A targeting-only publish uses the same Environment release workflow.
Rollback copies the exact compiled decision snapshot and never recompiles from
mutable Rule Sets.

## Canonical fixtures and minimum sufficient tests

One shared corpus protects platform, locale, explicit country, semantic app
version, typed attributes, active/unknown Entitlement, Product available and
unavailable, priority, no match, `no_paywall`, fallback, rollout vectors,
identity transition/reset, unsupported operator, malformed Rule, duplicate
priority, fallback cycle, and old-SDK projection.

Backend tests protect Draft concurrency/idempotency, tenant/reference isolation,
immutability, validation, atomic publication/rollback, attribute limits,
override expiration, privacy-safe release bytes, and simulator non-persistence.
Dashboard tests protect priority persistence, field-level errors, intentional
`no_paywall`, trace navigation/redaction, visible unknown states, override
permissions, and publish recovery. SDK tests protect shared conformance,
identity persistence/reset, atomic rejection/LKG retention, offline evaluation,
provider-state distinctions, fallback, and public API compatibility.

No new test runner, snapshot framework, mock library, or browser harness is
introduced.

## Explicit exclusions

- event ingestion, exposure tracking, analytics dashboards, and conversion
  reporting;
- Experiments, Variants, statistical inference, and automatic winners;
- production QA overrides;
- authoritative Mosaic customer Entitlement state or customer profiles;
- receipt validation, billing reconciliation, and financial reporting;
- AI targeting, JavaScript, SQL, scripts, remote functions, or arbitrary code;
- automatic Product substitution;
- Paywall Protocol 0.3 components.

## Public Alpha demo

Create `export_pdf`, retain a default Paywall, add iOS, Android, minimum-version,
explicit-country, student-attribute, active-Pro, Product fallback, and 20%
rollout Rules; publish; compare Go, Flutter, Swift, and Kotlin; disconnect the
network; repeat from cache; produce deliberate `no_paywall`; trigger Product
fallback; and inspect the same complete trace. The one-minute path shows iOS
Paywall A, Android Paywall B, Pro `no_paywall`, Product fallback, and offline
local decisions through the unchanged Placement API.

## Stage order and ownership

- Stage 2 Protocol owns only decision/delivery schemas, documentation, fixtures,
  compatibility, and established generated artifacts.
- Stage 2 Backend owns `apps/api/**`, `apps/worker/**`, migrations, OpenAPI,
  backend tests, and backend documentation.
- Stage 2 Dashboard owns Placement/rule/attribute/simulator/override/publishing
  UI, feature tests, and dashboard documentation.
- Stage 3 Flutter, iOS, and Android agents own only their SDKs, examples, tests,
  and documentation and consume the frozen canonical fixtures.
- Stage 4 runs the integrated demo and cross-platform conformance.
- Stage 5 is read-only Product, UX, Protocol, and Quality review followed by at
  most two bounded fix rounds.

Stop after `docs/reviews/phase-5.md`. Do not merge, tag, or begin Phase 6.
