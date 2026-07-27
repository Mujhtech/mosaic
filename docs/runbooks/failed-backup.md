# Runbook: Failed Backup

## Symptoms

- `scripts/backup-postgres.sh` or `scripts/backup-objects.sh` exited
  non-zero, or produced artifacts that fail their checksum.
- A scheduled backup produced nothing, or the metadata sidecar looks wrong
  (zero counts, unexpected migration version).

## Impact

No immediate service impact — but **you are running without a recovery
point**. Treat a failed backup with the urgency of the incident it would have
covered: irreversible migrations and rollbacks depend on it.

## Diagnosis

- Both scripts print the Compose installation they act on before doing
  anything. **Verify it is the right one** — on a multi-installation host a
  bare invocation acts on the default project; use `-p <project>` (and
  `--compose-file`/`--env-file`) for anything else.
- `backup-postgres.sh` failures: PostgreSQL not running (the script execs
  into the `postgres` service), or in direct-URL mode (`-u`) an unreachable/
  unauthorized URL.
- `backup-objects.sh` failures: object-storage credentials not set
  (`MOSAIC_OBJECT_STORAGE_ACCESS_KEY/_SECRET_KEY` or
  `MINIO_ROOT_USER/PASSWORD` in the environment), MinIO down, or wrong
  bucket (`-b`).
- Disk space in the output directory.

Sanity-check a "successful" artifact via its sidecars: the `.json` records
migration version, PostgreSQL version, and object/byte counts; the `.sha256`
must match:

```bash
shasum -a 256 -c ./backups/mosaic-postgres-<timestamp>.dump.sha256
```

The drill additionally verified artifacts contain **no credentials** (zero
occurrences of the configured passwords).

## Recovery

Fix the cause and re-run the script — backups are read-only against the
installation and always safe to repeat. Keep the ordering: PostgreSQL first,
then objects. Do not proceed with an upgrade or migration until a backup
succeeds (`scripts/upgrade.sh` refuses without one; overriding requires
`MOSAIC_I_HAVE_A_BACKUP=yes`, which means exactly what it says).

## Verification

A backup is only proven by a restore: run a verification restore into an
isolated database and a `restore-objects.sh -c` check —
[backup and restore guide](../guides/backup-restore.md). The drill's
acceptance bar is a demonstrated restore, not a green backup script.

## Escalation

An artifact whose checksum verifies but whose restore fails integrity checks
→ [failed-restore](failed-restore.md); if the script itself misbehaves,
capture its full output and file per [docs/support.md](../support.md).

## Prevention

Schedule backups; alert on the job's exit code; periodically rehearse the
restore; back the keyring up separately
([keyring-loss-rotation](keyring-loss-rotation.md)).
