# ADR-0011: Use Zerolog for Structured Logging

## Status

Accepted

## Date

2026-07-16

## Context

Mosaic requires efficient structured logs that integrate with request context and OpenTelemetry trace identifiers.

## Decision

Use `github.com/rs/zerolog` as the application logging API.

Request-scoped loggers will be stored in context.

Logs should include where available:

- service
- environment
- request ID
- trace ID
- actor ID
- project ID
- resource IDs

## Consequences

### Benefits

- structured JSON output
- low-allocation logging
- context integration
- explicit fields
- strong performance

### Trade-offs

- APIs are specific to Zerolog
- logging conventions must be documented
- trace correlation requires middleware support

## Alternatives Considered

- slog
- Zap
- Logrus
- OpenTelemetry logs as the direct application API
