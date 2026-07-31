# Phase 9C RevenueCat v2 source pulls

Phase 9C imports RevenueCat evidence through durable source-pull jobs. A job has one explicit intent: `snapshot`, `delta`, or `final_delta`. Snapshots have no starting position. Delta intents bind the exact opaque starting cursor and watermark to a 32-byte watermark digest. Every job also stores its expected migration state version, frozen mapping set, retry state, and lease generation. Workers must acquire the database lease before opening the migration credential or performing provider/object-store I/O.

## RevenueCat resource graph

The adapter follows the official v2 resources without synthetic expansions:

1. paginate `/projects/{project}/customers`;
2. for each customer, paginate `/projects/{project}/customers/{id}/subscriptions` and `/projects/{project}/customers/{id}/aliases`;
3. paginate `/projects/{project}/products?expand=items.app`.

Every response body is retained byte-for-byte in the encrypted source object. Mosaic adds a length-prefixed evidence boundary containing the endpoint, resource identity, and exact opaque cursor. The evidence digest covers both boundaries and raw bodies. Unknown JSON fields and original escaping therefore remain auditable. A delta starting position is accepted only when its cursor, final watermark, and digest exactly match a completed server-recorded pull for the same migration program. The predecessor is persisted and may have only one active successor; `final_delta` must extend the latest completed chain head.

Pagination and retries share the RevenueCat client's bounded operation budget. A retry leases a new source-object reservation generation; it never accepts a caller-selected object key and never holds a PostgreSQL transaction open during provider or object-store calls.

## Normalization and binding

Normalization is append-only. Customers, aliases, subscriptions, products, subscription ownership, product relationships, and entitlement identifiers are recorded separately from provider-validation evidence and from billing facts.

Store normalization is explicit:

| RevenueCat store | Mosaic provider | Platform | reference kind |
| --- | --- | --- | --- |
| `app_store`, `mac_app_store` | `app_store` | iOS | `app_store_transaction_id` |
| `play_store` | `google_play` | Android | `google_play_order_id` |

Mosaic does not infer a provider from identifier syntax. Unsupported stores are quarantined. RevenueCat subscription environments are accepted only as exact `production` or `sandbox` values and must agree with the Mosaic Environment mode (`production` maps to `production`; development and staging map to `sandbox`). Unsupported or mismatched environments are quarantined before validation work is created. A subscription is eligible for provider validation only when its product has exactly one application/platform binding in the frozen mapping evidence. The validation record preserves the RevenueCat source product ID, expected store product identifier and environment, and mapped Mosaic Product ID together with that exact Application binding. Missing and ambiguous bindings are quarantined. RevenueCat's Google v2 store subscription identifier is preserved as `google_play_order_id`; it is not relabeled as a purchase token.

Import-batch records are plaintext operational joins, so their reference kind is closed rather than
extensible: only the Apple transaction ID and Google order ID rows above are representable, with an
exact provider pairing. Generic provider references and Google purchase tokens fail before provider
dispatch and are rejected by the database constraint. A token returned later by Google
`orders.get` exists only in the encrypted Phase 9A Raw Input validation boundary; source-pull
normalization, import rows, logs, and telemetry never persist it in plaintext.

RevenueCat v2 defines `starting_after` as the ID of the final object from the
previous page. Mosaic records the terminal customer ID as the next pull cursor,
including for a one-page snapshot; it never reuses the cursor that fetched the
terminal page. An empty snapshot has an empty cursor, which remains a valid
server-bound predecessor position: its successor starts from the beginning and
captures customers created later. The predecessor watermark and evidence digest
remain mandatory, so an empty cursor cannot authorize an arbitrary restart.

The verified source object, manifest, normalized records and relationships, import batch, import-record bindings, and successful source-pull settlement are written in one serializable transaction. Raw provider evidence remains distinct from the normalized relationship projection and the later provider-validation result.

## Final delta

Operators queue a `final_delta` source pull; there is no separate final-delta command. Once the pull's lease-bound provider-validation import settles successfully, the same import settlement transaction creates the final-delta evaluation job using the pulled manifest digest, frozen mapping digest, and provider-validation evidence digest. Stale owners or lease generations cannot settle either stage.

## Operational checks

- Monitor pending/running jobs through `billing_migration_source_pull_jobs` without reading encrypted payloads.
- `last_error_code` contains a bounded machine-readable category, never a credential or provider body.
- Repeated idempotency keys replay only when their request digest matches.
- Migration 00058 refuses rollback while any durable pull job or normalized relationship remains.
- Apply schema changes with the migration command; API and worker startup do not mutate the schema.
