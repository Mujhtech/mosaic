# Billing State Webhook Contract changelog

## Version 1 - 2026-07-28

Status: draft

Born `draft` per Phase 9B owner decision OD-15. No compatibility guarantee until
an explicit product-owner decision approves it.

Scope is the **minimal slice** approved as OD-1(b): one emitted event type, HMAC
signing, at-least-once delivery, attempt history, API-only destinations, no
dashboard UI. The roadmap places webhooks in Gate 9C; the split is deliberate and
recorded in the Phase 9B plan.

### What version 1 introduces

Two canonical schemas plus a compatibility manifest, and two closed record types.

- **`billingStateEvent`**: `eventId`, `eventType`, Project, Environment, Billing
  Customer, optional Subscription Instance, `snapshotVersion` and
  `previousSnapshotVersion`, `projectionRuleVersion`, `occurredAt`, `createdAt`,
  `changedEntitlements[]`, a four-axis `stateSummary`, `sourceReason`,
  `isTestSource`, `correlationId`, and safe diagnostics.
- **`webhookDeliveryAttempt`**: operator-facing attempt history, **never
  transmitted to a destination**, carrying no destination URL and no signing
  secret. A test asserts no property name in it matches `url`, `secret`,
  `signature`, `endpoint`, or `token`.
- **Ten event types declared, one emitted.** All ten names are in the closed
  enumeration now because adding a member later costs a contract version. The
  manifest separates the two facts: `eventTypes` is a promise about the
  vocabulary, `emittedEventTypes` is a promise about behaviour.
- **HMAC-SHA256 signing**: `Mosaic-Signature: t=<unix>, v1=<hex>` over
  `signingVersion.timestamp.eventId.rawBody`, multiple `v1` parameters during key
  rotation, a 300-second replay window, and a test endpoint.
- **At-least-once delivery** with `eventId` as the deduplication key,
  `snapshotVersion` as the ordering key, and the rule that delivery failure never
  rolls back customer state. Exactly-once is never promised.

### Approved exception: consumer tolerance (OD-16)

Mosaic's repo-wide doctrine is fail-closed reading: a reader that does not fully
understand a document rejects it. Webhook consumers are a **documented
exception**, approved by the owner.

Producers stay strict — closed enumerations, `additionalProperties: false`, no
provider material. Consumers are documented as tolerant: ignore unknown fields,
unknown event types, and unknown enumeration members, and re-read the snapshot.

The justification is that the event is not authoritative; the snapshot is. A
consumer that rejected an event carrying an unrecognized field would stop
reacting to real state changes in order to protect itself from information it was
free to ignore. Ignoring the unknown and re-reading reaches the same fail-safe
outcome by the opposite route. Signature verification is the one thing a consumer
must not be tolerant about, and it happens before the body is parsed.

Both halves are pinned as separate manifest blocks (`producerPolicy`,
`consumerTolerance`) so the exception stays an exception, and the asymmetry is
also recorded in `docs/protocol/compatibility-policy.md`.

### Deliberate restrictions

- **No provider-specific event names.** A validator guard rejects any event type
  matching `apple|google|storekit|play|itunes`. An application backend should
  never have to branch on which store a change came from.
- **An event must report a change.** A no-change projection creates no snapshot
  and emits no webhook, so an event whose entitlement states are all unchanged is
  a producer defect — unless `sourceReason` is `subscription_period_changed`,
  `renewal_intent_changed`, or `grant_version_changed`.
- **The forbidden-value walk is ported from Billing Ingestion, values only.**
  Billing Ingestion also bans `entitlement`, `subscription`, and `customer` field
  names; here that vocabulary is legitimate and banning it would ban the
  contract.

### Fixtures and vectors

13 canonical fixtures and 8 invalid ones.
`packages/test-fixtures/src/webhook-signature-vectors.json` carries eight
signature vectors — tampered body, changed event ID, changed timestamp, rotation
key, non-ASCII body, non-ASCII secret — built by
`build-webhook-signature-vectors.mjs`. Signatures are computed, never
hand-edited, and a test asserts the canonical vector signs the exact bytes of
`events/entitlement-activated.json`.
