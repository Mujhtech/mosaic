# Runbook: Migration Failed

## Symptoms

- `migrate up` (or the Compose `migrate` one-shot) exited non-zero.
- `migrate preflight` exit 4 (`incompatible`) or reports a dirty schema.
- Readiness shows `migration_incompatible`, or the API crash-loops with
  `database schema is behind the expected migration version`.

## Impact

The new release cannot serve until the schema matches. Data is intact:
migrations run in transactions (with one exception below) and the API fails
closed rather than serving a mismatched schema.

## Diagnosis

```bash
docker compose run --rm --entrypoint /usr/local/bin/migrate api status      # exactly which migrations applied
docker compose run --rm --entrypoint /usr/local/bin/migrate api preflight   # current vs expected, pending list, dirty flag, verdict
```

A `migrate` that appears hung may be waiting on the session advisory lock
held by another migrate attempt — find and finish (or stop) that one first.

## Recovery

1. **Transactional migration failed** (the normal case): nothing from the
   failed step was applied. Fix the cause named in the error and re-run:

   ```bash
   docker compose run --rm --entrypoint /usr/local/bin/migrate api up
   ```

2. **`00019` failed** — it builds an index `CONCURRENTLY` outside a
   transaction and can leave an invalid index behind. *(From the operations
   reference; this failure path was not exercised in a drill.)*

   ```sql
   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
   DROP INDEX CONCURRENTLY <name>;
   ```

   Then re-run `migrate up` (the migration is `IF NOT EXISTS`, safe to
   repeat).

3. **Schema ahead of the binary** (preflight exit 4 with applied > expected):
   deploy the release that migrated it, or restore —
   [rollback-after-bad-release](rollback-after-bad-release.md).

4. **You are tempted to roll the schema back**: `down-to` requires
   `--confirm`, and irreversible migrations (`00006`, `00010`, `00018`)
   refuse on affected data, naming exactly what would be destroyed
   (drill-verified). That refusal is final — restore from backup instead:
   [failed-restore](failed-restore.md) /
   [backup-restore guide](../guides/backup-restore.md).

5. **Schema genuinely inconsistent**: stop API and worker, restore the
   pre-upgrade backup over the live database, `migrate up`, restart —
   the exact sequence drill-verified in D3.

## Verification

```bash
docker compose run --rm --entrypoint /usr/local/bin/migrate api preflight   # exit 0, verdict compatible
curl -s http://localhost:8080/health/ready                                  # 200
```

Then the upgrade smoke checks ([upgrade guide](../guides/upgrade.md)):
delivery ETag unchanged, row counts intact.

## Escalation

A migration failing for a cause you cannot fix (constraint violation on your
data, for example) — capture `migrate status`, `preflight`, and the exact
error, and file per [docs/support.md](../support.md). Do not hand-edit the
schema.

## Prevention

Always: backup before migrating (`scripts/upgrade.sh` enforces this),
preflight before applying, stop the old API/worker before `migrate up`.
