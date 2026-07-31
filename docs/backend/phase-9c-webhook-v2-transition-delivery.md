# Phase 9C Billing State Webhook v2 transition delivery

Stage 2E Package B adds the persistence and application seams for authority
transition notifications. It does not register HTTP routes or worker jobs;
Package C may wire the append/lease processors after the completion and
stabilization lifecycle is integrated.

## Destination compatibility and readiness

Each billing webhook destination declares contract version `1` or `2`.
Version 1 remains the default for existing rows and callers. Fanout matches an
event to destinations of the same contract version, so a v1 destination never
receives an authority event and Mosaic never down-converts a v2 envelope.

`DestinationReadiness` is the narrow production-readiness read port. No active
destination is a valid configuration. If active destinations exist, readiness
requires at least one active v2 destination with an active signing secret and
a successful delivery attempt, within the caller's freshness window, joined to
a stored v2 `authority.*` event that the destination's current event
subscription accepts. The attempt must be no older than the destination's
current configuration. A v1 or entitlement-only delivery never counts. URL,
event-subscription, and contract-version changes clear successful-test evidence
transactionally and invalidate earlier delivery proof. This port is deliberately
not wired into the shared readiness service in Package B.

## Exact transition audience and event storage

The transition audience is read from one immutable checkpoint and one explicit
Application/platform authority scope. The checkpoint cohort is therefore
multiplied by the exact migration scope without a wildcard or a live-customer
rescan. A rollback baseline marked absent produces snapshot version `0` and a
null snapshot reference; it does not preserve Mosaic access.

The transition consumer commits its lease before reading the audience or
rendering an event. It deterministically renders one Billing State Webhook v2
event per outbox/customer pair. The event ID is derived from that pair. The
compact envelope bytes and their SHA-256 digest are stored together, and the
delivery lease reads the byte column directly. Signing and retries therefore
use the original bytes and event ID rather than re-serializing JSON.

Event insert, eligible v2 destination fanout, fanout marker, and outbox
completion are one PostgreSQL transaction. A crash or constraint failure
commits none of them. The outbox returns to a bounded exponential retry, while
billing authority and current pointers remain outside the delivery transaction
and are never rolled back by notification failure.

Legacy `authority_changed` and `rollback_changed` outbox inserts remain valid
for the already-shipped atomic execution code. Migration 00056 marks and
interprets them as cutover-completed and rollback-completed respectively while
new append callers use the explicit Stage 2E vocabulary.

## Migration redelivery

Migration redelivery addresses one exact `(program, event, destination)` and
requires owner capability, tenant membership, the expected migration state
version, and the stored event-body digest. Its idempotency record is immutable.
The same command returns the original result; a different command using the
same key conflicts.

Redelivery extends the existing delivery's attempt budget and queues it. It
does not create or render an event, change the event ID or payload, change
signing input, or mutate billing authority. A v1 or cross-tenant destination is
not eligible for migration transition redelivery.

## Downgrade policy

Migration 00056 can be rolled down and reapplied while the database contains
only v1 webhook data and legacy transition rows. Down migration stops before
dropping any column if a v2 destination, v2 event, new transition outbox kind,
or migration redelivery record exists.
