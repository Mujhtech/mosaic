# Runbook: Failed Restore

## Symptoms

- `scripts/restore-postgres.sh` aborts (checksum mismatch, restore error) or
  its integrity report disagrees with the source (row counts, digest
  mismatches).
- `scripts/restore-objects.sh -c` reports missing objects and exits non-zero.
- The restored installation cannot serve a Paywall or Asset.

## Impact

If this is a verification restore: no production impact — that is why
restores default to an isolated database. If you are mid-disaster-recovery:
you do not yet have a working installation; do not declare recovery.

## Diagnosis

Work through the script's own checks in order (all drill-verified, D3–D5):

1. **Checksum mismatch** — the artifact is corrupt. Never restore it over
   good data; use the previous backup generation.
2. **Row counts / migration version differ from the source** — wrong
   artifact, or the dump predates data you expected. The `.json` sidecar's
   migration version tells you which release can read it.
3. **`release_representation_digest_mismatches` non-zero** — a stored
   Release's bytes no longer hash to its recorded digest. The restore has
   failed (corrupted immutable Release); use another artifact.
4. **Missing objects** (`restore-objects.sh -c`, named keys, exit 1) — the
   database references Assets the bucket lacks. Restore the object mirror
   (`-m <mirror-dir>`) and re-check; if the mirror lacks them too, the backup
   violated the ordering rule (bucket mirrored *before* the DB snapshot) —
   use an older generation. Orphaned objects, by contrast, are safe and
   expected.
5. **Provider credentials unreadable** —
   `docker compose run --rm --entrypoint /usr/local/bin/keyring api inspect`
   exits non-zero on missing keys:
   [keyring-loss-rotation](keyring-loss-rotation.md).

## Recovery

- Fix the identified layer and re-run; restores into an isolated database
  are repeatable without risk. Restoring over the live database requires
  `--force` **and** stopping the API and worker first
  ([backup-restore guide](../guides/backup-restore.md)).
- If the restored schema is behind the binary you will run:
  `docker compose run --rm --entrypoint /usr/local/bin/migrate api up`
  against it (drill-verified: restore at 18, migrate to 21, serve).

## Verification

The full bar the drill met: counts and migration version match the source;
zero digest mismatches; `restore-objects.sh -c` reports `missing 0`;
readiness 200 against the restored database; the delivery ETag is
**byte-identical** to the source installation's; an Asset resolves through
`GET /v1/sdk/assets/{assetId}/{contentDigest}` with matching digest.

## Escalation

Two independent backup generations failing integrity checks means your
backup pipeline is producing corrupt artifacts — stop relying on it, take a
fresh backup now, and verify it immediately. File per
[docs/support.md](../support.md) if the scripts misreport.

## Prevention

Rehearse restores on a schedule (a backup is only accepted after a
demonstrated restore); keep the snapshot-then-mirror ordering; keep the
keyring backed up separately.
