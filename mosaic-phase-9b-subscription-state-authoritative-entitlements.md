# Orchestration Prompt — Mosaic Phase 9B: Subscription State and Authoritative Entitlements

Read all of the following before making changes:

- `AGENTS.md`
- `README.md`
- `SECURITY.md`
- `docs/product/vision.md`
- `docs/product/principles.md`
- `docs/product/roadmap.md`
- `docs/product/mosaic-agentic-plan.md`
- `docs/architecture/overview.md`
- `docs/architecture/conventions/backend.md`
- `docs/architecture/conventions/frontend.md`
- `docs/architecture/conventions/protocol.md`
- `docs/architecture/conventions/sdk.md`
- `docs/architecture/conventions/testing.md`
- all accepted ADRs
- `docs/plans/phase-4a-revenuecat-custom-providers.md`
- `docs/plans/phase-4b-native-store-providers.md`
- `docs/plans/phase-6-analytics-identity-privacy.md`
- `docs/plans/phase-8-operational-hardening.md`
- `docs/plans/phase-9a-transaction-ingestion-validation.md`
- `docs/reviews/phase-8.md`
- `docs/reviews/phase-9-entry.md`
- `docs/reviews/phase-9a.md`
- post-GA billing demand evidence
- accepted Phase 9A incident, reconciliation, and provider-validation findings
- open issues marked as Phase 9B blockers

We are implementing:

# Mosaic Phase 9B: Subscription State and Authoritative Entitlements

Do not begin Phase 9C.

---

# Preflight Gate

Before delegating or modifying code, verify all of the following:

- Phase 8 is accepted as ready for General Availability.
- Mosaic v1.0.0 or an accepted GA baseline commit exists.
- `docs/reviews/phase-9-entry.md` explicitly approves Mosaic Billing.
- Phase 9A is accepted or accepted with tracked nonblocking follow-ups.
- `docs/reviews/phase-9a.md` exists.
- Apple transactions are validated server-side.
- Google purchases are validated server-side.
- Apple and Google notifications are authenticated and ingested.
- Raw Billing Inputs are append-only.
- Validation Attempts are append-only.
- the Billing Event Ledger is append-only.
- Normalized Transaction Facts are provider-independent and immutable.
- Product resolution uses stable Mosaic Product IDs and mapping history.
- unknown and ambiguous Products enter quarantine.
- duplicate provider notifications are idempotent.
- replay and revalidation preserve prior history.
- reconciliation discovers missed provider facts.
- sandbox and production are isolated.
- PostgreSQL remains the runtime system of record.
- Goose migrations apply successfully.
- no production in-memory persistence exists.
- provider credentials are encrypted and redacted.
- Products and Entitlements remain separate domain concepts.
- existing RevenueCat, StoreKit 2, Google Play Billing, and custom-provider integrations remain optional.
- customer Entitlement state is still provider-owned before this phase.
- no partial authoritative subscription-state engine has been introduced outside an accepted plan.
- no unresolved critical security, tenant-isolation, migration, backup, or data-integrity defect exists.
- the current branch has no unrelated uncommitted changes.

If any prerequisite fails, stop and return a blocker report.

Do not silently repair Phase 9A defects while pretending to implement Phase 9B.

If Phase 9A has unresolved provider-validation ambiguity, Product-resolution ambiguity, or append-only ledger defects, classify those as Phase 9A blockers and stop.

---

# Required Git branch

Create or use a dedicated branch.

Recommended branch:

```text
phase/9b-subscription-state-entitlements
```


Base the branch on the accepted Phase 9A baseline.

Do not merge automatically.

Do not tag automatically.

Do not begin Phase 9C automatically.

---

# Phase Objective

Build Mosaic’s authoritative customer subscription and Entitlement layer from the validated facts produced by Phase 9A.

Phase 9B must allow Mosaic to:

1. associate validated provider facts with the correct Mosaic customer
2. group provider facts into stable purchase or subscription lineages
3. project deterministic subscription state
4. preserve a complete subscription timeline
5. evaluate versioned Product-to-Entitlement grants
6. compute authoritative customer Entitlement state
7. explain exactly why access is active, inactive, unknown, or unavailable
8. synchronize state across devices and platforms
9. restore and refresh customer access safely
10. cache Entitlement state in SDKs for bounded offline use
11. provide server-side Entitlement APIs for protected application backends
12. notify application backends through signed, retryable webhooks
13. replay the complete projection deterministically from validated facts
14. repair projection defects without rewriting Phase 9A history
15. preserve Product and Entitlement meaning across replacements and version changes

The core promise is:

> Given the same validated billing facts, Product mapping history, identity evidence, and Entitlement grant versions, Mosaic always computes the same explainable customer-access result.

---

# Strict Phase Boundary

Phase 9B owns:

```text
Validated provider facts
→ customer association
→ subscription lineage
→ subscription state projection
→ versioned Product grant evaluation
→ authoritative customer Entitlements
→ SDK and server synchronization
→ signed access-change webhooks
```

Phase 9B does not own:

- RevenueCat customer migration
- RevenueCat historical transaction import
- bulk customer import
- dual-run migration
- provider cutover
- migration dry runs
- legacy-state comparison
- large-scale reconciliation of imported historical customers
- bulk repair tooling for migration
- migration rollback
- automatic provider decommissioning
- operational migration runbooks
- billing support console for mass migration
- financial accounting
- settlement reconciliation
- tax
- invoicing
- MRR, ARR, or LTV
- consumable Products
- credit Products
- metered Products
- quantity-based Products
- manual paid-access grants
- promotional support-issued Entitlements
- arbitrary operator override of validated billing state
- Stripe Billing
- Paddle
- Lemon Squeezy
- AI billing decisions
- autonomous access changes outside the state engine

Those belong to Phase 9C or later product decisions.

Do not begin Phase 9C.

---

# Non-Negotiable Architecture

Continue using:

- Go
- modular monolith
- REST APIs
- PostgreSQL
- `github.com/jackc/pgx/v5/pgxpool`
- `github.com/pressly/goose/v3`
- Chi
- Chi middleware
- Chi CORS
- Chi Render behind Mosaic response helpers
- Ozzo Validation
- `github.com/riandyrn/otelchi`
- OpenTelemetry
- Zerolog
- the accepted background-worker system
- the accepted secret-encryption system
- the accepted SDK networking and persistence systems

Do not introduce:

- production in-memory persistence
- another primary database
- Kafka
- a new queue platform
- microservices
- event-streaming infrastructure without an ADR and measured need
- automatic schema creation
- automatic production migration from API startup
- an ORM without an accepted ADR
- mutable billing history
- last-write-wins customer state
- heuristic customer identity merging
- client-authoritative Entitlements
- unsigned access webhooks
- server requests on every client-side feature check

The authoritative projection may be materialized in PostgreSQL, but its source remains the immutable validated billing history and accepted versioned business rules.

---

# Current Official Provider Semantics Requirement

Before implementation, inspect current official Apple and Google documentation relevant to state projection.

At minimum review:

## Apple

- transaction and original-transaction lineage
- signed transaction fields
- signed renewal information
- expiration
- grace period
- billing retry
- revocation
- refund
- upgrade and downgrade indicators
- subscription group behaviour
- ownership type and Family Sharing where supported
- environment
- offer type where relevant
- transaction reason and renewal reason where relevant
- current Entitlements and transaction-history semantics
- StoreKit restore and synchronization behaviour

## Google

- subscription purchase state
- line items
- base plans and offers
- linked purchase tokens
- replacement and upgrade or downgrade behaviour
- expiration
- auto-renew state
- account hold
- grace period
- pause
- cancellation
- revocation
- refund
- acknowledgement facts
- test purchase semantics
- Product type distinctions
- active purchase and history queries

Use official provider documentation.

Do not guess:

- whether a provider state grants access
- whether cancellation immediately removes access
- whether a refund is full, partial, or revoking
- whether a linked token supersedes a prior purchase
- whether paused state grants access
- whether billing retry grants access
- whether Family Sharing applies
- whether a provider timestamp is an event time, effective time, or receipt time

Record official sources, versions, and normalization decisions in:

```text
docs/plans/phase-9b-subscription-state-authoritative-entitlements.md
```

---

# Architectural Principles

## 1. Facts Are Immutable

Validated provider facts are append-only.

Do not edit a validated fact because a later fact changes its meaning.

A later fact creates a new fact and triggers reprojection.

## 2. Projections Are Rebuildable

Subscription and Entitlement projections are derived state.

They must be reproducible from:

- validated provider facts
- Product resolution history
- customer-association evidence
- versioned Product-to-Entitlement grants
- versioned projection rules
- explicit operator-approved repair metadata where allowed

## 3. State Is Explainable

Every projected subscription and Entitlement state must answer:

- which validated facts contributed
- which Product was resolved
- which customer was associated
- which grant version applied
- which projection version computed the result
- why access is active, inactive, unknown, or unavailable
- what timestamp the result is valid as of

## 4. Unknown Is Not Inactive

Missing, conflicting, or unavailable evidence must not silently become inactive.

Supported uncertainty states must remain explicit.

## 5. Provider Facts Remain Provider-Specific at the Boundary

Normalize only the concepts needed by Mosaic.

Do not erase provider details required for correct replay, diagnostics, or future rule changes.

## 6. Customer Access Changes Only Through the Engine

No handler, webhook endpoint, SDK endpoint, dashboard action, or provider adapter may directly activate or revoke an Entitlement.

All access changes flow through the authoritative projection engine.

## 7. One Source Cannot Revoke Another Unrelated Source

If several valid purchase sources grant the same Entitlement, the Entitlement remains active while at least one valid source grants it.

A refund or revocation affects its own source unless provider semantics prove a broader relationship.

## 8. Historical Meaning Is Preserved

Product replacements, mapping changes, and Entitlement-grant changes must not rewrite the meaning of prior validated purchases.

## 9. Server APIs Are Authoritative

Client SDK state is a bounded cache for UI and offline behaviour.

Protected backend resources should use Mosaic’s server-side Entitlement API or verified webhook state.

## 10. No Heuristic Identity Merge

Customers are associated only through explicit trusted evidence.

Do not merge based on email similarity, device metadata, IP address, display name, or provider metadata heuristics.

---

# Domain Invariants

The implementation must preserve these invariants.

## Billing History

- Raw Billing Inputs remain immutable.
- Validation Attempts remain immutable.
- Normalized Transaction Facts remain immutable.
- Billing Event Ledger entries remain append-only.
- validated facts cannot be deleted through ordinary user workflows.
- replay does not mutate original facts.
- revalidation creates new attempts.
- fact supersession is represented explicitly rather than through destructive updates.

## Tenant and Environment Isolation

- a Customer belongs to one Project.
- a Subscription Instance belongs to one Project and one Environment.
- a provider fact cannot project state into another Project.
- sandbox facts cannot affect production state.
- production facts cannot affect sandbox state.
- Entitlement definitions cannot cross Projects.
- Product grant rules cannot cross Projects.
- webhooks cannot deliver one tenant’s state to another tenant.

## Identity

- one customer alias cannot resolve to two active Customers in the same Project at the same time.
- an installation alias and application-user alias are typed and distinguishable.
- identity association history is immutable.
- alias reassignment requires an explicit accepted workflow and audit history.
- historical events are not rewritten when identity changes.
- unresolved customer association does not grant access.

## Product and Grants

- a validated provider Product resolves through mapping history.
- a historical fact never resolves only through the current mapping when a historical mapping is required.
- Product-to-Entitlement grants are versioned.
- a grant rule has an effective interval or version.
- changing a grant does not silently rewrite historical access meaning.
- an archived Product remains resolvable for historical facts.
- Product replacement preserves lineage.

## Subscription Projection

- the same ordered facts and rule versions produce the same projection.
- projection versions are monotonic per Subscription Instance.
- a projection never claims to be current beyond its computed `as_of`.
- out-of-order facts trigger deterministic reprojection.
- duplicate facts do not duplicate access.
- cancellation does not revoke access before the validated effective end unless provider facts require it.
- refund, revocation, and expiration have explicit effective times.
- an invalid or unknown state does not silently become active or inactive.

## Entitlement Projection

- Entitlement state derives from one or more grant sources.
- every active Entitlement source points to a Product, subscription or purchase lineage, grant version, and validated facts.
- revoking one source does not remove unrelated valid sources.
- an Entitlement with at least one active source remains active.
- an Entitlement with no active sources but unresolved critical evidence may be unknown rather than inactive.
- Entitlement snapshots are versioned.
- Entitlement changes are auditable.

## Webhooks

- webhook events are immutable.
- webhook delivery is at least once.
- webhook consumers receive stable event IDs.
- retries do not create new logical webhook events.
- webhook signatures are verifiable.
- delivery attempts are append-only.
- webhooks never contain provider secrets.
- an access-change webhook is emitted only after a committed authoritative projection.

## SDK State

- SDK cache does not overwrite newer snapshots with older snapshots.
- offline cache is bounded by an explicit validity policy.
- SDK cache cannot create server-side access.
- SDK cache failure does not corrupt provider purchase state.
- logout or identity change cannot leak one customer’s cached Entitlements to another customer.

---

# Consistency Model

Phase 9B must document consistency guarantees explicitly.

## Strongly Consistent Boundaries

The following operations should be strongly consistent within one PostgreSQL transaction where practical:

- committing a new Subscription Projection version
- committing corresponding Customer Entitlement Snapshot changes
- recording projection source links
- updating the current authoritative snapshot pointer
- creating authoritative access-change webhook events
- updating projection checkpoints
- resolving idempotency for one projection command

A consumer must not observe:

- a new subscription state without its matching Entitlement state
- a new Entitlement state without its source links
- a webhook event for state that was not committed
- a current-snapshot pointer to an incomplete snapshot

## Eventually Consistent Boundaries

The following may be eventually consistent:

- provider notification arrival
- validation retries
- projection worker execution
- SDK refresh
- application webhook delivery
- dashboard aggregate refresh
- cross-device cache refresh

Every eventually consistent surface must expose:

- last updated time
- current projection version
- pending state where relevant
- safe refresh or retry behaviour
- bounded stale-state policy

## Read-Your-Writes

Trusted server APIs that submit a validated projection command should return the committed projection version when synchronous projection is used.

When asynchronous projection is used, return:

