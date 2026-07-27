# Upgrade

The supported upgrade path for the single-host Docker Compose profile. The
previous supported release for upgrade testing is `v1.0.0-rc.1`.

Two rules shape everything below:

1. **Mosaic never migrates during normal startup.** Schema changes happen only
   through the `migrate` command or the Compose `migrate` step.
2. **Down migrations are not a rollback strategy.** Irreversible migrations
   refuse to run when affected data exists. Rolling back a release means
   restoring a backup.

## Supported Workflow

```bash
scripts/upgrade.sh
```

The script implements the workflow below and refuses to migrate without a backup.
Run the steps by hand when you need to stage them differently.

### 1. Verify the current version

```bash
curl -s http://localhost:8080/health/live
```

Returns `version`, `commit`, and `built` for the artifact currently serving.
Record it: this is the release you would restore to.

### 2. Verify a backup

```bash
scripts/backup-postgres.sh -o ./backups
scripts/backup-objects.sh  -o ./backups
```

Plus the credential keyring, stored separately. See
[backup-restore.md](backup-restore.md). A backup you have not restored from is
not yet a backup.

### 3. Install the target release

```bash
docker compose build api worker
```

For a tagged release, stamp the version so `/health/live` and telemetry report
it:

```bash
MOSAIC_VERSION=v1.0.0 MOSAIC_COMMIT="$(git rev-parse HEAD)" \
MOSAIC_BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  docker compose build api worker
```

### 4. Preflight

```bash
docker compose run --rm --entrypoint /usr/local/bin/migrate api preflight
```

Reports the current version, the version this binary expects, the pending list,
whether the schema is dirty, and a verdict. Exit codes:

| Code | Verdict | Action |
| --- | --- | --- |
| 0 | compatible | Nothing to migrate |
| 3 | upgrade required | Proceed to step 6 |
| 4 | incompatible | **Stop.** See recovery below |
| 1 | the command failed | Fix connectivity or configuration and retry |

Exit code 4 means either an interrupted previous run (a pending migration below
the current version) or a database ahead of this binary.

### 5. Stop the API and worker

```bash
docker compose stop api worker
```

Migrating while the previous release is still serving lets a binary run against a
schema it does not understand.

### 6. Apply migrations

```bash
docker compose run --rm --entrypoint /usr/local/bin/migrate api up
```

The migration command takes a session advisory lock, so a second concurrent
attempt waits instead of interleaving. The per-step timeout is generous and
configurable (`--timeout`, or `MOSAIC_MIGRATION_TIMEOUT`, default 30 minutes) and
applies per migration rather than to the whole run.

`migrate up-to <version>` applies a prefix of the pending list when you want to
stage a long migration.

### 7. Start

```bash
docker compose up -d
```

Startup verifies configuration, PostgreSQL connectivity, migration compatibility,
and object storage before listening. It fails closed rather than serving against
an incompatible schema.

### 8. Verify readiness

```bash
curl -s http://localhost:8080/health/ready
curl -s http://localhost:8081/health/ready   # worker
```

### 9. Smoke checks

- `GET /health/live` reports the new version.
- `migrate preflight` reports `compatible`.
- Fetch a Configuration Release through the SDK delivery endpoint and confirm the
  digest is unchanged from before the upgrade — Releases are immutable and an
  upgrade must not alter one.
- Publish nothing yet; confirm the existing Release still serves first.
- Confirm the worker drains: `mosaic.worker.queue.oldest_age_seconds` should not
  climb ([observability.md](observability.md)).
- Row counts for Products, Entitlements, Paywalls, Releases, Placements, and
  Experiments match the pre-upgrade counts.

## Version Compatibility

Each binary embeds the migrations it understands and the highest one is its
expected version. The applied version must equal it.

| Situation | Detected by | Meaning |
| --- | --- | --- |
| applied < expected | `migration_incompatible` in readiness; preflight exit 3 | Migrations are pending; run step 6 |
| applied > expected | preflight exit 4 | The database was migrated by a newer release; deploy that release or restore |
| applied == expected | readiness 200; preflight exit 0 | Compatible |

Mosaic supports one version of the server and dashboard as a single SemVer unit.
SDKs version independently and negotiate delivery down to v2 or v1; an SDK
carrying an unsupported contract fails safely and retains its last-known-valid
configuration.

## Recovery: Failed Start

The API failed to start after an upgrade.

1. `docker compose logs api`. Configuration errors are printed as a structured
   multi-problem list naming each variable; values are never printed.
2. `verify migration compatibility` in the error means the schema does not match.
   Run `migrate preflight` and follow the table above.
3. `initialize object storage` means the bucket is unreachable or absent. Check
   the `minio` service and `MOSAIC_OBJECT_STORAGE_*`.
4. `configure provider credential encryption` means the keyring is malformed. See
   [key-rotation.md](key-rotation.md).
5. If the new release cannot start and the schema was already migrated, **do not
   roll the schema back**. Redeploy the new release with corrected configuration,
   or restore the backup taken in step 2 and redeploy the previous release.

The previous release cannot serve a migrated schema. Starting it will fail
readiness with `migration_incompatible` — by design, rather than corrupting data.

## Recovery: Failed Migration

A migration failed part-way.

1. `migrate status` shows exactly which migrations applied.
2. `migrate preflight` reports whether the schema is dirty.
3. Each migration runs in a transaction unless it declares
   `-- +goose NO TRANSACTION`, so a failed migration usually leaves nothing
   applied. Fix the cause and re-run `migrate up`.
4. `00019` is `NO TRANSACTION` (it builds an index `CONCURRENTLY`). A failed
   concurrent index build can leave an invalid index behind:

   ```sql
   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
   DROP INDEX CONCURRENTLY <name>;
   ```

   Then re-run `migrate up`. The migration is `IF NOT EXISTS`, so it is safe to
   repeat.
5. If the schema is genuinely inconsistent, restore the backup. This is why step 2
   is not optional.

## Rollback versus Restore

| You want to | Do this |
| --- | --- |
| Undo a code change, schema unchanged | Redeploy the previous image. No migration. |
| Undo a schema change on an **empty or unaffected** database | `migrate down --confirm` or `migrate down-to <version> --confirm` |
| Undo a schema change on a database with affected data | **Restore from backup.** The down migration will refuse. |

`down`, `down-to`, and `redo` all require `--confirm`, so a rollback is never a
typo.

Migrations `00006`, `00010`, and `00018` are irreversible on real data and refuse
rather than destroying it:

| Migration | Refuses when | What a rollback would have destroyed |
| --- | --- | --- |
| `00006` | non-placeholder provider Product mappings exist | Real commerce configuration |
| `00010` | Delivery v2 Configuration Releases exist | Would rewrite immutable Releases to claim contract v1 |
| `00018` | Delivery v3 Releases, Analytics Event v2 rows, or Release-to-Experiment links exist | Experiment attribution and analysis state |

Each refusal names the affected row counts and points here. Immutability triggers
are never disabled to force a rollback through.

## Configuration Changes

New variables in a release are documented in `.env.example` and default to
existing behaviour. Production guards may reject configuration a previous release
tolerated — wildcard or plaintext CORS origins, a `DATABASE_URL` without a
verifying `sslmode`, plaintext object storage. Each has a documented escape hatch
(`MOSAIC_DATABASE_ALLOW_INSECURE`, `MOSAIC_OBJECT_STORAGE_ALLOW_INSECURE`) for a
trusted private network. Run the new binary's configuration validation before the
maintenance window: startup prints every problem at once so there is no
fix-one-restart-repeat loop.
