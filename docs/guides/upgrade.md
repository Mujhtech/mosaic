# Upgrading Mosaic

How to upgrade a single-host Docker Compose installation. This is the
user-facing path over the operator reference,
[`docs/backend/operations/upgrade.md`](../backend/operations/upgrade.md); the
whole flow below was executed and verified in the GA upgrade drill (Drill 2,
schema 18 → 21, recorded in
[`docs/reviews/phase-8-drill-evidence.md`](../reviews/phase-8-drill-evidence.md)).

Two rules shape everything:

1. **Mosaic never migrates during normal startup.** Schema changes happen only
   through the `migrate` command or the Compose `migrate` one-shot.
2. **Down migrations are not a rollback strategy.** Irreversible migrations
   refuse to run when affected data exists; rolling back a release means
   restoring a backup.

## The short version

```bash
scripts/upgrade.sh
```

The script runs the entire workflow below and **refuses to migrate without a
backup**. If your host runs more than one Mosaic installation (a drill,
restore-check, or staging stack), name the one you mean:

```bash
scripts/upgrade.sh -p <compose-project> [--compose-file FILES] [--env-file FILES]
```

The script prints the installation it is about to act on before touching it,
and passes the same selection to the backup scripts it calls.

## Step by step

### 1. Record the current version

```bash
curl -s http://localhost:8080/health/live
```

Returns `version`, `commit`, and `built`. Write it down — this is the release
you would restore to.

### 2. Back up

```bash
scripts/backup-postgres.sh -o ./backups
scripts/backup-objects.sh  -o ./backups
```

Plus the credential keyring, stored separately — see
[backup and restore](backup-restore.md). A backup you have never restored from
is an assumption, not a recovery plan.

### 3. Fetch and build the target release

```bash
git fetch && git checkout <target-tag>
MOSAIC_VERSION=<target-tag> docker compose build api dashboard
```

### 4. Preflight

```bash
docker compose run --rm --entrypoint /usr/local/bin/migrate api preflight
```

Preflight prints the applied version, the version the new binary expects, the
**pending migration list**, whether the schema is dirty, and a verdict:

| Exit code | Verdict | Action |
| --- | --- | --- |
| 0 | compatible | Nothing to migrate; go to step 6 |
| 3 | upgrade required | Proceed |
| 4 | incompatible | **Stop** — interrupted previous run, or a database migrated by a newer release. See [migration-failed runbook](../runbooks/migration-failed.md) |
| 1 | command failed | Fix connectivity/configuration and retry |

### 5. Stop the old binaries, then migrate

```bash
docker compose stop api worker
docker compose run --rm --entrypoint /usr/local/bin/migrate api up
```

Migrations take a session advisory lock (a second concurrent attempt waits
rather than interleaving) and each step has its own generous timeout
(`MOSAIC_MIGRATION_TIMEOUT`, default 30 minutes, per migration). Use
`migrate up-to <version>` to stage a long pending list in stages.

### 6. Start and verify readiness

```bash
docker compose up -d
curl -s http://localhost:8080/health/ready     # 200 {"status":"ready"}
docker compose exec worker /usr/local/bin/healthcheck http://127.0.0.1:8081/health/ready
```

Startup fails closed against an incompatible schema — if the API crash-loops
here, read [Recovery](#recovery) before doing anything else.

### 7. Smoke checks

The checks the drill actually asserted:

- `GET /health/live` reports the **new** version.
- `migrate preflight` reports `compatible` (exit 0).
- **The delivery digest is unchanged.** Fetch `GET /v1/sdk/configuration`
  with a real SDK key and confirm the `ETag` is byte-identical to before the
  upgrade — Configuration Releases are immutable and an upgrade must never
  alter one.
- Ingestion works: an SDK event batch to `POST /v1/sdk/events/batch` is
  accepted.
- Row counts (Projects, Products, Paywalls, Releases, Placements,
  Experiments) match the pre-upgrade counts.
- The worker drains: `mosaic.worker.queue.oldest_age_seconds` does not climb
  ([observability](../backend/operations/observability.md)).

Publish nothing until the existing Release is confirmed still serving.

## Recovery

**The API will not start after the upgrade** — configuration errors print as
a structured multi-error list naming every offending variable (values never
printed); `verify migration compatibility` in the log means schema mismatch
(run preflight); see the
[api-will-not-start runbook](../runbooks/api-will-not-start.md). Note that an
API started against pending migrations does not serve a 503 — it **fails
startup and crash-loops**, by design, so a load balancer never sees an
instance that cannot serve.

**A migration failed part-way** — `migrate status` shows exactly what
applied; `migrate preflight` reports dirtiness; most migrations run in a
transaction so a failure usually leaves nothing applied. Full procedure:
[migration-failed runbook](../runbooks/migration-failed.md).

**You need the previous release back** — the previous binary cannot serve a
migrated schema (it fails compatibility verification rather than corrupting
data). Rolling back means one of:

| Situation | Do this |
| --- | --- |
| Code change only, schema untouched | Redeploy the previous image; no migration |
| Schema change, **no affected data** | `migrate down-to <version> --confirm` |
| Schema change with affected data | **Restore from the step-2 backup.** The down migration will refuse. |

`down`, `down-to`, and `redo` all require `--confirm`. Migrations `00006`,
`00010`, and `00018` are **irreversible on real data**: they detect affected
rows and refuse, naming exactly what a rollback would have destroyed (the
drill's attempt was refused with the count of Delivery v3 Releases, Analytics
Event v2 rows, and Release-to-Experiment links at stake). That refusal is
final — the recovery is
[restore from backup](../runbooks/rollback-after-bad-release.md), never
disabling the guard.
