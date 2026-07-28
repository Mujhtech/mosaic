# Billing State Webhook Contract v1

Billing State Webhook Contract `1` is how Mosaic tells an application backend
that a customer's committed authoritative state changed. It is a **draft** and
reaches `approved` only through an explicit product-owner decision.

Scope is the **minimal slice** approved as OD-1(b): one emitted event type, HMAC
signing, at-least-once delivery, attempt history, API-only destinations, no
dashboard UI. The roadmap places webhooks in Gate 9C; the split is deliberate and
recorded.

Canonical artifacts:

- `protocol/schema/billing-state-webhook/v1/event.schema.json`
- `protocol/schema/billing-state-webhook/v1/delivery.schema.json`
- `protocol/schema/billing-state-webhook/v1/compatibility-manifest.schema.json`
- `protocol/compatibility/billing-state-webhook/v1.json`
- `protocol/fixtures/billing-state-webhook/v1/`
- `protocol/billing-state-webhook/CHANGELOG.md`

## An event is a notification, not an authority

> **The event says something changed. The snapshot says what it is.**

A consumer reacts to an event by re-reading the Customer Entitlement Snapshot.
It never grants or revokes access from the event body alone. This is pinned as
`consumerTolerance.authoritativeState: "reReadSnapshot"`.

That single decision is what makes everything else safe: delivery can be
duplicated, delayed, or reordered without any of it changing what a customer can
do.

## Envelope and record types

```json
{
  "billingStateWebhookContractVersion": "1",
  "recordType": "billingStateEvent",
  "payload": {}
}
```

| Record type | Meaning |
| --- | --- |
| `billingStateEvent` | The committed change Mosaic transmits |
| `webhookDeliveryAttempt` | One recorded attempt, **never transmitted** |

The delivery-attempt record is dashboard- and API-facing only. It carries no
destination URL and no signing secret — attempt history is read by operators far
more often than by whoever configured the destination — and a test asserts no
property name in it matches `url`, `secret`, `signature`, `endpoint`, or `token`.

## Event types: ten declared, one emitted

The enumeration is closed at ten members, and Phase 9B emits exactly one:

| Event type | 9B |
| --- | --- |
| `customer.entitlements.changed` | **emitted** |
| `subscription.state.changed` | reserved |
| `subscription.period.changed` | reserved |
| `subscription.renewal_intent.changed` | reserved |
| `subscription.expired` | reserved |
| `subscription.revoked` | reserved |
| `subscription.refunded` | reserved |
| `customer.billing_identity.conflict` | reserved |
| `customer.projection.failed` | reserved |
| `customer.projection.recovered` | reserved |

All ten are declared **now** because adding an enumeration member later costs a
contract version, which matches house style everywhere else in Mosaic. The
manifest separates the two facts: `eventTypes` is a promise about the vocabulary,
`emittedEventTypes` is a promise about behaviour, and they are deliberately
different sizes.

No member names a provider. An application backend that had to branch on whether
a change came from Apple or Google would be reading a provider integration, not a
Mosaic contract; a validator guard rejects any event type matching
`apple|google|storekit|play|itunes`.

## Event payload

`eventId`, `eventType`, `projectId`, `environmentId`, `billingCustomerId`,
optional `subscriptionInstanceId`, `snapshotVersion`, optional
`previousSnapshotVersion`, `projectionRuleVersion`, `occurredAt`, `createdAt`,
`changedEntitlements[]`, `stateSummary`, `sourceReason`, optional `isTestSource`,
`correlationId`, optional `diagnostics[]`.

The contract version lives on the envelope only. Duplicating it into the payload
would create two places that can disagree.

`changedEntitlements` entries carry `entitlementKey`, `previousState`, and
`currentState`. `previousState` may be `absent`, which is how a first grant is
reported without pretending the customer was previously `inactive`.

`stateSummary` carries the same four axes as
[Authoritative Entitlement v1](authoritative-entitlement-v1.md) — `accessState`,
`lifecycleState`, `renewalIntent`, `billingState`, `uncertainty` — as a safe
summary for routing and logging. The authoritative answer is still the snapshot.

**An event must report a change.** A no-change projection creates no snapshot and
emits no webhook, so an event whose entitlement states are all unchanged is a
producer defect — unless `sourceReason` is `subscription_period_changed`,
`renewal_intent_changed`, or `grant_version_changed`, which are real changes that
legitimately leave every access state untouched. The semantic validator enforces
exactly that.

### Never in an event

Provider secrets, raw purchase tokens, private keys, and complete raw provider
payloads. `additionalProperties: false` blocks the field; the ported
forbidden-value walk blocks a signed-payload-shaped **value** smuggled into an
allowed field, which is what `invalid/raw-purchase-token-in-event.json` pins.

Only the *values* half of the Billing Ingestion walk is ported. Billing Ingestion
also bans `entitlement`, `subscription`, and `customer` field names; here that
vocabulary is legitimate and banning it would ban the contract.

## Signing

```http
POST /your-endpoint
Mosaic-Signature: t=1785243603, v1=<64 lowercase hex characters>
```

```text
signature = HMAC-SHA256(secret, "v1" + "." + t + "." + eventId + "." + rawBody)
```

