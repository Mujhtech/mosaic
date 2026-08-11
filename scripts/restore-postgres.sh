#!/usr/bin/env bash
# Restore a Mosaic PostgreSQL backup into a target database and verify it.
#
# Restores go into an isolated target database by default so a verification
# restore can never overwrite a live installation. Overwriting the live database
# requires --force and stopping the API and worker first.
#
# Usage:
#   scripts/restore-postgres.sh -f DUMP [-d TARGET_DB] [-s SERVICE] [--force]
#   scripts/restore-postgres.sh -f DUMP -u ADMIN_URL -t TARGET_URL [--force]
#
#   -f       dump produced by scripts/backup-postgres.sh (required)
#   -d       target database name (default mosaic_restore_<timestamp>), Compose mode
#   -s       Compose service to exec into (default postgres)
#   -u       direct-URL mode: an admin URL on the maintenance database that can
#            CREATE DATABASE
#   -t       direct-URL mode: the URL of the target database to restore into;
#            its database name must match -d (required with -u)
#   --force  allow restoring over an existing database
#   -p       Compose project to act on (default: the Compose default project).
#            Required when the host runs more than one Mosaic installation.
#   --compose-file / --env-file  extra Compose file and env-file selection
set -euo pipefail

# shellcheck source=lib/compose.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/compose.sh"

dump_path=""
target_database=""
admin_url=""
target_url=""
service="postgres"
force="false"

arguments=()
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--force" ]]; then force="true"; shift; continue; fi
  mosaic_compose_parse_option "$@"
  if [[ "${mosaic_compose_consumed}" -gt 0 ]]; then shift "${mosaic_compose_consumed}"; continue; fi
  arguments+=("$1"); shift
done
set -- "${arguments[@]+"${arguments[@]}"}"

while getopts ":f:d:u:t:s:h" option; do
  case "${option}" in
    f) dump_path="${OPTARG}" ;;
    d) target_database="${OPTARG}" ;;
    u) admin_url="${OPTARG}" ;;
    t) target_url="${OPTARG}" ;;
    s) service="${OPTARG}" ;;
    h) sed -n '2,27p' "$0"; exit 0 ;;
    *) echo "unknown option: -${OPTARG}" >&2; exit 2 ;;
  esac
done

if [[ -z "${dump_path}" ]]; then
  echo "-f DUMP is required" >&2
  exit 2
fi
if [[ ! -s "${dump_path}" ]]; then
  echo "dump ${dump_path} is missing or empty" >&2
  exit 1
fi
if [[ -z "${target_database}" ]]; then
  target_database="mosaic_restore_$(date -u +%Y%m%d%H%M%S)"
fi
# Direct-URL mode needs both endpoints explicitly: deriving the target URL from
# the admin URL by string surgery is how a verification restore ends up
# overwriting a live database.
if [[ -n "${admin_url}" && -z "${target_url}" ]]; then
  echo "-t TARGET_URL is required with -u ADMIN_URL" >&2
  exit 2
fi
if [[ -n "${target_url}" && -z "${admin_url}" ]]; then
  echo "-u ADMIN_URL is required with -t TARGET_URL" >&2
  exit 2
fi

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

if [[ -z "${admin_url}" ]]; then mosaic_compose_describe; fi

echo "==> verifying artifact integrity"
if [[ -f "${dump_path}.sha256" ]]; then
  expected="$(awk '{print $1}' "${dump_path}.sha256")"
  actual="$(checksum "${dump_path}")"
  if [[ "${expected}" != "${actual}" ]]; then
    echo "checksum mismatch: the backup artifact is corrupt and must not be restored" >&2
    exit 1
  fi
  echo "    checksum matches ${expected}"
else
  echo "    WARNING: no .sha256 sidecar; integrity is unverified" >&2
fi
if [[ -f "${dump_path}.json" ]]; then
  echo "    metadata: $(tr -d '\n' < "${dump_path}.json")"
fi

# administer runs a statement against the maintenance database.
administer() {
  local statement="$1"
  if [[ -n "${admin_url}" ]]; then
    psql "${admin_url}" -v ON_ERROR_STOP=1 -At -c "${statement}"
  else
    mosaic_compose exec -T "${service}" \
      psql -U "${POSTGRES_USER:-mosaic}" -d postgres -v ON_ERROR_STOP=1 -At -c "${statement}"
  fi
}

