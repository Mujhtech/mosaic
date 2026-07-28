# Phase 9A: Transaction Ingestion and Validation (Backend)

Mosaic Billing proves a provider transaction is authentic, associates it with the correct
Mosaic Product, and preserves an auditable history — **without deciding customer access.**

Phase 9A performs no access update from any event, validated or not. There is no customer,
entitlement-state, subscription-state, or access-grant table, no application access webhook,
and no financial accounting. A Transaction Fact is a statement that a store confirmed
something happened; it is never a subscription.

Recorded in ADR-0023. The public contract is the Billing Ingestion Contract v1 (ADR-0022).

## Terminology

| Term | Meaning |
| --- | --- |
| Store Notification | Inbound Apple ASSN V2 or Google RTDN message. Never "webhook". |
| Store Server Credential | Encrypted Apple In-App Purchase key or Google service-account key. |
| Transaction Observation | Untrusted client or trusted app-backend report. A trigger, never proof. |
| Raw Billing Input | Immutable record of an original received input. |
| Validation Attempt | One append-only record of one validation try. |
| Transaction Fact | Provider-independent normalized fact produced by successful validation. |
| Resolution Snapshot | The exact mapping version used, so replay is reproducible. |
| Quarantine Record | Input that cannot safely proceed. |
| Store Environment | Sandbox/production from verified provider metadata. **Distinct from Mosaic Environment.** |

Mosaic Environment and Store Environment are always two separate values on every record, every
API field, and every dashboard control.

## Enabling billing

Billing is off by default at two independent levels, and both must be on:

1. **Deployment**: `MOSAIC_BILLING_ENABLED=true` plus `MOSAIC_BILLING_NOTIFICATION_BASE_URL`.
   Without these the routes are not registered and the worker families are not started.
2. **Project**: `PUT /v1/projects/{projectId}/billing/settings` with `billingEnabled: true`.
   Observations from a Project with billing off are permanently rejected so SDK queues drain
   rather than retrying forever.

`MOSAIC_PROVIDER_CREDENTIAL_KEYRING` is required when billing is enabled: every Store Server
Credential and every retained Raw Billing Input body is sealed under it.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `MOSAIC_BILLING_ENABLED` | `false` | Registers billing routes and worker families. |
| `MOSAIC_BILLING_NOTIFICATION_BASE_URL` | — | Public origin Apple posts notifications to. Required when enabled. |
| `MOSAIC_BILLING_RAW_RETENTION_DAYS` | `90` | Encrypted raw-body retention, bounded 30–400. |
| `MOSAIC_BILLING_WORKER_POLL_INTERVAL` | `1s` | Dedicated, so notification latency is not coupled to analytics load. |
| `MOSAIC_BILLING_OBSERVATIONS_PER_MINUTE` | `600` | Observation limiter. Notification intake is deliberately unlimited. |
| `MOSAIC_APPLE_STOREKIT_BASE_URL` | `https://api.storekit.apple.com` | Production App Store Server API. |
| `MOSAIC_APPLE_STOREKIT_SANDBOX_BASE_URL` | `https://api.storekit-sandbox.apple.com` | Sandbox host. Apple decides the environment purely by which host is called. |
| `MOSAIC_GOOGLE_PLAY_BASE_URL` | `https://androidpublisher.googleapis.com` | Play Developer API. |
| `MOSAIC_GOOGLE_PUBSUB_BASE_URL` | `https://pubsub.googleapis.com` | RTDN pull. |

Retention is deployment-level rather than per-Project. Ninety days is the midpoint of Apple's
180-day production and 30-day sandbox notification-history windows. Normalized facts are kept
indefinitely; only the sensitive payload behind them expires, so replay after expiry runs from
facts and is labelled as such.

## Pipeline

```
intake  →  Raw Billing Input  →  validation queue
                                       ↓
                          Validation Attempt (append-only)
                                       ↓
                          provider API (the authority)
                                       ↓
                     normalize → resolve Product → Transaction Fact
                                       ↓
                          Billing Ledger + quarantine on failure
```

**Intake never validates inline.** No outbound provider call happens on a request path.

### Apple notifications

