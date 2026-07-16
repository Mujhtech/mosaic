# ADR-0010: Use OpenTelemetry

## Status

Accepted

## Date

2026-07-16

## Context

Mosaic needs consistent traces, metrics, and observability context across HTTP requests, background jobs, database operations, event ingestion, publishing, and webhooks.

## Decision

Use OpenTelemetry as the observability standard.

Use `github.com/riandyrn/otelchi` for Chi HTTP instrumentation.

Instrument:

- inbound HTTP
- outbound HTTP
- PostgreSQL
- Redis
- background jobs
- publishing
- analytics ingestion
- asset processing
- webhook delivery

## Consequences

### Benefits

- vendor-neutral telemetry
- distributed trace context
- consistent metrics
- compatibility with OTLP backends

### Trade-offs

- instrumentation and sampling require maintenance
- excessive spans can create cost and noise
- graceful provider shutdown must be implemented

## Alternatives Considered

- vendor-specific APM SDK
- logging-only observability
- custom metrics and tracing

---
