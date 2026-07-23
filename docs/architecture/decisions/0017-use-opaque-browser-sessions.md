# ADR-0017: Use Email/Password Authentication with Opaque Browser Sessions

## Status

Accepted

## Date

2026-07-22

## Context

Mosaic Studio needs a real browser identity boundary before hosted authoring and publishing can be deployed. The existing provider-neutral Principal boundary is useful, but an anonymous runtime resolver cannot authorize organization or Project operations. SDK delivery credentials are a separate trust boundary and must not authenticate Studio users.

The private alpha needs a small self-contained authentication path without adding an external identity-provider dependency. It must avoid exposing reusable credentials to JavaScript or persisting raw session secrets.

## Decision

Mosaic will initially support email/password signup and login for Studio users. Passwords are normalized only at the email boundary and hashed with bcrypt cost 12 before PostgreSQL persistence.

Successful signup or login creates a cryptographically random opaque session token. Only its SHA-256 digest is stored in `browser_sessions`; the raw token is sent in the `mosaic_session` cookie. The cookie is:

- `HttpOnly`
- `SameSite=Lax`
- `Secure` outside development and test
- scoped to `/`
- absolute-expiry, seven days by default and configurable

Logout revokes the persisted session and expires the cookie. Sessions do not silently extend during ordinary API requests. The API resolves a valid, unexpired, non-revoked session into the existing provider-neutral Principal; SDK API keys continue through their distinct authentication path.

Credentialed CORS is limited to configured Studio origins. Every unsafe browser-session mutation
under `/v1`, including multipart Asset upload, rejects a supplied untrusted `Origin`; requests
without an `Origin` remain available to non-browser clients. SameSite cookies provide the primary
cross-site request defense, with origin enforcement and exact allowed origins as additional
protection. Login and signup additionally use bounded per-IP and hashed-account token buckets, and
missing-user login performs bcrypt work before returning the same public credential error.
Production configuration fails if secure cookies are disabled.

Errors use stable, non-enumerating public messages. Raw passwords, authorization material, session tokens, and credential-bearing request bodies must not be logged.

## Consequences

### Benefits

- hosted APIs have a durable actor identity after restarts
- raw session secrets are absent from PostgreSQL
- Studio JavaScript cannot read the session cookie
- revocation is immediate and explicit
- the Principal boundary can later accept an external identity-provider adapter without changing domain services

### Trade-offs

- Mosaic temporarily owns password storage and account recovery concerns
- password reset, email verification, MFA, device/session management, and federated login are deferred
- bcrypt work must be capacity-tested before broader availability
- multi-region session storage depends on PostgreSQL availability

## Alternatives Considered

### Anonymous or development-only identity headers

Rejected because they do not provide a production authorization boundary.

### Browser-readable bearer tokens

Rejected because JavaScript-accessible long-lived credentials increase the impact of cross-site scripting and complicate revocation.

### External identity provider for the private alpha

Deferred. The provider-neutral Principal interface keeps this migration reversible when product and operational requirements justify it.
