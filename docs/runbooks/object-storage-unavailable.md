# Runbook: Object Storage Unavailable

## Symptoms

- `/health/ready` 503 with `object_storage_unavailable`.
- Asset uploads fail; SDK Asset fetches fail.
- **Configuration delivery keeps working** — verified in the drill: the
  Release payload lives in PostgreSQL, so `GET /v1/sdk/configuration` served
  200 throughout a MinIO outage.

## Impact

Paywalls render but remote images may be missing (SDKs use cached Assets
where they have them). Publishing paywalls that carry new Assets fails.

## Diagnosis

```bash
docker compose ps minio
docker compose logs --tail 50 minio
curl -s http://localhost:8080/health/ready
docker compose logs api | grep -i objectstore
```

Object-storage operations are bounded by
`MOSAIC_OBJECT_STORAGE_OPERATION_TIMEOUT`; the readiness probe by
`MOSAIC_OBJECT_STORAGE_CHECK_TIMEOUT`.

## Recovery

- MinIO container down: `docker compose up -d minio`. Readiness recovers
  without an API restart (drill-verified).
- Wrong credentials/endpoint after a config change: fix
  `MOSAIC_OBJECT_STORAGE_*` in `.env`, `docker compose up -d api worker`.
- Bucket missing: re-run the one-shot init —
  `docker compose up minio-init` — or create the bucket in your managed store
  (Profile B).
- Objects missing (bucket exists, specific Assets 404/500): that is a restore
  problem — run `scripts/restore-objects.sh -c` to enumerate missing keys,
  then [failed-restore](failed-restore.md).

## Verification

`/health/ready` → 200; fetch a known Asset through the SDK path:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  "http://localhost:8080/v1/sdk/assets/<assetId>/<contentDigest>"   # 200
```

## Escalation

Data loss in the bucket → [failed-restore](failed-restore.md). Note: as
drilled, a missing object answers `500 internal_error` on the SDK asset path;
a distinct 404 is **(fix in progress — verify at Stage 6)**.

## Prevention

Alert on object-storage failure rate above baseline; include
`scripts/backup-objects.sh` in every backup cycle and verify with
`scripts/restore-objects.sh -c`.
