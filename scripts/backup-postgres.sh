#!/usr/bin/env bash
# Back up the Mosaic PostgreSQL database.
#
# A PostgreSQL dump is NOT a complete Mosaic backup. A complete backup is
# PostgreSQL + object storage + the credential keyring. See
# docs/backend/operations/backup-restore.md.
#
# Usage:
#   scripts/backup-postgres.sh [-o OUTPUT_DIR] [-u DATABASE_URL] [-s SERVICE]
#                              [-p PROJECT] [--compose-file FILES] [--env-file FILES]
#
#   -o  output directory (default ./backups)
#   -u  direct-URL mode: run pg_dump against this URL from the host
#   -s  Compose service to exec into (default postgres); used when -u is absent
#   -p  Compose project to act on (default: the Compose default project).
#       Required when the host runs more than one Mosaic installation.
#
# The artifact is pg_dump custom format, accompanied by a .sha256 checksum and a
# .json metadata sidecar. Credentials are never written into any artifact.
set -euo pipefail

# shellcheck source=lib/compose.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/compose.sh"

output_directory="./backups"
database_url="${DATABASE_URL:-}"
service="postgres"

arguments=()
while [[ $# -gt 0 ]]; do
  mosaic_compose_parse_option "$@"
  if [[ "${mosaic_compose_consumed}" -gt 0 ]]; then shift "${mosaic_compose_consumed}"; continue; fi
  arguments+=("$1"); shift
done
set -- "${arguments[@]+"${arguments[@]}"}"

while getopts ":o:u:s:h" option; do
  case "${option}" in
    o) output_directory="${OPTARG}" ;;
    u) database_url="${OPTARG}" ;;
    s) service="${OPTARG}" ;;
    h) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "unknown option: -${OPTARG}" >&2; exit 2 ;;
  esac
done

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "${output_directory}"
dump_path="${output_directory}/mosaic-postgres-${timestamp}.dump"
metadata_path="${dump_path}.json"
checksum_path="${dump_path}.sha256"

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# query runs read-only SQL and prints a single value.
query() {
  local statement="$1"
  if [[ -n "${database_url}" ]]; then
    psql "${database_url}" -At -c "${statement}"
  else
    mosaic_compose exec -T "${service}" \
      psql -U "${POSTGRES_USER:-mosaic}" -d "${POSTGRES_DB:-mosaic}" -At -c "${statement}"
  fi
}

if [[ -z "${database_url}" ]]; then mosaic_compose_describe; fi

echo "==> capturing schema version"
migration_version="$(query "SELECT COALESCE(max(version_id), 0) FROM goose_db_version WHERE is_applied" || echo "unknown")"
postgres_version="$(query "SHOW server_version" || echo "unknown")"

echo "==> dumping PostgreSQL (custom format)"
if [[ -n "${database_url}" ]]; then
  pg_dump --format=custom --no-owner --no-privileges --file="${dump_path}" "${database_url}"
else
  mosaic_compose exec -T "${service}" \
    pg_dump --format=custom --no-owner --no-privileges \
      -U "${POSTGRES_USER:-mosaic}" -d "${POSTGRES_DB:-mosaic}" > "${dump_path}"
fi

if [[ ! -s "${dump_path}" ]]; then
  echo "backup produced an empty artifact; refusing to record it as a backup" >&2
  rm -f "${dump_path}"
  exit 1
fi

digest="$(checksum "${dump_path}")"
printf '%s  %s\n' "${digest}" "$(basename "${dump_path}")" > "${checksum_path}"

mosaic_version="$(git -C "${repository_root}" describe --tags --always 2>/dev/null || echo "unknown")"

cat > "${metadata_path}" <<JSON
{
  "artifact": "$(basename "${dump_path}")",
  "kind": "postgresql",
  "format": "pg_dump-custom",
  "takenAt": "${timestamp}",
  "sha256": "${digest}",
  "byteLength": $(wc -c < "${dump_path}" | tr -d ' '),
  "migrationVersion": "${migration_version}",
  "postgresVersion": "${postgres_version}",
  "mosaicVersion": "${mosaic_version}",
  "completeBackupRequires": ["postgresql", "object-storage", "credential-keyring"]
}
JSON

echo
echo "PostgreSQL backup written:"
echo "  dump:     ${dump_path}"
echo "  checksum: ${checksum_path}"
echo "  metadata: ${metadata_path}"
echo
echo "This is not yet a complete Mosaic backup. Now run:"
echo "  scripts/backup-objects.sh -o ${output_directory}"
echo "and back up MOSAIC_PROVIDER_CREDENTIAL_KEYRING separately from these artifacts."
echo
echo "A backup procedure is only accepted after a demonstrated restore:"
echo "  scripts/restore-postgres.sh -f ${dump_path} -d mosaic_restore_check"
