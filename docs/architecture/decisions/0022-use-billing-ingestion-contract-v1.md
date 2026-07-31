# ADR-0022: Use Billing Ingestion Contract v1

## Status

Accepted

## Date

2026-07-28

## Context

Phase 9A starts Mosaic Billing: Mosaic must prove a provider transaction is
authentic, associate it with the correct Mosaic Product, and preserve an
auditable history — **without deciding customer access**.

Nothing in the accepted contract set can carry that. Commerce Provider `1`/`2`
holds the only existing transaction reference in the protocol
(`purchaseOutcome.transactionReference`, an opaque 1–128 character provider
code), but it describes a client-side adapter boundary, its record-type set is
closed at exactly ten by its own manifest, and it has no vocabulary for
validation, quarantine, replay, or a normalized fact. Analytics Event `1`/`2`
records observations for product analytics, not evidence, and has no event for a
validated transaction. Extending either in place would force strict readers to
reject documents they must accept, or — far worse — let a reader interpret part
of a billing record.

Three specific hazards drove the design:

1. **A client will be tempted to treat "accepted" as "validated."** Any
   acknowledgement vocabulary containing a word like `validated` invites an SDK
   to unlock content on intake, before any provider has been contacted.
2. **The two stores disagree about what a transaction reference is.** iOS holds
   a raw decimal StoreKit transaction identifier; Android holds a purchase token
   that must never leave the device in raw form. Left unstated, each SDK would
   invent its own convention and the values would not join.
3. **Product resolution is not a single lookup.** `provider_product_mappings` is
   scoped by environment and supports archival and replacement chains, so
   resolution can legitimately return zero or several candidates, and the
   observed Store Environment can disagree with the mapping's environment.

## Decision

Define **Billing Ingestion Contract v1** as a new, independently versioned,
platform-neutral contract with discriminator
`billingIngestionContractVersion: "1"`. It is not embedded in the Paywall
document, Configuration Delivery, or a Commerce Configuration sidecar.

Four canonical schemas plus a compatibility manifest, following the Analytics
Event precedent, under `protocol/schema/billing-ingestion/v1/`. Seven closed
record types: client and server transaction observations, submission result,
validation result, transaction fact, product resolution, and quarantine record.
Each schema is a self-describing envelope pinning its own `recordType` subset.

The frozen rules, all machine-checked by the manifest's `readerPolicy` and
mirrored as schema `const`s:

- **Acceptance is not validation.** The submission-result set is
  `accepted_for_validation`, `duplicate`, `permanently_rejected`,
  `retryable_failure`. No member is named `validated`, `verified`, `confirmed`,
  or `entitled`, and the validator fails if one is ever added.
  (`acceptedSubmission: "neverTreatAsValidated"`.)
- **A client never authors a fact.** `client_observation` is pinned on client
  observations and structurally absent from every transaction fact.
  (`clientAuthoritativeFact: "forbidden"`.)
- **Unresolved Products quarantine.** Only a `resolved` resolution may feed a
  fact; ambiguity requires at least two candidates and Mosaic never selects one.
  (`unresolvedProduct: "quarantineNeverGuess"`.)
- **Sandbox never mixes with production.** A fact is always exactly `sandbox` or
  `production`; the client never asserts classification.
  (`unclassifiedStoreEnvironment: "neverAggregateWithProduction"`.)
- **Facts are append-only.** Replay appends and names what it supersedes.
  (`factMutation: "forbidden"`.)
- **No entitlement inference, no raw provider credential, no raw provider
  error.** (Three further `forbidden` policies.)
- Unknown contract version, record type, field, outcome, quarantine reason,
  source authority, or transaction type rejects the whole record.

Provider references carry an explicit `referenceKind` discriminator, resolving
hazard 2 as a documented cross-SDK contract pinned in the manifest:
`app_store_transaction_id` is the raw decimal App Store transaction identifier;
`google_play_token_digest` is **SHA-256 over the UTF-8 bytes of the purchase
token, lowercase hexadecimal**; `google_play_order_id` is an optional join
handle. Reference kind must match store platform.

`subjectReference` and `monetaryAmount` are defined as optional schema fields
that Phase 9A never populates or persists, so introducing them later does not
cost a contract version. Every enumeration is closed and therefore deliberately
over-provisioned, because every later addition costs a contract version.

Billing Ingestion is **server-only in Phase 9A**:
`tools/generate-browser-contract.mjs` is deliberately untouched and no billing
type reaches `protocol/browser/generated/contract-types.d.ts`. The dashboard
consumes OpenAPI-generated types for billing instead. Adding browser generation
later is additive and does not require a contract version.

The manifest is born `status: "draft"`. It reaches `approved` only by an
explicit product-owner decision recorded in the Phase 9A review.

## Consequences

Mosaic gains a contract in which the dangerous statements are unrepresentable
rather than merely discouraged: a client cannot claim provider authority, an
acceptance cannot be read as a validation, an ambiguous resolution cannot
collapse to a guess, a sandbox fact cannot be filed as production, and a fact
cannot be rewritten. Twenty-four invalid fixtures freeze those rejections, with
generated `rejection-layers.json` recording that twenty-one are enforced by the
schema itself.

Because every enumeration is closed, adding a record type, outcome, quarantine
reason, transaction type, source authority, resolution, or reference kind is a
breaking change requiring Billing Ingestion `2`. This is the same trap Commerce
Provider set for itself deliberately, and it is why the vocabularies here are
generous rather than minimal.

The diagnostic shape is redefined locally rather than referenced from Commerce
Provider `2`. That duplicates roughly thirty lines, and is chosen so an approved
Billing Ingestion `1` does not point at a definition a future Commerce Provider
`3` would deprecate.

No approved contract changes. Paywall `0.2`, Local Preview `0.2`, Configuration
Delivery `1`/`2`/`3`, Placement Decision `1`, Experiment Assignment `1`,
Analytics Event `1`/`2`, Commerce Provider `1`/`2`, and Commerce Configuration
`1`/`2` are untouched, byte for byte. In particular there is no
`billing_transaction_validated` Analytics event — that would be Analytics Event
`3` and is out of scope. Billing-to-analytics correlation uses only the existing
opaque `purchaseAttemptId`, `providerOperationId`, and `providerUpdateId`
handles.

Mosaic Billing remains optional. No contract gains a required reference to
Billing Ingestion, and an SDK that never submits an observation loses no
capability.

The persistence, credential, and ledger decisions for Phase 9A — including the
reversal of the Phase 4B "no receipts or tokens persisted" claim — are recorded
separately in the Phase 9A backend ADR, not here.

## Alternatives considered

**Extend Commerce Provider to version 3.** Rejected: it would couple an
adapter-facing client contract to a server-side evidence contract, and its
manifest closes the record-type set at exactly ten, so any addition breaks every
existing reader anyway.

**Carry billing records inside Configuration Delivery.** Rejected: delivery is a
read-path snapshot contract; ingestion is a write path with entirely different
authority and retry semantics.

**A single `contract.schema.json`, following Commerce Provider.** Rejected in
favour of four files following Analytics Event: a single file would exceed 1500
lines and a reader dispatching on the envelope gains nothing from it.

**Submit the raw Google purchase token from the SDK.** Rejected: the token is
bearer-grade material. The SDK submits its digest; the token reaches Mosaic only
over the trusted server endpoint, where it is encrypted at rest and never
enters this contract.

**Include a `validated` acknowledgement so clients can react quickly.**
Rejected outright — this is the failure mode the contract exists to prevent.
