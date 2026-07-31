# Codex Orchestration Prompt — Mosaic Phase 9C: Migration, Reconciliation, and Operations

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
- `docs/plans/phase-8-operational-hardening.md`
- `docs/plans/phase-9a-transaction-ingestion-validation.md`
- `docs/plans/phase-9b-subscription-state-authoritative-entitlements.md`
- `docs/reviews/phase-8.md`
- `docs/reviews/phase-9-entry.md`
- `docs/reviews/phase-9a.md`
- `docs/reviews/phase-9b.md`
- `docs/research/post-ga-adoption.md` and any owner-supplied migration/support evidence
- `docs/reviews/phase-9a.md` reconciliation and quarantine findings
- `docs/reviews/phase-9b.md` state-projection, Entitlement, SDK-cache, and webhook findings
- open issues marked as Phase 9C blockers

We are implementing:

# Mosaic Phase 9C: Migration, Reconciliation, and Operations

Do not begin Phase 10.

---

# Preflight Gate

Before delegating or modifying code, verify all of the following:

- Phase 8 is accepted as ready for General Availability.
- Mosaic v1.0.0 or an accepted GA baseline commit exists.
- `docs/reviews/phase-9-entry.md` explicitly approves Mosaic Billing.
- Phase 9A is accepted or accepted with tracked nonblocking follow-ups.
- Phase 9B is accepted or accepted with tracked nonblocking follow-ups.
- `docs/reviews/phase-9a.md` exists.
- `docs/reviews/phase-9b.md` exists.
- Phase 9A server-side Apple and Google validation implementations are accepted. Live sandbox/test
  verification remains a production-cutover and contract-promotion blocker, not a Stage 1
  inspection blocker.
- provider notifications are authenticated and ingested idempotently.
- Raw Billing Inputs, Validation Attempts, and Billing Event Ledger entries are append-only.
- normalized transaction facts use stable Mosaic Product IDs and historical mapping versions.
- unknown and ambiguous provider Products enter quarantine.
- subscription projections are deterministic and replayable.
- authoritative Entitlement snapshots are explainable and versioned.
- customer identity aliases are explicit and audited.
- the trusted server access API works.
- Customer Access Tokens and SDK Entitlement synchronization work.
- offline Entitlement cache policies are implemented and documented.
- application webhooks are signed, retryable, and auditable.
- projection replay/checksum comparison works without changing customer access, and unsupported
  projection-rule versions are refused. Phase 9C will add source-versus-Mosaic shadow comparison.
- PostgreSQL remains the runtime system of record.
- Goose migrations apply successfully.
- no production in-memory persistence exists.
- existing provider credentials are encrypted and redacted. Stage 1 must define migration
  credential encryption and redaction before Stage 2 implementation.
- Products and Entitlements remain separate domain concepts.
- existing RevenueCat, StoreKit 2, Google Play Billing, and custom-provider integrations remain optional.
- no unresolved critical security, tenant-isolation, backup, migration, state-projection, identity, or data-integrity defect exists.
- the current branch has no unrelated uncommitted changes. Reviewed Phase 9B remediation changes
  may be present during read-only Stage 1 inspection, but must be committed and accepted before
  write-enabled Phase 9C implementation.

If any prerequisite fails, stop and return a blocker report.

Do not silently repair Phase 9A or Phase 9B defects while pretending to implement Phase 9C.

If transaction validation, Product resolution, customer identity, subscription replay, Entitlement projection, Customer Access Tokens, or application webhooks are not trustworthy, classify those as earlier-phase blockers and stop.

---

# Required Git Isolation

Create or use a dedicated branch.

Recommended branch:

```text
phase/9c-migration-reconciliation-operations
```


Base the branch on an accepted and integrated Phase 9B commit. Record the exact commit hash in the
Stage 1 integration plan before write-enabled Phase 9C implementation.

Do not merge automatically.

Do not tag automatically.

Do not change production migration authority from an unaccepted branch.

---

# Phase Objective

Build a controlled migration and operations system that can move a real application from an existing billing authority to Mosaic Billing without silently changing customer access or destroying historical evidence.

The complete workflow should support:

1. connect an approved migration source
2. inspect source capabilities and data quality
3. create an explicit Migration Program
4. map source identities, Products, and Entitlements
5. import source history into isolated migration staging
6. validate current active purchases against Apple or Google where possible
7. run a dry migration without changing authority
8. build shadow Mosaic projections
9. compare source access with Mosaic access
10. classify and resolve divergence
11. ingest source deltas while shadow mode runs
12. verify supported application versions can use Mosaic access
13. create a cutover checkpoint and final source watermark
14. switch authority atomically and explicitly
15. monitor customer access, provider ingestion, SDK synchronization, and webhooks
16. roll back within an approved window when safety conditions permit
17. reconcile missed, conflicting, or quarantined records
18. provide audited repair and redelivery tools
19. complete the Migration Program with preserved evidence and operational runbooks

The core promise is:

> Move production customers to Mosaic Billing with measured parity, explicit authority, reversible cutover, and no silent access loss.

---

# Strict Phase Boundary

Phase 9C operationalizes migration, cutover, reconciliation, repair, and ongoing billing support.

Phase 9C includes:

- RevenueCat migration assessment
- RevenueCat customer and alias import
- RevenueCat transaction-history import where officially and contractually available
- native Apple and Google history discovery through accepted Phase 9A reconciliation
- approved custom-provider migration adapters
- migration source connections
- source snapshot and delta import
- migration manifests
- migration mapping sets
- identity mapping
- Product mapping
- Entitlement mapping
- source-confidence classification
- active-transaction revalidation
- migration dry runs
- shadow customer projections
- source-versus-Mosaic access comparison
- divergence classification
- reconciliation cases
- repair actions
- cutover readiness
- application-version readiness
- final delta synchronization
- cutover checkpoints
- explicit billing-authority switching
- rollback checkpoints
- rollback within approved safety limits
- migration audit history
- webhook redelivery and operational hardening
- support tooling
- migration and billing-health dashboards
- operational runbooks
- bulk but bounded migration jobs
- resumable migration batches
- source export retention and deletion
- migration completion reports
- consolidated Phase 9 review preparation

Phase 9C does not include:

- new billing-state semantics not already approved in Phase 9B
- new provider transaction-validation systems
- new commerce providers
- new Product types
- consumables
- credits
- metered billing
- quantity-based billing
- financial accounting
- settlement reconciliation
- invoicing
- tax
- revenue recognition
- automatic refund issuance
- automatic customer compensation
- arbitrary manual `Mark Active` or `Grant Forever` controls
- heuristic customer-identity merge
- silent provider-to-Mosaic authority switch
- permanent dual authority
- destructive source-data deletion
- direct mutation of immutable billing facts
- direct mutation of historical Entitlement snapshots
- AI-assisted migration decisions
- autonomous repair
- Phase 10 AI features
- Kafka
- ClickHouse
- another database
- a new queue system
- microservices
- gRPC
- GraphQL

Do not begin Phase 10.

---

# Migration Is Optional and Source Integrations Remain Supported

Mosaic Billing remains optional even after Phase 9C.

A Project may continue using:

- RevenueCat
- StoreKit 2
- Google Play Billing
- a custom provider

A Migration Program must never begin merely because Mosaic Billing is enabled.

The user must explicitly create, validate, approve, and execute a Migration Program.

Do not:

- automatically import source customers
- automatically switch authority
- automatically disconnect RevenueCat
- automatically rewrite SDK configuration
- automatically revoke source credentials
- automatically alter provider Product mappings
- automatically change application webhooks

Migration source integrations should remain available for comparison and rollback according to the accepted policy.

---

# Current Official Documentation Requirement

Before implementation, inspect current official documentation for every supported migration source.

## RevenueCat

Use current official RevenueCat documentation and APIs for:

- customer and subscriber retrieval
- aliases and application user identifiers
- Product, Package, Offering, and Entitlement metadata
- transaction and subscription history
- data export capabilities
- webhook history where available
- pagination and rate limits
- environment and application scope
- credential types and permissions
- migration guidance
- limitations on historical data
- deletion and retention obligations
- supported server APIs
- customer transfer or alias semantics where documented

Do not:

- scrape RevenueCat dashboards
- depend on undocumented endpoints
- infer Package or Offering semantics as stable store Product identity
- treat a RevenueCat export as Apple or Google cryptographic validation
- assume every historical record can be revalidated

## Apple

Use current official Apple documentation for:

- App Store Server API
- transaction history
- transaction lookup
- original transaction lineage
- App Store Server Notifications
- sandbox and production
- Family Sharing where relevant
- revocation and refund facts
- historical lookup limitations
- credential scope
- rate limits
- recovery and pagination

## Google

Use current official Google documentation for:

- Google Play Developer API
- subscription purchase history where available
- active purchase lookup
- one-time Product lookup where applicable
- Real-time Developer Notifications
- package and application scope
- base plans and offers
- purchase tokens
- test and production separation
- rate limits
- historical lookup limitations

## Custom Providers

A custom migration source must use an explicit, documented adapter contract.

Do not permit:

- remote executable migration code
- arbitrary SQL import
- untrusted scripts
- undocumented payloads
- source records without stable source identifiers
- source records without an authority classification

Record all official documentation, API versions, export formats, provider limits, and unresolved assumptions in:

```text
docs/plans/phase-9c-migration-reconciliation-operations.md
```

---

# Non-Negotiable Architectural Principles

## 1. Migration Never Rewrites Billing History

Imported source records, validated provider facts, migration decisions, reconciliation cases, and cutover actions are append-only evidence.

Do not rewrite:

- Raw Billing Inputs
- Validation Attempts
- Normalized Transaction Facts
- Billing Event Ledger entries
- historical Product-resolution records
- historical subscription snapshots
- historical Entitlement snapshots
- historical webhook deliveries
- migration source snapshots
- cutover checkpoints
- rollback checkpoints

A correction creates a new fact, mapping version, projection, repair action, or migration decision.

## 2. Migration Staging Is Not Authoritative State

Source imports first enter migration staging.

A staged source record must not:

- grant access
- revoke access
- create authoritative Entitlements
- overwrite a Billing Customer
- become a production subscription source automatically

Only accepted, validated, and promoted facts may enter the authoritative Phase 9A/9B pipeline.

## 3. Source Authority Remains Explicit

Before cutover, the source provider remains authoritative for customer access.

Shadow Mosaic projections are comparisons only.

After cutover, Mosaic becomes authoritative only through an explicit, audited authority transition.

There must never be an ambiguous state where two systems can independently grant and revoke access without a defined precedence rule.

## 4. Dual Run Means Comparison, Not Dual Authority

Shadow or dual-run mode may compute:

- source access
- Mosaic access
- differences
- timing lag
- missing data
- mapping conflicts

It must not allow both sources to mutate customer access independently.

## 5. Current Access Requires Sufficient Evidence

A current active subscription, lifetime purchase, or other access-granting source must meet the accepted evidence policy.

Source export data alone may be insufficient.

The plan must classify source evidence, for example:

- provider-validated
- cryptographically verified
- trusted provider-server response
- RevenueCat-exported observation
- custom-provider trusted observation
- untrusted client observation
- historical informational record
- quarantined

Do not silently promote lower-confidence evidence into current authoritative access.

## 6. Expired History and Current Access Have Different Risk

Historical expired transactions may be imported for audit and analytics under a lower authority classification when accepted.

Current access-granting records require the stronger accepted validation policy.

Do not let a lower-confidence historical import grant current access.

## 7. No Heuristic Identity Merge

Customer mappings require explicit source identifiers, accepted aliases, or authorized operator evidence.

Do not merge customers based on:

- email similarity
- name
- device data
- country
- Product
- purchase timestamp
- IP address
- approximate string matching

Ambiguity enters reconciliation.

## 8. Product Meaning Is Historical

Provider Products, RevenueCat Packages, RevenueCat Offerings, and Entitlements must map through versioned Mosaic Product and Entitlement mappings.

Do not resolve historical access using only the latest mapping when the mapping changed over time.

## 9. Cutover Is an Atomic Authority Decision

Cutover must have:

- a source watermark
- an imported and validated delta
- a cutover checkpoint
- a target authority mode
- an effective timestamp
- an actor
- approval evidence
- a rollback policy
- a monitoring window

Do not implement cutover as a collection of unrelated configuration changes with no shared transaction or orchestration record.

## 10. Rollback Preserves Mosaic Evidence

Rollback may switch access authority back to the source according to the accepted policy.

Rollback must not delete:

- imported facts
- Mosaic projections
- divergence records
- webhook history
- cutover evidence
- customer access history

## 11. All Bulk Operations Are Resumable and Idempotent

Migration import, validation, projection, comparison, reconciliation, repair, cutover preparation, and webhook redelivery must be:

- resumable
- bounded
- idempotent
- tenant-isolated
- observable
- auditable

## 12. No Unsafe Manual State Mutation

Do not provide an unrestricted button to:

- mark subscription active
- mark transaction valid
- grant permanent Entitlement
- change provider transaction
- delete divergence
- erase quarantine

If an emergency access override is considered necessary, stop and require a separate owner-approved ADR.

Any override must be modeled as an explicit, expiring, auditable Entitlement source—not as a hidden mutation.

---

# Domain Invariants

The following invariants must always hold.

## Tenant and Environment Isolation

- a Migration Program belongs to exactly one Project
- production and sandbox migration data cannot mix
- source credentials cannot cross Projects
- source snapshots cannot cross Environments
- identity mappings cannot cross Projects
- Product mappings cannot cross Projects
- cutover affects only the selected Project, Application, Environment, and platform scope
- reconciliation and repair remain tenant-scoped

## Authority

- one accepted billing authority mode exists for each migration scope
- source-authoritative and Mosaic-authoritative states are mutually exclusive
- shadow mode cannot mutate access
- cutover has one effective authority timestamp
- rollback creates a new authority transition
- authority history is append-only

## Customers

- one source identity maps to at most one Billing Customer in a mapping set
- conflicting source identities remain unresolved until evidence is approved
- one Billing Customer may have several explicit source aliases
- identity mapping changes preserve history
- import never rewrites raw source identity

## Products and Entitlements