`POST /v1/billing/apple/notifications/{intakeToken}` — public, two-factor:

1. An unguessable per-credential intake token in the path, stored SHA-256 only. Presented once
   at credential create and once at rotate; no read ever returns it.
2. JWS x5c-chain verification against the Apple Root CA compiled into the binary. ES256 is
   pinned before any key material is examined; the system trust store is never consulted;
   certificate validity is checked at the payload's own `signedDate` so a genuine historical
   notification still verifies.

Tenant identity comes from the intake token, never from payload content. The verified `bid` is
then matched against the resolved Application, and a mismatch quarantines.

**This endpoint has no rate limiter and returns 202 for almost everything.** Apple retries a
failed V2 notification only five times (1/12/24/48/72 h) and never in sandbox, so a 429 or a
4xx spends a non-renewable delivery attempt and can lose a transaction permanently. An unknown
bundle, a bad signature, or an unsupported type is recorded and answered 202. Only a durable-
storage failure answers non-2xx. An unknown or revoked intake token answers 404 and stores
nothing: there is no tenant to attribute the body to, and persisting unattributable bodies
would be an unbounded write on an unauthenticated endpoint.

### Google notifications

Consumed by the worker as a **Pub/Sub pull** subscription using the credential's own service
account. There is no public Google endpoint. The order is pull → persist → acknowledge: a
crash between persist and acknowledge causes redelivery, which the idempotency key absorbs,
while acknowledging first could lose a notification.

The verified `packageName` must be inside the credential's Application scope; a mismatch
quarantines rather than being attributed to the tenant that happens to own the subscription.

### Observations

- `POST /v1/sdk/billing/observations` — untrusted, public SDK key. **May return 429**; SDKs
  hold a durable queue and retry. References are bounded by `safeProviderCode`, which
  structurally excludes a JWS or a raw purchase token. A purchase token sent to this endpoint
  is discarded before the service is called.
- `POST /v1/billing/server/observations` — trusted app-backend, secret server key. May carry a
  full Google purchase token, encrypted on receipt. Still subject to complete provider
  validation: a trusted caller is more accountable, not more authoritative.

Outcomes are `accepted_for_validation`, `duplicate`, `permanently_rejected`, and
`retryable_failure`. **There is no outcome meaning "validated"** — the store has not been
consulted when the response is written.

### Idempotency

| Source | Key material |
| --- | --- |
| Apple notification | `notificationUUID` |
| Apple transaction | Store Environment + transaction id |
| Google RTDN | subscription + `messageId` + content digest |
| Google purchase | package + token digest |
| Observation | Environment + deterministic `submissionId` |
| Transaction Fact | `UNIQUE (environment_id, fact_digest)` |

All keys are domain-separated SHA-256. None is derived from a timestamp, Product, amount, or
customer identifier. On a key collision the stored content digest is compared in constant
time: equal is a duplicate, different is a security-severity quarantine and never overwrites
the original.

## Product resolution

`Provider + Application + Environment + provider Product identifier + mapping history →
Mosaic Product`, evaluated at the transaction's own `occurred_at`.

Order: active mapping → the mapping live at `occurred_at` → the linear `replaces_mapping_id`
chain. Outcomes: `resolved`, `unknown`, `ambiguous`, `cross_environment_mismatch`,
`unsupported_product_type`; the last four quarantine.

Nothing resolves by display name, price, billing period, or approximate match. An unresolved
Product still produces a fact with `resolution_state = 'unresolved'`, because the ledger must
be complete: the store confirmed a real purchase of something Mosaic does not recognise, and
that is evidence rather than noise. The operator repairs the mapping and retries.

## Retry and dead-lettering

Retryable: provider timeout, 429, 5xx, transient network failure, Apple's documented
retryable error codes. Exponential backoff from 15 s, capped at 10 minutes, with ±25 % jitter,
max 8 attempts.

Permanent: invalid signature, malformed reference, Application mismatch, environment mismatch,
unsupported type, rejected credentials. These go straight to quarantine.

Every retry is a new Validation Attempt; earlier attempts are never overwritten.

