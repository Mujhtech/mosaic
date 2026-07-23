# Phase 3A backend

The Phase 3A API implements the frozen cloud-workspace and provider-neutral
Catalog contract as a modular-monolith slice. It does not implement hosted
publishing, configuration delivery, provider synchronization, purchasing, or
customer subscription state.

## Runtime boundary

The API mounts hosted routes at `/v1`. `/health/live` is liveness and
`/health/ready` verifies PostgreSQL connectivity.

The default binary requires `DATABASE_URL`, verifies a pgx pool at startup, and
uses the PostgreSQL repository. There is no in-memory runtime fallback. The
in-memory implementation remains test-only. Versioned Goose SQL migrations live
in `apps/api/migrations` and run only through `cmd/migrate` or the Compose
migration service, never during normal API startup.

Application services own authorization and transaction boundaries. Every
service operation accepts an explicit Actor. Repositories do not know about
HTTP, status codes, or authentication credentials. The PostgreSQL adapter maps
each application-owned transaction callback to one database transaction.
Multi-record mutations and their audit events therefore commit or roll back
together; Product replacement records durable history in that same transaction.

## Authentication

`authn.Resolver` is the provider-neutral dashboard boundary. It yields a
Principal with an Actor ID and authentication metadata. The production binary
currently installs `AnonymousResolver`, so hosted routes return the stable
`unauthenticated` error until the owner approves an identity provider and
cookie/token session mechanism.

Do not replace this with a development identity header or silently infer a
session mechanism. Public SDK keys and secret server keys will use separate
authenticators when their consumption endpoints are implemented.

Credentialed CORS remains disabled while the browser session decision is open.
The account-free local `/studio` workflow is separate and unchanged.

## Resources and responses

The OpenAPI source at `docs/backend/openapi.yaml` is authoritative for paths,
request fields, response resources, filters, pagination, and lifecycle actions.

- Detail and mutation results use `{ "data": <resource> }`.
- Lists use `{ "data": { "items": [], "page": { "nextCursor": "..." } } }`.
- API-key creation and rotation use
  `{ "data": { "apiKey": <metadata>, "secret": "..." } }`.
- The raw key secret is generated with `crypto/rand`, stored only as SHA-256,
  returned once, and excluded from list, revoke, audit, and log payloads.
- Provider mappings always have status `placeholder` and never make a Product
  connected or provider-backed.

Stable application error codes include `unauthenticated`, `forbidden`,
`not_found`, `conflict`, `validation_failed`, `last_owner`,
`resource_archived`, `product_referenced`, `replacement_invalid`,
`key_revoked`, and `secret_unavailable`.

## Authorization and invariants

- Organization membership is checked in application services, including for
  nested Project, Environment, and Catalog resources.
- Owners and admins can mutate workspace and Catalog resources; members are
  read-only.
- Admins cannot grant, change, or remove owner memberships.
- An Organization cannot lose its final owner.
- A Project is created atomically with immutable-key Development, Staging, and
  Production Environments.
- Catalog keys are Project-scoped, and Plan memberships, Entitlement grants,
  Provider placeholders, and Product replacements reject cross-Project links.
- Product archive and restore preserve the Product ID and relationships.
- Product replacement graphs are acyclic. A replacement target cannot be
  archived, and linked Product types cannot be changed incompatibly.
- Referenced Products cannot be destructively deleted; usage is available
  before recovery through archive or replacement.
- Project and Environment keys are immutable through the current REST surface.
- Malformed or stale cursors return `validation_failed` for `cursor`; they never
  replay the first page.

Expected unauthenticated resolver results continue to the service authorization
boundary. Unexpected resolver failures stop the request, emit a safe structured
diagnostic without resolver error text, and return `internal_error`.

Meaningful mutations create OpenTelemetry spans, structured Zerolog context,
and non-secret audit events.

## Verification

Run from `apps/api`:

```bash
gofmt -w cmd internal
go test ./...
go vet ./...
```

Database-bound checks require a disposable PostgreSQL database:

```bash
docker compose up -d postgres
docker compose exec -T postgres createdb -U mosaic mosaic_test
```

If the database already exists, `createdb` may report that fact. Then run this required acceptance
command from `apps/api`:

```bash
DATABASE_TEST_URL='postgres://mosaic:mosaic_dev@localhost:5432/mosaic_test?sslmode=disable' \
  go test ./internal/platform/cloudworkspacepostgres -run TestPhase3APersistenceRisks -count=1 -v
```

The focused integration test owns and resets the named test database schema; do
not point it at a database containing useful data. `go test ./...` without
`DATABASE_TEST_URL` skips this suite and must not be reported as database acceptance evidence. The
suite verifies empty-database migration, reconstruction persistence, Catalog relationships, tenant
constraints, error precedence, stable constraint mapping, owner/Product concurrency,
replacement atomicity/history, monotonic revocation, and API-key digest-only storage.

Hosted sign-in and an authenticated runtime demo are blocked until the owner
approves the authentication/session mechanism.