- accepted job ID
- current known projection version
- status endpoint
- retry guidance

Do not claim immediate access change before the projection commits.

## Ordering

Ordering must be deterministic per Subscription Instance.

Do not depend solely on worker arrival order.

The Stage 1 plan must define the canonical ordering tuple, considering:

- provider effective timestamp
- provider event timestamp
- transaction sequence or lineage
- provider transaction identifier
- normalized fact type precedence where required
- received timestamp only as a final deterministic tie-breaker
- fact ID as a final stable tie-breaker

Provider-specific ordering rules must be documented.

---

# Failure Model

The implementation must account for the following failures.

## Duplicate Facts

Expected behaviour:

- deduplicate logical provider facts
- preserve repeated validation attempts
- avoid duplicate projection changes
- avoid duplicate webhooks

## Out-of-Order Facts

Expected behaviour:

- store the fact
- detect projection impact
- reproject from the correct checkpoint
- preserve prior projection history
- emit a new authoritative snapshot only when state changes or projection metadata requires it

## Missing Facts

Expected behaviour:

- preserve current valid state until the accepted staleness or uncertainty policy requires otherwise
- expose pending reconciliation
- avoid fabricating expiration or renewal
- use reconciliation from Phase 9A
- move to unknown when evidence is insufficient according to approved policy

## Provider Unavailable

Expected behaviour:

- preserve last authoritative server projection
- mark validation or synchronization freshness
- retry according to policy
- avoid converting unavailable to inactive
- keep SDK cache within its accepted offline window

## Projection Worker Crash

Expected behaviour:

- transaction rollback
- idempotent retry
- no partial current snapshot
- no orphan webhook event
- observable failed job
- safe replay

## Concurrent Facts

Expected behaviour:

- serialize projection per Subscription Instance or Customer scope according to the plan
- use row-level locks, advisory locks, or accepted compare-and-swap
- avoid last-write-wins
- re-read current projection version inside the transaction

## Identity Conflict

Expected behaviour:

- quarantine or hold association
- do not grant access to either candidate Customer automatically
- expose operator-safe diagnostics
- preserve provider facts
- require explicit trusted resolution

## Product Mapping Conflict

Expected behaviour:

- quarantine affected facts
- do not guess
- preserve historical mapping versions
- reproject only after accepted repair

## Grant Rule Change

Expected behaviour:

- create a new grant version
- define whether it applies prospectively, retrospectively, or both
- require an explicit owner-approved policy
- never silently rewrite historical Entitlement meaning

## Webhook Destination Failure

Expected behaviour:

- committed state remains authoritative
- retry with bounded backoff
- preserve delivery attempts
- expose dead-letter or exhausted state
- permit authorized replay
- do not roll back state because delivery failed

## SDK Offline

Expected behaviour:

- use bounded cached snapshot
- expose snapshot age
- preserve last known customer identity
- deny or report unknown after cache validity expires according to policy
- never extend access indefinitely unless explicitly approved

## Clock Skew

Expected behaviour:

- server uses trusted server time for snapshot issuance
- provider effective timestamps remain distinct
- SDK uses server-issued `valid_until`
- client clock is not the only source of truth
- large skew produces diagnostics


# Core Domain Model

## Billing Customer

A Billing Customer is the Project-scoped authoritative subject whose access Mosaic computes.

A Billing Customer should contain:

- stable Billing Customer ID
- Project ID
- lifecycle status
- created timestamp
- updated timestamp
- current authoritative Entitlement Snapshot ID
- current projection version
- last projected timestamp
- deletion or anonymization metadata where policy requires it
- diagnostics state
- audit metadata

A Billing Customer is not:

- an email address
- a provider customer object
- a device
- an installation
- a store account
- a RevenueCat subscriber record
- an arbitrary analytics subject

The relationship between analytics identity and billing identity must be explicit.

Do not assume that an analytics subject is automatically a Billing Customer.

## Customer Alias

A Customer Alias links an accepted external identity to one Billing Customer.

Alias types may include:

- application user ID
- installation ID
- Apple app-account token or accepted equivalent
- Google obfuscated account identifier or accepted equivalent
- trusted application-backend identity
- provider-specific lineage identity where it represents the same customer rather than only a transaction

Each alias should contain:

- alias ID
- Project ID
- alias type
- protected alias value or approved irreversible representation
- Billing Customer ID
- effective start
- effective end where applicable
- source authority
- verification status
- created metadata
- revoked metadata
- audit history

Alias values must be protected according to their sensitivity.

Do not expose raw sensitive provider identity values unnecessarily.

## Customer Association Evidence

A validated provider fact may be associated with a Billing Customer only through accepted evidence.

Evidence may include:

- verified application account token
- verified obfuscated external account ID
- trusted server observation containing an authorized Billing Customer reference
- previously accepted provider lineage associated with the same Billing Customer
- an explicit restore or link operation authenticated for the same user
- an operator-approved identity repair workflow defined later

Phase 9B should support only evidence types approved in the Stage 1 plan.

Do not associate a fact using:

- email
- IP address
- display name
- Product choice
- device model
- locale
- approximate timing
- transaction amount
- analytics behaviour

If association is unresolved or conflicting, the fact remains valid but access projection for a customer must not proceed automatically.

## Purchase Lineage

A Purchase Lineage groups validated facts that describe one provider purchase chain.

Examples may include:

- Apple original transaction chain
- Google subscription chain connected through linked purchase tokens
- one-time non-consumable ownership lineage
- provider-specific purchase chain defined by validated identifiers

A Purchase Lineage should contain:

- Purchase Lineage ID
- Project ID
- Environment ID
- Application ID
- provider
- provider lineage key or protected representation
- Product lineage
- Billing Customer ID when resolved
- lineage type
- sandbox or production
- created timestamp
- current projection checkpoint
- diagnostic status
- source mapping version
- audit metadata

Do not merge two provider lineages because they share a Product or customer unless the accepted identity and provider semantics prove they belong together.

## Subscription Instance

A Subscription Instance is Mosaic’s authoritative projection unit for one recurring purchase lineage.

It should contain:

- Subscription Instance ID
- Purchase Lineage ID
- Billing Customer ID
- Project ID
- Environment ID
- Application ID
- provider
- current Mosaic Product ID
- current provider Product identity
- subscription group or base-plan context where relevant
- current authoritative Subscription Snapshot ID
- current projection version
- created timestamp
- updated timestamp
- terminal timestamp where applicable
- diagnostic status

The Subscription Instance row may point to the current projection, but it must not be the only record of state history.

## One-Time Purchase Instance

A One-Time Purchase Instance represents validated ownership of a supported non-consumable Product.

It should contain:

- One-Time Purchase Instance ID
- Purchase Lineage ID
- Billing Customer ID
- Product ID
- provider
- acquisition timestamp
- current validity state
- revocation or refund effective timestamp where applicable
- current projection version
- source fact links
- audit metadata

Consumables remain excluded.

## Subscription Snapshot

A Subscription Snapshot is an immutable projected state for one Subscription Instance at one projection version.

It should contain:

- Subscription Snapshot ID
- Subscription Instance ID
- projection version
- projection-rule version
- computed-at timestamp
- `as_of` timestamp
- access state
- renewal intent
- billing state
- period start
- period end
- grace-period end
- billing-retry start
- pause start or resume time where supported
- cancellation effective time
- expiration effective time
- revocation effective time
- refund effective time
- current Product ID
- prior Product ID where transition applies
- provider status metadata required for explanation
- uncertainty status
- terminal status
- source fact range or references
- checksum
- projection reason
- created metadata

Snapshots are immutable.

Changing state creates a new Snapshot.

## Subscription Timeline Entry

A Timeline Entry is an immutable human- and machine-readable explanation of a relevant change.

Timeline types may include:

- purchase started
- purchase validated
- trial started
- renewal validated
- auto-renew enabled
- auto-renew disabled
- cancellation requested
- grace period started
- grace period ended
- billing retry started
- billing recovered
- pause scheduled
- pause started
- pause ended
- Product upgraded
- Product downgraded
- expiration
- refund
- revocation
- customer association changed
- Product resolution repaired
- projection replayed
- projection rule upgraded

A Timeline Entry should contain:

- Timeline Entry ID
- Subscription Instance ID or One-Time Purchase Instance ID
- effective timestamp
- observed timestamp
- entry type
- old snapshot ID where applicable
- new snapshot ID where applicable
- Product IDs
- source fact IDs
- explanation code
- safe explanation details
- projection-rule version
- created timestamp

Timeline entries must not expose raw provider secrets.

## Entitlement Definition

An Entitlement Definition already exists from earlier phases.

Phase 9B must preserve:

- stable Entitlement ID
- Project scope
- key
- internal name
- description
- lifecycle state
- created metadata
- archive metadata

An Entitlement Definition describes access meaning.

It is not customer state.

## Product-to-Entitlement Grant Version

A Product-to-Entitlement Grant Version defines which Entitlements a Product grants and when that rule applies.

It should contain:

- Grant Version ID
- Project ID
- Product ID
- Entitlement ID
- grant-policy version
- effective start
- effective end where applicable
- supported purchase types
- access policy for active state
- access policy for grace period
- access policy for billing retry where approved
- access policy for paused state where approved
- access policy for one-time ownership
- created metadata
- actor
- reason

The plan must define whether Product grant changes are:

- prospective only
- retroactive
- selectable by effective date
- or represented through Product replacement

Do not silently choose retroactive behaviour.

## Entitlement Source

An Entitlement Source explains one valid reason that a Billing Customer currently has or may have an Entitlement.

It should contain:

- Entitlement Source ID
- Billing Customer ID
- Entitlement ID
- source type
- Subscription Instance ID or One-Time Purchase Instance ID
- Product ID
- Grant Version ID
- source Snapshot ID
- source start
- source end
- source state
- uncertainty state
- effective priority only where needed
- explanation code
- created metadata

Source types may include:

- active subscription
- trial
- verified grace period
- accepted billing-retry access
- valid one-time non-consumable purchase
- Family Sharing source where explicitly supported

Manual access grants remain excluded unless later approved.

## Customer Entitlement Snapshot

A Customer Entitlement Snapshot is an immutable authoritative view of all Entitlements for one Billing Customer at one projection version.

It should contain:

- Customer Entitlement Snapshot ID
- Billing Customer ID
- projection version
- projection-rule version
- computed-at timestamp
- `as_of` timestamp
- Entitlement entries
- source references
- unknown or unavailable evidence
- checksum
- previous Snapshot ID
- change reason
- created metadata

A current pointer may identify the latest committed Snapshot.

The Snapshot must be reconstructable from underlying source projections and grant versions.

## Entitlement Entry

Each Entitlement entry should contain:

- Entitlement ID
- Entitlement key
- authoritative state
- effective start
- effective end where known
- refresh recommended at
- source count
- source IDs
- primary explanation
- uncertainty reason where relevant
- Product IDs
- Subscription Instance IDs
- Snapshot version

Suggested authoritative states:

- active
- inactive
- unknown
- unavailable

Do not add a large flat state enum where source-level detail provides the explanation.

## Access Decision Snapshot

An Access Decision Snapshot is the server response shape or materialized view used by application backends and SDK synchronization.

It should include:

- Billing Customer ID
- Entitlement Snapshot version
- issued-at timestamp
- `as_of` timestamp
- refresh-after timestamp
- valid-until timestamp for bounded client caching
- Entitlement entries
- data freshness
- projection status
- correlation ID
- optional signature or integrity metadata if approved

An Access Decision Snapshot is not a bearer credential unless explicitly designed as one.

---

# Subscription State Model

Do not model every provider concept as one flat enum.

Use multiple explicit axes and derive a canonical human-readable state.

## Access State

Suggested access states:

- active
- inactive
- unknown
- unavailable

This axis answers whether the subscription source currently grants access under accepted policy.

## Lifecycle State

Suggested lifecycle states:

- trialing
- active
- grace_period
- billing_retry
- paused
- expired
- revoked
- refunded
- superseded
- unknown

This axis explains the provider lifecycle.

## Renewal Intent

Suggested renewal-intent values:

- auto_renew_enabled
- auto_renew_disabled
- provider_managed
- paused
- unknown

Cancellation usually changes renewal intent before it changes access.

Do not model `cancelled` as immediate inactive access unless provider facts prove the effective access end has occurred.

## Billing State

Suggested billing-state values:

- current
- retrying
- grace
- failed
- refunded
- revoked
- unknown

## Uncertainty State

Suggested uncertainty values:

- none
- provider_unavailable
- missing_fact
- identity_unresolved
- Product_unresolved
- conflicting_facts
- projection_failed
- stale_validation
- unsupported_provider_state

Unknown and unavailable must remain explainable.

---

# Canonical State Derivation

The plan must define a deterministic derivation from the state axes.

Example conceptual derivation:

```text
if revoked is effective:
    lifecycle = revoked
    access = inactive

else if refund invalidates ownership and is effective:
    lifecycle = refunded
    access = inactive

else if current verified period is active:
    if trial:
        lifecycle = trialing
    else:
        lifecycle = active
    access = active

else if verified grace period is active and policy grants access:
    lifecycle = grace_period
    access = active

else if verified billing retry is active:
    lifecycle = billing_retry
    access = policy-dependent active or inactive

else if verified pause is effective:
    lifecycle = paused
    access = provider-and-policy-dependent

else if verified period ended:
    lifecycle = expired
    access = inactive

else:
    lifecycle = unknown
    access = unknown
```

This is conceptual only.

The implementation must use accepted provider normalization and approved access policies.

Do not use this example as a substitute for reviewing current provider semantics.

---

# Subscription State Transition Table

The Stage 1 plan must produce a complete transition table.

At minimum, evaluate transitions such as:

