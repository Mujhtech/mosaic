# Phase 5 Placement Decisions Backend

The Phase 5 backend adds Environment-scoped Placement Rule Sets without changing
the existing Placement presentation key. Rule Set Drafts are whole-document,
optimistically concurrent resources. Every accepted edit creates an immutable
Draft revision; publication creates an immutable Rule Set Version.

## Contracts and delivery

- Authoring accepts the canonical Placement Decision v1 envelope from
  `protocol/schema/placement-decision/v1/decision.schema.json`.
- Configuration publication compiles the current immutable Rule Set Versions
  and exact referenced Paywall Versions, Products, Entitlements, and Assets into
  a Configuration Delivery v2 representation in the same PostgreSQL
  transaction as the release.
- A Delivery v1 representation is stored only when every advanced Placement has
  an explicit Paywall default. `no_paywall`, fallback, and Rule outcomes are
  never projected as unconditional legacy bindings.
- Rollback copies stored immutable v1/v2 representations and pinned Rule Set
  Version references; it does not recompile mutable Drafts.

SDKs request Delivery versions through `Mosaic-Configuration-Versions`. Delivery
v2 clients additionally report Placement Decision versions, exact decision
features, and supported bucketing algorithms. Unsupported required semantics
withhold the candidate so the SDK can retain its last accepted or bundled
configuration.

## Authoring resources

Project APIs expose attribute definitions, Placement aliases and usage, Rule Set
Draft create/update/validate/publish/history/clone, the simulator, and QA
overrides. `PUT` Draft updates require both `If-Match` and `Idempotency-Key`.
Stale revisions return `draft_revision_conflict` with the server revision and
ETag; local work is never overwritten.

Only owners and admins mutate or publish. Members may read and run simulations.
Attribute values and simulator contexts are never persisted.

`POST /v1/projects/{projectId}/environments/{environmentId}/placements/{placementId}/rule-sets/{ruleSetId}/archive`
is the owner/admin-only terminal Rule Set lifecycle operation. It supersedes the
active Draft and clears the mutable Draft pointer while preserving every
immutable published Rule Set Version. Archived Rule Sets cannot be restored,
edited, cloned, or published in Phase 5. Placement usage counts only active Rule
Sets for the Placement archive precondition; historical published Rule and Rule
Set Versions remain inspectable and immutable.

## QA overrides and privacy

QA overrides are limited to development and staging and expire within 24 hours.
The raw selector is reduced to a server-side digest. A separate random 256-bit
opaque token is returned once; only its digest is published. Audit metadata
contains safe IDs, outcome type, and expiry, never selectors, tokens, identity
values, attributes, provider payloads, or request bodies.

## Evaluation

The pure Go evaluator implements explicit priority, three-state condition
semantics, `mosaic_semver_v1`, RFC 4647 basic locale filtering, explicit country
input, deterministic `sha256_length_prefixed_v1` rollout, `no_paywall`, named
fallbacks, and bounded redacted traces. The simulator injects Project,
Environment, and Placement identity server-side and does not cache its response.

No analytics, customer profile, customer attribute value, trace, Experiment, or
authoritative Entitlement-state storage is introduced by Phase 5.