- one effective source Product mapping resolves to one Mosaic Product
- ambiguous Product mapping blocks promotion
- archived Mosaic Products cannot receive new migration mappings
- Product replacement preserves historical meaning
- Entitlement mapping references existing Entitlement definitions
- source Entitlement labels do not become authoritative definitions automatically

## Transactions

- imported records retain source record identifiers
- provider-validated facts are not duplicated
- source exports cannot overwrite validated facts
- current access facts meet the accepted evidence threshold
- lower-confidence history is marked explicitly
- migration promotion is idempotent

## Projection

- shadow projection never changes authoritative access
- production projection remains reproducible
- divergence records identify both compared snapshots
- cutover uses a complete accepted projection
- rollback never discards the cutover projection
- projection-rule versions are captured

## Webhooks

- webhook history is immutable
- redelivery does not create a different logical event
- signing-key versions are recorded
- destination failures do not roll back billing state
- migration-specific webhooks identify the Migration Program and authority transition

## Operations

- every high-risk action records actor, reason, scope, and timestamp
- source export files have retention and deletion policies
- migration jobs expose progress and resumable checkpoints
- failed jobs do not silently skip records
- repair actions preserve before and after evidence


---

# Consistency Model

Phase 9C combines immutable source evidence, bulk imports, provider revalidation, shadow projection, authority switching, and eventually delivered SDK/webhook state.

The implementation plan must define consistency guarantees explicitly.

## Strongly Consistent Boundaries

Use a PostgreSQL transaction or equivalent accepted boundary for:

- creating a Migration Program and its initial scope
- advancing a Migration Program state
- creating a versioned Mapping Set
- promoting a validated imported fact
- creating a Cutover Checkpoint
- switching billing authority
- creating a Rollback Checkpoint
- switching authority during rollback
- recording a Repair Action and its resulting state transition
- creating an application webhook event for an authority change
- marking a Migration Batch checkpoint as committed
- closing a Reconciliation Case

Do not expose a cutover as successful before the authoritative state, authority history, and audit evidence commit together.

## Eventually Consistent Boundaries

These may be eventually consistent:

- source import progress
- provider revalidation
- shadow projection
- divergence aggregation
- dashboard counters
- support search indexes
- webhook delivery
- SDK refresh after authority transition
- operational metrics
- reconciliation summaries
- migration report generation

Every eventually consistent surface must show:

- data freshness
- current watermark
- backlog where relevant
- last successful processing time
- incomplete or failed state

## Read-Your-Writes

After an operator:

- changes a mapping
- resolves a Reconciliation Case
- requests revalidation
- approves cutover
- executes rollback
- redelivers a webhook

the dashboard should read the accepted command state immediately.

Derived projections and comparisons may remain pending, but the UI must distinguish:

```text
Command accepted
Processing
Completed
Failed
```

## Source Watermarks

Every import source must define a stable progress mechanism such as:

- source cursor
- provider event identifier
- export snapshot timestamp
- transaction sequence
- pagination token
- provider-specific high-water mark

Do not use only the local job start timestamp as proof that all source records were imported.

A watermark must be:

- provider-scoped
- Application-scoped
- Environment-scoped
- persistently recorded
- resumable
- explainable
- immutable once used for cutover evidence

## Cutover Barrier

Cutover requires an accepted barrier that establishes:

- source snapshot watermark
- imported records through the watermark
- provider facts validated through the watermark
- shadow projection completed through the watermark
- divergence report computed through the watermark
- final delta window
- unresolved cases and accepted exceptions
- target effective authority time

Do not switch authority while the final delta is unknown.

---

# Failure Model

The system must be designed for the following failures.

## Source API Unavailable

When RevenueCat or another source API is unavailable:

- preserve the last successful cursor
- mark import as retryable
- use bounded backoff
- keep source authority unchanged
- prevent cutover readiness
- expose provider diagnostics
- do not fabricate a complete snapshot

## Partial Source Export

When a source export is incomplete:

- record the accepted file or page checksum
- identify missing segments
- stop promotion where completeness is required
- retain successfully imported staging records
- allow resumable continuation
- prevent cutover

Do not infer missing customers from absence.

## Duplicate Source Records

Duplicate source records must be deduplicated by stable source identity and snapshot scope.

Repeated import may create new attempt evidence but must not duplicate promoted billing facts.

## Source Record Mutation

When a later source export changes an earlier record:

- preserve both source observations
- identify the source revision or observation time
- compare against provider-validated facts
- create a divergence or superseding observation
- do not overwrite the earlier source record

## Invalid or Expired Source Credentials

- mark source connection unhealthy
- stop new source reads
- keep prior staging evidence
- preserve current authority
- require credential rotation
- audit the event
- prevent cutover

## Provider Revalidation Unavailable

When Apple or Google cannot be queried:

- mark affected records as validation pending or unavailable
- preserve source evidence
- do not promote current access under a stronger confidence class
- use accepted retry policy
- block or warn cutover according to the approved threshold
- never convert unavailable into inactive

## Identity Conflict

When one source customer maps to multiple Billing Customers, or several source customers ambiguously map to one Billing Customer:

- create a Reconciliation Case
- stop promotion for affected current-access records
- preserve all evidence
- require explicit resolution
- never merge heuristically

## Product Mapping Conflict

When a source Product maps to several Mosaic Products or no Product:

- quarantine affected records
- show affected customers and source records
- require a versioned Product mapping
- replay resolution
- preserve old mapping history
- prevent affected current access from cutover

## Entitlement Mapping Conflict

When a source Entitlement label does not map clearly to a Mosaic Entitlement:

- keep source state informational
- block authoritative grant promotion
- require explicit mapping
- preserve source labels
- do not auto-create permanent Entitlement definitions from source strings

## Projection Divergence

When Mosaic shadow access differs from source access:

- preserve both snapshots
- classify the difference
- identify customer, Product, Entitlement, and source evidence
- distinguish timing lag from logic difference
- create or update a Reconciliation Case
- prevent or warn cutover according to accepted severity

Do not hide divergence through aggregate-only reporting.

## Migration Worker Crash

All jobs must resume from committed checkpoints.

A crash must not:

- skip records
- duplicate facts
- lose cursor state
- advance cutover readiness
- mark incomplete batches complete

## Concurrent Mapping Change

When a mapping changes while an import or shadow run is active:

- capture Mapping Set version in every run
- continue the run with its immutable version or stop safely
- require a new run for new mappings
- do not mix mapping versions silently

## New Source Activity During Dry Run

Source purchases, renewals, refunds, aliases, and Product changes may occur during migration.

The system must:

- import deltas
- preserve source order and timestamps
- update shadow projections
- update divergence
- keep cutover barrier current
- never assume the initial snapshot is final

## Application Version Not Ready

If supported production application versions still depend on source-provider access:

- cutover readiness fails
- show adoption by application version where available
- require a minimum supported Mosaic-ready version or an accepted backward-compatibility path
- do not strand old clients

## Authority Switch Failure

If cutover fails before the authority transaction commits:

- remain source-authoritative
- mark the attempt failed
- preserve checkpoint evidence
- retry only through an explicit action

If cutover commits but downstream refresh fails:

- Mosaic remains authoritative
- show propagation failure
- retry SDK configuration and webhook delivery
- use documented rollback only when approved
- do not oscillate authority automatically

## Rollback Failure

When rollback cannot safely complete:

- keep the current authoritative mode explicit
- stop further automated transitions
- raise a critical operational alert
- preserve all checkpoint evidence
- follow the accepted incident runbook
- never claim rollback completed partially

## SDK Offline During Cutover

Offline clients may continue using a cached Entitlement snapshot according to Phase 9B policy.

The cutover plan must define:

- cache expiry
- authority metadata
- minimum app version
- token refresh
- post-cutover refresh urgency
- behaviour for stale source-authoritative cache

Do not allow an old source-authoritative cache to remain valid indefinitely after cutover.

## Webhook Destination Failure

Billing state and migration authority transitions remain committed.

Webhook delivery retries independently.

The dashboard must expose:

- pending deliveries
- exhausted deliveries
- signing key
- event version
- redelivery
- destination health

## Source Deleted or Revoked Too Early

If the source Project, credentials, or data are removed before the rollback window ends:

- mark rollback capability degraded or unavailable
- raise a critical warning
- prevent claims of reversible cutover
- preserve Mosaic evidence
- require updated approval before cutover completion

## Operator Error

High-risk actions must support:

- explicit scope review
- confirmation
- reason
- dry-run preview
- permission checks
- audit
- idempotency
- safe retry
- cancellation before commit where possible

The plan must decide whether production cutover and rollback require two-person approval.

Do not choose that policy silently.

---

# Migration Authority Model

Each migration scope has exactly one authority mode.

Suggested modes:

- `source_authoritative`
- `shadow_comparison`
- `cutover_scheduled`
- `mosaic_authoritative`
- `rollback_scheduled`
- `source_authoritative_after_rollback`
- `migration_completed`
- `migration_aborted`

## Source Authoritative

The source provider remains the access authority.

Mosaic may:

- import records
- validate provider facts
- compute shadow subscription state
- compute shadow Entitlements
- compare results
- send diagnostics

Mosaic must not serve its shadow result as authoritative access.

## Shadow Comparison

Shadow comparison is still source-authoritative.

It adds:

- continuously updated Mosaic projections
- source access snapshots
- divergence classification
- readiness thresholds
- application-version readiness
- final-delta preparation

Do not call this dual authority.

## Cutover Scheduled

Cutover has been approved for a defined:

- Project
- Environment
- Application set
- platform set
- customer population
- effective time
- source watermark
- rollback window

Source remains authoritative until the cutover transaction commits.

## Mosaic Authoritative

Mosaic access APIs and SDK synchronization become authoritative.

The source may remain connected for:

- continued comparison
- rollback support
- additional historical import
- support investigation

The source must not independently override Mosaic access.

## Rollback Scheduled

A rollback has been approved but has not committed.

Mosaic remains authoritative until the rollback authority transaction commits.

## Source Authoritative After Rollback

The source becomes authoritative again under the accepted rollback policy.

Mosaic continues preserving:

- imported facts
- projections
- divergence
- cutover history
- rollback history
- webhook history
- operational evidence

## Migration Completed

The Migration Program has completed its accepted stabilization and rollback window.

Completion does not require deleting source integrations.

## Migration Aborted

The Program ended without cutover or after a safe rollback.

All evidence remains auditable.

---

# Migration Program Lifecycle

Suggested lifecycle states:

- Draft
- Assessing
- Mapping Required
- Ready for Dry Run
- Dry Run Running
- Dry Run Failed
- Dry Run Complete
- Shadow Running
- Divergence Blocking
- Ready for Cutover
- Cutover Scheduled
- Cutover In Progress
- Mosaic Authoritative
- Stabilizing
- Rollback Scheduled
- Rollback In Progress
- Rolled Back
- Completed
- Aborted
- Archived

State transitions must be explicit.

Example:

```text
Draft
→ Assessing
→ Mapping Required
→ Ready for Dry Run
→ Dry Run Running
→ Dry Run Complete
→ Shadow Running
→ Ready for Cutover
→ Cutover Scheduled
→ Cutover In Progress
→ Mosaic Authoritative
→ Stabilizing
→ Completed
```

Alternative failure and rollback paths may include:

```text
Dry Run Running → Dry Run Failed
Shadow Running → Divergence Blocking
Cutover Scheduled → Shadow Running
Mosaic Authoritative → Rollback Scheduled
Rollback Scheduled → Rollback In Progress
Rollback In Progress → Rolled Back
Rolled Back → Aborted
```

Do not permit:

- Draft → Mosaic Authoritative
- Dry Run Failed → Cutover Scheduled
- Divergence Blocking → Cutover Scheduled without an accepted exception
- Archived → Cutover Scheduled
- Completed → Shadow Running without a new Migration Program
- authority changes by editing a status field directly

Every lifecycle command must validate prerequisites.

---

# Core Migration Domain Model

## Migration Program

A Migration Program is the top-level orchestration record.

It should contain:

- Migration Program ID
- Organization ID
- Project ID
- source provider
- source connection
- target Mosaic Billing configuration
- Application scope
- Environment scope
- platform scope
- customer population scope
- lifecycle state
- authority mode
- source confidence policy
- Mapping Set version
- dry-run policy
- divergence thresholds
- cutover policy
- rollback policy
- stabilization window
- created metadata
- updated metadata
- approval metadata
- completion metadata
- archive metadata

A Migration Program must not span unrelated Projects.

## Migration Source

A Migration Source represents one approved external billing authority or historical dataset.

It should contain:

- Migration Source ID
- Migration Program ID
- provider type
- source Project or account identifier
- Application scope
- Environment classification
- credential reference
- capability manifest
- current connection status
- export mechanism
- delta mechanism
- source cursor
- last successful read
- data-retention policy
- audit metadata

Initial first-class source:

- RevenueCat

Additional accepted sources may include:

- Apple provider history through Phase 9A reconciliation
- Google provider history through Phase 9A reconciliation
- explicitly approved custom-provider adapter

Do not build arbitrary file import as an untyped escape hatch.

## Source Snapshot

A Source Snapshot is an immutable captured view of source data.

It should contain:

- Source Snapshot ID
- Migration Source ID
- snapshot kind
- source cursor or watermark
- source-generated timestamp where available
- Mosaic capture timestamp
- source schema version
- record counts
- file or page checksums
- encryption metadata
- storage reference
- completeness status
- import status
- retention expiry
- created metadata

A Source Snapshot must not be modified after capture.

## Source Record

A Source Record is a normalized but non-authoritative staging representation of one source record.

It should contain:

- Source Record ID
- Source Snapshot ID
- source record type
- stable source record identifier
- source revision or observation time
- source customer identifiers
- source Product identifiers
- source Entitlement labels
- source transaction references
- source status fields
- raw-record hash
- normalized source payload
- confidence classification
- validation status
- mapping status
- promotion status
- diagnostics

Source Records remain staging evidence until promoted through accepted rules.

## Migration Mapping Set

A Mapping Set is an immutable versioned collection of mappings used by a migration run.

It should contain:

- Mapping Set ID
- Migration Program ID
- version
- status
- source schema version
- identity mappings
- Product mappings
- Entitlement mappings
- mapping policy versions
- creator
- approval metadata
- created timestamp

