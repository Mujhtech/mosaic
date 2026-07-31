# Billing Ingestion Contract changelog

## Version 1 - 2026-07-28

Status: draft

**Approval is gated on live-sandbox verification.** The manifest stays `draft`
until Billing Ingestion `1` has been verified end to end against a live Apple
sandbox and a live Google Play test track — real credentials, a real purchase, a
real store notification, and a real provider validation. The Phase 9A
demonstration used synthetic signed vectors and recorded that limitation, which
is sufficient for `draft` and explicitly not sufficient for `approved`. A
contract that has only ever seen fixtures it authored has not been tested
against the provider behaviour it exists to normalize.

While the contract is `draft`, narrowing and additive corrections are permitted
without a version bump, per
[the breaking-change process](../../docs/protocol/breaking-change-process.md).
Amendments made under that allowance are listed below.

### Draft amendments

**2026-07-28 — optional `purchaseToken` on trusted server observations.**
Added an optional `purchaseToken` (string, 1–4096 printable non-control
characters) to `serverTransactionObservation`, permitted **only** when
`sourceAuthority` is `trusted_server_observation` and `storePlatform` is
`google_play`. A public SDK can never carry it: `clientTransactionObservation`
has no such property, so `additionalProperties: false` rejects it, and
`fixtures/billing-ingestion/v1/invalid/client-observation-carries-purchase-token.json`
pins that rejection.

This is additive and optional; every record valid before the amendment remains
valid. It exists because the app-backend endpoint accepted in the Phase 9A plan
may pass a full purchase token server-to-server, which is what makes an
observation carrying only an order reference actionable against the Play
Developer API.

A purchase token is a transaction reference the buyer's own purchase produced,
not a Mosaic provider credential. `rawProviderCredential: "forbidden"` is
unchanged and still holds: service-account keys, signing keys, and Authorization
values remain forbidden everywhere in the contract. The new transport rule is
pinned as reader policy `purchaseTokenTransport: "trustedServerObservationOnly"`
rather than left to prose, so the most dangerous field in the contract is not
the only one unenforced. The semantic validator additionally requires that a
present `purchaseToken` digests to its own `transactionReference.value`, so a
record cannot validate one purchase and be filed under another.

Billing Ingestion `1` is a new, independently versioned contract. It is not
part of the Paywall document, not embedded in Configuration Delivery, and not
carried in a Commerce Configuration sidecar. Paywall Protocol `0.2`,
Configuration Delivery `1`/`2`/`3`, Placement Decision `1`, Experiment
Assignment `1`, Analytics Event `1`/`2`, Commerce Provider `1`/`2`, and Commerce
Configuration `1`/`2` are unchanged, byte for byte.

- Added closed observation, submission-response, validation, transaction-fact,
  and compatibility-manifest schemas under
  `billingIngestionContractVersion = "1"`, with seven record types:
  `clientTransactionObservation`, `serverTransactionObservation`,
  `observationSubmissionResult`, `validationResult`, `transactionFact`,
  `productResolution`, and `quarantineRecord`.
- Separated an untrusted client observation, which is a trigger, from a trusted
  server observation, which records how trust was established but never the
  credential that established it.
- Froze the submission-result set as `accepted_for_validation`, `duplicate`,
  `permanently_rejected`, and `retryable_failure`. There is deliberately no
  member named `validated`, `verified`, `confirmed`, or `entitled`, and the
  validator fails if one is ever added.
- Added a `referenceKind` discriminator on every provider reference:
  `app_store_transaction_id` carries the raw decimal App Store transaction
  identifier, `google_play_token_digest` carries SHA-256 over the UTF-8 bytes of
  the purchase token as lowercase hexadecimal, and `google_play_order_id`
  carries the optional Google Play order reference. The digest derivation is
  pinned in the compatibility manifest as a cross-SDK contract.
- Made a raw receipt, signed payload, JWS representation, purchase token, or
  service-account credential structurally impossible to carry.
- Added a closed source-authority set with explicit precedence and froze
  `client_observation` out of every transaction fact.
- Added Store Environment classification distinct from Mosaic Environment;
  a fact is always exactly `sandbox` or `production`, and unclassified or
  sandbox records never aggregate with production.
- Added deterministic Product resolution with five closed outcomes. Only
  `resolved` may feed a transaction fact; unknown, ambiguous, cross-environment,
  and unsupported outcomes quarantine. Ambiguity requires at least two
  candidates, so a single-candidate "ambiguity" is unrepresentable.
- Added explicit retryability: a `retry` block may appear only on
  `transient_failure`, `retryable` is pinned true there, and attempt exhaustion
  becomes `permanent_failure` rather than a validated or quarantined outcome.
- Added validator version, Resolution Snapshot mapping identity and version, and
  append-only replay provenance. Replay appends and never mutates; a superseding
  fact names what it supersedes and the superseded fact is preserved.
- Defined `subjectReference` and `monetaryAmount` as optional schema fields that
  Phase 9A never populates or persists, so adding them later does not require a
  contract version.
- Over-provisioned the transaction-type, quarantine-reason, source-authority,
  and diagnostic-code vocabularies, because readers reject unknown members and
  every later addition costs a contract version.
- Added 28 canonical fixtures and 24 invalid fixtures, each invalid fixture
  violating exactly one rule, with entirely synthetic values and no real
  credential, token, receipt, signed payload, order, or subject identifier.
- Correlation to Analytics uses only the existing opaque `purchaseAttemptId`,
  `providerOperationId`, and `providerUpdateId` handles. No Analytics event is
  added or changed.