| Prior state | Validated fact | Effective result | Access expectation |
|---|---|---|---|
| none | initial purchase validated | trialing or active | active |
| trialing | renewal validated | active | active |
| active | renewal validated | active with new period | active |
| active | auto-renew disabled | active with renewal off | active until period end |
| active | cancellation effective at period end | active until period end | active |
| active | grace period begins | grace period | policy-defined, normally active when provider confirms grace |
| grace period | payment recovered | active | active |
| grace period | grace ends without recovery | expired | inactive |
| active | billing retry begins | billing retry | policy-defined |
| billing retry | payment recovered | active | active |
| billing retry | retry ends without recovery | expired | inactive |
| active | pause scheduled | active until pause effective | active |
| active | pause effective | paused | provider-defined |
| paused | resume effective | active or billing retry | provider-defined |
| active | refund effective | refunded | inactive where refund invalidates source |
| active | revocation effective | revoked | inactive |
| expired | late renewal fact validated | active with reprojection | active after effective renewal |
| active Product A | upgrade fact effective | active Product B | active, Product grants re-evaluated |
| active Product A | downgrade scheduled | Product A until effective change | active |
| Product A period end | downgrade effective to Product B | active Product B | active |
| any | conflicting valid facts | unknown or deterministic provider-precedence result | never guess |
| any | duplicate fact | unchanged | unchanged |
| any | out-of-order fact | deterministic reprojection | derived from effective timeline |

The actual table must cover supported Apple and Google facts separately where semantics differ.

Do not force provider-specific behaviour into a misleading universal transition.

---

# Transaction Ordering and Effective Time

Each fact should distinguish:

- provider effective time
- provider event time
- provider transaction time
- provider expiration time
- received time
- validation time
- projection time

The plan must define which timestamp drives each transition.

Examples:

- cancellation notice may change renewal intent immediately but access only at period end
- refund may be effective at a provider-supplied revocation time
- late renewal may reactivate a period whose effective time predates receipt
- upgrade may have immediate or next-period effect
- downgrade may be deferred
- pause may have a scheduled future effective time

Do not sort only by `received_at`.

## Deterministic Tie-Breaking

If two facts have the same effective timestamp, use a documented provider-aware precedence and stable tie-breaker.

Potential tie-break inputs:

- provider sequence number
- transaction lineage position
- provider fact type precedence
- provider transaction ID
- fact ID

The same facts must order identically during replay.

## Supersession

Some provider facts supersede or replace earlier purchase lineage.

Represent supersession explicitly.

Do not delete the earlier Subscription Instance.

A superseded source may stop granting access while remaining visible in history.

---

# Projection Checkpoints

Projection may use checkpoints for efficiency.

A checkpoint should contain:

- Subscription Instance ID
- last projected ordered-fact position
- projection-rule version
- current Snapshot ID
- checksum
- created timestamp

Checkpoint rules:

- checkpoints are derived and rebuildable
- replay may ignore checkpoints
- out-of-order facts invalidate affected checkpoints
- checkpoint corruption must not corrupt source facts
- checkpoint use must not change deterministic output

Do not use a checkpoint as the only copy of state history.

---

# Projection Rule Versioning

Every Subscription Snapshot and Customer Entitlement Snapshot must record the projection-rule version.

Changing state semantics requires:

- documented reason
- version increment
- compatibility analysis
- shadow replay
- impact report
- owner approval when access may change
- controlled promotion
- rollback plan

Do not silently deploy new projection semantics that change customer access.

## Shadow Projection

For access-affecting rule changes, support a shadow projection process.

Shadow projection should:

- replay selected or all customers using the candidate rule version
- compare current and candidate state
- report changes
- classify expected and unexpected differences
- avoid changing authoritative pointers
- support sampling and full runs
- produce auditable results

Promotion requires explicit approval.

---

# Customer Association

## Association Before Projection

A validated fact may project to a customer only when accepted association evidence exists.

If no customer can be resolved:

- preserve the fact
- record unresolved association
- expose diagnostics
- allow accepted restore or trusted linking workflows
- do not create an arbitrary Customer silently

## Creating a Billing Customer

A Billing Customer may be created when:

- a trusted application backend identifies a new customer
- an SDK presents an accepted customer access token bound to an application user
- an approved anonymous installation mode creates an installation-scoped customer
- a validated provider identity is explicitly linked through an accepted flow

The Stage 1 plan must define which creation modes are supported.

## Conflicting Association

If one purchase lineage appears associated with more than one Billing Customer:

- freeze projection for the disputed lineage
- preserve the last authoritative state according to approved safety policy
- mark uncertainty
- expose a conflict
- require trusted resolution
- audit all actions

Do not duplicate the same purchase across two customers.

## Reassociation

Reassociation is high risk.

Phase 9B should support reassociation only if essential for restore and identity correction.

The plan must define:

- authorization
- proof required
- effect on historical snapshots
- webhook behaviour
- SDK cache invalidation
- audit history
- replay
- rollback

Bulk reassociation remains Phase 9C.

---

# Product-to-Entitlement Grant Evaluation

## Effective Grant Selection

For each active purchase source, select the applicable Product-to-Entitlement Grant Version using accepted rules.

The plan must define whether selection uses:

- purchase effective time
- current projection time
- Product version
- explicit grant policy version stored with the transaction fact
- another accepted deterministic key

Do not use whichever grant row is currently active without historical analysis.

## Prospective Versus Retroactive Changes

The owner must approve one or more supported policies.

Possible policies:

### Prospective

New grant rules apply only to new purchases or renewals after the effective time.

### Retroactive

New grant rules intentionally update existing valid purchase sources.

### Product Replacement

Historical purchases keep old grants; new Product versions carry new grants.

The dashboard must show the selected policy before a grant change is published.

Do not silently apply retroactive changes.

## Multiple Entitlement Sources

If several sources grant one Entitlement:

```text
Pro Monthly subscription
+ Lifetime purchase
+ Family-shared source
= Pro Entitlement active while any accepted source remains active
```

The Entitlement entry should expose all contributing sources.

Do not select one source and discard the others.

## Source End

An Entitlement Source ends when:

- its Subscription Snapshot no longer grants access
- its One-Time Purchase is revoked or refunded
- its Product grant version ends according to policy
- customer association is invalidated
- a Family Sharing source ends
- a superseding provider fact ends the source

Ending one source triggers customer Entitlement reprojection.

---

# Authoritative Entitlement Computation

For each Billing Customer:

1. load current accepted subscription and one-time purchase projections
2. identify valid access-granting sources
3. resolve applicable Product grant versions
4. produce Entitlement Sources
5. group sources by Entitlement
6. derive authoritative state
7. preserve unknown evidence
8. create an immutable Customer Entitlement Snapshot
9. atomically update the current Snapshot pointer
10. enqueue access-change webhooks if the committed state changed

## Active

An Entitlement is active when at least one accepted source actively grants it.

## Inactive

An Entitlement is inactive when:

- no source actively grants it
- all relevant evidence is resolved
- no critical unknown condition prevents a definitive result

## Unknown

An Entitlement is unknown when Mosaic cannot safely determine active or inactive because of:

- unresolved customer identity
- conflicting validated facts
- unresolved Product mapping
- projection failure
- stale or missing critical provider evidence according to policy
- unsupported provider state

## Unavailable

An Entitlement response may be unavailable when the authoritative service cannot currently provide a valid snapshot.

Unavailable is a service-delivery state, not customer access state.

## Effective End

When several sources grant one Entitlement, the effective end may be:

- the latest known end among active finite sources
- absent for a valid permanent source
- unknown if one active source has uncertain end

Do not report a misleading finite expiry when a permanent source exists.

## Explanation

Every Entitlement entry must expose a safe explanation.

Example:

```text
Entitlement: pro
State: active
Reason: Active yearly subscription
Product: Pro Yearly
Source: Subscription 01...
Valid through: 2027-04-01T12:00:00Z
Additional source: Lifetime Purchase
```

Do not expose raw provider tokens or secret identifiers.


# Subscription Scenarios

## Initial Purchase

When an initial validated purchase fact is associated with a Billing Customer:

1. resolve Product mapping history
2. create or locate the Purchase Lineage
3. create Subscription Instance or One-Time Purchase Instance
4. order the fact
5. project state
6. evaluate Product grants
7. create Customer Entitlement Snapshot
8. update authoritative pointers atomically
9. enqueue access-change webhook if state changed
10. make the new Snapshot available to server and SDK APIs

Do not grant access from an unvalidated client observation.

## Renewal

A validated renewal should:

- extend or create the accepted subscription period
- preserve the same lineage where provider semantics require it
- update current Product where applicable
- preserve prior Snapshots
- re-evaluate grant versions
- keep access active
- emit timeline and webhook changes only when relevant

A renewal that does not change Entitlement state may still create a new Subscription Snapshot and Timeline Entry.

The plan must decide whether it emits an Entitlement webhook when only expiry changes.

## Cancellation

Cancellation normally means future renewal is disabled.

It must not automatically revoke current access.

Expected behaviour:

- set renewal intent to auto-renew disabled
- preserve access through the validated current period
- show cancellation effective time
- emit subscription-state webhook
- emit Entitlement webhook only when the Entitlement payload or expiry semantics change according to policy
- transition to expired only when the effective end is reached without a valid renewal

## Expiration

Expiration occurs when:

- validated period end has passed
- no valid renewal extends the period
- no accepted grace or billing-retry access applies
- no later out-of-order fact reactivates the lineage

Expiration should:

- create a new Subscription Snapshot
- end related Entitlement Sources
- recompute Customer Entitlements
- emit access-change webhook if state changes
- preserve the complete timeline

## Grace Period

Grace-period handling must be provider-aware and policy-approved.

The plan must define:

- how grace start is identified
- how grace end is identified
- whether verified grace grants access
- how provider unavailable affects grace
- how late recovery is handled
- whether SDK cache may extend through grace end
- webhook semantics

Do not synthesize a grace period merely because payment failed.

## Billing Retry

Billing retry and grace period are not automatically identical.

The plan must define:

- normalized provider facts
- access policy
- retry start
- retry end
- recovery
- expiration
- unknown state when provider semantics are insufficient

Do not grant indefinite access during billing retry.

## Pause

For providers supporting pause:

- preserve access until pause is effective where provider facts require it
- represent paused lifecycle explicitly
- apply provider- and policy-approved access during pause
- represent scheduled resume
- handle resume, cancellation, or expiration
- preserve prior periods

Do not treat a scheduled pause as immediate inactive access.

## Refund

A validated refund should:

- identify the affected transaction or purchase lineage
- determine effective time
- determine whether it invalidates ownership
- create a refund Timeline Entry
- project the affected source
- recompute Entitlements
- preserve unrelated sources
- emit webhooks if state changes

Partial or ambiguous refunds must not be normalized as full revocation without provider evidence.

If partial refunds are outside supported Product types, quarantine or mark unsupported.

## Revocation

A validated revocation should:

- mark the affected source invalid at the provider effective time
- reproject state
- recompute Entitlements
- preserve unrelated sources
- emit high-priority access-change webhooks
- invalidate SDK cache on next refresh
- remain auditable

Do not delete the purchase history.

## Upgrade

An upgrade may be immediate or provider-scheduled.

The plan must define provider-specific mapping for:

- old Product
- new Product
- effective time
- proration context where informational
- prior lineage
- new lineage or linked token
- Entitlement grant changes
- overlapping periods

Mosaic does not compute financial proration.

Expected access behaviour:

- preserve valid access during transition
- avoid duplicate access sources when one source supersedes another
- apply new Product grants at the accepted effective time
- preserve old Product history
- emit subscription and Entitlement changes

## Downgrade

A downgrade is often scheduled for a future period.

Expected behaviour:

- current Product remains authoritative until effective change
- renewal intent records the scheduled Product where provider facts support it
- new Product grants apply only at effective time
- timeline shows scheduled change
- historical snapshots remain unchanged

Do not switch Product grants at scheduling time unless provider semantics require immediate effect.

## One-Time Non-Consumable

A validated one-time non-consumable purchase should:

- create or update One-Time Purchase Instance
- grant configured Entitlements
- remain active without a recurring expiration
- become inactive only after validated refund, revocation, association invalidation, or accepted Product rule change
- preserve acquisition history

Do not create recurring subscription periods for a one-time Product.

## Family Sharing

Family Sharing support must be explicit and provider-aware.

The Stage 1 plan must determine:

- which provider facts identify shared ownership
- whether server validation exposes sufficient ownership information
- whether the customer association is safe
- whether the Product permits sharing
- how a shared source ends
- how restore behaves
- how SDK diagnostics explain shared access

Do not create a Mosaic family graph unless separately approved.

Do not grant Family Sharing access based only on a client flag.

If server-side evidence is insufficient, mark the feature unsupported or unknown.

## Multiple Active Purchases

A customer may have:

- more than one subscription lineage
- one subscription and one lifetime purchase
- overlapping old and new Products
- purchases across providers
- purchases across platforms

The engine must:

- project each source independently
- detect invalid duplicate association where necessary
- aggregate Entitlements from all accepted sources
- avoid double-counting access
- explain contributing sources
- preserve provider independence

## Cross-Provider Purchase

If one customer purchases equivalent Products through Apple and Google:

- each purchase remains a separate source
- the same Entitlement may have multiple active sources
- refunding one source does not revoke the other
- customer identity must be explicitly linked
- Product mapping history remains provider-specific

Do not collapse provider lineages destructively.

---

# Restore and Cross-Device Synchronization

## Restore Objective

Restore should recover access already supported by validated provider facts or trigger accepted provider synchronization.

Restore must not fabricate access from local receipt presence alone.

## Restore Flow

A recommended flow is:

```text
SDK initiates native provider restore or sync
→ SDK obtains provider transaction references
→ SDK submits untrusted transaction observations
→ Phase 9A validates or recognizes duplicates
→ Phase 9B associates facts with Billing Customer
→ projection runs
→ SDK polls or refreshes authoritative Entitlement Snapshot
→ restored access is displayed
```

The exact platform flow must follow current provider semantics.

## Restore Result

Suggested server-aware restore outcomes:

- restored
- no additional purchases found
- validation pending
- identity unresolved
- Product unresolved
- provider unavailable
- failed

Do not return restored until authoritative server state reflects the restored source.

The native provider’s local restore success may be reported separately from Mosaic authoritative sync completion.

## Customer Access Token

A public SDK key alone is insufficient to authorize access to an arbitrary Billing Customer’s Entitlements.

The Stage 1 plan must define a secure customer-authentication mechanism.

Preferred model:

```text
Host application backend
→ authenticates its user
→ requests short-lived Mosaic Customer Access Token using secret server key
→ returns token to app
→ SDK uses token for Entitlement synchronization
```

A Customer Access Token should be:

