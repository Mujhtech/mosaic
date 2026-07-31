# Phase 3A backend

The Phase 3A API implements the frozen cloud-workspace and provider-neutral
Catalog contract as a modular-monolith slice. It does not implement hosted
publishing, configuration delivery, provider synchronization, purchasing, or
customer subscription state.

## Runtime boundary

The API mounts the hosted routes at `/v1`. `/health` is liveness and `/ready`
reports readiness of the currently configured process-local adapter.

The default binary uses a concurrency-safe in-memory repository. Data is lost
when the process exits. This is deliberate: PostgreSQL is approved, but the Go
driver, SQL/query strategy, migration runner, transaction implementation, and
API/worker sharing boundary remain owner decisions. No database dependency or
placeholder migration was introduced.

Application services own authorization and transaction boundaries. Every
service operation accepts an explicit Actor. Repositories do not know about
HTTP, status codes, or authentication credentials. The in-memory adapter clones
state for each write transaction and commits only when the application callback
succeeds.

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

## Verification and blocked checks

Run from `apps/api`:

```bash
gofmt -w cmd internal
go test ./...
go vet ./...
```

PostgreSQL repository tests, forward migration checks, and rollback/operational
migration checks are blocked until the owner approves persistence tooling.
Hosted sign-in and an authenticated runtime demo are blocked until the owner
approves the authentication/session mechanism.
