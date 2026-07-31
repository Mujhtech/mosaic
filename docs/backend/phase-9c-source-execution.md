# Phase 9C source ingestion and execution core

Stage 2E Package A adds the internal source-ingestion and execution boundary. It is not wired to an
HTTP route or worker loop yet.

## Source channel and evidence boundary

RevenueCat REST API v2 pull is the required v1 source channel. A RevenueCat Scheduled Data Export
may be accepted only as source evidence after it has passed the same Mosaic-owned object workflow.
Callers cannot choose an object key or request a presigned upload. Object keys are deterministic
digests of the Project, migration program, and server-owned object identity.

RevenueCat customer IDs, original IDs, aliases, subscription ownership, and transfer history are
preserved as byte-exact source evidence. Cursors are opaque. Exact duplicate revisions are absorbed
idempotently; out-of-order revisions remain valid evidence. Email, fuzzy, and device matching are not
implemented.

Each provider page is written using its original JSON bytes; unknown fields, field order, and
escaping are not reconstructed from normalized structs. The opaque resume cursor is reported
separately from a terminal page-identity watermark, so completion is never represented by an empty
or previously consumed cursor.

Source evidence has no repository port that inserts `billing_transaction_facts`. Known Apple and
Google references may cross only the `ProviderEvidenceImporter` revalidation port into the accepted
Phase 9A validation pipeline. Export and ordinary RevenueCat API evidence remain
`trusted_source_export` or `trusted_provider_api`, never provider validation.

The plaintext import queue accepts only provider-paired, non-secret join handles:
`app_store_transaction_id` for App Store records and `google_play_order_id` for Google Play records.
It rejects generic `provider_reference` values and `google_play_purchase_token` values before
adapter dispatch, and PostgreSQL enforces the same allowlist. Google purchase tokens are
bearer-grade credentials: they may enter validation only inside the encrypted Phase 9A Raw Input
flow after an authoritative `orders.get` response, and are never stored in migration import rows.

## Private encrypted objects

Plaintext is limited to 100 MiB. The `billingmigrationobject` envelope streams fixed-size chunks
through AES-256-GCM and writes an authenticated terminal record. Its metadata records:

- envelope and algorithm version, key ID, base nonce, chunk size, and chunk count;
- an AAD digest bound to Project, program, object, adapter version, and normalization schema;
- plaintext and ciphertext SHA-256 digests and sizes.

Mosaic streams ciphertext into private S3-compatible storage and then independently opens and
authenticates the stored stream. Truncation, chunk modification, cross-tenant AAD, checksum mismatch,
or oversize input fails the object before any manifest or import work can be appended. The complete
object is never buffered in memory.

Execution is deployment-gated by `MOSAIC_BILLING_MIGRATION_ENABLED` and remains off by default.
Verified source objects use `MOSAIC_BILLING_MIGRATION_SOURCE_BUCKET`, which must differ from the
public Asset bucket. The source-object keyring is configured separately through
`MOSAIC_BILLING_MIGRATION_SOURCE_KEYRING`; it must not reuse the provider-credential keyring. Its
versioned JSON format carries one `activeKeyId` plus all retained AES-256 keys. New objects use the
active key, while retained keys remain decryptable for the full evidence-retention and rollback
windows. Removing an old key before every referenced object is deleted makes that evidence
unrecoverable, so rotation is add-new-key, deploy, verify reads, then retire only after the object
inventory reaches zero for the old key.

Operators can validate and inventory this keyring without exposing source data:

```bash
cd apps/api
go run ./cmd/keyring validate --category migration-source
go run ./cmd/keyring inspect --category migration-source
```

Inspection exits non-zero when a retained object's key is missing. There is no
source-object reseal command: verified ciphertext, envelope metadata, and its
digest are immutable evidence. Add a new active key for new objects, retain old
keys while their inventory is non-zero, and use the approved retention/deletion
flow before removing an old key.

The supported Compose profile creates the source bucket without an anonymous access policy. The
chunk size and source-operation timeout are bounded at startup; invalid encryption, shared-bucket,
or migration-without-billing configurations fail startup without printing key material.

Migration `00055` records reservation, verification, failure, and deletion metadata separately from
the immutable source manifest. A verified object can only transition to a retained `deleted` ledger
record; its cryptographic evidence cannot change. The migration refuses rollback before destructive
statements when verified/deleted objects, manifest bindings, execution attempts, or final-delta jobs
exist.

## Execution and lease rules

Import, dry-run, shadow, and final-delta work use bounded attempts, due times, backoff, stable safe
error codes, lease owners, expiries, and monotonic lease generations. Leasing and the immutable
`started` attempt commit before external I/O. Settlement uses a short serializable transaction and
requires the same owner, generation, and an unexpired lease. Completion/failure is appended as a new
attempt row; the started row is never updated. A stale lease cannot settle work.

Import leases load their exact bounded source-record associations from PostgreSQL. Callers cannot
substitute an arbitrary reference list, and successful settlement requires every batch record to be
classified exactly once as validated or quarantined.

Dry-run and shadow settlement may create immutable migration runs and migration-owned prepared
pointers. The application ports expose no live-current-pointer, Customer Access Token, billing
webhook, or authority-transition operation. Final-delta settlement rechecks program state plus the
latest manifest and mapping digests, freezes the cohort, and requires exact `cohort × explicit scope`
prepared-pointer coverage. It never advances live pointers.
Checkpoint preparation consumes only pointers bound to that completed final-delta job and lease
generation. Stale rows from an earlier shadow or delta run cannot satisfy coverage even when their
cardinality matches the new cohort.

## Operational telemetry

Future worker wiring should annotate only program, job, scope, attempt, counts, duration, cursor age,
and stable error category. Credentials, raw payloads, customer identifiers, aliases, source cursors,
and complete provider responses must not be logged or attached to spans.
