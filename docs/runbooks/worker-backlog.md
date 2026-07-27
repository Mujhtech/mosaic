# Runbook: Worker Backlog

## Symptoms

- `mosaic.worker.queue.oldest_age_seconds` > 900 on any queue (the
  documented alert), or `mosaic.worker.queue.depth` climbing without
  draining.
- Analytics results lag; scheduled Experiment transitions do not happen;
  exports/deletions stay queued.

## Impact

Delivery and ingestion are unaffected — the backlog delays derived work
(aggregation, retention, exports, deletions, Experiment schedule actions).

## Diagnosis

```bash
docker compose ps worker
docker compose exec worker /usr/local/bin/healthcheck http://127.0.0.1:8081/health/ready
docker compose logs --tail 200 worker
```

Every finished job logs one line with `job_family` (`analytics` or
`experiment`), `job_id`, `job_kind`, `project_id`, `duration`, `failed`, and
`trace_id` where available. Distinguish:

- **Worker down / crash-looping** — no "background job finished" lines at
  all. Check the log for its exit cause; PostgreSQL reachability is its
  readiness condition.
- **Jobs failing and retrying** — `"failed":true` lines. Jobs retry with
  backoff up to their attempt budget, then dead-letter:
  `mosaic.worker.queue.dead_lettered` increases and the job records a
  terminal `last_error_code` (drill-observed example:
  `experiment_state_conflict` at attempts 5/5).
- **Queue busy but draining** — depth high, oldest age falling. Wait.

## Recovery

- Worker down: `docker compose up -d worker`. Recovery is lease-safe and
  drill-verified against `kill -9`: a lease stranded by a dead worker is
  reclaimed after expiry and the job retried — no manual queue surgery, no
  duplicates.
- Jobs failing repeatedly: fix the cause named by the job's error code
  (dependency down, misconfiguration), then let retries proceed.
- Dead-lettered jobs stopped on their own and need a human: the terminal
  `last_error_code` says why. A job dead-lettered because its action already
  happened (e.g. `experiment_state_conflict` after a manual start) needs no
  action.

## Verification

Oldest age falls back toward zero; `docker compose logs worker` shows
`"failed":false` completions; the delayed outcome appears (results update,
export completes, Experiment transitions).

## Escalation

Dead-letters with an error code that names Mosaic internals rather than your
environment: capture the job log lines and file per
[docs/support.md](../support.md).

## Prevention

Alert on `oldest_age_seconds` > 900 and on any `dead_lettered` increase
([observability](../backend/operations/observability.md)). Depth alone does
not distinguish busy from stuck; oldest age does.
