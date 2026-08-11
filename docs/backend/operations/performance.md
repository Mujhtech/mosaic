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

Every recorded run belongs to a dated run on a stated environment. Recorded
runs live in the Results section below and are cross-referenced from the Phase 8
drill evidence.

## Results

Numbers describe the stated environment only. Per owner decision D8, Phase 8
measures and records; it does not publish latency SLOs.

### 2026-07-27 — Phase 8 GA drill, pass two

| Item | Value |
| --- | --- |
| Mosaic version | `drill2-phase8` (`GET /health/live`), branch `phase/8-operational-hardening` |
| Host | Apple Silicon macOS (Darwin 25.5.0), arm64, 12 CPU, 16 GiB; Docker Engine 29.4.0 with 12 CPU / 7.8 GiB allocated |
| Deployment | Profile A, Docker Compose project `mosaic-drill2`, all services on one host |
| PostgreSQL | 17.10 (`postgres:17-alpine`), in-Compose |
| Object storage | MinIO `RELEASE.2025-07-23T15-54-02Z`, in-Compose |
| Load generator | `apps/api/cmd/loadgen`, run on the host against the published API port |
| Rate limits | Raised for the run so the limiter was not the thing being measured (see the note below) |

Dataset at measurement time:

| Entity | Count |
| --- | --- |
| Configuration Releases | 9 |
| Paywall Versions | 3 |
| Experiments | 3 (1 completed, 1 stopped, 1 draft) |
| Analytics Events | 41 |
| Delivered representation | Delivery v3, 15 761 bytes |

This is a **small** dataset: it exercises the request path, negotiation, and
serialization, not large-table scan behaviour. Treat the delivery numbers as a
floor for this deployment shape and re-measure against a production-sized
Release before drawing capacity conclusions.

| ID | Path | Concurrency | Duration | Requests | Throughput | Median | p95 | p99 | Max | Error rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P2 | Configuration delivery (`GET /v1/sdk/configuration`, Delivery v3, no validator) | 8 | 45s | 102 590 | 2 279.8 req/s | 3.257 ms | 6.396 ms | 8.596 ms | 41.916 ms | 0.0000 |
| P3 | Delivery 304 path (`If-None-Match` matching) | 8 | 45s | 106 997 | 2 377.7 req/s | 3.147 ms | 6.083 ms | 8.090 ms | 36.977 ms | 0.0000 |
| P5 | Analytics ingestion, 100-event batches (`POST /v1/sdk/events/batch`) | 4 | 45s | 2 478 | 55.1 req/s | 69.536 ms | 89.871 ms | 128.341 ms | 518.738 ms | 0.0000 |

P3 reported a **304 ratio of 1.0000** — every conditional request with a
matching validator was answered 304 with no body, which is the property SDK
cache revalidation depends on. All three runs had a **zero error rate**, so the
latencies are real rather than throttled.

P5 is per **batch**: 2 478 batches × 100 events is ~247 800 events accepted in
45 s (~5 500 events/s) at concurrency 4, including per-event schema validation,
minimization checks, and digest-based deduplication.

Not measured in this run, and not claimed: P1 (cold delivery immediately after a
publish), P4 (publish), P6 (Placement evaluation), P7 (Experiment result
queries), P8 (v3 versus v2 payload cost), P9 (dashboard APIs), P10 (worker
backlog drain over the seeded 10 k jobs), and P11 (pool gauges under load). No
`EXPLAIN (ANALYZE, BUFFERS)` plans were captured.

#### Rate limits during the measurement

At the shipped defaults (`MOSAIC_DELIVERY_REQUESTS_PER_MINUTE=120`) the first
attempt returned a 50 % 429 rate and 10 successful responses in 45 s, which
measures the limiter, not the delivery path. The run above raised the delivery
and analytics limits far above the offered load, as this document's
"Interpreting Failures" section prescribes. **The raised values are a
measurement setting and are not a recommended production configuration.**

Two harness defects were fixed before these numbers could be produced at all,
both found by this run:

- `cmd/loadgen` sent no capability headers, so `GET /v1/sdk/configuration` was
  answered `406 unsupported_capability` for every delivery version and the
  delivery scenarios had never measured a Configuration Release. It now
  advertises the full Paywall 0.3, Placement Decision, and Experiment
  Assignment vocabulary, so negotiation selects the highest representation the
  Environment serves.
- The Compose `api` and `worker` services passed only the variables Compose
  itself controls, so none of the rate-limit variables (and 55 other documented
  variables) reached the containers. Raising a limit for a measurement — or for
  a real deployment — had no effect until `compose.yaml` gained an operator
  `env_file`.

## Interpreting Failures

An error rate above zero invalidates a latency number until explained: a 429
means the run exceeded a configured rate limit (raise the limit for the
measurement rather than reading the throttled latency as real), a 503 means
readiness or a dependency failed mid-run, and a 504 means the request exceeded
`MOSAIC_HTTP_HANDLER_TIMEOUT` or a per-route override.

See [observability.md](observability.md) for the signals referenced above.