- short lived
- scoped to Project and Environment
- scoped to one Billing Customer
- audience restricted
- revocable where practical
- signed
- free of provider secrets
- minimal in claims
- safe to refresh through the host backend

Do not let the SDK retrieve arbitrary customer state using only a guessable application user ID.

## Anonymous Mode

If anonymous installation-scoped Entitlements are supported:

- issue an opaque installation credential
- bind it to Project, Environment, and installation
- use rate limiting
- support rotation
- prevent querying another installation
- document transition to identified user
- prevent cache leakage after identity change

The owner must approve anonymous authoritative access.

## Cross-Device Synchronization

When the same identified Billing Customer uses several devices:

- all devices should receive the same authoritative Snapshot version
- provider purchase source may originate on any supported platform
- SDK cache remains device-local
- server state remains customer-scoped
- identity token controls access
- one device’s logout does not revoke the server customer
- identity reassociation follows accepted rules

## Sync API Behaviour

The SDK sync API should return:

- current Entitlement Snapshot version
- issued-at
- `as_of`
- refresh-after
- valid-until
- Entitlement entries
- source summaries
- projection status
- pending validation or reconciliation status where safe
- ETag or version token
- safe diagnostics

Support conditional requests.

A `304 Not Modified` should preserve the cached Snapshot.

---

# Offline SDK Entitlement Cache

## Purpose

SDK cache supports:

- UI continuity
- temporary offline feature gating
- reduced network use
- startup speed

It does not replace server authorization for protected backend resources.

## Cache Policy

The plan must define:

- storage location
- encryption or secure-storage use
- cache key
- customer identity binding
- Snapshot version
- issued-at
- refresh-after
- valid-until
- hard expiry
- stale grace if any
- logout invalidation
- identity-change invalidation
- application reinstall behaviour
- clock-skew handling

Do not allow one customer’s cache to be reused by another customer.

## Offline Access Policy

The owner must approve the offline access policy.

Possible policies include:

### Strict

After `valid_until`, state becomes unknown and premium UI is not granted.

### Bounded Grace

Previously active Entitlements remain locally active for a short approved interval after `valid_until`, while clearly marked stale.

### Server-Only

SDK cache informs UI, but protected actions always require application-server authorization.

The selected policy may differ by Entitlement sensitivity, but such complexity requires explicit approval.

Do not silently grant unlimited offline access.

## Cache Integrity

Use:

- atomic writes
- version checks
- identity binding
- checksum or accepted integrity protection
- secure storage where available for sensitive metadata
- last-known-valid preservation

If a new Snapshot is malformed or older:

- reject it
- preserve current cache
- emit diagnostics

## Cache State Model

Suggested cache states:

- fresh
- refresh recommended
- stale but within approved grace
- expired
- missing
- invalid
- belongs to different customer

The SDK public API should not hide these distinctions when they matter.

---

# Server Access Decision API

Provide a trusted server API for application backends.

Example conceptual endpoint:

```text
GET /api/v1/public/customers/{customer_id}/entitlements
```

The actual path should follow existing API conventions.

Authentication requires a secret server key with appropriate Project and Environment scope.

The response should include:

- Billing Customer ID
- Snapshot version
- `as_of`
- Entitlements
- source summaries
- projection status
- pending state
- ETag
- safe diagnostics
- correlation ID

Do not expose provider credentials or raw purchase tokens.

## Entitlement Check API

Provide a focused endpoint where justified:

```text
POST /api/v1/public/entitlements/check
```

Request may include:

- Billing Customer ID
- Entitlement keys
- expected Snapshot version where useful

Response should include:

- per-key state
- explanation
- Snapshot version
- `as_of`
- stale or pending status

Do not return a bare boolean without explanation and version context.

## Customer Creation and Token API

Where accepted, provide trusted endpoints for:

- create or get Billing Customer
- attach application user alias
- issue Customer Access Token
- revoke or rotate installation credential
- inspect identity conflicts
- request authoritative sync

These endpoints require strong authorization and tenant scope.

Do not let a public SDK key create arbitrary identified customers without an approved abuse model.

---

# Application Webhooks

Phase 9B may notify application backends of committed authoritative changes.

## Webhook Event Types

Suggested events:

- `customer.entitlements.changed`
- `subscription.state.changed`
- `subscription.period.changed`
- `subscription.renewal_intent.changed`
- `subscription.expired`
- `subscription.revoked`
- `subscription.refunded`
- `customer.billing_identity.conflict`
- `customer.projection.failed`
- `customer.projection.recovered`

Avoid provider-specific event names in the primary public webhook contract.

Provider facts remain available through diagnostics or linked source data.

## Webhook Event Model

A webhook event should contain:

- stable event ID
- event type
- event-contract version
- Project ID
- Environment ID
- Billing Customer ID
- Subscription Instance ID where applicable
- Entitlement Snapshot version
- prior Snapshot version
- `occurred_at`
- `created_at`
- changed fields
- current safe state
- source projection version
- correlation ID

Do not include:

- provider secrets
- raw purchase tokens
- private keys
- complete raw provider payloads

## Signing

Use the accepted webhook-signing system.

A signature should cover:

- timestamp
- event ID
- raw request body
- signing version

Support:

- key rotation
- multiple active verification keys during rotation
- replay-window guidance
- documented verification examples
- test endpoint

Do not invent a second unrelated signing system if one exists.

## Delivery

Webhook delivery is at least once.

Support:

- bounded timeout
- retry with exponential backoff and jitter
- stable event ID
- attempt history
- response code
- safe response excerpt limits
- exhausted state
- manual replay
- disable destination
- audit events
- tenant isolation

Webhook failure must not roll back customer state.

## Ordering

Webhook order may be delayed or retried.

Consumers must use:

- event ID
- Entitlement Snapshot version
- Subscription projection version
- occurred-at

Document that consumers should ignore older versions after applying a newer version.

Do not promise exactly-once delivery.

## Webhook Destinations

A destination should contain:

- Project and Environment
- URL
- enabled event types
- encrypted signing secret
- status
- created metadata
- last success
- last failure
- delivery statistics
- disabled metadata

Validate URLs against SSRF policy.

Do not allow unsafe internal-network destinations without an explicit self-hosted policy.

---

# Projection Processing Architecture

A recommended processing flow is:

```text
Phase 9A validated fact committed
→ projection job enqueued
→ acquire lineage lock
→ load ordered validated facts
→ resolve Billing Customer
→ project Subscription or One-Time Purchase
→ evaluate Product grant versions
→ project Customer Entitlements
→ commit Snapshots and current pointers atomically
→ create webhook events
→ release lock
→ dispatch webhooks asynchronously
```

## Locking

Use an accepted per-lineage or per-customer serialization mechanism.

Options may include:

- PostgreSQL advisory lock
- row-level lock
- compare-and-swap projection version
- accepted job uniqueness

The Stage 1 plan must choose and justify the mechanism.

Do not hold a database lock while calling external providers or webhook destinations.

## Transaction Boundary

The authoritative transaction should include:

- new Subscription Snapshot
- Timeline Entries
- Entitlement Sources
- Customer Entitlement Snapshot
- current pointer updates
- projection checkpoint
- webhook event creation
- audit event where required

Webhook delivery attempts occur outside the projection transaction.

## Idempotency

A projection command should include an idempotency key based on:

- target lineage or customer
- highest fact version or ordered position
- projection-rule version
- grant-rule version set

Repeated execution must not create duplicate logical Snapshots.

It may record an operational retry attempt separately.

## No-Change Projection

If replay produces the same authoritative state:

- avoid emitting a duplicate access-change webhook
- optionally record projection metadata or a no-change audit event
- advance checkpoint safely
- preserve deterministic checksum

---

# PostgreSQL Persistence Model

The Stage 1 plan must inspect existing tables and add only necessary migrations.

Likely concepts include:

- billing customers
- customer aliases
- customer association evidence
- purchase lineages
- subscription instances
- one-time purchase instances
- subscription snapshots
- subscription timeline entries
- projection checkpoints
- projection jobs
- projection attempts
- projection-rule versions
- Product-to-Entitlement grant versions
- Entitlement sources
- customer Entitlement snapshots
- customer Entitlement snapshot entries
- current customer Entitlement pointers
- customer access tokens or token metadata
- installation credentials where approved
- webhook destinations
- webhook signing keys
- webhook events
- webhook delivery attempts
- restore or synchronization jobs
- shadow projection runs
- shadow projection differences
- billing identity conflicts
- projection audit events

Do not create Phase 9C migration tables.

Do not duplicate Phase 9A validated-fact tables.

## Constraints

Use appropriate:

- primary keys
- foreign keys
- tenant scope
- Environment scope
- unique constraints
- check constraints
- explicit deletion behaviour
- immutable-row protections where practical
- justified indexes

Important constraints may include:

- alias unique by Project, type, and protected value while active
- Purchase Lineage unique by provider, Environment, Application, and lineage key
- projection version unique within Subscription Instance
- Entitlement Snapshot version unique within Billing Customer
- one current Snapshot pointer per Billing Customer
- one Entitlement entry per Entitlement per Snapshot
- webhook event ID unique
- delivery attempt number unique within webhook event and destination
- grant-version intervals cannot overlap for the same Product and Entitlement under the accepted policy
- customer token metadata cannot cross Environment

## Deletion

Billing history should not be cascade deleted casually.

The Stage 1 plan must define:

- customer deletion or anonymization
- retention
- audit preservation
- legal and product requirements
- backup implications
- webhook history
- provider fact retention

Do not use broad `ON DELETE CASCADE` without analysis.

---

# Security Model

## Authorization

Enforce server-side authorization for:

- customer lookup
- alias management
- customer token issuance
- Entitlement APIs
- projection replay
- shadow projection
- webhook destination management
- webhook replay
- customer diagnostics
- restore and sync jobs

Dashboard visibility is not authorization.

## Customer Access Tokens

If used, tokens must:

- be short lived
- be audience scoped
- be Project and Environment scoped
- bind one Billing Customer
- use accepted signing keys
- support key rotation
- avoid sensitive provider data
- be validated on every SDK sync request
- be rate limited
- be revocable through accepted mechanisms

Do not use a Project secret key inside mobile applications.

## PII and Sensitive Identifiers

Protect:

- application user IDs where sensitive
- installation credentials
- provider account tokens
- purchase lineage identifiers
- provider transaction references
- webhook signing secrets

Use:

- encryption
- approved hashing
- redaction
- least privilege
- access audit

Do not log raw values unnecessarily.

## SSRF

Webhook destinations and any operator-supplied URLs require SSRF protections.

Validate:

- scheme
- DNS resolution
- private-network policy
- redirects
- timeouts
- response-size limits
- IP changes
- self-hosted exceptions

## Rate Limits

Apply suitable limits to:

- SDK Entitlement sync
- customer token issuance
- server Entitlement checks
- restore and sync requests
- projection replay
- shadow projection
- webhook test
- webhook replay
- customer search

## Audit

Audit:

- customer creation
- alias attachment
- alias conflict resolution
- Product grant changes
- projection-rule changes
- shadow projection approval
- authoritative rule promotion
- replay
- reassociation
- webhook destination changes
- webhook key rotation
- manual sync
- access token issuance policy changes

Do not put secrets into audit records.

---

# Observability

Use OpenTelemetry and Zerolog.

Instrument:

- projection jobs
- projection latency
- facts processed
- out-of-order replays
- projection no-change rate
- projection failure
- identity conflict
- Product resolution conflict
- Entitlement Snapshot changes
- customer sync
- SDK cache responses
- ETag hits
- token issuance
- webhook events
- webhook delivery latency
- webhook retry count
- exhausted webhook delivery
- restore jobs
- shadow projection runs
- shadow projection differences
- replay
- lock contention
- worker backlog
- stale projections

Useful dimensions may include:

- Project ID
- Environment ID
- provider
- projection-rule version
- Product ID
- Entitlement ID
- safe state codes

Do not attach:

- raw user IDs
- purchase tokens
- transaction payloads
- secrets
- raw webhook bodies

## Alerts

Define alerts for:

- projection backlog
- projection failure rate
- stale authoritative state
- identity conflict spikes
- Product resolution quarantine
- webhook delivery exhaustion
- shadow projection unexpected changes
- high lock contention
- restore failure
- token issuance failure
- cross-tenant authorization failure
- database constraint failure

Alerts should be actionable and vendor-neutral.

---

# Performance and Capacity

Do not invent arbitrary targets without measurement.

Stage 1 must propose owner-approved budgets for:

- fact-to-authoritative-projection latency
- server Entitlement-check latency
- SDK sync latency
- cached SDK check latency
- projection replay throughput
- shadow projection throughput
- webhook event creation
- webhook delivery latency
- customer timeline query
- dashboard customer search
- lock contention
- worker backlog recovery

Record:

- median
- p95
- p99 where appropriate
- throughput
- error rate
- dataset
- concurrency
- environment
- resource use

Do not optimize with new infrastructure before measuring PostgreSQL and the existing worker system.


# Required Agent Execution Model

Use no more than four concurrent agents.

Run Phase 9B in six stages.

---

# Stage 1A: Product, Protocol, Backend, and Quality Inspection

Use exactly:

1. `mosaic-product`
2. `mosaic-protocol`
3. `mosaic-backend`
4. `mosaic-quality`

All four agents are read-only during Stage 1A.

---

## Product Agent

Review:

- Phase 9B scope
- accepted Phase 9A evidence
- customer-access use cases
- Product and Entitlement boundaries
- subscription-state requirements
- offline access expectations
- restore expectations
- cross-device synchronization
- application-backend authorization
- webhook requirements
- grace-period policy
- billing-retry policy
- pause policy
- Family Sharing expectations
- Product grant change policy
- identity conflict policy
- Phase 9C exclusions
- operational support expectations

Return:

- required scope
- deferred scope
- customer terminology
- subscription terminology
- Entitlement terminology
- access-state terminology
- Product grant policy options
- offline access policy options
- grace-period access policy
- billing-retry access policy
- pause access policy
- webhook event requirements
- observable acceptance criteria
- owner decisions
- product risks
- smallest complete Phase 9B workflow

Confirm:

- Phase 9B does not perform RevenueCat migration
- Phase 9B does not perform dual-run cutover
- Phase 9B does not add financial reporting
- manual paid-access grants remain excluded
- existing commerce adapters remain usable without Mosaic Billing
- Mosaic Billing remains optional
- server state is authoritative
- client cache is bounded
- Product replacement preserves history

