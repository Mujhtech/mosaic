# Placement Decision Contract v1

Placement Decision `1` is Mosaic's closed, platform-neutral local-decision contract. It extends a stable Placement key with deterministic Rules without changing the host application's Placement presentation API. The canonical schema is `protocol/schema/placement-decision/v1/decision.schema.json`.

The contract is declarative JSON. It contains no JavaScript, SQL, expressions, callbacks, remote functions, provider identifiers, customer profiles, or executable code. A candidate is accepted only after schema, semantic, compatibility, reference, and size validation succeeds completely.

## Rule Set evaluation

A document contains one immutable published Rule Set version for one Project, Environment, and Placement. Rules have unique priorities from 0 through 9,999. Readers sort enabled Rules by ascending numeric priority; array order is not meaningful. The first Rule whose condition is `true` and whose optional rollout matches wins. A `false` or `unknown` Rule is skipped. If none wins, the exact `defaultOutcome` is selected.

Conditions are closed nodes:

- `all` and `any` contain 2–16 children;
- `not` contains exactly one child;
- `condition` contains one approved source, operator, and typed operand, except `exists` and `does_not_exist`, which carry no operand.

Maximums are 5 condition levels, 64 leaves per Rule, 100 Rules, and 256 KiB of serialized UTF-8 JSON per document. These limits are semantic publication and reader-acceptance requirements.

Every leaf returns `true`, `false`, or `unknown`:

- `all` is false if any child is false, otherwise unknown if any is unknown;
- `any` is true if any child is true, otherwise unknown if any is unknown;
- `not` flips true/false and preserves unknown;
- `exists` on a missing value is false and `does_not_exist` is true;
- another comparison against missing, malformed, or type-incompatible runtime input is unknown.

Unknown is never coerced to false data. In particular, unknown, provider-unavailable, and failed Entitlement observations never become `inactive`.

## Inputs and operators

| Source | Runtime source | Values and operators |
| --- | --- | --- |
| `device.platform` | SDK runtime | `ios`/`android`; equality and membership |
| `device.os_version` | SDK runtime when valid | `mosaic_semver_v1`; equality, ordering, existence |
| `application.version` | host application metadata | `mosaic_semver_v1`; equality, ordering, existence |
| `application.locale` | host/OS locale | bounded BCP 47; equality, membership, existence, `locale_matches` |
| `context.country` | host application only | uppercase ISO 3166-1 alpha-2; equality, membership, existence |
| `environment.id` / `.key` | accepted release | equality and membership |
| `identity.user_present` | local identity state | Boolean equality |
| `user_attribute` | host-supplied local attributes | operators allowed by its published definition |
| `entitlement_state` | provider observation | `active`, `inactive`, `unknown`, `provider_unavailable`, `failed` |
| `product_availability` | provider observation | `available`, `unavailable`, `unknown`, `provider_unavailable`, `failed` |
| `product_readiness` | immutable release reference | `ready` or `not_ready` |
| `provider_capability` | active provider adapter | `available`, `unavailable`, or `unknown` |

Country is never inferred from locale, device region, language, timezone, currency, or IP. Its diagnostic provenance is `host_application`.

All `application.locale` comparisons normalize both the runtime source and authored operand: underscores become hyphens, language is lowercase, script is title case, and region is uppercase. Equality and membership therefore treat runtime `en_US` as authored `en-US`. `locale_matches` applies RFC 4647 basic filtering to the same normalized values. A range matches the same normalized tag or a tag beginning with the range followed by `-`.

`mosaic_semver_v1` accepts one to three numeric core components, pads omitted components with zero, rejects non-zero leading zeroes, and supports SemVer prerelease and build syntax. Build metadata is ignored for precedence. Numeric identifiers sort numerically, numeric prerelease identifiers sort before non-numeric identifiers, and a release sorts after its prereleases. Invalid or missing versions are unknown; lexical comparison is forbidden.

Typed values are closed: string, Boolean, finite number, RFC 3339 UTC timestamp with exactly millisecond precision, semantic version, or a unique bounded string list. Nested values are forbidden. A Rule's attribute operand type and operator must match its allow-listed attribute definition. SDK-local identity state permits at most 32 attributes, an 8 KiB serialized payload, 256 UTF-8 bytes per string, and 16 list values of at most 128 UTF-8 bytes each. Number `-0` is normalized to `0`.

