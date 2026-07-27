# Analytics Event Contract changelog

## Version 2 - 2026-07-26

Status: approved at v1 GA (2026-07-27); released as a candidate on 2026-07-26

- Added `experiment_assigned`, `experiment_exposed`, `experiment_fallback_presented`, and `experiment_assignment_failed` with closed typed payloads.
- Added an all-or-none immutable Experiment ID/Version/Variant/allocation tuple to Experiment, Product-selection, and purchase lifecycle events.
- Froze successful native presentation as the exposure boundary and kept diagnostic assignment outside result denominators.
- Kept assigned and actually presented fallback identities distinct and prohibited QA presentation from statistical exposure.
- Preserved Analytics Event `1` bytes and semantics; ingestion accepts exact v1 and v2 batches side by side.

## Version 1 - 2026-07-26

Status: approved at v1 GA (2026-07-27); released as a candidate on 2026-07-26

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