Do not modify production code.

---

## Protocol Agent

Inspect:

- Billing Ingestion Contract v1
- Commerce Provider Contract
- Analytics Event Contract
- current identity contracts
- current Product and Entitlement models
- current SDK result types
- current webhook contracts
- current Configuration Delivery capability model

Propose separate versioned contracts where necessary:

```text
Authoritative Entitlement Contract v1
Customer Access Token Contract v1
Billing State Webhook Contract v1
```

Avoid introducing a contract when an accepted existing contract can be extended compatibly.

Define provider-independent concepts for:

- Billing Customer
- Subscription Snapshot
- renewal intent
- lifecycle state
- access state
- uncertainty
- Entitlement Snapshot
- Entitlement entry
- Entitlement source summary
- Customer Access Token claims
- SDK sync request and response
- ETag and version semantics
- webhook event
- webhook delivery metadata
- restore status
- projection status
- safe diagnostics

Do not put provider-native payloads into public contracts.

Do not modify production files during Stage 1A.

---

## Backend Agent

Inspect:

- Phase 9A schema
- Billing Event Ledger
- Normalized Transaction Facts
- Provider Product Mapping history
- reconciliation
- replay
- worker architecture
- job idempotency
- customer or analytics identity models
- Entitlement definitions
- Product-to-Entitlement grants
- current server API authentication
- current SDK authentication
- current webhook infrastructure
- current secret-signing infrastructure
- PostgreSQL transaction patterns
- advisory or row-lock use
- OpenAPI
- audit system
- backup and restore
- current tests

Propose:

- Billing Customer model
- alias model
- customer association evidence
- Purchase Lineage
- Subscription Instance
- One-Time Purchase Instance
- Subscription Snapshot
- Timeline
- projection checkpoints
- projection-rule versions
- Product grant versions
- Entitlement Sources
- Customer Entitlement Snapshots
- current authoritative pointers
- serialization strategy
- transaction boundaries
- event ordering
- state machine
- projection worker
- replay
- shadow projection
- customer sync
- token issuance
- webhook events and delivery
- restore workflow
- PostgreSQL migrations
- minimum sufficient tests

Do not modify production code during Stage 1A.

---

## Quality Agent

Perform a correctness, security, and operational readiness audit.

Review:

- Phase 9A fact immutability
- Product mapping history
- customer identity evidence
- cross-tenant boundaries
- sandbox and production boundaries
- potential double-grant paths
- potential accidental revocation paths
- provider-state ambiguity
- duplicate and out-of-order handling
- transaction ordering
- lock and concurrency risks
- replay determinism
- Product grant history
- offline cache risks
- customer token risks
- webhook signing
- SSRF
- privacy and PII
- retention
- backup implications
- existing SDK identity behaviour

Return:

- Phase 9B blockers
- unsafe assumptions
- required ADR checkpoints
- security risks
- correctness risks
- operational risks
- acceptable deferred work
- smallest required mitigations

Do not modify production code.

---

# Stage 1B: Dashboard and SDK Inspection

Use exactly:

1. `mosaic-dashboard`
2. `mosaic-flutter`
3. `mosaic-ios`
4. `mosaic-android`

All four agents are read-only during Stage 1B.

---

## Dashboard Agent

Inspect:

- Catalog
- Product and Entitlement detail
- Provider mappings
- transaction ledger
- quarantine
- existing customer or analytics identity UI
- permission system
- audit UI
- job status UI
- webhook settings
- current tables, filters, timelines, and diagnostics
- design-system components
- generated REST client
- existing tests

Return:

- Billing Customer information architecture
- customer search
- customer detail
- subscription timeline
- Entitlement detail
- Entitlement source explanation
- projection status
- identity conflict UI
- restore and sync UI
- shadow projection UI
- webhook destination UI
- webhook delivery UI
- server-access token guidance
- required empty, loading, permission, error, and recovery states
- exact files requiring modification
- minimum sufficient tests

Do not modify code.

---

## Flutter Agent

Inspect:

- current identity API
- installation identity
- customer token support
- networking
- secure storage
- Configuration Delivery cache
- commerce adapters
- restore flow
- analytics queue
- application lifecycle
- diagnostics
- current tests

Return:

- customer authentication design
- Entitlement sync API
- local cache design
- offline state model
- identity-change behaviour
- restore-and-refresh behaviour
- listener or stream API
- server-check integration
- exact files requiring modification
- minimum sufficient tests

Do not modify code.

---

## iOS Agent

Perform the equivalent inspection for:

- Swift API
- secure storage
- Keychain use
- StoreKit restore and sync
- application lifecycle
- concurrency
- current Entitlements
- background limitations
- diagnostics

Do not modify code.

---

## Android Agent

Perform the equivalent inspection for:

- Kotlin API
- encrypted or protected local storage
- Google Billing restore or active-purchase recovery
- lifecycle
- coroutines
- diagnostics

Do not modify code.

---

# Stage 1 Integration Contract

After Stage 1A and Stage 1B:

1. reconcile all reports
2. resolve terminology centrally
3. surface owner decisions
4. select authoritative customer authentication
5. select offline access policy
6. select grace-period access policy
7. select billing-retry access policy
8. select pause access policy
9. select Product grant change policy
10. select projection serialization strategy
11. select projection rule-version strategy
12. select webhook signing and delivery reuse
13. define state ordering
14. define Family Sharing support or exclusion
15. do not begin implementation with unresolved access-affecting decisions

Create:

```text
docs/plans/phase-9b-subscription-state-authoritative-entitlements.md
```

The plan must define:

- current provider documentation consulted
- Billing Customer model
- Customer Alias model
- customer-association evidence
- Purchase Lineage
- Subscription Instance
- One-Time Purchase Instance
- Subscription Snapshot
- state axes
- canonical state derivation
- complete transition tables
- provider-specific transition mappings
- transaction ordering
- effective-time rules
- supersession
- projection checkpoints
- projection-rule versioning
- shadow projection
- Product-to-Entitlement Grant Version
- prospective and retroactive policy
- Entitlement Source
- Customer Entitlement Snapshot
- Access Decision Snapshot
- server authorization
- Customer Access Token
- anonymous mode if approved
- SDK cache
- offline policy
- restore
- cross-device sync
- upgrades and downgrades
- refunds and revocations
- grace and billing retry
- pause
- Family Sharing support or explicit exclusion
- webhooks
- replay
- concurrency
- PostgreSQL migrations
- REST resources
- dashboard information architecture
- SDK architecture
- observability
- security
- performance targets
- minimum sufficient tests
- explicit Phase 9C exclusions
- integrated demonstration

Stop if any owner-level access or security decision remains unresolved.

---

# ADR Checkpoints

Claude must stop and request an ADR or owner decision before introducing any of the following if not already accepted:

- new primary database
- new queue or streaming platform
- new token-signing system
- new encryption-key system
- new webhook-signing system
- retroactive Product grant changes
- indefinite offline access
- manual customer Entitlement grants
- cross-Project identity
- automatic customer merge
- family-account graph
- projection semantics that revoke existing access
- new public breaking SDK API
- new authoritative state outside the projection engine
- direct provider calls inside the Entitlement read path
- synchronous webhook delivery inside the projection transaction

---

# Stage 2: Protocol, Backend, and Dashboard Implementation

Use exactly:

1. `mosaic-protocol`
2. `mosaic-backend`
3. `mosaic-dashboard`

These agents have non-overlapping write ownership.

---

## Protocol Agent Ownership

Own only:

- authoritative Entitlement contract schemas
- customer-access-token contract documentation
- billing-state webhook schemas
- contract fixtures
- contract changelogs
- compatibility documentation
- generated contract artifacts where established

Do not modify:

- Paywall Protocol semantics
- Configuration Delivery semantics
- Commerce Provider Contract semantics
- Placement Decision Contract semantics
- Analytics Event Contract semantics
- Experiment Assignment Contract semantics
- Billing Ingestion Contract semantics
- backend implementation files
- dashboard implementation files
- SDK implementation files

---

## Protocol Work Package 1: Authoritative Entitlement Contract v1

Implement:

- Billing Customer reference
- Entitlement Snapshot version
- issued-at
- `as_of`
- refresh-after
- valid-until
- Entitlement entries
- states
- source summaries
- Product references
- Subscription references
- uncertainty
- projection status
- ETag or version semantics
- diagnostics-safe metadata
- unknown field behaviour
- unsupported version behaviour

Create meaningful fixtures for:

- active subscription
- active trial
- active grace period
- inactive expired subscription
- unknown state
- one-time purchase
- multiple active sources
- refund of one source while another remains active
- bounded offline cache
- newer Snapshot
- older Snapshot rejection
- different-customer rejection

---

## Protocol Work Package 2: Customer Access Token Contract v1

Document:

- token issuer
- audience
- subject
- Project
- Environment
- Billing Customer
- issued-at
- expiry
- token ID
- key ID
- scopes
- version
- refresh expectations
- revocation expectations
- clock-skew policy

Do not put Entitlement state or provider secrets in the token unless an accepted design explicitly requires a signed offline claim.

Prefer using the token for authentication and retrieving a current Snapshot.

---

## Protocol Work Package 3: Billing State Webhook Contract v1

Implement:

- event ID
- event type
- contract version
- Project
- Environment
- Billing Customer
- Subscription Instance
- current Snapshot version
- previous Snapshot version
- changed Entitlements
- state summary
- occurred-at
- created-at
- projection-rule version
- source reason
- correlation ID
- signing metadata documentation

Create fixtures for:

- Entitlement activated
- Entitlement deactivated
- expiry extended
- subscription cancelled but access remains active
- refund
- revocation
- unknown-state transition
- webhook retry with same event ID

Do not include provider secrets or raw tokens.

---

## Backend Agent Ownership

Own:

- `apps/api/**`
- `apps/worker/**`
- PostgreSQL migrations
- authoritative projection engine
- customer identity
- Entitlement engine
- server APIs
- SDK sync endpoints
- webhook delivery
- replay and shadow projection
- OpenAPI
- observability
- backend tests
- backend documentation

Do not modify dashboard, protocol, or SDK production files.

---

# Backend Work Packages

## Backend Work Package 1: PostgreSQL Migrations

Add only migrations required by the accepted Phase 9B model.

Likely concepts include:

- billing customers
- customer aliases
- customer association evidence
- purchase lineages
- subscription instances
- one-time purchase instances
- subscription snapshots
- subscription timeline entries
- projection checkpoints
- projection attempts
- projection-rule versions
- Product-to-Entitlement Grant Versions
- Entitlement Sources
- customer Entitlement Snapshots
- customer Entitlement Snapshot entries
- current Snapshot pointers
- customer token metadata
- installation credentials where approved
- restore or synchronization jobs
- identity conflicts
- shadow projection runs
- shadow projection differences
- webhook destinations
- webhook signing keys
- webhook events
- webhook delivery attempts
- projection audit events

Do not create:

- RevenueCat migration tables
- bulk customer import tables
- cutover tables
- financial ledger tables
- manual paid-access grant tables
- Phase 9C repair-batch tables

Use:

- primary keys
- foreign keys
- Project and Environment isolation
- unique constraints
- check constraints
- immutable-row protections where practical
- explicit deletion behaviour
- justified indexes

Run migrations against:

- a clean Phase 9A database
- representative Phase 9A data
- accepted GA backup fixture where available

---

## Backend Work Package 2: Billing Customer and Alias Service

Implement:

- create or get Billing Customer through trusted flow
- list and retrieve Billing Customers
- attach application-user alias
- attach installation alias where approved
- attach provider identity evidence where approved
- inspect aliases
- revoke alias
- detect conflict
- preserve history
- permissions
- audit events
- stable errors

Do not:

- merge customers heuristically
- reassign a purchase lineage automatically
- expose protected alias values unnecessarily
- let public SDK keys query arbitrary customers

Use optimistic or transactional conflict protection.

---

## Backend Work Package 3: Customer Association Resolver

Implement deterministic association using approved evidence.

Return:

- resolved
- unresolved
- conflicting
- quarantined
- unsupported evidence

The resolver should:

- use explicit authority ranking
- preserve evidence links
- avoid side effects during dry-run
- be deterministic
- be replayable
- emit diagnostics
- support accepted restore flows

Do not guess.

A conflict should create or update a Billing Identity Conflict record.

---

## Backend Work Package 4: Purchase Lineage Service

Implement:

- create or locate Purchase Lineage
- enforce provider and Environment scope
- link validated facts
- detect duplicates
- resolve Product mapping history
- attach Billing Customer
- identify subscription versus one-time purchase
- detect supersession
- preserve historical mapping
- audit events

Do not merge lineages because they share a Product.

---

## Backend Work Package 5: Projection Ordering

Implement one canonical ordering component.

It must:

- order provider facts deterministically
- preserve provider effective time
- use provider-specific sequence where required
- use stable tie-breakers
- detect out-of-order additions
- identify affected checkpoint
- support replay
- expose safe diagnostics

Do not duplicate ordering logic across several services.

Document the ordering version.

---

## Backend Work Package 6: Subscription Projection Engine

Implement a pure or mostly pure deterministic projection core.

Inputs should include:

- ordered validated facts
- prior accepted checkpoint where valid
- Product resolution history
- projection-rule version
- approved provider semantics
- current server time only where explicitly required

Outputs should include:

- Subscription Snapshot candidate
- Timeline Entries
- checkpoint
- warnings
- uncertainty
- source fact links
- Product transition
- no-change indicator

The projection core should not:

- perform HTTP calls
- write to the database directly
- deliver webhooks
- query dashboard state
- mutate Phase 9A facts

Persist outputs through an application service transaction.

---

## Backend Work Package 7: One-Time Purchase Projection

Implement deterministic projection for supported non-consumables.

Support:

- acquisition
- duplicate acquisition fact
- refund
- revocation
- Product replacement history
- customer association
- current validity
- Timeline Entries
- source links

Do not support consumables.

---

## Backend Work Package 8: Subscription State Policies

Implement the owner-approved policies for:

- trial access
- active access
- grace-period access
- billing-retry access
- paused access
- cancellation
- expiration
- refund
- revocation
- unknown state
- provider unavailable
- stale validation

Policies must be versioned.

