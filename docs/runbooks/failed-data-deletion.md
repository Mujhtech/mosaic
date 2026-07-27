# Runbook: Failed Data Deletion

## Symptoms

A privacy deletion (`POST .../analytics/privacy/deletions`) is refused, or
accepted (202) but never completes.

## Impact

A privacy obligation is pending — treat with the urgency your regulatory
clock requires. Refusals below are safety interlocks, not defects.

## Diagnosis

The deletion flow is preview → confirm-by-digest → job (all drill-verified):

1. `POST .../analytics/privacy/preview` returns the affected event/session
   counts, the affected Environment ids, and a `requestDigest`.
2. `POST .../analytics/privacy/deletions` must confirm **that exact digest**.
   A self-computed or stale digest is refused with **409** — the interlock
   ensuring you delete what you previewed. Re-preview and resubmit.
3. The job runs on the worker (family `analytics`, queue `deletion`), then
   moves through `recomputing` while aggregates are rebuilt without the
   deleted events.

```bash
docker compose logs --tail 200 worker | grep '"job_kind":"deletion"'
```

- **409 on submit** → digest mismatch (step 2 above).
- **403** → requester outside the tenant; correct refusal (drill-verified).
- Job never runs → [worker-backlog](worker-backlog.md).
- Job `"failed":true` → the logged error (with `job_id`, `trace_id`) names
  the cause; PostgreSQL health is the usual dependency.

## Recovery

Fix the dependency and let the job retry; if it dead-lettered, re-run the
preview → deletion flow. The deletion is confirmable end to end: the drill's
deletion processed 4 previewed events, and the affected aggregates recompute
so metrics no longer include them.

## Verification

- The deletion job completes with `affected_event_count` equal to the
  preview's `affectedEvents`.
- A privacy **export** for the same subject returns no rows for the deleted
  events.
- Aggregated metrics reflect the recomputation.

## Escalation

A deletion reporting completion while the subject's events remain
exportable, or affecting another tenant's data, is a release-blocker class
issue — file immediately per [docs/support.md](../support.md) /
[SECURITY.md](../../SECURITY.md).

## Prevention

Always drive deletions through preview-then-confirm; alert on deletion job
failures and dead-letters.
