# Runbook: API Will Not Start

## Symptoms

- `docker compose ps` shows `api` as `restarting` or `exited`.
- `/health/live` connection-refused; the dashboard shows an API outage.

## Impact

Dashboard and SDK delivery are down. SDKs keep rendering from cache/bundled
fallback, so end users are degraded, not broken.

## Diagnosis

```bash
docker compose ps
docker compose logs --tail 100 api
```

Read upward from the last `api stopped` line. The four startup failure
classes, in the order startup checks them:

1. **Configuration invalid** — a structured multi-problem list naming every
   offending variable (values never printed). Includes production-guard
   rejections: wildcard/`http://` CORS origins, default MinIO credentials,
   plaintext object storage, `DATABASE_URL` without a verifying `sslmode`.
2. **PostgreSQL unreachable** — see
   [postgres-unavailable](postgres-unavailable.md).
3. **`verify migration compatibility: database schema is behind the expected
   migration version`** — pending migrations. The API fails startup and
   crash-loops by design; it never auto-migrates and never serves against an
   incompatible schema.
4. **`initialize object storage`** — see
   [object-storage-unavailable](object-storage-unavailable.md);
   **`configure provider credential encryption`** — keyring malformed, see
   [keyring-loss-rotation](keyring-loss-rotation.md).

## Recovery

- Class 1: fix every listed variable in `.env`, then `docker compose up -d api`.
- Class 3: run the migrate step, then start:

  ```bash
  docker compose run --rm --entrypoint /usr/local/bin/migrate api preflight
  docker compose run --rm --entrypoint /usr/local/bin/migrate api up
  docker compose up -d api worker
  ```

  If the schema is *ahead* of the binary (preflight exit 4), deploy the newer
  release or restore — see
  [rollback-after-bad-release](rollback-after-bad-release.md).
- Classes 2 and 4: recover the dependency first; the API restarts on its own
  (`restart: unless-stopped`).

## Verification

```bash
curl -s http://localhost:8080/health/live    # 200, expected version
curl -s http://localhost:8080/health/ready   # 200
```

## Escalation

If startup fails with a genuine panic or an error naming no variable and no
dependency, capture `docker compose logs api` and file an issue per
[docs/support.md](../support.md).

## Prevention

Run the new binary's configuration validation before a maintenance window
(startup prints all problems at once); always run `migrate preflight` before
starting a new release ([upgrade guide](../guides/upgrade.md)).
