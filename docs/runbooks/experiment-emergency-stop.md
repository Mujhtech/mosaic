# Runbook: Experiment Emergency Stop

## Symptoms

You need a running Experiment out of production **now**: a broken treatment,
a guardrail breach, or a business decision.

## Impact

Stopping is safe and immediate: every affected device deterministically falls
back to the normal Placement behaviour. History, versions, and results are
preserved.

## Recovery (the stop itself)

```text
POST .../environments/{environmentId}/experiments/{experimentId}/emergency-stop
```

With a reason in the body. Drill-verified (D14 remainder) effects:

- Experiment state → `stopped`; a **new Configuration Release is published
  automatically** by the stop.
- Delivery serves a new ETag; the Experiment's assignment entry is **not
  removed** from the payload — it remains with `"lifecycle": "stopped"` and
  `"fallback": "normal_placement"`, so SDKs deterministically fall back
  rather than silently losing the record. Devices pick this up on their next
  configuration fetch (`max-age=60`).

## Verification

All drill-verified:

1. `GET .../experiments/{experimentId}` → `state: "stopped"`.
2. Delivery ETag changed; the assignment carries `lifecycle: stopped`.
3. `GET .../experiments/{experimentId}/history` — the stop is recorded with
   your reason; prior entries preserved.
4. `GET .../experiments/{experimentId}/results` — still served
   (`state: "stopped"`), Variant rows intact.
5. Raw export still works: `POST .../experiments/{experimentId}/exports`.

## Diagnosis (if the stop is refused)

- **404 `experiment_not_found`** — wrong tenant or wrong Environment (the
  drill confirmed foreign tenants receive 404 here).
- **State conflict** — the Experiment is not in a stoppable state; read its
  current state and history.
- **500** — look up the `requestId` in `docker compose logs api`.

## Escalation

If delivery does not reflect the stop after a new fetch (ETag unchanged), or
results are lost after a stop, file immediately per
[docs/support.md](../support.md) — both would be blocker-class.

## Prevention

Keep guardrail metrics and results under review while Experiments run; the
scheduled-stop path also exists (worker `experiment` family) —
[worker-backlog](worker-backlog.md) if scheduled transitions are not
happening.
