# Mosaic API foundation

The Phase 0 API is a modular-monolith-ready Go shell. It contains platform and
transport packages only; organizations, projects, paywalls, publishing, and all
other product domains remain intentionally unimplemented.

## Run and verify

The API module requires Go 1.26.2 or newer. The module directive is pinned to
the repository's approved backend toolchain version.

```bash
cd apps/api
go mod download
go run ./cmd/api
```

In another terminal:

```bash
curl -i http://localhost:8080/health
```

Run the local checks from `apps/api`:

```bash
gofmt -w .
go test ./...
go vet ./...
```

## Health contract

`GET /health` is a process-liveness check. It does not currently check a
database, object store, Redis, or another dependency.

Successful response:

```http
HTTP/1.1 200 OK
Content-Type: application/json
X-Request-ID: <request-id>
```

```json
{
  "data": {
    "status": "ok"
  }
}
```

The API accepts an inbound `X-Request-ID` or creates one when it is absent. The
same ID is returned in the response header and included in error envelopes.

## Response contract

Handlers call the Mosaic-owned `response` package. Only that package calls
`go-chi/render`.

Success helpers are:

- `response.OK`
- `response.Created`
- `response.Accepted`
- `response.NoContent`

Known request failures use a stable envelope:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "The request contains invalid fields.",
    "fields": {
      "name": ["Name is required."]
    },
    "requestId": "req-example"
  }
}
```

Unknown errors and every 5xx `APIError` are replaced with the safe
`internal_error` code and a generic message. Internal error text is never sent
to clients. The timeout middleware uses the dedicated `response.RequestTimeout`
helper to return a safe `504` envelope with the stable `request_timeout` code.

Ozzo request validation errors are converted to the `fields` map by
`requestvalidation.FieldErrors`. Request DTOs can provide aliases when their
JSON field names cannot be derived from Go names. Custom Ozzo validators must
wrap infrastructure failures with `validation.NewInternalError`; those errors
are intentionally excluded from client field messages.

## Middleware order

The router installs middleware in this outer-to-inner order:

1. Chi request ID
2. Chi real IP
3. `otelchi` inbound HTTP telemetry
4. request-scoped Zerolog and request completion log
5. Mosaic safe recovery
6. security headers
7. Chi CORS
8. Mosaic request timeout

The order is defined by `httpserver.MiddlewareOrder` and asserted in router
tests. Telemetry precedes request logging so request loggers include trace IDs.
Request logging precedes recovery so recovered panics retain request and trace
correlation. Recovery returns the standard safe error envelope.

The security middleware emits `Content-Security-Policy`, `Referrer-Policy`,
`X-Content-Type-Options`, and `X-Frame-Options`. CORS has no credential support
in Phase 0 because dashboard authentication has not been designed. An empty
origin list installs a no-op CORS boundary, so it emits no cross-origin headers;
this avoids the permissive default in `go-chi/cors`.

## Configuration

Configuration is read from environment variables with no additional config
framework.

| Variable                          | Default                              | Purpose                                                                                                     |
| --------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `MOSAIC_ENVIRONMENT`              | `development`                        | Deployment environment in logs and traces.                                                                  |
| `MOSAIC_HTTP_ADDRESS`             | `:8080`                              | HTTP listen address in `host:port` form.                                                                    |
| `MOSAIC_HTTP_READ_HEADER_TIMEOUT` | `5s`                                 | Maximum time to read request headers.                                                                       |
| `MOSAIC_HTTP_READ_TIMEOUT`        | `15s`                                | Maximum request-read time.                                                                                  |
| `MOSAIC_HTTP_WRITE_TIMEOUT`       | `15s`                                | Maximum response-write time.                                                                                |
| `MOSAIC_HTTP_IDLE_TIMEOUT`        | `60s`                                | Keep-alive idle timeout.                                                                                    |
| `MOSAIC_HTTP_HANDLER_TIMEOUT`     | `10s`                                | Cooperative handler deadline with a Mosaic error envelope; must be shorter than the write timeout.          |
| `MOSAIC_HTTP_SHUTDOWN_TIMEOUT`    | `10s`                                | Graceful HTTP and telemetry shutdown budget.                                                                |
| `MOSAIC_CORS_ALLOWED_ORIGINS`     | local dashboard origins on port 3000 | Comma-separated exact origins; an explicitly empty value disables cross-origin access.                      |
| `MOSAIC_LOG_LEVEL`                | `info`                               | Zerolog level such as `debug`, `info`, or `warn`.                                                           |
| `MOSAIC_LOG_FORMAT`               | `json`                               | `json` or developer-friendly `console`.                                                                     |
| `OTEL_SERVICE_NAME`               | `mosaic-api`                         | OpenTelemetry service name.                                                                                 |
| `OTEL_EXPORTER_OTLP_ENDPOINT`     | empty                                | Optional OTLP/HTTP trace endpoint. With no endpoint, trace context still exists but spans are not exported. |

The process listens only after configuration, logging, and telemetry initialize.
It handles `SIGINT` and `SIGTERM`, stops accepting HTTP traffic, waits for
in-flight requests within the shutdown budget, then flushes telemetry.

## Deferred boundaries

No migrations or deployment files are created in Phase 0 because the health
shell has no database or infrastructure dependency.

No runnable worker is created. A root/shared Go module decision is required
before API and worker application/domain packages can be reused coherently.
That decision belongs at the Phase 0 review gate, before the first background
job—not in this foundation scaffold.