**Apple's `Retry-After` on 429 is an absolute UNIX timestamp in milliseconds**, not RFC 7231
delta-seconds. `appstoreserver.ParseRetryAfter` and `googleplay.ParseRetryAfter` are separate
functions for that reason and must never be interchanged. Reading an absolute value as a delta
schedules the retry tens of thousands of years out and presents as a permanently stalled queue
with no error anywhere.

A provider instruction may push a retry later but never pull it earlier.

## Operator-visible limitations

- **Mosaic does not acknowledge Google purchases.** Acknowledgement is an assertion that goods
  were delivered — an entitlement act, excluded from this phase. It stays with the application
  and its Play Billing adapter. **An unacknowledged purchase is auto-refunded by Google after
  three days (five minutes for license testers).** If your app relies on Mosaic to
  acknowledge, it will lose purchases.
- **No access decision is made from any event.** Facts are never labelled active
  subscriptions, and reconciliation validates provider facts rather than calculating customer
  access.
- **Consumables and non-renewing subscriptions are unsupported** and quarantine as
  `unsupported_transaction_type` rather than being coerced into a type Phase 9A can model.
- **Raw bodies expire after 90 days by default.** After that, an input cannot be re-validated
  and replay runs from normalized facts.
- **Live store verification is not exercised in CI.** Apple sandbox and Google Play test
  purchases require real store accounts; automated coverage uses synthetic signed vectors.

## Observability

Spans: `billing.intake.apple`, `billing.intake.google`, `billing.intake.observation`,
`billing.validate.app_store`, `billing.validate.google_play`, `billing.reconcile.run`,
`billing.replay.run`, `billing.provider.apple.*`, `billing.provider.google.*`.

Metrics: `mosaic.billing.intake.accepted` / `.rejected`, `mosaic.billing.signature.failures`,
`mosaic.billing.validation.outcomes`, `mosaic.billing.validation.latency`,
`mosaic.billing.facts.appended` / `.deduplicated`, `mosaic.billing.provider.requests`,
`mosaic.billing.quarantine.depth` (by reason), and `mosaic.worker.queue.{depth,
oldest_age_seconds,dead_lettered}` with `family="billing"` for the validation, reconciliation,
and replay queues.

Alerts worth defining:

1. Validation queue oldest age > 15 minutes.
2. Any billing dead-letter occurrence.
3. `signature.failures` sustained above zero — forged or misdirected notifications.
4. `quarantine.depth{reason_code="product_unknown"}` above threshold — the operator has store
   Products Mosaic does not know about.
5. Provider 429 rate above 1 % over 15 minutes — quota headroom exhausted.
6. Credential health `degraded` or `unavailable` — links to `docs/runbooks/keyring-loss-rotation.md`
   when the cause is envelope decryption.

## Logging and redaction

Logged: project, environment, application, credential, raw-input, correlation, and error-code
identifiers.

**Never logged, never returned, never placed in a span attribute or audit metadata:** purchase
tokens, signed payloads, `appAccountToken`, `Authorization` headers, provider response bodies,
or decrypted credential material.

The billing transport layer never populates `response.APIError.Cause`. `response.Error` logs
the cause behind every 5xx, and on this surface a cause can quote a fragment of a signed
payload or a token; the unmapped branch logs the error's type only, following the redaction
precedent in `internal/platform/authn/principal.go`. The `billing_ledger_entries.detail`
column carries a `CHECK` banning the key names that carry bearer values, so a future caller
cannot smuggle one in by adding a field.

## Key rotation

`keyring inspect` and `keyring rotate` cover `store_server_credentials` and the encrypted
bodies in `billing_raw_inputs` in addition to Provider Connection credentials. A key that
still seals billing rows cannot safely be dropped from the keyring.

The raw-input append-only trigger permits an `UPDATE` only when nothing but the envelope
columns changed, so rotation can reseal a body without being able to alter what it says.

## Privacy boundary

Billing records are **exempt from Phase 6 analytics deletion**. Phase 9A facts carry no
customer identity — `appAccountToken` and `obfuscatedExternalAccountId` are deliberately never
decoded or persisted — so a subject-deletion request has nothing to reach. The boundary is
recorded here and in the data inventory.
