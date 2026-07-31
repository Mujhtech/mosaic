# Billing Migration Operations Contract changelog

## Version 1 - 2026-07-29

Status: draft

Introduces the strict RevenueCat-first migration record and command set. It
freezes explicit application/platform scope, exact/audited-alias identity
matching, evidence/readiness gates, two-person production approval, monotonic
authority commands, allowlisted repairs, idempotent redelivery, seven-day
default stabilization/rollback policy, and 30-day raw-source retention.

Stage 2A quality closure distinguishes opaque source identifiers (including
RevenueCat anonymous IDs) from Mosaic IDs; freezes exact cutover and rollback
digest sets plus approval expiry; completes repair audit/result fields; and
enforces credential-removal and source-retention timing.

Stage 2E approval clarification removes the portable same-person rejection for
migration approval records because Environment is server-derived and absent
from the output. Production cutover and rollback still require two distinct
humans at the server boundary; development and sandbox permit one authorized
operator. Source-access exceptions remain universally two-person-approved.

The draft additionally freezes durable `sourcePull` jobs for snapshot, delta,
and final-delta acquisition. Delta jobs bind the exact starting cursor and
watermark, completed jobs bind source-object/manifest/import evidence, and a
completed final delta includes the evaluation reference once its
provider-validation import completes and the server automatically queues that
evaluation. A separate final-delta command is forbidden. The server may also
return a closed `operatorCapabilities` record for UI affordances; backend
authorization remains authoritative.

The repair vocabulary is canonicalized as `provider_revalidate`,
`projection_replay`, `attach_proven_alias`, `replace_mapping_set`, and
`retry_quarantined_record`. Repair execution status is closed to `pending` and
`completed`. Pending executions retain an unsettled durable reservation and
are forbidden from carrying a result or after-state digest; completed
executions carry one of the closed terminal results `succeeded`, `failed`, or
`no_change`.
