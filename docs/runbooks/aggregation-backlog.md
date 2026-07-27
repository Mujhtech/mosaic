# Runbook: Aggregation Backlog

## Symptoms

- Events are ingested (`mosaic.analytics.events.ingested` moving) but
  analytics overview/funnel and Experiment results lag behind.
- `mosaic.worker.queue.oldest_age_seconds` climbing on the `analytics`
  family's `aggregate` queue.

## Impact

Read-side freshness only. Raw events are durable; aggregation catches up and
recomputes — no data is lost while the backlog drains.

## Diagnosis

```bash
docker compose logs --tail 200 worker | grep '"job_family":"analytics"'
```

- No `aggregate` completions at all → the worker itself is the problem:
  [worker-backlog](worker-backlog.md).
- Completions with `"failed":true` → the logged error and `job_id` name the
  cause; the job retries with backoff and dead-letters at its attempt budget.
- Completions succeeding but slow → a genuine volume backlog; watch oldest
  age fall. *(Drain-rate under a seeded 10k-job backlog was not measured in
  the GA drills; no throughput guidance is claimed.)*

Cross-check freshness end to end: ingest a test event and watch it appear in
`GET .../analytics/overview` (requires `timezone` and `metricBasis`
parameters) after the next aggregation pass — the drill observed the worker
picking up aggregation on its own poll.

## Recovery

- Worker/dependency problem: recover it; aggregation resumes on the next
  poll (`MOSAIC_ANALYTICS_WORKER_POLL_INTERVAL`, default 1s).
- Dead-lettered aggregation job: the terminal `last_error_code` says why;
  address it and file per escalation if it names internals. A privacy
  deletion in state `recomputing` (drill-observed) is aggregation redoing
  affected windows — expected, not a failure.

## Verification

Oldest age on the `aggregate` queue returns toward zero; overview/funnel and
`GET .../experiments/{id}/results` reflect recent events.

## Escalation

Aggregation jobs dead-lettering repeatedly with the same internal error:
capture the job log lines (`job_id`, `trace_id`, error) and file per
[docs/support.md](../support.md).

## Prevention

Alert on `oldest_age_seconds` > 900 per queue and dead-letter increases;
keep the worker running in every installation (it is not optional).