- **Raw body, exactly as received.** Parsing and re-serializing changes the
  bytes — whitespace, member order, Unicode escaping — and every genuine delivery
  then fails verification.
- **The event ID is inside the signed payload**, so a captured signature cannot
  be replayed onto a different event body even within the replay window.
- **The timestamp is inside it too**, which is what makes the replay window
  enforceable.
- The secret is used as **UTF-8 bytes verbatim**, not hex- or base64-decoded.
- Output is lowercase hexadecimal. Several HMAC libraries emit uppercase; compare
  case-insensitively or lowercase your own output.

### Verification

1. Reject if `t` is more than **300 seconds** from your own clock, before
   comparing signatures.
2. Compute the expected signature over the raw body.
3. **During rotation the header carries one `v1` parameter per active key.**
   Accept if **any** verifies. A verifier that reads only the first parameter
   drops every delivery signed with the new key.
4. Compare in constant time. A byte-by-byte early-exit comparison leaks the
   expected value over enough requests.
5. Only then parse the body.

Reference vectors:
[`packages/test-fixtures/src/webhook-signature-vectors.json`](../../packages/test-fixtures/src/webhook-signature-vectors.json)
— eight vectors including a tampered body, a changed event ID, a changed
timestamp, a rotation key, a non-ASCII body, and a non-ASCII secret. A test
asserts the canonical vector signs the exact bytes of
`events/entitlement-activated.json`, so the vectors and the fixture cannot drift.

A test endpoint is supported so an integrator can verify a signature before any
real state change depends on it.

## Delivery

At-least-once. **Exactly-once is never promised**
(`producerPolicy.exactlyOnceDelivery: "neverPromised"`).

- `eventId` is stable across every attempt and every manual replay. It is the
  consumer's deduplication key.
- Order by `snapshotVersion`, never by `createdAt` or arrival. A consumer that
  has applied a higher version ignores a lower one.
- Retry with exponential backoff and jitter, bounded timeout, bounded attempts.
- Attempt status is `pending`, `succeeded`, `failed`, `exhausted`, or `skipped`.
  Exhaustion is terminal and means the attempts actually ran out — the semantic
  validator rejects an `exhausted` record whose attempt count has not reached its
  maximum.
- `responseExcerpt` is at most 240 control-character-free characters, kept only
  so an integrator can see why their endpoint refused. It is never parsed.
- **Delivery failure never rolls back customer state**
  (`delivery.failureIsolation: "deliveryNeverRollsBackState"`). Delivery is a
  notification path, not a commit path.

Destinations are HTTPS-only and validated against the SSRF policy: RFC1918,
loopback, link-local, CGNAT, ULA, and IPv4-mapped addresses are denied, DNS is
resolved and pinned per attempt, redirects are not followed, and time and size
are bounded. A self-hosted allowlist flag exists for operators who genuinely need
an internal destination.

## Consumer tolerance: a documented exception to fail-closed reading

**Approved as OD-16.** Everywhere else in Mosaic, a reader that does not fully
understand a document rejects it. Webhook consumers are the documented exception:

| | Producer (Mosaic) | Consumer (your backend) |
| --- | --- | --- |
| Unknown field | `rejectRecord` | **ignore** |
| Unknown event type | `rejectRecord` | **ignore** |
| Unknown enumeration member | `rejectRecord` | **ignore** |
| Authoritative state | — | **re-read the snapshot** |
| Ordering | — | ignore older `snapshotVersion` |
| Duplicates | — | deduplicate by `eventId` |
| Signature | — | **verify before parsing** |

The asymmetry is justified by the top rule of this contract: the event is not
authoritative, the snapshot is. A consumer that rejected an event carrying a
field it had not seen would stop reacting to real state changes in order to
protect itself from information it was free to ignore. Ignoring the unknown and
re-reading the snapshot reaches the same fail-safe outcome by the opposite route.

Signature verification is the one thing a consumer must **not** be tolerant
about, and it happens before the body is parsed at all.

Both columns are machine-checked: `producerPolicy` and `consumerTolerance` are
separate pinned blocks in the manifest, so the exception stays an exception
rather than becoming a habit. See
[compatibility policy](compatibility-policy.md#webhook-consumer-tolerance-is-a-documented-exception).

## Fixtures

`protocol/fixtures/billing-state-webhook/v1/` — 13 canonical fixtures across
`events/` and `deliveries/`, and 8 in `invalid/`.

Behavioural fixtures worth reading:
`events/subscription-cancelled-access-active.json` (cancelled, still active),
`events/expiry-extended.json` (a real change with no state change),
`events/unknown-state-transition.json` (unknown, not deactivated), and
`deliveries/retry-same-event-id.json` (attempt 2 carrying the same `eventId`).

Invalid fixtures: `raw-purchase-token-in-event.json`,
`provider-payload-embedded.json`, `unknown-event-type.json`,
`missing-snapshot-version.json`, `response-excerpt-too-long.json`,
`exhausted-before-attempts-ran-out.json`, `snapshot-version-regresses.json`,
`created-before-it-occurred.json`.

## Related documents

- [Authoritative Entitlement Contract v1](authoritative-entitlement-v1.md)
- [Customer Access Token Contract v1](customer-access-token-v1.md)
- [Compatibility policy](compatibility-policy.md) · [Versioning](versioning.md)
