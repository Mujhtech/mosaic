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
may not carry a Google order reference. An Apple JWS representation, a receipt,
a device-verification value, an `appAccountToken`, an `appTransactionID`, and
any service-account or signing material are absent from the contract and
structurally impossible to carry: the decimal and hexadecimal patterns admit
nothing else, and no free-form provider blob field exists.

### The one exception: `purchaseToken` on a trusted server observation

`serverTransactionObservation` carries an optional `purchaseToken` — the full
Google Play purchase token, 1–4096 printable non-control characters — permitted
**only** when `sourceAuthority` is `trusted_server_observation` **and**
`storePlatform` is `google_play`. Both conditions are enforced by the schema.

A public SDK can never carry it. `clientTransactionObservation` has no such
property, so `additionalProperties: false` rejects it, and
`invalid/client-observation-carries-purchase-token.json` pins that rejection.
The token reaches Mosaic only over the app-backend endpoint authenticated by a
Mosaic secret key.

It exists because an app backend that holds the token can make an observation
immediately actionable against the Play Developer API, rather than requiring
Mosaic to recover the token from an order reference first.

A purchase token is a transaction reference the buyer's own purchase produced —
not a Mosaic provider credential. `rawProviderCredential: "forbidden"` is
unchanged and still holds for service-account keys, signing keys, and
Authorization values. The token's own transport rule is pinned separately as
`purchaseTokenTransport: "trustedServerObservationOnly"`, so the most dangerous
field in the contract is not the only one left to prose.

When present, the token must digest to its own `transactionReference.value`
under the same SHA-256/UTF-8/lowercase-hex derivation. The semantic validator
enforces this: a record must not be able to validate one purchase and be filed
under another. The token is encrypted at rest on receipt, never logged, never
returned on any read, and never relieves the record of full provider validation.

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

### The customer token is transport, not a record field

Phase 9B associates validated provider facts with a Billing Customer. One of the
accepted evidence types is **submission context**: the request that submitted an
observation was authenticated as a known customer.

An SDK therefore attaches its current Customer Access Token, when it holds one,
to the observation-submission request:

```http
POST /v1/sdk/billing/observations
Mosaic-SDK-Key: <public SDK key>
Mosaic-Customer-Token: mcat_<43 base64url characters>
Content-Type: application/json
```

`Mosaic-Customer-Token` is **optional**. An observation submitted without it is
valid, is validated exactly as before, and simply yields no submission-context
evidence; the fact still exists and can be associated later through a restore or
an explicit link. Nothing about Phase 9A's behaviour changes when the header is
absent, which is the whole point — 9A submissions remain conformant.

