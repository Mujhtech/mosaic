#!/usr/bin/env bash
# Back up the Mosaic object-storage bucket (immutable, digest-addressed Assets).
#
# Object storage is one third of a complete Mosaic backup. See
# docs/backend/operations/backup-restore.md for the required ordering: snapshot
# PostgreSQL first, then mirror the bucket. Because Assets are immutable and
# digest-addressed, a bucket mirrored after the database snapshot may be a
# superset of what the database references, which is safe; the reverse is not.
#
# Usage:
#   scripts/backup-objects.sh [-o OUTPUT_DIR] [-b BUCKET] [-e ENDPOINT]
#
#   -o  output directory (default ./backups)
#   -b  bucket (default $MOSAIC_OBJECT_STORAGE_BUCKET or mosaic-assets)
#   -e  S3 endpoint URL (default http://minio:9000 inside the Compose network)
#   -p  Compose project to act on (default: the Compose default project).
#       Required when the host runs more than one Mosaic installation.
#   --compose-file / --env-file  extra Compose file and env-file selection
#
# Credentials come from MOSAIC_OBJECT_STORAGE_ACCESS_KEY / _SECRET_KEY (or
# MINIO_ROOT_USER / MINIO_ROOT_PASSWORD) and are never written to any artifact.
set -euo pipefail

# shellcheck source=lib/compose.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/compose.sh"

output_directory="./backups"
bucket="${MOSAIC_OBJECT_STORAGE_BUCKET:-mosaic-assets}"
endpoint="http://minio:9000"

arguments=()
while [[ $# -gt 0 ]]; do
  mosaic_compose_parse_option "$@"
  if [[ "${mosaic_compose_consumed}" -gt 0 ]]; then shift "${mosaic_compose_consumed}"; continue; fi
  arguments+=("$1"); shift
done
set -- "${arguments[@]+"${arguments[@]}"}"

while getopts ":o:b:e:h" option; do
  case "${option}" in
    o) output_directory="${OPTARG}" ;;
    b) bucket="${OPTARG}" ;;
    e) endpoint="${OPTARG}" ;;
    h) sed -n '2,23p' "$0"; exit 0 ;;
    *) echo "unknown option: -${OPTARG}" >&2; exit 2 ;;
  esac
done

access_key="${MOSAIC_OBJECT_STORAGE_ACCESS_KEY:-${MINIO_ROOT_USER:-}}"
secret_key="${MOSAIC_OBJECT_STORAGE_SECRET_KEY:-${MINIO_ROOT_PASSWORD:-}}"
if [[ -z "${access_key}" || -z "${secret_key}" ]]; then
  echo "object-storage credentials are not set (MOSAIC_OBJECT_STORAGE_ACCESS_KEY/_SECRET_KEY)" >&2
  exit 2
fi

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mirror_directory="${output_directory}/mosaic-objects-${timestamp}"
inventory_path="${mirror_directory}.inventory.txt"
metadata_path="${mirror_directory}.json"
mkdir -p "${mirror_directory}"

# mc runs the MinIO client through the Compose `minio-init` service, which
# already uses the pinned mc image and is attached to the Compose network, so
# the object store is reachable by service name and no credentials are baked
# into a bespoke container invocation.
mc() {
  mosaic_compose run --rm -T \
    -e MC_HOST_mosaic="${endpoint/:\/\//://${access_key}:${secret_key}@}" \
    -v "$(cd "${mirror_directory}" && pwd)":/backup \
    --entrypoint mc minio-init "$@"
}

mosaic_compose_describe

echo "==> listing bucket inventory"
mc ls --recursive "mosaic/${bucket}" > "${inventory_path}"
object_count="$(wc -l < "${inventory_path}" | tr -d ' ')"
echo "    ${object_count} object(s)"

echo "==> mirroring bucket"
mc mirror --overwrite --preserve "mosaic/${bucket}" /backup

mirrored_count="$(find "${mirror_directory}" -type f | wc -l | tr -d ' ')"
mirror_bytes="$(find "${mirror_directory}" -type f -exec wc -c {} + 2>/dev/null | tail -1 | awk '{print $1}')"
mosaic_version="$(git -C "${repository_root}" describe --tags --always 2>/dev/null || echo "unknown")"

cat > "${metadata_path}" <<JSON
{
  "artifact": "$(basename "${mirror_directory}")",
  "kind": "object-storage",
  "format": "mc-mirror",
  "takenAt": "${timestamp}",
  "bucket": "${bucket}",
  "objectCount": ${mirrored_count:-0},
  "byteLength": ${mirror_bytes:-0},
  "mosaicVersion": "${mosaic_version}",
  "note": "Assets are immutable and digest-addressed; this mirror may be a superset of the paired PostgreSQL snapshot."
}
JSON

echo
echo "Object-storage backup written:"
echo "  mirror:    ${mirror_directory}"
echo "  inventory: ${inventory_path}"
echo "  metadata:  ${metadata_path}"
echo
echo "Verify and detect missing or orphaned objects with:"
echo "  scripts/restore-objects.sh -c -m ${mirror_directory}"