Do not hardcode access-affecting policy across handlers.

Provide one versioned policy interface or module.

---

## Backend Work Package 9: Product Grant Versioning

Implement:

- create Grant Version
- list versions
- validate intervals
- select effective version
- publish change
- prospective or approved retroactive policy
- impact preview
- Product usage
- Entitlement usage
- audit events

Do not mutate an active historical Grant Version.

If retroactive change is approved:

- require impact analysis
- require shadow projection
- require explicit confirmation
- record actor and reason

---

## Backend Work Package 10: Entitlement Projection Engine

Implement a deterministic engine that:

- loads current purchase-source projections
- selects grant versions
- creates Entitlement Sources
- groups by Entitlement
- preserves uncertainty
- derives active, inactive, unknown, or unavailable state
- computes effective dates
- creates immutable Customer Entitlement Snapshot candidate
- identifies changes from prior Snapshot
- produces safe explanations
- produces webhook change set

Do not write to the database inside the pure computation core.

Do not collapse source history.

---

## Backend Work Package 11: Authoritative Projection Transaction

Implement one atomic application-service transaction that:

1. acquires accepted lock
2. reloads current projection version
3. loads new validated facts
4. projects Subscription or One-Time Purchase
5. writes immutable Snapshots
6. writes Timeline Entries
7. writes Entitlement Sources
8. writes Customer Entitlement Snapshot
9. updates current pointers
10. writes checkpoint
11. creates webhook events
12. writes audit event
13. commits
14. releases lock

Do not call external services inside the transaction.

Repeated execution must be idempotent.

---

## Backend Work Package 12: Projection Job Scheduling

Trigger projection when:

- Phase 9A validates a new fact
- Product resolution is repaired
- customer association is established
- grant version changes
- projection-rule version is promoted
- reconciliation discovers a fact
- replay or revalidation changes normalization
- authorized manual sync is requested

Use the existing worker system.

Support:

- job uniqueness
- retries
- bounded backoff
- dead-letter or exhausted state
- observability
- customer or lineage serialization

Do not enqueue an unbounded duplicate job storm.

---

## Backend Work Package 13: Replay

Implement:

- replay one Subscription Instance
- replay one Billing Customer
- replay a bounded Project scope where operationally approved
- select projection-rule version
- preserve prior Snapshots
- compare checksums
- create new projection versions only according to policy
- report no-change
- audit actor
- expose job status

Do not delete old Snapshots.

Do not make bulk migration replay tooling; that remains Phase 9C.

---

## Backend Work Package 14: Shadow Projection

Implement:

- candidate projection-rule version
- customer or bounded sample selection
- current versus candidate comparison
- Entitlement differences
- subscription-state differences
- expected versus unexpected classification
- summary
- detailed samples
- no authoritative pointer change
- audit history

Promotion must be a separate authorized action.

Do not auto-promote because a shadow run completed.

---

## Backend Work Package 15: Customer Access Token Service

Implement the accepted token model.

Support:

- trusted server request
- Billing Customer scope
- Project and Environment scope
- short expiry
- accepted scopes
- key ID
- key rotation
- revocation or invalidation policy
- audit events
- rate limiting
- safe response

Do not:

- expose Project secret keys to mobile apps
- allow one token to access another customer
- include provider secrets
- create long-lived unbounded tokens
- accept an unverified public user ID as authorization

---

## Backend Work Package 16: SDK Entitlement Sync Endpoint

Implement:

- Customer Access Token authentication
- optional installation credential mode where approved
- ETag or Snapshot version
- conditional request
- current Snapshot response
- `304 Not Modified`
- issued-at
- `as_of`
- refresh-after
- valid-until
- projection status
- pending validation state
- safe source summaries
- rate limiting
- observability

Do not call provider APIs synchronously on every read.

Read the authoritative committed projection.

---

## Backend Work Package 17: Trusted Server Entitlement APIs

Implement:

- Billing Customer lookup
- Entitlement Snapshot retrieval
- multi-key Entitlement check
- Subscription list
- Subscription Snapshot
- Timeline
- current sources
- projection status
- pending conflict status
- ETag
- pagination where needed
- authorization
- audit where sensitive

Do not return a bare boolean without version and state context.

---

## Backend Work Package 18: Restore and Sync Jobs

Implement accepted server-side coordination for restore.

Support:

- create sync job
- Billing Customer
- provider
- Application
- Environment
- submitted transaction observations
- Phase 9A validation references
- projection status
- completion
- unresolved identity
- unresolved Product
- provider unavailable
- retry
- audit events

Do not claim restore completed before authoritative projection reflects it.

---

## Backend Work Package 19: Webhook Destinations and Signing

Reuse the accepted webhook system where available.

Implement:

- create destination
- event subscriptions
- signing secret
- one-time secret display
- key rotation
- destination test
- enable and disable
- SSRF validation
- permission checks
- audit events

Do not store signing secrets in plaintext.

---

## Backend Work Package 20: Webhook Event Creation

Create webhook events only after committed authoritative state.

Support accepted event types.

Use stable event IDs.

Include Snapshot versions.

Do not emit duplicate logical access-change events during no-change replay.

---

## Backend Work Package 21: Webhook Delivery Worker

Implement:

- at-least-once delivery
- signature
- timestamp
- bounded timeout
- retries
- jitter
- attempt history
- response-size cap
- exhausted state
- manual replay
- destination disable
- metrics
- logs
- audit

Do not perform delivery inside the projection transaction.

---

## Backend Work Package 22: Projection Diagnostics and Health

Implement safe operational views for:

- projection backlog
- projection failure
- stale customer state
- identity conflicts
- Product conflicts
- unknown Entitlements
- shadow projection
- webhook backlog
- exhausted webhook delivery
- restore jobs
- lock contention
- rule versions

Do not expose secrets or raw provider payloads.

---

## Backend Work Package 23: OpenAPI and Documentation

Document all new REST resources.

Generate the dashboard client through the accepted workflow.

Document:

- server authentication
- customer token flow
- SDK sync
- server Entitlement checks
- state semantics
- unknown and unavailable
- webhook verification
- restore flow
- replay
- shadow projection
- grant version changes
- Phase 9C exclusions

---

## Backend Work Package 24: Observability

Add OpenTelemetry spans and metrics for:

- association
- lineage resolution
- ordering
- subscription projection
- Entitlement projection
- transaction commit
- replay
- shadow projection
- token issuance
- SDK sync
- webhook creation
- webhook delivery
- restore
- lock wait
- stale projection
- conflict

Use Zerolog with safe IDs.

Never log token values, raw aliases, provider tokens, or webhook secrets.

---

# Dashboard Agent Ownership

Own:

- Billing Customer features
- customer search
- customer detail
- subscription timeline
- Entitlement explanation
- projection status
- identity conflict UI
- restore and sync UI
- grant-version UI
- replay and shadow projection UI
- webhook settings and delivery UI
- feature-specific tests and documentation

Use the accepted design system.

Do not redesign Catalog, Studio, Placements, Analytics, or Experiments.

Do not add Phase 9C migration UI.

---

# Dashboard Work Packages

## Dashboard Work Package 1: Billing Customer Search

Implement search using accepted safe identifiers.

Support:

- Billing Customer ID
- approved application user ID lookup
- installation ID lookup where permission allows
- provider lineage reference lookup through protected workflow
- Project and Environment context
- pagination
- permission states
- no-result state
- identity-conflict indicator

Do not expose broad PII search.

---

## Dashboard Work Package 2: Billing Customer Detail

Show:

- Billing Customer ID
- lifecycle
- current Entitlement Snapshot version
- `as_of`
- last projected
- pending facts
- pending projection
- identity aliases
- identity conflicts
- subscriptions
- one-time purchases
- current Entitlements
- webhook status
- audit summary

Do not label unresolved state as inactive.

---

## Dashboard Work Package 3: Subscription Detail and Timeline

Show:

- provider
- Product
- lineage
- current lifecycle state
- access state
- renewal intent
- billing state
- current period
- grace
- billing retry
- pause
- scheduled Product change
- Timeline
- source facts
- projection version
- projection-rule version
- warnings
- replay action where allowed

Do not show raw purchase tokens.

---

## Dashboard Work Package 4: Entitlement Explanation

For each Entitlement show:

- state
- effective dates
- all contributing sources
- Product
- Subscription or one-time purchase
- Grant Version
- Snapshot version
- uncertainty
- explanation
- last updated
- refresh status

Users should be able to answer:

> Why does this customer have access?

and:

> Why does this customer not have access?

without reading raw provider payloads.

---

## Dashboard Work Package 5: Identity Conflict

Implement:

- conflict list
- affected aliases
- affected purchase lineage
- candidate Customers
- evidence
- current safety state
- authorized resolution action where approved
- audit history
- replay status
- cache invalidation guidance

Do not offer a one-click heuristic merge.

---

## Dashboard Work Package 6: Product Grant Versions

Implement:

- grant list
- version history
- effective dates
- prospective or approved retroactive mode
- impacted Products
- impacted Entitlements
- impact preview
- create new version
- shadow projection requirement
- publish
- audit

Do not edit a published Grant Version in place.

---

## Dashboard Work Package 7: Replay and Shadow Projection

Implement:

- select customer or subscription
- select projection-rule version
- replay
- job status
- comparison
- no-change result
- changed state
- shadow sample
- difference summary
- unexpected changes
- promotion readiness
- permission checks
- audit

Do not promote automatically.

---

## Dashboard Work Package 8: Restore and Synchronization

Implement:

- start restore or sync
- provider
- Application
- Environment
- current customer
- job status
- validation pending
- Product unresolved
- identity unresolved
- completed
- retry
- diagnostics
- recovery actions

Explain the distinction between:

- native provider restore
- server validation
- authoritative Mosaic projection

---

## Dashboard Work Package 9: Webhook Destinations

Implement:

- destination list
- create destination
- URL
- event types
- one-time signing secret
- test
- rotate secret
- disable
- delete where safe
- last success
- last failure
- delivery statistics
- permission states
- audit summary

Do not re-display signing secrets.

---

## Dashboard Work Package 10: Webhook Deliveries

Implement:

- event list
- event type
- Billing Customer
- Snapshot version
- destination
- attempts
- response codes
- next retry
- exhausted state
- replay
- safe response excerpt
- correlation ID
- filters
- diagnostics

Do not expose sensitive destination response data beyond accepted limits.

---

## Dashboard Work Package 11: Projection Health

Show:

- current backlog
- stale projections
- failed projections
- identity conflicts
- unknown Entitlements
- Product resolution conflicts
- restore backlog
- webhook backlog
- shadow-run status
- lock contention
- rule versions
- links to runbooks

---

# Stage 2 Validation

After each bounded work package, run relevant:

- Go formatting
- Go static checks
- Goose migration checks
- backend unit and integration tests
- worker tests
- dashboard formatting
- dashboard lint
- dashboard type checks
- dashboard tests
- OpenAPI generation validation
- contract fixture validation

Follow minimum sufficient testing.

Do not add tests merely because files are new.


# Stage 3: SDK Authoritative Entitlement Synchronization

Use exactly:

1. `mosaic-flutter`
2. `mosaic-ios`
3. `mosaic-android`

Each agent owns only its SDK, platform adapter modules, example applications, tests, and documentation.

Do not modify the canonical Authoritative Entitlement Contract.

---

# Shared SDK Requirements

Each SDK must support:

- Customer Access Token configuration
- optional approved anonymous installation credential
- authoritative Entitlement Snapshot fetch
- ETag or Snapshot version
- `304 Not Modified`
- Snapshot validation
- identity binding
- atomic cache replacement
- last-known-valid Snapshot
- issued-at
- `as_of`
- refresh-after
- valid-until
- cache state
- bounded offline policy
- manual refresh
- lifecycle-aware refresh
- refresh deduplication
- restore and sync coordination
- Entitlement listeners or streams
- subscription-summary access
- safe diagnostics
- logout and identity change
- customer-token expiry
- customer-token refresh handoff
- unsupported-contract handling
- no cross-customer cache leakage

The SDK must not:

- grant server-side access
- use the public SDK key to query arbitrary customers
- treat local provider state as authoritative Mosaic state
- overwrite a newer Snapshot with an older Snapshot
- extend offline access indefinitely
- expose provider secrets
- block purchase completion on Entitlement sync
- silently convert unknown to inactive
- fetch provider APIs directly for every Entitlement check

---

# Shared SDK Public API Shape

The actual language-specific API should remain idiomatic.

Conceptually support:

```text
configure customer authentication
identify or change customer
refresh Entitlements
read current Entitlement Snapshot
check one Entitlement
observe Entitlement changes
inspect cache state
start restore and authoritative sync
clear customer state on logout
```

## Entitlement Result

Do not return only a boolean.

A check should expose:

- state
- Snapshot version
- `as_of`
- cache state
- source summary
- effective dates
- unknown or unavailable reason
- whether refresh is recommended
- whether server verification is required

Example conceptual states:

```text
active
inactive
unknown
unavailable
```

## Snapshot Listener

Support an observable mechanism:

- Dart stream or listener
- Swift async sequence, observation, or documented callback
- Kotlin Flow or documented callback

Emit only accepted Snapshot changes.

Do not emit a change for a rejected older or malformed Snapshot.

---

# Customer Authentication in SDKs

## Token Provider

Prefer a callback or provider abstraction through which the host application supplies a current Customer Access Token.

The SDK should support:

- initial token
- refresh callback
- expiry awareness
- token replacement
- unauthorized response handling
- token-clear on logout
- bounded concurrent refresh
- safe diagnostics

Do not embed the application’s secret server key.

## Token Refresh

When the server returns unauthorized because the token expired:

1. invoke the accepted host token-refresh callback
2. avoid parallel refresh storms
3. retry once according to policy
4. preserve current cache
5. expose unavailable if refresh fails
6. do not silently switch customers

## Identity Binding

A Snapshot response must match the expected Billing Customer identity or accepted opaque subject.

If it does not:

- reject the Snapshot
- preserve current safe cache according to policy
- clear cache if cross-customer exposure is possible
- emit high-severity diagnostic
- do not show the mismatched Entitlements

---

# SDK Cache Requirements

## Storage

Use accepted platform persistence.

Protect sensitive metadata where appropriate.

The cache should include:

