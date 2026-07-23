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

## PostgreSQL Persistence

Mosaic uses PostgreSQL as its system of record.

Runtime database access uses:

```text
github.com/jackc/pgx/v5/pgxpool
```

Schema migrations use:

```text
github.com/pressly/goose/v3
```

Migrations should be written in SQL unless a migration cannot reasonably be expressed in SQL.

### Runtime Wiring

The production API dependency graph must use PostgreSQL repositories.

Expected flow:

```text
cmd/api
→ configuration
→ pgxpool.Pool
→ PostgreSQL repositories
→ application services
→ HTTP handlers
```

The production dependency graph must never silently select an in-memory repository.

### Repository Interfaces

Repository interfaces may be retained where they improve domain isolation and testability.

Each production repository must have an explicit PostgreSQL implementation.

Example:

```text
ProjectRepository
└── postgres.ProjectRepository
```

An optional in-memory implementation may exist only under test-specific ownership.

### Database Startup

On startup, the API must:

1. read `DATABASE_URL`
2. parse the PostgreSQL configuration
3. create the connection pool
4. verify connectivity
5. construct PostgreSQL repositories
6. start serving requests

If connectivity verification fails, API startup must fail with a useful structured error.

Do not fall back to volatile storage.

### Migrations

Store versioned SQL migrations in:

```text
apps/api/migrations/
```

Provide commands for:

```text
migrate up
migrate down
migrate status
migrate version
```

Normal API startup must not automatically run migrations.

Local Docker Compose may use a dedicated migration service before starting the API.

### Transactions

Application services own transaction boundaries.

Use one transaction when an operation must atomically update several records.

Examples:

- create a Plan and add initial Products
- replace a Product and record replacement history
- create an API key and audit event
- update Product-to-Entitlement grants
- archive a Project and related environment state

Repositories must not independently commit pieces of an operation that should be atomic.

### Schema Integrity

Prefer database constraints for invariants that must remain true regardless of the application caller.

Examples:

- unique Product key within a Project
- unique Environment key within a Project
- valid Product type
- valid lifecycle status
- no duplicate Plan-to-Product membership
- no duplicate Product-to-Entitlement grant
- valid foreign-key relationships

Application validation improves error messages but does not replace database integrity.

### Readiness

Expose separate health concepts:

- liveness: the API process is running
- readiness: required dependencies, including PostgreSQL, are available

Readiness must fail when PostgreSQL is unavailable.

### In-Memory Implementations

In-memory repositories must not be used as production persistence.

They may be used only for narrowly scoped tests when a real PostgreSQL boundary is not the behaviour under examination.

Repository integration and migration behaviour must be verified against PostgreSQL.

## Testing

Handlers should be tested using `httptest`.

Application services should be tested independently of HTTP.

Repository integration tests should run against PostgreSQL.

---

```

```
