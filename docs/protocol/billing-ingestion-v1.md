# Billing Ingestion Contract v1

Billing Ingestion Contract `1` is Mosaic's closed, platform-neutral contract for
observing, validating, and recording provider transactions. It is a **draft**:
it is not part of the approved v1 GA set and reaches `approved` only through an
explicit product-owner decision recorded in the Phase 9A review.

The contract proves a provider transaction is authentic, associates it with the
correct Mosaic Product, and preserves an auditable history. It **decides no
customer access**. There is no entitlement, no subscription state, no access
grant, and no financial accounting anywhere in it, and the compatibility
manifest pins that absence as machine-checked reader policy.

Canonical artifacts:

- `protocol/schema/billing-ingestion/v1/observation.schema.json`
- `protocol/schema/billing-ingestion/v1/submission-response.schema.json`
- `protocol/schema/billing-ingestion/v1/validation.schema.json`
- `protocol/schema/billing-ingestion/v1/transaction-fact.schema.json`
- `protocol/schema/billing-ingestion/v1/compatibility-manifest.schema.json`
- `protocol/compatibility/billing-ingestion/v1.json`
- `protocol/fixtures/billing-ingestion/v1/`
- `protocol/billing/CHANGELOG.md`

No platform type name appears anywhere in the contract. Apple and Google are
represented only by an opaque `providerId` and a closed `storePlatform`
enumeration, exactly as Commerce Configuration `2` already does. Nothing in the
contract is executable.

## Envelope and record types

Every document is an envelope:

```json
{
  "billingIngestionContractVersion": "1",
  "recordType": "clientTransactionObservation",
  "payload": {}
}
```

`additionalProperties` is `false` at every level. The record-type set is closed
at seven members and is pinned by the manifest as well as by the schemas:

| Record type | Schema | Meaning |
| --- | --- | --- |
| `clientTransactionObservation` | observation | An untrusted claim that a transaction may exist |
| `serverTransactionObservation` | observation | An observation Mosaic's server produced or verified |
| `observationSubmissionResult` | submission-response | The synchronous answer to a submission |
| `validationResult` | validation | The outcome of validating against the provider |
| `productResolution` | validation | Deterministic provider Product to Mosaic Product resolution |
| `quarantineRecord` | validation | An input or result that cannot safely proceed |
| `transactionFact` | transaction-fact | The provider-independent normalized fact |

Four schemas rather than one follows the Analytics Event precedent. Each schema
is a self-describing envelope that pins its own `recordType` subset, so a
reader dispatches on the envelope alone and a document matches exactly one
schema.

## The two rules that matter most

**Acceptance is not validation.** The submission-result set is
`accepted_for_validation`, `duplicate`, `permanently_rejected`, and
`retryable_failure`. There is no member named `validated`, `verified`,
`confirmed`, or `entitled`, and `validateBillingIngestionV1Artifacts` fails if
one is ever introduced. `accepted_for_validation` means the observation is well
formed and queued. An SDK must not grant access, unlock content, re-label a
local purchase result, or emit a provider-confirmed Analytics Event on it. This
is stricter than, and consistent with, the accepted Commerce Provider rule
`entitlementLookupFailure: "neverInferInactive"`: Mosaic neither infers absence
from failure nor presence from acceptance.

**A client never authors a fact.** `clientTransactionObservation.sourceAuthority`
is pinned to `client_observation`, and `transactionFact.sourceAuthority` cannot
be `client_observation` at all. A client observation triggers validation; the
authority on the resulting fact is that of the server-side verification. This is
the direct analogue of the Analytics rule narrowing
`purchase_completed_provider` to `trusted_server | provider_confirmed`.

## Provider references and the `referenceKind` discriminator

Every provider reference carries an explicit kind. This resolves the otherwise
ambiguous question of what each SDK actually submits.

| `referenceKind` | Store platform | Role | Derivation |
| --- | --- | --- | --- |
| `app_store_transaction_id` | `apple_app_store` | transaction | The raw decimal App Store transaction identifier, submitted verbatim, 1–24 digits |
| `google_play_token_digest` | `google_play` | transaction | **SHA-256 over the UTF-8 bytes of the Google Play purchase token, rendered as lowercase hexadecimal**, unprefixed, exactly 64 characters |
| `google_play_order_id` | `google_play` | provider order | The optional Google Play order reference, a join handle only |

The digest derivation is a **cross-SDK contract**, pinned in
`referenceKinds` in the compatibility manifest so all three SDKs and the backend
compute the identical value. A digest computed over anything other than the raw
UTF-8 token bytes, or emitted in uppercase, is a different value and will not
join.