- contract version
- Billing Customer binding
- Snapshot version
- issued-at
- `as_of`
- refresh-after
- valid-until
- Entitlement entries
- checksum or accepted integrity metadata
- write timestamp

Do not store access tokens in ordinary unprotected preferences if a secure alternative is required.

## Atomicity

Cache writes must be atomic.

If a write fails:

- preserve prior cache
- do not leave a partial Snapshot
- emit diagnostics
- continue with prior accepted state where safe

## Monotonicity

Reject a Snapshot when:

- version is older than current
- `as_of` regresses unexpectedly
- customer binding differs
- contract version is unsupported
- checksum is invalid
- required fields are missing

A lower version may be accepted only through an explicit reset or Environment change.

## Identity Change

When the host changes Billing Customer:

- stop in-flight refresh for prior customer
- clear or isolate prior customer cache
- replace token provider context
- begin new customer sync
- avoid showing prior customer Entitlements during transition
- emit an explicit loading or unavailable state

Do not keep old active Entitlements visible for a new customer.

## Logout

On logout:

- clear current Customer Access Token
- clear or isolate identified-customer cache
- reset listeners
- preserve installation identity according to Phase 6 policy
- return to approved anonymous or no-customer state
- avoid leaking previous customer access

---

# Offline Behaviour

Implement the owner-approved policy exactly.

## Fresh Cache

When before `refresh_after`:

- return cached authoritative state
- avoid unnecessary network call
- permit background refresh only according to policy

## Refresh Recommended

Between `refresh_after` and `valid_until`:

- return cached state
- initiate or recommend refresh
- expose cache freshness
- avoid blocking UI

## Expired Cache

After `valid_until`:

- apply approved strict, bounded-grace, or server-only policy
- preserve last Snapshot for diagnostics
- do not pretend it is current
- return unknown or stale-active according to approved policy
- never extend indefinitely

## Client Clock

Use server-issued timestamps.

Handle client clock skew through accepted tolerance.

If the client clock is clearly invalid:

- expose diagnostics
- prefer conservative policy
- avoid indefinite access

---

# Restore and Authoritative Sync in SDKs

Provide a high-level operation conceptually similar to:

```text
restore purchases
→ native provider sync
→ submit transaction observations
→ wait or poll for validation
→ refresh authoritative Entitlement Snapshot
→ return combined result
```

The result should distinguish:

- native restore completed
- server validation pending
- authoritative Entitlements updated
- nothing found
- identity unresolved
- Product unresolved
- provider unavailable
- server unavailable
- failed

Do not collapse all stages into one ambiguous boolean.

## Purchase Completion Refresh

After a successful local provider purchase:

- submit the accepted transaction observation
- do not block the provider purchase result on network delivery
- trigger an Entitlement refresh
- expose validation pending if server state is not updated yet
- preserve local provider result separately
- avoid granting indefinite authoritative access before server validation

The host application may optimistically update UI according to its own policy, but Mosaic’s authoritative Entitlement result remains pending until server projection commits.

---

# Flutter Agent

Implement:

- Dart Authoritative Entitlement models
- Customer Access Token provider
- Entitlement sync client
- ETag support
- persistent cache
- atomic replacement
- cache states
- offline policy
- identity binding
- logout
- refresh deduplication
- retry
- Entitlement stream
- check API
- restore-and-sync API
- purchase-triggered refresh
- diagnostics
- example application
- documentation

Use idiomatic Dart.

Do not block the UI isolate.

Reuse accepted networking and storage abstractions.

Do not create a second identity system.

---

# iOS Agent

Implement:

- Swift Authoritative Entitlement models
- Customer Access Token provider
- async refresh
- ETag
- Keychain or accepted secure storage for token material
- atomic Snapshot persistence
- offline policy
- identity binding
- logout
- application lifecycle refresh
- async sequence, Observation, or accepted listener
- check API
- StoreKit restore and authoritative sync
- purchase-triggered refresh
- diagnostics
- SwiftUI example
- documentation

Use Swift concurrency.

Do not block the main actor.

Respect iOS background limitations.

Do not claim background sync is guaranteed.

---

# Android Agent

Implement:

- Kotlin Authoritative Entitlement models
- Customer Access Token provider
- coroutine refresh
- ETag
- accepted protected storage for token material
- atomic Snapshot persistence
- offline policy
- identity binding
- logout
- lifecycle-aware refresh
- Flow or accepted listener
- check API
- Google Play restore or active-purchase recovery and authoritative sync
- purchase-triggered refresh
- diagnostics
- Compose example
- documentation

Use Kotlin coroutines.

Do not block the main thread.

Respect Android background-execution limits.

---

# Stage 3 Cross-Platform Conformance

Use shared Authoritative Entitlement Contract fixtures.

Go, Dart, Swift, and Kotlin must agree on:

- state names
- unknown and unavailable semantics
- Snapshot version
- issued-at
- `as_of`
- refresh-after
- valid-until
- source summaries
- customer binding
- older Snapshot rejection
- unsupported contract rejection
- multiple sources
- permanent source
- refund of one source
- cache-state interpretation
- token-expiry handling outcomes

Do not accept semantic divergence.

---

# Stage 4: Integrated Demonstration

Use sandbox and test data only.

Do not use production customer data.

## Demonstration 1: Initial Subscription

1. create Billing Customer
2. issue Customer Access Token
3. complete validated Apple or Google purchase
4. associate fact with Billing Customer
5. project Subscription Snapshot
6. apply Product-to-Entitlement Grant Version
7. create Customer Entitlement Snapshot
8. fetch through server API
9. fetch through Flutter, iOS, and Android SDKs
10. confirm active Entitlement
11. inspect source explanation
12. inspect signed webhook delivery

## Demonstration 2: Renewal

1. ingest validated renewal
2. project new period
3. preserve prior Snapshot
4. extend Entitlement effective end
5. deliver state-change webhook according to policy
6. refresh SDKs
7. confirm monotonic Snapshot version

## Demonstration 3: Cancellation Without Immediate Revocation

1. ingest validated auto-renew-disabled fact
2. show renewal intent off
3. keep access active through period end
4. show scheduled expiration
5. confirm Entitlement remains active
6. confirm dashboard explanation
7. confirm webhook semantics

## Demonstration 4: Expiration

1. reach validated period end with no renewal
2. project expired state
3. remove subscription Entitlement Source
4. recompute Customer Entitlements
5. emit access-change webhook
6. refresh SDKs
7. confirm inactive state

## Demonstration 5: Multiple Sources

1. create active subscription source
2. create valid lifetime purchase source
3. grant same Entitlement
4. revoke or expire subscription
5. confirm Entitlement remains active through lifetime source
6. inspect both source histories

## Demonstration 6: Refund or Revocation

1. ingest validated refund or revocation
2. reproject affected source
3. preserve unrelated sources
4. update Entitlement state
5. deliver high-priority webhook
6. refresh SDKs
7. confirm history remains intact

## Demonstration 7: Grace and Recovery

1. ingest verified grace-period fact
2. apply approved access policy
3. show grace end
4. ingest payment recovery
5. project active state
6. preserve Timeline
7. refresh SDKs

## Demonstration 8: Out-of-Order Fact

1. project expiration
2. ingest late renewal with earlier effective time
3. detect out-of-order fact
4. invalidate checkpoint
5. reproject deterministically
6. create new authoritative Snapshot
7. preserve prior Snapshots
8. confirm expected access

## Demonstration 9: Upgrade or Downgrade

1. start on Product A
2. ingest validated Product transition
3. preserve old Product history
4. apply Product B grants at effective time
5. avoid double-grant errors
6. show Timeline and webhooks
7. confirm provider mapping history

## Demonstration 10: Restore Across Devices

1. identify same Billing Customer on two devices
2. purchase on device A
3. validate and project
4. refresh device B
5. confirm same Snapshot version
6. run restore on a third device
7. submit observations
8. confirm duplicate-safe validation
9. refresh authoritative state

## Demonstration 11: Offline Cache

1. fetch fresh Snapshot
2. disconnect network
3. read active Entitlement from cache
4. advance through refresh-recommended state
5. reach approved expiry policy
6. confirm state changes according to policy
7. restore network
8. fetch newer Snapshot
9. confirm atomic cache update

## Demonstration 12: Identity Conflict

1. associate one purchase lineage with Billing Customer A
2. submit conflicting trusted identity evidence for Billing Customer B
3. detect conflict
4. prevent double grant
5. preserve last accepted authoritative state according to policy
6. show dashboard conflict
7. resolve through approved workflow
8. replay projection
9. invalidate affected SDK caches

## Demonstration 13: Webhook Retry

1. commit Entitlement change
2. create webhook event
3. fail destination
4. retry with same event ID
5. recover destination
6. deliver successfully
7. inspect attempt history
8. confirm state never rolled back

## Demonstration 14: Replay and Shadow Projection

1. replay one customer with current rule version
2. confirm deterministic checksum
3. run candidate rule in shadow
4. compare differences
5. leave authoritative pointer unchanged
6. approve or reject candidate explicitly

---

# Stage 5: Product, UX, Protocol, and Quality Review

Use exactly:

1. `mosaic-product`
2. `mosaic-ux`
3. `mosaic-protocol`
4. `mosaic-quality`

All four are read-only.

---

## Product Review

Confirm:

- Phase 9B remained within scope
- Mosaic Billing remains optional
- validated facts remain the source
- authoritative state is explainable
- Product and Entitlement boundaries remain correct
- customer identity is explicit
- unknown is not inactive
- cancellation does not revoke early
- multiple sources behave correctly
- offline policy is bounded
- server APIs are authoritative
- migration and cutover remain Phase 9C
- manual paid-access grants remain excluded
- financial reporting remains excluded

Return:

- Approve
- Approve with changes
- Reject
- Owner decision required

---

## UX Review

Review:

- Billing Customer search
- customer detail
- subscription timeline
- Entitlement explanation
- renewal intent
- grace and billing retry
- expiration
- refund and revocation
- multiple sources
- identity conflict
- restore
- replay
- shadow projection
- grant versions
- webhook destinations
- webhook deliveries
- projection health
- unknown and unavailable language
- error recovery
- dead ends

Do not approve a UI that:

- describes cancellation as immediate expiry
- hides uncertainty
- hides contributing sources
- offers unsafe manual state override
- conflates provider facts with customer access
- conflates restore with immediate validation

---

## Protocol Review

Confirm:

- Authoritative Entitlement Contract is versioned
- Customer Access Token contract is documented
- Billing State Webhook Contract is versioned
- state semantics are provider-independent
- unknown and unavailable are distinct
- source summaries are safe
- Snapshot monotonicity is explicit
- older Snapshot rejection is explicit
- customer binding is explicit
- existing Paywall, Commerce, Placement, Analytics, Experiment, and Billing Ingestion contracts remain compatible
- no provider secrets appear in fixtures

---

## Quality Review

Review:

- PostgreSQL migrations
- tenant isolation
- Environment isolation
- append-only fact use
- customer association
- identity conflict
- Product mapping history
- event ordering
- out-of-order reprojection
- duplicate handling
- state machine
- cancellation semantics
- grace semantics
- billing-retry semantics
- pause semantics
- refund
- revocation
- upgrades and downgrades
- one-time purchases
- multiple sources
- grant versioning
- projection determinism
- transaction boundaries
- locks
- checkpoints
- replay
- shadow projection
- server APIs
- token security
- SDK cache
- offline expiry
- logout and identity change
- restore
- webhook signing
- webhook SSRF
- webhook retries
- observability
- backup implications
- minimum sufficient tests
- absence of Phase 9C migration work

Return findings ordered by severity with exact paths and symbols.

---

# Final Fix Pass

After reviews:

1. classify findings
2. assign backend findings to `mosaic-backend`
3. assign dashboard findings to `mosaic-dashboard`
4. assign Flutter findings to `mosaic-flutter`
5. assign iOS findings to `mosaic-ios`
6. assign Android findings to `mosaic-android`
7. assign contract findings to `mosaic-protocol`
8. reject speculative feature additions
9. rerun affected checks
10. rerun complete Phase 9B conformance
11. request one targeted final quality review

Limit the fix-and-review cycle to two rounds.

If blocking issues remain after two rounds, classify Phase 9B as rejected pending fixes.

---

# Minimum Sufficient Testing Policy

Follow:

```text
docs/architecture/conventions/testing.md
```

Do not add tests merely because code is new.

Do not recreate tests for:

- PostgreSQL internals
- pgx
- Goose
- Chi
- JWT or cryptography-library internals
- Keychain internals
- Android storage internals
- provider SDK internals
- HTTP client internals
- background-job library internals

The following identifies risks, not one required test per bullet.

## Projection Determinism Risk Coverage

Protect:

- same facts and rule versions produce same Subscription Snapshot
- same sources and grant versions produce same Entitlement Snapshot
- duplicate facts do not duplicate access
- out-of-order fact triggers correct reprojection
- checkpoint and full replay agree
- no-change replay does not emit duplicate access-change webhook
- older projection cannot overwrite newer projection
- rule version is recorded

## State Transition Risk Coverage

Protect:

- initial purchase grants access
- renewal extends state
- cancellation preserves access until effective end
- expiration removes only affected source
- grace follows approved policy
- billing retry follows approved policy
- pause follows provider and approved policy
- refund affects correct source
- revocation affects correct source
- upgrade applies new Product grants at effective time
- downgrade remains scheduled until effective time
- one-time purchase remains active until validated invalidation

## Entitlement Aggregation Risk Coverage

Protect:

- multiple sources aggregate correctly
- revoking one source preserves another valid source
- permanent source produces no misleading finite expiry
- unknown evidence remains unknown
- Product grant version is selected deterministically
- grant change follows prospective or approved retroactive policy
- archived Product remains historically resolvable
- Entitlement Snapshot source links are complete

## Identity Risk Coverage

Protect:

- public SDK key cannot query arbitrary customer
- Customer Access Token cannot cross Project or Environment
- Customer Access Token cannot access another customer
- alias conflict does not double grant
- identity change does not leak old cache
- logout clears identified-customer state
- historical events are not rewritten
- reassociation is audited and replayed

## Concurrency Risk Coverage

Protect:

- concurrent facts do not create conflicting current Snapshots
- current pointer and Snapshot commit atomically
- webhook event creation commits with state
- lock failure retries safely
- projection job retry is idempotent
- simultaneous refreshes do not corrupt SDK cache

