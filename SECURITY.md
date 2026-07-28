# Security Policy

## Supported versions

Security fixes are applied to the latest minor release of the current major
version only. Older minors do not receive security patches; upgrade to the
latest minor to stay supported. SDKs version independently and follow the
same latest-minor rule.

## Reporting a vulnerability

Report vulnerabilities privately to the maintainers through GitHub security
advisories on this repository ("Report a vulnerability" under the Security
tab). **Do not open public issues or pull requests for vulnerabilities.**

Include the affected component, a reproduction or proof of concept, the
impact you believe it has, and the version or commit you tested.

- **Acknowledgement target**: 5 business days.
- **Coordinated disclosure**: 90 days by default from the report, or earlier
  by mutual agreement once a fix is released. We will credit reporters who
  want credit.

## Scope

In scope: the Mosaic API server, the worker, the dashboard (including
Studio), the Flutter/iOS/Android SDKs, and the protocol tooling under
`protocol/`. Out of scope: vulnerabilities exclusively in third-party
dependencies (report upstream, though we still want to know if Mosaic's usage
is affected), and issues requiring a misconfigured deployment that the
documentation explicitly warns against.

## Operator hardening

Mosaic's security model assumes the operator completes these steps:

- **Restrict signup at the edge.** Self-hosted signup
  (`POST /v1/auth/signup`) is deliberately ungated in the application (owner
  decision D9). Restricting it — at your reverse proxy or firewall — after
  creating your accounts is a documented operator responsibility. Anyone who
  can reach the endpoint can create an account.
- **Require TLS in production.** Terminate TLS at your edge (the Compose
  profile includes a Caddy example under `deploy/local/`); production
  configuration validation rejects plaintext CORS origins, a `DATABASE_URL`
  without a verifying `sslmode`, and plaintext object storage.
- **Configure trusted proxies.** Set `MOSAIC_TRUSTED_PROXY_CIDRS` to exactly
  your proxy addresses. By default no proxy is trusted and
  `X-Forwarded-For`/`X-Real-IP` are ignored, so rate limiting keys on the
  TCP peer; setting the CIDRs too broadly makes client IPs spoofable.
- **Manage secrets via environment variables.** All configuration is
  environment-driven (see `.env.example`); secrets are never generated
  silently or printed. Provider credentials are encrypted at rest with
  AES-256-GCM envelopes under a multi-key keyring
  ([ADR 0019](docs/architecture/decisions/0019-encrypt-provider-credentials-with-aes-gcm-envelopes.md));
  keep `MOSAIC_PROVIDER_CREDENTIAL_KEYRING` in your secret manager and back
  it up separately from the database — losing it makes stored provider
  credentials permanently undecryptable. Rotation is documented in
  [docs/backend/operations/key-rotation.md](docs/backend/operations/key-rotation.md).
- **Mosaic Billing raises what the keyring protects.** With
  `MOSAIC_BILLING_ENABLED` set, the same keyring also seals Apple In-App
  Purchase keys, Google service-account keys, and retained Raw Billing Input
  bodies — which contain Apple signed payloads and full Google purchase tokens
  ([ADR 0023](docs/architecture/decisions/0023-persist-store-transaction-evidence-in-an-append-only-billing-ledger.md)).
  Those bodies expire after `MOSAIC_BILLING_RAW_RETENTION_DAYS` (90 by default);
  normalized Transaction Facts are kept indefinitely and carry no customer
  identity, no price, and no currency. The Apple notification endpoint is
  authenticated by an unguessable per-credential intake token in the URL plus
  JWS verification against a pinned, compiled-in Apple root; treat the endpoint
  URL as a secret and rotate the credential to invalidate it.

Browser sessions use opaque tokens stored as SHA-256 digests
([ADR 0017](docs/architecture/decisions/0017-use-opaque-browser-sessions.md));
API keys are hashed at rest and rotatable.
