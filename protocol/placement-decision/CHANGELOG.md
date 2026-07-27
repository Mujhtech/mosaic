# Placement Decision Contract changelog

## Version 1 - 2026-07-26

Status: approved at v1 GA (2026-07-27); released as a candidate on 2026-07-26

- Added a closed, platform-neutral three-state Placement decision model with explicit priority, bounded conditions, typed values, exact compatibility requirements, and safe diagnostic labels.
- Added platform, semantic version, locale, explicit country, identity, allow-listed attribute, Entitlement, Product, readiness, and provider-capability inputs.
- Added exact Paywall, `no_paywall`, named fallback, and unavailable outcomes with bounded acyclic fallback resolution.
- Added explicit assignment policies and `sha256_length_prefixed_v1` rollout with shared UTF-8 conformance vectors.
- Added non-production, high-entropy token-digest QA override metadata with a 24-hour maximum lifetime and privacy-safe trace requirements.
- Added a shared evaluator corpus and focused invalid fixtures for unsupported operators, malformed condition kinds, duplicate priorities, and fallback cycles.
- Clarified that locale equality and membership use the same canonical normalization as locale filtering, and added conformance vectors for underscore-delimited runtime locales and malformed runtime semantic versions.
