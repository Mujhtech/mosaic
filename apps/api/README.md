# Mosaic API

This directory contains the Go API foundation and the isolated Phase 3A cloud
workspace/Catalog slice. The normal API runtime uses PostgreSQL through pgx;
the deterministic in-memory adapter remains available only to focused tests.

See [`../../docs/backend/api-foundation.md`](../../docs/backend/api-foundation.md)
for the endpoint contract, configuration, middleware order, and local commands.

See [`../../docs/backend/phase-3a-cloud-workspace.md`](../../docs/backend/phase-3a-cloud-workspace.md)
for hosted resource behavior, authorization, persistence, migrations, and
one-time API-key handling. The complete wire contract is
[`../../docs/backend/openapi.yaml`](../../docs/backend/openapi.yaml).

See [`../../docs/backend/phase-3b-hosted-publishing.md`](../../docs/backend/phase-3b-hosted-publishing.md)
for hosted Draft concurrency, immutable publishing and rollback, and public SDK configuration
delivery, browser sessions, canonical Protocol validation, and S3-compatible hosted Assets.

See [`../../docs/backend/phase-4a-provider-integrations.md`](../../docs/backend/phase-4a-provider-integrations.md)
for RevenueCat v2 credentials, required read permissions, import and mapping
semantics, synchronization workers, Commerce Configuration sidecars, and
operational recovery.

`cmd/api`, `cmd/worker`, and `cmd/migrate` load this directory's `.env` with `godotenv`
and decode it with `envconfig`. Existing process environment variables override
matching `.env` entries.
