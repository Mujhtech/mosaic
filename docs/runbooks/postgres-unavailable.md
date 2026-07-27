# Runbook: PostgreSQL Unavailable

## Symptoms

- `/health/ready` 503 with `database_unavailable` (API), worker readiness
  failing; `/health/live` still 200.
- Dashboard requests fail; SDK delivery fails (SDKs serve cache).

## Impact

Everything that reads or writes state is down. Nothing is corrupted: the API
and worker wait rather than degrade.

## Diagnosis

```bash
docker compose ps postgres
docker compose logs --tail 50 postgres
curl -s http://localhost:8080/health/ready
```

The API operator log records the connection failure with topology detail
(host/port, no password); the HTTP response carries only the code. With the
`debug` profile up, connect directly:

```bash
docker compose exec postgres psql -U mosaic -d mosaic -c 'SELECT 1'
```

## Recovery

- Container stopped/crashed: `docker compose up -d postgres`. It has
  `restart: unless-stopped`, so investigate why it stopped (`docker compose
  logs postgres`; disk full is the classic cause).
- Managed PostgreSQL (Profile B): follow your provider's incident process;
  Mosaic reconnects on its own once the database answers.

No API or worker restart is required — the drill verified readiness recovery
with zero restarts.

## Verification

```bash
curl -s http://localhost:8080/health/ready   # 200
docker compose exec worker /usr/local/bin/healthcheck http://127.0.0.1:8081/health/ready
```

Then confirm a normal read (dashboard page or any authenticated `GET`).

## Escalation

If PostgreSQL data is corrupted or the volume is lost, this becomes a restore
incident: [failed-restore](failed-restore.md) /
[backup and restore guide](../guides/backup-restore.md).

## Prevention

Monitor pool gauges (`mosaic.db.pool.*`, especially `empty_acquire_count`
rising) and disk space on the PostgreSQL volume; take scheduled backups.