## Identity and rollout

Assignment policies are `installation` (default), `identified_user`, and `identified_user_or_installation`. The assignment-key type is part of bucketing input and must not change silently. Missing user identity under `identified_user` makes a rollout gate unknown, so that Rule cannot win.

User identity reset clears the user ID, attributes, user-bound override material, and decision cache while retaining the random, app-install-scoped, non-advertising installation ID. Installation reset is a separate explicit operation. Anonymous-to-identified alias metadata remains local and has no Phase 5 assignment effect.

`sha256_length_prefixed_v1` creates these exact UTF-8 bytes:

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

Hash with SHA-256, interpret the first eight digest bytes as an unsigned big-endian integer, and take modulo 10,000. A gate matches when `bucket < thresholdBasisPoints`; 0 never matches and 10,000 always matches. String lengths are UTF-8 byte lengths, not character counts. Canonical cross-language vectors live in `protocol/fixtures/placement-decision/v1/rollout-vectors.json`.

## Outcomes and fallbacks

Outcomes are closed:

- `paywall` pins an exact immutable Paywall Version ID and may name an unavailable fallback;
- `no_paywall` is a successful terminal decision, never an error and never a fallback trigger;
- `fallback` enters one named Rule Set-owned fallback;
- `unavailable` terminates with a stable safe reason.

Fallback references must exist, be acyclic, and resolve in at most eight steps. Fallback is explicit for incompatibility, missing exact Product mapping, Product/provider unavailability, unknown required commerce state, or unsafe rendering. Readers never substitute a similar Paywall or Product.

Validation traverses both direct `fallback` outcomes and every `paywall.unavailableFallbackKey`. The unavailable-Paywall path must reference an existing named fallback, remain acyclic across any later Paywall-unavailable edges, and reach a terminal outcome within eight named fallback steps.

Static targeting selects a candidate first. Only that candidate performs compatibility, exact Product mapping, readiness, provider capability, and runtime availability checks. Provider observations occur at most once per decision and are reused for rendering.

## QA overrides and diagnostics

Published QA override metadata contains a safe ID/label, SHA-256 digest of a server-created high-entropy opaque selector, start/expiry, and outcome. It contains no raw token or identity. Overrides are valid only in development or staging, precede normal Rules, and expire no later than 24 hours after start. Revocation requires a later immutable release.

Traces are bounded to 256 steps and ephemeral. They may expose Rule IDs, safe labels, input provenance, three-state results, assignment-key type, bucket, fallback path, and final outcome. They must never include attribute values, sensitive values, raw user/installation IDs, assignment values, provider payloads, selector material, or override tokens.

## Conformance and rejection

`requiredFeatures` is a closed enum and, together with `bucketingAlgorithms`, exactly describes semantics used by the Rule Set. This derivation includes all condition groups, sources, operators, outcomes, and `override.qa` whenever `qaOverrides` is non-empty. Both under-declaration and over-declaration reject the complete candidate. An unknown operator, source, outcome, required feature, or algorithm also rejects it. Readers preserve last-known-valid configuration, then use a bundled fallback, then return configuration unavailable.

Authoring validation may additionally return at most 64 non-blocking warnings. Contract v1 defines two deliberately narrow warnings: an exactly duplicated leaf within one Rule, and a later enabled Rule with the exact same condition tree as an earlier enabled Rule that has no rollout gate. Warnings never invalidate an otherwise valid published document and do not attempt general logical implication analysis.

The shared evaluator corpus at `protocol/fixtures/placement-decision/v1/evaluator-conformance.json` protects priority, platform/locale/country separation, canonical locale equality and membership, semantic versions (including unknown malformed runtime versions across equality, inequality, and ordering), typed attributes, active and unknown Entitlements, Product unavailability, explicit fallback, rollout, `no_paywall`, and exact default selection. Invalid fixtures additionally protect closed source/operator compatibility, unavailable-Paywall traversal, exact feature under/over-declaration, override duration, unsupported operators, malformed condition kinds, duplicate priorities, and fallback cycles.
