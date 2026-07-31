# ADR-0023: Persist Store Transaction Evidence in an Append-Only Billing Ledger

## Status

Accepted

## Date

2026-07-28

## Context

Phase 4B states outright that "no transaction, receipt, purchase, customer-access, or
Apple/Google credential table is permitted." That was a deliberate product boundary, not an
implementation gap, and it was re-affirmed at the Phase 9 entry gate.

Phase 9A reverses part of it. Mosaic must be able to prove a provider transaction is
authentic, associate it with the correct Mosaic Product, and preserve an auditable history.
None of that is possible without holding server-side store credentials and recording what the
store said. Leaving two accepted documents in direct contradiction is worse than recording the
reversal, so this ADR records it explicitly and bounds it.

The reversal is narrow: **validate and record; grant nothing.** Phase 9A performs no access
update from any event, validated or not.

Three properties of the store APIs shaped the design and are worth stating, because several
decisions below are only defensible in light of them:

- Apple retries a failed App Store Server Notification V2 **five times** (1, 12, 24, 48, and
  72 hours) and **never retries in sandbox**. A non-2xx response therefore consumes a finite,
  non-renewable delivery budget.
- Neither provider's notification is authoritative on its own. Google documents that a
  Real-time Developer Notification only signals that state changed and that the Play Developer
  API must be consulted; Apple documents notification history as the recovery path for gaps.
- Google auto-refunds unacknowledged purchases after three days, and acknowledging is an
  assertion that goods were delivered.

## Decision

### 1. Phase 4B's "no transaction or credential table" rule is superseded for billing only

Phase 9A creates Store Server Credentials, Raw Billing Inputs, Validation Attempts,
Transaction Facts, Product Resolutions, a Billing Event Ledger, quarantine, reconciliation,
and replay tables.

It does **not** create — and this ADR forbids adding without a further gate — any entitlement,
subscription-state, access-grant, customer, RevenueCat-migration, or financial-ledger table.
No price, currency, or subject-identity column exists on any Phase 9A table. Phase 4B's
credential-free native activation is untouched: a Store Server Credential is a separate entity
from a Provider Connection and can never become an active runtime provider.

### 2. Intake never validates inline

The intake contract is: authenticate, persist the Raw Billing Input, enqueue validation,
return 2xx. No outbound provider call happens on the request path.

The Apple notification endpoint is deliberately excluded from every rate-limiter family that
can return 429. Returning 429 to Apple spends one of five non-renewable retries and can lose a
transaction permanently, which is a worse outcome than any load that endpoint can plausibly
produce. It is bounded instead by a hard body-size ceiling, two-factor identity, and anomaly
telemetry. Only a durable-storage failure answers non-2xx.

### 3. Apple intake authenticates on two independent factors

An unguessable per-credential intake token in the URL path (32 random bytes, stored SHA-256
only, matching the API-key posture from ADR-0017) **and** JWS x5c-chain verification against
the Apple Root CA compiled into the binary with `go:embed`.

Tenant identity always comes from the intake token, never from payload content: bundle
identifiers are not globally unique across Mosaic tenants, so trusting the payload for
attribution would let anyone holding a genuine Apple notification steer it into another
tenant's ledger. The verified `bid` is then matched against the resolved Application, and a
mismatch quarantines.

The signing algorithm is pinned to ES256 before any key material is examined, and the system
trust store is never consulted.

### 4. Google RTDN arrives by Pub/Sub pull, not push

The worker consumes the subscription with the connection's service-account credentials. A push
subscription would require a second public unauthenticated endpoint plus Google OIDC
verification, and a misconfigured push subscription produces an unbounded retry loop against
it. Pulling inverts the control.

The order is pull, persist, then acknowledge. A crash between persist and acknowledge causes
redelivery, which the idempotency key absorbs; acknowledging first could lose a notification.

### 5. Tokens and payloads are encrypted at rest under a new AAD domain

Full Google purchase tokens and Apple signed payloads are encrypted under the ADR-0019
keyring, using a **new additional-authenticated-data domain (`v2`)** addressed by a
`(subject kind, subject id)` pair rather than a connection id.

Widening the existing `Scope` was rejected: making `ConnectionID` optional would let an empty
value silently weaken the binding of every existing v1 envelope. Because the domain string is
the first length-prefixed field of the AAD, a v1 envelope can never be opened through the v2
path or vice versa, even under the same key.

A separate SHA-256 digest column exists alongside every encrypted token for idempotency and
notification-to-observation attribution. Raw bodies are encrypted only after the tenant is
resolved; an input that cannot be attributed is recorded by metadata only, with no plaintext
body persisted.

`keyring inspect` and `keyring rotate` were extended to cover both new envelope tables. A key
that still seals rows cannot safely be dropped from the keyring, and rotation that could not
reach these tables would make that failure silent.

### 6. The ledger is append-only, enforced by database triggers