## SDK Cache Risk Coverage

Protect:

- cache survives SDK reconstruction
- older Snapshot is rejected
- malformed Snapshot preserves prior cache
- wrong-customer Snapshot is rejected
- refresh-after and valid-until follow policy
- offline expiry follows approved behaviour
- token expiry invokes accepted refresh
- failed token refresh preserves safe state
- identity change prevents cache leakage
- `304` preserves cache

## Webhook Risk Coverage

Protect:

- signature verifies
- secret rotation works
- retries keep stable event ID
- webhook failure does not roll back state
- older webhook can be identified by Snapshot version
- exhausted delivery remains replayable
- SSRF policy rejects unsafe destination
- cross-tenant replay fails

## Security Risk Coverage

Protect:

- provider identifiers are redacted where required
- customer aliases are protected
- Project and Environment isolation holds
- token secrets are not logged
- signing secrets are not re-displayed
- sensitive diagnostics are permission-controlled
- no direct handler mutates Entitlements
- no Phase 9C migration endpoint exists

Every agent report must explain:

- tests added
- risk protected
- existing tests reused
- checks run
- unavailable provider or device checks
- why no new test was added where none was necessary

---

# Required Phase 9B Acceptance Criteria

Phase 9B is complete only when all of the following are true.

## Preconditions and Boundaries

- Phase 9A remains accepted.
- PostgreSQL remains the runtime system of record.
- no production in-memory fallback exists.
- Goose migrations exist for Phase 9B persistence.
- Phase 9A facts remain immutable.
- Phase 9B does not mutate raw provider facts.
- Mosaic Billing remains optional.
- RevenueCat, StoreKit 2, Google Play Billing, and custom providers remain usable without Mosaic Billing.
- no Phase 9C migration, bulk import, dual-run, or cutover feature was introduced.
- no financial reporting was introduced.
- no manual paid-access grant system was introduced.

## Billing Customer and Identity

- Billing Customers are Project-scoped.
- Customer aliases are typed.
- aliases are protected.
- alias history is preserved.
- customer association uses explicit trusted evidence.
- no heuristic identity merge exists.
- unresolved identity does not grant access.
- conflicting identity does not double grant.
- alias conflict is visible and auditable.
- reassociation follows an accepted protected workflow.
- historical facts are not rewritten after identity change.

## Purchase Lineage

- Apple purchase chains resolve deterministically.
- Google purchase chains resolve deterministically.
- one-time purchase lineages are supported.
- Product mapping history is respected.
- cross-Project lineages are rejected.
- sandbox and production remain isolated.
- lineages are not merged by Product similarity.
- supersession is explicit.
- historical lineages remain visible.

## Subscription Projection

- Subscription Snapshots are immutable.
- projection versions are monotonic.
- projection-rule version is recorded.
- state axes are explicit.
- cancellation does not revoke access early.
- renewal extends the accepted period.
- expiration is deterministic.
- grace period follows the approved policy.
- billing retry follows the approved policy.
- pause follows the approved policy.
- refunds are effective at validated provider time.
- revocations remove the affected source.
- upgrades and downgrades preserve history.
- one-time non-consumables project correctly.
- duplicate facts do not duplicate state.
- out-of-order facts trigger deterministic reprojection.
- checkpoint replay matches full replay.
- projection failures do not create partial current state.
- unknown remains distinct from inactive.
- unavailable remains distinct from customer state.

## Product Grants and Entitlements

- Product-to-Entitlement Grant Versions are immutable.
- grant effective intervals are valid.
- prospective or retroactive policy is explicit.
- historical grant meaning is preserved.
- Entitlement Sources link to Snapshots and Products.
- multiple sources aggregate correctly.
- one source revocation does not remove unrelated sources.
- permanent sources do not show false expiry.
- Customer Entitlement Snapshots are immutable.
- Entitlement Snapshot versions are monotonic.
- current Subscription and Entitlement pointers update atomically.
- every Entitlement state is explainable.
- unknown evidence remains visible.
- access changes produce a deterministic change set.
- no handler or UI action directly mutates authoritative Entitlements.

## Transactions and Concurrency

- one accepted transaction commits subscription state, Entitlement state, pointers, checkpoint, and webhook events.
- external calls do not occur inside the projection transaction.
- projection jobs are idempotent.
- per-lineage or per-customer serialization is enforced.
- concurrent facts do not create conflicting current Snapshots.
- current state cannot point to incomplete data.
- no-change projection avoids duplicate logical webhooks.
- worker restart does not lose accepted projection work.

## Replay and Rule Changes

- replay preserves prior Snapshots.
- replay is deterministic.
- replay records actor and version.
- shadow projection does not change authoritative state.
- shadow differences are visible.
- access-affecting rule promotion requires explicit approval.
- projection-rule rollback is documented.
- Product grant changes can be impact-previewed.
- retroactive changes cannot occur silently.

## Server APIs and Authentication

- trusted server Entitlement API works.
- server responses include Snapshot version and `as_of`.
- Entitlement checks return explicit states, not bare booleans.
- Customer Access Tokens are short lived.
- tokens are Project-scoped.
- tokens are Environment-scoped.
- tokens are customer-scoped.
- tokens are audience restricted.
- token keys rotate.
- token values are absent from logs.
- a public SDK key alone cannot query arbitrary customers.
- anonymous mode, if supported, is explicitly approved and isolated.
- rate limits are applied.

## SDK Synchronization

- Flutter fetches authoritative Entitlement Snapshots.
- iOS fetches authoritative Entitlement Snapshots.
- Android fetches authoritative Entitlement Snapshots.
- SDKs support ETag or Snapshot version.
- `304` preserves cache.
- caches are atomically replaced.
- older Snapshots are rejected.
- malformed Snapshots preserve prior cache.
- wrong-customer Snapshots are rejected.
- cache freshness states are visible.
- offline policy is enforced.
- offline access is not indefinite unless explicitly approved.
- token expiry follows accepted refresh behaviour.
- logout prevents prior customer cache leakage.
- identity change prevents cache leakage.
- Entitlement listeners emit only accepted changes.
- SDK state does not grant server-side access.
- local provider success remains distinct from authoritative server validation.
- restore returns explicit multi-stage status.

## Webhooks

- webhook events are created only after committed state.
- webhook events have stable IDs.
- webhook payloads include Snapshot versions.
- webhook payloads contain no secrets.
- signatures are verifiable.
- signing-key rotation works.
- delivery is at least once.
- retries use bounded backoff.
- delivery attempts are append-only.
- webhook failure does not roll back state.
- exhausted delivery is visible and replayable.
- destination SSRF protections work.
- cross-tenant webhook access fails.
- old events can be ordered using Snapshot version.

## Dashboard and Explainability

- Billing Customer search works through approved identifiers.
- customer detail shows current projection.
- subscription Timeline is complete.
- renewal intent is visible.
- grace and billing retry are visible.
- refunds and revocations are visible.
- Product transitions are visible.
- Entitlement sources are visible.
- users can answer why access is active or inactive.
- unknown and unavailable are visible.
- identity conflicts are visible.
- restore jobs are visible.
- replay and shadow projection are visible.
- Product Grant Version history is visible.
- webhook destination and delivery status are visible.
- projection health is visible.
- no unsafe manual Entitlement override exists.
- no Phase 9C migration UI exists.

## Security, Privacy, and Operations

- customer aliases are protected.
- customer tokens are protected.
- webhook secrets are encrypted.
- secrets are absent from logs and diagnostics.
- tenant isolation is enforced.
- Environment isolation is enforced.
- SSRF protections are enforced.
- sensitive endpoints are rate limited.
- audit events exist for high-risk actions.
- OpenTelemetry covers projection and webhook paths.
- operational alerts are defined.
- backup and restore include new Phase 9B tables.
- retention and deletion semantics are documented.
- no known critical double-grant path remains.
- no known critical accidental-revocation path remains.
- relevant checks pass.
- unavailable device or provider checks are documented honestly.

---

# Required Phase 9B Demonstration

The complete demonstration should show:

```text
Create Billing Customer
→ issue Customer Access Token
→ complete validated subscription purchase
→ associate purchase lineage
→ project active Subscription Snapshot
→ apply versioned Product grants
→ create authoritative Entitlement Snapshot
→ fetch through trusted server API
→ fetch through Flutter, iOS, and Android
→ deliver signed access-change webhook
→ disable auto-renew
→ confirm access remains active
→ expire subscription
→ confirm Entitlement becomes inactive
→ add lifetime purchase source
→ renew and later revoke subscription source
→ confirm lifetime source preserves access
→ enter grace period
→ apply approved access policy
→ recover payment
→ process out-of-order renewal
→ reproject deterministically
→ upgrade Product
→ apply new grants at effective time
→ run restore on another device
→ synchronize same customer state
→ disconnect network
→ use bounded SDK cache
→ expire cache according to policy
→ restore network and refresh
→ trigger identity conflict
→ prevent double grant
→ resolve through approved workflow
→ replay projection
→ run candidate rule in shadow
→ compare differences without changing state
→ fail webhook delivery
→ retry with same event ID
→ recover destination
→ confirm complete history and audit trail
```

The one-minute demo should focus on:

```text
Validated purchase
→ authoritative Pro Entitlement
→ cancellation keeps access through period end
→ expiration removes subscription source
→ lifetime source keeps access active
→ all three SDKs synchronize the same Snapshot
→ signed webhook reports the change
```

---

# Phase 9B Review Document

Create:

```text
docs/reviews/phase-9b.md
```

Use the following required structure.

## Status

Choose one:

- Accepted
- Accepted with tracked follow-ups
- Rejected pending fixes

## Baseline

Document:

- base commit
- branch
- worktree
- GA tag
- accepted Phase 9A review
- Authoritative Entitlement Contract version
- Customer Access Token contract version
- Billing State Webhook Contract version
- projection-rule version
- Product grant policy
- offline access policy
- grace-period policy
- billing-retry policy
- pause policy
- customer-association policy
- locking strategy
- webhook-signing strategy
- official Apple and Google documentation used

## Completed Deliverables

Group by:

- Billing Customers
- customer aliases
- association evidence
- purchase lineages
- subscription instances
- one-time purchases
- state machine
- ordering
- Snapshots
- Timeline
- projection checkpoints
- projection-rule versions
- Product Grant Versions
- Entitlement Sources
- Customer Entitlement Snapshots
- access APIs
- customer tokens
- restore
- replay
- shadow projection
- webhooks
- dashboard
- Flutter
- iOS
- Android
- migrations
- OpenAPI
- observability
- security
- tests

## Product Review

Include:

- validated demand
- phase boundaries
- Mosaic Billing optionality
- subscription-state value
- Entitlement value
- offline policy
- Product grant policy
- deferred Phase 9C migration
- deferred manual grants
- owner decisions

## UX Review

Include:

- customer search
- subscription detail
- Timeline
- Entitlement explanation
- cancellation
- grace
- billing retry
- refund
- revocation
- multiple sources
- identity conflict
- restore
- replay
- shadow projection
- webhook management
- projection health
- unknown and unavailable language
- dead ends
- task-completion findings

## Engineering Review

Include:

- migrations
- fact immutability
- lineage resolution
- ordering
- state machine
- projection determinism
- concurrency
- checkpoints
- replay
- Product grants
- Entitlement aggregation
- transaction boundaries
- token service
- SDK synchronization
- offline cache
- restore
- webhooks
- worker recovery
- performance
- tests
- unavailable checks
- known defects

## Protocol Review

Confirm:

- Authoritative Entitlement Contract is versioned
- Customer Access Token contract is documented
- Billing State Webhook Contract is versioned
- state semantics are provider-independent
- unknown and unavailable are distinct
- Snapshot monotonicity is explicit
- customer binding is explicit
- old or malformed Snapshots fail safely
- existing contracts remain compatible
- no provider secrets appear in fixtures

## Security Review

Confirm:

- customer aliases are protected
- customer tokens are protected
- Project and Environment scopes are enforced
- public SDK key cannot query arbitrary customers
- webhook secrets are encrypted
- webhook signatures verify
- SSRF protections exist
- cross-tenant access fails
- sensitive identifiers are absent from logs
- high-risk actions are audited
- no direct Entitlement mutation endpoint exists

## State-Machine Review

Include:

- supported states
- state axes
- provider mappings
- transition tables
- cancellation semantics
- expiration
- grace
- billing retry
- pause
- refund
- revocation
- upgrade
- downgrade
- one-time purchase
- out-of-order facts
- unknown facts
- unsupported provider states
- projection-rule version

## Entitlement Review

Include:

- Product grant versioning
- prospective or retroactive policy
- multiple sources
- permanent source
- source end
- unknown evidence
- effective dates
- explanations
- Snapshot versions
- webhook changes
- replay consistency

## SDK Review

Include:

- customer authentication
- Snapshot sync
- ETag
- cache atomicity
- cache monotonicity
- offline policy
- token refresh
- logout
- identity change
- restore
- listeners
- cross-platform conformance
- unavailable checks

## Webhook Review

Include:

- event types
- stable event IDs
- signatures
- retries
- ordering
- replay
- exhausted state
- destination security
- audit history

## Phase Boundary Review

Confirm:

- no RevenueCat migration exists
- no historical customer import exists
- no dual-run cutover exists
- no bulk repair migration tool exists
- no financial reporting exists
- no manual paid-access grants exist
- no Phase 9C work was introduced

## Demo Review

State whether:

- initial purchase projection succeeds
- renewal succeeds
- cancellation preserves access
- expiration removes the correct source
- multiple-source Entitlement aggregation succeeds
- refund or revocation succeeds
- grace and recovery succeed
- out-of-order reprojection succeeds
- Product transition succeeds
- restore and cross-device sync succeed
- offline cache follows policy
- identity conflict prevents double grant
- webhook retry succeeds
- replay is deterministic
- shadow projection leaves state unchanged
- the one-minute demonstration succeeds

## Decision

Choose one:

- Phase 9B accepted; proceed to Phase 9C
- Phase 9B accepted with tracked follow-ups; proceed to Phase 9C
- Phase 9B rejected pending fixes

Stop after producing the Phase 9B review.

Do not begin Phase 9C.

Do not merge automatically.

Do not tag automatically.
