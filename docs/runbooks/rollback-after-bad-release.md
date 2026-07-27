# Runbook: Rollback After a Bad Release

## Symptoms

A newly deployed release misbehaves: failed start, wrong behaviour, or an
upgrade you need to unwind.

## Impact

Depends on the defect. Decide fast whether the *schema* changed — that is the
whole fork in the road.

## Diagnosis

```bash
curl -s http://localhost:8080/health/live                                   # which version is serving
docker compose run --rm --entrypoint /usr/local/bin/migrate api status      # did the upgrade migrate?
```

Compare the applied migration version with your pre-upgrade backup's metadata
sidecar (`mosaic-postgres-<timestamp>.dump.json` records it).

## Recovery

| Situation | Action |
| --- | --- |
| Bad code, schema unchanged | Check out the previous tag, rebuild, restart. No migration. |
| Schema migrated, **no affected data** | `docker compose run --rm --entrypoint /usr/local/bin/migrate api down-to <previous-version> --confirm`, then deploy the previous release |
| Schema migrated, affected data exists | **Restore.** The down migration refuses (drill-verified: the refusal names the exact rows at stake). Steps below. |

Restore path (drill-verified in D3):

```bash
docker compose stop api worker
scripts/restore-postgres.sh -f ./backups/mosaic-postgres-<timestamp>.dump -d mosaic --force
# check out / rebuild the previous release, then:
docker compose run --rm --entrypoint /usr/local/bin/migrate api preflight   # compatible for that binary
docker compose up -d
```

Anything written between the backup and the restore is lost — that is the
cost of a rollback, and why the decision belongs to a human. Never disable
immutability triggers or edit `goose_db_version` to force a rollback through.

The **previous** binary cannot serve a migrated schema: it fails
compatibility verification rather than corrupting data. Starting the old
image without restoring will simply crash-loop.

## Verification

`/health/live` reports the intended version; `migrate preflight` exit 0;
delivery ETag matches the restored dataset; spot-check dashboard reads.

## Escalation

If the bad release also wrote bad *data* (not just schema), stop and assess
before restoring — a restore discards everything since the backup. File per
[docs/support.md](../support.md) with the version pair and logs.

## Prevention

Take the backup in [upgrade guide](../guides/upgrade.md) step 2 every time —
`scripts/upgrade.sh` refuses to migrate without one. Verify a restore
periodically so the artifact is proven.
