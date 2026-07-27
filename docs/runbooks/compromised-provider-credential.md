# Runbook: Compromised Provider Credential

## Symptoms

A commerce provider credential stored in Mosaic (for example a RevenueCat
secret key) leaked at the provider side, in your secret handling, or must be
rotated on policy.

## Impact

The credential authorizes Mosaic's server-side calls to the provider. The
exposure is at the **provider**, so revocation must happen there; Mosaic's
job is to store the replacement.

## Recovery

This is **credential rotation, not keyring rotation** — replacing the
credential writes a fresh encrypted envelope under the active keyring key; no
keyring procedure is involved.

1. **Issue a new credential and revoke the old one at the provider** (their
   console/API — outside Mosaic).
2. **Store the replacement in Mosaic** (drill-verified endpoint, D9/D10):

   ```text
   POST /v1/provider-connections/{connectionId}/rotate-credential
   ```

   Note: a `custom` / `sdk_only` connection stores **no** server-side
   credential; rotating one is correctly refused with
   `422 providerIntegrationUnsupported` (drill-verified). There is nothing to
   rotate for that mode.
3. **Re-test the connection**:

   ```text
   POST /v1/provider-connections/{connectionId}/test
   GET  /v1/provider-connections/{connectionId}/health
   ```

## Verification

- Connection health returns healthy with the new credential.
- The rotation is visible in the Organization audit events.
- `GET /v1/products/{id}/provider-readiness` shows no new blockers.

*(Live verification against a real RevenueCat/Apple/Google endpoint is not
part of v1 evidence — commerce providers are not live-verified, owner
decision D10. The storage, rotation refusal, and diagnostics paths above are
drill-verified.)*

## Diagnosis (scope of exposure)

Credentials are stored only as AES-256-GCM envelopes; Mosaic never returns,
logs, or exports the plaintext (drill log scans found zero occurrences). A
Mosaic database leak therefore does **not** disclose provider credentials
without the keyring. Assess exposure at wherever the plaintext lived.

## Escalation

If you believe the plaintext leaked *from* Mosaic (a response, log, trace, or
export), that is secret-exposure blocker class — report per
[SECURITY.md](../../SECURITY.md) with the exact surface.

## Prevention

Keep `MOSAIC_PROVIDER_CREDENTIAL_KEYRING` in a secret manager, backed up
separately ([keyring-loss-rotation](keyring-loss-rotation.md)); rotate
provider credentials on your provider's policy schedule.