A record's reference kind must match its store platform, and an Apple record
may not carry a Google order reference. The raw Google purchase token, an Apple
JWS representation, a receipt, a device-verification value, an
`appAccountToken`, an `appTransactionID`, and any service-account material are
all absent from the contract and structurally impossible to carry: the decimal
and hexadecimal patterns admit nothing else, and no free-form provider blob
field exists.

## Store Environment

Store Environment is the sandbox/production classification derived from verified
provider metadata. It is **not** Mosaic Environment; the two are always distinct
controls.

```json
{
  "classification": "sandbox",
  "basis": "signature_environment"
}
```

- The client never asserts it. `clientTransactionObservation` has no such
  property, so an assertion is rejected as an unknown field.
- `basis: "unknown"` requires `classification: "unclassified"`.
- A `transactionFact` is always exactly `sandbox` or `production`;
  `unclassified` is structurally absent from the fact's enumeration.
- Sandbox and unclassified records form a separate logical stream. The manifest
  pins `unclassifiedStoreEnvironment: "neverAggregateWithProduction"`: they are
  never aggregated, reported, or exported alongside production facts.
- A sandbox observation resolving against a production-scoped mapping is
  `cross_environment_mismatch` and quarantines. It is never coerced, never
  "corrected", and never dropped silently.

## Product resolution

Resolution is `provider + Application + Store Environment + provider Product
reference + effective mapping history → Mosaic Product`, and it is
reproducible: the resolved branch records the exact `mappingId` and
`mappingVersion` used, which is the Resolution Snapshot. Five closed outcomes:

| `resolution` | Required evidence |
| --- | --- |
| `resolved` | `mosaicProductId`, `mappingId`, `mappingVersion`, `productType`; optional `resolvedThroughReplacementChain` with `originalMappingId` |
| `unknown` | `reason` ∈ `no_mapping`, `mapping_archived`, `mapping_replaced_without_successor`, `mapping_out_of_scope` |
| `ambiguous` | `candidateMappingIds`, **at least two**, at most 16 |
| `cross_environment_mismatch` | `mappingId`, `observedStoreEnvironment`, `mappingStoreEnvironment` |
| `unsupported_product_type` | `providerReportedProductType` |

Only `resolved` may feed a transaction fact. Every other outcome forces
`outcome: "quarantined"`. The manifest pins
`unresolvedProduct: "quarantineNeverGuess"`. Nothing resolves by display name,
price, billing period, or approximate match, and Mosaic never selects one of
several ambiguous candidates on the reader's behalf — emitting a single
candidate is unrepresentable.

Phase 9A supports auto-renewable subscriptions and non-consumables. A provider
Product type outside that set is `unsupported_product_type`; a transaction type
outside it quarantines as `unsupported_transaction_type`.

## Validation outcomes and retryability

`outcome` is closed at six members:

| Value | Retryable | Meaning |
| --- | --- | --- |
| `validated` | n/a | The provider confirmed the transaction; a normalized fact was produced |
| `provider_rejected` | no | The provider authoritatively denies this reference. Terminal |
| `quarantined` | no | Mosaic understood the answer but cannot safely normalize it |
| `transient_failure` | yes | Provider unreachable, throttled, or timed out |
| `permanent_failure` | no | Malformed beyond repair, unsupported, or attempts exhausted |
| `superseded` | no | A higher-authority observation produced the authoritative fact instead |

Retryability is explicit, never inferred. A `retry` block may appear **only** on
`transient_failure`, and `retryable` is pinned `true` there: there is no such
thing as a non-retryable transient failure. `exhausted` must agree with
`attempt` and `maxAttempts`. Attempt exhaustion transitions the outcome to
`permanent_failure` with diagnostic code
`billing.validation.attempts_exhausted`; it never silently becomes `validated`
or `quarantined`.

The schema also pins the shape of each outcome: `validated` requires a
transaction fact and a `resolved` Product resolution and forbids quarantine and
retry; `quarantined` requires a quarantine record and forbids a fact;
`provider_rejected`, `permanent_failure`, and `superseded` forbid both a fact
and a retry.

## Source authority and precedence

```
provider_notification > trusted_server_observation > reconciliation_discovery > client_observation
```

`manual_revalidation` is not a competing authority; it is an operator-initiated
re-run. The resulting fact carries the authority of whatever source the
revalidation actually re-read, and a manual revalidation may never lower an
existing fact's authority. A lower-authority observation arriving after a
higher-authority fact exists yields `superseded`, never a competing fact and
never an overwrite.

A `serverTransactionObservation` claiming `provider_notification` must declare
`trustBasis` of `provider_signature_verified` or `mutual_tls`. An unverified
notification has no trust basis and quarantines rather than being accepted as
trusted.

## Transaction facts, replay, and append-only history