**No Billing Ingestion record schema changes.** The frozen draft stays frozen:
no observation record gains a field, no fixture changes, and
`clientTransactionObservation` still rejects any unknown property. This follows
the established rule that
[transport is not contract](#compatibility-and-versioning) — the same rule under
which a `406` negotiation detail is additive REST vocabulary rather than a
contract version bump.

#### Why a header and never the body

The credential travels in a header specifically because an observation body does
not behave like a request. It is:

- **Persisted.** The submitted record is stored as the raw input a validation was
  performed against. A credential in the body would be a bearer token written to
  the ledger, and the ledger is append-only by design — there is no path to
  redact it later.
- **Replayable.** Observations are re-validated and replayed. A credential
  embedded in a replayed body would be re-presented long after it expired, which
  either fails confusingly or, worse, succeeds against a token whose lifetime
  should have ended the association.
- **Digested.** The body participates in idempotency and fact identity. A
  rotating credential inside it would make two submissions of the same purchase
  look like two different purchases.
- **Sealed and forwarded.** Bodies are encrypted at rest and surfaced to
  operators through diagnostics. Headers are stripped at the transport boundary
  and never logged.

The header is read once, at the transport boundary, to resolve the Billing
Customer; the resolved association is recorded as evidence and the token itself
is never persisted, never logged, and never enters the record. This is the same
posture the contract already takes toward every other credential — see
[Deliberately absent](#deliberately-absent).

The token's shape, lifetime, scoping, and revocation are defined by
[Customer Access Token Contract v1](customer-access-token-v1.md).

### Quarantine vocabulary is not REST vocabulary

`quarantineRecord.reason` is the **contract** vocabulary: a closed, cross-SDK
record vocabulary that every reader must understand exactly, where adding a
member costs a contract version. The `reasonCode` on
`GET /v1/projects/{projectId}/billing/quarantine` is the **operator** vocabulary:
a diagnostics vocabulary tuned for someone reading a dashboard, free to grow with
the backend's ability to distinguish causes.

The two are deliberately not required to be equal, and today they are not. REST
carries 17 reason codes to the contract's 12, `severity` adds `security`, and
`status` uses entirely different member names. This is correct rather than a
defect: a fine-grained operator distinction such as "the credential was revoked"
versus "no credential was ever configured" is exactly what an operator needs and
exactly what a cross-SDK reader must not be forced to enumerate.

`quarantineRecord` is **not emitted on any wire in Phase 9A** — the dashboard
consumes OpenAPI types — so the collapse is defined here, before the record type
first travels, rather than discovered afterwards.

| REST `reasonCode` | Contract `quarantineReason` |
| --- | --- |
| `signature_invalid` | `unverifiable_input` |
| `application_mismatch` | `application_mismatch` |
| `environment_mismatch` | `cross_environment_mismatch` |
| `store_environment_mismatch` | `cross_environment_mismatch` |
| `credential_unavailable` | `credential_unavailable` |
| `credential_revoked` | `credential_unavailable` |
| `missing_validation_credential` | `credential_unavailable` |
| `product_unknown` | `product_unknown` |
| `product_ambiguous` | `product_ambiguous` |
| `cross_environment_mismatch` | `cross_environment_mismatch` |
| `unsupported_product_type` | `unsupported_product_type` |
| `unsupported_transaction_type` | `unsupported_transaction_type` |
| `malformed_reference` | `unverifiable_input` |
| `input_content_conflict` | `normalization_conflict` |
| `replay_conflict` | `replay_comparison_conflict` |
| `provider_permanently_failed` | `unverifiable_input` |
| `validation_exhausted` | `attempts_exhausted` |

Supporting projections:

| REST | Contract |
| --- | --- |
| `severity: security` | `severity: error` |
| `status: retrying` | `status: recovering` |
| `status: closed_after_success` | `status: recovered` |
| `status: closed_superseded` | `status: dismissed` |

`tenant_unresolved` has no REST source: an input whose tenant cannot be resolved
is quarantined by metadata alone and never reaches a Project-scoped REST
resource. It exists in the contract because a future reconciliation or export
surface would need to name that state.

The projection is lossy by design — three REST codes collapse onto
`credential_unavailable` and three onto `unverifiable_input`. If that loss turns
out to matter to operators, the fix is **one deliberate decision covering every
unmapped code at once**, taken while the manifest is still `draft` or
`releaseCandidate`. Adding members one at a time as each is noticed would
produce a contract vocabulary that mirrors the backend's internal taxonomy
without ever matching it, and would spend a contract version on each step.

### Clients may clamp `retryAfterSeconds`

The schema bounds `retryAfterSeconds` at 86400 on both the submission result and
the `retry` block, matching the Commerce Provider bound, because the driving
case is a provider outage measured in hours rather than an ingestion backpressure
signal measured in minutes.

A reader **may clamp** the value it honours to something shorter. Every Mosaic
SDK clamps to **300 seconds**: an observation queue that stops trying for a day
because one response said so is indistinguishable from a broken queue, and the
observation is a latency and attribution optimization rather than the reliable
path — store notifications are. Clamping is a local scheduling decision, not a
contract violation, and a clamping reader still accepts the full documented
range without error.

The schema maximum stays 86400 and is not narrowed to match the SDK clamp: the
server must remain able to state a long backoff to a non-SDK reader, such as an
app backend draining a queue after a provider outage.

The manifest is born `status: "draft"`, moves to `releaseCandidate` for the
Phase 9A review gate, and reaches `approved` only by explicit owner decision.
**Approval is additionally gated on live-sandbox verification**: the contract
stays `draft` until it has been exercised end to end against a live Apple
sandbox and a live Google Play test track. The Phase 9A demonstration used
synthetic signed vectors and recorded that limitation, which is enough for a
draft and deliberately not enough for an approved contract.
Narrowing corrections remain permitted while it is a release candidate, per
[the breaking-change process](breaking-change-process.md).

## Fixtures

`protocol/fixtures/billing-ingestion/v1/` holds 28 canonical fixtures —
observations at the root, plus `responses/`, `validation/`, and
`transaction-facts/` — and 24 invalid fixtures under `invalid/`, each violating
exactly one rule. `invalid/rejection-layers.json` is generated and records that
21 are rejected by the schema alone and 3 by the semantic validator (time
ordering and retry arithmetic).

Every value is synthetic, including the trusted-server fixture's
`purchaseToken`. No fixture contains a real credential, purchase token,
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
