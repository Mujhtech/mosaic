# Customer Access Token Contract changelog

## Version 1 - 2026-07-28

Status: draft

Born `draft` per Phase 9B owner decision OD-15. No compatibility guarantee until
an explicit product-owner decision approves it.

### What version 1 introduces

One canonical schema plus a compatibility manifest, four closed record types, and
the wire form the three SDKs and the backend must agree on exactly.

- **Opaque tokens**: `mcat_` plus 43 base64url characters, 256 bits of
  randomness, stored server-side as a SHA-256 digest with scoping columns for
  Project, Environment, Billing Customer, audience, scopes, and expiry.
- **Contract-owned header names**, finalized here: the customer token travels in
  `Authorization: Bearer` and the public SDK key in `Mosaic-SDK-Key`. Both are
  required; `wireForm.publicSdkKeyAloneSufficient` is `false`.
- **Lifetime bounds**: 1 hour default, 24 hour maximum, 60 second minimum, ±60
  second clock skew, evaluated by the **server**.
- **Immediate revocation** with a closed seven-member reason set, and
  all-or-nothing revocation state enforced in the schema.
- **An over-provisioned audience set.** `sdk_sync` is the only audience issued in
  Phase 9B; `server_check` is declared and reserved so a future server-facing
  audience costs no contract version.
- **SDK obligations** pinned in the manifest: memory-only storage, never parsed,
  never logged, one forced refresh per 401 generation, discard-and-clear on
  logout, generation bump on identity change, and `unavailable` — never
  `inactive` — when the host backend cannot mint a token.

### Owner-approved deviation: opaque, not signed (OD-14)

The orchestration prompt's token requirement list says "signed". These tokens are
opaque random bytes. This is recorded as an **explicit deviation**, approved by
the owner on 2026-07-28, rather than a quiet substitution.

The opaque model satisfies every other requirement on that list at least as well
and satisfies "revocable where practical" strictly better: revocation is one
`UPDATE`, effective immediately and everywhere, whereas a signed token is not
revocable without a revocation list — a server-side lookup that reintroduces
exactly the database read a signed token exists to avoid. It also avoids a
signing-key ADR, a JWKS surface, key rotation, and device-side clock validation:
four new failure modes buying nothing Mosaic needs. ADR-0017's posture already
covers digest-stored, never-recoverable secrets.

The deviation is machine-guarded, not merely documented.
`protocol/tools/customer-access-token-validation-v1.mjs` fails the build if the
contract ever declares a signing property (`alg`, `kid`, `jwk`, `jwks`, `jws`,
`signature`, a key identifier) or a property whose name suggests the token
carries access state, and the manifest pins `tokenModel.signed: false` and
`tokenModel.carriesEntitlementState: false`.

### Deliberate restrictions

- **The issuance request cannot name a Project or Environment.** Tenant scope is
  derived from the authenticated `secret_server` key, matching Billing Ingestion.
  A request that could name a tenant would let a careless or compromised caller
  mint a token into one it does not own. A test asserts those properties stay
  absent.
- **No anonymous mode** (OD-4). An installation identifier is client-generated
  and guessable; letting it select a Billing Customer would let anyone read
  someone else's entitlements by replay or guess.
- **`readerPolicy.tokenInQueryString` is `forbidden`.** Query strings end up in
  access logs, proxy logs, and browser history.

### Fixtures

6 canonical fixtures and 9 invalid ones, including
`token-carries-entitlement-claims.json`, `token-shaped-as-signed-payload.json`,
`token-missing-customer-binding.json`, and the semantic
`token-lifetime-exceeds-maximum.json`.
