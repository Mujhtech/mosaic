# Performance Measurement

Mosaic measures and records latency; it does not publish latency SLOs at v1
(owner decision D8). This document describes how to run the measurements and
where the results are recorded. **It deliberately states no target numbers.** A
number only becomes a target after it has been measured on a stated environment
and accepted by the product owner.

The one hard reliability target, verified by test rather than by load, is that a
Mosaic outage never prevents cached or bundled rendering in an SDK.

## Harness

`apps/api/cmd/loadgen` is a standard-library-only measurement harness. It ships
in the API image as `/usr/local/bin/loadgen`.

```bash
cd apps/api
go run ./cmd/loadgen -scenario delivery      -url http://localhost:8080 -key "$SDK_KEY" -c 16 -d 60s
go run ./cmd/loadgen -scenario delivery-etag -url http://localhost:8080 -key "$SDK_KEY" -c 16 -d 60s
go run ./cmd/loadgen -scenario ingest        -url http://localhost:8080 -key "$SDK_KEY" -c 8  -d 60s -batch 100
```

Flags: `-scenario`, `-url`, `-key`, `-c` (concurrency), `-d` (duration),
`-batch` (events per batch), `-timeout`, `-warmup`, `-platform`,
`-sdk-version`.

Output per run: request count, throughput, error count and rate, median, p95,
p99, max, the observed status-code distribution, and for `delivery-etag` the 304
ratio. The warm-up window is not measured.

`-key` must be a **public SDK key** for a Project whose Environment has a
published Configuration Release. `delivery-etag` primes the ETag with one
request and fails fast if the endpoint returns none, so a zero 304 ratio is
always a real finding and never a harness artefact.

## Dataset

```bash
# Worker backlog for the drain measurement.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v days=365 -f scripts/seed-perf-data.sql

# Event volume, seeded through the real ingestion boundary.
go run ./cmd/loadgen -scenario ingest -url http://localhost:8080 -key "$SDK_KEY" -batch 100 -c 8 -d 5m
```

Event volume is seeded through ingestion rather than by direct `INSERT` because
`analytics_events` rows carry foreign keys to ingestion batches, API keys,
installations, subjects, and sessions that the ingestion boundary creates
together. Seeding through the real path keeps the measured read paths running
against production-shaped data.

Record the resulting row counts (`analytics_events`, `analytics_daily_*`,
`experiment_daily_unique_units`) alongside every result. A latency number
without its dataset size is not evidence.

## Measured Paths (P1–P11)

| ID  | Path | How to measure |
| --- | --- | --- |
| P1  | Configuration delivery, cold | `-scenario delivery` immediately after a publish, no `If-None-Match` |
| P2  | Configuration delivery, warm | `-scenario delivery` on a steady-state Release |
| P3  | Delivery 304 ratio | `-scenario delivery-etag`; read the reported 304 ratio and `mosaic.delivery.responses` |
| P4  | Publish | Publish through the dashboard or API while watching the publish duration histogram and the `paywall.publish` span |
| P5  | Analytics ingestion, 100-event batches | `-scenario ingest -batch 100` |
| P6  | Placement evaluation | Authenticated decision endpoint under load; `EXPLAIN ANALYZE` the decision query |
| P7  | Experiment result queries | Call the Experiment results endpoint after seeding and draining aggregation |
| P8  | Delivery v3 payload cost | Compare v3 against v2 response sizes and latency for the same Release |
| P9  | Critical dashboard APIs | Organization list, Project list, Paywall list, Release list |
| P10 | Worker backlog drain | Seed with `seed-perf-data.sql`, start the worker, watch `mosaic.worker.queue.depth` and `mosaic.worker.queue.oldest_age_seconds` to zero |
| P11 | Pool behaviour under load | Watch `mosaic.db.pool.*`, especially `empty_acquire_count` and `acquire_duration_seconds`, during P1–P10 |

For P6–P9, capture `EXPLAIN (ANALYZE, BUFFERS)` for the dominant query. A slow
path is only worth fixing once the plan shows why it is slow; Phase 8 fixes
measured release-blocking issues and does no speculative optimization.

## Recording Results

Every recorded run states:

- Mosaic version and commit (from `GET /health/live`)
- environment: host CPU/memory, PostgreSQL version, whether object storage is
  local MinIO or managed
- dataset sizes
- concurrency and duration
- median, p95, p99, error rate
- resource use during the run (CPU, memory, pool gauges)

Results are recorded as Phase 8 drill evidence, not in this document. This
document describes the method; the numbers belong to a dated run on a stated
environment.

## Interpreting Failures

An error rate above zero invalidates a latency number until explained: a 429
means the run exceeded a configured rate limit (raise the limit for the
measurement rather than reading the throttled latency as real), a 503 means
readiness or a dependency failed mid-run, and a 504 means the request exceeded
`MOSAIC_HTTP_HANDLER_TIMEOUT` or a per-route override.

See [observability.md](observability.md) for the signals referenced above.
