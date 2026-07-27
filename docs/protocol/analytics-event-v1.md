# Analytics Event Contract v1

Analytics Event Contract `1` is Mosaic's closed, platform-neutral product
analytics contract. It describes monetization observations and batch ingestion;
it does not change Paywall Protocol `0.2`, Placement Decision `1`, Configuration
Delivery `1`/`2`, or Commerce Provider `1`/`2`.

Canonical artifacts:

- `protocol/schema/analytics-event/v1/event.schema.json`
- `protocol/schema/analytics-event/v1/batch.schema.json`
- `protocol/schema/analytics-event/v1/ingestion-response.schema.json`
- `protocol/schema/analytics-event/v1/compatibility-manifest.schema.json`
- `protocol/compatibility/analytics-event/v1.json`
- `protocol/fixtures/analytics-event/v1/`

Canonical event names are unprefixed, and Mosaic's own NDJSON and CSV exports
emit them verbatim. `mosaic_*` is a recommended convention for third-party
downstream destinations only; Mosaic never emits or accepts a prefixed name. See
[Analytics export names](analytics-export-names.md) for the complete mapping and
the reserved provider-native namespaces.

The exact batch and response discriminator is
`analyticsEventContractVersion = "1"`. Every event independently declares the
exact `eventSchemaVersion = "1"`. Unknown versions, names, payload variants,
and fields fail closed. A future payload revision may add another exact event
schema version without changing v1 batch framing.

## Tenant and source authority

Public SDK events never contain Organization, Project, Environment, or
Application IDs. The authenticated public SDK key determines Organization,
Project, and Environment. Analytics ingestion additionally requires that key
to be bound to exactly one trusted Application; a legacy unbound key cannot
ingest analytics. The backend derives and validates all tenant and Application
scope before storage.

The event's `authority` assertion is not trusted by itself:

- a public SDK key accepts only `client_observed`;
- an accepted secret server endpoint may accept `trusted_server`;
- an accepted provider integration may accept `provider_confirmed`.

The stored authority is derived from authentication and integration type. A
public SDK cannot submit `purchase_completed_provider`. RevenueCat
synchronization, RevenueCat client results, StoreKit verification, and Google
Play client results are not trusted server confirmation sources in Phase 6.
Provider-confirmed metrics are unavailable, not zero, until an accepted source
exists.

## Batch and event envelopes

A batch contains:

```json
{
  "analyticsEventContractVersion": "1",
  "batchId": "batch_001",
  "sentAt": "2026-07-26T12:00:08.000Z",
  "events": []
}
```

The contract accepts 1–100 events; SDKs send at most 50. Event IDs must be
unique inside one batch. The uncompressed batch is at most 512 KiB and each
serialized UTF-8 event is at most 32 KiB.

An event contains stable identity, time, authority, correlation, attribution,
and one typed payload:

```json
{
  "eventId": "event_001",
  "eventSchemaVersion": "1",
  "eventName": "paywall_presented",
  "occurredAt": "2026-07-26T12:00:00.120Z",
  "queuedAt": "2026-07-26T12:00:00.125Z",
  "authority": "client_observed",
  "identity": {
    "installationId": "installation_001",
    "applicationUserId": "customer_42",
    "generation": 3
  },
  "sessionId": "session_001",
  "context": {
    "platform": "ios",
    "sdkFamily": "flutter",
    "sdkVersion": "0.6.0"
  },
  "correlation": { "paywallPresentationId": "presentation_001" },
  "attribution": {
    "paywallId": "paywall_pro",
    "paywallVersionId": "paywall_version_19"
  },
  "payload": {}
}
```

Client events require installation identity, identity generation, session, and
context. Application user identity is optional. Its canonical wire value is a
1–256 character, non-control, opaque string chosen by the host application; it
does not use Mosaic resource-ID syntax and may therefore contain spaces,
slashes, or other non-control characters. Ingestion semantically rejects values
that appear to be an email, phone number, full name, access token, payment
identifier, or another sensitive value under the accepted privacy policy. The
schema deliberately cannot encode every evolving sensitive-value detector.
Trusted provider observations may omit client identity and session when the
source cannot establish them exactly; Mosaic never reconstructs them
heuristically.

Context is closed to platform, SDK family/version, operating-system version,
application version, locale, Configuration Delivery version, and Commerce
Provider Contract version. Advertising IDs, device models, IP-derived country,
exact location, and arbitrary device or screen data are absent.

## Correlation and attribution

Closed correlation identifiers are:

- `placementRequestId`
- `paywallPresentationId`
- `productLoadAttemptId`
- `purchaseAttemptId`
- `restoreAttemptId`
- exact `providerOperationId` and `providerUpdateId`

Funnels use these identifiers and a 24-hour attribution window. Mosaic never
correlates through display names, price, provider SKU similarity, or timestamp
proximity alone.

Closed immutable attribution includes Configuration Release, Placement, Rule
Set/version, winning Rule, Paywall/Version, Mosaic Product, Mosaic Plan,
provider, and safe Provider Product Mapping IDs. Fields are included only when
the originating contract supplies them exactly. Bundled fallback and Delivery
v1 events omit unavailable immutable fields rather than inventing them. Google
base-plan IDs are never placed in `planId`.

The closed vocabularies above are an upper bound, not a property bag. Each
event accepts only fields relevant to its causal family:

- Placement events accept only placement-request correlation and exact
  release/Placement/Rule attribution; selected and fallback Paywall outcomes
  may additionally carry exact Paywall identity.
