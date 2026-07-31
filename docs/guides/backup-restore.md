# Backup and Restore

The user-facing path over the operator reference,
[`docs/backend/operations/backup-restore.md`](../backend/operations/backup-restore.md).
Every command below was executed and verified in the GA backup/restore drills
(Drills 2–5, recorded in
[`docs/reviews/phase-8-drill-evidence.md`](../reviews/phase-8-drill-evidence.md)),
except where labelled otherwise.

## What a Mosaic backup is

**A database dump alone is not a Mosaic backup.** A complete backup is three
independent things:

1. **PostgreSQL** — every Organization, Project, Product, Entitlement,
   Paywall, Configuration Release, Placement, Experiment, analytics row, and
   audit event.
2. **Object storage** — the immutable, digest-addressed Asset bytes the
   database references.
3. **The credential keyring** (`MOSAIC_PROVIDER_CREDENTIAL_KEYRING`) — stored
   **separately** from the other two, because it is the secret that decrypts
   provider credentials. Restoring 1+2 without 3 leaves provider credentials
   permanently undecryptable; restoring 1 without 2 leaves Paywalls whose
   Assets no SDK can fetch.

**Ordering matters:** snapshot PostgreSQL first, then mirror the bucket.
Assets are immutable and content-addressed, so a bucket mirrored after the
database snapshot can only be a harmless superset; the reverse ordering can
produce a database referencing objects the mirror lacks — a failed restore.
The keyring changes only when you rotate it; back it up before every rotation.

## Taking a backup

```bash
scripts/backup-postgres.sh -o ./backups
scripts/backup-objects.sh  -o ./backups
# 3. Copy the keyring value into separate secret storage — never into ./backups.
```

Both scripts accept `-p <compose-project>`, `--compose-file`, and
`--env-file` (or the `MOSAIC_COMPOSE_PROJECT` / `MOSAIC_COMPOSE_FILE` /
`MOSAIC_COMPOSE_ENV_FILE` environment equivalents) and **print the
installation they are about to act on**. Use them whenever the host runs more
than one Mosaic stack; the default is Compose's own default project.

For managed PostgreSQL (Profile B), direct-URL mode runs `pg_dump` from the
host *(not drill-validated; the drills used Compose mode)*:

```bash
scripts/backup-postgres.sh -o ./backups \
  -u "postgres://<user>:<password>@db.example:5432/mosaic?sslmode=verify-full"
```

### What you get

- `mosaic-postgres-<timestamp>.dump` — pg_dump custom format.
- `mosaic-objects-<timestamp>/` — a mirror of the bucket; each file is named
  by its content digest, so the file's own sha256 verifies it.
- `*.sha256` — checksums, verified before any restore.
- `*.json` — metadata sidecars: timestamp, Mosaic version, **migration
  version** (which release can read the artifact), PostgreSQL version, object
  count. **No credentials appear in any artifact** — the drill scanned every
  artifact for the configured passwords and found zero occurrences.

### Retention and encryption

Mosaic does not manage retention or at-rest encryption of backup artifacts.
They are plaintext dumps of your customers' configuration and analytics data:
store them encrypted, restrict access to the people who can reach production,
and set the retention your compliance posture requires. For point-in-time
recovery beyond snapshots, run PostgreSQL WAL archiving or your managed
provider's PITR *(not drill-validated; the snapshot scripts are compatible
with it)*.

## Restoring

Restores default to a **new, isolated database**, so a verification restore
can never overwrite a live installation:

```bash
scripts/restore-postgres.sh -f ./backups/mosaic-postgres-<timestamp>.dump \
                            -d mosaic_restore_check
```

The script verifies the checksum first (a mismatch aborts — a corrupt
artifact must never be restored over good data), restores, and then prints
the integrity report below.

Object storage — restoring is an additive mirror, because Assets are
immutable:

```bash
scripts/restore-objects.sh -m ./backups/mosaic-objects-<timestamp>   # restore
scripts/restore-objects.sh -c                                        # verify only, no writes
```

Restoring **over** the live database is a deliberate act: it requires
`--force` and stopping the API and worker first:

```bash
docker compose stop api worker
scripts/restore-postgres.sh -f <dump> -d mosaic --force
docker compose run --rm --entrypoint /usr/local/bin/migrate api up   # if the backup pre-dates the running release
docker compose up -d api worker
```

Direct-URL mode for managed PostgreSQL requires **both** the admin URL and
the target URL explicitly (`-u ADMIN_URL -t TARGET_URL`), so a verification
restore can never be derived onto the production database by string surgery
*(not drill-validated; the drills used Compose mode)*.

## Verifying a restore

**A backup procedure is only accepted after a demonstrated restore.**

`restore-postgres.sh` reports automatically — compare against the source:

- migration version;
- row counts (Organizations, Projects, Products, Entitlements, Paywalls and
  versions, Configuration Releases, Placements, Assets, analytics events,
  Experiments and versions, audit events);
- **Release digest integrity** — every stored representation's hash must
  equal the hash of its bytes; `release_representation_digest_mismatches`
  must be 0. A single mismatch is a failed restore.

`restore-objects.sh -c` reports:

- **Missing objects** — referenced by the database but absent from the
  bucket. This is a **failed restore**; the script names each key and exits
  non-zero (the drill wiped the bucket and confirmed detection).
- **Orphaned objects** — in the bucket with no referencing row. Safe and
  expected, given the snapshot-then-mirror ordering.

Then two checks with the restored keyring:

```bash
docker compose run --rm --entrypoint /usr/local/bin/migrate api preflight   # schema matches the binary
docker compose run --rm --entrypoint /usr/local/bin/keyring api inspect     # every envelope's key is present
```

`keyring inspect` exits non-zero if any envelope is sealed under a key
missing from the keyring — the early warning for "we restored the data but
not the key".

The final check is behavioural: the drill served the restored database with a
second API process, fetched `GET /v1/sdk/configuration`, and confirmed the
delivery `ETag` was **byte-identical** to the live installation's, then
resolved an Asset through `GET /v1/sdk/assets/{assetId}/{contentDigest}`. A
restore that passes every count but cannot serve a Paywall has not been
demonstrated.

## If something fails

- Backup script fails or artifacts look wrong →
  [failed-backup runbook](../runbooks/failed-backup.md).
- Restore fails, digests mismatch, or objects are missing →
  [failed-restore runbook](../runbooks/failed-restore.md).
- Keyring lost or `MISSING FROM KEYRING` reported →
  [keyring-loss-rotation runbook](../runbooks/keyring-loss-rotation.md).
