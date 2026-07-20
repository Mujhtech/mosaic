# Mosaic API

This directory contains the Go API foundation and the isolated Phase 3A cloud
workspace/Catalog slice. Phase 3A is implemented behind auth-neutral and
SQL-neutral ports with a deterministic in-memory adapter.

See [`../../docs/backend/api-foundation.md`](../../docs/backend/api-foundation.md)
for the endpoint contract, configuration, middleware order, and local commands.

See [`../../docs/backend/phase-3a-cloud-workspace.md`](../../docs/backend/phase-3a-cloud-workspace.md)
for hosted resource behavior, authorization, one-time API-key handling, and the
explicit persistence/session blockers. The complete wire contract is
[`../../docs/backend/openapi.yaml`](../../docs/backend/openapi.yaml).