# inTarget runs a statement against the restored database.
inTarget() {
  local statement="$1"
  if [[ -n "${admin_url}" ]]; then
    psql "${target_url}" -v ON_ERROR_STOP=1 -At -c "${statement}"
  else
    mosaic_compose exec -T "${service}" \
      psql -U "${POSTGRES_USER:-mosaic}" -d "${target_database}" -v ON_ERROR_STOP=1 -At -c "${statement}"
  fi
}

# A failed probe is not a "no". Treating it as one drops and recreates whatever
# the target name refers to, so the status is captured apart from the output.
set +e
exists="$(administer "SELECT 1 FROM pg_database WHERE datname = '${target_database}'")"
exists_status=$?
set -e
if [[ "${exists_status}" -ne 0 ]]; then
  echo "could not determine whether database ${target_database} already exists" >&2
  echo "(the probe failed with status ${exists_status}); nothing was changed." >&2
  echo "Fix the connection to the maintenance database and re-run." >&2
  exit 1
fi
if [[ "${exists}" == "1" && "${force}" != "true" ]]; then
  echo "database ${target_database} already exists; pass --force to overwrite it" >&2
  exit 1
fi
if [[ "${exists}" == "1" ]]; then
  echo "==> dropping existing ${target_database} (--force)"
  administer "DROP DATABASE ${target_database}"
fi

echo "==> creating ${target_database}"
administer "CREATE DATABASE ${target_database}"

echo "==> restoring"
if [[ -n "${admin_url}" ]]; then
  pg_restore --no-owner --no-privileges --exit-on-error \
    --dbname="${target_url}" "${dump_path}"
else
  mosaic_compose exec -T "${service}" \
    pg_restore --no-owner --no-privileges --exit-on-error \
      -U "${POSTGRES_USER:-mosaic}" -d "${target_database}" < "${dump_path}"
fi

echo
echo "==> post-restore integrity checks"
inTarget "SELECT 'migration_version=' || COALESCE(max(version_id), 0) FROM goose_db_version WHERE is_applied"
inTarget "SELECT 'organizations=' || count(*) FROM organizations"
inTarget "SELECT 'projects=' || count(*) FROM projects"
inTarget "SELECT 'products=' || count(*) FROM products"
inTarget "SELECT 'entitlements=' || count(*) FROM entitlements"
inTarget "SELECT 'paywalls=' || count(*) FROM paywalls"
inTarget "SELECT 'paywall_versions=' || count(*) FROM paywall_versions"
inTarget "SELECT 'configuration_releases=' || count(*) FROM configuration_releases"
inTarget "SELECT 'placements=' || count(*) FROM placements"
inTarget "SELECT 'assets=' || count(*) FROM assets"
inTarget "SELECT 'analytics_events=' || count(*) FROM analytics_events"
inTarget "SELECT 'experiments=' || count(*) FROM experiments"
inTarget "SELECT 'experiment_versions=' || count(*) FROM experiment_versions"
inTarget "SELECT 'audit_events=' || count(*) FROM audit_events"

echo
echo "==> Configuration Release digest integrity"
# Releases are digest-addressed and immutable. A representation whose stored
# digest does not match its stored payload means the artifact or the restore is
# corrupt, which is a failed restore.
inTarget "SELECT 'release_representation_digest_mismatches=' || count(*)
  FROM configuration_release_representations
  WHERE content_hash <> encode(sha256(payload_bytes), 'hex')"

echo
echo "==> asset object references (verify against object storage)"
inTarget "SELECT 'asset_objects=' || count(*) FROM assets WHERE archived_at IS NULL"
echo "    Cross-check these against the bucket with: scripts/restore-objects.sh -c"

echo
echo "Restore complete into database: ${target_database}"
echo "Verify migration compatibility for the running binary with:"
echo "  DATABASE_URL='...${target_database}...' go run ./cmd/migrate preflight"
echo
echo "A restore is only accepted after the data-integrity checks above are"
echo "reviewed against the source installation. See"
echo "docs/backend/operations/backup-restore.md."
