# ADR-0024: Sign Application Webhooks with HMAC-SHA256 and Constrain Destinations

## Status

Accepted

## Date

2026-07-28

## Context

Phase 9B makes Mosaic authoritative over customer access. An application backend that needs to
react when access changes has two options: poll the Access Decision API, or receive a webhook.
The orchestration prompt assumed a "webhook-signing system" already existed; the Phase 9B Stage 1
inspection established that no webhook or signing infrastructure exists anywhere in the
repository, so the mechanism has to be chosen rather than reused.

Owner decision OD-1(b) scopes 9B to a minimal slice: one event type
(`customer.entitlements.changed`), at-least-once delivery, attempt history, API-managed
destinations, no dashboard UI. The roadmap is amended to record the split with the remainder in
9C.

A webhook receiver has to answer one question before it acts: did Mosaic send this? Without a
verifiable answer, an entitlement-change webhook is an unauthenticated instruction to grant
someone access — a receiver that trusts it grants access to whoever can reach the URL. Mosaic
also accepts an operator-supplied URL and makes outbound requests to it, which is a
server-side request forgery primitive unless it is bounded.

## Decision

### 1. Signature: HMAC-SHA256 over a versioned, timestamped, event-bound string

Every delivery carries:

```text
Mosaic-Signature: t=<unix seconds>, v1=<hex(hmac_sha256(secret, "v1." + t + "." + eventId + "." + body))>
```

The signed payload begins with the literal `v1`, matching the header element name and the
reference vectors in `packages/test-fixtures/src/webhook-signature-vectors.json`. This ADR was
drafted with a bare `1` before the Billing State Webhook Contract was frozen; the contract and
its vectors are the authority, and the literal above is corrected to agree with them.

The signed string binds four things deliberately:

- the **scheme version** (`v1`), so a future scheme change is a new `v` element rather than a
  silent reinterpretation of the same bytes;
- the **timestamp**, so a receiver can reject replays outside its tolerance window;
- the **event ID**, so a captured signature cannot be re-attached to a different event body;
- the **exact body bytes**, so nothing in the payload can be altered in flight.

HMAC-SHA256 rather than an asymmetric signature: the receiver is the tenant that owns the
secret, there is no third party who must verify without being able to sign, and a shared secret
keeps verification to a few lines in any language. Asymmetric signing would add key
distribution and rotation surface that buys nothing here.

Receivers must compare in constant time and must reject a delivery whose timestamp is outside
their tolerance. Both are documented in the consumer guidance.

### 2. Multiple active secrets during rotation

A destination may hold more than one active signing secret. Delivery signs with every active
secret and sends the resulting `v1` elements together, so a receiver that has adopted the new
secret and one that has not both verify during the overlap. Retirement is explicit and audited;
a retired secret stops signing immediately.

Without an overlap window, rotating a secret means a rotation that is simultaneous on both
sides or a period of rejected deliveries — neither of which an operator can actually achieve.

### 3. Secrets are sealed under a new v2 AAD SubjectKind

Webhook signing secrets are sealed with the existing AES-GCM envelope from ADR-0019 under a new
`SubjectKind` of `webhook_signing_secret`, with the destination ID as the subject ID. The
additional authenticated data therefore binds each ciphertext to the exact destination row it
belongs to, so a sealed secret moved to another destination — by a bug or by a database
compromise that can write but not decrypt — fails to open rather than signing for the wrong
tenant.

This is a v2 AAD addition, not a change to any existing subject kind; credentials sealed under
9A's subject kinds are unaffected.

### 4. SSRF policy for destinations

A destination URL is operator-supplied and Mosaic makes outbound requests to it. The policy:

- **HTTPS only.** Plaintext delivery of entitlement state is not offered at any tier.
- **Denied address space**, evaluated against the *resolved* address: RFC1918 private ranges,
  loopback, link-local (including the cloud metadata address), CGNAT (100.64.0.0/10), IPv6
  unique-local, IPv4-mapped IPv6, and the unspecified address.
- **Resolve and pin per attempt.** The hostname is resolved, the resolved address is checked,
  and the connection is made to that address. Checking the hostname and then letting the HTTP
  client resolve again is the classic DNS-rebinding hole: the second resolution can return an
  address the first check would have refused.
- **No redirects.** A redirect is a second destination the operator never approved.
- **Bounded time and size**: a connect and total timeout, and a response-body read ceiling. A
  webhook receiver's response body is never used for anything, so the ceiling can be small.
- **Self-hosted exception behind an environment flag.** Operators running Mosaic and their
  application backend on one private network legitimately need a private destination. The
  exception is an explicit deployment-level flag, never a per-destination toggle an operator
  could set from the API — a per-destination override would let anyone with destination-write
  permission reach the internal network.

### 5. Delivery never rolls back committed state

An access-change webhook is created inside the projection transaction, so an event exists only
for state that was committed. Delivery happens outside it. A destination that is down, slow, or
returning errors produces retries and eventually an exhausted delivery record; it never rolls
back an entitlement change, and it never blocks a projection.

Retries reuse the same event ID. A retry is a new delivery attempt, never a new logical event,
so a receiver deduplicating on event ID sees each change once.

## Consequences

- Receivers need a shared secret and constant-time HMAC verification; the delivery contract
  documents the exact signed string and a reference vector set lives in `packages/test-fixtures`.
- Rotation is operationally safe but requires an explicit retire step, which is audited.
- The SSRF policy will refuse some destinations operators expect to work (localhost during
  development). The self-hosted flag is the supported answer; a per-destination bypass is not.
- Consumers are documented as tolerant (ignore unknown fields and unknown event types, re-read
  the snapshot) while the producer stays strict — a deliberate, recorded departure from the
  repository-wide fail-closed posture (OD-16), because a webhook consumer that rejects an
  unrecognized field breaks on every additive change Mosaic makes.
- The delivery worker, destination management API, and signing implementation land after the
  9B schema; this ADR is the contract they implement.

## Alternatives Considered

**Asymmetric signatures (Ed25519 / JWS).** Rejected: no verifier exists who cannot also be
trusted with a shared secret, and it adds public-key distribution and rotation surface for no
gain in this trust model.

**No signing; TLS plus a secret path segment.** Rejected: a secret in a URL leaks through
proxy logs, browser history, and error reports, and it cannot be rotated without changing the
destination.

**Polling only, deferring webhooks entirely to 9C (OD-1(a)).** Rejected by the owner in favour
of the minimal slice, because polling the Access Decision API for change detection is the
pattern the authoritative-entitlement design exists to remove.