Changing a mapping creates a new Mapping Set version.

## Source Identity Mapping

Maps source customer identities to Mosaic Billing Customers.

It should contain:

- source identity type
- source identity value hash or protected representation
- source Project or Application scope
- Mosaic Billing Customer ID
- mapping evidence
- confidence
- mapping status
- effective time
- superseded mapping
- actor
- audit metadata

Do not expose protected source identity values unnecessarily.

## Source Product Mapping

Maps source Product concepts to Mosaic Products.

It should contain:

- source provider
- source Product identifier
- source Package or Offering context where informational
- source Application
- source Environment
- Mosaic Product ID
- effective time or source-version range
- mapping confidence
- mapping status
- superseded mapping
- diagnostics
- actor
- audit metadata

RevenueCat Package and Offering references are adapter metadata, not Mosaic Product identity.

## Source Entitlement Mapping

Maps source Entitlement labels or access concepts to Mosaic Entitlement definitions.

It should contain:

- source Entitlement identifier
- source scope
- Mosaic Entitlement ID
- mapping policy
- prospective or historical use
- confidence
- status
- diagnostics
- actor
- audit metadata

Do not auto-create authoritative Entitlements from arbitrary source labels.

## Migration Import Batch

A bounded resumable import operation.

It should contain:

- Import Batch ID
- Migration Program ID
- Migration Source ID
- Source Snapshot ID
- Mapping Set ID
- cursor start
- cursor end
- status
- records discovered
- records staged
- records validated
- records promoted
- records skipped
- records quarantined
- failures
- retry count
- checkpoint
- started timestamp
- completed timestamp
- worker identity
- correlation ID

## Migration Record Decision

Records the disposition of one source record.

Suggested dispositions:

- informational history only
- requires provider validation
- provider validated and promotable
- duplicate of existing Mosaic fact
- identity unresolved
- Product unresolved
- Entitlement unresolved
- inconsistent with validated fact
- quarantined
- promoted
- permanently excluded under policy

Every decision must include:

- rule or policy version
- reason
- evidence
- actor or worker
- timestamp

## Shadow Projection Run

A versioned comparison run.

It should contain:

- Shadow Run ID
- Migration Program ID
- Mapping Set ID
- source watermark
- Mosaic billing-fact watermark
- Phase 9B projection-rule version
- source-access snapshot version
- customer population
- started timestamp
- completed timestamp
- customer count
- match count
- divergence count
- blocking divergence count
- unavailable count
- error count
- result status

## Divergence Record

Represents a difference between source and Mosaic.

It should contain:

- Divergence ID
- Shadow Run ID
- Billing Customer ID
- source customer reference
- source access snapshot
- Mosaic access snapshot
- Entitlement
- Product or lineage
- divergence category
- severity
- likely cause
- source watermark
- Mosaic watermark
- first observed
- last observed
- status
- linked Reconciliation Case
- resolution evidence

## Cutover Checkpoint

An immutable approved record of cutover readiness.

It should contain:

- Cutover Checkpoint ID
- Migration Program ID
- Mapping Set ID
- source snapshot watermark
- final delta watermark
- Billing Event Ledger watermark
- subscription projection checkpoint
- Entitlement projection checkpoint
- shadow run
- divergence thresholds and actual counts
- unresolved accepted exceptions
- minimum application version
- SDK adoption evidence
- webhook readiness
- rollback readiness
- source connection health
- effective cutover time
- approvers
- approval timestamp
- checksum or integrity hash

## Authority Transition

An append-only record of authority change.

It should contain:

- Authority Transition ID
- Migration Program ID
- from mode
- to mode
- scope
- effective time
- Cutover or Rollback Checkpoint
- actor
- approvers
- reason
- transaction timestamp
- Configuration Release reference
- application webhook event reference
- audit correlation ID

## Rollback Checkpoint

An immutable approved rollback record.

It should contain:

- Rollback Checkpoint ID
- Migration Program ID
- current authority
- target authority
- reason
- source health
- source watermark
- Mosaic Billing watermark
- affected customers
- known source-versus-Mosaic divergence
- SDK cache implications
- webhook implications
- rollback effective time
- approvers
- created timestamp
- integrity hash

## Reconciliation Case

An operational case for one or more unresolved records.

It should contain:

- Reconciliation Case ID
- Migration Program ID
- case category
- severity
- affected customer
- affected source identities
- affected Products
- affected Entitlements
- affected transactions
- evidence links
- status
- owner
- created timestamp
- due timestamp where used
- resolution
- resolution actor
- audit history

## Repair Action

An explicit audited operation.

Examples:

- revalidate provider transaction
- re-run Product resolution
- re-run identity mapping
- apply a new Mapping Set
- replay subscription projection
- replay Entitlement projection
- redeliver webhook
- reimport source delta
- close duplicate case
- mark source record informational only under policy

A Repair Action should contain:

- Repair Action ID
- Reconciliation Case ID
- action type
- input references
- before state
- requested actor
- approval where required
- execution status
- result
- after state
- created timestamp
- completed timestamp
- correlation ID

Repair must not edit immutable facts.

## Migration Completion Report

A generated immutable summary containing:

- Program scope
- source
- source watermarks
- imported record counts
- validated counts
- informational-only counts
- quarantined counts
- mapped identities
- mapped Products
- mapped Entitlements
- shadow comparison history
- divergence resolution
- cutover evidence
- rollback-window result
- remaining known limitations
- source-retention decision
- runbook references
- completion approvals


---

# Source Evidence and Confidence Policy

The implementation plan must define a source evidence taxonomy.

Suggested classifications:

- `provider_validated`
- `provider_signed`
- `trusted_provider_api`
- `trusted_source_export`
- `trusted_custom_server`
- `untrusted_client_observation`
- `historical_informational`
- `quarantined`
- `unavailable`

## Provider-Validated

A transaction was validated through Phase 9A using the accepted Apple or Google provider path.

This is suitable input to authoritative subscription projection.

## Provider-Signed

A provider-signed record was cryptographically verified according to current official rules.

The plan must still define whether additional provider lookup is required.

## Trusted Provider API

A current response was fetched from an authenticated provider server API and validated for Application, Environment, and Product scope.

## Trusted Source Export

A record came from an authenticated source export such as RevenueCat.

This may be useful for:

- identity mapping
- historical timeline
- source comparison
- import discovery
- missing-record detection

It must not automatically be treated as equivalent to direct Apple or Google validation.

## Trusted Custom Server

A custom provider's trusted server supplied the record through an approved adapter.

The adapter contract must define the authority and validation guarantees.

## Untrusted Client Observation

An SDK or application reported a transaction reference.

It may trigger validation but cannot grant access by itself.

## Historical Informational

A record is retained for history, analytics, or support but cannot grant current access.

Examples may include:

- expired records that can no longer be revalidated
- source metadata with insufficient cryptographic evidence
- legacy aliases
- old Package or Offering associations

## Quarantined

The record cannot safely progress due to conflict, missing mapping, invalid signature, ambiguous identity, or policy failure.

## Current-Access Evidence

The plan must explicitly define which confidence classes can support current access at cutover.

At minimum:

- active subscriptions should be revalidated through the provider where technically possible
- current lifetime or non-consumable access should be revalidated or covered by an owner-approved exception policy
- provider-unavailable must not silently become valid
- source export alone must not be promoted without the accepted policy
- historical expired access must not grant current access

If a current-access exception policy is needed for legacy records that cannot be revalidated, stop and require an owner decision and ADR.

---

# RevenueCat Migration Semantics

RevenueCat is the initial first-class migration source.

The implementation must preserve Mosaic's domain model:

```text
RevenueCat customer and aliases
→ explicit Source Identity Mapping
→ Mosaic Billing Customer

RevenueCat Product, Package, and Offering metadata
→ Source Product Mapping
→ stable Mosaic Product

RevenueCat Entitlement labels
→ Source Entitlement Mapping
→ Mosaic Entitlement definitions

RevenueCat transaction observations
→ provider validation or historical informational record
→ Phase 9A normalized transaction facts
→ Phase 9B projections
```

## RevenueCat App User IDs and Aliases

Do not assume:

- one RevenueCat App User ID equals one human
- anonymous IDs are safe to merge automatically
- aliases are globally unique outside their source scope
- aliases always represent intended identity transfers

Import source identity relationships as evidence.

Resolve them through explicit identity-mapping policy.

Conflicting alias graphs must create Reconciliation Cases.

## RevenueCat Products

RevenueCat Product identifiers may help locate Apple or Google Products.

RevenueCat Packages and Offerings are presentation and grouping metadata.

Do not use Package or Offering identity as the authoritative store Product identity.

## RevenueCat Entitlements

RevenueCat Entitlement labels may inform Mosaic Entitlement mapping.

Do not auto-create or auto-grant Mosaic Entitlements solely because a string exists in RevenueCat.

Mappings require explicit review and versioning.

## RevenueCat Customer State

RevenueCat customer or subscriber state is the source-authoritative comparison before cutover.

It may be used for:

- shadow parity
- divergence classification
- access-continuity validation
- support evidence

It must not replace direct provider validation for current access where provider validation is required.

## RevenueCat Transaction History

Import available transaction history with:

- source record ID
- Product
- purchase date
- expiration
- store
- Environment
- source customer identity
- source revision
- source confidence
- raw-record hash

Promote only through the accepted validation and Product-resolution path.

## RevenueCat Webhooks

If RevenueCat webhooks remain active during shadow or rollback windows:

- authenticate according to accepted source capabilities
- persist source input
- deduplicate
- use them as source observations
- continue provider validation where required
- preserve source and Mosaic timestamps separately
- stop or revoke only through explicit cutover completion policy

Do not treat a RevenueCat webhook as an Apple or Google signature.

---

# Native Provider History Migration

A Project may already use StoreKit 2 or Google Play Billing directly without RevenueCat.

Phase 9C may onboard such Projects through Phase 9A reconciliation rather than a separate source export.

## Apple

Use:

- original transaction lineage
- transaction history
- App Store Server API
- notification history where officially available
- provider-validated transactions

## Google

Use:

- purchase tokens
- subscription purchase history where available
- active purchase lookup
- Real-time Developer Notifications
- provider-validated purchases

## Limitations

The plan must document:

- how far back history can be retrieved
- which Product types are supported
- unavailable records
- current versus historical validation
- Family Sharing limitations
- refunded or revoked records
- data not recoverable from the provider

Do not claim a complete historical migration when provider history is incomplete.

---

# Custom Provider Migration Adapter

A custom provider migration adapter may support:

- source capability declaration
- source customer records
- source aliases
- source Product identifiers
- source Entitlement concepts
- source transaction observations
- current source access snapshot
- source cursor
- delta import
- source record confidence
- source health

It must not support:

- remote arbitrary code
- arbitrary SQL
- scripts uploaded through the dashboard
- undocumented payloads
- operator-provided "validated" flags with no authority
- automatic access mutation

The adapter remains optional and separately packaged.

---

# Migration Assessment

Assessment runs before a Dry Run.

It should answer:

- what source capabilities are available
- what customer identifiers exist
- what alias relationships exist
- how many Products exist
- how many Products are mapped
- how many source Entitlements exist
- how many Entitlements are mapped
- how much transaction history is accessible
- how many current-access records can be provider-validated
- how many records are historical only
- how many unsupported Product types exist
- whether Application and Environment mappings are complete
- whether SDK versions are Mosaic-ready
- whether source webhooks or deltas can continue through cutover
- whether rollback is technically possible
- estimated import volume
- estimated provider revalidation volume
- rate-limit risks
- privacy and retention implications

Assessment must not change access authority.

It may persist:

- source capability snapshot
- counts
- sample records
- mapping gaps
- readiness findings
- recommended next actions

Do not persist unnecessary source payloads during assessment.

---

# Mapping Workflow

Mappings are prepared before authoritative promotion.

## Identity Mapping

Support:

- automatic exact mapping for owner-approved stable IDs
- explicit user-ID namespace mapping
- source alias graph inspection
- unresolved identity cases
- mapping preview
- mapping import from approved application records
- operator confirmation
- conflict rejection
- versioned changes

Do not map by email or display name.

## Product Mapping

Support:

- exact provider Product identifier mapping
- Application and Environment scope
- historical mapping ranges
- Product replacement history
- source Package and Offering context
- current mapping
- unmapped Product detection
- ambiguous mapping detection
- preview of affected customers and records

## Entitlement Mapping

Support:

- source Entitlement list
- Mosaic Entitlement definitions
- source usage counts
- Product grants
- mapping preview
- historical and current distinction
- conflict warnings
- explicit no-equivalent outcome

A source Entitlement with no Mosaic equivalent may remain historical informational data.

## Mapping Approval

A Mapping Set used for Dry Run, Shadow, or Cutover must be immutable and approved.

Do not allow active runs to read mutable mapping rows.

Changing mappings requires:

- new Mapping Set version
- new validation
- new or incremental shadow run
- updated readiness

---

# Dry Run

A Dry Run simulates migration without changing authoritative customer access.

## Dry Run Inputs

- immutable Source Snapshot or source watermark
- immutable Mapping Set
- evidence policy
- Product grant-rule versions
- Phase 9B projection-rule versions
- customer population scope
- Application and Environment scope

## Dry Run Steps

1. import source records into staging
2. normalize source records
3. apply identity mappings
4. apply Product mappings
5. apply Entitlement mappings
6. identify direct provider-validation candidates
7. validate current-access candidates
8. classify lower-confidence history
9. promote accepted facts into an isolated migration namespace or shadow input
10. build shadow subscription projections
11. build shadow Entitlement projections
12. compare against source access
13. create divergence records
14. generate readiness report
15. preserve all run evidence

## Dry Run Must Not

- switch authority
- alter production Entitlement snapshots
- alter production Customer Access Tokens
- send production access webhooks
- revoke source credentials
- modify current Configuration Releases
- write imported facts into production projection without accepted promotion boundary
- hide failed records

## Dry Run Results

Report:

- source records discovered
- records imported
- exact duplicates
- current records provider-validated
- historical informational records
- unresolved identities
- unresolved Products
- unresolved Entitlements
- quarantined records
- projection successes
- source/Mosaic matches
- divergence by category
- customers with no safe current-access result
- estimated cutover risk
- required repairs
- provider rate-limit findings
- application-version readiness
- rollback readiness

