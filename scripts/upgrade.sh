#!/usr/bin/env bash
# Upgrade a single-host Docker Compose Mosaic installation.
#
# Implements the supported happy path from docs/backend/operations/upgrade.md:
#
#   verify current version -> verify backup -> build target -> preflight ->
#   apply migrations -> start -> verify readiness -> smoke checks
#
# It refuses to migrate without a backup, because a failed migration on
# irreversible schema is recovered by restore, not by rollback.
#
# Usage:
#   scripts/upgrade.sh [-b BACKUP_DIR] [--skip-backup]
#
#   -b             backup directory (default ./backups)
#   --skip-backup  proceed without taking a backup (requires MOSAIC_I_HAVE_A_BACKUP=yes)
#   -p             Compose project to upgrade (default: the Compose default
#                  project). Required when the host runs more than one Mosaic
#                  installation; it is also passed to the backup scripts.
#   --compose-file / --env-file  extra Compose file and env-file selection
set -euo pipefail

# shellcheck source=lib/compose.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/compose.sh"

backup_directory="./backups"
skip_backup="false"

arguments=()
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--skip-backup" ]]; then skip_backup="true"; shift; continue; fi
  mosaic_compose_parse_option "$@"
  if [[ "${mosaic_compose_consumed}" -gt 0 ]]; then shift "${mosaic_compose_consumed}"; continue; fi
  arguments+=("$1"); shift
done
set -- "${arguments[@]+"${arguments[@]}"}"

while getopts ":b:h" option; do
  case "${option}" in
    b) backup_directory="${OPTARG}" ;;
    h) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "unknown option: -${OPTARG}" >&2; exit 2 ;;
  esac
done

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repository_root}"

# The backup scripts are separate processes; export the resolved selection so
# they act on the same installation this upgrade is touching.
mosaic_compose_export
mosaic_compose_describe

api_port="${MOSAIC_API_PORT:-8080}"

echo "=== 1. current installed version ==="
if curl -fsS "http://localhost:${api_port}/health/live" 2>/dev/null; then
  echo
else
  echo "    the API is not currently serving; continuing with the upgrade"
fi

echo
echo "=== 2. backup ==="
if [[ "${skip_backup}" == "true" ]]; then
  if [[ "${MOSAIC_I_HAVE_A_BACKUP:-}" != "yes" ]]; then
    echo "--skip-backup requires MOSAIC_I_HAVE_A_BACKUP=yes." >&2
    echo "Irreversible migrations refuse to roll back on affected data; without a" >&2
    echo "backup a failed migration has no recovery path." >&2
    exit 1
  fi
  echo "    skipped at operator request (MOSAIC_I_HAVE_A_BACKUP=yes)"
else
  echo "--> ensuring PostgreSQL is up for the backup"
  mosaic_compose up -d postgres
  mosaic_compose exec -T postgres sh -c 'until pg_isready -q; do sleep 1; done'
  scripts/backup-postgres.sh -o "${backup_directory}"
  echo "--> object storage"
  mosaic_compose up -d minio
  scripts/backup-objects.sh -o "${backup_directory}"
  echo
  echo "    Back up MOSAIC_PROVIDER_CREDENTIAL_KEYRING separately from these"
  echo "    artifacts. Losing it makes provider credentials permanently"
  echo "    undecryptable. See docs/backend/operations/key-rotation.md."
fi

echo
echo "=== 3. build the target release ==="
mosaic_compose build api worker

echo
echo "=== 4. migration preflight ==="
# Exit code 3 means "pending migrations": the expected state for an upgrade.
# Exit code 4 means an incompatible or dirty schema and stops the upgrade.
set +e
mosaic_compose run --rm --entrypoint /usr/local/bin/migrate api preflight
preflight_status=$?
set -e
case "${preflight_status}" in
  0) echo "    schema already matches this release; nothing to migrate" ;;
  3) echo "    pending migrations detected; proceeding" ;;
  4)
    echo "preflight reported an incompatible or dirty schema. Do not migrate." >&2
    echo "See the failed-migration recovery runbook in" >&2
    echo "docs/backend/operations/upgrade.md." >&2
    exit 1
    ;;
  *)
    echo "preflight failed with status ${preflight_status}" >&2
    exit 1
    ;;
esac

echo
echo "=== 5. stop the API and worker before migrating ==="
# Migrating while the previous release is serving lets a binary run against a
# schema it does not understand.
mosaic_compose stop api worker || true

echo
echo "=== 6. apply migrations ==="
mosaic_compose run --rm --entrypoint /usr/local/bin/migrate api up

echo
echo "=== 7. start services ==="
mosaic_compose up -d

echo
echo "=== 8. verify readiness ==="
attempt=0
until curl -fsS "http://localhost:${api_port}/health/ready" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [[ "${attempt}" -ge 60 ]]; then
    echo "the API did not become ready within 60 attempts." >&2
    echo "Diagnose with: curl -sS http://localhost:${api_port}/health/ready | jq" >&2
    echo "and: docker compose logs api (with the same -p/--env-file selection)" >&2
    exit 1
  fi
  sleep 2
done
echo "    ready"

echo
echo "=== 9. smoke checks ==="
echo "--> /health/live"
curl -fsS "http://localhost:${api_port}/health/live"
echo
echo "--> /health/ready"
curl -fsS "http://localhost:${api_port}/health/ready"
echo
echo "--> post-upgrade preflight (expect: compatible)"
mosaic_compose run --rm --entrypoint /usr/local/bin/migrate api preflight

echo
echo "Upgrade complete. Verify the data-integrity checks listed in"
echo "docs/backend/operations/upgrade.md before declaring the upgrade accepted."
