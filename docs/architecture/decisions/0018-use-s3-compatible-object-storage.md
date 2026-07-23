# ADR-0018: Use an S3-Compatible Object-Storage Port for Hosted Assets

## Status

Accepted

## Date

2026-07-22

## Context

Protocol 0.2 Paywalls can reference remote image and video Assets. Hosted publishing therefore needs durable binary storage, immutable public delivery URLs, bounded uploads, and retention for historical releases. PostgreSQL remains the system of record for Asset metadata and release references, but storing large media bytes in application tables would couple transactional persistence to binary delivery and backup growth.

Mosaic must work in local Docker Compose and remain deployable against common hosted object-storage providers without making the domain depend on one vendor SDK.

## Decision

Define a Mosaic-owned object-storage port in the hosted-publishing application boundary with health check, put, open, and delete operations. The initial adapter uses the S3-compatible MinIO Go client.

MinIO is the local Docker Compose implementation and bucket bootstrap mechanism. Production remains provider-agnostic: operators may configure any compatible S3 endpoint, credentials, bucket, and TLS setting without changing hosted-publishing services.

PostgreSQL stores private object keys, media metadata, SHA-256 content digests, lifecycle state, and immutable version/release references. Public API responses never expose object-store credentials or private object keys. Delivery uses a Mosaic URL containing the Asset ID and content digest; Mosaic streams the private object with immutable cache headers.

Uploads are size-bounded, media-sniffed, limited to the accepted image/video allowlist, and first recorded as `pending`. Successful object persistence moves metadata to `ready`; failures move it to `failed`. Archiving removes an Asset from new authoring use but retains its bytes so previously published releases remain reproducible. Published Paywall Versions and Configuration Releases reference Assets through immutable relational rows.

The API fails startup when its configured bucket is unavailable. Every environment requires an
HTTPS public Asset base URL because the canonical Protocol and PostgreSQL constraint deliberately
share that invariant. Local Compose supplies a Caddy TLS edge with a development-only root
certificate; production rejects the documented development object-storage credentials.

## Consequences

### Benefits

- hosted Asset bytes survive API restarts
- the domain and transport remain independent of MinIO-specific types
- local development has a reproducible storage dependency
- immutable content-addressed URLs support long-lived caching
- historical releases retain the exact media they published

### Trade-offs

- deployment now requires an S3-compatible service and bucket lifecycle operations
- metadata and object writes cannot share a PostgreSQL transaction, so failed/pending reconciliation remains an operational concern
- Mosaic streams public bytes initially; a CDN or signed origin integration may be needed at higher scale
- aggregate storage quotas and media transformation are deferred

## Alternatives Considered

### PostgreSQL byte storage

Rejected because large media payloads would inflate relational backups, replication, and request-path database load.

### MinIO types in domain services

Rejected because it would make hosted publishing vendor-specific and harder to test.

### Public object-store buckets

Rejected for the initial path because Mosaic needs one stable delivery URL and must avoid exposing mutable provider URLs or bucket policy details in protocol documents.