Dry Run results are immutable.

A new Dry Run creates a new result.

---

# Shadow Mode

Shadow mode continuously computes Mosaic authoritative projections without serving them as authority.

## Shadow Inputs

- accepted source snapshot
- source deltas
- Phase 9A validated provider facts
- immutable Mapping Set
- Phase 9B projection rules
- source current-access snapshot
- SDK/application readiness data

## Shadow Comparison

Compare at least:

- customer identity
- active Products
- purchase lineages
- subscription lifecycle
- access state
- expiration
- Entitlement keys
- source count
- unknown or unavailable state
- Family Sharing source where supported
- grace and billing retry where represented
- revoked or refunded state
- webhook-visible state

## Divergence Categories

Suggested categories:

- exact match
- expected propagation lag
- source ahead
- Mosaic ahead
- identity mismatch
- Product mismatch
- Entitlement mapping mismatch
- missing provider fact
- duplicate lineage
- expiration mismatch
- grace-period mismatch
- billing-retry mismatch
- refund or revocation mismatch
- Family Sharing mismatch
- source unknown
- Mosaic unknown
- unsupported source semantics
- unsupported Product type
- application-version incompatibility
- webhook propagation mismatch

## Divergence Severity

Suggested severities:

- Informational
- Warning
- Blocking
- Critical

Blocking and Critical divergences must be resolved or explicitly accepted under an owner-approved exception policy before cutover.

## Shadow Freshness

Display:

- source watermark
- provider validation watermark
- billing ledger watermark
- projection checkpoint
- comparison completion time
- source lag
- worker backlog
- unavailable sources

Do not report parity when the watermarks are materially different.

---

# Cutover Readiness

Cutover readiness is a computed and reviewable result, not a manually selected checkbox.

Evaluate:

## Source Completeness

- initial snapshot complete
- delta mechanism healthy
- final cursor available
- source credentials healthy
- source data-retention window sufficient

## Mapping Completeness

- current customers mapped
- active Products mapped
- current source Entitlements mapped
- ambiguous mappings resolved
- historical mapping preserved

## Validation

- current active subscriptions validated according to policy
- lifetime purchases validated or accepted under explicit exception
- unsupported current access quarantined
- validation backlog below accepted threshold
- provider rate limits understood

## Projection

- Phase 9B projection healthy
- Entitlement projection healthy
- no unresolved Critical divergence
- Blocking divergence below accepted policy
- shadow freshness within threshold
- replay determinism passes

## Applications and SDKs

- minimum supported application version established
- Mosaic Customer Access Token flow available
- SDK access API adopted
- old source-gating paths disabled or safely bridged
- offline cache expiry compatible with cutover
- supported platforms ready
- app-store rollout constraints understood

## Webhooks and Backends

- application webhook destinations healthy
- signing keys configured
- source and Mosaic event overlap understood
- backend consumers can deduplicate
- authority-change event supported
- rollback webhook path supported

## Operations

- cutover runbook reviewed
- rollback runbook reviewed
- on-call coverage established
- monitoring and alerts configured
- source remains available through rollback window
- backups verified
- approvers available
- communication plan ready

Cutover readiness must show evidence for every requirement.

---

# Cutover Planning

A Cutover Plan should define:

- exact migration scope
- effective time
- source authority mode before cutover
- target Mosaic authority mode
- source watermark
- final-delta strategy
- mapping version
- projection-rule version
- Entitlement grant versions
- minimum application version
- SDK cache policy
- Configuration Release
- Customer Access Token behaviour
- application webhook transition
- source webhook policy
- rollback window
- rollback trigger thresholds
- monitoring window
- operator roles
- approvers
- communication steps
- stop conditions

Do not cut over the entire Project when a smaller platform or Application scope is intended.

---

# Cutover Execution

Recommended cutover sequence:

1. verify Migration Program state
2. verify approvals
3. verify source connection health
4. capture final source watermark
5. ingest final source delta
6. validate final current-access records
7. project final shadow state
8. compare final source and Mosaic access
9. confirm divergence thresholds
10. confirm application-version readiness
11. confirm webhooks and monitoring
12. create immutable Cutover Checkpoint
13. create new Configuration Release where required
14. atomically record authority transition
15. activate Mosaic authoritative access APIs
16. emit signed authority-transition webhook
17. start stabilization monitoring
18. preserve source integration for rollback window
19. record propagation status
20. close only after all commit boundaries succeed

Cutover must be idempotent.

Repeating the same cutover command must not create several authority transitions.

---

# Authority Transition Propagation

After cutover:

- server Entitlement APIs return Mosaic authoritative snapshots
- Customer Access Tokens identify Mosaic as authority
- SDK sync responses include authority metadata
- application webhooks identify authority transition
- dashboard shows Mosaic authoritative
- source comparison may continue
- source access snapshots remain diagnostic only
- new provider facts continue through Phase 9A
- Phase 9B continues projection normally

Do not delete source SDKs or credentials automatically.

---

# Stabilization Window

During stabilization, monitor:

- access API error rate
- SDK synchronization failure
- stale Customer Access Tokens
- source-versus-Mosaic divergence
- provider validation backlog
- unknown or unavailable Entitlements
- Product-resolution quarantine
- webhook delivery
- purchase completion
- restore
- customer support cases
- application version distribution
- offline cache expiry
- source connection health
- worker backlog
- database errors

The plan must define:

- stabilization duration
- rollback thresholds
- warning thresholds
- responsible operators
- communication rules
- completion criteria

---

# Rollback Policy

Rollback is an explicit authority transition.

It is not deletion of Mosaic Billing.

## Rollback Preconditions

- source remains operational
- source credentials remain valid
- source current-access state can be obtained
- source delta is current
- source SDK or application access path remains supported
- rollback window has not expired or exceptional approval exists
- affected application versions can use source authority
- webhook consumers can accept rollback event
- rollback impact is understood

## Rollback Sequence

1. create Rollback Checkpoint
2. verify source current-access snapshot
3. ingest latest source delta
4. compare source and Mosaic state
5. assess customers affected by rollback
6. verify application compatibility
7. approve rollback
8. atomically switch authority
9. publish required configuration
10. emit signed authority-transition webhook
11. monitor source access recovery
12. preserve Mosaic evidence and facts
13. mark Migration Program rolled back or aborted

## Rollback Must Not

- delete Mosaic transactions
- delete Entitlement history
- delete migration records
- rewrite Cutover Checkpoint
- silently discard Mosaic-only provider facts
- pretend the migration never occurred
- revoke Mosaic Billing credentials automatically
- mark source authority restored before the transition commits

## Rollback Limitations

The dashboard and runbook must explain when rollback is degraded or impossible, including:

- source data deleted
- source account closed
- source SDK removed from supported applications
- source credentials revoked
- new Mosaic-only Products introduced
- Mosaic-only customers created
- provider history unavailable
- rollback window expired

Do not claim rollback is always possible.

---

# Reconciliation

Reconciliation is continuous before, during, and after cutover.

## Reconciliation Inputs

- source snapshots
- source deltas
- Phase 9A validated facts
- Phase 9B subscription projections
- authoritative Entitlement snapshots
- source current-access snapshots
- application webhook acknowledgements
- SDK sync diagnostics
- Product mapping history
- identity mapping history
- migration authority history

## Reconciliation Cases

Create cases for:

- identity conflict
- Product conflict
- Entitlement mapping conflict
- missing provider fact
- extra provider fact
- source-only active access
- Mosaic-only active access
- expiration mismatch
- refund or revocation mismatch
- lineage duplication
- Family Sharing mismatch
- source lag
- webhook mismatch
- SDK authority mismatch
- stale application version
- quarantine backlog
- migration import failure
- rollback readiness degradation

## Case Lifecycle

Suggested states:

- Open
- Investigating
- Waiting for Provider
- Waiting for Mapping
- Ready for Repair
- Repair Running
- Validation Required
- Resolved
- Accepted Exception
- Closed

Accepted exceptions require:

- reason
- scope
- expiration or review date
- approver
- customer impact
- operational mitigation

Do not hide exceptions in comments.

---

# Repair Tools

Provide bounded repair operations.

Allowed examples:

- re-fetch source record
- re-import source page or delta
- revalidate provider transaction
- re-run Product resolution
- re-run identity mapping
- apply a new Mapping Set version
- promote accepted validated fact
- replay subscription projection
- replay Entitlement projection
- rebuild Customer Access Token snapshot
- redeliver webhook
- re-run source comparison
- merge duplicate staging records
- mark historical record informational only under policy
- close duplicate case

Every Repair Action must:

- identify exact inputs
- show before state
- show expected effect
- require permission
- be idempotent
- preserve immutable history
- create audit evidence
- show after state
- allow safe failure and retry

Do not provide:

- edit provider transaction
- delete billing fact
- manually set expiration
- manually mark active
- manually erase refund
- manually rewrite customer identity without evidence

---

# Application Webhook Operations

Phase 9B created signed retryable application webhooks.

Phase 9C hardens operations for migration and support.

Support:

- destination health
- signing-key rotation
- event-schema version
- delivery cursor
- retry
- redelivery
- bounded historical replay
- poison-event quarantine
- per-destination pause
- destination resume
- delivery audit
- migration authority-transition events
- migration completion events
- rollback events
- reconciliation alert events where approved

Redelivery must reuse the same logical webhook event ID.

Do not create a new logical event merely because it was redelivered.

Application backends must be able to deduplicate.

---

# Support and Operations Console

Provide support tooling for authorized operators.

Support:

- Billing Customer search
- source identity search
- provider transaction search
- Product lineage search
- Migration Program search
- authority history
- subscription timeline
- Entitlement explanation
- source-versus-Mosaic comparison
- validation attempts
- quarantine
- reconciliation cases
- repair history
- webhook history
- SDK sync status
- Customer Access Token status
- migration source health

Every support surface must enforce tenant and role boundaries.

Do not expose raw secrets or unredacted protected identifiers.

---

# SDK Authority Transition

SDKs must not guess whether source or Mosaic is authoritative.

The accepted access response should include:

- authority mode
- authority transition version
- effective time
- snapshot version
- cache policy
- refresh recommendation
- Customer Access Token scope
- diagnostics-safe migration status where appropriate

## Pre-Cutover

The host application may continue using source-provider access.

Mosaic SDK may:

- fetch shadow diagnostics in development
- prepare Customer Access Tokens
- verify compatibility
- warm cache if approved

It must not report shadow access as authoritative.

## Post-Cutover

Mosaic authoritative access APIs control access decisions.

The SDK should:

- refresh authority metadata
- reject stale source-authority snapshots after accepted expiry
- preserve valid bounded offline Mosaic cache
- notify listeners when authority changes
- avoid duplicate customer identity
- continue purchase-provider integration independently

## Old Application Versions

The plan must define behaviour for versions that cannot consume Mosaic authority.

Options may include:

- block cutover until adoption threshold
- maintain a temporary source-compatible bridge
- restrict cutover scope
- require mandatory upgrade
- accept a documented limitation

Do not silently strand old clients.

## Logout and Identity Change

Authority transition must preserve Phase 9B identity rules.

Do not rewrite queued events or cached snapshots to another user.

---

# Migration REST APIs

Define typed REST resources for:

- Migration Programs
- Migration Sources
- source assessment
- Source Snapshots
- source imports
- Mapping Sets
- identity mappings
- Product mappings
- Entitlement mappings
- Dry Runs
- Shadow Runs
- divergence
- cutover readiness
- cutover approval
- cutover execution
- stabilization
- rollback readiness
- rollback approval
- rollback execution
- Reconciliation Cases
- Repair Actions
- migration reports
- webhook redelivery
- migration health

Use:

- Chi
- Mosaic response helpers
- Ozzo Validation
- OpenAPI
- PostgreSQL repositories
- server-side authorization
- idempotency keys for high-risk commands
- explicit conflict responses
- audit events

High-risk commands must not be generic `PATCH status`.

Use explicit commands such as:

```text
POST /migration-programs/{id}/dry-runs
POST /migration-programs/{id}/shadow-runs
POST /migration-programs/{id}/cutover-checkpoints
POST /migration-programs/{id}/cutover
POST /migration-programs/{id}/rollback-checkpoints
POST /migration-programs/{id}/rollback
POST /reconciliation-cases/{id}/repair-actions
```

Exact paths follow accepted API conventions.

---

# PostgreSQL Persistence Model

The Stage 1 plan must inspect existing Phase 9A and 9B tables and add only necessary Phase 9C tables.

Likely concepts include:

- migration_programs
- migration_sources
- migration_source_snapshots
- migration_source_records
- migration_mapping_sets
- migration_identity_mappings
- migration_product_mappings
- migration_entitlement_mappings
- migration_import_batches
- migration_record_decisions
- migration_shadow_runs
- migration_divergences
- migration_cutover_checkpoints
- billing_authority_transitions
- migration_rollback_checkpoints
- reconciliation_cases
- repair_actions
- migration_completion_reports
- migration_audit_events
- webhook_redelivery_jobs where not already covered
- migration_approvals where required

Do not duplicate:

- Billing Customers
- Normalized Transaction Facts
- subscription snapshots
- Entitlement snapshots
- webhook events
- Provider Product Mappings
- Product definitions
- Entitlement definitions

## Constraints

Use:

- primary keys
- foreign keys
- Project and Environment scope
- unique constraints
- check constraints
- explicit deletion behaviour
- append-only protections where practical
- immutable Mapping Set versions
- immutable source snapshots
- immutable cutover and rollback checkpoints
- one current authority mode per migration scope
- idempotent import-record identity
- idempotent Repair Action commands
- approved lifecycle transitions

## Retention

Define retention separately for:

- source credentials
- source export files
- normalized source records
- raw source payloads
- migration reports
- divergence evidence
- cutover evidence
- rollback evidence
- repair history
- application webhooks

Do not delete evidence required for audit or customer support without an accepted policy.

---

# Security Model

## Authorization

Separate permissions for:

- view migration
- create migration
- manage source credentials
- edit mappings
- run assessment
- run Dry Run
- run shadow comparison
- resolve reconciliation
- execute repair
- approve cutover
- execute cutover
- approve rollback
- execute rollback
- view protected source data
- redeliver webhooks
- export migration report

Do not rely on dashboard visibility.

## High-Risk Approval

The implementation plan must decide whether production cutover and rollback require:

- one privileged actor
- two-person approval
- time-delayed approval
- owner confirmation
- break-glass procedure

Do not choose silently.

## Source Files

Source exports must use:

- encrypted object storage
- short-lived upload or download URLs
- content hash
- size limits
- type validation
- access audit
- retention expiry
- deletion job
- no public bucket exposure

## PII

Minimize source personal data.

Protect:

- source customer identifiers
- application user IDs
- aliases
- provider transaction references
- migration reports
- support exports

Do not log raw identity values.

## SSRF and Remote Fetch

Source download URLs and custom-provider endpoints require:

- allow-list or accepted policy
- bounded timeouts
- redirect restrictions
- private-network protection
- response-size limits
- content-type validation

## Rate Limits

Apply controls to:

- source connection tests
- imports
- Dry Runs
- shadow runs
- cutover readiness
- reconciliation
- replay
- repair
- webhook redelivery
- export

## Audit

Audit:

- credential creation and rotation
- mapping changes
- imports
- Dry Runs
- shadow runs
- exception acceptance
- cutover approvals
- cutover
- rollback approvals
- rollback
- repairs
- webhook redelivery
- source export deletion
- Migration Program completion

Audit records must not contain secrets.

---

# Observability

Instrument:

- source API latency
- source rate limits
- source import throughput
- source import failures
- provider revalidation backlog
- mapping coverage
- identity conflicts
- Product conflicts
- Entitlement conflicts
- Dry Run duration
- shadow projection duration
- divergence counts
- divergence severity
- cutover readiness
- final-delta lag
- authority transition latency
- SDK authority refresh
- webhook authority-transition delivery
- rollback readiness
- Reconciliation Case backlog
- Repair Action failures
- source export retention jobs
- worker retries
- database pool state
- object-storage failures

Alerts should include:

- source delta stopped
- Critical divergence appeared
- validation backlog exceeds threshold
- authority transition failed
- SDK refresh failure spike
- access API error spike
- webhook authority-transition failure
- rollback source unhealthy
- reconciliation backlog growing
- source export deletion failed
- cross-Environment mismatch
- unexpected Mosaic/source access divergence after cutover

Do not include customer PII in labels.

---

# Performance and Capacity

Stage 1 must propose measurable targets based on expected migration sizes.

Measure:

- source records imported per minute
- provider validations per minute under rate limits
- Mapping Set evaluation throughput
- shadow projection throughput
- divergence comparison throughput
- cutover final-delta duration
- access API latency during cutover
- SDK refresh propagation
- webhook delivery latency
- reconciliation backlog recovery
- repair action latency
- dashboard query latency for large Programs

Do not invent aggressive targets without source-provider limits and dataset evidence.

Large migration jobs must be:

- paginated
- bounded
- checkpointed
- resumable
- rate-aware
- cancelable where safe
- observable
- fair across tenants

Do not load an entire migration population into memory.

---

# Required Agent Execution Model

Use no more than four concurrent agents.

Run Phase 9C in six stages.


---

# Stage 1A: Product, Protocol, Backend, and Quality Inspection

Use exactly:

1. `mosaic_product`
2. `mosaic_protocol`
3. `mosaic_backend`
4. `mosaic_quality`

All four agents are read-only during Stage 1A.

---

## Product Agent

Review:

- validated demand for migration from RevenueCat or native providers
- Phase 9C scope
- Phase 9A and 9B acceptance evidence
- target migration sources
- source-authority assumptions
- source evidence classifications
- current-access validation requirements
- identity mapping
- Product and Entitlement mapping
- Dry Run requirements
- shadow comparison
- divergence thresholds
- cutover requirements
- rollback policy
- stabilization window
- Reconciliation Case workflow
- repair boundaries
- application version requirements
- operational support expectations
- Phase 10 exclusions

Return:

- required scope
- deferred scope
- source evidence policy options
- current-access evidence requirements
- Migration Program lifecycle
- cutover readiness requirements
- rollback requirements
- divergence severity policy
- exception policy
- operator approval requirements
- observable acceptance criteria
- owner decisions
- product risks
- smallest complete production-like migration workflow

Confirm:

- migration remains optional
- source remains authoritative before cutover
- shadow mode is not dual authority
- no heuristic identity merge exists
- no unsafe manual access mutation exists
- RevenueCat Package and Offering are not Mosaic Product identity
- Phase 10 AI is excluded
- financial accounting is excluded

Do not modify production code.

---

## Protocol Agent

Inspect:

- Billing Ingestion Contract
- Authoritative Entitlement Contract
- Customer Access Token Contract
- Billing State Webhook Contract
- Commerce Provider Contract
- existing migration or import formats
- SDK authority metadata
- Configuration Delivery compatibility
- application webhook event versions

Propose a versioned:

```text
Billing Migration Operations Contract v1
```

The contract should define provider-independent types for:

- migration source capability
- source record envelope
- source evidence classification
- migration mapping manifest
- Dry Run result
- shadow comparison result
- divergence category
- cutover readiness
- Cutover Checkpoint
- authority transition
- Rollback Checkpoint
- Reconciliation Case
- Repair Action
- migration completion report
- migration diagnostics

Also confirm whether existing access and webhook contracts need backward-compatible fields for:

- authority mode
- authority-transition version
- migration effective time
- source or Mosaic authority
- rollback transition
- migration correlation ID

Do not modify production files during Stage 1A.

Do not put RevenueCat-specific Package or Offering types into the core migration contract.

---

## Backend Agent

Inspect:

- Phase 9A billing inputs, validation, quarantine, reconciliation, and replay
- Phase 9B Billing Customers, aliases, lineages, subscription projection, Entitlement projection, tokens, SDK sync, and webhooks
- Provider Connection infrastructure
- RevenueCat adapter capabilities
- Apple and Google reconciliation capabilities
- Product and Entitlement mapping history
- PostgreSQL schema
- object storage
- worker architecture
- job checkpointing
- authorization
- audit logs
- OpenAPI
- backup and retention
- existing support tooling
- current tests
- current release and operational constraints

Using current official documentation, propose:

- source connection architecture
- source assessment
- RevenueCat import architecture
- source snapshot storage
- delta import
- import staging
- source evidence classification
- provider revalidation
- Mapping Set versioning
- promotion boundary
- Dry Run
- shadow projection
- source access snapshot
- divergence calculation
- cutover readiness
- final delta
- authority transition transaction
- rollback transaction
- application-version gating
- Reconciliation Cases
- Repair Actions
- webhook redelivery
- source export retention
- migrations
- minimum sufficient tests
- performance and rate-limit handling

Do not modify production code during Stage 1A.

---

## Quality Agent

Perform a migration-readiness audit.

Review:

- append-only guarantees
- projection determinism
- authority metadata
- Product mapping history
- Entitlement grant history
- identity alias safety
- provider-validation coverage
- RevenueCat adapter limitations
- source credential security
- source export security
- object-storage security
- tenant isolation
- Environment isolation
- bulk-job resumability
- cutover transaction feasibility
- rollback feasibility
- SDK cache behaviour
- application webhooks
- support permissions
- audit completeness
- backup and restore implications
- current operational runbooks

Return:

- blocking prerequisites
- critical migration risks
- security risks
- authority-transition risks
- rollback risks
- data-retention risks
- acceptable deferred work
- smallest required mitigations

Do not modify production code.

---

# Stage 1B: Dashboard and SDK Inspection

Use exactly:

1. `mosaic_dashboard`
2. `mosaic_flutter`
3. `mosaic_ios`
4. `mosaic_android`

All four agents are read-only during Stage 1B.

---

## Dashboard Agent

Inspect:

- Provider Connection settings
- RevenueCat connection UI
- Product and Entitlement mapping UI
- Billing Customer detail
- subscription timeline
- Entitlement explanation
- Phase 9A transaction ledger and quarantine
- Phase 9B replay and shadow projection UI
- webhook operations
- operational dashboards
- jobs and progress patterns
- audit views
- permission system
- Environment switching
- design-system components
- tables and filtering
- existing tests

Return:

- Migration Program information architecture
- source assessment flow
- mapping workflow
- Dry Run workflow
- shadow comparison workflow
- divergence dashboard
- cutover readiness UI
- cutover confirmation
- stabilization dashboard
- rollback UI
- Reconciliation Case workflow
- Repair Action workflow
- migration report
- source export retention UI
- required empty, loading, error, permission, conflict, and recovery states
- exact files requiring change
- minimum sufficient tests

Do not modify code.

---

## Flutter Agent

Inspect:

- Customer Access Token flow
- authoritative Entitlement sync
- cache authority metadata
- RevenueCat adapter usage
- custom-provider support
- StoreKit and Google bridges
- purchase completion refresh
- identity lifecycle
- analytics queue
- Configuration Release refresh
- application version reporting
- diagnostics
- example application
- current tests

Return:

- authority-transition metadata handling
- pre-cutover compatibility mode
- post-cutover sync
- old-cache rejection
- source-to-Mosaic authority listener
- minimum application-version reporting
- RevenueCat purchase-provider coexistence
- rollback support
- exact files requiring change
- minimum sufficient tests

Do not modify code.

---

## iOS Agent

Perform the equivalent inspection for:

- Swift access APIs
- Customer Access Token
- authoritative Entitlement cache
- StoreKit
- RevenueCat
- application lifecycle
- background refresh
- version reporting
- authority transition
- rollback
- diagnostics

Do not modify code.

---

## Android Agent

Perform the equivalent inspection for:

- Kotlin access APIs
- Customer Access Token
- authoritative Entitlement cache
- Google Play Billing
- RevenueCat
- application lifecycle
- background refresh
- version reporting
- authority transition
- rollback
- diagnostics

Do not modify code.

---

# Stage 1 Integration Contract

After Stage 1A and Stage 1B:

1. reconcile all reports
2. resolve terminology centrally
3. freeze migration-source scope
4. freeze source evidence policy
5. freeze identity mapping policy
6. freeze current-access validation requirements
7. freeze divergence severity and thresholds
8. freeze cutover authority semantics
9. freeze rollback policy and window
10. freeze application-version readiness policy
11. freeze source export retention
12. freeze high-risk approval requirements
13. do not begin implementation with unresolved security or authority decisions

Create:

```text
docs/plans/phase-9c-migration-reconciliation-operations.md
```

The plan must define:

- official source documentation and versions
- supported migration sources
- source capability model
- Migration Program lifecycle
- authority model
- source evidence classifications
- current-access evidence policy
- source assessment
- Source Snapshot
- Source Record
- Mapping Set
- identity mappings
- Product mappings
- Entitlement mappings
- mapping approval
- import staging
- Import Batches
- record disposition
- provider revalidation
- promotion boundary
- Dry Run
- shadow mode
- source access snapshot
- divergence categories
- divergence severity
- cutover readiness
- source watermarks
- final delta
- Cutover Checkpoint
- authority transition
- stabilization
- rollback policy
- Rollback Checkpoint
- Reconciliation Cases
- Repair Actions
- webhook operations
- SDK authority metadata
- old-application behaviour
- application-version requirements
- PostgreSQL migrations
- REST resources
- authorization
- audit
- security
- retention
- observability
- performance targets
- minimum sufficient tests
- operational drills
- explicit exclusions
- Phase 9C demonstration

Stop before Stage 2 implementation if owner-level decisions remain unresolved.

---

# ADR Checkpoints

Create an ADR or explicit owner decision before implementation when the repository does not already define:

- source evidence authority
- current-access exception policy
- RevenueCat export retention
- source identity mapping rules
- cutover authority transaction
- rollback window
- rollback feasibility requirements
- two-person approval
- old-application compatibility
- source-versus-Mosaic divergence thresholds
- emergency access overrides
- migration source credential storage
- source file encryption
- historical lower-confidence data retention

Do not let Codex make these decisions silently.

---

# Stage 2: Protocol, Backend, and Dashboard Implementation

Use exactly:

1. `mosaic_protocol`
2. `mosaic_backend`
3. `mosaic_dashboard`

These agents have non-overlapping write ownership.

---

## Protocol Agent Ownership

Own only:

- Billing Migration Operations Contract schemas
- migration fixtures
- backward-compatible authority metadata changes where approved
- migration contract documentation
- migration contract changelog
- generated artifacts where established

Do not modify:

- Paywall Protocol semantics
- Commerce Provider Contract semantics
- Placement Decision Contract semantics
- Analytics Event Contract semantics
- Experiment Assignment Contract semantics
- Billing Ingestion Contract semantics
- Authoritative Entitlement Contract semantics except approved compatible fields
- SDK implementation files
- backend implementation files
- dashboard implementation files

---

## Protocol Work Package 1: Billing Migration Operations Contract v1

Implement versioned provider-independent types for:

- source capability
- source evidence
- source record envelope
- Mapping Set manifest
- import result
- record disposition
- Dry Run result
- shadow run
- divergence
- cutover readiness
- Cutover Checkpoint
- authority transition
- rollback readiness
- Rollback Checkpoint
- Reconciliation Case
- Repair Action
- migration report
- diagnostics

Create meaningful fixtures for:

- RevenueCat source assessment
- mapped current subscription
- unmapped Product
- identity conflict
- historical informational record
- provider-validated current access
- Dry Run complete
- blocking divergence
- cutover ready
- cutover not ready
- authority transition
- rollback transition
- repair action
- migration complete

Do not include real source credentials or PII.

---

## Protocol Work Package 2: Authority Metadata

If approved, add authority metadata to the existing draft or accepted access and webhook
contracts only through an approved backward-compatible change or a new contract version.

The metadata should be able to express:

- authority mode
- transition version
- effective time
- Migration Program ID where safe
- cache expiry
- refresh urgency
- rollback transition
- diagnostics-safe state

Do not expose internal cutover approvals or source credentials.

Old SDKs must follow the accepted compatibility path.

---

## Backend Agent Ownership

Own:

