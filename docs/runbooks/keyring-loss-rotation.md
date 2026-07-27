# Runbook: Keyring Loss and Rotation

The keyring (`MOSAIC_PROVIDER_CREDENTIAL_KEYRING`) is the versioned multi-key
AES-256-GCM keyring that encrypts provider credentials. Full reference:
[key rotation](../backend/operations/key-rotation.md).

## Symptoms

- Readiness 503 with `encryption_misconfigured` (provider integrations
  enabled with an unusable keyring), or startup refused with a keyring
  validation error naming the structural rule violated (never the value).
- `keyring inspect` reports envelopes `MISSING FROM KEYRING`.

## Impact

**Losing the keyring permanently destroys every stored provider
credential.** The ciphertext survives in PostgreSQL but is unreadable; there
is no recovery other than re-entering each credential. Nothing else in Mosaic
depends on the keyring.

## Diagnosis

All three commands are drill-verified (D9) and never print key material:

```bash
docker compose run --rm --entrypoint /usr/local/bin/keyring api validate   # structure; active + known key ids
docker compose run --rm --entrypoint /usr/local/bin/keyring api inspect    # envelope count per key id; MISSING keys
```

`inspect` exits non-zero if any envelope is sealed under a key absent from
the configured keyring — the early warning for "restored the data, not the
key".

## Recovery

**Malformed keyring (startup/readiness failure):** the error names the rule —
`version` must be 1, keys must be unpadded base64url decoding to exactly 32
bytes, `activeKeyId` must exist in `keys`. Fix the value in your secret
manager and restart API and worker.

**`MISSING FROM KEYRING`:** restore the missing key from your keyring backup
into the `keys` map (it need not be active — every key in `keys` can
decrypt). If the key is truly gone, the credentials it seals are
unrecoverable: delete and recreate the affected provider connections with
fresh credentials
([compromised-provider-credential](compromised-provider-credential.md) has
the re-test flow).

**Planned rotation** (drill-verified end to end):

1. Back up the current keyring and PostgreSQL first.
2. Generate a new 32-byte key, add it to `keys`, make it `activeKeyId`,
   **keep the old key present**.
3. Restart API and worker; confirm readiness.
4. `keyring rotate` (idempotent, transactional batches; an interrupted run is
   simply re-run):

   ```bash
   docker compose run --rm --entrypoint /usr/local/bin/keyring api rotate
   ```

5. `keyring inspect` → every envelope under the active key, zero missing.
6. **Only then** remove the old key and restart.

## Verification

`inspect` shows all envelopes under the active key and `0 envelope(s) not
under the active key`; readiness 200; one provider connection test passes end
to end.

## Escalation

If key material ever appears in a log, trace, error, or backup artifact, that
is secret-exposure blocker class — report per
[SECURITY.md](../../SECURITY.md). (Drill log scans found zero occurrences.)

## Prevention

Back the keyring up separately from database and object-storage artifacts,
**before** every rotation; never remove a key while `inspect` still counts
envelopes under it.
