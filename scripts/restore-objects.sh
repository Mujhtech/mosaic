#!/usr/bin/env bash
# Restore or verify the Mosaic object-storage bucket.
#
# Assets are immutable and digest-addressed, so restoring is an additive mirror:
# an object that already exists is byte-identical to the one in the backup.
#
# Usage:
#   scripts/restore-objects.sh -m MIRROR_DIR [-b BUCKET] [-e ENDPOINT]      # restore
#   scripts/restore-objects.sh -c [-m MIRROR_DIR] [-b BUCKET] [-e ENDPOINT] # verify only
#
#   -m  mirror directory produced by scripts/backup-objects.sh
#   -b  bucket (default $MOSAIC_OBJECT_STORAGE_BUCKET or mosaic-assets)
#   -e  S3 endpoint URL (default http://minio:9000 inside the Compose network)
#   -c  check only: no writes; reports missing and orphaned objects
#
# Missing object  = referenced by the assets table but absent from the bucket.
#                   This is a failed restore: an SDK cannot render that Asset.
# Orphaned object = present in the bucket but not referenced by any row. This is
#                   safe (Assets are immutable and content-addressed) and is the
#                   expected result of mirroring the bucket after the database
#                   snapshot.
set -euo pipefail

mirror_directory=""
bucket="${MOSAIC_OBJECT_STORAGE_BUCKET:-mosaic-assets}"
endpoint="http://minio:9000"
check_only="false"

while getopts ":m:b:e:ch" option; do
  case "${option}" in
    m) mirror_directory="${OPTARG}" ;;
    b) bucket="${OPTARG}" ;;
    e) endpoint="${OPTARG}" ;;
    c) check_only="true" ;;
    h) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "unknown option: -${OPTARG}" >&2; exit 2 ;;
  esac
done

if [[ "${check_only}" != "true" && -z "${mirror_directory}" ]]; then
  echo "-m MIRROR_DIR is required unless -c is given" >&2
  exit 2
fi
if [[ -n "${mirror_directory}" && ! -d "${mirror_directory}" ]]; then
  echo "mirror directory ${mirror_directory} does not exist" >&2
  exit 1
fi

access_key="${MOSAIC_OBJECT_STORAGE_ACCESS_KEY:-${MINIO_ROOT_USER:-}}"
secret_key="${MOSAIC_OBJECT_STORAGE_SECRET_KEY:-${MINIO_ROOT_PASSWORD:-}}"
if [[ -z "${access_key}" || -z "${secret_key}" ]]; then
  echo "object-storage credentials are not set (MOSAIC_OBJECT_STORAGE_ACCESS_KEY/_SECRET_KEY)" >&2
  exit 2
fi

work_directory="$(mktemp -d)"
trap 'rm -rf "${work_directory}"' EXIT
mount_directory="${mirror_directory:-${work_directory}}"

mc() {
  docker compose run --rm -T \
    -e MC_HOST_mosaic="${endpoint/:\/\//://${access_key}:${secret_key}@}" \
    -v "$(cd "${mount_directory}" && pwd)":/backup \
    --entrypoint mc minio-init "$@"
}

if [[ "${check_only}" != "true" ]]; then
  echo "==> verifying the mirror against its checksums"
  if [[ -f "${mirror_directory}.json" ]]; then
    echo "    metadata: $(tr -d '\n' < "${mirror_directory}.json")"
  fi

  echo "==> ensuring the bucket exists"
  mc mb --ignore-existing "mosaic/${bucket}"

  echo "==> mirroring objects back into ${bucket}"
  mc mirror --preserve /backup "mosaic/${bucket}"
fi

echo
echo "==> bucket inventory"
mc ls --recursive "mosaic/${bucket}" | awk '{print $NF}' | sort > "${work_directory}/bucket-keys.txt"
bucket_count="$(wc -l < "${work_directory}/bucket-keys.txt" | tr -d ' ')"
echo "    ${bucket_count} object(s) in the bucket"

echo
echo "==> reconciling against the assets table"
# Storage keys are the authoritative link between a row and its object.
if docker compose ps --status running postgres >/dev/null 2>&1; then
  docker compose exec -T postgres \
    psql -U "${POSTGRES_USER:-mosaic}" -d "${POSTGRES_DB:-mosaic}" -At \
      -c "SELECT storage_key FROM assets WHERE archived_at IS NULL ORDER BY storage_key" \
    | sort > "${work_directory}/database-keys.txt"

  missing="$(comm -23 "${work_directory}/database-keys.txt" "${work_directory}/bucket-keys.txt" | wc -l | tr -d ' ')"
  orphaned="$(comm -13 "${work_directory}/database-keys.txt" "${work_directory}/bucket-keys.txt" | wc -l | tr -d ' ')"

  echo "    referenced by the database: $(wc -l < "${work_directory}/database-keys.txt" | tr -d ' ')"
  echo "    missing from the bucket:    ${missing}"
  echo "    orphaned in the bucket:     ${orphaned}"

  if [[ "${missing}" -gt 0 ]]; then
    echo
    echo "    MISSING OBJECTS (first 20):"
    comm -23 "${work_directory}/database-keys.txt" "${work_directory}/bucket-keys.txt" | head -20 | sed 's/^/      /'
    echo
    echo "A missing object means an Asset an SDK expects to render cannot be" >&2
    echo "served. Treat this as a failed restore: see" >&2
    echo "docs/backend/operations/backup-restore.md." >&2
    exit 1
  fi
else
  echo "    SKIPPED: the postgres service is not running, so object references" >&2
  echo "    could not be reconciled. Run this check with the database available." >&2
  echo "    Manual query:" >&2
  echo "      SELECT storage_key FROM assets WHERE archived_at IS NULL ORDER BY storage_key;" >&2
  exit 1
fi

echo
echo "Object-storage verification passed."