- `apps/api/**`
- `apps/worker/**`
- PostgreSQL migrations
- migration sources
- source import
- Dry Run
- shadow comparison
- cutover and rollback
- reconciliation
- repair
- webhook operations
- OpenAPI
- observability
- backend tests
- backend documentation
- deployment configuration needed for source imports

Do not modify dashboard, protocol, or SDK production files.

---

# Backend Work Packages

## Backend Work Package 1: PostgreSQL Migrations

Add only migrations required by the accepted Phase 9C model.

Likely concepts include:

- Migration Programs
- Migration Sources
- Source Snapshots
- Source Records
- Mapping Sets
- Source Identity Mappings
- Source Product Mappings
- Source Entitlement Mappings
- Import Batches
- Migration Record Decisions
- Shadow Runs
- Divergence Records
- Cutover Checkpoints
- Authority Transitions
- Rollback Checkpoints
- Reconciliation Cases
- Repair Actions
- Migration Completion Reports
- migration approvals
- migration audit events
- webhook redelivery jobs where existing tables are insufficient

Do not duplicate:

- Billing Customers
- Provider Product Mappings
- Normalized Transaction Facts
- subscription snapshots
- Entitlement snapshots
- webhook events

Use:

- primary keys
- foreign keys
- tenant isolation
- Environment isolation
- unique constraints
- check constraints
- append-only protections
- immutable checkpoint protections
- lifecycle transition constraints where practical
- justified indexes
- explicit deletion behaviour

Important invariants include:

- one active authority mode per migration scope
- source record identity unique in Source Snapshot scope
- Mapping Set versions immutable
- active import references one Mapping Set version
- Cutover Checkpoint immutable
- Rollback Checkpoint immutable
- Authority Transition append-only
- Repair Action cannot alter immutable facts
- source and target Project scopes match
- sandbox and production cannot mix

---

## Backend Work Package 2: Migration Source Connections

Implement:

- create source connection
- list source connections
- source details
- capability assessment
- credential entry
- credential test
- credential rotation
- revocation
- Environment scope
- Application scope
- source health
- rate-limit status
- last successful read
- retention policy
- audit events

Initial first-class source:

- RevenueCat

Use the accepted Provider Connection and encryption infrastructure where appropriate.

Do not expose source credentials to SDKs.

---

## Backend Work Package 3: Source Assessment

Implement assessment jobs.

Assessment should:

- query source capabilities
- inspect customer identifiers
- inspect aliases
- inspect Products
- inspect source Entitlements
- estimate transaction history
- identify current-access records
- identify unsupported Product types
- identify mapping gaps
- identify application-version requirements
- estimate validation load
- estimate migration size
- identify rollback limitations
- produce immutable assessment result

Assessment must not alter access state.

---

## Backend Work Package 4: Source Snapshot Capture

Implement:

- snapshot request
- source cursor
- paginated retrieval
- encrypted object-storage persistence where required
- content hashes
- record counts
- completeness status
- resumable capture
- cancellation where safe
- retention expiry
- audit events

Do not store an entire large export in process memory.

Do not mark incomplete capture complete.

---

## Backend Work Package 5: Source Record Normalization

Normalize source records into staging.

Support accepted source record types such as:

- source customer
- source alias
- source Product
- source Entitlement
- source transaction observation
- source current-access snapshot
- source webhook observation

Preserve:

- stable source ID
- source revision
- source timestamp
- raw hash
- confidence
- normalized payload
- diagnostics

Do not promote automatically.

---

## Backend Work Package 6: Mapping Sets

Implement:

- create Mapping Set
- identity mapping
- Product mapping
- Entitlement mapping
- validation
- usage preview
- conflict detection
- immutable version publication
- clone to new version
- approval
- audit history

Do not allow active jobs to read mutable mapping state.

---

## Backend Work Package 7: Import Batches

Implement bounded resumable import.

Support:

- source cursor
- batch size
- Mapping Set version
- progress
- checkpoints
- retries
- duplicate detection
- record disposition
- quarantine
- cancellation where safe
- restart safety
- fairness across tenants
- telemetry

Do not skip failed records silently.

---

## Backend Work Package 8: Provider Revalidation

For accepted current-access records:

- resolve provider transaction reference
- invoke Phase 9A validation
- reuse existing facts where identical
- create new Validation Attempt where required
- classify result
- preserve source evidence
- rate-limit provider calls
- support retry
- create reconciliation cases for unresolved current access

Do not duplicate provider-validation logic.

Do not let source export status bypass provider validation where policy requires it.

---

## Backend Work Package 9: Record Promotion

Promote only accepted records.

Promotion must:

- verify immutable Mapping Set
- verify evidence classification
- verify identity mapping
- verify Product mapping
- verify Environment
- deduplicate against Phase 9A facts
- create or reference accepted facts
- record disposition
- remain idempotent
- preserve staging evidence
- avoid customer access mutation outside Phase 9B projection

Promotion into the authoritative fact pipeline may trigger Phase 9B projection only when the accepted Program mode permits it.

During Dry Run, use an isolated shadow namespace or equivalent accepted boundary.

---

## Backend Work Package 10: Dry Run

Implement:

- create Dry Run
- validate prerequisites
- snapshot inputs
- run staged import
- provider revalidation
- shadow promotion
- subscription projection
- Entitlement projection
- source comparison
- divergence creation
- readiness report
- immutable result
- export
- retry failed sub-jobs
- cancellation where safe

Dry Run must not change authority.

---

## Backend Work Package 11: Source Access Snapshot

Implement source current-access snapshot ingestion.

The snapshot should preserve:

- source customer
- source Products
- source Entitlements
- expiration
- source lifecycle state
- source observation time
- source watermark
- source confidence
- source diagnostics

Do not treat source access snapshot as a provider-validated transaction fact.

---

## Backend Work Package 12: Shadow Projection

Implement:

- create Shadow Run
- select Mapping Set
- select source watermark
- select Mosaic fact watermark
- select projection-rule version
- build shadow subscription state
- build shadow Entitlements
- compare source
- produce divergence
- preserve result
- support incremental rerun
- support full rerun
- observe backlog
- audit

Shadow must not change authoritative access.

---

## Backend Work Package 13: Divergence Engine

Classify and persist divergence.

Support:

- exact match
- timing lag
- identity mismatch
- Product mismatch
- Entitlement mismatch
- missing provider fact
- source-only access
- Mosaic-only access
- expiration mismatch
- grace mismatch
- retry mismatch
- refund mismatch
- Family Sharing mismatch
- unsupported semantics
- unknown
- unavailable

Return:

- severity
- likely cause
- evidence
- affected customers
- affected Products
- recommended recovery action
- cutover impact

Do not auto-resolve blocking divergence with a guess.

---

## Backend Work Package 14: Cutover Readiness

Compute cutover readiness from accepted policy.

Include:

- source health
- source completeness
- mapping coverage
- current-access validation
- unresolved quarantine
- divergence counts
- projection freshness
- SDK/application readiness
- webhook readiness
- rollback readiness
- operational readiness
- approvals
- known exceptions

Return:

- ready
- not ready
- blocking reasons
- warnings
- evidence
- recovery actions

Do not provide a manual Ready checkbox.

---

## Backend Work Package 15: Cutover Checkpoint

Create immutable Cutover Checkpoint.

Require:

- readiness passed or approved exceptions
- final source watermark
- final delta status
- projection checkpoints
- Mapping Set version
- application readiness
- rollback window
- approvers
- idempotency key
- integrity hash

Do not allow checkpoint mutation.

---

## Backend Work Package 16: Authority Transition

Implement explicit atomic authority transition.

It must:

- lock migration scope
- verify checkpoint
- verify current authority
- verify effective time
- create Authority Transition
- update current authority pointer
- create required Configuration Release
- create application webhook event
- create audit records
- commit atomically
- return transition version

Do not modify access snapshots directly in the transition transaction.

Phase 9B projections already determine access.

---

## Backend Work Package 17: Stabilization Monitoring

Implement Program-specific monitoring:

- authority state
- access API errors
- SDK sync failures
- shadow divergence
- provider validation backlog
- source delta lag
- webhook failures
- quarantine
- support cases
- old application versions
- rollback readiness
- worker health

Support configured thresholds and alerts.

---

## Backend Work Package 18: Rollback Readiness and Checkpoint

Implement:

- source health verification
- source current-access snapshot
- latest source delta
- customer impact estimate
- application compatibility
- rollback limitation report
- immutable Rollback Checkpoint
- approvals
- audit

Do not claim rollback ready if source support is unavailable.

---

## Backend Work Package 19: Rollback Authority Transition

Implement atomic rollback transition.

It must:

- verify current Mosaic authority
- verify Rollback Checkpoint
- switch authority explicitly
- create new Authority Transition
- publish required Configuration Release
- create signed application webhook event
- preserve Mosaic facts and projections
- commit atomically
- begin rollback stabilization monitoring

Do not delete migration evidence.

---

## Backend Work Package 20: Reconciliation Cases

Implement:

- create Case
- list Cases
- Case detail
- assign owner
- severity
- evidence
- lifecycle
- accepted exception
- resolution
- audit
- filtering
- bulk selection only for safe homogeneous actions

Do not close a case merely because a dashboard row disappeared.

---

## Backend Work Package 21: Repair Actions

Implement only accepted Repair Actions.

Require:

- exact action type
- exact inputs
- before-state capture
- permission
- approval where required
- idempotency
- execution status
- after-state capture
- audit
- safe retry

Do not add generic arbitrary state editing.

---

## Backend Work Package 22: Webhook Operations

Extend Phase 9B webhook operations with:

- destination cursor
- delivery health
- redelivery
- bounded historical replay
- poison-event quarantine
- signing-key rotation
- authority-transition events
- rollback events
- migration completion events
- audit

Redelivery reuses the logical event ID.

---

## Backend Work Package 23: Migration Completion

Implement completion checks:

- stabilization window complete
- accepted divergence state
- no unresolved Critical cases
- rollback window result documented
- source retention decision
- source credentials disposition
- webhook health
- completion report
- approvals
- archive readiness

Completion must not delete source data automatically.

---

## Backend Work Package 24: REST, OpenAPI, and Observability

Document every accepted migration resource and command.

Instrument:

- source assessment
- source import
- provider revalidation
- mapping coverage
- Dry Run
- shadow run
- divergence
- readiness
- cutover
- propagation
- stabilization
- rollback
- reconciliation
- repair
- webhook redelivery
- completion

Use safe identifiers.

Do not log raw source exports, credentials, or PII.

---

# Dashboard Agent Ownership

Own:

- Migration Program routes
- source setup
- assessment
- mappings
- import
- Dry Run
- shadow comparison
- divergence
- readiness
- cutover
- stabilization
- rollback
- reconciliation
- repair
- webhook operations
- migration reports
- feature-specific tests and documentation

Use the accepted design system.

Do not redesign Catalog, Billing Customers, or Studio.

---

# Dashboard Work Packages

## Dashboard Work Package 1: Migration Programs

Implement:

- Program list
- create Program
- source provider
- scope
- lifecycle
- authority mode
- progress
- warnings
- Program detail
- archive
- permission states
- loading, empty, error, and recovery states

---

## Dashboard Work Package 2: Source Setup and Assessment

Implement:

- add source
- credential entry
- capability test
- Environment and Application scope
- assessment
- source health
- source counts
- source limitations
- mapping gaps
- validation estimate
- rollback feasibility
- next actions

Never re-display accepted secrets.

---

## Dashboard Work Package 3: Mapping Workspace

Implement:

- identity mappings
- Product mappings
- Entitlement mappings
- conflict detection
- usage counts
- affected current customers
- historical-only records
- mapping preview
- immutable Mapping Set publication
- clone to new version
- approval
- audit

Use progressive disclosure.

Do not expose RevenueCat Package and Offering as top-level Product identity.

---

## Dashboard Work Package 4: Import and Dry Run

Implement:

- Source Snapshot
- import progress
- batch status
- retry
- cancel where safe
- record dispositions
- provider validation progress
- quarantine
- Dry Run start
- Dry Run result
- export report
- immutable result
- recovery actions

Show that Dry Run does not change authority.

---

## Dashboard Work Package 5: Shadow Comparison

Implement:

- shadow run
- source watermark
- Mosaic watermark
- freshness
- match rate
- divergence by category
- divergence by severity
- customer drill-down
- Product drill-down
- Entitlement drill-down
- timing lag
- unavailable data
- rerun
- incremental run
- history

Do not show parity without aligned watermarks.

---

## Dashboard Work Package 6: Cutover Readiness

Show every readiness category:

- source
- mappings
- provider validation
- projection
- applications
- SDKs
- webhooks
- operations
- rollback

Each blocker must link to its recovery workflow.

Do not reduce readiness to a single unexplainable score.

---

## Dashboard Work Package 7: Cutover

Implement:

- scope summary
- effective time
- final watermark
- final delta
- Mapping Set
- divergence summary
- accepted exceptions
- minimum app version
- webhook readiness
- rollback window
- approvers
- confirmation
- execution progress
- authority-transition result
- propagation status

Do not permit cutover from a not-ready Program without the approved exception workflow.

---

## Dashboard Work Package 8: Stabilization

Show:

- current authority
- access API health
- SDK sync
- source delta
- shadow comparison
- validation backlog
- webhook delivery
- quarantine
- support cases
- old app versions
- rollback readiness
- stabilization countdown
- alerts

---

## Dashboard Work Package 9: Rollback

Implement:

- rollback readiness
- limitations
- source health
- latest source snapshot
- affected customers
- app compatibility
- rollback checkpoint
- approvals
- execution progress
- authority transition
- stabilization after rollback
- failure recovery

Explain that rollback preserves Mosaic history.

---

## Dashboard Work Package 10: Reconciliation Cases

Implement:

- Case list
- severity
- category
- customer
- Product
- Entitlement
- evidence
- owner
- status
- due date where used
- accepted exception
- resolution
- audit
- filters
- safe bulk actions

---

## Dashboard Work Package 11: Repair Actions

Implement approved actions with:

- before state
- expected effect
- confirmation
- permission
- progress
- result
- after state
- audit
- retry

Do not provide generic field editing.

---

## Dashboard Work Package 12: Webhook Operations

Implement:

