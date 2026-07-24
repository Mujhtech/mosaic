# Commerce Configuration changelog

## Version 1 release candidate - 2026-07-23

- Added an immutable Commerce Configuration sidecar without changing Paywall
  Protocol `0.2`, Local Preview `0.2`, Configuration Delivery `1`, or Commerce
  Provider Contract `1`.
- Bound exact Environment, Application, platform, Configuration Release ID,
  and Configuration Release digest.
- Added one explicit active provider, provider capabilities, verified Mosaic
  Product mappings, and Mosaic Entitlement mappings.
- Added closed direct-Product and RevenueCat Package/Offering mapping variants.
- Added an equivalent SDK-local custom-provider snapshot activation.
- Added canonical whole-sidecar digest semantics, freshness, safe diagnostics,
  strict credential exclusions, minimum fixtures, semantic validation,
  browser declarations, and generation-drift coverage.