A fact records what a provider confirmed. It carries `factDigest` — its
provider-independent identity within a Mosaic Environment, never derived from a
timestamp, price, subject, or display name — plus the Resolution Snapshot,
transaction type, Store Environment, source authority, provider and Mosaic
timestamps, optional provider-reported service period and revocation, and the
`validatorVersion` that produced it.

Replay appends; it never mutates. The manifest pins
`factMutation: "forbidden"`. A superseding fact carries
`supersedesTransactionFactId` and a `replay` block naming the original
validation and validator version; the superseded fact remains byte-identical. A
replay that produces the same normalized content still produces a new fact
record — idempotent in effect, auditable in record. A replay of a client
observation never elevates its authority.

`periodEnd` on a fact is a record of what the provider said. It is not an
authorization to serve content, because no access state exists.

## Deliberately absent

Entitlement grants, access decisions, subscription state machines, an "is
active" flag, cross-platform subscriber state, MRR, ARR, LTV, tax, invoices, and
raw provider error text are all absent and frozen as absent for version `1`. The
validator additionally rejects any billing record whose property names use
Customer, Subscriber, Subscription, Entitlement, or Access Grant vocabulary.

`subjectReference` and `monetaryAmount` exist as **optional schema fields only**,
so that adding them later would not require a contract version. Phase 9A never
populates or persists either one, and no fixture carries either one.

## Compatibility and versioning

- **Exact-match reading.** `billingIngestionContractVersion: "1"` accepts only
  `"1"`. A `"2"` document is as unreadable as a `"9.9"` document.
- **Fail closed on everything unknown.** An unknown contract version, record
  type, field, outcome, resolution, quarantine reason, source authority, or
  transaction type rejects the **whole record**. There is no partial acceptance
  and no field stripping.
- **Independence.** The number `1` implies nothing about any other contract, and
  changing Billing Ingestion never authorizes changing one.
- **Every enumeration is closed**, so adding any member is a breaking change
  requiring Billing Ingestion `2`. The vocabularies are therefore deliberately
  over-provisioned.
- **Optional.** No existing contract gains a required reference to Billing
  Ingestion. An SDK that never submits an observation loses no capability.
- **Server-only in Phase 9A.** Billing records are not generated into
  `protocol/browser/generated/contract-types.d.ts`; the dashboard consumes
  OpenAPI-generated types instead. `generate-browser-contract.mjs` is
  deliberately untouched. See ADR-0022.
- **Transport is not contract.** If HTTP negotiation gains a
  `billingIngestionContractVersion` requirement in a `406`
  `unsupported_capability` detail, that is additive REST vocabulary and does not
  require a contract version bump.

The manifest is born `status: "draft"`, moves to `releaseCandidate` for the
Phase 9A review gate, and reaches `approved` only by explicit owner decision.
Narrowing corrections remain permitted while it is a release candidate, per
[the breaking-change process](breaking-change-process.md).

## Fixtures

`protocol/fixtures/billing-ingestion/v1/` holds 28 canonical fixtures —
observations at the root, plus `responses/`, `validation/`, and
`transaction-facts/` — and 24 invalid fixtures under `invalid/`, each violating
exactly one rule. `invalid/rejection-layers.json` is generated and records that
21 are rejected by the schema alone and 3 by the semantic validator (time
ordering and retry arithmetic).

Every value is synthetic. No fixture contains a real credential, purchase token,
receipt, signed payload, JWS, service-account key, order identifier, or customer
identifier, and a validator test asserts that no fixture contains a
signed-payload-shaped value. Free-form identifiers are `fixture-`-prefixed;
the App Store reference kind is constrained to decimal digits and the Google
digest kind to lowercase hexadecimal, so those two carry obviously synthetic
values of the required shape rather than a prefix.

Run `npm --prefix protocol run validate` and `npm --prefix protocol test`.

## Cross-SDK reference vectors

The `google_play_token_digest` derivation is a contract, not an implementation
detail: if the Android, Flutter, iOS, and backend implementations do not compute
byte-identical digests, observations silently fail to join and duplicates cannot
be detected. The schema constrains the digest's *shape* but cannot constrain its
*value*, so shared vectors carry that obligation:

```
packages/test-fixtures/src/billing-reference-vectors.json
```

It holds four Google Play token/digest pairs — including a non-ASCII token,
which is the only vector that distinguishes UTF-8 from UTF-16, Latin-1, or a
platform default — and four App Store transaction-id values including
`UInt64.max`, which fails any implementation that parses the identifier rather
than carrying it as a string.

`protocol/tools/billing-ingestion-validation-v1.test.mjs` recomputes every
digest and asserts the canonical vectors match the values actually carried by
`google-client-observation.json` and `apple-client-observation.json`, so the
vectors and the canonical fixtures cannot drift apart. See
[the package README](../../packages/test-fixtures/README.md).
