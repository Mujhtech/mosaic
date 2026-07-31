# Analytics Event Contract changelog

## Version 1 - 2026-07-26

Status: release candidate

- Added closed batch, event, ingestion-response, and compatibility-manifest
  schemas for the Placement-to-purchase and restore journeys.
- Added stable event, session, and correlation identifiers; immutable
  attribution; event-time identity snapshots; and exact millisecond UTC time.
- Separated client-observed, trusted-server, and provider-confirmed authority.
- Added typed payloads for 27 event names without custom property bags.
- Added accepted, duplicate, permanently rejected, retryable, and mixed-result
  batch semantics with Environment-scoped event idempotency.
- Froze 100-event, 32 KiB event, 512 KiB batch, five-minute future-skew,
  seven-day expiry, and 24-hour attribution limits.
- Added canonical lifecycle, provider-authority, invalid, duplicate, and mixed
  response fixtures plus focused semantic validation.
- Closed correlation and attribution per event family, made Rule Set and
  rollout attribution atomic, and added a shared edge-case conformance corpus.
- Clarified opaque Application User identity and fail-closed unknown
  acknowledgement-code behavior.
- Preserved Paywall Protocol `0.2`, Placement Decision `1`, Configuration
  Delivery `1`/`2`, and Commerce Provider `1`/`2` semantics.
