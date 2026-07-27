# Runbook: Analytics Ingestion Failure

## Symptoms

- SDK batches to `POST /v1/sdk/events/batch` rejected (409, 422, 429), or
  `mosaic.analytics.events.rejected` spiking against its baseline.
- Analytics dashboards flat while the app is active.

## Impact

Metrics and Experiment results under-count. **Analytics failure never blocks
purchasing** — SDKs queue and retry; ingestion is deduplicated, so replays do
not double-count.

## Diagnosis

The batch response names each event's outcome; permanent rejection codes are
contract-stable. Drill-observed causes:

- **`409 analytics_collection_disabled`** — collection is **off by default**
  for every new Environment. Enable it:

  ```bash
  PUT .../environments/{environmentId}/analytics/settings
  {"collectionEnabled":true,"rawRetentionDays":90}
  ```

- **`permanently_rejected` / `occurred_at_too_far_future`** — device clocks
  ahead of server time (the drill hit this with timestamps ~6 minutes ahead).
  The boundary is working correctly; investigate the client's clock handling.
- **401** — wrong/rotated public SDK key.
- **429** — ingestion has three limiter dimensions (per source IP, per key
  batch rate, per key event rate: `MOSAIC_ANALYTICS_*` in `.env`). Behind a
  proxy, check `MOSAIC_TRUSTED_PROXY_CIDRS`.
- **Schema rejections** — an SDK/backend contract divergence; the rejection
  code attributes the cause. Check the SDK version against the supported
  Analytics Event contracts (v1, v2).

Watch the `events.ingest` span (accepted/duplicate/rejected split) and
`mosaic.analytics.events.rejected` by reason code.

## Recovery

Fix the named cause. Nothing is lost server-side: accepted events are
durable, duplicates are deduplicated, and SDKs retry transient failures.
Permanently rejected events are gone by design (they were invalid).

## Verification

A batch returns 200 with `"status":"accepted"` per event;
`mosaic.analytics.events.ingested` moves; aggregated results appear after the
worker's next pass.

## Escalation

A rejection-rate spike with a code that does not map to any documented cause,
or suspected duplication corrupting metrics: capture batch payload shape (no
user data), rejection codes, and SDK versions; file per
[docs/support.md](../support.md).

## Prevention

Enable analytics collection as part of Environment bootstrap
([installation guide](../guides/installation.md)); alert on rejection rate
versus baseline.
