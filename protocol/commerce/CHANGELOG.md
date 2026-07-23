# Commerce Provider Contract changelog

## Version 1 release candidate - 2026-07-23

- Added a separately versioned, closed, platform-neutral Commerce Provider
  Contract without changing Paywall Protocol `0.2`, Local Preview `0.2`, or
  Configuration Delivery `1`.
- Defined provider identity and explicit supported, unsupported, or conditional
  capability reporting.
- Distinguished stable Mosaic Product identity and Entitlement grants from a
  verified opaque Provider Product binding.
- Added resolved localized Product metadata, availability, structured billing
  periods, trials, introductory offers, metadata source, and freshness.
- Added explicit purchased, pending, deferred, cancelled, already-entitled,
  Product-unavailable, Provider-unavailable, and failed purchase outcomes.
- Added restore and active-Entitlement outcomes that cannot turn provider
  failure into an empty successful state.
- Added bounded safe diagnostics, correlation, retryability, optional
  retry-after, and redaction requirements.
- Added minimum cross-platform fixtures, semantic validation, generated browser
  declarations, documentation, and generation-drift coverage.

