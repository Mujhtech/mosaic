# Backend Conventions

## Approved Stack

Use:

- Go
- Chi
- Chi middleware
- Chi CORS
- Chi Render
- Ozzo Validation
- otelchi
- OpenTelemetry
- Zerolog
- PostgreSQL
- Redis only where justified

## Package Structure

Prefer domain-oriented packages.

```text
internal/
├── organization/
├── project/
├── environment/
├── paywall/
├── placement/
├── publishing/
├── configuration/
├── analytics/
├── experiment/
├── identity/
├── asset/
├── apikey/
├── member/
├── webhook/
└── audit/
```

Each domain may contain:

```text
handler.go
service.go
repository.go
model.go
errors.go
requests.go
responses.go
```

Split further only when a package becomes difficult to navigate.

## Handlers

Handlers must:

1. read path, query, headers, and body
2. decode input
3. validate transport-level constraints
4. call an application service
5. return a standardized response

Handlers must not:

- query the database directly
- contain publishing rules
- perform authorization only in the UI
- construct SQL
- expose internal errors
- call `render.JSON` directly

## Response Helpers

Use Mosaic-owned response functions:

```go
response.OK(w, r, data)
response.Created(w, r, data)
response.Accepted(w, r, data)
response.NoContent(w, r)
response.Error(w, r, err)
```

Successful responses should generally use:

```json
{
  "data": {}
}
```

Errors should generally use:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "The request contains invalid fields.",
    "fields": {
      "name": ["Name is required."]
    },
    "requestId": "..."
  }
}
```

## Validation

Use Ozzo Validation for transport-level validation.

Examples:

- required fields
- lengths
- patterns
- enumerations
- simple cross-field checks

Do not perform database-dependent validation inside request DTOs.

Application services own:

- uniqueness
- ownership
- authorization
- state transitions
- resource relationships
- publishing eligibility

## Errors

Create stable domain and application errors.

Do not compare error-message strings.

Use:

- typed errors
- sentinel errors where appropriate
- `errors.Is`
- `errors.As`

Map errors to HTTP responses in one centralized layer.

## Logging

Use Zerolog from context:

```go
logger := zerolog.Ctx(ctx)
```

Use structured fields instead of formatted message strings.

Preferred:

```go
logger.Info().
    Str("project_id", projectID).
    Str("actor_id", actorID).
    Msg("project created")
```

Avoid:

```go
logger.Info().Msgf("project %s created by %s", projectID, actorID)
```

Never log secrets or authorization headers.

## OpenTelemetry

Instrument:

- HTTP requests
- database operations
- Redis operations
- outbound requests
- publishing
- background jobs
- event ingestion
- webhook delivery

Use semantic span names such as:

```text
paywall.publish
configuration.build
events.ingest
webhook.deliver
```

## Middleware

Middleware should have one responsibility.

Expected middleware includes:

- request ID
- real IP
- recovery
- security headers
- CORS
- authentication
- authorization context
- telemetry
- request-scoped logging
- rate limiting
- timeout

Document the final middleware order in router tests or an ADR.

## Transactions

Application services should define transaction boundaries.

Do not begin transactions inside generic repositories without the caller understanding the boundary.

Publishing a release should be atomic where necessary.

## Database Access

Repositories should:

- accept context
- return domain or persistence models intentionally
- use parameterized queries
- distinguish not-found from unexpected failures
- avoid leaking SQL errors upward

## Testing

Handlers should be tested using `httptest`.

Application services should be tested independently of HTTP.

Repository integration tests should run against PostgreSQL.

---