- Paywall events accept placement-request and presentation correlation plus
  exact release/Placement/Rule/Paywall attribution where known.
- Product events may extend that lineage with product-load correlation and
  exact Product, Plan, provider, and mapping attribution.
- Purchase events may extend it with purchase-attempt and provider-operation
  correlation. Only provider-confirmed completion may use `providerUpdateId`.
- Restore events accept restore-attempt/provider-operation correlation and
  optional exact Configuration Release provenance; restored Products remain in
  the typed result payload because one restore may return several Products.

Unrelated globally known fields are invalid. For example,
`placement_requested` cannot carry `providerUpdateId` or `planId`. Rule Set ID
and version are either both present or both absent, and `winningRuleId` requires
that exact Rule Set pair.

## Typed event taxonomy

Placement events are `placement_requested`, `placement_paywall_selected`,
`placement_no_paywall`, `placement_fallback_used`, `placement_unavailable`, and
`placement_evaluation_failed`. They carry the exact request correlation,
decision version, final outcome, safe fallback/unavailable reason, and optional
rollout attribution. Assignment values, attribute values, QA tokens, and full
decision traces are forbidden.

For `placement_paywall_selected` and `placement_no_paywall`, rollout attribution
is all-or-none: `assignmentKeyType`, `bucketingAlgorithm`, and `rolloutBucket`
must either all be present or all be absent. This applies equally to Paywall and
no-Paywall rollout winners.

Paywall events are `paywall_presented`, `paywall_dismissed`,
`paywall_action_selected`, and `paywall_render_failed`. Dismissal reasons are
`user`, `system`, `purchase_completed`, `host_application`, and `unknown`.
Actions are `purchase`, `restore`, `close`, `navigate_to`, `navigate_back`, and
`open_external_url`. Action events never carry Paywall text or an external URL.

Product events are `product_load_started`, `product_load_completed`,
`product_load_failed`, `product_unavailable`, and `product_selected`.
Unavailable reasons are `mapping_missing`, `mapping_invalid`,
`product_not_found`, `temporarily_unavailable`, `provider_unavailable`,
`unsupported_product_type`, and `metadata_unavailable`.

Purchase events are `purchase_started`, `purchase_completed_client`,
`purchase_completed_provider`, `purchase_pending`, `purchase_deferred`,
`purchase_cancelled`, and `purchase_failed`. Client completion distinguishes
`purchased` from `already_entitled`; already-entitled is not a new-purchase
completion. Client and provider completion are distinct observations with
distinct event IDs.

Restore events are `restore_started`, `restore_completed`,
`restore_nothing_found`, `restore_cancelled`, and `restore_failed`. A provider
failure never becomes a successful empty restore.

Durations are integer milliseconds from 0 through 86,400,000. Product and
Entitlement identifier lists contain at most 64 unique stable identifiers.
Diagnostic and provider result codes are safe, machine-readable, and at most
96 characters. Raw provider messages, objects, transactions, receipts, tokens,
credentials, and stack traces are forbidden.

## Timestamp and session semantics

All timestamps are RFC 3339 UTC with exact millisecond precision.
`occurredAt` is immutable, `queuedAt` records local queue insertion, `sentAt`
records batch transmission, and response `receivedAt` is server-generated.
The server never replaces occurrence time with receipt time.

Events over five minutes in the future or over seven days old at receipt are
permanently rejected. Metrics use `occurredAt`; freshness and retention use
`receivedAt`. Accepted late events dirty and transactionally rebuild their UTC
occurrence buckets.

Sessions use a 30-minute inactivity threshold, survive SDK reconstruction and
application restart inside that threshold, and restart on effective user
identity change/clear, installation reset, or collection re-enable.

## Partial-batch response

Every syntactically valid batch returns exactly one result per submitted event:

- `accepted`
- `duplicate`
- `permanently_rejected` with a closed permanent code
- `retryable` with a closed retryable code and optional 1–300 second delay

Idempotency is `(Environment ID, event ID)`. The same canonical event digest is
`duplicate`; different content under the same ID is permanent
`event_id_conflict`. A malformed acknowledgement makes the SDK retain the
complete sent batch. Accepted, duplicate, and permanently rejected events are
removed; retryable events remain.

Acknowledgement status and code vocabularies are closed. An unknown status,
unknown permanent code, unknown retryable code, missing submitted event result,
duplicate result, or other malformed acknowledgement makes the whole sent
batch retryable from the SDK's perspective. The SDK must not partially remove
events using the recognizable subset of an invalid response.

Validation is per event, while otherwise valid candidates persist in one
transaction. A transient persistence failure rolls back that candidate subset
and marks it retryable without changing already determined permanent results.
An invalid outer envelope, unsupported batch framing, oversized body, or
unusable event-ID set is a batch-level rejection.

## Privacy and compatibility

There is no custom metadata in v1. Every object is closed. Unknown fields are
permanently rejected rather than ignored. Event-time identity snapshots are
never rewritten by identify or reset. The schema contains no executable code
and no platform widget/view names.

The shared SDK conformance corpus is
`protocol/fixtures/analytics-event/v1/batches/edge-case-conformance.json`. It
covers a no-Paywall rollout winner, fallback, placement-evaluation failure,
Paywall-render failure, missing Product mapping, an unmapped purchase failure,
and an unmapped restore outcome. SDK conformance tests should consume this
canonical corpus rather than duplicate platform-specific versions.

Validate with:

```bash
npm --prefix protocol run validate
npm --prefix protocol test
```
