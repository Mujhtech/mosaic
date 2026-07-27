# Backup and Restore

**A database-only backup is not a Mosaic backup.** A complete backup is three
independent things:

1. **PostgreSQL** — every Organization, Project, Product, Entitlement, Paywall,
   Configuration Release, Placement, Experiment, analytics row, and audit event.
2. **Object storage** — the immutable, digest-addressed Asset bytes referenced by
   the database.
3. **The credential keyring** (`MOSAIC_PROVIDER_CREDENTIAL_KEYRING`) — stored
   **separately** from the other two.

Restoring 1 and 2 without 3 gives you an installation whose provider credentials
are permanently undecryptable. Restoring 1 without 2 gives you Paywalls that
reference Assets no SDK can fetch.

**A backup procedure is only accepted after a demonstrated restore.** An untested
backup is an assumption, not a recovery plan.

## Ordering

Take the PostgreSQL snapshot **first**, then mirror the bucket.

Assets are immutable and content-addressed: an object is written before the row
that references it, and an object is never rewritten. So a bucket mirrored *after*
the database snapshot may contain objects the snapshot does not reference — a
harmless superset. The reverse ordering can produce a database referencing objects
the mirror does not contain, which is a failed restore.

The keyring changes only when an operator rotates it, so it can be backed up
independently and on its own schedule. Back it up **before** rotating.

## Taking a Backup

```bash
# 1. PostgreSQL (pg_dump custom format + .sha256 + .json metadata)
scripts/backup-postgres.sh -o ./backups

# 2. Object storage (mc mirror + inventory + .json metadata)
scripts/backup-objects.sh -o ./backups

# 3. The keyring, to separate storage. Never into ./backups.
#    Record only the value; it is a secret and must not be written next to the
#    data it protects.
```

Direct-URL mode, for managed PostgreSQL (deployment Profile B):

```bash
scripts/backup-postgres.sh -o ./backups -u "postgres://user:pass@db.example:5432/mosaic?sslmode=verify-full"
```

### What the artifacts contain

Each artifact is accompanied by:

- `*.sha256` — the checksum verified before any restore. A mismatch stops the
  restore; a corrupt artifact must never be restored over good data.
- `*.json` — timestamp, Mosaic version, migration version, PostgreSQL version,
  object count, byte length. **No credentials.** The migration version is what
  tells you which release can read the artifact.

### Retention and encryption

Mosaic does not manage retention or at-rest encryption of backup artifacts. The
artifacts are plaintext dumps of your customers' configuration and analytics
data: store them encrypted, restrict access to the same set of people who can
reach production, and set a retention policy your compliance posture requires.

For point-in-time recovery beyond these snapshots, run PostgreSQL WAL archiving
(`archive_mode`/`archive_command`, or your managed provider's PITR feature).
Mosaic neither configures nor requires it; the snapshot scripts are compatible
with it.

## Restoring

Restores default to a **new, isolated database** so a verification restore can
never overwrite a live installation.

```bash
# Compose mode: restore into an isolated database and run integrity checks.
scripts/restore-postgres.sh -f ./backups/mosaic-postgres-<timestamp>.dump \
                            -d mosaic_restore_check

# Object storage.
scripts/restore-objects.sh -m ./backups/mosaic-objects-<timestamp>

# Verify object references without writing anything.
scripts/restore-objects.sh -c
```

Direct-URL mode requires both endpoints explicitly, because deriving a target URL
from an admin URL by string manipulation is how a verification restore ends up
overwriting production:

```bash
scripts/restore-postgres.sh -f DUMP \
  -u "postgres://admin:pass@db.example:5432/postgres?sslmode=verify-full" \
  -t "postgres://admin:pass@db.example:5432/mosaic_restore_check?sslmode=verify-full" \
  -d mosaic_restore_check
```

Restoring **over** a live database requires `--force` and requires stopping the
API and worker first:

```bash
docker compose stop api worker
scripts/restore-postgres.sh -f DUMP -d mosaic --force
docker compose up -d api worker
```

## Data-Integrity Verification

`restore-postgres.sh` reports these automatically; compare each against the
source installation:

- migration version
- row counts: Organizations, Projects, Products, Entitlements, Paywalls, Paywall
  versions, Configuration Releases, Placements, Assets, analytics events,
  Experiments, Experiment versions, audit events
- **Configuration Release digest integrity** — every stored representation's
  `content_hash` must equal `sha256(payload_bytes)`. A single mismatch means the
  artifact or the restore is corrupt and the restore has failed: a Release whose
  digest does not match its bytes is a corrupted immutable Release.

`restore-objects.sh` reports:

- **Missing objects** — referenced by a non-archived `assets` row but absent from
  the bucket. This is a **failed restore**; the script exits non-zero. An SDK
  cannot render an Asset whose bytes are gone.
- **Orphaned objects** — present in the bucket with no referencing row. Safe and
  expected, because the bucket was mirrored after the database snapshot.

The final check is behavioural, not a row count: resolve an Asset digest through
the SDK delivery path (`GET /v1/sdk/assets/{assetId}/{contentDigest}`) and render
a Paywall from the restored Release. A restore that passes every count but cannot
serve a Paywall has not been demonstrated.

## After Restoring

```bash
# Confirm the restored schema matches the binary you intend to run.
DATABASE_URL="...mosaic_restore_check..." go run ./cmd/migrate preflight

# Confirm every provider credential is readable with the keyring you restored.
MOSAIC_PROVIDER_CREDENTIAL_KEYRING="..." go run ./cmd/keyring inspect
```

`keyring inspect` reports envelope counts per key ID and exits non-zero if any
key that seals an envelope is missing from the configured keyring — that is the
early warning for "we restored the data but not the key".

See [key-rotation.md](key-rotation.md) for keyring handling and
[upgrade.md](upgrade.md) for how restore relates to rollback.
