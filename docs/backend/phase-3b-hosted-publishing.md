# Phase 3B hosted publishing backend

The Phase 3B API adds browser-authenticated hosted Paywalls, Environment-scoped append-only Draft
revisions, immutable Paywall Versions, hosted Assets, basic Placements, atomic Configuration
Releases, rollback, and public SDK-key delivery. PostgreSQL is the metadata system of record and an
S3-compatible private bucket stores Asset bytes.

## Browser authentication

`POST /v1/auth/signup` and `POST /v1/auth/login` create an opaque
`mosaic_session` cookie. `GET /v1/auth/session` returns the current user and
`POST /v1/auth/logout` revokes the server-side session. Passwords use bcrypt cost 12. PostgreSQL
stores only password hashes and SHA-256 session-token digests. Cookies are HttpOnly,
SameSite=Lax, and Secure outside development/test. Credentialed CORS and supplied-Origin checks
are restricted to configured Studio origins. Every unsafe `/v1` browser mutation, including
multipart Asset upload, rejects a supplied untrusted Origin; Origin-less CLI/server requests remain
available. Login and signup use bounded IP and hashed-account token buckets. A missing-account
login still performs bcrypt work before returning the same `invalid_credentials` response used for
a bad password. SDK API keys never authenticate Studio routes.

## Draft concurrency

Draft reads return an `ETag` in the form `"draft-<id>-r<revision>"`. Updates require both
`If-Match` and `Idempotency-Key`. Missing preconditions return `428 precondition_required`; a stale
revision returns `412 draft_revision_conflict` with allowlisted current-revision metadata. Every
successful save appends an immutable `paywall_draft_revisions` row. A mutation key is bound to its
base ETag and canonical document. A later retry returns the exact historical revision metadata,
document, and ETag instead of mixing the old document with current Draft metadata.

Studio can rediscover hosted work after reload with:

```text
GET /v1/projects/{projectId}/paywalls/{paywallId}/drafts/active?environmentId={environmentId}
```

It returns the existing Draft envelope and ETag, or `404 not_found` when there is no active Draft.

## Publishing

Publish and rollback require `Idempotency-Key`. Each operation locks the Environment release scope,
validates authorization and relationships, creates immutable snapshots, advances the monotonic
release number, updates the current pointer, records audit data, and commits in one PostgreSQL
transaction. Retrying an identical request returns the original Release. Rollback copies the
selected Release's persisted payload snapshot and regenerates only the new Release ID, number,
publication time, and content digest; mutable Product or Asset rows are never consulted.

Publishing is Protocol `0.3` only. The API compiles the canonical Protocol 0.3 JSON Schema at
startup and applies both schema and semantic validation before any immutable Version is created.
Missing, archived, or cross-Project Products block publication.
Mock Products require explicit acknowledgement and missing provider mappings are returned as
warnings. Remote document Assets must use a ready Mosaic-hosted URL in the same Project. Published
Version/Release Asset rows are immutable.

## Hosted Assets

The authenticated Project Asset API supports upload, list, get, usage, and archive operations.
Uploads are bounded, media-sniffed, and limited to JPEG, PNG, WebP, GIF, and MP4. S3-compatible
storage is accessed behind the Mosaic `ObjectStore` port; local Compose uses a private MinIO bucket.
Public bytes are streamed from:

```text
GET /v1/sdk/assets/{assetId}/{contentDigest}
```

The URL includes the immutable SHA-256 digest and returns long-lived immutable cache headers.
Archiving prevents new authoring use but deliberately retains bytes referenced by release history.

## SDK delivery

`GET /v1/sdk/configuration` authenticates an active Environment-scoped `public_sdk` key supplied as
a Bearer token. The Environment is derived only from the key. Required capability headers are
documented in OpenAPI. `Mosaic-Paywall-Capabilities` reports unique comma-separated exact pairs
such as `component.text@0.3`; the API validates the closed capability catalog and requires every
capability in the selected Release. The endpoint serves only the persisted current immutable Release, supports
representation-specific strong ETags, `If-None-Match`, `304`, deterministic standard gzip, and:

```text
Cache-Control: private, max-age=60, stale-if-error=86400
```

Drafts, unpublished Versions, API credentials, provider identifiers, and audit actors are excluded
from delivery payloads.

The private-alpha delivery edge applies bounded in-process token buckets first by client IP and then
by authenticated public SDK key. Rejections return `429 rate_limited` and `Retry-After`. This is a
single-instance safety limit; horizontally scaled deployments need an aggregate edge limiter.

## Migrations and verification

Migrations `00003_phase_3b_hosted_publishing.sql`, `00004_browser_auth.sql`, and
`00005_hosted_assets.sql` extend the accepted Phase 3A schema. API startup
does not apply it automatically. Run the existing migration command or Compose migration service.

Local durable dependencies and bucket creation are started through:

```bash
docker compose up --build
```

Local Compose also starts Caddy on `https://localhost:8443`. The API persists that HTTPS origin in
Protocol documents and Release Asset references, so local records satisfy the same database and
Protocol constraints as hosted records. Export the development root certificate with:

```bash
docker compose cp local-edge:/data/caddy/pki/authorities/local/root.crt /tmp/mosaic-local-caddy-root.crt
```

Trust that certificate only on development simulators/emulators or devices used for the hosted
Asset demo. Do not distribute it with an application. The direct API remains available on
`http://localhost:8080` for browser development; SDK configuration and immutable Asset bytes can be
requested through the trusted local TLS edge.

Every `MOSAIC_PUBLIC_ASSET_BASE_URL`, including development, must be HTTPS because Protocol `0.3`
and PostgreSQL intentionally enforce immutable HTTPS Asset references. For hosted deployments,
replace the documented development object-store credentials, enable the session Secure cookie,
and configure an externally reachable HTTPS Asset origin.

Authentication token buckets are configured with `MOSAIC_AUTH_REQUESTS_PER_MINUTE`,
`MOSAIC_AUTH_BURST`, and `MOSAIC_AUTH_LIMITER_ENTRIES`. Like the private-alpha delivery limiter,
they are per-process; multi-instance deployments require an aggregate edge limit.

The focused PostgreSQL integration scenario requires a disposable database and resets its schema:

```bash
DATABASE_TEST_URL='postgres://mosaic:mosaic_dev@localhost:5432/mosaic_test?sslmode=disable' \
  go test ./internal/platform/cloudworkspacepostgres -run TestPhase3BPublishingPersistenceRisks -count=1 -v
```
