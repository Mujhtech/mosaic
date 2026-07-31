# Configuration Delivery Changelog

## Version 1 release candidate - 2026-07-22

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
