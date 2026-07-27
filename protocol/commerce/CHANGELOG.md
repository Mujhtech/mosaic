# Commerce Provider Contract changelog

## Version 2 - 2026-07-24

Status: approved at v1 GA (2026-07-27); released as a candidate on 2026-07-24

- Preserved all v1 behavior and fixtures as a parallel readable contract.
- Added native recovery modes and explicit base-plan, offer, asynchronous
  update, and local-delivery-acceptance capabilities.
- Added configuration-bound asynchronous commerce updates with stable
  deduplication identity and bounded safe outcomes.
- Added idempotent local acceptance dispositions and froze the rule that only
  accepted or already-accepted delivery authorizes native finish or
  acknowledgement.
- Documented exact v1/v2 negotiation and retain-last-accepted/bundled fallback.
- Bound `configurationRevision` to the exact Commerce Configuration content
  digest, required non-empty purchased-update access, and froze complete
  truthful StoreKit and Google capability matrices.

## Version 1 - 2026-07-23

Status: approved at v1 GA (2026-07-27); released as a candidate on 2026-07-23

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
