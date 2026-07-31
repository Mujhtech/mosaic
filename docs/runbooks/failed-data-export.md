# Runbook: Failed Data Export

## Symptoms

An export request — environment analytics (`POST .../analytics/exports`),
raw Experiment (`POST .../experiments/{experimentId}/exports`), or privacy
export (`POST .../analytics/privacy/exports`) — was accepted (202) but never
completes, or completes with an error.

## Impact

The requester lacks their data (for privacy exports this may carry a
regulatory clock). Nothing else is affected; exports are read-only jobs.

## Diagnosis

Exports run as worker jobs (family `analytics`, queue `export`) and write an
NDJSON artifact to object storage (drill-observed artifact shape:
`analytics-exports/<projectId>/<exportId>.ndjson`).

```bash
docker compose logs --tail 200 worker | grep '"job_kind":"export"'
```

- No export job lines → worker problem: [worker-backlog](worker-backlog.md).
- `"failed":true` → the logged error names the cause; object storage down is
  the common one ([object-storage-unavailable](object-storage-unavailable.md)).
- Job completed but the download fails → object storage again, or the
  artifact was removed by your own bucket lifecycle rules.
- **403 on the request itself** → the requester is not in the resource's
  tenant. Exports are tenant-scoped server-side (drill-verified: foreign
  tenants receive 403); this is a correct refusal, not a failure.

## Recovery

Recover the dependency, then request the export again — export jobs are safe
to re-request; each request is its own job and artifact. Interrupted jobs
retry on their own (drill-verified lease reclaim; four export jobs completed
through a worker kill window).

## Verification

The export reaches `completed` with a non-zero row count and byte size
(drill example: 45 rows / 45,425 bytes), and the artifact downloads.

## Escalation

An export completing with fewer rows than the preview/row count implies, or
crossing tenant boundaries in its content, is a release-blocker class issue —
file immediately per [docs/support.md](../support.md) /
[SECURITY.md](../../SECURITY.md).

## Prevention

Alert on export job outcomes and dead-letters; keep object storage in the
backup cycle so artifacts survive incidents.