- destination health
- delivery list
- event type
- logical event ID
- attempt history
- signing-key version
- redelivery
- historical replay
- poison-event quarantine
- pause and resume
- audit

---

## Dashboard Work Package 13: Migration Report and Completion

Implement:

- Program summary
- imported records
- validation results
- mappings
- divergence history
- cutover
- rollback status
- known limitations
- source-retention policy
- completion approvals
- downloadable report
- completion action

Do not claim success while Critical cases remain open.

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
- migration contract fixture validation

Follow minimum sufficient testing.

Do not add tests merely because files are new.


---

# Stage 3: SDK Authority Transition and Migration Continuity

Use exactly:

1. `mosaic_flutter`
2. `mosaic_ios`
3. `mosaic_android`

Each agent owns only its SDK, example application, platform tests, and documentation.

Do not modify the canonical Billing Migration Operations Contract.

---

# Shared SDK Requirements

Each SDK must preserve the existing Phase 9B access API while adding migration-aware authority handling.

Support:

- authority mode
- authority-transition version
- effective time
- current authoritative source
- Customer Access Token refresh
- Entitlement snapshot refresh
- cache authority metadata
- cache expiry
- urgent refresh signal
- cutover notification
- rollback notification
- authority listener
- minimum application-version diagnostics
- safe offline behaviour
- source-provider purchase coexistence
- diagnostics
- migration correlation ID where safe

The SDK must not choose authority locally.

Authority comes from the accepted server response and Configuration Release metadata.

## No Dual Access Merge

Do not merge source-provider Entitlements and Mosaic authoritative Entitlements into one silent union.

Before cutover:

- source remains authoritative according to host integration
- Mosaic shadow state is diagnostic only

After cutover:

- Mosaic authoritative state controls access
- source state may remain diagnostic
- source purchase provider may still process purchases where accepted
- new purchase facts must still reach Phase 9A

If both states are displayed in development, label them clearly.

## Stable Public API

Applications should continue using the accepted Phase 9B API for authoritative access.

Do not require a second migration-specific gating API.

Migration metadata may be exposed through:

- diagnostics
- authority listener
- snapshot metadata
- development inspection

## Token Refresh

On authority transition:

- refresh Customer Access Token
- reject a token scoped to the wrong authority version
- preserve the current user identity
- avoid duplicate token refresh loops
- use bounded retry
- expose failure diagnostics
- do not log token contents

## Cache Behaviour

Every cached Entitlement snapshot should record:

- Billing Customer
- authority mode
- authority-transition version
- snapshot version
- issued time
- expiry
- integrity metadata
- identity scope

After cutover, a cached source-authority snapshot must expire according to the accepted policy.

After rollback, a cached Mosaic-authority snapshot must expire according to the accepted policy.

Do not retain the wrong authority indefinitely while offline.

## Application Version Reporting

SDKs should report:

- SDK version
- application version
- authority-contract support
- access-token support
- migration-capability support

Do not collect unnecessary device identity.

The backend may use aggregated compatibility evidence for cutover readiness.

## Purchase Provider Coexistence

Migration of access authority does not necessarily change the purchase provider.

Examples:

- RevenueCat may continue presenting purchases while Mosaic Billing validates underlying Apple or Google transactions
- StoreKit 2 may remain the purchase provider while Mosaic becomes access authority
- Google Play Billing may remain the purchase provider while Mosaic becomes access authority
- custom provider purchase flow may continue under the approved adapter

The SDK must not initialize a duplicate provider instance.

The purchase result remains provider-specific at the boundary and triggers authoritative Mosaic refresh according to Phase 9B.

## Old App Versions

The SDK plan must implement the accepted old-version policy.

Potential supported behaviours:

- old client remains source-authoritative until forced upgrade
- cutover excludes old application versions
- temporary compatibility bridge
- mandatory upgrade
- documented no-offline-access limitation

Do not invent a compatibility bridge that weakens authority guarantees.

---

## Flutter Agent

Implement:

- authority metadata decoding
- authority listener
- Customer Access Token refresh
- cache authority versioning
- cutover transition
- rollback transition
- application-version reporting
- migration diagnostics
- RevenueCat/custom/native purchase coexistence
- example migration screen
- documentation

Use idiomatic Dart.

Do not block the UI isolate.

Do not expose server credentials.

---

## iOS Agent

Implement the equivalent in Swift.

Use:

- Swift concurrency
- Keychain or accepted protected storage for tokens
- application lifecycle handling
- background refresh within platform limits
- authority listener
- cache invalidation
- StoreKit and RevenueCat coexistence where configured

Do not claim guaranteed background refresh.

Do not block the main actor.

---

## Android Agent

Implement the equivalent in Kotlin.

Use:

- coroutines
- accepted protected storage
- application lifecycle handling
- background refresh within platform limits
- authority listener
- cache invalidation
- Google Play Billing and RevenueCat coexistence where configured

Do not block the main thread.

---

# Stage 3 Minimum Sufficient Tests

Protect Mosaic-owned risks:

- authority comes from server metadata, not local guess
- source-authority cache does not remain valid indefinitely after cutover
- Mosaic-authority cache does not remain valid indefinitely after rollback
- token refresh does not loop
- wrong-authority token is rejected
- identity remains stable through authority transition
- logout preserves accepted identity-reset semantics
- offline cache follows the accepted policy
- old application version reports incompatibility
- purchase provider remains usable after access-authority switch
- SDK does not merge source and Mosaic Entitlements silently
- diagnostics contain no token or credential
- Flutter, iOS, and Android interpret the same authority transition identically

Do not reproduce platform storage or networking-library tests.

---

# Stage 3 Cross-Platform Conformance

Use shared fixtures to prove identical interpretation of:

- source authoritative
- shadow comparison
- cutover scheduled
- Mosaic authoritative
- rollback scheduled
- source authoritative after rollback
- authority-transition version
- effective time
- stale source cache
- stale Mosaic cache
- token refresh required
- unsupported authority metadata
- minimum application-version failure

Go, Dart, Swift, and Kotlin must agree on authority metadata.

Do not accept behavioural divergence in access authority.

---

# Stage 4: Migration and Operations Drills

Run drills in isolated staging or sandbox environments.

Do not use production customer data for initial acceptance.

Record:

- Program
- source
- dataset size
- start and end
- operator
- commands
- evidence
- result
- failures
- recovery
- follow-up

---

## Drill 1: RevenueCat Assessment

Demonstrate:

```text
connect RevenueCat source
→ test credentials
→ inspect capabilities
→ count customers
→ inspect aliases
→ inspect Products
→ inspect source Entitlements
→ estimate current-access records
→ identify unsupported records
→ produce assessment report
```

No customer access changes.

---

## Drill 2: Mapping Set

Demonstrate:

```text
map source user IDs
→ inspect alias conflict
→ map source Products
→ preserve Package and Offering as metadata
→ map source Entitlements
→ detect unmapped Product
→ publish immutable Mapping Set
```

---

## Drill 3: Dry Run

Demonstrate:

```text
capture source snapshot
→ import records
→ validate current purchases
→ classify historical-only records
→ build shadow projections
→ compare source access
→ generate divergence
→ confirm source remains authoritative
```

---

## Drill 4: Identity Conflict

Demonstrate:

```text
one source alias graph points to two Billing Customers
→ import stops for affected current access
→ Reconciliation Case opens
→ operator reviews evidence
→ applies accepted identity mapping
→ reruns affected records
→ preserves original conflict evidence
```

---

## Drill 5: Unknown Product

Demonstrate:

```text
source transaction references unmapped Product
→ provider validates transaction
→ Product resolution fails
→ record enters quarantine
→ create mapping
→ re-run Product resolution
→ promote fact
→ replay shadow projection
```

---

## Drill 6: Lower-Confidence Historical Record

Demonstrate:

```text
source export includes expired record that cannot be revalidated
→ classify as historical informational
→ retain timeline evidence
→ confirm it does not grant current access
```

---

## Drill 7: Shadow Divergence

Demonstrate:

```text
source says Pro active
→ Mosaic says inactive
→ create Blocking divergence
→ inspect missing provider fact
→ reconcile provider history
→ replay projection
→ divergence resolves
```

---

## Drill 8: Source Delta During Shadow

Demonstrate:

```text
initial snapshot completes
→ new renewal occurs at source
→ delta import receives it
→ provider validates it
→ shadow projection updates
→ source and Mosaic remain aligned
```

---

## Drill 9: Cutover Readiness

Demonstrate every readiness category:

```text
source healthy
→ mappings complete
→ validation backlog acceptable
→ divergence acceptable
→ application versions ready
→ webhooks healthy
→ rollback ready
→ operations ready
→ create immutable Cutover Checkpoint
```

---

## Drill 10: Successful Cutover

Demonstrate:

```text
capture final watermark
→ import final delta
→ validate
→ project
→ compare
→ approve
→ atomically switch authority
→ issue new authority metadata
→ refresh SDK
→ deliver application webhook
→ source remains available for rollback
→ monitor stabilization
```

Verify no user loses expected access in the test population.

---

## Drill 11: Offline Client During Cutover

Demonstrate:

```text
client caches source-authority state
→ client goes offline
→ cutover occurs
→ cache reaches accepted expiry
→ client does not keep source authority indefinitely
→ client reconnects
→ refreshes Mosaic authoritative snapshot
```

---

## Drill 12: Old Application Version

Demonstrate the accepted policy:

```text
old app reports no migration support
→ cutover readiness blocks or excludes scope
→ operator sees affected adoption
→ no silent customer stranding
```

---

## Drill 13: Authority Webhook Failure

Demonstrate:

```text
cutover commits
→ application webhook destination fails
→ Mosaic authority remains committed
→ delivery retries
→ operator redelivers
→ application backend deduplicates logical event
```

---

## Drill 14: Rollback

Demonstrate:

```text
Mosaic authoritative
→ critical rollback trigger occurs
→ verify source health
→ ingest latest source delta
→ create Rollback Checkpoint
→ approve
→ atomically switch authority back
→ refresh SDKs
→ deliver rollback webhook
→ preserve all Mosaic facts and history
```

---

## Drill 15: Rollback Not Possible

Demonstrate:

```text
source credentials revoked or old app path removed
→ rollback readiness fails
→ dashboard explains limitation
→ system does not claim reversible cutover
```

---

## Drill 16: Worker Crash and Resume

Demonstrate:

- import worker crash
- validation worker crash
- shadow worker crash
- divergence worker crash
- Repair Action worker crash

Every job resumes from committed checkpoint without skipping or duplicating records.

---

## Drill 17: Reconciliation and Repair

Demonstrate:

```text
open Reconciliation Case
→ inspect evidence
→ request revalidation
→ apply new Mapping Set
→ replay projection
→ compare before and after
→ close case with audit
```

---

## Drill 18: Source Outage

Demonstrate:

```text
source API unavailable during shadow
→ cursor preserved
→ source authority remains
→ readiness becomes blocked
→ retry after recovery
→ no fabricated completeness
```

---

## Drill 19: Large Dataset

Use a representative synthetic dataset.

Demonstrate:

- bounded memory
- pagination
- checkpoints
- resumability
- tenant fairness
- rate-limit compliance
- progress
- cancellation
- completion report

Do not use a tiny fixture as the only scale evidence.

---

## Drill 20: Migration Completion

Demonstrate:

```text
stabilization window completes
→ no unresolved Critical cases
→ rollback status recorded
→ source-retention decision recorded
→ completion report generated
→ Program completed
→ evidence remains auditable
```

---

# Stage 5: Product, UX, Protocol, and Quality Review

Use exactly:

1. `mosaic_product`
2. `mosaic_ux`
3. `mosaic_protocol`
4. `mosaic_quality`

All four are read-only.

---

## Product Review

Confirm:

- Phase 9C remained within scope
- migration remains optional
- source remains authoritative before cutover
- shadow mode is comparison only
- current access uses accepted evidence
- identity is not merged heuristically
- cutover is explicit and audited
- rollback limitations are honest
- no new billing semantics were introduced
- no financial accounting was introduced
- no AI was introduced
- consolidated Phase 9 readiness is credible

Return:

- Approve
- Approve with changes
- Reject
- Owner decision required

---

## UX Review

Review:

- source setup
- assessment
- mappings
- import
- Dry Run
- shadow comparison
- divergence
- readiness
- cutover
- stabilization
- rollback
- reconciliation
- repair
- webhook operations
- completion report
- permissions
- errors
- dead ends
- terminology

Do not approve:

- a mysterious readiness score
- an irreversible-looking cutover with no evidence
- a rollback button that hides limitations
- generic manual state editing
- source-specific implementation language in primary workflows

---

## Protocol Review

Confirm:

- Billing Migration Operations Contract is versioned
- source evidence is explicit
- authority transitions are explicit
- cutover and rollback are distinct
- no PII or secrets exist in fixtures
- existing billing and Entitlement contracts remain compatible
- old SDK behaviour is documented
- authority metadata is backward compatible or versioned safely

---

## Quality Review

Review:

- PostgreSQL migrations
- append-only evidence
- tenant isolation
- Environment isolation
- source credential encryption
- source export encryption
- SSRF controls
- source rate limits
- Mapping Set immutability
- import idempotency
- job checkpoints
- provider revalidation
- evidence classification
- identity mapping
- Product mapping history
- shadow isolation
- divergence correctness
- readiness correctness
- cutover atomicity
- rollback atomicity
- authority uniqueness
- SDK authority handling
- webhook redelivery
- Reconciliation Case audit
- Repair Action safety
- retention
- performance
- operational drills
- absence of unsafe manual access mutation
- minimum sufficient tests

Return findings ordered by severity with exact paths and symbols.

---

# Final Fix Pass

After reviews:

1. classify findings
2. assign backend findings to `mosaic_backend`
3. assign dashboard findings to `mosaic_dashboard`
4. assign Flutter findings to `mosaic_flutter`
5. assign iOS findings to `mosaic_ios`
6. assign Android findings to `mosaic_android`
7. assign contract findings to `mosaic_protocol`
8. reject speculative feature additions
9. rerun affected checks
10. rerun affected migration drills
11. rerun complete Phase 9C validation
12. request one targeted final quality review

Limit the fix-and-review cycle to two rounds.

If blocking issues remain after two rounds, classify Phase 9C as rejected pending fixes.

