# Runbook: Provider Connection Failure

## Symptoms

- A provider connection test fails; connection health shows `degraded`.
- Product readiness shows `attentionRequired` with blockers; Product loading
  fails in the app.

## Impact

Commerce configuration sync and Product resolution through that connection
are degraded. Published Paywalls keep serving; purchasing through an
SDK-only (`custom`) provider is host-implemented and unaffected by
server-side connection state.

## Diagnosis

All drill-verified endpoints (D13):

```text
POST /v1/provider-connections/{id}/test          # runs a live test
GET  /v1/provider-connections/{id}/health        # status + lastErrorCode
GET  /v1/provider-connections/{id}/diagnostics   # per-operation diagnostic rows (retryable flag)
GET  /v1/provider-connections/{id}/capabilities  # what this integration mode can do
GET  /v1/products/{id}/provider-readiness        # blockers + recovery actions
```

Outcomes are machine-readable codes, not opaque failures:

- `providerUnavailable` (503, retryable) — the provider cannot be reached.
  For a `custom`/`sdk_only` connection this is **expected**: there is no
  server side to test (`productLoading: conditional`,
  `host.implementationRequired`).
- `providerInvalidResponse` (502) — the provider answered garbage.
- Readiness blockers name their recovery action (drill example:
  `productUnavailable` → `connectProduct`).
- A never-tested replacement connection reports `providerUnavailable` until
  you run `test` — readiness deliberately refuses to call an untested
  connection healthy.

Note: RevenueCat, StoreKit 2, and Google Play Billing are **not
live-verified** in v1 (owner decision D10); server-connected diagnosis
against real provider outages is documented shape, drill-verified only for
the custom provider path.

## Recovery

- Provider outage: wait and re-test; diagnostics mark retryable errors.
- Bad credential: rotate it —
  [compromised-provider-credential](compromised-provider-credential.md) (same
  flow: `POST /v1/provider-connections/{id}/rotate-credential`).
- Replacement connection: run `POST .../test` after creating it, or
  readiness will keep it blocked.
- `503 providerUnavailable` on a connection you can't even read: check you
  are in the right tenant — a cross-tenant test is refused with 403.

## Verification

`GET .../health` returns healthy; `GET /v1/products/{id}/provider-readiness`
shows zero blockers and resolves the intended connection.

## Escalation

Wrong Product resolution (readiness green but the app loads the wrong
Product) is release-blocker class — file per [docs/support.md](../support.md)
with the readiness and mapping payloads.

## Prevention

Test connections after creation and after credential rotation; alert on
provider synchronization outcomes
([observability](../backend/operations/observability.md)).
