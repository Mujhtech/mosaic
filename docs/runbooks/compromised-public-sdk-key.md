# Runbook: Compromised Public SDK Key

## Symptoms

A public SDK key secret leaked (committed to a public repo, extracted from an
app build, posted in logs) or shows anomalous use (delivery/ingestion traffic
you cannot attribute).

## Impact

A public SDK key can fetch the Environment's delivered configuration and
submit analytics events. It cannot read the dashboard API, other
Environments, or any credential. Risks: configuration disclosure and
analytics pollution.

## Recovery

Rotation, drill-verified (D9) — the key **id stays stable; only the secret
changes**, and the old secret dies at the moment of rotation:

```text
POST /v1/api-keys/{apiKeyId}/rotate
```

The response returns the new secret **once**. Deliver it to your app builds
(remote config / next release). Devices still holding the old secret get
401 and serve cached configuration until updated.

If the key should not exist at all:

```text
POST /v1/api-keys/{apiKeyId}/revoke
```

If you cannot tolerate the client-update window, create a new key first
(`POST /v1/environments/{environmentId}/api-keys`, kind `public_sdk`), ship
it, then revoke the compromised one.

## Verification

Drill-verified: a request with the **old** secret → `401 unauthenticated`; a
request with the **new** secret → 200:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/v1/sdk/configuration \
  -H "Authorization: Bearer <old secret>" ...   # 401
```

Rotation and revocation are audited (`api_key.rotated`, `api_key.revoked` in
the Organization audit events) — confirm via
`GET /v1/organizations/{organizationId}/audit-events`.

## Diagnosis (scope of exposure)

Review delivery and ingestion rate metrics for the window the key was
exposed; analytics submitted with the key during that window may be polluted
— consider a privacy deletion for affected ranges
([failed-data-deletion](failed-data-deletion.md) describes the flow).

## Escalation

If the leak came from Mosaic itself (a key printed in a log or response),
that is secret-exposure blocker class — report per
[SECURITY.md](../../SECURITY.md).

## Prevention

Public SDK keys are Environment-scoped — never share one across
Environments; treat secrets as shown-once; keep rotation rehearsed (it is
one call).
