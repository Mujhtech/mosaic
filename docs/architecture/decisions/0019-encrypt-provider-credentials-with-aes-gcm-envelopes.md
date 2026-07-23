# ADR-0019: Encrypt Provider Credentials with Versioned AES-GCM Envelopes

## Status

Accepted

## Date

2026-07-23

## Context

Phase 4A Provider Connections need recoverable server credentials for outbound provider API calls.
Mosaic's existing API-key and browser-session storage is intentionally digest-only and cannot
support that use case.

Provider credentials must be encrypted at rest without making a cloud KMS or external secret
manager mandatory for self-hosted installations. The design must support key rotation, multiple API
instances, backup and recovery, and a future KMS-backed implementation without exposing secrets to
SDKs, logs, diagnostics, audit events, or exported documents.

The product owner approved the versioned AES-256-GCM envelope option on 2026-07-23.

## Decision

Mosaic encrypts recoverable provider credentials with AES-256-GCM behind a Mosaic-owned
`CredentialCipher` interface.

### Keyring

Operators provide the keyring through:

```text
MOSAIC_PROVIDER_CREDENTIAL_KEYRING
```

The value is a compact JSON object:

```json
{
  "version": 1,
  "activeKeyId": "primary-2026-07",
  "keys": {
    "primary-2026-07": "<base64url-encoded 32-byte key>"
  }
}
```

Rules:

- `version` must equal `1`.
- `activeKeyId` must reference one entry in `keys`.
- key IDs are operator-owned opaque strings between 1 and 64 printable ASCII characters.
- every decoded key is exactly 32 bytes.
- key material uses unpadded base64url encoding.
- duplicate JSON fields, unknown top-level fields, an empty keyring, invalid encodings, and invalid
  key lengths reject configuration.
- production startup fails when provider-credential persistence is enabled and the keyring is
  absent or invalid.
- production code has no generated, hard-coded, plaintext, or digest-only fallback.

The environment variable is the initial self-hosting transport, not the domain abstraction.
Hosted deployments may populate it from an orchestrator secret or replace the cipher adapter with
KMS/Vault under a future ADR.

### Envelope

Each encrypted credential stores:

- envelope version `1`
- algorithm `AES-256-GCM`
- key ID
- random 12-byte nonce
- ciphertext including the 16-byte authentication tag
- credential class
- non-secret fingerprint

Encryption uses a cryptographically secure random nonce for every write. Nonces are never derived
from resource IDs, timestamps, or credential values.

Authenticated additional data is the UTF-8 encoding of these length-prefixed fields:

```text
mosaic-provider-credential-envelope-v1
organization ID
project ID
provider connection ID
credential class
```

Binding the envelope to its tenant, Project, connection, and class prevents a valid ciphertext from
being moved to another scope.

The fingerprint is an HMAC-SHA-256 value computed with a derived, domain-separated fingerprint key
and is used only to recognize credential replacement. It must not permit credential verification
without keyring access and must never be treated as authentication.

### Rotation

To rotate encryption keys:

1. add the new key to `keys`;
2. make it `activeKeyId`;
3. deploy the keyring to every API and worker instance;
4. re-encrypt stored envelopes in bounded batches;
5. verify that no envelope references the old key;
6. remove the old key in a later deployment.

Old keys remain decrypt-only while referenced. Writes always use the active key.

Credential replacement is atomic:

1. validate the new provider credential without persisting it;
2. encrypt it with the active key;
3. replace the old envelope and record audit metadata in one PostgreSQL transaction.

If provider validation fails, the existing credential remains active.

### Failure behavior

- Authentication failure during decryption is a safe internal credential-unavailable error.
- Logs contain only connection ID, key ID, envelope version, and correlation identifiers.
- Raw keys, nonces with ciphertext, plaintext credentials, and decrypted buffers are never logged.
- Losing every key referenced by stored envelopes makes those credentials unrecoverable; affected
  Provider Connections require explicit reconnection.
- Keyring parsing and envelope failures fail closed.

## Consequences

### Benefits

- provider secrets are encrypted at rest;
- self-hosting does not require a cloud vendor;
- ciphertext is bound to tenant and connection scope;
- rotation can occur without rewriting domain identifiers;
- the domain can later use KMS/Vault through the same cipher boundary.

### Trade-offs

- operators must back up key material separately from PostgreSQL;
- every API and worker instance needs the same decrypt key set;
- loss of the keyring requires Provider Connection recovery;
- environment-delivered keyrings are less operationally rich than managed KMS.

## Alternatives Considered

### KMS or Vault envelope encryption

Provides centralized key lifecycle and audit controls but creates a mandatory external operational
dependency for the initial self-hosted product.

### External secret-manager references

Keeps ciphertext outside PostgreSQL but requires a compatible secret lifecycle API in every
deployment.

### Digest-only storage

Rejected because Mosaic must recover the credential to call the provider.

### Plaintext development fallback

Rejected because it can be selected accidentally and weakens the production boundary.

