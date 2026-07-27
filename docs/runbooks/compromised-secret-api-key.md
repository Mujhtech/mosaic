# Runbook: Compromised Secret API Key

## Symptoms

A secret server key (kind `secret_server`) leaked — committed, pasted, or
found in a third-party breach — or shows API calls you cannot attribute.

## Impact

Higher than a public SDK key: a secret server key authenticates server-side
API access within its scope. Assume everything it could read was read.

## Recovery

Immediately, in this order (both drill-verified in D9):

1. **Revoke** if you can tolerate breaking its consumers, or **rotate** to
   keep the integration alive while killing the leaked secret:

   ```text
   POST /v1/api-keys/{apiKeyId}/rotate    # same key id, new secret, old secret dead
   POST /v1/api-keys/{apiKeyId}/revoke    # key dead entirely
   ```

2. Deliver the new secret to the legitimate consumer through your secret
   manager — it is returned once.

3. Review the audit trail for the exposure window:

   ```text
   GET /v1/organizations/{organizationId}/audit-events
   ```

   Key lifecycle events are audited (`api_key.created`, `api_key.rotated`,
   `api_key.revoked` — drill-verified), alongside the resource actions taken
   in the window.

4. If the key could reach provider connections, consider rotating provider
   credentials too: [compromised-provider-credential](compromised-provider-credential.md).

## Verification

Calls with the old secret fail `401 unauthenticated`; the legitimate consumer
works with the new secret; the rotation appears in the audit events.

## Diagnosis (scope of exposure)

Keys are hashed at rest, so a database leak does not disclose secrets — the
exposure is wherever the plaintext secret traveled. Bound the window from
when the secret was issued or last rotated to the rotation above, and review
audit events and access logs (`request_id`, `remote_ip`) for that window.

## Escalation

Unattributable *write* actions in the audit trail during the window mean the
key was actively abused — treat as an incident, preserve logs, and report per
[SECURITY.md](../../SECURITY.md).

## Prevention

Store secret keys only in a secret manager; one key per consumer so
revocation is surgical; rotate on personnel change; alert on
`mosaic.http.rate_limit.rejections` for the `api` surface.
