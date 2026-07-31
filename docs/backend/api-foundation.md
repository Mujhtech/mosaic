# Mosaic API foundation

This document records the Phase 0 HTTP foundation. Phase 3A now adds the
cloud-workspace and Catalog slice documented in
`docs/backend/phase-3a-cloud-workspace.md`. Hosted publishing, browser authentication, Assets,
and configuration delivery are documented in `docs/backend/phase-3b-hosted-publishing.md`.

## Run and verify

The API module requires Go 1.26.2 or newer. The module directive is pinned to
the repository's approved backend toolchain version.

```bash
cd apps/api
go mod download
# apps/api/.env contains the local development configuration.
go run ./cmd/migrate up
go run ./cmd/api
```

In another terminal:

```bash
curl -i http://localhost:8080/health/live
curl -i http://localhost:8080/health/ready
```

Run the local checks from `apps/api`:

```bash
gofmt -w .
go test ./...
go vet ./...
```

## Health contract

`GET /health/live` is a process-liveness check. `GET /health/ready` pings
PostgreSQL and returns `503 not_ready` while it is unavailable. `/health` and
`/ready` remain compatibility aliases.

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
`X-Content-Type-Options`, and `X-Frame-Options`. CORS permits credentials only for configured
Studio origins so the HttpOnly browser session can cross the Studio/API origin boundary. An empty
origin list installs a no-op CORS boundary, so it emits no cross-origin headers;
this avoids the permissive default in `go-chi/cors`.

## Configuration

At startup, the API, provider worker, and migration command load `apps/api/.env` with
`github.com/joho/godotenv`, then decode and validate the typed configuration
with `github.com/kelseyhightower/envconfig`. Existing process environment
variables take precedence because `.env` loading does not overwrite them.

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
| `DATABASE_URL`                    | none; required                       | PostgreSQL connection URL. It is parsed but never logged.                                                   |
| `DATABASE_MAX_CONNECTIONS`        | `10`                                 | Maximum pgx pool connections.                                                                               |
| `DATABASE_MIN_CONNECTIONS`        | `2`                                  | Minimum pgx pool connections; cannot exceed the maximum.                                                    |
| `DATABASE_CONNECT_TIMEOUT`        | `5s`                                 | Startup connectivity-verification deadline.                                                                 |
| `MOSAIC_SESSION_LIFETIME`         | `168h`                               | Absolute opaque browser-session lifetime.                                                                   |
| `MOSAIC_SESSION_COOKIE_SECURE`    | `false`; required true outside development/test | Requires HTTPS transport for the browser-session cookie.                                            |
| `MOSAIC_SESSION_COOKIE_DOMAIN`    | empty                                | Optional browser-session cookie domain.                                                                     |
| `MOSAIC_AUTH_REQUESTS_PER_MINUTE` | `12`                                 | Refill rate for each authentication IP and hashed-account bucket.                                           |
| `MOSAIC_AUTH_BURST`               | `4`                                  | Burst size for each authentication limiter bucket.                                                          |
| `MOSAIC_AUTH_LIMITER_ENTRIES`     | `10000`                              | Bound on in-process authentication limiter keys.                                                            |
| `MOSAIC_PROTOCOL_V02_SCHEMA_PATH` | repository canonical schema path     | Canonical Protocol 0.2 JSON Schema compiled at startup.                                                      |
| `MOSAIC_COMMERCE_PROVIDER_SCHEMA_PATH` | repository canonical schema path | Canonical Commerce Provider v1 JSON Schema compiled at API startup.                                          |
| `MOSAIC_COMMERCE_CONFIGURATION_SCHEMA_PATH` | repository canonical schema path | Canonical Commerce Configuration v1 JSON Schema compiled at API startup.                              |
| `MOSAIC_OBJECT_STORAGE_ENDPOINT`  | `localhost:9000`                     | S3-compatible object-storage endpoint.                                                                      |
| `MOSAIC_OBJECT_STORAGE_ACCESS_KEY`| `mosaic`                             | Object-storage access key; development value is rejected in hosted environments.                            |
| `MOSAIC_OBJECT_STORAGE_SECRET_KEY`| `mosaic_dev_secret`                  | Object-storage secret; never logged and development value is rejected in hosted environments.               |
| `MOSAIC_OBJECT_STORAGE_BUCKET`    | `mosaic-assets`                      | Existing private Asset bucket checked at API startup.                                                        |
| `MOSAIC_OBJECT_STORAGE_TLS`       | `false`                              | TLS for the S3-compatible endpoint.                                                                          |
| `MOSAIC_PUBLIC_ASSET_BASE_URL`    | `https://localhost:8443/v1/sdk/assets` | Public Mosaic Asset URL prefix; HTTPS is required in every environment.                                   |
| `MOSAIC_ASSET_MAX_UPLOAD_BYTES`   | `10485760`                           | Maximum Asset bytes accepted by the application service.                                                     |
| `MOSAIC_DELIVERY_REQUESTS_PER_MINUTE` | `120`                           | Refill rate for each SDK delivery IP/API-key bucket.                                                         |
| `MOSAIC_DELIVERY_BURST`           | `30`                                 | Burst size for each SDK delivery limiter bucket.                                                             |
| `MOSAIC_DELIVERY_LIMITER_ENTRIES` | `10000`                              | Bound on in-process delivery limiter keys.                                                                   |

RevenueCat credentials, adapter timeouts, provider metadata freshness, and
worker polling variables are documented in
[`phase-4a-provider-integrations.md`](phase-4a-provider-integrations.md).

The process listens only after configuration, logging, telemetry, and a verified
PostgreSQL pool initialize. It fails startup instead of selecting volatile storage.
It handles `SIGINT` and `SIGTERM`, stops accepting HTTP traffic, waits for
in-flight requests within the shutdown budget, then flushes telemetry.

## PostgreSQL and migrations

Normal startup never applies migrations. Run them explicitly from `apps/api`:

```bash
go run ./cmd/migrate status
go run ./cmd/migrate up
go run ./cmd/migrate version
go run ./cmd/migrate down
```

For the durable Compose workflow, copy `.env.example`, then run
`docker compose up --build`. The `migrate` service completes before the API
starts, and PostgreSQL data lives in the named `mosaic_postgres_data` volume.
Stopping or recreating the API container does not remove data. Back up the
PostgreSQL volume with `pg_dump` before destructive migrations or environment
changes; named volumes are durability, not a backup policy.

## Background provider worker

`cmd/worker` uses the same PostgreSQL repository and provider credential
keyring as the API. It is enabled in Compose with the `providers` profile and
processes bounded, leased provider-synchronization jobs. It never applies
migrations or falls back to volatile storage.
