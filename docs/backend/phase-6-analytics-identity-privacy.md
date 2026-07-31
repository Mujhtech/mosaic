# Phase 6 analytics, identity, and privacy

Mosaic accepts the canonical Analytics Event v1 contract at
`POST /v1/sdk/events/batch`. Collection is disabled by default for every
Environment. A public SDK key must be bound to one Application; the API derives
Organization, Project, Environment, and Application scope from that trusted
binding. Legacy unbound public keys continue to serve configuration but cannot
ingest analytics.

## Ingestion and reporting

Batches contain at most 100 events and 512 KiB; one event is limited to 32 KiB.
The endpoint rejects compressed bodies, authenticates bearer keys, applies
bounded IP, key-batch, and key-event rate limits, validates each event against
the canonical JSON Schema, and returns an ordered per-event outcome. Event IDs
are idempotent within an Environment. Reusing an ID with different content is a
conflict. Client events cannot claim provider-confirmed authority.

Accepted events are retained for 180 days by default (configurable from 30 to
730 days). Events older than seven days are rejected and timestamps receive a
five-minute future-skew allowance. UTC daily aggregates and privacy audit rows
are retained for 24 months. Report metadata states the event-count basis,
authority, 24-hour attribution window, timezone, definitions, warnings, and
aggregate freshness. Because Phase 6 has no trusted provider-confirmation
ingestion source, `provider_confirmed_purchases` and
`presentation_to_provider_confirmed_purchase_rate` always omit `value`, declare
`provider_confirmed` authority, and include the
`provider_confirmed_unavailable` warning. Client observations are never
presented as provider confirmation. Paywall Version comparison includes both
presentation counts and the correlated client-completed purchase rate. Provider
and Product issue reports include only bounded safe diagnostic-code and reason
dimensions.

## Identity and privacy

Installation and optional application-user identifiers are stored as opaque
references and linked through generation-aware aliases. `applicationUserId`
uses the canonical 1–256 Unicode-code-point, non-control-string contract; it is
not constrained to Mosaic resource-ID syntax, so provider-style punctuation,
spaces, and Unicode are accepted. The public ingestion boundary additionally
rejects values shaped like email addresses, phone numbers, or bearer material
with the permanent `sensitive_value_rejected` event result. This deliberate
data-minimization rule is stricter than the structural JSON Schema.

Sessions use a
30-minute inactivity boundary. Owner-only privacy preview resolves an exact
Project-scoped identity before export or deletion. Exports are private object
store artifacts that expire after seven days. Confirmed deletion hard-deletes
matching events and sessions, removes identity links, and completes only after
affected aggregate buckets are rebuilt. Append-only audit records store
digests and counts, never the submitted raw identity.

Members may read analytics, including collection settings. Owners and admins
may update settings and create, inspect, and download event exports. Privacy
preview, user export, deletion, identity-job status, and identity-export
download require the owner role. Job lookup is Project-scoped before its
kind-specific role check, so a caller cannot cross a tenant boundary by knowing
a job ID. Export workers spool rows to a private temporary file rather than
holding an export in process memory; the deterministic object key and leased
job state make retries safe. The complete endpoint and response contract is in
`docs/backend/openapi.yaml`.

## Operations

`cmd/worker` processes aggregate rebuilds, deletions, retention, exports, and,
when enabled, provider synchronization. PostgreSQL and the configured private
S3-compatible bucket are mandatory. Relevant environment variables are:

- `MOSAIC_ANALYTICS_EVENT_SCHEMA_PATH`
- `MOSAIC_ANALYTICS_IP_REQUESTS_PER_MINUTE` and `MOSAIC_ANALYTICS_IP_BURST`
- `MOSAIC_ANALYTICS_KEY_BATCHES_PER_MINUTE` and `MOSAIC_ANALYTICS_KEY_BATCH_BURST`
- `MOSAIC_ANALYTICS_KEY_EVENTS_PER_MINUTE` and `MOSAIC_ANALYTICS_KEY_EVENT_BURST`
- `MOSAIC_ANALYTICS_LIMITER_ENTRIES`
- `MOSAIC_ANALYTICS_WORKER_POLL_INTERVAL`

Apply migrations explicitly with `go run ./cmd/migrate up`; neither API nor
worker mutates the schema at startup.
