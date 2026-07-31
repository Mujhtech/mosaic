# Runbook: Readiness Failing

## Symptoms

- `GET /health/ready` returns 503 while `GET /health/live` stays 200.
- Load balancer pulls the instance; Compose healthcheck reports unhealthy.

## Impact

The instance is not serving (or is about to be pulled). SDKs fall back to
cached configuration.

## Diagnosis

```bash
curl -s http://localhost:8080/health/ready
```

The 503 body lists safe per-check codes (never hosts or credentials):

| Code | Go to |
| --- | --- |
| `database_unavailable` | [postgres-unavailable](postgres-unavailable.md) |
| `object_storage_unavailable` | [object-storage-unavailable](object-storage-unavailable.md) — delivery keeps serving; only Assets are degraded |
| `migration_incompatible` | schema drifted under a running API — [migration-failed](migration-failed.md) |
| `encryption_misconfigured` | [keyring-loss-rotation](keyring-loss-rotation.md) |
| `draining` | shutdown in progress — expected during deploys |

Checks are dependency-aware: with PostgreSQL down you see only
`database_unavailable`; the migration check is skipped rather than reported
as a second failure.

The worker's readiness (PostgreSQL reachability) is served on `:8081` inside
its container:

```bash
docker compose exec worker /usr/local/bin/healthcheck http://127.0.0.1:8081/health/ready
```

## Recovery

Recover the named dependency. No API restart is needed: readiness returned
503 → 200 with zero restarts in the dependency-failure drill once the
dependency came back.

## Verification

`curl -s http://localhost:8080/health/ready` → 200; `docker compose ps` shows
`api` healthy with an unchanged restart count.

## Escalation

Readiness failing more than 2 minutes is the documented alert condition. If
readiness flaps with no dependency change, capture the readiness responses
and `docker compose logs api` and file per [docs/support.md](../support.md).

## Prevention

Alert on the conditions in
[observability](../backend/operations/observability.md): readiness failing
> 2m, and `migration_incompatible` appearing in any readiness response.
