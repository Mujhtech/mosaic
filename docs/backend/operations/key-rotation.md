# Credential Keyring and Key Rotation

Mosaic encrypts provider credentials as AES-256-GCM envelopes with scope-bound
AAD under a versioned multi-key keyring (ADR 0019). The keyring lives entirely in
`MOSAIC_PROVIDER_CREDENTIAL_KEYRING`.

**Losing the keyring permanently destroys every stored provider credential.** The
ciphertext survives in PostgreSQL and is unreadable. There is no recovery other
than re-entering each credential by hand. Back the keyring up **separately** from
your database and object-storage artifacts, before you ever rotate it.

## Format

```json
{
  "version": 1,
  "activeKeyId": "key_2026_07",
  "keys": {
    "key_2026_01": "<base64url, unpadded, 32 bytes>",
    "key_2026_07": "<base64url, unpadded, 32 bytes>"
  }
}
```

Rules the loader enforces, so a malformed keyring fails startup rather than
silently degrading:

- `version` must be `1`.
- Every key must decode from unpadded base64url to exactly 32 bytes.
- `activeKeyId` must be present in `keys`.
- Unknown or duplicated fields are rejected.

New envelopes are always sealed under `activeKeyId`. Every key in `keys` can
decrypt. That is what makes rotation non-destructive.

Startup validates the keyring whenever it is set, and readiness reports
`encryption_misconfigured` when provider integrations are enabled with an
unusable keyring. Key material never enters logs, spans, error messages, or
backups.

## Commands

```bash
cd apps/api

# Structural check; prints the active key ID and known key IDs, never key bytes.
go run ./cmd/keyring validate

# Envelope count per key ID, and which keys are active, retired, or MISSING.
go run ./cmd/keyring inspect

# Re-encrypt every envelope under the active key, in transactional batches.
go run ./cmd/keyring rotate --dry-run
go run ./cmd/keyring rotate
```

In a Compose deployment the same binary is in the image:

```bash
docker compose run --rm --entrypoint /usr/local/bin/keyring api inspect
```

## What the keyring seals

`inspect` and `rotate` cover every table that stores an encryption envelope:

| Table | Contents | Added |
| --- | --- | --- |
| `provider_connection_credentials` | Provider Connection server secrets | Phase 4A |
| `store_server_credentials` | Apple In-App Purchase keys and Google service-account keys | Phase 9A |
| `billing_raw_inputs` | Retained Raw Billing Input bodies (signed payloads, purchase tokens) | Phase 9A |

The Phase 9A tables use a separate additional-authenticated-data domain (`v2`)
addressed by a `(subject kind, subject id)` pair, so a Provider Connection
envelope can never be opened as a billing envelope or the reverse, even under
the same key. Rotation rebuilds each envelope's scope from its own row rather
than assuming one.

A test asserts that **any** table carrying both a `key_id` and a `ciphertext`
column appears in the rotation source set. A new envelope table added without
registering it fails the suite rather than being discovered by an operator whose
correct rotation stranded its rows.

**Revoked credentials are excluded** from both `inspect` and `rotate`, by
design: a revoked secret should become unreadable, and resealing it would keep
it alive. The consequence is that `inspect` under-reports — a retired key may
still seal revoked rows it does not count. That is intended, and it means a
retired key can be removed while revoked envelopes still reference it; those
envelopes become permanently undecryptable, which is the desired outcome for a
revoked secret and an unrecoverable one for anything else.

## Rotation Procedure

1. **Back up the current keyring**, and take a PostgreSQL backup
   ([backup-restore.md](backup-restore.md)).

2. **Generate a new key.**

   ```bash
   openssl rand 32 | basenc --base64url | tr -d '='
   # macOS: openssl rand 32 | openssl base64 -A | tr '+/' '-_' | tr -d '='
   ```

3. **Add the new key and make it active, keeping the old key.** This is the whole
   trick: both keys present means old envelopes still decrypt while new writes use
   the new key.

   ```json
   {
     "version": 1,
     "activeKeyId": "key_new",
     "keys": { "key_old": "...", "key_new": "..." }
   }
   ```

4. **Restart the API and worker** with the updated keyring and confirm readiness.

5. **Inspect**, to see how many envelopes still need rotating.

   ```bash
   docker compose run --rm --entrypoint /usr/local/bin/keyring api inspect
   ```

6. **Rotate.** Each batch is one transaction, so an interrupted rotation leaves no
   half-written envelope and can simply be re-run.

   ```bash
   docker compose run --rm --entrypoint /usr/local/bin/keyring api rotate
   ```

7. **Verify** that `inspect` reports every envelope under the active key and zero
   missing keys.

8. **Only then remove the old key** from the keyring, and restart. Removing it
   before step 7 completes makes the credentials it still seals unreadable.

9. Test one provider connection through the dashboard to confirm a credential
   still works end to end.

## Failure Modes

**`keyring inspect` reports `MISSING FROM KEYRING`.** Envelopes are sealed under a
key that is no longer configured. Those credentials cannot be decrypted or
rotated. Restore the missing key from your keyring backup. If it is gone, the
credentials must be re-entered; delete and recreate the affected provider
connections.

**`keyring rotate` fails on one connection.** Rotation stops and names the
connection and the key ID it needs. Nothing in the failing batch was written. Add
the named key back and re-run.

**`keyring validate` fails at startup.** The API refuses to start with an unusable
keyring rather than running with provider integrations silently broken. The error
names the variable and the structural rule violated, never the value.

**Rotation interrupted.** Re-run `rotate`. It is idempotent: it only selects
envelopes not already under the active key.

## Related Rotations

- **Public SDK keys** and **secret API keys** are hashed at rest and are rotated
  by creating a new key and revoking the old one through the dashboard; they are
  not part of the keyring.
- **Session tokens** are opaque and SHA-256 stored (ADR 0017); revoking a session
  is a database operation, not a key rotation.
- **Provider credentials themselves** (a compromised RevenueCat key, for example)
  are replaced by updating the provider connection, which writes a fresh envelope.
  That is credential rotation, not key rotation, and does not require this
  procedure.
