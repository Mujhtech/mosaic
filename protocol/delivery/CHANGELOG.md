# Configuration Delivery Changelog

## Versions 1 and 2 deleted; v3 re-pinned to Paywall 0.4 - 2026-08-13

Status: approved

Owner ruling, single-version contracts
([ADR-0028](../../docs/architecture/decisions/0028-single-version-contracts.md)).
Versions `1` and `2` are deleted outright, and with them the v2 -> v1 and
v3 -> v2 projection machinery, the carry-forward rule that kept a v1
representation alive across Experiment publishes, and the `legacyProjection`
reader policy. A release is now accepted whole or rejected whole; nothing is
compiled down to a narrower representation.

`3` inlined the `$defs` it had been borrowing from v1's release and
capability-request schemas, and was re-pinned to carry **Paywall Protocol 0.4**:
`paywallVersion.protocolVersion` and `protocolCompatibility.version` are
`const "0.4"`, the embedded document `$ref`s
`urn:mosaic:protocol:schema:v0.4:paywall`, and both sides of the capability
request negotiate `0.4`. That re-pin is what makes a `0.4` document deliverable.

The fixture corpus is generated directly from the `0.4` paywall corpus by
`tools/generate-delivery-fixtures-v3.mjs`; the v1 and v2 fixture generators are
deleted. The v2 valid and invalid corpora were migrated to `v3` rather than
dropped, so no Placement Decision rejection scenario was lost.

## Version 3 - 2026-07-26

Status: approved at v1 GA (2026-07-27); released as a candidate on 2026-07-26

- Retained the complete immutable Delivery `2` snapshot and atomically added Experiment Assignment Contract `1` definitions.
- Added exact Experiment contract, feature, bucketing-algorithm, and trusted-time schedule-policy negotiation.
- Added strict tenant, Placement, immutable Paywall Version, allocation, compatibility, and release-digest validation with last-accepted preservation.
- Defined the Delivery `2` projection as unchanged normal Placement behavior; Experiment Variants are never projected as unconditional bindings.
- Added canonical release/capability/projection fixtures and malformed-allocation/unsupported-contract rejection fixtures without modifying v1/v2.
- Group Version snapshots carry complete stable-Experiment membership ranges; Delivery validates each pinned Experiment Version's stable Experiment root against that selected Group Version.
- Delivery accepts both bounded schedules and immediate/manual-completion
  Assignments without an `endsAt`, while preserving trusted-time fallback.

## Version 2 - 2026-07-26

Status: approved at v1 GA (2026-07-27); released as a candidate on 2026-07-26

- Added an atomic Delivery `2` envelope for Placement Decision Contract `1` Rule Sets and unchanged Paywall Protocol `0.2` documents.
- Added exact decision-feature and bucketing-algorithm capability negotiation, Product readiness, stable Entitlement references, and zero-Paywall `no_paywall` releases.
- Added strict Project/Environment and Paywall/Product/Entitlement/Asset reference validation with whole-candidate rejection and last-known-valid preservation.
- Defined Delivery v1 projection only for an explicit default Paywall; advanced Rules and `no_paywall` are never projected as unconditional bindings.
- Added valid, zero-Paywall, capability, legacy-projection, and atomic invalid fixtures without modifying Delivery v1.

## Version 1 - 2026-07-22

Status: approved at v1 GA (2026-07-27); released as a candidate on 2026-07-22

- Added the separate, strict Configuration Delivery `1` release envelope around unchanged Paywall
  Protocol `0.2` documents.
- Added immutable Environment, Release, Placement, Paywall Version, Product display-reference, and
  hosted Asset-reference records with complete semantic cross-reference validation.
- Added canonical SHA-256 document and release-material digests and documented strong ETag as an
  HTTP concern.
- Added the closed SDK capability-request metadata contract for platform, SDK version, supported
  Delivery versions, exact Paywall versions/capabilities, and optional application version.
- Defined atomic candidate rejection, last-known-valid cache preservation, bundled Release fallback,
  explicit unavailable behavior, safe diagnostics, and unknown-version/field rejection.
- Added valid, multiple-Paywall, Placement, Product, Asset, unsupported-version, malformed, and
  incomplete fixtures plus minimum-sufficient validation tests.
- Preserved Paywall Protocol `0.2`, Local Preview `0.2`, and ADR-0016 retirement of pre-release
  Protocol `0.1` without semantic changes.
