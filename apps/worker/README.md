# Mosaic worker

The worker entry point lives in the shared Go module at `apps/api/cmd/worker`.
It leases PostgreSQL-backed analytics aggregation, export, deletion, and
retention jobs. When provider integrations are enabled, the same process also
leases provider synchronization work. Jobs use bounded leases and retry state;
no separate queue, Redis dependency, or second service is required.

Run it after explicit migrations with `go run ./cmd/worker` from `apps/api`.
PostgreSQL and the configured private S3-compatible bucket are required.