---

# Minimum Sufficient Testing Policy

Follow:

```text
docs/architecture/conventions/testing.md
```

Do not create tests merely because code is new.

Do not recreate tests for:

- RevenueCat internals
- Apple provider internals
- Google provider internals
- object-storage SDK internals
- pgx
- Goose
- Chi
- queue-library internals
- chart libraries
- framework routing
- platform storage

The following identifies risks, not one required test per bullet.

## Import and Evidence Risk Coverage

Protect:

- source cursor resumes correctly
- duplicate source records remain idempotent
- incomplete snapshots are not marked complete
- current-access records cannot bypass evidence policy
- historical informational records do not grant access
- source export cannot overwrite provider-validated fact
- sandbox and production cannot mix

## Mapping Risk Coverage

Protect:

- ambiguous identity mapping blocks promotion
- no heuristic identity merge occurs
- ambiguous Product mapping blocks promotion
- historical Product mapping is reproducible
- Entitlement label does not auto-create authoritative Entitlement
- changing Mapping Set does not alter an active run silently

## Shadow and Divergence Risk Coverage

Protect:

- shadow projection cannot change production access
- source and Mosaic watermarks are compared
- divergence category is stable
- timing lag is not misclassified as logical mismatch under accepted policy
- blocking divergence prevents readiness
- unavailable source is not treated as parity

## Cutover Risk Coverage

Protect:

- cutover requires accepted checkpoint
- authority switches atomically
- repeating cutover is idempotent
- only one authority mode is current
- final delta is included
- Configuration Release and webhook event align with transition
- failed precommit cutover leaves source authoritative
- postcommit propagation failure does not silently switch back

## Rollback Risk Coverage

Protect:

- rollback requires source health
- rollback creates new Authority Transition
- rollback preserves Mosaic facts
- rollback does not rewrite Cutover Checkpoint
- rollback cannot claim success partially
- unavailable rollback is shown honestly

## Repair Risk Coverage

Protect:

- Repair Action preserves before and after state
- repair cannot mutate immutable fact
- revalidation creates new attempt
- replay is idempotent
- generic manual `Mark Active` does not exist
- permissions protect high-risk repairs

## SDK Risk Coverage

Protect:

- authority is server-controlled
- stale source cache expires after cutover
- stale Mosaic cache expires after rollback
- wrong-authority token fails safely
- source and Mosaic Entitlements are not silently unioned
- purchase provider remains independent of access authority
- old application behaviour follows accepted policy
- all SDKs interpret authority metadata identically

## Webhook Risk Coverage

Protect:

- redelivery reuses logical event ID
- signing-key version is preserved
- failed delivery does not roll back authority
- destination pause does not lose events
- cross-tenant redelivery fails
- payload contains correct authority transition

## Security Risk Coverage

Protect:

- source credentials are encrypted
- source exports are private
- source download SSRF is blocked
- source PII is absent from logs
- cutover and rollback require accepted authorization
- tenant scope is enforced
- source export deletion follows retention policy
- migration reports do not leak other tenants

Every agent report must explain:

- tests added
- risk protected
- existing tests reused
- drills performed
- checks run
- unavailable external checks
- why no new test was added where none was necessary

---

# Required Phase 9C Acceptance Criteria

Phase 9C is complete only when all of the following are true.

## Preconditions and Boundaries

- Phase 9A remains accepted.
- Phase 9B remains accepted.
- Migration remains optional.
- Existing provider integrations remain available.
- No new Product type was introduced.
- No financial accounting was introduced.
- No AI migration decision was introduced.
- No unsafe manual access mutation exists.

## Source and Assessment

- RevenueCat source connection works through current official APIs.
- source credentials are encrypted.
- sandbox and production are isolated.
- source capability assessment works.
- source limitations are visible.
- Source Snapshots are immutable.
- source capture is resumable.
- incomplete capture is not marked complete.
- source export retention is documented.
- source export deletion is auditable.

## Evidence and Import

- source evidence classification is explicit.
- current-access evidence policy is enforced.
- lower-confidence history cannot grant current access.
- provider revalidation reuses Phase 9A.
- imports are bounded and resumable.
- duplicate imports are idempotent.
- failed records are visible.
- record disposition is auditable.
- promotion into billing facts is idempotent.

## Mappings

- Mapping Sets are versioned and immutable.
- identity mapping is explicit.
- no heuristic identity merge exists.
- Product mapping uses stable provider identifiers.
- Product mapping history is preserved.
- RevenueCat Package and Offering remain metadata.
- Entitlement mappings are explicit.
- ambiguous mappings block promotion.
- active runs do not mix Mapping Set versions.

## Dry Run

- Dry Run does not change authority.
- Dry Run does not mutate production access.
- Dry Run result is immutable.
- current-access validation is reported.
- historical informational records are reported.
- quarantine is reported.
- projection result is reported.
- divergence is reported.
- application readiness is reported.
- rollback feasibility is reported.

## Shadow Mode

- source remains authoritative.
- shadow projection cannot change access.
- source and Mosaic watermarks are visible.
- shadow projections are deterministic.
- divergence categories are explicit.
- divergence severity is explicit.
- blocking divergence prevents readiness.
- source unavailable is not treated as parity.
- source deltas update shadow state.

## Cutover Readiness

- readiness is evidence-based.
- source health is checked.
- mapping completeness is checked.
- validation coverage is checked.
- projection health is checked.
- divergence thresholds are checked.
- supported application versions are checked.
- SDK migration support is checked.
- webhooks are checked.
- rollback readiness is checked.
- operational readiness is checked.
- known exceptions are explicit and approved.

## Cutover

- Cutover Checkpoint is immutable.
- final source watermark is captured.
- final delta is imported.
- final provider validation completes according to policy.
- final shadow comparison completes.
- cutover is idempotent.
- authority switches atomically.
- only one authority is current.
- authority history is append-only.
- Configuration Release reflects authority metadata.
- Customer Access Tokens reflect authority metadata.
- application webhook event is created.
- source remains available through rollback window.
- failed precommit cutover leaves source authoritative.
- postcommit propagation failures are visible.

## Stabilization

- access API health is monitored.
- SDK sync is monitored.
- source delta lag is monitored.
- divergence is monitored.
- validation backlog is monitored.
- webhook delivery is monitored.
- quarantine is monitored.
- old application versions are monitored.
- rollback readiness is monitored.
- stabilization completion criteria are explicit.

## Rollback

- rollback limitations are documented.
- Rollback Checkpoint is immutable.
- source health is verified.
- source delta is current.
- affected customer impact is shown.
- rollback requires accepted approval.
- rollback switches authority atomically.
- rollback creates a new Authority Transition.
- rollback preserves Mosaic facts.
- rollback preserves cutover history.
- rollback publishes required authority metadata.
- rollback webhook is signed and retryable.
- partial rollback is not reported as success.

## Reconciliation and Repair

- Reconciliation Cases are tenant-isolated.
- cases preserve evidence.
- accepted exceptions are explicit.
- Repair Actions are typed.
- Repair Actions are idempotent.
- Repair Actions preserve before and after state.
- immutable facts cannot be edited.
- revalidation creates new attempts.
- replay preserves history.
- generic `Mark Active` does not exist.
- repair permissions are enforced.
- repair audit is complete.

## Webhooks and Support

- logical webhook event IDs survive redelivery.
- webhook signing-key versions are recorded.
- historical replay is bounded.
- poison events can be quarantined.
- destination pause and resume work.
- support search is tenant-isolated.
- protected source identifiers are redacted.
- migration authority history is visible.
- migration completion report is generated.

## SDKs

- Flutter handles authority transition.
- iOS handles authority transition.
- Android handles authority transition.
- Go, Dart, Swift, and Kotlin agree on authority metadata.
- wrong-authority tokens fail safely.
- stale source cache expires after cutover.
- stale Mosaic cache expires after rollback.
- source and Mosaic Entitlements are not silently merged.
- purchase-provider integration remains functional.
- offline behaviour follows policy.
- old application version policy is enforced.
- diagnostics contain no secrets.

## Security and Operations

- cutover and rollback authorization are enforced.
- high-risk approval policy is implemented.
- source credentials are encrypted.
- source exports are private.
- source export downloads are protected from SSRF.
- source PII is absent from logs.
- request and job limits are enforced.
- migration jobs are resumable.
- migration workers recover after restart.
- observability covers critical paths.
- operational alerts exist.
- migration runbooks exist.
- backup and restore implications are documented.
- large synthetic migration completes within accepted targets.
- unavailable external checks are documented honestly.

---

# Required Phase 9C Demonstration

The complete demonstration should show:

```text
Connect RevenueCat migration source
→ assess source capabilities and limitations
→ capture immutable source snapshot
→ map source identities
→ map source Products to stable Mosaic Products
→ map source Entitlements
→ publish Mapping Set
→ run Dry Run
→ provider-validate current access
→ classify lower-confidence historical records
→ build shadow subscription and Entitlement projections
→ compare source and Mosaic
→ create identity and Product divergence
→ resolve through Reconciliation Cases
→ ingest a new source renewal delta
→ update shadow projection
→ reach cutover readiness
→ capture final watermark
→ import final delta
→ create Cutover Checkpoint
→ atomically switch authority to Mosaic
→ refresh Flutter, iOS, and Android
→ deliver signed authority-transition webhook
→ continue purchase flow through existing provider
→ monitor stabilization
→ simulate critical rollback trigger
→ verify source readiness
→ create Rollback Checkpoint
→ atomically switch authority back
→ preserve Mosaic history
→ repair a quarantined Product
→ replay projection
→ redeliver one webhook
→ generate Migration Completion Report
```

The one-minute demonstration should focus on:

```text
Import RevenueCat customers
→ run Dry Run
→ compare source and Mosaic access
→ resolve one divergence
→ cut over atomically
→ native SDKs refresh authoritative Entitlements
→ roll back safely without deleting history
```

---

# Phase 9C Review Document

Create:

```text
docs/reviews/phase-9c.md
```

Include the following.

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
- accepted Phase 9B review
- migration source versions
- RevenueCat API and export capabilities used
- Apple and Google provider-history capabilities used
- source evidence policy
- current-access evidence policy
- cutover authority policy
- rollback policy
- high-risk approval policy
- source export retention policy

## Completed Deliverables

Group by:

- Migration Programs
- Migration Sources
- assessment
- Source Snapshots
- Source Records
- Mapping Sets
- identity mappings
- Product mappings
- Entitlement mappings
- Import Batches
- provider revalidation
- Dry Runs
- shadow projection
- divergence
- cutover readiness
- Cutover Checkpoints
- Authority Transitions
- stabilization
- Rollback Checkpoints
- rollback
- Reconciliation Cases
- Repair Actions
- webhook operations
- support tooling
- Migration Completion Reports
- Flutter
- iOS
- Android
- migrations
- OpenAPI
- observability
- security
- performance
- runbooks
- tests
- drills

## Product Review

Include:

- validated migration demand
- optional Mosaic Billing
- source authority
- current-access evidence
- identity policy
- Product and Entitlement mappings
- cutover scope
- rollback limitations
- known exceptions
- deferred Phase 10
- owner decisions

## UX Review

Include:

- source setup
- assessment
- mapping
- import
- Dry Run
- shadow comparison
- divergence
- readiness
- cutover
- stabilization
- rollback
- reconciliation
- repair
- webhook operations
- completion
- terminology
- dead ends
- task-completion findings

## Engineering Review

Include:

- migrations
- append-only evidence
- import idempotency
- job checkpoints
- provider revalidation
- source watermarks
- mapping history
- shadow isolation
- divergence correctness
- readiness correctness
- cutover atomicity
- rollback atomicity
- authority uniqueness
- repair safety
- webhook redelivery
- SDK authority handling
- performance
- tests
- unavailable checks
- known defects

## Protocol Review

Confirm:

- Billing Migration Operations Contract is versioned.
- authority metadata is versioned or backward compatible.
- existing billing and Entitlement contracts remain compatible.
- no source-specific implementation type leaked into core contracts.
- fixtures contain no PII or credentials.
- unsupported clients fail safely.

## Security Review

Confirm:

- source credentials are encrypted.
- source export files are encrypted and private.
- source retention and deletion work.
- SSRF controls exist.
- protected identifiers are redacted.
- cross-tenant migration access fails.
- cutover and rollback permissions are enforced.
- high-risk approvals work.
- audit history is complete.
- webhook signing remains secure.
- no unsafe manual access mutation exists.

## Migration Correctness Review

Include:

- evidence classifications
- current-access validation
- identity mapping
- Product mapping
- Entitlement mapping
- historical mapping
- Dry Run results
- shadow parity
- divergence thresholds
- source and Mosaic watermarks
- final delta
- cutover result
- rollback result
- completion criteria

## SDK Review

Include:

- authority metadata
- token refresh
- cache transition
- offline behaviour
- old application version policy
- purchase-provider coexistence
- Flutter
- iOS
- Android
- conformance
- unavailable device checks

## Operational Drill Results

Record every Drill:

- environment
- dataset
- source
- commands
- evidence
- result
- defect
- recovery
- follow-up

## Phase Boundary Review

Confirm:

- no new billing semantics were introduced.
- no new Product type was introduced.
- no financial accounting was introduced.
- no AI migration decision was introduced.
- no automatic customer compensation was introduced.
- no unsafe manual Entitlement mutation was introduced.
- Phase 10 did not begin.

## Demo Review

State whether:

- assessment succeeds
- mapping succeeds
- Dry Run succeeds
- provider revalidation succeeds
- shadow comparison succeeds
- divergence repair succeeds
- final delta succeeds
- cutover succeeds
- SDK authority refresh succeeds
- webhook transition succeeds
- rollback succeeds
- reconciliation succeeds
- repair succeeds
- migration completion report succeeds
- the one-minute demonstration succeeds
- consolidated Mosaic Billing readiness is credible

## Decision

Choose one:

- Phase 9C accepted; create consolidated Phase 9 review
- Phase 9C accepted with tracked follow-ups; create consolidated Phase 9 review
- Phase 9C rejected pending fixes

Stop after producing the Phase 9C review.

Do not begin Phase 10.

Do not merge automatically.

Do not tag automatically.
