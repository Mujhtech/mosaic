# Configuration Delivery Contract v2

Configuration Delivery `2` atomically delivers immutable Paywall Protocol `0.3` documents and Placement Decision Contract `1` Rule Sets for one Project and Environment. It is additive: Delivery `1` and Paywall Protocol `0.3` remain unchanged.

The canonical schemas are under `protocol/schema/configuration-delivery/v2/`. A release contains Project/Environment identity, compatibility requirements, Placement decisions, exact Paywall Versions, provider-neutral Product readiness references, stable Entitlement references, and hosted Asset references. It may contain zero Paywalls only when no outcome references a Paywall.

Delivery v2 adds an authoritative immutable `release.environment.mode`. Its closed values are `development`, `staging`, and `production`, matching Mosaic's canonical Environment modes. `environment.key` remains the stable Environment key and is not used to infer security policy. Readers and validators use `mode`, never key naming conventions, to decide whether QA override material is permitted. Delivery v1's Environment shape is unchanged; a v1 projection omits v2's `mode` field.

## Atomic acceptance

Before replacing accepted state, a reader validates the complete envelope:

1. closed JSON Schema and exact contract versions;
2. release material digest;
3. every embedded Rule Set and its exact feature/algorithm requirements, including `override.qa` when an override is present;
4. Project and Environment ownership;
5. unique Placement key/ID and Rule Set ID;
6. exact Paywall, Product, Entitlement, and Asset references;
7. unchanged Paywall Protocol `0.3` document semantics and capability requirements;
8. `environment.mode` and the non-production and duration rules for QA overrides.

Unsupported or malformed semantics reject the whole candidate. Readers never skip a Rule, drop an unknown field, partially accept Paywalls, or retain a new envelope with an old decision subset. Rejection preserves the last accepted release; without one, readers try a bundled v2 release and then return configuration unavailable.

`release.contentDigest` uses the same canonical material rule as Delivery v1: SHA-256 over the canonical release object with `contentDigest` omitted. Published representations are immutable and rollback copies exact stored bytes rather than recompiling mutable Rule Sets.

## Compatibility request

SDK capability metadata adds:

- `supportedPlacementDecisionContracts`, containing exact supported versions;
- `supportedDecisionFeatures`, containing exact source/operator/outcome/group capabilities;
- `supportedBucketingAlgorithms`, containing exact algorithm identifiers.

Existing Paywall Protocol capability reporting remains exact. If any required version, feature, algorithm, or Paywall capability is unsupported, the backend withholds a candidate rather than publishing degraded semantics.

Decision feature identifiers are a closed enum. Release requirements are the exact set union derived from all embedded Rule Sets; both missing requirements and unused extra requirements invalidate the release. This prevents a reader from accepting undeclared semantics and prevents accidental over-declaration from needlessly excluding compatible SDKs.

## Exact references and commerce state

Every `paywall` outcome pins one included immutable Paywall Version. Every Product referenced by a Paywall or decision condition has one release Product reference with published readiness. Every `entitlement_state` source has one stable Entitlement key reference. Runtime mappings and provider observations remain in the Commerce contracts/adapters; Delivery v2 contains no credentials, provider customer data, receipt data, or authoritative Mosaic customer state.

Product readiness is a static publication fact. Runtime availability and provider capability remain local inputs. Neither a missing mapping nor an unavailable Product permits substitution.

## Delivery v1 projection

A legacy Delivery v1 candidate may be generated only when the advanced Placement has an explicit default `paywall` outcome. The projection contains that exact Paywall Version as the simple Placement binding. Rules are never projected as unconditional bindings, and `no_paywall`, `fallback`, or `unavailable` defaults are never converted to a Paywall.

If a safe v1 projection cannot be produced, the server returns no compatible candidate. The legacy SDK keeps its last accepted or bundled v1 release. This is not a Delivery v2 rejection and does not change v1 bytes or semantics.

## Privacy and diagnostics

Delivery v2 contains definitions and stable references, never host-supplied attribute values, raw identities, assignment values, provider payloads, or raw QA override tokens. Safe diagnostics may include contract/release/Rule Set/Rule/Placement/Paywall/Product/Entitlement IDs, exact compatibility issue codes, counts, fallback keys, assignment type and bucket, and selected fallback behavior.

Canonical valid fixtures include an advanced release, a deliberate zero-Paywall release, and a staging release with a 24-hour QA override. Atomic invalid releases cover unsupported and source-incompatible operators, malformed conditions, duplicate priority, unavailable-Paywall fallback references/cycles, exact compatibility under/over-declaration, an override longer than 24 hours, a production override, and an invalid Environment mode. `legacy-projection.json` freezes old-SDK behavior.