Validation Attempts, Transaction Facts, Product Resolutions, Ledger Entries, quarantine
actions, and credential events all reject `UPDATE` and `DELETE` with ERRCODE `55000`,
following the `analytics_privacy_audit_events` precedent. There is no update endpoint for any
of them anywhere in the API.

Raw Billing Inputs carry two narrow, schema-level exceptions: `DELETE` is permitted because
retention is the only path that removes an expired body, and `UPDATE` is permitted only when
nothing but the encryption envelope changed, so `keyring rotate` can reseal a body without
being able to alter what it says. The one permitted `body_state` transition is
`stored → expired`.

Correction is a new fact, never a mutation of an earlier one.

### 7. Fact identity is a content digest, which makes replay a structural no-op

`UNIQUE (environment_id, fact_digest)`, where the digest covers everything that gives a fact
meaning and deliberately excludes its own identifier, its provenance columns, and
`recorded_at`.

Re-validating the same input against the same mapping history recomputes the same digest and
the unique constraint absorbs the write. A genuinely different outcome produces a different
digest and is appended beside the original rather than replacing it. Replay is therefore safe
by construction rather than by convention.

### 8. Sandbox and production cannot mix, enforced by composite foreign key

Store Server Credentials, Raw Billing Inputs, and Transaction Facts all carry the Mosaic
Environment's mode denormalized alongside the Store Environment, with a composite foreign key
onto `environments(id, project_id, mode)` and a `CHECK` tying the two together. An application
defect produces a constraint violation rather than a sandbox purchase quietly counted as
production revenue.

### 9. Mosaic does not acknowledge Google purchases

Acknowledgement is an entitlement-granting act. Coupling a customer's three-day refund window
to Mosaic's availability is not an acceptable trade for a phase that grants nothing.
Acknowledgement stays with the application and its Play Billing adapter.

This is an operator-visible limitation and is documented as one: an unacknowledged purchase is
auto-refunded after three days.

### 10. Product resolution never guesses

Resolution matches an active mapping, then the mapping that was live at the transaction's own
`occurred_at`, then the linear `replaces_mapping_id` chain. Outcomes are `resolved`,
`unknown`, `ambiguous`, `cross_environment_mismatch`, and `unsupported_product_type`; the last
four quarantine.

Nothing resolves by display name, price, billing period, or approximate match. An unresolved
Product still produces a fact with `resolution_state = 'unresolved'` and no Mosaic Product,
because the ledger must be complete: the store confirmed a real purchase of something Mosaic
does not recognise, and that is evidence, not noise.

### 11. Quarantine has no "mark as valid" path

The only exit that yields a Transaction Fact is a successful revalidation against the store,
and closure always names the attempt that justified it. There is no column, status, endpoint,
or dashboard affordance by which an operator can assert authenticity the store never
confirmed.

## Consequences

- Mosaic now holds live bearer-adjacent values (Google purchase tokens, Apple signed
  payloads). The blast radius is bounded by encryption at rest, a 90-day default retention on
  raw bodies, owner/admin-only read access, and a ledger `detail` column whose `CHECK` bans
  the key names that carry bearer values.
- The keyring becomes load-bearing for a second subsystem. `docs/backend/operations/backup-restore.md`
  already treats it as a first-class backup artifact; losing it now also costs billing replay.
- Raw bodies expire after 90 days by default while normalized facts are kept indefinitely, so
  replay after expiry runs from facts and is labelled as such.
- Billing records are exempt from Phase 6 analytics deletion. Phase 9A facts carry no customer
  identity, so there is nothing for a subject-deletion request to reach.
- Apple's `Retry-After` on 429 is an absolute UNIX timestamp in milliseconds, unlike the RFC
  7231 delta-seconds form every other Mosaic provider client sees. The two parsers are
  separate functions in separate packages and must never be interchanged; reading an absolute
  value as a delta schedules a retry tens of thousands of years out and presents as a
  permanently stalled queue with no error.
- Live Apple sandbox and Google Play test purchases cannot be exercised in CI. Verification
  uses synthetic signed vectors, and live sandbox confirmation is an operator follow-up
  recorded in the Phase 9A review.

## Alternatives Considered

- **Keep Phase 4B's prohibition and validate without persisting.** Rejected: a validation with
  no durable record cannot be audited, reconciled, or replayed, which are the phase's entire
  product promise.
- **Store raw bodies unencrypted with short retention**, as `analytics_events` does for
  client payloads. Rejected: those bodies contain live Google purchase tokens and Apple
  `appAccountToken` values, which are materially more sensitive than analytics payloads.
- **Amend ADR-0019's `Scope` to make `ConnectionID` optional.** Rejected in favour of a
  separate v2 domain, for the reason given in decision 5.
- **Google RTDN by push subscription**, matching the Apple endpoint shape. Rejected per
  decision 4.
- **Acknowledge Google purchases server-side**, which Google's own guidance recommends.
  Rejected per decision 9.
- **Mutable facts with an `is_active` flag and in-place correction.** Rejected: it makes
  replay non-deterministic and is the first step toward a subscription-state table, which this
  phase excludes.
