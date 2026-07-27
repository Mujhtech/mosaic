# Runbook: Configuration Delivery Failure

## Symptoms

SDKs cannot fetch `GET /v1/sdk/configuration`: 401, 406, 429, 5xx, or no
connection. End-user paywalls keep rendering from SDK cache or bundled
fallback — that is the designed behaviour, and the one hard v1 reliability
target.

## Impact

Devices stop receiving *new* configuration. Existing users are served stale
(but valid) configuration; `stale-if-error=86400` also lets intermediaries
serve stale for 24h.

## Diagnosis

Reproduce the SDK's request (drill-verified shape):

```bash
curl -si http://localhost:8080/v1/sdk/configuration \
  -H "Authorization: Bearer <public SDK key>" \
  -H "Mosaic-SDK-Platform: ios" -H "Mosaic-SDK-Version: <version>" \
  -H "Mosaic-Configuration-Versions: 3,2,1" \
  -H "Mosaic-Paywall-Protocol-Versions: 0.2"
```

- **401 `unauthenticated`** — revoked/rotated key, or a key for a different
  Environment → [compromised-public-sdk-key](compromised-public-sdk-key.md)
  has the rotation flow; issue the current secret to the app.
- **406 `unsupported_capability`** — `details` names the failed requirement
  and reason. Common: misspelled Experiment feature names, or missing
  `Mosaic-Decision-Features` entries required by the Release. A v1-only SDK
  against an Environment with a published Experiment currently receives 406
 .
- **429** — rate limit; see the
  [troubleshooting guide](../guides/troubleshooting.md#429-too-many-requests)
  (check `MOSAIC_TRUSTED_PROXY_CIDRS` behind a proxy).
- **503 / connection refused** — instance down or not ready →
  [readiness-failing](readiness-failing.md).
- **304 is not a failure** — it is the conditional-request success path.

Watch `mosaic.delivery.responses` and the 304 ratio: a collapsing 304 ratio
means ETags changed unexpectedly or SDKs stopped revalidating — delivery cost
multiplies with no Release change.

## Recovery

Fix the diagnosed cause. Delivery needs PostgreSQL only — an object-storage
outage does **not** stop it (drill-verified). After an API outage, no cache
invalidation is needed: the drill confirmed a conditional GET with the
pre-outage ETag returns 304 with a byte-identical validator after restart.

## Verification

200 with the expected `ETag` (equal to the current Release's `contentHash`
from `GET .../releases`); a repeat with `If-None-Match` returns 304.

## Escalation

A digest mismatch between the delivery ETag and the Release `contentHash` is
a corrupted-Release blocker — stop and file per
[docs/support.md](../support.md) immediately with both values.

## Prevention

Alert on readiness and on the 304 ratio; keep SDK keys per Environment and
rotate deliberately (rotation kills the old secret immediately).
