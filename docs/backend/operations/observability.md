# Observability

Mosaic exports traces and metrics over OTLP/HTTP when
`OTEL_EXPORTER_OTLP_ENDPOINT` is set. With no endpoint configured, Mosaic still
records spans and metrics in-process and simply does not export them.

**Telemetry export failure never stops Mosaic.** A collector that is down or slow
degrades observability, not availability. Telemetry flush at shutdown has its own
budget (`MOSAIC_TELEMETRY_SHUTDOWN_TIMEOUT`) so a wedged collector cannot consume
the HTTP drain budget.

**No personal data and no secrets enter telemetry.** Span attributes carry
tenant, resource, and outcome identifiers only. Object-storage spans record the
bucket (deployment configuration) but not object contents. Rejection metrics
carry a coarse reason code, never the rejected value.

## Resource Attributes

Every span and metric carries:

| Attribute | Source |
| --- | --- |
| `service.name` | `OTEL_SERVICE_NAME` |
| `service.version` | build stamp (`buildinfo`) |
| `service.commit` | build stamp, when present |
| `deployment.environment.name` | `MOSAIC_ENVIRONMENT` |

The same identity is served by `GET /health/live`, so a trace can always be tied
back to a specific artifact.

## Signals

### HTTP

| Metric | Meaning |
| --- | --- |
| `request_duration_millis` | Request latency by route and status (otelchi) |
| `request_inflight` | Concurrent in-flight requests (otelchi) |
| `response_size_bytes` | Response size by route (otelchi) |
| `mosaic.http.rate_limit.rejections` | Rate-limit rejections, attribute `surface` (`auth`, `delivery`, `ingestion`, `api`, `decision`) |

Request logs carry `request_id`, `trace_id`, `http_method`, `http_path`,
`http_route`, `http_status`, `duration`, and `remote_ip`. `remote_ip` reflects
the trusted-proxy decision: a forwarded header from an untrusted peer is never
logged as the client address.

### Database

| Metric | Meaning |
| --- | --- |
| `mosaic.db.pool.acquired_connections` | Connections checked out |
| `mosaic.db.pool.idle_connections` | Idle connections |
| `mosaic.db.pool.total_connections` | Connections owned by the pool |
| `mosaic.db.pool.max_connections` | Configured maximum |
| `mosaic.db.pool.empty_acquire_count` | Acquires that waited for an empty pool |
| `mosaic.db.pool.canceled_acquire_count` | Acquires abandoned before a connection freed |
| `mosaic.db.pool.acquire_duration_seconds` | Cumulative acquire wait |

Query spans come from `otelpgx`. Sessions carry `statement_timeout` and
`lock_timeout` defaults so one query cannot hold a connection or a lock forever.

### Object Storage

Spans: `objectstore.check`, `objectstore.put`, `objectstore.open`,
`objectstore.delete`, each with `objectstore.bucket` and, for puts,
`objectstore.size_bytes`. Every operation is bounded by
`MOSAIC_OBJECT_STORAGE_OPERATION_TIMEOUT`; the readiness probe by
`MOSAIC_OBJECT_STORAGE_CHECK_TIMEOUT`.

### Publishing and Delivery

| Signal | Meaning |
| --- | --- |
| `paywall.publish` span | Publish duration and outcome |
| `configuration.build` span | Release representation construction |
| `mosaic.delivery.responses` | Delivery responses, attributes `surface` and `not_modified` |

The 304 ratio is `not_modified=true` over the total. A ratio that collapses means
SDKs stopped sending `If-None-Match` or ETags changed unexpectedly, both of which
multiply delivery cost without any Release actually changing.

### Analytics Ingestion

| Metric | Meaning |
| --- | --- |
| `mosaic.analytics.events.ingested` | Events durably accepted (including deduplicated replays) |
| `mosaic.analytics.events.rejected` | Events permanently rejected |
| `mosaic.analytics.jobs.processed` | Analytics jobs completed |

Span `events.ingest` records batch size and the accepted / duplicate / rejected
split. Permanent rejection codes are listed in
`apps/api/internal/analytics/errors.go`; they are contract-stable, so a rejection
rate spike can be attributed to a specific cause.

### Workers

| Metric | Meaning |
| --- | --- |
| `mosaic.worker.queue.depth` | Jobs queued or leased, attributes `family` and `queue` |
| `mosaic.worker.queue.oldest_age_seconds` | Age of the oldest unfinished job |
| `mosaic.worker.queue.dead_lettered` | Jobs that exhausted their retry budget |

Families: `analytics` (queues `aggregate`, `export`, `deletion`, `retention`) and
`experiment` (queue `schedule`). Each executed job logs one line with
`job_family`, `worker_id`, `duration`, and `failed`.

Depth alone does not distinguish a busy queue from a stuck one; oldest age does.

### Health

`GET /health/live` returns `status`, `version`, `commit`, `built`.

`GET /health/ready` returns 200 with `{"status":"ready"}`, or 503 with a safe
per-check code list:

| Code | Failing dependency |
| --- | --- |
| `database_unavailable` | PostgreSQL ping failed |
| `object_storage_unavailable` | Bucket check failed |
| `migration_incompatible` | Applied schema does not match the running binary |
| `encryption_misconfigured` | Provider integrations are enabled with an unusable keyring |
| `draining` | The process is shutting down |

Codes never include credentials, hostnames, or connection strings.

The worker serves the same two endpoints on `MOSAIC_WORKER_HEALTH_ADDRESS`
(default `:8081`), with PostgreSQL reachability as its readiness condition.

## Alert Conditions

Vendor-neutral definitions. Mosaic does not ship alert rules for any specific
monitoring system; these are the conditions to encode in whatever you run.

| Condition | Why it matters |
| --- | --- |
| `/health/ready` failing for more than 2 minutes | The instance is serving no traffic or is about to be pulled from rotation |
| `migration_incompatible` present in any readiness response | A binary and schema mismatch; requires an upgrade or a restore decision, never an implicit migration |
| `mosaic.worker.queue.oldest_age_seconds` > 900 on any queue | Jobs are not draining; aggregation, retention, or a scheduled Experiment transition is stalled |
| `mosaic.worker.queue.dead_lettered` increases | A job exhausted its retry budget and stopped on its own; needs a human |
| Analytics rejection rate rising sharply versus its own baseline | Either an SDK regression or a contract divergence; both corrupt metrics |
| Any publish failure | Publishing is a deliberate, low-frequency operation; a failure is always actionable |
| Object-storage failure rate above its baseline | Asset upload and delivery are degraded even while PostgreSQL is healthy |
| `mosaic.db.pool.empty_acquire_count` rising | Pool exhaustion; latency will follow |
| `mosaic.http.rate_limit.rejections` spiking with `surface="auth"` | Credential-stuffing or brute-force pressure on authentication |

Deliberately no thresholds on latency: Mosaic publishes no latency SLOs at v1
(owner decision D8). Alert on error and saturation signals, and on latency
relative to a baseline measured on your own deployment — see
[performance.md](performance.md).
